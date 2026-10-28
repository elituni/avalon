import { createHash } from 'node:crypto';
import { ROLE_INFO, preset } from '../../shared/roles.js';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { GameError } from './game.js';
import { help, roles } from './commands.js';
import { actionSummary, lobbyMessage, setupMessage, setupNotice, setupPages } from './presentation.js';

export async function publishGame(client, store, game) {
  const channel = await client.channels.fetch(game.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Lobby channel is unavailable.');
  const payload = lobbyMessage(game);
  let updated = false;
  if (game.messageId) {
    try { await channel.messages.edit(game.messageId, payload); updated = true; }
    catch (error) { if (error.code !== 10008) throw error; }
  }
  if (!updated) {
    const message = await channel.send(payload);
    game.messageId = message.id;
    if (game.phase !== 'ended') store.set(game.guildId, game);
  }
  if (game.phase === 'started' && game.leaderId && !game.leaderAnnouncementId) {
    const message = await channel.send({
      content: `<@${game.leaderId}> goes first! You are the leader for this game.`,
      allowedMentions: { parse: [], users: [game.leaderId] },
      nonce: createHash('sha256').update(game.id).digest('hex').slice(0, 24), enforceNonce: true,
    });
    game.leaderAnnouncementId = message.id;
    store.set(game.guildId, game);
  }
}

export function interactionHandler({ client, games, publish = game => publishGame(client, games.store, game) }) {
  const drafts = new Map();
  return async interaction => {
    const slash = interaction.isChatInputCommand() && interaction.commandName === 'avalon';
    const button = interaction.isButton() && interaction.customId.startsWith('avalon:');
    const select = interaction.isStringSelectMenu?.() && interaction.customId.startsWith('avalon:');
    if (!slash && !button && !select) return;
    const editorAction = select || (button && ['savesetup', 'setuppage'].includes(interaction.customId.split(':')[2]));
    try {
      if (editorAction) await interaction.deferUpdate();
      else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!interaction.guildId) throw new GameError('Use Avalon in a server text channel.');
      const [, gameId, buttonAction, roleArgument] = (button || select) ? interaction.customId.split(':') : [];
      const action = slash ? interaction.options.getSubcommand() : buttonAction;
      if (slash && action === 'setup') throw new GameError('Use the lobby’s Edit setup button to configure roles.');
      if (slash && action === 'roles') return await interaction.editReply({ content: roles, allowedMentions: { parse: [] } });
      if (action === 'help') return await interaction.editReply({ content: help, allowedMentions: { parse: [] } });
      if (!['create', 'join', 'leave', 'setup', 'start', 'retry', 'end', 'preset', 'setuppage', 'count', 'savesetup'].includes(action)) throw new GameError('Unknown Avalon action.');
      await games.run(interaction.guildId, async () => {
        let game;
        const user = { id: interaction.user.id, name: (interaction.member?.displayName || interaction.user.globalName || interaction.user.username).slice(0, 32) };
        if (action === 'create') {
          if (interaction.channel?.type !== ChannelType.GuildText) throw new GameError('Create the lobby in a regular server text channel.');
          const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
          if (!interaction.appPermissions?.has(required)) throw new GameError('I need View Channel, Send Messages, Embed Links, and Read Message History here.');
          game = await games.create({ guildId: interaction.guildId, guildName: interaction.guild.name, channelId: interaction.channelId, user });
        } else {
          game = games.requireGame(interaction.guildId, gameId);
          if (interaction.channelId !== game.channelId) throw new GameError(`Use the lobby channel <#${game.channelId}>.`);
          if (button && !editorAction && interaction.message.id !== game.messageId) throw new GameError('Use the latest lobby message.');
          const openSetup = action === 'setup' && button;
          if (openSetup || editorAction) {
            games.host(game, user.id); games.lobby(game);
            if (openSetup) drafts.set(game.guildId, { gameId: game.id, userId: user.id, page: 0, config: structuredClone(game.config) });
            const draft = drafts.get(game.guildId);
            if (!draft || draft.gameId !== game.id || draft.userId !== user.id) throw new GameError('Reopen Edit setup to start a new draft.');
            if (action === 'setuppage') {
              const page = Number(roleArgument);
              if (!/^\d+$/.test(roleArgument || '') || !Number.isInteger(page) || page >= setupPages().length) throw new GameError('Choose an available setup page.');
              draft.page = page;
            }
            const value = interaction.values?.[0];
            if (action === 'preset') {
              if (!['5', '6', '7', '8', '9', '10', '15'].includes(value)) throw new GameError('Choose a supported preset.');
              draft.config = preset(Number(value));
            }
            if (action === 'count') {
              if (!Object.hasOwn(ROLE_INFO, roleArgument) || !/^(?:[0-9]|1[0-5])$/.test(value || '')) throw new GameError('Choose a valid role count.');
              draft.config.mode = 'custom';
              draft.config.counts[roleArgument] = Number(value);
            }
            if (action !== 'savesetup') return await interaction.editReply(setupMessage({ ...game, config: draft.config }, null, draft.page));
            game = games.setup(game, user.id, draft.config);
            drafts.delete(game.guildId);
          }
          if (action === 'join') game = await games.join(game, user);
          if (action === 'leave') game = games.leave(game, user.id);
          if (action === 'start') game = await games.start(game, user.id);
          if (action === 'retry') game = await games.retry(game, user.id);
          if (action === 'end') game = games.end(game, user.id);
        }
        if (['start', 'end', 'setup'].includes(action)) drafts.delete(game.guildId);
        let content = actionSummary(action === 'savesetup' ? 'setup' : action, game);
        try { await publish(game); }
        catch {
          content += ' The lobby message could not be updated. Check my channel permissions; the game change is saved. A later action will retry the update.';
          console.error('Could not update an Avalon lobby message.');
        }
        await interaction.editReply(editorAction ? setupNotice(content) : { content, components: [], embeds: [], allowedMentions: { parse: [] } });
      });
    } catch (error) {
      // Discord errors can include request bodies/tokens; never log the raw error.
      if (!(error instanceof GameError)) console.error('Avalon action failed; check service and state-file permissions.');
      const content = error instanceof GameError ? error.message : 'The action could not finish. Existing roles remain saved; ask the host to retry or check the bot service.';
      try {
        if (interaction.deferred || interaction.replied) {
          let payload = { content, allowedMentions: { parse: [] } };
          if (editorAction) {
            const draft = drafts.get(interaction.guildId);
            const game = games.store.get(interaction.guildId);
            payload = game?.phase === 'lobby' && game.hostId === interaction.user.id &&
              draft?.gameId === game.id && draft.userId === interaction.user.id
              ? setupMessage({ ...game, config: draft.config }, content, draft.page) : setupNotice(content);
          }
          await interaction.editReply(payload);
        }
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      } catch { console.error('Could not acknowledge a Discord interaction.'); }
    }
  };
}
