const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const postgres = require('connect-pg-simple');
const passport = require('passport');
const setupSecurity = require('./middleware/security');
const pool = require('./db/pool');
const config = require('./config');

const app = express();

// Trust Railway's proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);

// Cookie parser with secret for signed cookies
app.use(cookieParser(config.sessionSecret));

// Security middleware (helmet, cors, rate limiters, json body parser)
setupSecurity(app);

// Session (for OAuth handshake state/nonce)
const PostgresqlStore = postgres(session);
app.use(session({
  store: new PostgresqlStore({
    pool,
    errorLog: (err) => console.error('[SessionStore] Error:', err),
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60, // 1 hour
  },
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/auth', require('./routes/oauth'));

// Static files (last, so API routes take precedence). "/" serves public/index.html.
app.use(express.static('public'));

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
