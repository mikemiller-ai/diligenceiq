# DiligenceIQ Launch Film v2 — Narration and Mix

92s · 1920×1080 · picture by Claude Design from `claude-design-brief.md` (`DiligenceIQ Launch Film v2.mp4`
at the repo root, gitignored). Voice: Mike's ElevenLabs clone (`EJrwgUWVchC0SGWY7xT8`,
`eleven_multilingual_v2`), recorded before the picture so the brief could give exact line lengths.
Claims are checked in `claims.md`. Rebuild with `python3 build-final.py [--publish]`.

## Placement (sync points read off the picture)

| # | Line | In | Picture sync |
|---|---|---|---|
| 1 | A deal team asks a question like this every week. Answering it properly means hours inside 10-Ks and 10-Qs. | 2.6 | The question finishes typing at ~3.0 |
| 2 | DiligenceIQ reads the filings for you, and shows its evidence. | 10.8 | Logo forms at 10.0 |
| 3a | Open a company, and the first read is already there: how it's performing, and what changed. | 16.0 | Dashboard, "The first read, before you ask" |
| 3b | Like the $4.5 billion export-control charge that pulled NVIDIA's gross margin to 60.5%. Flagged, with the filing passage behind it. | 23.3 | Signal card spotlight, 23–32 |
| 4 | Then ask anything, in plain English. It searches the filings, gathers the passages… and makes exactly one model call to write the brief. Every step is shown. | 34.4 | Run click ~36.5; "exactly one model call" (~41.0) on the "Generating diligence brief · 1 model call" step |
| 5 | What comes back reads like an investment memo: a summary, the key findings, and the trend. | 46.6 | Brief appears at 46 |
| 6a | Every claim opens the passage it came from. | 54.9 | Citation clicked 55.0, drawer opens 55.5 |
| 6b | And every number is checked against the filing it cites. | 58.5 | "54 of 54 figures verified" at 59.5 |
| 7 | Compare companies side by side: which risk areas they share, and where their trends diverge. | 63.0 | Compare, 62–70 |
| 8 | About a minute per brief. Around thirteen cents. And almost nothing when it sits idle. | 71.9 | One phrase per number: ~1 min / ~$0.13 / ~$0.57/mo appear at 72 / 73 / 74 |
| 9 | Today, it reads public filings. Next, it watches for new ones. And later, your deal room. | 78.3 | Today / Next / Later rows at 78.5 / 79.5 / 80.5 |
| 10 | DiligenceIQ. Know what changed. Know what matters. Know what to investigate next. | 84.5 | End card logo 84.5, phrases from 85.0 |

Line 6 is split at its sentence break so each half lands on its own picture beat.

## Sound design

Keyboard typing under the question (0.15) · soft whoosh as the logo forms (9.7) · UI tick on
Run analysis (36.45) · softer tick on the citation click (55.0) · verified chime on the
54-of-54 pill (59.45) · whoosh swell into the end card (83.2).

## Music

Three 92s candidates (`eleven_music_v2`), shaped to the cut. **B-minimal-piano** is the default:
quiet piano under the question card, the groove enters as the logo forms (~10–12s), it stays even
under the narration, and fades naturally under the end card (from ~88s, silent by 91.5s). It was checked
instrumental with a transcription pass. A-premium-sleek resolves too early (~76s), which would
leave the end card nearly silent.

## Mix

- Each line is measured and gained to −19 LUFS before the voice bus, so every line sits within ~1 dB.
- The bed is level-compressed, sits ~10 dB under the voice, ducks ~4.5 dB on speech, and gets a
  small lift on the verify beat (54.5–62.5s).
- The voice bus is padded to picture length so the sidechain never ends the music early (the first build chopped the bed to silence at 87.3s).
- Master: −16.2 LUFS, −2.2 dBTP, picture stream-copied. Web copy: CRF 26 `-tune stillimage`, AAC 192k at −0.6 dB (−16.8 LUFS, −2.7 dBTP), 9.2 MB.
- Poster: the question card at 6.0s.

## Revisions

- **2026-10-03, after the adversary review:** value line reworded (the first version, "A cited brief in about a
  minute, for about thirteen cents…", read awkwardly); lines 9 and 10 re-timed (the end card starts at 84.5, not
  82.5); music chop fixed; web peak brought under −1.5 dBTP. The site's caption track is no longer `default`,
  because the picture already burns in caption cards (`apps/web/src/components/landing/launch-film.tsx`).
