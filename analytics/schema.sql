-- One row per page view. No IP address is ever stored: `visitor` is a salted
-- hash that rotates daily, so the same person is one visitor within a day and
-- unlinkable across days.
CREATE TABLE IF NOT EXISTS hits (
  ts      INTEGER NOT NULL,
  day     TEXT    NOT NULL,
  path    TEXT    NOT NULL,
  country TEXT    NOT NULL,
  ref     TEXT    NOT NULL,
  visitor TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS hits_day ON hits(day);
CREATE INDEX IF NOT EXISTS hits_day_visitor ON hits(day, visitor);
