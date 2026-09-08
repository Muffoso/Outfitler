const crypto = require('crypto');
const imageProcessor = require('./imageProcessor');
const imageStore = require('./imageStore');

// Process an uploaded buffer into WebP variants and store them under
// `<keyPrefixBase>/<random imageId>/`. Returns the fields for a
// garment/outfit setImage() call. Throws err.code 'UNSUPPORTED_TYPE' for a
// non-image buffer.
const storeUpload = async (buffer, keyPrefixBase) => {
  const processed = await imageProcessor.process(buffer);
  const imageId = crypto.randomUUID();
  const keyPrefix = `${keyPrefixBase}/${imageId}`;

  await Promise.all(Object.entries(processed.variants).map(([name, v]) =>
    imageStore.put(`${keyPrefix}/${name}.webp`, v.buffer, 'image/webp')));

  const variants = Object.fromEntries(
    Object.entries(processed.variants).map(([name, v]) => [name, { w: v.width, h: v.height }])
  );

  return {
    keyPrefix,
    variants,
    width: processed.width,
    height: processed.height,
    bytes: processed.bytes,
    hash: processed.hash,
  };
};

module.exports = { storeUpload };
