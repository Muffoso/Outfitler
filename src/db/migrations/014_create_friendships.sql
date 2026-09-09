-- Friends: invite by email, the other person accepts, then both may visit each
-- other's wardrobe. Invites to an address without an account yet wait in
-- friend_invites until that address signs in. See plan/outfitler_overview.md §9.
-- Idempotent.

CREATE TABLE IF NOT EXISTS friendships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);
ALTER TABLE friendships DROP CONSTRAINT IF EXISTS friendships_status_check;
ALTER TABLE friendships ADD CONSTRAINT friendships_status_check CHECK (status IN ('pending', 'accepted'));
ALTER TABLE friendships DROP CONSTRAINT IF EXISTS friendships_no_self;
ALTER TABLE friendships ADD CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id);

-- One row per pair, in either direction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_friendships_pair
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);

CREATE TABLE IF NOT EXISTS friend_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  token        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_friend_invites_pair ON friend_invites(requester_id, email);
CREATE INDEX IF NOT EXISTS idx_friend_invites_email ON friend_invites(email);

-- Accepted friendships, both directions, as (user_id -> friend_id).
CREATE OR REPLACE VIEW accepted_friends AS
  SELECT requester_id AS user_id, addressee_id AS friend_id, created_at
  FROM friendships WHERE status = 'accepted'
  UNION ALL
  SELECT addressee_id AS user_id, requester_id AS friend_id, created_at
  FROM friendships WHERE status = 'accepted';

GRANT SELECT, INSERT, UPDATE, DELETE ON friendships, friend_invites TO app_user;
GRANT SELECT ON accepted_friends TO app_user;
