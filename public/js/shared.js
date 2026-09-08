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

// Searchable tag filter: a search box, prefix-filtered toggle chips, a
// Någon/Alla switch and a plain-language caption. Renders into `host`.
// `noun` goes in the caption ("plagg" / "outfits"). onChange() fires whenever
// the selection or match mode changes. query() -> { tags: [...], match? }.
export function createTagFilter(host, noun, onChange) {
  const selected = new Set();
  let allTags = [];
  let search = '';
  let match = 'any';

  const row = document.createElement('div');
  row.className = 'tag-filter';
  row.hidden = true;

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

  const chipBox = document.createElement('div');
  chipBox.className = 'filter-tags';

  const matchWrap = document.createElement('div');
  matchWrap.className = 'match-control';
  matchWrap.hidden = true;
  const seg = document.createElement('span');
  seg.className = 'segmented';
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
  const caption = document.createElement('span');
  caption.className = 'match-caption';
  matchWrap.append(seg, caption);

  row.append(searchInput, chipBox, matchWrap);
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
    matchWrap.hidden = selected.size < 1;
    seg.hidden = selected.size < 2;
    if (selected.size < 2) {
      caption.textContent = selected.size === 1 ? `Visar ${noun} med den valda taggen` : '';
      return;
    }
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
