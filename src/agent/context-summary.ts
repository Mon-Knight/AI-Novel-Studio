// src/agent/context-summary.ts
// AI Novel Studio — Agent 上下文摘要格式化
// 版本：v1.0.46
// 用途：把 Tool Layer 读取结果转换成 Agent 可显示的中文文本
// 安全：不调用 AI，不写数据库，不修改数据

/**
 * Agent 上下文摘要输入
 */
export interface ContextSummaryInput {
  /** 项目/作品信息 */
  project?: unknown;
  /** 章节信息 */
  chapter?: unknown;
  /** 风格方案信息 */
  style?: unknown;
  /** 输出控制信息 */
  outputControl?: unknown;
  /** 警告列表 */
  warnings?: string[];
}

/**
 * 格式化 Agent 上下文摘要
 *
 * 将 Tool Layer 读取的数据转换为结构化的中文摘要文本。
 * 能处理空值和缺失字段，不因字段缺失而崩溃。
 *
 * @param input - 上下文信息
 * @returns 格式化后的中文摘要字符串
 */
export function formatAgentContextSummary(input: ContextSummaryInput): string {
  const lines: string[] = [];
  lines.push('=== AI Novel Studio Agent 上下文摘要 ===\n');

  // ---- 作品信息 ----
  lines.push('--- 作品信息 ---');
  if (input.project) {
    const p = input.project as Record<string, unknown>;
    if (p.novel) {
      const novel = p.novel as Record<string, unknown>;
      lines.push(`  名称: ${novel.title ?? '(未知)'}`);
      lines.push(`  ID: ${novel.id ?? '?'}`);
      if (novel.status) lines.push(`  状态: ${novel.status}`);
      if (typeof novel.totalWordCount === 'number') {
        lines.push(`  总字数: ${novel.totalWordCount.toLocaleString()}`);
      }
    } else {
      lines.push('  (未获取到作品数据)');
    }
  } else {
    lines.push('  缺失: 未提供作品信息');
  }

  // ---- 章节信息 ----
  lines.push('\n--- 章节信息 ---');
  if (input.chapter) {
    const c = input.chapter as Record<string, unknown>;
    if (c.chapter) {
      const ch = c.chapter as Record<string, unknown>;
      lines.push(`  标题: ${ch.title ?? '(未知)'}`);
      lines.push(`  ID: ${ch.id ?? '?'}`);
      if (ch.status) lines.push(`  状态: ${ch.status}`);
      if (typeof ch.targetWordCount === 'number') {
        lines.push(`  目标字数: ${ch.targetWordCount.toLocaleString()}`);
      }
      if (typeof ch.wordCount === 'number') {
        lines.push(`  当前字数: ${(ch.wordCount as number).toLocaleString()}`);
      }
    }
    if (c.chapterCharacters) {
      const chars = c.chapterCharacters as unknown[];
      if (Array.isArray(chars)) {
        lines.push(`  出场角色: ${chars.length} 人`);
      }
    }
    if (c.chapterEvents) {
      const events = c.chapterEvents as unknown[];
      if (Array.isArray(events)) {
        lines.push(`  章节事件: ${events.length} 个`);
      }
    }
  } else {
    lines.push('  缺失: 未提供章节信息');
  }

  // ---- 风格信息 ----
  lines.push('\n--- 风格信息 ---');
  if (input.style) {
    const s = input.style as Record<string, unknown>;
    if (s.activeStyle) {
      const st = s.activeStyle as Record<string, unknown>;
      lines.push(`  方案: ${st.name ?? '(未知)'}`);
      if (st.narrativePerspective) lines.push(`  叙事: ${st.narrativePerspective}`);
      if (st.pace) lines.push(`  节奏: ${st.pace}`);
      if (typeof st.dialogueRatio === 'number') {
        lines.push(`  对话比例: ${st.dialogueRatio}%`);
      }
      if (typeof st.descriptionRatio === 'number') {
        lines.push(`  描写比例: ${st.descriptionRatio}%`);
      }
    } else {
      lines.push('  未配置风格方案');
    }
  } else {
    lines.push('  缺失: 未提供风格信息');
  }

  // ---- 输出控制 ----
  lines.push('\n--- 输出控制 ---');
  if (input.outputControl) {
    const oc = input.outputControl as Record<string, unknown>;
    if (oc.activeProfile) {
      const ap = oc.activeProfile as Record<string, unknown>;
      lines.push(`  方案: ${ap.name ?? '(未知)'}`);
      if (typeof ap.targetWordCount === 'number') {
        lines.push(`  目标字数: ${ap.targetWordCount}`);
      }
      if (ap.paceLevel) lines.push(`  节奏: ${ap.paceLevel}`);
      if (ap.povType) lines.push(`  视角: ${ap.povType}`);
      if (ap.tenseType) lines.push(`  时态: ${ap.tenseType}`);
    } else {
      lines.push('  未配置输出控制方案');
    }
  } else {
    lines.push('  (未提供输出控制信息)');
  }

  // ---- 警告 ----
  if (input.warnings && input.warnings.length > 0) {
    lines.push('\n--- 警告 ---');
    for (const w of input.warnings) {
      lines.push(`  ${w}`);
    }
  }

  // ---- 完整度评估 ----
  lines.push('\n--- 完整度评估 ---');
  const checks: { label: string; ok: boolean }[] = [
    { label: '作品信息', ok: input.project != null },
    { label: '章节信息', ok: input.chapter != null },
    {
      label: '风格方案',
      ok: input.style != null && (input.style as Record<string, unknown>).activeStyle != null,
    },
    { label: '输出控制', ok: input.outputControl != null },
  ];
  const ready = checks.filter((c) => c.ok).length;
  const total = checks.length;
  lines.push(`  就绪项: ${ready}/${total}`);
  for (const c of checks) {
    lines.push(`  ${c.ok ? '[通过]' : '[缺失]'} ${c.label}`);
  }
  if (ready === total) {
    lines.push('\n  状态: 上下文准备就绪，可以开始生成');
  } else {
    lines.push(`\n  状态: 缺少 ${total - ready} 项，建议先完善`);
  }

  lines.push('\n=== 摘要结束 ===');
  return lines.join('\n');
}
