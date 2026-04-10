from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.core.settings import settings
from app.db.repository import get_conn

router = APIRouter()

MAX_SKP_BYTES = int(1.5 * 1024 * 1024 * 1024)
MAX_TERRAIN_BYTES = 25 * 1024 * 1024
MAX_PROJECT_BYTES = 3 * 1024 * 1024 * 1024
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


class GenerateRequest(BaseModel):
    project_id: str
    prompt: str = Field(min_length=3, max_length=1000)
    resolution: int = Field(default=2048)
    views: int = Field(default=5, ge=3, le=5)


class RefineRequest(BaseModel):
    project_id: str
    prompt_delta: str = Field(min_length=2, max_length=500)


def _storage_root() -> Path:
    root = Path(settings.storage_root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _project_root(project_id: str) -> Path:
    root = _storage_root() / project_id
    root.mkdir(parents=True, exist_ok=True)
    return root


def _upload_size(upload: UploadFile) -> int:
    upload.file.seek(0, 2)
    size = upload.file.tell()
    upload.file.seek(0)
    return size


def _safe_name(filename: str) -> str:
    return "".join(c for c in filename if c.isalnum() or c in {"-", "_", "."})


def _project_exists(project_id: str) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM projects WHERE id = %s", (project_id,))
            return cur.fetchone() is not None


def _project_total_bytes(project_id: str) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM assets WHERE project_id = %s", (project_id,))
            row = cur.fetchone()
            return int(row["total_bytes"])


def _delete_asset_rows_and_files(project_id: str, kind: str) -> int:
    deleted_bytes = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, stored_path, size_bytes FROM assets WHERE project_id = %s AND kind = %s",
                (project_id, kind),
            )
            rows = cur.fetchall()
            for row in rows:
                deleted_bytes += int(row["size_bytes"])
                file_path = Path(row["stored_path"])
                if file_path.exists():
                    file_path.unlink(missing_ok=True)
            cur.execute("DELETE FROM assets WHERE project_id = %s AND kind = %s", (project_id, kind))
    return deleted_bytes


def _insert_asset(project_id: str, kind: str, upload: UploadFile, file_path: Path, size_bytes: int) -> None:
    mime_type = upload.content_type or "application/octet-stream"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO assets (id, project_id, kind, original_name, stored_path, size_bytes, mime_type)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    project_id,
                    kind,
                    upload.filename or "unnamed",
                    str(file_path),
                    size_bytes,
                    mime_type,
                ),
            )


def _prune_render_versions(project_id: str, keep_last: int = 2) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM render_versions
                WHERE project_id = %s
                ORDER BY version_number DESC
                OFFSET %s
                """,
                (project_id, keep_last),
            )
            stale = [row["id"] for row in cur.fetchall()]
            if not stale:
                return
            cur.execute("DELETE FROM render_outputs WHERE render_version_id = ANY(%s)", (stale,))
            cur.execute("DELETE FROM render_versions WHERE id = ANY(%s)", (stale,))


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=3, max_length=120)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/project/create")
def create_project(payload: CreateProjectRequest) -> dict[str, str]:
    project_id = str(uuid4())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO projects (id, name) VALUES (%s, %s)",
                (project_id, payload.name),
            )
    _project_root(project_id)
    return {"project_id": project_id, "name": payload.name, "status": "created"}


@router.post("/project/upload-model")
def upload_model(project_id: str = Form(...), model_file: UploadFile = File(...)) -> dict[str, str | int]:
    if not _project_exists(project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    ext = Path(model_file.filename or "").suffix.lower()
    if ext != ".skp":
        raise HTTPException(status_code=422, detail="Only .skp files are allowed")

    size_bytes = _upload_size(model_file)
    if size_bytes > MAX_SKP_BYTES:
        raise HTTPException(status_code=422, detail=".skp file exceeds 1.5 GB limit")

    current_total = _project_total_bytes(project_id)
    replaced_model_bytes = _delete_asset_rows_and_files(project_id, "model")
    projected_total = current_total - replaced_model_bytes + size_bytes
    if projected_total > MAX_PROJECT_BYTES:
        raise HTTPException(status_code=422, detail="Project exceeds 3 GB total limit")

    project_path = _project_root(project_id) / "model"
    project_path.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4()}_{_safe_name(model_file.filename or 'model.skp')}"
    file_path = project_path / filename
    with file_path.open("wb") as output:
        shutil.copyfileobj(model_file.file, output)

    _insert_asset(project_id, "model", model_file, file_path, size_bytes)
    return {"status": "uploaded", "project_id": project_id, "size_bytes": size_bytes}


@router.post("/project/upload-images")
def upload_images(project_id: str = Form(...), terrain_images: list[UploadFile] = File(...)) -> dict[str, str | int]:
    if not _project_exists(project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    if len(terrain_images) < 3 or len(terrain_images) > 5:
        raise HTTPException(status_code=422, detail="Provide between 3 and 5 terrain images")

    total_new_bytes = 0
    for image in terrain_images:
        ext = Path(image.filename or "").suffix.lower()
        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            raise HTTPException(status_code=422, detail="Only .jpg, .jpeg, .png, .webp images are allowed")
        image_size = _upload_size(image)
        if image_size > MAX_TERRAIN_BYTES:
            raise HTTPException(status_code=422, detail="An image exceeds 25 MB limit")
        total_new_bytes += image_size

    current_total = _project_total_bytes(project_id)
    replaced_terrain_bytes = _delete_asset_rows_and_files(project_id, "terrain")
    projected_total = current_total - replaced_terrain_bytes + total_new_bytes
    if projected_total > MAX_PROJECT_BYTES:
        raise HTTPException(status_code=422, detail="Project exceeds 3 GB total limit")

    terrain_path = _project_root(project_id) / "terrain"
    terrain_path.mkdir(parents=True, exist_ok=True)

    for image in terrain_images:
        size_bytes = _upload_size(image)
        filename = f"{uuid4()}_{_safe_name(image.filename or 'terrain.jpg')}"
        file_path = terrain_path / filename
        with file_path.open("wb") as output:
            shutil.copyfileobj(image.file, output)
        _insert_asset(project_id, "terrain", image, file_path, size_bytes)

    return {"status": "uploaded", "project_id": project_id, "images_count": len(terrain_images)}


@router.post("/render/generate")
def generate_render(payload: GenerateRequest) -> dict[str, str | int]:
    if payload.resolution not in {1536, 2048, 2560}:
        raise HTTPException(status_code=422, detail="Resolution must be one of: 1536, 2048, 2560")

    if not _project_exists(payload.project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS c FROM assets WHERE project_id = %s AND kind = 'model'",
                (payload.project_id,),
            )
            model_count = int(cur.fetchone()["c"])
            cur.execute(
                "SELECT COUNT(*) AS c FROM assets WHERE project_id = %s AND kind = 'terrain'",
                (payload.project_id,),
            )
            terrain_count = int(cur.fetchone()["c"])
            cur.execute(
                "SELECT COALESCE(MAX(version_number), 0) AS v FROM render_versions WHERE project_id = %s",
                (payload.project_id,),
            )
            next_version = int(cur.fetchone()["v"]) + 1

            if model_count < 1:
                raise HTTPException(status_code=422, detail="Upload one .skp model first")
            if terrain_count < 3 or terrain_count > 5:
                raise HTTPException(status_code=422, detail="Project must have between 3 and 5 terrain images")

            render_version_id = str(uuid4())
            cur.execute(
                """
                INSERT INTO render_versions (id, project_id, version_number, status, mode, prompt, resolution, views)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    render_version_id,
                    payload.project_id,
                    next_version,
                    "pending_base_render",
                    "generate",
                    payload.prompt,
                    payload.resolution,
                    payload.views,
                ),
            )

    _prune_render_versions(payload.project_id, keep_last=2)
    return {
        "status": "pending_base_render",
        "render_version_id": render_version_id,
        "project_id": payload.project_id,
        "version_number": next_version,
    }


@router.post("/render/refine")
def refine_render(payload: RefineRequest) -> dict[str, str | int]:
    if not _project_exists(payload.project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, version_number, prompt, resolution, views
                FROM render_versions
                WHERE project_id = %s
                ORDER BY version_number DESC
                LIMIT 1
                """,
                (payload.project_id,),
            )
            latest = cur.fetchone()
            if latest is None:
                raise HTTPException(status_code=422, detail="Generate a base version first")

            next_version = int(latest["version_number"]) + 1
            render_version_id = str(uuid4())
            new_prompt = f"{latest['prompt']} | refine: {payload.prompt_delta}"
            cur.execute(
                """
                INSERT INTO render_versions (id, project_id, version_number, status, mode, prompt, resolution, views)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    render_version_id,
                    payload.project_id,
                    next_version,
                    "queued_enhancement",
                    "refine",
                    new_prompt,
                    int(latest["resolution"]),
                    int(latest["views"]),
                ),
            )

    _prune_render_versions(payload.project_id, keep_last=2)
    return {
        "status": "queued_enhancement",
        "render_version_id": render_version_id,
        "project_id": payload.project_id,
        "version_number": next_version,
    }


@router.get("/render/results")
def render_results(project_id: str) -> dict[str, object]:
    if not _project_exists(project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, created_at FROM projects WHERE id = %s", (project_id,))
            project = cur.fetchone()
            cur.execute(
                "SELECT kind, COUNT(*) AS c FROM assets WHERE project_id = %s GROUP BY kind",
                (project_id,),
            )
            assets_rows = cur.fetchall()
            assets_count = {row["kind"]: int(row["c"]) for row in assets_rows}
            cur.execute(
                """
                SELECT id, version_number, status, mode, prompt, resolution, views, created_at
                FROM render_versions
                WHERE project_id = %s
                ORDER BY version_number DESC
                """,
                (project_id,),
            )
            versions = cur.fetchall()

    return {
        "project": project,
        "assets": {
            "model_count": assets_count.get("model", 0),
            "terrain_count": assets_count.get("terrain", 0),
        },
        "versions": versions,
        "rules": {
            "version_retention": "last_2",
            "refine_reprocesses": "enhancement_only",
        },
    }


# ─── Enscape Base Renders ─────────────────────────────────────────────────────

MAX_ENSCAPE_BYTES = 200 * 1024 * 1024  # 200 MB per base render image


def _render_version_exists(render_version_id: str) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM render_versions WHERE id = %s", (render_version_id,))
            return cur.fetchone() is not None


@router.post("/render/enscape-base-render")
def upload_enscape_base_render(
    render_version_id: str = Form(...),
    view_name: str = Form(...),
    render_file: UploadFile = File(...),
) -> dict[str, str | int]:
    """Register an Enscape base render for a specific view of a render version.

    The operator calls this endpoint after exporting each view from Enscape.
    Re-uploading the same view_name replaces the previous file.
    """
    if not _render_version_exists(render_version_id):
        raise HTTPException(status_code=404, detail="Render version not found")

    view_name = view_name.strip()
    if not view_name or len(view_name) > 64:
        raise HTTPException(status_code=422, detail="view_name must be 1–64 characters")

    ext = Path(render_file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=422, detail="Only .jpg, .jpeg, .png, .webp images are allowed")

    size_bytes = _upload_size(render_file)
    if size_bytes > MAX_ENSCAPE_BYTES:
        raise HTTPException(status_code=422, detail="Enscape render exceeds 200 MB limit")

    # Fetch project_id from render version so we can build a storage path.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT project_id FROM render_versions WHERE id = %s", (render_version_id,))
            row = cur.fetchone()
            project_id: str = row["project_id"]

    # Delete previous file for the same view if it exists.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, stored_path FROM enscape_base_renders WHERE render_version_id = %s AND view_name = %s",
                (render_version_id, view_name),
            )
            existing = cur.fetchone()
            if existing:
                old_path = Path(existing["stored_path"])
                old_path.unlink(missing_ok=True)
                cur.execute("DELETE FROM enscape_base_renders WHERE id = %s", (existing["id"],))

    enscape_path = _project_root(project_id) / "enscape" / render_version_id
    enscape_path.mkdir(parents=True, exist_ok=True)
    safe_view = "".join(c for c in view_name if c.isalnum() or c in {"-", "_"})
    filename = f"{safe_view}_{uuid4()}{ext}"
    file_path = enscape_path / filename
    with file_path.open("wb") as out:
        shutil.copyfileobj(render_file.file, out)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO enscape_base_renders
                    (id, render_version_id, view_name, original_name, stored_path, size_bytes)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    render_version_id,
                    view_name,
                    render_file.filename or "unnamed",
                    str(file_path),
                    size_bytes,
                ),
            )

    return {
        "status": "registered",
        "render_version_id": render_version_id,
        "view_name": view_name,
        "size_bytes": size_bytes,
    }


@router.get("/render/enscape-base-renders")
def list_enscape_base_renders(render_version_id: str) -> dict[str, object]:
    """List all registered Enscape base renders for a render version."""
    if not _render_version_exists(render_version_id):
        raise HTTPException(status_code=404, detail="Render version not found")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, view_name, original_name, size_bytes, registered_at
                FROM enscape_base_renders
                WHERE render_version_id = %s
                ORDER BY view_name
                """,
                (render_version_id,),
            )
            rows = cur.fetchall()

    return {"render_version_id": render_version_id, "base_renders": rows}


# ─── Photomontage ─────────────────────────────────────────────────────────────

PHOTOMONTAGE_MODES = {"auto", "manual", "hybrid"}


class CreatePhotomontageRequest(BaseModel):
    render_version_id: str
    mode: str = Field(default="hybrid")


class ControlPoint(BaseModel):
    src_x: float
    src_y: float
    dst_x: float
    dst_y: float


class AddControlPointsRequest(BaseModel):
    photomontage_job_id: str
    view_name: str = Field(min_length=1, max_length=64)
    control_points: list[ControlPoint] = Field(min_length=1)


@router.post("/photomontage/create")
def create_photomontage(payload: CreatePhotomontageRequest) -> dict[str, str]:
    """Create a photomontage job for a render version.

    mode: 'auto' — fully automatic alignment
          'manual' — operator-defined control points only
          'hybrid' (default) — automatic with manual control-point overrides
    """
    if payload.mode not in PHOTOMONTAGE_MODES:
        raise HTTPException(status_code=422, detail=f"mode must be one of: {', '.join(sorted(PHOTOMONTAGE_MODES))}")

    if not _render_version_exists(payload.render_version_id):
        raise HTTPException(status_code=404, detail="Render version not found")

    job_id = str(uuid4())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO photomontage_jobs (id, render_version_id, mode, status)
                VALUES (%s, %s, %s, 'pending')
                """,
                (job_id, payload.render_version_id, payload.mode),
            )

    return {
        "status": "created",
        "photomontage_job_id": job_id,
        "render_version_id": payload.render_version_id,
        "mode": payload.mode,
    }


@router.post("/photomontage/control-points")
def add_control_points(payload: AddControlPointsRequest) -> dict[str, object]:
    """Add manual control points for a view in a photomontage job.

    Each control point maps a pixel in the source (Enscape render) to the
    corresponding pixel in the destination (terrain photo).
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM photomontage_jobs WHERE id = %s", (payload.photomontage_job_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="Photomontage job not found")

            rows_to_insert = [
                (
                    str(uuid4()),
                    payload.photomontage_job_id,
                    payload.view_name,
                    cp.src_x,
                    cp.src_y,
                    cp.dst_x,
                    cp.dst_y,
                )
                for cp in payload.control_points
            ]
            cur.executemany(
                """
                INSERT INTO photomontage_control_points
                    (id, photomontage_job_id, view_name, src_x, src_y, dst_x, dst_y)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                rows_to_insert,
            )

    return {
        "status": "added",
        "photomontage_job_id": payload.photomontage_job_id,
        "view_name": payload.view_name,
        "points_added": len(payload.control_points),
    }


@router.get("/photomontage")
def get_photomontage(render_version_id: str) -> dict[str, object]:
    """Get photomontage jobs and their control points for a render version."""
    if not _render_version_exists(render_version_id):
        raise HTTPException(status_code=404, detail="Render version not found")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, mode, status, created_at
                FROM photomontage_jobs
                WHERE render_version_id = %s
                ORDER BY created_at DESC
                """,
                (render_version_id,),
            )
            jobs = cur.fetchall()

            result_jobs = []
            for job in jobs:
                cur.execute(
                    """
                    SELECT id, view_name, src_x, src_y, dst_x, dst_y, created_at
                    FROM photomontage_control_points
                    WHERE photomontage_job_id = %s
                    ORDER BY view_name, created_at
                    """,
                    (job["id"],),
                )
                control_points = cur.fetchall()
                result_jobs.append({**job, "control_points": control_points})

    return {"render_version_id": render_version_id, "photomontage_jobs": result_jobs}


# ─── Visual Consistency Checklist (Lumion 4.0 rubric) ─────────────────────────

# Default Lumion 4.0 rubric checklist items (item_key → label).
LUMION_CHECKLIST_DEFAULTS: list[tuple[str, str]] = [
    ("lighting_coherence", "Coherencia de iluminación (luz natural vs. artificial)"),
    ("shadow_accuracy", "Precisión de sombras y oclusión ambiental"),
    ("material_consistency", "Consistencia de materiales y texturas"),
    ("vegetation_density", "Densidad y escala de vegetación"),
    ("sky_match", "Concordancia del cielo con la fotografía de terreno"),
    ("foreground_integration", "Integración del primer plano con el entorno"),
    ("color_grading", "Gradación de color y temperatura de la imagen"),
    ("depth_of_field", "Profundidad de campo y desenfoque de bokeh"),
    ("reflections_accuracy", "Precisión de reflexiones y brillos especulares"),
    ("overall_realism", "Realismo general del fotomontaje"),
]


class UpdateChecklistItemRequest(BaseModel):
    checklist_id: str
    passed: bool | None = None
    score: float | None = Field(default=None, ge=0.0, le=4.0)
    notes: str | None = Field(default=None, max_length=1000)


@router.post("/checklist/create")
def create_checklist(render_version_id: str) -> dict[str, object]:
    """Initialise a Lumion 4.0 visual-consistency checklist for a render version.

    Creates one row per default checklist item.  Re-calling this endpoint on
    an already-initialised version is a no-op (returns the existing items).
    """
    if not _render_version_exists(render_version_id):
        raise HTTPException(status_code=404, detail="Render version not found")

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Check if already initialised.
            cur.execute(
                "SELECT COUNT(*) AS c FROM visual_checklist WHERE render_version_id = %s",
                (render_version_id,),
            )
            existing_count = int(cur.fetchone()["c"])
            if existing_count == 0:
                cur.executemany(
                    """
                    INSERT INTO visual_checklist
                        (id, render_version_id, item_key, label, passed, score, notes)
                    VALUES (%s, %s, %s, %s, FALSE, NULL, NULL)
                    ON CONFLICT (render_version_id, item_key) DO NOTHING
                    """,
                    [
                        (str(uuid4()), render_version_id, item_key, label)
                        for item_key, label in LUMION_CHECKLIST_DEFAULTS
                    ],
                )

            cur.execute(
                """
                SELECT id, item_key, label, passed, score, notes, reviewed_at
                FROM visual_checklist
                WHERE render_version_id = %s
                ORDER BY item_key
                """,
                (render_version_id,),
            )
            items = cur.fetchall()

    return {
        "render_version_id": render_version_id,
        "checklist": items,
        "rubric": "Lumion 4.0",
        "score_range": "0.00–4.00",
    }


@router.patch("/checklist/update")
def update_checklist_item(payload: UpdateChecklistItemRequest) -> dict[str, object]:
    """Update passed/score/notes for a single visual-checklist item."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM visual_checklist WHERE id = %s", (payload.checklist_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="Checklist item not found")

            updates: list[str] = ["reviewed_at = NOW()"]
            params: list[object] = []
            if payload.passed is not None:
                updates.append("passed = %s")
                params.append(payload.passed)
            if payload.score is not None:
                updates.append("score = %s")
                params.append(payload.score)
            if payload.notes is not None:
                updates.append("notes = %s")
                params.append(payload.notes)

            params.append(payload.checklist_id)
            cur.execute(
                f"UPDATE visual_checklist SET {', '.join(updates)} WHERE id = %s",  # noqa: S608
                params,
            )

            cur.execute(
                """
                SELECT id, item_key, label, passed, score, notes, reviewed_at
                FROM visual_checklist
                WHERE id = %s
                """,
                (payload.checklist_id,),
            )
            updated = cur.fetchone()

    return {"status": "updated", "item": updated}


@router.get("/checklist")
def get_checklist(render_version_id: str) -> dict[str, object]:
    """Retrieve the visual-consistency checklist for a render version."""
    if not _render_version_exists(render_version_id):
        raise HTTPException(status_code=404, detail="Render version not found")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, item_key, label, passed, score, notes, reviewed_at
                FROM visual_checklist
                WHERE render_version_id = %s
                ORDER BY item_key
                """,
                (render_version_id,),
            )
            items = cur.fetchall()
            total = len(items)
            passed_count = sum(1 for item in items if item["passed"])
            scored = [item["score"] for item in items if item["score"] is not None]
            avg_score = round(sum(float(s) for s in scored) / len(scored), 2) if scored else None

    return {
        "render_version_id": render_version_id,
        "checklist": items,
        "summary": {
            "total_items": total,
            "passed": passed_count,
            "failed": total - passed_count,
            "average_score": avg_score,
        },
        "rubric": "Lumion 4.0",
    }
