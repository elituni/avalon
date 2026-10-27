import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from '../src/store.js';
import { BotGames, roleMessage } from '../src/game.js';
import { emptyCounts, preset } from '../../shared/roles.js';

function fixture(t, { disk = false } = {}) {
  let file;
  if (disk) {
    const dir = mkdtempSync(join(tmpdir(), 'avalon-bot-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    file = join(dir, 'games.json');
  }
  const store = new GameStore(file);
  const messages = [];
  const blocked = new Set();
  const sendDM = async (id, content) => {
    if (blocked.has(id)) throw new Error('DM blocked');
    messages.push({ id, content });
  };
  const games = new BotGames({ store, sendDM });
  const create = (guildId = 'guild') => games.run(guildId, () => games.create({ guildId, guildName: 'Test server', channelId: 'channel', user: { id: '0', name: 'Host' } }));
  const act = (action, ...args) => games.run('guild', () => games[action](games.requireGame('guild'), ...args));
  async function full() {
    await create();
    for (let i = 1; i < 6; i++) await act('join', { id: String(i), name: `Player ${i}` });
    messages.length = 0;
  }
  return { file, store, games, messages, blocked, sendDM, create, act, full };
}

test('one game per guild, DM checks, duplicates, host transfer and closing the last seat', async t => {
  const f = fixture(t);
  f.blocked.add('0');
  await assert.rejects(f.create(), /could not DM/);
  assert.equal(f.store.get('guild'), null);
  f.blocked.clear();
  await f.create();
  await assert.rejects(f.create(), /already has/);
  await f.create('other');
  f.blocked.add('1');
  await assert.rejects(f.act('join', { id: '1', name: 'Guest' }), /could not DM/);
  assert.equal(f.store.get('guild').players.length, 1);
  f.blocked.clear();
  await f.act('join', { id: '1', name: 'Guest' });
  const count = f.messages.length;
  await f.act('join', { id: '1', name: 'Guest' });
  assert.equal(f.messages.length, count);
  await f.act('leave', '0');
  assert.equal(f.store.get('guild').hostId, '1');
  await f.act('leave', '1');
  assert.equal(f.store.get('guild'), null);
  assert.ok(f.store.get('other'));
});

test('host restrictions, full seats, validation, locked setup, stale game IDs', async t => {
  const f = fixture(t);
  await f.full();
  for (const action of ['start', 'retry', 'end']) await assert.rejects(f.act(action, '1'), /Only the host/);
  await assert.rejects(f.act('setup', '1', preset()), /Only the host/);
  await assert.rejects(f.act('setup', '0', preset(5)), /more joined/);
  await assert.rejects(f.act('setup', '0', { mode: 'custom', counts: { Spy: -1 } }), /supported roles/);
  await assert.rejects(f.act('join', { id: '7', name: 'Extra' }), /full/);
  assert.throws(() => f.games.requireGame('guild', 'old'), /old game/);
  await f.act('leave', '5');
  await assert.rejects(f.act('start', '0'), /Fill every seat/);
  await f.act('join', { id: '5', name: 'Back' });
  await f.act('start', '0');
  for (const [action, ...args] of [['start', '0'], ['setup', '0', preset()], ['leave', '1'], ['join', { id: '7', name: 'Extra' }]]) {
    await assert.rejects(f.act(action, ...args), /Roles have been dealt/);
  }
});

test('persisted role assignments survive delivery failure, restart and retry without reshuffling', async t => {
  const f = fixture(t, { disk: true });
  await f.full();
  f.blocked.add('2');
  const game = await f.act('start', '0');
  assert.equal(f.messages.length, 5);
  assert.equal(game.delivered.length, 5);
  assert.deepEqual(game.players.map(p => p.role).sort(), ['Resistance', 'Resistance', 'Merlin', 'Percival', 'Assassin', 'Morgana'].sort());
  assert.equal(statSync(f.file).mode & 0o777, 0o600);
  const recovered = new BotGames({ store: new GameStore(f.file), sendDM: f.sendDM });
  f.blocked.clear();
  await recovered.run('guild', () => recovered.retry(recovered.requireGame('guild'), '0'));
  assert.deepEqual(recovered.requireGame('guild').players, game.players);
  assert.equal(f.messages.length, 6);
  const retried = f.messages.at(-1);
  assert.equal(retried.id, '2');
  assert.equal(retried.content, roleMessage(game, game.players.find(p => p.id === '2')));
  await recovered.run('guild', () => recovered.retry(recovered.requireGame('guild'), '0'));
  assert.equal(f.messages.length, 6);
  recovered.end(recovered.requireGame('guild'), '0');
  assert.equal(new GameStore(f.file).get('guild'), null);
});

test('assignments are on disk before any role DM and a storage failure prevents revealing roles', async t => {
  const f = fixture(t, { disk: true });
  await f.full();
  f.games.sendDM = async (id, content) => {
    const saved = new GameStore(f.file).get('guild');
    assert.equal(saved.phase, 'started');
    assert.ok(saved.players.every(p => p.role));
    assert.equal(content, roleMessage(saved, saved.players.find(p => p.id === id)));
  };
  await f.act('start', '0');
  await f.act('end', '0');
  f.games.sendDM = f.sendDM;
  await f.full();
  f.store.set = () => { throw new Error('disk full'); };
  await assert.rejects(f.act('start', '0'), /disk full/);
  assert.equal(f.messages.length, 0);
  assert.equal(f.store.get('guild').phase, 'lobby');
});

test('simultaneous guild actions are rejected until DM delivery finishes', async t => {
  const f = fixture(t);
  await f.full();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  f.games.sendDM = () => pending;
  const starting = f.act('start', '0');
  await assert.rejects(f.act('start', '0'), /Another action/);
  await assert.rejects(f.act('end', '0'), /Another action/);
  release();
  await starting;
  assert.equal(f.store.get('guild').delivered.length, 6);
});

test('custom roles use shared privacy rules in DMs and include stable game IDs', async t => {
  const f = fixture(t);
  await f.create();
  const counts = { ...emptyCounts(), Merlin: 1, Percival: 1, Morgana: 1, Mordred: 1, Oberon: 1, Tristan: 1, Isolde: 1 };
  await f.act('setup', '0', { mode: 'custom', counts });
  for (let i = 1; i < 7; i++) await f.act('join', { id: String(i), name: `Person ${i}` });
  const game = await f.act('start', '0');
  const byRole = Object.fromEntries(game.players.map(p => [p.role, p]));
  const seenIds = role => [...roleMessage(game, byRole[role]).matchAll(/\(ID: (\d+)\)/g)].map(m => m[1]).sort();
  assert.deepEqual(seenIds('Merlin'), [byRole.Morgana.id, byRole.Oberon.id].sort());
  assert.deepEqual(seenIds('Percival'), [byRole.Merlin.id, byRole.Morgana.id].sort());
  assert.deepEqual(seenIds('Oberon'), []);
  assert.deepEqual(seenIds('Tristan'), [byRole.Isolde.id]);
  assert.deepEqual(seenIds('Isolde'), [byRole.Tristan.id]);
  for (const p of game.players) assert.ok(roleMessage(game, p).includes(game.id));
});

test('corrupt or unsupported saved state fails closed', t => {
  const f = fixture(t, { disk: true });
  writeFileSync(f.file, 'not json');
  assert.throws(() => new GameStore(f.file));
  writeFileSync(f.file, JSON.stringify({ version: 2, games: {} }));
  assert.throws(() => new GameStore(f.file), /Unsupported/);
  assert.match(readFileSync(f.file, 'utf8'), /"version":2/);
});

test('leader survives DM retry and restart, and role messages end with a divider', async t => {
  const f = fixture(t, { disk: true });
  await f.full();
  f.blocked.add('2');
  const game = await f.act('start', '0');
  assert.ok(game.players.some(p => p.id === game.leaderId));
  const persisted = new GameStore(f.file).get('guild');
  assert.equal(persisted.leaderId, game.leaderId);
  f.blocked.clear();
  assert.equal((await f.act('retry', '0')).leaderId, game.leaderId);
  const message = roleMessage(game, game.players[0]);
  assert.ok(message.endsWith('────────────────────'));
  assert.ok(!message.includes('Keep this message private'));
});
