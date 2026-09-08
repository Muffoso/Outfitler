const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const outfitService = require('../services/outfitService');
const { requireAuth } = require('../middleware/authenticate');
const { validateBody, validateQuery } = require('../middleware/validate');

const router = express.Router();

router.use(requireAuth);

router.param('id', (req, res, next, value) => {
  if (!z.string().uuid().safeParse(value).success) {
    return res.status(404).json({ error: 'Outfit not found' });
  }
  next();
});

const rating = z.number().int().min(1).max(5).nullable();
const notes = z.string().max(2000).nullable();
const tags = z.array(z.string().trim().min(1).max(50)).max(50);
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
  tag: z.string().trim().min(1).max(50).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

const handleGarmentError = (res, err, fallback) => {
  if (err.code === 'GARMENT_NOT_FOUND') {
    return res.status(400).json({ error: 'One or more garments not found' });
  }
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

router.get('/', validateQuery(listQuerySchema), async (req, res) => {
  try {
    const outfits = await outfitService.list(pool, req.user.id, req.validatedQuery);
    res.json({ outfits });
  } catch (err) {
    console.error('List outfits error:', err);
    res.status(500).json({ error: 'Failed to list outfits' });
  }
});

router.post('/', validateBody(createSchema), async (req, res) => {
  try {
    const outfit = await outfitService.create(pool, req.user.id, req.validatedData);
    res.status(201).json({ outfit });
  } catch (err) {
    handleGarmentError(res, err, 'Failed to create outfit');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const outfit = await outfitService.getById(pool, req.user.id, req.params.id);
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    res.json({ outfit });
  } catch (err) {
    console.error('Get outfit error:', err);
    res.status(500).json({ error: 'Failed to get outfit' });
  }
});

router.patch('/:id', validateBody(updateSchema), async (req, res) => {
  try {
    const outfit = await outfitService.update(pool, req.user.id, req.params.id, req.validatedData);
    if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
    res.json({ outfit });
  } catch (err) {
    handleGarmentError(res, err, 'Failed to update outfit');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const removed = await outfitService.remove(pool, req.user.id, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Outfit not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Delete outfit error:', err);
    res.status(500).json({ error: 'Failed to delete outfit' });
  }
});

module.exports = router;
