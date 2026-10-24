const $ = selector => document.querySelector(selector);
const form = $('#join-form');
const start = $('#start');
const leave = $('#leave');
const connection = $('#connection');
const feedback = $('#feedback');
let state;
let busy = false;
let timer;
let online = false;

function render() {
  if (!state) return;
  const joined = Boolean(state.me);
  const started = state.phase === 'started';
  $('#lobby-count').textContent = `${state.connectedCount} / 6 CONNECTED`;
  form.hidden = joined || started;
  $('#join').disabled = busy || !online || state.connectedCount >= 6;
  start.hidden = !joined || started;
  start.disabled = busy || !online || state.connectedCount !== 6;
  leave.hidden = !joined || started;
  leave.disabled = busy || !online;
  $('#players').replaceChildren(...state.players.map(player => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = player.name + (player.id === state.me?.id ? ' (you)' : '') + (player.id === state.hostId ? ' · Host' : '');
    const status = document.createElement('span');
    status.className = player.connected ? 'player-online' : 'player-offline';
    status.textContent = player.connected ? 'Connected' : 'Disconnected';
    row.append(name, status);
    if (!started && state.me?.id === state.hostId && player.id !== state.me.id) {
      const controls = document.createElement('div');
      controls.className = 'player-controls';
      for (const [label, endpoint] of [['Make host', '/api/host'], ['Kick', '/api/kick']]) {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'secondary';
        control.textContent = label;
        control.setAttribute('aria-label', `${label}: ${player.name}`);
        control.disabled = busy || !online || (endpoint === '/api/host' && !player.connected);
        control.addEventListener('click', () => update(endpoint, { playerId: player.id }));
        controls.append(control);
      }
      row.append(controls);
    }
    return row;
  }));
  $('#role-panel').hidden = !state.me?.role;
  $('#role').textContent = state.me?.role || '';
  $('#team').textContent = ['Morgana', 'Assassin'].includes(state.me?.role) ? 'You are on the Evil team.' : 'You are on the Resistance team.';
  $('#hint').textContent = started
    ? joined ? 'Roles assigned. The roster is locked.' : 'This game has started. The roster is locked.'
    : joined ? state.connectedCount === 6 ? 'Everyone is here. Any player can start.' : `Waiting for ${6 - state.connectedCount} more connected player${state.connectedCount === 5 ? '' : 's'}.`
    : state.kicked ? 'The host removed you from the lobby. You can join again if there is a seat.'
    : state.connectedCount === 6 ? 'The lobby is full.' : 'Enter your name to take a seat.';
}

async function request(path, body) {
  const response = await fetch(path, {
    method: path === '/api/state' ? 'GET' : 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', signal: AbortSignal.timeout(5000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

async function update(path = '/api/heartbeat', body) {
  if (busy) return;
  clearTimeout(timer);
  busy = true;
  render();
  const action = !['/api/heartbeat', '/api/state'].includes(path);
  try {
    state = await request(path, body);
    online = true;
    connection.textContent = 'Live';
    connection.dataset.state = 'live';
    if (action) feedback.textContent = '';
  } catch (error) {
    online = false;
    connection.textContent = 'Reconnecting…';
    connection.dataset.state = 'offline';
    if (action) feedback.textContent = `${error.message} Checking the latest game state…`;
  } finally {
    busy = false;
    render();
    timer = setTimeout(() => update(), 3000);
  }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  update('/api/join', { name: $('#name').value });
});
start.addEventListener('click', () => update('/api/start'));
leave.addEventListener('click', () => update('/api/leave'));
// No unload/leave request: closing one tab must not disconnect other tabs.
update('/api/state');
