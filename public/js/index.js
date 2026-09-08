import { initAuth, logout } from './auth.js';
import {
  api, jsonHeaders, starRow, tagChips, tagAddForm, spacer, wearSection,
  createTagFilter, createSortMenu,
} from './shared.js';

await initAuth();

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const detail = document.getElementById('detail');
const filterRating = document.getElementById('filterRating');
const filterArchived = document.getElementById('filterArchived');

const MAX_RATING = 10;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const MAX_UPLOAD = 20 * 1024 * 1024;

const state = { garments: [], tags: [] };
const tagFilter = createTagFilter(document.getElementById('tagFilter'), 'plagg', loadGarments);
const sortMenu = createSortMenu(document.getElementById('sortBy'), loadGarments);

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
detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); });

async function loadTags() {
  try {
    const { tags } = await api('/api/tags');
    state.tags = tags;
  } catch {
    /* not critical */
  }
  tagFilter.setTags(state.tags.map((t) => ({ name: t.name, count: t.garmentCount })));
}

async function loadGarments() {
  const params = new URLSearchParams();
  const { tags, match } = tagFilter.query();
  for (const t of tags) params.append('tag', t);
  if (match) params.set('match', match);
  params.set('sort', sortMenu.value());
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
    const { garment } = await api('/api/garments', { method: 'POST', headers: jsonHeaders(), body: '{}' });
    await refresh();
    openDetail(garment.id);
  } catch (err) {
    alert('Kunde inte skapa plagg: ' + err.message);
  }
}

async function patchGarment(id, patch) {
  const { garment } = await api('/api/garments/' + id, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch),
  });
  replaceInState(garment);
  return garment;
}

async function recordWear(id, date) {
  const { garment } = await api('/api/garments/' + id + '/wear', {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ date }),
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

  body.append(starRow(g.rating, MAX_RATING, (value) =>
    mutateDetail(() => patchGarment(g.id, { rating: value }))));

  body.append(wearSection(g, (date) => mutateDetail(() => recordWear(g.id, date))));

  body.append(tagChips(g.tags, (tag) =>
    mutateDetail(() => patchGarment(g.id, { tags: g.tags.filter((t) => t !== tag) }))));
  body.append(tagAddForm(g.tags, (name) =>
    mutateDetail(() => patchGarment(g.id, { tags: [...g.tags, name] }))));

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

await refresh();
