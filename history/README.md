# AI Girl World Tour Poster Series

This folder stores prompt docs and visual source materials for a cinematic poster series about one AI-generated girl traveling around the world.

Core creative direction:
- One recurring female lead across the whole series
- Each city is one poster group with a small story
- Every poster should feel cinematic, premium, and emotionally specific
- Short copy can be placed directly on the poster as a title or line

Recommended structure:
- `00-character-base`: the source of truth for the protagonist
- `01-paris` to `06-sydney`: city-based story poster groups

Series consistency rules:
- Keep the same face identity in every generation
- Keep the same age range and overall aura
- Change wardrobe and lighting per city, but not the person
- Prefer realistic photography over overly synthetic beauty rendering
- Poster text should be minimal, elegant, and intentional

Recommended poster ratio:
- Vertical `4:5` for polished poster output
- Vertical `9:16` for short-video cover adaptations

Recommended negative prompt:
`low quality, blurry, deformed hands, extra fingers, extra limbs, bad anatomy, cross-eye, duplicate person, multiple people, distorted face, malformed body, watermark, chaotic background, cheap poster design, messy typography, plastic skin, oversmoothed face, obvious AI artifacts`

Suggested prompt framework:
`[same character anchor], [city scene], [story moment], cinematic film-poster composition, luxury travel campaign, realistic skin texture, premium wardrobe styling, atmospheric light, elegant typography area, highly detailed`

How to work with this folder:
1. Finalize the character in `00-character-base`
2. Generate 3-6 consistent reference portraits for her
3. Use those references when generating each city story
4. For every city, define one emotional story beat and one poster copy line

Subfolders:
- `00-character-base`
- `01-paris`
- `02-tokyo`
- `03-cairo`
- `04-rio`
- `05-new-york`
- `06-sydney`
