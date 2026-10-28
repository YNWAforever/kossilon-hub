import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const folder = import.meta.dirname;
const walk = directory => readdirSync(directory).flatMap(name => { const path = join(directory, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
const files = walk(folder).map(absolute => ({ absolute, path: relative(folder, absolute).replaceAll('\\', '/') }))
  .filter(({ path }) => !['evidence-manifest.json', 'verification-report.txt'].includes(path)).sort((a, b) => a.path.localeCompare(b.path))
  .map(({ path, absolute }) => { const bytes = readFileSync(absolute); return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; });
writeFileSync(join(folder, 'evidence-manifest.json'), JSON.stringify({ run_id: 'cosec-20261024-export-9dd9e445', algorithm: 'SHA256', files }, null, 2) + '\n', { flag: 'wx' });
console.log(`Manifested ${files.length} files; manifest and verification report excluded to avoid self-reference.`);
