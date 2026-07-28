import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatContext,
  buildPromptText,
  buildPolishPromptText,
  buildOutputContract,
} from '../src/core/prompt-builder.js';
import { normalizeOutputMode } from '../src/core/ai-config.js';

test('buildChatContext drops empty content and caps limit', () => {
  const context = buildChatContext({
    chat: { snsId: 'peer', snsNickname: 'Bob', isGroup: false },
    meId: 'me-phone',
    limit: 2,
    messages: [
      { body: 'first', send_type: 2, type: 'text' },
      { body: '', send_type: 2, type: 'text' },
      { body: 'second', send_type: 1, type: 'text' },
      { body: 'third', send_type: 2, type: 'text' },
    ],
  });

  assert.equal(context.messages.length, 2);
  assert.equal(context.sender_phone, 'me-phone');
  assert.equal(context.receiver_phone, 'peer');
  assert.equal(context.snsNickname, 'Bob');
  // slice(0, limit).reverse() keeps earliest of the filtered head
  assert.equal(context.messages[0].content, 'second');
  assert.equal(context.messages[1].content, 'first');
});

test('buildChatContext normalizes media placeholders without caption', () => {
  const context = buildChatContext({
    chat: { snsId: 'x' },
    messages: [
      { type: 'image', body: {}, send_type: 2 },
      { type: 'audio', body: { duration: '0:12' }, send_type: 2 },
      { type: 'document', body: { fileName: 'spec.pdf' }, send_type: 1 },
      { type: 'video', body: { caption: 'see this' }, send_type: 2 },
    ],
  });

  const contents = context.messages.map((m) => m.content);
  assert.ok(contents.includes('[image]'));
  assert.ok(contents.includes('[audio 0:12]'));
  assert.ok(contents.includes('[document: spec.pdf]'));
  assert.ok(contents.includes('see this'));
});

test('buildPromptText includes system prompt and recent lines', () => {
  const text = buildPromptText({
    chat: { snsId: 'c1', snsNickname: 'Ada', isGroup: true },
    meId: '100',
    systemPrompt: 'Be brief.',
    messages: [
      { body: 'hello', send_type: 2 },
      { body: 'hi there', send_type: 1 },
    ],
  });

  assert.match(text, /Be brief\./);
  assert.match(text, /Chat ID: c1/);
  assert.match(text, /Group Chat: yes/);
  assert.match(text, /Nickname: Ada/);
  assert.match(text, /Customer: hello/);
  assert.match(text, /Me: hi there/);
  assert.match(text, /Return only the suggested reply text/);
});

test('buildPolishPromptText keeps draft and polish instructions', () => {
  const text = buildPolishPromptText({
    draft: 'pls check asap',
    chat: { snsId: 'c2' },
    messages: [{ body: 'status?', send_type: 2 }],
    systemPrompt: 'Polish carefully.',
  });

  assert.match(text, /pls check asap/);
  assert.match(text, /Polish carefully\./);
  assert.match(text, /User draft to polish/);
  assert.match(text, /Return only the polished message text/);
});

test('buildPolishPromptText works with empty draft', () => {
  const text = buildPolishPromptText({
    draft: '',
    chat: {},
    messages: [],
  });
  assert.match(text, /User draft to polish/);
});

test('normalizeOutputMode defaults to text and accepts structured aliases', () => {
  assert.equal(normalizeOutputMode(undefined), 'text');
  assert.equal(normalizeOutputMode('TEXT'), 'text');
  assert.equal(normalizeOutputMode('structured'), 'structured');
  assert.equal(normalizeOutputMode('json'), 'structured');
  assert.equal(normalizeOutputMode('panel'), 'structured');
});

test('buildOutputContract text vs structured', () => {
  const textAsk = buildOutputContract({ mode: 'ask', outputMode: 'text' });
  assert.match(textAsk, /Return only the suggested reply text/);
  assert.doesNotMatch(textAsk, /话术建议/);

  const structured = buildOutputContract({ mode: 'ask', outputMode: 'structured' });
  assert.match(structured, /话术建议/);
  assert.match(structured, /JSON object/);
  assert.match(structured, /解释/);
});

test('buildPromptText structured mode appends JSON contract without user writing schema', () => {
  const text = buildPromptText({
    chat: { snsId: 'c1' },
    messages: [{ body: 'hi', send_type: 2 }],
    systemPrompt: 'Be a friendly agent.',
    outputMode: 'structured',
  });
  assert.match(text, /Be a friendly agent\./);
  assert.match(text, /Output contract/);
  assert.match(text, /话术建议/);
  assert.doesNotMatch(text, /Return only the suggested reply text/);
});

test('buildPolishPromptText text mode forbids JSON', () => {
  const text = buildPolishPromptText({
    draft: 'hello',
    chat: {},
    messages: [],
    outputMode: 'text',
  });
  assert.match(text, /Return only the polished message text/);
  assert.doesNotMatch(text, /话术建议/);
});
