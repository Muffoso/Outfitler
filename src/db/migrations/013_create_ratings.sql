-- Multi-user ratings: one row per (item, user). The owner's own rating is also
-- mirrored back to garments.rating / outfits.rating as a transitional scaffold
-- (dropped in a later migration once every read path uses these tables).
-- See plan/outfitler_overview.md §9. Idempotent.

CREATE TABLE IF NOT EXISTS garment_ratings (
  garment_id UUID NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value      SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (garment_id, user_id)
);
ALTER TABLE garment_ratings DROP CONSTRAINT IF EXISTS garment_ratings_value_check;
ALTER TABLE garment_ratings ADD CONSTRAINT garment_ratings_value_check CHECK (value BETWEEN 1 AND 10);

CREATE TABLE IF NOT EXISTS outfit_ratings (
  outfit_id  UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value      SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outfit_id, user_id)
);
ALTER TABLE outfit_ratings DROP CONSTRAINT IF EXISTS outfit_ratings_value_check;
ALTER TABLE outfit_ratings ADD CONSTRAINT outfit_ratings_value_check CHECK (value BETWEEN 1 AND 10);

CREATE INDEX IF NOT EXISTS idx_garment_ratings_user ON garment_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_outfit_ratings_user ON outfit_ratings(user_id);

-- Backfill each owner's existing rating as their row in the new table.
INSERT INTO garment_ratings (garment_id, user_id, value)
SELECT id, user_id, rating FROM garments WHERE rating IS NOT NULL
ON CONFLICT (garment_id, user_id) DO NOTHING;

INSERT INTO outfit_ratings (outfit_id, user_id, value)
SELECT id, user_id, rating FROM outfits WHERE rating IS NOT NULL
ON CONFLICT (outfit_id, user_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON garment_ratings, outfit_ratings TO app_user;
