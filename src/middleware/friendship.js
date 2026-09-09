// Resolves the wardrobe a request targets. `?owner=<uuid>` (or `owner` in the
// body) selects a friend's wardrobe; anything else is the caller's own. A
// friendship miss looks exactly like "not found" (404) — the codebase never
// uses 403 for ownership.

const { z } = require('zod');
const pool = require('../db/pool');
const friendService = require('../services/friendService');

const isUuid = (v) => z.string().uuid().safeParse(v).success;

const resolveOwner = async (req, res, next) => {
  try {
    const owner = (req.query && req.query.owner) || (req.body && req.body.owner) || null;
    if (!owner || owner === req.user.id) {
      req.scope = { ownerId: req.user.id, viewerId: req.user.id, isOwner: true };
      return next();
    }
    if (!isUuid(owner) || !(await friendService.areFriends(pool, req.user.id, owner))) {
      return res.status(404).json({ error: 'Not found' });
    }
    req.scope = { ownerId: owner, viewerId: req.user.id, isOwner: false };
    next();
  } catch (err) {
    console.error('resolveOwner error:', err);
    res.status(500).json({ error: 'Failed to resolve wardrobe' });
  }
};

// Guard for routes that only the wardrobe owner may use.
const requireOwner = (req, res, next) => {
  if (!req.scope || !req.scope.isOwner) return res.status(404).json({ error: 'Not found' });
  next();
};

module.exports = { resolveOwner, requireOwner };
