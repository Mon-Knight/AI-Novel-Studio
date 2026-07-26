import { useState, useEffect } from 'react';
import { settingRepository } from '../../../services/database/settingRepository';
import { protagonistRepository } from '../../../services/database/protagonistRepository';
import { settingExpandService, type SettingSuggestion } from '../../../services/ai/settingExpandService';
import type { WorldSetting, RuleSystem } from '../../../types/setting';
import type { Protagonist } from '../../../types/protagonist';
import type { Chapter } from '../../../types/chapter';

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
  const [error, setError] = useState('');

  useEffect(() => {
    if (novelId) {
      settingRepository.getWorldSettings(novelId).then(setWorldSettings).catch(() => {});
      settingRepository.getRuleSystems(novelId).then(setRuleSystems).catch(() => {});
      protagonistRepository.getByNovelId(novelId).then(setProtagonist).catch(() => {});
    }
  }, [novelId]);

  const activeWorld = worldSettings.find((s) => s.isActive) || worldSettings[0];
  const activeRules = ruleSystems.filter((r) => r.isActive);

  const handleSuggestSettings = async () => {
    if (!novelId) return;
    setLoading(true);
    setError('');
    try {
      const list = await settingExpandService.suggestSettings({
        novelId,
        chapterId: chapter?.id,
        chapterTitle: chapter?.title,
        chapterOutline: chapter?.outline || chapter?.goal,
      });
      setSuggestions(list);
    } catch (e: any) {
      setError(e.message || '设定补充失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdoptSuggestion = async (suggestion: SettingSuggestion) => {
    if (!novelId) return;
    const content = [
      suggestion.description,
      suggestion.usageInChapter ? `\n本章用途：${suggestion.usageInChapter}` : '',
      suggestion.risk ? `\n风险提示：${suggestion.risk}` : '',
    ].filter(Boolean).join('\n');
    const saved = await settingRepository.saveWorldSetting(null, {
      novelId,
      title: suggestion.name,
      content,
      isActive: true,
    });
    setWorldSettings((prev) => [...prev, saved]);
    setSuggestions((prev) => prev.filter((item) => item.name !== suggestion.name));
  };

  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">AI 设定补充</div>
        <button data-testid="setting-suggest" className="btn btn-primary btn-sm" onClick={handleSuggestSettings} disabled={loading || !novelId} style={{ width: '100%', marginBottom: 8 }}>
          {loading ? '生成中...' : '生成本章设定建议'}
        </button>
        {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>{error}</div>}
        {suggestions.map((item, index) => (
          <div key={`${item.name}-${index}`} data-testid="setting-suggestion" data-setting-name={item.name} className="panel-field" style={{ marginBottom: 8, border: '1px solid var(--color-primary-light)', padding: 8, borderRadius: 6 }}>
            <div className="panel-field-label">{item.name}{item.category ? ` · ${item.category}` : ''}</div>
            <div className="panel-field-value" style={{ fontSize: 12, fontWeight: 400, whiteSpace: 'pre-wrap' }}>
              {item.rawText || item.description}
            </div>
            {item.usageInChapter && <div style={{ fontSize: 11, marginTop: 4, color: 'var(--color-text-muted)' }}>本章用途：{item.usageInChapter}</div>}
            {item.risk && <div style={{ fontSize: 11, marginTop: 4, color: 'var(--color-warning)' }}>风险：{item.risk}</div>}
            {!item.rawText && (
              <button data-testid="setting-suggestion-adopt" className="btn btn-primary btn-sm" onClick={() => handleAdoptSuggestion(item)} style={{ marginTop: 6 }}>
                确认加入设定库
              </button>
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
              <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                {activeWorld.content.slice(0, 200)}{activeWorld.content.length > 200 ? '...' : ''}
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
              <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                {r.content.slice(0, 120)}{r.content.length > 120 ? '...' : ''}
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
            <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
              {protagonist.specialAbility.slice(0, 150)}{protagonist.specialAbility.length > 150 ? '...' : ''}
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
