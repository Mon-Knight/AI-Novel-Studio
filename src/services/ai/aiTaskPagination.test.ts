import { beforeEach, describe, expect, it } from 'vitest';
import type { AiTaskRecord } from '../../types/ai';
import { aiTaskService } from './aiTaskService';

const TASKS_KEY = 'ai_novel_studio_ai_tasks';

function task(index: number): AiTaskRecord {
  return {
    id: `task-${String(index).padStart(4, '0')}`,
    taskType: index % 2 === 0 ? 'chapter_generate' : 'quality_check',
    status: index % 3 === 0 ? 'failed' : 'succeeded',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  };
}

describe('aiTaskService server-compatible pagination fallback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps records beyond the former 500-item cap reachable', async () => {
    localStorage.setItem(TASKS_KEY, JSON.stringify(Array.from({ length: 650 }, (_, i) => task(i))));

    const page = await aiTaskService.getAll(13, 50);

    expect(page.total).toBe(650);
    expect(page.items).toHaveLength(50);
    expect(page.items[0]?.id).toBe('task-0049');
    expect(page.items[49]?.id).toBe('task-0000');
  });

  it('applies type and status filters before counting and slicing', async () => {
    localStorage.setItem(TASKS_KEY, JSON.stringify(Array.from({ length: 600 }, (_, i) => task(i))));

    const page = await aiTaskService.getAll(2, 25, {
      taskType: 'chapter_generate',
      status: 'succeeded',
    });

    expect(page.total).toBe(200);
    expect(page.items).toHaveLength(25);
    expect(page.items.every((item) => item.taskType === 'chapter_generate')).toBe(true);
    expect(page.items.every((item) => item.status === 'succeeded')).toBe(true);
  });
});
