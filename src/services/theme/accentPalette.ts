export type AccentTheme = 'light' | 'dark';

export const DEFAULT_ACCENTS: Record<AccentTheme, string> = {
  light: '#4a7cf7',
  dark: '#7aa2ff',
};

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
}

function hex(channels: Rgb): string {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function mix(first: string, second: string, amount: number): string {
  const a = rgb(first);
  const b = rgb(second);
  return hex(a.map((value, index) => value * (1 - amount) + b[index] * amount) as Rgb);
}

export function colorContrast(first: string, second: string): number {
  const luminance = (value: string) =>
    rgb(value).reduce((sum, channel, index) => {
      const normalized = channel / 255;
      const linear =
        normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      return sum + linear * [0.2126, 0.7152, 0.0722][index];
    }, 0);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function normalizeAccent(accent: unknown): string | null {
  return typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : null;
}

/** Opaque, hue-preserving accent families with tested text contrast in both themes. */
export function buildAccentPalette(accent: unknown, theme: AccentTheme): Record<string, string> {
  const source = normalizeAccent(accent) ?? DEFAULT_ACCENTS[theme];
  const dark = theme === 'dark';
  const onPrimary = dark ? '#111827' : '#ffffff';
  const endpoint = dark ? '#ffffff' : '#000000';
  const surface = dark ? '#252526' : '#ffffff';
  const mostDemandingSurface = dark ? '#3c3c3c' : '#f0f2f5';
  let primary = endpoint;
  let light = surface;
  for (let step = 0; step <= 255; step += 1) {
    const candidate = mix(source, endpoint, step / 255);
    const tinted = mix(surface, candidate, dark ? 0.12 : 0.07);
    if (
      colorContrast(candidate, onPrimary) >= 4.5 &&
      colorContrast(candidate, mostDemandingSurface) >= 4.5 &&
      colorContrast(candidate, tinted) >= 4.5
    ) {
      primary = candidate;
      light = tinted;
      break;
    }
  }
  const hover = mix(primary, endpoint, 0.12);
  return {
    '--color-primary': primary,
    '--color-primary-hover': hover,
    '--color-primary-light': light,
    '--color-primary-dark': mix(primary, endpoint, 0.24),
    '--color-on-primary': onPrimary,
    '--color-accent': primary,
    '--color-focus-ring': primary,
    '--color-bg-active': light,
    '--color-border-focus': primary,
  };
}
