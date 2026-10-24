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

## Next: Droplet deployment

Copy this app to `178.128.7.152`, install a supported Node.js version, run it as a dedicated unprivileged user under systemd, and allow inbound TCP 3000 while preserving SSH. Then verify `http://178.128.7.152:3000` from a phone on cellular data. Deployment has not been performed yet.
