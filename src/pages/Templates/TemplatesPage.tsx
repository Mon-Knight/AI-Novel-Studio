/**
 * AI Novel Studio - 模板中心页面
 */
import { useState } from 'react';
import BackButton from '../../components/common/BackButton';

interface BuiltInTemplate {
  id: string; type: string; title: string; genre: string; description: string; content: string;
}

const BUILTIN_TEMPLATES: BuiltInTemplate[] = [
  { id: 'tpl-001', type: '作品模板', title: '玄幻长篇模板', genre: '玄幻', description: '适合东方玄幻题材的长篇架构', content: '# 玄幻长篇结构\n## 第一卷：觉醒\n- 第1-3章：主角身世之谜初现\n- 第4-6章：意外获得传承或特殊能力\n- 第7-9章：首次冲突与成长\n## 第二卷：试炼\n...' },
  { id: 'tpl-002', type: '作品模板', title: '科幻探索模板', genre: '科幻', description: '适合科幻探索题材的长篇架构', content: '# 科幻探索结构\n## 第一卷：接触\n- 第1-3章：异常现象发现\n- 第4-6章：深入调查\n- 第7-9章：首次接触与危机\n## 第二卷：真相\n...' },
  { id: 'tpl-003', type: '章节大纲', title: '战斗章节模板', genre: '通用', description: '高强度战斗章节的大纲结构', content: '# 战斗章节大纲\n## 战斗目标\n## 敌方设定\n## 战斗阶段\n1. 试探期\n2. 劣势期\n3. 转折点\n4. 反击期\n5. 战后总结' },
  { id: 'tpl-004', type: '章节大纲', title: '日常过渡模板', genre: '通用', description: '连接大事件的日常章节大纲', content: '# 日常过渡章节\n## 主线回顾\n## 角色互动\n## 信息铺垫\n## 下一章钩子' },
  { id: 'tpl-005', type: '角色模板', title: '主角设定模板', genre: '通用', description: '完整的主角设定框架', content: '# 主角设定\n## 基本信息\n- 姓名、年龄、身份\n## 性格特征\n## 特殊能力\n## 能力限制\n## 行为禁忌\n## 角色弧光' },
  { id: 'tpl-006', type: '角色模板', title: '反派设定模板', genre: '通用', description: '反派角色设定框架', content: '# 反派设定\n## 基本信息\n## 动机与目标\n## 能力与资源\n## 与主角关系\n## 行为逻辑\n## 弱点' },
  { id: 'tpl-007', type: '输出控制', title: '快节奏输出方案', genre: '通用', description: '适合快节奏故事的输出控制', content: '{ "paceLevel": "fast", "dialogueRatio": 0.4, "descriptionRatio": 0.2, "endingHookRequired": true, "targetWordCount": 3500 }' },
  { id: 'tpl-008', type: '输出控制', title: '厚重输出方案', genre: '通用', description: '适合史诗厚重风格的输出控制', content: '{ "paceLevel": "slow", "dialogueRatio": 0.25, "descriptionRatio": 0.45, "endingHookRequired": false, "targetWordCount": 5500 }' },
];

const TYPE_FILTERS = ['全部', '作品模板', '章节大纲', '角色模板', '输出控制'];

function TemplatesPage() {
  const [filter, setFilter] = useState('全部');
  const [msg, setMsg] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = BUILTIN_TEMPLATES.filter((t) => filter === '全部' || t.type === filter);

  const handleUse = async (tpl: BuiltInTemplate) => {
    try {
      await navigator.clipboard.writeText(tpl.content);
      setMsg(`「${tpl.title}」内容已复制到剪贴板，可粘贴到作品设定或章节大纲中使用`);
      setTimeout(() => setMsg(''), 3000);
    } catch {
      setMsg('复制失败，请手动复制下方内容');
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 800, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <BackButton label="返回首页" to="/" />
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>📋 模板中心</div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>提供内置创作模板，帮助快速搭建小说架构和章节大纲</div>

      {msg && <div style={{ padding: '8px 16px', marginBottom: 16, background: 'var(--color-primary-light)', borderRadius: 6, fontSize: 13, color: 'var(--color-primary)' }}>{msg}</div>}

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TYPE_FILTERS.map((f) => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {/* 模板列表 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {filtered.map((tpl) => (
          <div key={tpl.id} className="detail-card" style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === tpl.id ? null : tpl.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--color-bg-primary)', color: 'var(--color-text-muted)', marginRight: 6 }}>{tpl.type}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{tpl.genre}</span>
              </div>
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{tpl.title}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{tpl.description}</div>
            {expandedId === tpl.id && (
              <div style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--color-bg-primary)', padding: 8, borderRadius: 4, marginBottom: 8, maxHeight: 200, overflowY: 'auto', color: 'var(--color-text-secondary)' }}>
                {tpl.content}
              </div>
            )}
            <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); handleUse(tpl); }} style={{ width: '100%' }}>
              📋 使用模板
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TemplatesPage;
