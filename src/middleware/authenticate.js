const { verifyAccessToken } = require('../services/tokenService');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    req.user = null;
    return next();
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer') {
    req.user = null;
    return next();
  }

  const decoded = verifyAccessToken(token);

  if (!decoded) {
    req.user = null;
    return next();
  }

  req.user = {
    id: decoded.sub,
    email: decoded.email,
  };

  next();
};

const requireAuth = (req, res, next) => {
  authenticate(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
};

module.exports = {
  authenticate,
  requireAuth,
};
