import { ROLE_INFO } from '../../shared/roles.js';
import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType } from 'discord.js';

export const command = new SlashCommandBuilder()
  .setName('avalon').setDescription('Create a lobby and deal private Avalon roles by DM')
  .setContexts(InteractionContextType.Guild)
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .addSubcommand(s => s.setName('create').setDescription('Create a lobby and join as host'))
  .addSubcommand(s => s.setName('start').setDescription('Host: assign roles and send private DMs'))
  .addSubcommand(s => s.setName('retry').setDescription('Host: retry undelivered role DMs without reshuffling'))
  .addSubcommand(s => s.setName('end').setDescription('End the lobby or game one minute after creation; host can end anytime'))
  .addSubcommand(s => s.setName('roles').setDescription('Show every role, its team, and its starting information'))
  .addSubcommand(s => s.setName('help').setDescription('Explain Avalon commands and DM requirements'));

export const help = [
  '**Avalon — lobbies and role DMs**',
  '`/avalon create` creates a lobby and joins you as host. One game per server.',
  'Use **Join** / **Leave** in the lobby. Joining sends a test DM; enable DMs from this server.',
  'Click **Edit setup** for presets and − / + buttons beside each role, then **Save setup**.',
  '`/avalon start` (or **Start**) deals roles and DMs starting information once all seats are filled.',
  '`/avalon roles` describes every role and its team.',
  '`/avalon retry` retries only pending DMs, preserving roles.',
  '`/avalon end` lets anyone end the game one minute after `/avalon create`, even while waiting in the lobby. The host can end it anytime. Setup/start/retry are host-only.',
  'If the host leaves the lobby, the next player becomes host. The last player leaving closes it.',
  'Games survive bot restarts. Role DMs remain in your history; check the game ID.',
  'Play quests, votes and assassination in voice or in person. A random first leader is shown in the lobby and mentioned in the channel. No optional cards are assigned.',
].join('\n');

export const roles = [
  '**Avalon roles**',
  ...Object.entries(ROLE_INFO).map(([name, info]) => `**${name}** · ${info.team}\n${info.description}`),
].join('\n\n');
