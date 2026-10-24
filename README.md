# Avalon shared counter

A tiny shared counter using Node.js and plain browser JavaScript. No dependencies or build step.

## Run locally

Use Node.js 22 or newer:

```sh
npm start
```

Open http://localhost:3000 in two browser tabs. Click **Add one** in either tab; the other tab should update within about a second. Each click counts, including repeated clicks by the same person. Stop with Ctrl+C.

The total lives in one server process and resets to zero whenever the process restarts. Run only one instance. There are no accounts, rooms, roles, or persistent storage yet.

```sh
npm test
```

Tests cover shared reads, 50 simultaneous increments, fresh-server reset, asset routes, and unsupported requests.

## Configuration

The default listener is `0.0.0.0:3000`. Override it with environment variables:

```sh
HOST=127.0.0.1 PORT=3001 npm start
```

`GET /api/count` returns `{ "count": 0 }`; `POST /api/count` adds one and returns the new total. API responses are not cached. Browsers poll every second and reconnect automatically. Failed click requests are never automatically retried because the server may already have counted them.

## Deploy to the Droplet

With local Node.js, Git, rsync, and SSH available, commit your changes and run:

```sh
bash scripts/deploy.sh
```

The default target is the `avalon-droplet` SSH alias (root at `178.128.7.152`). An alternate target can be passed as the first argument. The script uses `~/.ssh/config`; override this with `AVALON_SSH_CONFIG` if needed.

Deployment requires a clean working tree, runs the tests, and transfers only the committed app and deployment files via rsync. Each release records its Git revision in `/opt/avalon/current/REVISION`. First-time setup installs an official Node.js 24 binary under `/opt/node`, verifies its published SHA-256 checksum, and creates an unprivileged `avalon` service user. Node.js is not automatically upgraded on subsequent deployments.

The systemd service starts on boot, restarts after crashes, and listens on port 3000. The script allows port 3000 and SSH port 22 if UFW is active; any DigitalOcean cloud firewall must also permit port 3000. Deployment checks the API locally on the Droplet and restores the previous release if that check fails. Previous release directories are retained under `/opt/avalon/releases`.

Open http://178.128.7.152:3000 and verify from a phone on cellular data. Every deployment restarts the app and resets the counter.

```sh
ssh -F ~/.ssh/config avalon-droplet 'systemctl status avalon --no-pager'
ssh -F ~/.ssh/config avalon-droplet 'journalctl -u avalon -n 50 --no-pager'
```
