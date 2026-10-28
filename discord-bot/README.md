# Avalon Discord bot

Independent Discord games using the website's shared role rules. Node.js 22.12+ is required (the Droplet's Node.js 24 works). Install dependencies with `npm --prefix discord-bot ci` from the repository root. The website still has no dependencies.

## Play

One active game per Discord server, in a regular text channel. The creator joins as host; both creating and joining send a test DM. A failed DM prevents joining. Players can use buttons without typing commands.

| Command | Purpose |
| --- | --- |
| `/avalon create` | Create a lobby and join as host |
| `/avalon start` | Host: fill every seat, assign roles, DM each player's starting information |
| `/avalon retry` | Host: retry only pending role DMs, keeping assignments |
| `/avalon end` | Anyone: end the lobby or game one minute after creation; host: end anytime |
| `/avalon roles` | Describe every role and its team (visible only to you; no active game needed) |
| `/avalon help` | Show instructions |

Lobby buttons: **Join**, **Leave**, **Edit setup**, **Start**. The host can open **Edit setup**, choose presets or **Role: quantity − +** rows, and apply the draft with **Save setup**. Eight roles fit on each page, with automatic paging for larger catalogs and a full selected-role summary on each page. **Save setup** applies edits from every page. Drafts do not change the lobby until saved and are discarded on bot restart. If the host leaves before starting, hosting passes to the next joined player. The last player leaving closes the lobby. After starting, the roster and setup are locked. Play quests, voting, and assassination in voice or in person. Starting chooses a random first leader, shows a Leader label in the roster, and posts a message mentioning that player in the lobby channel. The choice and announcement ID persist across restarts and DM retries. Games already started before this feature retain their existing state; new games choose a leader. No optional cards are assigned.

Role DMs include the game ID, role, team, and allowed starting information. Names and Discord user IDs identify revealed players. A failed role DM leaves that player pending, and the host receives a private delivery report. The public lobby only shows the number of pending DMs. Enable DMs from server members and unblock the bot before retrying. Existing DMs remain in history; ending a game does not delete them.

## One-time Discord setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application. Under **Bot**, obtain/reset the bot token. Keep it secret.
2. Under **Installation**, enable **Guild Install**. Configure the `bot` and `applications.commands` scopes. Give the bot **View Channels**, **Send Messages**, **Embed Links**, and **Read Message History**. Use the installation link to add it to your server. No Administrator permission or privileged intents are needed. Leave the Interactions Endpoint URL empty; this bot uses the Gateway.
3. Copy the **Application ID** from General Information.
4. Make a local environment file without sharing the token in chat or Git:

   ```sh
   cp discord-bot/.env.example discord-bot/.env
   chmod 600 discord-bot/.env
   ```

   Edit `discord-bot/.env` and fill in `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID`. The file is ignored by Git.
5. Register the global commands, then run the bot:

   ```sh
   npm --prefix discord-bot run register
   npm run start:bot
   ```

Registration updates only the global `/avalon` command, available in servers where the bot is installed. Register once, and rerun when command definitions change; adding another server does not require registration. Commands are restricted to servers, not DMs. Server administrators can restrict command access under Server Settings → Integrations. Only run one bot process against a given state file; stop the local bot before activating production.

## Persistence and tests

The one-minute end timer starts at `/avalon create`, persists across restarts, and is not reset by starting the game or retrying DMs. Older saved games use their recorded start time as a conservative fallback; older lobbies without a timestamp get a one-minute grace period on first load, which is saved so subsequent restarts do not reset it.

Games are saved atomically in `discord-bot/data/games.json` by default. Assignments are saved **before** role DMs are sent. Bot restarts preserve games, host, assignments, and delivery progress; `/avalon retry` resumes pending delivery. A crash just after a successful DM may cause that same DM to be sent again, but never reshuffles roles. The file contains private roles and is created with owner-only permissions. An unreadable or unsupported state file stops startup instead of silently resetting games.

Ended games are removed from the state file. There is no automatic inactivity expiry. The host should end the game before leaving the Discord server; host recovery after a host leaves the server during a game is not implemented.

```sh
npm test
```

Run from the repository root after installing bot dependencies. Tests use fake Discord delivery and temporary state files; they do not message real users. Live Discord testing still requires your application token and a test server.

## Deploy to the existing Droplet

The bot uses its own service, releases, state, and deployment command. Website deployments do not restart it, and bot deployments do not restart the website.

First connect to the Droplet and create its environment file:

```sh
ssh -F ~/.ssh/config avalon-droplet
install -m 600 /dev/null /etc/avalon-bot.env
nano /etc/avalon-bot.env
```

For first-time setup only, put `DISCORD_TOKEN=your-token` in this file. Do not rerun the `install` command once populated: it would empty the file. Command registration can be done locally as above; the production service only needs the token.

From the repository root, with the changes committed:

```sh
bash scripts/deploy-bot.sh
```

The script requires the existing `/opt/node/bin/node` installation, installs locked dependencies, creates an unprivileged `avalon-bot` user, and waits for the bot to connect to Discord before reporting success. Failed startup restores the previous release when available. It never copies local `.env` or game-state files. Registration is separate from deployment.

Production state lives at `/var/lib/avalon-bot/games.json` and survives releases. The service uses a 128 MB memory-high threshold and a 192 MB hard limit to leave room for the website. Measure actual usage with real games before expanding the bot; exceeding the hard limit can restart it. No new inbound port or domain is needed.

```sh
ssh -F ~/.ssh/config avalon-droplet 'systemctl status avalon-bot --no-pager'
ssh -F ~/.ssh/config avalon-droplet 'journalctl -u avalon-bot -n 50 --no-pager'
ssh -F ~/.ssh/config avalon-droplet 'systemctl show avalon-bot -p MemoryCurrent -p CPUUsageNSec'
```

Protocol references: [Discord interactions](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx), [discord.js response methods](https://discordjs.guide/legacy/slash-commands/response-methods), and [cache configuration](https://discordjs.guide/legacy/miscellaneous/cache-customization).

Fool is an optional Resistance role (zero in the presets). Its private role is shown as Merlin, with the same Merlin text. At the start of each game, each Fool gets a random selection of other players of any team, without duplicates; its size equals the total number of spies, including Mordred and Oberon. The selection stays fixed through reconnects, DM retries, and bot restarts. Percival sees only real Merlins and Morganas, never Fools. The true Fool role and selected IDs stay in server storage, not in the player's web response or DM. Public setup counts still show the Fool count.
