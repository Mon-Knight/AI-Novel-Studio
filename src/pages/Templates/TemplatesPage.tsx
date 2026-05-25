/**
 * AI Novel Studio - 模板中心页面 (v1.0.27 增强版)
 */
import { useState, useEffect, useRef } from 'react';
import BackButton from '../../components/common/BackButton';
import { confirmDanger } from '../../utils/nativeDialog';
import { templateService, type UserTemplate, type TemplateType, TemplateTypeLabels } from '../../services/templates/templateService';

interface BuiltInTemplate {
  id: string; type: string; title: string; genre: string; description: string; content: string;
}

const BUILTIN_TEMPLATES: BuiltInTemplate[] = [
  { id: 'tpl-001', type: '作品模板', title: '玄幻长篇模板', genre: '玄幻', description: '适合东方玄幻题材的长篇架构', content: '# 玄幻长篇结构\n## 第一卷：觉醒\n- 第1-3章：主角身世之谜初现\n- 第4-6章：意外获得传承或特殊能力\n- 第7-9章：首次冲突与成长\n## 第二卷：试炼\n...' },
  { id: 'tpl-002', type: '作品模板', title: '科幻探索模板', genre: '科幻', description: '适合科幻探索题材的长篇架构', content: '# 科幻探索结构\n## 第一卷：接触\n- 第1-3章：异常现象发现\n- 第4-6章：深入调查\n- 第7-9章：首次接触与危机\n## 第二卷：真相\n...' },
  { id: 'tpl-003', type: '章节大纲', title: '战斗章节模板', genre: '通用', description: '高强度战斗章节的大纲结构', content: '# 战斗章节大纲\n## 战斗目标\n## 敌方设定\n## 战斗阶段\n1. 试探期\n2. 劣势期\n3. 转折点\n4. 反击期\n5. 战后总结' },
  { id: 'tpl-004', type: '章节大纲', title: '日常过渡模板', genre: '通用', description: '连接大事件的日常章节大纲', content: '# 日常过渡章节\n## 主线回顾\n## 角色互动\n## 信息铺垫\n## 下一章钩子' },
  { id: 'tpl-005', type: '角色模板', title: '主角设定模板', genre: '通用', description: '完整的主角设定框架', content: '# 主角设定\n## 基本信息\n- 姓名、年龄、身份\n## 性格特征\n## 特殊能力\n## 能力限制\n## 行为禁忌\n## 角色弧光' },
  { id: 'tpl-006', type: '角色模板', title: '反派设定模板', genre: '通用', description: '反派角色设定框架', content: '# 反派设定\n## 基本信息\n## 动机与目标\n## 能力与资源\n## 与主角关系\n## 行为逻辑\n## 弱点' },
  { id: 'tpl-007', type: '输出控制', title: '快节奏输出方案', genre: '通用', description: '适合快节奏故事的输出控制', content: '{ "paceLevel": "fast", "dialogueRatio": 0.4, "descriptionRatio": 0.2, "endingHookRequired": true, "targetWordCount": 3500 }' },
  { id: 'tpl-008', type: '输出控制', title: '厚重输出方案', genre: '通用', description: '适合史诗厚重风格的输出控制', content: '{ "paceLevel": "slow", "dialogueRatio": 0.25, "descriptionRatio": 0.45, "endingHookRequired": false, "targetWordCount": 5500 }' },
];

const TYPE_FILTERS = ['全部', '系统内置', '我的模板', '作品模板', '章节大纲', '角色模板', '输出控制'];
const TEMPLATE_TYPES: { value: TemplateType; label: string }[] = Object.entries(TemplateTypeLabels).map(([value, label]) => ({ value: value as TemplateType, label }));

function TemplatesPage() {
  const [filter, setFilter] = useState('全部');
  const [msg, setMsg] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // v1.0.27 用户自定义模板
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([]);

  // 新建/编辑表单
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<TemplateType>('custom');
  const [formDesc, setFormDesc] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formTags, setFormTags] = useState('');
  const [saving, setSaving] = useState(false);

  const loadUserTemplates = () => {
    setUserTemplates(templateService.getAll());
  };

  useEffect(() => { loadUserTemplates(); }, []);

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      if (!text.trim()) throw new Error('文件内容为空');
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== 'txt' && ext !== 'md' && ext !== 'json') throw new Error('不支持的文件格式，仅支持 .txt、.md、.json');

      // 如果是 JSON
      if (ext === 'json') {
        let parsed: any;
        try { parsed = JSON.parse(text); }
        catch { throw new Error('JSON 解析失败，请检查文件格式'); }

        if (!parsed.content) throw new Error('JSON 缺少 content 字段，模板内容不能为空');

        setFormName(parsed.name || file.name.replace(/\.json$/, ''));
        setFormType(parsed.type || 'custom');
        setFormDesc(parsed.description || '');
        setFormContent(typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content, null, 2));
        setFormTags(Array.isArray(parsed.tags) ? parsed.tags.join(', ') : '');
      } else {
        // TXT / MD
        setFormName(file.name.replace(/\.(txt|md)$/i, ''));
        setFormType('custom');
        setFormDesc('');
        setFormContent(text);
        setFormTags('');
      }

      setEditingId(null);
      setShowForm(true);
      setMsg(`已加载文件「${file.name}」，请确认并保存。`);

    } catch (err: any) {
      setMsg('导入失败：' + (err?.message || '未知错误'));
    }

    e.target.value = '';
  };

  // 确认保存模板
  const handleSaveTemplate = async () => {
    if (!formName.trim()) { setMsg('请输入模板名称'); return; }
    if (!formContent.trim()) { setMsg('模板内容不能为空'); return; }

    setSaving(true);
    try {
      if (editingId) {
        templateService.update(editingId, {
          name: formName.trim(),
          type: formType,
          description: formDesc.trim(),
          content: formContent,
          tags: formTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        });
        setMsg('模板已更新！');
      } else {
        templateService.create({
          name: formName.trim(),
          type: formType,
          description: formDesc.trim(),
          content: formContent,
          tags: formTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
          source: 'user_created',
        });
        setMsg('模板已保存！');
      }
      setShowForm(false);
      setEditingId(null);
      setFormName(''); setFormType('custom'); setFormDesc(''); setFormContent(''); setFormTags('');
      loadUserTemplates();
      setTimeout(() => setMsg(''), 3000);
    } catch (err: any) {
      setMsg('保存失败：' + (err?.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  // 编辑模板
  const handleEditTemplate = (tpl: UserTemplate) => {
    setEditingId(tpl.id);
    setFormName(tpl.name);
    setFormType(tpl.type);
    setFormDesc(tpl.description);
    setFormContent(tpl.content);
    setFormTags(tpl.tags.join(', '));
    setShowForm(true);
    setMsg('');
  };

  // 删除模板
  const handleDeleteTemplate = async (tpl: UserTemplate) => {
    if (!(await confirmDanger({ title: '删除模板', message: `确定删除模板「${tpl.name}」吗？\n删除后无法恢复。` }))) return;
    templateService.remove(tpl.id);
    loadUserTemplates();
    setMsg(`已删除模板「${tpl.name}」`);
    setTimeout(() => setMsg(''), 3000);
  };

  // 复制使用
  const handleUse = async (content: string, title: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setMsg(`「${title}」内容已复制到剪贴板`);
      setTimeout(() => setMsg(''), 3000);
    } catch {
      setMsg('复制失败，请手动复制下方内容');
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <BackButton label="返回首页" to="/" />
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>📋 模板中心</div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>提供内置创作模板，并支持上传和管理自定义模板</div>

      {msg && <div style={{ padding: '8px 16px', marginBottom: 16, background: msg.includes('失败') ? '#ffebee' : 'var(--color-primary-light)', borderRadius: 6, fontSize: 13, color: msg.includes('失败') ? '#c62828' : 'var(--color-primary)' }}>{msg}</div>}

      {/* 操作按钮区 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditingId(null); setFormName(''); setFormType('custom'); setFormDesc(''); setFormContent(''); setFormTags(''); setShowForm(!showForm); }}>
          {showForm ? '✕ 取消' : '➕ 新建模板'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
          📤 上传模板
        </button>
        <input ref={fileInputRef} type="file" accept=".txt,.md,.json" onChange={handleFileUpload} style={{ display: 'none' }} />
      </div>

      {/* 新建/编辑表单 */}
      {showForm && (
        <div className="detail-card" style={{ marginBottom: 16, borderColor: 'var(--color-primary)' }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>{editingId ? '✏️ 编辑模板' : '➕ 新建模板'}</div>
          <div className="panel-field" style={{ marginBottom: 8 }}>
            <div className="panel-field-label">模板名称</div>
            <input className="form-input" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="输入模板名称" style={{ width: '100%', fontSize: 13 }} />
          </div>
          <div className="panel-field" style={{ marginBottom: 8 }}>
            <div className="panel-field-label">模板类型</div>
            <select className="panel-select" value={formType} onChange={(e) => setFormType(e.target.value as TemplateType)} style={{ fontSize: 13, width: '100%' }}>
              {TEMPLATE_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
          </div>
          <div className="panel-field" style={{ marginBottom: 8 }}>
            <div className="panel-field-label">说明</div>
            <input className="form-input" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="简要说明（可选）" style={{ width: '100%', fontSize: 13 }} />
          </div>
          <div className="panel-field" style={{ marginBottom: 8 }}>
            <div className="panel-field-label">标签（逗号分隔）</div>
            <input className="form-input" value={formTags} onChange={(e) => setFormTags(e.target.value)} placeholder="例如：修仙, 大纲, 快节奏" style={{ width: '100%', fontSize: 13 }} />
          </div>
          <div className="panel-field" style={{ marginBottom: 12 }}>
            <div className="panel-field-label">模板正文</div>
            <textarea className="form-textarea" value={formContent} onChange={(e) => setFormContent(e.target.value)} placeholder="在此输入模板内容..." rows={8} style={{ width: '100%', resize: 'vertical', fontSize: 13, fontFamily: 'monospace' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveTemplate} disabled={saving}>{saving ? '保存中...' : '💾 保存模板'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowForm(false); setEditingId(null); }}>取消</button>
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TYPE_FILTERS.map((f) => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {/* 我的模板列表 */}
      {filter === '全部' || filter === '我的模板' ? (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>📁 我的模板（{userTemplates.length}）</div>
          {userTemplates.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: 16, textAlign: 'center' }}>
              还没有自定义模板，点击「新建模板」或「上传模板」开始
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {userTemplates.map((tpl) => (
                <div key={tpl.id} className="detail-card" style={{ cursor: 'pointer', borderColor: 'var(--color-primary-light)' }} onClick={() => setExpandedId(expandedId === tpl.id ? null : tpl.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>{TemplateTypeLabels[tpl.type]}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{tpl.source === 'user_imported' ? '📤 导入' : '✏️ 自建'}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{tpl.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{tpl.description || tpl.content.slice(0, 60)}{(tpl.content.length > 60 && !tpl.description) && '...'}</div>
                  {tpl.tags.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>{tpl.tags.map((tag, i) => (<span key={i} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 2, background: 'var(--color-bg-primary)', color: 'var(--color-text-muted)' }}>{tag}</span>))}</div>}
                  {expandedId === tpl.id && (
                    <div style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--color-bg-primary)', padding: 8, borderRadius: 4, marginBottom: 8, maxHeight: 200, overflowY: 'auto', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                      {tpl.content}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); handleUse(tpl.content, tpl.name); }}>📋 使用</button>
                    <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); handleEditTemplate(tpl); }}>✏️ 编辑</button>
                    <button className="btn btn-text btn-sm" style={{ color: 'var(--color-error)' }} onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl); }}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* 系统内置模板 */}
      {filter !== '我的模板' ? (
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>🏷️ 系统内置模板</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {BUILTIN_TEMPLATES.filter((t) => filter === '全部' || filter === '系统内置' || t.type === filter).map((tpl) => (
              <div key={tpl.id} className="detail-card" style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === tpl.id ? null : tpl.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--color-bg-primary)', color: 'var(--color-text-muted)', marginRight: 6 }}>{tpl.type}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{tpl.genre}</span>
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{tpl.title}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{tpl.description}</div>
                {expandedId === tpl.id && (
                  <div style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--color-bg-primary)', padding: 8, borderRadius: 4, marginBottom: 8, maxHeight: 200, overflowY: 'auto', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                    {tpl.content}
                  </div>
                )}
                <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); handleUse(tpl.content, tpl.title); }} style={{ width: '100%' }}>
                  📋 使用模板
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default TemplatesPage;
