import { initAuth, logout } from './auth.js';
import { api, initFriendsNav, markContributionsSeen } from './shared.js';

await initAuth();
document.getElementById('logoutBtn').addEventListener('click', () => logout());

const friendId = new URLSearchParams(location.search).get('friend');

const els = {
  head: document.getElementById('head'),
  sugGarments: document.getElementById('sugGarments'),
  sugOutfits: document.getElementById('sugOutfits'),
  ratings: document.getElementById('ratings'),
  notes: document.getElementById('notes'),
};

if (!friendId) {
  els.head.textContent = 'Ingen vän vald';
} else {
  await load();
  markContributionsSeen(friendId);
  initFriendsNav();
}

function thumb(images) {
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

function button(label, kind, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm ' + kind;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function card({ images, title, meta, note, actions }) {
  const c = document.createElement('div');
  c.className = 'sug-card';
  c.append(thumb(images));
  const body = document.createElement('div');
  body.className = 'sug-body';
  const t = document.createElement('div');
  t.className = 'sug-title';
  t.textContent = title;
  body.append(t);
  if (meta) {
    const m = document.createElement('div');
    m.className = 'sug-meta';
    m.textContent = meta;
    body.append(m);
  }
  if (note) {
    const n = document.createElement('div');
    n.className = 'sug-note';
    n.textContent = note;
    body.append(n);
  }
  if (actions && actions.length) {
    const a = document.createElement('div');
    a.className = 'sug-actions';
    actions.forEach((x) => a.append(x));
    body.append(a);
  }
  c.append(body);
  return c;
}

function empty(text) {
  return Object.assign(document.createElement('p'), { className: 'sug-empty', textContent: text });
}

async function act(fn) {
  try {
    await fn();
    await load();
  } catch (err) {
    alert(err.message);
  }
}

async function load() {
  let data;
  try {
    data = await api(`/api/friends/${friendId}/contributions`);
  } catch (err) {
    els.head.textContent = 'Kunde inte ladda: ' + err.message;
    return;
  }

  els.head.textContent = `Bidrag från ${data.friendName}`;

  fill(els.sugGarments, data.suggestedGarments, 'Inga föreslagna plagg.', (g) => card({
    images: [g.image && g.image.thumb.url],
    title: 'Plagg',
    actions: [
      button('Lägg till', 'btn-primary', () =>
        act(() => api(`/api/suggestions/garments/${g.id}/accept`, { method: 'POST' }))),
      button('Strunta i', 'btn-secondary', () =>
        act(() => api(`/api/suggestions/garments/${g.id}/ignore`, { method: 'POST' }))),
    ],
  }));

  fill(els.sugOutfits, data.suggestedOutfits, 'Inga föreslagna outfits.', (o) => card({
    images: [o.image && o.image.thumb.url],
    title: o.name,
    actions: [
      button('Lägg till', 'btn-primary', () =>
        act(() => api(`/api/suggestions/outfits/${o.id}/accept`, { method: 'POST' }))),
      button('Strunta i', 'btn-secondary', () =>
        act(() => api(`/api/suggestions/outfits/${o.id}/ignore`, { method: 'POST' }))),
    ],
  }));

  fill(els.ratings, data.ratings, 'Inga betyg.', (r) => card({
    images: [r.image && r.image.thumb.url],
    title: r.kind === 'outfit' ? r.name : 'Plagg',
    meta: `Betyg: ${r.value}`,
  }));

  fill(els.notes, data.notes, 'Inga anteckningar.', (n) => card({
    images: [n.image && n.image.thumb.url],
    title: n.kind === 'outfit' ? n.name : 'Plagg',
    note: n.notes,
  }));
}

function fill(container, items, emptyText, render) {
  container.replaceChildren(...(items.length ? items.map(render) : [empty(emptyText)]));
}
