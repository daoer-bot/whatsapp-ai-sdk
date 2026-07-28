import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpc } from '../src/core/rpc.js';

function pair(timeout = 200) {
  /** @type {{ receive: Function } | null} */
  let a = null;
  /** @type {{ receive: Function } | null} */
  let b = null;

  a = createRpc({
    origin: 'content',
    timeout,
    post: (data) => queueMicrotask(() => b?.receive(data)),
  });
  b = createRpc({
    origin: 'page',
    timeout,
    post: (data) => queueMicrotask(() => a?.receive(data)),
  });

  return { content: a, page: b };
}

test('rpc send resolves handler result across endpoints', async () => {
  const { content, page } = pair();
  page.on('echo', (value) => ({ echoed: value }));

  const result = await content.send('echo', { n: 7 });
  assert.deepEqual(result, { echoed: { n: 7 } });
});

test('rpc send returns null on handler error (compat mode)', async () => {
  const { content, page } = pair();
  page.on('boom', () => {
    throw new Error('nope');
  });

  const result = await content.send('boom', null);
  assert.equal(result, null);
});

test('rpc sendOrThrow rejects on handler error', async () => {
  const { content, page } = pair();
  page.on('boom', () => {
    throw new Error('nope');
  });

  await assert.rejects(() => content.sendOrThrow('boom', null), /nope/);
});

test('rpc send returns null on timeout (compat mode)', async () => {
  const { content } = pair(30);
  // no handler registered on page
  const result = await content.send('missing', 1);
  assert.equal(result, null);
});

test('rpc sendOrThrow rejects on timeout', async () => {
  const { content } = pair(30);
  await assert.rejects(() => content.sendOrThrow('missing', 1), /timeout/);
});

test('rpc emit delivers events to onEvent listeners', async () => {
  const { content, page } = pair();
  const seen = await new Promise((resolve) => {
    content.onEvent('NEW_MESSAGE', resolve);
    page.emit('NEW_MESSAGE', { id: 'm1', body: 'hi' });
  });
  assert.deepEqual(seen, { id: 'm1', body: 'hi' });
});

test('rpc ignores malformed receive payloads', () => {
  const { content } = pair();
  // must not throw
  content.receive(null);
  content.receive({});
  content.receive({ uid: 'bad' });
  content.receive({ uid: '1.not-our-prefix', type: 'receive send', value: [1, null] });
});
