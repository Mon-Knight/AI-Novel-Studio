import { useRef, useState } from 'react';
import { Globe2, Pencil } from 'lucide-react';
import type { WorldSetting } from '../../types/setting';
import type { WorldRuleChange, WorldRuleChangeImpact } from '../../types/worldRules';
import { formatDate } from '../../utils/date';
import SettingEditForm, { type SettingEditInput } from './SettingEditForm';
import WorldRuleSummary from './WorldRuleSummary';

interface WorldSettingCardProps {
  novelId: string;
  settings: WorldSetting[];
  onSave: (id: string | null, data: SettingEditInput) => Promise<void>;
  onPreview: (change: WorldRuleChange) => Promise<WorldRuleChangeImpact>;
}
function WorldSettingCard({ settings, onSave, onPreview }: WorldSettingCardProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const active =
    settings.find((s) => s.id === selectedId) ?? settings.find((s) => s.isActive) ?? settings[0];
  const activeId = useRef(active?.id);
  activeId.current = active?.id;
  const close = () => {
    setEditing(false);
    editButton.current?.focus();
  };
  return (
    <div className="detail-card">
      <div className="detail-card-header">
        <div className="detail-card-title">
          <Globe2 aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>世界背景</span>
        </div>
        <button
          ref={editButton}
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="world-setting-edit"
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
          {editing ? '编辑中' : '编辑'}
        </button>
      </div>
      <p className="text-sm text-muted">
        先写大致背景，八类参数按需补充。每次确认前预览影响；不会自动改写正文或把候选当正史。
      </p>
      {settings.length > 1 && (
        <label className="panel-field-label">
          背景条目
          <select
            className="panel-select"
            value={active?.id ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {settings.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.isActive ? '' : '（停用）'}
              </option>
            ))}
          </select>
        </label>
      )}
      {!editing &&
        (active ? (
          <div>
            <div className="detail-fact-text detail-fact-text--pre">
              {active.content.slice(0, 160)}
              {active.content.length > 160 ? '…' : ''}
            </div>
            <WorldRuleSummary structuredJson={active.structuredJson} />
            <p className="text-sm text-muted">最后更新：{formatDate(active.updatedAt)}</p>
          </div>
        ) : (
          <div className="detail-empty-hint">尚未填写世界背景，点击编辑开始填写</div>
        ))}
      {settings.map((source) => (
        <SettingEditForm
          key={source.id}
          source={source}
          world
          hidden={!editing || active?.id !== source.id}
          onClose={() => {
            if (activeId.current === source.id) close();
          }}
          onSave={(data) => onSave(source.id, data)}
          onPreview={onPreview}
        />
      ))}
      <SettingEditForm
        world
        hidden={!editing || !!active}
        onClose={close}
        onSave={(data) => onSave(null, data)}
        onPreview={onPreview}
      />
    </div>
  );
}
export default WorldSettingCard;
