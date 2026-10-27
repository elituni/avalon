import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, MessageFlags } from 'discord.js';
import { BotGames } from '../src/game.js';
import { GameStore } from '../src/store.js';
import { interactionHandler, publishGame } from '../src/interaction.js';
import { command, readSetup } from '../src/commands.js';
import { lobbyMessage } from '../src/presentation.js';

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

test('command schema exposes the agreed commands and custom setup semantics', () => {
  const json = command.toJSON();
  assert.deepEqual(json.options.map(o => o.name), ['create', 'setup', 'start', 'retry', 'end', 'help']);
  assert.equal(json.options.find(o => o.name === 'setup').options.length, 11);
  const options = values => ({ getInteger: key => values[key] ?? null });
  assert.equal(readSetup(options({ preset: 6 })).counts.Merlin, 1);
  const config = readSetup(options({ resistance: 3, spy: 2 }));
  assert.equal(config.counts.Merlin, 0);
  assert.equal(config.counts.Spy, 2);
  assert.throws(() => readSetup(options({ preset: 6, merlin: 1 })), /not both/);
  assert.throws(() => readSetup(options({})), /Provide/);
});

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
  await handler(interaction('setup', { options: { resistance: 1 } }));
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
