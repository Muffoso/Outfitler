-- Track who last edited an item's shared notes, so a friend's note edits can be
-- surfaced on their contributions view. See plan/outfitler_overview.md §9.
-- Idempotent.

ALTER TABLE garments ADD COLUMN IF NOT EXISTS notes_updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE garments ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMPTZ;

ALTER TABLE outfits ADD COLUMN IF NOT EXISTS notes_updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_garments_notes_updated_by ON garments(notes_updated_by) WHERE notes_updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outfits_notes_updated_by ON outfits(notes_updated_by) WHERE notes_updated_by IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON garments, outfits TO app_user;
