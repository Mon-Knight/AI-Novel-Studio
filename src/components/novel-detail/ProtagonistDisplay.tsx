import type { Novel } from '../../types/novel';
import { Link2, UserRound, Zap } from 'lucide-react';
import { RELATION_TYPE_LABELS } from './protagonistPresentation';

interface ProtagonistDisplayProps {
  novel: Novel | null;
}

export default function ProtagonistDisplay({ novel }: ProtagonistDisplayProps) {
  const protagonists = novel?.protagonists;
  if (!protagonists?.length || !protagonists[0]?.name) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: 14, fontStyle: 'italic' }}>
        尚未设定主角，点击编辑开始填写
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 500 }}>
        主角模式：{novel?.protagonistMode === 'dual' ? '双主角' : '单主角'}
      </div>
      {protagonists.map((profile) => (
        <div
          key={profile.id}
          style={{ border: '1px solid var(--color-border-light)', borderRadius: 6, padding: 10 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontWeight: 600,
              fontSize: 14,
              marginBottom: 4,
            }}
          >
            <UserRound aria-hidden="true" size={14} strokeWidth={1.8} />
            {profile.label === 'primary' ? '主角 A' : '主角 B'}：{profile.name}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 13 }}>
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
              <div style={{ gridColumn: '1 / -1' }}>
                <span
                  className="text-sm"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--color-primary)',
                  }}
                >
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
        <div
          style={{
            border: '1px solid var(--color-primary-light)',
            borderRadius: 6,
            padding: 10,
            background: 'var(--color-bg-primary)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontWeight: 600,
              fontSize: 13,
              marginBottom: 4,
            }}
          >
            <Link2 aria-hidden="true" size={13} strokeWidth={1.8} />
            双主角关系
          </div>
          <div style={{ fontSize: 13 }}>
            {RELATION_TYPE_LABELS[novel.dualProtagonistRelation.type] ||
              novel.dualProtagonistRelation.type}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {novel.dualProtagonistRelation.description}
          </div>
          {novel.dualProtagonistRelation.conflict && (
            <div style={{ fontSize: 12, color: 'var(--color-warning)' }}>
              冲突：{novel.dualProtagonistRelation.conflict}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
