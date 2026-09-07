if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = require('./src/app');
const config = require('./src/config');
const pool = require('./src/db/pool');

const server = app.listen(config.port, () => {
  console.log(`✅ Server running on port ${config.port}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await pool.end();
    console.log('✅ Server shut down');
    process.exit(0);
  });
});
