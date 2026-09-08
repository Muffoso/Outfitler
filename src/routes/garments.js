const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const garmentService = require('../services/garmentService');
const { requireAuth } = require('../middleware/authenticate');
const { validateBody, validateQuery } = require('../middleware/validate');

const router = express.Router();

router.use(requireAuth);

router.param('id', (req, res, next, value) => {
  if (!z.string().uuid().safeParse(value).success) {
    return res.status(404).json({ error: 'Garment not found' });
  }
  next();
});

const rating = z.number().int().min(1).max(5).nullable();
const notes = z.string().max(2000).nullable();
const tags = z.array(z.string().trim().min(1).max(50)).max(50);

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
  tag: z.string().trim().min(1).max(50).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  archived: z.enum(['true', 'false', 'all']).optional(),
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

module.exports = router;
