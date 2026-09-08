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
