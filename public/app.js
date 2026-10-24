import { ROLE_INFO, preset, totals, validateConfig } from '/roles.js';

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
let editorKey;
let savedConfig;

function readDraft() {
  return { mode: $('#mode').value, counts: Object.fromEntries(Object.keys(ROLE_INFO).map(role => [role, Number(document.getElementById(`role-${role}`).value)])) };
}
function fillEditor(config) {
  $('#mode').value = config.mode;
  $('#role-inputs').replaceChildren(...Object.entries(ROLE_INFO).map(([role, info]) => {
    const row = document.createElement('div');
    row.className = 'role-input-row';
    const label = document.createElement('label');
    label.htmlFor = `role-${role}`;
    label.textContent = `${role} · ${info.team}`;
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '15'; input.step = '1'; input.required = true;
    input.id = `role-${role}`; input.value = config.counts[role];
    const description = document.createElement('p');
    description.className = 'footnote'; description.textContent = info.description;
    row.append(label, input, description);
    return row;
  }));
}
function validateDraft() {
  if (!state || $('#setup-form').hidden) return;
  const draft = readDraft();
  const error = validateConfig(draft);
  const counts = totals(draft);
  const overcrowded = counts.total < state.players.length;
  const dirty = JSON.stringify(draft) !== savedConfig;
  $('#setup-validation').textContent = error || (overcrowded ? 'Remove players before reducing the number of seats.' : `${counts.total} seats · ${counts.Good} Good / ${counts.Evil} Evil${dirty ? ' · Unsaved changes' : ' · Saved'}`);
  $('#save-setup').disabled = busy || !online || !dirty || Boolean(error) || overcrowded;
  if (dirty) start.disabled = true;
}
function renderSetup(started) {
  const counts = totals(state.config);
  $('#setup-summary').textContent = `${state.config.mode === 'custom' ? 'Custom rules' : 'Standard setup'} · ${counts.total} players · ${counts.Good} Good / ${counts.Evil} Evil`;
  $('#setup-roles').textContent = Object.entries(state.config.counts).filter(([, n]) => n).map(([role, n]) => `${n} ${role}`).join(' · ');
  const host = state.me?.id === state.hostId;
  $('#setup-form').hidden = !host || started;
  const key = JSON.stringify([state.hostId, state.config]);
  if (key !== editorKey) {
    fillEditor(state.config);
    savedConfig = JSON.stringify(readDraft());
    editorKey = key;
    $('#preset').value = '';
  }
  for (const input of $('#setup-form').querySelectorAll('input, select')) input.disabled = busy || !online;
  validateDraft();
}

function render() {
  if (!state) return;
  const joined = Boolean(state.me);
  const started = state.phase === 'started';
  $('#lobby-count').textContent = `${state.connectedCount} / ${state.capacity} CONNECTED`;
  form.hidden = joined || started;
  $('#join').disabled = busy || !online || state.connectedCount >= state.capacity;
  start.hidden = !joined || started;
  start.disabled = busy || !online || state.connectedCount !== state.capacity;
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
  $('#team').textContent = state.me?.team ? `You are on the ${state.me.team} team.` : '';
  $('#role-description').textContent = ROLE_INFO[state.me?.role]?.description || '';
  const information = state.me?.information;
  $('#information-heading').textContent = information?.heading || '';
  $('#information-explanation').textContent = information?.explanation || '';
  $('#information-players').replaceChildren(...(information?.players || []).map(player => {
    const row = document.createElement('li');
    row.textContent = player.name;
    return row;
  }));
  if (information && information.players.length === 0) {
    const row = document.createElement('li'); row.textContent = 'No players revealed.';
    $('#information-players').append(row);
  }
  $('#hint').textContent = started
    ? joined ? 'Roles assigned. The roster is locked.' : 'This game has started. The roster is locked.'
    : joined ? state.connectedCount === state.capacity ? 'Everyone is here. Any player can start.' : `Waiting for ${state.capacity - state.connectedCount} more connected player${state.connectedCount === state.capacity - 1 ? '' : 's'}.`
    : state.kicked ? 'The host removed you from the lobby. You can join again if there is a seat.'
    : state.connectedCount === state.capacity ? 'The lobby is full.' : 'Enter your name to take a seat.';
  renderSetup(started);
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
$('#setup-form').addEventListener('input', () => {
  start.disabled = busy || !online || state.connectedCount !== state.capacity;
  validateDraft();
});
$('#preset').addEventListener('change', () => {
  if ($('#preset').value) fillEditor(preset(Number($('#preset').value)));
  validateDraft();
});
$('#setup-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!validateConfig(readDraft())) update('/api/config', readDraft());
});
form.addEventListener('submit', event => {
  event.preventDefault();
  update('/api/join', { name: $('#name').value });
});
start.addEventListener('click', () => update('/api/start'));
leave.addEventListener('click', () => update('/api/leave'));
// No unload/leave request: closing one tab must not disconnect other tabs.
update('/api/state');
