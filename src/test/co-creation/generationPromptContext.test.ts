import { describe, expect, it } from 'vitest';
import {
  buildChapterOutlineGeneratePrompt,
  buildOutlineGeneratePrompt,
  buildVolumeOutlineGeneratePrompt,
} from '../../services/ai/promptBuilder';

describe('co-creation outline prompt context', () => {
  it('passes the compiled co-creation context to every existing outline prompt', () => {
    const coCreationContext = 'storySeed.premise [user_confirmed]：记忆可以买卖';
    const requests = [
      buildOutlineGeneratePrompt({ novelTitle: '作品 A', coCreationContext }),
      buildVolumeOutlineGeneratePrompt({ novelTitle: '作品 A', volumeTitle: '第一卷', coCreationContext }),
      buildChapterOutlineGeneratePrompt({ novelTitle: '作品 A', chapterCount: 3, coCreationContext }),
    ];

    for (const request of requests) {
      const prompt = request.messages.map((message) => message.content).join('\n');
      expect(prompt).toContain(coCreationContext);
      expect(prompt).toContain('正式作品数据优先');
    }
  });
});
