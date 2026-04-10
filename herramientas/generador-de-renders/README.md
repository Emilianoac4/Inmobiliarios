# Generador de renders

## Objetivo
Generar renders arquitectonicos de alta calidad desde modelos SketchUp con resultados consistentes, iterables por chat y salida profesional en PNG.

## Alcance MVP (cerrado)
- Entorno local en Windows.
- Flujo de render base manual por operador (SketchUp + Enscape).
- Enhancement con SDXL base + ControlNet.
- Photomontage incluido en MVP.
- Salida final PNG.
- Proyecto single-tenant, sin login, 1 proyecto concurrente.
- Interfaz bilingue (ES/EN).

## Reglas funcionales cerradas
- Refine solo reprocesa AI enhancement (no relanza Enscape).
- Se aceptan de 3 a 5 imagenes de terreno por proyecto.
- Resolucion configurable con presets: 1536, 2048, 2560.
- Vistas objetivo MVP: 3 a 5.
- Historial de versiones: solo version actual + version anterior.
- Aprobacion manual de camaras antes de enhancement.

## Limites de archivos (MVP inicial)
- Modelo SketchUp (.skp): hasta 1.5 GB.
- Imagen de terreno: hasta 25 MB por archivo.
- Tope total por proyecto: 3 GB.

## Pipeline recomendado (MVP)
1. Ingesta
	- Cargar .skp
	- Cargar 3-5 imagenes de terreno
	- Capturar prompt y parametros (chat + sliders)
2. Render base manual
	- Operador exporta vistas desde SketchUp + Enscape
	- Exporta PNG en resolucion configurada
3. Analisis y preparacion
	- Generar mapas depth y edge por vista
4. AI enhancement
	- SDXL base + ControlNet (depth/canny)
	- Preservar geometria base
	- Ajustar materiales, iluminacion, vegetacion y atmosfera
5. Photomontage hibrido
	- Alineacion automatica
	- Ajuste asistido por usuario (puntos de control)
6. Export
	- PNG finales
	- Metadatos de ejecucion por version

## Calidad y consistencia (criterios de aceptacion MVP)
### Consistencia visual
- Luz: direccion y temperatura coherentes entre vistas.
- Materiales: continuidad visual de texturas y tonalidades.
- Atmosfera: cielo/clima coherente entre vistas.
- Geometria: sin distorsiones estructurales visibles.

Umbral MVP:
- Al menos 4 de 5 vistas deben pasar checklist.
- 0 vistas con distorsion geometrica critica.

### Calidad tipo Lumion (rubrica inicial)
- Rubrica 1-5 en cinco ejes:
  - Realismo de materiales
  - Iluminacion
  - Integracion con entorno
  - Nitidez/detalle
  - Composicion arquitectonica

Umbral MVP:
- Todos los ejes en 4.0 o superior.
- Recalibrar luego de primeras corridas reales.

## Arquitectura tecnica
### Frontend
- Next.js
- Modulos:
  - Upload de .skp e imagenes
  - Chat copilot style (texto)
  - Sliders (warmth, vegetation, luxury)
  - Aprobacion de camaras
  - Galeria de resultados y version activa/anterior

### Backend
- FastAPI + PostgreSQL
- Storage local (disco)
- Worker unico para jobs de pipeline
- Endpoints base:
  - POST /project/create
  - POST /project/upload-model
  - POST /project/upload-images
  - POST /render/generate
  - POST /render/refine
  - GET /render/results

## GPU y rendimiento
- Objetivo recomendado para SDXL + ControlNet: 16 GB VRAM.
- Si la GPU local tiene menos VRAM:
  - Priorizar 1536 para iteracion
  - Usar optimizaciones de memoria (xformers, offload)
  - Escalar a 2048/2560 solo en corrida final

## Necesidades registradas
- Crear tablero de 20 referencias visuales para calibrar estilo y validar calidad (pendiente, obligatorio antes de benchmark formal).

## Fases de implementacion
1. Base de proyecto
	- Estructura monorepo en carpeta de herramienta
	- Frontend Next.js + API FastAPI + DB PostgreSQL
2. Ingesta y estado
	- Entidades project, render_job, render_version, asset
	- Validaciones de limites de archivo
3. Pipeline enhancement
	- Integracion SDXL + ControlNet
	- Configuracion de prompts y parametros por version
4. Photomontage MVP
	- Auto align + ajuste manual
5. QA y criterios
	- Checklist de consistencia
	- Rubrica de calidad
6. UX bilingue
	- Etiquetas ES/EN y mensajes de error

## Proximos pasos inmediatos
1. Crear scaffolding del frontend Next.js y backend FastAPI.
2. Definir esquema SQL inicial en PostgreSQL.
3. Implementar primer flujo vertical: upload -> generate -> result.
