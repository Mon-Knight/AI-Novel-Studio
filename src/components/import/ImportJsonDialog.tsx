/**
 * AI Novel Studio - JSON 导入确认弹窗
 */
import { useState, useRef } from 'react';
import { CircleCheck, FileJson, FolderOpen, LoaderCircle, X } from 'lucide-react';
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
import type { CreateOutputProfileInput } from '../../types/output';
import { runWithLoading } from '../../lib/runWithLoading';
import { describeUnknownError } from '../../utils/errorMessage';

interface ImportJsonDialogProps {
  onClose: () => void;
}

type PaceLevel = NonNullable<CreateOutputProfileInput['paceLevel']>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readStringOr(value: unknown, fallback: string): string {
  return readOptionalString(value) || fallback;
}

function readNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value || fallback : fallback;
}

function readPaceLevel(value: unknown): PaceLevel | undefined {
  return value === 'slow' || value === 'medium' || value === 'fast' ? value : undefined;
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
  const isProjectBackupCandidate =
    detectResult?.type === 'ai_novel_studio_project' &&
    detectResult.isProjectBackupCandidate === true;
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
      if (result.type === 'unknown') {
        setError(
          '无法识别该 JSON 格式。当前支持：AI Novel Studio 作品 JSON、风格方案、输出控制方案。',
        );
        return;
      }
      setStep('confirm');
    } catch (err: unknown) {
      setError(describeUnknownError(err, '解析失败'));
    }
  };

  const handleImport = async () => {
    if (!detectResult || !rawData) return;
    setImporting(true);
    setError('');
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
          const obj = asRecord(rawData);
          if (!obj) throw new Error('JSON 根节点必须是对象');
          if (detectResult.type === 'style_profile') {
            setMessage('正在导入风格方案……');
            await styleProfileService.create({
              name: readStringOr(obj.name, '导入风格'),
              sourceType: 'json_import',
              narrativePerspective: readOptionalString(obj.narrativePerspective),
              tone: readOptionalString(obj.tone),
              pace: readOptionalString(obj.pace),
              dialogueRatio: readNumberOr(obj.dialogueRatio, 0.35),
              descriptionRatio: readNumberOr(obj.descriptionRatio, 0.4),
              styleSummary: readStringOr(obj.styleSummary, ''),
            });
            setResultMsg('风格方案导入成功！');
          } else if (detectResult.type === 'output_profile') {
            await outputProfileService.create({
              name: readStringOr(obj.name, '导入输出方案'),
              targetWordCount: readNumberOr(obj.targetWordCount, 4000),
              paceLevel: readPaceLevel(obj.paceLevel),
              dialogueRatio: readNumberOr(obj.dialogueRatio, 0.35),
              descriptionRatio: readNumberOr(obj.descriptionRatio, 0.4),
              endingHookRequired: !!obj.endingHookRequired,
            });
            setResultMsg('输出控制方案导入成功！');
          } else if (
            detectResult.type === 'ai_novel_studio_project' &&
            detectResult.isProjectBackupCandidate
          ) {
            if (!isCompleteProjectBackup(rawData)) {
              throw new Error('完整项目备份校验不通过，不能按旧版项目 JSON 导入。');
            }
            setMessage(`正在验证并恢复：${getProjectBackupSummary(rawData)}`);
            const result = await restoreCompleteProjectBackup(rawData);
            setResultMsg(
              `作品「${result.title}」已完整恢复：${Object.values(result.restoredRecords).reduce((total, count) => total + count, 0)} 条记录`,
            );
          } else if (detectResult.type === 'ai_novel_studio_project') {
            const novelData = asRecord(obj.novel);
            const legacyTitle = readOptionalString(novelData?.title);
            if (!novelData || !legacyTitle) {
              setError('作品 JSON 缺少必要字段');
              setImporting(false);
              return;
            }
            const normalizedNovel = normalizeNovel(novelData);
            const novel = await novelService.createNovel({
              title: normalizedNovel?.title ?? legacyTitle,
              genre: normalizedNovel?.genre ?? readOptionalString(novelData.genre),
              description:
                normalizedNovel?.description ?? readOptionalString(novelData.description),
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
            setResultMsg(`作品「${legacyTitle}」导入成功！`);
          }
          setImporting(false);
          setStep('done');
          setTimeout(() => {
            onClose();
            if (detectResult.type === 'style_profile' || detectResult.type === 'output_profile')
              navigate('/styles');
            else navigate('/');
          }, 1500);
        },
      );
    } catch (err: unknown) {
      setError(describeUnknownError(err, '导入失败'));
      setImporting(false);
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div
        className="modal-content"
        style={{ maxWidth: 500, width: '90%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <span
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700 }}
          >
            <FileJson aria-hidden="true" size={18} strokeWidth={1.8} />
            导入 JSON
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 JSON 导入"
            title="关闭"
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
          >
            <X aria-hidden="true" size={20} strokeWidth={1.8} />
          </button>
        </div>

        {step === 'select' && (
          <div>
            <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              选择 JSON 文件。支持完整作品备份、旧版项目 JSON、风格方案和输出控制方案。
            </div>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: 32,
                border: '2px dashed var(--color-border-light)',
                borderRadius: 8,
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              <FolderOpen
                aria-hidden="true"
                size={32}
                strokeWidth={1.8}
                style={{ marginBottom: 8 }}
              />
              <div style={{ fontSize: 14 }}>点击选择 JSON 文件</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.JSON"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {step === 'confirm' && detectResult && (
          <div>
            <div
              style={{
                padding: 12,
                background: 'var(--color-info-bg)',
                borderRadius: 6,
                border: '1px solid var(--color-info-border)',
                marginBottom: 16,
                fontSize: 13,
              }}
            >
              <div>
                类型：
                <strong>
                  {detectResult.type === 'ai_novel_studio_project'
                    ? isProjectBackupCandidate
                      ? hasValidProjectBackup
                        ? '完整作品备份'
                        : '无效或不支持的完整备份'
                      : '旧版项目 JSON'
                    : detectResult.type === 'style_profile'
                      ? '风格方案'
                      : '输出控制方案'}
                </strong>
              </div>
              {detectResult.name && <div>名称：{detectResult.name}</div>}
              {detectResult.summary && <div>摘要：{detectResult.summary}</div>}
            </div>
            {isProjectBackupCandidate && !hasValidProjectBackup && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 10,
                  border: '1px solid var(--color-error)',
                  background: 'var(--color-error-bg)',
                  color: 'var(--color-error-text)',
                  fontSize: 12,
                }}
              >
                此完整备份文件不完整或协议版本不受支持，不能按旧版项目 JSON 导入。
              </div>
            )}
            {detectResult.type === 'ai_novel_studio_project' && !isProjectBackupCandidate && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 10,
                  border: '1px solid var(--color-warning)',
                  background: 'var(--color-warning-bg)',
                  color: 'var(--color-warning-text)',
                  fontSize: 12,
                }}
              >
                这是旧版项目 JSON，只能恢复基础作品资料，不能替代完整备份。
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>
                取消
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleImport}
                disabled={importing || (isProjectBackupCandidate && !hasValidProjectBackup)}
              >
                {importing ? (
                  <>
                    <LoaderCircle aria-hidden="true" size={15} strokeWidth={1.8} />
                    导入中...
                  </>
                ) : (
                  <>
                    <CircleCheck aria-hidden="true" size={15} strokeWidth={1.8} />
                    确认导入
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <CircleCheck
              aria-hidden="true"
              size={40}
              strokeWidth={1.8}
              style={{ marginBottom: 12, color: 'var(--color-success)' }}
            />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-success)' }}>
              {resultMsg}
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: 8,
              background: 'var(--color-error-bg)',
              borderRadius: 6,
              color: 'var(--color-error)',
              fontSize: 13,
              marginTop: 8,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </>
  );
}

export default ImportJsonDialog;
