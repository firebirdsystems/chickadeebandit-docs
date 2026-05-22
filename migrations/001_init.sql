CREATE TABLE IF NOT EXISTS folders (
  household_id UUID NOT NULL DEFAULT current_setting('app.household_id', true)::uuid,
  id           TEXT NOT NULL,
  name         TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'everyone',
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (household_id, id)
);

CREATE TABLE IF NOT EXISTS documents (
  household_id UUID NOT NULL DEFAULT current_setting('app.household_id', true)::uuid,
  id           TEXT NOT NULL,
  folder_id    TEXT NOT NULL,
  file_key     TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  uploaded_by  TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL,
  PRIMARY KEY (household_id, id)
);
