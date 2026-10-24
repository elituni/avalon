# Avalon six-player lobby

A shared lobby and private role reveal using Node.js and plain browser JavaScript. No dependencies or build step.

## Run locally

Use Node.js 22 or newer:

```sh
npm start
```

Open http://localhost:3000. Enter a unique display name and join. Exactly six connected players are required to start; any joined player may start. The server randomly deals two Resistance roles and one each of Merlin, Morgana, Assassin, and Percival. Each browser receives only its own role.

The first player to join becomes the host (viewing the page alone does not take a seat). The host can transfer hosting to another connected player or kick someone from the lobby. These controls are enforced by the server and unavailable after roles are dealt. Any joined player can still start when all six are connected.

If the host leaves or exceeds the 15-second disconnect grace period, hosting passes to the earliest joined connected player. Reconnecting does not reclaim hosting. Kicking removes a seat from all of that player’s tabs; it is not a ban, and the player may explicitly join again if space is available.

A browser session cookie identifies a player across tabs and refreshes. To test six players, use six separate browser profiles or devices (ordinary tabs share one seat). Private windows from the same browser may also share cookies.

Browsers send heartbeats every three seconds. A player is disconnected after 15 seconds without one, including when a device sleeps or the browser suspends background tabs. Before starting, disconnected seats can be reclaimed by new players. Players can also explicitly leave the lobby. After starting, the roster is locked and reconnecting restores the original role.

State is held in one server process. Restarting or deploying clears the lobby and assignments. This version stops at role reveal: no quests, voting, role-specific knowledge, or in-app new-game/reset control yet. A session identifies a browser, not a verified person.

```sh
npm test
```

Tests cover capacity, duplicate tabs, simultaneous starts, exact role counts, role privacy, heartbeat expiry, reconnects, locked rosters, fresh-server reset, host permissions, transfers, kicks, and automatic host succession.

## Configuration

The default listener is `0.0.0.0:3000`. Override with `HOST` and `PORT`. The current IP-based deployment uses HTTP; private role responses are access-controlled by session but transport is not encrypted. HTTPS should be added before relying on role secrecy over untrusted networks.

The API provides `GET /api/state`, `GET /api/health`, and POST endpoints `/api/join`, `/api/heartbeat`, `/api/start`, and `/api/leave`. Join accepts `{ "name": "Alice" }`. Other actions have no body. All responses disable caching, and modifying requests reject cross-site origins.

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
