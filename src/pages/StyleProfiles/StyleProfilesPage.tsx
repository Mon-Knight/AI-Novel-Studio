import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import { styleProfileService } from '../../services/styles/styleProfileService';
import { outputProfileService } from '../../services/styles/outputProfileService';
import { importedAssetService } from '../../services/styles/importedAssetService';
import { analyzeStyle } from '../../services/styles/styleAnalyzeService';
import type { StyleProfile, StyleAnalyzeResult } from '../../types/style';
import type { OutputProfile } from '../../types/output';
import type { ImportedAsset } from '../../types/importedAsset';
import { formatNumber } from '../../utils/format';

type TabType = 'styles' | 'outputs' | 'imports';

function StyleProfilesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabType>('styles');
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [outputs, setOutputs] = useState<OutputProfile[]>([]);
  const [assets, setAssets] = useState<ImportedAsset[]>([]);
  const [msg, setMsg] = useState('');

  const [showStyleForm, setShowStyleForm] = useState(false);
  const [editingStyle, setEditingStyle] = useState<StyleProfile | null>(null);
  const [styleForm, setStyleForm] = useState({ name: '', narrativePerspective: '', tone: '', pace: '', sentenceStyle: '', dialogueRatio: 35, descriptionRatio: 40, styleSummary: '' });

  const [showOutputForm, setShowOutputForm] = useState(false);
  const [editingOutput, setEditingOutput] = useState<OutputProfile | null>(null);
  const [outputForm, setOutputForm] = useState({ name: '', targetWordCount: 4000, paceLevel: 'medium' as 'slow' | 'medium' | 'fast', dialogueRatio: 35, descriptionRatio: 40 });

  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeText, setAnalyzeText] = useState('');
  const [analyzeResult, setAnalyzeResult] = useState<StyleAnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  useEffect(() => { styleProfileService.getAll().then(setStyles).catch(() => {}); }, []);
  useEffect(() => { outputProfileService.getAll().then(setOutputs).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'imports') importedAssetService.getAll().then(setAssets).catch(() => {}); }, [tab]);

  const saveStyle = async () => {
    if (!styleForm.name.trim()) return flash('请输入风格名称');
    const input = { ...styleForm, dialogueRatio: styleForm.dialogueRatio / 100, descriptionRatio: styleForm.descriptionRatio / 100 };
    if (editingStyle) { await styleProfileService.update(editingStyle.id, { ...input, sourceType: 'manual' as const }); flash('已更新'); }
    else { await styleProfileService.create({ ...input, sourceType: 'manual' }); flash('已创建'); }
    setShowStyleForm(false); setEditingStyle(null);
    styleProfileService.getAll().then(setStyles);
  };

  const editStyle = (s: StyleProfile) => {
    setEditingStyle(s);
    setStyleForm({ name: s.name, narrativePerspective: s.narrativePerspective || '', tone: s.tone || '', pace: s.pace || '', sentenceStyle: s.sentenceStyle || '', dialogueRatio: Math.round(s.dialogueRatio * 100), descriptionRatio: Math.round(s.descriptionRatio * 100), styleSummary: s.styleSummary || '' });
    setShowStyleForm(true);
  };

  const deleteStyle = async (id: string, name: string) => {
    if (!confirm(`确定删除「${name}」？`)) return;
    await styleProfileService.remove(id); flash('已删除');
    styleProfileService.getAll().then(setStyles);
  };

  const saveOutput = async () => {
    if (!outputForm.name.trim()) return flash('请输入方案名称');
    if (editingOutput) { await outputProfileService.update(editingOutput.id, outputForm); flash('已更新'); }
    else { await outputProfileService.create({ ...outputForm, dialogueRatio: outputForm.dialogueRatio / 100, descriptionRatio: outputForm.descriptionRatio / 100 } as Parameters<typeof outputProfileService.create>[0]); flash('已创建'); }
    setShowOutputForm(false); setEditingOutput(null);
    outputProfileService.getAll().then(setOutputs);
  };

  const deleteOutput = async (id: string, name: string) => {
    if (!confirm(`确定删除「${name}」？`)) return;
    await outputProfileService.remove(id); flash('已删除');
    outputProfileService.getAll().then(setOutputs);
  };

  const handleAnalyze = async () => {
    if (!analyzeText.trim()) return setAnalyzeError('请输入参考文本');
    setAnalyzing(true); setAnalyzeError(''); setAnalyzeResult(null);
    try {
      const result = await analyzeStyle(analyzeText);
      setAnalyzeResult(result);
      setStyleForm({ name: result.name || '分析结果', narrativePerspective: result.narrativePerspective || '', tone: result.tone || '', pace: result.pace || '', sentenceStyle: result.sentenceStyle || '', dialogueRatio: Math.round((result.dialogueRatio || 0.35) * 100), descriptionRatio: Math.round((result.descriptionRatio || 0.4) * 100), styleSummary: result.styleSummary || '' });
    } catch (e: unknown) { setAnalyzeError(e instanceof Error ? e.message : '分析失败'); }
    setAnalyzing(false);
  };

  const applyAnalyzeResult = () => { setShowAnalyze(false); setShowStyleForm(true); setEditingStyle(null); };

  const tabs: { key: TabType; label: string }[] = [
    { key: 'styles', label: '风格方案' }, { key: 'outputs', label: '输出控制' }, { key: 'imports', label: '导入记录' },
  ];

  const sourceLabel = (s: StyleProfile) => s.sourceType === 'manual' ? '手动' : s.sourceType === 'txt_analysis' ? 'TXT分析' : s.sourceType === 'json_import' ? 'JSON导入' : '系统默认';

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <BackButton label="返回首页" to="/" />
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>🎨 风格方案管理</div>
      <div className="text-sm text-muted" style={{ marginBottom: 20 }}>管理可复用的写作风格画像和输出控制方案。</div>
      {msg && <div style={{ fontSize: 13, padding: '6px 12px', background: 'var(--color-primary-light)', borderRadius: 6, marginBottom: 16, color: 'var(--color-primary)' }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--color-border)' }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '8px 20px', fontSize: 14, fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: tab === t.key ? '2px solid var(--color-primary)' : '2px solid transparent', marginBottom: -2, background: 'none', cursor: 'pointer' }}>
            {t.label} ({t.key === 'styles' ? styles.length : t.key === 'outputs' ? outputs.length : assets.length})
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {tab === 'styles' && <><button className="btn btn-primary btn-sm" onClick={() => { setEditingStyle(null); setStyleForm({ name: '', narrativePerspective: '', tone: '', pace: '', sentenceStyle: '', dialogueRatio: 35, descriptionRatio: 40, styleSummary: '' }); setShowStyleForm(true); }}>+ 新建风格</button><button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} onClick={() => { setAnalyzeText(''); setAnalyzeResult(null); setAnalyzeError(''); setShowAnalyze(true); }}>📄 TXT分析</button></>}
        {tab === 'outputs' && <button className="btn btn-primary btn-sm" onClick={() => { setEditingOutput(null); setOutputForm({ name: '', targetWordCount: 4000, paceLevel: 'medium', dialogueRatio: 35, descriptionRatio: 40 }); setShowOutputForm(true); }}>+ 新建方案</button>}
      </div>

      {/* 风格列表 */}
      {tab === 'styles' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {styles.map((s) => (
            <div key={s.id} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, background: 'var(--color-bg-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</span><span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}>{sourceLabel(s)}</span></div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
                {s.narrativePerspective && <div>👁️ {s.narrativePerspective}</div>}
                {s.tone && <div>🎭 {s.tone}</div>}
                {s.pace && <div>⚡ {s.pace}</div>}
                <div>💬 {Math.round(s.dialogueRatio * 100)}% · 🖊️ {Math.round(s.descriptionRatio * 100)}%</div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => editStyle(s)}>✏️</button>
                {s.sourceType !== 'system_default' && <button className="btn btn-secondary btn-sm" onClick={() => deleteStyle(s.id, s.name)} style={{ color: 'var(--color-error)' }}>🗑️</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 输出控制列表 */}
      {tab === 'outputs' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {outputs.map((o) => (
            <div key={o.id} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, background: o.isDefault ? 'var(--color-primary-light)' : 'var(--color-bg-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 600, fontSize: 15 }}>{o.name}</span>{o.isDefault && <span style={{ fontSize: 11, color: 'var(--color-primary)', fontWeight: 600 }}>默认</span>}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}><div>📊 {formatNumber(o.targetWordCount ?? o.chapterWordRange.default)} 字</div><div>⚡ {o.paceLevel === 'fast' ? '快' : o.paceLevel === 'slow' ? '慢' : '中等'}</div></div>
              <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => { setEditingOutput(o); setOutputForm({ name: o.name, targetWordCount: o.targetWordCount || 4000, paceLevel: o.paceLevel || 'medium', dialogueRatio: 35, descriptionRatio: 40 }); setShowOutputForm(true); }}>✏️</button>
                {!o.isDefault && <button className="btn btn-secondary btn-sm" onClick={() => deleteOutput(o.id, o.name)} style={{ color: 'var(--color-error)' }}>🗑️</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 导入记录 */}
      {tab === 'imports' && (
        <div>{assets.length === 0 ? <div className="text-muted" style={{ textAlign: 'center', padding: 40 }}>暂无导入记录</div> : assets.map((a) => (
          <div key={a.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div><span style={{ fontWeight: 500 }}>{a.fileName}</span><span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 8 }}>{a.fileType.toUpperCase()}</span></div>
            <button className="btn btn-secondary btn-sm" onClick={async () => { await importedAssetService.remove(a.id); flash('已删除'); importedAssetService.getAll().then(setAssets); }}>🗑️</button>
          </div>
        ))}</div>
      )}

      {/* 风格表单弹窗 */}
      {showStyleForm && (
        <div className="modal-overlay" onClick={() => setShowStyleForm(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-title">{editingStyle ? '编辑风格方案' : '新建风格方案'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '70vh', overflowY: 'auto' }}>
              <div><label className="panel-field-label">名称 *</label><input className="form-input" value={styleForm.name} onChange={e => setStyleForm({...styleForm, name: e.target.value})} style={{width:'100%'}} /></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}><div><label className="panel-field-label">叙事人称</label><input className="form-input" value={styleForm.narrativePerspective} onChange={e => setStyleForm({...styleForm, narrativePerspective: e.target.value})} style={{width:'100%'}} /></div><div><label className="panel-field-label">文风语气</label><input className="form-input" value={styleForm.tone} onChange={e => setStyleForm({...styleForm, tone: e.target.value})} style={{width:'100%'}} /></div></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}><div><label className="panel-field-label">节奏</label><select className="panel-select" value={styleForm.pace} onChange={e => setStyleForm({...styleForm, pace: e.target.value})}><option value="">-</option><option>快</option><option>中等</option><option>慢</option></select></div><div><label className="panel-field-label">句式特点</label><input className="form-input" value={styleForm.sentenceStyle} onChange={e => setStyleForm({...styleForm, sentenceStyle: e.target.value})} style={{width:'100%'}} /></div></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}><div><label className="panel-field-label">对话比例 {styleForm.dialogueRatio}%</label><input type="range" min={0} max={100} value={styleForm.dialogueRatio} onChange={e => setStyleForm({...styleForm, dialogueRatio: Number(e.target.value)})} style={{width:'100%'}} /></div><div><label className="panel-field-label">描写比例 {styleForm.descriptionRatio}%</label><input type="range" min={0} max={100} value={styleForm.descriptionRatio} onChange={e => setStyleForm({...styleForm, descriptionRatio: Number(e.target.value)})} style={{width:'100%'}} /></div></div>
              <div><label className="panel-field-label">风格总结</label><textarea className="form-textarea" value={styleForm.styleSummary} onChange={e => setStyleForm({...styleForm, styleSummary: e.target.value})} style={{width:'100%',height:60,resize:'vertical'}} /></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button className="btn btn-secondary" onClick={() => setShowStyleForm(false)}>取消</button><button className="btn btn-primary" onClick={saveStyle}>{editingStyle ? '保存' : '创建'}</button></div>
            </div>
          </div>
        </div>
      )}

      {/* 输出控制弹窗 */}
      {showOutputForm && (
        <div className="modal-overlay" onClick={() => setShowOutputForm(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-title">{editingOutput ? '编辑输出方案' : '新建输出方案'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div><label className="panel-field-label">名称 *</label><input className="form-input" value={outputForm.name} onChange={e => setOutputForm({...outputForm, name: e.target.value})} style={{width:'100%'}} /></div>
              <div><label className="panel-field-label">目标字数</label><input type="number" className="form-input" value={outputForm.targetWordCount} onChange={e => setOutputForm({...outputForm, targetWordCount: Number(e.target.value)})} style={{width:'100%'}} /></div>
              <div><label className="panel-field-label">节奏</label><select className="panel-select" value={outputForm.paceLevel} onChange={e => setOutputForm({...outputForm, paceLevel: e.target.value as 'slow'|'medium'|'fast'})}><option value="slow">慢</option><option value="medium">中等</option><option value="fast">快</option></select></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button className="btn btn-secondary" onClick={() => setShowOutputForm(false)}>取消</button><button className="btn btn-primary" onClick={saveOutput}>{editingOutput ? '保存' : '创建'}</button></div>
            </div>
          </div>
        </div>
      )}

      {/* TXT 分析弹窗 */}
      {showAnalyze && (
        <div className="modal-overlay" onClick={() => setShowAnalyze(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="modal-title">📄 TXT 风格分析</div>
            <div className="text-sm text-muted" style={{ marginBottom: 12 }}>粘贴参考文本，AI 分析抽象风格。不会复制原文。</div>
            <textarea className="form-textarea" value={analyzeText} onChange={e => setAnalyzeText(e.target.value)} placeholder="在此粘贴参考文本..." style={{ width: '100%', height: 180, resize: 'vertical', fontSize: 14 }} />
            {analyzeError && <div style={{ fontSize: 13, color: 'var(--color-error)', marginTop: 8 }}>{analyzeError}</div>}
            {analyzeResult && <div style={{ marginTop: 12, padding: 12, background: '#e8f5e9', borderRadius: 8, fontSize: 13 }}><strong>分析完成：</strong>{analyzeResult.styleSummary}<br /><button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={applyAnalyzeResult}>应用并创建风格方案</button></div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}><button className="btn btn-secondary" onClick={() => setShowAnalyze(false)}>取消</button><button className="btn btn-primary" onClick={handleAnalyze} disabled={analyzing}>{analyzing ? '分析中...' : '🤖 分析'}</button></div>
          </div>
        </div>
      )}

      <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ marginTop: 20 }}>← 返回首页</button>
    </div>
  );
}

export default StyleProfilesPage;
