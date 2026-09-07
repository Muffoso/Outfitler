-- The app_user role and its password are created by src/scripts/migrate.js from
-- the APP_USER_PASSWORD env var (before this file runs). This migration only
-- grants app_user its privileges, which must happen after the tables above exist.

GRANT CONNECT ON DATABASE railway TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
