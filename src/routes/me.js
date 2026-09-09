const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const friendService = require('../services/friendService');
const { requireAuth } = require('../middleware/authenticate');
const { validateBody } = require('../middleware/validate');

const router = express.Router();

router.use(requireAuth);

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
});

const counts = async (userId) => {
  const [friendRequests, suggestions] = await Promise.all([
    friendService.countIncomingRequests(pool, userId),
    pool.query(
      `SELECT
         (SELECT count(*) FROM garments WHERE user_id = $1 AND status = 'suggested')
       + (SELECT count(*) FROM outfits  WHERE user_id = $1 AND status = 'suggested') AS n`,
      [userId]
    ).then((r) => Number(r.rows[0].n)),
  ]);
  return { friendRequests, suggestions };
};

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, display_name FROM users WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: rows[0].id,
      email: rows[0].email,
      displayName: rows[0].display_name,
      counts: await counts(req.user.id),
    });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Failed to load account' });
  }
});

router.patch('/', validateBody(updateSchema), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, display_name',
      [req.validatedData.displayName, req.user.id]
    );
    res.json({ id: rows[0].id, email: rows[0].email, displayName: rows[0].display_name });
  } catch (err) {
    console.error('Update me error:', err);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

module.exports = router;
