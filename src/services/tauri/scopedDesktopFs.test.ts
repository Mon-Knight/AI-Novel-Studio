import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideDesktopFileAccess,
  declaredLifecycleSidecarScope,
  readBinaryFileFromOpenDialog,
  readDeclaredLifecycleSidecar,
  writeTextFromSaveDialog,
  type DesktopFsMode,
  type ScopedDesktopFsPorts,
} from './scopedDesktopFs';

const SIDECAR = '.ai-novel-studio-local-model-lifecycle.json';
const HOME = 'C:\\Users\\Writer';
const REFERENCE_FIXTURE = 'C:\\Users\\Writer\\reference.txt';
const SIDECAR_PATH = `${HOME}\\${SIDECAR}`;

function decision(mode: DesktopFsMode, candidate: string, grant: string | null = null) {
  return decideDesktopFileAccess({
    mode,
    kind: grant ? 'dialog-read' : 'sidecar-read',
    candidate,
    dialogGrant: grant,
    sidecarHome: grant ? null : HOME,
    sidecarFileName: grant ? null : SIDECAR,
  });
}

test('dialog grants accept the existing reference fixture and reject its neighbors', () => {
  for (const mode of ['production', 'development'] as const) {
    const allowed = decideDesktopFileAccess({
      mode,
      kind: 'dialog-read',
      candidate: REFERENCE_FIXTURE,
      dialogGrant: REFERENCE_FIXTURE,
    });
    assert.deepEqual(allowed, { allowed: true, path: REFERENCE_FIXTURE });
    for (const candidate of [
      'C:\\Users\\Writer\\secrets.txt',
      'C:\\Users\\Writer\\reference.txt\\..\\secrets.txt',
      'C:\\Users\\Writer\\Documents\\novel.txt',
      REFERENCE_FIXTURE + '\\extra.txt',
      'reference.txt',
      '\\\\server\\share\\other\\reference.txt',
    ]) {
      const denied = decideDesktopFileAccess({
        mode,
        kind: 'dialog-read',
        candidate,
        dialogGrant: REFERENCE_FIXTURE,
      });
      assert.equal(denied.allowed, false, `${mode} ${candidate}`);
    }
  }
});

test('dialog grants accept UNC and extended UNC file paths without widening to neighbors', () => {
  const unc = '\\\\server\\share\\reference.txt';
  const extended = '\\\\?\\UNC\\server\\share\\reference.txt';
  assert.deepEqual(
    decideDesktopFileAccess({
      mode: 'production',
      kind: 'dialog-read',
      candidate: unc,
      dialogGrant: unc,
    }),
    { allowed: true, path: unc },
  );
  assert.deepEqual(
    decideDesktopFileAccess({
      mode: 'production',
      kind: 'dialog-write',
      candidate: extended,
      dialogGrant: extended,
    }),
    { allowed: true, path: extended },
  );
  assert.equal(
    decideDesktopFileAccess({
      mode: 'production',
      kind: 'dialog-read',
      candidate: '\\\\server\\other-share\\reference.txt',
      dialogGrant: unc,
    }).allowed,
    false,
  );
});

test('development mode does not widen access to an unselected automation fixture', () => {
  const fixture = 'C:\\automation\\fixtures\\gate-research-reference.txt';
  const production = decision('production', fixture);
  const development = decision('development', fixture);
  assert.equal(production.allowed, false);
  assert.deepEqual(development, production);
  const selected = decideDesktopFileAccess({
    mode: 'development',
    kind: 'dialog-write',
    candidate: fixture,
    dialogGrant: fixture,
  });
  assert.deepEqual(selected, { allowed: true, path: fixture });
});

test('declared sidecar is one exact file and separator or case variants keep the granted path', () => {
  assert.equal(declaredLifecycleSidecarScope(SIDECAR), `$HOME/${SIDECAR}`);
  assert.equal(
    decideDesktopFileAccess({
      mode: 'production',
      kind: 'sidecar-read',
      candidate: SIDECAR_PATH,
      sidecarHome: HOME + '\\',
      sidecarFileName: SIDECAR,
    }).allowed,
    true,
  );
  assert.equal(
    decideDesktopFileAccess({
      mode: 'development',
      kind: 'sidecar-read',
      candidate: `\\\\?\\${SIDECAR_PATH}`,
      sidecarHome: `\\\\?\\${HOME}`,
      sidecarFileName: SIDECAR,
    }).allowed,
    true,
  );
  for (const candidate of [
    `${HOME}\\${SIDECAR}.bak`,
    `${HOME}\\notes\\${SIDECAR}`,
    `${HOME}\\.ai-novel-studio-local-model-lifecycle.json.txt`,
    'C:\\Windows\\.ai-novel-studio-local-model-lifecycle.json',
  ]) {
    assert.equal(decision('production', candidate).allowed, false, candidate);
    assert.equal(decision('development', candidate).allowed, false, candidate);
  }
  const grant = 'C:/Users/Writer/reference.txt';
  const matched = decideDesktopFileAccess({
    mode: 'production',
    kind: 'dialog-write',
    candidate: 'c:\\users\\writer\\reference.txt',
    dialogGrant: grant,
  });
  assert.deepEqual(matched, { allowed: true, path: grant });
});

function ports(partial: Partial<ScopedDesktopFsPorts>): ScopedDesktopFsPorts {
  const fail = async () => {
    throw new Error('unexpected FS call');
  };
  return {
    open: fail,
    save: fail,
    readTextFile: fail,
    readBinaryFile: fail,
    writeTextFile: fail,
    homeDir: fail,
    join: fail,
    ...partial,
  };
}

test('open dialog reads only the returned fixture path', async () => {
  const calls: string[] = [];
  const bytes = Uint8Array.from([1, 2, 3]);
  const opened = await readBinaryFileFromOpenDialog(
    { title: '选择 TXT 参考资料', multiple: false, directory: false },
    ports({
      open: async (options) => {
        assert.equal(options.multiple, false);
        assert.equal(options.directory, false);
        assert.equal(options.recursive, false);
        return REFERENCE_FIXTURE;
      },
      readBinaryFile: async (path) => {
        calls.push(path);
        return bytes;
      },
    }),
  );
  assert.deepEqual(calls, [REFERENCE_FIXTURE]);
  assert.equal(opened?.path, REFERENCE_FIXTURE);
  assert.equal(opened?.bytes, bytes);
});

test('cancelled, multiple, directory, and traversal selections do not read', async () => {
  let reads = 0;
  const idle = ports({
    open: async () => null,
    readBinaryFile: async () => {
      reads += 1;
      return new Uint8Array();
    },
  });
  assert.equal(await readBinaryFileFromOpenDialog({}, idle), null);
  await assert.rejects(
    () => readBinaryFileFromOpenDialog({}, ports({ open: async () => [REFERENCE_FIXTURE] })),
    /单个显式选择的文件/,
  );
  await assert.rejects(
    () =>
      readBinaryFileFromOpenDialog(
        { directory: true },
        ports({ open: async () => REFERENCE_FIXTURE }),
      ),
    /单个显式选择的文件/,
  );
  await assert.rejects(
    () =>
      readBinaryFileFromOpenDialog(
        {},
        ports({ open: async () => 'C:\\Users\\Writer\\reference.txt\\..\\secrets.txt' }),
      ),
    /未经文件对话框/,
  );
  assert.equal(reads, 0);
});

test('save dialog writes the selected export path and ignores a cancelled dialog', async () => {
  const writes: Array<{ path: string; contents: string }> = [];
  const saved = await writeTextFromSaveDialog(
    { title: '导出文件', defaultPath: 'novel.txt' },
    '正文',
    ports({
      save: async () => 'C:\\Users\\Writer\\Documents\\novel.txt',
      writeTextFile: async (path, contents) => {
        writes.push({ path, contents });
      },
    }),
  );
  assert.equal(saved, 'C:\\Users\\Writer\\Documents\\novel.txt');
  assert.deepEqual(writes, [{ path: saved, contents: '正文' }]);
  const cancelled = await writeTextFromSaveDialog(
    { defaultPath: 'novel.txt' },
    '正文',
    ports({
      save: async () => null,
    }),
  );
  assert.equal(cancelled, null);
  await assert.rejects(
    () => writeTextFromSaveDialog({}, '正文', ports({ save: async () => 'novel.txt' })),
    /未经文件对话框/,
  );
});

test('sidecar read uses only the joined declared file', async () => {
  const reads: string[] = [];
  const text = await readDeclaredLifecycleSidecar(
    SIDECAR,
    ports({
      homeDir: async () => HOME + '\\',
      join: async (home, fileName) => `${home.replace(/[\\/]+$/u, '')}\\${fileName}`,
      readTextFile: async (path) => {
        reads.push(path);
        return '{"schemaVersion":1}';
      },
    }),
  );
  assert.equal(text, '{"schemaVersion":1}');
  assert.deepEqual(reads, [SIDECAR_PATH]);
  await assert.rejects(
    () =>
      readDeclaredLifecycleSidecar(
        SIDECAR,
        ports({
          homeDir: async () => HOME,
          join: async () => `${HOME}\\notes\\${SIDECAR}`,
          readTextFile: async () => {
            throw new Error('read must not run');
          },
        }),
      ),
    /未声明的生命周期 sidecar/,
  );
  await assert.rejects(
    () => readDeclaredLifecycleSidecar('.other-sidecar.json', ports({})),
    /文件名无效/,
  );
  await assert.rejects(
    () => readDeclaredLifecycleSidecar('../sidecar.json', ports({})),
    /文件名无效/,
  );
});
