import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { GameError } from './game.js';
import { help, readSetup } from './commands.js';
import { actionSummary, lobbyMessage } from './presentation.js';

export async function publishGame(client, store, game) {
  const channel = await client.channels.fetch(game.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Lobby channel is unavailable.');
  const payload = lobbyMessage(game);
  if (game.messageId) {
    try { await channel.messages.edit(game.messageId, payload); return; }
    catch (error) { if (error.code !== 10008) throw error; } // Recreate deleted lobby messages only.
  }
  const message = await channel.send(payload);
  game.messageId = message.id;
  if (game.phase !== 'ended') store.set(game.guildId, game);
}

export function interactionHandler({ client, games, publish = game => publishGame(client, games.store, game) }) {
  return async interaction => {
    const slash = interaction.isChatInputCommand() && interaction.commandName === 'avalon';
    const button = interaction.isButton() && interaction.customId.startsWith('avalon:');
    if (!slash && !button) return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!interaction.guildId) throw new GameError('Use Avalon in a server text channel.');
      const [, gameId, buttonAction] = button ? interaction.customId.split(':') : [];
      const action = slash ? interaction.options.getSubcommand() : buttonAction;
      if (action === 'help') return await interaction.editReply({ content: help, allowedMentions: { parse: [] } });
      if (!['create', 'join', 'leave', 'setup', 'start', 'retry', 'end'].includes(action)) throw new GameError('Unknown Avalon action.');
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
          if (button && interaction.message.id !== game.messageId) throw new GameError('Use the latest lobby message.');
          if (action === 'join') game = await games.join(game, user);
          if (action === 'leave') game = games.leave(game, user.id);
          if (action === 'setup') game = games.setup(game, user.id, readSetup(interaction.options));
          if (action === 'start') game = await games.start(game, user.id);
          if (action === 'retry') game = await games.retry(game, user.id);
          if (action === 'end') game = games.end(game, user.id);
        }
        let content = actionSummary(action, game);
        try { await publish(game); }
        catch {
          content += ' The lobby message could not be updated. Check my channel permissions; the game change is saved. A later action will retry the update.';
          console.error('Could not update an Avalon lobby message.');
        }
        await interaction.editReply({ content, allowedMentions: { parse: [] } });
      });
    } catch (error) {
      // Discord errors can include request bodies/tokens; never log the raw error.
      if (!(error instanceof GameError)) console.error('Avalon action failed; check service and state-file permissions.');
      const content = error instanceof GameError ? error.message : 'The action could not finish. Existing roles remain saved; ask the host to retry or check the bot service.';
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content, allowedMentions: { parse: [] } });
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      } catch { console.error('Could not acknowledge a Discord interaction.'); }
    }
  };
}
