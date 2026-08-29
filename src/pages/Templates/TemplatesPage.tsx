/**
 * AI Novel Studio - 模板中心页面 (v1.0.27 增强版)
 */
import { useState, useEffect, useRef } from 'react';
import BackButton from '../../components/common/BackButton';
import { confirmDanger } from '../../utils/nativeDialog';
import {
  templateService,
  type UserTemplate,
  type TemplateType,
  TemplateTypeLabels,
} from '../../services/templates/templateService';
import { describeUnknownError } from '../../utils/errorMessage';
import { BuiltInTemplateList, TemplateEditorForm, UserTemplateList } from './TemplatePageSections';
import { TYPE_FILTERS } from './templateCatalog';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTemplateType(value: unknown): value is TemplateType {
  return typeof value === 'string' && value in TemplateTypeLabels;
}

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

  useEffect(() => {
    loadUserTemplates();
  }, []);

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      if (!text.trim()) throw new Error('文件内容为空');
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== 'txt' && ext !== 'md' && ext !== 'json')
        throw new Error('不支持的文件格式，仅支持 .txt、.md、.json');

      // 如果是 JSON
      if (ext === 'json') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error('JSON 解析失败，请检查文件格式');
        }

        if (!isRecord(parsed) || !parsed.content) {
          throw new Error('JSON 缺少 content 字段，模板内容不能为空');
        }

        setFormName(
          typeof parsed.name === 'string' && parsed.name.trim()
            ? parsed.name
            : file.name.replace(/\.json$/, ''),
        );
        setFormType(isTemplateType(parsed.type) ? parsed.type : 'custom');
        setFormDesc(typeof parsed.description === 'string' ? parsed.description : '');
        setFormContent(
          typeof parsed.content === 'string'
            ? parsed.content
            : JSON.stringify(parsed.content, null, 2),
        );
        setFormTags(
          Array.isArray(parsed.tags)
            ? parsed.tags.filter((tag): tag is string => typeof tag === 'string').join(', ')
            : '',
        );
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
    } catch (err: unknown) {
      setMsg('导入失败：' + describeUnknownError(err, '未知错误'));
    }

    e.target.value = '';
  };

  // 确认保存模板
  const handleSaveTemplate = async () => {
    if (!formName.trim()) {
      setMsg('请输入模板名称');
      return;
    }
    if (!formContent.trim()) {
      setMsg('模板内容不能为空');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        templateService.update(editingId, {
          name: formName.trim(),
          type: formType,
          description: formDesc.trim(),
          content: formContent,
          tags: formTags
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        });
        setMsg('模板已更新！');
      } else {
        templateService.create({
          name: formName.trim(),
          type: formType,
          description: formDesc.trim(),
          content: formContent,
          tags: formTags
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
          source: 'user_created',
        });
        setMsg('模板已保存！');
      }
      setShowForm(false);
      setEditingId(null);
      setFormName('');
      setFormType('custom');
      setFormDesc('');
      setFormContent('');
      setFormTags('');
      loadUserTemplates();
      setTimeout(() => setMsg(''), 3000);
    } catch (err: unknown) {
      setMsg('保存失败：' + describeUnknownError(err, '未知错误'));
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
    if (
      !(await confirmDanger({
        title: '删除模板',
        message: `确定删除模板「${tpl.name}」吗？\n删除后无法恢复。`,
      }))
    )
      return;
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
    <div
      style={{ padding: 32, maxWidth: 900, margin: '0 auto', height: '100%', overflowY: 'auto' }}
    >
      <BackButton label="返回工作台" to="/" />
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>
        📋 模板中心
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        提供内置创作模板，并支持上传和管理自定义模板
      </div>

      {msg && (
        <div
          style={{
            padding: '8px 16px',
            marginBottom: 16,
            background: msg.includes('失败')
              ? 'var(--color-error-bg)'
              : 'var(--color-primary-light)',
            borderRadius: 6,
            fontSize: 13,
            color: msg.includes('失败') ? 'var(--color-error-text)' : 'var(--color-primary)',
          }}
        >
          {msg}
        </div>
      )}

      {/* 操作按钮区 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setEditingId(null);
            setFormName('');
            setFormType('custom');
            setFormDesc('');
            setFormContent('');
            setFormTags('');
            setShowForm(!showForm);
          }}
        >
          {showForm ? '✕ 取消' : '➕ 新建模板'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
          📤 上传模板
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.json"
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />
      </div>

      {showForm && (
        <TemplateEditorForm
          editing={Boolean(editingId)}
          name={formName}
          type={formType}
          description={formDesc}
          tags={formTags}
          content={formContent}
          saving={saving}
          onNameChange={setFormName}
          onTypeChange={setFormType}
          onDescriptionChange={setFormDesc}
          onTagsChange={setFormTags}
          onContentChange={setFormContent}
          onSave={() => void handleSaveTemplate()}
          onCancel={() => {
            setShowForm(false);
            setEditingId(null);
          }}
        />
      )}

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TYPE_FILTERS.map((f) => (
          <button
            key={f}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {filter === '全部' || filter === '我的模板' ? (
        <UserTemplateList
          templates={userTemplates}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
          onUse={(content, title) => void handleUse(content, title)}
          onEdit={handleEditTemplate}
          onDelete={(template) => void handleDeleteTemplate(template)}
        />
      ) : null}

      {filter !== '我的模板' ? (
        <BuiltInTemplateList
          filter={filter}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
          onUse={(content, title) => void handleUse(content, title)}
        />
      ) : null}
    </div>
  );
}

export default TemplatesPage;
