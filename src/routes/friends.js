const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const friendService = require('../services/friendService');
const contributionService = require('../services/contributionService');
const { requireAuth } = require('../middleware/authenticate');
const { validateBody } = require('../middleware/validate');

const router = express.Router();

router.use(requireAuth);

const uuid = (name) => (req, res, next, value) => {
  if (!z.string().uuid().safeParse(value).success) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
};
router.param('id', uuid('id'));
router.param('userId', uuid('userId'));

const inviteSchema = z.object({
  email: z.string().email().max(254),
  connect: z.boolean().optional(),
});

router.get('/', async (req, res) => {
  try {
    res.json(await friendService.list(pool, req.user.id));
  } catch (err) {
    console.error('List friends error:', err);
    res.status(500).json({ error: 'Failed to load friends' });
  }
});

router.post('/', validateBody(inviteSchema), async (req, res) => {
  try {
    const { email, connect } = req.validatedData;
    const result = await friendService.invite(
      pool, req.user.id, req.user.email, email, connect !== false
    );
    const code = result.status === 'accepted' ? 200 : 201;
    res.status(code).json(result);
  } catch (err) {
    if (err.code === 'SELF') return res.status(400).json({ error: 'Du kan inte lägga till dig själv' });
    if (err.code === 'ALREADY_FRIENDS') return res.status(409).json({ error: 'Ni är redan vänner' });
    if (err.code === 'CAP') return res.status(400).json({ error: 'För många väntande inbjudningar' });
    console.error('Invite friend error:', err);
    res.status(500).json({ error: 'Kunde inte skicka inbjudan' });
  }
});

router.get('/:userId/contributions', async (req, res) => {
  try {
    if (!(await friendService.areFriends(pool, req.user.id, req.params.userId))) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(await contributionService.from(pool, req.user.id, req.params.userId));
  } catch (err) {
    console.error('Friend contributions error:', err);
    res.status(500).json({ error: 'Failed to load contributions' });
  }
});

router.post('/requests/:id/accept', async (req, res) => {
  try {
    const friend = await friendService.accept(pool, req.user.id, req.params.id);
    if (!friend) return res.status(404).json({ error: 'Not found' });
    res.json({ status: 'accepted', friend });
  } catch (err) {
    console.error('Accept friend error:', err);
    res.status(500).json({ error: 'Kunde inte acceptera' });
  }
});

router.post('/requests/:id/decline', async (req, res) => {
  try {
    const ok = await friendService.decline(pool, req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Decline friend error:', err);
    res.status(500).json({ error: 'Kunde inte avböja' });
  }
});

router.delete('/requests/:id', async (req, res) => {
  try {
    const ok = await friendService.cancel(pool, req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Cancel friend request error:', err);
    res.status(500).json({ error: 'Kunde inte ångra' });
  }
});

router.delete('/invites/:id', async (req, res) => {
  try {
    const ok = await friendService.cancelInvite(pool, req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Cancel invite error:', err);
    res.status(500).json({ error: 'Kunde inte ångra' });
  }
});

router.delete('/:userId', async (req, res) => {
  try {
    const ok = await friendService.removeFriend(pool, req.user.id, req.params.userId);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ error: 'Kunde inte ta bort vän' });
  }
});

module.exports = router;
