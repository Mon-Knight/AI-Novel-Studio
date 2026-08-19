import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmDanger } from '../../utils/nativeDialog';
import { styleProfileService } from '../../services/styles/styleProfileService';
import { outputProfileService } from '../../services/styles/outputProfileService';
import { importedAssetService } from '../../services/styles/importedAssetService';
import { analyzeStyle } from '../../services/styles/styleAnalyzeService';
import type { StyleProfile, StyleAnalyzeResult } from '../../types/style';
import type { OutputProfile } from '../../types/output';
import type { ImportedAsset } from '../../types/importedAsset';
import { describeUnknownError } from '../../utils/errorMessage';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import { StyleProfilesContent } from './StyleProfilesContent';
import { StyleProfileDialogs } from './StyleProfileDialogs';
import type { StyleProfilesTab } from './styleProfilesPageTypes';

function StyleProfilesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<StyleProfilesTab>('styles');
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [outputs, setOutputs] = useState<OutputProfile[]>([]);
  const [assets, setAssets] = useState<ImportedAsset[]>([]);
  const [msg, setMsg] = useState('');

  const [showStyleForm, setShowStyleForm] = useState(false);
  const [editingStyle, setEditingStyle] = useState<StyleProfile | null>(null);
  const [styleForm, setStyleForm] = useState({
    name: '',
    narrativePerspective: '',
    tone: '',
    pace: '',
    sentenceStyle: '',
    dialogueRatio: 35,
    descriptionRatio: 40,
    styleSummary: '',
  });

  const [showOutputForm, setShowOutputForm] = useState(false);
  const [editingOutput, setEditingOutput] = useState<OutputProfile | null>(null);
  const [outputForm, setOutputForm] = useState({
    name: '',
    targetWordCount: 4000,
    paceLevel: 'medium' as 'slow' | 'medium' | 'fast',
    dialogueRatio: 35,
    descriptionRatio: 40,
  });

  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeText, setAnalyzeText] = useState('');
  const [analyzeResult, setAnalyzeResult] = useState<StyleAnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [analyzeStatus, setAnalyzeStatus] = useState('');
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 2500);
  };

  useEffect(() => {
    styleProfileService
      .getAll()
      .then(setStyles)
      .catch(() => {});
  }, []);
  useEffect(() => {
    outputProfileService
      .getAll()
      .then(setOutputs)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (tab === 'imports')
      importedAssetService
        .getAll()
        .then(setAssets)
        .catch(() => {});
  }, [tab]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      analyzeAbortRef.current?.abort();
      analyzeAbortRef.current = null;
    };
  }, []);

  const saveStyle = async () => {
    if (!styleForm.name.trim()) return flash('请输入风格名称');
    const input = {
      ...styleForm,
      dialogueRatio: styleForm.dialogueRatio / 100,
      descriptionRatio: styleForm.descriptionRatio / 100,
    };
    if (editingStyle) {
      await styleProfileService.update(editingStyle.id, {
        ...input,
        sourceType: 'manual' as const,
      });
      flash('已更新');
    } else {
      await styleProfileService.create({ ...input, sourceType: 'manual' });
      flash('已创建');
    }
    setShowStyleForm(false);
    setEditingStyle(null);
    styleProfileService.getAll().then(setStyles);
  };

  const editStyle = (s: StyleProfile) => {
    setEditingStyle(s);
    setStyleForm({
      name: s.name,
      narrativePerspective: s.narrativePerspective || '',
      tone: s.tone || '',
      pace: s.pace || '',
      sentenceStyle: s.sentenceStyle || '',
      dialogueRatio: Math.round(s.dialogueRatio * 100),
      descriptionRatio: Math.round(s.descriptionRatio * 100),
      styleSummary: s.styleSummary || '',
    });
    setShowStyleForm(true);
  };

  const deleteStyle = async (id: string, name: string) => {
    if (!(await confirmDanger({ title: '删除风格', message: `确定删除「${name}」？` }))) return;
    try {
      await styleProfileService.remove(id);
      setStyles(await styleProfileService.getAll());
      flash('已删除');
    } catch (error: unknown) {
      flash(describeUnknownError(error, '删除风格失败'));
    }
  };

  const saveOutput = async () => {
    if (!outputForm.name.trim()) return flash('请输入方案名称');
    if (editingOutput) {
      await outputProfileService.update(editingOutput.id, outputForm);
      flash('已更新');
    } else {
      await outputProfileService.create({
        ...outputForm,
        dialogueRatio: outputForm.dialogueRatio / 100,
        descriptionRatio: outputForm.descriptionRatio / 100,
      } as Parameters<typeof outputProfileService.create>[0]);
      flash('已创建');
    }
    setShowOutputForm(false);
    setEditingOutput(null);
    outputProfileService.getAll().then(setOutputs);
  };

  const deleteOutput = async (id: string, name: string) => {
    if (!(await confirmDanger({ title: '删除方案', message: `确定删除「${name}」？` }))) return;
    try {
      await outputProfileService.remove(id);
      setOutputs(await outputProfileService.getAll());
      flash('已删除');
    } catch (error: unknown) {
      flash(describeUnknownError(error, '删除输出方案失败'));
    }
  };

  const stopAnalyze = () => {
    const controller = analyzeAbortRef.current;
    if (!controller) return;
    analyzeAbortRef.current = null;
    controller.abort();
    setAnalyzing(false);
    setAnalyzeError('');
    setAnalyzeStatus('分析已停止');
  };

  const closeAnalyzeDialog = () => {
    if (analyzeAbortRef.current) stopAnalyze();
    setShowAnalyze(false);
  };

  const handleAnalyze = async () => {
    if (!analyzeText.trim()) return setAnalyzeError('请输入参考文本');
    analyzeAbortRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    setAnalyzing(true);
    setAnalyzeError('');
    setAnalyzeStatus('');
    setAnalyzeResult(null);
    try {
      const result = await analyzeStyle(analyzeText, {
        signal: controller.signal,
        cancel: () => controller.abort(),
      });
      if (
        controller.signal.aborted ||
        analyzeAbortRef.current !== controller ||
        !mountedRef.current
      )
        return;
      setAnalyzeResult(result);
      setStyleForm({
        name: result.name || '分析结果',
        narrativePerspective: result.narrativePerspective || '',
        tone: result.tone || '',
        pace: result.pace || '',
        sentenceStyle: result.sentenceStyle || '',
        dialogueRatio: Math.round((result.dialogueRatio || 0.35) * 100),
        descriptionRatio: Math.round((result.descriptionRatio || 0.4) * 100),
        styleSummary: result.styleSummary || '',
      });
    } catch (e: unknown) {
      if (analyzeAbortRef.current !== controller || !mountedRef.current) return;
      if (controller.signal.aborted || isAiRequestCancelled(e)) {
        setAnalyzeError('');
        setAnalyzeStatus('分析已停止');
      } else {
        setAnalyzeError(describeUnknownError(e, '分析失败'));
      }
    } finally {
      if (analyzeAbortRef.current === controller) {
        analyzeAbortRef.current = null;
        if (mountedRef.current) setAnalyzing(false);
      }
    }
  };

  const applyAnalyzeResult = () => {
    setShowAnalyze(false);
    setShowStyleForm(true);
    setEditingStyle(null);
  };

  const tabs: { key: StyleProfilesTab; label: string }[] = [
    { key: 'styles', label: '风格方案' },
    { key: 'outputs', label: '输出控制' },
    { key: 'imports', label: '导入记录' },
  ];

  return (
    <>
      <StyleProfilesContent
        tab={tab}
        setTab={setTab}
        tabs={tabs}
        styles={styles}
        outputs={outputs}
        assets={assets}
        setAssets={setAssets}
        msg={msg}
        flash={flash}
        setEditingStyle={setEditingStyle}
        setStyleForm={setStyleForm}
        setShowStyleForm={setShowStyleForm}
        setAnalyzeText={setAnalyzeText}
        setAnalyzeResult={setAnalyzeResult}
        setAnalyzeError={setAnalyzeError}
        setShowAnalyze={setShowAnalyze}
        setEditingOutput={setEditingOutput}
        setOutputForm={setOutputForm}
        setShowOutputForm={setShowOutputForm}
        editStyle={editStyle}
        deleteStyle={deleteStyle}
        deleteOutput={deleteOutput}
        onBack={() => navigate('/')}
      />
      <StyleProfileDialogs
        showStyleForm={showStyleForm}
        setShowStyleForm={setShowStyleForm}
        editingStyle={editingStyle}
        styleForm={styleForm}
        setStyleForm={setStyleForm}
        saveStyle={saveStyle}
        showOutputForm={showOutputForm}
        setShowOutputForm={setShowOutputForm}
        editingOutput={editingOutput}
        outputForm={outputForm}
        setOutputForm={setOutputForm}
        saveOutput={saveOutput}
        showAnalyze={showAnalyze}
        closeAnalyzeDialog={closeAnalyzeDialog}
        analyzeText={analyzeText}
        setAnalyzeText={setAnalyzeText}
        analyzeError={analyzeError}
        analyzeStatus={analyzeStatus}
        analyzeResult={analyzeResult}
        analyzing={analyzing}
        applyAnalyzeResult={applyAnalyzeResult}
        stopAnalyze={stopAnalyze}
        handleAnalyze={handleAnalyze}
      />
    </>
  );
}

export default StyleProfilesPage;
