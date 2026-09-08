const imageStore = require('./imageStore');

// Signed variant URLs for a row carrying image_key_prefix / image_variants /
// image_width / image_height (garments and outfits share this shape).
// Returns null when the row has no image.
const buildImage = async (row) => {
  if (!row.image_key_prefix) return null;
  const dims = row.image_variants || {};
  const [thumb, card, archive] = await Promise.all([
    imageStore.signedUrl(`${row.image_key_prefix}/thumb.webp`),
    imageStore.signedUrl(`${row.image_key_prefix}/card.webp`),
    imageStore.signedUrl(`${row.image_key_prefix}/archive.webp`),
  ]);
  return {
    thumb: { url: thumb, ...(dims.thumb || {}) },
    card: { url: card, ...(dims.card || {}) },
    archive: { url: archive, ...(dims.archive || {}) },
    width: row.image_width,
    height: row.image_height,
  };
};

module.exports = { buildImage };
