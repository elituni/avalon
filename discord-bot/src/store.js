import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

// One bot process owns this file. Persist before revealing roles; never silently
// discard unreadable state, since players may already have received their roles.
export class GameStore {
  constructor(file) {
    this.file = file;
    this.games = {};
    if (!file) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version !== 1 || !saved.games || typeof saved.games !== 'object' || Array.isArray(saved.games)) {
        throw new Error('Unsupported bot state file.');
      }
      this.games = saved.games;
      // Saved games from before Fool was introduced keep all assignments intact.
      for (const game of Object.values(this.games)) {
        if (game.config?.counts && !Object.hasOwn(game.config.counts, 'Fool')) game.config.counts.Fool = 0;
        // Old games lack creation times: use their start time if known,
        // otherwise start a one-minute grace period and persist it once.
        if (!Number.isFinite(game.createdAt)) {
          game.createdAt = Number.isFinite(game.startedAt) ? game.startedAt : Date.now();
          this.set(game.guildId, game);
        }
      }
      chmodSync(file, 0o600);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  get(guildId) { return structuredClone(this.games[guildId] ?? null); }
  all() { return structuredClone(Object.values(this.games)); }
  set(guildId, game) {
    const next = structuredClone(this.games);
    if (game) next[guildId] = structuredClone(game);
    else delete next[guildId];
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, games: next }), { mode: 0o600, flush: true });
      renameSync(temporary, this.file);
    }
    this.games = next;
  }
}
