-- Adds where-from and what-device columns, plus a random per-browser id kept in
-- localStorage so a returning visitor is the same visitor across days. Rows from
-- before this have them empty. Run once against the live database.
ALTER TABLE hits ADD COLUMN city    TEXT    NOT NULL DEFAULT '';
ALTER TABLE hits ADD COLUMN region  TEXT    NOT NULL DEFAULT '';
ALTER TABLE hits ADD COLUMN org     TEXT    NOT NULL DEFAULT '';
ALTER TABLE hits ADD COLUMN asn     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hits ADD COLUMN browser TEXT    NOT NULL DEFAULT '';
ALTER TABLE hits ADD COLUMN os      TEXT    NOT NULL DEFAULT '';
ALTER TABLE hits ADD COLUMN device  TEXT    NOT NULL DEFAULT '';
ALTER TABLE hits ADD COLUMN vid     TEXT    NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS hits_vid ON hits(vid);
