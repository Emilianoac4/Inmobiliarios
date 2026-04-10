"use client";

import { FormEvent, useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type ResultsPayload = {
  project?: { id: string; name: string; created_at: string };
  assets?: { model_count: number; terrain_count: number };
  versions?: Array<{
    id: string;
    version_number: number;
    status: string;
    mode: string;
    prompt: string;
    resolution: number;
    views: number;
    created_at: string;
  }>;
};

type EnscapeBaseRender = {
  id: string;
  view_name: string;
  original_name: string;
  size_bytes: number;
  registered_at: string;
};

type ChecklistItem = {
  id: string;
  item_key: string;
  label: string;
  passed: boolean;
  score: number | null;
  notes: string | null;
  reviewed_at: string;
};

type ChecklistPayload = {
  render_version_id: string;
  checklist: ChecklistItem[];
  summary: { total_items: number; passed: number; failed: number; average_score: number | null };
  rubric: string;
};

type PhotomontagePayload = {
  render_version_id: string;
  photomontage_jobs: Array<{
    id: string;
    mode: string;
    status: string;
    created_at: string;
    control_points: Array<{
      id: string;
      view_name: string;
      src_x: number;
      src_y: number;
      dst_x: number;
      dst_y: number;
    }>;
  }>;
};

export default function Home() {
  const [projectName, setProjectName] = useState("Proyecto Casa Tropical");
  const [projectId, setProjectId] = useState("");
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [terrainFiles, setTerrainFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState(
    "modern tropical house, realistic architecture, high-end materials, warm golden light"
  );
  const [resolution, setResolution] = useState(2048);
  const [views, setViews] = useState(5);
  const [warmth, setWarmth] = useState(50);
  const [vegetation, setVegetation] = useState(50);
  const [luxury, setLuxury] = useState(50);
  const [refineText, setRefineText] = useState("increase luxury feel and add more vegetation");
  const [status, setStatus] = useState("Ready");
  const [results, setResults] = useState<ResultsPayload | null>(null);

  // Enscape base renders state
  const [enscapeVersionId, setEnscapeVersionId] = useState("");
  const [enscapeViewName, setEnscapeViewName] = useState("vista_1");
  const [enscapeFile, setEnscapeFile] = useState<File | null>(null);
  const [enscapeBaseRenders, setEnscapeBaseRenders] = useState<EnscapeBaseRender[]>([]);

  // Photomontage state
  const [pmVersionId, setPmVersionId] = useState("");
  const [pmMode, setPmMode] = useState("hybrid");
  const [pmJobId, setPmJobId] = useState("");
  const [pmViewName, setPmViewName] = useState("vista_1");
  const [pmPointsText, setPmPointsText] = useState(
    '[{"src_x":100,"src_y":200,"dst_x":110,"dst_y":195}]'
  );
  const [pmData, setPmData] = useState<PhotomontagePayload | null>(null);

  // Checklist state
  const [clVersionId, setClVersionId] = useState("");
  const [checklist, setChecklist] = useState<ChecklistPayload | null>(null);
  const [clEditId, setClEditId] = useState("");
  const [clScore, setClScore] = useState("");
  const [clNotes, setClNotes] = useState("");
  const [clPassed, setClPassed] = useState(false);

  const computedPrompt = useMemo(() => {
    return `${prompt} | warmth:${warmth} vegetation:${vegetation} luxury:${luxury}`;
  }, [prompt, warmth, vegetation, luxury]);

  async function createProject(e: FormEvent) {
    e.preventDefault();
    setStatus("Creating project...");

    const response = await fetch(`${API_BASE_URL}/project/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Error creating project: ${payload.detail || "unknown"}`);
      return;
    }

    setProjectId(payload.project_id);
    setStatus(`Project created: ${payload.project_id}`);
  }

  async function uploadModel() {
    if (!projectId || !modelFile) {
      setStatus("Select project and .skp file first");
      return;
    }
    setStatus("Uploading .skp model...");

    const formData = new FormData();
    formData.append("project_id", projectId);
    formData.append("model_file", modelFile);

    const response = await fetch(`${API_BASE_URL}/project/upload-model`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Model upload error: ${payload.detail || "unknown"}`);
      return;
    }

    setStatus("Model uploaded");
  }

  async function uploadImages() {
    if (!projectId || terrainFiles.length < 3 || terrainFiles.length > 5) {
      setStatus("Select project and 3 to 5 terrain images");
      return;
    }
    setStatus("Uploading terrain images...");

    const formData = new FormData();
    formData.append("project_id", projectId);
    terrainFiles.forEach((file) => formData.append("terrain_images", file));

    const response = await fetch(`${API_BASE_URL}/project/upload-images`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Terrain upload error: ${payload.detail || "unknown"}`);
      return;
    }

    setStatus("Terrain images uploaded");
  }

  async function generate() {
    if (!projectId) {
      setStatus("Create project first");
      return;
    }
    setStatus("Creating render version...");

    const response = await fetch(`${API_BASE_URL}/render/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        prompt: computedPrompt,
        resolution,
        views,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Generate error: ${payload.detail || "unknown"}`);
      return;
    }

    setStatus(`Generate OK. Version ${payload.version_number} created.`);
    await fetchResults();
  }

  async function refine() {
    if (!projectId) {
      setStatus("Create project first");
      return;
    }
    setStatus("Queuing refine...");

    const response = await fetch(`${API_BASE_URL}/render/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        prompt_delta: refineText,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Refine error: ${payload.detail || "unknown"}`);
      return;
    }

    setStatus(`Refine OK. Version ${payload.version_number} queued.`);
    await fetchResults();
  }

  async function fetchResults() {
    if (!projectId) {
      setStatus("Create project first");
      return;
    }
    const response = await fetch(`${API_BASE_URL}/render/results?project_id=${projectId}`);
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Results error: ${payload.detail || "unknown"}`);
      return;
    }
    setResults(payload);
    setStatus("Results updated");
  }

  // ── Enscape base render handlers ──────────────────────────────────────────

  async function uploadEnscapeBaseRender() {
    if (!enscapeVersionId || !enscapeViewName || !enscapeFile) {
      setStatus("Provide render_version_id, view name and a file");
      return;
    }
    setStatus("Registering Enscape base render...");

    const formData = new FormData();
    formData.append("render_version_id", enscapeVersionId);
    formData.append("view_name", enscapeViewName);
    formData.append("render_file", enscapeFile);

    const response = await fetch(`${API_BASE_URL}/render/enscape-base-render`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Enscape upload error: ${payload.detail || "unknown"}`);
      return;
    }

    setStatus(`Enscape render registered for view "${payload.view_name}"`);
    await fetchEnscapeBaseRenders();
  }

  async function fetchEnscapeBaseRenders() {
    if (!enscapeVersionId) return;
    const response = await fetch(
      `${API_BASE_URL}/render/enscape-base-renders?render_version_id=${enscapeVersionId}`
    );
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Enscape list error: ${payload.detail || "unknown"}`);
      return;
    }
    setEnscapeBaseRenders(payload.base_renders ?? []);
    setStatus("Enscape base renders loaded");
  }

  // ── Photomontage handlers ─────────────────────────────────────────────────

  async function createPhotomontageJob() {
    if (!pmVersionId) {
      setStatus("Provide a render_version_id for photomontage");
      return;
    }
    setStatus("Creating photomontage job...");

    const response = await fetch(`${API_BASE_URL}/photomontage/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ render_version_id: pmVersionId, mode: pmMode }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Photomontage error: ${payload.detail || "unknown"}`);
      return;
    }

    setPmJobId(payload.photomontage_job_id);
    setStatus(`Photomontage job created: ${payload.photomontage_job_id}`);
  }

  async function addControlPoints() {
    if (!pmJobId || !pmViewName || !pmPointsText) {
      setStatus("Provide job ID, view name and control points JSON");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(pmPointsText);
    } catch {
      setStatus("Control points JSON is invalid");
      return;
    }

    setStatus("Adding control points...");
    const response = await fetch(`${API_BASE_URL}/photomontage/control-points`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photomontage_job_id: pmJobId,
        view_name: pmViewName,
        control_points: parsed,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Control points error: ${payload.detail || "unknown"}`);
      return;
    }

    setStatus(`${payload.points_added} control point(s) added`);
    await fetchPhotomontage();
  }

  async function fetchPhotomontage() {
    if (!pmVersionId) return;
    const response = await fetch(`${API_BASE_URL}/photomontage?render_version_id=${pmVersionId}`);
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Photomontage fetch error: ${payload.detail || "unknown"}`);
      return;
    }
    setPmData(payload);
    setStatus("Photomontage data loaded");
  }

  // ── Checklist handlers ────────────────────────────────────────────────────

  async function initChecklist() {
    if (!clVersionId) {
      setStatus("Provide render_version_id for checklist");
      return;
    }
    setStatus("Initialising checklist...");

    const response = await fetch(
      `${API_BASE_URL}/checklist/create?render_version_id=${clVersionId}`,
      { method: "POST" }
    );
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Checklist init error: ${payload.detail || "unknown"}`);
      return;
    }

    setChecklist(payload);
    setStatus("Checklist ready");
  }

  async function updateChecklistItem() {
    if (!clEditId) {
      setStatus("Select a checklist item ID to update");
      return;
    }
    setStatus("Updating checklist item...");

    const body: Record<string, unknown> = { checklist_id: clEditId, passed: clPassed };
    if (clScore !== "") body.score = parseFloat(clScore);
    if (clNotes !== "") body.notes = clNotes;

    const response = await fetch(`${API_BASE_URL}/checklist/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Checklist update error: ${payload.detail || "unknown"}`);
      return;
    }

    setStatus("Checklist item updated");
    await fetchChecklist();
  }

  async function fetchChecklist() {
    if (!clVersionId) return;
    const response = await fetch(`${API_BASE_URL}/checklist?render_version_id=${clVersionId}`);
    const payload = await response.json();
    if (!response.ok) {
      setStatus(`Checklist fetch error: ${payload.detail || "unknown"}`);
      return;
    }
    setChecklist(payload);
    setStatus("Checklist loaded");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6">
          <h1 className="text-3xl font-semibold">Generador de renders - MVP Console</h1>
          <p className="mt-2 text-slate-300">Vertical flow: create project, upload assets, generate, refine, results</p>
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={createProject} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="mb-3 text-xl font-medium">1) Proyecto</h2>
            <label className="mb-2 block text-sm text-slate-300">Nombre</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
            <button className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-900" type="submit">
              Crear proyecto
            </button>
            <p className="mt-3 text-xs text-slate-400">Project ID: {projectId || "(pending)"}</p>
          </form>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="mb-3 text-xl font-medium">2) Upload de activos</h2>
            <label className="mb-2 block text-sm text-slate-300">Modelo .skp (max 1.5 GB)</label>
            <input type="file" accept=".skp" onChange={(e) => setModelFile(e.target.files?.[0] || null)} />
            <button onClick={uploadModel} className="mt-3 rounded-lg border border-slate-600 px-4 py-2">
              Subir modelo
            </button>

            <label className="mb-2 mt-5 block text-sm text-slate-300">Terreno (3-5 imagenes, 25 MB c/u)</label>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              multiple
              onChange={(e) => setTerrainFiles(Array.from(e.target.files || []))}
            />
            <button onClick={uploadImages} className="mt-3 rounded-lg border border-slate-600 px-4 py-2">
              Subir imagenes
            </button>
            <p className="mt-3 text-xs text-slate-400">Seleccionadas: {terrainFiles.length}</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="mb-3 text-xl font-medium">3) Generate</h2>
            <label className="mb-2 block text-sm text-slate-300">Prompt base</label>
            <textarea
              className="h-24 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />

            <label className="mt-3 block text-sm text-slate-300">Resolution</label>
            <select
              className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={resolution}
              onChange={(e) => setResolution(Number(e.target.value))}
            >
              <option value={1536}>1536</option>
              <option value={2048}>2048</option>
              <option value={2560}>2560</option>
            </select>

            <label className="mt-3 block text-sm text-slate-300">Views</label>
            <select className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={views} onChange={(e) => setViews(Number(e.target.value))}>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>

            <div className="mt-4 grid gap-2">
              <label className="text-sm">Warmth: {warmth}</label>
              <input type="range" min={0} max={100} value={warmth} onChange={(e) => setWarmth(Number(e.target.value))} />
              <label className="text-sm">Vegetation: {vegetation}</label>
              <input type="range" min={0} max={100} value={vegetation} onChange={(e) => setVegetation(Number(e.target.value))} />
              <label className="text-sm">Luxury: {luxury}</label>
              <input type="range" min={0} max={100} value={luxury} onChange={(e) => setLuxury(Number(e.target.value))} />
            </div>

            <button onClick={generate} className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 font-medium text-slate-900">
              Generar version
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="mb-3 text-xl font-medium">4) Refine + Results</h2>
            <label className="mb-2 block text-sm text-slate-300">Refine instruction</label>
            <textarea
              className="h-20 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={refine} className="rounded-lg border border-slate-600 px-4 py-2">
                Refinar
              </button>
              <button onClick={fetchResults} className="rounded-lg border border-slate-600 px-4 py-2">
                Cargar resultados
              </button>
            </div>
            <pre className="mt-4 max-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
              {JSON.stringify(results, null, 2)}
            </pre>
          </div>

          {/* ── 5) Enscape Base Renders ──────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 lg:col-span-2">
            <h2 className="mb-3 text-xl font-medium">5) Enscape Base Renders por vista</h2>
            <p className="mb-4 text-sm text-slate-400">
              Después de exportar cada vista desde Enscape, registra aquí el archivo base antes de
              continuar con el fotomontaje. El pipeline permanece en{" "}
              <code className="rounded bg-slate-800 px-1">pending_base_render</code> hasta que
              registres todas las vistas.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm text-slate-300">Render Version ID</label>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={enscapeVersionId}
                  onChange={(e) => setEnscapeVersionId(e.target.value)}
                  placeholder="UUID del render version"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-300">Nombre de vista</label>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={enscapeViewName}
                  onChange={(e) => setEnscapeViewName(e.target.value)}
                  placeholder="vista_1"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-300">Archivo Enscape (.jpg/.png)</label>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={(e) => setEnscapeFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={uploadEnscapeBaseRender}
                className="rounded-lg bg-violet-500 px-4 py-2 font-medium text-slate-900"
              >
                Registrar base render
              </button>
              <button
                onClick={fetchEnscapeBaseRenders}
                className="rounded-lg border border-slate-600 px-4 py-2"
              >
                Listar base renders
              </button>
            </div>

            {enscapeBaseRenders.length > 0 && (
              <table className="mt-4 w-full rounded-lg border border-slate-700 text-xs">
                <thead className="bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left">Vista</th>
                    <th className="px-3 py-2 text-left">Archivo original</th>
                    <th className="px-3 py-2 text-right">Tamaño</th>
                    <th className="px-3 py-2 text-left">Registrado</th>
                  </tr>
                </thead>
                <tbody>
                  {enscapeBaseRenders.map((r) => (
                    <tr key={r.id} className="border-t border-slate-800">
                      <td className="px-3 py-2 font-mono">{r.view_name}</td>
                      <td className="px-3 py-2">{r.original_name}</td>
                      <td className="px-3 py-2 text-right">{(r.size_bytes / 1024).toFixed(1)} KB</td>
                      <td className="px-3 py-2 text-slate-400">{new Date(r.registered_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── 6) Photomontage híbrido ──────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 lg:col-span-2">
            <h2 className="mb-3 text-xl font-medium">6) Fotomontaje híbrido (auto + puntos de control)</h2>
            <p className="mb-4 text-sm text-slate-400">
              Crea un job de fotomontaje y, opcionalmente, agrega puntos de control manuales para
              guiar el alineamiento automático.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm text-slate-300">Render Version ID</label>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={pmVersionId}
                  onChange={(e) => setPmVersionId(e.target.value)}
                  placeholder="UUID del render version"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-300">Modo</label>
                <select
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={pmMode}
                  onChange={(e) => setPmMode(e.target.value)}
                >
                  <option value="auto">auto</option>
                  <option value="manual">manual</option>
                  <option value="hybrid">hybrid</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={createPhotomontageJob}
                  className="w-full rounded-lg bg-amber-400 px-4 py-2 font-medium text-slate-900"
                >
                  Crear job
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm text-slate-300">Job ID</label>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={pmJobId}
                  onChange={(e) => setPmJobId(e.target.value)}
                  placeholder="UUID del job (se llena auto)"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-300">Vista</label>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={pmViewName}
                  onChange={(e) => setPmViewName(e.target.value)}
                  placeholder="vista_1"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-300">
                  Puntos de control (JSON array)
                </label>
                <textarea
                  className="h-16 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"
                  value={pmPointsText}
                  onChange={(e) => setPmPointsText(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={addControlPoints}
                className="rounded-lg border border-amber-500 px-4 py-2 text-amber-400"
              >
                Agregar puntos de control
              </button>
              <button
                onClick={fetchPhotomontage}
                className="rounded-lg border border-slate-600 px-4 py-2"
              >
                Cargar fotomontaje
              </button>
            </div>

            {pmData && (
              <pre className="mt-4 max-h-60 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
                {JSON.stringify(pmData, null, 2)}
              </pre>
            )}
          </div>

          {/* ── 7) Checklist de consistencia visual (Lumion 4.0) ──────────────── */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 lg:col-span-2">
            <h2 className="mb-3 text-xl font-medium">7) Checklist de consistencia visual — Rúbrica Lumion 4.0</h2>
            <p className="mb-4 text-sm text-slate-400">
              Inicializa el checklist para una render version. Luego marca cada ítem, asigna un
              puntaje (0–4) y agrega notas.
            </p>

            <div className="flex flex-wrap gap-3">
              <input
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={clVersionId}
                onChange={(e) => setClVersionId(e.target.value)}
                placeholder="Render Version ID"
              />
              <button
                onClick={initChecklist}
                className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-900"
              >
                Inicializar checklist
              </button>
              <button
                onClick={fetchChecklist}
                className="rounded-lg border border-slate-600 px-4 py-2"
              >
                Cargar checklist
              </button>
            </div>

            {checklist && (
              <>
                <div className="mt-4 flex flex-wrap gap-4 rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm">
                  <span>
                    <strong>Total:</strong> {checklist.summary.total_items}
                  </span>
                  <span className="text-emerald-400">
                    <strong>Passed:</strong> {checklist.summary.passed}
                  </span>
                  <span className="text-red-400">
                    <strong>Failed:</strong> {checklist.summary.failed}
                  </span>
                  <span>
                    <strong>Puntaje promedio:</strong>{" "}
                    {checklist.summary.average_score !== null
                      ? checklist.summary.average_score
                      : "—"}{" "}
                    / 4.0
                  </span>
                </div>

                <table className="mt-4 w-full rounded-lg border border-slate-700 text-xs">
                  <thead className="bg-slate-800">
                    <tr>
                      <th className="px-3 py-2 text-left">Ítem</th>
                      <th className="px-3 py-2 text-left">Descripción</th>
                      <th className="px-3 py-2 text-center">✓</th>
                      <th className="px-3 py-2 text-right">Score</th>
                      <th className="px-3 py-2 text-left">Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklist.checklist.map((item) => (
                      <tr
                        key={item.id}
                        className={`cursor-pointer border-t border-slate-800 ${clEditId === item.id ? "bg-slate-800" : "hover:bg-slate-800/50"}`}
                        onClick={() => {
                          setClEditId(item.id);
                          setClPassed(item.passed);
                          setClScore(item.score !== null ? String(item.score) : "");
                          setClNotes(item.notes ?? "");
                        }}
                      >
                        <td className="px-3 py-2 font-mono text-slate-400">{item.item_key}</td>
                        <td className="px-3 py-2">{item.label}</td>
                        <td className="px-3 py-2 text-center">
                          {item.passed ? (
                            <span className="text-emerald-400">✓</span>
                          ) : (
                            <span className="text-slate-600">✗</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{item.score !== null ? item.score : "—"}</td>
                        <td className="px-3 py-2 text-slate-400">{item.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {clEditId && (
                  <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4">
                    <p className="w-full text-xs text-slate-400">
                      Editando ítem: <code>{clEditId}</code>
                    </p>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={clPassed}
                        onChange={(e) => setClPassed(e.target.checked)}
                      />
                      Passed
                    </label>
                    <div>
                      <label className="mb-1 block text-xs text-slate-300">Score (0–4)</label>
                      <input
                        type="number"
                        min={0}
                        max={4}
                        step={0.25}
                        className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                        value={clScore}
                        onChange={(e) => setClScore(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-300">Notas</label>
                      <input
                        className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                        value={clNotes}
                        onChange={(e) => setClNotes(e.target.value)}
                      />
                    </div>
                    <button
                      onClick={updateChecklistItem}
                      className="rounded-lg bg-cyan-500 px-4 py-2 font-medium text-slate-900"
                    >
                      Guardar
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <footer className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
          Estado: {status}
        </footer>
      </main>
    </div>
  );
}
