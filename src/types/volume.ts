/**
 * AI Novel Studio - 分卷类型定义
 */

export type VolumeStatus = 'planned' | 'writing' | 'completed';

export const VolumeStatusLabels: Record<VolumeStatus, string> = {
  planned: '规划中',
  writing: '创作中',
  completed: '已完成',
};

export interface Volume {
  id: string;
  novelId: string;
  title: string;
  summary?: string;
  goal?: string;
  mainConflict?: string;
  orderIndex: number;
  volumeNumber: number;
  sortOrder: number;
  status: VolumeStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CreateVolumeInput {
  novelId: string;
  title: string;
  summary?: string;
  goal?: string;
  mainConflict?: string;
  orderIndex?: number;
}

export interface UpdateVolumeInput {
  title?: string;
  summary?: string;
  goal?: string;
  mainConflict?: string;
  orderIndex?: number;
  status?: VolumeStatus;
}
