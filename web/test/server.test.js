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
  assert.equal(starts.filter(r => r.status === 403).length, 5);
  assert.equal((await players[0].call('/api/start')).status, 409);
  const assigned = [];
  for (const c of players) {
    const { data } = await c.call();
    assert.equal(data.phase, 'started');
    assigned.push(data.me.role);
    for (const p of data.players) assert.deepEqual(Object.keys(p).sort(), ['connected', 'id', 'name', 'npc']);
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
  const { preset, emptyCounts, validateConfig } = await import('../../shared/roles.js');
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




  const sixteen = preset(15); sixteen.counts.Resistance++; invalid.push(sixteen);
  invalid.push({ mode: 'custom', counts: emptyCounts() });
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
  const { emptyCounts } = await import('../../shared/roles.js');
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
    for (const p of states[i].players) assert.deepEqual(Object.keys(p).sort(), ['connected', 'id', 'name', 'npc']);
    assert.deepEqual((await client(clients[i].cookie).call()).data.me.information, me.information);
  }
  assert.equal((await client().call()).data.me, null);
});

test('standard Percival without Morgana sees Merlin; custom repeated roles work for 15 players', async t => {
  const { preset } = await import('../../shared/roles.js');
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

test('opt-in Percival demo has three persistent NPCs and reserves Percival for laze', async t => {
  const { client, advance } = await setup(t, { demo: true });
  const player = client();
  const initial = (await player.call()).data;
  assert.equal(initial.demo, true);
  assert.equal(initial.capacity, 4);
  assert.equal(initial.connectedCount, 3);
  assert.equal(initial.hostId, null);
  assert.deepEqual(initial.players.map(p => p.name), ['NPC 1', 'NPC 2', 'NPC 3']);
  advance(60000);
  assert.equal((await player.call()).data.connectedCount, 3);

  const joined = (await player.call('/api/join', { name: 'laze' })).data;
  assert.equal(joined.hostId, joined.me.id);
  assert.equal(joined.connectedCount, 4);
  assert.equal((await player.call('/api/config', joined.config)).status, 200);
  const edited = structuredClone(joined.config);
  edited.counts.Assassin = 0; edited.counts.Spy = 1;
  assert.equal((await player.call('/api/config', edited)).status, 200);
  assert.equal((await player.call()).data.config.counts.Spy, 1);
  const noPercival = structuredClone(edited);
  noPercival.counts.Percival = 0; noPercival.counts.Resistance = 1;
  assert.equal((await player.call('/api/config', noPercival)).status, 200);
  const tooMany = structuredClone(edited); tooMany.counts.Resistance = 1;
  assert.equal((await player.call('/api/config', tooMany)).status, 200);
  assert.equal((await player.call()).data.capacity, 5);
  assert.equal((await player.call('/api/config', edited)).status, 200);
  assert.equal((await client().call('/api/config', edited)).status, 403);
  assert.equal((await player.call('/api/host', { playerId: initial.players[0].id })).status, 409);
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


test('host can use any role mix, including a single team and no special roles', async t => {
  const { emptyCounts } = await import('../../shared/roles.js');
  const { client } = await setup(t, { demo: true });
  const host = client();
  await host.call('/api/join', { name: 'laze' });
  for (const counts of [
    { ...emptyCounts(), Merlin: 4 },
    { ...emptyCounts(), Morgana: 4 },
    { ...emptyCounts(), Resistance: 2, Spy: 2 },
    { ...emptyCounts(), Assassin: 3, Percival: 1 },
    { ...emptyCounts(), Resistance: 4 },
  ]) {
    assert.equal((await host.call('/api/config', { mode: 'custom', counts })).status, 200);
  }
  const started = await host.call('/api/start');
  assert.equal(started.status, 200);
  assert.equal(started.data.me.role, 'Resistance');
  assert.equal(started.data.me.information.players.length, 0);
});

test('smaller demo setups release NPC seats and allow starting without Percival', async t => {
  const { emptyCounts } = await import('../../shared/roles.js');
  const { client } = await setup(t, { demo: true });
  const host = client();
  await host.call('/api/join', { name: 'laze' });
  const saved = await host.call('/api/config', { mode: 'custom', counts: { ...emptyCounts(), Spy: 1 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.capacity, 1);
  assert.equal(saved.data.players.length, 1);
  assert.equal((await host.call('/api/start')).data.me.role, 'Spy');
});

test('only host can start/reset; resetting preserves seats and config but removes private information', async t => {
  const { client } = await setup(t);
  const host = client();
  await host.call('/api/join', { name: 'Host' });
  const guests = [];
  for (let i = 0; i < 5; i++) {
    const guest = client(); await guest.call('/api/join', { name: `Guest ${i}` }); guests.push(guest);
  }
  assert.equal((await guests[0].call('/api/start')).status, 403);
  const starts = await Promise.all([host.call('/api/start'), host.call('/api/start')]);
  assert.deepEqual(starts.map(r => r.status).sort(), [200, 409]);
  const before = (await host.call()).data;
  assert.equal((await guests[0].call('/api/reset')).status, 403);
  assert.equal((await client().call('/api/reset')).status, 403);
  const reset = await host.call('/api/reset');
  assert.equal(reset.status, 200);
  assert.equal(reset.data.phase, 'lobby');
  assert.deepEqual(reset.data.config, before.config);
  assert.deepEqual(reset.data.players, before.players);
  assert.equal(reset.data.hostId, before.hostId);
  for (const player of [host, ...guests]) {
    const state = (await player.call()).data;
    assert.equal(state.me.role, null);
    assert.equal(state.me.team, null);
    assert.equal(state.me.information, null);
  }
  assert.equal((await host.call('/api/reset')).status, 409);
  assert.equal((await host.call('/api/config', before.config)).status, 200);
  const restarted = await host.call('/api/start');
  assert.equal(restarted.status, 200);
  assert.equal(restarted.data.gameNumber, before.gameNumber + 1);
});

test('a disconnected host is replaced during a game so remaining players can reset', async t => {
  const { client, advance } = await setup(t, { demo: true });
  const host = client();
  await host.call('/api/join', { name: 'laze' });
  const config = (await host.call()).data.config;
  config.counts.Resistance = 1;
  await host.call('/api/config', config);
  const guest = client(); await guest.call('/api/join', { name: 'Guest' });
  await host.call('/api/start');
  advance(14000);
  await guest.call('/api/heartbeat');
  advance(1001);
  const state = (await guest.call()).data;
  assert.equal(state.hostId, state.me.id);
  assert.equal((await host.call('/api/reset')).status, 403);
  assert.equal((await guest.call('/api/reset')).status, 200);
  assert.equal((await guest.call()).data.players.length, 5);
});


test('demo host can kick NPCs, transfer to humans, and all humans can leave the lobby', async t => {
  const { client } = await setup(t, { demo: true });
  const host = client();
  const joined = (await host.call('/api/join', { name: 'laze' })).data;
  const npc = joined.players.find(p => p.npc);
  assert.equal((await host.call('/api/kick', { playerId: npc.id })).status, 200);
  const guest = client();
  const guestState = (await guest.call('/api/join', { name: 'Guest' })).data;
  assert.equal((await host.call('/api/host', { playerId: guestState.me.id })).status, 200);
  assert.equal((await host.call('/api/leave')).data.me, null);
  assert.equal((await guest.call('/api/leave')).data.me, null);
  const final = (await client().call()).data;
  assert.equal(final.hostId, null);
  assert.equal(final.connectedCount, 2);
  assert.ok(final.players.every(p => p.npc));
});

test('lovers see only the opposite lover role, including repeated and unpaired setups', async t => {
  const { emptyCounts } = await import('../../shared/roles.js');
  const { startingInformation } = await import('../server.js');
  const { client } = await setup(t);
  const host = client();
  await host.call('/api/join', { name: 'Host' });
  const counts = { ...emptyCounts(), Tristan: 2, Isolde: 2, Merlin: 1, Spy: 1 };
  assert.equal((await host.call('/api/config', { mode: 'custom', counts })).status, 200);
  const clients = [host];
  for (let i = 1; i < 6; i++) {
    const c = client(); await c.call('/api/join', { name: `Player ${i}` }); clients.push(c);
  }
  await host.call('/api/start');
  const states = await Promise.all(clients.map(async c => (await c.call()).data));
  const all = states.map(s => s.me);
  for (const me of all) {
    const partner = me.role === 'Tristan' ? 'Isolde' : me.role === 'Isolde' ? 'Tristan' : null;
    const expected = partner ? all.filter(p => p.role === partner) : me.role === 'Merlin' ? all.filter(p => p.role === 'Spy') : [];
    assert.deepEqual(me.information.players, expected.map(p => ({ id: p.id, name: p.name })));
    if (partner) assert.equal(me.team, 'Resistance');
  }
  const observer = (await client().call()).data;
  assert.equal(observer.me, null);
  for (const p of observer.players) assert.deepEqual(Object.keys(p).sort(), ['connected', 'id', 'name', 'npc']);
  for (const role of ['Tristan', 'Isolde']) {
    assert.deepEqual(startingInformation({ id: 'alone', role }, [{ id: 'alone', role }]).players, []);
  }
});

async function streamState(t, url, cookie = '') {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(url + '/api/events', { headers: { cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    close: () => controller.abort(),
    async next() {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.startsWith('data: ')) return JSON.parse(frame.slice(6));
          continue;
        }
        const { value, done } = await reader.read();
        assert.equal(done, false, 'stream should remain open');
        buffer += decoder.decode(value, { stream: true });
      }
    },
  };
}

test('SSE pushes joins, private roles, resets and fresh reconnect snapshots', { timeout: 5000 }, async t => {
  const { client, url } = await setup(t);
  const observer = await streamState(t, url);
  assert.equal((await observer.next()).players.length, 0);
  const host = client();
  await host.call('/api/join', { name: 'Host' });
  assert.equal((await observer.next()).players.length, 1);
  const hostStream = await streamState(t, url, host.cookie);
  assert.equal((await hostStream.next()).me.name, 'Host');
  for (let i = 1; i < 6; i++) {
    await client().call('/api/join', { name: `Guest ${i}` });
    assert.equal((await observer.next()).players.length, i + 1);
    assert.equal((await hostStream.next()).players.length, i + 1);
  }
  const started = (await host.call('/api/start')).data;
  const privateState = await hostStream.next();
  assert.deepEqual(privateState.me, started.me);
  const publicState = await observer.next();
  assert.equal(publicState.phase, 'started');
  assert.equal(publicState.me, null);
  for (const player of publicState.players) assert.equal('role' in player, false);
  hostStream.close();
  const reconnect = await streamState(t, url, host.cookie);
  assert.deepEqual((await reconnect.next()).me, started.me);
  await host.call('/api/reset');
  assert.equal((await reconnect.next()).me.role, null);
  assert.equal((await observer.next()).phase, 'lobby');
});

test('SSE detects heartbeat expiry and broadcasts kick and host changes', { timeout: 5000 }, async t => {
  const { client, url, advance } = await setup(t);
  const host = client();
  const guest = client();
  await host.call('/api/join', { name: 'Host' });
  const joined = (await guest.call('/api/join', { name: 'Guest' })).data;
  const stream = await streamState(t, url, guest.cookie);
  await stream.next();
  await host.call('/api/kick', { playerId: joined.me.id });
  const kicked = await stream.next();
  assert.equal(kicked.kicked, true);
  assert.equal(kicked.me, null);
  await guest.call('/api/join', { name: 'Guest' });
  await stream.next();
  advance(10000);
  await guest.call('/api/heartbeat');
  advance(6000);
  const expired = await stream.next();
  assert.equal(expired.connectedCount, 1);
  assert.equal(expired.hostId, expired.me.id);
});

test('SSE rejects cross-site connections and incorrect methods', async t => {
  const { url } = await setup(t);
  for (const headers of [{ origin: 'https://other.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await fetch(url + '/api/events', { headers })).status, 403);
  }
  assert.equal((await fetch(url + '/api/events', { method: 'POST' })).status, 405);
});

test('shared public rules retain their URL while private shared code stays inaccessible', async t => {
  const { url } = await setup(t);
  const rules = await fetch(url + '/roles.js');
  assert.equal(rules.status, 200);
  assert.match(await rules.text(), /export const ROLE_INFO/);
  for (const path of ['/shared/game.js', '/shared/roles.js', '/discord-bot/src/game.js']) {
    assert.equal((await fetch(url + path)).status, 404);
  }
});

test('first leader is public, stable on reconnect, and cleared on reset', async t => {
  const { client, six } = await setup(t);
  const players = await six();
  assert.equal((await players[0].call()).data.leaderId, null);
  const started = (await players[0].call('/api/start')).data;
  assert.ok(started.players.some(p => p.id === started.leaderId));
  assert.equal((await client().call()).data.leaderId, started.leaderId);
  assert.equal((await players[0].call()).data.leaderId, started.leaderId);
  assert.equal((await players[0].call('/api/reset')).data.leaderId, null);
});
