// Turns an uploaded image buffer into the stored variants. See
// plan/image_storage.md §2–3: EXIF-rotate, strip metadata, transcode to WebP,
// produce archive / card / thumb. sharp output carries no EXIF by default, so
// GPS and other metadata are dropped.

const crypto = require('crypto');
const sharp = require('sharp');

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1',
]);

const VARIANTS = {
  archive: { max: 2560, quality: 82 },
  card: { max: 1000, quality: 78 },
  thumb: { max: 500, quality: 72 },
};

// Sniff the real container from magic bytes — never trust the client's type.
const detectType = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('latin1', 4, 8) === 'ftyp' && HEIF_BRANDS.has(buf.toString('latin1', 8, 12))) return 'image/heic';
  return null;
};

const process = async (inputBuffer) => {
  const sourceType = detectType(inputBuffer);
  if (!sourceType) {
    const err = new Error('Unsupported image type');
    err.code = 'UNSUPPORTED_TYPE';
    throw err;
  }

  const variants = {};
  for (const [name, { max, quality }] of Object.entries(VARIANTS)) {
    const { data, info } = await sharp(inputBuffer, { failOn: 'error' })
      .rotate() // apply and clear EXIF orientation
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    variants[name] = { buffer: data, width: info.width, height: info.height };
  }

  const archive = variants.archive;
  return {
    sourceType,
    contentType: 'image/webp',
    variants, // { thumb: {buffer,width,height}, card: {...}, archive: {...} }
    width: archive.width,
    height: archive.height,
    bytes: archive.buffer.length,
    hash: crypto.createHash('sha256').update(archive.buffer).digest('hex'),
  };
};

module.exports = { process, detectType };
