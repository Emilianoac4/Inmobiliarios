CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS render_versions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  prompt TEXT NOT NULL,
  resolution INT NOT NULL,
  views INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE render_versions ADD COLUMN IF NOT EXISTS mode VARCHAR(32);
ALTER TABLE render_versions ADD COLUMN IF NOT EXISTS prompt TEXT;
ALTER TABLE render_versions ADD COLUMN IF NOT EXISTS resolution INT;
ALTER TABLE render_versions ADD COLUMN IF NOT EXISTS views INT;

UPDATE render_versions SET mode = COALESCE(mode, 'generate');
UPDATE render_versions SET prompt = COALESCE(prompt, '');
UPDATE render_versions SET resolution = COALESCE(resolution, 2048);
UPDATE render_versions SET views = COALESCE(views, 5);

ALTER TABLE render_versions ALTER COLUMN mode SET NOT NULL;
ALTER TABLE render_versions ALTER COLUMN prompt SET NOT NULL;
ALTER TABLE render_versions ALTER COLUMN resolution SET NOT NULL;
ALTER TABLE render_versions ALTER COLUMN views SET NOT NULL;

CREATE TABLE IF NOT EXISTS render_outputs (
  id UUID PRIMARY KEY,
  render_version_id UUID NOT NULL REFERENCES render_versions(id) ON DELETE CASCADE,
  view_name VARCHAR(64) NOT NULL,
  file_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_render_versions_project ON render_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_project_kind ON assets(project_id, kind);
