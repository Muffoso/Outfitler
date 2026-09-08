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

const MAX_RATING = 10;

const state = { outfits: [], garmentsById: new Map(), tags: [] };
const tagFilter = createTagFilter(document.getElementById('tagFilter'), 'outfits', loadOutfits);
const sortMenu = createSortMenu(document.getElementById('sortBy'), loadOutfits);

for (let n = MAX_RATING; n >= 1; n--) {
  const opt = document.createElement('option');
  opt.value = String(n);
  opt.textContent = `${n} +`;
  filterRating.append(opt);
}

document.getElementById('logoutBtn').addEventListener('click', () => logout());
document.getElementById('newBtn').addEventListener('click', createOutfit);
filterRating.addEventListener('change', loadOutfits);
detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); });

async function loadGarments() {
  try {
    const { garments } = await api('/api/garments?archived=all');
    state.garmentsById = new Map(garments.map((g) => [g.id, g]));
  } catch {
    /* surfaced via loadOutfits */
  }
}

async function loadTags() {
  try {
    const { tags } = await api('/api/tags');
    state.tags = tags;
  } catch {
    /* not critical */
  }
  tagFilter.setTags(state.tags.map((t) => ({ name: t.name, count: t.outfitCount })));
}

async function loadOutfits() {
  const params = new URLSearchParams();
  const { tags, match } = tagFilter.query();
  for (const t of tags) params.append('tag', t);
  if (match) params.set('match', match);
  params.set('sort', sortMenu.value());
  if (filterRating.value) params.set('rating', filterRating.value);
  try {
    const { outfits } = await api('/api/outfits?' + params.toString());
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
  grid.replaceChildren(...state.outfits.map(tileEl));
}

function tileEl(o) {
  const tile = document.createElement('div');
  tile.className = 'outfit-tile';
  tile.addEventListener('click', () => openDetail(o.id));

  const cover = document.createElement('div');
  cover.className = 'outfit-cover';
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
  if (o.rating != null) {
    const badge = document.createElement('span');
    badge.className = 'tile-badge';
    badge.textContent = '★ ' + o.rating;
    cover.append(badge);
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
let pickerOpen = false;

function openDetail(id) {
  detailId = id;
  pickerOpen = false;
  renderDetail();
  if (!detail.open) detail.showModal();
}

function refreshDetail() {
  if (detailId && state.outfits.some((o) => o.id === detailId)) renderDetail();
  else detail.close();
}

function currentOutfit() {
  return state.outfits.find((o) => o.id === detailId);
}

async function patchOutfit(id, patch) {
  const { outfit } = await api('/api/outfits/' + id, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch),
  });
  replaceInState(outfit);
  return outfit;
}

async function recordWear(id, date) {
  const { outfit } = await api('/api/outfits/' + id + '/wear', {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ date }),
  });
  replaceInState(outfit);
  // wearing an outfit bumps its garments' counts too
  await loadGarments();
  return outfit;
}

function replaceInState(outfit) {
  const i = state.outfits.findIndex((o) => o.id === outfit.id);
  if (i >= 0) state.outfits[i] = outfit;
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

  const body = document.createElement('div');
  body.className = 'detail-body';

  const head = document.createElement('div');
  head.className = 'detail-head';
  const title = document.createElement('strong');
  title.textContent = 'Outfit';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary btn-sm';
  closeBtn.textContent = 'Stäng';
  closeBtn.addEventListener('click', () => detail.close());
  head.append(title, spacer(), closeBtn);
  body.append(head);

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

  body.append(starRow(o.rating, MAX_RATING, (value) =>
    mutateDetail(() => patchOutfit(o.id, { rating: value }))));

  body.append(wearSection(o, (date) => mutateDetail(() => recordWear(o.id, date))));

  body.append(tagChips(o.tags, (tag) =>
    mutateDetail(() => patchOutfit(o.id, { tags: o.tags.filter((t) => t !== tag) }))));
  body.append(tagAddForm(o.tags, (name) =>
    mutateDetail(() => patchOutfit(o.id, { tags: [...o.tags, name] }))));

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
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '×';
    rm.title = 'Ta bort ur outfit';
    rm.addEventListener('click', () => mutateDetail(() =>
      patchOutfit(o.id, { garmentIds: o.garmentIds.filter((x) => x !== gid) })));
    cell.append(rm);
    gGrid.append(cell);
  }
  body.append(gGrid);

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
      cell.addEventListener('click', () => mutateDetail(() =>
        patchOutfit(o.id, { garmentIds: [...o.garmentIds, g.id] })));
      picker.append(cell);
    }
    body.append(picker);
  }

  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn-danger btn-sm';
  del.textContent = 'Ta bort outfit';
  del.addEventListener('click', () => removeOutfit(o.id));
  actions.append(del);
  body.append(actions);

  detail.replaceChildren(body);
}

async function removeOutfit(id) {
  if (!confirm('Ta bort outfiten?')) return;
  try {
    await api('/api/outfits/' + id, { method: 'DELETE' });
    detail.close();
    await loadOutfits();
  } catch (err) {
    alert('Kunde inte ta bort: ' + err.message);
  }
}

async function createOutfit() {
  try {
    const { outfit } = await api('/api/outfits', {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name: 'Ny outfit' }),
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
