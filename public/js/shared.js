// Shared helpers for the wardrobe and outfit pages.

import { authFetch, authUpload } from './auth.js';

export async function api(url, options) {
  const res = await authFetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export function jsonHeaders() {
  return { 'Content-Type': 'application/json' };
}

// --- visiting a friend's wardrobe: ?owner=<id> ---

export function ownerId() {
  try {
    return new URLSearchParams(location.search).get('owner');
  } catch {
    return null;
  }
}

export function isVisiting() {
  return !!ownerId();
}

// Append owner=<id> to an API path when visiting a friend's wardrobe.
export function scoped(path) {
  const o = ownerId();
  if (!o) return path;
  return path + (path.includes('?') ? '&' : '?') + 'owner=' + encodeURIComponent(o);
}

// Keep the ?owner= param when navigating between the wardrobe and outfits pages.
export function navHref(path) {
  const o = ownerId();
  return o ? path + '?owner=' + encodeURIComponent(o) : path;
}

// "★ 7,3 · 4" when more than one person rated, else "★ 6" for the viewer's own.
export function ratingBadgeText(item) {
  if (item.ratingCount > 1 && item.avgRating != null) {
    return '★ ' + item.avgRating.toFixed(1).replace('.', ',') + ' · ' + item.ratingCount;
  }
  if (item.myRating != null) return '★ ' + item.myRating;
  return null;
}

// A small block: "Snitt 7,3 av 4 betyg" + one line per rater.
export function ratingSummary(item) {
  const wrap = document.createElement('div');
  wrap.className = 'rating-summary muted';
  if (!item.ratingCount) {
    wrap.textContent = 'Inga betyg än';
    return wrap;
  }
  const head = document.createElement('div');
  const avg = item.avgRating != null ? item.avgRating.toFixed(1).replace('.', ',') : '–';
  head.textContent = `Snitt ${avg} av ${item.ratingCount} ${item.ratingCount === 1 ? 'betyg' : 'betyg'}`;
  wrap.append(head);
  for (const r of item.ratings || []) {
    const line = document.createElement('div');
    line.textContent = `${r.displayName}: ${r.value}`;
    wrap.append(line);
  }
  return wrap;
}

// A row of `max` star buttons. onSet(n | null) fires on click; clicking the
// current value (or "nollställ") clears the rating.
export function starRow(value, max, onSet) {
  const wrap = document.createElement('div');
  wrap.className = 'stars';
  for (let n = 1; n <= max; n++) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'star' + (value >= n ? ' on' : '');
    s.textContent = '★';
    s.title = `${n} av ${max}`;
    s.addEventListener('click', () => onSet(value === n ? null : n));
    wrap.append(s);
  }
  if (value != null) {
    const clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'rating-clear';
    clr.textContent = 'nollställ';
    clr.addEventListener('click', () => onSet(null));
    wrap.append(clr);
  }
  return wrap;
}

// Removable tag chips. onRemove(tagName) fires when an × is clicked.
export function tagChips(tags, onRemove) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  for (const tag of tags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(document.createTextNode(tag));
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Ta bort tagg';
    x.addEventListener('click', () => onRemove(tag));
    chip.append(x);
    wrap.append(chip);
  }
  return wrap;
}

// Shared bits for the "add a tag" widgets ------------------------------------

function wireScrollFade(el) {
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.style.setProperty('--fade-l', el.scrollLeft > 2 ? '22px' : '0px');
    el.style.setProperty('--fade-r', el.scrollLeft < max - 2 ? '22px' : '0px');
  };
  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  return update;
}

// Paint a scrolling, edge-faded row of existing-tag chips into `chipBox`.
function paintTagChips(chipBox, names, { exclude = new Set(), search = '', onPick }) {
  const usage = readTagUsage();
  const rec = (n) => usage[n.toLowerCase()] || 0;
  const list = names
    .filter((n) => !exclude.has(n.toLowerCase()))
    .filter((n) => !search || n.toLowerCase().startsWith(search))
    .sort((a, b) => rec(b) - rec(a) || a.localeCompare(b, 'sv'));
  chipBox.replaceChildren(...list.map((n) => {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip-toggle';
    c.textContent = n;
    c.addEventListener('click', () => onPick(n));
    return c;
  }));
}

// Add-tag widget: a text field (type a new tag) + a row of the owner's existing
// tags below it (filtered as you type, click to add). onChoose(name) fires for a
// typed name or a picked chip; tags already on the item are hidden from the row.
export function createTagAdder({ onChoose }) {
  const wrap = document.createElement('div');
  wrap.className = 'tag-adder';

  const form = document.createElement('form');
  form.className = 'tag-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Lägg till en tagg';
  input.setAttribute('enterkeyhint', 'done');
  input.autocapitalize = 'none';
  input.autocomplete = 'off';
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'btn btn-secondary btn-sm';
  btn.textContent = 'Lägg till';
  form.append(input, btn);

  const chipBox = document.createElement('div');
  chipBox.className = 'filter-tags';
  const updateFade = wireScrollFade(chipBox);

  wrap.append(form, chipBox);

  let all = [];
  let applied = new Set();
  let filterText = '';

  const render = () => {
    paintTagChips(chipBox, all, {
      exclude: applied,
      search: filterText,
      onPick: (n) => { markTagUsed(n); choose(n); },
    });
    requestAnimationFrame(updateFade);
  };
  const choose = (name) => {
    const n = (name || '').trim();
    input.value = '';
    filterText = '';
    if (n) onChoose(n);
  };

  input.addEventListener('input', () => { filterText = input.value.trim().toLowerCase(); render(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); choose(input.value); });

  return {
    el: wrap,
    setTags(allNames, appliedNames = []) {
      all = allNames.slice();
      applied = new Set(appliedNames.map((s) => s.toLowerCase()));
      render();
    },
  };
}

export function spacer() {
  const s = document.createElement('span');
  s.className = 'spacer';
  return s;
}

// --- press-and-hold to view an image full-size ---

let peekEl = null;

function showImagePeek(url) {
  if (!url) return;
  if (!peekEl) {
    // A <dialog> so it stacks in the top layer, above an open detail dialog.
    peekEl = document.createElement('dialog');
    peekEl.className = 'image-peek';
    peekEl.append(document.createElement('img'));
    const hide = () => { if (peekEl.open) peekEl.close(); };
    peekEl.addEventListener('pointerup', hide);
    peekEl.addEventListener('click', hide);
    document.body.append(peekEl);
  }
  peekEl.querySelector('img').src = url;
  if (!peekEl.open) peekEl.showModal();
}

// Long-press `el` -> show getUrl() big. Suppresses the click that follows.
export function attachPeek(el, getUrl) {
  let timer = null;
  let sx = 0;
  let sy = 0;
  let fired = false;

  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; fired = false;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      const url = getUrl();
      if (!url) return;
      fired = true;
      showImagePeek(url);
    }, 420);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => { if (fired || timer) e.preventDefault(); });
  el.addEventListener('click', (e) => {
    if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
  }, true);
}

// --- bulk tag bar (assign one tag to many items) ---

export function createBulkTagBar({ onSave, onCancel, onArm }) {
  const bar = document.createElement('div');
  bar.className = 'bulk-bar';
  bar.hidden = true;

  const top = document.createElement('div');
  top.className = 'bulk-bar-top';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'bulk-tag-input';
  input.placeholder = 'Lägg till en tagg';
  input.autocapitalize = 'none';
  input.autocomplete = 'off';

  const count = document.createElement('span');
  count.className = 'bulk-count';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary btn-sm';
  save.textContent = 'Spara';
  save.addEventListener('click', () => {
    const name = input.value.trim();
    if (name) onSave(name);
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary btn-sm';
  cancel.textContent = 'Avbryt';
  cancel.addEventListener('click', onCancel);

  top.append(input, count, save, cancel);

  const hint = document.createElement('div');
  hint.className = 'bulk-hint';
  hint.textContent = 'Kryssa i de som ska få taggen nedan';
  hint.hidden = true;

  const chipBox = document.createElement('div');
  chipBox.className = 'filter-tags';
  const updateFade = wireScrollFade(chipBox);

  bar.append(top, hint, chipBox);

  let all = [];
  let filterText = '';

  const setArmed = (armed) => {
    hint.hidden = !armed;
    if (onArm) onArm(armed);
  };
  const render = () => {
    paintTagChips(chipBox, all, {
      search: filterText,
      onPick: (n) => { markTagUsed(n); input.value = n; filterText = ''; setArmed(true); render(); },
    });
    requestAnimationFrame(updateFade);
  };

  input.addEventListener('input', () => {
    filterText = input.value.trim().toLowerCase();
    setArmed(!!input.value.trim());
    render();
  });

  return {
    el: bar,
    open(tagNames) {
      all = tagNames.slice();
      input.value = '';
      filterText = '';
      setArmed(false);
      bar.hidden = false;
      render();
      input.focus();
    },
    close() { bar.hidden = true; setArmed(false); },
    setCount(n) { count.textContent = `${n} ${n === 1 ? 'vald' : 'valda'}`; },
  };
}

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// A clickable photo area (label wrapping a hidden file input). Shows image.card
// when set, otherwise a prompt. onFile(File, labelEl) fires on selection.
export function detailPhoto(image, onFile) {
  // Read-only when onFile is null: a plain box, no file input.
  const photo = document.createElement(onFile ? 'label' : 'div');
  photo.className = 'detail-photo';

  if (onFile) {
    photo.title = image ? 'Byt bild' : 'Lägg till bild';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = IMAGE_ACCEPT;
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files[0];
      file.value = '';
      if (f) onFile(f, photo);
    });
    photo.append(file);
  }

  if (image) {
    const img = document.createElement('img');
    img.src = image.card.url;
    img.alt = '';
    photo.append(img);
  } else {
    photo.append(document.createTextNode(onFile ? 'Klicka för att lägga till bild' : 'Ingen bild'));
  }
  return photo;
}

// PUT a File to `${base}/image` as multipart/form-data with a progress bar drawn
// on labelEl. Returns the parsed JSON; throws on error (incl. too large).
export async function uploadImageFile(base, file, labelEl) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Bilden är för stor (max 20 MB).');
  const form = new FormData();
  form.append('image', file);

  labelEl.classList.add('busy');
  const bar = document.createElement('div');
  bar.className = 'upload-progress';
  const fillEl = document.createElement('div');
  fillEl.className = 'upload-progress-fill';
  bar.append(fillEl);
  labelEl.append(bar);

  try {
    return await authUpload(scoped(base + '/image'), form, (p) => {
      fillEl.style.width = Math.max(3, Math.round(p * 100)) + '%';
      // Past 100% of the bytes the server is still processing (sharp/R2).
      if (p >= 1) bar.classList.add('processing');
    });
  } finally {
    bar.remove();
    labelEl.classList.remove('busy');
  }
}

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "Använd N gånger, senast <date>" + a date field prefilled with today and an
// "Använd" button. onRecord(dateStr) is called with the chosen date.
export function wearSection(item, onRecord) {
  const wrap = document.createElement('div');
  wrap.className = 'wear';

  const info = document.createElement('span');
  info.className = 'muted';
  info.textContent = item.wearCount
    ? `Använd ${item.wearCount} ${item.wearCount === 1 ? 'gång' : 'gånger'}, senast ${item.lastWornOn}`
    : 'Inte använd än';

  const date = document.createElement('input');
  date.type = 'date';
  date.className = 'wear-date';
  date.value = todayISO();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary btn-sm';
  btn.textContent = 'Använd';
  btn.addEventListener('click', () => onRecord(date.value || todayISO()));

  wrap.append(info, date, btn);
  return wrap;
}

// Per-device record of when a tag was last used in a search, so the most
// recently relevant tags sort to the front of the filter row.
const TAG_USAGE_KEY = 'outfitler:tagUsage';

function readTagUsage() {
  try {
    return JSON.parse(localStorage.getItem(TAG_USAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function markTagUsed(name) {
  if (!name) return;
  try {
    const m = readTagUsage();
    m[name.toLowerCase()] = Date.now();
    localStorage.setItem(TAG_USAGE_KEY, JSON.stringify(m));
  } catch {
    /* localStorage may be unavailable */
  }
}

// --- "new friend activity" tracking (per device) ---

const FRIENDS_SEEN_KEY = 'outfitler:friendsSeen';

function readFriendsSeen() {
  try {
    const s = JSON.parse(localStorage.getItem(FRIENDS_SEEN_KEY)) || {};
    return { activitySeenAt: s.activitySeenAt || 0, contribSeen: s.contribSeen || {} };
  } catch {
    return { activitySeenAt: 0, contribSeen: {} };
  }
}

function writeFriendsSeen(s) {
  try {
    localStorage.setItem(FRIENDS_SEEN_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const ts = (x) => (x ? Date.parse(x) || 0 : 0);

// Call with the /api/friends payload once the Vänner page has been viewed.
// Records the newest *server* timestamp seen, so it never depends on the
// client clock matching the server's.
export function markFriendActivitySeen(data) {
  const s = readFriendsSeen();
  let latest = s.activitySeenAt || 0;
  for (const r of data.incoming || []) latest = Math.max(latest, ts(r.createdAt));
  for (const f of data.friends || []) if (f.initiatedByMe) latest = Math.max(latest, ts(f.since));
  s.activitySeenAt = latest;
  writeFriendsSeen(s);
}

// Call with the friend's own lastContributionAt (a server timestamp) once their
// contributions page has been viewed.
export function markContributionsSeen(friendId, lastContributionAt) {
  const seen = ts(lastContributionAt);
  if (!seen) return;
  const s = readFriendsSeen();
  s.contribSeen[friendId] = Math.max(s.contribSeen[friendId] || 0, seen);
  writeFriendsSeen(s);
}

// Has this friend contributed something not yet seen?
export function friendHasNew(friend) {
  const { contribSeen } = readFriendsSeen();
  return !!friend.lastContributionAt && ts(friend.lastContributionAt) > (contribSeen[friend.userId] || 0);
}

// Any unseen request / acceptance / contribution across all friends?
export function friendsPayloadHasNew(data) {
  const { activitySeenAt } = readFriendsSeen();
  const reqNew = (data.incoming || []).some((r) => ts(r.createdAt) > activitySeenAt);
  const accNew = (data.friends || []).some((f) => f.initiatedByMe && ts(f.since) > activitySeenAt);
  const contribNew = (data.friends || []).some(friendHasNew);
  return reqNew || accNew || contribNew;
}

// Put a "new" dot on the Vänner nav link when there's unseen activity.
// Fire-and-forget; safe to call on any page with the nav.
export async function initFriendsNav() {
  const link = document.querySelector('.nav a[href="/friends.html"]');
  if (!link) return;
  try {
    const data = await api('/api/friends');
    link.classList.toggle('has-new', friendsPayloadHasNew(data));
  } catch {
    /* leave the nav as-is */
  }
}

// Searchable tag filter. Row 1: search box + the Någon/Alla switch, both kept
// within the screen width. Row 2: the tags on one horizontally-scrolling line
// that never widens past the grid, faded at whichever edge can still scroll.
// Ordered by most-recently-used-in-a-search (or newest). Renders into `host`.
// `noun` goes in the caption. onChange() fires on any selection/match change.
// query() -> { tags: [...], match? }.
export function createTagFilter(host, noun, onChange) {
  const selected = new Set();
  let allTags = [];
  let search = '';
  let match = 'any';

  const row = document.createElement('div');
  row.className = 'tag-filter';

  const top = document.createElement('div');
  top.className = 'tag-filter-top';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'tag-search';
  searchInput.placeholder = 'Sök tagg…';
  searchInput.setAttribute('enterkeyhint', 'search');
  searchInput.autocapitalize = 'none';
  searchInput.autocomplete = 'off';
  searchInput.addEventListener('input', () => {
    search = searchInput.value.trim().toLowerCase();
    renderChips();
  });

  const seg = document.createElement('span');
  seg.className = 'segmented match-seg';
  for (const [value, label] of [['any', 'Någon'], ['all', 'Alla']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.match = value;
    b.textContent = label;
    b.className = value === match ? 'on' : '';
    b.addEventListener('click', () => {
      match = value;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.match === match));
      renderCaption();
      onChange();
    });
    seg.append(b);
  }

  top.append(searchInput, seg);

  const chipBox = document.createElement('div');
  chipBox.className = 'filter-tags';
  chipBox.addEventListener('scroll', updateScrollHints, { passive: true });
  window.addEventListener('resize', updateScrollHints);

  const caption = document.createElement('span');
  caption.className = 'match-caption';
  caption.hidden = true;

  row.append(top, chipBox, caption);
  host.append(row);

  function updateScrollHints() {
    const max = chipBox.scrollWidth - chipBox.clientWidth;
    chipBox.style.setProperty('--fade-l', chipBox.scrollLeft > 2 ? '22px' : '0px');
    chipBox.style.setProperty('--fade-r', chipBox.scrollLeft < max - 2 ? '22px' : '0px');
  }

  function recency(t) {
    const usage = readTagUsage();
    const used = usage[t.name.toLowerCase()] || 0;
    const created = t.createdAt ? Date.parse(t.createdAt) || 0 : 0;
    return Math.max(used, created);
  }

  function makeChip(t) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip-toggle' + (selected.has(t.name) ? ' on' : '');
    chip.textContent = `${t.name} (${t.count})`;
    chip.addEventListener('click', () => {
      if (selected.has(t.name)) {
        selected.delete(t.name);
      } else {
        selected.add(t.name);
        markTagUsed(t.name);
      }
      // Clear the search so the full set of tags (with the new selection at the
      // front) is shown again, as if the box had been emptied manually.
      search = '';
      searchInput.value = '';
      renderChips();
      renderCaption();
      onChange();
    });
    return chip;
  }

  function renderChips() {
    const matches = allTags
      .filter((t) => !search || t.name.toLowerCase().startsWith(search))
      .sort((a, b) => recency(b) - recency(a) || a.name.localeCompare(b.name, 'sv'));
    chipBox.replaceChildren(...matches.map(makeChip));
    requestAnimationFrame(updateScrollHints);
  }

  function renderCaption() {
    caption.hidden = selected.size < 2;
    if (selected.size < 2) return;
    caption.replaceChildren();
    caption.append(document.createTextNode(`Visar ${noun} med `));
    const strong = document.createElement('strong');
    strong.textContent = match === 'all' ? `alla ${selected.size}` : 'minst en';
    caption.append(strong);
    caption.append(document.createTextNode(match === 'all'
      ? ' valda taggarna'
      : ` av de ${selected.size} valda taggarna`));
  }

  return {
    setTags(tags) {
      allTags = tags;
      const names = new Set(tags.map((t) => t.name));
      for (const n of [...selected]) if (!names.has(n)) selected.delete(n);
      renderChips();
      renderCaption();
    },
    hasSelection() { return selected.size > 0; },
    refresh() { renderChips(); },
    query() {
      return {
        tags: [...selected],
        match: selected.size >= 2 ? match : undefined,
      };
    },
  };
}

const SORT_OPTIONS = [
  { value: 'created', label: 'Senast tillagd' },
  { value: 'rating', label: 'Mitt betyg' },
  { value: 'avg_rating', label: 'Genomsnittligt betyg' },
  { value: 'last_worn', label: 'Senast använd' },
  { value: 'most_worn', label: 'Mest använd' },
];

// An icon button that opens a menu of sort options (the active one marked).
// The current choice is not shown as text. onChange() fires on pick.
// value() -> the selected sort key.
export function createSortMenu(host, onChange) {
  let value = 'created';
  host.classList.add('sort-menu');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.title = 'Sortera';
  btn.setAttribute('aria-label', 'Sortera');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">'
    + '<path d="M3 4.5h10M3 8h6M3 11.5h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>'
    + '</svg>';

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.hidden = true;

  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); };

  function renderMenu() {
    menu.replaceChildren(...SORT_OPTIONS.map((o) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu-item' + (o.value === value ? ' selected' : '');
      item.textContent = o.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        value = o.value;
        renderMenu();
        close();
        onChange();
      });
      return item;
    }));
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  renderMenu();
  host.append(btn, menu);

  return { value: () => value };
}
