# Cuts the full recording (scripts/gameplay-video.mjs) to about two minutes: a dozen long real-time takes, cut only
# between radio lines and joined by short dips to black. A speed other than 1 tempo-matches audio and tags the picture. Times are for one particular take: re-check them after re-recording.
import os, subprocess
SRC="/tmp/gameplay/gameplay.mp4"
# (start, end, speed)
EDL=[(0.5,3.5,1),(6,9.5,1),            # menu, level select
     (31,41,1),(45,49,1),                # lander build (parts snapping on, lock in), crew
     (101.2,118.2,1),(121,130,1),        # countdown "six" to liftoff, staging in space
     (144,156,1),(182,196.5,1),          # cruise hurdle solved, landing site: hint, probe, 300 test landings
     (236.5,260.6,1),                    # final descent, dust, touchdown, score, "touchdown right on the spot"
     (264,273,1),(336,344,1),(367,374,1),# down the ladder, mission goal reached, explore: a site's card
     (379,385,1)]                        # mission report
def atempo(s):
    f=[]
    while s>2.0: f.append("atempo=2.0"); s/=2.0
    f.append(f"atempo={s:.4f}"); return ",".join(f)

OUT="/tmp/gameplay/gameplay-2min.mp4"
WORK="/tmp/gameplay/cut"
X=0.5  # dip through black between takes, like the game's own phase changes
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
           "-filter_complex",f"[0:v]setpts=PTS-STARTPTS,fps=60[x];[1:v]setpts=PTS-STARTPTS,fps=60[y];[x][y]xfade=transition=fadeblack:duration={X}:offset=0",*V,f"{WORK}/t{i}.mp4")
        parts.append(f"t{i}.mp4")
open(f"{WORK}/list.txt","w").write("".join(f"file '{p}'\n" for p in parts))

# 3. sound: crossfade chain over the wavs (cheap), then mux and encode once
ins=sum((["-i",f"{WORK}/s{i}.wav"] for i in range(n)),[])
fc=[];cur="[0:a]"
for i in range(1,n):
    fc.append(f"{cur}[{i}:a]acrossfade=d={X}[x{i}]"); cur=f"[x{i}]"
ff(*ins,"-filter_complex",";".join(fc),"-map",cur,f"{WORK}/audio.wav")
total=sum(durs)-X*(n-1)
ff("-f","concat","-safe","0","-i",f"{WORK}/list.txt","-i",f"{WORK}/audio.wav","-map","0:v","-map","1:a",
   "-vf",f"fade=t=out:st={total-1.2:.3f}:d=1.2","-af",f"afade=t=in:d=0.4,afade=t=out:st={total-1.5:.3f}:d=1.5",
   "-c:v","libx264","-preset","slow","-crf","18","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart","-shortest",OUT)
print("planned", round(sum(durs)-X*(n-1),1), "s ->", OUT)
