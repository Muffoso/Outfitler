-- Outfits get their own image (in addition to being shown as their garments'
-- images). Same columns as garments; see plan/image_storage.md §7.
-- ADD COLUMN IF NOT EXISTS makes this safe to re-run.

ALTER TABLE outfits ADD COLUMN IF NOT EXISTS image_key_prefix TEXT;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS image_variants JSONB;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS image_width INTEGER;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS image_height INTEGER;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS image_bytes INTEGER;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS image_hash TEXT;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS image_updated_at TIMESTAMPTZ;
