import { initAuth, logout } from './auth.js';
import {
  api, jsonHeaders, starRow, tagChips, createTagAdder, spacer, wearSection,
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
const newBtn = document.getElementById('newBtn');
const bulkBtn = document.getElementById('bulkBtn');

const MAX_RATING = 10;

const state = { outfits: [], garmentsById: new Map(), tags: [] };
let bulkMode = false;
const bulkSelected = new Set();
const tagFilter = createTagFilter(document.getElementById('tagFilter'), 'outfits', loadOutfits);
const sortMenu = createSortMenu(document.getElementById('sortBy'), loadOutfits);

for (let n = MAX_RATING; n >= 1; n--) {
  const opt = document.createElement('option');
  opt.value = String(n);
  opt.textContent = `${n} +`;
  filterRating.append(opt);
}

if (VISITING) {
  newBtn.textContent = '+ Föreslå outfit';
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.getAttribute('href') === '/') a.href = navHref('/');
    if (a.getAttribute('href') === '/outfits.html') a.href = navHref('/outfits.html');
  }
  setupBanner();
}

document.getElementById('logoutBtn').addEventListener('click', () => logout());
newBtn.addEventListener('click', createOutfit);
filterRating.addEventListener('change', loadOutfits);
detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); });

// ---- bulk tagging ----

const bulkBar = createBulkTagBar({
  onArm: (armed) => grid.classList.toggle('bulk-armed', armed),
  onSave: async (name) => {
    const ids = [...bulkSelected];
    if (ids.length === 0) {
      alert('Kryssa i minst en outfit först.');
      return;
    }
    try {
      const { count } = await api(scoped('/api/outfits/bulk-tag'), {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name, ids }),
      });
      markTagUsed(name);
      exitBulk();
      await refresh();
      alert(`Taggen "${name}" lades på ${count} outfits.`);
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
  } catch { /* generic */ }
  banner.querySelector('.vb-text').textContent = `Du är på besök hos ${name}`;
  banner.hidden = false;
}

async function loadGarments() {
  try {
    const { garments } = await api(scoped('/api/garments?archived=all'));
    state.garmentsById = new Map(garments.map((g) => [g.id, g]));
  } catch {
    /* surfaced via loadOutfits */
  }
}

async function loadTags() {
  try {
    const { tags } = await api(scoped('/api/tags'));
    state.tags = tags;
  } catch {
    /* not critical */
  }
  tagFilter.setTags(state.tags.map((t) => ({ name: t.name, count: t.outfitCount, createdAt: t.createdAt })));
}

async function loadOutfits() {
  const params = new URLSearchParams();
  const { tags, match } = tagFilter.query();
  for (const t of tags) params.append('tag', t);
  if (match) params.set('match', match);
  params.set('sort', sortMenu.value());
  if (filterRating.value) params.set('rating', filterRating.value);
  try {
    const { outfits } = await api(scoped('/api/outfits?' + params.toString()));
    state.outfits = outfits;
    renderGrid();
    if (detail.open) refreshDetail();
  } catch (err) {
    empty.hidden = true;
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Kunde inte ladda outfits: ' + err.message;
    grid.replaceChildren(p);
  }
}

async function refresh() {
  await loadGarments();
  await Promise.all([loadOutfits(), loadTags()]);
}

function thumbFor(garmentId) {
  const g = state.garmentsById.get(garmentId);
  return g && g.image ? g.image.thumb.url : null;
}

function renderGrid() {
  empty.hidden = state.outfits.length > 0;
  grid.classList.toggle('bulk', bulkMode);
  grid.replaceChildren(...state.outfits.map(tileEl));
}

function tileEl(o) {
  const tile = document.createElement('div');
  tile.className = 'outfit-tile' + (bulkMode && bulkSelected.has(o.id) ? ' bulk-selected' : '');
  tile.addEventListener('click', () => {
    if (bulkMode) {
      if (bulkSelected.has(o.id)) bulkSelected.delete(o.id);
      else bulkSelected.add(o.id);
      tile.classList.toggle('bulk-selected', bulkSelected.has(o.id));
      bulkBar.setCount(bulkSelected.size);
    } else {
      openDetail(o.id);
    }
  });

  const cover = document.createElement('div');
  cover.className = 'outfit-cover';
  if (o.image) {
    cover.style.gridTemplateColumns = '1fr';
    cover.style.gridTemplateRows = '1fr';
    const img = document.createElement('img');
    img.src = o.image.thumb.url;
    img.alt = '';
    img.loading = 'lazy';
    cover.append(img);
  } else {
    const thumbs = o.garmentIds.map(thumbFor).filter(Boolean).slice(0, 4);
    const n = thumbs.length;
    const cells = n === 0 ? 1 : (n <= 2 ? n : 4);
    cover.style.gridTemplateColumns = cells === 1 ? '1fr' : '1fr 1fr';
    cover.style.gridTemplateRows = cells <= 2 ? '1fr' : '1fr 1fr';
    for (let i = 0; i < cells; i++) {
      if (thumbs[i]) {
        const img = document.createElement('img');
        img.src = thumbs[i];
        img.alt = '';
        img.loading = 'lazy';
        cover.append(img);
      } else {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cover.append(cell);
      }
    }
  }
  const badgeText = ratingBadgeText(o);
  if (badgeText) {
    const badge = document.createElement('span');
    badge.className = 'tile-badge';
    badge.textContent = badgeText;
    cover.append(badge);
  }
  if (o.status === 'suggested') {
    const s = document.createElement('span');
    s.className = 'tile-badge';
    s.style.left = 'auto';
    s.style.right = '6px';
    s.textContent = 'Förslag';
    cover.append(s);
  }
  tile.append(cover);

  const name = document.createElement('div');
  name.className = 'outfit-name';
  name.textContent = o.name;
  tile.append(name);

  const meta = document.createElement('div');
  meta.className = 'outfit-meta';
  meta.textContent = o.wearCount
    ? `Använd ${o.wearCount} ggr · senast ${o.lastWornOn}`
    : 'Inte använd än';
  tile.append(meta);
  return tile;
}

// ---- detail dialog ----

let detailId = null;
let detailFull = null;
let pickerOpen = false;

async function openDetail(id) {
  detailId = id;
  detailFull = null;
  pickerOpen = false;
  renderDetail();
  if (!detail.open) detail.showModal();
  try {
    const { outfit } = await api(scoped('/api/outfits/' + id));
    if (detailId === id) { detailFull = outfit; replaceInState(outfit); renderDetail(); }
  } catch {
    /* keep the list row */
  }
}

function refreshDetail() {
  if (detailId && (detailFull || state.outfits.some((o) => o.id === detailId))) renderDetail();
  else detail.close();
}

function currentOutfit() {
  if (detailFull && detailFull.id === detailId) return detailFull;
  return state.outfits.find((o) => o.id === detailId);
}

function canEdit(o) {
  return !VISITING || o.status === 'suggested';
}

async function patchOutfit(id, patch) {
  const { outfit } = await api(scoped('/api/outfits/' + id), {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch),
  });
  replaceInState(outfit);
  return outfit;
}

async function setRating(id, value) {
  const { outfit } = await api(scoped('/api/outfits/' + id + '/rating'), {
    method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ value }),
  });
  replaceInState(outfit);
  return outfit;
}

async function addTag(id, name) {
  const { outfit } = await api(scoped('/api/outfits/' + id + '/tags'), {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }),
  });
  replaceInState(outfit);
  return outfit;
}

async function removeTag(id, name) {
  const { outfit } = await api(scoped('/api/outfits/' + id + '/tags/' + encodeURIComponent(name)), {
    method: 'DELETE',
  });
  replaceInState(outfit);
  return outfit;
}

async function recordWear(id, date) {
  const { outfit } = await api(scoped('/api/outfits/' + id + '/wear'), {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ date }),
  });
  replaceInState(outfit);
  await loadGarments();
  return outfit;
}

async function uploadImage(id, file, labelEl) {
  try {
    const { outfit } = await uploadImageFile('/api/outfits/' + id, file, labelEl);
    replaceInState(outfit);
    renderGrid();
    renderDetail();
  } catch (err) {
    alert('Kunde inte ladda upp bild: ' + err.message);
  }
}

async function removeImage(id) {
  if (!confirm('Ta bort outfit-bilden?')) return;
  await mutateDetail(async () => {
    const { outfit } = await api(scoped('/api/outfits/' + id + '/image'), { method: 'DELETE' });
    replaceInState(outfit);
  });
}

function replaceInState(outfit) {
  const i = state.outfits.findIndex((o) => o.id === outfit.id);
  if (i >= 0) state.outfits[i] = outfit;
  if (detailFull && detailFull.id === outfit.id) detailFull = outfit;
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
  const o = currentOutfit();
  if (!o) return;

  const editable = canEdit(o);
  const photo = detailPhoto(o.image, editable ? (file, labelEl) => uploadImage(o.id, file, labelEl) : null);

  const body = document.createElement('div');
  body.className = 'detail-body';

  const head = document.createElement('div');
  head.className = 'detail-head';
  const title = document.createElement('strong');
  title.textContent = o.status === 'suggested' ? 'Förslag' : 'Outfit';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary btn-sm';
  closeBtn.textContent = 'Stäng';
  closeBtn.addEventListener('click', () => detail.close());
  head.append(title, spacer(), closeBtn);
  body.append(head);

  if (editable) {
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'name-input';
    nameInput.value = o.name;
    nameInput.maxLength = 100;
    const commitName = async () => {
      const cur = currentOutfit();
      if (!cur) return;
      const v = nameInput.value.trim();
      if (!v || v === cur.name) { nameInput.value = cur.name; return; }
      try {
        await patchOutfit(cur.id, { name: v });
        renderGrid();
        renderDetail();
      } catch (err) {
        alert(err.message);
        nameInput.value = cur.name;
      }
    };
    nameInput.addEventListener('blur', commitName);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitName(); }
    });
    body.append(nameInput);
  } else {
    const nameEl = document.createElement('div');
    nameEl.className = 'name-input';
    nameEl.textContent = o.name;
    body.append(nameEl);
  }

  body.append(starRow(o.myRating, MAX_RATING, (value) =>
    mutateDetail(() => setRating(o.id, value))));
  body.append(ratingSummary(o));

  if (!VISITING && o.status !== 'suggested') {
    body.append(wearSection(o, (date) => mutateDetail(() => recordWear(o.id, date))));
  }

  body.append(tagChips(o.tags, (tag) => mutateDetail(async () => {
    await removeTag(o.id, tag);
    await loadTags();
  })));
  const adder = createTagAdder({
    onChoose: (name) => mutateDetail(async () => {
      markTagUsed(name);
      await addTag(o.id, name);
      await loadTags();
    }),
  });
  adder.setTags(state.tags.map((t) => t.name), o.tags);
  body.append(adder.el);

  const notes = document.createElement('textarea');
  notes.className = 'notes';
  notes.placeholder = 'Anteckningar…';
  notes.value = o.notes || '';
  notes.addEventListener('blur', async () => {
    const value = notes.value.trim() || null;
    if (value === (o.notes || null)) return;
    try {
      await patchOutfit(o.id, { notes: value });
    } catch (err) {
      alert(err.message);
    }
  });
  body.append(notes);

  const gLabel = document.createElement('div');
  gLabel.className = 'section-label';
  gLabel.textContent = `Plagg (${o.garmentIds.length})`;
  body.append(gLabel);

  const gGrid = document.createElement('div');
  gGrid.className = 'og-grid';
  for (const gid of o.garmentIds) {
    const g = state.garmentsById.get(gid);
    const cell = document.createElement('div');
    cell.className = 'og';
    if (g && g.image) {
      const img = document.createElement('img');
      img.src = g.image.thumb.url;
      img.alt = '';
      cell.append(img);
    } else {
      cell.append(document.createTextNode('–'));
    }
    attachPeek(cell, () => g && g.image && g.image.card.url);
    if (editable) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'rm';
      rm.textContent = '×';
      rm.title = 'Ta bort ur outfit';
      rm.addEventListener('click', () => mutateDetail(() =>
        patchOutfit(o.id, { garmentIds: o.garmentIds.filter((x) => x !== gid) })));
      cell.append(rm);
    }
    gGrid.append(cell);
  }
  body.append(gGrid);

  if (editable) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-secondary btn-sm';
    addBtn.textContent = pickerOpen ? 'Stäng plaggväljaren' : '+ Lägg till plagg';
    addBtn.addEventListener('click', () => { pickerOpen = !pickerOpen; renderDetail(); });
    body.append(addBtn);

    if (pickerOpen) {
      const picker = document.createElement('div');
      picker.className = 'picker';
      const inOutfit = new Set(o.garmentIds);
      const candidates = [...state.garmentsById.values()]
        .filter((g) => !inOutfit.has(g.id) && !g.archived);
      if (candidates.length === 0) {
        const p = document.createElement('div');
        p.className = 'muted';
        p.textContent = 'Inga fler plagg att lägga till.';
        picker.append(p);
      }
      for (const g of candidates) {
        const cell = document.createElement('div');
        cell.className = 'og';
        cell.title = 'Lägg till';
        if (g.image) {
          const img = document.createElement('img');
          img.src = g.image.thumb.url;
          img.alt = '';
          cell.append(img);
        } else {
          cell.append(document.createTextNode('Ingen bild'));
        }
        attachPeek(cell, () => g.image && g.image.card.url);
        cell.addEventListener('click', () => mutateDetail(() =>
          patchOutfit(o.id, { garmentIds: [...o.garmentIds, g.id] })));
        picker.append(cell);
      }
      body.append(picker);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  if (o.image && editable) {
    const rmImg = document.createElement('button');
    rmImg.type = 'button';
    rmImg.className = 'btn btn-secondary btn-sm';
    rmImg.textContent = 'Ta bort bild';
    rmImg.addEventListener('click', () => removeImage(o.id));
    actions.append(rmImg);
  }
  if (!VISITING || o.status === 'suggested') {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-danger btn-sm';
    del.textContent = VISITING ? 'Dra tillbaka' : 'Ta bort outfit';
    del.addEventListener('click', () => removeOutfit(o.id));
    actions.append(del);
  }
  if (actions.children.length) body.append(actions);

  detail.replaceChildren(photo, body);
}

async function removeOutfit(id) {
  const q = VISITING ? 'Dra tillbaka förslaget?' : 'Ta bort outfiten?';
  if (!confirm(q)) return;
  try {
    await api(scoped('/api/outfits/' + id), { method: 'DELETE' });
    detail.close();
    await loadOutfits();
  } catch (err) {
    alert('Kunde inte ta bort: ' + err.message);
  }
}

async function createOutfit() {
  try {
    const { outfit } = await api(scoped('/api/outfits'), {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ name: VISITING ? 'Nytt förslag' : 'Ny outfit' }),
    });
    await loadOutfits();
    openDetail(outfit.id);
    pickerOpen = true;
    renderDetail();
  } catch (err) {
    alert('Kunde inte skapa outfit: ' + err.message);
  }
}

await refresh();
if (!VISITING) initFriendsNav();
