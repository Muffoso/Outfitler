-- Free-form tags, scoped per user and unique case-insensitively. Created
-- implicitly when applied to a garment or outfit (see plan/outfitler_overview.md
-- §2). One tag table, two join tables — a tag can sit on garments and outfits.

CREATE TABLE IF NOT EXISTS tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_user_name ON tags(user_id, lower(name));

CREATE TABLE IF NOT EXISTS garment_tags (
  garment_id  UUID NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (garment_id, tag_id)
);

CREATE TABLE IF NOT EXISTS outfit_tags (
  outfit_id   UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (outfit_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_garment_tags_tag_id ON garment_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_outfit_tags_tag_id ON outfit_tags(tag_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON tags TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON garment_tags TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON outfit_tags TO app_user;
