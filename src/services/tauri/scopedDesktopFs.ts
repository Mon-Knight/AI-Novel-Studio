/**
 * Narrow desktop file access.
 *
 * Tauri 1.8.3 (the locked crate) extends the runtime FS scope inside the dialog
 * command before it returns the path: a single file uses `Scopes::allow_file`,
 * a directory uses `Scopes::allow_directory`, and save uses `Scopes::allow_file`
 * (`tauri-1.8.3/src/endpoints/dialog.rs`). That grant is not persisted. The
 * static allowlist therefore stays the declared lifecycle sidecar file only.
 *
 * This module does not reimplement the Rust glob matcher and does not prove CSP.
 * It only refuses to hand the FS API any path other than the exact dialog result
 * or the exact sidecar path it computes. Development mode uses the same rule:
 * automation fixture paths are accepted only when a dialog returns them.
 */

export type DesktopFsMode = 'production' | 'development';
export type DesktopFsKind = 'dialog-read' | 'dialog-write' | 'sidecar-read';

export interface DesktopOpenFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
  directory?: boolean;
  recursive?: boolean;
}

export interface DesktopSaveFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface ScopedDesktopFsPorts {
  open(options: DesktopOpenFileOptions): Promise<string | string[] | null>;
  save(options: DesktopSaveFileOptions): Promise<string | null>;
  readTextFile(path: string): Promise<string>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeTextFile(path: string, contents: string): Promise<void>;
  homeDir(): Promise<string>;
  join(home: string, fileName: string): Promise<string>;
}

export interface DesktopFsRequest {
  mode: DesktopFsMode;
  kind: DesktopFsKind;
  candidate: string;
  dialogGrant?: string | null;
  sidecarHome?: string | null;
  sidecarFileName?: string | null;
}

export type DesktopFsDecision =
  { allowed: true; path: string } | { allowed: false; reason: string };

interface AbsolutePath {
  windows: boolean;
  segments: string[];
}

export const DECLARED_LIFECYCLE_SIDECAR_NAME = '.ai-novel-studio-local-model-lifecycle.json';

function denied(reason: string): DesktopFsDecision {
  return { allowed: false, reason };
}

function withoutExtendedPrefix(value: string): string {
  if (/^\\\\\?\\UNC\\/iu.test(value)) return value.replace(/^\\\\\?\\UNC\\/iu, '\\\\');
  return value.startsWith('\\\\?\\') ? value.slice(4) : value;
}

function parseAbsolute(value: string, directory: boolean): AbsolutePath | null {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return null;
  if (value.includes('\0')) return null;
  const comparable = withoutExtendedPrefix(value);
  const trailing = /[\\/]$/u.test(comparable);
  if (!directory && trailing) return null;
  const withoutTrailing = trailing ? comparable.replace(/[\\/]+$/u, '') : comparable;
  if (!withoutTrailing) return null;
  const unified = withoutTrailing.replace(/[\\/]+/gu, '/');
  const windowsDrive = /^[A-Za-z]:\//u.test(unified);
  const windowsUnc = unified.startsWith('//');
  const windows = windowsDrive || windowsUnc;
  const posix = !windows && unified.startsWith('/');
  if (!windows && !posix) return null;
  const segments = windowsUnc
    ? unified.slice(2).split('/')
    : windows
      ? unified.split('/')
      : unified.slice(1).split('/');
  if (segments.length === 0 || (windowsUnc && segments.length < 2)) return null;
  if (windowsDrive && !/^[A-Za-z]:$/u.test(segments[0] ?? '')) return null;
  if (segments.some((part) => part.length === 0 || part === '.' || part === '..')) return null;
  return { windows, segments };
}

function samePath(left: AbsolutePath, right: AbsolutePath): boolean {
  if (left.windows !== right.windows || left.segments.length !== right.segments.length) {
    return false;
  }
  return left.segments.every((part, index) => {
    const other = right.segments[index] ?? '';
    return left.windows ? part.toLowerCase() === other.toLowerCase() : part === other;
  });
}

export function isDeclaredSidecarFileName(fileName: string): boolean {
  return fileName === DECLARED_LIFECYCLE_SIDECAR_NAME;
}

export function declaredLifecycleSidecarScope(fileName: string): string {
  if (!isDeclaredSidecarFileName(fileName)) {
    throw new Error('DESKTOP_FS_DENIED: 生命周期 sidecar 文件名无效。');
  }
  return `$HOME/${fileName}`;
}

function sidecarMatches(home: string, filePath: string, fileName: string): boolean {
  if (!isDeclaredSidecarFileName(fileName)) return false;
  const root = parseAbsolute(home, true);
  const file = parseAbsolute(filePath, false);
  if (!root || !file) return false;
  if (file.segments.length !== root.segments.length + 1) return false;
  const parent = { windows: file.windows, segments: file.segments.slice(0, -1) };
  const leaf = file.segments[file.segments.length - 1] ?? '';
  const leafMatches = file.windows
    ? leaf.toLowerCase() === fileName.toLowerCase()
    : leaf === fileName;
  return leafMatches && samePath(parent, root);
}

/**
 * Production and development use one rule. Fixture paths are not a static
 * scope; a test path is allowed only when the dialog returned that exact file.
 */
export function decideDesktopFileAccess(request: DesktopFsRequest): DesktopFsDecision {
  if (request.mode !== 'production' && request.mode !== 'development') {
    return denied('DESKTOP_FS_DENIED: 未知的桌面文件访问模式。');
  }
  if (request.kind === 'sidecar-read') {
    const home = request.sidecarHome ?? '';
    const fileName = request.sidecarFileName ?? '';
    if (!sidecarMatches(home, request.candidate, fileName)) {
      return denied('DESKTOP_FS_DENIED: 拒绝未声明的生命周期 sidecar 路径。');
    }
    return { allowed: true, path: request.candidate };
  }
  if (request.kind !== 'dialog-read' && request.kind !== 'dialog-write') {
    return denied('DESKTOP_FS_DENIED: 未知的桌面文件访问类型。');
  }
  const grant = request.dialogGrant ?? '';
  const granted = parseAbsolute(grant, false);
  const candidate = parseAbsolute(request.candidate, false);
  if (!granted || !candidate || !samePath(granted, candidate)) {
    return denied('DESKTOP_FS_DENIED: 拒绝未经文件对话框显式选择的路径。');
  }
  return { allowed: true, path: grant };
}

function assertSingleFileDialog(options: DesktopOpenFileOptions): void {
  if (options.directory === true || options.multiple === true || options.recursive === true) {
    throw new Error('DESKTOP_FS_DENIED: 桌面文件访问只接受单个显式选择的文件。');
  }
}

function invalidBytes(): Error {
  return new Error('DESKTOP_FS_DENIED: 桌面文件读取结果无效。');
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  const bytesPerElement = (value as { BYTES_PER_ELEMENT?: unknown } | null)?.BYTES_PER_ELEMENT;
  if (ArrayBuffer.isView(value) && bytesPerElement === 1) {
    const view = value as ArrayBufferView & ArrayLike<number>;
    const copy = new Uint8Array(view.byteLength);
    for (let index = 0; index < view.byteLength; index += 1) {
      const byte = view[index];
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw invalidBytes();
      copy[index] = byte;
    }
    return copy;
  }
  if (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255,
    )
  ) {
    return Uint8Array.from(value);
  }
  throw invalidBytes();
}

function unusedPort(name: string): () => Promise<never> {
  return async () => {
    throw new Error(`DESKTOP_FS_DENIED: 此操作不使用 ${name}。`);
  };
}

async function openDialogPorts(): Promise<Pick<ScopedDesktopFsPorts, 'open' | 'readBinaryFile'>> {
  const [{ open }, fs] = await Promise.all([
    import('@tauri-apps/api/dialog'),
    import('@tauri-apps/api/fs'),
  ]);
  return {
    open,
    readBinaryFile: (filePath) => fs.readBinaryFile(filePath),
  };
}

async function saveDialogPorts(): Promise<Pick<ScopedDesktopFsPorts, 'save' | 'writeTextFile'>> {
  const [{ save }, fs] = await Promise.all([
    import('@tauri-apps/api/dialog'),
    import('@tauri-apps/api/fs'),
  ]);
  return {
    save,
    writeTextFile: (filePath, contents) => fs.writeTextFile(filePath, contents),
  };
}

async function sidecarPorts(): Promise<ScopedDesktopFsPorts> {
  const [fs, pathApi] = await Promise.all([
    import('@tauri-apps/api/fs'),
    import('@tauri-apps/api/path'),
  ]);
  return {
    readTextFile: (filePath) => fs.readTextFile(filePath),
    homeDir: () => pathApi.homeDir(),
    join: (home, fileName) => pathApi.join(home, fileName),
    open: unusedPort('open'),
    save: unusedPort('save'),
    readBinaryFile: unusedPort('readBinaryFile'),
    writeTextFile: unusedPort('writeTextFile'),
  };
}

export async function readBinaryFileFromOpenDialog(
  options: DesktopOpenFileOptions,
  ports?: ScopedDesktopFsPorts,
): Promise<{ path: string; bytes: Uint8Array } | null> {
  assertSingleFileDialog(options);
  const active = ports ?? (await openDialogPorts());
  const selected = await active.open({
    ...options,
    multiple: false,
    directory: false,
    recursive: false,
  });
  if (selected == null) return null;
  if (typeof selected !== 'string') {
    throw new Error('DESKTOP_FS_DENIED: 桌面文件访问只接受单个显式选择的文件。');
  }
  const decision = decideDesktopFileAccess({
    mode: 'production',
    kind: 'dialog-read',
    candidate: selected,
    dialogGrant: selected,
  });
  if (!decision.allowed) throw new Error(decision.reason);
  const bytes = asBytes(await active.readBinaryFile(decision.path));
  return { path: decision.path, bytes };
}

export async function writeTextFromSaveDialog(
  options: DesktopSaveFileOptions,
  contents: string,
  ports?: ScopedDesktopFsPorts,
): Promise<string | null> {
  if (typeof contents !== 'string') {
    throw new Error('DESKTOP_FS_DENIED: 只能写入文本内容。');
  }
  const active = ports ?? (await saveDialogPorts());
  const selected = await active.save(options);
  if (selected == null) return null;
  const decision = decideDesktopFileAccess({
    mode: 'production',
    kind: 'dialog-write',
    candidate: selected,
    dialogGrant: selected,
  });
  if (!decision.allowed) throw new Error(decision.reason);
  await active.writeTextFile(decision.path, contents);
  return decision.path;
}

export async function readDeclaredLifecycleSidecar(
  fileName: string,
  ports?: ScopedDesktopFsPorts,
): Promise<string> {
  if (!isDeclaredSidecarFileName(fileName)) {
    throw new Error('DESKTOP_FS_DENIED: 生命周期 sidecar 文件名无效。');
  }
  const active = ports ?? (await sidecarPorts());
  const home = await active.homeDir();
  const candidate = await active.join(home, fileName);
  const decision = decideDesktopFileAccess({
    mode: 'production',
    kind: 'sidecar-read',
    candidate,
    sidecarHome: home,
    sidecarFileName: fileName,
  });
  if (!decision.allowed) throw new Error(decision.reason);
  return active.readTextFile(decision.path);
}
