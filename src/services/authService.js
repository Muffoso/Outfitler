const { hashPassword, verifyPassword } = require('./passwordService');
const withTransaction = require('../db/withTransaction');
const friendService = require('./friendService');

const register = async (pool, email, password, displayName) => {
  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash = await hashPassword(password);

  return withTransaction(pool, async (client) => {
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      const error = new Error('Email already registered');
      error.code = 'EMAIL_TAKEN';
      throw error;
    }

    const result = await client.query(
      'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name',
      [normalizedEmail, passwordHash, displayName ? displayName.trim() : null]
    );

    await friendService.consumeInvites(client, result.rows[0].id, normalizedEmail);

    return result.rows[0];
  });
};

const login = async (pool, email, password) => {
  const normalizedEmail = email.toLowerCase().trim();

  const result = await pool.query(
    'SELECT id, email, password_hash, display_name FROM users WHERE email = $1',
    [normalizedEmail]
  );

  const user = result.rows[0];
  const dummyHash = '$argon2id$v=19$m=19456,t=2,p=1$0000000000000000000000$0000000000000000000000000000000000000000000';

  // Always run exactly one argon2 verify to prevent timing-based user enumeration
  const hashToVerify = user ? user.password_hash : dummyHash;
  const isPasswordValid = await verifyPassword(hashToVerify, password);

  if (!user || !isPasswordValid) {
    const error = new Error('Invalid email or password');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  // Pick up any friend invites sent to this address after registration.
  await friendService.consumeInvites(pool, user.id, user.email)
    .catch((err) => console.error('consumeInvites on login failed:', err));

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
  };
};

const loginWithGoogle = async (pool, googleProfile) => {
  const googleId = googleProfile.id;
  const googleEmail = googleProfile.emails && googleProfile.emails[0] ? googleProfile.emails[0].value : null;
  const displayName = googleProfile.displayName;
  const photos = googleProfile.photos;

  if (!googleEmail) {
    throw new Error('No email in Google profile');
  }

  const normalizedEmail = googleEmail.toLowerCase().trim();
  const avatarUrl = photos && photos[0] ? photos[0].value : null;

  let finalUser;

  const byGoogleId = await pool.query(
    'SELECT id, email, display_name FROM users WHERE google_id = $1',
    [googleId]
  );

  if (byGoogleId.rows.length > 0) {
    finalUser = byGoogleId.rows[0];
  } else {
    const byEmail = await pool.query(
      'SELECT id, email, display_name, google_id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (byEmail.rows.length > 0) {
      await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, byEmail.rows[0].id]);
      finalUser = byEmail.rows[0];
    } else {
      const newUser = await pool.query(
        'INSERT INTO users (email, google_id, display_name, avatar_url, email_verified) VALUES ($1, $2, $3, $4, true) RETURNING id, email, display_name',
        [normalizedEmail, googleId, displayName, avatarUrl]
      );
      finalUser = newUser.rows[0];
    }
  }

  await friendService.consumeInvites(pool, finalUser.id, normalizedEmail)
    .catch((err) => console.error('consumeInvites on Google login failed:', err));

  return finalUser;
};

const revokeAllUserTokens = async (pool, userId) => {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
};

module.exports = {
  register,
  login,
  loginWithGoogle,
  revokeAllUserTokens,
};
