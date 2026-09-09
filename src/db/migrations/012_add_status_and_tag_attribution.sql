-- Friend-contributed garments/outfits become "suggestions" the owner accepts or
-- ignores; friend-added tags are applied directly but attributed. See
-- plan/outfitler_overview.md §9. Idempotent: every statement is re-run safe.

ALTER TABLE garments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE garments DROP CONSTRAINT IF EXISTS garments_status_check;
ALTER TABLE garments ADD CONSTRAINT garments_status_check CHECK (status IN ('active', 'suggested'));
ALTER TABLE garments ADD COLUMN IF NOT EXISTS suggested_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE outfits ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE outfits DROP CONSTRAINT IF EXISTS outfits_status_check;
ALTER TABLE outfits ADD CONSTRAINT outfits_status_check CHECK (status IN ('active', 'suggested'));
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS suggested_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_garments_suggested ON garments(user_id) WHERE status = 'suggested';
CREATE INDEX IF NOT EXISTS idx_outfits_suggested ON outfits(user_id) WHERE status = 'suggested';
CREATE INDEX IF NOT EXISTS idx_garments_suggested_by ON garments(suggested_by) WHERE suggested_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outfits_suggested_by ON outfits(suggested_by) WHERE suggested_by IS NOT NULL;

-- Tag link attribution. PK stays (item_id, tag_id): a friend tag resolves to the
-- owner's tag_id, so "summer" added by two people is one link row. added_by NULL
-- means the owner / a link that predates this migration.
ALTER TABLE garment_tags ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE garment_tags ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE outfit_tags ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE outfit_tags ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

GRANT SELECT, INSERT, UPDATE, DELETE ON garments, outfits, garment_tags, outfit_tags TO app_user;
