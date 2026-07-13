/**
 * AI Novel Studio - 大纲编辑器组件
 * 支持：手动编辑、AI 生成、保存、版本管理、设置为采用版本
 */
import { useState, useEffect, useCallback } from 'react';
import { runWithLoading } from '../../lib/runWithLoading';
import {
  masterOutlineService, volumeOutlineService, chapterOutlineService,
} from '../../services/outlines/outlineService';
import type { OutlineGenerationContext, OutlineType } from '../../types/outline';
import { outlineGenerateService } from '../../services/ai/outlineGenerateService';

interface OutlineEditorProps {
  projectId: string;
  outlineType: OutlineType;
  targetId?: string;       // volumeId or chapterId
  targetTitle?: string;    // display title
  targetIndex?: number;    // order index
  parentOutlineId?: string; // for chapter -> volume outline, for volume -> master outline
  onSaved?: () => void;
}

function OutlineEditor({
  projectId, outlineType, targetId, targetTitle, targetIndex, parentOutlineId, onSaved,
}: OutlineEditorProps) {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState(targetTitle || '');
  const [isDirty, setIsDirty] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<number>(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ id: string; version: number; isActive: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [context, _setContext] = useState<OutlineGenerationContext | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [backgroundMessage, setBackgroundMessage] = useState('');

  const typeLabel = outlineType === 'master' ? '总纲' : outlineType === 'volume' ? '分卷大纲' : '章节大纲';

  // 加载当前大纲
  const load = useCallback(async () => {
    setLoading(true);
    try {
      let result;
      if (outlineType === 'master') {
        result = await masterOutlineService.getActive(projectId);
      } else if (outlineType === 'volume') {
        result = await volumeOutlineService.getActive(projectId, targetId);
      } else {
        result = await chapterOutlineService.getActive(projectId, targetId);
      }
      if (result) {
        setContent(result.content);
        setTitle(result.title);
        setCurrentVersion(result.version);
        setCurrentId(result.id);
      } else {
        setContent('');
        setCurrentVersion(0);
        setCurrentId(null);
      }
      // 加载版本列表
      let versionList;
      if (outlineType === 'master') {
        versionList = await masterOutlineService.getVersions(projectId);
      } else if (outlineType === 'volume') {
        versionList = await volumeOutlineService.getVersions(projectId, targetId);
      } else {
        versionList = await chapterOutlineService.getVersions(projectId, targetId);
      }
      setVersions(versionList.map(v => ({ id: v.id, version: v.version, isActive: v.isActive })));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId, outlineType, targetId]);

  useEffect(() => { load(); }, [load]);

  // AI 生成大纲
  const handleAiGenerate = async () => {
    try {
      const created = outlineType === 'master'
        ? await outlineGenerateService.submitNovelOutline(projectId)
        : outlineType === 'volume'
          ? await outlineGenerateService.submitVolumeOutline({ novelId: projectId, volumeId: targetId, volumeTitle: targetTitle })
          : await outlineGenerateService.submitChapterOutlines({
            novelId: projectId, chapterId: targetId, chapterTitle: targetTitle, chapterCount: 6,
          });
      setBackgroundMessage(`${typeLabel}已转入后台（${created.rootTaskId.slice(0, 8)}），完成后请在任务中心审查。`);
      return;

    } catch (e: any) {
      // 错误已在弹窗显示
    }
  };

  // 保存大纲
  const handleSave = useCallback(async (saveAsNew: boolean) => {
    if (!content.trim()) return;
    try {
      await runWithLoading(
        {
          title: `正在保存${typeLabel}`,
          initialMessage: '正在写入数据库……',
          successMessage: `${typeLabel}已保存`,
          errorMessage: '保存失败',
          successAutoCloseMs: 800,
        },
        async () => {
          const contextSnapshot = context ? JSON.stringify(context).slice(0, 10000) : undefined;
          const sourceType = 'manual';

          if (outlineType === 'master') {
            const result = await masterOutlineService.save({
              projectId, title: title || '作品总纲', content,
              sourceType, contextSnapshot, saveAsNewVersion: saveAsNew,
            });
            setCurrentId(result.id);
            setCurrentVersion(result.version);
          } else if (outlineType === 'volume') {
            const result = await volumeOutlineService.save({
              projectId, masterOutlineId: parentOutlineId, volumeId: targetId,
              volumeIndex: targetIndex || 1, title: title || targetTitle || '分卷大纲', content,
              sourceType, contextSnapshot, saveAsNewVersion: saveAsNew,
            });
            setCurrentId(result.id);
            setCurrentVersion(result.version);
          } else {
            const result = await chapterOutlineService.save({
              projectId, volumeOutlineId: parentOutlineId, chapterId: targetId,
              chapterIndex: targetIndex || 1, title: title || targetTitle || '章节大纲', content,
              sourceType, contextSnapshot, saveAsNewVersion: saveAsNew,
            });
            setCurrentId(result.id);
            setCurrentVersion(result.version);
          }

          setIsDirty(false);
          await load();
          onSaved?.();
        },
      );
    } catch {
      // 错误已在弹窗显示
    }
  }, [
    content,
    context,
    load,
    onSaved,
    outlineType,
    parentOutlineId,
    projectId,
    targetId,
    targetIndex,
    targetTitle,
    title,
    typeLabel,
  ]);

  // 设为采用版本
  const handleSetActive = async () => {
    if (!currentId) return;
    try {
      if (outlineType === 'master') {
        await masterOutlineService.setActive(currentId, projectId);
      } else if (outlineType === 'volume') {
        await volumeOutlineService.setActive(currentId, projectId);
      } else {
        await chapterOutlineService.setActive(currentId, projectId);
      }
      await load();
    } catch {
      // ignore
    }
  };

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) handleSave(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, handleSave]);

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>⏳ 加载中……</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0 4px' }}>
        <span style={{ fontWeight: 600, fontSize: 15, marginRight: 8 }}>📋 {typeLabel}</span>

        <button className="btn btn-primary btn-sm" onClick={handleAiGenerate}>
          🤖 AI 生成
        </button>
        <button
          className="btn btn-sm"
          style={{ background: isDirty ? 'var(--color-warning)' : undefined, color: isDirty ? '#fff' : undefined }}
          onClick={() => handleSave(false)}
        >
          💾 保存{isDirty ? ' *' : ''}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => handleSave(true)}>
          📑 保存为新版本
        </button>
        {currentId && (
          <button className="btn btn-secondary btn-sm" onClick={handleSetActive}>
            ✅ 设为采用版本
          </button>
        )}
        {context && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowContext(!showContext)}>
            📊 上下文
          </button>
        )}

        {versions.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            v{currentVersion} · {versions.length} 个版本
          </span>
        )}
      </div>
      {backgroundMessage && (
        <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--color-success)', background: '#ecfdf5', borderRadius: 6 }}>
          {backgroundMessage}
        </div>
      )}

      {/* 上下文摘要 */}
      {showContext && context && (
        <div style={{
          padding: 12, fontSize: 11, background: '#f8fafc', borderRadius: 8,
          border: '1px solid var(--color-border-light)', maxHeight: 180, overflowY: 'auto',
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>📊 生成上下文摘要</div>
          {context.protagonistName && <div>👤 主角：{context.protagonistName} · {context.protagonistIdentity}</div>}
          {context.protagonistAbility && <div>⚡ 能力：{context.protagonistAbility}</div>}
          {context.worldBackground && <div>🌍 世界：{context.worldBackground.slice(0, 150)}……</div>}
          {context.activeMasterOutline && <div>📋 总纲：{context.activeMasterOutline.slice(0, 150)}……</div>}
          <div style={{ marginTop: 4, color: 'var(--color-text-muted)' }}>
            {!context.protagonistName && '⚠️ 缺少主角设定 '}
            {!context.worldBackground && '⚠️ 缺少世界背景 '}
          </div>
        </div>
      )}

      {/* 标题编辑 */}
      <div>
        <input
          className="input"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setIsDirty(true); }}
          placeholder={`${typeLabel}标题`}
          style={{ width: '100%', fontSize: 14, fontWeight: 600 }}
        />
      </div>

      {/* 内容编辑区 */}
      <textarea
        className="input"
        value={content}
        onChange={(e) => { setContent(e.target.value); setIsDirty(true); }}
        placeholder={`在此编辑${typeLabel}内容，或点击「AI 生成」……`}
        style={{
          flex: 1, width: '100%', resize: 'vertical', minHeight: 300,
          fontFamily: 'var(--font-family-editor)', fontSize: 14, lineHeight: 1.8,
          padding: 16, borderRadius: 8,
          border: '1px solid var(--color-border)',
        }}
      />

      {/* 版本列表 */}
      {versions.length > 1 && (
        <div style={{ padding: '8px 0', borderTop: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>历史版本：</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {versions.map((v) => (
              <span
                key={v.id}
                style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11,
                  background: v.isActive ? 'var(--color-primary-light)' : 'var(--color-bg-hover)',
                  color: v.id === currentId ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontWeight: v.isActive ? 600 : 400,
                }}
                title={v.isActive ? '当前采用版本' : `版本 ${v.version}`}
              >
                v{v.version}{v.isActive ? ' ★' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 状态栏 */}
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', gap: 16 }}>
        <span>字数：{content.length}</span>
        <span>版本：v{currentVersion}</span>
        {isDirty && <span style={{ color: 'var(--color-warning)' }}>● 未保存</span>}
      </div>
    </div>
  );
}

export default OutlineEditor;
