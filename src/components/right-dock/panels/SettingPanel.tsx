import { useState, useEffect } from 'react';
import { settingRepository } from '../../../services/database/settingRepository';
import { protagonistRepository } from '../../../services/database/protagonistRepository';
import type { WorldSetting, RuleSystem } from '../../../types/setting';
import type { Protagonist } from '../../../types/protagonist';

interface SettingPanelProps {
  novelId?: string;
}

function SettingPanel({ novelId }: SettingPanelProps) {
  const [worldSettings, setWorldSettings] = useState<WorldSetting[]>([]);
  const [ruleSystems, setRuleSystems] = useState<RuleSystem[]>([]);
  const [protagonist, setProtagonist] = useState<Protagonist | null>(null);

  useEffect(() => {
    if (novelId) {
      settingRepository.getWorldSettings(novelId).then(setWorldSettings).catch(() => {});
      settingRepository.getRuleSystems(novelId).then(setRuleSystems).catch(() => {});
      protagonistRepository.getByNovelId(novelId).then(setProtagonist).catch(() => {});
    }
  }, [novelId]);

  const activeWorld = worldSettings.find((s) => s.isActive) || worldSettings[0];
  const activeRules = ruleSystems.filter((r) => r.isActive);

  return (
    <div>
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
