import { describe, expect, it } from 'vitest';
import { appendWorkbenchExample } from './useWorkbenchPageChrome';

describe('appendWorkbenchExample', () => {
  it('appends without overwriting existing draft text', () => {
    expect(appendWorkbenchExample('', '  示例一句  ')).toBe('示例一句');
    expect(appendWorkbenchExample('已有目标', '示例一句')).toBe('已有目标\n\n示例一句');
    expect(appendWorkbenchExample('已有目标  \n', '示例一句')).toBe('已有目标  \n\n\n示例一句');
    expect(appendWorkbenchExample('已有目标', '   ')).toBe('已有目标');
  });
});
