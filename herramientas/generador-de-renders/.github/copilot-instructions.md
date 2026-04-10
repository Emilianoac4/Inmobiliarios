# AI Render Agent — Workspace Instructions

## Project Purpose
Generate high-quality architectural renders from SketchUp models using a pipeline of:
Enscape (base render) → ComfyUI SDXL + ControlNet (AI enhancement) → Photomontage

## Architecture
- **Backend**: FastAPI (Python 3.11), PostgreSQL, local disk storage — `backend/`
- **Frontend**: Next.js 15 App Router, bilingual ES/EN — `frontend/`
- **AI Runner**: ComfyUI local server (RTX 5050, 8GB VRAM — use `--medvram --xformers`)
- **AI Models**: SDXL base + ControlNet Depth + Canny + Tile (sequential, not parallel)
- **Orchestrator**: GPT API for intent parsing and prompt generation

## File Structure

### Backend
```
backend/app/
  api/routes/         # projects.py, renders.py, chat.py (WebSocket)
  core/               # config.py (Settings), pipeline.py (orchestrator)
  db/                 # models.py (SQLAlchemy), session.py (async)
  modules/
    sketchup_processor.py   # .skp parsing, auto-camera generation
    comfyui_client.py       # HTTP client to local ComfyUI API
    ai_orchestrator.py      # GPT intent → render config
    photomontage.py         # perspective alignment + blending
    file_watcher.py         # hot-folder watch for Enscape exports
```

### Frontend
```
frontend/src/app/
  (dashboard)/page.tsx      # project list
  projects/[id]/page.tsx    # project view: chat + gallery + controls
  components/
    ChatPanel.tsx            # copilot chat + sliders (warmth/vegetation/luxury)
    RenderGallery.tsx        # render grid
    UploadZone.tsx           # drag & drop .skp + terrain images
    CameraApproval.tsx       # approve cameras before enhancement
    PhotomontageEditor.tsx   # control points drag interface
```

## Pipeline Flow
1. `.skp` upload → auto-camera generation (5 views) OR named views from SketchUp
2. Operator exports from Enscape → file_watcher picks up PNGs + depth maps
3. Camera approval in UI
4. ComfyUI: SDXL + ControlNet (Depth → Canny → Tile, sequential)
5. Photomontage (3–5 terrain images, auto + manual control points)
6. PNG output stored locally, metadata in PostgreSQL

## Key Constraints
- Single project at a time (no concurrency in MVP)
- Single-tenant, no auth
- RTX 5050 (8GB VRAM): always use `--medvram` flag for ComfyUI, process ControlNets sequentially
- Refine Caso A (aesthetic only): re-runs AI enhancement only, never touches Enscape export
- Refine Caso B (new camera angle): guides operator to re-export from SketchUp → full pipeline
- Version history: keep only previous + current version per render
- Output format: PNG, configurable resolution (default 2048px long edge)
- Photomontage: 3–5 terrain images per project (4 recommended)

## API Endpoints
```
POST /project/create
POST /project/{id}/upload-model      # .skp only
POST /project/{id}/upload-images     # terrain images (3–5)
POST /render/{id}/generate           # triggers full pipeline
POST /render/{id}/refine             # aesthetic refinement only (Caso A)
                                     # or new camera (Caso B, guides operator)
GET  /render/{id}/results
WS   /chat/{project_id}              # copilot chat + commands
```

## Database Models
- `Project`: id, name, type, location, style[], materials[], status, created_at
- `Render`: id, project_id, camera_view, base_render_path, enhanced_path, version, created_at
- `RenderConfig`: id, project_id, lighting_time, weather, resolution, warmth, vegetation, luxury
- `TerrainImage`: id, project_id, path, alignment_data (JSON)

## Code Standards
- Python: async/await throughout (SQLAlchemy async, httpx for external calls)
- TypeScript: strict mode, App Router patterns only (no Pages Router)
- No auth middleware needed (single-tenant)
- Error responses: always return structured JSON with `detail` field
- i18n: use `next-intl` for ES/EN, locale files in `frontend/messages/`

## ComfyUI Integration
- ComfyUI runs as separate local process on port 8188
- Backend calls ComfyUI HTTP API to queue workflows
- Workflows defined as JSON in `backend/comfyui_workflows/`
- Three workflows: `enhance_full.json`, `enhance_refine.json`, `photomontage.json`

## DO NOT
- Never run Enscape from code — it is always manual by the operator
- Never process more than 1 ComfyUI job at a time
- Never store renders in DB (only paths)
- Never use Pages Router in Next.js
- Never use sync SQLAlchemy (always async)
