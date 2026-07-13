import { isTauriRuntime } from '../tauri/runtime';

export type ImportFileKind = 'txt' | 'json';

export interface SelectedImportFile {
  kind: ImportFileKind;
  name: string;
  path: string;
  source: 'tauri' | 'browser';
  browserFile?: File;
}

const FILE_CONFIG: Record<ImportFileKind, { label: string; extensions: string[]; mimeTypes: string[] }> = {
  txt: { label: 'TXT 小说文本', extensions: ['txt'], mimeTypes: ['text/plain'] },
  json: { label: 'JSON 导入文件', extensions: ['json'], mimeTypes: ['application/json'] },
};

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function extensionOf(path: string): string {
  const name = fileNameFromPath(path);
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function validateImportFilePath(path: string, kind: ImportFileKind): void {
  if (!path.trim()) throw new Error('未选择文件');
  const allowed = FILE_CONFIG[kind].extensions;
  if (!allowed.includes(extensionOf(path))) {
    throw new Error(`文件格式不受支持，请选择 .${allowed.join(' 或 .')} 文件`);
  }
}

type BrowserFileHandle = { getFile(): Promise<File> };
type BrowserFilePickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    excludeAcceptAllOption: boolean;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<BrowserFileHandle[]>;
};

async function selectBrowserFile(kind: ImportFileKind): Promise<SelectedImportFile | null> {
  const picker = (window as BrowserFilePickerWindow).showOpenFilePicker;
  if (!picker) throw new Error('当前浏览器不支持系统文件选择，请使用桌面应用导入');
  const config = FILE_CONFIG[kind];
  try {
    const handles = await picker({
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{
        description: config.label,
        accept: Object.fromEntries(config.mimeTypes.map((mime) => [mime, config.extensions.map((ext) => `.${ext}`)])),
      }],
    });
    const file = await handles[0]?.getFile();
    if (!file) return null;
    validateImportFilePath(file.name, kind);
    return {
      kind,
      name: file.name,
      path: `浏览器本地文件/${file.name}`,
      source: 'browser',
      browserFile: file,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function selectImportFile(kind: ImportFileKind): Promise<SelectedImportFile | null> {
  if (!isTauriRuntime()) return selectBrowserFile(kind);
  const { open } = await import('@tauri-apps/api/dialog');
  const config = FILE_CONFIG[kind];
  const selected = await open({
    title: kind === 'txt' ? '选择要导入的 TXT 小说文件' : '选择要导入的 JSON 文件',
    multiple: false,
    directory: false,
    filters: [{ name: config.label, extensions: config.extensions }],
  });
  if (selected === null) return null;
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;
  validateImportFilePath(path, kind);
  return { kind, name: fileNameFromPath(path), path, source: 'tauri' };
}

export async function readSelectedImportFile(file: SelectedImportFile): Promise<string> {
  validateImportFilePath(file.name, file.kind);
  if (file.source === 'browser') {
    if (!file.browserFile) throw new Error('所选文件已失效，请重新选择');
    return file.browserFile.text();
  }
  const { readTextFile } = await import('@tauri-apps/api/fs');
  return readTextFile(file.path);
}

export const systemFilePickerService = {
  select: selectImportFile,
  readText: readSelectedImportFile,
};
