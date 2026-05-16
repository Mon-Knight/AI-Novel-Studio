/**
 * AI Novel Studio - Mock 风格数据
 */
import type { StyleProfile } from '../../types/style';
import type { OutputProfile } from '../../types/output';
import type { Character } from '../../types/character';

export const mockStyleProfiles: StyleProfile[] = [
  {
    id: 'style-001',
    novelId: 'novel-001',
    name: '科幻快节奏',
    description: '适合科幻小说的快节奏风格，注重情节推进和场景转换',
    targetWordsPerChapter: 4000,
    rhythmPreference: 'fast',
    dialogueRatio: 0.35,
    descriptionRatio: 0.25,
    prohibitedStyles: ['过度心理描写', '长篇景物描写', '说教式表达'],
    createdAt: '2026-05-10T08:00:00Z',
    updatedAt: '2026-05-10T08:00:00Z',
  },
  {
    id: 'style-002',
    novelId: 'novel-001',
    name: '仙侠厚重',
    description: '适合仙侠小说的厚重风格，注重意境营造和打斗场面描写',
    targetWordsPerChapter: 5000,
    rhythmPreference: 'moderate',
    dialogueRatio: 0.3,
    descriptionRatio: 0.4,
    prohibitedStyles: ['现代口语', '西式表达', '网络流行语'],
    createdAt: '2026-05-10T09:00:00Z',
    updatedAt: '2026-05-10T09:00:00Z',
  },
];

export const mockOutputProfiles: OutputProfile[] = [
  {
    id: 'output-001',
    novelId: 'novel-001',
    name: '默认输出方案',
    description: '标准章节输出配置',
    chapterWordRange: { min: 3000, max: 6000, default: 4000 },
    paragraphLength: 'medium',
    povType: 'third_person_limited',
    tenseType: 'past',
    createdAt: '2026-05-10T10:00:00Z',
    updatedAt: '2026-05-10T10:00:00Z',
  },
  {
    id: 'output-002',
    novelId: 'novel-001',
    name: '第一人称方案',
    description: '使用第一人称视角写作',
    chapterWordRange: { min: 2500, max: 5000, default: 3500 },
    paragraphLength: 'medium',
    povType: 'first_person',
    tenseType: 'present',
    createdAt: '2026-05-10T11:00:00Z',
    updatedAt: '2026-05-10T11:00:00Z',
  },
];

export const mockCharacters: Character[] = [
  {
    id: 'char-001',
    novelId: 'novel-001',
    name: '林远',
    role: 'protagonist',
    description: '二十七岁的航天工程师，在一次意外中被传送到第七前哨站。聪明、冷静，但内心深处有着不愿面对的过去。',
    personality: '理性冷静，善于观察和分析，但在情感表达上较为内敛',
    goals: '找到回家的方法，同时揭开第七前哨站背后的真相',
    restrictions: '不能杀人（除非自卫），不能背叛朋友',
    currentState: '刚刚在第七前哨站醒来，对周围环境一无所知',
    relationships: [],
    isConfirmed: true,
    createdAt: '2026-05-10T08:00:00Z',
  },
  {
    id: 'char-002',
    novelId: 'novel-001',
    name: '艾琳(E-247)',
    role: 'supporting',
    description: '第七前哨站的适应指导员，编号E-247。表面温和有礼，实则对前哨站的秘密守口如瓶。',
    personality: '训练有素，情绪控制力强，在执行职责和个人良知之间存在冲突',
    goals: '完成指导员职责，但内心对系统的某些做法存有疑虑',
    restrictions: '不能违反前哨站指令',
    currentState: '正在引导林远适应前哨站生活',
    relationships: [],
    isConfirmed: true,
    createdAt: '2026-05-10T09:00:00Z',
  },
  {
    id: 'char-003',
    novelId: 'novel-001',
    name: '卡尔·雷恩',
    role: 'antagonist',
    description: '第七前哨站的安全主管，对传送系统的运作有深入了解。外表友善，实则冷酷无情。',
    personality: '表面和善，实际上为了维护系统稳定可以牺牲任何人',
    goals: '维护前哨站的安全和传送系统的秘密',
    restrictions: '不能公开违反联盟条例',
    currentState: '尚未出场，但已在暗中关注林远',
    relationships: [],
    isConfirmed: true,
    createdAt: '2026-05-10T10:00:00Z',
  },
];
