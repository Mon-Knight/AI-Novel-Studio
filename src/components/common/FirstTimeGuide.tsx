/**
 * AI Novel Studio - 首次使用引导组件
 */
import { useState } from 'react';

const GUIDE_KEY = 'ai_novel_studio_guide_dismissed';

function FirstTimeGuide() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(GUIDE_KEY));

  const dismiss = () => {
    localStorage.setItem(GUIDE_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
      border: '1px solid var(--color-border-light)',
      borderRadius: 12,
      padding: 20,
      marginBottom: 16,
      position: 'relative',
    }}>
      <button onClick={dismiss} style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--color-text-muted)' }}>✕</button>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>🚀 AI Novel Studio 基础创作流程</div>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 2 }}>
        <div>1. 📖 <strong>创建作品</strong> — 填写作品名称、题材和简介</div>
        <div>2. 🌍 <strong>填写世界背景</strong> — 输入大致世界观和规则体系</div>
        <div>3. 👤 <strong>设定主角</strong> — 定义主角性格、能力和限制</div>
        <div>4. 📚 <strong>创建分卷与章节</strong> — 规划长篇结构</div>
        <div>5. 👥 <strong>添加角色</strong> — 建立角色库，选择本章出场角色</div>
        <div>6. ⚡ <strong>添加事件</strong> — 规划本章必须发生的剧情</div>
        <div>7. ✏️ <strong>进入写作工作台</strong> — AI 逐章生成正文</div>
        <div>8. ✅ <strong>确认采用</strong> — 选择满意的草稿版本作为正式正文</div>
        <div>9. 📝 <strong>生成章节总结</strong> — 沉淀上下文供后续章节使用</div>
        <div>10. 📦 <strong>导出作品</strong> — 在作品详情页导出 TXT / Markdown</div>
      </div>
    </div>
  );
}

export default FirstTimeGuide;
