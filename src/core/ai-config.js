/**
 * core/ai-config.js — AI 运行时配置
 */

const STORAGE_KEY = 'aiConfig';

/** @typedef {'text' | 'structured'} AiOutputMode */

/**
 * 输出模式：
 * - text：只约束「写入输入框的一句」；人设 prompt 可随便改
 * - structured：代码追加 JSON 契约，解释面板才有总结/解释/翻译
 */
export const OUTPUT_MODE_TEXT = 'text';
export const OUTPUT_MODE_STRUCTURED = 'structured';

/**
 * @param {unknown} value
 * @returns {AiOutputMode}
 */
export function normalizeOutputMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === OUTPUT_MODE_STRUCTURED || raw === 'json' || raw === 'detail' || raw === 'panel') {
    return OUTPUT_MODE_STRUCTURED;
  }
  return OUTPUT_MODE_TEXT;
}

const DEFAULT_CONFIG = {
  // 开源版本默认使用本地 mock，避免未配置时向任何外部服务发送聊天内容。
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  // openai 兼容接口使用的模型名；dify 可忽略
  model: '',
  // 人设 / 业务提示词（用户可改）；输出序列化契约不写在这里
  prompt: 'You are a professional sales assistant. Generate a concise and natural reply in the same language as the customer message.',
  // 润色模式专用 system prompt；为空时回退到 prompt
  polishPrompt: 'You are a professional writing assistant. Polish the user draft so it is clearer, more natural, and more professional, while keeping the original intent and language.',
  // 默认纯文本：分发友好；需要解释面板时再选 structured
  outputMode: OUTPUT_MODE_TEXT,
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

function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    outputMode: normalizeOutputMode(raw.outputMode ?? DEFAULT_CONFIG.outputMode),
    debug: raw.debug === true,
  };
}

export async function loadAiConfig() {
  try {
    const storage = getStorageArea();
    const result = await storage.get(STORAGE_KEY);
    return normalizeConfig(result?.[STORAGE_KEY] || {});
  } catch (e) {
    // 扩展上下文失效（Extension context invalidated）等异常时，
    // 降级使用默认配置，避免中断 AI 生成流程
    console.warn('[AI] loadAiConfig failed, falling back to default:', e?.message || e);
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveAiConfig(config = {}) {
  const storage = getStorageArea();
  const nextConfig = normalizeConfig(config);
  await storage.set({
    [STORAGE_KEY]: nextConfig,
  });
  return nextConfig;
}
