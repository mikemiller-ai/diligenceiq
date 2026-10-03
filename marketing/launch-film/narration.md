# DiligenceIQ Launch Film — Narration

60s · 1920×1080 · feature company NVIDIA · Mike's ElevenLabs voice clone
(`EJrwgUWVchC0SGWY7xT8`, `eleven_multilingual_v2`). Each line was generated separately with
two takes; the take used is listed. The product name is written `Diligence I. Q.` and SEC as
`S.E.C.` so the model pronounces them.

| # | Scene | Placed at | Speech (measured) | Take | Line |
|---|---|---|---|---|---|
| 1 | Opening | 0.6 | 0.68–6.30 | a | Private equity diligence begins with a mountain of SEC filings. DiligenceIQ turns them into decisions. |
| 2 | Company Intelligence | 7.0 | 7.09–18.57 | a | Pick a company. Before you ask anything, you see how NVIDIA is performing, what changed across its filings, and what deserves a closer look — every figure straight from the filing, every line you can check. |
| 3 | Ask → live RAG | 21.5 | 21.56–29.32 | b | Have a question? Just ask. Retrieval searches the filings, then exactly one model call writes your answer. These are the real steps — no black box. |
| 4a | Diligence Brief | 33.6 | 33.68–37.07 | b | The result is a Diligence Brief, structured like an investment memo. |
| 4b | Diligence Brief | 39.6 | 39.75–44.70 | b | Every claim opens its source passage, and every number is verified against the filing it cites. |
| 5 | Compare | 47.5 | 47.54–52.38 | a | Compare companies side by side — see where they move together, and where they diverge. |
| 6 | Close | 54.5 | 54.56–58.80 | a | DiligenceIQ. Know what changed, what matters, and what to investigate next. |

## Timing decision

Line 4 reads in about 8.9s, but its window is 13s and the green "All 54 figures found in their
cited passages" highlight appears at **43.0s** in the picture. Played straight from 33.5,
"verified" would land near 40s, three seconds early. The line is split at its sentence break
(a natural 0.3s pause in the take), so the first sentence plays over the Brief reveal and the
second starts at 39.6, putting "verified" on the highlight at about 42.9s.

## Sound design

| Cue | At | Picture |
|---|---|---|
| Soft whoosh | 0.1 | Wordmark settles on the title card |
| UI tick | 26.95 | "Run analysis" pressed (button state changes at ~27.0) |
| Verified chime | 42.95 | "All 54 figures found" highlight (43.0) |
| Whoosh swell | 52.9 | Dissolve into the end card (54) |

## Music

Three 60s candidates (`eleven_music_v2`, all checked instrumental with a transcription pass):

- **A-upbeat-pulse** — four-on-the-floor, bright arpeggio, flat energy throughout.
- **B-premium-sleek** (default) — sparse open, lifts at ~20s and again ~38s, resolves with a
  natural tail at 56–60s.
- **C-optimistic-pop** — bouncier and more consumer; doesn't resolve before 60s (relies on the fade).

The bed is level-compressed (B rises ~5 dB on its own), sits ~6–8 dB under the voice, ducks a
further ~4–5 dB on speech, gets a small +1.4 dB lift on the Brief reveal (32.6–36.5s), and fades
over the last 2.4s.

## Master

−16.4 LUFS integrated, −1.4 dBTP, H.264 picture untouched, AAC 192k. Web copy: CRF 26
`-tune stillimage`, about 5 MB.
