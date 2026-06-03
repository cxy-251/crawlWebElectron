# ComfyUI Model Guide for macOS Desktop

This guide is for the current `hikingGirl` project and assumes:
- You are using the ComfyUI macOS desktop app
- You want to focus on `SDXL` rather than `FLUX`
- Your goal is automated production of cinematic portrait posters and `9:16` phone wallpapers

## Recommended first-download set

Download these first:

1. `sd_xl_base_1.0.safetensors`
2. `sd_xl_refiner_1.0.safetensors`
3. `pulid_v1.1.safetensors`
4. `4x-UltraSharp.safetensors`
5. `RealESRGAN_x4plus.pth`

These five are enough to build a practical first production pipeline.

## What each model does

### 1. SDXL Base

File:
- `sd_xl_base_1.0.safetensors`

Purpose:
- This is the main text-to-image generation model.
- It creates the first version of the portrait, wallpaper, or poster.

Use in our project:
- Generate the first image of the recurring female character
- Generate city-based posters
- Generate wallpaper compositions in `9:16`

### 2. SDXL Refiner

File:
- `sd_xl_refiner_1.0.safetensors`

Purpose:
- This improves detail and final image quality after the base model.
- It is especially useful when the base image is already close but still needs cleaner textures or richer finishing.

Use in our project:
- Refine good base generations into more premium-looking poster outputs
- Improve skin texture, clothing detail, and lighting polish

### 3. PuLID for SDXL

File:
- `pulid_v1.1.safetensors`

Purpose:
- This is the identity-consistency model.
- It helps keep the same person across multiple images.

Use in our project:
- Keep the same female protagonist across different wallpaper variations
- Keep the same face across Paris, Tokyo, Cairo, and later city sets

Important note:
- For this project, PuLID is more important than downloading random extra checkpoints.
- If the person changes too much between generations, this is the tool we lean on.

### 4. 4x-UltraSharp

File:
- `4x-UltraSharp.safetensors`

Purpose:
- This is an upscaler.
- It increases resolution and sharpens fine details.

Use in our project:
- Improve phone wallpaper crispness
- Prepare poster images for cleaner export
- Add detail after a good generation is selected

### 5. Real-ESRGAN x4plus

File:
- `RealESRGAN_x4plus.pth`

Purpose:
- Another upscaler, often more conservative and practical.
- Good for natural enhancement and cleanup.

Use in our project:
- Upscale realistic images
- Compare with UltraSharp to decide which finish looks better

## Where to put the files in ComfyUI Desktop

The exact install path of ComfyUI Desktop can vary on macOS, but inside the ComfyUI models directory, place files like this:

### Checkpoints

Put these in:
- `models/checkpoints/`

Files:
- `sd_xl_base_1.0.safetensors`
- `sd_xl_refiner_1.0.safetensors`

Why:
- ComfyUI reads main SD and SDXL generation models from `checkpoints`

### PuLID

Put this in:
- `models/pulid/`

File:
- `pulid_v1.1.safetensors`

Why:
- PuLID custom nodes usually look for a dedicated `pulid` model folder

### Upscale models

Put these in:
- `models/upscale_models/`

Files:
- `4x-UltraSharp.safetensors`
- `RealESRGAN_x4plus.pth`

Why:
- ESRGAN and related upscalers are typically loaded from `upscale_models`

## Example target folder structure

```text
ComfyUI/
  models/
    checkpoints/
      sd_xl_base_1.0.safetensors
      sd_xl_refiner_1.0.safetensors
    pulid/
      pulid_v1.1.safetensors
    upscale_models/
      4x-UltraSharp.safetensors
      RealESRGAN_x4plus.pth
```

## Suggested install priority

If you do not want to download everything at once:

### Priority A

Install first:
- `sd_xl_base_1.0.safetensors`
- `pulid_v1.1.safetensors`

This is the minimum useful set for character generation with identity consistency.

### Priority B

Install next:
- `sd_xl_refiner_1.0.safetensors`

This gives you a higher-end finish.

### Priority C

Install after that:
- `4x-UltraSharp.safetensors`
- `RealESRGAN_x4plus.pth`

This gives you clean export quality for wallpapers and posters.

## Practical workflow for this project

Recommended order:

1. Generate the character base image with `SDXL Base`
2. Use `PuLID` to keep the same identity across variants
3. Refine good images with `SDXL Refiner`
4. Upscale chosen final images with `4x-UltraSharp` or `RealESRGAN`

## Notes for macOS desktop users

- The ComfyUI macOS desktop app may hide the underlying install path, but the app still uses the same model folder structure internally.
- If a node says a model is missing, the file is usually in the wrong folder or the app has not reloaded yet.
- After copying models, restarting ComfyUI Desktop is often the safest way to make sure they are detected.

## Project-specific recommendation

For `hikingGirl`, do not spend time downloading many random realistic checkpoints at the start.

The better production strategy is:

1. One stable SDXL base
2. One identity-consistency tool
3. One or two upscalers
4. Strong prompt iteration

That will help us more than collecting many overlapping models.
