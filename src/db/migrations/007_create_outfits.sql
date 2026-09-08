-- An outfit is a named collection of garments with a rating and free-text notes
-- (see plan/outfitler_overview.md §2). It has no image of its own — it is shown
-- as its garments' images. outfit_garments links the two, with `position` for
-- display order within the outfit.

CREATE TABLE IF NOT EXISTS outfits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 10),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outfit_garments (
  outfit_id   UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  garment_id  UUID NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
  position    SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (outfit_id, garment_id)
);

CREATE INDEX IF NOT EXISTS idx_outfits_user_id ON outfits(user_id);
CREATE INDEX IF NOT EXISTS idx_outfit_garments_garment_id ON outfit_garments(garment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON outfits TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON outfit_garments TO app_user;
