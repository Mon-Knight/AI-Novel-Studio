import { describe, expect, it } from 'vitest';
import { AI_TASK_USER_STATUS_LABELS } from '../../types/aiTaskCenter';

describe('quality worker frontend contract', () => {
  it('keeps worker states in the shared author-facing vocabulary', () => {
    expect(AI_TASK_USER_STATUS_LABELS.preparing).toBe('准备中');
    expect(AI_TASK_USER_STATUS_LABELS.working).toBe('工作中');
    expect(AI_TASK_USER_STATUS_LABELS.checking).toBe('检查结果');
    expect(AI_TASK_USER_STATUS_LABELS.awaiting_confirmation).toBe('等待确认');
  });
});

