#!/usr/bin/env node
/**
 * Copy Vite `dist/` into the Android asset bundle (run after `npm run build:web`).
 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist');
const dest = join(root, 'android', 'app', 'src', 'main', 'assets', 'public');

if (!existsSync(src)) {
  console.error('dist/ missing — run npm run build:web first');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Synced ${src} → ${dest}`);
