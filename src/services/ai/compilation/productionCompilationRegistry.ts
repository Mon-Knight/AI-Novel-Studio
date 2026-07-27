import connectionTestTemplate from '../../../../prompts/system_connection_test.md?raw';
import settingExpandTemplate from '../../../../prompts/setting_expand.md?raw';
import autonomousOutlineTemplate from '../../../../prompts/autonomous_outline_generate.md?raw';
import autonomousChapterTemplate from '../../../../prompts/autonomous_chapter_generate.md?raw';
import autonomousRevisionTemplate from '../../../../prompts/autonomous_chapter_revision.md?raw';
import autonomousSummaryTemplate from '../../../../prompts/autonomous_chapter_summary.md?raw';
import autonomousQualityTemplate from '../../../../prompts/autonomous_quality_check.md?raw';
import autonomousContinuityTemplate from '../../../../prompts/autonomous_continuity_check.md?raw';
import autonomousExpertTemplate from '../../../../prompts/autonomous_expert_review.md?raw';
import type { AiSettings } from '../../../types/ai';
import type {
  AiCompilationScope,
  AiExecutionCompilationInput,
  CompiledAiExecutionContractV1,
} from '../../../types/aiCompilation';
import type { AiTaskType } from '../../../types/ai-task';
import { productionToolRegistry } from '../../agent-tools/productionToolRegistry';
import { AiCompilationError } from './errors';
import {
  compileAiExecutionContract,
  type AiTaskCompilationDefinition,
} from './executionContractCompiler';

const definitions: Partial<Record<AiTaskType, AiTaskCompilationDefinition>> = {
  connection_test: {
    taskType: 'connection_test',
    expectedArtifactType: 'generic_text',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'system/connection_test',
    promptTemplateVersion: '2',
    promptTemplateBody: connectionTestTemplate,
    userPrompt: '请只回复 OK。',
    responseSchema: 'exact_text_ok_v1',
    constraints: {
      exactText: 'OK',
      allowMarkdown: false,
      allowAdditionalText: false,
    },
    allowedSourceTypes: [],
    requiredSourceTypes: [],
    allowedTools: [],
    modelContextTokens: 512,
    maxOutputTokens: 8,
    defaultTemperature: 0,
  },
  setting_expand: {
    taskType: 'setting_expand',
    expectedArtifactType: 'setting_candidates',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'setting/expand',
    promptTemplateVersion: '2',
    promptTemplateBody: settingExpandTemplate,
    userPrompt: '请为当前章节补充相关设定候选。',
    responseSchema: 'setting_candidates_v1',
    constraints: {
      candidateOnly: true,
      minimumCandidates: 3,
      maximumCandidates: 8,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
    },
    allowedSourceTypes: [
      'novel',
      'chapter',
      'world_setting',
      'rule_system',
      'request_context',
    ],
    requiredSourceTypes: ['novel'],
    allowedTools: [],
    modelContextTokens: 16_000,
    maxOutputTokens: 5_000,
    defaultTemperature: 0.7,
  },
  outline_generate: {
    taskType: 'outline_generate',
    expectedArtifactType: 'outline',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'autonomous/outline-generate',
    promptTemplateVersion: '1',
    promptTemplateBody: autonomousOutlineTemplate,
    userPrompt: '请生成结构化大纲。',
    responseSchema: 'autonomous_outline_v1',
    constraints: { candidateOnly: true, requireUserConfirmation: true },
    allowedSourceTypes: ['novel', 'outline', 'request_context'],
    requiredSourceTypes: ['novel', 'request_context'],
    allowedTools: [],
    modelContextTokens: 32_000,
    maxOutputTokens: 16_000,
    defaultTemperature: 0.7,
  },
  chapter_generate: {
    taskType: 'chapter_generate',
    expectedArtifactType: 'chapter_text',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'autonomous/chapter-generate',
    promptTemplateVersion: '1',
    promptTemplateBody: autonomousChapterTemplate,
    userPrompt: '请生成完整章节正文。',
    responseSchema: 'chapter_text_v1',
    constraints: { plainTextOnly: true, mayAdoptAutomaticallyAfterGates: true },
    allowedSourceTypes: [
      'novel', 'chapter', 'world_setting', 'rule_system', 'protagonist',
      'character', 'chapter_event', 'outline', 'context_record', 'style_profile',
      'output_profile', 'request_context',
    ],
    requiredSourceTypes: ['novel', 'chapter', 'request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: 16_000,
    defaultTemperature: 0.75,
  },
  chapter_polish: {
    taskType: 'chapter_polish',
    expectedArtifactType: 'chapter_text',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'autonomous/chapter-polish',
    promptTemplateVersion: '1',
    promptTemplateBody: autonomousRevisionTemplate,
    userPrompt: '请润色目标草稿。',
    responseSchema: 'chapter_text_v1',
    constraints: { plainTextOnly: true, preserveFacts: true },
    allowedSourceTypes: ['novel', 'chapter', 'draft', 'request_context'],
    requiredSourceTypes: ['draft', 'request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: 16_000,
    defaultTemperature: 0.45,
  },
  chapter_rewrite: {
    taskType: 'chapter_rewrite',
    expectedArtifactType: 'chapter_text',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'autonomous/chapter-rewrite',
    promptTemplateVersion: '1',
    promptTemplateBody: autonomousRevisionTemplate,
    userPrompt: '请依据约束重写目标草稿。',
    responseSchema: 'chapter_text_v1',
    constraints: { plainTextOnly: true, preserveScope: true },
    allowedSourceTypes: ['novel', 'chapter', 'draft', 'request_context'],
    requiredSourceTypes: ['draft', 'request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: 16_000,
    defaultTemperature: 0.7,
  },
  chapter_summary: {
    taskType: 'chapter_summary',
    expectedArtifactType: 'chapter_summary',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'autonomous/chapter-summary',
    promptTemplateVersion: '1',
    promptTemplateBody: autonomousSummaryTemplate,
    userPrompt: '请生成结构化章节总结。',
    responseSchema: 'chapter_summary_v1',
    constraints: { structuredJsonOnly: true, sourceDraftBound: true },
    allowedSourceTypes: ['novel', 'chapter', 'draft', 'request_context'],
    requiredSourceTypes: ['draft', 'request_context'],
    allowedTools: [],
    modelContextTokens: 48_000,
    maxOutputTokens: 4_000,
    defaultTemperature: 0.2,
  },
  quality_check: {
    taskType: 'quality_check',
    expectedArtifactType: 'quality_report',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'autonomous/quality-check',
    promptTemplateVersion: '1',
    promptTemplateBody: autonomousQualityTemplate,
    userPrompt: '请检查目标草稿质量。',
    responseSchema: 'quality_report_v1',
    constraints: { structuredJsonOnly: true, sourceDraftBound: true },
    allowedSourceTypes: ['novel', 'chapter', 'draft', 'context_record', 'request_context'],
    requiredSourceTypes: ['draft', 'request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: 6_000,
    defaultTemperature: 0.1,
  },
  continuity_check: {
    taskType: 'continuity_check',
    expectedArtifactType: 'quality_report',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'autonomous/continuity-check',
    promptTemplateVersion: '1',
    promptTemplateBody: autonomousContinuityTemplate,
    userPrompt: '请执行连续性检查。',
    responseSchema: 'continuity_report_v1',
    constraints: { structuredJsonOnly: true, sourceDraftBound: true },
    allowedSourceTypes: ['novel', 'chapter', 'draft', 'context_record', 'request_context'],
    requiredSourceTypes: ['draft', 'request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: 5_000,
    defaultTemperature: 0.1,
  },
  expert_review: {
    taskType: 'expert_review',
    expectedArtifactType: 'quality_report',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'autonomous/expert-review',
    promptTemplateVersion: '1',
    promptTemplateBody: autonomousExpertTemplate,
    userPrompt: '请按指定专家职责评审目标草稿。',
    responseSchema: 'expert_review_v1',
    constraints: { structuredJsonOnly: true, sourceDraftBound: true },
    allowedSourceTypes: ['novel', 'chapter', 'draft', 'context_record', 'request_context'],
    requiredSourceTypes: ['draft', 'request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: 4_000,
    defaultTemperature: 0.2,
  },
};

export interface CompileProductionAiExecutionInput {
  taskType: AiTaskType;
  scope: AiCompilationScope;
  compilation: AiExecutionCompilationInput;
  settings: AiSettings;
  providerId: string;
  modelId: string;
}

export async function compileProductionAiExecution(
  input: CompileProductionAiExecutionInput,
): Promise<CompiledAiExecutionContractV1> {
  const definition = definitions[input.taskType];
  if (!definition) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      `任务 ${input.taskType} 尚未注册正式编译策略。`,
    );
  }
  return compileAiExecutionContract({
    ...input,
    definition,
    toolRegistry: await productionToolRegistry.getManifest(),
  });
}

export const productionCompilationRegistryPrivate = { definitions };
