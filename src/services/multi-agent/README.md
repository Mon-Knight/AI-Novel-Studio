# Multi-Agent Collaboration System

多智能体协作系统，用于章节内容的多维度评审和迭代改进。

## 概述

Multi-Agent 系统通过协调多个专家 Agent 对章节进行并行评审，形成共识决策，实现高质量的内容生成。

## 核心流程

```
1. 并行调用多个专家 Agent 评审当前草稿
   ↓
2. 计算共识（acceptance rate, average score）
   ↓
3. 根据共识决策：accept / revise / regenerate
   ↓
4. 如果需要改进，应用改进并进入下一轮
   ↓
5. 最多执行 maxRounds 轮，返回最终草稿
```

## 专家类型

系统支持 6 类专家，每个专家专注于特定维度：

| 专家类型 | 专注领域 | 评分标准 |
|---------|---------|---------|
| `outline` | 大纲专家 | 情节结构、起承转合、伏笔铺垫 |
| `character` | 角色专家 | 人物动机、性格一致性、对话合理性 |
| `setting` | 设定专家 | 世界观规则、场景细节、设定一致性 |
| `logic` | 逻辑专家 | 因果关系、时间线、情节逻辑 |
| `polish` | 润色专家 | 语言表达、节奏、文风 |
| `quality` | 质量专家 | 整体可读性、完成度 |

## 使用示例

```typescript
import { multiAgentService } from './services/multi-agent/multiAgentService';

// 执行多专家评审
const result = await multiAgentService.review({
  novelId: 'novel-123',
  chapterId: 'chapter-456',
  draftId: 'draft-789',
  experts: ['outline', 'character', 'logic', 'quality'],
  maxRounds: 3,                    // 最多 3 轮
  acceptanceThreshold: 0.7,        // 70% 专家同意即接受
});

if (result.success) {
  console.log('最终草稿:', result.finalDraftId);
  console.log('评审轮数:', result.rounds.length);
  console.log('Token 消耗:', result.totalTokensUsed);
  
  // 查看每轮结果
  result.rounds.forEach(round => {
    console.log(`第 ${round.roundNumber} 轮:`);
    console.log('  平均评分:', round.consensus.averageScore);
    console.log('  接受率:', round.consensus.acceptanceRate);
    console.log('  决策:', round.consensus.action);
  });
}
```

## 共识机制

系统通过以下规则计算共识并决策：

### 评分标准
- **0-100 分制**：每个专家给出评分
- **平均分**：所有专家评分的平均值
- **接受率**：评分 ≥ 70 的专家比例

### 决策规则
1. **Accept（接受）**
   - 接受率 ≥ 阈值（默认 0.7）
   - 且 平均分 ≥ 75

2. **Revise（修订）**
   - 平均分 ≥ 60
   - 但未达到接受标准

3. **Regenerate（重新生成）**
   - 平均分 < 60
   - 需要重新生成草稿

## API 参考

### `multiAgentService.review(params)`

执行多智能体评审。

**参数：**
```typescript
interface MultiAgentReviewParams {
  novelId: string;              // 小说 ID
  chapterId: string;            // 章节 ID
  draftId: string;              // 草稿 ID
  experts: ExpertType[];        // 参与的专家类型
  maxRounds?: number;           // 最大轮数（默认 3）
  acceptanceThreshold?: number; // 接受阈值（默认 0.7）
  operationId?: string;         // 操作 ID（可选）
}
```

**返回值：**
```typescript
interface MultiAgentReviewResult {
  success: boolean;             // 是否成功
  finalDraftId: string;         // 最终草稿 ID
  rounds: CollaborationRound[]; // 每轮评审结果
  totalTokensUsed: number;      // 总 Token 消耗
  durationMs: number;           // 总耗时（毫秒）
  errorMessage?: string;        // 错误信息（如果失败）
}
```

## 性能指标

### Token 消耗
- **单个专家：** ~500 tokens（模拟值）
- **4 个专家 × 2 轮：** ~4,000 tokens
- **6 个专家 × 3 轮：** ~9,000 tokens

### 执行时间
- **并行执行：** 所有专家同时调用
- **单轮：** ~2-5 秒（取决于网络和 AI 响应）
- **多轮：** 轮数 × 单轮时间

## 当前实现状态

### ✅ 已实现（v2.6.1）
- 多专家并行评审框架
- 共识计算机制
- 多轮迭代逻辑
- 完整的类型定义
- 单元测试（5/5 通过）

### 🚧 占位实现（待 v3.0）
- **真实 AI Provider 调用**（当前返回模拟评分）
- **改进建议应用**（revise/regenerate）
- **协作日志持久化**（需要数据库表）

### 🔜 未来增强（v3.0+）
- 自定义专家 Prompt
- 专家权重配置
- 增量改进（只修改有问题的段落）
- 历史评审分析
- 专家意见可视化

## 测试

运行测试：
```bash
npx tsx --test src/services/multi-agent/multiAgentService.test.ts
```

测试覆盖：
- ✅ 多专家并行评审
- ✅ 共识计算
- ✅ 多轮迭代
- ✅ 最大轮数限制
- ✅ 接受阈值判断

## 技术架构

### 设计原则
1. **并行优先**：所有专家同时调用，减少等待时间
2. **容错机制**：单个专家失败不影响整体评审
3. **可扩展性**：易于添加新的专家类型
4. **类型安全**：完整的 TypeScript 类型定义

### 代码结构
```
src/
├── types/
│   └── multiAgent.ts                    # 类型定义
└── services/
    └── multi-agent/
        ├── multiAgentService.ts         # 核心服务
        ├── multiAgentService.test.ts    # 单元测试
        └── README.md                    # 本文档
```

## 与其他系统集成

### 与 Agent Planner 集成
Multi-Agent 可以作为 Chapter Readiness Planner 的一个步骤：

```typescript
// 在 Planner 中添加 multi-agent 评审步骤
{
  stepId: 'multi_agent_review',
  name: '多专家评审',
  dependencies: ['generate_draft'],
  tool: 'multi_agent.review',
}
```

### 与 Autonomous Generation 集成
作为自主生成流程的质量保障环节：

```typescript
// 生成 → Multi-Agent 评审 → 决策
const draft = await generateDraft();
const review = await multiAgentService.review({
  draftId: draft.id,
  experts: ['outline', 'character', 'quality'],
});

if (review.rounds[0].consensus.action === 'accept') {
  await adoptDraft(draft.id);
}
```

## 配置建议

### 场景 1：快速验证
```typescript
{
  experts: ['quality'],
  maxRounds: 1,
  acceptanceThreshold: 0.5,
}
```

### 场景 2：标准评审
```typescript
{
  experts: ['outline', 'character', 'logic', 'quality'],
  maxRounds: 2,
  acceptanceThreshold: 0.7,
}
```

### 场景 3：严格审查
```typescript
{
  experts: ['outline', 'character', 'setting', 'logic', 'polish', 'quality'],
  maxRounds: 3,
  acceptanceThreshold: 0.8,
}
```

## 常见问题

### Q: 如何选择专家组合？
A: 根据章节特点选择：
- 对话多 → 加入 `character`
- 世界观复杂 → 加入 `setting`
- 情节转折 → 加入 `outline` 和 `logic`
- 最终发布 → 全部专家

### Q: 如何控制成本？
A: 
- 减少专家数量（3-4 个核心专家）
- 降低最大轮数（1-2 轮）
- 提高接受阈值（快速通过）

### Q: 评审失败怎么办？
A: 系统会返回 `success: false` 和错误信息，但会尽量完成已有轮次的评审。

## 更新日志

### v2.6.1 (2026-07-27)
- ✅ 初始实现
- ✅ 6 类专家支持
- ✅ 并行评审框架
- ✅ 共识机制
- ✅ 单元测试

### v3.0 (计划中)
- 真实 AI Provider 集成
- 改进建议应用
- 数据库持久化

---

**文档版本：** 1.0  
**最后更新：** 2026-07-27  
**维护者：** AI Novel Studio Team
