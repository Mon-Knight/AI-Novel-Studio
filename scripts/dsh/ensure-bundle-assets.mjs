// Debug builds only need resource paths to exist for tauri-build validation.
// Release packaging always replaces the ignored placeholder zip through
// prepare-bundle-assets.mjs, and build.rs rejects an empty release resource.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = path.join(root, 'src-tauri', 'bin');
mkdirSync(bin, { recursive: true });
copyFileSync(
  path.join(root, 'scripts', 'dsh', 'unpack-payload.mjs'),
  path.join(bin, 'unpack-payload.mjs'),
);
const zip = path.join(bin, 'dsh-runtime.zip');
if (!existsSync(zip)) {
  writeFileSync(zip, '');
  console.log('[dsh-assets] created ignored debug resource placeholder');
}
