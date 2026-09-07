const express = require('express');
const passport = require('../passport/googleStrategy');
const tokenService = require('../services/tokenService');
const crypto = require('crypto');
const config = require('../config');

const router = express.Router();

router.get('/google', (req, res, next) => {
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  req.session.oauthNonce = nonce;
  req.session.save((err) => {
    if (err) {
      console.error('[OAuth] Failed to save session:', err);
      return res.redirect('/login.html');
    }
    passport.authenticate('google', {
      scope: ['openid', 'email', 'profile'],
      state,
      nonce,
    })(req, res, next);
  });
});

router.get('/google/callback', (req, res, next) => {
  if (!req.query.state || req.query.state !== req.session.oauthState) {
    console.error('[OAuth] State mismatch or missing');
    return res.redirect('/login.html');
  }
  delete req.session.oauthState;
  passport.authenticate('google', {
    failureRedirect: '/login.html',
    session: false,
  })(req, res, () => {
    console.log('[OAuth] Passport done, user:', req.user);
    if (!req.user) {
      console.log('[OAuth] No user, redirecting to login');
      return res.redirect('/login.html');
    }

    try {
      const accessToken = tokenService.signAccessToken(req.user.id, req.user.email);
      const refreshToken = tokenService.generateRefreshToken();
      const family = crypto.randomUUID();

      const pool = require('../db/pool');

      pool.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at) VALUES ($1, $2, $3, $4)',
        [
          req.user.id,
          require('../services/passwordService').hashToken(refreshToken),
          family,
          new Date(Date.now() + config.refreshTokenMaxAgeSeconds * 1000),
        ]
      ).then(() => {
        tokenService.setRefreshCookie(res, refreshToken);

        res.cookie('oauth_access_token', accessToken, {
          httpOnly: false,
          secure: config.nodeEnv === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: 10000,
        });

        res.redirect('/');
      }).catch(err => {
        console.error('Error storing refresh token:', err);
        res.redirect('/login.html');
      });
    } catch (err) {
      console.error('OAuth callback error:', err);
      res.redirect('/login.html');
    }
  });
});

module.exports = router;
