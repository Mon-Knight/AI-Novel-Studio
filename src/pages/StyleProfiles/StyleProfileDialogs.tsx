import type { Dispatch, SetStateAction } from 'react';
import type { OutputProfile } from '../../types/output';
import type { StyleAnalyzeResult, StyleProfile } from '../../types/style';
import type { OutputProfileFormValue, StyleProfileFormValue } from './styleProfilesPageTypes';

interface StyleProfileDialogsProps {
  showStyleForm: boolean;
  setShowStyleForm: Dispatch<SetStateAction<boolean>>;
  editingStyle: StyleProfile | null;
  styleForm: StyleProfileFormValue;
  setStyleForm: Dispatch<SetStateAction<StyleProfileFormValue>>;
  saveStyle: () => Promise<void>;
  showOutputForm: boolean;
  setShowOutputForm: Dispatch<SetStateAction<boolean>>;
  editingOutput: OutputProfile | null;
  outputForm: OutputProfileFormValue;
  setOutputForm: Dispatch<SetStateAction<OutputProfileFormValue>>;
  saveOutput: () => Promise<void>;
  showAnalyze: boolean;
  closeAnalyzeDialog: () => void;
  analyzeText: string;
  setAnalyzeText: Dispatch<SetStateAction<string>>;
  analyzeError: string;
  analyzeStatus: string;
  analyzeResult: StyleAnalyzeResult | null;
  analyzing: boolean;
  applyAnalyzeResult: () => void;
  stopAnalyze: () => void;
  handleAnalyze: () => Promise<void>;
}

export function StyleProfileDialogs({
  showStyleForm,
  setShowStyleForm,
  editingStyle,
  styleForm,
  setStyleForm,
  saveStyle,
  showOutputForm,
  setShowOutputForm,
  editingOutput,
  outputForm,
  setOutputForm,
  saveOutput,
  showAnalyze,
  closeAnalyzeDialog,
  analyzeText,
  setAnalyzeText,
  analyzeError,
  analyzeStatus,
  analyzeResult,
  analyzing,
  applyAnalyzeResult,
  stopAnalyze,
  handleAnalyze,
}: StyleProfileDialogsProps) {
  return (
    <>
      {/* 风格表单弹窗 */}
      {showStyleForm && (
        <div className="modal-overlay" onClick={() => setShowStyleForm(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560 }}
          >
            <div className="modal-title">{editingStyle ? '编辑风格方案' : '新建风格方案'}</div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxHeight: '70vh',
                overflowY: 'auto',
              }}
            >
              <div>
                <label className="panel-field-label">名称 *</label>
                <input
                  className="form-input"
                  value={styleForm.name}
                  onChange={(e) => setStyleForm({ ...styleForm, name: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label className="panel-field-label">叙事人称</label>
                  <input
                    className="form-input"
                    value={styleForm.narrativePerspective}
                    onChange={(e) =>
                      setStyleForm({ ...styleForm, narrativePerspective: e.target.value })
                    }
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="panel-field-label">文风语气</label>
                  <input
                    className="form-input"
                    value={styleForm.tone}
                    onChange={(e) => setStyleForm({ ...styleForm, tone: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label className="panel-field-label">节奏</label>
                  <select
                    className="panel-select"
                    value={styleForm.pace}
                    onChange={(e) => setStyleForm({ ...styleForm, pace: e.target.value })}
                  >
                    <option value="">-</option>
                    <option>快</option>
                    <option>中等</option>
                    <option>慢</option>
                  </select>
                </div>
                <div>
                  <label className="panel-field-label">句式特点</label>
                  <input
                    className="form-input"
                    value={styleForm.sentenceStyle}
                    onChange={(e) => setStyleForm({ ...styleForm, sentenceStyle: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label className="panel-field-label">对话比例 {styleForm.dialogueRatio}%</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={styleForm.dialogueRatio}
                    onChange={(e) =>
                      setStyleForm({ ...styleForm, dialogueRatio: Number(e.target.value) })
                    }
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="panel-field-label">
                    描写比例 {styleForm.descriptionRatio}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={styleForm.descriptionRatio}
                    onChange={(e) =>
                      setStyleForm({ ...styleForm, descriptionRatio: Number(e.target.value) })
                    }
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <div>
                <label className="panel-field-label">风格总结</label>
                <textarea
                  className="form-textarea"
                  value={styleForm.styleSummary}
                  onChange={(e) => setStyleForm({ ...styleForm, styleSummary: e.target.value })}
                  style={{ width: '100%', height: 60, resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setShowStyleForm(false)}>
                  取消
                </button>
                <button className="btn btn-primary" onClick={saveStyle}>
                  {editingStyle ? '保存' : '创建'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 输出控制弹窗 */}
      {showOutputForm && (
        <div className="modal-overlay" onClick={() => setShowOutputForm(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480 }}
          >
            <div className="modal-title">{editingOutput ? '编辑输出方案' : '新建输出方案'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="panel-field-label">名称 *</label>
                <input
                  className="form-input"
                  value={outputForm.name}
                  onChange={(e) => setOutputForm({ ...outputForm, name: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="panel-field-label">目标字数</label>
                <input
                  type="number"
                  className="form-input"
                  value={outputForm.targetWordCount}
                  onChange={(e) =>
                    setOutputForm({ ...outputForm, targetWordCount: Number(e.target.value) })
                  }
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="panel-field-label">节奏</label>
                <select
                  className="panel-select"
                  value={outputForm.paceLevel}
                  onChange={(e) =>
                    setOutputForm({
                      ...outputForm,
                      paceLevel: e.target.value as 'slow' | 'medium' | 'fast',
                    })
                  }
                >
                  <option value="slow">慢</option>
                  <option value="medium">中等</option>
                  <option value="fast">快</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setShowOutputForm(false)}>
                  取消
                </button>
                <button className="btn btn-primary" onClick={saveOutput}>
                  {editingOutput ? '保存' : '创建'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TXT 分析弹窗 */}
      {showAnalyze && (
        <div className="modal-overlay" onClick={closeAnalyzeDialog}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640 }}
          >
            <div className="modal-title">📄 TXT 风格分析</div>
            <div className="text-sm text-muted" style={{ marginBottom: 12 }}>
              粘贴参考文本，AI 分析抽象风格。不会复制原文。
            </div>
            <textarea
              className="form-textarea"
              value={analyzeText}
              onChange={(e) => setAnalyzeText(e.target.value)}
              placeholder="在此粘贴参考文本..."
              style={{ width: '100%', height: 180, resize: 'vertical', fontSize: 14 }}
            />
            {analyzeError && (
              <div style={{ fontSize: 13, color: 'var(--color-error)', marginTop: 8 }}>
                {analyzeError}
              </div>
            )}
            {analyzeStatus && (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                {analyzeStatus}
              </div>
            )}
            {analyzeResult && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'var(--color-success-bg)',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <strong>分析完成：</strong>
                {analyzeResult.styleSummary}
                <br />
                <button
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={applyAnalyzeResult}
                >
                  应用并创建风格方案
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={closeAnalyzeDialog}>
                取消
              </button>
              {analyzing && (
                <button className="btn btn-secondary" onClick={stopAnalyze}>
                  停止分析
                </button>
              )}
              <button className="btn btn-primary" onClick={handleAnalyze} disabled={analyzing}>
                {analyzing ? '分析中...' : '🤖 分析'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
