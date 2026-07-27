# Phase 0 实施计划：基础设施准备（v2.7.0）

> 目标：建立自动化生成所需的核心基础设施  
> 工期：2-3 周  
> 前置条件：v2.6.0 已完成

---

## 1. 总体目标

Phase 0 不涉及 AI 生成正文，只建立自动化任务调度、质量自动评分和重试策略的基础设施。

**交付物：**
1. 自动化任务队列系统
2. 全局进度追踪
3. 质量自动评分引擎
4. 自动采纳决策引擎
5. 重试策略配置

---

## 2. 数据库设计（Migration 023）

### 2.1 自主生成任务表

```sql
-- Migration 023: Autonomous Generation Infrastructure
CREATE TABLE autonomous_generation_jobs (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE, -- 幂等性
  
  -- 状态机
  status TEXT NOT NULL CHECK (status IN (
    'pending',      -- 等待开始
    'running',      -- 正在生成
    'paused',       -- 用户暂停或异常暂停
    'completed',    -- 全部完成
    'failed',       -- 失败终止
    'cancelled'     -- 用户取消
  )),
  
  -- 进度追踪
  total_chapters INTEGER NOT NULL,
  completed_chapters INTEGER NOT NULL DEFAULT 0,
  current_chapter_id TEXT,
  current_chapter_attempt INTEGER DEFAULT 0,
  
  -- 统计
  total_tokens_input INTEGER DEFAULT 0,
  total_tokens_output INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0.0,
  
  -- 时间戳
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  paused_at TIMESTAMP,
  
  -- 暂停原因
  paused_reason TEXT,
  paused_chapter_id TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
  FOREIGN KEY (current_chapter_id) REFERENCES chapters(id),
  FOREIGN KEY (paused_chapter_id) REFERENCES chapters(id)
);

CREATE INDEX idx_autonomous_jobs_novel ON autonomous_generation_jobs(novel_id);
CREATE INDEX idx_autonomous_jobs_status ON autonomous_generation_jobs(status);

-- 状态机约束触发器
CREATE TRIGGER validate_autonomous_job_status_transition
BEFORE UPDATE OF status ON autonomous_generation_jobs
FOR EACH ROW
BEGIN
  SELECT CASE
    -- pending 只能 → running/cancelled
    WHEN OLD.status = 'pending' AND NEW.status NOT IN ('running', 'cancelled')
    THEN RAISE(ABORT, 'Invalid transition from pending')
    
    -- running 只能 → paused/completed/failed/cancelled
    WHEN OLD.status = 'running' AND NEW.status NOT IN ('paused', 'completed', 'failed', 'cancelled')
    THEN RAISE(ABORT, 'Invalid transition from running')
    
    -- paused 只能 → running/cancelled
    WHEN OLD.status = 'paused' AND NEW.status NOT IN ('running', 'cancelled')
    THEN RAISE(ABORT, 'Invalid transition from paused')
    
    -- 终态不可变
    WHEN OLD.status IN ('completed', 'failed', 'cancelled')
    THEN RAISE(ABORT, 'Cannot transition from terminal state')
  END;
END;
```

### 2.2 质量门槛配置表

```sql
CREATE TABLE quality_thresholds (
  novel_id TEXT PRIMARY KEY,
  
  -- 总分要求
  min_total_score INTEGER NOT NULL DEFAULT 70 CHECK (min_total_score >= 0 AND min_total_score <= 100),
  
  -- 各维度最低分
  min_logic_score INTEGER NOT NULL DEFAULT 60 CHECK (min_logic_score >= 0 AND min_logic_score <= 100),
  min_setting_score INTEGER NOT NULL DEFAULT 60 CHECK (min_setting_score >= 0 AND min_setting_score <= 100),
  min_character_score INTEGER NOT NULL DEFAULT 60 CHECK (min_character_score >= 0 AND min_character_score <= 100),
  min_continuity_score INTEGER NOT NULL DEFAULT 70 CHECK (min_continuity_score >= 0 AND min_continuity_score <= 100),
  min_language_score INTEGER NOT NULL DEFAULT 50 CHECK (min_language_score >= 0 AND min_language_score <= 100),
  min_pacing_score INTEGER NOT NULL DEFAULT 50 CHECK (min_pacing_score >= 0 AND min_pacing_score <= 100),
  
  -- 重试策略
  max_retry_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_retry_attempts >= 1 AND max_retry_attempts <= 10),
  
  -- 严重问题阈值
  max_critical_issues INTEGER NOT NULL DEFAULT 0 CHECK (max_critical_issues >= 0),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);
```

### 2.3 自动采纳审计日志表

```sql
CREATE TABLE autonomous_actions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  
  action_type TEXT NOT NULL CHECK (action_type IN (
    'auto_generate',      -- 自动生成章节
    'auto_quality_check', -- 自动质量检查
    'auto_adopt',         -- 自动采纳
    'auto_fix',           -- 自动修正
    'auto_retry',         -- 自动重试
    'auto_pause',         -- 自动暂停
    'auto_summary'        -- 自动生成总结
  )),
  
  -- 决策上下文
  quality_score INTEGER,
  quality_report_id TEXT,
  decision_reason TEXT NOT NULL,
  
  -- 结果
  success BOOLEAN NOT NULL,
  error_message TEXT,
  
  -- 元数据
  tokens_used INTEGER,
  duration_ms INTEGER,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (job_id) REFERENCES autonomous_generation_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  FOREIGN KEY (quality_report_id) REFERENCES quality_check_reports(id)
);

CREATE INDEX idx_autonomous_actions_job ON autonomous_actions(job_id);
CREATE INDEX idx_autonomous_actions_chapter ON autonomous_actions(chapter_id);
CREATE INDEX idx_autonomous_actions_type ON autonomous_actions(action_type);
```

### 2.4 章节生成锁表

```sql
CREATE TABLE chapter_generation_locks (
  chapter_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  locked_by TEXT NOT NULL, -- session_id 或 worker_id
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES autonomous_generation_jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_generation_locks_expires ON chapter_generation_locks(expires_at);

-- 自动清理过期锁（应用启动时调用）
CREATE TRIGGER cleanup_expired_locks
AFTER INSERT ON chapter_generation_locks
BEGIN
  DELETE FROM chapter_generation_locks
  WHERE expires_at < CURRENT_TIMESTAMP;
END;
```

---

## 3. TypeScript 类型定义

### 3.1 核心类型

```typescript
// src/types/autonomous.ts

export type AutonomousJobStatus = 
  | 'pending' 
  | 'running' 
  | 'paused' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

export interface AutonomousGenerationJob {
  id: string;
  novelId: string;
  operationId: string;
  status: AutonomousJobStatus;
  totalChapters: number;
  completedChapters: number;
  currentChapterId?: string;
  currentChapterAttempt: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  estimatedCostUsd: number;
  startedAt?: Date;
  completedAt?: Date;
  pausedAt?: Date;
  pausedReason?: string;
  pausedChapterId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QualityThresholds {
  novelId: string;
  minTotalScore: number;
  minLogicScore: number;
  minSettingScore: number;
  minCharacterScore: number;
  minContinuityScore: number;
  minLanguageScore: number;
  minPacingScore: number;
  maxRetryAttempts: number;
  maxCriticalIssues: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AutonomousActionType =
  | 'auto_generate'
  | 'auto_quality_check'
  | 'auto_adopt'
  | 'auto_fix'
  | 'auto_retry'
  | 'auto_pause'
  | 'auto_summary';

export interface AutonomousAction {
  id: string;
  jobId: string;
  novelId: string;
  chapterId: string;
  actionType: AutonomousActionType;
  qualityScore?: number;
  qualityReportId?: string;
  decisionReason: string;
  success: boolean;
  errorMessage?: string;
  tokensUsed?: number;
  durationMs?: number;
  createdAt: Date;
}

export interface AutoQualityCheckResult {
  score: number; // 0-100
  passed: boolean;
  dimensionScores: {
    logic: number;
    setting: number;
    character: number;
    continuity: number;
    language: number;
    pacing: number;
  };
  dimensionPassed: {
    logic: boolean;
    setting: boolean;
    character: boolean;
    continuity: boolean;
    language: boolean;
    pacing: boolean;
  };
  criticalIssues: QualityCheckItem[];
  autoFixableIssues: QualityCheckItem[];
  needsRegeneration: boolean;
  recommendation: 'adopt' | 'fix' | 'regenerate' | 'give_up';
}
```

---

## 4. Rust IPC 命令

### 4.1 命令列表

```rust
// src-tauri/src/commands/autonomous.rs

#[tauri::command]
pub async fn create_autonomous_job(
    input: CreateAutonomousJobInput,
    state: State<'_, AppState>
) -> Result<AutonomousGenerationJob, AppError>

#[tauri::command]
pub async fn get_autonomous_job(
    job_id: String,
    state: State<'_, AppState>
) -> Result<Option<AutonomousGenerationJob>, AppError>

#[tauri::command]
pub async fn list_autonomous_jobs_by_novel(
    novel_id: String,
    state: State<'_, AppState>
) -> Result<Vec<AutonomousGenerationJob>, AppError>

#[tauri::command]
pub async fn update_autonomous_job_status(
    input: UpdateJobStatusInput,
    state: State<'_, AppState>
) -> Result<AutonomousGenerationJob, AppError>

#[tauri::command]
pub async fn update_autonomous_job_progress(
    input: UpdateJobProgressInput,
    state: State<'_, AppState>
) -> Result<AutonomousGenerationJob, AppError>

#[tauri::command]
pub async fn pause_autonomous_job(
    input: PauseJobInput,
    state: State<'_, AppState>
) -> Result<AutonomousGenerationJob, AppError>

#[tauri::command]
pub async fn resume_autonomous_job(
    job_id: String,
    state: State<'_, AppState>
) -> Result<AutonomousGenerationJob, AppError>

#[tauri::command]
pub async fn cancel_autonomous_job(
    job_id: String,
    state: State<'_, AppState>
) -> Result<AutonomousGenerationJob, AppError>

// 质量门槛
#[tauri::command]
pub async fn get_quality_thresholds(
    novel_id: String,
    state: State<'_, AppState>
) -> Result<Option<QualityThresholds>, AppError>

#[tauri::command]
pub async fn save_quality_thresholds(
    input: SaveQualityThresholdsInput,
    state: State<'_, AppState>
) -> Result<QualityThresholds, AppError>

// 审计日志
#[tauri::command]
pub async fn log_autonomous_action(
    input: LogActionInput,
    state: State<'_, AppState>
) -> Result<AutonomousAction, AppError>

#[tauri::command]
pub async fn list_autonomous_actions(
    job_id: String,
    state: State<'_, AppState>
) -> Result<Vec<AutonomousAction>, AppError>

// 锁管理
#[tauri::command]
pub async fn acquire_chapter_lock(
    input: AcquireChapterLockInput,
    state: State<'_, AppState>
) -> Result<bool, AppError>

#[tauri::command]
pub async fn release_chapter_lock(
    chapter_id: String,
    state: State<'_, AppState>
) -> Result<(), AppError>

#[tauri::command]
pub async fn cleanup_expired_locks(
    state: State<'_, AppState>
) -> Result<usize, AppError>
```

---

## 5. 前端服务实现

### 5.1 自主生成任务服务

```typescript
// src/services/autonomous/autonomousJobService.ts

import { dbCall } from '@/services/tauri/dbCall';
import type { 
  AutonomousGenerationJob, 
  QualityThresholds,
  AutonomousAction 
} from '@/types/autonomous';

export const autonomousJobService = {
  async create(input: {
    novelId: string;
    operationId: string;
    totalChapters: number;
  }): Promise<AutonomousGenerationJob> {
    return dbCall('create_autonomous_job', { input });
  },

  async get(jobId: string): Promise<AutonomousGenerationJob | null> {
    return dbCall('get_autonomous_job', { jobId });
  },

  async listByNovel(novelId: string): Promise<AutonomousGenerationJob[]> {
    return dbCall('list_autonomous_jobs_by_novel', { novelId });
  },

  async updateStatus(input: {
    jobId: string;
    status: AutonomousJobStatus;
  }): Promise<AutonomousGenerationJob> {
    return dbCall('update_autonomous_job_status', { input });
  },

  async updateProgress(input: {
    jobId: string;
    completedChapters: number;
    currentChapterId?: string;
    currentChapterAttempt?: number;
    tokensInput?: number;
    tokensOutput?: number;
  }): Promise<AutonomousGenerationJob> {
    return dbCall('update_autonomous_job_progress', { input });
  },

  async pause(input: {
    jobId: string;
    reason: string;
    chapterId?: string;
  }): Promise<AutonomousGenerationJob> {
    return dbCall('pause_autonomous_job', { input });
  },

  async resume(jobId: string): Promise<AutonomousGenerationJob> {
    return dbCall('resume_autonomous_job', { jobId });
  },

  async cancel(jobId: string): Promise<AutonomousGenerationJob> {
    return dbCall('cancel_autonomous_job', { jobId });
  },

  async getQualityThresholds(novelId: string): Promise<QualityThresholds | null> {
    return dbCall('get_quality_thresholds', { novelId });
  },

  async saveQualityThresholds(input: QualityThresholds): Promise<QualityThresholds> {
    return dbCall('save_quality_thresholds', { input });
  },

  async logAction(input: {
    jobId: string;
    novelId: string;
    chapterId: string;
    actionType: AutonomousActionType;
    decisionReason: string;
    success: boolean;
    qualityScore?: number;
    qualityReportId?: string;
    errorMessage?: string;
    tokensUsed?: number;
    durationMs?: number;
  }): Promise<AutonomousAction> {
    return dbCall('log_autonomous_action', { input });
  },

  async listActions(jobId: string): Promise<AutonomousAction[]> {
    return dbCall('list_autonomous_actions', { jobId });
  },
};
```

### 5.2 质量自动评分服务

```typescript
// src/services/autonomous/autoQualityService.ts

import type { QualityCheckReport, QualityCheckItem } from '@/types/quality';
import type { AutoQualityCheckResult, QualityThresholds } from '@/types/autonomous';

export class AutoQualityService {
  /**
   * 自动评分：将质量检查报告转换为决策
   */
  async evaluateQuality(
    report: QualityCheckReport,
    items: QualityCheckItem[],
    thresholds: QualityThresholds
  ): Promise<AutoQualityCheckResult> {
    // 1. 计算各维度分数
    const dimensionScores = this.calculateDimensionScores(items);
    
    // 2. 计算总分
    const totalScore = this.calculateTotalScore(dimensionScores);
    
    // 3. 判断各维度是否通过
    const dimensionPassed = {
      logic: dimensionScores.logic >= thresholds.minLogicScore,
      setting: dimensionScores.setting >= thresholds.minSettingScore,
      character: dimensionScores.character >= thresholds.minCharacterScore,
      continuity: dimensionScores.continuity >= thresholds.minContinuityScore,
      language: dimensionScores.language >= thresholds.minLanguageScore,
      pacing: dimensionScores.pacing >= thresholds.minPacingScore,
    };
    
    // 4. 识别严重问题
    const criticalIssues = items.filter(item => item.severity === 'critical');
    
    // 5. 识别可自动修复的问题
    const autoFixableIssues = items.filter(item => 
      item.category === 'language' && item.severity !== 'critical'
    );
    
    // 6. 判断是否需要重新生成
    const needsRegeneration = 
      criticalIssues.length > thresholds.maxCriticalIssues ||
      !dimensionPassed.logic ||
      !dimensionPassed.setting ||
      !dimensionPassed.character ||
      !dimensionPassed.continuity;
    
    // 7. 给出推荐
    let recommendation: 'adopt' | 'fix' | 'regenerate' | 'give_up';
    
    if (totalScore >= thresholds.minTotalScore && criticalIssues.length === 0) {
      recommendation = 'adopt';
    } else if (autoFixableIssues.length > 0 && !needsRegeneration) {
      recommendation = 'fix';
    } else if (needsRegeneration) {
      recommendation = 'regenerate';
    } else {
      recommendation = 'give_up';
    }
    
    return {
      score: totalScore,
      passed: totalScore >= thresholds.minTotalScore,
      dimensionScores,
      dimensionPassed,
      criticalIssues,
      autoFixableIssues,
      needsRegeneration,
      recommendation,
    };
  }
  
  private calculateDimensionScores(items: QualityCheckItem[]): AutoQualityCheckResult['dimensionScores'] {
    const categories = ['logic', 'setting', 'character', 'continuity', 'language', 'pacing'] as const;
    const scores: any = {};
    
    for (const category of categories) {
      const categoryItems = items.filter(item => item.category === category);
      
      if (categoryItems.length === 0) {
        scores[category] = 100; // 无问题 = 满分
      } else {
        // 100 - (严重问题数 × 30 + 中等问题数 × 10 + 轻微问题数 × 3)
        const critical = categoryItems.filter(i => i.severity === 'critical').length;
        const major = categoryItems.filter(i => i.severity === 'major').length;
        const minor = categoryItems.filter(i => i.severity === 'minor').length;
        
        const deduction = critical * 30 + major * 10 + minor * 3;
        scores[category] = Math.max(0, 100 - deduction);
      }
    }
    
    return scores;
  }
  
  private calculateTotalScore(dimensionScores: AutoQualityCheckResult['dimensionScores']): number {
    // 加权平均：逻辑、设定、连续性权重更高
    const weights = {
      logic: 0.25,
      setting: 0.20,
      character: 0.15,
      continuity: 0.25,
      language: 0.10,
      pacing: 0.05,
    };
    
    let totalScore = 0;
    for (const [key, weight] of Object.entries(weights)) {
      totalScore += dimensionScores[key as keyof typeof dimensionScores] * weight;
    }
    
    return Math.round(totalScore);
  }
}

export const autoQualityService = new AutoQualityService();
```

---

## 6. 测试计划

### 6.1 Rust 单元测试

```rust
// src-tauri/src/commands/autonomous.rs

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_create_and_get_job() {
        // 测试创建任务
    }
    
    #[tokio::test]
    async fn test_job_status_transitions() {
        // 测试状态机转换
    }
    
    #[tokio::test]
    async fn test_quality_thresholds_defaults() {
        // 测试默认阈值
    }
    
    #[tokio::test]
    async fn test_chapter_lock_expiry() {
        // 测试锁过期清理
    }
}
```

### 6.2 TypeScript 单元测试

```typescript
// src/services/autonomous/__tests__/autoQualityService.test.ts

describe('AutoQualityService', () => {
  it('should score 100 when no issues', () => {
    const result = autoQualityService.evaluateQuality(
      mockReport,
      [],
      mockThresholds
    );
    expect(result.score).toBe(100);
    expect(result.recommendation).toBe('adopt');
  });
  
  it('should recommend fix for language issues', () => {
    const items = [mockLanguageIssue];
    const result = autoQualityService.evaluateQuality(
      mockReport,
      items,
      mockThresholds
    );
    expect(result.recommendation).toBe('fix');
  });
  
  it('should recommend regenerate for critical logic issues', () => {
    const items = [mockCriticalLogicIssue];
    const result = autoQualityService.evaluateQuality(
      mockReport,
      items,
      mockThresholds
    );
    expect(result.recommendation).toBe('regenerate');
  });
});
```

---

## 7. 实施顺序

### Step 1：数据库（1 天）
- [ ] 编写 Migration 023
- [ ] Rust 迁移逻辑
- [ ] 验证约束和触发器

### Step 2：Rust 命令（2 天）
- [ ] 实现 autonomous.rs 所有命令
- [ ] 单元测试
- [ ] 注册到 main.rs

### Step 3：TypeScript 类型（0.5 天）
- [ ] 定义 autonomous.ts 类型
- [ ] 同步到前后端

### Step 4：前端服务（2 天）
- [ ] autonomousJobService.ts
- [ ] autoQualityService.ts
- [ ] 单元测试

### Step 5：集成测试（1 天）
- [ ] 端到端创建任务流程
- [ ] 质量评分流程
- [ ] 锁管理流程

### Step 6：文档（0.5 天）
- [ ] 更新架构文档
- [ ] API 文档
- [ ] 代码注释

---

## 8. 验收标准

- [x] Migration 023 成功运行
- [ ] 所有 Rust 单元测试通过
- [ ] 所有 TypeScript 单元测试通过
- [ ] 可以创建自主生成任务（不执行，只记录状态）
- [ ] 可以正确评分质量检查报告
- [ ] 章节锁正常工作
- [ ] 审计日志正确记录
- [ ] 文档完整

---

**完成 Phase 0 后，即可进入 Phase 1：自主大纲生成。**
