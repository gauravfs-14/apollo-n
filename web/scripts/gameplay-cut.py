# Cuts the full recording (scripts/gameplay-video.mjs) to about two minutes: kept stretches with their speed,
# tempo-matched audio, a speed tag on sped-up parts. Times are for one particular take: re-check them after re-recording.
import subprocess
SRC="/tmp/gameplay/gameplay.mp4"
# (start, end, speed)
EDL=[(0,3.2,1.5),(5.5,10.5,1.5),(11,43,3.5),(44,55,2.5),(58,62,2),(74,77,1.5),(78,93,3),
     (96,118,1.6),(120,137,2.5),(142,146,1.2),(146,154,2),(167,176,2.5),(176,193,2),
     (196,226,3),(226,250,2),(250,257,1.2),(259,272,1.5),(272,284,2),(290,298,1.3)]
def atempo(s):
    f=[]
    while s>2.0: f.append("atempo=2.0"); s/=2.0
    f.append(f"atempo={s:.4f}"); return ",".join(f)
args=["ffmpeg","-loglevel","error","-y"]
fc=[]
for i,(a,b,s) in enumerate(EDL):
    args+=["-ss",str(a),"-t",str(b-a),"-i",SRC]
    d=(b-a)/s
    tag = f",drawtext=text='{s:g}x speed':x=w-tw-28:y=h-th-28:fontsize=26:fontcolor=white@0.9:box=1:boxcolor=black@0.55:boxborderw=10" if s>1.05 else ""
    fc.append(f"[{i}:v]setpts=(PTS-STARTPTS)/{s},fps=60{tag}[v{i}]")
    fc.append(f"[{i}:a]asetpts=PTS-STARTPTS,{atempo(s)},afade=t=in:d=0.06,afade=t=out:st={max(0,d-0.08):.3f}:d=0.08[a{i}]")
n=len(EDL)
fc.append("".join(f"[v{i}][a{i}]" for i in range(n))+f"concat=n={n}:v=1:a=1[v][a]")
args+=["-filter_complex",";".join(fc),"-map","[v]","-map","[a]","-c:v","libx264","-preset","slow","-crf","18","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart","/tmp/gameplay/gameplay-2min.mp4"]
print("planned", round(sum((b-a)/s for a,b,s in EDL),1), "s")
subprocess.run(args,check=True)
