# Complete SDXL Workflow for `hikingGirl`

This guide defines a complete ComfyUI workflow for the current project.

Goals:
- Generate attractive, believable East Asian female portraits
- Keep one recurring protagonist consistent across many images
- Produce cinematic posters and `9:16` phone wallpapers
- Support iterative prompt tuning instead of one-off generation
- Stay practical for ComfyUI Desktop on macOS

This document is intentionally more complete than a minimal `text2img` graph.

## Core idea

Do not force one single `SDXL Base` pass to solve everything at once.

Split responsibilities into layers:

1. Base generation
2. Identity consistency
3. Refinement and upscale
4. `9:16` wallpaper composition
5. Output and version management

That is the key difference between a toy graph and a production graph.

## Recommended complete structure

```text
[A] Prompt + Base Generation
Load Checkpoint
-> CLIP Text Encode (positive)
-> CLIP Text Encode (negative)
-> Empty Latent Image
-> KSampler
-> VAE Decode

[B] Identity Consistency Branch
Reference Image Loader
-> Face / identity preprocess
-> PuLID Apply
-> feed into base or refinement stage

[C] Refinement Branch
Base image
-> SDXL Refiner or img2img refine
-> optional face-detail pass

[D] Wallpaper Composition Branch
Refined image
-> resize / crop / outpaint to 9:16
-> optional second denoise pass

[E] Final Output Branch
9:16 image
-> Upscale model
-> Save preview
-> Save final
```

## Workflow modules

## Module A: Base generation

Purpose:
- Create the first believable portrait with clean lighting and structure
- Do not ask this pass to do identity locking, perfect wallpaper composition, and final sharpness all at once

Recommended nodes:
- `Load Checkpoint`
- `CLIP Text Encode (Prompt)` positive
- `CLIP Text Encode (Prompt)` negative
- `Empty Latent Image`
- `KSampler`
- `VAE Decode`

Recommended settings:
- Checkpoint: `sd_xl_base_1.0.safetensors`
- Sampler: `dpmpp_2m`
- Scheduler: `karras`
- Steps: `28-36`
- CFG: `5.5-6.5`
- Denoise: `1.0`

Recommended starting sizes:
- Portrait close-up: `896x1152`
- Half-body portrait: `832x1216`
- Only use direct `1024x1536` if the face already looks stable

Why:
- SDXL often behaves better on slightly less aggressive portrait sizes than a full tall wallpaper frame

## Module B: Identity consistency

Purpose:
- Keep the same protagonist across repeated generations
- Stop the face from drifting every time the prompt changes

Recommended nodes:
- `Load Image` for reference portrait
- `PuLID` model loader
- `PuLID apply / identity conditioning` node set

Inputs:
- One or more approved reference portraits from:
  - [00-character-base/approved](/Users/cxy251/Code/04AIMedia/hikingGirl/00-character-base/approved)

How to use:
- First generate a small set of base portraits without overcomplicating the scene
- Pick 2-4 approved identity anchors
- Feed one strong anchor into PuLID before generating city variants

Role in the graph:
- This should sit between prompt conditioning and final sampling logic, depending on the custom node design
- Treat it as an identity control layer, not a post-processing effect

Important:
- If identity consistency matters, this branch is not optional

## Module C: Refinement branch

Purpose:
- Improve texture, skin realism, and finish
- Clean up a good image without rebuilding everything from scratch

Recommended options:

### Option 1: SDXL Refiner pass

Nodes:
- `Load Checkpoint` with `sd_xl_refiner_1.0.safetensors`
- image-to-latent or refiner-compatible refine path
- lower denoise refinement pass

Suggested settings:
- Steps: `15-25`
- CFG: `4.5-6`
- Denoise: `0.15-0.35`

Best for:
- Better skin texture
- Cleaner clothing detail
- Better premium finish

### Option 2: Image-to-image detail pass

Nodes:
- `VAE Encode`
- `KSampler`
- `VAE Decode`

Suggested settings:
- Denoise: `0.18-0.32`

Best for:
- Small prompt corrections
- Slight style adjustment without replacing the face

Important:
- Keep refinement denoise low
- High denoise at this stage usually destroys identity

## Module D: `9:16` wallpaper composition branch

Purpose:
- Convert a good portrait into a strong phone wallpaper
- Preserve the face while creating proper breathing room for mobile UI

Recommended approaches:

### Approach 1: Crop and extend

Use when:
- The portrait is already close to the framing you want

Process:
- Resize portrait
- Crop vertically
- Expand canvas if needed
- Outpaint top or bottom space

### Approach 2: Controlled recompose

Use when:
- The face is good but the composition is not good for a lock screen

Process:
- Take refined image
- Re-encode to latent
- Extend to `9:16`
- Use low-denoise composition pass

Suggested output sizes:
- Working wallpaper size: `1024x1792`
- Alternative: `1080x1920` after upscale/export

Wallpaper composition rules:
- Keep the face around upper-middle, not too high
- Preserve negative space near the top for the clock
- Avoid busy patterns behind the head
- Avoid hard detail where app icons will sit

## Module E: Final upscale and export

Purpose:
- Produce clean output for phone wallpaper or poster use

Recommended nodes:
- `Load Upscale Model`
- `Image Upscale With Model`
- `Save Image`

Upscaler choices:
- `4x-UltraSharp`: stronger sharpness, more dramatic
- `RealESRGAN_x4plus`: safer and more natural

How to use:
- Save one preview before upscale
- Save one final export after upscale
- Compare both upscalers on the same image before standardizing

## Suggested complete graph

```text
Load Checkpoint (SDXL Base)
-> CLIP Positive
-> CLIP Negative
-> Empty Latent
-> KSampler
-> VAE Decode
-> Preview Save

Load Reference Image
-> PuLID Identity Branch
-> inject into sampling / conditioning path

Base Image
-> Refiner or Img2Img Refine
-> Save Refined

Refined Image
-> Resize / Crop / Outpaint to 9:16
-> Optional low-denoise correction pass
-> Save Wallpaper Draft

Wallpaper Draft
-> Upscale Model
-> Save Final
```

## Suggested node groups in the canvas

To keep the graph readable, organize left to right:

1. `Prompt + Model`
2. `Identity`
3. `Sampling`
4. `Refine`
5. `Wallpaper Compose`
6. `Upscale + Save`

This matters because once you start adding city variants, notes, and batch output, a messy graph becomes hard to maintain.

## Suggested save naming

Use different filename prefixes for each stage:

- `char_base_preview`
- `char_base_refined`
- `char_base_wallpaper`
- `char_base_final`

Later, for city sets:

- `paris_preview`
- `paris_refined`
- `paris_wallpaper`
- `paris_final`

## Prompt responsibilities by module

Do not put every goal into one prompt.

### Base prompt should handle:
- face structure
- age range
- hair
- skin realism
- emotional tone
- camera language

### Refinement prompt should handle:
- premium finish
- subtle styling adjustment
- detail polish

### Wallpaper composition prompt should handle:
- negative space
- vertical framing
- background calmness

## Recommended first version for this project

If you want the smallest graph that is still production-worthy, start with:

1. `Load Checkpoint`
2. `CLIP Positive`
3. `CLIP Negative`
4. `Empty Latent Image`
5. `KSampler`
6. `VAE Decode`
7. `PuLID branch`
8. `Refine pass`
9. `Upscale model`
10. `Save preview`
11. `Save final`

This is the best next step from your current minimal graph.

## What not to do

- Do not rely on prompt wording alone for identity consistency
- Do not start with final wallpaper resolution if the face is still unstable
- Do not push refinement denoise too high
- Do not collect many random checkpoints before stabilizing one workflow
- Do not make the base prompt carry composition, identity, beauty standard, and final polish all at once

## Project rollout plan

Phase 1:
- Stabilize one believable character portrait

Phase 2:
- Lock identity with PuLID

Phase 3:
- Produce 3-5 wallpaper variants from one approved face

Phase 4:
- Reuse that identity for city poster sets

## Companion project files

Use these together with this guide:

- [docs/comfyui-model-guide-macos.md](/Users/cxy251/Code/04AIMedia/hikingGirl/docs/comfyui-model-guide-macos.md)
- [00-character-base/README.md](/Users/cxy251/Code/04AIMedia/hikingGirl/00-character-base/README.md)
- [00-character-base/iterations/prompt-v1-phone-wallpapers.md](/Users/cxy251/Code/04AIMedia/hikingGirl/00-character-base/iterations/prompt-v1-phone-wallpapers.md)
- [00-character-base/iterations/revision-log.md](/Users/cxy251/Code/04AIMedia/hikingGirl/00-character-base/iterations/revision-log.md)
