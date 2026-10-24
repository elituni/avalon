# Avalon lobby and private role reveal

A shared lobby and private role reveal using Node.js and plain browser JavaScript. No dependencies or build step.

## Run locally

Use Node.js 22 or newer:

```sh
npm start
```

Open http://localhost:3000. Enter a unique display name and join. The host chooses the role distribution; its total determines the number of seats. Every seat must be filled by a connected player to start. Any joined player may start. The default remains six players: two Resistance and one each of Merlin, Morgana, Assassin, and Percival. Each browser receives its own role and only the starting information that role is allowed to see.

The first player to join becomes the host (viewing the page alone does not take a seat). The host can transfer hosting to another connected player or kick someone from the lobby. These controls are enforced by the server and unavailable after roles are dealt. Any joined player can still start when all configured seats are connected.

If the host leaves or exceeds the 15-second disconnect grace period, hosting passes to the earliest joined connected player. Reconnecting does not reclaim hosting. Kicking removes a seat from all of that player’s tabs; it is not a ban, and the player may explicitly join again if space is available.

A browser session cookie identifies a player across tabs and refreshes. To test six players, use six separate browser profiles or devices (ordinary tabs share one seat). Private windows from the same browser may also share cookies.

Browsers send heartbeats every three seconds. A player is disconnected after 15 seconds without one, including when a device sleeps or the browser suspends background tabs. Before starting, disconnected seats can be reclaimed by new players. Players can also explicitly leave the lobby. After starting, the roster is locked and reconnecting restores the original role.

State is held in one server process. Restarting or deploying clears the lobby and assignments. This version stops at role reveal: no quests, voting, assassination action, or in-app new-game/reset control yet. A session identifies a browser, not a verified person.

```sh
npm test
```

Tests cover capacity, duplicate tabs, simultaneous starts, exact role counts, role privacy, heartbeat expiry, reconnects, locked rosters, fresh-server reset, host permissions, transfers, kicks, automatic host succession, configuration validation, all eight roles’ private starting information, and custom 15-player games.

## Role setup and starting information

The player grid is the main view for everyone, including the host. Role counts appear in the **Game setup** sidebar (below the roster on phones). The host opens **Edit roles**, adjusts counts, then selects **Save setup**. Role explanations are available under **Role guide** and private **Role details**. All players can see the saved distribution; nobody can see the assignments before starting. Presets cover 5–10 players plus the custom 15-player example. The server rejects changes by non-hosts, changes after starting, and reductions below the current roster size.

Standard setup uses the original game’s team counts: 5 players = 3 Resistance / 2 Spy; 6 = 4/2; 7 = 4/3; 8 = 5/3; 9 = 6/3; 10 = 6/4. Our standard preset requires one Merlin and one Assassin, and at most one each of Percival, Morgana, Mordred, and Oberon. With five players and Percival, include Morgana or Mordred. Custom mode supports 5–15 players, repeated special roles, optional Merlin/Assassin, and any split with at least one player on each side. Custom distributions are house rules, not an official balanced format.

- Merlin sees spies except Mordred, including Oberon, without exact roles.
- Percival sees Merlin and Morgana together without labels distinguishing them. If only one of those role types exists, the public distribution makes the reveal unambiguous.
- Assassin, Morgana, Mordred, and ordinary spies see their spy teammates except Oberon, without exact roles.
- Resistance and Oberon receive no other-player identities. Oberon still knows their own Spy allegiance.

Repeated special roles in custom mode each receive the same visibility rules. A custom Percival sees all Merlin/Morgana candidates; Merlins do not learn other Merlins. Candidate lists follow public seating order rather than sorting by secret role. Information persists through refreshes and reconnects. The host has no special access to anyone else’s role or knowledge.

Rules checked against the original [Avalon rulebook PDF](https://avalon.fun/pdfs/rules.pdf) and its [text transcription](https://www.rulespal.com/resistance-avalon/rulebook). This scope covers the original roles and opening reveal, not expansion characters or gameplay powers such as Lady of the Lake.

## Configuration

The default listener is `0.0.0.0:3000`. Override with `HOST` and `PORT`. The current IP-based deployment uses HTTP; private role responses are access-controlled by session but transport is not encrypted. HTTPS should be added before relying on role secrecy over untrusted networks.

The API provides `GET /api/state`, `GET /api/health`, and POST endpoints `/api/join`, `/api/heartbeat`, `/api/start`, `/api/leave`, `/api/host`, `/api/kick`, and `/api/config`. Join accepts `{ "name": "Alice" }`. Host transfer and kick accept `{ "playerId": "..." }`. Configuration accepts `{ "mode": "standard", "counts": { ... } }` with all eight role counts (see `public/roles.js`). Other actions have no body. All responses disable caching, and modifying requests reject cross-site origins.

## Deploy to the Droplet

With local Node.js, Git, rsync, and SSH available, commit your changes and run:

```sh
bash scripts/deploy.sh
```

The default target is the `avalon-droplet` SSH alias (root at `178.128.7.152`). An alternate target can be passed as the first argument. The script uses `~/.ssh/config`; override this with `AVALON_SSH_CONFIG` if needed.

Deployment requires a clean working tree, runs the tests, and transfers only the committed app and deployment files via rsync. Each release records its Git revision in `/opt/avalon/current/REVISION`. First-time setup installs an official Node.js 24 binary under `/opt/node`, verifies its published SHA-256 checksum, and creates an unprivileged `avalon` service user. Node.js is not automatically upgraded on subsequent deployments.

The systemd service starts on boot, restarts after crashes, and listens on port 3000. The script allows port 3000 and SSH port 22 if UFW is active; any DigitalOcean cloud firewall must also permit port 3000. Deployment checks the API locally on the Droplet and restores the previous release if that check fails. Previous release directories are retained under `/opt/avalon/releases`.

Open http://178.128.7.152:3000 and verify from a phone on cellular data. Every deployment restarts the app and clears the lobby and roles.

```sh
ssh -F ~/.ssh/config avalon-droplet 'systemctl status avalon --no-pager'
ssh -F ~/.ssh/config avalon-droplet 'journalctl -u avalon -n 50 --no-pager'
```

## Temporary Percival UI demo

Run `AVALON_DEMO=1 npm start` to seed four always-connected NPCs and a five-player setup. Join as `laze` and start; that player is always Percival, while the other roles are shuffled among NPCs. The page labels this as a Percival demo. NPC seats and role configuration are fixed, and the human player is host. NPCs simulate seats only, not gameplay.

Normal mode is unchanged when `AVALON_DEMO` is unset. On the Droplet the demo can be enabled through `/etc/systemd/system/avalon.service.d/demo.conf` containing `[Service]` and `Environment=AVALON_DEMO=1`. Remove that specific override, run `systemctl daemon-reload`, and restart `avalon` to restore normal random assignments and an empty six-player lobby.
