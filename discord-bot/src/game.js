import { randomUUID } from 'node:crypto';
import { assignRoles, perceivedRole, chooseLeader, startingInformation } from '../../shared/game.js';
import { ROLE_INFO, preset, totals, validateConfig } from '../../shared/roles.js';

export class GameError extends Error {}
const check = (condition, message) => { if (!condition) throw new GameError(message); };
const safeName = name => String(name).replace(/[\\*_~`>|\[\]()]/g, '\\$&').slice(0, 100);

export function roleMessage(game, player) {
  const info = startingInformation(player, game.players);
  const role = perceivedRole(player);
  return [
    `**Avalon · Game ${game.id}**`,
    `Server: ${safeName(game.guildName)}`,
    `**Your role: ${role}**`,
    `**Team: ${ROLE_INFO[player.role].team}**`,
    ROLE_INFO[role].description,
    '', `**${info.heading}**`, info.explanation,
    ...info.players.map(p => `• ${safeName(p.name)} (ID: ${p.id})`),
    ...(info.players.length ? [] : ['No players revealed.']),
    '', '────────────────────',
  ].join('\n');
}

export class BotGames {
  constructor({ store, sendDM }) {
    this.store = store;
    this.sendDM = sendDM;
    this.locks = new Set();
  }
  async run(guildId, action) {
    check(!this.locks.has(guildId), 'Another action is running. Try again in a moment.');
    this.locks.add(guildId);
    try { return await action(); }
    finally { this.locks.delete(guildId); }
  }
  requireGame(guildId, gameId) {
    const game = this.store.get(guildId);
    check(game, 'No active game. Use /avalon create.');
    check(!gameId || game.id === gameId, 'This button belongs to an old game. Use the current lobby.');
    return game;
  }
  host(game, userId) { check(game.hostId === userId, 'Only the host can do that.'); }
  lobby(game) { check(game.phase === 'lobby', 'Roles have been dealt. End this game to create a new lobby.'); }
  async checkDM(userId, gameId) {
    try {
      await this.sendDM(userId, `Avalon · Game ${gameId}\nDM check successful. Your seat will be confirmed in the lobby. Your role will arrive here when the host starts.`);
    } catch {
      throw new GameError('I could not DM you. Allow direct messages from this server, unblock the bot if needed, then try again.');
    }
  }
  async create({ guildId, guildName, channelId, user }) {
    check(!this.store.get(guildId), 'This server already has an active game. End it before creating another.');
    const game = { id: randomUUID(), guildId, guildName, channelId, messageId: null,
      hostId: user.id, phase: 'lobby', config: preset(), players: [{ ...user }], delivered: [] };
    await this.checkDM(user.id, game.id);
    this.store.set(guildId, game);
    return game;
  }
  async join(game, user) {
    this.lobby(game);
    if (game.players.some(p => p.id === user.id)) return game;
    check(game.players.length < totals(game.config).total, 'This lobby is full.');
    await this.checkDM(user.id, game.id);
    game.players.push({ ...user });
    this.store.set(game.guildId, game);
    return game;
  }
  leave(game, userId) {
    this.lobby(game);
    check(game.players.some(p => p.id === userId), 'You are not in this lobby.');
    game.players = game.players.filter(p => p.id !== userId);
    if (game.players.length === 0) return this.end(game, userId);
    if (game.hostId === userId) game.hostId = game.players[0].id;
    this.store.set(game.guildId, game);
    return game;
  }
  setup(game, userId, config) {
    this.host(game, userId); this.lobby(game);
    const error = validateConfig(config);
    check(!error, error);
    check(totals(config).total >= game.players.length, 'There are more joined players than seats. Players must leave first.');
    game.config = structuredClone(config);
    this.store.set(game.guildId, game);
    return game;
  }
  async start(game, userId) {
    this.host(game, userId); this.lobby(game);
    check(game.players.length === totals(game.config).total, 'Fill every seat before starting.');
    game.players = assignRoles(game.players, game.config);
    game.leaderId = chooseLeader(game.players);
    game.leaderAnnouncementId = null;
    game.phase = 'started';
    game.delivered = [];
    this.store.set(game.guildId, game); // Assignments must survive a crash before the first DM.
    return this.deliver(game);
  }
  async retry(game, userId) {
    this.host(game, userId);
    check(game.phase === 'started', 'Start the game before retrying role delivery.');
    return this.deliver(game);
  }
  async deliver(game) {
    for (const player of game.players) {
      if (game.delivered.includes(player.id)) continue;
      try { await this.sendDM(player.id, roleMessage(game, player)); }
      catch { continue; }
      game.delivered.push(player.id);
      // A crash between DM delivery and this save can cause a duplicate DM,
      // but never a new assignment. Storage errors stop further delivery.
      this.store.set(game.guildId, game);
    }
    return game;
  }
  end(game, userId) {
    this.host(game, userId);
    this.store.set(game.guildId, null);
    return { ...game, phase: 'ended' };
  }
}
