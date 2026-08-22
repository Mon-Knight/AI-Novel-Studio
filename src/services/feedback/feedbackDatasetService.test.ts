import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateEditMetrics,
  FeedbackDatasetService,
} from './feedbackDatasetService';

test('calculateEditMetrics computes difference and ratio', () => {
  const same = calculateEditMetrics('测试正文内容', '测试正文内容');
  assert.equal(same.charDifference, 0);
  assert.equal(same.editRatio, 0);

  const diff = calculateEditMetrics(
    '林清玄慢慢走着，神色非常平静。',
    '林清玄按住腰间佩剑，目光冷峻地望向竹林深处。',
  );
  assert.ok(diff.charDifference > 0);
  assert.ok(diff.editRatio > 0.3);
});

test('FeedbackDatasetService captures SFT and DPO pairs and ignores identical text', async () => {
  const service = new FeedbackDatasetService();
  service.reset('novel-001');

  // 1. 无修改时不沉淀
  const noEdit = await service.captureFeedbackSample({
    novelId: 'novel-001',
    chapterId: 'chap-001',
    source: 'editor_manual_edit',
    prompt: '描写林清玄夜探竹林',
    initialAiOutput: '林清玄走入竹林。',
    finalHumanOutput: '林清玄走入竹林。',
  });
  assert.equal(noEdit, null);

  // 2. 有质量修改时自动沉淀
  const captured = await service.captureFeedbackSample({
    novelId: 'novel-001',
    chapterId: 'chap-001',
    source: 'editor_manual_edit',
    systemPrompt: '你是一位严谨的修仙小说作家。',
    prompt: '描写林清玄夜探竹林，避开戒律堂神识',
    initialAiOutput: '林清玄走入竹林，感觉周围很黑，他四处看了一下就离开了。',
    finalHumanOutput:
      '夜风萧萧，林清玄敛息屏气没入竹林阴影。戒律堂的神识扫过树梢，他指尖暗捏法决死死压制住玉简灵气。',
    qualityScore: 92,
    tags: ['xianxia', 'stealth'],
  });

  assert.ok(captured !== null);
  assert.equal(captured.sftSample.type, 'sft_demonstration');
  assert.equal(captured.sftSample.finalHumanOutput.includes('戒律堂的神识'), true);
  assert.equal(captured.dpoSample.type, 'dpo_preference');
  assert.equal(captured.dpoSample.initialAiOutput.includes('感觉周围很黑'), true);
  assert.equal(captured.dpoSample.finalHumanOutput.includes('夜风萧萧'), true);

  const list = service.listSamples('novel-001');
  assert.equal(list.length, 2);

  service.reset('novel-001');
});

test('FeedbackDatasetService exports dataset in JSONL, ShareGPT, and OpenAI formats', async () => {
  const service = new FeedbackDatasetService();
  service.reset('novel-export');

  await service.captureFeedbackSample({
    novelId: 'novel-export',
    chapterId: 'chap-002',
    source: 'chapter_adopt',
    systemPrompt: '作家助手',
    prompt: '续写第二段',
    initialAiOutput: '初稿内容，略显单薄。',
    finalHumanOutput: '终稿内容，经过多智能体修订与人工精修，情节紧凑。',
  });

  // 1. JSONL 导出 (DPO 偏好对)
  const dpoJsonl = service.exportDataset({
    novelId: 'novel-export',
    format: 'jsonl',
    sampleType: 'dpo_preference',
  });
  assert.ok(dpoJsonl.includes('"chosen"'));
  assert.ok(dpoJsonl.includes('"rejected"'));
  const parsedDpo = JSON.parse(dpoJsonl.split('\n')[0]);
  assert.equal(parsedDpo.chosen.includes('终稿内容'), true);
  assert.equal(parsedDpo.rejected.includes('初稿内容'), true);

  // 2. ShareGPT 格式导出
  const shareGptJson = service.exportDataset({
    novelId: 'novel-export',
    format: 'sharegpt',
  });
  const parsedShareGpt = JSON.parse(shareGptJson);
  assert.ok(Array.isArray(parsedShareGpt));
  assert.ok(parsedShareGpt[0].conversations.length >= 2);

  // 3. OpenAI Chat 格式导出
  const openaiJsonl = service.exportDataset({
    novelId: 'novel-export',
    format: 'openai_chat',
  });
  const parsedOpenAi = JSON.parse(openaiJsonl.split('\n')[0]);
  assert.ok(Array.isArray(parsedOpenAi.messages));
  assert.equal(parsedOpenAi.messages[parsedOpenAi.messages.length - 1].role, 'assistant');

  service.reset('novel-export');
});

test('FeedbackDatasetService calculates dataset statistics accurately', async () => {
  const service = new FeedbackDatasetService();
  service.reset('novel-stats');

  await service.captureFeedbackSample({
    novelId: 'novel-stats',
    chapterId: 'chap-003',
    source: 'editor_manual_edit',
    prompt: '场景描述',
    initialAiOutput: '简短初始内容。',
    finalHumanOutput: '更加丰富详实的最终采用正文段落。',
  });

  const stats = service.getStatistics('novel-stats');
  assert.equal(stats.totalSamples, 2);
  assert.equal(stats.sftSamplesCount, 1);
  assert.equal(stats.dpoSamplesCount, 1);
  assert.ok(stats.totalWords > 0);
  assert.ok(stats.avgEditRatio > 0);

  service.reset('novel-stats');
});
