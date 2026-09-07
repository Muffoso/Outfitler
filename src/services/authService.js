const { hashPassword, verifyPassword } = require('./passwordService');

const register = async (pool, email, password) => {
  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (existingUser.rows.length > 0) {
    const error = new Error('Email already registered');
    error.code = 'EMAIL_TAKEN';
    throw error;
  }

  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, display_name',
    [normalizedEmail, passwordHash]
  );

  return result.rows[0];
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

  let user = await pool.query(
    'SELECT id, email, display_name FROM users WHERE google_id = $1',
    [googleId]
  );

  if (user.rows.length > 0) {
    return user.rows[0];
  }

  user = await pool.query(
    'SELECT id, email, display_name, google_id FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (user.rows.length > 0) {
    await pool.query(
      'UPDATE users SET google_id = $1 WHERE id = $2',
      [googleId, user.rows[0].id]
    );
    return user.rows[0];
  }

  const newUser = await pool.query(
    'INSERT INTO users (email, google_id, display_name, avatar_url, email_verified) VALUES ($1, $2, $3, $4, true) RETURNING id, email, display_name',
    [normalizedEmail, googleId, displayName, avatarUrl]
  );

  return newUser.rows[0];
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
