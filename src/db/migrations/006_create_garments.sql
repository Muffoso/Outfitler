-- A garment is essentially a photo with a rating, free-text notes and tags.
-- No name/category/colour/brand by design (see plan/outfitler_overview.md §2).
-- The image_* columns mirror plan/image_storage.md §7 and stay NULL until an
-- image is uploaded (max one image per garment).

CREATE TABLE IF NOT EXISTS garments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_key_prefix  TEXT,
  image_variants    JSONB,
  image_width       INTEGER,
  image_height      INTEGER,
  image_bytes       INTEGER,
  image_hash        TEXT,
  image_updated_at  TIMESTAMPTZ,
  rating            SMALLINT CHECK (rating BETWEEN 1 AND 5),
  notes             TEXT,
  archived          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_garments_user_id ON garments(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON garments TO app_user;
