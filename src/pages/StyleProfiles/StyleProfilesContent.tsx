import type { Dispatch, SetStateAction } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Drama,
  Eye,
  FileText,
  Gauge,
  MessageCircle,
  Palette,
  PenLine,
  Plus,
  Trash2,
} from 'lucide-react';
import BackButton from '../../components/common/BackButton';
import { PageHeader, PageLayout, PageTabs } from '../../components/common/PageLayout';
import { importedAssetService } from '../../services/styles/importedAssetService';
import type { ImportedAsset } from '../../types/importedAsset';
import type { OutputProfile } from '../../types/output';
import type { StyleProfile, StyleAnalyzeResult } from '../../types/style';
import { formatNumber } from '../../utils/format';
import type {
  OutputProfileFormValue,
  StyleProfileFormValue,
  StyleProfilesTab,
} from './styleProfilesPageTypes';
import { StyleSourceTrace } from './StyleSourceTrace';

function sourceTypeLabel(style: StyleProfile): string {
  switch (style.sourceType) {
    case 'manual':
      return '手动';
    case 'txt_analysis':
      return 'TXT分析';
    case 'json_import':
      return 'JSON导入';
    case 'ai_analyzed':
      return 'AI分层分析';
    case 'system_default':
      return '系统默认';
  }
}

interface StyleProfilesContentProps {
  tab: StyleProfilesTab;
  setTab: Dispatch<SetStateAction<StyleProfilesTab>>;
  tabs: Array<{ key: StyleProfilesTab; label: string }>;
  styles: StyleProfile[];
  outputs: OutputProfile[];
  assets: ImportedAsset[];
  setAssets: Dispatch<SetStateAction<ImportedAsset[]>>;
  msg: string;
  flash: (message: string) => void;
  setEditingStyle: Dispatch<SetStateAction<StyleProfile | null>>;
  setStyleForm: Dispatch<SetStateAction<StyleProfileFormValue>>;
  setShowStyleForm: Dispatch<SetStateAction<boolean>>;
  setAnalyzeText: Dispatch<SetStateAction<string>>;
  setAnalyzeResult: Dispatch<SetStateAction<StyleAnalyzeResult | null>>;
  setAnalyzeError: Dispatch<SetStateAction<string>>;
  setShowAnalyze: Dispatch<SetStateAction<boolean>>;
  setEditingOutput: Dispatch<SetStateAction<OutputProfile | null>>;
  setOutputForm: Dispatch<SetStateAction<OutputProfileFormValue>>;
  setShowOutputForm: Dispatch<SetStateAction<boolean>>;
  editStyle: (style: StyleProfile) => void;
  activateStyle: (style: StyleProfile) => Promise<void>;
  activatingStyleId: string | null;
  deleteStyle: (id: string, name: string) => Promise<void>;
  makeOutputDefault: (output: OutputProfile) => Promise<void>;
  defaultingOutputId: string | null;
  deleteOutput: (id: string, name: string) => Promise<void>;
  onBack: () => void;
}

export function StyleProfilesContent({
  tab,
  setTab,
  tabs,
  styles,
  outputs,
  assets,
  setAssets,
  msg,
  flash,
  setEditingStyle,
  setStyleForm,
  setShowStyleForm,
  setAnalyzeText,
  setAnalyzeResult,
  setAnalyzeError,
  setShowAnalyze,
  setEditingOutput,
  setOutputForm,
  setShowOutputForm,
  editStyle,
  activateStyle,
  activatingStyleId,
  deleteStyle,
  makeOutputDefault,
  defaultingOutputId,
  deleteOutput,
  onBack,
}: StyleProfilesContentProps) {
  const pageActions = (
    <>
      {tab === 'styles' && (
        <>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditingStyle(null);
              setStyleForm({
                name: '',
                narrativePerspective: '',
                tone: '',
                pace: '',
                sentenceStyle: '',
                dialogueRatio: 35,
                descriptionRatio: 40,
                styleSummary: '',
              });
              setShowStyleForm(true);
            }}
          >
            <Plus aria-hidden="true" size={15} strokeWidth={1.8} />
            新建风格
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setAnalyzeText('');
              setAnalyzeResult(null);
              setAnalyzeError('');
              setShowAnalyze(true);
            }}
          >
            <FileText aria-hidden="true" size={15} strokeWidth={1.8} />
            TXT分析
          </button>
        </>
      )}
      {tab === 'outputs' && (
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setEditingOutput(null);
            setOutputForm({
              name: '',
              targetWordCount: 4000,
              paceLevel: 'medium',
              dialogueRatio: 35,
              descriptionRatio: 40,
            });
            setShowOutputForm(true);
          }}
        >
          <Plus aria-hidden="true" size={15} strokeWidth={1.8} />
          新建方案
        </button>
      )}
    </>
  );
  return (
    <PageLayout>
      <BackButton label="返回工作台" to="/" />
      <PageHeader
        title="风格方案管理"
        description="管理可复用的写作风格画像和输出控制方案。"
        icon={Palette}
        actions={pageActions}
      />
      {msg && (
        <div className="resource-notice resource-notice--success" role="status">
          {msg}
        </div>
      )}

      <PageTabs<StyleProfilesTab>
        label="风格资源分类"
        value={tab}
        onChange={setTab}
        items={tabs.map((item) => ({
          value: item.key,
          label: item.label,
          count:
            item.key === 'styles'
              ? styles.length
              : item.key === 'outputs'
                ? outputs.length
                : assets.length,
        }))}
      >
        {/* 风格列表 */}
        {tab === 'styles' && (
          <div className="resource-grid">
            {styles.map((s) => (
              <div
                key={s.id}
                className={`resource-card resource-card--flow${s.isActive ? ' is-active' : ''}`}
              >
                <div className="resource-card-header">
                  <span className="resource-card-title">{s.name}</span>
                  <div className="resource-pill-row resource-shrink">
                    {s.isActive && (
                      <span className="resource-pill resource-pill--primary">当前</span>
                    )}
                    <span className="resource-pill">{sourceTypeLabel(s)}</span>
                  </div>
                </div>
                <div className="resource-card-description">
                  {s.narrativePerspective && (
                    <div className="resource-row">
                      <Eye aria-hidden="true" size={14} strokeWidth={1.8} />
                      {s.narrativePerspective}
                    </div>
                  )}
                  {s.tone && (
                    <div className="resource-row">
                      <Drama aria-hidden="true" size={14} strokeWidth={1.8} />
                      {s.tone}
                    </div>
                  )}
                  {s.pace && (
                    <div className="resource-row">
                      <Gauge aria-hidden="true" size={14} strokeWidth={1.8} />
                      {s.pace}
                    </div>
                  )}
                  <div className="resource-row">
                    <MessageCircle aria-hidden="true" size={14} strokeWidth={1.8} />
                    {Math.round(s.dialogueRatio * 100)}% ·
                    <PenLine aria-hidden="true" size={14} strokeWidth={1.8} />
                    {Math.round(s.descriptionRatio * 100)}%
                  </div>
                </div>
                <StyleSourceTrace profile={s} />
                <div className="resource-actions">
                  {!s.isActive && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => activateStyle(s)}
                      disabled={activatingStyleId !== null}
                    >
                      {activatingStyleId === s.id ? '切换中...' : '设为当前'}
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => editStyle(s)}
                    aria-label={`编辑风格 ${s.name}`}
                    title="编辑风格"
                  >
                    <PenLine aria-hidden="true" size={15} strokeWidth={1.8} />
                  </button>
                  {s.sourceType !== 'system_default' && (
                    <button
                      className="btn btn-secondary btn-sm resource-text-error"
                      onClick={() => deleteStyle(s.id, s.name)}
                      aria-label={`删除风格 ${s.name}`}
                      title="删除风格"
                    >
                      <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 输出控制列表 */}
        {tab === 'outputs' && (
          <div className="resource-grid">
            {outputs.map((o) => (
              <div
                key={o.id}
                className={`resource-card resource-card--flow${o.isDefault ? ' is-active' : ''}`}
              >
                <div className="resource-card-header">
                  <span className="resource-card-title">{o.name}</span>
                  {o.isDefault && (
                    <span className="resource-pill resource-pill--primary resource-shrink">
                      默认
                    </span>
                  )}
                </div>
                <div className="resource-card-description">
                  <div className="resource-row">
                    <BarChart3 aria-hidden="true" size={14} strokeWidth={1.8} />
                    {formatNumber(o.targetWordCount ?? o.chapterWordRange.default)} 字
                  </div>
                  <div className="resource-row">
                    <Gauge aria-hidden="true" size={14} strokeWidth={1.8} />
                    {o.paceLevel === 'fast' ? '快' : o.paceLevel === 'slow' ? '慢' : '中等'}
                  </div>
                </div>
                <div className="resource-actions">
                  {!o.isDefault && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => makeOutputDefault(o)}
                      disabled={defaultingOutputId !== null}
                    >
                      {defaultingOutputId === o.id ? '切换中...' : '设为默认'}
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    aria-label={`编辑输出方案 ${o.name}`}
                    title="编辑输出方案"
                    onClick={() => {
                      setEditingOutput(o);
                      setOutputForm({
                        name: o.name,
                        targetWordCount: o.targetWordCount || 4000,
                        paceLevel: o.paceLevel || 'medium',
                        dialogueRatio: 35,
                        descriptionRatio: 40,
                      });
                      setShowOutputForm(true);
                    }}
                  >
                    <PenLine aria-hidden="true" size={15} strokeWidth={1.8} />
                  </button>
                  {!o.isDefault && (
                    <button
                      className="btn btn-secondary btn-sm resource-text-error"
                      onClick={() => deleteOutput(o.id, o.name)}
                      aria-label={`删除输出方案 ${o.name}`}
                      title="删除输出方案"
                    >
                      <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 导入记录 */}
        {tab === 'imports' && (
          <div className="resource-list">
            {assets.length === 0 ? (
              <div className="resource-empty">暂无导入记录</div>
            ) : (
              assets.map((a) => (
                <div key={a.id} className="resource-list-item">
                  <div className="resource-list-item-main">
                    <span>{a.fileName}</span>
                    <span className="resource-meta">{a.fileType.toUpperCase()}</span>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      await importedAssetService.remove(a.id);
                      flash('已删除');
                      importedAssetService.getAll().then(setAssets);
                    }}
                    aria-label={`删除导入记录 ${a.fileName}`}
                    title="删除导入记录"
                  >
                    <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </PageTabs>
      <button className="btn btn-secondary resource-gap-top-lg" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />
        返回首页
      </button>
    </PageLayout>
  );
}
