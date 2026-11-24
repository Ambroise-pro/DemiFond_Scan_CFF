(() => {
  "use strict";

  /*
   * Scanner flottant : une petite fenêtre caméra déplaçable, posée
   * au-dessus de la page de l'exercice. On continue de consulter et de
   * corriger les résultats pendant les scans.
   *
   * open({ title, onText }) : onText(texteDuQR) enregistre le résultat et
   * renvoie { ok, text } pour le message affiché dans la fenêtre.
   */

  const POSITION_KEY = "demifond-floating-scanner-position";
  const SCAN_INTERVAL = 180;
  const MAX_WIDTH = 480;
  const SAME_CODE_DELAY = 3000;

  let panel = null;
  let stream = null;
  let raf = 0;
  let paused = false;
  let handler = null;
  let lastCode = "";
  let lastCodeAt = 0;
  let lastScanAt = 0;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", {willReadFrequently: true});

  function ensureStyles() {
    if (document.getElementById("floatingScannerStyles")) return;
    const style = document.createElement("style");
    style.id = "floatingScannerStyles";
    style.textContent =
      "#floatingScanner{position:fixed;z-index:9000;width:300px;max-width:calc(100vw - 16px);background:#fff;border:1px solid #c9d3de;border-radius:16px;box-shadow:0 18px 40px rgba(15,23,42,.22);overflow:hidden;font-family:inherit;color:#142130}" +
      "#floatingScanner .fs-head{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;background:#142130;color:#fff;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}" +
      "#floatingScanner .fs-head.dragging{cursor:grabbing}" +
      "#floatingScanner .fs-grip{font-size:16px;opacity:.7}" +
      "#floatingScanner .fs-title{flex:1;min-width:0;font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#floatingScanner .fs-head button{min-width:40px;min-height:40px;padding:0 10px;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;font-weight:700}" +
      "#floatingScanner .fs-video{position:relative;background:#000;aspect-ratio:4/3}" +
      "#floatingScanner video{display:block;width:100%;height:100%;object-fit:cover}" +
      "#floatingScanner .fs-target{position:absolute;inset:18% 22%;border:3px solid rgba(255,255,255,.85);border-radius:14px;pointer-events:none}" +
      "#floatingScanner .fs-paused{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.65);color:#fff;font-weight:700}" +
      "#floatingScanner .fs-paused[hidden]{display:none}" +
      "#floatingScanner .fs-message{padding:10px 12px;font-size:14px;line-height:1.4;min-height:40px;background:#f6f8fa}" +
      "#floatingScanner .fs-message.ok{background:#e6f4ec;color:#17603c}" +
      "#floatingScanner .fs-message.bad{background:#fdecec;color:#9b1c1c}";
    document.head.appendChild(style);
  }

  function savedPosition() {
    try {
      const value = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
      if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) return value;
    } catch {}
    return null;
  }

  function place(x, y) {
    const maxX = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    const left = Math.min(Math.max(8, x), maxX);
    const top = Math.min(Math.max(8, y), maxY);
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    return {x:left, y:top};
  }

  function enableDrag(head) {
    let start = null;
    head.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return;
      start = {id:event.pointerId, dx:event.clientX - panel.offsetLeft, dy:event.clientY - panel.offsetTop};
      head.setPointerCapture(event.pointerId);
      head.classList.add("dragging");
    });
    head.addEventListener("pointermove", event => {
      if (!start || event.pointerId !== start.id) return;
      place(event.clientX - start.dx, event.clientY - start.dy);
    });
    const end = event => {
      if (!start || event.pointerId !== start.id) return;
      start = null;
      head.classList.remove("dragging");
      try { localStorage.setItem(POSITION_KEY, JSON.stringify({x:panel.offsetLeft, y:panel.offsetTop})); } catch {}
    };
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  }

  function showMessage(text, kind) {
    const box = panel?.querySelector(".fs-message");
    if (!box) return;
    box.className = "fs-message" + (kind ? " " + kind : "");
    box.textContent = text;
  }

  function build(title) {
    ensureStyles();
    panel = document.createElement("section");
    panel.id = "floatingScanner";
    panel.setAttribute("aria-label", "Scanner flottant");
    panel.innerHTML =
      '<div class="fs-head"><span class="fs-grip" aria-hidden="true">⠿</span><span class="fs-title"></span>' +
      '<button type="button" class="fs-pause">Pause</button>' +
      '<button type="button" class="fs-close" aria-label="Fermer le scanner">✕</button></div>' +
      '<div class="fs-video"><video playsinline muted></video><div class="fs-target"></div><div class="fs-paused" hidden>En pause</div></div>' +
      '<div class="fs-message" aria-live="polite">Présente un QR devant la caméra.</div>';
    panel.querySelector(".fs-title").textContent = "📷 " + title;
    document.body.appendChild(panel);

    const position = savedPosition();
    if (position) place(position.x, position.y);
    else place(window.innerWidth - panel.offsetWidth - 16, window.innerHeight - panel.offsetHeight - 16);

    enableDrag(panel.querySelector(".fs-head"));
    panel.querySelector(".fs-close").onclick = close;
    panel.querySelector(".fs-pause").onclick = () => setPaused(!paused);
  }

  function setPaused(value) {
    paused = value;
    if (!panel) return;
    panel.querySelector(".fs-pause").textContent = paused ? "Reprendre" : "Pause";
    panel.querySelector(".fs-paused").hidden = !paused;
  }

  function loop(now) {
    if (!stream || !panel) return;
    raf = requestAnimationFrame(loop);
    if (paused || now - lastScanAt < SCAN_INTERVAL) return;
    lastScanAt = now;

    const video = panel.querySelector("video");
    if (video.readyState < 2 || !video.videoWidth || typeof window.jsQR !== "function") return;

    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(image.data, image.width, image.height, {inversionAttempts: "dontInvert"});
    if (!code?.data) return;

    // Le même QR reste souvent devant la caméra : on ne le relit qu'après un délai.
    if (code.data === lastCode && Date.now() - lastCodeAt < SAME_CODE_DELAY) return;
    lastCode = code.data;
    lastCodeAt = Date.now();
    read(code.data);
  }

  function read(text) {
    if (!handler) return;
    try {
      const result = handler(text);
      if (result?.text) showMessage(result.text, result.ok ? "ok" : "bad");
    } catch (error) {
      showMessage("Lecture impossible : " + error.message, "bad");
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showMessage("Caméra indisponible sur cet appareil.", "bad");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: "environment"}}, audio: false});
      if (!panel) {
        s.getTracks().forEach(track => track.stop());
        return;
      }
      stream = s;
      const video = panel.querySelector("video");
      video.srcObject = s;
      await video.play();
      raf = requestAnimationFrame(loop);
    } catch {
      showMessage("Caméra refusée : autorise l’accès à la caméra pour scanner.", "bad");
    }
  }

  function open({title, onText}) {
    handler = onText;
    if (panel) {
      setTitle(title);
      setPaused(false);
      return;
    }
    build(title);
    setPaused(false);
    startCamera();
  }

  function setTitle(title) {
    const node = panel?.querySelector(".fs-title");
    if (node) node.textContent = "📷 " + title;
  }

  function close() {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    handler = null;
    panel?.remove();
    panel = null;
    lastCode = "";
  }

  // La fenêtre reste dans l'écran quand l'iPad pivote.
  window.addEventListener("resize", () => {
    if (panel) place(panel.offsetLeft, panel.offsetTop);
  });

  window.DFFloatingScanner = {
    open,
    close,
    setTitle,
    isOpen: () => !!panel
  };
})();
