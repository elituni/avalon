import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCounterServer } from '../server.js';

async function start(t) {
  const server = createCounterServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('visitors share the total and concurrent clicks are not lost', async t => {
  const url = await start(t);
  const read = async () => (await fetch(`${url}/api/count`)).json();
  assert.deepEqual(await read(), { count: 0 });
  const replies = await Promise.all(Array.from({ length: 50 }, async () => {
    const response = await fetch(`${url}/api/count`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return (await response.json()).count;
  }));
  assert.equal(new Set(replies).size, 50);
  assert.deepEqual(await read(), { count: 50 });
  assert.deepEqual(await read(), { count: 50 });
  const restarted = await start(t);
  assert.deepEqual(await (await fetch(`${restarted}/api/count`)).json(), { count: 0 });
});

test('serves the UI, rejects unsupported methods, and does not expose source files', async t => {
  const url = await start(t);
  for (const path of ['/', '/app.js', '/style.css']) {
    assert.equal((await fetch(url + path)).status, 200);
  }
  const invalid = await fetch(`${url}/api/count`, { method: 'DELETE' });
  assert.equal(invalid.status, 405);
  assert.equal(invalid.headers.get('allow'), 'GET, POST');
  assert.equal((await fetch(`${url}/server.js`)).status, 404);
  assert.equal((await fetch(`${url}/`, { method: 'POST' })).status, 405);
  assert.deepEqual(await (await fetch(`${url}/api/count`)).json(), { count: 0 });
});
