import { initAuth, logout } from './auth.js';
import { api } from './shared.js';

await initAuth();

document.getElementById('logoutBtn').addEventListener('click', () => logout());

const garmentSug = document.getElementById('garmentSug');
const outfitSug = document.getElementById('outfitSug');

function thumbBox(images) {
  const box = document.createElement('div');
  box.className = 'sug-thumb';
  const pics = images.filter(Boolean).slice(0, 4);
  const cells = pics.length <= 1 ? 1 : (pics.length <= 2 ? 2 : 4);
  box.style.gridTemplateColumns = cells === 1 ? '1fr' : '1fr 1fr';
  box.style.gridTemplateRows = cells <= 2 ? '1fr' : '1fr 1fr';
  for (let i = 0; i < cells; i += 1) {
    if (pics[i]) {
      const img = document.createElement('img');
      img.src = pics[i];
      img.alt = '';
      box.append(img);
    } else {
      box.append(document.createElement('div'));
    }
  }
  return box;
}

function chip(text) {
  const c = document.createElement('span');
  c.className = 'chip';
  c.textContent = text;
  return c;
}

function button(label, kind, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm ' + kind;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function card({ thumbImages, title, by, tags, onAccept, onIgnore }) {
  const c = document.createElement('div');
  c.className = 'sug-card';
  c.append(thumbBox(thumbImages));

  const body = document.createElement('div');
  body.className = 'sug-body';

  const t = document.createElement('div');
  t.className = 'sug-title';
  t.textContent = title;
  body.append(t);

  const b = document.createElement('div');
  b.className = 'sug-by';
  b.textContent = 'Föreslaget av ' + by;
  body.append(b);

  if (tags && tags.length) {
    const tg = document.createElement('div');
    tg.className = 'sug-tags';
    tags.forEach((name) => tg.append(chip(name)));
    body.append(tg);
  }

  const actions = document.createElement('div');
  actions.className = 'sug-actions';
  actions.append(
    button('Acceptera', 'btn-primary', onAccept),
    button('Ignorera', 'btn-secondary', onIgnore),
  );
  body.append(actions);

  c.append(body);
  return c;
}

async function load() {
  let data;
  try {
    data = await api('/api/suggestions');
  } catch (err) {
    garmentSug.replaceChildren(Object.assign(document.createElement('p'),
      { className: 'sug-empty', textContent: 'Kunde inte ladda förslag: ' + err.message }));
    return;
  }

  if (data.garments.length === 0) {
    garmentSug.replaceChildren(Object.assign(document.createElement('p'),
      { className: 'sug-empty', textContent: 'Inga föreslagna plagg.' }));
  } else {
    garmentSug.replaceChildren(...data.garments.map((g) => card({
      thumbImages: [g.image && g.image.thumb.url],
      title: 'Plagg',
      by: g.suggestedBy ? g.suggestedBy.displayName : 'en vän',
      tags: g.tags,
      onAccept: () => act(() => api(`/api/suggestions/garments/${g.id}/accept`, { method: 'POST' })),
      onIgnore: () => act(() => api(`/api/suggestions/garments/${g.id}/ignore`, { method: 'POST' })),
    })));
  }

  if (data.outfits.length === 0) {
    outfitSug.replaceChildren(Object.assign(document.createElement('p'),
      { className: 'sug-empty', textContent: 'Inga föreslagna outfits.' }));
  } else {
    outfitSug.replaceChildren(...data.outfits.map((o) => card({
      thumbImages: (o.image ? [o.image.thumb.url]
        : (o.garments || []).map((g) => g.image && g.image.thumb.url)),
      title: o.name,
      by: o.suggestedBy ? o.suggestedBy.displayName : 'en vän',
      tags: o.tags,
      onAccept: () => act(() => api(`/api/suggestions/outfits/${o.id}/accept`, { method: 'POST' })),
      onIgnore: () => act(() => api(`/api/suggestions/outfits/${o.id}/ignore`, { method: 'POST' })),
    })));
  }
}

async function act(fn) {
  try {
    await fn();
    await load();
  } catch (err) {
    alert(err.message);
  }
}

await load();
