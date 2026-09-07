const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const config = require('../config');
const pool = require('../db/pool');
const authService = require('../services/authService');

// Subclass to forward nonce into the authorization URL — passport-google-oauth20
// v2.0.0 does not pass nonce through authorizationParams by default.
class NonceAwareGoogleStrategy extends GoogleStrategy {
  authorizationParams(options) {
    const params = super.authorizationParams(options);
    if (options.nonce) {
      params.nonce = options.nonce;
    }
    return params;
  }
}

passport.use(new NonceAwareGoogleStrategy({
  clientID: config.google.clientId,
  clientSecret: config.google.clientSecret,
  callbackURL: config.google.callbackUrl,
  passReqToCallback: true,
}, async (req, accessToken, refreshToken, params, profile, done) => {
  try {
    const expectedNonce = req.session.oauthNonce;
    const idToken = params.id_token;
    let receivedNonce = null;
    if (idToken) {
      try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
        receivedNonce = payload.nonce || null;
      } catch (e) {
        console.error('[OAuth] Failed to parse id_token:', e.message);
      }
    }

    if (!expectedNonce || !receivedNonce || expectedNonce !== receivedNonce) {
      console.error('[OAuth] Nonce verification failed');
      return done(new Error('OAuth nonce mismatch'));
    }
    delete req.session.oauthNonce;

    const user = await authService.loginWithGoogle(pool, profile);
    done(null, user);
  } catch (err) {
    done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query(
      'SELECT id, email, display_name FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return done(null, false);
    }
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
