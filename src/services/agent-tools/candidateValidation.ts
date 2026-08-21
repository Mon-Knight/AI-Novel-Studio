function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.search(/[[{]/);
    if (start < 0) return undefined;
    try {
      return JSON.parse(trimmed.slice(start)) as unknown;
    } catch {
      return undefined;
    }
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function namesFrom(value: unknown, keys: string[], nameKey: 'name' | 'title'): string[] {
  const object = record(value);
  const nested = record(object?.data);
  const lists = [value, object?.[keys[0] ?? ''], nested?.[keys[0] ?? '']];
  for (const key of keys) {
    lists.push(object?.[key], nested?.[key]);
  }
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const names = list
      .map((item) => {
        const row = record(item);
        return typeof row?.[nameKey] === 'string' ? row[nameKey].trim() : '';
      })
      .filter(Boolean);
    if (names.length > 0) return names;
  }
  const single = record(value);
  const name = typeof single?.[nameKey] === 'string' ? single[nameKey].trim() : '';
  return name ? [name] : [];
}

export function validateCandidateText(artifactType: string, candidateText: string): string {
  const text = candidateText.trim();
  if (!text) throw new Error('候选内容不能为空。');
  if (Array.from(text).length > 400_000) throw new Error('候选内容超过长度上限。');

  if (artifactType === 'chapter_text' || artifactType === 'scene_text') {
    if (Array.from(text).length < 8) throw new Error('章节候选过短。');
    return candidateText;
  }

  const parsed = parseJson(text);
  if (artifactType === 'outline') {
    const object = record(parsed);
    if (!object && Array.from(text).length < 20) {
      throw new Error('大纲候选必须是 JSON 对象或足够长的正文。');
    }
    return candidateText;
  }
  if (artifactType === 'character_candidates') {
    if (namesFrom(parsed, ['characters', 'candidates'], 'name').length === 0) {
      throw new Error('角色候选必须包含至少一个带 name 的条目。');
    }
    return candidateText;
  }
  if (artifactType === 'event_candidates') {
    if (namesFrom(parsed, ['events', 'suggestions', 'candidates'], 'title').length === 0) {
      throw new Error('事件候选必须包含至少一个带 title 的条目。');
    }
    return candidateText;
  }
  if (artifactType === 'setting_candidates') {
    const object = record(parsed);
    const settings = object?.settings ?? object?.candidates ?? parsed;
    const names = namesFrom(settings, ['settings', 'candidates'], 'name');
    if (names.length === 0 && namesFrom(parsed, ['settings', 'candidates'], 'name').length === 0) {
      throw new Error('设定候选必须包含至少一个带 name 的条目。');
    }
    return candidateText;
  }
  if (artifactType === 'quality_report') {
    const object = record(parsed);
    if (!object || (typeof object.summary !== 'string' && !Array.isArray(object.issues))) {
      throw new Error('质量报告必须是包含 summary 或 issues 的 JSON。');
    }
    return candidateText;
  }
  if (artifactType === 'chapter_summary' || artifactType === 'volume_summary') {
    const object = record(parsed);
    const summary = typeof object?.summary === 'string' ? object.summary.trim() : '';
    if (!summary && Array.from(text).length < 12) {
      throw new Error('总结候选过短。');
    }
    return candidateText;
  }
  return candidateText;
}
