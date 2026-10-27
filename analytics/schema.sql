-- One row per page view. No IP address is ever stored: `visitor` is a salted
-- hash that rotates daily, so the same person is one visitor within a day and
-- unlinkable across days. city, region, org and asn come from Cloudflare's
-- edge geolocation; browser, os and device are parsed from the user-agent.
CREATE TABLE IF NOT EXISTS hits (
  ts      INTEGER NOT NULL,
  day     TEXT    NOT NULL,
  path    TEXT    NOT NULL,
  country TEXT    NOT NULL,
  ref     TEXT    NOT NULL,
  visitor TEXT    NOT NULL,
  city    TEXT    NOT NULL DEFAULT '',
  region  TEXT    NOT NULL DEFAULT '',
  org     TEXT    NOT NULL DEFAULT '',
  asn     INTEGER NOT NULL DEFAULT 0,
  browser TEXT    NOT NULL DEFAULT '',
  os      TEXT    NOT NULL DEFAULT '',
  device  TEXT    NOT NULL DEFAULT '',
  vid     TEXT    NOT NULL DEFAULT ''   -- random id kept in the browser's localStorage
);

CREATE INDEX IF NOT EXISTS hits_day ON hits(day);
CREATE INDEX IF NOT EXISTS hits_day_visitor ON hits(day, visitor);
CREATE INDEX IF NOT EXISTS hits_vid ON hits(vid);
