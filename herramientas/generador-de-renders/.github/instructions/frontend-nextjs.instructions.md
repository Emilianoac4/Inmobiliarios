---
description: "Use when writing, editing, or debugging TypeScript/TSX files in the Next.js frontend: pages, components, hooks, or API calls. Applies App Router patterns, bilingual ES/EN conventions, and UI component standards for this project."
applyTo: "frontend/**/*.{ts,tsx}"
---

## Next.js / TypeScript Standards

### App Router Only
- Only use App Router (`src/app/`) — never Pages Router
- Server Components by default — add `'use client'` only when needed (event handlers, hooks, browser APIs)
- Route groups with `(dashboard)` for layout grouping without affecting URL
- Loading states with `loading.tsx`, errors with `error.tsx` at route level

### TypeScript Strict Mode
- `strict: true` in tsconfig — no implicit `any`
- Type all component props explicitly with interfaces
- Type API responses — create types in `src/types/`
- Never use `// @ts-ignore` or `// @ts-expect-error`

### Bilingual (ES/EN) with next-intl
- All user-visible strings via `useTranslations()` or `getTranslations()` (Server Components)
- Locale files: `frontend/messages/es.json` and `frontend/messages/en.json`
- Never hardcode Spanish or English strings directly in components
- Route structure: `src/app/[locale]/...` with locale layout wrapper

### Component Conventions
```
src/app/
  [locale]/
    (dashboard)/page.tsx        # Project list
    projects/[id]/page.tsx      # Project detail
  components/
    ChatPanel.tsx               # Client component — WebSocket + sliders
    RenderGallery.tsx           # Can be server (initial load) + client (updates)
    UploadZone.tsx              # Client component — drag & drop
    CameraApproval.tsx          # Client component — camera selection
    PhotomontageEditor.tsx      # Client component — control points drag
```

### API Calls from Frontend
- All backend calls via `src/lib/api.ts` utility (never fetch raw in components)
- Backend base URL from `NEXT_PUBLIC_API_URL` env var
- WebSocket connection for chat: `WS_URL` env var
- Handle loading + error states for every API call

### WebSocket (Chat Panel)
- Connect once per project view, disconnect on unmount
- Reconnect with exponential backoff on drop
- Message schema: `{ type: "command" | "status" | "result", payload: ... }`

### Sliders → Backend Mapping
| Slider | Range | Backend field |
|--------|-------|---------------|
| Warmth | 0–100 | `render_config.warmth` |
| Vegetation | 0–100 | `render_config.vegetation` |
| Luxury | 0–100 | `render_config.luxury` |

Slider changes debounce 500ms before sending to backend.

### File Upload Rules
- `.skp` files only for model upload (validate client-side + server-side)
- Images: JPG/PNG only for terrain (validate MIME type)
- Max terrain images: 5 (enforce in UI)
- Show upload progress via `XMLHttpRequest` or `fetch` with `ReadableStream`

### Never Do
- Never use the Pages Router (`pages/`)
- Never call the backend directly from Server Components that aren't data-fetching
- Never store sensitive data in `localStorage` (single-tenant, but still)
- Never use default exports for components — use named exports
