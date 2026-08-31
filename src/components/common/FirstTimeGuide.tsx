/**
 * AI Novel Studio - 首次使用引导组件
 */
import { useState } from 'react';
import {
  BookOpenText,
  Boxes,
  CircleCheck,
  FileText,
  Globe2,
  Library,
  Rocket,
  Sparkles,
  UserRound,
  UsersRound,
  X,
  Zap,
} from 'lucide-react';

const GUIDE_KEY = 'ai_novel_studio_guide_dismissed';

function FirstTimeGuide() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(GUIDE_KEY));

  const dismiss = () => {
    localStorage.setItem(GUIDE_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      data-testid="first-time-guide"
      style={{
        background:
          'linear-gradient(135deg, var(--color-info-bg) 0%, var(--color-success-bg) 100%)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        position: 'relative',
      }}
    >
      <button
        data-testid="first-time-guide-dismiss"
        aria-label="关闭首次使用指南"
        onClick={dismiss}
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          background: 'none',
          border: 'none',
          fontSize: 18,
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
        }}
      >
        <X aria-hidden="true" size={18} strokeWidth={1.8} />
      </button>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 18,
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        <Rocket aria-hidden="true" size={18} strokeWidth={1.8} />
        AI Novel Studio 基础创作流程
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          1. <BookOpenText aria-hidden="true" size={15} strokeWidth={1.8} />{' '}
          <strong>创建作品</strong> — 填写作品名称、题材和简介
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          2. <Globe2 aria-hidden="true" size={15} strokeWidth={1.8} /> <strong>填写世界背景</strong>{' '}
          — 输入大致世界观和规则体系
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          3. <UserRound aria-hidden="true" size={15} strokeWidth={1.8} /> <strong>设定主角</strong>{' '}
          — 定义主角性格、能力和限制
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          4. <Library aria-hidden="true" size={15} strokeWidth={1.8} />{' '}
          <strong>创建分卷与章节</strong> — 规划长篇结构
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          5. <UsersRound aria-hidden="true" size={15} strokeWidth={1.8} /> <strong>添加角色</strong>{' '}
          — 建立角色库，选择本章出场角色
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          6. <Zap aria-hidden="true" size={15} strokeWidth={1.8} /> <strong>添加事件</strong> —
          规划本章必须发生的剧情
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          7. <Sparkles aria-hidden="true" size={15} strokeWidth={1.8} />{' '}
          <strong>打开创作工作台</strong> — 选择章节后用对话生成候选正文
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          8. <CircleCheck aria-hidden="true" size={15} strokeWidth={1.8} />{' '}
          <strong>确认采用</strong> — 选择满意的草稿版本作为正式正文
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          9. <FileText aria-hidden="true" size={15} strokeWidth={1.8} />{' '}
          <strong>生成章节总结</strong> — 沉淀上下文供后续章节使用
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          10. <Boxes aria-hidden="true" size={15} strokeWidth={1.8} /> <strong>导出作品</strong> —
          在作品详情页导出 TXT / Markdown
        </div>
      </div>
    </div>
  );
}

export default FirstTimeGuide;
