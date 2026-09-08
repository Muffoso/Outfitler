// Runs fn inside a transaction on a dedicated client from the pool. fn receives
// the client; whatever it returns is passed through once the transaction commits.
const withTransaction = async (pool, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = withTransaction;
