const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const garmentService = require('../services/garmentService');
const outfitService = require('../services/outfitService');
const { requireAuth } = require('../middleware/authenticate');

const router = express.Router();

router.use(requireAuth);

router.param('id', (req, res, next, value) => {
  if (!z.string().uuid().safeParse(value).success) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

router.get('/', async (req, res) => {
  try {
    const [garments, outfits] = await Promise.all([
      garmentService.listSuggestions(pool, req.user.id),
      outfitService.listSuggestions(pool, req.user.id),
    ]);
    res.json({ garments, outfits });
  } catch (err) {
    console.error('List suggestions error:', err);
    res.status(500).json({ error: 'Failed to load suggestions' });
  }
});

router.post('/garments/:id/accept', async (req, res) => {
  try {
    const garment = await garmentService.acceptSuggestion(pool, req.user.id, req.params.id);
    if (!garment) return res.status(404).json({ error: 'Not found' });
    res.json({ garment });
  } catch (err) {
    console.error('Accept garment suggestion error:', err);
    res.status(500).json({ error: 'Failed to accept suggestion' });
  }
});

router.post('/garments/:id/ignore', async (req, res) => {
  try {
    const ok = await garmentService.ignoreSuggestion(pool, req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Ignore garment suggestion error:', err);
    res.status(500).json({ error: 'Failed to ignore suggestion' });
  }
});

router.post('/outfits/:id/accept', async (req, res) => {
  try {
    const outfit = await outfitService.acceptSuggestion(pool, req.user.id, req.params.id);
    if (!outfit) return res.status(404).json({ error: 'Not found' });
    res.json({ outfit });
  } catch (err) {
    console.error('Accept outfit suggestion error:', err);
    res.status(500).json({ error: 'Failed to accept suggestion' });
  }
});

router.post('/outfits/:id/ignore', async (req, res) => {
  try {
    const ok = await outfitService.ignoreSuggestion(pool, req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Ignore outfit suggestion error:', err);
    res.status(500).json({ error: 'Failed to ignore suggestion' });
  }
});

module.exports = router;
