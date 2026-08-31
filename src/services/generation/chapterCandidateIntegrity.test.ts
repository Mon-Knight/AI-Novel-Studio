import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectChapterCandidateIntegrity } from './chapterCandidateIntegrity';

test('detects a new chapter reopening a completed scene from the previous chapter body', () => {
  const repeated = '“你为什么不问他们，为什么报警广播出现在没有发布警报的夜里？”';
  const previousChapterText = [
    '沈砚抵达档案馆，开始核对录音。',
    '调查推进了很长一段时间。'.repeat(40),
    repeated,
    '匿名人完成警告后离开值班室。'.repeat(20),
    '沈砚完成双备份，最后听见一句“门在水下”。',
  ].join('\n');
  const candidateText = `${repeated}\n匿名人仍站在值班室里，重新回答已经结束的问题。`;

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText, previousChapterText }).map(
      (issue) => issue.code,
    ),
    ['chapter_opening_rollback'],
  );
});

test('detects the Gate rollback when the repeated opening differs by one leading character', () => {
  const repeated = '“你为什么不问他们，为什么报警广播出现在没有发布警报的夜里？”';
  const previousChapterText = [
    '沈砚抵达档案馆，开始核对录音。',
    '调查推进了很长一段时间。'.repeat(40),
    repeated,
    '匿名人完成警告后离开值班室。'.repeat(20),
    '沈砚完成双备份，最后听见一句“门在水下”。',
  ].join('\n');
  const candidateText = `那${repeated.slice(1)}\n匿名人仍站在值班室里，重新收起已经交付过的物证袋。`;

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText, previousChapterText }).map(
      (issue) => issue.code,
    ),
    ['chapter_opening_rollback'],
  );
});

test('allows a short chapter-end hook to be echoed without reopening an earlier scene', () => {
  const previousChapterText = `${'调查继续。'.repeat(120)}\n门在水下。`;
  const candidateText = '门在水下。沈砚记住这句话，沿着退潮后的石阶继续前行。';

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText, previousChapterText }), []);
});

test('detects a paraphrased opening that restores a previous evidence scene', () => {
  const previousChapterText = [
    '沈砚走进档案馆，楼梯口的封条仍然完好。',
    '现场人员从楼梯口走来，手里多了一只黑色物证袋。',
    '它是被门缝夹过，或者擦过门框。',
    '如果你们不查现场记录，那就不能排除删改。',
    '十点前带证件到市局，把录音副本交给专案组。',
    '林致远把登记表收回去，十二点后地下资料室将正式封闭。',
    '沈砚没有再看楼梯口，他把相机收进包里。',
    '他沿走廊逐项核对照片和通话时间，并将新发现分开保存。'.repeat(12),
    '他在门外拍下盐痕，随后发现凌晨的通话录音被远程删除。',
    '章末时，封闭的门内传来了缓慢转动锁芯的声音。',
  ].join('\n');
  const candidateText = [
    '我只是在判断它是不是被门夹过。',
    '林致远看了他一眼，把物证袋交给现场人员，随后侧身让开通道。',
    '十点以前，市局专案组。别再到现场附近拍东西。',
    '如果你们不把现场记录给我看呢？',
    '那就等正式程序。十二点以后，资料室还在吗？',
  ].join('\n');

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText, previousChapterText }).map(
      (issue) => issue.code,
    ),
    ['chapter_opening_rollback'],
  );
});

test('detects a complete sentence copied from the immediate previous ending', () => {
  const tailHook = '林致远把物证袋交给现场人员，提醒沈砚十点前去市局专案组。';
  const previousChapterText = `${'调查继续。'.repeat(140)}\n${tailHook}`;
  const candidateText = `${tailHook}沈砚记住时间，离开档案馆后径直向市局走去。`;

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText, previousChapterText }).map(
      (issue) => issue.code,
    ),
    ['chapter_boundary_sentence_repetition'],
  );
});

test('allows the previous ending state to continue in genuinely new prose', () => {
  const previousChapterText = [
    '林致远把物证袋交给现场人员，提醒沈砚十点前去市局专案组。',
    '档案馆的铁门在他身后缓缓合拢。',
  ].join('\n');
  const candidateText = '九点四十分，沈砚已经带着证件走上市局门前的石阶。';

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText, previousChapterText }), []);
});

test('detects a completed boundary action replayed with different surrounding words', () => {
  const previousChapterText = [
    '她把未知文件复制到隔离存储卡里。',
    '点开之前，她先按下了录音键。',
  ].join('\n');
  const candidateText = '林砚按下录音键，才点开名为“0250”的文件。';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText, previousChapterText }).map(
      (issue) => issue.code,
    ),
    ['chapter_boundary_action_replay'],
  );
});

test('detects a completed image inspection replayed with reversed word order', () => {
  const previousChapterText = [
    '下午，林砚再次放大纸片照片。',
    '她调高对比度，看见缺口像一道向下折的箭头。',
  ].join('\n');
  const candidateText = '林砚把照片放大，沿着那道向下折的箭头重新查看缺口。';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText, previousChapterText }).map(
      (issue) => issue.code,
    ),
    ['chapter_boundary_action_replay'],
  );
});

test('allows a new image operation that advances beyond the previous boundary action', () => {
  const previousChapterText = '林砚放大纸片照片，确认折痕指向附件缺口。';
  const candidateText = '她将照片打印出来，交给档案员核对纸张编号。';

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText, previousChapterText }), []);
});

test('allows a spoken command to be carried out at the next chapter boundary', () => {
  const previousChapterText = '门外的人压低声音：“打开保险柜，把名册拿出来。”';
  const candidateText = '林砚打开保险柜，先用相机拍下名册封面。';

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText, previousChapterText }), []);
});

test('detects a copied boundary sentence that ends with an ellipsis', () => {
  const repeated = '灯塔熄灭以前，井底又传来那串间隔完全相同的敲击声……';
  const previousChapterText = `他们沿着潮线继续搜索。\n${repeated}`;
  const candidateText = `${repeated}\n沈砚按亮手电，重新数了一遍。`;

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText, previousChapterText }).map(
      (issue) => issue.code,
    ),
    ['chapter_boundary_sentence_repetition'],
  );
});

test('does not treat common function phrases as an approximate scene replay', () => {
  const previousChapterText = [
    '他没有回答那个问题，也没有立刻转身。',
    '对方看了一眼门外，随后继续整理桌面上的文件。',
    '如果你们还要等待，那就按照原定程序办理。',
    '他知道自己不能在这里停留太久，便把手机收回口袋。',
    '最后一班汽车已经离站，雨声完全盖住了远处的脚步。',
  ].join('\n');
  const candidateText = [
    '他没有立刻回答，只是看了对方一眼。',
    '随后他把手机放回口袋，如果你们不再阻拦，那就继续往前走。',
  ].join('\n');

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText, previousChapterText }), []);
});

test('detects a short unrelated suffix pasted after a complete story sentence', () => {
  const candidateText = '九分钟不是空白，而是有人同时剪掉的同一段时间。经典三级';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_tail_pollution'],
  );
});

test('detects the same polluted suffix when separated by whitespace', () => {
  const candidateText = '九分钟不是空白，而是有人同时剪掉的同一段时间。\n\n  经典三级  ';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_tail_pollution'],
  );
});

test('accepts complete prose endings and synthetic test bodies without punctuation', () => {
  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText: '有人在门后轻声说：“门在水下。”' }),
    [],
  );
  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText: '正'.repeat(3_000) }), []);
});

test('detects the Gate sample continuous English self-revision after valid prose', () => {
  const candidateText = [
    '父亲的薄册里，被刮去的也是六时四十分。',
    'Wait avoid typo. Need continue. The piece has same line.',
    'Could be a hook but perhaps too definitive. We need end on the existing record.',
    "Let's revise the final paragraphs and preserve the chapter constraints.",
    "Let's craft final prose around 3800 Chinese characters.",
  ].join('\n\n');

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_meta_reasoning_leakage'],
  );
});

test('detects clustered Chinese internal constraints and self-correction', () => {
  const candidateText = [
    '她把薄册重新放回铁盒，窗外的雾已经漫过旧船厂。',
    '等等，这样不行，需要删掉刚才新增的角色。',
    '必须保持本章事件顺序，不得引入资产之外的新设定和新秘密。',
    '只输出最终正文，不要输出解释或标题。',
  ].join('\n');

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_meta_reasoning_leakage'],
  );
});

test('detects explicit model reasoning tags anywhere in the candidate', () => {
  assert.deepEqual(
    inspectChapterCandidateIntegrity({
      candidateText: '风从没有关严的窗缝里钻进来。\n<analysis>先检查字数再续写</analysis>',
    }).map((issue) => issue.code),
    ['chapter_meta_reasoning_leakage'],
  );
});

test('detects an explicit final-prose wrapper leaked by the model', () => {
  assert.deepEqual(
    inspectChapterCandidateIntegrity({
      candidateText: '以下是根据上述提示词生成的最终章节正文：\n风从没有关严的窗缝里钻进来。',
    }).map((issue) => issue.code),
    ['chapter_meta_reasoning_leakage'],
  );
});

test('detects dense audit voice distributed across distinct narrative sentences', () => {
  const candidateText = [
    '沈砚把三张照片摊在灯下。第一处盐痕已经确认，门框上的划痕仍待核实。',
    '录音里的脚步不能证明来人身份，缺失的九分钟也不足以确认闸门曾经开启。',
    '现阶段只能保留两种结论，第二份值班记录尚未复核，钥匙去向也未确认。',
    '因此仍不能断定林致远说了谎，这一点有待验证，所有结论继续标作待核实。',
  ].join('\n');

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_audit_voice_leakage'],
  );
});

test('allows repeated verification language inside investigation dialogue and quoted case files', () => {
  const candidateText = [
    '沈砚把照片推到值班员面前。',
    '“这道划痕不能证明有人撬过门锁。”',
    '“第二份记录仍待核实，钥匙去向也尚未确认。”',
    '“所以目前还不能断定林致远说了谎？”',
    '“对，这只是判断，不是结论。”',
    '她翻开旧卷宗，页边保留着一行原始批注。',
    '「现有证据不足以确认闸门开启，结论待复核。」',
    '值班员移开目光，伸手去拿桌角的车钥匙。',
  ].join('\n');

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('deduplicates overlapping audit signals within one narrative sentence', () => {
  const candidateText =
    '目前仍只能保留这一判断，这点不足以证明来人身份，因此不能据此断定林致远说谎，现有证据仍不足，结论尚待核实，这也不是事实，只是推测。';

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('detects Gate-style audit disclaimers distributed through a full chapter', () => {
  const candidateText = [
    '林砚沿着江堤走了很久，把灯塔和冷库的位置分别记下。'.repeat(20),
    '这道划痕不能证明有人撬过门锁。',
    '她没有把潮汐钟的停摆时间当作事实。',
    '一张照片仍不足以确认鞋印的方向。',
    '这不是证据，是她暂时的判断。',
    '两份记录也不能证明周启明在同一时刻进入冷库。',
    '她收起相机，追上正准备离开的守门人。'.repeat(20),
  ].join('\n');

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_audit_voice_leakage'],
  );
});

test('detects an author-side chapter number leaked into character dialogue', () => {
  const candidateText = '顾沉问：“第一章新闻照片那组鞋印？”';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_authorial_label_leakage'],
  );
});

test('detects a directory label disclosed only after an unreadable device is disconnected', () => {
  const candidateText = [
    '文件本身的创建时间已经被电脑改成今晚，设备存储里的目录也无法读取。',
    '她把录音笔从数据线上拔下来，取出电池，放入抽屉最里面。',
    '电脑忽然自己亮了一下，波形下方多出一行目录名称。',
    '那行字写着 REC_20091014_2317。',
  ].join('\n');

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_source_chain_break'],
  );
});

test('allows a directory label after the device is explicitly reconnected and read', () => {
  const candidateText = [
    '设备存储里的目录无法读取。',
    '她把录音笔从数据线上拔下来，取出电池检查触点。',
    '装回电池后，她重新连接设备，成功读取目录。',
    '目录名称显示为 REC_20091014_2317。',
  ].join('\n');

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('detects visual comparison against attachment imagery that remains unavailable', () => {
  const candidateText = [
    '申请状态变成可下载结论复印件和附件目录，附件影像仍显示现场核验。',
    '附件没有刊出，理由是原件受潮。',
    '她却在旧附件第二页看见相似压痕，又说新卷宗里的同一位置已经改成现场区域。',
  ].join('\n');

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_source_chain_break'],
  );
});

test('allows attachment detail after an explicit image acquisition', () => {
  const candidateText = [
    '附件影像仍显示现场核验。',
    '稍后她收到档案员发来的附件扫描件，下载后核对了校验码。',
    '旧附件第二页保留着一道订孔压痕。',
  ].join('\n');

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('detects a nearby mother-reference switch in dialogue with an elderly witness', () => {
  const candidateText = [
    '老人看着林砚说：“你母亲当年也问过这条路。”',
    '林砚指向值班表：“她后来还来过这里？”',
    '老人点头，说她知道得比自己多。',
    '林砚追问：“您母亲知道吗？”',
  ].join('\n');

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_dialogue_reference_conflict'],
  );
});

test('allows the same question when the interlocutor mother was explicitly introduced', () => {
  const candidateText = [
    '老人说：“你母亲认识我母亲，她们当年一起保管值班表。”',
    '林砚问：“您母亲知道吗？”',
  ].join('\n');

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('detects a 23-hour timestamp labeled as dawn for the same recorded event', () => {
  const candidateText =
    '十五年前南平码头火灾发生在凌晨。官方记录里，起火时间写的是二十三点二十分。';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_temporal_semantics_conflict'],
  );
});

test('detects an unexplained same-event dawn and 23-hour conflict in one sentence', () => {
  const candidateText = '火灾发生在凌晨，官方记录里的起火时间写的是23:20。';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_temporal_semantics_conflict'],
  );
});

test('detects a direct dawn label attached to a 23-hour timestamp', () => {
  const candidateText = '监控屏幕显示为凌晨23:20。';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_temporal_semantics_conflict'],
  );
});

test('does not treat an unrelated contrast word as an acknowledged time conflict', () => {
  const candidateText = '火灾发生在凌晨，值班员却没有解释，官方记录里的起火时间写的是23:20。';

  assert.deepEqual(
    inspectChapterCandidateIntegrity({ candidateText }).map((issue) => issue.code),
    ['chapter_temporal_semantics_conflict'],
  );
});

test('allows valid midnight, next-day, and overnight-range time labels', () => {
  assert.deepEqual(
    inspectChapterCandidateIntegrity({
      candidateText: '火灾发生在凌晨零点二十分，官方记录也是00:20。',
    }),
    [],
  );
  assert.deepEqual(
    inspectChapterCandidateIntegrity({
      candidateText: '夜班从二十三点二十分持续到次日凌晨一点。',
    }),
    [],
  );
  assert.deepEqual(
    inspectChapterCandidateIntegrity({
      candidateText: '夜班从23:20持续到凌晨一点，交接后才关灯。',
    }),
    [],
  );
  assert.deepEqual(
    inspectChapterCandidateIntegrity({
      candidateText: '文件在23:20写入，沈砚秋到第二天凌晨一点才核查完。',
    }),
    [],
  );
});

test('allows an explicitly acknowledged conflict between time sources in one sentence', () => {
  const candidateText =
    '目击者坚持火灾发生在凌晨，档案却把起火时间写成二十三点二十分；两份说法明显矛盾。';

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('allows an explicitly acknowledged conflict between time sources across sentences', () => {
  const candidateText =
    '目击者称火灾发生在凌晨。可官方记录却写二十三点二十分，两者时间明显对不上。';

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('allows a character to discuss the first chapter of an in-world book', () => {
  const candidateText = '她翻开《潮汐志》：“第一章写到旧港的三座灯塔。”';

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('allows occasional verification language required by an investigative scene', () => {
  const candidateText = [
    '仅凭潮湿的袖口还不能证明林致远去过船坞。',
    '沈砚没有把判断写进记录，而是追上正要关门的值班员，把照片推到他面前。',
    '“你确认昨晚只有这一辆车进来？”',
    '值班员看着照片里模糊的尾灯，许久才摇头。',
  ].join('\n');

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('allows ordinary English dialogue containing Wait, need, and lets craft', () => {
  const candidateText = [
    '潮水已经漫到木屋的第二级台阶。',
    "“Wait! We need to leave before nightfall. Let's craft a raft from these boards,” Mara said.",
    '她说完便把绳索抛给同伴，两人继续加固木板。',
  ].join('\n');

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});

test('allows normal Chinese narrative constraints without a writing-meta cluster', () => {
  const candidateText = [
    '根据系统指令，所有乘客必须在红灯亮起前离开站台。',
    '他需要确保本章账簿没有漏页，不能让雨水打湿封面。',
    '值班员必须保持闸门关闭，不得引入未经登记的访客。',
    '钟声响起时，所有人都回到了走廊。',
  ].join('\n');

  assert.deepEqual(inspectChapterCandidateIntegrity({ candidateText }), []);
});
