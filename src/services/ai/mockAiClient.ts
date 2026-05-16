/**
 * AI Novel Studio - Mock AI Client
 * v0.5.0 模拟 AI 返回章节正文
 */
import type { AiGenerateRequest, AiGenerateResponse, AiClient } from '../../types/ai';

function countWords(text: string): number {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (cleaned.match(/[a-zA-Z0-9]+/g) || []).length;
  return cjk + words;
}

// 提取用户消息中的章节信息来生成模拟正文
function extractChapterInfo(messages: { role: string; content: string }[]): {
  chapterTitle?: string;
  outline?: string;
  protagonist?: string;
  genre?: string;
  targetWords?: number;
} {
  let chapterTitle: string | undefined;
  let outline: string | undefined;
  let protagonist: string | undefined;
  let genre: string | undefined;
  let targetWords: number | undefined;

  for (const msg of messages) {
    if (msg.role === 'user') {
      const m = msg.content.match(/当前章节：(.+)/);
      if (m) chapterTitle = m[1].trim();
      const o = msg.content.match(/章节大纲：([\s\S]+?)(?:\n\n|$)/);
      if (o) outline = o[1].trim();
      const p = msg.content.match(/主角名称：(.+)/);
      if (p) protagonist = p[1].trim();
      const g = msg.content.match(/作品题材：(.+)/);
      if (g) genre = g[1].trim();
      const w = msg.content.match(/目标字数：(\d+)/);
      if (w) targetWords = parseInt(w[1]);
    }
  }
  return { chapterTitle, outline, protagonist, genre, targetWords };
}

function generateMockContent(context: ReturnType<typeof extractChapterInfo>): string {
  const title = context.chapterTitle || '未命名章节';
  const protag = context.protagonist || '主角';
  const targetWords = context.targetWords || 2000;

  // 根据大纲生成不同风格的模拟正文
  const hasOutline = !!context.outline;
  const paragraphs: string[] = [];

  // 开篇段落
  if (hasOutline && context.outline) {
    paragraphs.push(`${protag}站在窗前，望着远方的天际线。${context.outline?.slice(0, 50)}……这一切要从那天说起。`);
  } else {
    paragraphs.push(`${protag}醒来的时候，周围的一切都显得陌生而又熟悉。`);
  }

  paragraphs.push(`窗外是一片灰蒙蒙的天空，远处的建筑在晨雾中若隐若现。${protag}深吸一口气，空气中带着些许潮湿的味道，像是刚刚下过一场小雨。房间里很安静，只有挂钟的滴答声在不知疲倦地走着。`);

  paragraphs.push(`"时间不多了。"${protag}低声自语。他知道今天必须做出决定，这个决定将改变所有人的命运。`);

  paragraphs.push(`门外传来了脚步声，稳健而有力。${protag}转过身，面向那扇即将被推开的门。他整理了一下衣领，努力让自己看起来平静一些。但指尖的微微颤抖还是出卖了他内心的波澜。`);

  paragraphs.push(`门开了。一个身影逆光站在门口，看不清面容，但那种压迫感却真真切切地传达过来。${protag}挺直了背脊，迎向那个身影。`);

  paragraphs.push(`"你考虑清楚了？"那个声音低沉而沙哑，像是很久没有说过话。`);

  paragraphs.push(`${protag}没有立刻回答。他的目光越过对方，落在走廊尽头那扇半掩的窗户上。阳光正从那里洒进来，金色的光束中漂浮着细小的尘埃。这平凡的一幕却让他的心跳渐渐平稳下来。`);

  paragraphs.push(`"是的，我考虑清楚了。"${protag}的声音比他预想的更加坚定，"无论结果如何，我都不会后悔。"`);

  // 如果大纲提供了更多信息，增加相关内容
  if (hasOutline && context.outline && context.outline.length > 30) {
    paragraphs.push(`对方沉默了几秒，像是在评估${protag}的决心。然后，那个身影缓缓点了点头。`);
    paragraphs.push(`"很好。那就开始吧。"`);
  }

  paragraphs.push(`${protag}迈出了第一步。他知道，这一步一旦迈出，就再也没有回头路了。但他没有犹豫，因为他心里清楚——这不仅仅是他的选择，更是他的使命。`);

  // 结尾
  paragraphs.push(`窗外的阳光越来越亮，驱散了晨雾，也驱散了${protag}心中最后一丝不确定。不管前方等待着他的是什么，他都已经做好了准备。`);

  // 根据目标字数调整段落数
  let result = paragraphs.join('\n\n');
  const currentWords = countWords(result);

  // 如果字数不够，补充更多内容
  if (currentWords < targetWords && hasOutline) {
    const extra = [
      `日子一天天过去，${protag}逐渐适应了新的身份。他开始注意到那些以前被忽略的细节——墙角的裂纹、天花板上的水渍、过道里来来往往的面孔。`,
      `每到一个新的地方，他都会仔细观察周围的一切。这已经成为了一种本能。他相信答案就藏在最不起眼的细节中。`,
      `线索并不总是显而易见的。有时候它们伪装成巧合，有时候又以意外的方式出现。但${protag}已经学会了分辨。`,
    ];
    for (const ex of extra) {
      if (countWords(result) >= targetWords) break;
      result += '\n\n' + ex;
    }
  }

  return result;
}

export class MockAiClient implements AiClient {
  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    // 模拟延迟
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));

    const context = extractChapterInfo(request.messages);
    const text = generateMockContent(context);

    return {
      text,
      tokenInput: Math.floor(Math.random() * 500) + 200,
      tokenOutput: Math.floor(Math.random() * 1000) + 500,
    };
  }
}
