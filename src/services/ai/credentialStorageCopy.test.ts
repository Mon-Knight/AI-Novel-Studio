import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { credentialStorageCopy } from './credentialStorageCopy';
import { AiApiModelEditor } from '../../components/settings/AiApiModelEditor';
import { LocalModelEditor } from '../../components/settings/LocalModelEditor';
import { GatewayModelEditor } from '../../components/settings/GatewayModelEditor';
import { emptyApiModelDraft } from '../../components/settings/apiModelEditorDraft';
import {
  emptyGatewayModelDraft,
  emptyLocalModelDraft,
} from '../../components/settings/optionalModelEditorDraft';

test('credential copy distinguishes Windows DPAPI persistence, browser memory and local placeholder semantics', () => {
  const desktop = credentialStorageCopy(true);
  assert.match(desktop.saved, /DPAPI.*加密保存.*重启后可恢复/);
  assert.match(desktop.keyHelp, /清空并保存会删除当前模型身份/);
  assert.match(desktop.localKeyHelp, /本地免鉴权使用占位值/);
  assert.doesNotMatch(desktop.saved, /仅保留.*会话/);
  assert.match(desktop.unavailableHint, /加密凭据恢复/);
  const browser = credentialStorageCopy(false);
  assert.match(browser.saved, /当前会话内存/);
  assert.doesNotMatch(browser.saved, /DPAPI|加密保存|可恢复/);
  assert.match(browser.keyHelp, /Provider、Endpoint 与模型精确绑定/);
});

test('all three model editors display environment-correct key help even with a filled draft', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const actions = { onChange: () => undefined, onSave: () => undefined, onCancel: () => undefined };
  try {
    for (const desktop of [false, true]) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: desktop ? { __TAURI_INTERNALS__: {} } : {},
      });
      for (const html of [
        renderToStaticMarkup(
          createElement(AiApiModelEditor, { ...actions, draft: emptyApiModelDraft() }),
        ),
        renderToStaticMarkup(
          createElement(LocalModelEditor, { ...actions, draft: emptyLocalModelDraft() }),
        ),
        renderToStaticMarkup(
          createElement(GatewayModelEditor, { ...actions, draft: emptyGatewayModelDraft() }),
        ),
      ]) {
        assert.match(html, desktop ? /DPAPI/ : /当前会话内存/);
        assert.match(html, /清空并保存/);
        assert.match(html, /不写入模型卡片、项目备份或 Git/);
      }
    }
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
