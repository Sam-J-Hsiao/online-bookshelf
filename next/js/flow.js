// Cover flow 動畫引擎
// - 位置是連續的浮點數 pos（0 = 第一本），每一幀依 pos 算出每本書的 3D 變形，
//   所以觸控板、拖曳、滑桿都能「跟手」移動，中間任何位置都是平滑的。
// - 放手（或觸控板慣性結束）後，用臨界阻尼彈簧吸附到最近的一本，速度會被延續。
// - 只在動畫進行時跑 requestAnimationFrame，靜止時不耗電。

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createFlow(el, { onIndex, onSettle, onFrame, onActivate } = {}) {
  let items = [], n = 0;
  let pos = 0, vel = 0, target = 0;
  let mode = "idle";               // idle | spring | wheel | drag
  let raf = 0, lastIdx = -1, wheelTimer = 0, settledIdx = -1;
  let gap = 160, step = 60;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  const measure = () => {
    const cw = parseFloat(getComputedStyle(el).getPropertyValue("--cw")) || el.clientWidth * .15;
    // 寬螢幕讓兩側的書攤得開一點，窄螢幕收緊
    gap = cw * (el.clientWidth < 560 ? .72 : .86);
    step = cw * (el.clientWidth < 560 ? .26 : .34);
  };

  // 超出頭尾時給一點橡皮筋阻力
  const rubber = p => {
    if (p < 0) return -(1 - 1 / (1 - p * .9)) / .9 * .55;
    const max = n - 1;
    if (p > max) return max + (1 - 1 / (1 + (p - max) * .9)) / .9 * .55;
    return p;
  };

  function layout() {
    for (let i = 0; i < n; i++) {
      const d = i - pos, a = Math.abs(d), s = Math.sign(d), t = Math.min(a, 1);
      // 中間那本在 |d|<1 的區間做連續插值，所以不會「跳一格」
      const ease = t * t * (3 - 2 * t);                       // smoothstep
      const x = a < 1 ? d * gap : s * (gap + (a - 1) * step);
      const ry = -s * ease * 62;
      const z = (1 - ease) * 110 - a * 18;
      const it = items[i];
      it.style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg)`;
      it.style.zIndex = String(1000 - Math.round(a * 10));
      const fade = a > 5 ? clamp(6.5 - a, 0, 1) : 1;
      it.style.opacity = fade.toFixed(3);
      it.style.visibility = fade <= 0 ? "hidden" : "visible";
      it.style.setProperty("--shade", (ease * .32 + Math.max(0, a - 1) * .03).toFixed(3));
    }
    const idx = n ? clamp(Math.round(pos), 0, n - 1) : -1;
    if (idx !== lastIdx) { lastIdx = idx; onIndex?.(idx); }
    onFrame?.(n > 1 ? clamp(pos / (n - 1), 0, 1) : 0, pos);
  }

  function loop() {
    raf = 0;
    if (mode === "spring") {
      // 臨界阻尼附近的彈簧：快速收斂、只有極輕微的過衝
      const k = .085, damp = .76;
      vel = vel * damp + (target - pos) * k;
      pos += vel;
      if (Math.abs(target - pos) < .0008 && Math.abs(vel) < .0008) {
        pos = target; vel = 0; mode = "idle"; layout(); settle(); return;
      }
    }
    layout();
    if (mode !== "idle") raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  function settle() {
    const idx = clamp(Math.round(pos), 0, n - 1);
    if (idx !== settledIdx) { settledIdx = idx; onSettle?.(idx); }
  }

  function springTo(i, v = vel) {
    target = clamp(i, 0, Math.max(0, n - 1));
    vel = v;
    if (reduce.matches) { pos = target; vel = 0; mode = "idle"; layout(); settle(); return; }
    mode = "spring"; kick();
  }

  /* ── 觸控板／滑鼠滾輪 ── */
  let raw = 0, lastWheelT = 0, wheelVel = 0;
  el.addEventListener("wheel", e => {
    if (n < 2) return;
    const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY) * .9;
    // 垂直滾動留給頁面，除非按住 Shift（一般滑鼠的水平捲動）
    if (!horiz && !e.shiftKey) return;
    e.preventDefault();
    let dx = horiz ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) dx *= 32; else if (e.deltaMode === 2) dx *= el.clientWidth;
    if (mode !== "wheel") { raw = pos; mode = "wheel"; }
    raw += dx / (gap * 1.15);
    raw = clamp(raw, -.9, n - .1);
    const now = performance.now(), dt = Math.max(8, now - lastWheelT); lastWheelT = now;
    const prev = pos;
    pos = rubber(raw);
    wheelVel = wheelVel * .6 + ((pos - prev) / dt * 16.7) * .4;   // 每幀速度的平滑估計
    kick();
    clearTimeout(wheelTimer);
    // 觸控板慣性停止（約 110ms 沒有新事件）後吸附；用目前速度推估落點，保留「甩」的感覺
    wheelTimer = setTimeout(() => {
      const projected = pos + wheelVel * 6;
      mode = "spring";
      springTo(Math.round(projected), wheelVel * .5);
    }, 110);
  }, { passive: false });

  /* ── 拖曳（滑鼠／觸控） ── */
  let startX = 0, startPos = 0, moved = false, samples = [], pid = null;
  el.addEventListener("pointerdown", e => {
    if (n < 1 || (e.pointerType === "mouse" && e.button !== 0)) return;
    pid = e.pointerId; startX = e.clientX; startPos = pos; moved = false; samples = [[performance.now(), e.clientX]];
    clearTimeout(wheelTimer);
  });
  el.addEventListener("pointermove", e => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 6) {
      moved = true; mode = "drag"; el.setPointerCapture(pid); el.classList.add("dragging");
    }
    if (!moved) return;
    pos = rubber(startPos - dx / gap);
    samples.push([performance.now(), e.clientX]); if (samples.length > 6) samples.shift();
    kick();
  });
  const end = e => {
    if (e.pointerId !== pid) return;
    pid = null; el.classList.remove("dragging");
    if (!moved) {                                    // 點擊：翻到那本書；點中間那本則觸發 onActivate
      const it = e.target.closest?.(".book");
      if (it) {
        const i = +it.dataset.i;
        if (i === clamp(Math.round(pos), 0, n - 1)) onActivate?.(i); else springTo(i, 0);
      }
      return;
    }
    const [t0, x0] = samples[0], [t1, x1] = samples[samples.length - 1];
    const v = (x1 - x0) / Math.max(16, t1 - t0) * 16.7 / gap;     // 每幀移動幾本
    const projected = pos - v * 7;
    springTo(Math.round(projected), -v * .6);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  /* ── 鍵盤 ── */
  el.addEventListener("keydown", e => {
    const map = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (!(e.key in map)) return;
    e.preventDefault();
    const base = mode === "spring" ? target : Math.round(pos);
    springTo(Number.isFinite(map[e.key]) ? base + map[e.key] : map[e.key] < 0 ? 0 : n - 1);
  });

  const ro = new ResizeObserver(() => { measure(); layout(); });
  ro.observe(el);

  return {
    /** 換一批書。keep：要停在哪一本（index）。 */
    setItems(nodes, keep = 0) {
      el.replaceChildren(...nodes);
      items = nodes; n = nodes.length;
      nodes.forEach((nd, i) => { nd.dataset.i = i; });
      measure();
      pos = target = clamp(keep, 0, Math.max(0, n - 1)); vel = 0; mode = "idle";
      lastIdx = -1; settledIdx = -1;
      layout(); settle();
    },
    /** 只更新內容、不重排（例如進度改變） */
    update(fn) { items.forEach((nd, i) => fn(nd, i)); },
    go(delta) { const base = mode === "spring" ? target : Math.round(pos); springTo(base + delta, 0); },
    goTo(i) { springTo(i, 0); },
    /** 滑桿用：0..1 的連續位置 */
    scrubTo(f, done) {
      if (n < 2) return;
      if (done) { springTo(Math.round(f * (n - 1)), 0); return; }
      mode = "drag"; pos = clamp(f, 0, 1) * (n - 1); kick();
    },
    get index() { return clamp(Math.round(pos), 0, Math.max(0, n - 1)); },
    get count() { return n; }
  };
}
