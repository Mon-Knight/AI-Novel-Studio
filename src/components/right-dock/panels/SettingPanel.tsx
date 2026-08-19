import { useState, useEffect, useRef } from 'react';
import { settingRepository } from '../../../services/database/settingRepository';
import { protagonistRepository } from '../../../services/database/protagonistRepository';
import {
  settingExpandService,
  type SettingSuggestion,
} from '../../../services/ai/settingExpandService';
import { placementRuntimeService } from '../../../services/placements/placementRuntimeService';
import { getAppErrorUserMessage, normalizeAppError } from '../../../types/appError';
import type { WorldSetting, RuleSystem } from '../../../types/setting';
import type { Protagonist } from '../../../types/protagonist';
import type { Chapter } from '../../../types/chapter';
import { describeUnknownError } from '../../../utils/errorMessage';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from '../../../services/ai/aiCancellation';

interface SettingPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function SettingPanel({ novelId, chapter }: SettingPanelProps) {
  const [worldSettings, setWorldSettings] = useState<WorldSetting[]>([]);
  const [ruleSystems, setRuleSystems] = useState<RuleSystem[]>([]);
  const [protagonist, setProtagonist] = useState<Protagonist | null>(null);
  const [suggestions, setSuggestions] = useState<SettingSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingProposalId, setApplyingProposalId] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const suggestionAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (novelId) {
      settingRepository
        .getWorldSettings(novelId)
        .then(setWorldSettings)
        .catch(() => {});
      settingRepository
        .getRuleSystems(novelId)
        .then(setRuleSystems)
        .catch(() => {});
      protagonistRepository
        .getByNovelId(novelId)
        .then(setProtagonist)
        .catch(() => {});
    }
  }, [novelId]);

  useEffect(
    () => () => {
      suggestionAbortRef.current?.abort();
    },
    [novelId, chapter?.id],
  );

  const activeWorld = worldSettings.find((s) => s.isActive) || worldSettings[0];
  const activeRules = ruleSystems.filter((r) => r.isActive);

  const handleSuggestSettings = async () => {
    if (!novelId || suggestionAbortRef.current) return;
    const controller = new AbortController();
    suggestionAbortRef.current = controller;
    setLoading(true);
    setError('');
    setStatusMessage('正在生成本章设定建议…');
    try {
      const list = await settingExpandService.suggestSettings({
        novelId,
        chapterId: chapter?.id,
        chapterTitle: chapter?.title,
        chapterOutline: chapter?.outline || chapter?.goal,
        signal: controller.signal,
      });
      throwIfAiRequestCancelled(controller.signal);
      setSuggestions(list);
      setStatusMessage(`已生成 ${list.length} 条设定建议`);
    } catch (e: unknown) {
      if (controller.signal.aborted || isAiRequestCancelled(e)) {
        setStatusMessage('已停止生成设定建议');
      } else {
        setError(describeUnknownError(e, '设定补充失败'));
        setStatusMessage('');
      }
    } finally {
      if (suggestionAbortRef.current === controller) {
        suggestionAbortRef.current = null;
        setLoading(false);
      }
    }
  };

  const handleStopSuggesting = () => {
    const controller = suggestionAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    setStatusMessage('正在停止生成设定建议…');
    controller.abort();
  };

  const handleAdoptSuggestion = async (suggestion: SettingSuggestion) => {
    if (!novelId || !suggestion.placement) return;
    const { proposal, plan } = suggestion.placement;
    setApplyingProposalId(proposal.proposalId);
    setError('');
    try {
      const result = await placementRuntimeService.apply({
        planId: plan.planId,
        operationId: plan.operationId,
        expectedPlanHash: plan.planHash,
      });
      setWorldSettings((prev) => [
        ...prev.filter((item) => item.id !== result.worldSetting.id),
        result.worldSetting,
      ]);
      setSuggestions((prev) =>
        prev.filter((item) => item.placement?.proposal.proposalId !== proposal.proposalId),
      );
    } catch (e: unknown) {
      setError(getAppErrorUserMessage(normalizeAppError(e, '安全应用设定失败')));
    } finally {
      setApplyingProposalId('');
    }
  };

  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">AI 设定补充</div>
        {loading ? (
          <button
            data-testid="setting-suggest-stop"
            className="btn btn-secondary btn-sm"
            onClick={handleStopSuggesting}
            style={{ width: '100%', marginBottom: 8 }}
          >
            停止生成
          </button>
        ) : (
          <button
            data-testid="setting-suggest"
            className="btn btn-primary btn-sm"
            onClick={handleSuggestSettings}
            disabled={!novelId}
            style={{ width: '100%', marginBottom: 8 }}
          >
            生成本章设定建议
          </button>
        )}
        {statusMessage && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            {statusMessage}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>{error}</div>
        )}
        {suggestions.map((item, index) => (
          <div
            key={item.placement?.proposal.proposalId ?? `${item.name}-${index}`}
            data-testid="setting-suggestion"
            data-setting-name={item.name}
            data-proposal-id={item.placement?.proposal.proposalId}
            data-plan-status={item.placement?.plan.status}
            className="panel-field"
            style={{
              marginBottom: 8,
              border: '1px solid var(--color-primary-light)',
              padding: 8,
              borderRadius: 6,
            }}
          >
            <div className="panel-field-label">
              {item.name}
              {item.category ? ` · ${item.category}` : ''}
            </div>
            <div
              className="panel-field-value"
              style={{ fontSize: 12, fontWeight: 400, whiteSpace: 'pre-wrap' }}
            >
              {item.rawText || item.description}
            </div>
            {item.usageInChapter && (
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--color-text-muted)' }}>
                本章用途：{item.usageInChapter}
              </div>
            )}
            {item.risk && (
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--color-warning)' }}>
                风险：{item.risk}
              </div>
            )}
            {!item.rawText && item.placement && (
              <button
                data-testid="setting-suggestion-adopt"
                className="btn btn-primary btn-sm"
                onClick={() => handleAdoptSuggestion(item)}
                disabled={Boolean(applyingProposalId)}
                style={{ marginTop: 6 }}
              >
                {applyingProposalId === item.placement.proposal.proposalId
                  ? '安全应用中...'
                  : '确认加入设定库'}
              </button>
            )}
            {!item.rawText && !item.placement && (
              <div className="text-sm text-muted" style={{ marginTop: 6 }}>
                浏览器临时候选不能写入正式设定，请在桌面版确认采用。
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">世界背景</div>
        {activeWorld ? (
          <>
            <div className="panel-field">
              <div className="panel-field-label">{activeWorld.title}</div>
              <div
                className="panel-field-value"
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {activeWorld.content.slice(0, 200)}
                {activeWorld.content.length > 200 ? '...' : ''}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-muted">尚未设置世界背景</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">规则体系</div>
        {activeRules.length > 0 ? (
          activeRules.map((r) => (
            <div key={r.id} className="panel-field" style={{ marginBottom: 8 }}>
              <div className="panel-field-label">{r.title}</div>
              <div
                className="panel-field-value"
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {r.content.slice(0, 120)}
                {r.content.length > 120 ? '...' : ''}
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-muted">尚未设置规则体系</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">主角特殊能力</div>
        {protagonist?.specialAbility ? (
          <div className="panel-field">
            <div className="panel-field-label">{protagonist.name} · 特殊能力</div>
            <div
              className="panel-field-value"
              style={{
                fontSize: 13,
                fontWeight: 400,
                color: 'var(--color-text-secondary)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {protagonist.specialAbility.slice(0, 150)}
              {protagonist.specialAbility.length > 150 ? '...' : ''}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted">尚未设置主角特殊能力</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">本章特殊限制</div>
        <div className="text-sm text-muted">
          {protagonist?.forbiddenBehaviors
            ? protagonist.forbiddenBehaviors.slice(0, 100)
            : '未设置特殊限制'}
        </div>
      </div>
    </div>
  );
}

export default SettingPanel;
