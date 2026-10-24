import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ROLE_INFO, preset, totals, validateConfig } from './public/roles.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/roles.js', ['roles.js', 'text/javascript; charset=utf-8']],
].map(([route, [file, type]]) => [route, {
  body: readFileSync(new URL(`./public/${file}`, import.meta.url)), type,
}]));
export function startingInformation(me, players) {
  if (!me.role) return null;
  let visible = [];
  let heading = 'No players revealed';
  let explanation = 'Your role gives you no information about other players.';
  if (me.role === 'Merlin') {
    visible = players.filter(p => ROLE_INFO[p.role].team === 'Evil' && p.role !== 'Mordred');
    heading = 'Known Evil players';
    explanation = 'Mordred is hidden from you. These players are Evil; their exact roles are not revealed.';
  } else if (me.role === 'Percival') {
    visible = players.filter(p => p.role === 'Merlin' || p.role === 'Morgana');
    heading = 'Possible Merlins';
    explanation = 'These players are Merlin or Morgana. You cannot tell their roles apart from this reveal.';
    if (!visible.some(p => p.role === 'Morgana')) {
      heading = 'Merlin';
      explanation = 'No Morgana is in this game, so every revealed player is Merlin.';
    } else if (!visible.some(p => p.role === 'Merlin')) {
      heading = 'Morgana';
      explanation = 'No Merlin is in this custom setup, so every revealed player is Morgana.';
    }
  } else if (me.role === 'Oberon') {
    explanation = 'You are Evil, but you do not see your teammates and they do not see you. Merlin can see you.';
  } else if (ROLE_INFO[me.role].team === 'Evil') {
    visible = players.filter(p => p.id !== me.id && ROLE_INFO[p.role].team === 'Evil' && p.role !== 'Oberon');
    heading = 'Known Evil teammates';
    explanation = 'Oberon is hidden from your team. Exact teammate roles are not revealed.';
  }
  // Preserve public seat order, never group or sort candidates by their hidden roles.
  return { heading, explanation, players: visible.map(p => ({ id: p.id, name: p.name })) };
}

export function createGameServer({ now = Date.now, graceMs = 15000, demo = false } = {}) {
  const players = new Map();
  if (demo) {
    for (let i = 1; i <= 4; i++) {
      players.set(randomBytes(32).toString('hex'), { id: randomUUID(), name: `NPC ${i}`, npc: true, lastSeen: now() });
    }
  }
  let phase = 'lobby';
  let config = preset(demo ? 5 : 6);
  let hostId = null;
  const kicked = new Set();
  const connected = player => player.npc || now() - player.lastSeen < graceMs;
  const updateHost = () => {
    if (phase !== 'lobby') return;
    const current = [...players.values()].find(p => p.id === hostId);
    if (!current || !connected(current)) {
      hostId = [...players.values()].find(p => !p.npc && connected(p))?.id ?? null;
    }
  };
  const snapshot = token => {
    updateHost();
    const me = players.get(token);
    return {
      phase,
      demo,
      config,
      capacity: totals(config).total,
      hostId,
      kicked: kicked.has(token),
      connectedCount: [...players.values()].filter(connected).length,
      players: [...players.values()].map(p => ({ id: p.id, name: p.name, connected: connected(p) })),
      me: me ? { id: me.id, name: me.name, role: me.role ?? null, team: me.role ? ROLE_INFO[me.role].team : null, information: startingInformation(me, [...players.values()]) } : null,
    };
  };
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const path = req.url.split('?')[0];
      if (path === '/api/health' && req.method === 'GET') return send(200, { ok: true });
      if (path.startsWith('/api/')) {
        const methods = { '/api/state': 'GET', '/api/join': 'POST', '/api/heartbeat': 'POST', '/api/start': 'POST', '/api/leave': 'POST', '/api/host': 'POST', '/api/kick': 'POST', '/api/config': 'POST' };
        if (!methods[path]) return send(404, { error: 'Not found' });
        if (req.method !== methods[path]) {
          res.setHeader('Allow', methods[path]);
          return send(405, { error: 'Method not allowed' });
        }
        if (req.method === 'POST' && (req.headers['sec-fetch-site'] === 'cross-site' ||
            (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))) {
          return send(403, { error: 'Use the game page to perform this action.' });
        }
        let token = /(?:^|;\s*)avalon_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
        if (!token) {
          token = randomBytes(32).toString('hex');
          res.setHeader('Set-Cookie', `avalon_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 2048) return send(413, { error: 'Request too large' });
        }
        updateHost();
        const me = players.get(token);
        if (path === '/api/join') {
          if (me) {
            me.lastSeen = now();
            return send(200, snapshot(token));
          }
          if (phase !== 'lobby') return send(409, { error: 'This game has already started.' });
          let data;
          try { data = JSON.parse(body); } catch { return send(400, { error: 'Enter a display name.' }); }
          const name = typeof data?.name === 'string' ? data.name.trim().replace(/\s+/g, ' ') : '';
          if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) return send(400, { error: 'Use a name between 1 and 24 characters.' });
          if (demo && name.toLowerCase() !== 'laze') return send(400, { error: 'Join as laze for this Percival demo.' });
          // Disconnected seats may be reclaimed before the game starts.
          for (const [key, p] of players) if (!connected(p)) players.delete(key);
          if (players.size >= totals(config).total) return send(409, { error: 'The lobby is full.' });
          if ([...players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return send(409, { error: 'That name is already taken.' });
          players.set(token, { id: randomUUID(), name, lastSeen: now() });
          kicked.delete(token);
        }
        if (path === '/api/heartbeat') {
          if (me) me.lastSeen = now();
        }
        if (path === '/api/leave') {
          if (phase !== 'lobby') return send(409, { error: 'The roster is locked for this game.' });
          players.delete(token);
        }
        if (path === '/api/host' || path === '/api/kick') {
          if (!me || me.id !== hostId) return send(403, { error: 'Only the host can manage players.' });
          if (demo) return send(409, { error: 'NPC seats are fixed for this demo.' });
          if (phase !== 'lobby') return send(409, { error: 'The roster is locked for this game.' });
          let data;
          try { data = JSON.parse(body); } catch { return send(400, { error: 'Choose a player.' }); }
          const target = [...players.entries()].find(([, p]) => p.id === data?.playerId);
          if (!target) return send(404, { error: 'That player is no longer in the lobby.' });
          const [targetToken, player] = target;
          if (player.id === me.id) return send(400, { error: 'Choose another player. Use Leave lobby to leave.' });
          if (path === '/api/host') {
            if (!connected(player)) return send(409, { error: 'Choose a connected player to host.' });
            hostId = player.id;
          } else {
            players.delete(targetToken);
            kicked.add(targetToken);
          }
        }
        if (path === '/api/config') {
          if (!me || me.id !== hostId) return send(403, { error: 'Only the host can change the role setup.' });
          if (demo) return send(409, { error: 'This demo uses five players with laze as Percival.' });
          if (phase !== 'lobby') return send(409, { error: 'Role setup is locked after the game starts.' });
          let proposed;
          try { proposed = JSON.parse(body); } catch { return send(400, { error: 'Invalid role setup.' }); }
          const error = validateConfig(proposed);
          if (error) return send(400, { error });
          if (totals(proposed).total < players.size) return send(409, { error: 'There are more players in the lobby than seats in this setup. Remove players first.' });
          config = { mode: proposed.mode, counts: { ...proposed.counts } };
        }
        if (path === '/api/start') {
          if (!me) return send(403, { error: 'Join the lobby first.' });
          if (phase !== 'lobby') return send(409, { error: 'The game has already started.' });
          if (players.size !== totals(config).total || [...players.values()].some(p => !connected(p))) return send(409, { error: `Exactly ${totals(config).total} connected players are needed.` });
          const shuffled = Object.entries(config.counts).flatMap(([role, count]) => Array(count).fill(role));
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          [...players.values()].forEach((p, i) => { p.role = shuffled[i]; });
          if (demo) {
            const laze = [...players.values()].find(p => !p.npc && p.name.toLowerCase() === 'laze');
            const percival = [...players.values()].find(p => p.role === 'Percival');
            [laze.role, percival.role] = [percival.role, laze.role];
          }
          phase = 'started';
        }
        return send(200, snapshot(token));
      }
      const asset = assets.get(path);
      if (!asset) return send(404, { error: 'Not found' });
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return send(405, { error: 'Method not allowed' });
      }
      res.writeHead(200, { 'Content-Type': asset.type });
      res.end(req.method === 'HEAD' ? undefined : asset.body);
    } catch {
      if (!res.headersSent) send(400, { error: 'Could not process request.' });
      else res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createGameServer({ demo: process.env.AVALON_DEMO === '1' });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Avalon: http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
