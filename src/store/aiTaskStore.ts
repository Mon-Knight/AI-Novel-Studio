import type { UnifiedAiTaskStatus } from '../types/ai-task';

export interface AiTaskSummary {
  taskId: string;
  status: UnifiedAiTaskStatus;
  progress?: string;
  errorSummary?: string;
  artifactId?: string;
}

type Listener = () => void;

const summaries = new Map<string, AiTaskSummary>();
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export const aiTaskStore = {
  upsert(summary: AiTaskSummary): void {
    summaries.set(summary.taskId, { ...summaries.get(summary.taskId), ...summary });
    emit();
  },

  get(taskId: string): AiTaskSummary | undefined {
    const summary = summaries.get(taskId);
    return summary ? { ...summary } : undefined;
  },

  list(): AiTaskSummary[] {
    return Array.from(summaries.values(), (summary) => ({ ...summary }));
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
