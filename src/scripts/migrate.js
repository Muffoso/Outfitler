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

// app_user's password is interpolated straight into CREATE/ALTER USER (which
// cannot take bind parameters), so restrict it to a shell/SQL-safe charset.
const APP_USER_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

async function ensureAppUser(client) {
  const password = process.env.APP_USER_PASSWORD;

  if (!password) {
    console.error('❌ APP_USER_PASSWORD environment variable is not set');
    process.exit(1);
  }

  if (!APP_USER_PASSWORD_PATTERN.test(password)) {
    console.error('❌ APP_USER_PASSWORD must be at least 16 chars and use only A-Z a-z 0-9 _ -');
    process.exit(1);
  }

  const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'");
  if (rows.length === 0) {
    await client.query(`CREATE USER app_user WITH PASSWORD '${password}'`);
    console.log('✅ Created role: app_user');
  } else {
    await client.query(`ALTER USER app_user WITH PASSWORD '${password}'`);
    console.log('✅ Updated password for role: app_user');
  }
}

async function migrate() {
  const client = new Client({
    connectionString: migrationDatabaseUrl,
    ssl: migrationDatabaseUrl?.includes('railway.internal') ? false : { rejectUnauthorized: true },
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    await ensureAppUser(client);

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
