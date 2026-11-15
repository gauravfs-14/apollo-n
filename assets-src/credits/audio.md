# Mission audio sources

## Radio scripts (web/game/data/missionComms.ts)
Real Apollo 11 transmissions from NASA's raw transcripts (US Government works, public domain;
"no copyright is asserted" for the raw transcripts). Call signs are adapted per mission.
- Technical Air-to-Ground Voice Transcription (GOSS NET 1):
  https://nasa.gov/wp-content/uploads/static/history/alsj/a11/a11transcript_tec.html
- Apollo 11 Mission Commentary (public affairs loop):
  https://nasa.gov/wp-content/uploads/static/history/alsj/a11/a11transcript_pao.html
- Index: https://nasa.gov/wp-content/uploads/static/history/alsj/a11/a11trans.html
The edited Apollo Flight Journal / Lunar Surface Journal pages are copyrighted by their editors and were not used.
One line comes from Apollo 13 ("Houston, we've had a problem"), used for the tipped-lander outcome.

## Voices
ElevenLabs text-to-speech (eleven_v3), premade voices: Bill (CAPCOM), Brian (commander),
Eric (lunar module pilot / recovery), Adam (public affairs). Generated at runtime and cached in api/data/media/voice.

## Sound effects and ambience (ElevenLabs sound generation)
| File (web/public/audio) | Prompt (short) |
|---|---|
| sfx/rocket_roar.mp3 | Saturn V launch heard from a few miles away |
| sfx/ignition.mp3 | rocket engines igniting on the pad |
| sfx/staging.mp3 | stage separation: pyrotechnic bang and clunk |
| ambience/mcc.mp3 | 1960s mission control room ambience (loop) |
| ambience/cabin.mp3 | spacecraft cabin hum, fans and pumps (loop) |
| ambience/suit.mp3 | breathing inside a space helmet with suit fan (loop) |
Loudness-normalized with ffmpeg (one-shots: -16/-18 LUFS with edge fades; loops: -24 LUFS, mono 64 kbps).
Check ElevenLabs' terms for your plan before commercial use of generated audio.
