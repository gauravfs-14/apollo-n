// Init script for recorded playthroughs: draws the mouse pointer, click ripples and the keys being pressed,
// so a viewer can see what the player is doing. Pure DOM on top of the game, pointer-events none.
(() => {
  const NAMES = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Space", Escape: "Esc", Enter: "Enter", ShiftLeft: "Shift", ShiftRight: "Shift", Backspace: "⌫", Tab: "Tab" };
  const label = (e) => NAMES[e.code] ?? (e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const css = `
  nextjs-portal{display:none!important}
  #io-root{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
  #io-cursor{position:absolute;left:0;top:0;width:26px;height:26px;transform:translate(-3px,-2px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}
  .io-ripple{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #ffb547;background:rgba(255,181,71,.18);animation:io-r .55s ease-out forwards}
  .io-ripple.r{border-color:#5fd0ff;background:rgba(95,208,255,.18)}
  @keyframes io-r{from{transform:scale(.35);opacity:1}to{transform:scale(1.25);opacity:0}}
  #io-keys{position:absolute;left:0;right:0;top:62px;display:flex;gap:8px;align-items:flex-start;justify-content:center}
  .io-key{min-width:46px;height:46px;padding:0 12px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:600;color:#fff;
    background:rgba(18,22,30,.82);border:1px solid rgba(255,255,255,.28);box-shadow:0 3px 0 rgba(255,255,255,.12),0 6px 18px rgba(0,0,0,.45);transition:opacity .35s,transform .1s}
  .io-key.down{background:rgba(255,181,71,.92);color:#111;border-color:#ffb547;transform:translateY(2px);box-shadow:0 1px 0 rgba(255,255,255,.2),0 4px 12px rgba(0,0,0,.4)}
  .io-key.gone{opacity:0}
  .io-key.mouse{font-size:15px}`;
  function mount() {
    if (document.getElementById("io-root")) return;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    const root = document.createElement("div");
    root.id = "io-root";
    root.innerHTML = `<svg id="io-cursor" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg><div id="io-keys"></div>`;
    document.body.appendChild(root);
    const cur = root.querySelector("#io-cursor"), keys = root.querySelector("#io-keys");
    // the drawn pointer glides to the real one, so instant scripted jumps read like hand movement
    let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty;
    const tick = () => {
      x += (tx - x) * 0.3;
      y += (ty - y) * 0.3;
      cur.style.transform = `translate(${x - 3}px,${y - 2}px)`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    addEventListener("pointermove", (e) => { if (!document.pointerLockElement) { tx = e.clientX; ty = e.clientY; } }, true);
    const held = new Map();
    const show = (id, text, cls = "") => {
      let el = held.get(id);
      if (!el) {
        el = document.createElement("div");
        el.className = "io-key " + cls;
        el.textContent = text;
        keys.appendChild(el);
        held.set(id, el);
      }
      clearTimeout(el._t);
      el.classList.remove("gone");
      el.classList.add("down");
      while (keys.children.length > 6) { const f = keys.firstChild; for (const [k, v] of held) if (v === f) held.delete(k); f.remove(); }
    };
    const release = (id) => {
      const el = held.get(id);
      if (!el) return;
      el.classList.remove("down");
      el._t = setTimeout(() => { el.classList.add("gone"); setTimeout(() => { if (held.get(id) === el) held.delete(id); el.remove(); }, 400); }, 700);
    };
    addEventListener("keydown", (e) => show("k" + e.code, label(e)), true);
    addEventListener("keyup", (e) => release("k" + e.code), true);
    addEventListener("pointerdown", (e) => {
      tx = e.clientX; ty = e.clientY;
      const r = document.createElement("div");
      r.className = "io-ripple" + (e.button === 2 ? " r" : "");
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      root.appendChild(r);
      setTimeout(() => r.remove(), 600);
      if (e.detail >= 2) {
        show("m", "Double-click", "mouse");
        release("m");
      }
    }, true);
    addEventListener("wheel", () => { show("w", "Scroll", "mouse"); release("w"); }, { capture: true, passive: true });
  }
  if (document.body) mount();
  else addEventListener("DOMContentLoaded", mount);
})();
