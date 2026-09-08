-- Wear tracking. "Using" an outfit records one outfit_wears row plus one
-- garment_wears row per garment in the outfit; a garment can also be recorded
-- as worn on its own (outfit_id NULL). worn_on is a plain date, editable by the
-- user (defaults to today in the UI).

CREATE TABLE IF NOT EXISTS outfit_wears (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id  UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worn_on    DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS garment_wears (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  garment_id UUID NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worn_on    DATE NOT NULL,
  outfit_id  UUID REFERENCES outfits(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outfit_wears_outfit ON outfit_wears(outfit_id);
CREATE INDEX IF NOT EXISTS idx_garment_wears_garment ON garment_wears(garment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON outfit_wears TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON garment_wears TO app_user;
