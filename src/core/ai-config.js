/**
 * core/ai-config.js — AI 运行时配置
 */

const STORAGE_KEY = 'aiConfig';

const DEFAULT_CONFIG = {
  // 开源版本默认使用本地 mock，避免未配置时向任何外部服务发送聊天内容。
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  prompt: 'You are a professional sales assistant. Generate a concise and natural reply in the same language as the customer message.',
  // 润色模式专用 system prompt；为空时回退到 prompt
  polishPrompt: 'You are a professional writing assistant. Polish the user draft so it is clearer, more natural, and more professional, while keeping the original intent and language.',
  // 默认关闭调试日志，避免聊天内容出现在浏览器控制台。
  debug: false,
};

function getStorageArea() {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error('chrome.storage.local is unavailable');
  }
  return globalThis.chrome.storage.local;
}

export function getDefaultAiConfig() {
  return { ...DEFAULT_CONFIG };
}

export async function loadAiConfig() {
  try {
    const storage = getStorageArea();
    const result = await storage.get(STORAGE_KEY);
    return {
      ...DEFAULT_CONFIG,
      ...(result?.[STORAGE_KEY] || {}),
    };
  } catch (e) {
    // 扩展上下文失效（Extension context invalidated）等异常时，
    // 降级使用默认配置，避免中断 AI 生成流程
    console.warn('[AI] loadAiConfig failed, falling back to default:', e?.message || e);
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveAiConfig(config = {}) {
  const storage = getStorageArea();
  const nextConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  await storage.set({
    [STORAGE_KEY]: nextConfig,
  });
  return nextConfig;
}
