---
description: "Use when writing, editing, or debugging Python backend files in FastAPI, SQLAlchemy, ComfyUI client, SketchUp processor, photomontage module, or file watcher. Applies Python async patterns, error handling, and module conventions for this project."
applyTo: "backend/**/*.py"
---

## Python / FastAPI Standards

### Async Everywhere
- All route handlers use `async def`
- All DB calls use `await session.execute(...)` with SQLAlchemy async
- All HTTP calls use `httpx.AsyncClient`, never `requests`
- Never use synchronous SQLAlchemy (no `session.query(...)`)

### Error Handling
- All routes return structured JSON errors: `{"detail": "message"}`
- Use `HTTPException(status_code=..., detail=...)` for API errors
- Log exceptions with `logging.exception(...)`, never swallow silently
- ComfyUI client errors must bubble up with context (which workflow, which step)

### SQLAlchemy Async Pattern
```python
async with get_session() as session:
    result = await session.execute(select(Model).where(...))
    obj = result.scalar_one_or_none()
```

### File Storage Conventions
- Storage root from `settings.STORAGE_ROOT` (never hardcode paths)
- Project files under: `{STORAGE_ROOT}/projects/{project_id}/`
- Renders under: `{STORAGE_ROOT}/projects/{project_id}/renders/{version}/`
- Enscape hot-folder: `{STORAGE_ROOT}/projects/{project_id}/enscape_watch/`
- Terrain images: `{STORAGE_ROOT}/projects/{project_id}/terrain/`

### Module Responsibilities
- `sketchup_processor.py` — only reads .skp, generates camera data, never writes to DB
- `comfyui_client.py` — only HTTP calls to ComfyUI API port 8188, no business logic
- `ai_orchestrator.py` — only GPT calls for parsing + prompt generation, no file I/O
- `photomontage.py` — only image processing/blending, no DB writes
- `pipeline.py` — coordinates all modules, owns DB writes and state transitions
- `file_watcher.py` — only watches folder and emits events, no heavy processing

### ComfyUI Client Rules
- Always check ComfyUI server is up before queueing (GET /system_stats)
- Queue one job at a time — check queue empty before submitting
- Poll for completion with exponential backoff (1s, 2s, 4s, max 30s)
- Timeout per job: 10 minutes
- On failure: store error in Render.status, never crash the whole backend

### Imports Order
1. Standard library
2. Third-party (fastapi, sqlalchemy, httpx, etc.)
3. Local imports (relative)

### Never Do
- Never `import *`
- Never use `print()` in production code — use `logging`
- Never store file contents in the database — store only file paths
- Never run blocking I/O in async routes — use `asyncio.to_thread()` for sync operations
