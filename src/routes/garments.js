const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const garmentService = require('../services/garmentService');
const imageStore = require('../services/imageStore');
const { storeUpload } = require('../services/imageUpload');
const { requireAuth } = require('../middleware/authenticate');
const { validateBody, validateQuery } = require('../middleware/validate');
const { receiveImage } = require('../middleware/receiveImage');

const router = express.Router();

router.use(requireAuth);

router.param('id', (req, res, next, value) => {
  if (!z.string().uuid().safeParse(value).success) {
    return res.status(404).json({ error: 'Garment not found' });
  }
  next();
});

const rating = z.number().int().min(1).max(10).nullable();
const notes = z.string().max(2000).nullable();
const tags = z.array(z.string().trim().min(1).max(50)).max(50);
const tagName = z.string().trim().min(1).max(50);

const createSchema = z.object({
  rating: rating.optional(),
  notes: notes.optional(),
  tags: tags.optional(),
});

const updateSchema = z.object({
  rating: rating.optional(),
  notes: notes.optional(),
  archived: z.boolean().optional(),
  tags: tags.optional(),
});

const listQuerySchema = z.object({
  // repeatable: ?tag=a&tag=b  (single ?tag=a still works)
  tag: z.union([tagName, z.array(tagName).max(20)]).optional()
    .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]))),
  match: z.enum(['all', 'any']).optional(),
  rating: z.coerce.number().int().min(1).max(10).optional(),
  archived: z.enum(['true', 'false', 'all']).optional(),
  sort: z.enum(['created', 'rating', 'last_worn', 'most_worn']).optional(),
});

const wearSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.get('/', validateQuery(listQuerySchema), async (req, res) => {
  try {
    const garments = await garmentService.list(pool, req.user.id, req.validatedQuery);
    res.json({ garments });
  } catch (err) {
    console.error('List garments error:', err);
    res.status(500).json({ error: 'Failed to list garments' });
  }
});

router.post('/', validateBody(createSchema), async (req, res) => {
  try {
    const garment = await garmentService.create(pool, req.user.id, req.validatedData);
    res.status(201).json({ garment });
  } catch (err) {
    console.error('Create garment error:', err);
    res.status(500).json({ error: 'Failed to create garment' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const garment = await garmentService.getById(pool, req.user.id, req.params.id);
    if (!garment) return res.status(404).json({ error: 'Garment not found' });
    res.json({ garment });
  } catch (err) {
    console.error('Get garment error:', err);
    res.status(500).json({ error: 'Failed to get garment' });
  }
});

router.patch('/:id', validateBody(updateSchema), async (req, res) => {
  try {
    const garment = await garmentService.update(pool, req.user.id, req.params.id, req.validatedData);
    if (!garment) return res.status(404).json({ error: 'Garment not found' });
    res.json({ garment });
  } catch (err) {
    console.error('Update garment error:', err);
    res.status(500).json({ error: 'Failed to update garment' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const removed = await garmentService.remove(pool, req.user.id, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Garment not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Delete garment error:', err);
    res.status(500).json({ error: 'Failed to delete garment' });
  }
});

router.post('/:id/wear', validateBody(wearSchema), async (req, res) => {
  try {
    const date = req.validatedData.date || new Date().toISOString().slice(0, 10);
    const garment = await garmentService.addWear(pool, req.user.id, req.params.id, date);
    if (!garment) return res.status(404).json({ error: 'Garment not found' });
    res.json({ garment });
  } catch (err) {
    console.error('Record garment wear error:', err);
    res.status(500).json({ error: 'Failed to record wear' });
  }
});

// Upload or replace the garment's single image.
router.put('/:id/image', receiveImage, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file' });

    const row = await garmentService.getRow(pool, req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Garment not found' });

    let img;
    try {
      img = await storeUpload(req.file.buffer, `users/${req.user.id}/garments/${row.id}`);
    } catch (err) {
      if (err.code === 'UNSUPPORTED_TYPE') {
        return res.status(415).json({ error: 'Unsupported image type (use JPEG, PNG, WebP or HEIC)' });
      }
      throw err;
    }

    const garment = await garmentService.setImage(pool, req.user.id, row.id, img);

    if (row.image_key_prefix && row.image_key_prefix !== img.keyPrefix) {
      await imageStore.delPrefix(row.image_key_prefix)
        .catch((err) => console.error('Old image cleanup failed:', err));
    }

    res.json({ garment });
  } catch (err) {
    console.error('Upload garment image error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

router.delete('/:id/image', async (req, res) => {
  try {
    const row = await garmentService.getRow(pool, req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Garment not found' });

    const garment = await garmentService.clearImage(pool, req.user.id, req.params.id);
    if (row.image_key_prefix) {
      await imageStore.delPrefix(row.image_key_prefix)
        .catch((err) => console.error('Image cleanup failed:', err));
    }
    res.json({ garment });
  } catch (err) {
    console.error('Delete garment image error:', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

module.exports = router;
