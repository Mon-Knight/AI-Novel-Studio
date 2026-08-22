# Novel Memory Layer 架构规范（Phase 1）

> **状态**：领域模型与契约已定义（Phase 1）  
> **适用版本**：v3.5.0+  
> **核心定位**：面向百万字长篇小说的三层结构化记忆体系，负责长篇创作过程中的世界状态追踪、角色心境演变与场景工作记忆供给。

---

## 1. 架构动机与三层记忆体系

在百万字长篇小说创作中，模型无法且不应当直接消费海量全文本。Novel Memory Layer 将小说的上下文沉淀为结构化、分层的动态切片：

```mermaid
flowchart TD
    subgraph MemoryHierarchy [三层记忆架构]
        direction TB
        
        subgraph LongTerm [长期记忆 (Long-Term)]
            WorldRules[世界规则 / 力量体系 / 地理设定]
            CoreChars[核心角色底层档案 / 性格特质 / 身世]
            CoreMysteries[未解主线之谜 / 核心伏笔库]
        end

        subgraph MidTerm [中期记忆 (Mid-Term)]
            VolumeGoal[当前卷主线冲突 / 阶段剧情进度]
            CharState[角色动态状态 (伤势/心境/即时目标/人际)]
            FactionState[阵营关系态势 / 正在发生的大事件]
        end

        subgraph ShortTerm [短期工作记忆 (Short-Term / Working)]
            ScenePOV[当前分镜 POV 视点动机]
            ActiveChars[现场活跃角色及即时交互]
            PrevSceneSummary[上一 Scene 结尾动作残余与对白线索]
            SceneConstraints[本场景写作硬约束与禁忌]
        end
    end

    subgraph MemoryManager [Novel Memory Manager]
        Retrieval[智能分层检索与实体对齐]
        Budget[Token Budget 动态分配]
    end

    LongTerm --> Retrieval
    MidTerm --> Retrieval
    ShortTerm --> Retrieval
    Retrieval --> Budget
    Budget --> SceneMemoryContext[SceneMemoryContext]
    SceneMemoryContext --> ExecutionCompiler[ExecutionContractCompiler]
    ExecutionCompiler --> SceneWriter[Qwen3.8-27B / AI Gateway]
```

---

## 2. 领域数据模型契约

### 2.1 `MemoryFragment`（记忆片段）
记忆片段是三层记忆体系的基本原子单元：
- `tier`: `'long_term' | 'mid_term' | 'short_term'`
- `type`: `'world_rule' | 'character_profile' | 'character_state' | 'plot_arc' | 'foreshadow' | 'scene_working'`
- `importance`: 重要度评级（1 ~ 5），作为 Token 预算紧张时的修剪依据；
- `relatedEntities`: 关联的实体 ID（如角色 ID、地点 ID、派系 ID），用于精准关联检索。

### 2.2 `CharacterDynamicState`（角色动态状态）
中期记忆核心，记录角色随剧情推进发生的状态演进：
- `currentEmotion`: 即时情绪与心境；
- `currentGoal`: 当前即时动机；
- `currentRelationship`: 对其他出场角色的即时好感与态度；
- `injuries` / `status`: 负面状态与即时伤势；
- `faction`: 当前阵营身份；
- `lastKnownLocation`: 最后所在地点；
- `stateVersion`: 演进版本号。

### 2.3 `WorldStateSnapshot`（世界状态快照）
- `timelinePosition`: 剧情纪年与时间线节点；
- `worldRules`: 当前场景/区域生效的世界规则；
- `activeEvents`: 正在发生的全局或区域事件；
- `factionStatus`: 各大势力的动态博弈态势；
- `unresolvedMysteries`: 尚未回收的核心伏笔。

### 2.4 `SceneMemoryContext`（场景组装产物）
最终由 `NovelMemoryManager.retrieveContext` 输出给 `executionContractCompiler`，由其编码进 Prompt Envelope。

---

## 3. Token 预算分配规划（Token Budget Allocation）

针对不同模型上下文窗口（4K / 8K / 32K），Memory Layer 采用比例与上限双重配额：

| 记忆层级 | 典型比例 | 4K Context 模型（如本地 Qwen） | 32K Context 模型（如 Gateway） |
| :--- | :--- | :--- | :--- |
| **长期记忆 (Long-Term)** | 30% | ~450 Tokens (核心规则 + 人物底色) | ~3,000 Tokens (完整世界体系 + 人物档案) |
| **中期记忆 (Mid-Term)** | 40% | ~600 Tokens (本卷进展 + 角色动态状态) | ~4,000 Tokens (多角色状态 + 伏笔网) |
| **短期工作记忆 (Short-Term)** | 30% | ~450 Tokens (前序摘要 + 场景硬约束) | ~2,000 Tokens (多轮场景延续 + 对白残余) |
| **正文生成与 Prompt 开销** | - | 留足 1024 Tokens 输出与安全裕量 | 留足 4000+ Tokens 输出 |

---

## 4. 与 Writer（Qwen3.8-27B）及下游系统的关系

1. **不破坏现有契约**：Memory Layer 输出的 `SceneMemoryContext` 通过 `executionContractCompiler` 的上下文包络注入，不更改 `scene-beat-prose-v1` 的输入/输出 Schema。
2. **Phase 1 范围界定**：本阶段建立统一类型定义、管理器服务接口与架构文档；后续阶段逐步引入实体关联过滤、自动状态提取与状态变更提交。
