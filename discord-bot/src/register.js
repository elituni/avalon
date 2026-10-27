import { REST, Routes } from 'discord.js';
import { command } from './commands.js';

const { DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_APPLICATION_ID || !DISCORD_GUILD_ID) {
  console.error('Set DISCORD_TOKEN, DISCORD_APPLICATION_ID, and DISCORD_GUILD_ID. Registration targets your test server.');
  process.exit(1);
}
try {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  // POST upserts only /avalon; do not replace unrelated application commands.
  const data = command.toJSON();
  delete data.contexts;
  delete data.integration_types;
  await rest.post(Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_GUILD_ID), { body: data });
  console.log('Registered /avalon in the configured Discord server.');
} catch {
  console.error('Command registration failed. Check the token, application/server IDs, and bot installation.');
  process.exitCode = 1;
}
