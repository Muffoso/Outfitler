const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const tagService = require('../services/tagService');
const { requireAuth } = require('../middleware/authenticate');
const { resolveOwner, requireOwner } = require('../middleware/friendship');

const router = express.Router();

router.use(requireAuth);
router.use(resolveOwner);

router.param('id', (req, res, next, value) => {
  if (!z.string().uuid().safeParse(value).success) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  next();
});

// Tags are created implicitly when set on a garment or outfit, so there is no
// POST here — only listing (with usage counts) and deletion. `?owner=<id>` lists
// a friend's tags (read-only — never prunes their orphans).
router.get('/', async (req, res) => {
  try {
    const tags = req.scope.isOwner
      ? await tagService.listForOwner(pool, req.scope.ownerId)
      : await tagService.listVisible(pool, req.scope.ownerId);
    res.json({ tags });
  } catch (err) {
    console.error('List tags error:', err);
    res.status(500).json({ error: 'Failed to list tags' });
  }
});

router.delete('/:id', requireOwner, async (req, res) => {
  try {
    const removed = await tagService.remove(pool, req.scope.ownerId, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Tag not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Delete tag error:', err);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

module.exports = router;
