import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { AiSettings } from '../../types/ai';
import {
  EXTERNAL_BEAT_REPAIR_MIN_TIMEOUT_SECONDS,
  EXTERNAL_BEAT_REPAIR_PROMPT_BUFFER_CHARACTERS,
  EXTERNAL_BEAT_REPAIR_PROMPT_HEADROOM_CHARACTERS,
  EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT,
  EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_HEADROOM,
  EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_MINIMUM_BUFFER,
  EXTERNAL_BEAT_REPAIR_REQUIRED_EVENT_RATIO,
  EXTERNAL_BEAT_REPAIR_TRANSPORT_BACKOFF_MS,
  MAX_EXTERNAL_BEAT_REPAIR_TRANSPORT_ATTEMPTS,
  MAX_LOCAL_BEAT_ATTEMPTS,
  MAX_LOCAL_BEAT_CHARACTERS,
  MAX_LOCAL_SCENE_ATTEMPTS,
  MIN_LOCAL_BEAT_CHARACTERS,
  continuationSceneContext,
  externalBeatRepairCompletionChecklist,
  externalBeatRepairPromptMaximum,
  externalBeatRepairPromptMinimum,
  externalBeatRepairRawCharacterLimit,
  externalBeatRepairRawCharacterMinimum,
  externalBeatRepairRequiredEventDeadline,
  mergeSceneContinuation,
  narrativeCharacterCount,
  isRetryableExternalBeatRepairError,
  selectChapterProseExecutionMode,
  trimExternalBeatRepairAtNaturalBoundary,
  validateBeatNovelty,
  validateLocalGenerationPlan,
  validateSceneContinuity,
  validateSceneRepetition,
  validateSceneText,
  withExternalBeatRepairRequestSettings,
} from './chapterProseOrchestrator';

test('confirmed Scene plan uses Beat orchestration independently of local model state', () => {
  const scenePlan = [{ sceneNo: 1, beats: [{ order: 1, text: '推进', required: true }] }];
  assert.equal(selectChapterProseExecutionMode({ scenePlan }), 'beat_orchestration');
  assert.equal(selectChapterProseExecutionMode({}), 'external_chapter');
  assert.equal(selectChapterProseExecutionMode({ mode: 'rewrite', scenePlan }), 'external_chapter');
});

test('local generation attempts are capped at initial generation plus one rewrite', () => {
  assert.equal(MAX_LOCAL_BEAT_ATTEMPTS, 2);
  assert.equal(MAX_LOCAL_SCENE_ATTEMPTS, 2);
  assert.equal(MIN_LOCAL_BEAT_CHARACTERS, 500);
  assert.equal(MAX_LOCAL_BEAT_CHARACTERS, 900);
});

test('transient external Beat-repair failures retry within one logical repair round', () => {
  assert.equal(MAX_EXTERNAL_BEAT_REPAIR_TRANSPORT_ATTEMPTS, 2);
  assert.equal(EXTERNAL_BEAT_REPAIR_TRANSPORT_BACKOFF_MS, 1_000);
  assert.equal(isRetryableExternalBeatRepairError({ retryable: true }), true);
  assert.equal(isRetryableExternalBeatRepairError(new Error('模型服务错误（503）')), true);
  assert.equal(
    isRetryableExternalBeatRepairError(new Error('API Key 无效（401 Unauthorized）')),
    false,
  );
});

test('external Beat repair uses bounded sampling and a 300-second minimum timeout', () => {
  const base: AiSettings = {
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    modelName: 'test-model',
    temperature: 0.7,
    maxTokens: 1024,
    timeoutSeconds: 120,
    maxConcurrentAiRequests: 1,
    maxRequestsPerMinute: 60,
    dailyTokenBudget: 100_000,
    inputPricePerMillionTokens: 0,
    outputPricePerMillionTokens: 0,
    mockMode: false,
  };

  assert.equal(EXTERNAL_BEAT_REPAIR_MIN_TIMEOUT_SECONDS, 300);
  assert.equal(withExternalBeatRepairRequestSettings(base).timeoutSeconds, 300);
  assert.equal(withExternalBeatRepairRequestSettings(base).temperature, 0.35);
  assert.equal(
    withExternalBeatRepairRequestSettings({ ...base, timeoutSeconds: 420 }).timeoutSeconds,
    420,
  );
  assert.equal(
    withExternalBeatRepairRequestSettings({ ...base, temperature: 0.2 }).temperature,
    0.2,
  );
  assert.equal(base.timeoutSeconds, 120);
  assert.equal(base.temperature, 0.7);
});

test('external Beat repair asks above the hard minimum to account for punctuation', () => {
  assert.equal(EXTERNAL_BEAT_REPAIR_PROMPT_BUFFER_CHARACTERS, 100);
  assert.equal(EXTERNAL_BEAT_REPAIR_PROMPT_HEADROOM_CHARACTERS, 400);
  assert.equal(externalBeatRepairPromptMinimum(625, 750), 1150);
  assert.equal(externalBeatRepairPromptMinimum(500, 750), 1150);
  assert.equal(externalBeatRepairPromptMinimum(500, 550), 950);
  assert.equal(externalBeatRepairPromptMaximum(700, 750), 1150);
  assert.equal(externalBeatRepairPromptMaximum(600, 750), 1150);
  assert.equal(externalBeatRepairPromptMaximum(550, 550), 950);
  assert.equal(EXTERNAL_BEAT_REPAIR_REQUIRED_EVENT_RATIO, 0.65);
  assert.equal(EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_HEADROOM, 1100);
  assert.equal(EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_MINIMUM_BUFFER, 800);
  assert.equal(EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT, 14);
  assert.equal(externalBeatRepairRequiredEventDeadline(750), 487);
  assert.equal(externalBeatRepairRequiredEventDeadline(500), 325);
  assert.equal(externalBeatRepairRawCharacterLimit(750), 1850);
  assert.equal(externalBeatRepairRawCharacterMinimum(750), 1550);
  assert.equal(externalBeatRepairRawCharacterMinimum(500), 1300);
});

test('external Beat repair checklist forces domain-neutral ordered completion', () => {
  const checklist = externalBeatRepairCompletionChecklist(
    '阿澄整理三份星图，确认坐标都指向北境塔；她决定天亮后伪装成信使进入塔内。',
  );

  assert.match(checklist, /第 1 段结束前必须完成：阿澄整理三份星图/);
  assert.match(checklist, /第 2 段结束前必须完成：确认坐标都指向北境塔/);
  assert.match(checklist, /第 3 段结束前必须完成：她决定天亮后伪装成信使进入塔内/);
  assert.match(checklist, /接近目标/);
  assert.match(checklist, /核心动作已经实际发生/);
  assert.match(checklist, /可观察状态变化/);
});

test('production Beat coverage contains no story-specific entity or prop vocabulary', () => {
  const source = readFileSync(new URL('./chapterProseOrchestrator.ts', import.meta.url), 'utf8');
  for (const storyTerm of ['林舟', '孙婶', '海葵诊所', '技师', '监测口', '脉冲']) {
    assert.doesNotMatch(source, new RegExp(storyTerm, 'u'));
  }
});

test('external Beat repair overrun is trimmed at the last safe natural boundary', () => {
  const acceptedBeat =
    '孙婶确认女儿失忆前曾反复听见零点潮声，林舟逐项核对证词与监控空白，' +
    '他把日期地点见证人和异常细节写入补录表，并对照街口摄像头的维护记录。'.repeat(21) +
    '录音上传时被系统标记为已归档待核，页面随即锁住。';
  const overrun =
    '林舟没有停手，又转去追查海葵诊所和老周的秘密档案，' +
    '这部分内容已经提前侵入下一 Beat，不应保留在当前生成单元。'.repeat(30);
  const repaired = trimExternalBeatRepairAtNaturalBoundary(
    acceptedBeat + '。' + overrun,
    'stop',
    500,
    750,
  );

  assert.ok(narrativeCharacterCount(repaired) >= 500);
  assert.ok(narrativeCharacterCount(repaired) <= 750);
  assert.match(repaired, /孙婶确认/);
  assert.match(repaired, /已归档待核/);
  assert.doesNotMatch(repaired, /海葵诊所/);
  assert.doesNotThrow(() =>
    validateSceneText(
      repaired,
      {
        sceneNo: 1,
        beats: [{ text: '孙婶证词、监控空白、录音被已归档待核拦截', required: true }],
      },
      'stop',
      500,
      750,
    ),
  );
});

test('external Beat repair trimming fails closed without a safe complete boundary', () => {
  assert.throws(
    () =>
      trimExternalBeatRepairAtNaturalBoundary(
        '林舟继续核对证词和监控记录'.repeat(80),
        'stop',
        500,
        750,
      ),
    /没有可安全收束的完整句或段落/,
  );
  assert.throws(
    () =>
      trimExternalBeatRepairAtNaturalBoundary(
        '孙婶交出证词。' + '林舟继续核对证词和监控记录'.repeat(80),
        'stop',
        500,
        750,
      ),
    /没有可安全收束的完整句或段落/,
  );
});

test('external Beat repair trimming cannot discard required Beat coverage', () => {
  const safePrefix =
    '林舟逐项核对孙婶的证词和街口监控，' +
    '他把日期地点见证人和异常细节写入补录表，并确认多处时间戳彼此吻合。'.repeat(20) +
    '这一轮核验暂时结束。';
  const repaired = trimExternalBeatRepairAtNaturalBoundary(
    safePrefix +
      '。' +
      '林舟继续检查没有结论的补充记录'.repeat(12) +
      '，录音随后才被系统标记为已归档待核。' +
      '额外调查记录'.repeat(80),
    'stop',
    500,
    750,
  );

  assert.throws(
    () =>
      validateSceneText(
        repaired,
        {
          sceneNo: 1,
          beats: [{ text: '录音被系统标记为已归档待核', required: true }],
        },
        'stop',
        500,
        750,
      ),
    /未覆盖必需 Beat/,
  );
});

test('external Beat repair keeps a completed next-day patient entry from the real artifact', () => {
  const requiredBeat =
    '林舟把多户失忆案例并表，发现每人都曾去“海葵记忆诊所”；市政同步封存和“维稳”口径出现，他决定次日伪装成患者进诊所调查。';
  const realArtifact = [
    '林舟把孙婶、老周和另外两户失忆者的证词并成一张表，逐行比对。四户人家互不相识，住得也远，唯一的交集是时间：都在近两周内发病。他把地址、症状、发病日列成四列，盯着屏幕看了很久，发现每户证词里都出现过同一个词——海葵。',
    '孙婶女儿念叨“海葵医生”，老周的老伴清醒时说过一句“海葵那边的人”，另外两户的家属也提到，病人曾提起“去海葵看看”。林舟在表尾加了一列，把“海葵记忆诊所”填进每一行。四户人家，四个不同的方向，唯一的共同点就是这家诊所。',
    '他试着在系统里检索海葵记忆诊所的登记信息，页面转了三圈，弹出一行字：该机构信息已封存。林舟愣了一下，又换了个关键词搜，结果一样。他切到市政公开平台，输入诊所名称，跳出来的是一条公告，说该诊所因“经营调整”暂停营业，落款是三天前。',
    '林舟觉得不对劲。他打电话给街道信息员，对方接起来，声音压得很低，说林舟你别查了，上头打过招呼，这事归“维稳”管，家属那边安抚住就行。林舟问什么叫安抚住，对方沉默了几秒，说就是让他们别闹，别把事情捅到网上去。',
    '林舟挂了电话，站在巷口，海风灌进领口。他想起孙婶择菜时那副麻木的样子，想起老周蹲在门口抽烟，烟灰掉了一地也没掸。这些人不是不想要答案，是没人给他们答案。系统锁记录，市政发公告，街道封口，三层下来，线索被压得死死的。',
    '他回到住处，把终端里的表格又看了一遍。海葵记忆诊所，这个名字反复出现，像一根刺扎在喉咙里。他试着查诊所的注册法人，系统提示权限不足；查地址，显示“已注销”；查诊疗范围，跳出一段标准模板，说该机构提供“记忆健康咨询”。',
    '林舟把终端合上，靠在椅背上。他知道，正规渠道已经走不通了。系统封存、市政公告、维稳口径，三样东西叠在一起，反而说明这家诊所确实有问题。如果它真没问题，不需要封得这么干净。',
    '他想了想，翻出手机，给一个做假证的朋友发了条消息，问他能不能弄一张身份证和一张医保卡，名字随便，照片用他自己的。朋友回了个问号，林舟说，别问，明天就要。朋友过了十分钟，回了个“行”。',
    '第二天一早，林舟换了件灰扑扑的夹克，头发抓乱了些，站在镜子前看了看，觉得自己像个睡眠不足的中年人。他把假身份证揣进兜里，出门前又检查了一遍，确认没有带任何能暴露身份的东西。他要去海葵记忆诊所，以“长期失眠”为由，进去看看里面到底藏着什么。',
    '诊所不在主街上，藏在港口旧城区一条窄巷子里，门脸不大，白底蓝字的招牌已经有些褪色。林舟走到门口，深吸一口气，推门进去。门铃响了一声，前台坐着一个穿白大褂的女人，抬起头来，脸上挂着标准的微笑，问他：“先生，有预约吗？”',
    '林舟摇摇头，说没有，听说你们这里能治失眠，就过来看看。女人低头翻了翻登记本，说那您稍等，我帮您排一下。她拿起电话，拨了个内线，低声说了几句，然后挂断，对林舟说：“医生正好有空，您跟我来。”林舟跟着她往里走，走廊两侧的房门都关着，门牌上写着不同的编号，没有一间标着用途。',
  ].join('\n\n');
  assert.doesNotThrow(() =>
    validateSceneText(realArtifact, {
      sceneNo: 1,
      beats: [{ text: requiredBeat, required: true }],
    }),
  );
  const trimmed = trimExternalBeatRepairAtNaturalBoundary(
    realArtifact,
    'stop',
    500,
    750,
    requiredBeat,
  );

  assert.ok(narrativeCharacterCount(trimmed) >= 500);
  assert.ok(narrativeCharacterCount(trimmed) <= 750);
  assert.match(trimmed, /推门进去/);
  assert.match(trimmed, /前台|预约|失眠/);
  assert.doesNotThrow(() =>
    validateSceneText(
      trimmed,
      { sceneNo: 1, beats: [{ text: requiredBeat, required: true }] },
      'stop',
      500,
      750,
    ),
  );

  const stayedOutside = realArtifact.replace(
    /林舟走到门口[\s\S]*$/u,
    '林舟走到门口，只在门外观察，没有推门，也没有进入诊所。',
  );
  assert.throws(
    () =>
      validateSceneText(stayedOutside, {
        sceneNo: 1,
        beats: [{ text: requiredBeat, required: true }],
      }),
    /缺少分句：他决定次日伪装成患者进诊所调查/,
  );
});

test('external Beat repair sentence compaction keeps late required events from the latest artifact', () => {
  const requiredBeat =
    '林舟把多户失忆案例并表，发现每人都曾去“海葵记忆诊所”；市政同步封存和“维稳”口径出现，他决定次日伪装成患者进诊所调查。';
  const realArtifact = [
    '林舟把今天走访的六户人家逐一并表，姓名、住址、失忆时间、家属描述，四列排开，手指沿着纸面缓缓滑过。他原本只是随手记录，可当最后一行的信息填进去，他忽然停住了。',
    '六户人家，六个不同的方向，六段互不相干的生活轨迹，却在一栏里出现了同一个名字。他盯着那三个字看了很久，又翻回前面几页确认了一遍，没有错，每一户都有人去过那个地方。',
    '“海葵记忆诊所。”',
    '他低声念出这个名字，笔尖在纸上重重顿了一下。孙婶家去过，老周家去过，后面那四户也去过。有人是陪老伴去治失眠，有人是自己去调理头痛，理由各不相同，时间也前后错开，但地点只有一个。',
    '他合上笔记本，靠在椅背上，脑子里把这几天的线索重新过了一遍。监控录像缺失，街道信息员被系统拦截，家属的证词互相矛盾又惊人地相似。这些散落的碎片原本看不出关联，可现在，一个名字把它们全部串了起来。',
    '他正准备起身再去街道核实一下，手机忽然震了一下。是街道信息员发来的消息，只有一行字：“请回避，该区域为封锁范围。”',
    '林舟皱了皱眉，回了一条：“哪个区域？”',
    '对方没有回复。过了几秒，又弹出一条：“涉及公共安全，暂不对外公开。”',
    '他盯着这两条消息，心里那股不对劲的感觉越来越重。上午他还在跟孙婶说话的时候，街道的人明明还正常接待他，现在却突然变成了这套说辞。他试着拨了街道办公室的电话，响了很久才有人接，对方语气生硬地重复了一遍“封锁范围”，然后直接挂断了。',
    '林舟放下手机，又打开市政公开信息平台，搜索“海葵记忆诊所”这几个字。页面跳转了几次，最后显示“该内容已归档待核”。他换了一个搜索词，输入“旧城区失忆”，结果同样被归档。再换“潮汐异常”，页面直接打不开。',
    '他试了七八个关键词，每一个都被系统拦截或归档。这不是巧合，有人在后台把相关的记录全部封存了。他想起孙婶说过，街道的人告诉她“不要乱传”，老周也提到过“上面说这是正常现象”。当时他没太在意，现在回头看，这些话分明是统一口径。',
    '林舟把笔记本重新翻开，在最后一页写下几个字：“海葵记忆诊所，明日实地调查。”他合上本子，又想了想，把这句话划掉，换成了更稳妥的说法：“长期失眠，求诊。”',
    '第二天一早，他换了一件洗得发白的旧衬衫，头发故意揉得有些乱，又在眼下抹了点灰，让自己看起来像是好几天没睡好。他对着镜子照了照，觉得差不多了，才拎着一个塑料袋出了门。袋子里装着一瓶水和一包纸巾，都是他平时出门会带的东西，不显眼。',
    '港口旧城区的早晨比市区安静得多，街边的早餐摊刚支起来，热气腾腾的包子香味飘在空气里。他沿着昨天走过的路往东走，拐过两个街角，在一栋灰白色的三层小楼前停了下来。楼门口挂着一块牌子，白底蓝字，写着“海葵记忆诊所”，旁边还有一行小字：“专注睡眠与记忆健康”。',
    '门面不大，玻璃门擦得很干净，能看到里面摆着几盆绿植，前台后面坐着一个穿浅蓝色制服的年轻女人。林舟深吸一口气，推门走了进去。门铃叮咚响了一声，前台的女人抬起头，露出一个标准的职业微笑。',
    '“您好，请问有预约吗？”',
    '林舟揉了揉太阳穴，声音带着几分疲惫：“没有，我最近老是失眠，想来看看。”',
    '女人点点头，递过来一张表格：“那您先填一下基本信息，稍后会有医生接待您。”',
  ].join('\n\n');
  assert.doesNotThrow(() =>
    validateSceneText(realArtifact, {
      sceneNo: 1,
      beats: [{ text: requiredBeat, required: true }],
    }),
  );
  const trimmed = trimExternalBeatRepairAtNaturalBoundary(
    realArtifact,
    'stop',
    500,
    750,
    requiredBeat,
  );

  assert.ok(narrativeCharacterCount(trimmed) >= 500);
  assert.ok(narrativeCharacterCount(trimmed) <= 750);
  assert.match(trimmed, /逐一并表/);
  assert.match(trimmed, /海葵记忆诊所/);
  assert.match(trimmed, /封存|归档/);
  assert.match(trimmed, /统一口径|不要乱传|正常现象/);
  assert.match(trimmed, /明日实地调查|长期失眠/);
  assert.match(trimmed, /推门走了进去/);
  assert.doesNotThrow(() =>
    validateSceneText(
      trimmed,
      { sceneNo: 1, beats: [{ text: requiredBeat, required: true }] },
      'stop',
      500,
      750,
    ),
  );
});

test('external Beat repair recognizes field-first event entry and drops its later side plot', () => {
  const requiredBeat =
    '林舟走访孙婶，孙婶说女儿昨天出门回来就忘掉一整夜，去街道调监控被告知无记录；林舟尝试补录事件，系统自动弹出“已归档待核”并封锁。';
  const realArtifact = [
    '孙婶家在三楼，林舟敲了两下门，里头传来拖鞋蹭地的声响。门开了一条缝，露出半张浮肿的脸，眼袋垂着，像是整夜没睡。他报了身份，孙婶没多问，侧身让他进屋。客厅茶几上摆着一碗凉透的面，筷子搁在碗沿，汤面结了一层白膜。',
    '“我闺女昨天早上出门，中午回来就忘掉一整夜了。”孙婶坐在沙发角上，手指绞着围裙带子，“问她去哪了，她说不记得，问她见了谁，也摇头。我寻思是不是中暑，可这天气也不热。”她顿了顿，声音低下去，“我昨晚上去街道调监控，人家说没有记录，说是网络故障，硬盘正好那几天坏了。”',
    '林舟掏出本子记下时间，问她女儿平时走哪条路。孙婶说就是巷口那条直道，拐过修车铺再走两百米，平时买菜都走那条。他又问女儿有没有提过什么诊所，孙婶摇头，说闺女身体好，很少吃药。林舟把本子合上，道了谢，起身时瞥见墙上挂着一张合影，女孩笑得眉眼弯弯，看不出半点异样。',
    '出了楼道，他站在巷口拨了街道办的电话，对方接得很快，语气客气，说监控确实没有保存，建议他去派出所问问。林舟挂了电话，打开随身终端，把孙婶女儿的名字、时间和地点逐项录入系统。他点了提交，屏幕上弹出一行灰字：“已归档待核。”他再点输入框，光标闪了两下，整个表单锁死，连修改备注的权限都没了。',
    '他盯着那行字看了几秒，又试了一次，系统纹丝不动。林舟把终端收进口袋，站在巷口的风里，太阳晒得柏油路发软，远处传来港口货轮的汽笛声。他想起上午走访的第一户人家，老周的儿子也是出门一趟回来就忘事，老周去街道问，得到的答复同样是“没有记录”。两户人家，两条不同的路线，却撞上同一个结果。',
    '林舟沿着巷子往回走，路过修车铺时，一个蹲在门口抽烟的师傅抬头看了他一眼，又低下头去。他走到街角的小卖部，买了一瓶水，老板娘找零时随口问了一句：“你是来查事的吧？这两天好几拨人问监控的事了。”林舟问她都谁来问过，老板娘摆摆手，说记不清了，反正穿制服的也有，便衣的也有。',
    '他拧开瓶盖喝了一口水，站在遮阳棚底下，把今天听到的话在脑子里过了一遍。孙婶说女儿出门时穿着蓝布外套，老周说儿子走时戴了顶灰帽子，两人都没提过什么特别的地方。唯一能对上的，是他们都说不清那段时间发生了什么，像是被谁从记忆里硬生生挖走了一块。',
    '林舟又打开终端，翻到系统日志，发现“已归档待核”那条记录的时间戳比提交时间早了四分钟。他皱了皱眉，点开详情，页面转了一圈，又跳回原来的界面，什么附加信息都没有。他试着调出老周儿子的记录，同样被锁死，连查看都进不去。系统像是早就等着他，每一步都堵得严严实实。',
    '他站在巷口，看着来来往往的人，有个穿环卫服的大爷推着车经过，车斗里堆着几个纸箱。林舟走过去问了一句，大爷说昨天下午确实看见一个蓝衣服的姑娘在修车铺附近站了很久，后来上了一辆白色面包车。林舟问他车牌号，大爷摇头，说没注意，车开得挺快。',
    '林舟记下这个细节，又回到孙婶家楼下，抬头看了看三楼的窗户，窗帘拉得严实。他没有再上去，站在楼下拨通了一个号码，响了三声后挂断。这是他和搭档约定的信号，意思是今天有进展，但需要碰面细说。他收起手机，沿着来时的路慢慢走回去，脑子里反复转着那辆白色面包车的影子。',
  ].join('\n\n');
  const trimmed = trimExternalBeatRepairAtNaturalBoundary(
    realArtifact,
    'stop',
    500,
    750,
    requiredBeat,
  );

  assert.ok(narrativeCharacterCount(trimmed) >= 500);
  assert.ok(narrativeCharacterCount(trimmed) <= 750);
  assert.match(trimmed, /侧身让他进屋/);
  assert.match(trimmed, /忘掉一整夜/);
  assert.match(trimmed, /逐项录入系统/);
  assert.match(trimmed, /已归档待核/);
  assert.match(trimmed, /表单锁死/);
  assert.doesNotMatch(trimmed, /白色面包车|搭档约定的信号/);
  assert.doesNotThrow(() =>
    validateSceneText(
      trimmed,
      { sceneNo: 1, beats: [{ text: requiredBeat, required: true }] },
      'stop',
      500,
      750,
    ),
  );
});

test('external Beat repair keeps an explicit synchronized补录 and stops before the next Beat', () => {
  const requiredBeat =
    '林舟走访孙婶，孙婶说女儿昨天出门回来就忘掉一整夜，去街道调监控被告知无记录；林舟尝试补录事件，系统自动弹出“已归档待核”并封锁。';
  const realArtifact = [
    '孙婶家的铁门半掩着，林舟敲了两下，里头传来一阵拖鞋拖地的声响。门拉开，孙婶探出半个身子，见是他，勉强挤出一丝笑：“小舟来了，进来坐。”屋里一股隔夜的饭菜味，桌上摆着没洗的碗，她女儿的房间门紧闭着。',
    '林舟在板凳上坐下，孙婶给他倒了杯凉白开，自己却站着，两只手在围裙上搓来搓去。他问起昨天的事，孙婶叹了口气，声音压得低低的：“我闺女昨天下午出门，回来就睡下了，今早起来，问她昨晚干啥了，她愣是一点都不记得，就跟那一整夜被人挖走了一样。”',
    '她说得急，又怕吵醒女儿，嗓子眼儿里憋着劲儿：“我寻思去街道调监控看看她到底去了哪儿，结果人家查了半天，跟我说那一段没记录，干干净净的，连个影子都没有。”她说着，眼眶泛红，却硬是没掉泪，只拿手背蹭了蹭鼻尖。',
    '林舟皱了皱眉，没急着接话，而是抬手按了按耳后的补录器。他让孙婶把昨天女儿出门和回来的时间再说一遍，自己同步在系统里补录事件。刚录完，手机屏幕猛地一亮，弹出一条系统通知，字是红的：“已归档待核”，紧跟着又弹出一条，同样的字，同样的红。',
    '他再点补录，系统直接弹窗封锁，提示该时段事件已被锁定，无法重复录入。孙婶凑过来看，问是不是出啥事了。林舟把手机扣在腿上，说没事，系统例行核对。他嘴上稳，心里却翻了个个儿，这“已归档待核”四个字，他头一回在补录器上见着。',
    '他试着补录另一条无关事件，系统照常通过，唯独孙婶女儿那条，怎么点都是封锁状态。林舟又让孙婶自己试了一遍，她手指头笨拙地按着耳垂，录完，手机照样弹出同样的红字。孙婶慌了，问他是不是自己弄坏了什么，林舟摇头，说不是她的问题。',
    '他站起身，走到窗边，外头巷子里有小孩在追着跑，笑声远远传过来。他回头问孙婶：“昨天去街道调监控，是谁接待的你？”孙婶想了想，说是个年轻小伙子，戴着眼镜，态度挺好，就是查完告诉她没记录，还让她别瞎折腾了。林舟记下这个细节，又问：“他有没有提过‘海葵诊所’这四个字？”',
    '孙婶一愣，摇摇头：“没提，不过……”她顿了顿，“我闺女昨天回来的时候，袖口上沾了点药膏味儿，我闻着像诊所那种消毒水混着薄荷的味儿。”林舟心里一动，海葵诊所就在这条街对面，他来的路上还看见那扇蓝白相间的门脸。他点点头，没再多问，只叮嘱孙婶这两天别让女儿单独出门。',
    '他走出孙婶家，站在巷口，回头望了一眼那扇铁门，又望向街对面的海葵诊所。补录器还攥在手里，屏幕上那行“已归档待核”的红字已经暗下去，可封锁的提示还挂在系统日志里。他试着再点一次补录，系统依旧弹出封锁窗口，连“反馈”按钮都变成了灰色，彻底锁死。',
    '林舟把补录器收进口袋，心里清楚，这条线索被人为封住了，而且封得又快又干净。他沿着巷子往回走，路过海葵诊所门口时，特意放慢了步子，玻璃门里透出冷白的灯光，前台坐着一个穿白大褂的女人，正低头翻着本子，头也不抬。林舟没停，继续往前走，但心里已经把“海葵诊所”四个字刻在了下一站的路线上。',
  ].join('\n\n');
  assert.doesNotThrow(() =>
    validateSceneText(realArtifact, {
      sceneNo: 1,
      beats: [{ text: requiredBeat, required: true }],
    }),
  );
  const trimmed = trimExternalBeatRepairAtNaturalBoundary(
    realArtifact,
    'stop',
    500,
    750,
    requiredBeat,
  );

  assert.ok(narrativeCharacterCount(trimmed) >= 500);
  assert.ok(narrativeCharacterCount(trimmed) <= 750);
  assert.match(trimmed, /同步在系统里补录事件/);
  assert.match(trimmed, /已归档待核/);
  assert.match(trimmed, /封锁状态/);
  assert.doesNotMatch(trimmed, /海葵诊所/);
  const invitationWithoutEntry = realArtifact.replace(
    '林舟在板凳上坐下，孙婶给他倒了杯凉白开，自己却站着，两只手在围裙上搓来搓去。',
    '门链始终没有解开，林舟站在门外，没有进去，只隔着铁门问话。',
  );
  assert.throws(
    () =>
      validateSceneText(invitationWithoutEntry, {
        sceneNo: 1,
        beats: [{ text: requiredBeat, required: true }],
      }),
    /缺少分句：林舟走访孙婶/,
  );
});

test('external Beat repair trims the latest completed clinic escape artifact', () => {
  const requiredBeat =
    '林舟伪装成患者接受检查，留意到检测仪启动时出现潮汐塔同频的脉冲；他借故摸到备用监测口记下频率，技师警觉前强行离开。';
  const realArtifact = [
    '林舟以失眠为由走进海葵记忆诊所，技师引他到检查室，让他坐在仪器前的椅子上。',
    '技师给他戴上电极，按下启动键，检测仪屏幕亮起，一道波形划过。',
    '林舟盯着波形，那脉冲节奏与潮汐塔的信号完全一致，他心头一紧。',
    '他借口口渴，起身走向角落的饮水机，顺手摸到备用监测口。',
    '他掏出钢笔，在掌心记下频率数字，技师抬头看他，他立刻咳嗽两声。',
    '“先生，还没检查完。”技师皱眉，林舟摆摆手，快步走向门口。',
    '“我有点急事，改天再来。”他推开门，头也不回地下了楼。',
    '楼道里消毒水味很重，林舟脚步不停，直到走出诊所大门才放缓。',
    '他低头看掌心，那串数字还清晰印着，与潮汐塔的频段分毫不差。',
    '他想起孙婶女儿那晚的空白，想起被锁死的系统记录，心里沉甸甸的。',
    '林舟沿着旧街往回走，阳光照在褪色的招牌上，海葵两个字泛着白。',
    '他掏出手机，把那串频率存进备忘录，备注栏里只写了“水下”两个字。',
    '街角杂货铺的老板娘还在择菜，见他经过，抬眼看了看，又低下头。',
    '林舟没停留，他得回去查这个频率到底对应什么，源头又在哪里。',
    '他拐进一条窄巷，巷子尽头是旧港区，海风裹着咸腥味扑面而来。',
    '林舟站在巷口，望着远处灰蒙蒙的海面，潮汐塔的轮廓隐约可见。',
    '那塔尖在日光下泛着冷光，像一根钉子，钉在记忆的缺口上。',
    '他攥紧手机，掌心那串数字仿佛还在发烫，提醒他这不是错觉。',
    '孙婶女儿忘掉的那一夜，老周儿子丢失的片段，都指向同一个方向。',
    '林舟深吸一口气，海风灌进肺里，带着铁锈和盐粒的气息。',
    '他转身走进巷子深处，脚步声在墙壁间回荡，像敲在什么空壳上。',
    '回到所里，他关上门，拉上窗帘，在昏暗的办公室里摊开笔记本。',
    '他把那串频率抄在纸上，又画了一条线，线的末端指向海的方向。',
    '窗外传来货轮的汽笛声，低沉悠长，像某种来自海底的回应。',
    '林舟盯着纸上那条线，笔尖停在“水下”两个字旁边，没有动。',
    '他想起技师最后那个眼神，警惕里带着一丝慌乱，像被踩了尾巴。',
    '那家诊所的检查，从来就不是什么记忆体检，而是定向的搬移。',
    '搬走的是记忆，留下的是空白，源头不在陆地上，在水下。',
    '林舟合上笔记本，把它锁进抽屉最底层，钥匙拔下来握在手里。',
    '他走到窗边，拉开一道缝，海风钻进来，吹动桌上的纸角。',
    '远处潮汐塔的灯亮了一下，又暗下去，像在呼吸，又像在计时。',
    '林舟看着那点微光，心里清楚，他离真相又近了一步，也离危险近了一步。',
  ].join('\n\n');
  assert.doesNotThrow(() =>
    validateSceneText(
      realArtifact,
      { sceneNo: 2, beats: [{ text: requiredBeat, required: true }] },
      'stop',
      500,
      900,
    ),
  );
  const trimmed = trimExternalBeatRepairAtNaturalBoundary(
    realArtifact,
    'stop',
    500,
    750,
    requiredBeat,
  );
  assert.ok(narrativeCharacterCount(trimmed) >= 500);
  assert.ok(narrativeCharacterCount(trimmed) <= 750);
  assert.match(trimmed, /走出诊所大门/);
  assert.doesNotThrow(() =>
    validateSceneText(
      trimmed,
      { sceneNo: 2, beats: [{ text: requiredBeat, required: true }] },
      'stop',
      500,
      750,
    ),
  );

  const noPatientExamination = realArtifact.replace(
    '林舟以失眠为由走进海葵记忆诊所，技师引他到检查室，让他坐在仪器前的椅子上。\n\n技师给他戴上电极，按下启动键，检测仪屏幕亮起，一道波形划过。',
    '林舟只在海葵记忆诊所门外观察，没有进入，也没有接受检查。',
  );
  assert.throws(
    () =>
      validateSceneText(
        noPatientExamination,
        { sceneNo: 2, beats: [{ text: requiredBeat, required: true }] },
        'stop',
        500,
        900,
      ),
    /缺少分句：林舟伪装成患者接受检查/,
  );

  const noTechnicianAlert = realArtifact
    .replace(
      '他掏出钢笔，在掌心记下频率数字，技师抬头看他，他立刻咳嗽两声。',
      '他掏出钢笔，在掌心记下频率数字，技师始终低头填写表格，没有察觉他的动作。',
    )
    .replace(
      '“先生，还没检查完。”技师皱眉，林舟摆摆手，快步走向门口。',
      '检查室里无人阻拦，林舟收好钢笔，快步走向门口。',
    )
    .replace(
      '他想起技师最后那个眼神，警惕里带着一丝慌乱，像被踩了尾巴。',
      '他只复盘了已经记下的数字，没有回想任何人的反应。',
    );
  assert.throws(
    () =>
      validateSceneText(
        noTechnicianAlert,
        { sceneNo: 2, beats: [{ text: requiredBeat, required: true }] },
        'stop',
        500,
        900,
      ),
    /技师警觉前强行离开/,
  );
});

test('external Beat repair trims the checkpointed clinic artifact with a named technician', () => {
  const requiredBeat =
    '林舟伪装成患者接受检查，留意到检测仪启动时出现潮汐塔同频的脉冲；他借故摸到备用监测口记下频率，技师警觉前强行离开。';
  const realArtifact = [
    '林舟假称长期失眠，推门进去，白大褂女人起身迎他，自称技师小周，领他到里间一台银灰色仪器前坐下。他刚坐稳，小周便启动设备，电极贴片贴上他太阳穴，机器发出一阵低沉的嗡鸣。',
    '嗡鸣声中，林舟注意到仪器侧面一块小屏上跳动的波形，每隔固定间隔便出现一次尖锐的脉冲尖峰，那节奏他再熟悉不过，与潮汐塔顶那台老旧发报机发出的信号完全同频。他心头一紧，面上却不动声色。',
    '“这个波形好像不太平稳，”林舟指了指屏幕，“是不是接触不好？”小周凑过来看了一眼，说正常，是设备自检信号。林舟趁她低头调参数，右手悄悄探向桌下那排备用监测接口，指尖摸到其中一个松动的插孔。',
    '他飞快记下接口旁贴纸上印着的一组频率数字，默念两遍，又用指甲在掌心掐出痕迹。小周忽然直起身，目光扫过他缩回的手，眉头微微皱了一下，语气冷了几分：“先生，检查还没结束，请您坐好。”',
    '林舟知道不能再留，他装作头晕，扶着额头站起来，说突然想起家里煤气没关，得赶紧回去。小周盯着他看了两秒，没再阻拦，只说了句“数据已归档”，便侧身让开门口。林舟快步走出诊室，下了楼梯才松一口气。',
    '他站在街边，掏出手机把那组频率记进备忘录，又回头看了一眼二楼那扇半掩的窗。窗帘动了一下，像是有人站在后面。他转身走进巷子，把夹克领子竖起来，脚步不快不慢，混进早市的人流里。',
    '路过一个卖早点的摊子，他停下来买了一杯豆浆，借着喝豆浆的工夫，又确认了一遍掌心里那串数字没有记错。摊主找零时多看了他一眼，他笑了笑，说昨晚没睡好。豆浆很烫，他小口喝着，脑子里却在拼那张频率图。',
    '潮汐塔的信号是市政十年前就废弃的旧频段，按理说早该停用，可这台诊所的检测仪却在用它做自检脉冲。他想起孙婶女儿那晚的空白，想起被锁死的系统记录，想起电话里那句“维稳要紧”，这些碎片被那组频率串成一条线，线的另一端沉在水下。',
    '他喝完最后一口豆浆，把纸杯扔进垃圾桶，沿着旧城区那条临海的马路慢慢走。海风带着咸腥味扑过来，远处港口传来汽笛声，他停下脚步，望向海面。潮汐塔立在防波堤尽头，灰白色的塔身被海雾罩着，看不清顶端的设备。',
    '他摸了摸口袋里的手机，那组频率就躺在备忘录里，像一颗刚挖出来的种子。他不知道自己还能查多远，但至少现在，他知道了该往哪个方向挖。水面之下，有什么东西在等着他。',
  ].join('\n\n');
  assert.doesNotThrow(() =>
    validateSceneText(
      realArtifact,
      { sceneNo: 2, beats: [{ text: requiredBeat, required: true }] },
      'stop',
      500,
      900,
    ),
  );

  const trimmed = trimExternalBeatRepairAtNaturalBoundary(
    realArtifact,
    'stop',
    500,
    750,
    requiredBeat,
  );
  assert.ok(narrativeCharacterCount(trimmed) >= 500);
  assert.ok(narrativeCharacterCount(trimmed) <= 750);
  assert.match(trimmed, /站在街边/);
  assert.doesNotThrow(() =>
    validateSceneText(
      trimmed,
      { sceneNo: 2, beats: [{ text: requiredBeat, required: true }] },
      'stop',
      500,
      750,
    ),
  );

  const noPatientExamination = realArtifact.replace(
    /林舟假称长期失眠，推门进去[\s\S]*?机器发出一阵低沉的嗡鸣。/u,
    '林舟只在诊所门外观察，没有进入，也没有接受检查。',
  );
  assert.throws(
    () =>
      validateSceneText(
        noPatientExamination,
        { sceneNo: 2, beats: [{ text: requiredBeat, required: true }] },
        'stop',
        500,
        900,
      ),
    /林舟伪装成患者接受检查/,
  );

  const noTechnicianAlert = realArtifact.replace(
    '小周忽然直起身，目光扫过他缩回的手，眉头微微皱了一下，语气冷了几分：“先生，检查还没结束，请您坐好。”',
    '小周始终低头调试参数，没有察觉他的动作，也没有出声阻拦。',
  );
  assert.throws(
    () =>
      validateSceneText(
        noTechnicianAlert,
        { sceneNo: 2, beats: [{ text: requiredBeat, required: true }] },
        'stop',
        500,
        900,
      ),
    /技师警觉前强行离开/,
  );
});

test('finish_reason=length is never made acceptable by external Beat trimming', () => {
  const truncated = '林舟继续核对证词和监控记录。'.repeat(80);
  const untouched = trimExternalBeatRepairAtNaturalBoundary(truncated, 'length', 500, 750);

  assert.equal(untouched, truncated);
  assert.throws(
    () => validateSceneText(untouched, { sceneNo: 1, beats: [] }, 'length', 500, 750),
    /截断/,
  );
});

test('local generation plan requires one-call-per-Beat chapter envelope', () => {
  const beat = { order: 1, text: '发生一个动作', required: true };
  assert.doesNotThrow(() =>
    validateLocalGenerationPlan([
      { sceneNo: 1, beats: [beat] },
      { sceneNo: 2, beats: [beat, beat, beat] },
    ]),
  );
  assert.throws(
    () => validateLocalGenerationPlan([{ sceneNo: 1, beats: [beat] }]),
    /整章必须包含 3–5 个 Beat/,
  );
  assert.throws(
    () => validateLocalGenerationPlan([{ sceneNo: 1, beats: [beat, beat, beat, beat] }]),
    /每个 Scene 必须包含 1–3 个 Beat/,
  );
  assert.throws(
    () =>
      validateLocalGenerationPlan([
        { sceneNo: 1, beats: [beat, beat, beat] },
        { sceneNo: 2, beats: [beat, beat, beat] },
      ]),
    /整章必须包含 3–5 个 Beat/,
  );
});

test('scene validation rejects thinking leakage and truncated output', () => {
  const scene = {
    sceneNo: 2,
    beats: [{ text: '怀表开始倒走', required: true }],
  };
  assert.throws(() => validateSceneText('<think>内部推理</think>正文', scene), /思考过程/);
  assert.throws(() => validateSceneText('怀表开始倒走', scene, 'length'), /截断/);
});

test('scene validation rejects short prose and planning-language leakage', () => {
  const scene = { sceneNo: 1, beats: [] };
  assert.equal(narrativeCharacterCount('林默走了 twenty steps。'), 6);
  assert.throws(() => validateSceneText('林默刚走出门。', scene, 'stop', 100), /不足最低篇幅/);
  assert.throws(
    () => validateSceneText('林默走出门。\n\n为后续副本做铺垫。', scene),
    /提纲或写作指令/,
  );
  assert.throws(
    () =>
      validateSceneText('林舟把多户案例并表，确认所有人都去过海葵诊所。', {
        sceneNo: 1,
        beats: [
          {
            text: '林舟把多户案例并表，确认所有人都去过海葵诊所。',
            required: true,
          },
        ],
      }),
    /原样输出了 Beat 规划句/,
  );
  assert.throws(() => validateSceneText('林默走出门。（本章完）', scene), /章节结束标记/);
  assert.throws(
    () => validateSceneText('林'.repeat(101), scene, 'stop', 50, 100),
    /超过最高篇幅 100 字/,
  );
});

test('scene continuity validation requires the next Scene to carry the prior state handoff', () => {
  assert.throws(
    () =>
      validateSceneContinuity(
        {
          result: '林澈站在二号站台入口',
          transition: '他决定进入站台',
          expectedEndState: '准备进入',
        },
        '广播声在雨幕中逐渐消失。',
      ),
    /未承接/,
  );
  assert.doesNotThrow(() =>
    validateSceneContinuity(
      {
        result: '林澈站在二号站台入口',
        transition: '他决定进入站台',
        expectedEndState: '准备进入',
      },
      '林澈没有停留，直接走向二号站台入口。',
    ),
  );
});

test('scene validation requires every required Beat signal', () => {
  const scene = {
    sceneNo: 1,
    beats: [
      { text: '广播出现姐姐的声音', required: true },
      { text: '进入二号站台', required: true },
    ],
  };
  assert.throws(() => validateSceneText('雨停了，车站恢复安静。', scene), /未覆盖/);
  assert.throws(() => validateSceneText('广播里出现姐姐的声音。', scene), /进入二号站台/);
  assert.doesNotThrow(() =>
    validateSceneText('广播里出现姐姐的声音，林澈随即走进二号站台。', scene),
  );
});

test('required Beat coverage works across unrelated entities and genres', () => {
  const observatoryScene = {
    sceneNo: 7,
    beats: [
      {
        text: '阿澄校准星盘，将北境塔坐标记入航海日志；守塔人警觉后，她离开观测台。',
        required: true,
      },
    ],
  };
  const completed = [
    '阿澄先把三张星图逐一核对，完成了星盘校准。',
    '她随后将北境塔的坐标写入航海日志。',
    '守塔人盯住偏转的指针，皱眉起疑。',
    '阿澄收好日志，快步走出观测台。',
  ].join('\n\n');

  assert.doesNotThrow(() => validateSceneText(completed, observatoryScene));
  assert.throws(
    () =>
      validateSceneText(
        [
          '阿澄先将北境塔的坐标写入航海日志。',
          '她随后把三张星图逐一核对，完成了星盘校准。',
          '守塔人盯住偏转的指针，皱眉起疑。',
          '阿澄收好日志，快步走出观测台。',
        ].join('\n\n'),
        observatoryScene,
      ),
    /阿澄校准星盘|将北境塔坐标记入航海日志/,
  );
  assert.throws(
    () =>
      validateSceneText(
        completed.replace('阿澄收好日志，快步走出观测台。', '阿澄收好日志，却没有离开观测台。'),
        observatoryScene,
      ),
    /她离开观测台/,
  );

  assert.doesNotThrow(() =>
    validateSceneText(
      '苏禾把香草切碎，接着将碎叶倒入汤锅。她尝过味道，随后关火，把浓汤盛进白瓷盘。',
      {
        sceneNo: 8,
        beats: [
          {
            text: '苏禾切碎香草，倒入汤锅；她尝过味道后关火装盘。',
            required: true,
          },
        ],
      },
    ),
  );
});

test('compound Beat validation requires every ordered event clause', () => {
  const scene = {
    sceneNo: 1,
    beats: [
      {
        text: '林舟把多户失忆案例并表，发现每人都曾去“海葵记忆诊所”；市政同步封存和“维稳”口径出现，他决定次日伪装成患者进诊所调查。',
        required: true,
      },
    ],
  };
  const partial = [
    '林舟整理四名失忆者的记录，逐项比对时间和地点。',
    '所有记录最终都指向海葵记忆诊所。',
    '相关档案很快被统一封存，街道只肯重复维稳口径。',
  ].join('\n\n');

  assert.throws(
    () => validateSceneText(partial, scene),
    /缺少分句：他决定次日伪装成患者进诊所调查/,
  );
  assert.doesNotThrow(() =>
    validateSceneText(partial + '\n\n他决定明天以长期失眠为由挂号，亲自进入诊所调查。', scene),
  );

  const stabilityParaphrase = [
    '林舟整理四名失忆者的记录，逐项比对时间和地点。',
    '所有记录最终都指向海葵记忆诊所。',
    '相关档案很快被统一封存，街道工作人员提醒他，消息传开会影响稳定。',
    '他决定明天以长期失眠为由挂号，亲自进入诊所调查。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(stabilityParaphrase, scene));

  const missingStabilityPolicy = stabilityParaphrase.replace(
    '街道工作人员提醒他，消息传开会影响稳定',
    '街道工作人员拒绝解释原因',
  );
  assert.throws(
    () => validateSceneText(missingStabilityPolicy, scene),
    /缺少分句：市政同步封存和维稳口径出现/,
  );

  const realExternalDecision = [
    '林舟把五份记录并排铺在桌上，逐一比对，五条线全指向海葵记忆诊所。',
    '终端弹出市政通知，要求各机构配合维稳；通知下方的封存清单包含这些失忆记录。',
    '他关掉终端。唯一的办法，是把自己送进去。',
    '第二天一早，林舟换下白大褂，让脸色显得疲惫。他对着镜子练习了一遍说辞：长期失眠，多梦，记性变差。',
    '海葵记忆诊所开在旧城区窄巷里。林舟深吸一口气，推门走了进去，对前台说自己想治失眠。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(realExternalDecision, scene));

  const latestRealExternalDecision = [
    '林舟把四户失忆记录并成一张表，逐行核对后确认唯一重合地点是海葵记忆诊所。',
    '市政同步封存了四份记录，街道信息员递来通知，反复强调要维稳。',
    '明天一早，他就去海葵记忆诊所。以长期失眠为由，挂一个号，进去看看那扇门后面到底藏着什么。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(latestRealExternalDecision, scene));

  const patientIdentityDecision = [
    '林舟把五份记录并排铺开，核对后确认唯一的共同点就是都去过海葵记忆诊所。',
    '街道信息员称档案涉及医疗隐私，已经统一封存，只丢下一句维稳需要。',
    '他把线索重新过了一遍，决定明天亲自去一趟，以患者身份混进去看看。',
    '第二天一早，他换下制服，走到海葵记忆诊所门口，随后推门进去。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(patientIdentityDecision, scene));

  const stableRecordRealExternalDecision = [
    '林舟把终端里的记录调出来，并成一张表。孙婶女儿、老周妻子，还有另外三户，共五起失忆案例，时间集中在近两个月。他逐行比对，发现每人的手机里都存着同一条预约短信，来自“海葵记忆诊所”，日期都在失忆前一两天。',
    '他刚把这张表存进系统，屏幕就弹出一行红字“该记录已被封存”。他点开详情，只见备注栏里写着“涉稳信息，禁止外传”。林舟盯着那行字，手指在键盘上停了两秒，又试了一次，系统直接提示“无权限访问”。他关掉页面，把表抄在纸上，折好塞进口袋。',
    '他想起小刘今天看孙婶家门时那半秒的目光，像在确认什么。林舟走到巷口，给街道办打了个电话，接线的值班员一听他问失忆案例，语气立刻变得客气而疏远，说“这些事已经按流程处理了，林同志不用操心”。他挂了电话，心里那点疑虑变成了实打实的判断：有人在压这件事。',
    '林舟把纸折好，站起身。他不能以警察身份去查，那样只会撞上更厚的墙。他决定明天换身便装，以“长期失眠”为由，走进那家诊所，看看里面到底藏着什么。',
    '他站在门口，深吸一口气，推开门。柜台后面的护士抬起头，笑着问：“先生，有预约吗？”林舟揉了揉太阳穴，声音沙哑：“没有，我最近总睡不着，想来看看。”',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(stableRecordRealExternalDecision, scene));

  const noPatientCoverOrEntry = latestRealExternalDecision.replace(
    '明天一早，他就去海葵记忆诊所。以长期失眠为由，挂一个号，进去看看那扇门后面到底藏着什么。',
    '明天一早，他只准备从海葵记忆诊所门外路过，不会挂号，也不会进去。',
  );
  assert.throws(
    () => validateSceneText(noPatientCoverOrEntry, scene),
    /缺少分句：他决定次日伪装成患者进诊所调查/,
  );
});

test('compound Beat validation recognizes explicit alert-and-exit actions', () => {
  const scene = {
    sceneNo: 2,
    beats: [
      {
        text: '林舟伪装成患者接受检查，留意到检测仪启动时出现潮汐塔同频的脉冲；他借故摸到备用监测口记下频率，技师警觉前强行离开。',
        required: true,
      },
    ],
  };
  const alertAndExit = [
    '林舟假称长期失眠，以患者身份躺上检查床。',
    '检测仪启动后，他确认短促脉冲与潮汐塔的频率完全一致。',
    '他借着翻身摸到备用监测口，让手机记下频率。',
    '技师的目光从他脸上移到仪器背面，又弯腰检查接口。林舟立即穿过前台，推开诊所大门，身后的脚步声随即跟上来。',
  ].join('\n\n');

  assert.doesNotThrow(() => validateSceneText(alertAndExit, scene));

  const noAlert = alertAndExit.replace(
    '技师的目光从他脸上移到仪器背面，又弯腰检查接口',
    '技师低头整理病历，没有查看仪器',
  );
  assert.throws(() => validateSceneText(noAlert, scene), /缺少分句：技师警觉前强行离开/);

  const noExit = alertAndExit.replace(
    '林舟立即穿过前台，推开诊所大门，身后的脚步声随即跟上来',
    '林舟坐回检查床，与技师继续对视',
  );
  assert.throws(() => validateSceneText(noExit, scene), /缺少分句：技师警觉前强行离开/);

  const realRepairParaphrase = [
    '林舟填了假名，以失眠患者的身份接受脑波扫描。',
    '仪器启动后，他确认嗡鸣节奏和潮汐塔脉冲完全一样。',
    '他先记下脉冲频率，趁技师转身时用手指探向松动的监测口，拔开橡胶塞查看接口；脉冲频率和接口编号都已经记在脑子里。',
    '技师回来后扫了一眼仪器侧面，似乎察觉到异样。林舟拉开门快步穿过走廊，径直推开诊所大门。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(realRepairParaphrase, scene));

  const noPhysicalPortAccess = realRepairParaphrase.replace(
    '趁技师转身时用手指探向松动的监测口，拔开橡胶塞查看接口',
    '始终躺在检查床上，只远远看着监测口',
  );
  assert.throws(
    () => validateSceneText(noPhysicalPortAccess, scene),
    /缺少分句：他借故摸到备用监测口记下频率/,
  );

  const realExternalArtifact = [
    '海葵诊所的门面窄小。林舟递上病历卡，前台技师领他进诊室。陈汐示意他坐进椅中，将电极贴片按在他太阳穴和额前。',
    '仪器嗡鸣启动的瞬间，他确认那脉冲节奏与港口潮汐塔顶的导航信标完全同频。',
    '林舟顺势碰了碰椅侧线缆，指尖摸到备用监测口。他默记下脉冲周期，手指在裤缝上快速划了两遍。',
    '技师忽然转头：“数据流有波动，辅助通道刚有人碰过。”她跨前半步挡住去路，目光落在他右手上。',
    '林舟摊开空手，借口去洗手间记下频率。出来后，他朝技师点头，推门走进港口潮湿的夜风里。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(realExternalArtifact, scene));

  const latestRealExternalArtifact = [
    '林舟躺上诊床，女技师将电极片贴在他太阳穴和额角。仪器启动后，他捕捉到与潮汐塔同频的脉冲。',
    '他假装电极刺痛，右手顺势摸向床沿下方的备用监测口，把那段脉冲完整录进笔里。',
    '女技师盯着波形图皱眉，说干扰源有点怪，要查一下备用通道。林舟翻身坐起，踉跄着往门口挪。',
    '她追上来时，林舟扶着门框说改天再来，推开玻璃门冲进巷子，拐过两个弯才停下。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(latestRealExternalArtifact, scene));

  const latestCompletedExternalArtifact = [
    '林舟推开海葵诊所的门，白大褂女人起身迎他，示意他坐到检测椅上。他报出编好的姓名和失眠症状，女人点头，在平板上点了几下，说先做个基础扫描。他配合地坐稳，任由对方把电极贴片按到太阳穴和手腕上，目光却始终没离开那台启动中的检测仪。',
    '仪器嗡鸣着亮起绿灯，屏幕上的波形开始跳动。林舟盯着那条起伏的曲线，瞳孔微缩——那节奏他太熟悉了，潮汐塔的脉冲信号，每天夜里都在他值班室的监控屏上重复。他不动声色地吸了口气，确认自己没看错，那频率几乎一模一样。',
    '“感觉怎么样？”女人问，眼睛盯着屏幕。林舟说有点头晕，顺势抬手扶住额头，指腹擦过座椅侧面的金属面板。他注意到那里有个不起眼的备用监测口，盖子松着，露出一截接口。他假装调整坐姿，手指探过去，按住了接口边缘。',
    '“您别动，数据会受影响。”女人皱眉，起身绕过桌子。林舟已经记下了接口上刻着的频率标号，数字清晰印在脑海里。他收回手，说抱歉，有点紧张。女人重新坐下，但视线在他手上多停了两秒，显然起了疑心。',
    '林舟知道不能再留了。他猛地站起来，说胸口闷得厉害，可能是低血糖，得出去透透气。女人站起身想拦，他已经拉开椅子，快步走到门口，推门而出，反手带上了门。楼道里消毒水的气味扑面而来，他没有回头，三步并作两步下了楼梯。',
    '身后传来开门声，女人的声音追出来：“先生，您的检查还没做完——”林舟没有停，拐过楼梯转角，推开一楼大门，走进正午的日光里。他沿着巷子走了两条街，才停下来，靠在墙上，把记下的频率数字在脑子里又过了一遍，确认无误。',
    '他掏出手机，打开备忘录，把那串数字敲进去，又加了一行备注：与潮汐塔同频。做完这些，他才长长吐出一口气，抬头看了看天。太阳很亮，晒得他眯起眼睛。巷口有只猫蹲在垃圾桶上，懒洋洋地舔爪子，对他的存在毫不在意。',
    '林舟在原地站了一会儿，把刚才的细节重新捋了一遍。那台检测仪启动时的波形，确实和潮汐塔的脉冲完全一致，连间隔都不差。他想起孙婶女儿那晚的空白，想起被锁死的系统记录，想起电话里那句“维稳要紧”，这些碎片终于有了一个共同的锚点。',
    '林舟没有回头，只是加快了脚步。他需要尽快把这条线索带回去，趁记忆还新鲜，趁那台仪器的波形还清晰地刻在脑子里。巷子尽头是主街，车流声渐渐大起来，他混进人群里，像一滴水落回海里，转眼就不见了踪影。',
  ].join('\n\n');
  const compactedCompletedExternalArtifact = trimExternalBeatRepairAtNaturalBoundary(
    latestCompletedExternalArtifact,
    'stop',
    500,
    750,
    scene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(compactedCompletedExternalArtifact) >= 500);
  assert.ok(narrativeCharacterCount(compactedCompletedExternalArtifact) <= 750);
  assert.match(compactedCompletedExternalArtifact, /起(?:了)?疑|警觉/);
  assert.match(compactedCompletedExternalArtifact, /推门而出|离开/);
  assert.doesNotThrow(() => validateSceneText(compactedCompletedExternalArtifact, scene));

  const completedWithoutExamination = latestCompletedExternalArtifact.replace(
    /白大褂女人起身迎他[\s\S]*?启动中的检测仪。/u,
    '白大褂女人让他在候诊区等候，电极和检测仪始终没有启用。',
  );
  assert.throws(
    () => validateSceneText(completedWithoutExamination, scene),
    /缺少分句：林舟伪装成患者接受检查/,
  );

  const completedWithoutPortContact = latestCompletedExternalArtifact.replace(
    '他假装调整坐姿，手指探过去，按住了接口边缘。',
    '他只远远看着备用监测口，没有触碰接口。',
  );
  assert.throws(
    () => validateSceneText(completedWithoutPortContact, scene),
    /缺少分句：他借故摸到备用监测口记下频率/,
  );

  const completedWithoutAlert = latestCompletedExternalArtifact.replace(
    '女人重新坐下，但视线在他手上多停了两秒，显然起了疑心。',
    '女人重新坐下继续整理数据，没有起疑。',
  );
  assert.throws(
    () => validateSceneText(completedWithoutAlert, scene),
    /缺少分句：技师警觉前强行离开/,
  );

  const completedWithoutExit = latestCompletedExternalArtifact.replace(
    /林舟知道不能再留了。[\s\S]*?确认无误。/u,
    '林舟坐回检测椅继续配合检查，始终没有离开诊所。',
  );
  assert.throws(
    () => validateSceneText(completedWithoutExit, scene),
    /缺少分句：技师警觉前强行离开/,
  );

  const stoppedExternalArtifact = [
    '柜台后的中年女人放下杂志，起身领他穿过走廊。走廊尽头是一扇灰白色金属门，推开后，里面摆着一张躺椅和一台半人高的黑色仪器，仪表面板上有两排指示灯，此刻全部暗着。',
    '她示意林舟躺下，从墙边取来一副耳机，动作熟练地替他戴上。耳机内侧冰凉，贴着耳廓的瞬间，林舟闻到一股淡淡的臭氧味。女人绕到仪器后方，按下启动键，指示灯依次亮起，其中一盏绿灯开始以固定间隔闪烁。',
    '林舟的目光落在那盏绿灯上。闪一下，停两拍，再闪一下。他数了三轮，心跳骤然加快——这个节奏他太熟悉了，潮汐塔顶端的导航灯就是这个频率，他曾在值夜班时对着它数过整整四个小时。',
    '他强迫自己放松呼吸，装作被检查弄得昏昏欲睡。女人低头看着屏幕，偶尔在键盘上敲两下，嘴里说着放松、不要紧张之类的话。林舟半闭着眼，视线扫过仪器侧面，发现靠近墙脚的位置有一个备用监测口，接口规格和市政公共设施的标准端口一致，上面蒙着一层薄灰，显然很久没人用过。',
    '他故意翻了个身，手臂自然垂下，指尖刚好够到那个接口。女人抬头看了他一眼，他立刻含糊地嘟囔了一句，像是睡梦中无意识的动作。她没起疑，又低头去看屏幕。林舟的指尖摸到接口边缘，确认了型号，又用指甲在接口内侧的金属片上轻轻刮了一下，记住了触感。',
    '绿灯又闪了三轮。林舟在心里默数着间隔，确认与潮汐塔完全一致。他正要再摸一次接口，女人忽然站起来，绕过仪器朝他走来。她的脚步很轻，但林舟的耳朵一直竖着，在她靠近前两秒就收回了手，重新躺平，呼吸放得均匀绵长。',
    '女人站在他旁边，低头看了他几秒，伸手调整了一下耳机的位置，说检查快结束了，让他保持放松。林舟感觉到她的目光在自己脸上停留了片刻，然后才转身回到仪器前。他没有睁眼，但后背已经渗出一层薄汗。',
    '他想起终端还藏在鞋垫下，现在不是取出来的时候。他需要把频率记下来，但任何明显的动作都可能引起警觉。他闭着眼，在脑子里反复默念那组间隔节奏，像背一段旋律一样把它刻进记忆里。',
    '女人说检查结束，让他坐起来。林舟慢慢起身，摘下耳机递给她，揉了揉太阳穴，做出刚睡醒的样子。她接过耳机，随手放进仪器旁的收纳盒里，然后说可以去前台填一份反馈表。林舟点头，站起来时故意踉跄了一下，扶住墙，手再次从备用监测口旁边滑过，指尖在接口边缘的金属片上轻轻一蹭，确认了上面的编号刻痕。',
    '他跟着女人走回前台，接过她递来的表格，低头填了几行字。填到一半，他抬头问了一句，说你们这个设备是不是经常检修，刚才好像听到嗡嗡声。女人说设备每周都有人来维护，让他放心。林舟哦了一声，低头继续填表，余光扫过走廊尽头那扇灰白色的门，门缝里透出的灯光已经灭了。',
    '他把表格递回去，说了声谢谢，转身朝门口走。走到门边时，他听见身后传来椅子挪动的声音，女人似乎站了起来。他没有回头，推开门，迈出去，顺手把门带上。门轴发出一声干涩的响，和来时一样。',
    '他沿着海葵路走了半条街，拐进一条巷子，才蹲下来，从鞋垫下摸出终端。他打开记事本，把那组间隔节奏换算成频率，输入终端。屏幕跳出一行字，他盯着那行字看了几秒，然后关掉终端，塞回鞋垫下，站起来继续走。',
    '巷子尽头是港口旧城区的早市，卖鱼的小贩正在吆喝，空气里满是咸腥味。林舟混进人群，放慢脚步，像任何一个刚买完菜的居民一样，慢慢走远。',
  ].join('\n\n');
  const trimmedStoppedExternalArtifact = trimExternalBeatRepairAtNaturalBoundary(
    stoppedExternalArtifact,
    'stop',
    500,
    750,
    scene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(trimmedStoppedExternalArtifact) <= 750);
  assert.doesNotThrow(() => validateSceneText(trimmedStoppedExternalArtifact, scene));

  const noPatientExamination = trimmedStoppedExternalArtifact.replace(
    /她示意林舟躺下[\s\S]*?其中一盏绿灯开始以固定间隔闪烁。/u,
    '她让林舟坐在候诊区，耳机和仪器始终没有启用。',
  );
  assert.throws(
    () => validateSceneText(noPatientExamination, scene),
    /缺少分句：林舟伪装成患者接受检查/,
  );

  const noImminentAlert = trimmedStoppedExternalArtifact
    .replace('女人忽然站起来，绕过仪器朝他走来。', '女人始终坐在原位整理表格。')
    .replace('任何明显的动作都可能引起警觉', '任何明显的动作都可能暴露身份');
  assert.throws(() => validateSceneText(noImminentAlert, scene), /缺少分句：技师警觉前强行离开/);
});

test('external Beat repair trims the latest clinic artifact before its speculative tail', () => {
  const scene = {
    sceneNo: 2,
    beats: [
      {
        required: true,
        text: '林舟伪装成患者接受检查，留意到检测仪启动时出现潮汐塔同频的脉冲；他借故摸到备用监测口记下频率，技师警觉前强行离开。',
      },
    ],
  };
  const realArtifact = [
    '林舟跟着穿蓝裙的女技师走进检查室，躺椅旁的仪器已经亮着待机灯。他配合地坐下，女技师把几片电极贴到他太阳穴和手腕上，动作熟练得像流水线上的工人。“放松，别紧张。”她说着按下启动键。',
    '屏幕亮起的瞬间，林舟的瞳孔微微收缩——波形底部规律地跳动着细密的脉冲，间隔、幅度、节奏，和他在潮汐塔值班日志里见过的那组信号一模一样。他不敢多看，垂下眼皮，让呼吸慢下来，心里却像被什么东西狠狠攥住。',
    '“您平时睡眠怎么样？”女技师低头记录，没注意他的目光。林舟含糊应了一声，手指悄悄探向躺椅右侧的金属面板，那里有个不起眼的备用监测口，接口边缘积了一层薄灰，显然很久没人碰过。',
    '他借着调整姿势的动作，把指尖按在接口上，另一只手从裤兜里摸出半截铅笔和一张皱巴巴的收据。脉冲还在屏幕上跳动，他飞快地记下几组数字，笔尖划过纸面的声音被仪器的嗡鸣盖住。',
    '“您在写什么？”女技师忽然抬头，视线落在他手上。林舟心里一紧，脸上却挤出个困倦的笑：“记个电话号码，怕忘了。”他把收据塞回口袋，指尖还残留着金属接口的凉意。',
    '女技师没再追问，但眼神明显多了几分审视。她绕到仪器侧面，手指搭在数据线上，像是在确认什么。林舟知道不能再待了，他站起身，假装腿麻似的晃了一下：“检查完了吗？我有点头晕，想出去透透气。”',
    '“还有最后一项数据要采集。”女技师挡在他和门口之间，语气依然温和，脚步却没挪开。林舟瞥见墙角的文件柜，柜门缝里露出一角蓝色文件夹，和他在楼下看到的那张宣传画同色。',
    '“那我明天再来补。”他边说边往门口走，步子不快不慢，像任何一个急着回去上班的普通患者。女技师张了张嘴，似乎想拦，又找不到合适的理由，只能跟在他身后送出来。',
    '走廊里消毒水的味道更浓了，林舟快步下楼，推开临街的铁门，午后的阳光刺得他眯起眼。他拐进旁边一条窄巷，背靠墙壁，掏出那张收据，上面的数字已经被汗水洇得有些模糊，但还能辨认。',
    '他深吸一口气，把数字在脑子里过了一遍，又和潮汐塔的频率比对——完全吻合。诊所的检测仪在发射和潮汐塔相同的脉冲，那些失忆者不是被删除了记忆，而是被搬走了，搬去某个他还没找到的地方。',
    '巷口传来脚步声，林舟把收据叠好塞进内袋，低头装作系鞋带。一个穿灰外套的男人从巷口走过，没往他这边看。林舟等他走远，才慢慢直起身，朝反方向离开。',
    '他想起孙婶女儿那晚的空白，想起被锁死的系统记录，想起电话里那句“维稳要紧”。这些碎片终于拼出一个轮廓——信号从水下传来，源头在潮汐塔底下的某个地方。他摸了摸口袋里的收据，纸角硌着掌心，像一枚刚拆下来的引信。',
  ].join('\n\n');

  validateSceneText(realArtifact, scene);
  const trimmed = trimExternalBeatRepairAtNaturalBoundary(
    realArtifact,
    'stop',
    500,
    750,
    scene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(trimmed) >= 500);
  assert.ok(narrativeCharacterCount(trimmed) <= 750);
  assert.doesNotMatch(trimmed, /信号从水下传来/);
  assert.doesNotThrow(() => validateSceneText(trimmed, scene));

  const deniedTouch = realArtifact
    .replace(
      '林舟含糊应了一声，手指悄悄探向躺椅右侧的金属面板，那里有个不起眼的备用监测口，接口边缘积了一层薄灰，显然很久没人碰过。',
      '林舟含糊应了一声，只远远观察躺椅右侧金属面板上的备用监测口。',
    )
    .replace(
      '他借着调整姿势的动作，把指尖按在接口上，另一只手从裤兜里摸出半截铅笔和一张皱巴巴的收据。脉冲还在屏幕上跳动，他飞快地记下几组数字，笔尖划过纸面的声音被仪器的嗡鸣盖住。',
      '他没有把指尖按在接口上，只把两手收回膝前。那张皱巴巴的收据始终空白，他没有记下任何数字。',
    );
  assert.throws(
    () => validateSceneText(deniedTouch, scene),
    /缺少分句：他借故摸到备用监测口记下频率/,
  );
});

test('external Beat repair recognizes recording a pulse rhythm in the latest real artifact', () => {
  const scene = {
    sceneNo: 2,
    beats: [
      {
        required: true,
        text: '林舟伪装成患者接受检查，留意到检测仪启动时出现潮汐塔同频的脉冲；他借故摸到备用监测口记下频率，技师警觉前强行离开。',
      },
    ],
  };
  const realArtifact = [
    '林舟推门走进海葵记忆诊所，白大褂女人起身迎他，自称陈医生，示意他坐到检测椅上。他揉着太阳穴说最近总失眠，记性差得厉害，听说这里有免费检查便来看看。陈医生点点头，从柜子里取出一顶布满电极的灰色帽子，让他戴上。',
    '电极帽贴紧头皮，凉意顺着发根渗下去。陈医生转身启动桌下的检测仪，黑色机箱嗡地一震，指示灯由蓝转红。林舟盯着屏幕，一条条波形开始跳动，就在那起伏的节奏里，他耳膜深处忽然捕捉到一阵熟悉的脉冲节律，和潮汐塔发出的信号完全同频。',
    '他心头一紧，面上却不动声色，只微微偏头，目光落在检测仪侧面一个未插线的备用监测口上。那接口闪着微弱的绿光，像是专门留给外部设备用的。林舟清了清嗓子，说帽子有点松，影响检查，借故抬手去扶帽沿，顺势摸向那个接口。',
    '指尖触到金属边缘，他飞快地按下藏在袖口的录音笔按钮，将那段脉冲频率完整录了下来。陈医生正低头调整屏幕参数，没注意到他的动作。林舟收回手，装作整理衣领，心里默记下波形图上跳动的数字节律。',
    '就在这时，陈医生忽然抬头，目光扫过他刚碰过的接口，眉头微微皱了一下。她没说话，只是伸手去够桌角的电话。林舟知道不能再留，他猛地站起身，说头晕得厉害，改天再来，不等对方回应便快步朝门口走去。',
    '陈医生喊了一声“先生”，声音里带着警觉，林舟没有回头，拉开房门闪进走廊，三步并作两步冲下楼梯。身后传来椅子挪动的声响，还有一句压低的“把数据锁起来”。他冲出楼道，冷风扑面，脚步不停，拐进巷子深处才停下来喘气。',
    '他靠在一面剥落的砖墙上，掏出录音笔，回放那段脉冲，节律清晰，和潮汐塔的频段几乎重合。他想起孙婶女儿那晚的空白，想起被锁死的系统记录，想起电话里那句“维稳要紧”。这家诊所的仪器，果然在用水下的信号搬移记忆。',
    '他低头看了一眼录音笔上跳动的数字，又抬头望向诊所二楼那扇半掩的窗。窗帘动了一下，像是有人站在后面。林舟把录音笔塞进内袋，转身朝巷口走去，脚步不快不慢，混进街上的人流里。他得尽快把这段频率比对清楚，确认源头在水下。',
  ].join('\n\n');

  assert.doesNotThrow(() => validateSceneText(realArtifact, scene));
  const trimmed = trimExternalBeatRepairAtNaturalBoundary(
    realArtifact,
    'stop',
    500,
    750,
    scene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(trimmed) >= 500);
  assert.ok(narrativeCharacterCount(trimmed) <= 750);
  assert.doesNotThrow(() => validateSceneText(trimmed, scene));
  assert.doesNotThrow(() =>
    validateSceneContinuity(
      {
        result: '林舟确认异常失忆并非个别事件，而是有共享路径的批量现象。',
        transition: '林舟以“长期失眠”为由，走进海葵记忆诊所。',
        expectedEndState: '失忆案例与海葵诊所建立关联，市政封存行为被坐实。',
      },
      trimmed,
    ),
  );

  const noRecording = realArtifact.replace(
    '指尖触到金属边缘，他飞快地按下藏在袖口的录音笔按钮，将那段脉冲频率完整录了下来。陈医生正低头调整屏幕参数，没注意到他的动作。林舟收回手，装作整理衣领，心里默记下波形图上跳动的数字节律。',
    '指尖触到金属边缘，但录音笔始终没有启动，他也没有记下频率或数字节律。',
  );
  assert.throws(
    () => validateSceneText(noRecording, scene),
    /缺少分句：他借故摸到备用监测口记下频率/,
  );
});

test('compound Beat validation recognizes structured event recording as a补录 action', () => {
  const scene = {
    sceneNo: 1,
    beats: [
      {
        text: '林舟走访孙婶，孙婶说女儿昨天出门回来就忘掉一整夜，去街道调监控被告知无记录；林舟尝试补录事件，系统自动弹出“已归档待核”并封锁。',
        required: true,
      },
    ],
  };
  const handwrittenRecord = [
    '林舟来到孙婶家，听她说女儿昨天出门，回来后就忘掉了一整夜。',
    '孙婶去街道调监控，却被告知那段路没有任何记录。',
    '林舟翻开记录本，写下日期、地点、失忆时长和街道监控结果。',
    '纸面随即浮出“已归档待核”，整页硬得像铁片，再也无法修改。',
  ].join('\n\n');

  assert.doesNotThrow(() => validateSceneText(handwrittenRecord, scene));

  const noRecordAction = handwrittenRecord.replace(
    '林舟翻开记录本，写下日期、地点、失忆时长和街道监控结果。',
    '林舟没有留下任何记录，只把这些内容记在心里。',
  );
  assert.throws(() => validateSceneText(noRecordAction, scene), /缺少分句：林舟尝试补录事件/);
});

test('compound Beat validation keeps a visit established by the opening location before testimony', () => {
  const scene = {
    sceneNo: 1,
    beats: [
      {
        text: '林舟走访孙婶，孙婶说女儿昨天出门回来就忘掉一整夜，去街道调监控被告知无记录；林舟尝试补录事件，系统自动弹出“已归档待核”并封锁。',
        required: true,
      },
    ],
  };
  const realRepair = [
    '孙婶家的门半掩着，屋里一股海腥味混着隔夜的潮气。她坐在矮凳上，手指绞着围裙边。',
    '“昨天下午她出门买酱油，回来就说不记得夜里的事。”孙婶声音发干。',
    '林舟问监控的事。孙婶苦笑：“我去街道调，人家说那一段没记录。他们说系统升级，数据丢了。”',
    '林舟掏出随身终端，试着把孙婶女儿的情况补录进市政事件系统。屏幕转了两圈，弹出一行灰字：“已归档待核。”',
    '他再点补录，系统直接跳回首页，像一扇门当面关上。他连试三次，每次都一样。',
  ].join('\n\n');

  assert.doesNotThrow(() => validateSceneText(realRepair, scene));

  const latestRealRepair = [
    '孙婶家窗户正对着港口旧城的货运巷，晾衣绳上挂着两件工装。她给林舟倒了杯凉白开，手指在杯沿上反复摩挲。',
    '孙婶说女儿昨天下午出门，晚上回来就忘掉一整夜，连自己吃过晚饭都不记得。',
    '她上午去街道调监控，信息员却说那晚摄像头故障，没有记录。',
    '林舟打开事件记录点了补录，屏幕立刻弹出“已归档待核”，编辑入口随即被封锁。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(latestRealRepair, scene));

  const firstPersonRealRepair = [
    '孙婶坐在门槛上择菜，见我来了，把菜筐往旁边一推，手在围裙上蹭了两下。她女儿昨天出门回来，睡一觉醒来，把一整夜的事忘得干干净净，连自己几点回的家都说不清。',
    '我蹲下身，问她女儿出门去了哪里。孙婶摇头，说孩子自己也不记得，只记得去了趟老城区那边。她去街道调监控，值班的人告诉她那一段的摄像头坏了，没有记录，让她别白跑。',
    '我掏出随身的记录仪，把孙婶的话逐句补录进系统。刚按下保存键，屏幕弹出一行字：“已归档待核”。紧接着，整个编辑界面被锁定，光标在输入框里闪烁，却再也敲不进一个字。',
    '我试着退出重进，系统仍然提示该事件已归档，等待核查，禁止修改。孙婶凑过来看屏幕，问我是不是弄错了。我说没事，程序问题，回头再处理。她没再追问，只是低头继续择菜。',
    '我站在巷口，把记录仪收好，又想起老周昨天说过的话。他妻子也是出门回来就忘掉一整夜，街道同样说监控坏了。两家的说辞几乎一模一样，连值班人员的语气都像同一个模子刻出来的。',
    '我拨了街道办的电话，接电话的是个年轻信息员，声音很客气。他说最近监控确实在检修，好几处都断了信号，建议我过几天再来查。我问是哪几家在修，他顿了一下，说这个要问上面，他不太清楚。',
    '挂了电话，我重新打开系统，试着新建一条补充记录。页面刚跳出来，又是那行字：“已归档待核”。这次连输入框都没出现，直接弹回列表页。我盯着屏幕看了几秒，意识到这不是普通的程序拦截。',
    '孙婶端了杯水出来，问我查得怎么样。我说还在查，让她别急。她叹了口气，说女儿现在白天好好的，就是晚上睡觉前总发呆，像在努力想什么，又想不起来。我记下这句话，没再多问。',
    '临走时，我回头看了一眼孙婶家的门牌号，又看了看巷子尽头那棵老槐树。风从海港那边吹过来，带着咸腥味。我掏出手机，在备忘录里写下两个字：共性。然后删掉，重新写：海葵诊所。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(firstPersonRealRepair, scene));

  const doorstepExternalArtifact = [
    '孙婶坐在门槛上择菜，手背青筋凸起，指甲缝里嵌着洗不净的机油。她抬眼看见林舟，没起身，只把板凳往旁边挪了挪。林舟蹲下来，掏出录音笔，她摆摆手说不用录，反正说了也没人信。',
    '“昨天下午出门，回来就忘掉一整夜。”孙婶把烂菜叶扔进盆里，声音平平的，“我问她去哪了，她瞪着眼说不知道，像被人拿橡皮擦擦掉了一块。”林舟问去过哪里，她摇头，说女儿自己也说不清，只记得路过港口那片旧仓库。',
    '林舟问她有没有去街道调监控，孙婶冷笑一声，说去了，人家翻出登记本，指着空白处说没有记录。她不服，又跑了两趟，值班的人换了三个，说法一模一样。她指着街角那根歪斜的摄像头说，那东西天天亮着红灯，怎么可能什么都没拍到。',
    '林舟打开随身终端，尝试把孙婶的陈述补录进系统。屏幕弹出输入框，他逐字敲完，按下确认键，界面忽然闪了一下，跳出一行灰字：“已归档待核。”他再点修改，按钮变成灰色，光标锁死在原地，连删除键都失灵了。他试着刷新页面，系统直接退回登录界面，重新登录后，那条记录彻底消失，仿佛从未存在过。',
    '孙婶凑过来看了一眼屏幕，没问结果，只低头继续择菜。林舟收起终端，问她女儿最近有没有去过什么特别的地方。孙婶想了想，说女儿提过一嘴，说去海葵诊所拿过几贴膏药，治肩膀的老毛病。林舟记下这个名字，又问诊所的位置，孙婶说就在旧码头往西走两条街，门脸不大，挂块白底蓝字的牌子。',
    '林舟道了谢，起身往巷口走。孙婶在背后喊住他，说街道那个信息员小周，前两天也来问过同样的话，问完就走了，后来再没来过。林舟回头，看见孙婶站在门槛上，围裙上沾着菜汁，眼神里带着一种被反复敷衍过的疲惫。他点点头，说会再去问问。',
    '巷口拐角处，林舟碰见老周，一个穿蓝布工装的男人，正蹲在墙根抽烟。老周看见他，掐灭烟头，说孙婶的女儿不是头一个，他家闺女前天也这样，出门回来忘掉一整夜，去街道调监控，同样被告知没有记录。老周说自己去街道吵了一架，值班的人只是摊手，说监控硬盘坏了，正在修。',
    '林舟问老周女儿去过哪里，老周说女儿提过海葵诊所，说是去配一副老花镜。林舟心里一动，两个互不相识的人，女儿都去过同一个地方。他打开终端，想补录老周这条，屏幕却直接弹出“已归档待核”，和刚才一模一样，连输入框都没出现。',
    '老周看着他的动作，没问，只叹了口气，说这年头，连个说法都讨不到。林舟合上终端，说他会查，老周苦笑一声，说查不查的，反正日子还得过。林舟走出巷口，回头看了一眼，老周又蹲回墙根，重新点了一根烟，烟雾在潮湿的空气里散得很快。',
    '林舟站在旧城区的街边，海风裹着咸腥味扑面而来。他低头看终端，屏幕已经恢复正常，但刚才那两行“已归档待核”像两根刺，扎在记忆里。他试着搜索“海葵诊所”，系统只返回一条注册信息，地址、电话、经营范围，干净得像是刚被整理过。他拨了那个电话，响了七声，无人接听。',
    '他又拨了一次，这次接通了，一个女声说诊所今天休息，请他明天再来。林舟问昨天有没有营业，对方沉默了两秒，说昨天正常营业，但顾客记录属于隐私，不便透露。林舟还想再问，电话已经挂断。他盯着屏幕上的号码，又看了一眼孙婶家那扇半掩的门，心里那个念头越来越清晰。',
    '他决定先回局里，把今天走访的情况整理成报告。但当他打开系统，准备新建文档时，页面再次弹出“已归档待核”，这次连他刚输入的几个字都被锁住了。他反复尝试，系统始终拒绝修改，仿佛有一只看不见的手，把所有的线索都按进了某个深不见底的抽屉里。',
    '林舟关掉终端，站在巷口，看着旧城区灰蒙蒙的天际线。海风把一张废报纸吹到他脚边，上面印着半行字，模糊不清。他弯腰捡起来，报纸边缘发黄，日期是三天前，头版角落里有一则小广告，白底蓝字，写着“海葵诊所，专业调理，欢迎咨询”。他把报纸折好，塞进口袋，转身朝街尾走去。',
  ].join('\n\n');
  const compactedDoorstepArtifact = trimExternalBeatRepairAtNaturalBoundary(
    doorstepExternalArtifact,
    'stop',
    500,
    750,
    scene.beats[0].text,
  );
  assert.doesNotThrow(() => validateSceneText(compactedDoorstepArtifact, scene));

  const noDoorstepInteraction = compactedDoorstepArtifact.replace(
    '她抬眼看见林舟，没起身，只把板凳往旁边挪了挪。林舟蹲下来，掏出录音笔，她摆摆手说不用录，反正说了也没人信。',
    '林舟只从巷口远远看见她坐在门槛上，没有走近，也没有和她说话。',
  );
  assert.throws(() => validateSceneText(noDoorstepInteraction, scene), /缺少分句：林舟走访孙婶/);

  const lookedAtHimDoorstepArtifact = doorstepExternalArtifact.replace(
    '孙婶坐在门槛上择菜，手背青筋凸起，指甲缝里嵌着洗不净的机油。她抬眼看见林舟，没起身，只把板凳往旁边挪了挪。林舟蹲下来，掏出录音笔，她摆摆手说不用录，反正说了也没人信。',
    '孙婶坐在门槛上择菜，手指却半天没动一下。林舟蹲下身，她抬头看了他一眼，说女儿昨天傍晚出门，回来时神色如常，今早却把一整夜的事全忘了。',
  );
  const compactedLookedAtHimArtifact = trimExternalBeatRepairAtNaturalBoundary(
    lookedAtHimDoorstepArtifact,
    'stop',
    500,
    750,
    scene.beats[0].text,
  );
  assert.doesNotThrow(() => validateSceneText(compactedLookedAtHimArtifact, scene));

  const openedDoorRepair = [
    '孙婶家住在港口旧城区一栋老筒子楼的三层，楼道里堆着纸箱和旧自行车，墙皮剥落处露出灰扑扑的水泥。林舟敲门时，门内先是一阵窸窣，随后门缝里探出半张脸，一双浑浊的眼睛上下打量他。',
    '“你是周家那孩子？”孙婶把门拉开，围裙上沾着面粉，屋里飘着葱花炝锅的味道。她没让林舟换鞋，直接引他到饭桌边坐下，桌上还摆着半碗没吃完的面条。',
    '“婶子，我听说您家闺女昨天出了点事。”林舟掏出证件亮了一下，又收回去。孙婶的目光在证件上停了一瞬，随即垂下眼，手指无意识地搓着围裙边。',
    '“是忘了事。”孙婶说这话时声音很平，像在讲一件已经重复过许多遍的事，“昨天早上七点半出门，说是去趟诊所拿药，十一点多回来，进门就问我妈，我早上是不是没吃饭。我说你吃了，她愣了半天，又问那我今天出门了吗。”',
    '林舟没打断她。孙婶顿了顿，接着说：“她连昨天夜里怎么睡的都不记得，一整夜的事，干干净净，像被人拿橡皮擦擦掉了。”她抬眼看了林舟一眼，“我去街道想调监控，人家说没有记录。”',
    '林舟从口袋里掏出手机，打开录音功能，对孙婶说：“婶子，您把刚才的话再说一遍，我做个补录。”孙婶点点头，正要开口，林舟的手机屏幕忽然闪了一下，弹出一行字：“已归档待核。”',
    '录音键同时变成了灰色，怎么点都没有反应。林舟试着退出重进，界面直接回到了桌面，再打开录音应用，刚才那段操作记录已经不见了。',
  ].join('\n\n');
  assert.doesNotThrow(() => validateSceneText(openedDoorRepair, scene));

  const countedKnockExternalArtifact = [
    '孙婶家住在港口旧城区一条窄巷的尽头，铁门锈得发黑。林舟敲了三下，门缝里探出半张脸，眼睛红肿，像是哭过很久。他报了身份，孙婶没多问，侧身让他进了屋。',
    '屋里一股潮湿的霉味，桌上摆着没洗的碗筷，墙上挂着一张年轻女孩的照片。孙婶坐下，手指绞着围裙边，说女儿昨天傍晚出门买药，回来时神色正常，还跟她说了两句话，可今早醒来，女儿竟问自己怎么穿着昨天的衣服。',
    '“她忘掉了一整夜。”孙婶声音发哑，“问她去了哪，见了谁，她什么都想不起来，只记得自己出了门，再睁眼就是天亮。”林舟记下时间，又问女儿平时身体如何，孙婶摇头说没病没灾，连感冒都少。',
    '林舟提出去街道调监控，孙婶领着他走到街口那间挂着“综治中心”牌子的平房。值班的年轻信息员听完来意，敲了几下键盘，屏幕上的画面闪了闪，最后显示“无记录”。信息员说那晚巷口摄像头坏了，正在报修。',
    '林舟没当场反驳，回到车里打开随身终端，把孙婶女儿的名字、时间、地点逐项录入补录系统。他按下提交键，界面却弹出一行灰字：“已归档待核”，随后输入框全部锁死，光标停在原地，怎么点都没有反应。',
    '他试着刷新页面，系统依旧弹出同样的提示，连修改备注的入口都消失了。林舟盯着那行字看了几秒，又试了一次，结果一样。他合上终端，手指在膝盖上敲了敲，心里浮起一个念头：这不是普通的系统故障。',
    '他折回孙婶家，问她女儿最近有没有去过什么特别的地方。孙婶想了半天，说女儿前些天说头晕，去了一家叫“海葵诊所”的小诊所看过，开了几包药，吃完也没见好。林舟把诊所名字记在本子上，又问有没有别的异常。',
    '孙婶说女儿那晚回来时，鞋底沾着细沙，裤脚湿了一截，像是去过海边。可女儿从不夜里出门，更不会独自去海边。林舟没说话，只把这点也记下。他走出巷子时，天已经暗下来，路灯亮起昏黄的光。',
    '他站在路口，回头看了一眼那栋灰扑扑的居民楼，孙婶家的窗户亮着灯，人影在帘后晃动。林舟又打开终端，试着用另一个账号登录补录系统，结果同样弹出“已归档待核”，连页面都跳回登录界面。',
  ].join('\n\n');
  const compactedCountedKnockArtifact = trimExternalBeatRepairAtNaturalBoundary(
    countedKnockExternalArtifact,
    'stop',
    500,
    750,
    scene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(compactedCountedKnockArtifact) >= 500);
  assert.ok(narrativeCharacterCount(compactedCountedKnockArtifact) <= 750);
  assert.doesNotThrow(() => validateSceneText(compactedCountedKnockArtifact, scene));

  const countedKnockWithoutVisit = countedKnockExternalArtifact
    .replace(
      /孙婶家住在港口旧城区[\s\S]*?侧身让他进了屋。/u,
      '林舟只在巷口远远看着孙婶家，没有敲门，也没有进入。',
    )
    .replace(
      /他折回孙婶家[\s\S]*?又问有没有别的异常。/u,
      '他只在电话里向街道信息员追问海葵诊所，没有见到孙婶。',
    );
  assert.throws(() => validateSceneText(countedKnockWithoutVisit, scene), /缺少分句：林舟走访孙婶/);

  const unansweredDoor = openedDoorRepair.replace(
    /林舟敲门时[\s\S]*?桌上还摆着半碗没吃完的面条。/u,
    '林舟站在楼下远望三层窗户，没有上楼敲门，也没有见到孙婶。',
  );
  assert.throws(() => validateSceneText(unansweredDoor, scene), /缺少分句：林舟走访孙婶/);

  const plannedPatientScene = {
    sceneNo: 1,
    beats: [
      {
        text: '林舟把多户失忆案例并表，发现每人都曾去“海葵记忆诊所”；市政同步封存和“维稳”口径出现，他决定次日伪装成患者进诊所调查。',
        required: true,
      },
    ],
  };
  const plannedPatientEntry = [
    '林舟把三份笔录摊在桌上，逐行比对。孙婶的女儿、老周的女儿、第三位失忆者，三人年龄不同、职业不同、住址相隔几条街，唯一的交集是都去过“海葵记忆诊所”。',
    '他翻出手机里拍下的门诊记录照片，那是一家开在海葵路107号的小诊所，招牌不起眼，门脸夹在五金店和早餐铺之间。三人的就诊时间前后不超过两周，症状描述却出奇一致：短期记忆缺失，醒来后对前一晚毫无印象。',
    '林舟又跑了一趟街道办，想调取那几天的监控。信息员摇头说硬盘正好坏了，没存下来，屏幕上还弹出“已归档待核”的提示。',
    '傍晚，市政办公室来电，客气地建议他暂时不要继续跟进，并请他配合维稳工作。电话挂断后，林舟发现几份补录记录已经被封存，查看权限也被收回。',
    '三户人家、同一个诊所、同样的失忆症状和官方口径拼在一起，指向一个他无法忽视的结论：海葵记忆诊所不是普通诊所。',
    '他打开地图，找到海葵路107号的位置，决定明天一早就去。去之前，他得想好一个身份。直接问失忆的事太显眼，容易打草惊蛇。',
    '他对着镜子试了试表情，揉了揉太阳穴，做出疲惫的样子。长期失眠——这个理由足够自然，也足够让诊所的人放松警惕。',
    '第二天上午九点，林舟站在海葵路107号门前。诊所的门虚掩着，里面透出暖黄色的灯光。他深吸一口气，推门走了进去。',
    '前台坐着一个穿白大褂的年轻女人，抬头冲他微笑。林舟揉了揉太阳穴，声音带着刻意压低的沙哑：“最近总是失眠，记性也差，想来看看。”',
  ].join('\n\n');
  const compactedPlannedPatientEntry = trimExternalBeatRepairAtNaturalBoundary(
    plannedPatientEntry,
    'stop',
    500,
    750,
    plannedPatientScene.beats[0].text,
  );
  assert.doesNotThrow(() => validateSceneText(compactedPlannedPatientEntry, plannedPatientScene));

  const latestChannelBypassRepair = [
    '老周的女儿也是睡了一觉起来就忘事，问她昨晚去哪，她只记得跟朋友吃了饭，别的全是一片空白。林舟把两家的说法并排写在笔记本上，时间、地点、症状一一对齐，发现除了细节略有出入，几乎像是同一件事被复制了两遍。他问老周，女儿出门前有没有接过什么电话，老周想了想，说好像有人给她发过一条消息，她看了一眼就出门了，具体是谁他没看清。',
    '林舟又跑了街道信息员那边，小伙子翻出最近几天的登记记录，说这一片已经有三户来报过同样的事，都是失忆，都是睡一觉起来什么都不记得。林舟问那三户的地址，小伙子犹豫了一下，说系统里查不到，已经被市里统一封存了。林舟追问封存是什么意思，小伙子压低声音说，上面打过招呼，这类事件暂时不对外公开，统一按“个人健康原因”处理。',
    '林舟心里一沉，面上没露，只说了声谢就出了门。他站在巷口，把笔记本翻开，把三户人家的地址、时间、症状全部列成一张表，逐行比对。失忆的人年龄不同、职业不同、住得也不近，唯一的共同点是，他们都在失忆前一周内去过同一家店，一家叫“海葵记忆诊所”的地方。孙婶女儿接的那个电话，老周女儿收到的那条消息，都跟这家诊所的预约确认有关。',
    '他掏出手机搜了一下，海葵记忆诊所开在港口旧城区边缘，门面不大，主打记忆修复和睡眠调理，网上评价不多，但每条都透着一种说不出的整齐。林舟又试着在系统里查这家诊所的登记信息，结果页面直接跳转到一个提示：该机构信息已归档，如需查询请联系市卫健委。他再点，连页面都打不开了。',
    '他合上笔记本，站在路灯底下抽了半根烟。市政封存、维稳口径、系统锁死，这些动作太快太整齐，不像是一般的流程失误，更像是有人在刻意抹平痕迹。他想起孙婶说的那句“干干净净，什么都没有”，忽然觉得这句话不只是形容监控，也是在形容这一整片区域被人为清理过的记忆。',
    '他决定不再走正规渠道。既然系统里查不到，那就直接去那家诊所看看。第二天一早，他换了一身不起眼的旧衣服，把录音笔藏在夹克内袋里，又在口袋里塞了一瓶安眠药，当作失眠的佐证。他对着镜子练了一遍说辞，说自己最近总是睡不好，听朋友介绍过来的，想调理一下。',
    '出门的时候天刚亮，港口的风带着咸腥味，街面上还没什么人。他沿着旧城区的巷子走了二十来分钟，拐过两个弯，在一栋灰扑扑的旧楼前停下。海葵记忆诊所没有招牌，只在铁栅门旁边挂着一块小木牌，上面用褪色的漆写着“海葵记忆诊所”几个字，旁边还有一行小字：预约制，非请勿入。',
    '林舟站在马路对面，把诊所的门口、窗户、进出的人影都看了一遍。门半掩着，里面透出暖黄色的灯光，隐约能看见前台后面坐着一个人，低着头像是在看什么。他深吸一口气，摸了摸夹克内袋里的录音笔，确认开关是亮的，然后穿过马路，走到铁栅门前，抬手敲了敲。',
    '门内传来一声“请进”，声音温和，带着一种刻意的亲切。林舟推门进去，前台后面坐着一个穿白大褂的年轻女人，抬头看了他一眼，微笑着问：“先生，有预约吗？”林舟摇摇头，说没有，只是路过看到牌子，想问问失眠能不能治。女人没有拒绝，反而站起身，说：“没关系，我们这边可以临时加一个号，您先坐一下，医生马上出来。”',
    '林舟在候诊区的塑料椅上坐下，目光扫过墙上的宣传画，上面写着“海葵记忆诊所，让您重新拥有安稳的睡眠”。他垂下眼，手指轻轻敲了敲膝盖，心里知道，自己已经走进了这片被刻意抹平记忆的区域。',
  ].join('\n\n');
  const compactedChannelBypassRepair = trimExternalBeatRepairAtNaturalBoundary(
    latestChannelBypassRepair,
    'stop',
    500,
    750,
    plannedPatientScene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(compactedChannelBypassRepair) >= 500);
  assert.ok(narrativeCharacterCount(compactedChannelBypassRepair) <= 750);
  assert.doesNotThrow(() => validateSceneText(compactedChannelBypassRepair, plannedPatientScene));

  const channelBypassWithoutEntry = latestChannelBypassRepair.replace(
    /门内传来一声“请进”[\s\S]*?医生马上出来。”/u,
    '林舟站在门外观察了很久，最终没有推门，也没有进入诊所。',
  );
  assert.throws(
    () => validateSceneText(channelBypassWithoutEntry, plannedPatientScene),
    /缺少分句：他决定次日伪装成患者进诊所调查/,
  );

  const latestDecidedPatientEntry = [
    '林舟把孙婶的笔录存进手机，又翻出前两天的走访记录。他把三户失忆者的名字、住址、发病时间列在一张纸上，横竖看了几遍，忽然发现一个共同点：三个人都在失忆前一周内，去过同一家诊所。',
    '那家诊所叫“海葵记忆诊所”。孙婶女儿头疼去看过，老周的老伴失眠去开过药，还有一个送水工，说是去治健忘。林舟把这三个名字圈在一起，又查了查诊所的登记信息。',
    '登记信息显示诊所开业不到半年，却已经接诊了不少类似病例。林舟逐项核对就诊日期、症状和失忆发生时间，三条看似分散的轨迹渐渐收束到同一处门牌，连挂号备注里的措辞都异常接近。',
    '他又调出附近道路的设备清单，摄像头状态都显示正常，唯独与三名失忆者行程重合的时间段没有影像。维护日志没有故障记录，备份索引却被改成只读，像是有人提前清理过所有能互相印证的痕迹。',
    '街道信息员打来电话，压低声音说市政把诊所附近几个路口的监控全调走了，还叮嘱街道“注意维稳，别让失忆的事传出去”。',
    '林舟又试着把三户的笔录合并上传，系统却提示“该记录已被封存”，连查看权限都没了。他盯着那行灰字，心里明白，有人不想让这些失忆案例被串起来。',
    '他把纸上的三个人名重新圈了一遍，旁边分别写下头疼、失眠和健忘。年龄、职业、家庭情况都不相同，只有就诊机构完全一致；市政越急着封存，这个交集就越不可能只是巧合。',
    '他决定明天一早，伪装成患者，去海葵记忆诊所看看。失眠是个好借口，他本来就常熬夜，脸色也差，不用怎么装就像个病人。他把证件留在家里，只带了身份证和一点现金。',
    '第二天清晨，林舟穿了一件旧夹克，头发故意揉得乱蓬蓬的，走到街尾那栋灰扑扑的小楼前。二楼窗户上挂着“海葵记忆诊所”的牌子，门虚掩着。',
    '他深吸一口气，推门进去。前台女人问他看什么，林舟揉了揉太阳穴，说最近老失眠，睡不好，白天也没精神。女人递给他一张表格，让他填名字和症状。',
    '医生让他躺下，说先做个脑电波扫描。林舟躺上去，听着仪器发出轻微的嗡鸣声，知道自己来对地方了。',
  ].join('\n\n');
  const compactedDecidedPatientEntry = trimExternalBeatRepairAtNaturalBoundary(
    latestDecidedPatientEntry,
    'stop',
    500,
    750,
    plannedPatientScene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(compactedDecidedPatientEntry) >= 500);
  assert.ok(narrativeCharacterCount(compactedDecidedPatientEntry) <= 750);
  assert.doesNotThrow(() => validateSceneText(compactedDecidedPatientEntry, plannedPatientScene));

  const decidedPatientWhoStayedOutside = latestDecidedPatientEntry.replace(
    '他深吸一口气，推门进去。前台女人问他看什么，林舟揉了揉太阳穴，说最近老失眠，睡不好，白天也没精神。女人递给他一张表格，让他填名字和症状。',
    '他在门外观察了很久，最终没有推门，也没有进入诊所。',
  );
  assert.throws(
    () => validateSceneText(decidedPatientWhoStayedOutside, plannedPatientScene),
    /缺少分句：他决定次日伪装成患者进诊所调查/,
  );

  const noActualPatientEntry = compactedPlannedPatientEntry.replace(
    /第二天上午[\s\S]*?推门走了进去。/u,
    '第二天上午，林舟只在海葵路107号门外远远看了一眼，没有推门。',
  );
  assert.throws(
    () => validateSceneText(noActualPatientEntry, plannedPatientScene),
    /缺少分句：他决定次日伪装成患者进诊所调查/,
  );

  const latestExecutedPatientEntryArtifact = [
    '孙婶说完女儿的事，林舟又跑了老周家。老周是码头卸货工，四十多岁，媳妇说他某天半夜出门买烟，回来就不认得自家门了。老周坐在门槛上搓着手指，半天憋出一句：“我就记得巷口那盏路灯，再往后，全是黑的。”林舟问他去过哪儿，老周摇头，他媳妇从屋里翻出一张皱巴巴的收据，上面印着“海葵记忆诊所”六个字，日期正好是失忆前一天。',
    '林舟把收据拍下来，回到派出所，把孙婶女儿、老周，加上档案里另外三起失忆报案并成一张表。五个人，五个地址，互不相识，唯一的交集是都去过那家诊所。他查了诊所登记信息，法人叫李海葵，经营范围写着“心理咨询”，注册地址在港口路尽头一栋旧楼二层。他正要调更多资料，系统却弹出一条提示：“该机构信息已封存，查询需授权。”',
    '他去找所长，所长正泡茶，听完沉默了一会儿，说：“这事你别碰了，上面打过招呼，说是维稳需要，怕引起恐慌。”林舟问什么恐慌，所长把茶杯放下，声音压得很低：“五个人同时失忆，传出去，街坊怎么想？你我都担不起这个责任。”林舟没再争，但心里那根弦绷紧了。他回到办公室，把那张收据和并表数据存进私人终端，锁进抽屉。',
    '第二天一早，他换了便装，没穿警服，也没开警车。他在镜子前站了一会儿，把头发揉乱，又往脸上抹了点灰，看起来像个熬了夜、精神萎靡的普通市民。他出门前给所长发了条短信，说请一天假，家里有事。所长没回，他也没等。他沿着港口路走，经过孙婶家时，门关着，海带汤的味道已经散了。',
    '他走到巷子尽头，抬头看见那栋旧楼，二层挂着一块褪色的招牌，白底蓝字，写着“海葵记忆诊所”。门口没有病人，玻璃门半掩着，里面透出昏黄的灯光。林舟深吸一口气，把准备好的说辞在心里过了一遍。他推门进去，前台坐着一个穿白大褂的中年男人，正低头翻一本杂志，听见门响才抬起头，脸上挂着客气的笑：“您好，有预约吗？”',
    '林舟挤出一个疲惫的笑，揉了揉太阳穴：“没有，我就是听说你们这儿能治失眠，最近老睡不好，脑子里跟塞了团棉花似的。”中年男人打量了他几秒，目光在他脸上停了一下，随即点点头，从抽屉里拿出一张表格递过来：“先填一下基本信息，医生马上过来。”林舟接过表格，笔尖在纸上顿了一下，填了假名字和假地址，职业写的是“个体户”。',
    '他填完表，中年男人引他进了里间。屋里摆着一张旧沙发，一张办公桌，桌上放着一台老式脑电波仪，指示灯闪着绿光。墙角的柜子里摆着几瓶药，标签都朝里，看不清名字。林舟坐下，膝盖微微发紧，但他没动，只是盯着那台仪器，心里默默记下每一个细节。',
  ].join('\n\n');
  const compactedExecutedPatientEntry = trimExternalBeatRepairAtNaturalBoundary(
    latestExecutedPatientEntryArtifact,
    'stop',
    500,
    750,
    plannedPatientScene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(compactedExecutedPatientEntry) >= 500);
  assert.ok(narrativeCharacterCount(compactedExecutedPatientEntry) <= 750);
  assert.doesNotThrow(() => validateSceneText(compactedExecutedPatientEntry, plannedPatientScene));

  const executedPatientWhoStayedOutside = latestExecutedPatientEntryArtifact.replace(
    /林舟深吸一口气，把准备好的说辞[\s\S]*?有预约吗？”/u,
    '林舟把准备好的说辞在心里过了一遍，却只在门外观察，最终没有推门，也没有进入诊所。',
  );
  assert.throws(
    () => validateSceneText(executedPatientWhoStayedOutside, plannedPatientScene),
    /缺少分句：他决定次日伪装成患者进诊所调查/,
  );

  const latestOfficialEuphemismArtifact = [
    '林舟把三份证词并排摊在桌上，手指顺着时间线划过去。孙婶的女儿、老周的媳妇、门槛上的老太太的儿子，出门时间不同，路线不同，唯独都经过那条巷子，都在回家后忘掉一整夜。他翻出笔记本，在三人名字旁边各画了一条线，三条线最终交汇在同一个点上——巷尾那栋亮着灯的小楼，门口挂着“海葵记忆诊所”的招牌。',
    '他盯着那个名字看了很久，又调出街道的登记信息。诊所是半年前注册的，经营范围写着“心理咨询”，法人代表叫陈默，没有其他任何记录。林舟想起孙婶说过，她女儿那阵子总说记性不好，想去看看有没有什么办法。老周的媳妇也提过同样的话。门槛上的老太太则说，她儿子那段时间老失眠，说是找了个地方做调理。',
    '三户人家，三个不同的症状，却都走进过同一扇门。林舟把这条线索记在笔记本的空白处，又在“海葵记忆诊所”下面画了两道横线。他合上本子，正准备起身去巷尾看看，终端忽然震了一下。屏幕上弹出一条来自市政办公室的通知，措辞简短而正式：“根据市领导指示，自本日起，涉及近期失忆事件的所有数据统一封存，各街道信息员不得对外提供监控记录。”',
    '林舟的手指停在屏幕上方，又往下滑了滑。通知下面附着一份通稿，标题写着“关于近期我市部分市民出现记忆模糊情况的说明”，正文称经专家初步研判，此类现象可能与网络流传的某些小说内容有关，建议市民理性看待，不要过度恐慌，如有不适可前往正规医疗机构就诊。落款是市卫健委和市网信办，日期是今天。',
    '他盯着那行字看了好一会儿，又翻回自己刚才录入的证词记录。系统里那几条“已归档待核”的记录已经不见了，取而代之的是一个灰色的文件夹，文件名是“临时封存”，打开后里面空空如也。林舟试着重新上传录音，屏幕上弹出一行红字：“该操作已被管理员锁定。”他退出去又试了一次，还是同样的提示。',
    '孙婶从里屋走出来，手里端着两杯水，见他盯着终端发呆，便问是不是系统又出问题了。林舟摇摇头，说没事，只是网络有点慢。他接过水杯喝了一口，又问了一句：“婶子，你女儿之前有没有提过，她去过哪家诊所？”孙婶想了想，说好像听她念叨过一回，说是巷尾那家新开的，叫什么海葵，说是治失眠的，她想去试试。',
    '林舟点点头，没有再追问。他起身告辞，走出巷子时又回头看了一眼那栋小楼。招牌上的灯还亮着，门口挂着一块木牌，上面写着营业时间：上午九点到晚上八点。他掏出手机拍了张照片，又把地址记在笔记本上。回到住处后，他打开电脑，把三户人家的证词、监控失灵的时间段、市政封存的通知，全部列在一张表里。',
    '表格做完，他靠在椅背上，盯着屏幕上那几行字。所有线索都指向同一个地方，而市政偏偏在这个时候把所有记录都封了起来。他想起通稿里那句“理性看待”，又想起孙婶女儿瞪着眼睛一个字都说不出来的样子，这两件事放在一起，怎么看都不对劲。他关掉电脑，在笔记本上写下明天的计划：以长期失眠为由，去海葵记忆诊所看看。',
    '第二天早上，林舟换了一身旧衣服，把录音笔藏在夹克内袋里，又在口袋里塞了几张现金。他对着镜子照了照，确认自己看起来像个普通的失眠患者，才推门出去。巷尾的诊所已经开门了，门虚掩着，里面透出暖黄色的灯光。他在门口站了片刻，深吸一口气，推门走了进去。前台抬头问他是否预约，他说自己长期失眠，想挂号检查。',
  ].join('\n\n');
  const compactedOfficialEuphemismArtifact = trimExternalBeatRepairAtNaturalBoundary(
    latestOfficialEuphemismArtifact,
    'stop',
    500,
    750,
    plannedPatientScene.beats[0].text,
  );
  assert.ok(narrativeCharacterCount(compactedOfficialEuphemismArtifact) >= 500);
  assert.ok(narrativeCharacterCount(compactedOfficialEuphemismArtifact) <= 750);
  assert.doesNotThrow(() =>
    validateSceneText(compactedOfficialEuphemismArtifact, plannedPatientScene),
  );

  const officialEuphemismWithoutEntry = latestOfficialEuphemismArtifact.replace(
    '他在门口站了片刻，深吸一口气，推门走了进去。',
    '他只在门外观察，最终没有推门，也没有进入诊所。',
  );
  assert.throws(
    () => validateSceneText(officialEuphemismWithoutEntry, plannedPatientScene),
    /缺少分句：他决定次日伪装成患者进诊所调查/,
  );

  const officialNoticeWithoutStabilityRhetoric = latestOfficialEuphemismArtifact.replace(
    '建议市民理性看待，不要过度恐慌，如有不适可前往正规医疗机构就诊。',
    '正文只列出医院名单和开放时间，没有提出任何对外口径。',
  );
  assert.throws(
    () => validateSceneText(officialNoticeWithoutStabilityRhetoric, plannedPatientScene),
    /缺少分句：市政同步封存和维稳口径出现/,
  );

  const distantWindowOnly = latestRealRepair.replace(
    '孙婶家窗户正对着港口旧城的货运巷，晾衣绳上挂着两件工装。她给林舟倒了杯凉白开，手指在杯沿上反复摩挲。',
    '林舟站在巷口，远远看见孙婶家窗户正对着货运巷，却没有登门。',
  );
  assert.throws(() => validateSceneText(distantWindowOnly, scene), /缺少分句：林舟走访孙婶/);
});

test('continuation context exposes only a short tail anchor', () => {
  const context = continuationSceneContext(
    '不可重复的开头。' + '中间正文。'.repeat(200) + '最后的续写锚点。',
  );
  assert.doesNotMatch(context, /不可重复的开头/);
  assert.match(context, /最后的续写锚点/);
  assert.match(context, /禁止复述锚点/);
  assert.ok(context.length < 900);
});

test('continuation merge trims a repeated boundary paragraph', () => {
  assert.equal(
    mergeSceneContinuation(
      '第一段已经发生。\n\n第二段作为锚点。',
      '第二段作为锚点。\n\n第三段继续推进。',
      1,
    ),
    '第一段已经发生。\n\n第二段作为锚点。\n\n第三段继续推进。',
  );
});

test('continuation merge trims overlap when the provider resumes inside a paragraph', () => {
  const existing = '雨水落在站台。\n\n林澈抬头看见列车驶来，车门缓缓打开';
  const continuation = '林澈抬头看见列车驶来，车门缓缓打开后，姐姐从车厢里走了出来。';
  assert.equal(
    mergeSceneContinuation(existing, continuation, 1),
    existing + '后，姐姐从车厢里走了出来。',
  );
});

test('continuation merge rejects a restart that mostly copies existing prose', () => {
  const existing = [
    '第一段已经交代了角色进入废弃车站并听见广播，他沿着积水站台向前走，没有回头查看身后的出口。',
    '第二段已经说明怀表开始倒走，林澈决定继续调查，同时记住墙上时钟停留的时间和广播出现的方向。',
    '第三段已经描写姐姐的声音从二号站台传来，他确认声音不是记忆，并开始寻找通往地下站台的楼梯。',
    '第四段让林澈走到站台入口并停下脚步，铁门后传来拖拽声，迫使他重新判断是否应该立刻进入。',
    '第五段记录林澈最终没有推门，而是先绕到值班室寻找能够照亮站台的应急手电和备用钥匙。',
  ].join('\n\n');
  const restarted = [
    '第一段已经交代了角色进入废弃车站并听见广播，他沿着积水站台向前走，没有回头查看身后的出口。',
    '第二段已经说明怀表开始倒走，林澈决定继续调查，同时记住墙上时钟停留的时间和广播出现的方向。',
    '第三段已经描写姐姐的声音从二号站台传来，他确认声音不是记忆，并开始寻找通往地下站台的楼梯。',
    '第四段让林澈走到站台入口并停下脚步，铁门后传来拖拽声，迫使他重新判断是否应该立刻进入。',
    '最后只增加一句无关紧要的话。',
  ].join('\n\n');
  assert.throws(() => mergeSceneContinuation(existing, restarted, 2), /大面积重复/);
});

test('scene repetition validation rejects long paragraph loops', () => {
  const loop = '林澈沿着积水站台向前走，广播里的姐姐声音越来越清晰。';
  assert.throws(() => validateSceneRepetition([loop, loop, loop].join('\n\n'), 3), /循环重复/);
  assert.doesNotThrow(() =>
    validateSceneRepetition(
      ['林澈走进站台。', '怀表开始倒走。', '广播里出现姐姐的声音。'].join('\n\n'),
      3,
    ),
  );
});

test('Beat novelty rejects copying accepted chapter paragraphs but allows a short handoff', () => {
  const accepted = [
    '林舟敲开孙婶家的铁门，逐项确认女儿失忆前后的行程和街道监控记录。'.repeat(3),
    '他把海葵诊所写进补录表，系统立刻弹出已归档待核，并锁住所有输入。'.repeat(3),
    '林舟离开档案室时确认，多户失忆者都被同一套市政流程挡在门外。'.repeat(3),
  ].join('\n\n');
  const copied = accepted + '\n\n他决定第二天继续调查。';

  assert.throws(() => validateBeatNovelty(accepted, copied, 1, 2), /大面积重复已接受的前文/);
  assert.doesNotThrow(() =>
    validateBeatNovelty(
      accepted,
      '沿着上一条线索，林舟第二天以长期失眠为由走进海葵诊所，前台让他填写一份没有机构抬头的登记表。',
      2,
      1,
    ),
  );
});
