// Fake React DevTools hook: catches the R3F reconciler root, whose container is the R3F store.
(() => {
  const renderers = new Map();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers,
    inject(r) { const id = renderers.size + 1; renderers.set(id, r); return id; },
    onCommitFiberRoot(id, root) { const c = root && root.containerInfo; if (c && typeof c.getState === "function" && c.getState().camera) window.__r3f = c; },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, onScheduleFiberRoot() {}, setStrictMode() {},
  };
})();
