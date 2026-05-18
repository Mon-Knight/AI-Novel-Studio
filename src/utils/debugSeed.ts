/**
 * Debug helper: seed bad novels into localStorage for testing repairs
 */
import { lsSet } from '../services/database/db';

export function seedBadNovels() {
  const key = 'ai_novel_studio_novels';
  const data = [
    null,
    {},
    { title: '缺少 id 的作品' },
    { id: 'bad-date', title: '坏日期作品', updatedAt: 'Invalid Date' },
    { id: 'bad-number', title: '坏数字作品', totalWordCount: 'abc' },
    { id: 'missing-count', title: '缺少字数字段作品' },
  ];
  try {
    lsSet(key, data);
    console.info('[debugSeed] seeded bad novels into localStorage');
  } catch (e) {
    console.error('[debugSeed] seed failed', e);
  }
}

export default seedBadNovels;
