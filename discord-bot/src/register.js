import { REST, Routes } from 'discord.js';
import { command } from './commands.js';

const { DISCORD_TOKEN, DISCORD_APPLICATION_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_APPLICATION_ID) {
  console.error('Set DISCORD_TOKEN and DISCORD_APPLICATION_ID.');
  process.exit(1);
}
try {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  // POST upserts only /avalon; do not replace unrelated application commands.
  const data = command.toJSON();
  await rest.post(Routes.applicationCommands(DISCORD_APPLICATION_ID), { body: data });
  console.log('Registered /avalon globally.');
} catch {
  console.error('Command registration failed. Check the token, application ID, and bot installation.');
  process.exitCode = 1;
}
