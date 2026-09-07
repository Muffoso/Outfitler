const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const authService = require('../services/authService');
const tokenService = require('../services/tokenService');
const passwordService = require('../services/passwordService');
const emailService = require('../services/emailService');
const { authenticate, requireAuth } = require('../middleware/authenticate');

const router = express.Router();

const validateRequest = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid request', details: result.error.errors });
  }
  req.validatedData = result.data;
  next();
};

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

const resetPasswordSchema = z.object({
  token: z.string().length(64),
  password: z.string().min(8).max(128),
});

// Register
router.post('/register', validateRequest(registerSchema), async (req, res) => {
  try {
    const { email, password } = req.validatedData;
    const user = await authService.register(pool, email, password);

    const accessToken = tokenService.signAccessToken(user.id, user.email);
    const refreshToken = tokenService.generateRefreshToken();
    const family = require('crypto').randomUUID();

    await tokenService.storeRefreshToken(pool, user.id, refreshToken, family);
    tokenService.setRefreshCookie(res, refreshToken);

    res.status(201).json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
    });
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', validateRequest(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.validatedData;
    const user = await authService.login(pool, email, password);

    const accessToken = tokenService.signAccessToken(user.id, user.email);
    const refreshToken = tokenService.generateRefreshToken();
    const family = require('crypto').randomUUID();

    await tokenService.storeRefreshToken(pool, user.id, refreshToken, family);
    tokenService.setRefreshCookie(res, refreshToken);

    res.status(200).json({
      accessToken,
      user,
    });
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh
router.post('/refresh', authenticate, async (req, res) => {
  try {
    const refreshToken = req.signedCookies.refresh_token;

    if (!refreshToken) {
      tokenService.clearRefreshCookie(res);
      return res.status(401).json({ error: 'No refresh token' });
    }

    const result = await tokenService.rotateRefreshToken(pool, refreshToken);

    if (!result) {
      tokenService.clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const { newPlaintextToken, userId } = result;

    const user = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const accessToken = tokenService.signAccessToken(userId, user.rows[0].email);

    tokenService.setRefreshCookie(res, newPlaintextToken);

    res.status(200).json({ accessToken });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.signedCookies.refresh_token;

    if (refreshToken) {
      const tokenHash = passwordService.hashToken(refreshToken);
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
        [tokenHash]
      );
    }

    tokenService.clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Forgot password
router.post('/forgot-password', validateRequest(forgotPasswordSchema), async (req, res) => {
  try {
    const { email } = req.validatedData;

    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length > 0) {
      const userId = result.rows[0].id;
      const resetToken = await passwordService.createPasswordResetToken(pool, userId);
      await emailService.sendPasswordResetEmail(email, resetToken);
    }

    res.status(200).json({ message: 'If email exists, password reset link will be sent' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Request failed' });
  }
});

// Reset password
router.post('/reset-password', validateRequest(resetPasswordSchema), async (req, res) => {
  try {
    const { token, password } = req.validatedData;

    const userId = await passwordService.consumePasswordResetToken(pool, token);

    if (!userId) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await passwordService.hashPassword(password);

    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, userId]
    );

    await authService.revokeAllUserTokens(pool, userId);

    res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

module.exports = router;
