import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { GameStore } from './store.js';
import { BotGames } from './game.js';
import { interactionHandler, publishGame } from './interaction.js';

if (!process.env.DISCORD_TOKEN) {
  console.error('Set DISCORD_TOKEN in discord-bot/.env or the service environment.');
  process.exit(1);
}
const store = new GameStore(resolve(process.env.AVALON_BOT_STATE || 'data/games.json'));
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  allowedMentions: { parse: [] },
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0 }),
  rest: { timeout: 15000, retries: 2 },
});
const games = new BotGames({ store, sendDM: async (userId, content) => {
  const user = await client.users.fetch(userId, { cache: false });
  await user.send({ content, allowedMentions: { parse: [] } });
} });
client.on(Events.InteractionCreate, interactionHandler({ client, games }));
client.once(Events.ClientReady, async () => {
  console.log('Avalon bot connected to Discord.');
  if (process.env.NOTIFY_SOCKET) execFile('systemd-notify', ['--ready'], error => {
    if (error) { console.error('Could not notify systemd of readiness.'); client.destroy(); process.exitCode = 1; }
  });
  for (const game of store.all()) {
    try { await games.run(game.guildId, () => publishGame(client, store, game)); }
    catch { console.error('Could not refresh a saved lobby; a later action can retry.'); }
  }
});
client.on(Events.Error, () => console.error('Discord connection error; reconnecting when possible.'));
client.on(Events.ShardError, () => console.error('Discord gateway error.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { client.destroy(); process.exit(0); });
try { await client.login(process.env.DISCORD_TOKEN); }
catch { console.error('Discord login failed. Check the bot token and internet connection.'); client.destroy(); process.exitCode = 1; }
