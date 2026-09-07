const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;

if (!migrationDatabaseUrl) {
  console.error('❌ MIGRATION_DATABASE_URL environment variable is not set');
  process.exit(1);
}

const migrationsDir = path.join(__dirname, '../db/migrations');

async function migrate() {
  const client = new Client({
    connectionString: migrationDatabaseUrl,
    ssl: migrationDatabaseUrl?.includes('railway.internal') ? false : { rejectUnauthorized: true },
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`✅ Executed: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed to execute ${file}:`, err.message);
        process.exit(1);
      }
    }

    console.log('✅ All migrations completed successfully');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
