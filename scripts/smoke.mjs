/**
 * scripts/smoke.mjs — 构建产物与源码结构冒烟检查
 *
 * 用法：npm run build && npm run smoke
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const requiredFiles = [
  'manifest.json',
  'options.html',
  'package.json',
  'rollup.config.mjs',
  'dist/content.js',
  'dist/inject.js',
  'dist/bridge.js',
  'dist/options.js',
  'dist/wpp.js',
  'src/content/content.js',
  'src/inject/inject.js',
  'src/core/rpc.js',
  'src/core/selectors.js',
  'src/core/message-types.js',
  'src/core/ai-client.js',
  'src/core/data-extractor.js',
];

const forbiddenFiles = [
  'src/inject/wpp-loader.js',
  'src/inject/wpp-runtime.js',
];

let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
}

console.log('[smoke] project root:', projectRoot);
console.log('[smoke] checking required files...');

for (const rel of requiredFiles) {
  const abs = join(projectRoot, rel);
  if (!existsSync(abs)) {
    fail(`missing: ${rel}`);
    continue;
  }
  const size = statSync(abs).size;
  if (size <= 0) {
    fail(`empty: ${rel}`);
    continue;
  }
  ok(`${rel} (${size} bytes)`);
}

console.log('[smoke] checking forbidden legacy files...');
for (const rel of forbiddenFiles) {
  const abs = join(projectRoot, rel);
  if (existsSync(abs)) {
    fail(`legacy file still present: ${rel}`);
  } else {
    ok(`removed: ${rel}`);
  }
}

console.log('[smoke] checking manifest web_accessible_resources...');
try {
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'manifest.json'), 'utf8'));
  const resources = manifest.web_accessible_resources?.[0]?.resources || [];
  for (const need of ['dist/inject.js', 'dist/bridge.js', 'dist/wpp.js']) {
    if (resources.includes(need)) ok(`manifest exposes ${need}`);
    else fail(`manifest missing resource: ${need}`);
  }
  if (!manifest.content_scripts?.[0]?.js?.includes('dist/content.js')) {
    fail('manifest content_scripts missing dist/content.js');
  } else {
    ok('manifest content_scripts includes dist/content.js');
  }
} catch (e) {
  fail(`manifest parse error: ${e.message}`);
}

console.log('[smoke] checking dist/content.js contains key markers...');
try {
  const content = readFileSync(join(projectRoot, 'dist/content.js'), 'utf8');
  for (const marker of [
    'WhatsappAI',
    'generateAndFill',
    'INJECT_READY',
    'includeMedia',
    'chat/completions',
    'Unsupported AI provider',
  ]) {
    if (content.includes(marker)) ok(`content.js has "${marker}"`);
    else fail(`content.js missing marker: ${marker}`);
  }
} catch (e) {
  fail(`read content.js: ${e.message}`);
}

console.log('[smoke] checking options page multi-provider wiring...');
try {
  const optionsHtml = readFileSync(join(projectRoot, 'options.html'), 'utf8');
  for (const marker of ['value="mock"', 'value="dify"', 'value="openai"', 'name="model"']) {
    if (optionsHtml.includes(marker)) ok(`options.html has ${marker}`);
    else fail(`options.html missing: ${marker}`);
  }
  const optionsJs = readFileSync(join(projectRoot, 'dist/options.js'), 'utf8');
  if (optionsJs.includes('model')) ok('options.js persists model field');
  else fail('options.js missing model field wiring');
} catch (e) {
  fail(`options multi-provider check: ${e.message}`);
}

console.log('[smoke] checking README load path guidance...');
try {
  const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8');
  if (/不要.*只选择.*dist|不是 `dist\/`|不是\*\*`dist\/`\*\*/.test(readme)
    && /仓库根目录/.test(readme)
    && /manifest\.json/.test(readme)) {
    ok('README warns to load repo root, not dist/');
  } else {
    fail('README missing explicit root-vs-dist load guidance');
  }
} catch (e) {
  fail(`README check: ${e.message}`);
}

console.log('[smoke] checking dist/inject.js markers...');
try {
  const inject = readFileSync(join(projectRoot, 'dist/inject.js'), 'utf8');
  for (const marker of ['GET_MESSAGES', 'ensureWppReady', 'includeMedia']) {
    if (inject.includes(marker)) ok(`inject.js has "${marker}"`);
    else fail(`inject.js missing marker: ${marker}`);
  }
} catch (e) {
  fail(`read inject.js: ${e.message}`);
}

// wpp 体积粗检（应是完整 bundle，通常 > 100KB）
try {
  const wppSize = statSync(join(projectRoot, 'dist/wpp.js')).size;
  if (wppSize > 100_000) ok(`dist/wpp.js size looks ok (${wppSize})`);
  else fail(`dist/wpp.js too small (${wppSize}), copy may have failed`);
} catch (e) {
  fail(`wpp size check: ${e.message}`);
}

if (failed > 0) {
  console.error(`\n[smoke] FAILED with ${failed} issue(s)`);
  process.exit(1);
}

console.log('\n[smoke] OK');
