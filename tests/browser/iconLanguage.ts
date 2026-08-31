import { browser, expect } from '@wdio/globals';

interface IconLanguageReport {
  iconCount: number;
  violations: string[];
}

export async function expectUnifiedIconLanguage(): Promise<void> {
  const report = await browser.execute<IconLanguageReport>(() => {
    const root = document.querySelector<HTMLElement>('#root');
    if (!root) return { iconCount: 0, violations: ['missing application root'] };
    const violations: string[] = [];
    const describe = (element: Element) => {
      const lucideClass = Array.from(element.classList).find(
        (className) => className.startsWith('lucide-') && className !== 'lucide',
      );
      if (lucideClass) return `svg.${lucideClass}`;
      const testId = element.closest<HTMLElement>('[data-testid]')?.dataset.testid;
      const classes = Array.from(element.classList).slice(0, 3).join('.');
      return testId ? `[data-testid=${testId}]` : `${element.tagName.toLowerCase()}.${classes}`;
    };
    const isGlyphOnly = (value: string) => {
      const normalized = value.replace(/\s+/gu, '');
      return (
        normalized.length > 0 &&
        Array.from(normalized).length <= 4 &&
        (/^[\p{Extended_Pictographic}\p{S}\p{P}]+$/u.test(normalized) || /^[xX]$/u.test(normalized))
      );
    };

    const icons = Array.from(root.querySelectorAll<SVGElement>('svg'));
    icons.forEach((icon) => {
      const location = describe(icon);
      if (!icon.classList.contains('lucide')) {
        violations.push(`${location}: non-Lucide SVG`);
        return;
      }
      if (icon.getAttribute('stroke-width') !== '1.8') {
        violations.push(`${location}: stroke-width=${icon.getAttribute('stroke-width') ?? ''}`);
      }
      if ((icon.getAttribute('fill') ?? 'none') !== 'none') {
        violations.push(`${location}: fill=${icon.getAttribute('fill') ?? ''}`);
      }
    });

    root
      .querySelectorAll<HTMLElement>(
        '[aria-hidden="true"], button, a, [class*="icon"], [class*="glyph"]',
      )
      .forEach((element) => {
        if (element.children.length > 0) return;
        const directText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('');
        if (isGlyphOnly(directText)) {
          violations.push(
            `${describe(element)}: standalone text glyph ${JSON.stringify(directText.trim())}`,
          );
        }
      });

    root.querySelectorAll<HTMLElement>('*').forEach((element) => {
      for (const pseudo of ['::before', '::after'] as const) {
        const content = getComputedStyle(element, pseudo).content;
        const normalized = content.replace(/^['"]|['"]$/gu, '');
        if (!['', 'none', 'normal'].includes(normalized) && isGlyphOnly(normalized)) {
          violations.push(`${describe(element)}${pseudo}: generated glyph ${content}`);
        }
      }
    });

    root
      .querySelectorAll<HTMLElement>('button, a, [class*="icon"], [class*="glyph"]')
      .forEach((element) => {
        const style = getComputedStyle(element);
        const maskImage = style.maskImage || style.getPropertyValue('-webkit-mask-image');
        if (
          /(?:url|image-set)\(/iu.test(style.backgroundImage) ||
          /(?:url|image-set)\(/iu.test(maskImage)
        ) {
          violations.push(`${describe(element)}: image or mask icon`);
        }
        if (element.querySelector('img')) {
          violations.push(`${describe(element)}: image control icon`);
        }
      });

    return { iconCount: icons.length, violations: violations.slice(0, 50) };
  });

  expect(report.iconCount).toBeGreaterThan(0);
  expect(report.violations).toEqual([]);
}
