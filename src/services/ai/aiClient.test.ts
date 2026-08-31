import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import type { AiSettings, AiTaskType } from '../../types/ai';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});

const vite = await createServer({
  appType: 'custom',
  define: {
    'import.meta.env.VITE_AI_NOVEL_STUDIO_E2E': JSON.stringify('1'),
  },
  server: { middlewareMode: true, hmr: false },
});
const { createAiClient, MockAiClient } = (await vite.ssrLoadModule(
  '/src/services/ai/aiClient.ts',
)) as typeof import('./aiClient');
const { inspectChapterCandidateIntegrity } = (await vite.ssrLoadModule(
  '/src/services/generation/chapterCandidateIntegrity.ts',
)) as typeof import('../generation/chapterCandidateIntegrity');

after(async () => {
  await vite.close();
});

const governedTaskTypes: AiTaskType[] = [
  'chapter_generate',
  'chapter_beat_repair',
  'chapter_scene_generate',
  'chapter_scene_plan_generate',
  'autonomous_plot_plan',
  'autonomous_character_evolution',
  'autonomous_world_build',
  'autonomous_conflict_generate',
  'autonomous_pacing_control',
  'autonomous_chapter_batch',
];

const settings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  maxTokens: 8000,
  timeoutSeconds: 60,
  mockMode: true,
};

test('direct client calls fail closed for every governed task type', async () => {
  const client = createAiClient(settings);
  for (const taskType of governedTaskTypes) {
    await assert.rejects(
      client.generate({
        taskType,
        messages: [{ role: 'user', content: 'test' }],
      }),
      new RegExp(`Task ${taskType} must run through executeAiTask`),
    );
  }
});

test('deterministic Mock rewrites the compiled provider repair-draft section', async () => {
  const source = '沈砚推开演武场的门，风雨正沿着石阶灌入长廊。';
  const client = new MockAiClient();
  const response = await client.generate({
    taskType: 'chapter_generate',
    messages: [
      { role: 'system', content: '你是一位专业小说作家。' },
      {
        role: 'user',
        content: [
          '## Current chapter repair draft',
          source,
          '',
          '## 本轮用户创作指令',
          '重新修改这一版正文，放慢节奏并强化压迫感。',
          '',
          '## 风格与输出控制',
          '只输出完整正文。',
        ].join('\n'),
      },
    ],
  });

  assert.notEqual(response.text, source);
  assert.ok(response.text.endsWith(source));
});

test('deterministic Mock bounds the localized repair draft at the next section', async () => {
  const source = '沈砚推开演武场的门，风雨正沿着石阶灌入长廊。';
  const client = new MockAiClient();
  const response = await client.generate({
    taskType: 'chapter_generate',
    messages: [
      { role: 'system', content: '你是一位专业小说作家。' },
      {
        role: 'user',
        content: ['## 当前正文修改', source, '', '## 风格与输出控制', '只输出完整正文。'].join(
          '\n',
        ),
      },
    ],
  });

  assert.ok(response.text.endsWith(source));
  assert.doesNotMatch(response.text, /风格与输出控制|只输出完整正文/);
});

test('deterministic Mock distinguishes compiled newline chapter outlines', async () => {
  const client = new MockAiClient();
  const generate = (chapterTitle: string, chapterOutline: string) =>
    client.generate({
      taskType: 'chapter_generate',
      messages: [
        { role: 'system', content: '你是一位专业小说作家。' },
        {
          role: 'user',
          content: [
            '## 主角与角色',
            '主角：沈砚',
            '',
            '---',
            '',
            '## 大纲与剧情锚点',
            '全书大纲：',
            '沈砚进入宗门并逐步发现异象来源。',
            '章节大纲：',
            chapterOutline,
            '本章目标：承接当前冲突并推动局势变化。',
            '',
            '---',
            '',
            '## 章节工程状态',
            `章节目标：完成《${chapterTitle}》的现场推进。`,
          ].join('\n'),
        },
      ],
    });
  const first = await generate(
    '第一章 苍穹惊变',
    '演武场冲突升级，风雨与天象同时异变，主角被迫显露异常。',
  );
  const second = await generate(
    '第二章 试剑石前',
    '众弟子聚集试剑石前，嘲讽与期待交错，主角平静接受测试。',
  );

  assert.match(first.text, /演武场冲突升级/);
  assert.match(second.text, /众弟子聚集试剑石前/);
  assert.notEqual(first.text, second.text);
  assert.ok(
    inspectChapterCandidateIntegrity({
      candidateText: second.text,
      previousChapterText: first.text,
    }).every((issue) => issue.code !== 'chapter_opening_rollback'),
  );

  const revise = (chapterTitle: string, chapterOutline: string, source: string) =>
    client.generate({
      taskType: 'chapter_generate',
      messages: [
        { role: 'system', content: '你是一位专业小说作家。' },
        {
          role: 'user',
          content: [
            `当前章节：${chapterTitle}`,
            '',
            '## 大纲与剧情锚点',
            '章节大纲：',
            chapterOutline,
            '',
            '---',
            '',
            '## Current chapter repair draft',
            source,
            '',
            '## 本轮用户创作指令',
            '重新修改这一版正文，放慢节奏并强化现场压力。',
            '',
            '---',
          ].join('\n'),
        },
      ],
    });
  const firstRevision = await revise(
    '第一章 苍穹惊变',
    '演武场冲突升级，风雨与天象同时异变，主角被迫显露异常。',
    first.text,
  );
  const secondRevision = await revise(
    '第二章 试剑石前',
    '众弟子聚集试剑石前，嘲讽与期待交错，主角平静接受测试。',
    second.text,
  );

  assert.ok(firstRevision.text.endsWith(first.text));
  assert.ok(secondRevision.text.endsWith(second.text));
  assert.ok(
    inspectChapterCandidateIntegrity({
      candidateText: secondRevision.text,
      previousChapterText: firstRevision.text,
    }).every((issue) => issue.code !== 'chapter_opening_rollback'),
  );
});

test('deterministic Mock replaces a rollback opening for an explicit integrity repair', async () => {
  const opening = '沈砚醒来时，窗外仍是一片灰蒙蒙的天空，远处建筑藏在晨雾里。';
  const preservedTail = '最后，试剑石表面的微光停在他掌心前，四周的议论同时沉了下去。';
  const source = [
    opening,
    '潮湿气味沿着门缝钻进来，挂钟仍在安静房间里反复作响。',
    '门外脚步由远而近，他整理衣领，等待那道逆光身影推开房门。',
    '来人低声询问他的决定，他望向走廊尽头，让呼吸渐渐恢复平稳。',
    '他终于迈步向前，周围人的视线也随这个动作聚集到同一处。',
    preservedTail,
  ].join('\n\n');
  const client = new MockAiClient();
  const repair = (chapterTitle: string) =>
    client.generate({
      taskType: 'chapter_generate',
      messages: [
        {
          role: 'system',
          content: '你是一位小说章节完整性修复编辑。',
        },
        {
          role: 'user',
          content: [
            `完整性修复《${chapterTitle}》正文。`,
            'issue_codes：chapter_opening_rollback',
            '',
            '## 跨章连续性硬约束（内部）',
            '来源章节：chapter-previous',
            '',
            '## Current chapter repair draft',
            source,
            '',
            '## 风格与输出控制',
            '只输出完整正文。',
          ].join('\n'),
        },
      ],
    });
  const response = await repair('第二章 试剑石前');
  const nextChapterResponse = await repair('第三章 风云际会');

  assert.doesNotMatch(response.text, new RegExp(opening));
  assert.match(response.text, new RegExp(preservedTail));
  assert.ok(response.text.endsWith('。'));
  assert.notEqual(response.text, nextChapterResponse.text);
  const previousChapterText = `${source}\n\n${'此前的余波仍在远处延伸，却没有改变眼前新出现的压力。'.repeat(12)}`;
  assert.ok(
    inspectChapterCandidateIntegrity({ candidateText: source, previousChapterText }).some(
      (issue) => issue.code === 'chapter_opening_rollback',
    ),
  );
  assert.ok(
    inspectChapterCandidateIntegrity({
      candidateText: response.text,
      previousChapterText,
    }).every((issue) => issue.code !== 'chapter_opening_rollback'),
  );
});
