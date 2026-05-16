/**
 * AI Novel Studio - Mock 章节数据
 */
import type { Chapter, ChapterDraft } from '../../types/chapter';

export const mockDrafts: Record<string, ChapterDraft[]> = {
  'ch-001': [
    {
      id: 'draft-001-1',
      chapterId: 'ch-001',
      version: 1,
      source: 'ai_generate',
      content: `# 第一章：异乡醒来

林远醒来的时候，首先感觉到的是后脑勺传来的钝痛。

那种感觉就像被人用钝器狠狠敲了一下，又像是宿醉后的余韵。他本能地想要翻个身，却发现身体异常沉重——不是疲惫的那种沉重，而是一种陌生感。

他猛地睁开眼睛。

头顶是陌生的天花板。灰白色的金属板拼接而成，缝隙间透出微弱的蓝色荧光。空气里有一股淡淡的消毒水味道，混合着某种他从未闻过的金属气息。

这不是他租住的那间公寓。

林远撑起身体，发现自己躺在一张窄小的床上。床单是浅灰色的，材质摸起来不像棉布，更像是某种合成纤维。房间不大，只有十来平米，除了这张床之外，就只有墙角的一个置物架和一个看起来像是门的金属面板。

没有窗户。

他的心脏开始加速跳动。

"冷静，冷静下来。"他低声对自己说，声音在这个狭小的空间里显得格外空洞。

他闭上眼睛，努力回想。最后的记忆是什么？

公寓。电脑。他在加班赶一个项目的设计图。然后……停电了？不，不对。是屏幕突然变得刺眼，然后有一股强烈的眩晕感。再然后……

一片空白。

他什么都想不起来了。

林远再次睁开眼睛，这次他注意到自己身上穿的衣服。不是他入睡时穿的T恤和短裤，而是一套深蓝色的连体服，质地柔软但很贴身。左胸口有一个他不认识的徽标——一个被圆圈环绕的三角星。

"这到底是什么地方？"`,
      wordCount: 1542,
      isAdopted: false,
      createdAt: '2026-05-15T10:30:00Z',
    },
  ],
  'ch-002': [
    {
      id: 'draft-002-1',
      chapterId: 'ch-002',
      version: 1,
      source: 'ai_generate',
      content: `# 第二章：规则的裂缝

林远在房间里待了将近三个小时后，那扇金属门终于打开了。

进来的是一个穿着同样深蓝色制服的中年女人。她的头发整齐地束在脑后，脸上带着一种训练有素的微笑。那笑容让林远莫名地不舒服——它太过标准，就像是有人用尺子量过嘴角应该上扬的角度。

"林远先生，欢迎来到第七前哨站。"她的声音也像是经过训练的，平稳而没有起伏，"我是你的适应指导员，编号E-247，你可以叫我艾琳。"

"第七前哨站？"林远皱起眉头，"这是哪里？我为什么会在这里？"

艾琳的微笑纹丝不动。"所有新到达者都会有类似的疑问。请跟我来，我会在途中向你解释。"

她转身走出房间，似乎默认林远会跟上来。

林远犹豫了两秒，还是跟了上去。他现在没有任何拒绝的理由——也不需要立刻表现出敌意。他需要的是信息。

走廊比房间宽敞一些，但同样由灰白色的金属构成。天花板上的蓝色荧光灯带一直延伸到视线的尽头。偶尔有其他穿着制服的人经过，他们都会向艾琳点头致意，然后用一种审视的目光扫过林远。

那种目光让林远感觉不舒服。不是因为敌意，而是因为好奇——这些人看他的眼神就像是在观察一件新到的货物。

"第七前哨站是联盟在边界星域设立的中转基地，"艾琳边走边说，"我们负责接收从母星传送过来的新公民，帮助他们适应这里的生活。"

"传送？"林远停下脚步，"我不记得自己同意过任何传送。"

艾琳也停了下来，转过身看着他。她的微笑仍然挂在脸上，但眼睛里的温度似乎降低了几度。

"林远先生，我可以理解你的困惑。记忆在传送过程中可能会出现暂时性的模糊。这是正常的生理反应，通常在七十二小时内会逐渐恢复。"

"我不需要恢复什么记忆，"林远说，声音比他预想的更加冷静，"我清楚地记得自己的身份和过往经历。我不记得的是自己为什么会出现在这里。"

艾琳沉默了两秒。这两秒的沉默比之前所有的对话都更有信息量。

"请继续跟我来，"她最终说道，没有回答他的问题，"有些事情，你亲自看到会更容易理解。"`,
      wordCount: 2100,
      isAdopted: false,
      createdAt: '2026-05-15T14:00:00Z',
    },
  ],
};

export const mockChapters: Chapter[] = [
  {
    id: 'ch-001',
    novelId: 'novel-001',
    volumeId: 'vol-001',
    title: '异乡醒来',
    chapterNumber: 1,
    status: 'ai_draft',
    targetWords: 4000,
    currentWords: 1542,
    drafts: [],
    sortOrder: 1,
    createdAt: '2026-05-15T08:00:00Z',
    updatedAt: '2026-05-15T10:30:00Z',
  },
  {
    id: 'ch-002',
    novelId: 'novel-001',
    volumeId: 'vol-001',
    title: '规则的裂缝',
    chapterNumber: 2,
    status: 'ai_draft',
    targetWords: 4000,
    currentWords: 2100,
    drafts: [],
    sortOrder: 2,
    createdAt: '2026-05-15T12:00:00Z',
    updatedAt: '2026-05-15T14:00:00Z',
  },
  {
    id: 'ch-003',
    novelId: 'novel-001',
    volumeId: 'vol-001',
    title: '第一次选择',
    chapterNumber: 3,
    status: 'unwritten',
    targetWords: 4000,
    currentWords: 0,
    drafts: [],
    sortOrder: 3,
    createdAt: '2026-05-16T08:00:00Z',
    updatedAt: '2026-05-16T08:00:00Z',
  },
  {
    id: 'ch-004',
    novelId: 'novel-001',
    volumeId: 'vol-002',
    title: '王城阴影',
    chapterNumber: 4,
    status: 'unwritten',
    targetWords: 4000,
    currentWords: 0,
    drafts: [],
    sortOrder: 1,
    createdAt: '2026-05-16T09:00:00Z',
    updatedAt: '2026-05-16T09:00:00Z',
  },
  {
    id: 'ch-005',
    novelId: 'novel-001',
    volumeId: 'vol-002',
    title: '地下交易',
    chapterNumber: 5,
    status: 'unwritten',
    targetWords: 4000,
    currentWords: 0,
    drafts: [],
    sortOrder: 2,
    createdAt: '2026-05-16T10:00:00Z',
    updatedAt: '2026-05-16T10:00:00Z',
  },
];

export const mockVolumes = [
  {
    id: 'vol-001',
    novelId: 'novel-001',
    title: '第一卷：觉醒',
    volumeNumber: 1,
    summary: '主角林远在异乡醒来，发现被传送到一个陌生星域，开始探索这个世界的规则。',
    chapters: [],
    sortOrder: 1,
  },
  {
    id: 'vol-002',
    novelId: 'novel-001',
    title: '第二卷：风暴',
    volumeNumber: 2,
    summary: '林远抵达王城，卷入政治阴谋与星际风暴。',
    chapters: [],
    sortOrder: 2,
  },
];
