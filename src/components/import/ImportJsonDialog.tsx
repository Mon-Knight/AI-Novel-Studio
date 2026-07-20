/**
 * AI Novel Studio - JSON 导入确认弹窗
 */
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { novelService } from '../../services/novels/novelService';
import { styleProfileService } from '../../services/styles/styleProfileService';
import { outputProfileService } from '../../services/styles/outputProfileService';
import { parseJsonFile, detectJsonImportType } from '../../services/import/jsonImportService';
import {
  getProjectBackupSummary,
  isCompleteProjectBackup,
  restoreCompleteProjectBackup,
} from '../../services/backup/projectBackupService';
import { normalizeNovel } from '../../features/novels/novelNormalizer';
import type { JsonDetectResult } from '../../services/import/jsonImportService';
import { runWithLoading } from '../../lib/runWithLoading';

interface ImportJsonDialogProps {
  onClose: () => void;
}

function ImportJsonDialog({ onClose }: ImportJsonDialogProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'select' | 'confirm' | 'done'>('select');
  const [detectResult, setDetectResult] = useState<JsonDetectResult | null>(null);
  const [rawData, setRawData] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const isProjectBackupCandidate = detectResult?.type === 'ai_novel_studio_project'
    && detectResult.isProjectBackupCandidate === true;
  const hasValidProjectBackup = isProjectBackupCandidate && isCompleteProjectBackup(rawData);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const data = parseJsonFile(text);
      const result = detectJsonImportType(data);
      setRawData(data);
      setDetectResult(result);
      if (result.type === 'unknown') { setError('无法识别该 JSON 格式。当前支持：AI Novel Studio 作品 JSON、风格方案、输出控制方案。'); return; }
      setStep('confirm');
    } catch (err: any) { setError(err.message || '解析失败'); }
  };

  const handleImport = async () => {
    if (!detectResult || !rawData) return;
    setImporting(true); setError('');
    try {
      await runWithLoading(
        {
          title: '正在导入 JSON 文件',
          initialMessage: `正在导入${detectResult.type === 'style_profile' ? '风格方案' : detectResult.type === 'output_profile' ? '输出控制方案' : '作品'}……`,
          successMessage: '导入成功',
          errorMessage: '导入失败',
          successAutoCloseMs: 1200,
        },
        async ({ setMessage }) => {
          const obj = rawData as Record<string, unknown>;
          if (detectResult.type === 'style_profile') {
            setMessage('正在导入风格方案……');
            await styleProfileService.create({
          name: (obj.name as string) || '导入风格',
          sourceType: 'json_import',
          narrativePerspective: obj.narrativePerspective as any,
          tone: obj.tone as any, pace: obj.pace as any,
          dialogueRatio: (obj.dialogueRatio as number) || 0.35,
          descriptionRatio: (obj.descriptionRatio as number) || 0.4,
          styleSummary: (obj.styleSummary as string) || '',
        });
        setResultMsg('风格方案导入成功！');
      } else if (detectResult.type === 'output_profile') {
        await outputProfileService.create({
          name: (obj.name as string) || '导入输出方案',
          targetWordCount: (obj.targetWordCount as number) || 4000,
          paceLevel: obj.paceLevel as any, dialogueRatio: (obj.dialogueRatio as number) || 0.35,
          descriptionRatio: (obj.descriptionRatio as number) || 0.4,
          endingHookRequired: !!obj.endingHookRequired,
        });
        setResultMsg('输出控制方案导入成功！');
      } else if (detectResult.type === 'ai_novel_studio_project' && detectResult.isProjectBackupCandidate) {
        if (!isCompleteProjectBackup(rawData)) {
          throw new Error('完整项目备份校验不通过，不能按旧版项目 JSON 导入。');
        }
        setMessage(`正在验证并恢复：${getProjectBackupSummary(rawData)}`);
        const result = await restoreCompleteProjectBackup(rawData);
        setResultMsg(`作品「${result.title}」已完整恢复：${Object.values(result.restoredRecords).reduce((total, count) => total + count, 0)} 条记录`);
      } else if (detectResult.type === 'ai_novel_studio_project') {
        const novelData = obj.novel as Record<string, any>;
        if (!novelData?.title) { setError('作品 JSON 缺少必要字段'); setImporting(false); return; }
        const normalizedNovel = normalizeNovel(novelData);
        const novel = await novelService.createNovel({
          title: normalizedNovel?.title ?? novelData.title,
          genre: normalizedNovel?.genre ?? novelData.genre,
          description: normalizedNovel?.description ?? novelData.description,
          outline: normalizedNovel?.outline ?? '',
          targetWordCount: normalizedNovel?.targetWordCount,
        });
        if (normalizedNovel) {
          await novelService.updateNovel(novel.id, {
            title: normalizedNovel.title,
            subtitle: normalizedNovel.subtitle,
            genre: normalizedNovel.genre,
            description: normalizedNovel.description,
            outline: normalizedNovel.outline,
            status: normalizedNovel.status,
            targetWordCount: normalizedNovel.targetWordCount,
            protagonistMode: normalizedNovel.protagonistMode,
            protagonists: normalizedNovel.protagonists,
            dualProtagonistRelation: normalizedNovel.dualProtagonistRelation,
            mainCharacter: normalizedNovel.mainCharacter,
            protagonistAbility: normalizedNovel.protagonistAbility,
          });
        }
        setResultMsg(`作品「${novelData.title}」导入成功！`);
      }
      setImporting(false); setStep('done');
      setTimeout(() => {
        onClose();
        if (detectResult.type === 'style_profile' || detectResult.type === 'output_profile') navigate('/styles');
        else navigate('/');
      }, 1500);
        },
      );
    } catch (err: any) { setError(err.message || '导入失败'); setImporting(false); }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content" style={{ maxWidth: 500, width: '90%' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>📋 导入 JSON</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {step === 'select' && (
          <div>
            <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              选择 JSON 文件。支持完整作品备份、旧版项目 JSON、风格方案和输出控制方案。
            </div>
            <div onClick={() => fileInputRef.current?.click()} style={{ padding: 32, border: '2px dashed var(--color-border-light)', borderRadius: 8, textAlign: 'center', cursor: 'pointer' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: 14 }}>点击选择 JSON 文件</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".json,.JSON" onChange={handleFileSelect} style={{ display: 'none' }} />
          </div>
        )}

        {step === 'confirm' && detectResult && (
          <div>
            <div style={{ padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd', marginBottom: 16, fontSize: 13 }}>
              <div>类型：<strong>{detectResult.type === 'ai_novel_studio_project' ? (isProjectBackupCandidate ? (hasValidProjectBackup ? '完整作品备份' : '无效或不支持的完整备份') : '旧版项目 JSON') : detectResult.type === 'style_profile' ? '风格方案' : '输出控制方案'}</strong></div>
              {detectResult.name && <div>名称：{detectResult.name}</div>}
              {detectResult.summary && <div>摘要：{detectResult.summary}</div>}
            </div>
            {isProjectBackupCandidate && !hasValidProjectBackup && (
              <div style={{ marginBottom: 16, padding: 10, border: '1px solid #ef4444', background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>
                此完整备份文件不完整或协议版本不受支持，不能按旧版项目 JSON 导入。
              </div>
            )}
            {detectResult.type === 'ai_novel_studio_project' && !isProjectBackupCandidate && (
              <div style={{ marginBottom: 16, padding: 10, border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e', fontSize: 12 }}>
                这是旧版项目 JSON，只能恢复基础作品资料，不能替代完整备份。
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={importing || (isProjectBackupCandidate && !hasValidProjectBackup)}>
                {importing ? '⏳ 导入中...' : '✅ 确认导入'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-success)' }}>{resultMsg}</div>
          </div>
        )}

        {error && <div style={{ padding: 8, background: '#fee2e2', borderRadius: 6, color: 'var(--color-error)', fontSize: 13, marginTop: 8 }}>{error}</div>}
      </div>
    </>
  );
}

export default ImportJsonDialog;
