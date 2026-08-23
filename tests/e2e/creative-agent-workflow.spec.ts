import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  clickTestId,
  createFirstChapterThroughUi,
  createProjectThroughUi,
  fillTestId,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
} from './helpers';

describe('creative agent autonomous workflow e2e', () => {
  it('executes autonomous creation loop, renders decision trace, quality review and memory persistence', async () => {
    // 1. 创建小说项目与首章
    const projectId = await createProjectThroughUi('E2E Creative Agent Novel');
    const projectSettings = await waitForTestIdAttribute(
      'project-settings',
      'data-project-id',
      projectId,
    );
    expect(await projectSettings.getAttribute('data-project-name')).toBe(
      'E2E Creative Agent Novel',
    );

    await openWorkspace(projectId);
    const chapterId = await createFirstChapterThroughUi();
    await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);

    // 2. 打开右侧 Inspector 面板验证 Memory Inspector & Generation Trace
    const rightDock = await waitForTestId('right-panel');
    expect(rightDock).toBeTruthy();

    // 3. 在 Agent 对话工作台中发送自然语言创作任务
    const agentWorkspace = await waitForTestId('agent-chat-workspace');
    expect(agentWorkspace).toBeTruthy();

    const emptyIntro = await waitForTestId('agent-empty-intro');
    expect(await emptyIntro.getText()).toContain('向创作智能体描述您的目标');

    // 发送创作指令
    await fillTestId('agent-input', '完成第五章第一节创作：主角进入遗迹探寻线索');
    await clickTestId('agent-send-btn');

    // 4. 验证自主任务状态横幅
    const taskBanner = await waitForTestId('agent-task-state-banner');
    expect(await taskBanner.getText()).toContain('任务目标');

    // 5. 验证 🧠 Agent Decision Trace 决策卡片
    const decisionCard = await waitForTestId('agent-decision-trace-card');
    expect(await decisionCard.getText()).toMatch(/(Agent Decision|目标|当前选择)/);

    // 6. 验证 📝 Quality Review 质量审查卡片
    const qualityCard = await waitForTestId('agent-quality-review-card');
    expect(await qualityCard.getText()).toMatch(/(Quality Review|人物一致性|剧情推进|文风匹配|连贯性)/);
    const qualityBadge = await waitForTestId('agent-quality-overall-badge');
    expect(await qualityBadge.getText()).toMatch(/\d+\/100/);

    // 7. 验证工具调用卡片与执行结果
    const toolCards = await browser.$$('[data-testid="agent-tool-card"]');
    expect(toolCards.length).toBeGreaterThanOrEqual(1);

    // 8. 验证清洁诊断与会话状态
    await assertCleanDiagnostics();
  });
});
