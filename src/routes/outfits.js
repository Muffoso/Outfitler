const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const outfitService = require('../services/outfitService');
const imageStore = require('../services/imageStore');
const { storeUpload } = require('../services/imageUpload');
const { requireAuth } = require('../middleware/authenticate');
const { resolveOwner, requireOwner } = require('../middleware/friendship');
const { validateBody, validateQuery } = require('../middleware/validate');
const { receiveImage } = require('../middleware/receiveImage');

const router = express.Router();

router.use(requireAuth);
router.use(resolveOwner);

router.param('id', (req, res, next, value) => {
  if (!z.string().uuid().safeParse(value).success) {
    return res.status(404).json({ error: 'Outfit not found' });
  }
  next();
});

const rating = z.number().int().min(1).max(10).nullable();
const notes = z.string().max(2000).nullable();
const tags = z.array(z.string().trim().min(1).max(50)).max(50);
const tagName = z.string().trim().min(1).max(50);
const garmentIds = z.array(z.string().uuid()).max(100);

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  garmentIds: garmentIds.optional(),
  rating: rating.optional(),
  notes: notes.optional(),
  tags: tags.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  garmentIds: garmentIds.optional(),
  rating: rating.optional(),
  notes: notes.optional(),
  tags: tags.optional(),
});

const listQuerySchema = z.object({
  tag: z.union([tagName, z.array(tagName).max(20)]).optional()
    .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]))),
  match: z.enum(['all', 'any']).optional(),
  rating: z.coerce.number().int().min(1).max(10).optional(),
  sort: z.enum(['created', 'rating', 'avg_rating', 'last_worn', 'most_worn']).optional(),
  owner: z.string().uuid().optional(),
});

const wearSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const ratingSchema = z.object({ value: z.number().int().min(1).max(10).nullable() });
const tagBodySchema = z.object({ name: tagName });

const handleGarmentError = (res, err, fallback) => {
  if (err.code === 'GARMENT_NOT_FOUND') {
    return res.status(400).json({ error: 'One or more garments not found' });
  }
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

router.get('/', validateQuery(listQuerySchema), async (req, res) => {
  try {
    const outfits = await outfitService.list(pool, req.scope, req.validatedQuery);
    res.json({ outfits });
  } catch (err) {
    console.error('List outfits error:', err);
    res.status(500).json({ error: 'Failed to list outfits' });
  }
});

router.post('/', validateBody(createSchema), async (req, res) => {
  try {
    const outfit = await outfitService.create(pool, req.scope, req.validatedData);
    res.status(201).json({ outfit });
  } catch (err) {
    handleGarmentError(res, err, 'Failed to create outfit');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const outfit = await outfitService.getById(pool, req.scope, req.params.id);
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    res.json({ outfit });
  } catch (err) {
    console.error('Get outfit error:', err);
    res.status(500).json({ error: 'Failed to get outfit' });
  }
});

router.patch('/:id', validateBody(updateSchema), async (req, res) => {
  try {
    const outfit = await outfitService.update(pool, req.scope, req.params.id, req.validatedData);
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    res.json({ outfit });
  } catch (err) {
    handleGarmentError(res, err, 'Failed to update outfit');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const removed = await outfitService.remove(pool, req.scope, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Outfit not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Delete outfit error:', err);
    res.status(500).json({ error: 'Failed to delete outfit' });
  }
});

router.put('/:id/rating', validateBody(ratingSchema), async (req, res) => {
  try {
    const outfit = await outfitService.setRatingById(pool, req.scope, req.params.id, req.validatedData.value);
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    res.json({ outfit });
  } catch (err) {
    console.error('Rate outfit error:', err);
    res.status(500).json({ error: 'Failed to rate outfit' });
  }
});

router.post('/:id/tags', validateBody(tagBodySchema), async (req, res) => {
  try {
    const outfit = await outfitService.addTagById(pool, req.scope, req.params.id, req.validatedData.name);
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    res.json({ outfit });
  } catch (err) {
    console.error('Add outfit tag error:', err);
    res.status(500).json({ error: 'Failed to add tag' });
  }
});

router.delete('/:id/tags/:name', async (req, res) => {
  try {
    const outfit = await outfitService.removeTagById(pool, req.scope, req.params.id, req.params.name);
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    res.json({ outfit });
  } catch (err) {
    console.error('Remove outfit tag error:', err);
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

router.post('/:id/wear', requireOwner, validateBody(wearSchema), async (req, res) => {
  try {
    const date = req.validatedData.date || new Date().toISOString().slice(0, 10);
    const outfit = await outfitService.recordWear(pool, req.scope, req.params.id, date);
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    res.json({ outfit });
  } catch (err) {
    console.error('Record outfit wear error:', err);
    res.status(500).json({ error: 'Failed to record wear' });
  }
});

// The outfit's own image (separate from its garments' images). Owner only.
router.put('/:id/image', requireOwner, receiveImage, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file' });

    const row = await outfitService.getRow(pool, req.scope, req.params.id);
    if (!row) return res.status(404).json({ error: 'Outfit not found' });

    let img;
    try {
      img = await storeUpload(req.file.buffer, `users/${row.user_id}/outfits/${row.id}`);
    } catch (err) {
      if (err.code === 'UNSUPPORTED_TYPE') {
        return res.status(415).json({ error: 'Unsupported image type (use JPEG, PNG, WebP or HEIC)' });
      }
      throw err;
    }

    const outfit = await outfitService.setImage(pool, req.scope, row.id, img);

    if (row.image_key_prefix && row.image_key_prefix !== img.keyPrefix) {
      await imageStore.delPrefix(row.image_key_prefix)
        .catch((e) => console.error('Old outfit image cleanup failed:', e));
    }

    res.json({ outfit });
  } catch (err) {
    console.error('Upload outfit image error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

router.delete('/:id/image', requireOwner, async (req, res) => {
  try {
    const row = await outfitService.getRow(pool, req.scope, req.params.id);
    if (!row) return res.status(404).json({ error: 'Outfit not found' });

    const outfit = await outfitService.clearImage(pool, req.scope, req.params.id);
    if (row.image_key_prefix) {
      await imageStore.delPrefix(row.image_key_prefix)
        .catch((e) => console.error('Outfit image cleanup failed:', e));
    }
    res.json({ outfit });
  } catch (err) {
    console.error('Delete outfit image error:', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

module.exports = router;
