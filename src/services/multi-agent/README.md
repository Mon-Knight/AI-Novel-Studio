# Multi-Agent Collaboration

v3.0.0 章节协作评审服务，也是自主逐章创作管线的质量门。完整架构见 [`docs/architecture/multi-agent-collaboration.md`](../../../docs/architecture/multi-agent-collaboration.md)。

## 能力

- 六类专家并行评审：`outline / character / setting / logic / polish / quality`
- 真实 API Provider 与确定性 Mock Provider
- quorum + acceptance rate + average score 共识
- `accept / revise / regenerate`
- 最多三轮，修订后下一轮评审新候选正文
- 单专家失败隔离与取消传播
- SQLite session / round / opinion 历史
- 浏览器 LocalStorage 开发回退
- 工作台历史回放与显式候选载入
- 由自主创作 Runtime 调用时，评审结果仍只形成未采用候选

## 目录

```text
src/services/multi-agent/
├── expertRegistry.ts
├── multiAgentOpinionParser.ts
├── multiAgentPersistence.ts
├── multiAgentProvider.ts
├── multiAgentRuntime.ts
├── multiAgentService.ts
└── multiAgentService.test.ts
```

Prompt 位于：

```text
prompts/multi_agent_review_system.md
prompts/multi_agent_outline_review.md
prompts/multi_agent_character_review.md
prompts/multi_agent_setting_review.md
prompts/multi_agent_logic_review.md
prompts/multi_agent_polish_review.md
prompts/multi_agent_quality_review.md
prompts/multi_agent_revision.md
```

## 使用

产品代码使用已装配的运行时单例：

```ts
import { multiAgentService } from './multiAgentRuntime';

const result = await multiAgentService.review({
  novelId,
  chapterId,
  draftId,
  draftVersion,
  draftContent,
  chapterTitle,
  chapterOutline,
  chapterGoal,
  experts: ['outline', 'character', 'setting', 'logic', 'polish', 'quality'],
  maxRounds: 3,
  acceptanceThreshold: 0.7,
  minimumAverageScore: 75,
});

if (result.finalDraft.id !== draftId) {
  // finalDraft 是未采用候选；交给用户确认，不要自动采用。
}
```

历史查询：

```ts
const sessions = await multiAgentService.listSessionsByChapter(chapterId);
const bundle = await multiAgentService.getSession(sessions[0].sessionId);
```

## 共识

默认 quorum 为 `ceil(selectedExperts × 0.67)`：

```text
quorum 满足 && acceptanceRate >= threshold && averageScore >= minimum
  → accept
quorum 满足 && averageScore >= 60
  → revise
其他
  → regenerate
```

前端计算结果不是权威事实。Rust 在追加 Round 前从 Opinion 重新计算并拒绝不一致数据。

## 失败语义

- 非法专家、空列表、零轮次、空正文、超长正文：抛出输入错误。
- 草稿不存在、跨作品、版本变化或全文不可用：失败关闭。
- 单专家失败：保存失败 Opinion；其他专家继续。
- 不足 quorum：不能 accept。
- Provider 返回无效 JSON：该专家失败，不转换为分数。
- 主编返回空正文或未变化正文：session 失败。
- 取消：Provider task 和 session 均进入 cancelled。
- 达到最大轮数仍未通过：session completed，但 `accepted=false`。

## 持久化

桌面端命令：

```text
create_multi_agent_session
append_multi_agent_round
complete_multi_agent_session
get_multi_agent_session
list_multi_agent_sessions_by_chapter
```

迁移：

```text
021_multi_agent_sessions
022_multi_agent_rounds
023_multi_agent_opinions
```

桌面 IPC 失败不会降级写入 LocalStorage。LocalStorage 只服务浏览器开发模式。项目备份 schema 5 同时保存这些协作事实和 `autonomous_story_plans`；schema 4 仍可导入。

## 自主创作集成

`AutonomousChapterWorkflowService` 在生成下一章草稿后调用六专家评审，并保存 `reviewSessionId`、最终候选、接受率和平均分。即使共识通过，候选也不会自动采用；采用成功后由 `AutonomousPostChapterService` 生成待确认章节分析。

全书规划、人物弧、世界、冲突和节奏 Agent 位于 `src/services/autonomous-creation/`，不与本目录的章节审查专家混为同一职责。

## 测试

```powershell
npx tsx --test --test-concurrency=1 src/services/multi-agent/multiAgentService.test.ts
npx tsx --test --test-concurrency=1 src/components/right-dock/panels/MultiAgentPanel.test.tsx
cd src-tauri
cargo test multi_agent
```

核心服务通过依赖注入测试 Provider、持久化、草稿和时钟；测试不使用 `Math.random()`，也不调用真实 API。
