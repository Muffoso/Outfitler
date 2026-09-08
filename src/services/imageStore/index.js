// Storage abstraction: app code depends on this shape, not on a provider.
//   put(key, body, contentType) -> Promise
//   signedUrl(key, ttlSeconds?) -> Promise<string>
//   del(keys[]) -> Promise
//   delPrefix(prefix) -> Promise<number>
// Only the R2 driver exists today. A local-disk driver can be slotted in here
// for local development without touching callers.

module.exports = require('./r2');
