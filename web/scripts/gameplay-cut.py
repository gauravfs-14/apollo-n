# Cuts the full recording (scripts/gameplay-video.mjs) to about two minutes: short real-time stretches of every phase;
# only pure animations are sped up (tempo-matched audio, speed tag on screen). Times are for one particular take: re-check them after re-recording.
import os, subprocess
SRC="/tmp/gameplay/gameplay.mp4"
# (start, end, speed)
EDL=[(0,3,1),(6,10,1),                                   # menu, level select
     (12,16,1),(27,31,1),(40,43,1),                       # build: pick parts, lock in
     (46,52,1),(74,77,1),(80,84,1),(90,93,1),             # crew, at the hatch, checklist
     (100,115,1),(120,132,1.5),                           # liftoff, staging in space (animation)
     (142,146,1),(147,152,1),                             # cruise hurdle
     (167,171,1),(176,180,1),(182,186,1),(188,193,1),     # site: scan, probe, hint, 300 test landings
     (210,226,2),(237,249,1),(250,256,1),                 # descent (high part is animation), touchdown, score
     (259,270,1),(290,297,1)]                             # surface, report
def atempo(s):
    f=[]
    while s>2.0: f.append("atempo=2.0"); s/=2.0
    f.append(f"atempo={s:.4f}"); return ",".join(f)

OUT="/tmp/gameplay/gameplay-2min.mp4"
WORK="/tmp/gameplay/cut"
X=0.35  # crossfade between stretches (picture and sound) so the cuts don't jump
os.makedirs(WORK, exist_ok=True)
ff=lambda *a: subprocess.run(["ffmpeg","-loglevel","error","-y",*a],check=True)
V=["-c:v","libx264","-preset","veryfast","-crf","12","-pix_fmt","yuv420p","-r","60"]
n=len(EDL)
durs=[(b-a)/s for a,b,s in EDL]

# 1. each stretch on its own: speed, speed tag, audio as wav
for i,(a,b,s) in enumerate(EDL):
    tag = f",drawtext=text='{s:g}x speed':x=w-tw-28:y=h-th-28:fontsize=26:fontcolor=white@0.9:box=1:boxcolor=black@0.55:boxborderw=10" if s>1.05 else ""
    ff("-ss",str(a),"-t",str(b-a),"-i",SRC,"-vf",f"setpts=(PTS-STARTPTS)/{s},fps=60{tag}","-an",*V,f"{WORK}/s{i}.mp4")
    # the in-game recorder writes no packets while the game is silent: fill those gaps with silence at their real time
    try:
        ff("-ss",str(a),"-t",str(b-a),"-i",SRC,"-vn","-af",f"aresample=48000:async=1:first_pts=0,{atempo(s)},apad,atrim=0:{durs[i]:.4f}","-ac","2",f"{WORK}/s{i}.wav")
    except subprocess.CalledProcessError:
        ff("-f","lavfi","-i","anullsrc=r=48000:cl=stereo","-t",f"{durs[i]:.4f}",f"{WORK}/s{i}.wav")

# 2. picture: body of every stretch + a short crossfade clip between neighbours, then joined end to end
parts=[]
for i in range(n):
    t0=X if i>0 else 0; t1=durs[i]-X if i<n-1 else durs[i]
    ff("-ss",f"{t0:.3f}","-to",f"{t1:.3f}","-i",f"{WORK}/s{i}.mp4",*V,f"{WORK}/b{i}.mp4"); parts.append(f"b{i}.mp4")
    if i<n-1:
        ff("-ss",f"{durs[i]-X:.3f}","-i",f"{WORK}/s{i}.mp4","-t",str(X),"-i",f"{WORK}/s{i+1}.mp4",
           "-filter_complex",f"[0:v]setpts=PTS-STARTPTS,fps=60[x];[1:v]setpts=PTS-STARTPTS,fps=60[y];[x][y]xfade=transition=fade:duration={X}:offset=0",*V,f"{WORK}/t{i}.mp4")
        parts.append(f"t{i}.mp4")
open(f"{WORK}/list.txt","w").write("".join(f"file '{p}'\n" for p in parts))

# 3. sound: crossfade chain over the wavs (cheap), then mux and encode once
ins=sum((["-i",f"{WORK}/s{i}.wav"] for i in range(n)),[])
fc=[];cur="[0:a]"
for i in range(1,n):
    fc.append(f"{cur}[{i}:a]acrossfade=d={X}[x{i}]"); cur=f"[x{i}]"
ff(*ins,"-filter_complex",";".join(fc),"-map",cur,f"{WORK}/audio.wav")
ff("-f","concat","-safe","0","-i",f"{WORK}/list.txt","-i",f"{WORK}/audio.wav","-map","0:v","-map","1:a",
   "-c:v","libx264","-preset","slow","-crf","18","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart","-shortest",OUT)
print("planned", round(sum(durs)-X*(n-1),1), "s ->", OUT)
