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
        </section>

        <footer className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
          Estado: {status}
        </footer>
      </main>
    </div>
  );
}
