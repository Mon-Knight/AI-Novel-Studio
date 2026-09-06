import { afterEach, describe, expect, it } from 'vitest';
import { buildAccentPalette, colorContrast } from './accentPalette';
import { applyThemeToDocument, setSystemAccentColor } from './themeRuntimeService';

afterEach(() => {
  setSystemAccentColor(null);
});

describe('complete accessible accent families', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`keeps arbitrary ${theme} accents opaque and readable with paired foregrounds`, () => {
      const accents = [
        '#000000',
        '#ffffff',
        '#ffff00',
        '#ff0000',
        '#00ff00',
        '#0000ff',
        '#777777',
        '#4a7cf7',
        '#7aa2ff',
        'invalid',
      ];
      for (let r = 0; r <= 255; r += 51)
        for (let g = 0; g <= 255; g += 51)
          for (let b = 0; b <= 255; b += 51) {
            accents.push(
              `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`,
            );
          }
      for (const accent of accents) {
        const palette = buildAccentPalette(accent, theme);
        for (const value of Object.values(palette)) expect(value).toMatch(/^#[a-f0-9]{6}$/);
        for (const background of ['--color-primary', '--color-primary-hover']) {
          expect(
            colorContrast(palette[background], palette['--color-on-primary']),
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
          colorContrast(palette['--color-primary'], palette['--color-primary-light']),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          colorContrast(palette['--color-primary'], theme === 'dark' ? '#3c3c3c' : '#f0f2f5'),
        ).toBeGreaterThanOrEqual(4.5);
        expect(palette['--color-focus-ring']).toBe(palette['--color-border-focus']);
        expect(palette['--color-bg-active']).toBe(palette['--color-primary-light']);
      }
    });
  }

  it('regenerates every dependent token on theme switches without stale inline colors', () => {
    setSystemAccentColor('#e0ef12');
    for (const theme of ['light', 'dark', 'light'] as const) {
      applyThemeToDocument(theme, theme);
      for (const [key, value] of Object.entries(buildAccentPalette('#e0ef12', theme))) {
        expect(document.documentElement.style.getPropertyValue(key)).toBe(value);
      }
    }
    setSystemAccentColor('invalid');
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(
      buildAccentPalette(null, 'light')['--color-primary'],
    );
  });

  it('keeps muted and placeholder text readable on the supported neutral surfaces', () => {
    for (const surface of ['#ffffff', '#f5f6f8', '#fdfbf7', '#f0f2f5']) {
      expect(colorContrast('#62677b', surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of ['#1f1f1f', '#252526', '#2d2d30', '#3c3c3c']) {
      expect(colorContrast('#b0b0b8', surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
