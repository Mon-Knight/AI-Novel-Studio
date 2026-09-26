import { useEffect, useRef, useState } from 'react';
import type {
  SettingSuggestionPayload,
  SettingSuggestionRecord,
} from '../../types/settingSuggestion';
import type { WorldRuleChangeImpact } from '../../types/worldRules';
import type { WorldRuleApplicationGuard } from '../../components/novel-detail/WorldRuleChangeConfirmation';
import { settingSuggestionService } from '../../services/settingSuggestions/settingSuggestionService';
import { describeUnknownError } from '../../utils/errorMessage';

/** Coordinates one explicit candidate decision; closing keeps per-candidate editing drafts. */
export function useSettingSuggestionAdoption({
  novelId: selectedNovelId,
  onRecord: refreshRecord,
  onMessage: setMessage,
  onError: setError,
}: {
  novelId: string;
  onRecord: (record: SettingSuggestionRecord) => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [editingRecord, setEditingRecord] = useState<SettingSuggestionRecord | null>(null);
  const [editingJson, setEditingJson] = useState('');
  const [editingBusy, setEditingBusy] = useState(false);
  const editingInFlight = useRef(false);
  const editedDrafts = useRef(new Map<string, string>());
  const adoptionRequest = useRef(0);
  const currentNovel = useRef(selectedNovelId);
  currentNovel.current = selectedNovelId;
  const [pendingAdoption, setPendingAdoption] = useState<{
    record: SettingSuggestionRecord;
    item?: SettingSuggestionPayload;
    preview: WorldRuleChangeImpact;
  } | null>(null);
  useEffect(() => {
    adoptionRequest.current += 1;
    setPendingAdoption(null);
    setEditingRecord(null);
  }, [selectedNovelId]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      adoptionRequest.current += 1;
    };
  }, []);
  const settleAdoption = async (
    record: SettingSuggestionRecord,
    item?: SettingSuggestionPayload,
    guard?: WorldRuleApplicationGuard,
  ) => {
    if (record.novelId !== currentNovel.current) throw new Error('作品已切换，请重新审阅候选');
    const result = await settingSuggestionService.adopt(record.id, item, guard);
    if (!mountedRef.current || record.novelId !== currentNovel.current) return;
    refreshRecord(result.record);
    editedDrafts.current.delete(record.id);
    setPendingAdoption(null);
    setEditingRecord(null);
    setMessage('已明确确认并采纳到正式模块，目标 ' + (result.targetId?.slice(0, 8) || ''));
  };
  const requestAdoption = async (
    record: SettingSuggestionRecord,
    item?: SettingSuggestionPayload,
  ) => {
    if (editingInFlight.current) return;
    editingInFlight.current = true;
    setEditingBusy(true);
    setError('');
    const token = ++adoptionRequest.current;
    try {
      const preview = await settingSuggestionService.previewAdoption(record.id, item);
      if (
        !mountedRef.current ||
        token !== adoptionRequest.current ||
        record.novelId !== currentNovel.current
      )
        return;
      if (preview) setPendingAdoption({ record, item, preview });
      else await settleAdoption(record, item);
    } catch (e) {
      if (mountedRef.current && token === adoptionRequest.current)
        setError(describeUnknownError(e, '采用预览失败，候选未改变'));
    } finally {
      editingInFlight.current = false;
      if (mountedRef.current) setEditingBusy(false);
    }
  };
  const handleAdopt = (record: SettingSuggestionRecord) => requestAdoption(record);
  const confirmGovernedAdoption = async (guard: WorldRuleApplicationGuard) => {
    if (!pendingAdoption || editingInFlight.current) return;
    editingInFlight.current = true;
    setEditingBusy(true);
    setError('');
    try {
      await settleAdoption(pendingAdoption.record, pendingAdoption.item, guard);
    } catch (e) {
      if (mountedRef.current)
        setError(describeUnknownError(e, '采用失败，请重新预览；候选与编辑内容保留'));
    } finally {
      editingInFlight.current = false;
      if (mountedRef.current) setEditingBusy(false);
    }
  };

  const openEditAdopt = (record: SettingSuggestionRecord) => {
    setEditingRecord(record);
    setEditingJson(editedDrafts.current.get(record.id) ?? JSON.stringify(record.item, null, 2));
    setError('');
  };

  const confirmEditAdopt = async () => {
    if (!editingRecord || editingInFlight.current) return;
    try {
      const parsed = JSON.parse(editingJson) as SettingSuggestionPayload;
      await requestAdoption(editingRecord, parsed);
    } catch (e) {
      setError(describeUnknownError(e, '编辑后采纳失败，请检查 JSON 格式'));
    }
  };

  return {
    editingRecord,
    editingJson,
    editingBusy,
    pendingAdoption,
    handleAdopt,
    confirmGovernedAdoption,
    openEditAdopt,
    confirmEditAdopt,
    updateEditingJson: (value: string) => {
      setEditingJson(value);
      if (editingRecord) editedDrafts.current.set(editingRecord.id, value);
    },
    closeEditor: () => {
      if (!editingBusy) setEditingRecord(null);
    },
    cancelPending: () => {
      if (!editingBusy) {
        setPendingAdoption(null);
        setError('');
      }
    },
  };
}
