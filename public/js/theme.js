/* Palettval. Sätter data-palette på <html> och sparar valet i localStorage.
   Alla färger är CSS-variabler (public/css/tokens.css) så attributbytet
   uppdaterar hela gränssnittet. Bygger en dropdown i varje [data-palette-picker]
   där paletterna visas som färgrutor. Se plan/outfitler_overview.md §6. */

const STORAGE_KEY = 'outfitler:palette';

// Representativa färgrutor (ljust läge) per palett – bg, sekundär yta, accent, text.
const PALETTES = [
  { id: 'muted', name: 'Dämpad', swatches: ['#FAFAF8', '#EEEDE9', '#42566A', '#1C1C1B'] },
  { id: 'bold', name: 'Järv', swatches: ['#F4F1EA', '#EDE6D8', '#B5451B', '#17110A'] },
];
const IDS = PALETTES.map((p) => p.id);

export function getPalette() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (IDS.includes(saved)) return saved;
  } catch {
    /* localStorage kan vara blockerat */
  }
  return 'muted';
}

export function applyPalette(id) {
  const palette = IDS.includes(id) ? id : 'muted';
  document.documentElement.dataset.palette = palette;
  try {
    localStorage.setItem(STORAGE_KEY, palette);
  } catch {
    /* ignoreras */
  }
  renderPickers();
  return palette;
}

function swatchRow(colors) {
  const row = document.createElement('span');
  row.className = 'palette-swatches';
  for (const c of colors) {
    const dot = document.createElement('span');
    dot.className = 'palette-swatch';
    dot.style.background = c;
    row.append(dot);
  }
  return row;
}

function closeAllMenus() {
  document.querySelectorAll('.palette-menu:not([hidden])').forEach((m) => { m.hidden = true; });
  document.querySelectorAll('.palette-current[aria-expanded="true"]')
    .forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

function renderPickers() {
  const current = getPalette();
  for (const host of document.querySelectorAll('[data-palette-picker]')) {
    host.classList.add('palette-picker');
    const cur = PALETTES.find((p) => p.id === current);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-current';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = `Palett: ${cur.name}`;
    btn.append(swatchRow(cur.swatches));
    const caret = document.createElement('span');
    caret.className = 'palette-caret';
    caret.textContent = '▾';
    btn.append(caret);

    const menu = document.createElement('div');
    menu.className = 'palette-menu';
    menu.hidden = true;
    for (const p of PALETTES) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'palette-option' + (p.id === current ? ' selected' : '');
      opt.append(swatchRow(p.swatches));
      const label = document.createElement('span');
      label.className = 'palette-name';
      label.textContent = p.name;
      opt.append(label);
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        applyPalette(p.id);
      });
      menu.append(opt);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = !menu.hidden;
      closeAllMenus();
      if (!wasOpen) {
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }
    });

    host.replaceChildren(btn, menu);
  }
}

document.addEventListener('click', closeAllMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllMenus(); });

applyPalette(getPalette());
