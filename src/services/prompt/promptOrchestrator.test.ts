import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import type { ChapterGenerationContext } from '../../types/ai';

const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null },
});

after(async () => {
  await vite.close();
});

const promptOrchestratorModule = (await vite.ssrLoadModule(
  '/src/services/prompt/promptOrchestrator.ts',
)) as typeof import('./promptOrchestrator');

const { buildGenerateRequest } = promptOrchestratorModule;

test('buildGenerateRequest builds a complete system prompt and user prompt', async () => {
  const context: ChapterGenerationContext = {
    novelTitle: '修仙模拟器',
    novelGenre: '玄幻修真',
    novelDescription: '一个穿越者的修仙故事',
    chapterTitle: '第一章 宗门测试',
    targetWordCount: 3000,
    chapterGoal: '通过入门考核',
    chapterOutline: '1. 主角来到广场 2. 测灵根 3. 产生异象引起长老关注',
    outlineChecklistText: '1. 必须完成：来到广场\n2. 必须完成：测灵根\n3. 必须推进：引起关注',
    masterOutline: '总纲：从小修士到宗门老祖',
    volumeOutline: '第一卷 拜入山门',
    worldBackground: '九洲界修仙体系',
    requiredCharactersSummary: '主角林舟（必须出场）',
    requiredCharacterNames: '林舟',
  };

  const request = await buildGenerateRequest(context);

  assert.equal(request.taskType, 'chapter_generate');
  assert.equal(request.messages.length, 2);

  const systemMsg = request.messages.find((m) => m.role === 'system');
  const userMsg = request.messages.find((m) => m.role === 'user');

  assert.ok(systemMsg);
  assert.ok(userMsg);

  // System prompt validations
  assert.ok(systemMsg.content.includes('修仙模拟器'));
  assert.ok(systemMsg.content.includes('玄幻修真'));
  assert.ok(systemMsg.content.includes('第一章 宗门测试'));
  assert.ok(systemMsg.content.includes('通过入门考核'));
  assert.ok(systemMsg.content.includes('测灵根'));
  assert.ok(systemMsg.content.includes('第一卷 拜入山门'));
  assert.ok(systemMsg.content.includes('九洲界修仙体系'));

  // User prompt validations
  assert.ok(userMsg.content.includes('《第一章 宗门测试》'));
  assert.ok(userMsg.content.includes('【当前章节大纲】'));
  assert.ok(userMsg.content.includes('【章节大纲执行清单】'));
  assert.ok(userMsg.content.includes('请直接输出小说正文'));

  // Debug info validations
  assert.ok(request.promptDebug);
  assert.equal(request.promptDebug.hasChapterOutlineBlock, true);
  assert.equal(request.promptDebug.hasOutlineChecklistBlock, true);
  assert.equal(request.promptDebug.hasVolumeOutlineBlock, true);
  assert.equal(request.promptDebug.hasMasterOutlineBlock, true);
  assert.equal(request.promptDebug.hasChapterGoalBlock, true);
});

test('buildGenerateRequest handles fallback when chapterGoal or chapterOutline is omitted', async () => {
  const context: ChapterGenerationContext = {
    novelTitle: '悬疑短篇',
    chapterTitle: '第二章 夜探废宅',
    targetWordCount: 2000,
  };

  const request = await buildGenerateRequest(context);
  const systemMsg = request.messages.find((m) => m.role === 'system');
  assert.ok(systemMsg);

  // Inverse conditions: {{^chapterGoal}} and {{^chapterOutline}}
  assert.ok(systemMsg.content.includes('未单独设置本章目标'));
  assert.ok(systemMsg.content.includes('当前章节大纲为空'));
});

test('buildGenerateRequest handles draft rewrite context', async () => {
  const context: ChapterGenerationContext = {
    novelTitle: '科幻未来',
    chapterTitle: '第三章 空间跃迁',
    targetWordCount: 2500,
    draftContent: '这里是初版草稿正文内容，需要进一步精炼优化。',
  };

  const request = await buildGenerateRequest(context);
  const systemMsg = request.messages.find((m) => m.role === 'system');
  assert.ok(systemMsg);

  assert.ok(systemMsg.content.includes('【当前草稿正文（请基于此改写）】'));
  assert.ok(systemMsg.content.includes('这里是初版草稿正文内容'));
});
