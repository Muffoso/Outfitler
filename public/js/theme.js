/* Palettval. Se plan/outfitler_overview.md §6 och public/css/tokens.css.
   Sätter data-palette på <html> och sparar valet i localStorage så att
   det följer med mellan sidor och sessioner. Alla färger är CSS-variabler,
   så attributbytet uppdaterar hela gränssnittet på en gång. */

const PALETTES = ['muted', 'bold'];
const STORAGE_KEY = 'outfitler:palette';
const LABELS = { muted: 'Palett: Dämpad', bold: 'Palett: Järv' };

export function getPalette() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (PALETTES.includes(saved)) return saved;
  } catch {
    /* localStorage kan vara blockerat – fall tillbaka på default */
  }
  return 'muted';
}

export function applyPalette(name) {
  const palette = PALETTES.includes(name) ? name : 'muted';
  document.documentElement.dataset.palette = palette;
  try {
    localStorage.setItem(STORAGE_KEY, palette);
  } catch {
    /* ignoreras – valet gäller då bara denna sidladdning */
  }
  refreshToggles();
  return palette;
}

export function togglePalette() {
  const current = document.documentElement.dataset.palette || getPalette();
  return applyPalette(current === 'bold' ? 'muted' : 'bold');
}

function refreshToggles() {
  const current = document.documentElement.dataset.palette || 'muted';
  const next = current === 'bold' ? 'muted' : 'bold';
  document.querySelectorAll('[data-palette-toggle]').forEach((btn) => {
    btn.textContent = LABELS[current];
    btn.setAttribute('aria-label', `Byt till palett ${LABELS[next].replace('Palett: ', '')}`);
  });
}

// Säkerställ att sparat val är aktivt (den inline-skriptsnutt som sidorna
// kör i <head> hinner före render; detta är för säkerhets skull) och koppla
// alla växlarknappar.
applyPalette(getPalette());

for (const btn of document.querySelectorAll('[data-palette-toggle]')) {
  btn.addEventListener('click', () => togglePalette());
}
