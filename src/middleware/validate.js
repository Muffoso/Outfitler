// Zod validation middleware. On success the parsed data is put on req; on
// failure a 400 is returned with the issue list.

const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid request', details: result.error.errors });
  }
  req.validatedData = result.data;
  next();
};

const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid query', details: result.error.errors });
  }
  req.validatedQuery = result.data;
  next();
};

module.exports = { validateBody, validateQuery };
