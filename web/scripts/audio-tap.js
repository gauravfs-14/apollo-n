// Init script for recorded playthroughs: every node connected to a live AudioContext's speakers is also
// connected to a MediaStreamDestination, so the game's real mix (music, sfx, radio voices) can be recorded.
// window.__audioRec.start() / await window.__audioRec.stop() -> [{ t0 (epoch ms), b64 (webm/opus) }]
(() => {
  const orig = AudioNode.prototype.connect;
  const taps = [];
  let recording = false;
  const begin = (tap) => {
    const rec = new MediaRecorder(tap.dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192000 });
    tap.chunks = [];
    rec.ondataavailable = (e) => e.data.size && tap.chunks.push(e.data);
    rec.start(1000);
    tap.rec = rec;
    tap.t0 = performance.timeOrigin + performance.now();
  };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const res = orig.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && dest.context instanceof AudioContext) {
      const ctx = dest.context;
      let tap = taps.find((t) => t.ctx === ctx);
      if (!tap) {
        tap = { ctx, dest: ctx.createMediaStreamDestination() };
        taps.push(tap);
        if (recording) begin(tap);
      }
      orig.call(this, tap.dest);
    }
    return res;
  };
  window.__audioRec = {
    start() {
      recording = true;
      for (const t of taps) if (!t.rec) begin(t);
      return taps.length;
    },
    async stop() {
      recording = false;
      const out = [];
      for (const t of taps) {
        if (!t.rec) continue;
        await new Promise((r) => { t.rec.onstop = r; t.rec.stop(); });
        const buf = new Uint8Array(await new Blob(t.chunks, { type: "audio/webm" }).arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        out.push({ t0: t.t0, b64: btoa(s) });
      }
      return out;
    },
  };
})();
