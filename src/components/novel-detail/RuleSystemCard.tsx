import { useRef, useState } from 'react';
import { Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import type { RuleSystem } from '../../types/setting';
import { RuleCategoryLabels } from '../../types/setting';
import type { WorldRuleChange, WorldRuleChangeImpact } from '../../types/worldRules';
import SettingEditForm, { type SettingEditInput } from './SettingEditForm';
import WorldRuleSummary from './WorldRuleSummary';

interface RuleSystemCardProps {
  novelId: string;
  ruleSystems: RuleSystem[];
  onSave: (id: string | null, data: SettingEditInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPreview: (change: WorldRuleChange) => Promise<WorldRuleChangeImpact>;
}
function RuleSystemCard({ ruleSystems, onSave, onDelete, onPreview }: RuleSystemCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const activeEditor = useRef(editingId);
  activeEditor.current = editingId;
  const addButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setEditingId(null);
    (trigger.current ?? addButton.current)?.focus();
  };
  const handleDelete = (id: string) => {
    setEditingId(id);
    setMessage('在编辑区取消“启用此条”，再预览影响并确认保存。停用保留历史来源与正文。');
  };
  return (
    <div className="detail-card">
      <div className="detail-card-header">
        <div className="detail-card-title">
          <Scale aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>规则体系</span>
        </div>
        <button
          ref={addButton}
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="rule-system-add"
          onClick={(e) => {
            trigger.current = e.currentTarget;
            setEditingId('new');
          }}
        >
          <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
          新增规则
        </button>
      </div>
      <p className="text-sm text-muted">
        区分世界事实、因果规则、社会规范、角色信念、作者约束与叙事偏好。约束强度不等于事实可信度；未知或不适用可保留。
      </p>
      {message && <p role="status">{message}</p>}
      {ruleSystems.map((source) => (
        <div key={source.id} className="detail-list-item">
          <div className="detail-list-item-header">
            <div>
              <span className="detail-list-item-title">{source.title}</span>
              {source.category && (
                <span className="detail-tag">
                  {RuleCategoryLabels[source.category] ?? source.category}
                </span>
              )}
              {!source.isActive && <span className="detail-tag">停用</span>}
            </div>
            <div className="detail-inline-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="rule-system-edit"
                data-rule-id={source.id}
                aria-label={'编辑规则 ' + source.title}
                onClick={(e) => {
                  trigger.current = e.currentTarget;
                  setEditingId(source.id);
                }}
              >
                <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleDelete(source.id)}
                disabled={!source.isActive}
              >
                停用
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label={'删除规则 ' + source.title}
                onClick={() => {
                  void onDelete(source.id).catch((error) =>
                    setMessage(error instanceof Error ? error.message : '删除预览失败'),
                  );
                }}
              >
                <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          {editingId !== source.id && (
            <>
              <div className="detail-fact-text detail-fact-text--sm">
                {source.content.slice(0, 120)}
                {source.content.length > 120 ? '…' : ''}
              </div>
              <WorldRuleSummary structuredJson={source.structuredJson} />
            </>
          )}
          <SettingEditForm
            source={source}
            world={false}
            hidden={editingId !== source.id}
            onClose={() => {
              if (activeEditor.current === source.id) close();
            }}
            onSave={(data) => onSave(source.id, data)}
            onPreview={onPreview}
          />
        </div>
      ))}
      {!ruleSystems.length && editingId !== 'new' && (
        <div className="detail-empty-hint">尚未添加规则体系，点击上方“新增规则”开始创建</div>
      )}
      <SettingEditForm
        world={false}
        hidden={editingId !== 'new'}
        onClose={() => {
          if (activeEditor.current === 'new') close();
        }}
        onSave={(data) => onSave(null, data)}
        onPreview={onPreview}
      />
    </div>
  );
}
export default RuleSystemCard;
