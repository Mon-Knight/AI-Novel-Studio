import { useState, useEffect } from 'react';
import { confirmDanger } from '../../utils/nativeDialog';
import type { Novel, ProtagonistProfile, DualProtagonistRelation, ProtagonistMode } from '../../types/novel';
import type { WorldSetting } from '../../types/setting';
import type { RuleSystem } from '../../types/setting';
import type { Protagonist } from '../../types/protagonist';
import {
  getDefaultDualProtagonistRelation,
  getDefaultProtagonistProfile,
  normalizeDualProtagonistRelation,
  normalizeProtagonistProfile,
} from '../../features/novels/novelNormalizer';
import { formatNumber } from '../../utils/format';
import { formatDate } from '../../utils/date';

interface NovelBasicInfoCardProps {
  novel: Novel;
  onSave: (data: {
    title: string;
    subtitle: string;
    genre: string;
    description: string;
    status: string;
    targetWordCount: number;
  }) => void;
}

const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'planning', label: '规划中' },
  { value: 'writing', label: '创作中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
];

function NovelBasicInfoCard({ novel, onSave }: NovelBasicInfoCardProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(novel.title);
  const [subtitle, setSubtitle] = useState(novel.subtitle || '');
  const [genre, setGenre] = useState(novel.genre || '');
  const [description, setDescription] = useState(novel.description || '');
  const [status, setStatus] = useState(novel.status);
  const [targetWordCount, setTargetWordCount] = useState(novel.targetWordCount || 0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setTitle(novel.title);
    setSubtitle(novel.subtitle || '');
    setGenre(novel.genre || '');
    setDescription(novel.description || '');
    setStatus(novel.status);
    setTargetWordCount(novel.targetWordCount || 0);
  }, [novel]);

  const handleSave = async () => {
    if (!title.trim()) {
      setMessage('作品名称不能为空');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onSave({
        title: title.trim(),
        subtitle: subtitle.trim(),
        genre: genre.trim(),
        description: description.trim(),
        status,
        targetWordCount,
      });
      setMessage('保存成功');
      setEditing(false);
      setTimeout(() => setMessage(''), 2000);
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setTitle(novel.title);
    setSubtitle(novel.subtitle || '');
    setGenre(novel.genre || '');
    setDescription(novel.description || '');
    setStatus(novel.status);
    setTargetWordCount(novel.targetWordCount || 0);
    setEditing(false);
    setMessage('');
  };

  return (
    <div className="detail-card" style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📖</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>作品信息</span>
        </div>
        {!editing ? (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            ✏️ 编辑
          </button>
        ) : null}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="panel-field-label">作品名称 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input"
              placeholder="请输入作品名称"
              style={{ width: '100%', fontSize: 15, fontWeight: 500 }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="panel-field-label">副标题</label>
              <input
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                className="form-input"
                placeholder="可选"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label className="panel-field-label">题材</label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="form-input"
                placeholder="如：科幻、仙侠、悬疑"
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div>
            <label className="panel-field-label">简介</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-textarea"
              placeholder="简要介绍作品背景和主要情节方向"
              style={{ width: '100%', height: 100, resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="panel-field-label">作品状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Novel['status'])}
                className="panel-select"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="panel-field-label">目标总字数</label>
              <input
                type="number"
                value={targetWordCount}
                onChange={(e) => setTargetWordCount(Number(e.target.value))}
                className="form-input"
                placeholder="如：300000"
                style={{ width: '100%' }}
                min={0}
              />
            </div>
          </div>
          {message && (
            <div style={{ fontSize: 13, color: message === '保存成功' ? 'var(--color-success)' : 'var(--color-error)' }}>
              {message}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>取消</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '💾 保存'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <span className="text-sm text-muted">作品名称</span>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{novel.title}</div>
            </div>
            <div>
              <span className="text-sm text-muted">题材</span>
              <div style={{ fontSize: 15 }}>{novel.genre || '未设置'}</div>
            </div>
          </div>
          {novel.subtitle && (
            <div>
              <span className="text-sm text-muted">副标题</span>
              <div>{novel.subtitle}</div>
            </div>
          )}
          <div>
            <span className="text-sm text-muted">简介</span>
            <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              {novel.description || '暂无简介'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <span className="text-sm text-muted">状态</span>
              <div>{statusOptions.find((o) => o.value === novel.status)?.label || novel.status}</div>
            </div>
            <div>
              <span className="text-sm text-muted">目标字数</span>
              <div>{formatNumber(novel.targetWordCount || 0)} 字</div>
            </div>
            <div>
              <span className="text-sm text-muted">最后更新</span>
              <div>{formatDate(novel.updatedAt)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 世界背景卡片 ====================

interface WorldSettingCardProps {
  novelId: string;
  settings: WorldSetting[];
  onSave: (id: string | null, data: { title: string; content: string }) => Promise<void>;
}

function WorldSettingCard({ novelId, settings, onSave }: WorldSettingCardProps) {
  const activeSetting = settings.find((s) => s.isActive) || settings[0];
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(activeSetting?.title || '默认世界设定');
  const [content, setContent] = useState(activeSetting?.content || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const s = settings.find((s) => s.isActive) || settings[0];
    setTitle(s?.title || '默认世界设定');
    setContent(s?.content || '');
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await onSave(activeSetting?.id || null, { title, content });
      setMessage('保存成功');
      setEditing(false);
      setTimeout(() => setMessage(''), 2000);
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="detail-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🌍</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>世界背景</span>
        </div>
        {!editing && (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>✏️ 编辑</button>
        )}
      </div>

      <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
        这里只需要输入大致世界背景，不要求一次性填写完整世界观。后续 AI 会根据这些内容辅助整理结构化设定。
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="form-input"
            placeholder="设定标题"
            style={{ width: '100%' }}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="form-textarea"
            placeholder="描述这个世界的背景、时代、地理、社会结构等..."
            style={{ width: '100%', height: 200, resize: 'vertical', fontSize: 14, lineHeight: 1.8 }}
          />
          {message && (
            <div style={{ fontSize: 13, color: message === '保存成功' ? 'var(--color-success)' : 'var(--color-error)' }}>
              {message}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>取消</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '💾 保存'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {content ? (
            <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {content.slice(0, 300)}{content.length > 300 ? '...' : ''}
            </div>
          ) : (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 14, fontStyle: 'italic' }}>
              尚未填写世界背景，点击编辑开始填写
            </div>
          )}
          {activeSetting && (
            <div className="text-sm text-muted" style={{ marginTop: 8 }}>
              最后更新：{formatDate(activeSetting.updatedAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== 规则体系卡片 ====================

const ruleCategoryOptions = [
  { value: '', label: '不限' },
  { value: 'magic', label: '魔法' },
  { value: 'technology', label: '科技' },
  { value: 'cultivation', label: '修炼' },
  { value: 'combat', label: '战斗' },
  { value: 'social', label: '社会' },
  { value: 'other', label: '其他' },
];

interface RuleSystemCardProps {
  novelId: string;
  ruleSystems: RuleSystem[];
  onSave: (id: string | null, data: {
    title: string;
    category?: string;
    content: string;
    forbiddenRules?: string;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function RuleSystemCard({ novelId, ruleSystems, onSave, onDelete }: RuleSystemCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [forbiddenRules, setForbiddenRules] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const startNew = () => {
    setEditingId(null);
    setIsNew(true);
    setTitle('');
    setCategory('');
    setContent('');
    setForbiddenRules('');
  };

  const startEdit = (rs: RuleSystem) => {
    setEditingId(rs.id);
    setIsNew(false);
    setTitle(rs.title);
    setCategory(rs.category || '');
    setContent(rs.content);
    setForbiddenRules(rs.forbiddenRules || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsNew(false);
    setMessage('');
  };

  const handleSave = async () => {
    if (!title.trim()) { setMessage('规则名称不能为空'); return; }
    setSaving(true);
    setMessage('');
    try {
      await onSave(isNew ? null : editingId, {
        title: title.trim(),
        category: category || undefined,
        content,
        forbiddenRules: forbiddenRules || undefined,
      });
      setMessage('保存成功');
      setEditingId(null);
      setIsNew(false);
      setTimeout(() => setMessage(''), 2000);
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmDanger({ title: '删除规则', message: '确定删除此规则体系？' }))) return;
    try {
      await onDelete(id);
    } catch {
      setMessage('删除失败');
    }
  };

  return (
    <div className="detail-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>⚖️</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>规则体系</span>
        </div>
        {!editingId && !isNew && (
          <button className="btn btn-secondary btn-sm" onClick={startNew}>+ 新增规则</button>
        )}
      </div>

      <div className="text-sm text-muted" style={{ marginBottom: 12 }}>
        这里用于描述魔法、科技、修炼、战斗或社会规则。正文生成时，AI 必须遵守这些规则。
      </div>

      {/* 已有规则列表 */}
      {ruleSystems.map((rs) =>
        editingId === rs.id ? (
          <RuleEditForm
            key={rs.id}
            title={title} setTitle={setTitle}
            category={category} setCategory={setCategory}
            content={content} setContent={setContent}
            forbiddenRules={forbiddenRules} setForbiddenRules={setForbiddenRules}
            message={message} saving={saving}
            onSave={handleSave} onCancel={cancelEdit}
          />
        ) : (
          <div key={rs.id} style={{
            border: '1px solid var(--color-border-light)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 500 }}>{rs.title}</span>
                {rs.category && (
                  <span style={{
                    fontSize: 11, marginLeft: 8, padding: '1px 6px',
                    background: 'var(--color-bg-hover)', borderRadius: 4,
                    color: 'var(--color-text-muted)',
                  }}>
                    {ruleCategoryOptions.find((o) => o.value === rs.category)?.label || rs.category}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(rs)}>✏️</button>
                <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(rs.id)}
                  style={{ color: 'var(--color-error)' }}>🗑️</button>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 6, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {rs.content.slice(0, 150)}{rs.content.length > 150 ? '...' : ''}
            </div>
          </div>
        ),
      )}

      {/* 新建表单 */}
      {isNew && (
        <RuleEditForm
          title={title} setTitle={setTitle}
          category={category} setCategory={setCategory}
          content={content} setContent={setContent}
          forbiddenRules={forbiddenRules} setForbiddenRules={setForbiddenRules}
          message={message} saving={saving}
          onSave={handleSave} onCancel={cancelEdit}
        />
      )}
    </div>
  );
}

function RuleEditForm({
  title, setTitle, category, setCategory, content, setContent,
  forbiddenRules, setForbiddenRules, message, saving, onSave, onCancel,
}: {
  title: string; setTitle: (v: string) => void;
  category: string; setCategory: (v: string) => void;
  content: string; setContent: (v: string) => void;
  forbiddenRules: string; setForbiddenRules: (v: string) => void;
  message: string; saving: boolean;
  onSave: () => void; onCancel: () => void;
}) {
  return (
    <div style={{
      border: '1px solid var(--color-primary)',
      borderRadius: 8, padding: 12, marginBottom: 8,
      background: 'var(--color-primary-light)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label className="panel-field-label">规则名称 *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              className="form-input" placeholder="如：魔法体系规则" style={{ width: '100%' }} />
          </div>
          <div>
            <label className="panel-field-label">规则类别</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="panel-select">
              {ruleCategoryOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="panel-field-label">规则内容</label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)}
            className="form-textarea" placeholder="详细描述规则体系..."
            style={{ width: '100%', height: 160, resize: 'vertical', fontSize: 14, lineHeight: 1.8 }} />
        </div>
        <div>
          <label className="panel-field-label">禁止违背的内容</label>
          <textarea value={forbiddenRules} onChange={(e) => setForbiddenRules(e.target.value)}
            className="form-textarea" placeholder="列出 AI 绝对不能违反的规则..."
            style={{ width: '100%', height: 80, resize: 'vertical', fontSize: 14 }} />
        </div>
        {message && (
          <div style={{ fontSize: 13, color: message === '保存成功' ? 'var(--color-success)' : 'var(--color-error)' }}>
            {message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>取消</button>
          <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
            {saving ? '保存中...' : '💾 保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 主角设定卡片 ====================

// v1.0.28 主角关系类型标签
const RELATION_TYPE_LABELS: Record<string, string> = {
  partner: '伙伴', romance: '恋爱', rival: '竞争', bound: '绑定',
  mentor_student: '师徒', family: '亲属', enemy_to_ally: '敌对转盟友',
  parallel: '平行双线', custom: '自定义',
};
const NARRATIVE_WEIGHT_LABELS: Record<string, string> = {
  balanced: '双主角均衡', primary_main: '主角A更核心', secondary_main: '主角B更核心',
};

interface ProtagonistCardProps {
  novelId: string;
  novel: Novel | null;
  protagonist: Protagonist | null;
  onSave: (data: {
    protagonistMode: ProtagonistMode;
    protagonists: ProtagonistProfile[];
    dualProtagonistRelation?: DualProtagonistRelation;
  }) => Promise<void>;
}

function ProtagonistCard({ novelId, novel, protagonist, onSave }: ProtagonistCardProps) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // v1.0.28 双主角状态
  const [mode, setMode] = useState<'single' | 'dual'>(novel?.protagonistMode || 'single');
  const [protA, setProtA] = useState<ProtagonistProfile>(
    normalizeProtagonistProfile(novel?.protagonists?.[0], 'primary'),
  );
  const [protB, setProtB] = useState<ProtagonistProfile>(
    normalizeProtagonistProfile(novel?.protagonists?.[1], 'secondary'),
  );
  const [relation, setRelation] = useState<DualProtagonistRelation>(
    normalizeDualProtagonistRelation(novel?.dualProtagonistRelation),
  );

  useEffect(() => {
    setMode(novel?.protagonistMode || 'single');
    setProtA(normalizeProtagonistProfile(novel?.protagonists?.[0], 'primary'));
    setProtB(normalizeProtagonistProfile(novel?.protagonists?.[1], 'secondary'));
    setRelation(normalizeDualProtagonistRelation(novel?.dualProtagonistRelation));
  }, [novel]);

  // 旧数据兼容：从 protagonist 迁移到 novel.protagonists
  useEffect(() => {
    if (protagonist && (!novel?.protagonists || novel.protagonists.length === 0)) {
      setProtA({
        ...getDefaultProtagonistProfile('primary'),
        id: protagonist.id,
        label: 'primary',
        name: protagonist.name,
        identity: protagonist.identity ?? '',
        personality: protagonist.personality ?? '',
        goal: protagonist.goal ?? '',
        ability: protagonist.specialAbility ?? '',
        limitation: protagonist.abilityLimits ?? '',
        specialAbility: protagonist.specialAbility ?? '',
        abilityLimits: protagonist.abilityLimits ?? '',
        forbiddenBehaviors: protagonist.forbiddenBehaviors ?? '',
        notes: protagonist.currentState ?? '',
      });
    }
  }, [protagonist, novel]);

  const handleSave = async () => {
    setSaving(true); setMessage('');
    try {
      const primary = normalizeProtagonistProfile({ ...protA, label: 'primary' }, 'primary');
      const secondary = normalizeProtagonistProfile({ ...protB, label: 'secondary' }, 'secondary');
      const protagonists = mode === 'dual'
        ? [primary, secondary]
        : [primary];
      await onSave({
        protagonistMode: mode,
        protagonists,
        dualProtagonistRelation: mode === 'dual'
          ? normalizeDualProtagonistRelation(relation)
          : getDefaultDualProtagonistRelation(),
      });
      setMessage('保存成功');
      setEditing(false);
      setTimeout(() => setMessage(''), 2000);
    } catch (e: any) {
      setMessage('保存失败：' + (e?.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const renderProtagonistFields = (
    p: ProtagonistProfile,
    setP: (p: ProtagonistProfile) => void,
    label: string,
  ) => (
    <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--color-primary)' }}>
        {label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="panel-field-label">姓名 *</label>
          <input type="text" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })}
            className="form-input" placeholder="姓名" style={{ width: '100%' }} />
        </div>
        <div>
          <label className="panel-field-label">性别</label>
          <input type="text" value={p.gender || ''} onChange={(e) => setP({ ...p, gender: e.target.value })}
            className="form-input" placeholder="男/女" style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <div>
          <label className="panel-field-label">身份</label>
          <input type="text" value={p.identity || ''} onChange={(e) => setP({ ...p, identity: e.target.value })}
            className="form-input" placeholder="如：航天工程师" style={{ width: '100%' }} />
        </div>
        <div>
          <label className="panel-field-label">动机</label>
          <input type="text" value={p.motivation || ''} onChange={(e) => setP({ ...p, motivation: e.target.value })}
            className="form-input" placeholder="行为动机" style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="panel-field-label">性格</label>
        <textarea value={p.personality || ''} onChange={(e) => setP({ ...p, personality: e.target.value })}
          className="form-textarea" placeholder="性格特点..." rows={2} style={{ width: '100%', resize: 'vertical' }} />
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="panel-field-label">目标</label>
        <textarea value={p.goal || ''} onChange={(e) => setP({ ...p, goal: e.target.value })}
          className="form-textarea" placeholder="长期目标..." rows={2} style={{ width: '100%', resize: 'vertical' }} />
      </div>
      <div style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: 8, marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6 }}>
          ⚡ 能力与限制
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label className="panel-field-label">特殊能力</label>
            <textarea value={p.specialAbility || p.ability || ''} onChange={(e) => setP({ ...p, ability: e.target.value, specialAbility: e.target.value })}
              className="form-textarea" placeholder="特殊能力..." rows={2} style={{ width: '100%', resize: 'vertical', fontSize: 13 }} />
          </div>
          <div>
            <label className="panel-field-label">能力限制</label>
            <textarea value={p.abilityLimits || p.limitation || ''} onChange={(e) => setP({ ...p, limitation: e.target.value, abilityLimits: e.target.value })}
              className="form-textarea" placeholder="能力限制..." rows={2} style={{ width: '100%', resize: 'vertical', fontSize: 13 }} />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="panel-field-label">禁止行为</label>
          <textarea value={p.forbiddenBehaviors || ''} onChange={(e) => setP({ ...p, forbiddenBehaviors: e.target.value })}
            className="form-textarea" placeholder="绝对不能做的行为..." rows={2} style={{ width: '100%', resize: 'vertical', fontSize: 13 }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="panel-field-label">背景经历</label>
          <textarea value={p.background || ''} onChange={(e) => setP({ ...p, background: e.target.value })}
            className="form-textarea" placeholder="人物背景..." rows={2} style={{ width: '100%', resize: 'vertical', fontSize: 13 }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="panel-field-label">人物成长线</label>
          <input type="text" value={p.arc || ''} onChange={(e) => setP({ ...p, arc: e.target.value })}
            className="form-input" placeholder="角色弧光/成长方向" style={{ width: '100%', fontSize: 13 }} />
        </div>
      </div>
    </div>
  );

  const renderRelationForm = () => (
    <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 12, marginBottom: 8, background: 'var(--color-bg-primary)' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--color-primary)' }}>
        🔗 双主角关系
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="panel-field-label">关系类型</label>
          <select className="panel-select" value={relation.type} onChange={(e) => setRelation({ ...relation, type: e.target.value as any })}
            style={{ width: '100%', fontSize: 13 }}>
            {Object.entries(RELATION_TYPE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
        </div>
        <div>
          <label className="panel-field-label">叙事权重</label>
          <select className="panel-select" value={relation.narrativeWeight || 'balanced'} onChange={(e) => setRelation({ ...relation, narrativeWeight: e.target.value as any })}
            style={{ width: '100%', fontSize: 13 }}>
            {Object.entries(NARRATIVE_WEIGHT_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="panel-field-label">关系说明</label>
        <textarea value={relation.description} onChange={(e) => setRelation({ ...relation, description: e.target.value })}
          className="form-textarea" placeholder="描述两位主角之间的关系..." rows={2} style={{ width: '100%', resize: 'vertical' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <div>
          <label className="panel-field-label">核心冲突</label>
          <input type="text" value={relation.conflict || ''} onChange={(e) => setRelation({ ...relation, conflict: e.target.value })}
            className="form-input" placeholder="两人之间的主要冲突" style={{ width: '100%', fontSize: 13 }} />
        </div>
        <div>
          <label className="panel-field-label">合作方式</label>
          <input type="text" value={relation.cooperation || ''} onChange={(e) => setRelation({ ...relation, cooperation: e.target.value })}
            className="form-input" placeholder="合作模式" style={{ width: '100%', fontSize: 13 }} />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="panel-field-label">关系推进</label>
        <input type="text" value={relation.emotionalProgression || ''} onChange={(e) => setRelation({ ...relation, emotionalProgression: e.target.value })}
          className="form-input" placeholder="关系发展路线" style={{ width: '100%', fontSize: 13 }} />
      </div>
    </div>
  );

  const renderDisplay = () => {
    const prots = novel?.protagonists;
    const hasData = prots && prots.length > 0 && prots[0]?.name;
    if (!hasData) {
      return <div style={{ color: 'var(--color-text-muted)', fontSize: 14, fontStyle: 'italic' }}>尚未设定主角，点击编辑开始填写</div>;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 500 }}>
          主角模式：{novel?.protagonistMode === 'dual' ? '双主角' : '单主角'}
        </div>
        {prots!.map((p, i) => (
          <div key={p.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 6, padding: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              {p.label === 'primary' ? '⭐ 主角A' : '🌟 主角B'}：{p.name}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 13 }}>
              {p.identity && <div><span className="text-sm text-muted">身份：</span>{p.identity}</div>}
              {p.personality && <div><span className="text-sm text-muted">性格：</span>{p.personality.slice(0, 60)}{p.personality.length > 60 && '…'}</div>}
              {p.goal && <div><span className="text-sm text-muted">目标：</span>{p.goal.slice(0, 60)}{p.goal.length > 60 && '…'}</div>}
              {(p.specialAbility || p.ability) && <div style={{ gridColumn: '1 / -1' }}><span className="text-sm" style={{ color: 'var(--color-primary)' }}>⚡ {(p.specialAbility || p.ability).slice(0, 80)}{(p.specialAbility || p.ability).length > 80 && '…'}</span></div>}
            </div>
          </div>
        ))}
        {novel?.dualProtagonistRelation?.description && (
          <div style={{ border: '1px solid var(--color-primary-light)', borderRadius: 6, padding: 10, background: 'var(--color-bg-primary)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>🔗 双主角关系</div>
            <div style={{ fontSize: 13 }}>{RELATION_TYPE_LABELS[novel.dualProtagonistRelation.type] || novel.dualProtagonistRelation.type}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{novel.dualProtagonistRelation.description}</div>
            {novel.dualProtagonistRelation.conflict && <div style={{ fontSize: 12, color: 'var(--color-warning)' }}>冲突：{novel.dualProtagonistRelation.conflict}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="detail-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>👤</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>主角设定</span>
        </div>
        {!editing && (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>✏️ 编辑</button>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 主角模式选择 */}
          <div>
            <label className="panel-field-label">主角模式</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className={`btn btn-sm ${mode === 'single' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('single')}>👤 单主角</button>
              <button className={`btn btn-sm ${mode === 'dual' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('dual')}>👥 双主角</button>
            </div>
          </div>

          {/* 主角A表单 */}
          {renderProtagonistFields(protA, setProtA, '⭐ 主角A')}

          {/* 主角B表单 */}
          {mode === 'dual' && renderProtagonistFields(protB, setProtB, '🌟 主角B')}

          {/* 双主角关系 */}
          {mode === 'dual' && renderRelationForm()}

          {message && (
            <div style={{ fontSize: 13, color: message === '保存成功' ? 'var(--color-success)' : 'var(--color-error)' }}>
              {message}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setMessage(''); }}>取消</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '💾 保存'}
            </button>
          </div>
        </div>
      ) : renderDisplay()}
    </div>
  );
}

export { NovelBasicInfoCard, WorldSettingCard, RuleSystemCard, ProtagonistCard };
