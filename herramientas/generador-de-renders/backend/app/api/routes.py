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
