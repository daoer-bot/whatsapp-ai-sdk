import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * rollup.config.mjs — 打包配置
 *
 * 构建目标：
 *   - content.js → IIFE bundle（classic script），manifest content_scripts 直接加载
 *   - inject.js  → ESM bundle，content script 通过 <script type="module" src="chrome-extension://..."> 注入 page world
 *   - wpp.js     → 复制 @wppconnect/wa-js 官方 browser bundle，作为 classic script 单独注入
 */

const plugins = [resolve(), commonjs()];
const rootDir = dirname(fileURLToPath(import.meta.url));
const wppSrc = pathResolve(rootDir, 'node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js');
const wppDest = pathResolve(rootDir, 'dist/wpp.js');

function copyWppPlugin() {
  return {
    name: 'copy-wpp-runtime',
    buildStart() {
      mkdirSync(dirname(wppDest), { recursive: true });
      copyFileSync(wppSrc, wppDest);
      console.log('[rollup] copied WPP runtime -> dist/wpp.js');
    },
  };
}

export default [
  // content.js — IIFE（isolated world）
  {
    input: 'src/content/content.js',
    output: {
      file: 'dist/content.js',
      format: 'iife',
      name: 'WhatsAppAISDKContent',
    },
    plugins,
  },
  // bridge.js — IIFE（page world 调试桥）
  {
    input: 'src/content/bridge.js',
    output: {
      file: 'dist/bridge.js',
      format: 'iife',
      name: 'WhatsAppAISDKBridge',
    },
    plugins,
  },
  // inject.js — ESM（page world）
  {
    input: 'src/inject/inject.js',
    output: {
      file: 'dist/inject.js',
      format: 'esm',
      inlineDynamicImports: true,
    },
    plugins: [...plugins, copyWppPlugin()],
  },
  // options.js — IIFE（扩展设置页）
  {
    input: 'src/content/options.js',
    output: {
      file: 'dist/options.js',
      format: 'iife',
      name: 'WhatsAppAISDKOptions',
    },
    plugins,
  },
];
