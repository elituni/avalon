const count = document.querySelector('#count');
const button = document.querySelector('#increment');
const connection = document.querySelector('#connection');
const feedback = document.querySelector('#feedback');
let busy = false;
let timer;

async function request(method) {
  const response = await fetch('/api/count', { method, cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Request failed');
  const data = await response.json();
  if (!Number.isSafeInteger(data.count) || data.count < 0) throw new Error('Invalid count');
  count.textContent = data.count.toLocaleString();
  connection.textContent = 'Live';
  connection.dataset.state = 'live';
}

async function update(method = 'GET') {
  // Serialize polling and presses so an older response cannot overwrite a newer count.
  if (busy) return;
  clearTimeout(timer);
  busy = true;
  button.disabled = true;
  try {
    await request(method);
    if (method === 'POST') {
      feedback.textContent = 'Your press has been counted.';
      feedback.classList.remove('error');
    }
  } catch {
    connection.textContent = 'Reconnecting…';
    connection.dataset.state = 'offline';
    if (method === 'POST') {
      feedback.textContent = 'Could not confirm your press. It may have counted; check the total before trying again.';
      feedback.classList.add('error');
    }
  } finally {
    busy = false;
    button.disabled = connection.dataset.state !== 'live';
    timer = setTimeout(() => update(), 1000);
  }
}

button.addEventListener('click', () => update('POST'));
update();
