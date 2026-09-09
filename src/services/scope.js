// A "scope" separates *whose* wardrobe a request touches (ownerId) from *who is
// acting* (viewerId). Service functions take a scope where they used to take a
// bare userId string; a plain string still means "owner === viewer" so existing
// call sites keep working unchanged.

const normalizeScope = (s) => {
  if (typeof s === 'string') return { ownerId: s, viewerId: s, isOwner: true };
  return { ...s, isOwner: s.ownerId === s.viewerId };
};

// Route helper: middleware sets req.scope for a friend visit; otherwise the
// authenticated user is both owner and viewer.
const scopeFromReq = (req) => req.scope || req.user.id;

module.exports = { normalizeScope, scopeFromReq };
