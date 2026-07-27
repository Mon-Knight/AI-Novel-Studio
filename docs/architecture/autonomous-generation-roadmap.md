# 无人干预生成百万字小说 — 架构升级路线图

> 文件：`docs/architecture/autonomous-generation-roadmap.md`  
> 版本：v1.0.0  
> 创建日期：2026-07-27  
> 目标：从"人机协作工具"升级为"监督式自主创作平台"

---

## 1. 总体目标

**用户交互模型：**
```
用户输入一句话创意
  ↓
AI 自动生成完整大纲（分卷、章节、角色、世界观）
  ↓
用户审查、修改、确认大纲
  ↓
[自动化边界] ← 用户确认后不再干预
  ↓
AI 自主逐章生成正文
  ├─ 自动质量检查
  ├─ 自动修正（失败时重试）
  ├─ 自动采纳（通过质量门槛）
  └─ 自动继续下一章
  ↓
用户仅在异常时收到通知
  ↓
百万字小说完成
```

**核心原则：**
1. **大纲可控**：AI 生成大纲，用户有最后审查权
2. **生成自动**：确认大纲后，正文生成到采纳完全自动化
3. **质量守护**：自动质量检查 + 自动修正闭环
4. **异常通知**：连续失败时暂停，通知用户决策

---

## 2. 架构升级分阶段规划

### Phase 0：基础设施准备（v2.7.0）
**工期：2-3 周**

建立自动化所需的核心基础设施：

#### 2.1 自动化任务调度器
- **任务队列系统**：`autonomous_job_queue`
  - 优先级队列（大纲生成 > 章节生成 > 质量检查）
  - 任务状态机：pending → running → completed/failed/retry
  - 支持暂停/恢复/取消
  - 跨重启持久化

- **全局进度追踪**：`novel_generation_progress`
  - 记录总章节数、已完成章节数、当前章节
  - 预计完成时间、Token 消耗统计
  - 异常次数、重试次数

#### 2.2 质量自动评分系统
- **质量门槛配置**：`quality_thresholds`
  - 6 个维度各自的最低分数要求
  - 总分最低要求
  - 单维度严重问题阈值（如逻辑矛盾 > 3 个自动拒绝）

- **自动采纳决策引擎**：
  - 质量分数 >= 阈值 → 自动采纳
  - 分数 < 阈值 → 自动触发修正
  - 修正失败 N 次 → 暂停并通知用户

#### 2.3 自动重试策略配置
```typescript
interface RetryStrategy {
  maxAttempts: number;           // 最大重试次数（默认 3）
  backoffStrategy: 'fixed' | 'exponential';
  qualityIssueHandling: {
    logic: 'regenerate_full' | 'patch_only';
    setting: 'regenerate_full' | 'patch_only';
    character: 'regenerate_with_stronger_constraint';
    continuity: 'inject_previous_context';
    language: 'polish_only';
    pacing: 'adjust_length_target';
  };
}
```

---

### Phase 1：自主大纲生成（v2.8.0）
**工期：3-4 周**

#### 1.1 概念扩展 Agent
**输入：** 一句话创意（如"废柴修仙逆袭"）

**输出：**
- 完整世界观设定（修仙体系、境界划分、势力分布）
- 主角背景故事
- 核心冲突设计
- 主线剧情走向

**实现：**
- 新增 `concept_expansion_service.ts`
- Prompt 模板：`prompts/concept_expansion.md`
- 结果存储在 `concept_expansions` 表
- 用户可修改后确认

#### 1.2 大纲架构师 Agent
**输入：** 确认后的世界观 + 目标字数（如 100 万字）

**输出：**
- 分卷结构（如 10 卷，每卷 10 万字）
- 每卷的核心目标、主要角色、高潮事件
- 每章的大纲草稿（标题、目标、字数）

**实现：**
- 新增 `outline_architect_service.ts`
- 算法：
  ```
  总字数 / 3000 = 总章节数
  总章节数 / 期望卷数 = 每卷章节数
  按故事弧线分配：起承转合
  ```
- 结果写入现有 `master_outline` / `volume_outline` / `chapter_outline` 表
- 状态标记为 `ai_generated_draft`，等待用户确认

#### 1.3 角色设计 Agent
**输入：** 确认后的大纲

**输出：**
- 主要角色列表（主角、主要配角、反派）
- 每个角色的详细卡片（性格、背景、动机、关系）
- 角色成长弧线规划

**实现：**
- 扩展现有 `settingSuggestions` 机制
- 批量生成角色候选
- 用户确认后自动写入 `characters` 表

#### 1.4 大纲确认流程
**新增 UI 页面：** `/novels/:id/outline-review`

**功能：**
- 展示 AI 生成的完整大纲树
- 支持编辑每个层级（分卷、章节、角色）
- "确认并开始自动生成"按钮
- 确认后：
  - 大纲状态 → `active`
  - 创建 `autonomous_generation_job`
  - 开始 Phase 2

---

### Phase 2：自动生成 + 质量闭环（v2.9.0）
**工期：4-5 周**

#### 2.1 自动生成协调器
**新增服务：** `autonomous_generation_orchestrator.ts`

**核心流程：**
```typescript
async function runAutonomousGeneration(novelId: string) {
  const chapters = await getChaptersInOrder(novelId);
  
  for (const chapter of chapters) {
    let attempt = 0;
    let success = false;
    
    while (attempt < MAX_ATTEMPTS && !success) {
      // 1. 生成正文
      const draft = await generateChapter(chapter.id);
      
      // 2. 自动质量检查
      const qualityReport = await autoQualityCheck(draft);
      
      // 3. 决策
      if (qualityReport.score >= QUALITY_THRESHOLD) {
        // 自动采纳
        await autoAdoptDraft(draft);
        success = true;
      } else {
        // 自动修正
        const fixed = await autoFixIssues(draft, qualityReport);
        if (fixed.success) {
          await autoAdoptDraft(fixed.draft);
          success = true;
        } else {
          attempt++;
        }
      }
    }
    
    if (!success) {
      // 暂停并通知用户
      await pauseGeneration(novelId, chapter.id, '质量检查连续失败');
      return;
    }
    
    // 4. 自动生成章节总结
    await autoGenerateSummary(chapter.id);
  }
  
  await notifyUser(novelId, '全书生成完成！');
}
```

#### 2.2 自动质量检查增强
**扩展现有 `qualityCheckService`：**

```typescript
interface AutoQualityCheckResult {
  score: number;               // 总分 0-100
  dimensionScores: {
    logic: number;
    setting: number;
    character: number;
    continuity: number;
    language: number;
    pacing: number;
  };
  criticalIssues: QualityIssue[];  // 严重问题
  autoFixable: QualityIssue[];     // 可自动修复的问题
  needsRegeneration: boolean;      // 是否需要完全重新生成
}
```

**评分算法：**
- 无严重问题：100 分
- 每个中等问题：-5 分
- 每个轻微问题：-1 分
- 任何严重问题：自动 < 60 分

#### 2.3 自动修正引擎
**新增服务：** `auto_fix_service.ts`

**修正策略矩阵：**
| 问题类型 | 自动修正方法 | 是否需要重新生成 |
|---------|------------|---------------|
| 逻辑矛盾 | 完全重新生成（注入矛盾点说明） | 是 |
| 设定违反 | 完全重新生成（强化世界观约束） | 是 |
| 角色 OOC | 重新生成（双倍角色约束权重） | 是 |
| 连续性问题 | 注入前章详细上下文后重新生成 | 是 |
| 语言问题 | 调用润色服务（polish） | 否 |
| 节奏问题 | 调整目标字数后重新生成 | 是 |

**实现：**
```typescript
async function autoFixIssues(
  draft: ChapterDraft,
  qualityReport: AutoQualityCheckResult
): Promise<{ success: boolean; draft?: ChapterDraft }> {
  // 尝试 Patch 修复（仅语言问题）
  if (qualityReport.autoFixable.length > 0) {
    const polished = await polishDraft(draft, qualityReport.autoFixable);
    const recheck = await autoQualityCheck(polished);
    if (recheck.score >= QUALITY_THRESHOLD) {
      return { success: true, draft: polished };
    }
  }
  
  // 否则重新生成
  if (qualityReport.needsRegeneration) {
    const context = await buildEnhancedContext(draft.chapterId, qualityReport);
    const regenerated = await generateChapter(draft.chapterId, context);
    return { success: true, draft: regenerated };
  }
  
  return { success: false };
}
```

#### 2.4 自动采纳机制
**目标：** 绕过现有的 Safe Apply 人工确认

**方案：**
1. 新增 `autonomous_apply_mode` 标志在 `novels` 表
2. 当 `autonomous_apply_mode = true` 时：
   - `placementRuntimeService.apply()` 跳过用户确认检查
   - 自动设置 `confirmedBy = 'autonomous_system'`
   - 记录到新的 `autonomous_actions` 审计表

**安全保护：**
- 仅在自动生成任务中启用
- 每次采纳记录详细日志（质量分数、决策依据）
- 用户可随时查看自动采纳历史

---

### Phase 3：全局一致性守护（v3.0.0）
**工期：5-6 周**

#### 3.1 全局一致性检查器
**新增服务：** `global_consistency_guardian.ts`

**检查维度：**
1. **人物一致性**
   - 性格：前后章节描述是否一致
   - 能力：实力增长是否合理（不能突然开挂）
   - 状态：伤病必须有痊愈过程
   - 关系：人际关系变化必须有铺垫

2. **世界观一致性**
   - 规则：魔法/修炼体系规则不能自相矛盾
   - 地理：地点距离、环境描述一致
   - 时间线：事件发生顺序合理

3. **剧情一致性**
   - 伏笔回收：前文提到的必须在后文解决
   - 逻辑链：因果关系完整
   - 悬念管理：关键问题不能遗忘

**实现机制：**
```typescript
interface ConsistencyCheck {
  checkEveryNChapters: number;  // 每 N 章执行一次全局检查
  
  async runGlobalCheck(novelId: string, upToChapter: number): Promise<ConsistencyReport> {
    // 1. 提取所有历史上下文
    const allContexts = await gatherAllContexts(novelId, upToChapter);
    
    // 2. 构建知识图谱
    const knowledgeGraph = await buildKnowledgeGraph(allContexts);
    
    // 3. AI 检查一致性
    const report = await aiCheckConsistency(knowledgeGraph);
    
    // 4. 标记矛盾点
    return report;
  }
}
```

**检查时机：**
- 每 10 章自动触发一次
- 每卷结束触发一次
- 全书完成后最终检查

**发现矛盾后的处理：**
- 严重矛盾：暂停生成，通知用户
- 中等矛盾：记录到 `continuity_issues`，在后续章节中自动修正
- 轻微矛盾：记录但不阻塞

#### 3.2 角色关系图谱
**新增表：** `character_relationships`

```sql
CREATE TABLE character_relationships (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  character_a_id TEXT NOT NULL,
  character_b_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL, -- ally/enemy/family/romantic/mentor/rival
  relationship_strength INTEGER NOT NULL, -- -100 to 100
  first_mentioned_chapter_id TEXT,
  last_updated_chapter_id TEXT,
  status TEXT NOT NULL, -- active/ended/unknown
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**自动更新机制：**
- 每章生成后，AI 自动识别关系变化
- 更新关系图谱
- 在后续章节生成时注入关系上下文

#### 3.3 世界观规则库
**新增表：** `world_rules`

```sql
CREATE TABLE world_rules (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  rule_category TEXT NOT NULL, -- magic_system/power_level/geography/economy/politics
  rule_content TEXT NOT NULL,
  source_chapter_id TEXT, -- 首次建立规则的章节
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**规则提取与验证：**
- 从世界设定和前 N 章自动提取规则
- 每章生成前，注入相关规则到 Prompt
- 每章生成后，检查是否违反规则

---

### Phase 4：并发生成与性能优化（v3.1.0）
**工期：3-4 周**

#### 4.1 批量章节并发生成
**场景：** 当大纲足够详细，且章节间依赖较弱时

**策略：**
```typescript
async function parallelGenerate(chapterIds: string[], maxConcurrency: number = 3) {
  const queue = [...chapterIds];
  const running: Promise<any>[] = [];
  
  while (queue.length > 0 || running.length > 0) {
    // 填满并发槽
    while (running.length < maxConcurrency && queue.length > 0) {
      const chapterId = queue.shift()!;
      const promise = generateChapterWithIsolation(chapterId);
      running.push(promise);
    }
    
    // 等待任意一个完成
    const result = await Promise.race(running);
    
    // 验证一致性
    await validateConsistency(result.chapterId);
    
    // 移除已完成
    const index = running.indexOf(result);
    running.splice(index, 1);
  }
}
```

**上下文隔离：**
- 每个并发章节使用独立的上下文快照
- 生成完成后，进行一致性合并检查
- 发现冲突时，串行重新生成冲突章节

#### 4.2 上下文压缩策略
**目标：** 解决百万字后上下文爆炸问题

**分层记忆架构：**
```typescript
interface LayeredMemory {
  // 短期记忆：最近 5 章的完整上下文
  shortTerm: MemorySnapshot[];
  
  // 中期记忆：最近 50 章的摘要上下文
  midTerm: ChapterSummary[];
  
  // 长期记忆：全书的关键事件 + 角色状态
  longTerm: {
    keyEvents: Event[];
    characterStates: CharacterState[];
    worldRules: WorldRule[];
  };
}
```

**压缩算法：**
1. **短期 → 中期**：每 5 章生成一个"弧线总结"
2. **中期 → 长期**：每 50 章提取关键转折点
3. **长期索引**：使用向量数据库（可选，Phase 5）

**预算分配：**
- 短期记忆：40% Token 预算
- 中期记忆：30% Token 预算
- 长期记忆：20% Token 预算
- 当前章节约束：10% Token 预算

#### 4.3 Token 预算管理
**新增表：** `generation_budget_tracking`

```sql
CREATE TABLE generation_budget_tracking (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT,
  tokens_input INTEGER NOT NULL,
  tokens_output INTEGER NOT NULL,
  tokens_total INTEGER NOT NULL,
  cost_usd REAL, -- 可选，基于 provider 定价
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**预算预警：**
- 计算当前速度下完成全书需要的总 Token
- Token 使用超过预期 20% 时警告用户
- 提供"降低质量要求以节省 Token"选项

---

### Phase 5：高级特性（v3.2.0+）
**工期：按需实施**

#### 5.1 向量检索增强（可选）
- 集成 Chroma / Qdrant 向量数据库
- 对历史章节进行 embedding
- 生成时语义检索相关章节

#### 5.2 Multi-Agent 协作（远期）
```
Orchestrator Agent（总调度）
  ├─ Planner Agent（大纲规划）
  ├─ Writer Agent（正文生成）
  ├─ Reviewer Agent（质量审查）
  ├─ Fixer Agent（自动修正）
  ├─ Continuity Agent（一致性守护）
  └─ Summary Agent（章节总结）
```

#### 5.3 用户监控面板
**新增页面：** `/novels/:id/autonomous-monitor`

**功能：**
- 实时进度条（已完成 X / 总共 Y 章）
- 当前正在生成的章节
- 质量分数趋势图
- 异常次数统计
- 暂停/恢复/终止按钮
- Token 消耗实时统计

---

## 3. 数据库迁移规划

### Migration 023：自动化任务基础设施
```sql
-- 自主生成任务
CREATE TABLE autonomous_generation_jobs (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  status TEXT NOT NULL, -- pending/running/paused/completed/failed
  total_chapters INTEGER NOT NULL,
  completed_chapters INTEGER NOT NULL,
  current_chapter_id TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  paused_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES novels(id)
);

-- 质量门槛配置
CREATE TABLE quality_thresholds (
  novel_id TEXT PRIMARY KEY,
  min_total_score INTEGER NOT NULL DEFAULT 70,
  min_logic_score INTEGER NOT NULL DEFAULT 60,
  min_setting_score INTEGER NOT NULL DEFAULT 60,
  min_character_score INTEGER NOT NULL DEFAULT 60,
  min_continuity_score INTEGER NOT NULL DEFAULT 70,
  min_language_score INTEGER NOT NULL DEFAULT 50,
  min_pacing_score INTEGER NOT NULL DEFAULT 50,
  max_retry_attempts INTEGER NOT NULL DEFAULT 3,
  FOREIGN KEY (novel_id) REFERENCES novels(id)
);

-- 自动采纳审计日志
CREATE TABLE autonomous_actions (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  action_type TEXT NOT NULL, -- auto_adopt/auto_fix/auto_retry/auto_pause
  quality_score INTEGER,
  decision_reason TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Migration 024：一致性守护
```sql
-- 角色关系图谱
CREATE TABLE character_relationships (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  character_a_id TEXT NOT NULL,
  character_b_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  relationship_strength INTEGER NOT NULL,
  first_mentioned_chapter_id TEXT,
  last_updated_chapter_id TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 世界观规则库
CREATE TABLE world_rules (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  rule_category TEXT NOT NULL,
  rule_content TEXT NOT NULL,
  source_chapter_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 一致性问题追踪
CREATE TABLE continuity_issues (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  detected_at_chapter_id TEXT NOT NULL,
  issue_type TEXT NOT NULL, -- character/setting/plot/timeline
  severity TEXT NOT NULL, -- critical/major/minor
  description TEXT NOT NULL,
  status TEXT NOT NULL, -- open/fixed/ignored
  fixed_at_chapter_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Migration 025：性能优化
```sql
-- Token 预算追踪
CREATE TABLE generation_budget_tracking (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT,
  operation_type TEXT NOT NULL, -- generate/quality_check/fix/summary
  tokens_input INTEGER NOT NULL,
  tokens_output INTEGER NOT NULL,
  tokens_total INTEGER NOT NULL,
  cost_usd REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 并发生成锁
CREATE TABLE chapter_generation_locks (
  chapter_id TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL, -- job_id 或 session_id
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);
```

---

## 4. 风险与缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| AI 幻觉导致质量崩溃 | 严重 | 严格质量门槛 + 自动重试 + 人工审查暂停点 |
| 上下文过长导致生成慢 | 中等 | 分层记忆 + 动态压缩 + 并发生成 |
| Token 成本爆炸 | 严重 | 预算追踪 + 实时预警 + 可调质量参数 |
| 一致性维护失败 | 严重 | 每 10 章全局检查 + 关系图谱 + 规则库 |
| SQLite 性能瓶颈 | 中等 | 索引优化 + 冷数据归档 + 读写分离 |
| 并发生成冲突 | 中等 | 分布式锁 + 一致性合并检查 |

---

## 5. 实施优先级

### P0（必须实现，否则无法自动生成）
- [x] Phase 0：任务调度器 + 质量自动评分
- [x] Phase 1：自主大纲生成
- [x] Phase 2：自动生成 + 质量闭环
- [x] Phase 3.1：全局一致性检查器

### P1（重要，影响用户体验）
- [ ] Phase 3.2：角色关系图谱
- [ ] Phase 3.3：世界观规则库
- [ ] Phase 4.2：上下文压缩策略
- [ ] Phase 4.3：Token 预算管理

### P2（优化，提升效率）
- [ ] Phase 4.1：并发生成
- [ ] Phase 5.3：用户监控面板

### P3（未来，可选）
- [ ] Phase 5.1：向量检索
- [ ] Phase 5.2：Multi-Agent 协作

---

## 6. 与现有架构的兼容性

**保持兼容：**
- 现有手动工作流完全保留
- 用户可以随时切换"手动模式"和"自动模式"
- 自动生成的内容可以手动修改

**复用现有组件：**
- `generationJobService`：扩展为自动任务
- `qualityCheckService`：增加自动评分
- `placementRuntimeService`：增加自动采纳分支
- `memoryPersistenceService`：复用记忆机制
- `agentPlanRuntimeService`：扩展为自动规划

**新增独立模块：**
- `autonomous_generation_orchestrator`（顶层协调器）
- `auto_fix_service`（自动修正引擎）
- `global_consistency_guardian`（一致性守护）
- `outline_architect_service`（大纲架构师）

---

## 7. 交付标准

每个 Phase 完成后必须满足：

1. **功能完整性**
   - 所有核心功能可正常工作
   - Mock 模式可完整演示流程

2. **测试覆盖**
   - Rust 单元测试覆盖新增命令
   - TypeScript 单元测试覆盖新增服务
   - E2E 测试覆盖关键路径

3. **文档完整性**
   - 架构文档更新
   - API 文档补充
   - 用户指南更新

4. **性能验证**
   - 单章生成时间 < 60 秒
   - 质量检查时间 < 30 秒
   - SQLite 查询 < 100ms

5. **安全性**
   - 所有自动操作有审计日志
   - 用户可随时暂停/回滚
   - API Key 不进入日志

---

## 8. 下一步行动

### 立即开始（本次会话）
1. ✅ 完成本路线图文档
2. ⏳ 实施 Phase 0.1：任务调度器基础架构
3. ⏳ 实施 Phase 0.2：质量自动评分系统

### 本周计划
- 完成 Phase 0 全部功能
- 编写 Migration 023
- 通过单元测试

### 下周计划
- 开始 Phase 1：自主大纲生成
- 实现概念扩展 Agent
- 实现大纲架构师 Agent

---

**此路线图是活文档，将随实施进度持续更新。**
