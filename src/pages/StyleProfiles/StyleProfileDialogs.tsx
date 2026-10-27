import { useState, type Dispatch, type SetStateAction } from 'react';
import { Bot, FileText } from 'lucide-react';
import type { OutputProfile } from '../../types/output';
import type { StyleAnalyzeResult, StyleProfile } from '../../types/style';
import type { OutputProfileFormValue, StyleProfileFormValue } from './styleProfilesPageTypes';
import { ModalFrame } from '../../components/common/ModalFrame';

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveProfile = async (save: () => Promise<void>) => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await save();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {/* 风格表单弹窗 */}
      {showStyleForm && (
        <ModalFrame
          title={editingStyle ? '编辑风格方案' : '新建风格方案'}
          maxWidth={560}
          onDismiss={() => setShowStyleForm(false)}
          busy={saving}
          initialFocusSelector='input[aria-label="风格方案名称"]'
          footer={
            <>
              <button
                className="btn btn-secondary"
                onClick={() => setShowStyleForm(false)}
                disabled={saving}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void saveProfile(saveStyle)}
                disabled={saving}
              >
                {saving ? '保存中…' : editingStyle ? '保存' : '创建'}
              </button>
            </>
          }
        >
          <div className="resource-form">
            <div>
              <label className="panel-field-label">名称 *</label>
              <input
                aria-label="风格方案名称"
                className="form-input resource-fill"
                value={styleForm.name}
                onChange={(e) => setStyleForm({ ...styleForm, name: e.target.value })}
              />
            </div>
            <div className="resource-form-grid">
              <div>
                <label className="panel-field-label">叙事人称</label>
                <input
                  aria-label="叙事人称"
                  className="form-input resource-fill"
                  value={styleForm.narrativePerspective}
                  onChange={(e) =>
                    setStyleForm({ ...styleForm, narrativePerspective: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="panel-field-label">文风语气</label>
                <input
                  aria-label="文风语气"
                  className="form-input resource-fill"
                  value={styleForm.tone}
                  onChange={(e) => setStyleForm({ ...styleForm, tone: e.target.value })}
                />
              </div>
            </div>
            <div className="resource-form-grid">
              <div>
                <label className="panel-field-label">节奏</label>
                <select
                  aria-label="风格节奏"
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
                  aria-label="句式特点"
                  className="form-input resource-fill"
                  value={styleForm.sentenceStyle}
                  onChange={(e) => setStyleForm({ ...styleForm, sentenceStyle: e.target.value })}
                />
              </div>
            </div>
            <div className="resource-form-grid">
              <div>
                <label className="panel-field-label">对话比例 {styleForm.dialogueRatio}%</label>
                <input
                  type="range"
                  className="resource-fill"
                  aria-label="对话比例"
                  min={0}
                  max={100}
                  value={styleForm.dialogueRatio}
                  onChange={(e) =>
                    setStyleForm({ ...styleForm, dialogueRatio: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="panel-field-label">描写比例 {styleForm.descriptionRatio}%</label>
                <input
                  type="range"
                  className="resource-fill"
                  aria-label="描写比例"
                  min={0}
                  max={100}
                  value={styleForm.descriptionRatio}
                  onChange={(e) =>
                    setStyleForm({ ...styleForm, descriptionRatio: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div>
              <label className="panel-field-label">风格总结</label>
              <textarea
                aria-label="风格总结"
                className="form-textarea resource-textarea--short"
                value={styleForm.styleSummary}
                onChange={(e) => setStyleForm({ ...styleForm, styleSummary: e.target.value })}
              />
            </div>
            {saveError && <p role="alert">{saveError}</p>}
          </div>
        </ModalFrame>
      )}

      {/* 输出控制弹窗 */}
      {showOutputForm && (
        <ModalFrame
          title={editingOutput ? '编辑输出方案' : '新建输出方案'}
          maxWidth={480}
          onDismiss={() => setShowOutputForm(false)}
          busy={saving}
          initialFocusSelector='input[aria-label="输出方案名称"]'
          footer={
            <>
              <button
                className="btn btn-secondary"
                onClick={() => setShowOutputForm(false)}
                disabled={saving}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void saveProfile(saveOutput)}
                disabled={saving}
              >
                {saving ? '保存中…' : editingOutput ? '保存' : '创建'}
              </button>
            </>
          }
        >
          <div className="resource-form">
            <div>
              <label className="panel-field-label">名称 *</label>
              <input
                aria-label="输出方案名称"
                className="form-input resource-fill"
                value={outputForm.name}
                onChange={(e) => setOutputForm({ ...outputForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="panel-field-label">目标字数</label>
              <input
                type="number"
                aria-label="目标字数"
                className="form-input resource-fill"
                value={outputForm.targetWordCount}
                onChange={(e) =>
                  setOutputForm({ ...outputForm, targetWordCount: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="panel-field-label">节奏</label>
              <select
                aria-label="输出节奏"
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
            {saveError && <p role="alert">{saveError}</p>}
          </div>
        </ModalFrame>
      )}

      {/* TXT 分析弹窗 */}
      {showAnalyze && (
        <ModalFrame
          title={
            <>
              <FileText aria-hidden="true" size={18} strokeWidth={1.8} />
              TXT 风格分析
            </>
          }
          maxWidth={640}
          onDismiss={closeAnalyzeDialog}
          busy={analyzing}
          initialFocusSelector='textarea[aria-label="参考文本"]'
          footer={
            <>
              <button
                className="btn btn-secondary"
                onClick={closeAnalyzeDialog}
                disabled={analyzing}
              >
                取消
              </button>
              {analyzing && (
                <button className="btn btn-secondary" onClick={stopAnalyze}>
                  停止分析
                </button>
              )}
              <button className="btn btn-primary" onClick={handleAnalyze} disabled={analyzing}>
                {!analyzing && <Bot aria-hidden="true" size={16} strokeWidth={1.8} />}
                {analyzing ? '分析中...' : '分析'}
              </button>
            </>
          }
        >
          <div className="text-sm text-muted resource-gap-bottom">
            粘贴参考文本，AI 分析抽象风格。不会复制原文。
          </div>
          <textarea
            aria-label="参考文本"
            className="form-textarea resource-textarea--tall"
            value={analyzeText}
            onChange={(e) => setAnalyzeText(e.target.value)}
            placeholder="在此粘贴参考文本..."
          />
          {analyzeError && <div className="resource-hint resource-hint--error">{analyzeError}</div>}
          {analyzeStatus && <div className="resource-hint">{analyzeStatus}</div>}
          {analyzeResult && (
            <div className="resource-notice resource-notice--success resource-notice--after">
              <strong>分析完成：</strong>
              {analyzeResult.styleSummary}
              <div className="resource-actions">
                <button className="btn btn-primary btn-sm" onClick={applyAnalyzeResult}>
                  应用并创建风格方案
                </button>
              </div>
            </div>
          )}
        </ModalFrame>
      )}
    </>
  );
}
