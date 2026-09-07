const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { hashToken } = require('./passwordService');

const signAccessToken = (userId, email) => {
  return jwt.sign(
    { sub: userId, email },
    config.jwtSecret,
    { expiresIn: config.jwtAccessExpiresIn, algorithm: 'HS256' }
  );
};

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
};

const generateRefreshToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const storeRefreshToken = async (pool, userId, plaintextToken, family) => {
  const tokenHash = hashToken(plaintextToken);
  const expiresAt = new Date(Date.now() + config.refreshTokenMaxAgeSeconds * 1000);

  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, tokenHash, family, expiresAt]
  );
};

const rotateRefreshToken = async (pool, plaintextToken) => {
  const tokenHash = hashToken(plaintextToken);

  const result = await pool.query(
    'SELECT id, user_id, family, revoked_at FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()',
    [tokenHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const { id, user_id: userId, family, revoked_at } = result.rows[0];

  // Check if token is revoked
  if (revoked_at) {
    // Token family compromised - revoke all tokens in family
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE family = $1',
      [family]
    );
    return null;
  }

  // Revoke old token
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
    [id]
  );

  // Generate new token
  const newPlaintextToken = generateRefreshToken();
  const newTokenHash = hashToken(newPlaintextToken);
  const expiresAt = new Date(Date.now() + config.refreshTokenMaxAgeSeconds * 1000);

  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, newTokenHash, family, expiresAt]
  );

  return { newPlaintextToken, userId };
};

const setRefreshCookie = (res, plaintextToken) => {
  res.cookie('refresh_token', plaintextToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: config.refreshTokenMaxAgeSeconds * 1000,
    signed: true,
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
    signed: true,
  });
};

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
};
