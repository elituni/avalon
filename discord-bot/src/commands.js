import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType } from 'discord.js';
import { ROLE_INFO, emptyCounts, preset } from '../../shared/roles.js';
import { GameError } from './game.js';

export const command = new SlashCommandBuilder()
  .setName('avalon').setDescription('Create a lobby and deal private Avalon roles by DM')
  .setContexts(InteractionContextType.Guild)
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .addSubcommand(s => s.setName('create').setDescription('Create a lobby and join as host'))
  .addSubcommand(s => {
    s.setName('setup').setDescription('Host: choose a preset or custom counts (omitted roles become zero)')
      .addIntegerOption(o => o.setName('preset').setDescription('Choose a preset; do not combine with role counts')
        .addChoices(...[5, 6, 7, 8, 9, 10, 15].map(n => ({ name: `${n} players`, value: n }))));
    for (const role of Object.keys(ROLE_INFO)) s.addIntegerOption(o => o.setName(role.toLowerCase())
      .setDescription(`Number of ${role} roles`).setMinValue(0).setMaxValue(15));
    return s;
  })
  .addSubcommand(s => s.setName('start').setDescription('Host: assign roles and send private DMs'))
  .addSubcommand(s => s.setName('retry').setDescription('Host: retry undelivered role DMs without reshuffling'))
  .addSubcommand(s => s.setName('end').setDescription('Host: end the game or cancel the lobby'))
  .addSubcommand(s => s.setName('help').setDescription('Explain Avalon commands and DM requirements'));

export function readSetup(options) {
  const size = options.getInteger('preset');
  const counts = emptyCounts();
  let custom = false;
  for (const role of Object.keys(counts)) {
    const value = options.getInteger(role.toLowerCase());
    if (value !== null) { counts[role] = value; custom = true; }
  }
  if (size !== null && custom) throw new GameError('Choose a preset OR custom role counts, not both.');
  if (size !== null) {
    if (![5, 6, 7, 8, 9, 10, 15].includes(size)) throw new GameError('Choose a supported preset.');
    return preset(size);
  }
  if (!custom) throw new GameError('Provide a preset or role counts. Example: /avalon setup preset:6. Omitted custom roles become zero.');
  return { mode: 'custom', counts };
}

export const help = [
  '**Avalon — lobbies and role DMs**',
  '`/avalon create` creates a lobby and joins you as host. One game per server.',
  'Use **Join** / **Leave** in the lobby. Joining sends a test DM; enable DMs from this server.',
  'Click **Edit setup** for preset, role, and count dropdowns, then **Save setup**. `/avalon setup` also opens the editor.',
  '`/avalon setup preset:6` still selects a preset. Or supply role counts; omitted roles become zero.',
  '`/avalon start` (or **Start**) deals roles and DMs starting information once all seats are filled.',
  '`/avalon retry` retries only pending DMs, preserving roles.',
  '`/avalon end` ends the game or cancels the lobby. Setup/start/retry/end are host-only.',
  'If the host leaves the lobby, the next player becomes host. The last player leaving closes it.',
  'Games survive bot restarts. Role DMs remain in your history; check the game ID.',
  'Play quests, votes and assassination in voice or in person. A random first leader is shown in the lobby and mentioned in the channel. No optional cards are assigned.',
].join('\n');
