import { initAuth, authFetch, logout } from './auth.js';

await initAuth();

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const detail = document.getElementById('detail');
const filterRating = document.getElementById('filterRating');
const filterArchived = document.getElementById('filterArchived');
const tagFilterRow = document.getElementById('tagFilterRow');
const filterTagsBox = document.getElementById('filterTags');
const matchToggle = document.getElementById('matchToggle');

const MAX_RATING = 10;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const MAX_UPLOAD = 20 * 1024 * 1024;

const state = {
  garments: [],
  tags: [],
  filterTags: new Set(),
  match: 'any',
};

// rating filter options 1..10
for (let n = MAX_RATING; n >= 1; n--) {
  const opt = document.createElement('option');
  opt.value = String(n);
  opt.textContent = `${n} +`;
  filterRating.append(opt);
}

document.getElementById('logoutBtn').addEventListener('click', () => logout());
document.getElementById('newBtn').addEventListener('click', createGarment);
filterRating.addEventListener('change', loadGarments);
filterArchived.addEventListener('change', loadGarments);
matchToggle.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  state.match = b.dataset.match;
  matchToggle.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  loadGarments();
}));
detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); });

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
    state.tags = tags;
  } catch {
    /* not critical */
  }
  renderTagFilter();
}

function renderTagFilter() {
  // drop filters whose tag no longer exists
  const names = new Set(state.tags.map((t) => t.name));
  for (const t of [...state.filterTags]) if (!names.has(t)) state.filterTags.delete(t);

  filterTagsBox.replaceChildren(...state.tags.map((t) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip-toggle' + (state.filterTags.has(t.name) ? ' on' : '');
    chip.textContent = `${t.name} (${t.garmentCount})`;
    chip.addEventListener('click', () => {
      state.filterTags.has(t.name) ? state.filterTags.delete(t.name) : state.filterTags.add(t.name);
      renderTagFilter();
      loadGarments();
    });
    return chip;
  }));

  tagFilterRow.hidden = state.tags.length === 0;
  matchToggle.hidden = state.filterTags.size < 2;
}

async function loadGarments() {
  const params = new URLSearchParams();
  for (const t of state.filterTags) params.append('tag', t);
  if (state.filterTags.size >= 2) params.set('match', state.match);
  if (filterRating.value) params.set('rating', filterRating.value);
  params.set('archived', filterArchived.checked ? 'all' : 'false');
  try {
    const data = await api('/api/garments?' + params.toString());
    state.garments = data.garments;
    renderGrid();
    if (detail.open) refreshDetail();
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

function renderGrid() {
  empty.hidden = state.garments.length > 0;
  grid.replaceChildren(...state.garments.map(tileEl));
}

function tileEl(g) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (g.archived ? ' archived' : '');
  tile.addEventListener('click', () => openDetail(g.id));

  if (g.image) {
    const img = document.createElement('img');
    img.src = g.image.thumb.url;
    img.alt = '';
    img.loading = 'lazy';
    tile.append(img);
  } else {
    tile.append(document.createTextNode('Ingen bild'));
  }
  if (g.rating != null) {
    const badge = document.createElement('span');
    badge.className = 'tile-badge';
    badge.textContent = '★ ' + g.rating;
    tile.append(badge);
  }
  return tile;
}

async function createGarment() {
  try {
    const { garment } = await api('/api/garments', { method: 'POST', headers: json(), body: '{}' });
    await refresh();
    openDetail(garment.id);
  } catch (err) {
    alert('Kunde inte skapa plagg: ' + err.message);
  }
}

async function patchGarment(id, patch) {
  const { garment } = await api('/api/garments/' + id, {
    method: 'PATCH', headers: json(), body: JSON.stringify(patch),
  });
  replaceInState(garment);
  return garment;
}

function replaceInState(garment) {
  const i = state.garments.findIndex((g) => g.id === garment.id);
  if (i >= 0) state.garments[i] = garment;
}

async function removeGarment(id) {
  if (!confirm('Ta bort plagget?')) return;
  try {
    await api('/api/garments/' + id, { method: 'DELETE' });
    detail.close();
    await refresh();
  } catch (err) {
    alert('Kunde inte ta bort: ' + err.message);
  }
}

// ---- detail dialog ----

let detailId = null;

function openDetail(id) {
  detailId = id;
  renderDetail();
  if (!detail.open) detail.showModal();
}

function refreshDetail() {
  if (detailId && state.garments.some((g) => g.id === detailId)) renderDetail();
  else detail.close();
}

function currentGarment() {
  return state.garments.find((g) => g.id === detailId);
}

async function mutateDetail(fn) {
  try {
    await fn();
    renderGrid();
    renderDetail();
  } catch (err) {
    alert(err.message);
  }
}

function renderDetail() {
  const g = currentGarment();
  if (!g) return;

  const photo = document.createElement('label');
  photo.className = 'detail-photo';
  photo.title = g.image ? 'Byt bild' : 'Lägg till bild';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = ACCEPT;
  file.hidden = true;
  file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; uploadImage(g.id, f, photo); });
  photo.append(file);
  if (g.image) {
    const img = document.createElement('img');
    img.src = g.image.card.url;
    img.alt = '';
    photo.append(img);
  } else {
    photo.append(document.createTextNode('Klicka för att lägga till bild'));
  }

  const body = document.createElement('div');
  body.className = 'detail-body';

  const head = document.createElement('div');
  head.className = 'detail-head';
  const title = document.createElement('strong');
  title.textContent = 'Plagg';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary btn-sm';
  closeBtn.textContent = 'Stäng';
  closeBtn.addEventListener('click', () => detail.close());
  head.append(title, spacer(), closeBtn);
  body.append(head);

  // rating 1..10
  const stars = document.createElement('div');
  stars.className = 'stars';
  for (let n = 1; n <= MAX_RATING; n++) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'star' + (g.rating >= n ? ' on' : '');
    s.textContent = '★';
    s.title = `${n} av ${MAX_RATING}`;
    s.addEventListener('click', () => mutateDetail(() =>
      patchGarment(g.id, { rating: g.rating === n ? null : n })));
    stars.append(s);
  }
  if (g.rating != null) {
    const clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'rating-clear';
    clr.textContent = 'nollställ';
    clr.addEventListener('click', () => mutateDetail(() => patchGarment(g.id, { rating: null })));
    stars.append(clr);
  }
  body.append(stars);

  // tags
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
    x.addEventListener('click', () => mutateDetail(() =>
      patchGarment(g.id, { tags: g.tags.filter((t) => t !== tag) })));
    chip.append(x);
    chips.append(chip);
  }
  body.append(chips);

  // add-tag form (submit works with the mobile keyboard's Enter/Go)
  const form = document.createElement('form');
  form.className = 'tag-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Lägg till tagg';
  input.setAttribute('enterkeyhint', 'done');
  input.autocapitalize = 'none';
  input.autocomplete = 'off';
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'btn btn-secondary btn-sm';
  addBtn.textContent = 'Lägg till';
  form.append(input, addBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    input.value = '';
    if (!name || g.tags.some((t) => t.toLowerCase() === name.toLowerCase())) return;
    mutateDetail(() => patchGarment(g.id, { tags: [...g.tags, name] }));
  });
  body.append(form);

  // notes
  const notes = document.createElement('textarea');
  notes.className = 'notes';
  notes.placeholder = 'Anteckningar…';
  notes.value = g.notes || '';
  notes.addEventListener('blur', async () => {
    const value = notes.value.trim() || null;
    if (value === (g.notes || null)) return;
    try {
      await patchGarment(g.id, { notes: value });
      renderGrid();
    } catch (err) {
      alert('Kunde inte spara anteckning: ' + err.message);
    }
  });
  body.append(notes);

  // actions
  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  const arch = document.createElement('button');
  arch.type = 'button';
  arch.className = 'btn btn-secondary btn-sm';
  arch.textContent = g.archived ? 'Återställ' : 'Arkivera';
  arch.addEventListener('click', () => mutateDetail(() => patchGarment(g.id, { archived: !g.archived })));
  actions.append(arch);
  if (g.image) {
    const rmImg = document.createElement('button');
    rmImg.type = 'button';
    rmImg.className = 'btn btn-secondary btn-sm';
    rmImg.textContent = 'Ta bort bild';
    rmImg.addEventListener('click', () => removeImage(g.id));
    actions.append(rmImg);
  }
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn-danger btn-sm';
  del.textContent = 'Ta bort plagg';
  del.addEventListener('click', () => removeGarment(g.id));
  actions.append(del);
  body.append(actions);

  detail.replaceChildren(photo, body);
}

// ---- image upload ----

async function uploadImage(id, fileObj, photoNode) {
  if (!fileObj) return;
  if (fileObj.size > MAX_UPLOAD) {
    alert('Bilden är för stor (max 20 MB).');
    return;
  }
  const form = new FormData();
  form.append('image', fileObj);
  photoNode.classList.add('busy');
  try {
    const { garment } = await api('/api/garments/' + id + '/image', { method: 'PUT', body: form });
    replaceInState(garment);
    renderGrid();
    renderDetail();
  } catch (err) {
    photoNode.classList.remove('busy');
    alert('Kunde inte ladda upp bild: ' + err.message);
  }
}

async function removeImage(id) {
  if (!confirm('Ta bort bilden?')) return;
  await mutateDetail(async () => {
    const { garment } = await api('/api/garments/' + id + '/image', { method: 'DELETE' });
    replaceInState(garment);
  });
}

// ---- helpers ----

function spacer() {
  const s = document.createElement('span');
  s.className = 'spacer';
  return s;
}

function json() {
  return { 'Content-Type': 'application/json' };
}

await refresh();
