import type { AiSettings, ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type {
  QualityCheckItem,
  QualityCheckReport,
  QualityCheckStatistics,
  QualityIssueFilter,
  QualityIssueStatus,
} from '../../../types/qualityCheck';
import type { FixComparison, FixScopeValidation } from '../../../services/ai/qualityFixService';
import { CheckPanelActionSections } from './CheckPanelActionSections';
import { CheckPanelResultSections } from './CheckPanelResultSections';

export type QualityOperationPhase = 'idle' | 'available' | 'committing' | 'cancelling';

export interface CheckPanelViewProps {
  chapter: Chapter;
  aiSettings: AiSettings;
  currentDraft: ChapterDraft | null;
  loading: boolean;
  operationPhase: QualityOperationPhase;
  activeReport: QualityCheckReport | null;
  viewingHistory: boolean;
  statistics: QualityCheckStatistics;
  fixLoading: boolean;
  fixStage: string;
  fixProgress: number;
  fixError: string;
  fixRoundUsed: boolean;
  error: string;
  historyReports: QualityCheckReport[];
  selectedReportId: string;
  historyLoading: boolean;
  reportOutdated: boolean;
  fixComparison: FixComparison | null;
  fixScopeValidation: FixScopeValidation | null;
  activeItems: QualityCheckItem[];
  filter: QualityIssueFilter;
  locateMessage: string;
  filteredItems: QualityCheckItem[];
  onRunCheck: () => void;
  onStopOperation: () => void;
  onAiFix: () => void;
  onHistoryChange: (reportId: string) => void;
  onFilterChange: (filter: QualityIssueFilter) => void;
  onLocate: (item: QualityCheckItem) => void;
  onStatusChange: (itemId: string, status: QualityIssueStatus) => void;
  onRevertFix: () => void;
  onConfirmFix: () => void;
}

export function CheckPanelView(props: CheckPanelViewProps) {
  return (
    <div>
      <CheckPanelActionSections {...props} />
      <CheckPanelResultSections {...props} />
    </div>
  );
}
