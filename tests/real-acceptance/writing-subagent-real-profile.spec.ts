import fs from 'node:fs';
import path from 'node:path';
import { browser, expect } from '@wdio/globals';
import { waitForTestId } from '../e2e/helpers';
import {
  collectConversationEvidence,
  createFixtureChapter,
  invoke,
  isRuntimeProjection,
  readChapterInvariants,
  readWritingSubAgentFlag,
  sanitizeError,
  seedCoreAssets,
  setWritingSubAgentFlag,
  startChapterTaskThroughUi,
  waitForTerminalConversationStatus,
  type ChapterDto,
  type NovelDto,
} from './production-app-helpers';
import {
  REAL_PROFILE_ENV,
  WRITING_SUBAGENT_ALLOWLIST,
  WRITING_SUBAGENT_CANDIDATE_TOOL,
  WRITING_SUBAGENT_READ_TOOLS,
  hardChapterWordRange,
} from './real-profile-env';

/**
 * Writing SubAgent gate E-4a: one real `chapter_write` turn through the production
 * desktop app with the model card the operator already configured in the client.
 *
 * Evidence stays sanitized: tool names, statuses, counts, lengths and hashes only.
 * No prompt, no chapter text and no credential ever leaves the application.
 */

const FIXTURE_TITLE_PREFIX = 'Writing SubAgent E-4 真实验收';

describe('Writing SubAgent real-profile acceptance (E-4a)', () => {
  it('runs one chapter_write turn with the client model card and keeps the candidate review-only', async () => {
    const artifactRoot = process.env[REAL_PROFILE_ENV.artifacts];
    if (!artifactRoot) throw new Error(`${REAL_PROFILE_ENV.artifacts} is required.`);
    fs.mkdirSync(artifactRoot, { recursive: true });
    const evidencePath = path.join(artifactRoot, 'writing-subagent-real-profile.json');
    const modelHint = (process.env[REAL_PROFILE_ENV.modelHint] ?? 'gemini').toLowerCase();
    const targetWordCount = Number(process.env[REAL_PROFILE_ENV.targetWordCount] ?? '1000');
    const turnTimeoutMs = Number(
      process.env[REAL_PROFILE_ENV.turnTimeoutMs] ?? String(15 * 60_000),
    );
    const wordRange = hardChapterWordRange(targetWordCount);
    const startedAt = new Date();

    const evidence: Record<string, unknown> = {
      schemaVersion: 1,
      gate: 'writing-subagent-E4a',
      runId: process.env[REAL_PROFILE_ENV.runId] ?? null,
      startedAt: startedAt.toISOString(),
      carrier: 'production-app-real-profile',
      modelHint,
      fixture: { targetWordCount, hardWordRange: wordRange },
      allowlist: [...WRITING_SUBAGENT_ALLOWLIST],
      verdict: 'INCOMPLETE',
    };
    const persistEvidence = () => {
      evidence.finishedAt = new Date().toISOString();
      evidence.durationMs = Date.now() - startedAt.getTime();
      fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    };

    let novelId = '';
    let chapterId = '';
    try {
      await waitForTestId('app-shell');

      // 1. Dedicated fixture novel with every core asset the chapter gate requires.
      //    Re-use an earlier fixture so repeated runs do not litter the library.
      const existingNovels = await invoke<NovelDto[]>('get_all_novels');
      const existingFixture = existingNovels.find((item) =>
        item.title.startsWith(FIXTURE_TITLE_PREFIX),
      );
      let fixtureReused = false;
      if (existingFixture) {
        novelId = existingFixture.id;
        fixtureReused = true;
      } else {
        const novel = await invoke<NovelDto>('create_novel', {
          input: {
            title: FIXTURE_TITLE_PREFIX,
            genre: '玄幻',
            description: '仅用于 Writing SubAgent 真实模型验收的固定作品，可随时删除。',
            targetWordCount: 60000,
          },
        });
        novelId = novel.id;
      }
      if (!fixtureReused) await seedCoreAssets(novelId);
      const existingChapters = await invoke<ChapterDto[]>('get_chapters_by_novel_id', {
        novelId,
      });
      const volumeId = fixtureReused
        ? undefined
        : (
            await invoke<{ id: string }>('create_volume', {
              input: { novelId, title: '第一卷 试炼', orderIndex: 0 },
            })
          ).id;
      const chapterIndex = existingChapters.length;
      const stamp = startedAt.toISOString().slice(11, 16);
      const chapter = await createFixtureChapter({
        novelId,
        volumeId,
        title: `第${chapterIndex + 1}章 苍穹惊变（验收 ${stamp}）`,
        orderIndex: chapterIndex,
        targetWordCount,
      });
      chapterId = chapter.id;
      evidence.fixture = {
        ...(evidence.fixture as Record<string, unknown>),
        novelId,
        fixtureReused,
        chapterId,
        chapterStatusBefore: chapter.status ?? null,
        chapterWordCountBefore: chapter.wordCount ?? 0,
      };

      // 2. v3.7.0 opens the Writing SubAgent for desktop API models by default; make sure no
      //    stale override is present so this run proves the default path.
      await setWritingSubAgentFlag(false);
      evidence.flagMode = 'default (no override)';

      // 3. Drive the production workbench exactly like a user would.
      const started = await startChapterTaskThroughUi({
        novelId,
        chapterId,
        goal: '生成本章正文，描写演武场激战与天生异象',
        modelHint,
      });
      evidence.modelCatalog = started.catalog;
      evidence.selectedModelKey = started.selectedModelKey;
      evidence.conversationId = started.conversationId;
      expect(started.selectedModelKey.toLowerCase()).toContain(modelHint);

      // 4. Wait for a terminal status.
      const turnStartedAt = Date.now();
      const finalDomStatus = await waitForTerminalConversationStatus({
        timeoutMs: turnTimeoutMs,
        label: 'chapter_write',
        onProgress: (status, tools) => {
          // eslint-disable-next-line no-console -- a real turn takes minutes; surface tool-level progress.
          console.log(
            `[REAL PROFILE] status=${status} elapsed=${Math.round((Date.now() - turnStartedAt) / 1000)}s tools=${tools
              .map((event) => `${event.toolName}:${event.status}`)
              .join(',')}`,
          );
        },
      });
      evidence.turnDurationMs = Date.now() - turnStartedAt;

      // 5. Collect sanitized evidence from the authoritative conversation bundle.
      const { bundle, evidence: conversationEvidence } = await collectConversationEvidence({
        conversationId: started.conversationId,
        fixtureNovelId: novelId,
        fixtureChapterId: chapterId,
        hardWordRange: wordRange,
      });
      const outsideAllowlist = conversationEvidence.toolEvents
        .map((event) => event.toolName)
        .filter((toolName) => !isRuntimeProjection(toolName))
        .filter((toolName) => !WRITING_SUBAGENT_ALLOWLIST.has(toolName));
      const invariants = await readChapterInvariants({ novelId, chapterId });
      Object.assign(evidence, {
        conversationStatusDom: finalDomStatus,
        ...conversationEvidence,
        toolNamesOutsideAllowlist: outsideAllowlist,
        invariants: {
          chapterStatusAfter: invariants.chapterStatus,
          chapterWordCountAfter: invariants.chapterWordCount,
          draftCountAfter: invariants.draftCount,
          novelTotalWordCountAfter: invariants.novelTotalWordCount,
        },
      });

      // 6. Acceptance criteria.
      const runs = conversationEvidence.runs;
      const lastRun = runs[runs.length - 1];
      const failures: string[] = [];
      if (runs.length < 1) failures.push('no run was recorded');
      if (outsideAllowlist.length > 0) {
        failures.push(
          `tools outside the Writing SubAgent allowlist: ${outsideAllowlist.join(',')}`,
        );
      }
      if (lastRun && !(lastRun.modelId ?? '').toLowerCase().includes(modelHint)) {
        failures.push(`run model ${lastRun.modelId ?? '<none>'} does not match hint ${modelHint}`);
      }
      if (invariants.chapterWordCount !== (chapter.wordCount ?? 0)) {
        failures.push('formal chapter word count changed during a candidate-only turn');
      }
      if (invariants.draftCount !== 0) {
        failures.push(`candidate-only turn created ${invariants.draftCount} chapter draft(s)`);
      }
      if (bundle.conversation.status === 'waiting_user') {
        if (lastRun?.status !== 'completed') {
          failures.push(
            `last run status ${lastRun?.status ?? '<none>'} while conversation waits for user`,
          );
        }
        if (
          !conversationEvidence.toolEvents.some(
            (event) =>
              event.toolName === WRITING_SUBAGENT_CANDIDATE_TOOL && event.status === 'succeeded',
          )
        ) {
          failures.push(`${WRITING_SUBAGENT_CANDIDATE_TOOL} never succeeded`);
        }
        if (
          !WRITING_SUBAGENT_READ_TOOLS.some((tool) =>
            conversationEvidence.toolEvents.some(
              (event) => event.toolName === tool && event.status === 'succeeded',
            ),
          )
        ) {
          failures.push('no Writing SubAgent read tool succeeded before the candidate');
        }
        const candidates = conversationEvidence.artifacts.filter(
          (artifact) => artifact.artifactType === 'chapter_text' && artifact.status === 'candidate',
        );
        if (candidates.length < 1) failures.push('no chapter_text candidate card was produced');
        if (candidates.some((artifact) => artifact.boundToFixtureChapter === false)) {
          failures.push('a chapter_text candidate is bound to a different chapter');
        }
      } else {
        failures.push(
          `conversation ended in ${bundle.conversation.status}: ${lastRun?.error ?? 'no run error recorded'}`,
        );
      }
      evidence.failures = failures;
      evidence.verdict = failures.length === 0 ? 'PASS' : 'FAIL';
      expect(failures).toEqual([]);
    } finally {
      if (evidence.verdict !== 'PASS') {
        // Local diagnosis only (test-results/ is ignored by git); the screenshot may show
        // candidate text and therefore never becomes committed evidence.
        try {
          await browser.saveScreenshot(path.join(artifactRoot, 'final-state.png'));
        } catch {
          /* best effort */
        }
      }
      try {
        await setWritingSubAgentFlag(false);
        evidence.flagRestored = (await readWritingSubAgentFlag()) === null;
      } catch (error) {
        evidence.flagRestored = false;
        evidence.flagRestoreError = sanitizeError(
          error instanceof Error ? error.message : String(error),
        );
      }
      persistEvidence();
      // eslint-disable-next-line no-console -- the evidence path is the operator's hand-off.
      console.log(`[REAL PROFILE] evidence written to ${evidencePath}`);
    }
  });
});
