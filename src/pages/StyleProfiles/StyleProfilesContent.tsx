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
  return (
    <div
      style={{ padding: 32, maxWidth: 1000, margin: '0 auto', height: '100%', overflowY: 'auto' }}
    >
      <BackButton label="返回工作台" to="/" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 8,
          marginTop: 12,
        }}
      >
        <Palette aria-hidden="true" size={22} strokeWidth={1.8} />
        风格方案管理
      </div>
      <div className="text-sm text-muted" style={{ marginBottom: 20 }}>
        管理可复用的写作风格画像和输出控制方案。
      </div>
      {msg && (
        <div
          style={{
            fontSize: 13,
            padding: '6px 12px',
            background: 'var(--color-primary-light)',
            borderRadius: 6,
            marginBottom: 16,
            color: 'var(--color-primary)',
          }}
        >
          {msg}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 20,
          borderBottom: '2px solid var(--color-border)',
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              borderBottom:
                tab === t.key ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -2,
              background: 'none',
              cursor: 'pointer',
            }}
          >
            {t.label} (
            {t.key === 'styles'
              ? styles.length
              : t.key === 'outputs'
                ? outputs.length
                : assets.length}
            )
          </button>
        ))}
        <div style={{ flex: 1 }} />
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
              style={{ marginLeft: 8 }}
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
      </div>

      {/* 风格列表 */}
      {tab === 'styles' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 12,
          }}
        >
          {styles.map((s) => (
            <div
              key={s.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                padding: 16,
                background: s.isActive ? 'var(--color-primary-light)' : 'var(--color-bg-card)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.isActive && (
                    <span style={{ fontSize: 11, color: 'var(--color-primary)', fontWeight: 600 }}>
                      当前
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 11,
                      padding: '1px 8px',
                      borderRadius: 10,
                      background: 'var(--color-bg-hover)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {sourceTypeLabel(s)}
                  </span>
                </div>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  marginTop: 8,
                  lineHeight: 1.6,
                }}
              >
                {s.narrativePerspective && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Eye aria-hidden="true" size={14} strokeWidth={1.8} />
                    {s.narrativePerspective}
                  </div>
                )}
                {s.tone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Drama aria-hidden="true" size={14} strokeWidth={1.8} />
                    {s.tone}
                  </div>
                )}
                {s.pace && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Gauge aria-hidden="true" size={14} strokeWidth={1.8} />
                    {s.pace}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <MessageCircle aria-hidden="true" size={14} strokeWidth={1.8} />
                  {Math.round(s.dialogueRatio * 100)}% ·
                  <PenLine aria-hidden="true" size={14} strokeWidth={1.8} />
                  {Math.round(s.descriptionRatio * 100)}%
                </div>
              </div>
              <StyleSourceTrace profile={s} />
              <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
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
                    className="btn btn-secondary btn-sm"
                    onClick={() => deleteStyle(s.id, s.name)}
                    style={{ color: 'var(--color-error)' }}
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {outputs.map((o) => (
            <div
              key={o.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                padding: 16,
                background: o.isDefault ? 'var(--color-primary-light)' : 'var(--color-bg-card)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{o.name}</span>
                {o.isDefault && (
                  <span style={{ fontSize: 11, color: 'var(--color-primary)', fontWeight: 600 }}>
                    默认
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChart3 aria-hidden="true" size={14} strokeWidth={1.8} />
                  {formatNumber(o.targetWordCount ?? o.chapterWordRange.default)} 字
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Gauge aria-hidden="true" size={14} strokeWidth={1.8} />
                  {o.paceLevel === 'fast' ? '快' : o.paceLevel === 'slow' ? '慢' : '中等'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
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
                    className="btn btn-secondary btn-sm"
                    onClick={() => deleteOutput(o.id, o.name)}
                    style={{ color: 'var(--color-error)' }}
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
        <div>
          {assets.length === 0 ? (
            <div className="text-muted" style={{ textAlign: 'center', padding: 40 }}>
              暂无导入记录
            </div>
          ) : (
            assets.map((a) => (
              <div
                key={a.id}
                style={{
                  border: '1px solid var(--color-border-light)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontWeight: 500 }}>{a.fileName}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                    {a.fileType.toUpperCase()}
                  </span>
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

      <button className="btn btn-secondary" onClick={onBack} style={{ marginTop: 20 }}>
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />
        返回首页
      </button>
    </div>
  );
}
