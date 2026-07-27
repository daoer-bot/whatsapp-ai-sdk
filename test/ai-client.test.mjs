import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAiAnswer,
  resolveDifyBaseUrl,
  resolveOpenAIBaseUrl,
  upgradeToHttps,
  DEFAULT_OPENAI_MODEL,
  generateReply,
} from '../src/core/ai-client.js';
import { buildChatContext, buildPolishPromptText } from '../src/core/prompt-builder.js';

test('parseAiAnswer parses structured JSON text', () => {
  const result = parseAiAnswer(JSON.stringify({
    话术建议: '您好，我马上为您确认。',
    解释: '先确认收到客户需求。',
    总结: '确认需求',
    原文翻译: 'I will confirm it for you.',
  }));
  assert.equal(result.suggestion, '您好，我马上为您确认。');
  assert.equal(result.explanation, '先确认收到客户需求。');
  assert.equal(result.summary, '确认需求');
  assert.equal(result.translation, 'I will confirm it for you.');
});

test('parseAiAnswer handles fenced JSON and plain text', () => {
  assert.equal(parseAiAnswer('```json\n{"suggestion":"hello"}\n```').suggestion, 'hello');
  assert.equal(parseAiAnswer('plain reply').suggestion, 'plain reply');
});

test('upgradeToHttps upgrades mixed-content http urls', () => {
  assert.equal(upgradeToHttps('http://ai.example.com/v1'), 'https://ai.example.com/v1');
  assert.equal(upgradeToHttps('https://ai.example.com/v1'), 'https://ai.example.com/v1');
});

test('resolveDifyBaseUrl appends chat-messages when needed', () => {
  assert.equal(
    resolveDifyBaseUrl('https://ai.example.com/v1'),
    'https://ai.example.com/v1/chat-messages',
  );
  assert.equal(
    resolveDifyBaseUrl('https://ai.example.com/v1/chat-messages'),
    'https://ai.example.com/v1/chat-messages',
  );
  assert.equal(
    resolveDifyBaseUrl('http://ai.example.com/v1/'),
    'https://ai.example.com/v1/chat-messages',
  );
  assert.throws(() => resolveDifyBaseUrl(''), /baseUrl is required/);
});

test('resolveOpenAIBaseUrl appends chat/completions when needed', () => {
  assert.equal(
    resolveOpenAIBaseUrl('https://api.openai.com/v1'),
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(
    resolveOpenAIBaseUrl('https://gateway.example.com/v1/chat/completions'),
    'https://gateway.example.com/v1/chat/completions',
  );
  assert.equal(
    resolveOpenAIBaseUrl('http://gateway.example.com/v1/'),
    'https://gateway.example.com/v1/chat/completions',
  );
  assert.equal(DEFAULT_OPENAI_MODEL, 'gpt-4o-mini');
  assert.throws(() => resolveOpenAIBaseUrl(''), /baseUrl is required/);
});

test('generateReply mock ask and polish modes work offline', async () => {
  const ask = await generateReply({
    chat: { snsId: '123' },
    messages: [{ body: 'price?', send_type: 2 }],
    config: { provider: 'mock' },
    mode: 'ask',
  });
  assert.match(ask.suggestion, /price\?/);

  const polish = await generateReply({
    chat: { snsId: '123' },
    messages: [],
    config: { provider: 'mock' },
    mode: 'polish',
    draft: 'hello customer',
  });
  assert.match(polish.suggestion, /Hello customer/);
});

test('generateReply rejects unknown provider', async () => {
  await assert.rejects(
    () => generateReply({
      chat: {},
      messages: [],
      config: { provider: 'not-a-real-provider' },
    }),
    /Unsupported AI provider/,
  );
});

test('buildChatContext normalizes inbound and outbound messages', () => {
  const context = buildChatContext({
    chat: { snsId: '12345', snsNickname: 'Alice' },
    messages: [
      { body: 'old', send_type: 2, send_time: '2026-07-18 10:00:00' },
      { body: 'reply', send_type: 1, send_time: '2026-07-18 10:01:00' },
    ],
    meId: 'me',
  });
  assert.equal(context.messages.length, 2);
  assert.equal(context.messages[0].role, 'assistant');
  assert.equal(context.messages[1].role, 'customer');
  assert.equal(context.sender_phone, 'me');
  assert.equal(context.receiver_phone, '12345');
});

test('buildPolishPromptText preserves the draft and custom prompt', () => {
  const text = buildPolishPromptText({
    draft: 'hello customer',
    chat: { snsNickname: 'Alice' },
    messages: [],
    systemPrompt: 'Polish this draft.',
    meId: 'me',
  });
  assert.match(text, /hello customer/);
  assert.match(text, /Polish this draft\./);
});
