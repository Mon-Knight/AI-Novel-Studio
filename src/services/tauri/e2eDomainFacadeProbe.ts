/**
 * E2E-only exercise for the Domain Facade layer.
 *
 * This module is imported dynamically by e2eBridge.ts and is unreachable in
 * normal builds.  It deliberately uses the real repositories/services from a
 * real Tauri WebView, so the read facades and the review/CAS facade can be
 * checked against the isolated SQLite database without adding a product API.
 */
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { createUniqueId } from '../../utils/uniqueId';
import { isTauri } from '../database/db';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { settingRepository } from '../database/settingRepository';
import { volumeRepository } from '../database/volumeRepository';
import { taskConversationService } from '../conversation/taskConversationService';
import {
  artifactCapability,
  contextCapability,
  conversationCapability,
  projectCapability,
  writingCapability,
} from '../capabilities/domain';
import type { DomainResult } from '../capabilities/domain';
import { getCanonicalToolManifest, listCanonicalToolsForAgent } from '../capabilities/canonical';
import { executeCanonicalToolForHostValidation } from '../capabilities/canonical/canonicalToolRuntime';

export interface DomainFacadeSqliteSmokeEvidence {
  storageMode: 'sqlite';
  fixture: {
    novelId: string;
    secondNovelId: string;
    volumeId: string;
    chapterId: string;
  };
  reads: {
    project: {
      ok: true;
      source: string;
      storageMode: string;
      projectId: string;
      chapterId: string;
      contentHash?: string;
    };
    position: {
      ok: true;
      source: string;
      storageMode: string;
      chapterId: string;
      volumeId?: string;
    };
    context: {
      ok: true;
      source: string;
      storageMode: string;
      projectId: string;
      chapterId: string;
    };
    crossScope: {
      ok: false;
      code?: string;
    };
  };
  canonical: {
    canonicalization: string;
    projectionHash: string;
    manifestToolIds: string[];
    manifestToolIdentities: string[];
    modelVisibleToolIdentities: string[];
    agentVisibleCount: number;
    project: {
      source: string;
      storageMode: string;
      projectId: string;
      contentHash?: string;
    };
    position: {
      source: string;
      storageMode: string;
      chapterId: string;
    };
    context: {
      source: string;
      storageMode: string;
      chapterId: string;
    };
    memory: {
      source: string;
      storageMode: string;
      itemCount: number;
    };
    legacyAliasCode?: string;
  };
  conversation: {
    conversationId: string;
    listed: boolean;
    runtimeSnapshotHasTurn: boolean;
  };
  artifact: {
    cardId: string;
    artifactId: string;
    authorizationId: string;
    draftId: string;
    adoptedDraftId?: string;
    replayCode?: string;
  };
  guards: {
    writingWithoutSnapshotCode?: string;
  };
}

function requireSuccess<T>(label: string, result: DomainResult<T>): T {
  if (!result.ok || result.data === undefined) {
    throw new Error(
      `${label} failed: ${result.error?.code ?? 'UNKNOWN'} ${result.error?.message ?? ''}`,
    );
  }
  return result.data;
}

function requireSqlite<T>(label: string, result: DomainResult<T>): T {
  if (!result.ok || result.data === undefined) return requireSuccess(label, result);
  if (result.source !== 'sqlite' || result.storageMode !== 'sqlite') {
    throw new Error(
      `${label} did not use SQLite: source=${result.source}, storageMode=${result.storageMode}`,
    );
  }
  return result.data;
}

/** Run one isolated, deterministic Domain Facade scenario in the desktop DB. */
export async function runDomainFacadeSqliteSmoke(): Promise<DomainFacadeSqliteSmokeEvidence> {
  if (!isTauri()) {
    throw new Error('Domain Facade SQLite smoke requires the Tauri runtime.');
  }

  const suffix = createUniqueId().slice(0, 8);
  const novel = await novelRepository.create({
    title: `Facade SQLite ${suffix}`,
    description: 'E2E-only Domain Facade fixture',
    genre: '测试',
  });
  const secondNovel = await novelRepository.create({
    title: `Facade SQLite Other ${suffix}`,
    genre: '测试',
  });
  const volume = await volumeRepository.create({
    novelId: novel.id,
    title: `Facade Volume ${suffix}`,
    summary: 'Facade E2E volume',
  });
  const chapter = await chapterRepository.create({
    novelId: novel.id,
    volumeId: volume.id,
    title: `Facade Chapter ${suffix}`,
    outline: 'Facade E2E outline',
    goal: 'Facade E2E goal',
    targetWordCount: 800,
  });
  await settingRepository.saveWorldSetting(null, {
    novelId: novel.id,
    title: `Facade Setting ${suffix}`,
    content: 'Facade E2E setting',
  });
  await protagonistRepository.save(null, {
    novelId: novel.id,
    name: `Facade Protagonist ${suffix}`,
    identity: '调查员',
    goal: '完成 SQLite Facade 验证',
    specialAbility: '观察',
  });

  const project = await projectCapability.readCurrentProject({
    novelId: novel.id,
    chapterId: chapter.id,
  });
  const projectData = requireSqlite('projectCapability.readCurrentProject', project);
  if (
    projectData.project.id !== novel.id ||
    !projectData.structure.chapters.some((item) => item.id === chapter.id)
  ) {
    throw new Error('Project Facade returned a mixed or incomplete SQLite DTO.');
  }

  const position = await projectCapability.readChapterPosition({
    novelId: novel.id,
    chapterId: chapter.id,
  });
  const positionData = requireSqlite('projectCapability.readChapterPosition', position);
  if (positionData.chapter.id !== chapter.id || positionData.volume?.id !== volume.id) {
    throw new Error('Chapter position Facade returned an unexpected SQLite relation.');
  }

  const context = await contextCapability.readCurrentStoryContext({
    novelId: novel.id,
    chapterId: chapter.id,
  });
  const contextData = requireSqlite('contextCapability.readCurrentStoryContext', context);
  if (contextData.project.id !== novel.id || contextData.chapter.id !== chapter.id) {
    throw new Error('Context Facade returned an unexpected SQLite scope.');
  }

  const canonicalManifest = await getCanonicalToolManifest();
  const canonicalAgentTools = await listCanonicalToolsForAgent();
  if (
    canonicalManifest.tools.map((tool) => tool.id).join(',') !==
      ['context.read', 'memory.search', 'novel.read', 'structure.read'].join(',') ||
    canonicalAgentTools.length !== 0
  ) {
    throw new Error('Canonical projection gate or stable ordering changed unexpectedly.');
  }
  const canonicalContext = {
    invocationId: `e2e-canonical-${suffix}`,
    allowedTools: canonicalManifest.tools.map((tool) => `${tool.id}@${tool.version}`),
    novelId: novel.id,
    chapterId: chapter.id,
    grantedPermissions: ['novel.read', 'chapter.read'],
  } as const;
  const runCanonical = (name: string, argumentsJson: unknown) =>
    executeCanonicalToolForHostValidation(
      {
        name,
        version: '1',
        argumentsJson,
        expectedProjectionHash: canonicalManifest.projectionHash,
      },
      canonicalContext,
    );
  const canonicalProjectResult = (await runCanonical('novel.read', {
    novelId: novel.id,
  })) as DomainResult<{ project: typeof projectData.project }>;
  const canonicalProject = requireSqlite<{ project: typeof projectData.project }>(
    'canonical novel.read',
    canonicalProjectResult,
  );
  const canonicalPositionResult = (await runCanonical('structure.read', {
    novelId: novel.id,
    chapterId: chapter.id,
  })) as DomainResult<{ chapter: typeof positionData.chapter }>;
  const canonicalPosition = requireSqlite<{ chapter: typeof positionData.chapter }>(
    'canonical structure.read',
    canonicalPositionResult,
  );
  const canonicalStoryResult = (await runCanonical('context.read', {
    novelId: novel.id,
    chapterId: chapter.id,
  })) as DomainResult<{ chapter: typeof contextData.chapter }>;
  const canonicalStory = requireSqlite<{ chapter: typeof contextData.chapter }>(
    'canonical context.read',
    canonicalStoryResult,
  );
  const canonicalMemoryResult = (await runCanonical('memory.search', {
    novelId: novel.id,
    query: 'SQLite canonical memory',
  })) as DomainResult<{ items: unknown[] }>;
  const canonicalMemory = requireSuccess<{ items: unknown[] }>(
    'canonical memory.search',
    canonicalMemoryResult,
  );
  if (!['sqlite', 'runtime'].includes(canonicalMemoryResult.source)) {
    throw new Error(
      `canonical memory.search returned an unexpected source: ${canonicalMemoryResult.source}`,
    );
  }
  const legacyAlias = await runCanonical('chapter.read_outline', {
    novelId: novel.id,
    chapterId: chapter.id,
  });
  if (legacyAlias.ok || legacyAlias.error?.code !== 'NOT_FOUND') {
    throw new Error('Canonical projection accepted a legacy technical alias.');
  }

  const crossScope = await projectCapability.readChapterPosition({
    novelId: secondNovel.id,
    chapterId: chapter.id,
  });
  if (crossScope.ok) throw new Error('Cross-novel chapter access was not rejected.');

  const conversation = await taskConversationService.create(novel.id, `Facade task ${suffix}`);
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    'Facade SQLite smoke',
  );
  const summaries = requireSuccess(
    'conversationCapability.listTaskSummaries',
    await conversationCapability.listTaskSummaries({ novelId: novel.id }),
  );
  const runtime = requireSuccess(
    'conversationCapability.readRuntimeSnapshot',
    await conversationCapability.readRuntimeSnapshot({
      novelId: novel.id,
      conversationId: conversation.conversationId,
    }),
  );
  if (!summaries.some((item) => item.conversationId === conversation.conversationId)) {
    throw new Error('Conversation Facade did not read the SQLite task.');
  }
  if (!runtime.turns.some((item) => item.turnId === turn.turnId)) {
    throw new Error('Conversation Facade did not project the SQLite turn.');
  }

  const published = requireSuccess(
    'artifactCapability.publishCandidate',
    await artifactCapability.publishCandidate({
      novelId: novel.id,
      chapterId: chapter.id,
      conversationId: conversation.conversationId,
      artifactType: 'chapter_text',
      title: `Facade Candidate ${suffix}`,
      summary: 'SQLite Facade candidate',
      structuredPayload: {
        data: {
          novelId: novel.id,
          chapterId: chapter.id,
          text: 'Facade SQLite candidate body',
        },
      },
    }),
  );
  if (!published.cardId || !published.artifactId) {
    throw new Error('SQLite candidate did not produce durable card/artifact identities.');
  }

  const review = requireSuccess(
    'artifactCapability.requestReview',
    await artifactCapability.requestReview({
      novelId: novel.id,
      chapterId: chapter.id,
      conversationId: conversation.conversationId,
      cardId: published.cardId,
      artifactId: published.artifactId,
      userConfirmedAt: new Date().toISOString(),
    }),
  );
  if (!review.authorizationId) throw new Error('SQLite review did not issue authorization.');

  const draftContent = `Facade SQLite adopted body ${suffix}`;
  const draft = await draftVersionService.create({
    novelId: novel.id,
    chapterId: chapter.id,
    content: draftContent,
    source: 'user_edited',
    title: `Facade Draft ${suffix}`,
  });
  const draftHash = await computeContentSha256(draftContent);
  const adopted = requireSuccess(
    'artifactCapability.applyAuthorizedDraft',
    await artifactCapability.applyAuthorizedDraft({
      novelId: novel.id,
      chapterId: chapter.id,
      authorizationId: review.authorizationId,
      draftId: draft.id,
      expectedDraftVersion: draft.versionNo,
      expectedContentHash: draftHash,
    }),
  );
  const replay = await artifactCapability.applyAuthorizedDraft({
    novelId: novel.id,
    chapterId: chapter.id,
    authorizationId: review.authorizationId,
    draftId: draft.id,
    expectedDraftVersion: draft.versionNo,
    expectedContentHash: draftHash,
  });
  if (replay.ok || replay.error?.code !== 'CONFLICT') {
    throw new Error('SQLite authorization replay was not rejected idempotently.');
  }

  const afterAdopt = requireSqlite(
    'projectCapability.readChapterPosition after adoption',
    await projectCapability.readChapterPosition({
      novelId: novel.id,
      chapterId: chapter.id,
    }),
  );
  if (afterAdopt.chapter.adoptedDraftId !== draft.id) {
    throw new Error('SQLite adoption did not update the authoritative chapter pointer.');
  }

  const writingGuard = await writingCapability.generateCandidate({
    novelId: novel.id,
    chapterId: chapter.id,
    instruction: 'E2E guard only',
  });
  if (writingGuard.ok || writingGuard.error?.code !== 'MODEL_SNAPSHOT_REQUIRED') {
    throw new Error('Writing Facade did not fail closed without a model snapshot.');
  }

  return {
    storageMode: 'sqlite',
    fixture: {
      novelId: novel.id,
      secondNovelId: secondNovel.id,
      volumeId: volume.id,
      chapterId: chapter.id,
    },
    reads: {
      project: {
        ok: true,
        source: project.source,
        storageMode: project.storageMode,
        projectId: projectData.project.id,
        chapterId: projectData.structure.chapters.find((item) => item.id === chapter.id)!.id,
        contentHash: project.contentHash,
      },
      position: {
        ok: true,
        source: position.source,
        storageMode: position.storageMode,
        chapterId: positionData.chapter.id,
        ...(positionData.volume ? { volumeId: positionData.volume.id } : {}),
      },
      context: {
        ok: true,
        source: context.source,
        storageMode: context.storageMode,
        projectId: contextData.project.id,
        chapterId: contextData.chapter.id,
      },
      crossScope: {
        ok: false,
        code: crossScope.error?.code,
      },
    },
    canonical: {
      canonicalization: canonicalManifest.canonicalization,
      projectionHash: canonicalManifest.projectionHash,
      manifestToolIds: canonicalManifest.tools.map((tool) => tool.id),
      manifestToolIdentities: canonicalManifest.tools.map((tool) => `${tool.id}@${tool.version}`),
      modelVisibleToolIdentities: [...canonicalManifest.modelVisibleToolIdentities],
      agentVisibleCount: canonicalAgentTools.length,
      project: {
        source: canonicalProjectResult.source,
        storageMode: canonicalProjectResult.storageMode,
        projectId: canonicalProject.project.id,
        contentHash: canonicalProjectResult.contentHash,
      },
      position: {
        source: canonicalPositionResult.source,
        storageMode: canonicalPositionResult.storageMode,
        chapterId: canonicalPosition.chapter.id,
      },
      context: {
        source: canonicalStoryResult.source,
        storageMode: canonicalStoryResult.storageMode,
        chapterId: canonicalStory.chapter.id,
      },
      memory: {
        source: canonicalMemoryResult.source,
        storageMode: canonicalMemoryResult.storageMode,
        itemCount: canonicalMemory.items.length,
      },
      legacyAliasCode: legacyAlias.error?.code,
    },
    conversation: {
      conversationId: conversation.conversationId,
      listed: summaries.some((item) => item.conversationId === conversation.conversationId),
      runtimeSnapshotHasTurn: runtime.turns.some((item) => item.turnId === turn.turnId),
    },
    artifact: {
      cardId: published.cardId,
      artifactId: published.artifactId,
      authorizationId: review.authorizationId,
      draftId: draft.id,
      adoptedDraftId: adopted.draftId,
      replayCode: replay.error?.code,
    },
    guards: {
      writingWithoutSnapshotCode: writingGuard.error?.code,
    },
  };
}
