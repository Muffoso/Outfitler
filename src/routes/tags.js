const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const tagService = require('../services/tagService');
const { requireAuth } = require('../middleware/authenticate');

const router = express.Router();

router.use(requireAuth);

router.param('id', (req, res, next, value) => {
  if (!z.string().uuid().safeParse(value).success) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  next();
});

// Tags are created implicitly when set on a garment or outfit, so there is no
// POST here — only listing (with usage counts) and deletion.
router.get('/', async (req, res) => {
  try {
    const tags = await tagService.listForOwner(pool, req.user.id);
    res.json({ tags });
  } catch (err) {
    console.error('List tags error:', err);
    res.status(500).json({ error: 'Failed to list tags' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const removed = await tagService.remove(pool, req.user.id, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Tag not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Delete tag error:', err);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

module.exports = router;
