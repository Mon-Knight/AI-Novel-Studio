import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { countTextWords } from '../../utils/contentHash';
import { aiWorkflowService, type BackgroundWorkflowStep, type WorkflowCreated } from '../ai-tasks/aiWorkflowService';
import { prepareQualityCheck } from './qualityCheckAiService';

export interface QualityRevisionWorkflowInput {
  novelId: string;
  chapter: Chapter;
  currentDraft: ChapterDraft;
}

export function buildQualityRevisionWorkflowSteps(
  qualityCheckMessages: BackgroundWorkflowStep['messages'],
  chapterTitle: string,
  draftContent: string,
  chapterOutline?: string,
): BackgroundWorkflowStep[] {
  return [
    {
      stepKey: 'freeze_chapter',
      taskType: 'workflow_freeze_chapter',
      agentRole: '快照冻结',
      artifactType: 'generic_json',
      messages: [],
    },
    {
      stepKey: 'quality_check',
      taskType: 'quality_check',
      agentRole: '质量检查',
      artifactType: 'quality_report',
      dependencies: ['freeze_chapter'],
      messages: qualityCheckMessages,
    },
    {
      stepKey: 'quality_fix',
      taskType: 'quality_fix',
      agentRole: '修复候选',
      artifactType: 'chapter_text',
      dependencies: ['quality_check'],
      messages: [{
        role: 'system',
        content: [
          '你是小说章节精准修订专家。请读取请求中的冻结章节正文和上游质量检查 Artifact。',
          '仅修复质量检查明确指出的问题，其他段落和设定尽量保持不变；不得声称结果已被采用。',
          `章节：${chapterTitle}`,
          chapterOutline ? `章节大纲：${chapterOutline}` : '',
          '严格输出 JSON：',
          '{"mode":"targeted_fix","fixed_issue_keys":[],"revision_summary":"","changed_ranges":[],"revised_content":"完整修订后正文","automaticApply":false}',
        ].filter(Boolean).join('\n'),
      }, {
        role: 'user',
        content: [
          '根据上游质量报告，对以下冻结章节做最小必要修订，并返回完整正文候选。',
          '【冻结章节正文】',
          draftContent,
        ].join('\n'),
      }],
    },
    {
      stepKey: 'quality_recheck',
      taskType: 'quality_recheck',
      agentRole: '修复复检',
      artifactType: 'quality_report',
      dependencies: ['quality_fix'],
      messages: [{
        role: 'system',
        content: [
          '你是小说章节质量检查员。只检查请求中附带的上游修复后正文 Artifact。',
          '不得修改正文，不得声称已采用结果。',
          '严格输出 JSON：{"overallScore":0,"summary":"","items":[]}。',
        ].join('\n'),
      }, { role: 'user', content: '请复检上游修复后的完整章节正文。' }],
    },
    {
      stepKey: 'review_bundle',
      taskType: 'workflow_quality_review_bundle',
      agentRole: '审查汇总',
      artifactType: 'generic_json',
      dependencies: ['quality_check', 'quality_fix', 'quality_recheck'],
      messages: [],
      reviewOutput: true,
    },
  ];
}

export const qualityRevisionWorkflowService = {
  async submit(input: QualityRevisionWorkflowInput): Promise<WorkflowCreated> {
    const { novelId, chapter, currentDraft } = input;
    const baseContentHash = currentDraft.contentState?.status === 'ready'
      ? currentDraft.contentState.contentHash
      : await computeContentSha256(currentDraft.content);
    const { request } = await prepareQualityCheck({
      novelId,
      chapterId: chapter.id,
      draftId: currentDraft.id,
      volumeId: chapter.volumeId,
      draftContent: currentDraft.content,
      chapterTitle: chapter.title,
      chapterOutline: chapter.outline,
      chapterGoal: chapter.goal,
      contentHash: baseContentHash,
      draftVersion: currentDraft.versionNo,
      wordCount: currentDraft.wordCount || countTextWords(currentDraft.content),
    });
    return aiWorkflowService.createBackground({
      workflowName: `${chapter.title} · 章节质量审查与修订候选`,
      taskType: 'quality_revision',
      novelId,
      chapterId: chapter.id,
      draftId: currentDraft.id,
      scopeType: 'draft',
      targetHintJson: {
        chapterId: chapter.id,
        draftId: currentDraft.id,
        staleAgainstLatest: true,
        automaticApply: false,
      },
      inputPayloadJson: {
        workflowKind: 'chapter_quality_revision',
        workflowVersion: 1,
        waitingForUserConfirmation: true,
      },
      inputBody: currentDraft.content,
      sourceManifestJson: [{
        type: 'chapter_draft',
        id: currentDraft.id,
        version: currentDraft.versionNo,
        hash: baseContentHash,
      }],
      sourceDraftVersion: currentDraft.versionNo,
      baseContentHash,
      steps: buildQualityRevisionWorkflowSteps(request.messages, chapter.title, currentDraft.content, chapter.outline),
    });
  },
};
