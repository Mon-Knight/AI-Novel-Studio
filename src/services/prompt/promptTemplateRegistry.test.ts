import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectModelFamily,
  PromptTemplateRegistry,
  renderTemplateString,
} from './promptTemplateRegistry';

test('detectModelFamily identifies model families correctly', () => {
  assert.equal(detectModelFamily('qwen3.8-27b-writer'), 'qwen');
  assert.equal(detectModelFamily('Qwen-Max'), 'qwen');
  assert.equal(detectModelFamily('deepseek-chat'), 'deepseek');
  assert.equal(detectModelFamily('DeepSeek-R1-Distill'), 'deepseek');
  assert.equal(detectModelFamily('claude-3-5-sonnet'), 'claude');
  assert.equal(detectModelFamily('gpt-4o-mini'), 'openai_compatible');
  assert.equal(detectModelFamily('ai-gateway-writer'), 'openai_compatible');
  assert.equal(detectModelFamily('unknown-model-xyz'), 'generic');
});

test('renderTemplateString handles interpolation and conditional blocks', () => {
  const tpl = `书名：{{title}}{{#subtitle}} - {{subtitle}}{{/subtitle}}{{^subtitle}} (无副标题){{/subtitle}}`;

  const withSub = renderTemplateString(tpl, {
    title: '修真传',
    subtitle: '天命卷',
  });
  assert.equal(withSub, '书名：修真传 - 天命卷');

  const withoutSub = renderTemplateString(tpl, {
    title: '修真传',
    subtitle: '',
  });
  assert.equal(withoutSub, '书名：修真传 (无副标题)');
});

test('PromptTemplateRegistry lists and filters templates', () => {
  const registry = new PromptTemplateRegistry();
  const allTemplates = registry.listTemplates();
  assert.ok(allTemplates.length >= 5);

  const sceneTemplates = registry.listTemplates('scene_generation');
  assert.equal(sceneTemplates.length, 1);
  assert.equal(sceneTemplates[0].templateId, 'scene_generation_v1');
});

test('PromptTemplateRegistry renders scene_generation_v1 with model adaptation', () => {
  const registry = new PromptTemplateRegistry();

  // 1. Qwen 家族适配渲染
  const qwenPayload = registry.renderPrompt(
    'scene_generation_v1',
    {
      novelTitle: '仙道问鼎',
      povName: '林清玄',
      sceneGoal: '避开戒律堂盘查',
      beatList: '1. 走出竹林\n2. 遇到岳凌峰\n3. 从容应对',
      memoryContext: '【世界规则】夜间严禁私斗',
    },
    { modelName: 'qwen3.8-27b-writer' },
  );

  assert.equal(qwenPayload.modelFamily, 'qwen');
  assert.ok(qwenPayload.systemPrompt.includes('Qwen 写作规范'));
  assert.ok(qwenPayload.userPrompt.includes('《仙道问鼎》'));
  assert.ok(qwenPayload.userPrompt.includes('林清玄'));
  assert.ok(qwenPayload.userPrompt.includes('【世界规则】夜间严禁私斗'));
  assert.ok(qwenPayload.hash.length === 64);

  // 2. DeepSeek 家族适配渲染
  const deepseekPayload = registry.renderPrompt(
    'scene_generation_v1',
    {
      novelTitle: '仙道问鼎',
      povName: '林清玄',
      sceneGoal: '避开戒律堂盘查',
      beatList: '1. 走出竹林',
    },
    { modelName: 'deepseek-chat' },
  );

  assert.equal(deepseekPayload.modelFamily, 'deepseek');
  assert.ok(deepseekPayload.systemPrompt.includes('DeepSeek 写作规范'));
});

test('PromptTemplateRegistry validates required variables in strict mode', () => {
  const registry = new PromptTemplateRegistry();

  assert.throws(
    () => {
      registry.renderPrompt('scene_generation_v1', {
        // 缺少必填的 novelTitle, povName, sceneGoal, beatList
      });
    },
    {
      message: /必填变量.*缺失/,
    },
  );
});

test('PromptTemplateRegistry supports custom template registration', () => {
  const registry = new PromptTemplateRegistry();

  registry.registerTemplate({
    templateId: 'custom_prologue_v1',
    name: '序章专属模板',
    category: 'custom',
    version: '1.0.0',
    description: '用于定制序章氛围渲染',
    isOfficial: false,
    variables: [{ name: 'worldSummary', required: true }],
    templateText: '【世界大势】{{worldSummary}}\n请写一段史诗级序幕。',
  });

  const payload = registry.renderPrompt('custom_prologue_v1', {
    worldSummary: '五千年前天地大劫',
  });

  assert.equal(payload.templateId, 'custom_prologue_v1');
  assert.ok(payload.userPrompt.includes('五千年前天地大劫'));
});
