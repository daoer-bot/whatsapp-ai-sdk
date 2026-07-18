import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const ignored = new Set(['.git', 'node_modules', 'dist']);
const textExtensions = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css', '.txt', '.yml', '.yaml']);
const patterns = [
  { label: 'Dify API key', regex: /\bapp-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'Bearer token', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { label: 'internal identifier', regex: /小满助手|xm-ai|__xm_bridge__/g },
  { label: 'internal domain', regex: /msldd\.com/gi },
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (textExtensions.has(extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

const failures = [];
for (const file of await walk(root)) {
  if (file === fileURLToPath(import.meta.url)) continue;
  const text = await readFile(file, 'utf8');
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) failures.push(`${relative(root, file)}: ${pattern.label}`);
  }
}

if (failures.length) {
  console.error('[secrets] FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('[secrets] OK - 未发现已知凭据或内部标识');
