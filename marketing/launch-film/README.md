# DiligenceIQ Launch Film

The 60-second launch film for DiligenceIQ, and the pipeline that scored it. Follows the
`marketing/launch-film/` convention in the resolveiq, careerops and archiq repos (see
`resolveiq/marketing/product-film-playbook.md`): **the pipeline is tracked, the media is not.**

## Tracked (in git)

- **`build-final.py`** — the audio pass. Places each voiceover segment on its scene,
  flattens and sidechain-ducks the music bed under the voice, mixes three light SFX cues,
  normalizes to −16 LUFS / −1.5 dBTP, and muxes onto the untouched silent picture (video is
  stream-copied). Also writes a 1080p web copy and the poster frame.
- **`narration.md`** — the voiceover script, the takes used, and the measured timing.
- **`diligenceiq-launch-film.vtt`** — captions, timed to the measured voiceover.
- **`apps/web/public/media/diligenceiq-launch-film{.mp4,-poster.jpg,.vtt}`** — the web copy
  the landing page embeds (`apps/web/src/lib/launch-film.ts`).

## Gitignored (regenerate; do not commit)

- **`assets/`** — voiceover takes (Mike's ElevenLabs voice clone `EJrwgUWVchC0SGWY7xT8`,
  `eleven_multilingual_v2`), music candidates (`eleven_music_v2`), SFX (`eleven_text_to_sound_v2`).
  All generated in the ElevenLabs flow "DiligenceIQ Launch Film audio".
- **`out/`** — `DiligenceIQ-Launch-Film-FINAL.mp4` (master), the web copy, `poster.jpg`,
  `mix-master.wav`, `vo-master.wav`, `music-ducked-stem.wav`.
- **`DiligenceIQ Launch Film.mp4`** (repo root) — the silent picture cut from Claude Design,
  the input to the audio pass.

## Rebuild the mix

Needs `ffmpeg`, the silent picture at the repo root, and the audio under `assets/{vo,music,sfx}/`:

```bash
python3 build-final.py                                   # music B (default)
DIQ_MUSIC=A-upbeat-pulse python3 build-final.py          # swap the music candidate
DIQ_MUSIC_VOL=0.95 DIQ_DUCK=soft python3 build-final.py  # louder bed, gentler duck
python3 build-final.py --publish                         # also copy into apps/web/public/media
```

Then `pnpm build` to put the film on the landing page.
