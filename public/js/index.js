import { initAuth, logout } from './auth.js';
import {
  api, jsonHeaders, starRow, tagChips, tagAddForm, spacer, wearSection,
  createTagFilter, createSortMenu, detailPhoto, uploadImageFile,
  ownerId, isVisiting, scoped, navHref, ratingBadgeText, ratingSummary, markTagUsed,
  initFriendsNav, attachPeek, createBulkTagBar,
} from './shared.js';

await initAuth();

const OWNER = ownerId();
const VISITING = isVisiting();

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const detail = document.getElementById('detail');
const filterRating = document.getElementById('filterRating');
const filterArchived = document.getElementById('filterArchived');
const newBtn = document.getElementById('newBtn');
const bulkBtn = document.getElementById('bulkBtn');

const MAX_RATING = 10;

const state = { garments: [], tags: [] };
let bulkMode = false;
const bulkSelected = new Set();
const tagFilter = createTagFilter(document.getElementById('tagFilter'), 'plagg', loadGarments);
const sortMenu = createSortMenu(document.getElementById('sortBy'), loadGarments);

for (let n = MAX_RATING; n >= 1; n--) {
  const opt = document.createElement('option');
  opt.value = String(n);
  opt.textContent = `${n} +`;
  filterRating.append(opt);
}

if (VISITING) {
  newBtn.textContent = '+ Föreslå plagg';
  filterArchived.closest('label').hidden = true;
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.getAttribute('href') === '/') a.href = navHref('/');
    if (a.getAttribute('href') === '/outfits.html') a.href = navHref('/outfits.html');
  }
  setupBanner();
}

document.getElementById('logoutBtn').addEventListener('click', () => logout());
newBtn.addEventListener('click', createGarment);
filterRating.addEventListener('change', loadGarments);
filterArchived.addEventListener('change', loadGarments);
detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); });

// ---- bulk tagging ----

const bulkBar = createBulkTagBar({
  onArm: (armed) => grid.classList.toggle('bulk-armed', armed),
  onSave: async (name) => {
    const ids = [...bulkSelected];
    if (ids.length === 0) {
      alert('Kryssa i minst ett plagg först.');
      return;
    }
    try {
      const { count } = await api(scoped('/api/garments/bulk-tag'), {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name, ids }),
      });
      markTagUsed(name);
      exitBulk();
      await refresh();
      alert(`Taggen "${name}" lades på ${count} plagg.`);
    } catch (err) {
      alert(err.message);
    }
  },
  onCancel: () => exitBulk(),
});
document.querySelector('.toolbar').append(bulkBar.el);
bulkBtn.addEventListener('click', () => {
  bulkMode = true;
  bulkSelected.clear();
  bulkBar.open(state.tags.map((t) => t.name));
  bulkBar.setCount(0);
  bulkBtn.hidden = true;
  renderGrid();
});

function exitBulk() {
  bulkMode = false;
  bulkSelected.clear();
  bulkBar.close();
  bulkBtn.hidden = false;
  grid.classList.remove('bulk-armed');
  renderGrid();
}

async function setupBanner() {
  const banner = document.getElementById('visitBanner');
  let name = 'en vän';
  try {
    const { friends } = await api('/api/friends');
    const f = (friends || []).find((x) => x.userId === OWNER);
    if (f) name = f.displayName;
  } catch { /* fall back to generic */ }
  banner.querySelector('.vb-text').textContent = `Du är på besök hos ${name}`;
  banner.hidden = false;
}

async function loadTags() {
  try {
    const { tags } = await api(scoped('/api/tags'));
    state.tags = tags;
  } catch {
    /* not critical */
  }
  tagFilter.setTags(state.tags.map((t) => ({ name: t.name, count: t.garmentCount, createdAt: t.createdAt })));
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
    const data = await api(scoped('/api/garments?' + params.toString()));
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
  grid.classList.toggle('bulk', bulkMode);
  grid.replaceChildren(...state.garments.map(tileEl));
}

function tileEl(g) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (g.archived ? ' archived' : '')
    + (bulkMode && bulkSelected.has(g.id) ? ' bulk-selected' : '');
  tile.addEventListener('click', () => {
    if (bulkMode) {
      if (bulkSelected.has(g.id)) bulkSelected.delete(g.id);
      else bulkSelected.add(g.id);
      tile.classList.toggle('bulk-selected', bulkSelected.has(g.id));
      bulkBar.setCount(bulkSelected.size);
    } else {
      openDetail(g.id);
    }
  });
  attachPeek(tile, () => g.image && g.image.card.url);

  if (g.image) {
    const img = document.createElement('img');
    img.src = g.image.thumb.url;
    img.alt = '';
    img.loading = 'lazy';
    tile.append(img);
  } else {
    tile.append(document.createTextNode('Ingen bild'));
  }

  const badgeText = ratingBadgeText(g);
  if (badgeText) {
    const badge = document.createElement('span');
    badge.className = 'tile-badge';
    badge.textContent = badgeText;
    tile.append(badge);
  }
  if (g.status === 'suggested') {
    const s = document.createElement('span');
    s.className = 'tile-badge';
    s.style.left = 'auto';
    s.style.right = '6px';
    s.textContent = 'Förslag';
    tile.append(s);
  }
  return tile;
}

async function createGarment() {
  try {
    const { garment } = await api(scoped('/api/garments'), { method: 'POST', headers: jsonHeaders(), body: '{}' });
    await refresh();
    openDetail(garment.id);
  } catch (err) {
    alert('Kunde inte skapa plagg: ' + err.message);
  }
}

async function patchGarment(id, patch) {
  const { garment } = await api(scoped('/api/garments/' + id), {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch),
  });
  replaceInState(garment);
  return garment;
}

async function setRating(id, value) {
  const { garment } = await api(scoped('/api/garments/' + id + '/rating'), {
    method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ value }),
  });
  replaceInState(garment);
  return garment;
}

async function addTag(id, name) {
  const { garment } = await api(scoped('/api/garments/' + id + '/tags'), {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }),
  });
  replaceInState(garment);
  return garment;
}

async function removeTag(id, name) {
  const { garment } = await api(scoped('/api/garments/' + id + '/tags/' + encodeURIComponent(name)), {
    method: 'DELETE',
  });
  replaceInState(garment);
  return garment;
}

async function recordWear(id, date) {
  const { garment } = await api(scoped('/api/garments/' + id + '/wear'), {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ date }),
  });
  replaceInState(garment);
  return garment;
}

function replaceInState(garment) {
  const i = state.garments.findIndex((g) => g.id === garment.id);
  if (i >= 0) state.garments[i] = garment;
  if (detailFull && detailFull.id === garment.id) detailFull = garment;
}

async function removeGarment(id) {
  const g = state.garments.find((x) => x.id === id);
  const q = VISITING ? 'Dra tillbaka förslaget?' : 'Ta bort plagget?';
  if (!confirm(q)) return;
  try {
    await api(scoped('/api/garments/' + id), { method: 'DELETE' });
    detail.close();
    await refresh();
  } catch (err) {
    alert('Kunde inte ta bort: ' + err.message);
  }
}

// ---- detail dialog ----

let detailId = null;
let detailFull = null;

async function openDetail(id) {
  detailId = id;
  detailFull = null;
  renderDetail();
  if (!detail.open) detail.showModal();
  try {
    const { garment } = await api(scoped('/api/garments/' + id));
    if (detailId === id) { detailFull = garment; replaceInState(garment); renderDetail(); }
  } catch {
    /* keep the list row */
  }
}

function refreshDetail() {
  if (detailId && (detailFull || state.garments.some((g) => g.id === detailId))) renderDetail();
  else detail.close();
}

function currentGarment() {
  if (detailFull && detailFull.id === detailId) return detailFull;
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

  const canEditImage = !VISITING || g.status === 'suggested';
  const photo = detailPhoto(g.image, canEditImage ? (file, labelEl) => uploadImage(g.id, file, labelEl) : null);
  if (!canEditImage) photo.style.cursor = 'default';

  const body = document.createElement('div');
  body.className = 'detail-body';

  const head = document.createElement('div');
  head.className = 'detail-head';
  const title = document.createElement('strong');
  title.textContent = g.status === 'suggested' ? 'Förslag' : 'Plagg';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary btn-sm';
  closeBtn.textContent = 'Stäng';
  closeBtn.addEventListener('click', () => detail.close());
  head.append(title, spacer(), closeBtn);
  body.append(head);

  body.append(starRow(g.myRating, MAX_RATING, (value) =>
    mutateDetail(() => setRating(g.id, value))));
  body.append(ratingSummary(g));

  if (!VISITING && g.status !== 'suggested') {
    body.append(wearSection(g, (date) => mutateDetail(() => recordWear(g.id, date))));
  }

  body.append(tagChips(g.tags, (tag) => mutateDetail(async () => {
    await removeTag(g.id, tag);
    await loadTags();
  })));
  body.append(tagAddForm(g.tags, (name) => mutateDetail(async () => {
    markTagUsed(name);
    await addTag(g.id, name);
    await loadTags();
  })));

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
  if (!VISITING) {
    const arch = document.createElement('button');
    arch.type = 'button';
    arch.className = 'btn btn-secondary btn-sm';
    arch.textContent = g.archived ? 'Återställ' : 'Arkivera';
    arch.addEventListener('click', () => mutateDetail(() => patchGarment(g.id, { archived: !g.archived })));
    actions.append(arch);
  }
  if (g.image && canEditImage) {
    const rmImg = document.createElement('button');
    rmImg.type = 'button';
    rmImg.className = 'btn btn-secondary btn-sm';
    rmImg.textContent = 'Ta bort bild';
    rmImg.addEventListener('click', () => removeImage(g.id));
    actions.append(rmImg);
  }
  if (!VISITING || g.status === 'suggested') {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-danger btn-sm';
    del.textContent = VISITING ? 'Dra tillbaka' : 'Ta bort plagg';
    del.addEventListener('click', () => removeGarment(g.id));
    actions.append(del);
  }
  if (actions.children.length) body.append(actions);

  detail.replaceChildren(photo, body);
}

// ---- image ----

async function uploadImage(id, file, labelEl) {
  try {
    const { garment } = await uploadImageFile('/api/garments/' + id, file, labelEl);
    replaceInState(garment);
    renderGrid();
    renderDetail();
  } catch (err) {
    alert('Kunde inte ladda upp bild: ' + err.message);
  }
}

async function removeImage(id) {
  if (!confirm('Ta bort bilden?')) return;
  await mutateDetail(async () => {
    const { garment } = await api(scoped('/api/garments/' + id + '/image'), { method: 'DELETE' });
    replaceInState(garment);
  });
}

await refresh();
if (!VISITING) initFriendsNav();
