import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignRoles, assignFoolKnowledge, startingInformation, perceivedRole, randomPlayerIds } from '../../shared/game.js';
import { emptyCounts } from '../../shared/roles.js';
import { roleMessage } from '../src/game.js';

const playersFor = roles => roles.map((role, i) => ({ id: String(i), name: `Person ${i}`, role }));

test('Fool draws exactly the total Spy count once, excludes self and duplicates, and stays hidden from Percival', () => {
  const players = playersFor(['Fool', 'Fool', 'Merlin', 'Percival', 'Morgana', 'Mordred', 'Oberon', 'Resistance']);
  assignFoolKnowledge(players);
  for (const fool of players.filter(p => p.role === 'Fool')) {
    assert.equal(fool.foolSeenIds.length, 3);
    assert.equal(new Set(fool.foolSeenIds).size, 3);
    assert.ok(!fool.foolSeenIds.includes(fool.id));
    assert.equal(perceivedRole(fool), 'Merlin');
    const information = startingInformation(fool, players);
    for (let i = 0; i < 10; i++) assert.deepEqual(startingInformation(fool, players), information);
    const actualMerlin = startingInformation(players[2], players);
    assert.equal(information.heading, actualMerlin.heading);
    assert.equal(information.explanation, actualMerlin.explanation);
    assert.ok(information.players.every(p => Object.keys(p).sort().join(',') === 'id,name'));
    const dm = roleMessage({ id: 'game', guildName: 'Server', players }, fool);
    assert.match(dm, /Your role: Merlin/);
    assert.ok(!dm.includes('Fool'));
  }
  assert.deepEqual(startingInformation(players[3], players).players.map(p => p.id), ['2', '4']);
  assert.deepEqual(startingInformation(players[2], players).players.map(p => p.id), ['4', '6']);
  assert.deepEqual(startingInformation(players[4], players).players.map(p => p.id), ['5']);
});

test('Fool handles zero spies, all other players as spies, and random targets of either team', () => {
  for (const roles of [['Fool'], ['Fool', 'Resistance'], ['Fool', 'Spy', 'Mordred', 'Oberon']]) {
    const players = playersFor(roles);
    assignFoolKnowledge(players);
    assert.equal(players[0].foolSeenIds.length, roles.includes('Spy') ? 3 : 0);
  }
  const pool = playersFor(['Fool', 'Resistance', 'Spy']);
  assert.deepEqual(randomPlayerIds(pool, '0', 2).sort(), ['1', '2']);
  assert.throws(() => randomPlayerIds(pool, '0', 3));
  assert.throws(() => startingInformation(pool[0], pool), /Missing saved/);
});

test('assignments carry saved Fool information and redealing clears previous private lists', () => {
  const config = { mode: 'custom', counts: { ...emptyCounts(), Fool: 2, Spy: 1, Resistance: 2 } };
  const players = playersFor(Array(5).fill('Resistance'));
  const assigned = assignRoles(players, config);
  assert.equal(assigned.filter(p => p.role === 'Fool').length, 2);
  for (const player of assigned) {
    if (player.role === 'Fool') assert.equal(player.foolSeenIds.length, 1);
    else assert.ok(!Object.hasOwn(player, 'foolSeenIds'));
  }
  const next = assignRoles(assigned, { mode: 'custom', counts: { ...emptyCounts(), Resistance: 5 } });
  assert.ok(next.every(p => !Object.hasOwn(p, 'foolSeenIds')));
});
