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
    'waai-settings-root',
    'openSettingsDrawer',
    'AI 润色',
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
  if (/浏览器扩展/.test(readme) && /npm runtime/.test(readme)) {
    ok('README states extension (not npm runtime) positioning');
  } else {
    fail('README missing extension-vs-npm positioning');
  }
  if (/THREAT_MODEL|威胁模型/.test(readme) && /SELECTOR_CHECKLIST|回归清单/.test(readme)) {
    ok('README links threat model and selector checklist');
  } else {
    fail('README missing threat model / selector checklist links');
  }
} catch (e) {
  fail(`README check: ${e.message}`);
}

console.log('[smoke] checking portfolio docs presence...');
for (const rel of [
  'README.en.md',
  'docs/THREAT_MODEL.md',
  'docs/SELECTOR_CHECKLIST.md',
  'docs/assets/README.md',
  'test/rpc.test.mjs',
  'test/prompt-builder.test.mjs',
  'test/message-types.test.mjs',
]) {
  const abs = join(projectRoot, rel);
  if (existsSync(abs) && statSync(abs).size > 0) ok(`present: ${rel}`);
  else fail(`missing portfolio/doc/test file: ${rel}`);
}

console.log('[smoke] checking composer anti-duplication markers...');
try {
  const composer = readFileSync(join(projectRoot, 'src/core/composer.js'), 'utf8');
  for (const marker of [
    'fillSendInputAsync',
    'ComposeBoxActions',
    'setTextContent',
    'clearComposer',
    'skip, already same',
    'select-replace',
    'fillViaSelectReplace',
    'isExactDouble',
    'insertOnceSafe',
  ]) {
    if (composer.includes(marker)) ok(`composer.js has "${marker}"`);
    else fail(`composer.js missing marker: ${marker}`);
  }
  const injectSrc = readFileSync(join(projectRoot, 'src/inject/inject.js'), 'utf8');
  if (injectSrc.includes('fillSendInputAsync')) ok('inject.js uses fillSendInputAsync');
  else fail('inject.js missing fillSendInputAsync');
  if (injectSrc.includes('skip sync fallback')) ok('inject.js guards sync fallback after async');
  else fail('inject.js missing sync fallback guard');
  const content = readFileSync(join(projectRoot, 'src/content/content.js'), 'utf8');
  if (content.includes('allowStreamPrefill')) ok('content.js gates stream prefill');
  else fail('content.js missing allowStreamPrefill gate');
  if (content.includes('single fill result') || content.includes('skip final fill')) {
    ok('content.js uses single-fill final path');
  } else {
    fail('content.js missing single-fill final path');
  }
  if (content.includes('isDoubled') || content.includes('dedupe once')) {
    ok('content.js detects doubled composer text');
  } else {
    fail('content.js missing doubled-text guard');
  }
  if (content.includes("fillInput('', true)") || content.includes('clear+rewrite once')) {
    fail('content.js still has clear+rewrite double-write path');
  } else {
    ok('content.js removed clear+rewrite double-write');
  }
} catch (e) {
  fail(`composer anti-duplication check: ${e.message}`);
}

console.log('[smoke] checking dist/inject.js markers...');
try {
  const inject = readFileSync(join(projectRoot, 'dist/inject.js'), 'utf8');
  for (const marker of ['GET_MESSAGES', 'ensureWppReady', 'includeMedia', 'fillSendInputAsync']) {
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
