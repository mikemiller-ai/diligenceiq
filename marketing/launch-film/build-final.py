#!/usr/bin/env python3
"""
DiligenceIQ Launch Film — final audio pass.

The picture is the 60s silent cut authored in Claude Design (`DiligenceIQ Launch Film.mp4`
at the repo root). This scores it: narration in Mike's ElevenLabs voice clone, an original
instrumental bed sidechain-ducked under the voice, and three light sound-design cues.
Video is stream-copied, never re-encoded.

Adapted from archiq/marketing/launch-film/build-final.py.

Usage:  python3 build-final.py                         # default music candidate
        DIQ_MUSIC=B-premium-sleek python3 build-final.py
        DIQ_MUSIC_VOL=0.42 DIQ_DUCK=soft python3 build-final.py
"""
import os, subprocess, shutil, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(ROOT, 'assets')
OUT = os.path.join(ROOT, 'out')
PIC = os.path.abspath(os.path.join(ROOT, '..', '..', 'DiligenceIQ Launch Film.mp4'))
WEB = os.path.abspath(os.path.join(ROOT, '..', '..', 'apps', 'web', 'public', 'media'))
FF = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
FP = shutil.which('ffprobe') or '/opt/homebrew/bin/ffprobe'
os.makedirs(OUT, exist_ok=True)

def run(a):
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode:
        print(' '.join(a[:12]), '...\n', r.stderr[-2500:]); sys.exit(1)

def dur(p):
    return float(subprocess.run([FP, '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'csv=p=0', p], capture_output=True, text=True).stdout.strip())

TOTAL = dur(PIC)

# file, start (s), trim (from, to) or None. In-points follow narration.md; segment 4 is
# split at its sentence break so "every number is verified" lands on the green
# "All 54 figures found" highlight at 43.0s.
VO = [('01', 0.6, None),
      ('02', 7.0, None),
      ('03', 21.5, None),
      ('04', 33.6, (0.0, 3.57)),     # "The result is a Diligence Brief, ... investment memo."
      ('04', 39.6, (3.57, None)),    # "Every claim opens ... verified against the filing it cites."
      ('05', 47.5, None),
      ('06', 54.5, None)]

# name, start (s), volume. Light and barely conscious.
SFXQ = [('whoosh-short', 0.1, 0.10),  # wordmark settles on the title card
        ('tick',   26.95, 0.55),  # Run analysis pressed (~27.0)
        ('chime',  42.95, 0.42),  # "All 54 figures found" highlight (43.0)
        ('whoosh', 52.9, 0.09)]   # swell into the end-card dissolve (54)

MUSIC = os.environ.get('DIQ_MUSIC', 'B-premium-sleek')
MUS_VOL = float(os.environ.get('DIQ_MUSIC_VOL', '0.85'))

def audio():
    print(f'picture {TOTAL:.2f}s * music {MUSIC}')
    args = [FF, '-y', '-v', 'error']; parts = []; n = 0; tags = []
    for i, (seg, at, trim) in enumerate(VO):
        args += ['-i', os.path.join(A, 'vo', f'{seg}.mp3')]
        t = ''
        if trim:
            lo, hi = trim
            t = f'atrim=start={lo}' + (f':end={hi}' if hi else '') + ',asetpts=PTS-STARTPTS,'
            t += 'afade=t=in:d=0.02,' if lo else ''
        ms = int(at * 1000)
        parts.append(f'[{n}:a]{t}adelay={ms}|{ms},'
                     f'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[v{i}]')
        tags.append(f'[v{i}]'); n += 1
    parts.append(''.join(tags) + f'amix=inputs={len(tags)}:normalize=0[vo_raw]')
    # light presence lift + gentle compression so the clone sits forward of the bed
    parts.append('[vo_raw]highpass=f=80,equalizer=f=3200:t=q:w=1.2:g=2,'
                 'acompressor=threshold=0.12:ratio=2.5:attack=8:release=120:makeup=1.4,'
                 'volume=1.6,alimiter=limit=0.94,'
                 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
                 'asplit=3[vo][vo_sc][vo_master]')
    # music bed: small lift on the Brief reveal (~33s), full-level resolve on the end card
    args += ['-i', os.path.join(A, 'music', f'{MUSIC}.mp3')]; mi = n; n += 1
    lift = "volume='if(between(t,32.6,36.5),1.18,1)':eval=frame"
    parts.append(f'[{mi}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
                 f'atrim=0:{TOTAL},asetpts=PTS-STARTPTS,'
                 # even out the bed's own build (candidate B rises ~5 dB after 20s)
                 f'acompressor=threshold=0.06:ratio=4:attack=80:release=600:makeup=1,'
                 f'volume={MUS_VOL},{lift},'
                 f'afade=t=in:st=0:d=0.8,afade=t=out:st={TOTAL-2.4:.2f}:d=2.4[mus]')
    if os.environ.get('DIQ_DUCK') == 'soft':
        parts.append('[mus][vo_sc]sidechaincompress=threshold=0.05:ratio=4:attack=25:release=350:makeup=1[mus_d]')
    else:  # a steady ~5 dB duck under the voice, per the script's direction
        parts.append('[mus][vo_sc]sidechaincompress=threshold=0.045:ratio=2.5:attack=30:release=650:makeup=1[mus_d]')
    parts.append('[mus_d]asplit=2[mus_mix][mus_stem]')
    sx = []
    for name, at, vol in SFXQ:
        args += ['-i', os.path.join(A, 'sfx', f'{name}.mp3')]
        ms = int(at * 1000)
        parts.append(f'[{n}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
                     f'volume={vol},adelay={ms}|{ms}[s{n}]')
        sx.append(f'[s{n}]'); n += 1
    parts.append(''.join(sx) + f'amix=inputs={len(sx)}:normalize=0[sfx]')
    parts.append(f'[vo][mus_mix][sfx]amix=inputs=3:normalize=0,apad,atrim=0:{TOTAL},'
                 f'asetpts=N/SR/TB,loudnorm=I=-16:TP=-1.5:LRA=11,'
                 f'aformat=sample_fmts=fltp:sample_rates=48000[mix]')
    args += ['-filter_complex', ';'.join(parts),
             '-map', '[mix]', '-c:a', 'pcm_s24le', os.path.join(OUT, 'mix-master.wav'),
             '-map', '[vo_master]', '-c:a', 'pcm_s24le', os.path.join(OUT, 'vo-master.wav'),
             '-map', '[mus_stem]', '-c:a', 'pcm_s24le', os.path.join(OUT, 'music-ducked-stem.wav')]
    run(args)
    shutil.copyfile(os.path.join(A, 'music', f'{MUSIC}.mp3'), os.path.join(OUT, 'music-master.mp3'))
    print(f'  mix {dur(os.path.join(OUT, "mix-master.wav")):.2f}s')

POSTER_AT = 4.5   # title card: wordmark + "Turn SEC filings into investment decisions."
def mux():
    final = os.path.join(OUT, 'DiligenceIQ-Launch-Film-FINAL.mp4')
    run([FF, '-y', '-v', 'error', '-i', PIC, '-i', os.path.join(OUT, 'mix-master.wav'),
         '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
         '-ar', '48000', '-movflags', '+faststart', '-shortest', final])
    jpg = os.path.join(OUT, 'poster.jpg')
    run([FF, '-y', '-v', 'error', '-ss', str(POSTER_AT), '-i', PIC, '-frames:v', '1', '-q:v', '2', jpg])
    # web copy: 1080p, still-image tuned (UI screencast), small enough to commit
    web = os.path.join(OUT, 'diligenceiq-launch-film.mp4')
    run([FF, '-y', '-v', 'error', '-i', final, '-map', '0:v:0', '-map', '0:a:0',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-tune', 'stillimage',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', web])
    print(f'\nFINAL {final}  {dur(final):.2f}s')
    print(f'WEB   {web}  {os.path.getsize(web)/1e6:.1f} MB')

def publish():
    os.makedirs(WEB, exist_ok=True)
    shutil.copyfile(os.path.join(OUT, 'diligenceiq-launch-film.mp4'), os.path.join(WEB, 'diligenceiq-launch-film.mp4'))
    shutil.copyfile(os.path.join(OUT, 'poster.jpg'), os.path.join(WEB, 'diligenceiq-launch-film-poster.jpg'))
    shutil.copyfile(os.path.join(ROOT, 'diligenceiq-launch-film.vtt'), os.path.join(WEB, 'diligenceiq-launch-film.vtt'))
    print(f'published to {WEB}')

if __name__ == '__main__':
    audio(); mux()
    if '--publish' in sys.argv: publish()
