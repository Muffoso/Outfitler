// Shared helpers for the wardrobe and outfit pages.

import { authFetch } from './auth.js';

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

// Add-tag form. Uses <form> submit so the mobile keyboard's Enter/Go works.
// onAdd(name) fires for a non-empty name that isn't already in `tags`.
export function tagAddForm(tags, onAdd) {
  const form = document.createElement('form');
  form.className = 'tag-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Lägg till tagg';
  input.setAttribute('enterkeyhint', 'done');
  input.autocapitalize = 'none';
  input.autocomplete = 'off';
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'btn btn-secondary btn-sm';
  btn.textContent = 'Lägg till';
  form.append(input, btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    input.value = '';
    if (!name || tags.some((t) => t.toLowerCase() === name.toLowerCase())) return;
    onAdd(name);
  });
  return form;
}

export function spacer() {
  const s = document.createElement('span');
  s.className = 'spacer';
  return s;
}

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// A clickable photo area (label wrapping a hidden file input). Shows image.card
// when set, otherwise a prompt. onFile(File, labelEl) fires on selection.
export function detailPhoto(image, onFile) {
  const photo = document.createElement('label');
  photo.className = 'detail-photo';
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

  if (image) {
    const img = document.createElement('img');
    img.src = image.card.url;
    img.alt = '';
    photo.append(img);
  } else {
    photo.append(document.createTextNode('Klicka för att lägga till bild'));
  }
  return photo;
}

// PUT a File to `${base}/image` as multipart/form-data. Toggles the 'busy'
// class on labelEl. Returns the parsed JSON; throws on error (incl. too large).
export async function uploadImageFile(base, file, labelEl) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Bilden är för stor (max 20 MB).');
  const form = new FormData();
  form.append('image', file);
  labelEl.classList.add('busy');
  try {
    return await api(base + '/image', { method: 'PUT', body: form });
  } catch (err) {
    labelEl.classList.remove('busy');
    throw err;
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

// Searchable tag filter. Layout: a search box, the Någon/Alla switch right
// beside it, then the tags on a single horizontally-scrolling row, with a
// plain-language caption below. Renders into `host`. `noun` goes in the caption
// ("plagg" / "outfits"). onChange() fires on any selection/match change.
// query() -> { tags: [...], match? }.
export function createTagFilter(host, noun, onChange) {
  const selected = new Set();
  let allTags = [];
  let search = '';
  let match = 'any';

  const row = document.createElement('div');
  row.className = 'tag-filter';

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
  seg.hidden = true;
  for (const [value, label] of [['any', 'Någon av taggarna'], ['all', 'Alla']]) {
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

  const chipBox = document.createElement('div');
  chipBox.className = 'filter-tags';

  const caption = document.createElement('span');
  caption.className = 'match-caption';
  caption.hidden = true;

  row.append(searchInput, seg, chipBox, caption);
  host.append(row);

  function makeChip(t) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip-toggle' + (selected.has(t.name) ? ' on' : '');
    chip.textContent = `${t.name} (${t.count})`;
    chip.addEventListener('click', () => {
      if (selected.has(t.name)) selected.delete(t.name);
      else selected.add(t.name);
      renderChips();
      renderCaption();
      onChange();
    });
    return chip;
  }

  function renderChips() {
    const matches = allTags.filter((t) => !search || t.name.toLowerCase().startsWith(search));
    const ordered = [
      ...allTags.filter((t) => selected.has(t.name)),
      ...matches.filter((t) => !selected.has(t.name)),
    ];
    chipBox.replaceChildren(...ordered.map(makeChip));
  }

  function renderCaption() {
    seg.hidden = selected.size < 2;
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
      host.hidden = tags.length === 0;
      renderChips();
      renderCaption();
    },
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
  { value: 'rating', label: 'Betyg' },
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
