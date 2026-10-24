// Full-screen viewer for scanned pages.
// The page opens fitted to the screen width and scrolls normally (mouse wheel,
// trackpad, one finger). Zoom: pinch, double-click / double-tap, Ctrl + wheel,
// or the + and − buttons. When zoomed, a mouse can also drag the page.
const $ = (id) => document.getElementById(id);
const MIN = 1, MAX = 4, STEP = 1.5;

export function createViewer(label = {
  pageOf: (i, n) => `Page ${i} of ${n}`, scannedOf: (i, n) => `Scanned page ${i} of ${n}`,
}) {
  const root = $('viewer'), stage = $('viewerStage'), img = $('viewerImg');
  const count = $('viewerCount'), prev = $('viewerPrev'), next = $('viewerNext'), close = $('viewerClose');
  const zin = $('viewerZoomIn'), zout = $('viewerZoomOut');
  let urls = [], index = 0, lastFocus = null, s = 1;

  // Width at scale 1: the screen width, but not wider than a comfortable reading size.
  const baseWidth = () => Math.max(200, Math.min(stage.clientWidth - 16, 980));

  function setScale(newScale, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
    newScale = Math.min(MAX, Math.max(MIN, newScale));
    // Keep the point under (cx, cy) in place while the image grows or shrinks.
    const oldW = img.offsetWidth || baseWidth();
    const fx = (stage.scrollLeft + cx - img.offsetLeft) / oldW;
    const fy = (stage.scrollTop + cy - img.offsetTop) / (img.offsetHeight || 1);
    s = newScale;
    img.style.width = `${Math.round(baseWidth() * s)}px`;
    stage.scrollLeft = img.offsetLeft + fx * img.offsetWidth - cx;
    stage.scrollTop = img.offsetTop + fy * img.offsetHeight - cy;
    zin.disabled = s >= MAX; zout.disabled = s <= MIN;
    root.classList.toggle('zoomed', s > MIN);
  }

  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // Double-click (mouse) and double-tap (touch) toggle between fitted and zoomed.
  stage.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const p = local(e);
    setScale(s > MIN ? MIN : 2.5, p.x, p.y);
  });

  // Ctrl + wheel (and trackpad pinch, which browsers report as Ctrl + wheel) zooms;
  // a plain wheel scrolls the page as usual.
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const p = local(e);
    setScale(s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), p.x, p.y);
  }, { passive: false });

  // Two-finger pinch on touch screens; one finger scrolls natively.
  const touches = new Map();
  let pinch = null;
  // Mouse drag to move a zoomed page.
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0 && s > MIN) {
        drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop };
        stage.setPointerCapture(e.pointerId);
      }
      return;
    }
    touches.set(e.pointerId, local(e));
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (drag && e.pointerType === 'mouse') {
      stage.scrollLeft = drag.l - (e.clientX - drag.x);
      stage.scrollTop = drag.t - (e.clientY - drag.y);
      return;
    }
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, local(e));
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(pinch.s * (d / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  });
  const end = (e) => {
    if (e.pointerType === 'mouse') { drag = null; return; }
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  function go(i) {
    if (i < 0 || i >= urls.length) return;
    index = i;
    img.src = urls[index];
    img.alt = label.scannedOf(index + 1, urls.length);
    count.textContent = label.pageOf(index + 1, urls.length);
    prev.disabled = index === 0;
    next.disabled = index === urls.length - 1;
    s = MIN;
    img.style.width = `${baseWidth()}px`;
    stage.scrollTop = 0; stage.scrollLeft = 0;
    zin.disabled = false; zout.disabled = true;
    root.classList.remove('zoomed');
  }

  function onKey(e) {
    if (e.key === 'Escape') hide();
    else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) go(index + 1);
    else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) go(index - 1);
    else if (e.key === '+' || e.key === '=') setScale(s * STEP);
    else if (e.key === '-') setScale(s / STEP);
  }

  function show(list, start = 0) {
    urls = list; lastFocus = document.activeElement;
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    go(start);
    document.addEventListener('keydown', onKey);
    close.focus();
  }

  function hide() {
    root.hidden = true;
    document.body.style.overflow = '';
    img.removeAttribute('src');
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  zin.addEventListener('click', () => setScale(s * STEP));
  zout.addEventListener('click', () => setScale(s / STEP));
  close.addEventListener('click', hide);
  window.addEventListener('resize', () => { if (!root.hidden) setScale(s); });

  return { show, hide, isOpen: () => !root.hidden };
}
