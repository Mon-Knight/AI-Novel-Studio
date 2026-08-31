import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ToolCallEvent } from '../../types/conversation';
import { GenerationContextReceipt, GenerationContextSummary } from './WorkbenchContextReceipt';
import {
  hideContextReceiptInternals,
  resolveToolContextReceipt,
} from './workbenchContextReceiptModel';

function toolEvent(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return {
    eventId: 'event-generate',
    runId: 'run-context',
    sequence: 20,
    toolName: 'generate_chapter',
    argumentsSummary: {},
    status: 'succeeded',
    createdAt: '2026-08-29T01:00:00.000Z',
    finishedAt: '2026-08-29T01:00:01.000Z',
    ...overrides,
  };
}

test('explicit generation receipts expose formal asset status without source content or identities', () => {
  const receipt = resolveToolContextReceipt(
    toolEvent({
      result: {
        ok: true,
        generationContext: {
          contextHash: 'full-context-hash-must-stay-hidden',
          providerRequestEvidence: {
            snapshotRequestSourceStatus: 'included',
            snapshotContextHash: '5'.repeat(64),
            messagesSha256: '7'.repeat(64),
            compiledContextSha256: '6'.repeat(64),
            messageCount: 3,
            apiKey: 'secret-api-key-must-stay-hidden',
          },
          sources: [
            {
              type: 'world_setting',
              title: 'secret-world-title',
              status: 'used',
              revision: 7,
              sourceId: 'full-world-id-must-stay-hidden',
              summary: 'secret-world-content-must-stay-hidden',
            },
            {
              type: 'world_setting',
              title: 'secret-world-title',
              status: 'used',
              revision: 7,
              sourceId: 'full-world-id-must-stay-hidden',
            },
            { type: 'rule_system', title: 'secret-rules', status: 'used' },
            { type: 'protagonist', title: 'secret-protagonist', status: 'missing' },
            { type: 'master_outline', title: 'secret-book-outline', status: 'used' },
            { type: 'volume_outline', title: 'secret-volume-outline', status: 'missing' },
            { type: 'chapter_outline', title: 'secret-chapter-outline', status: 'used' },
            { type: 'style_profile', title: 'secret-style', status: 'fallback' },
            { type: 'output_profile', title: 'secret-output', status: 'used', version: 2 },
            {
              type: 'reference_material',
              title: 'secret-reference-title',
              status: 'used',
              summary: 'secret-reference-excerpt-must-stay-hidden',
            },
            { type: 'memory_context', title: 'secret-memory', status: 'missing' },
            {
              type: 'future_source',
              title: 'raw-transcript-must-stay-hidden',
              status: 'used',
            },
          ],
        },
      },
    }),
  );

  assert.ok(receipt);
  assert.equal(receipt.evidence, 'explicit');
  assert.equal(receipt.snapshotRequestSourceStatus, 'included');
  assert.deepEqual(
    receipt.sources.map((source) => source.title),
    [
      '世界设定',
      '规则设定',
      '主角设定',
      '全书大纲',
      '分卷大纲',
      '章节大纲',
      '风格方案',
      '输出控制',
      '长期记忆（Memory）',
      '参考资料',
      '其他上下文',
    ],
  );
  assert.equal(receipt.sources.find((source) => source.type === 'world_setting')?.detail, '修订 7');
  assert.equal(receipt.sources.find((source) => source.type === 'output_profile')?.detail, 'v2');
  assert.deepEqual(receipt.evidenceChain, {
    snapshot: {
      usedCount: 7,
      sourceCount: 11,
      reference: 'sha256:55555555...5555',
    },
    provider: {
      status: 'included',
      includedCount: 7,
      sourceCount: 11,
      reference: 'sha256:77777777...7777',
      messageCount: 3,
    },
  });

  const html = renderToStaticMarkup(createElement(GenerationContextReceipt, { receipt }));
  assert.match(html, /运行后上下文回执/);
  assert.match(html, /data-context-stage="provider-receipt"/);
  assert.match(html, /已注入 7 项/);
  assert.match(html, /冻结快照/);
  assert.match(html, /读取 7\/11/);
  assert.match(html, /Provider 请求/);
  assert.match(html, /注入 7\/11/);
  assert.match(html, /ctx sha256:55555555\.\.\.5555/);
  assert.match(html, /req sha256:77777777\.\.\.7777/);
  assert.match(html, /3 条消息/);
  assert.match(html, /已注入 7/);
  assert.match(html, /逐条 Provider 来源证据/);
  assert.match(html, /已实际注入/);
  assert.match(html, /本轮未使用 3/);
  assert.match(html, /本轮无来源/);
  assert.match(html, /已降级 1/);
  assert.match(html, /世界设定/);
  assert.match(html, /规则设定/);
  assert.match(html, /主角设定/);
  assert.match(html, /全书大纲/);
  assert.match(html, /分卷大纲/);
  assert.match(html, /章节大纲/);
  assert.match(html, /风格方案/);
  assert.match(html, /输出控制/);
  assert.match(html, /参考资料/);
  assert.match(html, /长期记忆（Memory）/);
  assert.doesNotMatch(html, /secret-/);
  assert.doesNotMatch(html, /must-stay-hidden/);
  assert.doesNotMatch(html, /raw-transcript/);
  assert.doesNotMatch(html, new RegExp('5'.repeat(64), 'u'));
  assert.doesNotMatch(html, new RegExp('6'.repeat(64), 'u'));
  assert.doesNotMatch(html, new RegExp('7'.repeat(64), 'u'));

  const summaryHtml = renderToStaticMarkup(createElement(GenerationContextSummary, { receipt }));
  assert.match(summaryHtml, /快照 7\/11 · sha256:55555555\.\.\.5555/);
  assert.match(summaryHtml, /Provider 7\/11 · sha256:77777777\.\.\.7777/);
  assert.doesNotMatch(summaryHtml, /must-stay-hidden/);
});

test('truncated Provider request evidence downgrades snapshot usage instead of claiming injection', () => {
  const receipt = resolveToolContextReceipt(
    toolEvent({
      result: {
        generationContext: {
          providerRequestEvidence: { snapshotRequestSourceStatus: 'truncated' },
          sources: [
            { type: 'world_setting', status: 'used' },
            { type: 'chapter_outline', status: 'used' },
            { type: 'memory_context', status: 'missing' },
          ],
        },
      },
    }),
  );

  assert.ok(receipt);
  assert.equal(receipt.snapshotRequestSourceStatus, 'truncated');
  assert.deepEqual(
    receipt.sources.map((source) => source.status),
    ['truncated', 'truncated', 'missing'],
  );
  const html = renderToStaticMarkup(createElement(GenerationContextReceipt, { receipt }));
  assert.match(html, /总体 Provider 证据显示来源在进入本次请求时被截断/);
  assert.match(html, /请求截断 2/);
  assert.match(html, /快照存在 · Provider 请求被截断/);
  assert.match(html, /has-warning-tone/);
  assert.doesNotMatch(html, /has-error-tone/);
  assert.doesNotMatch(html, /data-context-status="used"/);
  assert.doesNotMatch(html, /已实际注入/);
});

test('per-source Provider evidence overrides the legacy request status while provider status controls the receipt headline', () => {
  const receipt = resolveToolContextReceipt(
    toolEvent({
      result: {
        generationContext: {
          providerRequestEvidence: {
            snapshotRequestSourceStatus: 'truncated',
            providerSourceStatus: 'included',
            generationSourceStatuses: {
              world_setting: 'included',
              chapter_outline: 'truncated',
            },
          },
          sources: [
            { type: 'world_setting', status: 'used' },
            { type: 'chapter_outline', status: 'used' },
          ],
        },
      },
    }),
  );

  assert.ok(receipt);
  assert.equal(receipt.snapshotRequestSourceStatus, 'included');
  assert.equal(receipt.sources.find((source) => source.type === 'world_setting')?.status, 'used');
  assert.equal(
    receipt.sources.find((source) => source.type === 'chapter_outline')?.status,
    'truncated',
  );

  const html = renderToStaticMarkup(createElement(GenerationContextReceipt, { receipt }));
  assert.match(html, /逐条 Provider 来源证据/);
  assert.match(html, /已注入 1 项/);
  assert.match(html, /已注入 1/);
  assert.match(html, /请求截断 1/);
});

test('legacy Provider fixtures without per-source statuses keep their aggregate compatibility path', () => {
  const receipt = resolveToolContextReceipt(
    toolEvent({
      result: {
        generationContext: {
          providerRequestEvidence: { snapshotRequestSourceStatus: 'included' },
          sources: [
            { type: 'world_setting', status: 'used' },
            { type: 'chapter_outline', status: 'used' },
          ],
        },
      },
    }),
  );

  assert.ok(receipt);
  assert.equal(receipt.snapshotRequestSourceStatus, 'included');
  assert.deepEqual(
    receipt.sources.map((source) => source.status),
    ['used', 'used'],
  );
});

for (const snapshotRequestSourceStatus of ['omitted_empty', 'omitted_budget'] as const) {
  test(`${snapshotRequestSourceStatus} Provider evidence marks snapshot sources as omitted`, () => {
    const receipt = resolveToolContextReceipt(
      toolEvent({
        result: {
          data: {
            generationContext: {
              providerRequestEvidence: { snapshotRequestSourceStatus },
              sources: [{ type: 'world_setting', status: 'used' }],
            },
          },
        },
      }),
    );

    assert.ok(receipt);
    assert.equal(receipt.snapshotRequestSourceStatus, snapshotRequestSourceStatus);
    assert.equal(receipt.sources[0]?.status, 'omitted');
    const html = renderToStaticMarkup(createElement(GenerationContextReceipt, { receipt }));
    assert.match(html, /总体 Provider 证据显示快照来源未进入本次请求/);
    assert.match(html, /未纳入 1/);
    assert.match(
      html,
      new RegExp(`data-provider-source-status="${snapshotRequestSourceStatus}"`, 'u'),
    );
    assert.match(
      html,
      snapshotRequestSourceStatus === 'omitted_empty' ? /空来源未纳入/ : /预算未纳入/,
    );
    assert.match(html, /has-error-tone/);
    assert.doesNotMatch(html, /has-warning-tone/);
    assert.doesNotMatch(html, /data-context-status="used"/);
    assert.doesNotMatch(html, /已实际注入/);
  });
}

test('generation snapshots without Provider request evidence remain unverified', () => {
  const receipt = resolveToolContextReceipt(
    toolEvent({
      result: {
        generationContext: {
          contextHash: 'txt_deadbeef',
          sources: [{ type: 'world_setting', status: 'used' }],
        },
      },
    }),
  );

  assert.ok(receipt);
  assert.equal(receipt.snapshotRequestSourceStatus, 'unverified');
  assert.equal(receipt.sources[0]?.status, 'snapshot');
  assert.equal(receipt.evidenceChain?.snapshot.reference, 'txt_deadbeef');
  assert.equal(receipt.evidenceChain?.provider.includedCount, undefined);
  const html = renderToStaticMarkup(createElement(GenerationContextReceipt, { receipt }));
  assert.match(html, /缺少 Provider 来源证据/);
  assert.match(html, /仅快照 1/);
  assert.match(html, /快照存在 · Provider 注入未核验/);
  assert.match(html, /ctx txt_deadbeef/);
  assert.match(html, /注入未核验/);
  assert.doesNotMatch(html, /data-context-status="used"/);
  assert.doesNotMatch(html, /已实际注入/);
});

test('observed tool calls prove reads without claiming that content was used', () => {
  const readEvents = [
    toolEvent({
      eventId: 'event-read-novel',
      sequence: 1,
      toolName: 'novel.read_context',
      result: { contentHash: 'hidden-hash' },
    }),
    toolEvent({
      eventId: 'event-read-outline',
      sequence: 2,
      toolName: 'chapter.read_outline',
    }),
    toolEvent({ eventId: 'event-read-memory', sequence: 3, toolName: 'search_memory' }),
  ];
  const candidate = toolEvent({ sequence: 4, result: { contentHash: 'candidate-hash' } });
  const receipt = resolveToolContextReceipt(candidate, [...readEvents, candidate]);

  assert.ok(receipt);
  assert.equal(receipt.evidence, 'observed');
  assert.ok(receipt.sources.every((source) => source.status === 'read'));
  const html = renderToStaticMarkup(createElement(GenerationContextReceipt, { receipt }));
  assert.match(html, /仅从本轮工具记录确认已读取/);
  assert.match(html, /已读取 3 项/);
  assert.match(html, /已读取 3/);
  assert.match(html, /小说上下文/);
  assert.match(html, /章节大纲/);
  assert.match(html, /长期记忆（Memory）/);
  assert.doesNotMatch(html, /实际注入/);
  assert.doesNotMatch(html, /hidden-hash/);
});

test('an observed Memory search with zero results is missing rather than read', () => {
  const memoryRead = toolEvent({
    eventId: 'event-read-memory-empty',
    sequence: 1,
    toolName: 'search_memory',
    result: { ok: true, data: { items: [] } },
  });
  const candidate = toolEvent({ sequence: 2, result: { contentHash: 'candidate-hash' } });
  const receipt = resolveToolContextReceipt(candidate, [memoryRead, candidate]);

  assert.ok(receipt);
  assert.equal(receipt.evidence, 'observed');
  assert.deepEqual(receipt.sources, [
    {
      type: 'memory_context',
      title: '长期记忆（Memory）',
      status: 'missing',
      group: 'continuity',
      count: 1,
      detail: '召回 0 条',
    },
  ]);
});

test('an observed Memory search reports a known non-zero result count as read', () => {
  const memoryRead = toolEvent({
    eventId: 'event-read-memory-results',
    sequence: 1,
    toolName: 'memory.search@1',
    result: { items: [{ id: 'memory-1' }, { id: 'memory-2' }] },
  });
  const candidate = toolEvent({ sequence: 2, result: { contentHash: 'candidate-hash' } });
  const receipt = resolveToolContextReceipt(candidate, [memoryRead, candidate]);

  assert.ok(receipt);
  assert.equal(receipt.sources[0]?.status, 'read');
  assert.equal(receipt.sources[0]?.detail, '召回 2 条');
});

test('compact context summary shows only core indicators and keeps their evidence tones', () => {
  const receipt = resolveToolContextReceipt(
    toolEvent({
      result: {
        generationContext: {
          providerRequestEvidence: {
            snapshotRequestSourceStatus: 'included',
            providerSourceStatus: 'included',
            generationSourceStatuses: {
              memory_context: 'omitted_budget',
              world_state: 'truncated',
              reference_material: 'truncated',
            },
          },
          sources: [
            { type: 'world_setting', status: 'used' },
            { type: 'rule_system', status: 'used' },
            { type: 'protagonist', status: 'missing' },
            { type: 'master_outline', status: 'used' },
            { type: 'volume_outline', status: 'missing' },
            { type: 'chapter_outline', status: 'used' },
            { type: 'adopted_chapter', status: 'used' },
            { type: 'context_record', status: 'used' },
            { type: 'memory_context', status: 'used' },
            { type: 'world_state', status: 'used' },
            { type: 'style_profile', status: 'used' },
            { type: 'output_profile', status: 'used' },
            { type: 'chapter_character', status: 'used' },
            { type: 'faction', status: 'used' },
            { type: 'location', status: 'missing' },
            { type: 'reference_material', status: 'used' },
          ],
        },
      },
    }),
  );

  assert.ok(receipt);
  const html = renderToStaticMarkup(createElement(GenerationContextSummary, { receipt }));
  assert.match(html, /data-testid="workbench-context-summary"/);
  assert.equal(html.match(/data-context-core=/gu)?.length, 15);
  assert.match(
    html,
    /data-context-core="world"[\s\S]*?data-context-status="used"[\s\S]*?data-provider-inclusion="included"/,
  );
  assert.match(html, /data-context-core="protagonist"[\s\S]*?data-context-status="missing"/);
  assert.match(html, /data-context-core="master_outline"[\s\S]*?data-context-status="used"/);
  assert.match(html, /data-context-core="volume_outline"[\s\S]*?data-context-status="missing"/);
  assert.match(html, /data-context-core="chapter_outline"[\s\S]*?data-context-status="used"/);
  assert.match(html, /data-context-core="adopted_chapter"[\s\S]*?data-context-status="used"/);
  assert.match(html, /data-context-core="context"[\s\S]*?data-context-status="used"/);
  assert.match(
    html,
    /data-context-core="memory"[\s\S]*?data-context-status="omitted"[\s\S]*?data-provider-inclusion="omitted"/,
  );
  assert.match(
    html,
    /data-context-core="world_state"[\s\S]*?data-context-status="truncated"[\s\S]*?data-provider-inclusion="unverified"/,
  );
  assert.match(html, /data-context-core="controls"[\s\S]*?data-context-status="used"/);
  assert.match(html, /data-context-core="chapter_roles"[\s\S]*?data-context-status="used"/);
  assert.match(html, /data-context-core="faction"[\s\S]*?data-context-status="used"/);
  assert.match(html, /data-context-core="location"[\s\S]*?data-context-status="missing"/);
  assert.match(html, /data-context-core="reference"[\s\S]*?data-context-status="truncated"/);
  assert.match(html, />正式世界</);
  assert.match(html, />正式规则</);
  assert.match(html, />正式主角</);
  assert.match(html, />全书大纲</);
  assert.match(html, />分卷大纲</);
  assert.match(html, />章节大纲</);
  assert.match(html, />前章采用稿</);
  assert.match(html, />Context</);
  assert.match(html, />Memory</);
  assert.match(html, />世界状态</);
  assert.match(html, />风格 \/ 输出</);
  assert.match(html, />章内角色</);
  assert.match(html, />势力</);
  assert.match(html, />地点</);
  assert.match(html, />参考资料</);

  const receiptHtml = renderToStaticMarkup(createElement(GenerationContextReceipt, { receipt }));
  assert.match(
    receiptHtml,
    /data-context-source-type="adopted_chapter"[\s\S]*?data-provider-inclusion="included"/,
  );
  assert.match(
    receiptHtml,
    /data-context-source-type="memory_context"[\s\S]*?data-provider-inclusion="omitted"/,
  );
  assert.match(receiptHtml, /已实际注入/);
  assert.match(receiptHtml, /预算未纳入/);
});

test('compact context summary marks unavailable core evidence as unverified', () => {
  const receipt = resolveToolContextReceipt(toolEvent({ result: { ok: true } }));

  assert.ok(receipt);
  const html = renderToStaticMarkup(createElement(GenerationContextSummary, { receipt }));
  assert.equal(html.match(/来源未核验/gu)?.length, 15);
  assert.equal(html.match(/data-context-status="unverified"/gu)?.length, 15);
  assert.doesNotMatch(html, /data-context-status="missing"/);
});

test('missing evidence fails closed instead of inventing formal asset usage', () => {
  const receipt = resolveToolContextReceipt(toolEvent({ result: { ok: true } }));
  assert.ok(receipt);
  assert.equal(receipt.evidence, 'unavailable');
  const html = renderToStaticMarkup(createElement(GenerationContextReceipt, { receipt }));
  assert.match(html, /无法判断正式资产是否用于本次结果/);
  assert.doesNotMatch(html, /已使用/);
});

test('receipt envelopes are removed from expandable tool results', () => {
  const visible = hideContextReceiptInternals({
    ok: true,
    contextReceipt: {
      contextHash: 'full-context-hash-must-stay-hidden',
      sources: [{ type: 'world_setting', status: 'used', sourceId: 'full-source-id' }],
    },
    data: {
      count: 2,
      contextSources: [{ type: 'rule_system', status: 'used', summary: 'secret-summary' }],
    },
  });

  assert.deepEqual(visible, { ok: true, data: { count: 2 } });
});

test('expandable tool details compact identities and hide transcript-shaped fields', () => {
  const fullHash = 'a'.repeat(64);
  const fullReferenceId = 'large-text-reference-id-0123456789';
  const visible = hideContextReceiptInternals({
    status: 'succeeded',
    contentHash: fullHash,
    largeTextRefId: fullReferenceId,
    transcript: 'private transcript body',
    prompt: { messages: [{ role: 'user', content: 'private prompt body' }] },
    originalGoal: '写个六万字左右的悬疑故事。',
    systemInstruction: '根据原始创意自动生成世界与规则设定候选。',
    sourceSummary: '失踪者在旧钟楼留下了尚未公开的时间记录。',
    referenceExcerpt: '这段参考资料正文不应出现在工具详情中。',
    worldBackground: '临雾港依靠回声档案保存市民记忆。',
    apiKey: 'secret-key-value',
  });
  const serialized = JSON.stringify(visible);

  assert.match(serialized, /aaaaaaaa\.\.\.aaaa/);
  assert.match(serialized, /large-te\.\.\.6789/);
  assert.match(serialized, /文本内容已隐藏/);
  assert.match(serialized, /结构化文本已隐藏/);
  assert.match(serialized, /敏感字段已隐藏/);
  assert.doesNotMatch(serialized, new RegExp(fullHash, 'u'));
  assert.doesNotMatch(serialized, new RegExp(fullReferenceId, 'u'));
  assert.doesNotMatch(serialized, /private transcript body/);
  assert.doesNotMatch(serialized, /private prompt body/);
  assert.doesNotMatch(serialized, /六万字左右/);
  assert.doesNotMatch(serialized, /自动生成世界/);
  assert.doesNotMatch(serialized, /失踪者在旧钟楼/);
  assert.doesNotMatch(serialized, /参考资料正文/);
  assert.doesNotMatch(serialized, /临雾港/);
  assert.doesNotMatch(serialized, /secret-key-value/);
});
