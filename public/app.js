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
let informationVisible = false;
let privateIdentity;

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
    label.textContent = role;
    row.dataset.team = info.team;
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '15'; input.step = '1'; input.required = true;
    input.id = `role-${role}`; input.value = config.counts[role];
    row.append(label, input);
    return row;
  }));
}
function validateDraft() {
  if (!state || $('#setup-form').hidden) return;
  const draft = readDraft();
  const error = validateConfig(draft);
  const counts = totals(draft);
  const overcrowded = !state.demo && counts.total < state.players.length;
  const dirty = JSON.stringify(draft) !== savedConfig;
  $('#setup-validation').textContent = error || (overcrowded ? 'Remove players to reduce seats.' : `${counts.total} seats · ${counts.Resistance} Resistance / ${counts.Spy} Spy${dirty ? ' · Unsaved' : ' · Saved'}`);
  $('#save-setup').disabled = busy || !online || !dirty || Boolean(error) || overcrowded;
  if (dirty) start.disabled = true;
}
function renderSetup(started) {
  const counts = totals(state.config);
  $('#setup-summary').textContent = `${state.demo ? 'Demo' : state.config.mode === 'custom' ? 'Custom' : 'Standard'} · ${counts.Resistance} Resistance / ${counts.Spy} Spy`;
  $('#setup-roles').replaceChildren(...Object.entries(state.config.counts).filter(([, n]) => n).map(([role, n]) => {
    const chip = document.createElement('span'); chip.className = 'role-chip'; chip.dataset.team = ROLE_INFO[role].team;
    const amount = document.createElement('b'); amount.textContent = `×${n}`;
    chip.append(role, amount);
    return chip;
  }));
  const host = state.me?.id === state.hostId;
  $('#setup-form').hidden = !host || started;
  $('#setup-editor').hidden = !host || started;
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
  const identity = state.me?.role ? `${state.me.id}:${state.me.role}` : null;
  if (identity !== privateIdentity) {
    privateIdentity = identity;
    informationVisible = false;
  }
  $('#lobby-count').textContent = `${state.connectedCount} / ${state.capacity} online`;
  form.hidden = joined || started;
  if (state.demo && !joined && !$('#name').value) $('#name').value = 'laze';
  $('#join').disabled = busy || !online || state.connectedCount >= state.capacity;
  start.hidden = !joined || started;
  start.disabled = busy || !online || state.connectedCount !== state.capacity;
  leave.hidden = !joined || started;
  leave.disabled = busy || !online;
  const knowsSpy = informationVisible && (state.me?.role === 'Merlin' || state.me?.team === 'Spy');
  const knownSpy = new Set(knowsSpy ? (state.me.information?.players || []).map(player => player.id) : []);
  const merlinCandidates = new Set(informationVisible && state.me?.role === 'Percival' ? (state.me.information?.players || []).map(player => player.id) : []);
  const seats = Array.from({ length: state.capacity }, (_, index) => {
    const player = state.players[index];
    const row = document.createElement('li');
    const number = document.createElement('span'); number.className = 'seat-number'; number.textContent = String(index + 1).padStart(2, '0');
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'player-name';
    row.append(number, avatar, name);
    if (!player) {
      row.className = 'empty-seat'; avatar.textContent = '+'; name.textContent = 'Open seat';
      return row;
    }
    row.classList.toggle('is-me', player.id === state.me?.id);
    row.classList.toggle('known-spy', knownSpy.has(player.id));
    row.classList.toggle('merlin-candidate', merlinCandidates.has(player.id));
    avatar.textContent = player.name.split(/\s+/).map(part => Array.from(part)[0]).slice(0, 2).join('').toUpperCase();
    name.textContent = player.name + (player.id === state.me?.id ? ' (you)' : '');
    const meta = document.createElement('div'); meta.className = 'player-meta';
    const status = document.createElement('span');
    status.className = player.connected ? 'player-online' : 'player-offline';
    status.textContent = player.connected ? 'Online' : 'Offline';
    meta.append(status);
    if (player.id === state.hostId) {
      const badge = document.createElement('span'); badge.className = 'host-badge'; badge.textContent = 'Host'; meta.append(badge);
    }
    if (knownSpy.has(player.id)) {
      const badge = document.createElement('span'); badge.className = 'spy-badge'; badge.textContent = 'Spy'; meta.append(badge);
    }
    if (merlinCandidates.has(player.id)) {
      const badge = document.createElement('span'); badge.className = 'merlin-badge'; badge.textContent = 'merlin?'; meta.append(badge);
    }
    row.append(meta);
    if (!state.demo && !started && state.me?.id === state.hostId && player.id !== state.me.id) {
      const controls = document.createElement('div'); controls.className = 'player-controls';
      for (const [label, endpoint] of [['Make host', '/api/host'], ['Kick', '/api/kick']]) {
        const control = document.createElement('button');
        control.type = 'button'; control.className = endpoint === '/api/kick' ? 'secondary kick' : 'secondary'; control.textContent = label;
        control.setAttribute('aria-label', `${label}: ${player.name}`);
        control.disabled = busy || !online || (endpoint === '/api/host' && !player.connected);
        control.addEventListener('click', () => update(endpoint, { playerId: player.id }));
        controls.append(control);
      }
      row.append(controls);
    }
    return row;
  });
  $('#players').replaceChildren(...seats);
  $('#role-panel').hidden = !state.me?.role;
  $('#role-panel').dataset.team = informationVisible ? state.me?.team || '' : '';
  $('#role').textContent = informationVisible ? state.me?.role || '??' : '??';
  $('#role-toggle').setAttribute('aria-expanded', String(informationVisible));
  $('#role-toggle-hint').textContent = informationVisible ? 'Hide' : 'Show';
  $('#role-content').hidden = !informationVisible;
  if (!informationVisible) $('.role-help').open = false;
  $('#team').textContent = informationVisible && state.me?.team ? `${state.me.team} team` : '';
  $('#role-description').textContent = informationVisible ? ROLE_INFO[state.me?.role]?.description || '' : '';
  const information = informationVisible ? state.me?.information : null;
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
    ? joined ? 'Game started' : 'Game in progress'
    : joined ? state.connectedCount === state.capacity ? 'Ready to start' : `Waiting for ${state.capacity - state.connectedCount} player${state.connectedCount === state.capacity - 1 ? '' : 's'}`
    : state.kicked ? 'Removed by host. Join again if a seat is open.'
    : state.connectedCount === state.capacity ? 'Table full' : 'Join to take a seat';
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
    if (action) feedback.textContent = error.message;
  } finally {
    busy = false;
    render();
    timer = setTimeout(() => update(), 3000);
  }
}
$('#role-toggle').addEventListener('click', () => {
  if (!state?.me?.role) return;
  informationVisible = !informationVisible;
  render();
});
$('#setup-form').addEventListener('input', event => {
  if (event.target.closest('#role-inputs')) $('#mode').value = 'custom';
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
$('#role-guide').replaceChildren(...Object.entries(ROLE_INFO).flatMap(([role, info]) => {
  const term = document.createElement('dt'); term.textContent = `${role} · ${info.team}`;
  const description = document.createElement('dd'); description.textContent = info.description;
  return [term, description];
}));
// No unload/leave request: closing one tab must not disconnect other tabs.
update('/api/state');
