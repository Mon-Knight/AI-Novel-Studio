import type { Novel } from '../../types/novel';
import { Link2, UserRound, Zap } from 'lucide-react';
import { RELATION_TYPE_LABELS } from './protagonistPresentation';

interface ProtagonistDisplayProps {
  novel: Novel | null;
}

export default function ProtagonistDisplay({ novel }: ProtagonistDisplayProps) {
  const protagonists = novel?.protagonists;
  if (!protagonists?.length || !protagonists[0]?.name) {
    return <div className="detail-empty-hint">尚未设定主角，点击编辑开始填写</div>;
  }
  return (
    <div className="detail-form detail-form--compact">
      <div className="detail-badge">
        主角模式：{novel?.protagonistMode === 'dual' ? '双主角' : '单主角'}
      </div>
      {protagonists.map((profile) => (
        <div key={profile.id} className="detail-list-item detail-list-item--sm">
          <div className="detail-subsection-title detail-subsection-title--md detail-subsection-title--tight">
            <UserRound aria-hidden="true" size={14} strokeWidth={1.8} />
            {profile.label === 'primary' ? '主角 A' : '主角 B'}：{profile.name}
          </div>
          <div className="detail-fact-grid">
            {profile.identity && (
              <div>
                <span className="text-sm text-muted">身份：</span>
                {profile.identity}
              </div>
            )}
            {profile.personality && (
              <div>
                <span className="text-sm text-muted">性格：</span>
                {profile.personality.slice(0, 60)}
                {profile.personality.length > 60 && '…'}
              </div>
            )}
            {profile.goal && (
              <div>
                <span className="text-sm text-muted">目标：</span>
                {profile.goal.slice(0, 60)}
                {profile.goal.length > 60 && '…'}
              </div>
            )}
            {(profile.specialAbility || profile.ability) && (
              <div className="detail-span-full">
                <span className="text-sm detail-badge">
                  <Zap aria-hidden="true" size={13} strokeWidth={1.8} />
                  {(profile.specialAbility || profile.ability).slice(0, 80)}
                  {(profile.specialAbility || profile.ability).length > 80 && '…'}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
      {novel?.dualProtagonistRelation?.description && (
        <div className="detail-list-item detail-list-item--sm detail-list-item--inset">
          <div className="detail-subsection-title detail-subsection-title--tight">
            <Link2 aria-hidden="true" size={13} strokeWidth={1.8} />
            双主角关系
          </div>
          <div className="detail-text-sm">
            {RELATION_TYPE_LABELS[novel.dualProtagonistRelation.type] ||
              novel.dualProtagonistRelation.type}
          </div>
          <div className="detail-text-sm text-secondary">
            {novel.dualProtagonistRelation.description}
          </div>
          {novel.dualProtagonistRelation.conflict && (
            <div className="detail-warning-text">
              冲突：{novel.dualProtagonistRelation.conflict}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
