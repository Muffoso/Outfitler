-- Ratings go 1–10 (was 1–5). DROP IF EXISTS + ADD is idempotent because the
-- drop always clears the way for the re-add on every migration re-run.

ALTER TABLE garments DROP CONSTRAINT IF EXISTS garments_rating_check;
ALTER TABLE garments ADD CONSTRAINT garments_rating_check CHECK (rating BETWEEN 1 AND 10);

ALTER TABLE outfits DROP CONSTRAINT IF EXISTS outfits_rating_check;
ALTER TABLE outfits ADD CONSTRAINT outfits_rating_check CHECK (rating BETWEEN 1 AND 10);
