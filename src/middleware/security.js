const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');

const setupSecurity = (app) => {
  // 1. Helmet for security headers
  app.use(helmet({
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
      reportOnly: config.nodeEnv !== 'production',
    },
    frameguard: {
      action: 'deny',
    },
    noSniff: true,
    referrerPolicy: {
      policy: 'no-referrer',
    },
  }));

  // 2. CORS
  app.use(cors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // 3. Rate limiters (applied to specific routes later)
  const createLimiter = (windowMs, max, message) =>
    rateLimit({
      windowMs,
      max,
      message,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({ error: message });
      },
    });

  app.locals.limiters = {
    general: createLimiter(15 * 60 * 1000, 100, 'Too many requests, please try again later'),
    auth: createLimiter(15 * 60 * 1000, 5, 'Too many login/register attempts, please try again later'),
    resetPassword: createLimiter(30 * 60 * 1000, 3, 'Too many password reset attempts, please try again later'),
  };

  // 4. Body parser with size limit
  app.use(require('express').json({ limit: '10kb' }));
};

module.exports = setupSecurity;
