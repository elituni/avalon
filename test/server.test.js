import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGameServer } from '../server.js';

async function setup(t, options = {}) {
  let time = 1000;
  const server = createGameServer({ now: () => time, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  function client(initialCookie = '') {
    let cookie = initialCookie;
    return {
      get cookie() { return cookie; },
      async call(path = '/api/state', body, extra = {}) {
        const response = await fetch(url + path, {
          method: ['/api/state', '/api/health', '/'].includes(path) ? 'GET' : 'POST',
          headers: { cookie, 'Content-Type': 'application/json', ...extra },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return { status: response.status, data: await response.json(), headers: response.headers };
      },
    };
  }
  async function six() {
    return Promise.all(Array.from({ length: 6 }, async (_, i) => {
      const c = client();
      assert.equal((await c.call('/api/join', { name: `Player ${i}` })).status, 200);
      return c;
    }));
  }
  return { client, six, url, advance: ms => { time += ms; } };
}

test('exactly six joined players, one start, correct private roles and locked roster', async t => {
  const { client, six } = await setup(t);
  const outsider = client();
  assert.equal((await outsider.call('/api/start')).status, 403);
  const players = await six();
  assert.equal((await outsider.call('/api/join', { name: 'Seventh' })).status, 409);
  const starts = await Promise.all(players.map(c => c.call('/api/start')));
  assert.equal(starts.filter(r => r.status === 200).length, 1);
  assert.equal(starts.filter(r => r.status === 409).length, 5);
  const assigned = [];
  for (const c of players) {
    const { data } = await c.call();
    assert.equal(data.phase, 'started');
    assigned.push(data.me.role);
    for (const p of data.players) assert.deepEqual(Object.keys(p).sort(), ['connected', 'id', 'name']);
    assert.equal(JSON.stringify(data).includes(c.cookie.split('=')[1]), false);
    assert.equal((await c.call('/api/leave')).status, 409);
    assert.equal((await client(c.cookie).call()).data.me.role, data.me.role);
  }
  assert.deepEqual(assigned.sort(), ['Resistance', 'Resistance', 'Merlin', 'Morgana', 'Assassin', 'Percival'].sort());
  assert.equal((await outsider.call()).data.me, null);
  assert.equal((await outsider.call('/api/join', { name: 'Late' })).status, 409);
});

test('refreshes and tabs share a seat; five players cannot start', async t => {
  const { client } = await setup(t);
  const first = client();
  const initial = await first.call('/api/join', { name: 'Alice' });
  assert.match(initial.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const tab = client(first.cookie);
  const rejoin = await tab.call('/api/join', { name: 'Alice again' });
  assert.equal(rejoin.data.me.id, initial.data.me.id);
  assert.equal(rejoin.data.connectedCount, 1);
  assert.equal((await first.call('/api/start')).status, 409);
  for (let i = 0; i < 4; i++) await client().call('/api/join', { name: `Other ${i}` });
  assert.equal((await first.call('/api/start')).status, 409);
  assert.equal((await tab.call('/api/leave')).data.me, null);
  assert.equal((await first.call()).data.connectedCount, 4);
});

test('heartbeat grace, reconnect, and reclaiming a disconnected lobby seat', async t => {
  const { client, six, advance } = await setup(t);
  const players = await six();
  advance(14000);
  for (const c of players.slice(1)) await c.call('/api/heartbeat');
  assert.equal((await players[1].call()).data.connectedCount, 6);
  advance(1001);
  assert.equal((await players[1].call()).data.connectedCount, 5);
  assert.equal((await players[1].call('/api/start')).status, 409);
  assert.equal((await players[0].call('/api/heartbeat')).data.connectedCount, 6);
  advance(15001);
  for (const c of players.slice(1)) await c.call('/api/heartbeat');
  const newcomer = client();
  assert.equal((await newcomer.call('/api/join', { name: 'Replacement' })).data.connectedCount, 6);
  assert.equal((await players[0].call()).data.me, null);
  assert.equal((await players[0].call('/api/join', { name: 'Returning' })).status, 409);
});

test('started game keeps roles through disconnects; a fresh server clears the game', async t => {
  const { six, advance, client } = await setup(t);
  const players = await six();
  await players[0].call('/api/start');
  const before = (await players[0].call()).data.me;
  advance(60000);
  assert.equal((await players[0].call()).data.connectedCount, 0);
  assert.deepEqual((await players[0].call('/api/heartbeat')).data.me, before);
  assert.equal((await client().call('/api/join', { name: 'New' })).status, 409);
  const fresh = await setup(t);
  const state = (await fresh.client(players[0].cookie).call()).data;
  assert.equal(state.phase, 'lobby');
  assert.equal(state.me, null);
  assert.deepEqual(state.players, []);
});

test('validates names, methods and origin, and serves assets without exposing source', async t => {
  const { client, url } = await setup(t);
  for (const name of ['', ' ', 'a'.repeat(25), null]) {
    assert.equal((await client().call('/api/join', { name })).status, 400);
  }
  await client().call('/api/join', { name: 'Alice' });
  assert.equal((await client().call('/api/join', { name: ' alice ' })).status, 409);
  assert.equal((await client().call('/api/join', { name: 'Mallory' }, { origin: 'https://other.example' })).status, 403);
  for (const path of ['/', '/app.js', '/style.css', '/api/health']) assert.equal((await fetch(url + path)).status, 200);
  assert.equal((await fetch(url + '/server.js')).status, 404);
  assert.equal((await fetch(url + '/api/start')).status, 405);
  const state = await client().call();
  assert.equal(state.headers.get('cache-control'), 'no-store');
});

test('first joined player hosts; only host can transfer or kick, including stale requests', async t => {
  const { client } = await setup(t);
  const observer = client();
  await observer.call();
  const host = client();
  const first = (await host.call('/api/join', { name: 'Host' })).data;
  const guest = client();
  const second = (await guest.call('/api/join', { name: 'Guest' })).data;
  assert.equal(first.hostId, first.me.id);
  assert.equal(second.hostId, first.me.id);
  assert.equal((await client(host.cookie).call()).data.hostId, first.me.id);
  for (const action of ['/api/host', '/api/kick']) {
    assert.equal((await observer.call(action, { playerId: first.me.id })).status, 403);
    assert.equal((await guest.call(action, { playerId: first.me.id })).status, 403);
    assert.equal((await host.call(action, { playerId: first.me.id })).status, 400);
    assert.equal((await host.call(action, { playerId: 'missing' })).status, 404);
  }
  const transferred = await host.call('/api/host', { playerId: second.me.id });
  assert.equal(transferred.data.hostId, second.me.id);
  assert.equal((await host.call('/api/kick', { playerId: second.me.id })).status, 403);
  assert.equal((await guest.call('/api/kick', { playerId: first.me.id })).status, 200);
  const removed = (await host.call('/api/heartbeat')).data;
  assert.equal(removed.me, null);
  assert.equal(removed.kicked, true);
  assert.equal(removed.connectedCount, 1);
  assert.equal((await client(host.cookie).call()).data.me, null);
  const rejoined = (await host.call('/api/join', { name: 'Returning' })).data;
  assert.equal(rejoined.kicked, false);
  assert.equal(rejoined.hostId, second.me.id);
  assert.notEqual(rejoined.me.id, first.me.id);
});

test('host passes to earliest connected player on leave or timeout, never stolen on reconnect', async t => {
  const { client, advance } = await setup(t);
  const a = client(), b = client(), c = client();
  const aid = (await a.call('/api/join', { name: 'A' })).data.me.id;
  const bid = (await b.call('/api/join', { name: 'B' })).data.me.id;
  const cid = (await c.call('/api/join', { name: 'C' })).data.me.id;
  advance(14000);
  await b.call('/api/heartbeat');
  await c.call('/api/heartbeat');
  assert.equal((await b.call()).data.hostId, aid);
  advance(1001);
  assert.equal((await b.call()).data.hostId, bid);
  assert.equal((await b.call('/api/host', { playerId: aid })).status, 409);
  assert.equal((await a.call('/api/heartbeat')).data.hostId, bid);
  assert.equal((await b.call('/api/leave')).data.hostId, aid);
  assert.equal((await a.call('/api/leave')).data.hostId, cid);
  assert.equal((await c.call('/api/leave')).data.hostId, null);
  assert.equal((await a.call('/api/join', { name: 'Fresh' })).data.hostId, (await a.call()).data.me.id);
});

test('kick updates readiness and host controls cannot change a started roster', async t => {
  const { six, client } = await setup(t);
  const players = await six();
  const snapshots = await Promise.all(players.map(async c => ({ c, state: (await c.call()).data })));
  const host = snapshots.find(p => p.state.me.id === p.state.hostId);
  const other = snapshots.find(p => p !== host);
  const kicked = await host.c.call('/api/kick', { playerId: other.state.me.id });
  assert.equal(kicked.data.connectedCount, 5);
  assert.equal((await host.c.call('/api/start')).status, 409);
  const newcomer = client();
  const target = (await newcomer.call('/api/join', { name: 'Replacement' })).data.me.id;
  assert.equal((await host.c.call('/api/start')).status, 200);
  for (const action of ['/api/kick', '/api/host']) assert.equal((await host.c.call(action, { playerId: target })).status, 409);
  assert.equal((await host.c.call()).data.players.length, 6);
});

test('only the host can configure roles; invalid setups and shrinking an occupied lobby are rejected', async t => {
  const { preset, emptyCounts, validateConfig } = await import('../public/roles.js');
  const { client } = await setup(t);
  const host = client();
  await host.call('/api/join', { name: 'Host' });
  const guest = client();
  await guest.call('/api/join', { name: 'Guest' });
  assert.equal((await guest.call('/api/config', preset(5))).status, 403);
  assert.equal((await client().call('/api/config', preset(5))).status, 403);
  for (const size of [5, 6, 7, 8, 9, 10, 15]) {
    assert.equal(validateConfig(preset(size)), null);
    assert.equal((await host.call('/api/config', preset(size))).data.capacity, size);
  }
  const invalid = [null, { mode: 'other', counts: emptyCounts() }, { ...preset(), counts: {} }];
  for (const value of [-1, 1.5, '1', 16, null]) {
    const config = preset(); config.counts.Merlin = value; invalid.push(config);
  }
  const extra = preset(); extra.counts.FakeRole = 0; invalid.push(extra);
  const wrongBalance = preset(); wrongBalance.counts.Resistance--; wrongBalance.counts.Spy++; invalid.push(wrongBalance);
  const duplicate = preset(10); duplicate.counts.Percival++; duplicate.counts.Resistance--; invalid.push(duplicate);
  const missing = preset(); missing.counts.Merlin = 0; missing.counts.Resistance++; invalid.push(missing);
  const weakFive = preset(5); weakFive.counts.Morgana = 0; weakFive.counts.Spy++; invalid.push(weakFive);
  const sixteen = preset(15); sixteen.counts.Resistance++; invalid.push(sixteen);
  const oneTeam = { mode: 'custom', counts: { ...emptyCounts(), Resistance: 5 } }; invalid.push(oneTeam);
  for (const config of invalid) {
    assert.equal((await host.call('/api/config', config)).status, 400);
    assert.equal((await host.call()).data.capacity, 15);
  }
  await host.call('/api/config', preset());
  for (let i = 0; i < 4; i++) await client().call('/api/join', { name: `Additional ${i}` });
  assert.equal((await host.call('/api/config', preset(5))).status, 409);
  await host.call('/api/start');
  assert.equal((await host.call('/api/config', preset(10))).status, 409);
});

test('all eight roles receive exactly their allowed starting knowledge, and no observer gets it', async t => {
  const { emptyCounts } = await import('../public/roles.js');
  const { client } = await setup(t);
  const host = client();
  await host.call('/api/join', { name: 'Host' });
  const counts = { ...emptyCounts(), Resistance: 3, Merlin: 1, Percival: 1, Assassin: 1, Morgana: 1, Mordred: 1, Oberon: 1, Spy: 1 };
  assert.equal((await host.call('/api/config', { mode: 'custom', counts })).status, 200);
  const clients = [host];
  for (let i = 1; i < 10; i++) {
    const c = client(); await c.call('/api/join', { name: `Player ${i}` }); clients.push(c);
  }
  assert.equal((await host.call('/api/start')).status, 200);
  const states = await Promise.all(clients.map(async c => (await c.call()).data));
  const all = states.map(s => s.me);
  for (let i = 0; i < clients.length; i++) {
    const me = all[i];
    const evil = ['Spy', 'Assassin', 'Morgana', 'Mordred', 'Oberon'];
    assert.equal(me.team, evil.includes(me.role) ? 'Spy' : 'Resistance');
    let expected = [];
    if (me.role === 'Merlin') expected = all.filter(p => evil.includes(p.role) && p.role !== 'Mordred');
    else if (me.role === 'Percival') expected = all.filter(p => ['Merlin', 'Morgana'].includes(p.role));
    else if (evil.includes(me.role) && me.role !== 'Oberon') expected = all.filter(p => evil.includes(p.role) && p.role !== 'Oberon' && p.id !== me.id);
    assert.deepEqual(me.information.players, expected.map(p => ({ id: p.id, name: p.name })));
    for (const p of states[i].players) assert.deepEqual(Object.keys(p).sort(), ['connected', 'id', 'name']);
    assert.deepEqual((await client(clients[i].cookie).call()).data.me.information, me.information);
  }
  assert.equal((await client().call()).data.me, null);
});

test('standard Percival without Morgana sees Merlin; custom repeated roles work for 15 players', async t => {
  const { preset } = await import('../public/roles.js');
  const { client } = await setup(t);
  const host = client();
  await host.call('/api/join', { name: 'Host' });
  const config = preset(6); config.counts.Morgana = 0; config.counts.Spy = 1;
  assert.equal((await host.call('/api/config', config)).status, 200);
  const clients = [host];
  for (let i = 1; i < 6; i++) { const c = client(); await c.call('/api/join', { name: `P${i}` }); clients.push(c); }
  await host.call('/api/start');
  const states = await Promise.all(clients.map(async c => (await c.call()).data));
  const merlin = states.find(s => s.me.role === 'Merlin').me;
  assert.equal(states.find(s => s.me.role === 'Percival').me.information.heading, 'Merlin');
  assert.deepEqual(states.find(s => s.me.role === 'Percival').me.information.players, [{ id: merlin.id, name: merlin.name }]);

  const fresh = await setup(t);
  const players = [fresh.client()];
  await players[0].call('/api/join', { name: 'Host' });
  await players[0].call('/api/config', preset(15));
  for (let i = 1; i < 15; i++) {
    const c = fresh.client();
    assert.equal((await c.call('/api/join', { name: `P${i}` })).status, 200);
    players.push(c);
    if (i === 13) assert.equal((await players[0].call('/api/start')).status, 409);
  }
  assert.equal((await fresh.client().call('/api/join', { name: 'Overflow' })).status, 409);
  assert.equal((await players[0].call('/api/start')).status, 200);
  const roles = {};
  for (const c of players) {
    const { me } = (await c.call()).data;
    roles[me.role] = (roles[me.role] || 0) + 1;
    if (me.role === 'Percival') assert.equal(me.information.players.length, 5);
    if (me.role === 'Merlin') assert.equal(me.information.players.length, 5);
    if (['Assassin', 'Morgana'].includes(me.role)) assert.equal(me.information.players.length, 4);
  }
  assert.deepEqual(roles, { Assassin: 2, Morgana: 3, Resistance: 5, Merlin: 2, Percival: 3 });
});

test('opt-in Percival demo has four persistent NPCs and reserves Percival for laze', async t => {
  const { client, advance } = await setup(t, { demo: true });
  const player = client();
  const initial = (await player.call()).data;
  assert.equal(initial.demo, true);
  assert.equal(initial.capacity, 5);
  assert.equal(initial.connectedCount, 4);
  assert.equal(initial.hostId, null);
  assert.deepEqual(initial.players.map(p => p.name), ['NPC 1', 'NPC 2', 'NPC 3', 'NPC 4']);
  advance(60000);
  assert.equal((await player.call()).data.connectedCount, 4);
  assert.equal((await player.call('/api/join', { name: 'Someone else' })).status, 400);
  const joined = (await player.call('/api/join', { name: 'laze' })).data;
  assert.equal(joined.hostId, joined.me.id);
  assert.equal(joined.connectedCount, 5);
  assert.equal((await player.call('/api/config', joined.config)).status, 409);
  assert.equal((await player.call('/api/kick', { playerId: initial.players[0].id })).status, 409);
  const started = (await player.call('/api/start')).data;
  assert.equal(started.me.role, 'Percival');
  assert.equal(started.me.team, 'Resistance');
  assert.equal(started.me.information.heading, 'Possible Merlins');
  assert.ok(started.me.information.players.every(p => !('role' in p)));
  assert.equal(started.me.information.players.length, 2);
  assert.ok(started.me.information.players.every(p => p.name.startsWith('NPC ')));
  assert.equal((await client(player.cookie).call()).data.me.role, 'Percival');
  assert.equal((await client().call()).data.me, null);
});

test('normal games do not seed NPCs or enable demo restrictions', async t => {
  const { client } = await setup(t);
  const player = client();
  const state = (await player.call()).data;
  assert.equal(state.demo, false);
  assert.equal(state.capacity, 6);
  assert.deepEqual(state.players, []);
  assert.equal((await player.call('/api/join', { name: 'Anyone' })).status, 200);
});
