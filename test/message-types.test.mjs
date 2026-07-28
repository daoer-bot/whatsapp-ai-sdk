import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSendTime, getMsgItem } from '../src/core/message-types.js';

test('formatSendTime handles unix seconds and milliseconds', () => {
  // 2026-07-18 00:00:00 UTC
  const sec = 1784332800;
  const ms = sec * 1000;
  assert.equal(formatSendTime(sec), '2026-07-18 00:00:00');
  assert.equal(formatSendTime(ms), '2026-07-18 00:00:00');
  assert.equal(formatSendTime(String(sec)), '2026-07-18 00:00:00');
});

test('formatSendTime keeps already-normalized strings and rejects junk', () => {
  assert.equal(formatSendTime('2026-07-18 10:01:02'), '2026-07-18 10:01:02');
  assert.equal(formatSendTime(''), '');
  assert.equal(formatSendTime(null), '');
  assert.equal(formatSendTime('not-a-date'), '');
});

test('formatSendTime accepts Date instances', () => {
  const d = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.equal(formatSendTime(d), '2026-01-02 03:04:05');
});

test('getMsgItem parses text chat messages', async () => {
  const item = await getMsgItem({
    type: 'chat',
    body: 'hello world',
    t: 1784332800,
    id: { id: 'msg-1', fromMe: false, _serialized: 'x' },
    from: { user: '8613800000000' },
  });

  assert.equal(item.type, 'text');
  assert.equal(item.body, 'hello world');
  assert.equal(item.send_type, 2);
  assert.equal(item.message_id, 'msg-1');
  assert.equal(item.send_id, '8613800000000');
  assert.equal(item.send_time, '2026-07-18 00:00:00');
});

test('getMsgItem marks fromMe as outbound', async () => {
  const item = await getMsgItem({
    type: 'chat',
    body: 'mine',
    id: { id: 'msg-2', fromMe: true },
  });
  assert.equal(item.send_type, 1);
});

test('getMsgItem parses audio without downloading media', async () => {
  const item = await getMsgItem({
    type: 'ptt',
    duration: 65,
    id: { id: 'a1', fromMe: false },
  });
  assert.equal(item.type, 'audio');
  assert.equal(item.body.duration, '1:05');
});

test('getMsgItem parses image metadata without media download by default', async () => {
  const item = await getMsgItem({
    type: 'image',
    caption: 'look',
    id: { id: 'img1', fromMe: false },
  });
  assert.equal(item.type, 'image');
  assert.equal(item.body.caption, 'look');
  assert.equal(item.body.link, '');
  assert.equal(item.body.hasMedia, true);
});

test('getMsgItem parses document and contact', async () => {
  const doc = await getMsgItem({
    type: 'document',
    filename: 'a.pdf',
    size: 1024,
    caption: '',
    id: { id: 'd1', fromMe: true },
  });
  assert.equal(doc.type, 'document');
  assert.equal(doc.body.fileName, 'a.pdf');
  assert.match(doc.body.fileSize, /kB|B/);

  const contact = await getMsgItem({
    type: 'vcard',
    body: 'BEGIN:VCARD',
    id: { id: 'c1', fromMe: false },
  });
  assert.equal(contact.type, 'contact');
});

test('getMsgItem returns null for empty input and labels unknown types', async () => {
  assert.equal(await getMsgItem(null), null);
  const unknown = await getMsgItem({
    type: 'totally_new_thing',
    id: { id: 'u1', fromMe: false, _serialized: 'ser' },
  });
  assert.equal(unknown.type, 'unsupported');
  assert.match(String(unknown.body?.caption || ''), /unsupported/);
});
