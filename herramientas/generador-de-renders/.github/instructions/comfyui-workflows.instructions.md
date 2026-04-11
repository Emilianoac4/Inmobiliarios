---
description: "Use when designing or modifying ComfyUI workflow JSON files for SDXL enhancement or photomontage. Covers node structure, VRAM constraints for RTX 5050, ControlNet chaining (Depth → Canny → Tile), and sampler settings for architectural render quality."
applyTo: "backend/comfyui_workflows/**/*.json"
---

## ComfyUI Workflow Design — RTX 5050 (8GB VRAM)

### Launch Requirements
ComfyUI must be started with:
```
python main.py --medvram --xformers --port 8188
```

### VRAM Budget
- SDXL base model: ~5.5GB
- Each ControlNet model: ~1.5GB
- Available headroom: ~1GB for activations
- **Strategy**: Load + apply each ControlNet sequentially, unload before next

### Workflow Files
| File | Purpose |
|------|---------|
| `enhance_full.json` | Full pipeline: SDXL + Depth + Canny + Tile |
| `enhance_refine.json` | Caso A refinement: re-run with updated prompt weights only |
| `photomontage.json` | Photomontage blending workflow |

### Node Structure for enhance_full.json
Sequential ControlNet passes — each pass feeds into the next:
1. Load SDXL base checkpoint
2. Encode positive prompt (architecture-specific keywords)
3. Encode negative prompt (distortion, artifacts)
4. Load ControlNet Depth → apply to conditioning
5. Unload Depth ControlNet from VRAM
6. Load ControlNet Canny → apply to conditioning  
7. Unload Canny ControlNet from VRAM
8. Load ControlNet Tile → apply for upscaling
9. KSampler (SDXL settings below)
10. VAE decode → output PNG

### KSampler Settings for Architectural Renders
```json
{
  "sampler_name": "dpmpp_2m",
  "scheduler": "karras",
  "steps": 25,
  "cfg": 7.0,
  "denoise": 0.65
}
```
- Denoise 0.5–0.7: preserves geometry from base render
- Never use denoise > 0.8: destroys architectural accuracy
- Steps 20–30: sweet spot for SDXL quality/speed

### ControlNet Strength Settings
| ControlNet | Strength | Purpose |
|------------|----------|---------|
| Depth | 0.85 | Preserve 3D structure from Enscape depth map |
| Canny | 0.65 | Preserve architectural edges and details |
| Tile | 0.45 | Upscale coherently, add texture detail |

### Resolution Handling
- Process at 1024×1024 (or 1024×768 for landscape) internally
- Upscale to target resolution AFTER generation using latent upscale or ESRGAN
- Never generate at 2048px directly in SDXL — OOM on 8GB

### Prompt Weight Format for Refine
```json
{
  "warmth": 50,
  "vegetation": 50,
  "luxury": 50
}
```
Maps to prompt token weights:
- warmth 0–100 → `(warm lighting:1.0)` to `(golden hour, warm sunset:1.6)`
- vegetation 0–100 → `(minimal plants:0.8)` to `(lush tropical vegetation:1.8)`
- luxury 0–100 → `(simple materials:0.8)` to `(high-end finishes, marble, premium:1.6)`
