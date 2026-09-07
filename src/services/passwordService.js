const argon2 = require('argon2');
const crypto = require('crypto');

const hashPassword = async (plaintext) => {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
};

const verifyPassword = async (hash, plaintext) => {
  try {
    return await argon2.verify(hash, plaintext);
  } catch (err) {
    return false;
  }
};

const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const hashToken = (plaintext) => {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
};

const createPasswordResetToken = async (pool, userId) => {
  const plaintoken = generateResetToken();
  const tokenHash = hashToken(plaintoken);

  await pool.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );

  return plaintoken;
};

const consumePasswordResetToken = async (pool, plaintextToken) => {
  const tokenHash = hashToken(plaintextToken);

  const result = await pool.query(
    'SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
    [tokenHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const userId = result.rows[0].user_id;

  await pool.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1',
    [tokenHash]
  );

  return userId;
};

module.exports = {
  hashPassword,
  verifyPassword,
  generateResetToken,
  hashToken,
  createPasswordResetToken,
  consumePasswordResetToken,
};
