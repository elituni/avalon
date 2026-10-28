import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, MessageFlags } from 'discord.js';
import { BotGames } from '../src/game.js';
import { GameStore } from '../src/store.js';
import { interactionHandler, publishGame } from '../src/interaction.js';
import { ROLE_INFO } from '../../shared/roles.js';
import { command } from '../src/commands.js';
import { lobbyMessage, setupMessage, setupPages } from '../src/presentation.js';

function interaction(action, { userId = 'host', gameId, messageId = 'message', channelId = 'channel', options = {} } = {}) {
  const button = Boolean(gameId);
  return {
    commandName: 'avalon', customId: `avalon:${gameId}:${action}`, message: { id: messageId },
    guildId: 'guild', guild: { name: 'Server' }, channelId, channel: { type: ChannelType.GuildText },
    user: { id: userId, username: userId }, member: { displayName: userId },
    appPermissions: { has: () => true },
    options: { getSubcommand: () => action, getInteger: key => options[key] ?? null },
    isChatInputCommand: () => !button, isButton: () => button,
    async deferReply(payload) { this.deferred = true; this.deferPayload = payload; },
    async editReply(payload) { this.response = payload; },
    async reply(payload) { this.response = payload; },
  };
}

function fixture() {
  const games = new BotGames({ store: new GameStore(), sendDM: async () => {} });
  const published = [];
  const handler = interactionHandler({ games, publish: async game => {
    game.messageId = 'message';
    if (game.phase !== 'ended') games.store.set(game.guildId, game);
    published.push(lobbyMessage(game));
  } });
  return { games, published, handler };
}

test('registered commands omit setup and stale setup commands cannot change a lobby', async () => {
  assert.deepEqual(command.toJSON().options.map(o => o.name), ['create', 'start', 'retry', 'end', 'roles', 'help']);
  const { games, handler } = fixture();
  await handler(interaction('create'));
  const before = games.requireGame('guild').config;
  const stale = interaction('setup', { options: { resistance: 1 } });
  await handler(stale);
  assert.match(stale.response.content, /Edit setup button/);
  assert.deepEqual(games.requireGame('guild').config, before);
});

async function configureSinglePlayer(games, handler) {
  const game = games.requireGame('guild');
  await handler(interaction('setup', { gameId: game.id }));
  for (const role of Object.keys(game.config.counts)) {
    const request = interaction(`count:${role}`, { gameId: game.id });
    request.isButton = () => false;
    request.isStringSelectMenu = () => true;
    request.values = [role === 'Resistance' ? '1' : '0'];
    request.deferUpdate = async () => { request.deferred = true; };
    await handler(request);
  }
  const save = interaction('savesetup', { gameId: game.id });
  save.deferUpdate = async () => { save.deferred = true; };
  await handler(save);
  assert.match(save.response.components[0].data.content, /saved/);
}

test('commands defer privately, enforce permissions, reject stale buttons, and end cleanly', async () => {
  const { games, handler } = fixture();
  const create = interaction('create');
  await handler(create);
  assert.equal(create.deferPayload.flags, MessageFlags.Ephemeral);
  assert.match(create.response.content, /Lobby created/);
  const game = games.requireGame('guild');
  const join = interaction('join', { userId: 'guest', gameId: game.id });
  await handler(join);
  assert.match(join.response.content, /in the lobby/);
  const denied = interaction('end', { userId: 'guest' });
  await handler(denied);
  assert.match(denied.response.content, /Only the host/);
  const stale = interaction('join', { userId: 'guest', gameId: 'old' });
  await handler(stale);
  assert.match(stale.response.content, /old game/);
  const oldMessage = interaction('leave', { userId: 'guest', gameId: game.id, messageId: 'old-message' });
  await handler(oldMessage);
  assert.match(oldMessage.response.content, /latest lobby/);
  const wrongChannel = interaction('end', { channelId: 'elsewhere' });
  await handler(wrongChannel);
  assert.match(wrongChannel.response.content, /lobby channel/);
  await handler(interaction('end'));
  assert.equal(games.store.get('guild'), null);
});

test('bot checks channel permissions before creating a game or sending DMs', async () => {
  const { games, handler } = fixture();
  const request = interaction('create');
  request.appPermissions.has = () => false;
  await handler(request);
  assert.match(request.response.content, /View Channel/);
  assert.equal(games.store.get('guild'), null);
});

test('public lobby never includes assignments or starting information', async () => {
  const { games, handler, published } = fixture();
  await handler(interaction('create'));
  await configureSinglePlayer(games, handler);
  const start = interaction('start');
  await handler(start);
  assert.match(start.response.content, /All role DMs delivered/);
  const game = games.requireGame('guild');
  const first = JSON.stringify(lobbyMessage(game));
  const changedPrivateState = structuredClone(game);
  changedPrivateState.players[0].role = 'Merlin';
  assert.equal(JSON.stringify(lobbyMessage(changedPrivateState)), first);
  assert.ok(published.every(p => p.allowedMentions.parse.length === 0));
  assert.ok(lobbyMessage(game).components[0].components.every(b => b.data.disabled));
});

test('deleted lobby messages are recreated, while permission failures are not mistaken for deletion', async () => {
  const { games, handler } = fixture();
  await handler(interaction('create'));
  const game = games.requireGame('guild');
  let sent = 0;
  const channel = { type: ChannelType.GuildText, messages: { edit: async () => { throw { code: 10008 }; } }, send: async () => { sent++; return { id: 'replacement' }; } };
  const client = { channels: { fetch: async () => channel } };
  await publishGame(client, games.store, game);
  assert.equal(games.requireGame('guild').messageId, 'replacement');
  assert.equal(sent, 1);
  channel.messages.edit = async () => { throw { code: 50013 }; };
  await assert.rejects(publishGame(client, games.store, game));
  assert.equal(sent, 1);
});

test('15-player rosters with markdown-heavy names fit Discord embed limits', () => {
  const game = { id: 'test', phase: 'lobby', hostId: '0', delivered: [],
    config: { counts: { Resistance: 15 } },
    players: Array.from({ length: 15 }, (_, i) => ({ id: String(i), name: '\\'.repeat(32) })),
  };
  const data = lobbyMessage(game).embeds[0].toJSON();
  assert.ok(data.fields.every(field => field.value.length <= 1024));
  assert.equal(data.fields.length, 4);
});

test('setup button opens a private draft; dropdowns save together and remain host-only', async () => {
  const { games, handler } = fixture();
  await handler(interaction('create'));
  const game = games.requireGame('guild');
  const denied = interaction('setup', { userId: 'guest', gameId: game.id });
  await handler(denied);
  assert.match(denied.response.content, /Only the host/);
  const open = interaction('setup', { gameId: game.id });
  await handler(open);
  assert.match(open.response.components[0].data.content, /Game setup/);
  assert.equal(open.response.flags, MessageFlags.IsComponentsV2);
  assert.ok(!open.response.components[0].data.content.includes("Oberon:"));
  function select(action, value) {
    const i = interaction(action, { gameId: game.id });
    i.isButton = () => false;
    i.isStringSelectMenu = () => true;
    i.values = [value];
    i.deferUpdate = async () => { i.deferred = true; };
    return i;
  }
  await handler(select('preset', '5'));
  assert.equal(games.requireGame('guild').config.counts.Resistance, 2);
  await handler(select('count:Merlin', '0'));
  await handler(select('count:Resistance', '2'));
  const save = interaction('savesetup', { gameId: game.id, messageId: 'private-editor' });
  save.deferUpdate = async () => { save.deferred = true; };
  await handler(save);
  assert.match(save.response.components[0].data.content, /saved/);
  assert.equal(games.requireGame('guild').config.counts.Merlin, 0);
  assert.equal(games.requireGame('guild').config.counts.Resistance, 2);
  const stale = select('preset', '6');
  await handler(stale);
  assert.match(stale.response.components[0].data.content, /Reopen/);
});

test('leader announcement mentions only the leader and persists across subsequent updates', async () => {
  const { games, handler } = fixture();
  await handler(interaction('create'));
  await configureSinglePlayer(games, handler);
  await handler(interaction('start'));
  const game = games.requireGame('guild');
  assert.equal(game.leaderId, 'host');
  const sent = [];
  const channel = { type: ChannelType.GuildText, messages: { edit: async () => {} }, send: async payload => { sent.push(payload); return { id: 'announcement' }; } };
  const client = { channels: { fetch: async () => channel } };
  await publishGame(client, games.store, game);
  await publishGame(client, games.store, games.requireGame('guild'));
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /<@host> goes first/);
  assert.deepEqual(sent[0].allowedMentions, { parse: [], users: ['host'] });
  assert.equal(sent[0].enforceNonce, true);
  assert.equal(games.requireGame('guild').leaderAnnouncementId, 'announcement');
  assert.match(JSON.stringify(lobbyMessage(game)), /Leader/);
});

test('setup pages contain labeled minus/quantity/plus rows within the V2 limit', async () => {
  const { games, handler } = fixture();
  await handler(interaction('create'));
  const game = games.requireGame('guild');
  const seen = [];
  for (let page = 0; page < setupPages().length; page++) {
    const view = setupMessage(game, null, page);
    assert.equal(view.flags, MessageFlags.IsComponentsV2);
    assert.equal(view.content, null);
    assert.deepEqual(view.embeds, []);
    assert.ok(!view.components[0].data.content.includes('Tristan:'));
    const components = view.components.map(c => c.toJSON());
    const count = items => items.reduce((n, c) => n + 1 + count(c.components || []), 0);
    assert.ok(count(components) <= 40);
    for (const row of components) {
      if (!row.components?.[0].custom_id.includes(':rolelabel:')) continue;
      const [label, minus, quantity, plus] = row.components;
      const role = label.custom_id.split(':')[3];
      seen.push(role);
      assert.equal(row.components.length, 4);
      assert.equal(label.label, role);
      assert.equal(label.disabled, true);
      assert.equal(quantity.label, String(game.config.counts[role]));
      assert.equal(quantity.disabled, true);
      assert.equal(minus.label, '−');
      assert.equal(plus.label, '+');
      assert.equal(minus.disabled, game.config.counts[role] === 0);
      assert.equal(plus.disabled, game.config.counts[role] === 15);
    }
  }
  assert.deepEqual(seen.sort(), Object.keys(game.config.counts).sort());
});

test('V2 setup validation errors preserve editable controls and support retrying save', async () => {
  const { games, handler } = fixture();
  await handler(interaction('create'));
  const game = games.requireGame('guild');
  await handler(interaction('setup', { gameId: game.id }));
  const count = interaction('count:Resistance', { gameId: game.id });
  count.isButton = () => false;
  count.isStringSelectMenu = () => true;
  count.values = ['15'];
  count.deferUpdate = async () => { count.deferred = true; };
  await handler(count);
  const save = interaction('savesetup', { gameId: game.id });
  save.deferUpdate = async () => { save.deferred = true; };
  await handler(save);
  assert.equal(save.response.flags, MessageFlags.IsComponentsV2);
  assert.equal(save.response.content, null);
  assert.match(save.response.components[1].data.content, /1 and 15/);
  assert.equal(save.response.components.filter(c => c.data.type === 1).length, setupPages()[0].length + 2);
  assert.equal(games.requireGame('guild').config.counts.Resistance, 2);
  count.values = ['2'];
  await handler(count);
  await handler(save);
  assert.match(save.response.components[0].data.content, /saved/);
});


test('roles is private, available without a game, and never reads or changes assignments', async () => {
  const { games, published, handler } = fixture();
  for (const started of [false, true]) {
    if (started) {
      await handler(interaction('create'));
      await configureSinglePlayer(games, handler);
      await handler(interaction('start'));
    }
    const before = games.store.all();
    const publications = published.length;
    const request = interaction('roles', { userId: 'non-player', channelId: 'another-channel' });
    await handler(request);
    assert.equal(request.deferPayload.flags, MessageFlags.Ephemeral);
    assert.ok(request.response.content.length <= 2000);
    for (const [name, info] of Object.entries(ROLE_INFO)) {
      assert.ok(request.response.content.includes(`**${name}** · ${info.team}`));
      assert.ok(request.response.content.includes(info.description));
    }
    assert.deepEqual(request.response.allowedMentions, { parse: [] });
    assert.deepEqual(games.store.all(), before);
    assert.equal(published.length, publications);
  }
});

test('larger role catalogs fit every page, including validation errors', async t => {
  const originalRoles = Object.keys(ROLE_INFO);
  t.after(() => {
    for (const role of Object.keys(ROLE_INFO)) if (!originalRoles.includes(role)) delete ROLE_INFO[role];
  });
  const count = items => items.reduce((n, c) => n + 1 + count(c.components || []), 0);
  for (const size of [12, 22, 35]) {
    while (Object.keys(ROLE_INFO).length < size) ROLE_INFO[`Extra${Object.keys(ROLE_INFO).length}`] = { team: 'Resistance', description: 'Test role.' };
    const { games, handler } = fixture();
    await handler(interaction('create'));
    const game = games.requireGame('guild');
    const seen = [];
    for (let page = 0; page < setupPages().length; page++) {
      for (const error of [null, 'Invalid setup']) {
        const components = setupMessage(game, error, page).components.map(c => c.toJSON());
        assert.ok(count(components) <= 40, `${size} roles, page ${page}, error ${error}`);
        const controls = components.at(-1).components;
        assert.equal(controls[0].disabled, page === 0);
        assert.equal(controls[1].disabled, page === setupPages().length - 1);
        const menus = components.flatMap(c => c.components || []).filter(c => c.custom_id.includes(':rolelabel:'));
        if (!error) seen.push(...menus.map(c => c.custom_id.split(':')[3]));
      }
    }
    assert.deepEqual(seen, Object.keys(ROLE_INFO));
  }
});

test('extra role edits survive navigation, invalid saves, and preset changes', async t => {
  ROLE_INFO.ExtraRole = { team: 'Resistance', description: 'Test role.' };
  t.after(() => { delete ROLE_INFO.ExtraRole; });
  const { games, handler } = fixture();
  await handler(interaction('create'));
  const game = games.requireGame('guild');
  await handler(interaction('setup', { gameId: game.id }));
  async function edit(action, value, userId = 'host') {
    const request = interaction(action, { gameId: game.id, userId });
    if (value !== undefined) {
      request.isButton = () => false;
      request.isStringSelectMenu = () => true;
      request.values = [value];
    }
    request.deferUpdate = async () => { request.deferred = true; };
    await handler(request);
    return request.response;
  }
  await edit('count:Resistance', '3');
  const page = await edit('setuppage:1');
  assert.match(page.components[0].data.content, /Page 2 of 2/);
  assert.match(page.components[0].data.content, /Resistance: \*\*3\*\*/);
  assert.ok(JSON.stringify(page).includes(':rolelabel:ExtraRole'));
  await edit('count:ExtraRole', '15');
  const failed = await edit('savesetup');
  assert.match(failed.components[1].data.content, /1 and 15/);
  assert.match(failed.components[0].data.content, /Page 2 of 2/);
  assert.equal(games.requireGame('guild').config.counts.ExtraRole, 0);
  await edit('setuppage:0');
  const back = await edit('setuppage:1');
  assert.match(back.components[0].data.content, /ExtraRole: \*\*15\*\*/);
  const invalid = await edit('setuppage:999');
  assert.match(invalid.components[1].data.content, /available setup page/);
  const denied = await edit('setuppage:0', undefined, 'guest');
  assert.match(denied.components[0].data.content, /Only the host/);
  await edit('preset', '5');
  await edit('count:ExtraRole', '1');
  await edit('setuppage:0');
  await edit('count:Resistance', '3');
  await edit('savesetup');
  assert.equal(games.requireGame('guild').config.counts.ExtraRole, 1);
  assert.equal(games.requireGame('guild').config.counts.Resistance, 3);
});

test('plus/minus buttons update drafts, enforce bounds and ownership, and save across pages', async () => {
  const { games, handler } = fixture();
  await handler(interaction('create'));
  const game = games.requireGame('guild');
  await handler(interaction('setup', { gameId: game.id }));
  async function click(action, userId = 'host') {
    const request = interaction(action, { gameId: game.id, userId, messageId: 'private-editor' });
    request.deferUpdate = async () => { request.deferred = true; request.updated = true; };
    await handler(request);
    assert.equal(request.updated, true);
    return request.response;
  }
  const denied = await click('adjust:Resistance:1', 'guest');
  assert.match(denied.components[0].data.content, /Only the host/);
  await click('adjust:Resistance:1');
  const adjusted = await click('adjust:Resistance:1');
  assert.match(adjusted.components[0].data.content, /Resistance: \*\*4\*\*/);
  assert.equal(games.requireGame('guild').config.counts.Resistance, 2);
  await click('adjust:Resistance:-1');
  const invalid = await click('adjust:Resistance:15');
  assert.match(invalid.components[1].data.content, /valid role adjustment/);
  const unknown = await click('adjust:Unknown:1');
  assert.match(unknown.components[1].data.content, /valid role adjustment/);
  await click('setuppage:1');
  const belowZero = await click('adjust:Spy:-1');
  assert.match(belowZero.components[1].data.content, /between 0 and 15/);
  let maximum;
  for (let i = 0; i < 15; i++) maximum = await click('adjust:Spy:1');
  const spyRow = maximum.components.map(c => c.toJSON()).find(c => c.components?.[0].label === 'Spy');
  assert.equal(spyRow.components[3].disabled, true);
  assert.equal(spyRow.components[2].label, '15');
  const aboveMax = await click('adjust:Spy:1');
  assert.match(aboveMax.components[1].data.content, /between 0 and 15/);
  const failed = await click('savesetup');
  assert.match(failed.components[1].data.content, /1 and 15/);
  assert.match(failed.components[0].data.content, /Page 2/);
  for (let i = 0; i < 14; i++) await click('adjust:Spy:-1');
  await click('setuppage:0');
  await click('savesetup');
  assert.equal(games.requireGame('guild').config.counts.Resistance, 3);
  assert.equal(games.requireGame('guild').config.counts.Spy, 1);
  const stale = await click('adjust:Resistance:1');
  assert.match(stale.components[0].data.content, /Reopen/);
});
