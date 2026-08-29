/// <reference types="@wdio/globals/types" />

import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  bridgeCall,
  runDomainFacadeSqliteSmoke,
  waitForTestId,
} from './helpers';

interface DomainFacadeSqliteSmokeEvidence {
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
    crossScope: { ok: false; code?: string };
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
    position: { source: string; storageMode: string; chapterId: string };
    context: { source: string; storageMode: string; chapterId: string };
    memory: { source: string; storageMode: string; itemCount: number };
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
  guards: { writingWithoutSnapshotCode?: string };
}

describe('Domain Facade SQLite production chain', () => {
  it('runs real facades against isolated SQLite and survives a WebView restart', async () => {
    await waitForTestId('app-shell');
    const evidence = await runDomainFacadeSqliteSmoke<DomainFacadeSqliteSmokeEvidence>();

    expect(evidence.storageMode).toBe('sqlite');
    expect(evidence.reads.project).toMatchObject({
      ok: true,
      source: 'sqlite',
      storageMode: 'sqlite',
      projectId: evidence.fixture.novelId,
      chapterId: evidence.fixture.chapterId,
    });
    expect(evidence.reads.position).toMatchObject({
      ok: true,
      source: 'sqlite',
      storageMode: 'sqlite',
      chapterId: evidence.fixture.chapterId,
      volumeId: evidence.fixture.volumeId,
    });
    expect(evidence.reads.context).toMatchObject({
      ok: true,
      source: 'sqlite',
      storageMode: 'sqlite',
      projectId: evidence.fixture.novelId,
      chapterId: evidence.fixture.chapterId,
    });
    expect(evidence.reads.crossScope).toEqual({ ok: false, code: 'SCOPE_MISMATCH' });
    expect(evidence.canonical.manifestToolIds).toEqual([
      'context.read',
      'memory.search',
      'novel.read',
      'structure.read',
    ]);
    expect(evidence.canonical.canonicalization).toBe('ans_canonical_json_v1');
    expect(evidence.canonical.projectionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.canonical.modelVisibleToolIdentities).toEqual([]);
    expect(evidence.canonical.agentVisibleCount).toBe(0);
    expect(evidence.canonical.project).toMatchObject({
      source: 'sqlite',
      storageMode: 'sqlite',
      projectId: evidence.fixture.novelId,
    });
    expect(evidence.canonical.position).toMatchObject({
      source: 'sqlite',
      storageMode: 'sqlite',
      chapterId: evidence.fixture.chapterId,
    });
    expect(evidence.canonical.context).toMatchObject({
      source: 'sqlite',
      storageMode: 'sqlite',
      chapterId: evidence.fixture.chapterId,
    });
    expect(evidence.canonical.memory.source).toMatch(/^(sqlite|runtime)$/);
    expect(evidence.canonical.memory.storageMode).toMatch(/^(sqlite|runtime)$/);
    expect(evidence.canonical.memory.itemCount).toBe(0);
    expect(evidence.canonical.legacyAliasCode).toBe('NOT_FOUND');
    expect(evidence.conversation.listed).toBe(true);
    expect(evidence.conversation.runtimeSnapshotHasTurn).toBe(true);
    expect(evidence.artifact.adoptedDraftId).toBe(evidence.artifact.draftId);
    expect(evidence.artifact.replayCode).toBe('CONFLICT');
    expect(evidence.guards.writingWithoutSnapshotCode).toBe('MODEL_SNAPSHOT_REQUIRED');

    const beforeDiagnostics = await bridgeCall<{
      enabled: boolean;
      schemaReady: boolean;
      integrityCheck: string;
      canonicalManifest: {
        canonicalization: string;
        projectionHash: string;
        toolIdentities: string[];
        modelVisibleToolIdentities: string[];
      };
    }>('get_e2e_diagnostics');
    expect(beforeDiagnostics).toMatchObject({
      enabled: true,
      schemaReady: true,
      integrityCheck: 'ok',
    });
    expect(beforeDiagnostics.canonicalManifest).toMatchObject({
      canonicalization: evidence.canonical.canonicalization,
      projectionHash: evidence.canonical.projectionHash,
      toolIdentities: evidence.canonical.manifestToolIdentities,
      modelVisibleToolIdentities: evidence.canonical.modelVisibleToolIdentities,
    });

    await browser.reloadSession();
    await waitForTestId('app-shell');

    const chapters = await bridgeCall<
      Array<{ id: string; novelId: string; adoptedDraftId?: string }>
    >('get_chapters_by_novel_id', { novelId: evidence.fixture.novelId });
    const chapter = chapters.find((item) => item.id === evidence.fixture.chapterId);
    expect(chapter).toMatchObject({
      id: evidence.fixture.chapterId,
      novelId: evidence.fixture.novelId,
      adoptedDraftId: evidence.artifact.draftId,
    });

    const conversation = await bridgeCall<{
      conversation: { conversationId: string; novelId: string };
      turns: Array<{ turnId: string }>;
      artifacts: Array<{ artifactId?: string }>;
    } | null>('get_task_conversation', { conversationId: evidence.conversation.conversationId });
    expect(conversation?.conversation).toMatchObject({
      conversationId: evidence.conversation.conversationId,
      novelId: evidence.fixture.novelId,
    });
    expect(conversation?.turns.length).toBeGreaterThanOrEqual(1);
    expect(
      conversation?.artifacts.some((item) => item.artifactId === evidence.artifact.artifactId),
    ).toBe(true);

    const authorization = await bridgeCall<{ status: string; consumedByDraftId?: string } | null>(
      'get_review_authorization',
      { authorizationId: evidence.artifact.authorizationId },
    );
    expect(authorization).toMatchObject({
      status: 'consumed',
      consumedByDraftId: evidence.artifact.draftId,
    });

    const drafts = await bridgeCall<
      Array<{ id: string; novelId: string; chapterId: string; isAdopted: boolean }>
    >('get_drafts_by_chapter_id', { chapterId: evidence.fixture.chapterId });
    expect(drafts.find((item) => item.id === evidence.artifact.draftId)).toMatchObject({
      id: evidence.artifact.draftId,
      novelId: evidence.fixture.novelId,
      chapterId: evidence.fixture.chapterId,
      isAdopted: true,
    });

    await assertCleanDiagnostics();
  });
});
