export type WorkbenchTaskTemplateScope = 'project' | 'chapter';

export interface WorkbenchTaskTemplate {
  id: string;
  label: string;
  goal: string;
  scope: WorkbenchTaskTemplateScope;
}

export const WORKBENCH_TASK_TEMPLATES: WorkbenchTaskTemplate[] = [
  { id: 'story-plan', label: '完善全书规划', goal: '生成全书规划候选', scope: 'project' },
  { id: 'protagonist', label: '生成主角候选', goal: '生成主角候选', scope: 'project' },
  {
    id: 'world-setting',
    label: '整理世界与规则设定',
    goal: '生成世界与规则设定候选',
    scope: 'project',
  },
  { id: 'generate-chapter', label: '生成下一章', goal: '生成下一章', scope: 'chapter' },
  {
    id: 'audit-chapter',
    label: '章节审计',
    goal: '审计本章已采用正文的质量、人物与设定一致性',
    scope: 'chapter',
  },
  { id: 'outline', label: '完善大纲', goal: '完善当前章节大纲', scope: 'chapter' },
  {
    id: 'characters',
    label: '人物一致性审计',
    goal: '审计本章已采用正文的人物一致性',
    scope: 'chapter',
  },
  { id: 'events', label: '推演事件', goal: '生成本章剧情事件候选', scope: 'chapter' },
  { id: 'settings', label: '整理设定', goal: '生成本章新增设定候选', scope: 'chapter' },
  { id: 'polish', label: '润色候选', goal: '润色本章候选正文，增强文风表现力', scope: 'chapter' },
];

export function isWorkbenchTaskTemplateEnabled(
  template: WorkbenchTaskTemplate,
  hasChapter: boolean,
): boolean {
  return template.scope === (hasChapter ? 'chapter' : 'project');
}
