#!/usr/bin/env python3
"""
DiligenceIQ Launch Film v2 — final audio pass.

The picture is the 92s silent cut authored in Claude Design from claude-design-brief.md
(`DiligenceIQ Launch Film v2.mp4` at the repo root). This scores it: narration in Mike's
ElevenLabs voice clone placed on the picture's sync points, an original instrumental bed
level-flattened and sidechain-ducked under the voice, and light sound design.
Video is stream-copied, never re-encoded.

Usage:  python3 build-final.py                       # default music candidate
        DIQ_MUSIC=B-minimal-piano python3 build-final.py
        python3 build-final.py --publish             # also copy into apps/web/public/media
"""
import os, subprocess, shutil, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(ROOT, '..', '..', '..'))
A = os.path.join(ROOT, 'assets')
OUT = os.path.join(ROOT, 'out')
PIC = os.path.join(REPO, 'DiligenceIQ Launch Film v2.mp4')
WEB = os.path.join(REPO, 'apps', 'web', 'public', 'media')
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

# file, start (s), trim (from, to) or None. Sync points are read off the picture (see narration.md).
VO = [('01', 2.6, None),            # question finishes typing at ~3.0
      ('02', 10.8, None),           # logo forms at 10.0
      ('03a', 16.0, None),          # dashboard, "The first read" caption
      ('03b', 23.3, None),          # $4.5B signal card
      ('04', 34.4, None),           # "exactly one model call" on the "Generating diligence brief" step (41.0)
      ('05', 46.6, None),           # brief appears at 46
      ('06', 54.9, (0.0, 2.28)),    # "Every claim opens the passage…": drawer opens at 55.5
      ('06', 58.5, (2.28, None)),   # "…every number is checked…": 54-of-54 pill at 59.5
      ('07', 63.0, None),           # Compare
      ('08', 71.9, None),           # one phrase per value number (72 / 73 / 74)
      ('09', 78.3, None),           # future rows at 78.5 / 79.5 / 80.5
      ('10', 84.5, None)]           # end card: logo at 84.5, phrases from 85.0

# name, start (s), volume. Light and barely conscious.
SFXQ = [('typing',       0.15, 0.22),  # the question types in (0–3.0)
        ('whoosh-short', 9.7,  0.10),  # logo forms (10.0)
        ('tick',         36.45, 0.50), # Run analysis pressed
        ('tick',         55.0, 0.32),  # citation chip clicked, drawer opens
        ('chime',        59.45, 0.42), # "54 of 54 figures verified"
        ('whoosh',       83.2, 0.09)]  # swell into the end card (84.5)

MUSIC = os.environ.get('DIQ_MUSIC', 'B-minimal-piano')
MUS_VOL = float(os.environ.get('DIQ_MUSIC_VOL', '1.5'))

VO_TARGET = -19.0   # LUFS per line before the bus, so every line sits at the same level

def loudness(path, trim):
    lo, hi = trim or (0.0, None)
    a = [FF, '-nostats', '-ss', str(lo), '-i', path] + (['-t', str(hi - lo)] if hi else []) + ['-af', 'ebur128', '-f', 'null', '-']
    err = subprocess.run(a, capture_output=True, text=True).stderr
    tail = err[err.rfind('Integrated loudness'):]
    return float(tail.split('I:')[1].split('LUFS')[0])

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
        gain = VO_TARGET - loudness(os.path.join(A, 'vo', f'{seg}.mp3'), trim)
        parts.append(f'[{n}:a]{t}volume={gain:.2f}dB,adelay={ms}|{ms},'
                     f'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[v{i}]')
        tags.append(f'[v{i}]'); n += 1
    # pad the voice bus to picture length so the sidechain key never ends before the music (was a chop at 87.3s)
    parts.append(''.join(tags) + f'amix=inputs={len(tags)}:normalize=0,apad=whole_dur={TOTAL}[vo_raw]')
    # presence lift + gentle compression, then a leveler so every line sits at the same loudness
    parts.append('[vo_raw]highpass=f=80,equalizer=f=3200:t=q:w=1.2:g=2,'
                 'acompressor=threshold=0.12:ratio=2.5:attack=8:release=120:makeup=1.4,'
                 'volume=1.6,alimiter=limit=0.94,'
                 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
                 'asplit=3[vo][vo_sc][vo_master]')
    args += ['-i', os.path.join(A, 'music', f'{MUSIC}.mp3')]; mi = n; n += 1
    lift = "volume='if(between(t,54.5,62.5),1.15,1)':eval=frame"   # small lift on the verify beat
    parts.append(f'[{mi}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
                 f'atrim=0:{TOTAL},asetpts=PTS-STARTPTS,'
                 f'acompressor=threshold=0.06:ratio=4:attack=80:release=600:makeup=1,'
                 f'volume={MUS_VOL},{lift},'
                 f'afade=t=in:st=0:d=0.8,afade=t=out:st={TOTAL-3.0:.2f}:d=3.0[mus]')
    parts.append('[mus][vo_sc]sidechaincompress=threshold=0.09:ratio=2.2:attack=30:release=650:makeup=1[mus_d]')
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
                 f'asetpts=N/SR/TB,loudnorm=I=-16:TP=-2.3:LRA=11,'
                 f'aformat=sample_fmts=fltp:sample_rates=48000[mix]')
    args += ['-filter_complex', ';'.join(parts),
             '-map', '[mix]', '-c:a', 'pcm_s24le', os.path.join(OUT, 'mix-master.wav'),
             '-map', '[vo_master]', '-c:a', 'pcm_s24le', os.path.join(OUT, 'vo-master.wav'),
             '-map', '[mus_stem]', '-c:a', 'pcm_s24le', os.path.join(OUT, 'music-ducked-stem.wav')]
    run(args)
    print(f'  mix {dur(os.path.join(OUT, "mix-master.wav")):.2f}s')

POSTER_AT = float(os.environ.get('DIQ_POSTER_AT', '6.0'))   # the question card, fully typed
def mux():
    final = os.path.join(OUT, 'DiligenceIQ-Launch-Film-v2-FINAL.mp4')
    run([FF, '-y', '-v', 'error', '-i', PIC, '-i', os.path.join(OUT, 'mix-master.wav'),
         '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
         '-ar', '48000', '-movflags', '+faststart', '-shortest', final])
    run([FF, '-y', '-v', 'error', '-ss', str(POSTER_AT), '-i', PIC, '-frames:v', '1', '-q:v', '2',
         os.path.join(OUT, 'poster.jpg')])
    web = os.path.join(OUT, 'diligenceiq-launch-film.mp4')
    run([FF, '-y', '-v', 'error', '-i', final, '-map', '0:v:0', '-map', '0:a:0',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-tune', 'stillimage',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-af', 'volume=-0.6dB',  # 160k AAC overshot to -1.3 dBTP '-movflags', '+faststart', web])
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
