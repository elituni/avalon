import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, TextDisplayBuilder, MessageFlags, escapeMarkdown } from 'discord.js';
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

export function setupNotice(content) {
  return {
    flags: MessageFlags.IsComponentsV2, content: null, embeds: [],
    components: [new TextDisplayBuilder().setContent(content)], allowedMentions: { parse: [] },
  };
}

// Each role uses three buttons and their row (4 components). Reserve room for
// the summary, preset, save/navigation controls, and a validation error.
export function setupPages() {
  const roles = Object.keys(ROLE_INFO);
  const pageSize = 8;
  return Array.from({ length: Math.ceil(roles.length / pageSize) }, (_, i) => roles.slice(i * pageSize, (i + 1) * pageSize));
}

export function setupMessage(game, error = null, page = 0) {
  const pages = setupPages();
  page = Math.max(0, Math.min(page, pages.length - 1));
  const counts = totals(game.config);
  const summary = Object.entries(game.config.counts).filter(([, n]) => n > 0)
    .map(([role, n]) => `${role}: **${n}**`).join(' · ') || 'No roles selected.';
  const payload = setupNotice(`**Game setup** · ${counts.total} seats · ${counts.Resistance} Resistance / ${counts.Spy} Spy\n${summary}`);
  const rows = payload.components;
  if (pages.length > 1) rows[0].setContent(`${rows[0].data.content}\nPage ${page + 1} of ${pages.length} · Save setup applies all pages.`);
  if (error) rows.push(new TextDisplayBuilder().setContent(error));
  rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`avalon:${game.id}:preset`).setPlaceholder('Choose a player-count preset')
    .addOptions(...[5, 6, 7, 8, 9, 10, 15].map(n => ({ label: `${n} players`, value: String(n) })))));
  for (const role of pages[page]) {
    const quantity = game.config.counts[role];
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`avalon:${game.id}:adjust:${role}:-1`)
        .setLabel('−').setStyle(ButtonStyle.Primary).setDisabled(quantity === 0),
      new ButtonBuilder().setCustomId(`avalon:${game.id}:adjust:${role}:1`)
        .setLabel('+').setStyle(ButtonStyle.Primary).setDisabled(quantity === 15),
      new ButtonBuilder().setCustomId(`avalon:${game.id}:rolelabel:${role}`)
        .setLabel(`${role}: ${quantity}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    ));
  }
  const controls = new ActionRowBuilder();
  if (pages.length > 1) controls.addComponents(
    new ButtonBuilder().setCustomId(`avalon:${game.id}:setuppage:${page - 1}`)
      .setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`avalon:${game.id}:setuppage:${page + 1}`)
      .setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length - 1),
  );
  controls.addComponents(new ButtonBuilder().setCustomId(`avalon:${game.id}:savesetup`).setLabel('Save setup').setStyle(ButtonStyle.Success));
  rows.push(controls);
  return payload;
}
