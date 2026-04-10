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

-- ─── Enscape Base Renders ────────────────────────────────────────────────────
-- Stores the Enscape-exported base render for each view of a render version.
-- The operator uploads these manually after running Enscape; the generate
-- endpoint sets the version to "pending_base_render" and the operator then
-- registers each view here to advance the pipeline.
CREATE TABLE IF NOT EXISTS enscape_base_renders (
  id UUID PRIMARY KEY,
  render_version_id UUID NOT NULL REFERENCES render_versions(id) ON DELETE CASCADE,
  view_name VARCHAR(64) NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enscape_base_version ON enscape_base_renders(render_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_enscape_base_view ON enscape_base_renders(render_version_id, view_name);

-- ─── Photomontage ────────────────────────────────────────────────────────────
-- Tracks hybrid (auto + manual control-point) photomontage jobs per version.
CREATE TABLE IF NOT EXISTS photomontage_jobs (
  id UUID PRIMARY KEY,
  render_version_id UUID NOT NULL REFERENCES render_versions(id) ON DELETE CASCADE,
  mode VARCHAR(32) NOT NULL DEFAULT 'hybrid',  -- 'auto' | 'manual' | 'hybrid'
  status VARCHAR(32) NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'done'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photomontage_version ON photomontage_jobs(render_version_id);

-- Manual control points that tie a source coordinate to a destination coordinate
-- for each view of the photomontage job.
CREATE TABLE IF NOT EXISTS photomontage_control_points (
  id UUID PRIMARY KEY,
  photomontage_job_id UUID NOT NULL REFERENCES photomontage_jobs(id) ON DELETE CASCADE,
  view_name VARCHAR(64) NOT NULL,
  src_x DOUBLE PRECISION NOT NULL,
  src_y DOUBLE PRECISION NOT NULL,
  dst_x DOUBLE PRECISION NOT NULL,
  dst_y DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ctrl_pts_job ON photomontage_control_points(photomontage_job_id);

-- ─── Visual Consistency Checklist (Lumion 4.0 rubric) ────────────────────────
-- One row per checklist item per render version.
-- score range: 0.00–4.00  (Lumion 4.0 rubric scale)
CREATE TABLE IF NOT EXISTS visual_checklist (
  id UUID PRIMARY KEY,
  render_version_id UUID NOT NULL REFERENCES render_versions(id) ON DELETE CASCADE,
  item_key VARCHAR(120) NOT NULL,
  label TEXT NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  score NUMERIC(4, 2),
  notes TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklist_version ON visual_checklist(render_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_item ON visual_checklist(render_version_id, item_key);
