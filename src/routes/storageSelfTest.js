// TEMPORARY — Fas 4b verification of the R2 image store. Does a full
// put -> sign -> fetch -> delete roundtrip and reports each step.
// Remove this file and its mount in app.js at the start of Fas 5.

const express = require('express');
const crypto = require('crypto');
const imageStore = require('../services/imageStore');
const { requireAuth } = require('../middleware/authenticate');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const key = `_selftest/${crypto.randomUUID()}.txt`;
  const payload = `outfitler r2 selftest ${new Date().toISOString()}`;
  const steps = [];
  try {
    await imageStore.put(key, Buffer.from(payload), 'text/plain');
    steps.push('put ok');

    const url = await imageStore.signedUrl(key, 300);
    steps.push('signed url ok');

    const fetched = await fetch(url);
    const body = await fetched.text();
    steps.push(`fetch ${fetched.status}, body matches: ${body === payload}`);

    const removed = await imageStore.delPrefix('_selftest/');
    steps.push(`cleaned ${removed} object(s)`);

    res.json({ ok: fetched.ok && body === payload, steps });
  } catch (err) {
    console.error('R2 selftest error:', err);
    res.status(500).json({ ok: false, steps, error: err.message });
  }
});

module.exports = router;
