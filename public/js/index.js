import { initAuth, authFetch, logout } from './auth.js';

await initAuth();

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const tagList = document.getElementById('tagList');
const filterTag = document.getElementById('filterTag');
const filterRating = document.getElementById('filterRating');
const filterArchived = document.getElementById('filterArchived');

document.getElementById('logoutBtn').addEventListener('click', () => logout());
document.getElementById('newBtn').addEventListener('click', createGarment);
filterRating.addEventListener('change', loadGarments);
filterArchived.addEventListener('change', loadGarments);
filterTag.addEventListener('input', debounce(loadGarments, 300));

let garments = [];

async function api(url, options) {
  const res = await authFetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

async function loadTags() {
  try {
    const { tags } = await api('/api/tags');
    tagList.replaceChildren(...tags.map((t) => {
      const opt = document.createElement('option');
      opt.value = t.name;
      return opt;
    }));
  } catch {
    /* taggförslag är inte kritiska */
  }
}

async function loadGarments() {
  const params = new URLSearchParams();
  if (filterTag.value.trim()) params.set('tag', filterTag.value.trim());
  if (filterRating.value) params.set('rating', filterRating.value);
  params.set('archived', filterArchived.checked ? 'all' : 'false');
  try {
    const data = await api('/api/garments?' + params.toString());
    garments = data.garments;
    render();
  } catch (err) {
    empty.hidden = true;
    const msg = document.createElement('p');
    msg.className = 'muted';
    msg.textContent = 'Kunde inte ladda plagg: ' + err.message;
    grid.replaceChildren(msg);
  }
}

async function refresh() {
  await Promise.all([loadGarments(), loadTags()]);
}

async function createGarment() {
  try {
    await api('/api/garments', { method: 'POST', headers: json(), body: '{}' });
    await refresh();
  } catch (err) {
    alert('Kunde inte skapa plagg: ' + err.message);
  }
}

async function patchGarment(id, patch) {
  const { garment } = await api('/api/garments/' + id, {
    method: 'PATCH', headers: json(), body: JSON.stringify(patch),
  });
  const i = garments.findIndex((g) => g.id === id);
  if (i >= 0) garments[i] = garment;
  return garment;
}

async function removeGarment(id) {
  if (!confirm('Ta bort plagget?')) return;
  try {
    await api('/api/garments/' + id, { method: 'DELETE' });
    await refresh();
  } catch (err) {
    alert('Kunde inte ta bort: ' + err.message);
  }
}

function render() {
  empty.hidden = garments.length > 0;
  grid.replaceChildren(...garments.map(cardEl));
}

function cardEl(g) {
  const card = document.createElement('div');
  card.className = 'card' + (g.archived ? ' archived' : '');

  const photo = document.createElement('div');
  photo.className = 'photo';
  photo.textContent = 'Bilduppladdning kommer i Fas 5';
  card.append(photo);

  const body = document.createElement('div');
  body.className = 'card-body';

  const stars = document.createElement('div');
  stars.className = 'stars';
  for (let n = 1; n <= 5; n++) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'star' + (g.rating >= n ? ' on' : '');
    s.textContent = '★';
    s.title = n + ' av 5';
    s.addEventListener('click', () => mutate(() =>
      patchGarment(g.id, { rating: g.rating === n ? null : n })));
    stars.append(s);
  }
  body.append(stars);

  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const tag of g.tags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(document.createTextNode(tag));
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Ta bort tagg';
    x.addEventListener('click', () => mutate(() =>
      patchGarment(g.id, { tags: g.tags.filter((t) => t !== tag) })));
    chip.append(x);
    chips.append(chip);
  }
  body.append(chips);

  const tagAdd = document.createElement('input');
  tagAdd.type = 'text';
  tagAdd.className = 'tag-add';
  tagAdd.placeholder = '+ tagg, Enter';
  tagAdd.setAttribute('list', 'tagList');
  tagAdd.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = tagAdd.value.trim();
    tagAdd.value = '';
    if (!name || g.tags.some((t) => t.toLowerCase() === name.toLowerCase())) return;
    mutate(() => patchGarment(g.id, { tags: [...g.tags, name] }));
  });
  body.append(tagAdd);

  const notes = document.createElement('textarea');
  notes.className = 'notes';
  notes.placeholder = 'Anteckningar…';
  notes.value = g.notes || '';
  notes.addEventListener('blur', async () => {
    const value = notes.value.trim() || null;
    if (value === (g.notes || null)) return;
    try {
      await patchGarment(g.id, { notes: value });
    } catch (err) {
      alert('Kunde inte spara anteckning: ' + err.message);
    }
  });
  body.append(notes);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const arch = document.createElement('button');
  arch.type = 'button';
  arch.className = 'btn btn-secondary btn-sm';
  arch.textContent = g.archived ? 'Återställ' : 'Arkivera';
  arch.addEventListener('click', () => mutate(() =>
    patchGarment(g.id, { archived: !g.archived })));
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn-danger btn-sm';
  del.textContent = 'Ta bort';
  del.addEventListener('click', () => removeGarment(g.id));
  actions.append(arch, del);
  body.append(actions);

  card.append(body);
  return card;
}

// Run an API mutation, then reload list + tags (so filters and counts stay right).
async function mutate(fn) {
  try {
    await fn();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

function json() {
  return { 'Content-Type': 'application/json' };
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

await refresh();
