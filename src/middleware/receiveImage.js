const multer = require('multer');

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
}).single('image');

// Rate-limited multipart receiver for a single `image` field. Maps multer
// errors to 413 / 400 so handlers only deal with a present (or missing) req.file.
const receiveImage = [
  (req, res, next) => req.app.locals.limiters.upload(req, res, next),
  (req, res, next) => {
    multerUpload(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Image too large (max 20 MB)' });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Send exactly one file in the "image" field' });
      }
      console.error('Upload middleware error:', err);
      return res.status(400).json({ error: 'Upload failed' });
    });
  },
];

module.exports = { receiveImage, MAX_UPLOAD_BYTES };
