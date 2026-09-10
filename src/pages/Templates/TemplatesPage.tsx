/**
 * AI Novel Studio - 模板中心页面
 * 统一风格方案管理 UI 结构设计
 */
import { useState, useEffect, useRef } from 'react';
import { ClipboardList, Plus, Upload, X } from 'lucide-react';
import BackButton from '../../components/common/BackButton';
import { PageHeader, PageLayout, PageTabs } from '../../components/common/PageLayout';
import { confirmDanger } from '../../utils/nativeDialog';
import {
  templateService,
  type UserTemplate,
  type TemplateType,
  TemplateTypeLabels,
} from '../../services/templates/templateService';
import { describeUnknownError } from '../../utils/errorMessage';
import { BUILTIN_TEMPLATES, type BuiltInTemplate } from './templateCatalog';
import { BuiltInTemplateCard, TemplateEditorForm, UserTemplateCard } from './TemplatePageSections';

type TemplateTabKey = 'all' | 'builtin' | 'user' | 'novel' | 'chapter' | 'character' | 'output';

interface TemplateTabItem {
  key: TemplateTabKey;
  label: string;
}

const TEMPLATE_TABS: TemplateTabItem[] = [
  { key: 'all', label: '全部' },
  { key: 'builtin', label: '系统内置' },
  { key: 'user', label: '我的模板' },
  { key: 'novel', label: '作品架构' },
  { key: 'chapter', label: '章节大纲' },
  { key: 'character', label: '角色设定' },
  { key: 'output', label: '输出控制' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTemplateType(value: unknown): value is TemplateType {
  return typeof value === 'string' && value in TemplateTypeLabels;
}

function TemplatesPage() {
  const [activeTab, setActiveTab] = useState<TemplateTabKey>('all');
  const [msg, setMsg] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([]);

  // 表单状态
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<TemplateType>('custom');
  const [formDesc, setFormDesc] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formTags, setFormTags] = useState('');
  const [saving, setSaving] = useState(false);

  const loadUserTemplates = async () => {
    try {
      setUserTemplates(await templateService.getAll());
    } catch (err: unknown) {
      flash('模板读取失败：' + describeUnknownError(err, '未知错误'));
    }
  };

  useEffect(() => {
    let active = true;
    templateService
      .getAll()
      .then((items) => {
        if (active) setUserTemplates(items);
      })
      .catch((err: unknown) => {
        if (active) setMsg('模板读取失败：' + describeUnknownError(err, '未知错误'));
      });
    return () => {
      active = false;
    };
  }, []);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 3000);
  };

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      if (!text.trim()) throw new Error('文件内容为空');
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== 'txt' && ext !== 'md' && ext !== 'json') {
        throw new Error('不支持的文件格式，仅支持 .txt、.md、.json');
      }

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
        setFormName(file.name.replace(/\.(txt|md)$/i, ''));
        setFormType('custom');
        setFormDesc('');
        setFormContent(text);
        setFormTags('');
      }

      setEditingId(null);
      setShowForm(true);
      flash(`已加载文件「${file.name}」，请确认并保存。`);
    } catch (err: unknown) {
      flash('导入失败：' + describeUnknownError(err, '未知错误'));
    }

    e.target.value = '';
  };

  // 确认保存模板
  const handleSaveTemplate = async () => {
    if (!formName.trim()) {
      flash('请输入模板名称');
      return;
    }
    if (!formContent.trim()) {
      flash('模板内容不能为空');
      return;
    }

    setSaving(true);
    try {
      const parsedTags = formTags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);

      if (editingId) {
        await templateService.update(editingId, {
          name: formName.trim(),
          type: formType,
          description: formDesc.trim(),
          content: formContent,
          tags: parsedTags,
        });
        flash('模板已更新！');
      } else {
        await templateService.create({
          name: formName.trim(),
          type: formType,
          description: formDesc.trim(),
          content: formContent,
          tags: parsedTags,
          source: 'user_created',
        });
        flash('模板已保存！');
      }
      setShowForm(false);
      setEditingId(null);
      setFormName('');
      setFormType('custom');
      setFormDesc('');
      setFormContent('');
      setFormTags('');
      await loadUserTemplates();
    } catch (err: unknown) {
      flash('保存失败：' + describeUnknownError(err, '未知错误'));
    } finally {
      setSaving(false);
    }
  };

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

  const handleDeleteTemplate = async (tpl: UserTemplate) => {
    if (
      !(await confirmDanger({
        title: '删除模板',
        message: `确定删除模板「${tpl.name}」吗？\n删除后无法恢复。`,
      }))
    ) {
      return;
    }
    try {
      await templateService.remove(tpl.id);
      await loadUserTemplates();
      flash(`已删除模板「${tpl.name}」`);
    } catch (err: unknown) {
      flash('删除失败：' + describeUnknownError(err, '未知错误'));
    }
  };

  const handleUse = async (content: string, title: string) => {
    try {
      await navigator.clipboard.writeText(content);
      flash(`「${title}」内容已复制到剪贴板`);
    } catch {
      flash('复制失败，请手动展开后复制内容');
    }
  };

  // 筛选内置模板与用户模板
  const filterBuiltin = (t: BuiltInTemplate) => {
    if (activeTab === 'all' || activeTab === 'builtin') return true;
    if (activeTab === 'novel') return t.type === '作品模板';
    if (activeTab === 'chapter') return t.type === '章节大纲';
    if (activeTab === 'character') return t.type === '角色模板';
    if (activeTab === 'output') return t.type === '输出控制';
    return false;
  };

  const filterUser = (t: UserTemplate) => {
    if (activeTab === 'all' || activeTab === 'user') return true;
    if (activeTab === 'novel') {
      return (
        t.type === 'novel_setting' || t.type === 'novel_outline' || t.type === 'volume_outline'
      );
    }
    if (activeTab === 'chapter') {
      return t.type === 'chapter_outline' || t.type === 'chapter_content';
    }
    if (activeTab === 'character') return t.type === 'character';
    if (activeTab === 'output') return t.type === 'output_control';
    return false;
  };

  const visibleBuiltins = activeTab === 'user' ? [] : BUILTIN_TEMPLATES.filter(filterBuiltin);
  const visibleUsers = activeTab === 'builtin' ? [] : userTemplates.filter(filterUser);

  // 计算各分类计数
  const getTabCount = (key: TemplateTabKey): number => {
    if (key === 'all') return BUILTIN_TEMPLATES.length + userTemplates.length;
    if (key === 'builtin') return BUILTIN_TEMPLATES.length;
    if (key === 'user') return userTemplates.length;
    if (key === 'novel') {
      return (
        BUILTIN_TEMPLATES.filter((t) => t.type === '作品模板').length +
        userTemplates.filter(
          (t) =>
            t.type === 'novel_setting' || t.type === 'novel_outline' || t.type === 'volume_outline',
        ).length
      );
    }
    if (key === 'chapter') {
      return (
        BUILTIN_TEMPLATES.filter((t) => t.type === '章节大纲').length +
        userTemplates.filter((t) => t.type === 'chapter_outline' || t.type === 'chapter_content')
          .length
      );
    }
    if (key === 'character') {
      return (
        BUILTIN_TEMPLATES.filter((t) => t.type === '角色模板').length +
        userTemplates.filter((t) => t.type === 'character').length
      );
    }
    if (key === 'output') {
      return (
        BUILTIN_TEMPLATES.filter((t) => t.type === '输出控制').length +
        userTemplates.filter((t) => t.type === 'output_control').length
      );
    }
    return 0;
  };

  const pageActions = (
    <div className="resource-row resource-row--wrap">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => {
          if (showForm && !editingId) {
            setShowForm(false);
          } else {
            setEditingId(null);
            setFormName('');
            setFormType('custom');
            setFormDesc('');
            setFormContent('');
            setFormTags('');
            setShowForm(true);
          }
        }}
      >
        {showForm && !editingId ? (
          <>
            <X aria-hidden="true" size={15} strokeWidth={1.8} />
            取消创建
          </>
        ) : (
          <>
            <Plus aria-hidden="true" size={15} strokeWidth={1.8} />
            新建模板
          </>
        )}
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload aria-hidden="true" size={15} strokeWidth={1.8} />
        上传模板
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.json"
        onChange={handleFileUpload}
        hidden
      />
    </div>
  );
  return (
    <PageLayout>
      <BackButton label="返回工作台" to="/" />
      <PageHeader
        title="模板中心"
        description="提供内置创作模板，并支持上传、管理与复用自定义创作架构。"
        icon={ClipboardList}
        actions={pageActions}
      />

      {msg && (
        <div
          className={`resource-notice ${
            msg.includes('失败') ? 'resource-notice--error' : 'resource-notice--success'
          }`}
          role={msg.includes('失败') ? 'alert' : 'status'}
        >
          {msg}
        </div>
      )}

      <PageTabs<TemplateTabKey>
        label="模板分类"
        value={activeTab}
        onChange={setActiveTab}
        items={TEMPLATE_TABS.map((item) => ({
          value: item.key,
          label: item.label,
          count: getTabCount(item.key),
        }))}
      >
        {/* 新建/编辑模板表单 */}
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

        {/* 模板卡片网格 */}
        {visibleUsers.length === 0 && visibleBuiltins.length === 0 ? (
          <div className="resource-empty">
            该分类下暂无模板，可点击上方「新建模板」或「上传模板」快速添加。
          </div>
        ) : (
          <div className="resource-grid">
            {visibleUsers.map((template) => (
              <UserTemplateCard
                key={template.id}
                template={template}
                expanded={expandedId === template.id}
                onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                onUse={(content, title) => void handleUse(content, title)}
                onEdit={handleEditTemplate}
                onDelete={(templateToDelete) => void handleDeleteTemplate(templateToDelete)}
              />
            ))}
            {visibleBuiltins.map((template) => (
              <BuiltInTemplateCard
                key={template.id}
                template={template}
                expanded={expandedId === template.id}
                onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                onUse={(content, title) => void handleUse(content, title)}
              />
            ))}
          </div>
        )}
      </PageTabs>
    </PageLayout>
  );
}

export default TemplatesPage;
