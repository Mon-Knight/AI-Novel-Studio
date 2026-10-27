import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheetPaths = [
  'src/styles/theme.css',
  'src/styles/story-assets.css',
  'src/styles/reference-library.css',
  'src/styles/autonomous-planning.css',
  'src/styles/novel-detail.css',
  'src/styles/page-layout.css',
  'src/styles/hub.css',
  'src/styles/right-dock.css',
] as const;

describe('readable support text in secondary surfaces', () => {
  it('does not leave explicit 9–11px text in the reviewed user-facing stylesheets', () => {
    for (const relativePath of stylesheetPaths) {
      const css = readFileSync(resolve(relativePath), 'utf8');
      expect(css, relativePath).not.toMatch(/font-size:\s*(?:9|10|11)px\b/u);
    }
  });

  it('keeps hover treatment on controls and navigational entries, not static cards', () => {
    const storyAssets = readFileSync(resolve('src/styles/story-assets.css'), 'utf8');
    const referenceLibrary = readFileSync(resolve('src/styles/reference-library.css'), 'utf8');
    const autonomous = readFileSync(resolve('src/styles/autonomous-planning.css'), 'utf8');
    expect(storyAssets).not.toMatch(/story-assets-(?:card|review|history)[^{]*:hover/u);
    expect(referenceLibrary).toMatch(/\.reference-work-item:hover/u);
    expect(autonomous).toMatch(/\.autonomous-(?:icon-button|tabs button):hover/u);
  });

  it('keeps visible controls comfortably targetable', () => {
    const theme = readFileSync(resolve('src/styles/theme.css'), 'utf8');
    const autonomous = readFileSync(resolve('src/styles/autonomous-planning.css'), 'utf8');
    const reference = readFileSync(resolve('src/styles/reference-library.css'), 'utf8');
    expect(theme).toMatch(/\.tree-load-more\s*\{[\s\S]*?padding:\s*5px 8px/u);
    expect(autonomous).toMatch(
      /\.autonomous-icon-button\s*\{[\s\S]*?width:\s*34px;[\s\S]*?height:\s*34px/u,
    );
    expect(reference).toMatch(/\.reference-work-item\s*\{[\s\S]*?padding:\s*11px 12px/u);
    const pageLayout = readFileSync(resolve('src/styles/page-layout.css'), 'utf8');
    expect(pageLayout).toMatch(
      /\.resource-icon-button\s*\{[\s\S]*?min-width:\s*28px;[\s\S]*?min-height:\s*28px/u,
    );
    expect(pageLayout).toMatch(/\.resource-pill\s*\{[\s\S]*?font-size:\s*12px/u);
    const rightDock = readFileSync(resolve('src/styles/right-dock.css'), 'utf8');
    expect(rightDock).toMatch(
      /\.right-toolbar-btn\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/u,
    );
    expect(rightDock).toMatch(/\.right-panel-header\s*\{[\s\S]*?min-height:\s*44px/u);
  });

  it('keeps the review tool rail and panel on the shell rail/side-panel widths', () => {
    const variables = readFileSync(resolve('src/styles/variables.css'), 'utf8');
    expect(variables).toMatch(/--right-toolbar-width:\s*56px/u);
    expect(variables).toMatch(/--sidebar-rail-width:\s*56px/u);
    expect(variables).toMatch(/--right-panel-width:\s*360px/u);
    expect(variables).toMatch(/--side-panel-width:\s*360px/u);
  });
});
