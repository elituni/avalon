import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, escapeMarkdown } from 'discord.js';
import { ROLE_INFO, totals } from '../../shared/roles.js';

export function lobbyMessage(game) {
  const started = game.phase === 'started';
  const ended = game.phase === 'ended';
  const pending = started ? game.players.filter(p => !game.delivered.includes(p.id)) : [];
  const status = ended ? 'Game ended' : started
    ? pending.length ? `${pending.length} role DM(s) pending. Host: use /avalon retry after players enable DMs.` : 'Roles delivered. Check your DMs!'
    : 'Join below. The host starts when all seats are filled.';
  const roster = game.players.map((p, i) => `${i + 1}. ${escapeMarkdown(p.name)}${p.id === game.hostId ? ' · Host' : ''}${started && p.id === game.leaderId ? ' · Leader' : ''}`);
  const playerFields = [];
  for (let offset = 0; offset < Math.max(roster.length, 1); offset += 5) {
    playerFields.push({
      name: offset ? 'Players (continued)' : `Players · ${game.players.length}/${totals(game.config).total}`,
      value: roster.slice(offset, offset + 5).join('\n') || 'No players',
    });
  }
  const roles = Object.entries(game.config.counts).filter(([, n]) => n).map(([role, n]) => `${role} ×${n}`).join(' · ');
  const embed = new EmbedBuilder().setTitle('Avalon').setColor(0x395d64)
    .setDescription(status).addFields(
      ...playerFields,
      { name: 'Role setup', value: roles },
    ).setFooter({ text: `Game ${game.id}` });
  // Only public setup and delivery status go in the channel, never assignments.
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`avalon:${game.id}:join`).setLabel('Join').setStyle(ButtonStyle.Primary)
      .setDisabled(started || ended || game.players.length >= totals(game.config).total),
    new ButtonBuilder().setCustomId(`avalon:${game.id}:leave`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(started || ended),
    new ButtonBuilder().setCustomId(`avalon:${game.id}:setup`).setLabel('Edit setup').setStyle(ButtonStyle.Secondary).setDisabled(started || ended),
    new ButtonBuilder().setCustomId(`avalon:${game.id}:start`).setLabel('Start').setStyle(ButtonStyle.Success)
      .setDisabled(started || ended || game.players.length !== totals(game.config).total),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

export function actionSummary(action, game) {
  if (game.phase === 'ended') return 'Game ended. Use /avalon create for another game.';
  if (['start', 'retry'].includes(action)) {
    const pending = game.players.filter(p => !game.delivered.includes(p.id));
    return pending.length
      ? `Roles are saved. DM delivery is pending for: ${pending.map(p => `${escapeMarkdown(p.name)} (ID: ${p.id})`).join(', ')}. Ask them to enable DMs, then use /avalon retry. Assignments will stay the same.`
      : 'All role DMs delivered. You can start playing.';
  }
  return { create: 'Lobby created. You are the host and have joined.', join: 'You are in the lobby.', leave: 'You left the lobby.', setup: 'Role setup saved.' }[action];
}

export const SETUP_PAGE_SIZE = 3;
export const SETUP_PAGE_COUNT = Math.ceil(Object.keys(ROLE_INFO).length / SETUP_PAGE_SIZE);

export function setupMessage(game, page = 0) {
  const counts = totals(game.config);
  const roles = Object.keys(ROLE_INFO).slice(page * SETUP_PAGE_SIZE, (page + 1) * SETUP_PAGE_SIZE);
  const rows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`avalon:${game.id}:preset`).setPlaceholder('Choose a player-count preset')
    .addOptions(...[5, 6, 7, 8, 9, 10, 15].map(n => ({ label: `${n} players`, value: String(n) }))))];
  for (const role of roles) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`avalon:${game.id}:count:${role}`).setPlaceholder(`${role}: ${game.config.counts[role]}`)
    .addOptions(...Array.from({ length: 16 }, (_, n) => ({
      label: `${role}: ${n}`, value: String(n), default: n === game.config.counts[role],
    })))));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`avalon:${game.id}:setuppage:${Math.max(0, page - 1)}`)
      .setLabel('Previous roles').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`avalon:${game.id}:setuppage:${Math.min(SETUP_PAGE_COUNT - 1, page + 1)}`)
      .setLabel('More roles').setStyle(ButtonStyle.Secondary).setDisabled(page === SETUP_PAGE_COUNT - 1),
    new ButtonBuilder().setCustomId(`avalon:${game.id}:savesetup`).setLabel('Save setup').setStyle(ButtonStyle.Success),
  ));
  const summary = Object.entries(game.config.counts).filter(([, n]) => n > 0)
    .map(([role, n]) => `${role}: **${n}**`).join(' · ') || 'No roles selected.';
  return {
    content: `**Game setup** · ${counts.total} seats · ${counts.Resistance} Resistance / ${counts.Spy} Spy\n` +
      summary + `\n**Roles · page ${page + 1}/${SETUP_PAGE_COUNT}**`,
    embeds: [], components: rows, allowedMentions: { parse: [] },
  };
}
