import { initAuth, logout } from './auth.js';
import { api, jsonHeaders } from './shared.js';

await initAuth();

document.getElementById('logoutBtn').addEventListener('click', () => logout());

const els = {
  displayName: document.getElementById('displayName'),
  saveName: document.getElementById('saveName'),
  nameMsg: document.getElementById('nameMsg'),
  inviteForm: document.getElementById('inviteForm'),
  inviteEmail: document.getElementById('inviteEmail'),
  inviteMsg: document.getElementById('inviteMsg'),
  incomingSection: document.getElementById('incomingSection'),
  incoming: document.getElementById('incoming'),
  friends: document.getElementById('friends'),
  outgoingSection: document.getElementById('outgoingSection'),
  outgoing: document.getElementById('outgoing'),
  invitesSection: document.getElementById('invitesSection'),
  invites: document.getElementById('invites'),
};

function msg(el, text, kind) {
  el.textContent = text;
  el.className = 'friends-msg' + (kind ? ' ' + kind : '');
}

function row(mainText, subText, actions) {
  const r = document.createElement('div');
  r.className = 'friend-row';
  const main = document.createElement('div');
  main.className = 'friend-main';
  const name = document.createElement('div');
  name.className = 'friend-name';
  name.textContent = mainText;
  main.append(name);
  if (subText) {
    const sub = document.createElement('div');
    sub.className = 'friend-sub';
    sub.textContent = subText;
    main.append(sub);
  }
  r.append(main);
  const act = document.createElement('div');
  act.className = 'friend-actions';
  for (const a of actions) act.append(a);
  r.append(act);
  return r;
}

function button(label, kind, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm ' + kind;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function linkButton(label, href) {
  const a = document.createElement('a');
  a.className = 'btn btn-sm btn-primary';
  a.textContent = label;
  a.href = href;
  return a;
}

async function loadMe() {
  try {
    const me = await api('/api/me');
    els.displayName.value = me.displayName || '';
  } catch {
    /* non-critical */
  }
}

async function saveName() {
  const displayName = els.displayName.value.trim();
  if (!displayName) { msg(els.nameMsg, 'Skriv ett namn', 'err'); return; }
  try {
    await api('/api/me', { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ displayName }) });
    msg(els.nameMsg, 'Sparat', 'ok');
  } catch (err) {
    msg(els.nameMsg, err.message, 'err');
  }
}

async function invite(e) {
  e.preventDefault();
  const email = els.inviteEmail.value.trim();
  if (!email) return;
  try {
    const res = await api('/api/friends', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email }) });
    els.inviteEmail.value = '';
    let text;
    let kind = 'ok';
    if (res.status === 'accepted') {
      text = 'Ni är nu vänner!';
    } else if (res.emailSent === false) {
      text = res.status === 'invited'
        ? 'Inbjudan sparad, men mejlet kunde inte skickas. Be din vän skapa ett konto på Outfitler — ni kopplas ihop automatiskt.'
        : 'Förfrågan sparad, men mejlet kunde inte skickas. Din vän ser den under "Vänner" nästa gång de loggar in.';
      kind = 'err';
    } else {
      text = res.status === 'invited' ? 'Inbjudan skickad via mail.' : 'Förfrågan skickad.';
    }
    msg(els.inviteMsg, text, kind);
    await load();
  } catch (err) {
    msg(els.inviteMsg, err.message, 'err');
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

async function load() {
  let data;
  try {
    data = await api('/api/friends');
  } catch (err) {
    els.friends.replaceChildren(Object.assign(document.createElement('p'),
      { className: 'friends-empty', textContent: 'Kunde inte ladda vänner: ' + err.message }));
    return;
  }

  els.incomingSection.hidden = data.incoming.length === 0;
  els.incoming.replaceChildren(...data.incoming.map((r) => row(
    r.displayName, r.email,
    [
      button('Acceptera', 'btn-primary', () => act(() =>
        api(`/api/friends/requests/${r.requestId}/accept`, { method: 'POST' }))),
      button('Avböj', 'btn-secondary', () => act(() =>
        api(`/api/friends/requests/${r.requestId}/decline`, { method: 'POST' }))),
    ])));

  if (data.friends.length === 0) {
    els.friends.replaceChildren(Object.assign(document.createElement('p'),
      { className: 'friends-empty', textContent: 'Inga vänner än. Bjud in någon ovan.' }));
  } else {
    els.friends.replaceChildren(...data.friends.map((f) => row(
      f.displayName, f.email,
      [
        linkButton('Besök garderob', `/?owner=${f.userId}`),
        button('Ta bort', 'btn-danger', () => {
          if (!confirm(`Ta bort ${f.displayName} som vän?`)) return;
          act(() => api(`/api/friends/${f.userId}`, { method: 'DELETE' }));
        }),
      ])));
  }

  els.outgoingSection.hidden = data.outgoing.length === 0;
  els.outgoing.replaceChildren(...data.outgoing.map((r) => row(
    r.displayName, r.email,
    [button('Ångra', 'btn-secondary', () => act(() =>
      api(`/api/friends/requests/${r.requestId}`, { method: 'DELETE' })))])));

  els.invitesSection.hidden = data.invites.length === 0;
  els.invites.replaceChildren(...data.invites.map((i) => row(
    i.email, 'Inbjudan skickad',
    [button('Ångra', 'btn-secondary', () => act(() =>
      api(`/api/friends/invites/${i.inviteId}`, { method: 'DELETE' })))])));
}

els.saveName.addEventListener('click', saveName);
els.inviteForm.addEventListener('submit', invite);

await Promise.all([loadMe(), load()]);
