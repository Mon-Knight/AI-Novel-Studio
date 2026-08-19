import { useMemo, useState, type FormEvent } from 'react';
import type {
  FactionAsset,
  LocationAsset,
  PrepareContentTargetInput,
} from '../../types/contentTransaction';

type AssetMode = 'faction' | 'location' | 'faction_relation' | 'location_link';

interface StoryAssetFormsProps {
  factions: FactionAsset[];
  locations: LocationAsset[];
  busy: boolean;
  createId(prefix: string): string;
  onPrepare(targets: PrepareContentTargetInput[]): Promise<void>;
}

export default function StoryAssetForms({
  factions,
  locations,
  busy,
  createId,
  onPrepare,
}: StoryAssetFormsProps) {
  const [mode, setMode] = useState<AssetMode>('faction');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [description, setDescription] = useState('');
  const [goals, setGoals] = useState('');
  const [parentLocationId, setParentLocationId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [relationType, setRelationType] = useState('');
  const relationMode = mode === 'faction_relation' || mode === 'location_link';
  const relationOptions = mode === 'faction_relation' ? factions : locations;
  const canSubmit = useMemo(() => {
    if (relationMode)
      return Boolean(sourceId && targetId && sourceId !== targetId && relationType.trim());
    return Boolean(name.trim());
  }, [name, relationMode, relationType, sourceId, targetId]);

  const reset = () => {
    setName('');
    setKind('');
    setDescription('');
    setGoals('');
    setParentLocationId('');
    setSourceId('');
    setTargetId('');
    setRelationType('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    let target: PrepareContentTargetInput;
    if (mode === 'faction') {
      target = {
        targetType: mode,
        targetId: createId('faction'),
        effectType: 'create',
        payload: {
          name: name.trim(),
          kind: kind.trim(),
          description: description.trim(),
          goals: goals.trim(),
        },
      };
    } else if (mode === 'location') {
      target = {
        targetType: mode,
        targetId: createId('location'),
        effectType: 'create',
        payload: {
          name: name.trim(),
          kind: kind.trim(),
          description: description.trim(),
          parentLocationId: parentLocationId || undefined,
        },
      };
    } else {
      target = {
        targetType: mode,
        targetId: createId(mode),
        effectType: 'create',
        payload:
          mode === 'faction_relation'
            ? {
                sourceFactionId: sourceId,
                targetFactionId: targetId,
                relationType: relationType.trim(),
                description: description.trim(),
              }
            : {
                sourceLocationId: sourceId,
                targetLocationId: targetId,
                linkType: relationType.trim(),
                description: description.trim(),
              },
      };
    }
    await onPrepare([target]);
    reset();
  };

  return (
    <section className="story-assets-card">
      <div className="story-assets-tabs" role="tablist" aria-label="正式资产类型">
        {(
          [
            ['faction', '势力'],
            ['location', '地点'],
            ['faction_relation', '势力关系'],
            ['location_link', '地点连接'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={mode === id ? 'active' : ''}
            onClick={() => {
              setMode(id);
              reset();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form className="story-assets-form" onSubmit={submit}>
        {relationMode ? (
          <>
            <label>
              起点
              <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                <option value="">请选择</option>
                {relationOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              终点
              <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">请选择</option>
                {relationOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {mode === 'faction_relation' ? '关系类型' : '连接类型'}
              <input
                value={relationType}
                onChange={(event) => setRelationType(event.target.value)}
                placeholder="盟友 / 敌对 / 航线 / 密道"
              />
            </label>
          </>
        ) : (
          <>
            <label>
              名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={240}
              />
            </label>
            <label>
              类型
              <input
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                maxLength={120}
              />
            </label>
            {mode === 'faction' && (
              <label>
                目标
                <input value={goals} onChange={(event) => setGoals(event.target.value)} />
              </label>
            )}
            {mode === 'location' && (
              <label>
                上级地点
                <select
                  value={parentLocationId}
                  onChange={(event) => setParentLocationId(event.target.value)}
                >
                  <option value="">无</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <label className="story-assets-form-wide">
          描述
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
          />
        </label>
        <div className="story-assets-form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !canSubmit}>
            生成待审阅候选
          </button>
        </div>
      </form>
    </section>
  );
}
