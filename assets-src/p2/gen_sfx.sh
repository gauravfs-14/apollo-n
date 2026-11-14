#!/bin/sh
# Procedurally synthesizes P2's sfx with ffmpeg (no external assets, no licensing). Output: web/public/audio/sfx/
set -e
O=../../web/public/audio/sfx; mkdir -p $O
F="ffmpeg -y -loglevel error"
M="-codec:a libmp3lame -q:a 4 -ar 44100"
$F -f lavfi -i "aevalsrc='(sin(2*PI*410*t)*0.5+sin(2*PI*913*t)*0.32+sin(2*PI*1790*t)*0.18+sin(2*PI*2630*t)*0.1)*exp(-10*t)*min(1,t*800)':d=0.7:s=44100" $M $O/clank.mp3
$F -f lavfi -i "aevalsrc='(sin(2*PI*1500*t)*0.5+(random(0)-0.5)*0.8)*exp(-60*t)':d=0.12:s=44100" $M $O/click.mp3
$F -f lavfi -i "aevalsrc='sin(2*PI*880*t)*0.5*exp(-4*t)*min(1,t*400)':d=0.35:s=44100" $M $O/beep.mp3
$F -f lavfi -i "aevalsrc='(sin(2*PI*660*t)*0.4+sin(2*PI*990*t)*0.3+sin(2*PI*1320*t)*0.2)*exp(-3*t)*min(1,t*300)':d=1.2:s=44100" $M $O/chime.mp3
$F -f lavfi -i "aevalsrc='(sin(2*PI*150*t)+0.5*sin(2*PI*300*t))*0.35*exp(-6*t)':d=0.4:s=44100" $M $O/buzz.mp3
$F -f lavfi -i "anoisesrc=d=1.4:c=white:r=44100:a=0.5" -af "highpass=f=2500,lowpass=f=9000,afade=t=in:d=0.1,afade=t=out:st=0.5:d=0.9" $M $O/hiss.mp3
$F -f lavfi -i "anoisesrc=d=0.5:c=brown:r=44100:a=0.9" -af "lowpass=f=300,afade=t=out:st=0.05:d=0.45" $M $O/thunk.mp3
$F -f lavfi -i "anoisesrc=d=3:c=brown:r=44100:a=0.9" -af "lowpass=f=140,afade=t=in:d=1.2,afade=t=out:st=1.8:d=1.2" $M $O/rumble.mp3
$F -f lavfi -i "anoisesrc=d=20:c=pink:r=44100:a=0.9" -af "lowpass=f=1400,highpass=f=40,tremolo=f=38:d=0.25,afade=t=in:d=3,afade=t=out:st=14:d=6" $M $O/rocket_roar.mp3
$F -f lavfi -i "anoisesrc=d=1.6:c=white:r=44100:a=0.7" -af "highpass=f=600,lowpass=f=5000,afade=t=in:d=0.25,afade=t=out:st=0.3:d=1.3" $M $O/whoosh.mp3
$F -f lavfi -i "anoisesrc=d=5:c=brown:r=44100:a=0.8" -af "lowpass=f=900,afade=t=in:d=4,afade=t=out:st=4.2:d=0.8" $M $O/ignition.mp3
$F -f lavfi -i "aevalsrc='(sin(2*PI*90*t)*0.8)*exp(-12*t)':d=0.5:s=44100" $M $O/boom.mp3
