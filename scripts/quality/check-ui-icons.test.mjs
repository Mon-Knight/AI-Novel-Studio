import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectUiSource,
  inspectUiStylesheet,
  isProductionTsx,
  isProductionUiSource,
} from './check-ui-icons.mjs';

test('accepts lucide icons and ordinary Chinese punctuation', () => {
  const source = `
    import { Save } from 'lucide-react';
    export const View = () => <button><Save size={14} strokeWidth={1.8} />保存</button>;
    const flow = '用户控制方向 -> AI 分工生成';
  `;
  assert.deepEqual(inspectUiSource(source), []);
});

test('rejects emoji, character icons, and handwritten svg', () => {
  const source = `
    export const Emoji = () => <button>✅ 保存</button>;
    export const CharacterIcon = () => <button>✕ 关闭</button>;
    export const Svg = () => <svg viewBox="0 0 10 10" />;
  `;
  const violations = inspectUiSource(source, 'fixture.tsx');
  assert.deepEqual(
    violations.map(({ line, kinds }) => ({ line, kinds })),
    [
      { line: 2, kinds: ['emoji'] },
      { line: 3, kinds: ['character-icon'] },
      { line: 4, kinds: ['handwritten-svg'] },
    ],
  );
});

test('rejects legacy symbol glyphs and encoded spinner frames missed by the old gate', () => {
  const source = `
    export const Spark = () => <div>✦</div>;
    export const Theme = () => <span aria-hidden="true">◐</span>;
    const spinnerFrames = ['\\u280b'];
    export const Add = () => <span aria-hidden="true">+</span>;
  `;
  const kinds = inspectUiSource(source, 'fixture.tsx').map((violation) => violation.kinds[0]);
  assert.deepEqual(kinds, [
    'symbol-icon',
    'symbol-icon',
    'symbol-icon',
    'standalone-character-icon',
  ]);
});

test('allows punctuation, arrows, percentages, and numbering used as prose', () => {
  const source = `
    export const Copy = () => (
      <p>① 输入 → ② 生成；完成率 50%，未填写时显示 -。</p>
    );
  `;
  assert.deepEqual(inspectUiSource(source, 'fixture.tsx'), []);
});

test('requires the sidebar stroke width on direct Lucide icons', () => {
  const source = `
    import { Save } from 'lucide-react';
    export const View = () => <Save size={14} />;
  `;
  assert.deepEqual(inspectUiSource(source, 'fixture.tsx'), [
    {
      filePath: 'fixture.tsx',
      line: 3,
      kinds: ['lucide-stroke-width'],
      source: '<Save> must set strokeWidth={1.8}',
    },
  ]);
});

test('requires explicit size, line-only fill, and controlled Lucide props', () => {
  const source = `
    import { Save } from 'lucide-react';
    export const MissingSize = () => <Save strokeWidth={1.8} />;
    export const Filled = () => <Save size={14} strokeWidth={1.8} fill="currentColor" />;
    export const Spread = (props) => <Save size={14} strokeWidth={1.8} {...props} />;
  `;
  assert.deepEqual(
    inspectUiSource(source, 'fixture.tsx').map((violation) => violation.kinds[0]),
    ['lucide-size', 'lucide-fill', 'lucide-prop-spread'],
  );
});

test('rejects non-Lucide libraries, SVG imports, and image control icons', () => {
  const source = `
    import { Star } from 'react-icons/fa';
    import closeIcon from './close.svg';
    export const ImageButton = () => <button><img src={closeIcon} alt="关闭图标" /></button>;
  `;
  assert.deepEqual(
    inspectUiSource(source, 'fixture.tsx').map((violation) => violation.kinds[0]),
    ['non-lucide-icon-library', 'svg-icon-import', 'image-icon'],
  );
});

test('rejects CSS glyph assets and hand-rolled spinner rings', () => {
  const source = `
    .close::before { content: '×'; }
    .icon { background-image: url('./close.svg'); }
    .legacy-spinner {
      border: 2px solid transparent;
      border-radius: 50%;
    }
  `;
  assert.deepEqual(
    inspectUiStylesheet(source, 'fixture.css').map((violation) => violation.kinds[0]),
    ['css-character-icon', 'css-image-icon', 'css-custom-spinner'],
  );
  assert.deepEqual(inspectUiStylesheet(".active::before { content: ''; }", 'fixture.css'), []);
});

test('limits the gate to production TSX', () => {
  assert.equal(isProductionTsx('src/components/Card.tsx', 'src'), true);
  assert.equal(isProductionTsx('src/components/Card.test.tsx', 'src'), false);
  assert.equal(isProductionTsx('src/test/Fixture.tsx', 'src'), false);
  assert.equal(isProductionTsx('src/services/value.ts', 'src'), false);
  assert.equal(isProductionUiSource('src/services/value.ts', 'src'), true);
  assert.equal(isProductionUiSource('src/services/value.test.ts', 'src'), false);
  assert.equal(isProductionUiSource('src/components/View.jsx', 'src'), true);
});
