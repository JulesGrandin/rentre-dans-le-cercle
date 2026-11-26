const BOARD_ORIGIN = "https://rentre-dans-le-cercle.julesgrandin.workers.dev";
const BOARD_NAME_KEY = "rentre-dans-le-cercle-pseudo";
const RADII = [300000, 200000, 100000];
const ROUNDS = RADII.length;
const NEED = 3;
const ROUND_MS = 30000;
const ROUND_CENTIS = 3000;
const CENTIS_PER_SECOND = 100;
const CENTIS_PER_MINUTE = 6000;
const MAP_R = 6378137;
const MAP_M_PER_DEG = MAP_R * Math.PI / 180;
const FRANCE_BOUNDS = [[-5.4, -4.97], [4.88, 4.59]];

const ui = {
  load: document.getElementById("load-overlay"),
  loadText: document.getElementById("load-text"),
  loadFill: document.getElementById("load-bar-fill"),
  intro: document.getElementById("intro-modal"),
  start: document.getElementById("btn-start"),
  timerBlock: document.getElementById("timer-block"),
  timerFill: document.getElementById("timer-fill"),
  timerValue: document.getElementById("timer-value"),
  timerBar: document.querySelector("#timer-block .timer-bar"),
  chrome: document.getElementById("chrome"),
  kicker: document.getElementById("round-kicker"),
  scoreLine: document.getElementById("score-line"),
  historyWrap: document.getElementById("history-wrap"),
  history: document.getElementById("history"),
  dock: document.getElementById("dock"),
  ask: document.getElementById("ask"),
  askLabel: document.getElementById("ask-label"),
  form: document.getElementById("guess-form"),
  guessWrap: document.getElementById("guess-wrap"),
  guess: document.getElementById("guess"),
  validate: document.getElementById("btn-validate"),
  suggest: document.getElementById("suggest"),
  hint: document.getElementById("guess-hint"),
  feedback: document.getElementById("feedback"),
  feedbackKicker: document.getElementById("feedback-kicker"),
  feedbackDetail: document.getElementById("feedback-detail"),
  next: document.getElementById("btn-next"),
  finish: document.getElementById("finish-modal"),
  finalScore: document.getElementById("final-score"),
  finishRecap: document.getElementById("finish-recap"),
  reviewBar: document.getElementById("review-bar"),
  mapReview: document.getElementById("btn-map"),
  backScore: document.getElementById("btn-back"),
  replay: document.getElementById("btn-replay"),
  boardForm: document.getElementById("board-form"),
  boardName: document.getElementById("board-name"),
  boardSave: document.getElementById("board-save"),
  boardNote: document.getElementById("board-note"),
  boardList: document.getElementById("board-list"),
};

const map = new maplibregl.Map({
  container: "map",
  fadeDuration: 0,
  renderWorldCopies: false,
  canvasContextAttributes: { alpha: true },
  style: {
    version: 8,
    sources: {},
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "rgba(0, 0, 0, 0)" } },
    ],
  },
  bounds: FRANCE_BOUNDS,
  fitBoundsOptions: { padding: 28 },
  attributionControl: false,
  maxZoom: 13,
  minZoom: 0,
});

map.scrollZoom.disable();
map.boxZoom.disable();
map.doubleClickZoom.disable();
map.touchZoomRotate.disable();
map.dragPan.disable();
map.dragRotate.disable();
map.keyboard.disable();

let index = null;
let places = [];
let franceRings = [];
let rounds = [];
let round = null;
let center = null;
let centerMark = null;
let seen = new Set();
let launching = false;
let launch = null;
let launchFrame = 0;
let franceMask = null;
let seaCrossPx = 420;
const SEA_CROSS_DEG = 3.9;
let banked = 0;
let locked = false;
let roundStartedAt = 0;
let roundEndsAt = 0;
let timerFrame = 0;
let markers = [];
let suggestItems = [];
let suggestIndex = 0;
let ignoreSubmit = false;
let fullHeight = window.innerHeight;
let fitFrame = 0;
let framedSize = "";
let keepKeyboard = false;
let suggestTouch = null;
let suggestLock = false;

function isPhone() {
  return window.matchMedia("(pointer: coarse) and (max-width: 820px), (pointer: coarse) and (max-height: 520px)").matches;
}

function focusGuess() {
  if (!keepKeyboard || ui.guess.disabled) return;
  if (document.activeElement === ui.guess) return;
  ui.guess.focus({ preventScroll: true });
}

function releaseKeyboard() {
  keepKeyboard = false;
  if (document.activeElement === ui.guess) ui.guess.blur();
}

function lambertToMap(x, y) {
  const lng = (x - 700000) / MAP_M_PER_DEG;
  const merc = (y - 6600000) / MAP_R;
  const lat = (2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * 180 / Math.PI;
  return [lng, lat];
}

function mapToLambert(lng, lat) {
  const merc = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  return [lng * MAP_M_PER_DEG + 700000, merc * MAP_R + 6600000];
}

function fold(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function franceContains(lng, lat) {
  for (let p = 0; p < franceRings.length; p += 1) {
    const rings = franceRings[p];
    if (!ringContains(rings[0], lng, lat)) continue;
    let inHole = false;
    for (let r = 1; r < rings.length; r += 1) {
      if (ringContains(rings[r], lng, lat)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

function circleRing(x, y, radius, steps) {
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push(lambertToMap(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius));
  }
  return ring;
}

function clippedCircle(x, y, radius) {
  return polygonClipping.intersection(franceRings, [circleRing(x, y, radius, 128)]);
}

function coastPoint(inside, outside) {
  let land = inside;
  let sea = outside;
  for (let n = 0; n < 14; n += 1) {
    const mid = [(land[0] + sea[0]) / 2, (land[1] + sea[1]) / 2];
    if (franceContains(mid[0], mid[1])) land = mid;
    else sea = mid;
  }
  return land;
}

function circleStroke(x, y, radius) {
  const steps = 360;
  const ring = circleRing(x, y, radius, steps);
  const inside = ring.map((point) => franceContains(point[0], point[1]));
  const runs = [];
  let run = [];
  for (let i = 0; i < steps; i += 1) {
    if (!inside[i]) {
      if (run.length) {
        runs.push(run);
        run = [];
      }
      continue;
    }
    if (!run.length && !inside[(i + steps - 1) % steps]) {
      run.push(coastPoint(ring[i], ring[(i + steps - 1) % steps]));
    }
    run.push(ring[i]);
    if (!inside[(i + 1) % steps]) run.push(coastPoint(ring[i], ring[(i + 1) % steps]));
  }
  if (run.length) runs.push(run);
  if (inside[0] && inside[steps - 1] && runs.length > 1) {
    const first = runs[0];
    runs[0] = runs.pop().concat(first);
  }
  if (runs.length === 1 && inside.every(Boolean)) runs[0].push(runs[0][0]);
  return {
    type: "FeatureCollection",
    features: runs.filter((line) => line.length > 1).map((line) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: line },
    })),
  };
}

function emptyCollection() {
  return { type: "FeatureCollection", features: [] };
}

function countInside(x, y, radius) {
  const r2 = radius * radius;
  const xs = index.cx;
  const ys = index.cy;
  let total = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - x;
    const dy = ys[i] - y;
    if (dx * dx + dy * dy <= r2) total += 1;
  }
  return total;
}

function isInside(i, x, y, radius) {
  const dx = index.cx[i] - x;
  const dy = index.cy[i] - y;
  return dx * dx + dy * dy <= radius * radius;
}

function randomCenter() {
  const radius = RADII[RADII.length - 1];
  const [[minLng, minLat], [maxLng, maxLat]] = FRANCE_BOUNDS;
  for (let n = 0; n < 80; n += 1) {
    const lng = minLng + Math.random() * (maxLng - minLng);
    const lat = minLat + Math.random() * (maxLat - minLat);
    if (!franceContains(lng, lat)) continue;
    const [x, y] = mapToLambert(lng, lat);
    if (countInside(x, y, radius) >= NEED) return { x, y };
  }
  for (let n = 0; n < 40; n += 1) {
    const i = Math.floor(Math.random() * index.cx.length);
    if (countInside(index.cx[i], index.cy[i], radius) >= NEED) {
      return { x: index.cx[i], y: index.cy[i] };
    }
  }
  return { x: index.cx[0], y: index.cy[0] };
}

function formatTotalTime(centis) {
  const safe = Math.max(0, Math.round(centis) || 0);
  const minutes = Math.floor(safe / CENTIS_PER_MINUTE);
  const rest = safe % CENTIS_PER_MINUTE;
  const seconds = Math.floor(rest / CENTIS_PER_SECOND);
  const fraction = String(rest % CENTIS_PER_SECOND).padStart(2, "0");
  const secondsHtml = `${seconds}.${fraction}<span class="time-unit"><span class="time-unit-long"> secondes</span><span class="time-unit-short"> s</span></span>`;
  if (minutes < 1) return secondsHtml;
  const minuteWord = minutes < 2 ? "minute" : "minutes";
  return `${minutes}<span class="time-unit"><span class="time-unit-long"> ${minuteWord}</span><span class="time-unit-short"> m</span></span> ${secondsHtml}`;
}

function formatShortTime(centis) {
  const safe = Math.max(0, Math.round(centis) || 0);
  const minutes = Math.floor(safe / CENTIS_PER_MINUTE);
  const rest = safe % CENTIS_PER_MINUTE;
  const seconds = Math.floor(rest / CENTIS_PER_SECOND);
  const fraction = String(rest % CENTIS_PER_SECOND).padStart(2, "0");
  const secondsText = `${seconds}.${fraction} s`;
  if (minutes < 1) return secondsText;
  return `${minutes} m ${secondsText}`;
}

function joinNames(names) {
  if (names.length < 2) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

function encoreText(left) {
  const villes = left > 1 ? `Encore ${left} villes` : "Encore 1 ville";
  return `${villes} · ${round.radius / 1000} km`;
}

function missPhrase(count) {
  if (!count) return "";
  return count > 1 ? `${count} hors du cercle` : "1 hors du cercle";
}

function setProgress(ratio) {
  const value = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  ui.loadFill.style.width = `${value}%`;
  ui.loadFill.parentElement.setAttribute("aria-valuenow", String(value));
}

function askDockHeight() {
  if (!ui.dock.hidden && !ui.ask.hidden && ui.feedback.hidden) return ui.dock.offsetHeight;
  const state = {
    dock: ui.dock.hidden,
    ask: ui.ask.hidden,
    feedback: ui.feedback.hidden,
    visibility: ui.dock.style.visibility,
  };
  ui.dock.style.visibility = "hidden";
  ui.dock.hidden = false;
  ui.ask.hidden = false;
  ui.feedback.hidden = true;
  const height = ui.dock.offsetHeight;
  ui.dock.hidden = state.dock;
  ui.ask.hidden = state.ask;
  ui.feedback.hidden = state.feedback;
  ui.dock.style.visibility = state.visibility;
  return height;
}

function framePad() {
  const review = !ui.reviewBar.hidden;
  if (!isPhone()) return { top: review ? 16 : 48, gap: 16, side: 12 };
  const safe = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0;
  return {
    top: Math.round(safe + (review ? 12 : 36)),
    gap: 8,
    side: 10,
  };
}

function frameFrance() {
  if (launching && launch && (launch.dragging || Math.hypot(launch.vx, launch.vy) > 1)) return;
  const box = map.getContainer();
  const review = !ui.reviewBar.hidden;
  const pad = framePad();
  const top = pad.top;
  const bottom = (review ? ui.reviewBar.offsetHeight : askDockHeight()) + pad.gap;
  const size = `${box.clientWidth}x${box.clientHeight}:${top}:${bottom}`;
  if (size === framedSize) return;
  framedSize = size;
  map.resize();
  map.fitBounds(FRANCE_BOUNDS, {
    padding: { top, bottom, left: pad.side, right: pad.side },
    duration: 0,
  });
  if (launching && launch && !launch.dragging) {
    ensureFranceMask();
    const bounds = launchBounds();
    const origin = nearestInside((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
    launch.x = origin.x;
    launch.y = origin.y;
    launch.home = origin;
    placeCenterPixels(launch.x, launch.y);
  }
  layoutMarks();
}

function paintMap(france, departements) {
  franceRings = france.features[0].geometry.coordinates;
  map.addSource("france", { type: "geojson", data: france });
  map.addLayer({
    id: "france-fill",
    type: "fill",
    source: "france",
    paint: { "fill-color": "#ffffff", "fill-opacity": 1, "fill-antialias": false },
  });
  map.addLayer({
    id: "france-line",
    type: "line",
    source: "france",
    paint: { "line-color": "#b8bcc4", "line-width": 1.2 },
  });
  map.addSource("circle", { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "circle-fill",
    type: "fill",
    source: "circle",
    paint: {
      "fill-color": "#c23b33",
      "fill-opacity": ["case", ["==", ["get", "current"], 1], 0.3, 0.16],
    },
  });
  map.addSource("departements", { type: "geojson", data: departements });
  map.addLayer({
    id: "departements-line",
    type: "line",
    source: "departements",
    paint: { "line-color": "#c4baaf", "line-width": 0.8 },
    layout: { "line-join": "round", "line-cap": "round" },
  });
  map.addSource("circle-stroke", { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "circle-line",
    type: "line",
    source: "circle-stroke",
    paint: {
      "line-color": "#8d241e",
      "line-width": ["case", ["==", ["get", "current"], 1], 2.25, 1.4],
    },
    layout: { "line-join": "round", "line-cap": "round" },
  });
  frameFrance();
}

function showCircle(x, y, radius) {
  const sizes = RADII.filter((size) => size >= radius);
  const features = [];
  sizes.forEach((size, index) => {
    const outer = clippedCircle(x, y, size);
    if (!outer.length) return;
    const current = size === radius;
    const next = sizes[index + 1];
    const geometry = current ? outer : polygonClipping.difference(outer, clippedCircle(x, y, next));
    if (!geometry.length) return;
    features.push({
      type: "Feature",
      properties: { current: current ? 1 : 0 },
      geometry: { type: "MultiPolygon", coordinates: geometry },
    });
  });
  map.getSource("circle").setData({ type: "FeatureCollection", features });
  const strokes = circleStroke(x, y, radius).features.map((feature) => {
    feature.properties = { current: 1 };
    return feature;
  });
  if (radius === RADII[RADII.length - 1]) {
    circleStroke(x, y, RADII[RADII.length - 2]).features.forEach((feature) => {
      feature.properties = { current: 0 };
      strokes.push(feature);
    });
  }
  map.getSource("circle-stroke").setData({ type: "FeatureCollection", features: strokes });
}

function ensureCenterMark() {
  if (centerMark) return;
  const mark = document.createElement("div");
  mark.className = "center-mark";
  mark.innerHTML = `<p class="center-hint">Attrapez le point et lancez-le pour fixer le centre du cercle.</p><span class="center-grab"></span><span class="center-dot"></span>`;
  centerMark = new maplibregl.Marker({ element: mark, anchor: "center" })
    .setLngLat([0, 0])
    .addTo(map);
  mark.setAttribute("aria-label", "Centre du cercle");
  mark.addEventListener("pointerdown", onLaunchPointerDown);
  mark.addEventListener("pointermove", onLaunchPointerMove);
  mark.addEventListener("pointerup", onLaunchPointerUp);
  mark.addEventListener("pointercancel", onLaunchPointerUp);
}

function showCenter(x, y) {
  ensureCenterMark();
  centerMark.setLngLat(lambertToMap(x, y));
}

function placeCenterPixels(x, y) {
  ensureCenterMark();
  centerMark.setLngLat(map.unproject([x, y]));
}

function traceMaskRing(ctx, ring) {
  ctx.beginPath();
  ring.forEach((coord, index) => {
    const point = map.project(coord);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function buildFranceMask() {
  const box = map.getContainer();
  const width = Math.max(1, box.clientWidth);
  const height = Math.max(1, box.clientHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  franceRings.forEach((rings) => {
    ctx.globalCompositeOperation = "source-over";
    traceMaskRing(ctx, rings[0]);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    for (let ring = 1; ring < rings.length; ring += 1) {
      traceMaskRing(ctx, rings[ring]);
      ctx.fill();
    }
  });
  franceMask = ctx.getImageData(0, 0, width, height);
  const origin = map.project([0, 0]);
  const east = map.project([1, 0]);
  seaCrossPx = Math.hypot(east.x - origin.x, east.y - origin.y) * SEA_CROSS_DEG;
}

function ensureFranceMask() {
  const box = map.getContainer();
  if (!franceMask || franceMask.width !== box.clientWidth || franceMask.height !== box.clientHeight) {
    buildFranceMask();
  }
}

function maskInside(x, y) {
  if (!franceMask) return false;
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= franceMask.width || iy >= franceMask.height) return false;
  return franceMask.data[(iy * franceMask.width + ix) * 4] > 0;
}

function nearestInside(x, y) {
  if (maskInside(x, y)) return { x, y };
  for (let radius = 4; radius < 480; radius += 4) {
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (maskInside(px, py)) return { x: px, y: py };
    }
  }
  return { x, y };
}

function pullToFrance(x, y) {
  const home = launch && launch.home;
  if (!home || maskInside(x, y)) return { x, y };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    const px = home.x + (x - home.x) * mid;
    const py = home.y + (y - home.y) * mid;
    if (maskInside(px, py)) lo = mid;
    else hi = mid;
  }
  return {
    x: home.x + (x - home.x) * lo,
    y: home.y + (y - home.y) * lo,
  };
}

function polygonAtPixel(x, y) {
  const ll = map.unproject([x, y]);
  for (let p = 0; p < franceRings.length; p += 1) {
    const rings = franceRings[p];
    if (!ringContains(rings[0], ll.lng, ll.lat)) continue;
    let hole = false;
    for (let r = 1; r < rings.length; r += 1) {
      if (ringContains(rings[r], ll.lng, ll.lat)) {
        hole = true;
        break;
      }
    }
    if (!hole) return p;
  }
  return -1;
}

function seaGap(x, y, vx, vy, fromPolygon) {
  const speed = Math.hypot(vx, vy) || 1;
  const ux = vx / speed;
  const uy = vy / speed;
  let best = 0;
  let seenSea = false;
  for (let distance = 6; distance <= seaCrossPx; distance += 8) {
    const px = x + ux * distance;
    const py = y + uy * distance;
    if (!maskInside(px, py)) {
      seenSea = true;
      continue;
    }
    if (!seenSea) continue;
    const polygon = polygonAtPixel(px, py);
    if (polygon < 0) continue;
    if (polygon === fromPolygon) break;
    best = distance;
  }
  return best;
}

function franceNormal(x, y) {
  let sx = 0;
  let sy = 0;
  const radius = 9;
  for (let i = 0; i < 20; i += 1) {
    const angle = (i / 20) * Math.PI * 2;
    if (maskInside(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)) {
      sx += Math.cos(angle);
      sy += Math.sin(angle);
    }
  }
  const length = Math.hypot(sx, sy);
  if (length < 0.2) return null;
  return { x: sx / length, y: sy / length };
}

function reflectInside(vx, vy, normal, bounce) {
  const dot = vx * normal.x + vy * normal.y;
  if (dot >= 0) return { vx, vy };
  return {
    vx: (vx - 2 * dot * normal.x) * bounce,
    vy: (vy - 2 * dot * normal.y) * bounce,
  };
}

function launchBounds() {
  const box = map.getContainer();
  const dock = ui.dock.hidden ? 0 : ui.dock.offsetHeight;
  const margin = 22;
  return {
    left: margin,
    top: margin,
    right: Math.max(margin + 40, box.clientWidth - margin),
    bottom: Math.max(margin + 40, box.clientHeight - dock - margin),
  };
}

function moveLaunchToClient(clientX, clientY) {
  const rect = map.getContainer().getBoundingClientRect();
  const bounds = launchBounds();
  launch.x = Math.min(bounds.right, Math.max(bounds.left, clientX - rect.left));
  launch.y = Math.min(bounds.bottom, Math.max(bounds.top, clientY - rect.top));
  placeCenterPixels(launch.x, launch.y);
}

function onLaunchPointerDown(event) {
  if (!launching || !launch || centerMark.getElement().classList.contains("is-flying")) return;
  event.preventDefault();
  launch.dragging = true;
  launch.vx = 0;
  launch.vy = 0;
  cancelAnimationFrame(launchFrame);
  const mark = centerMark.getElement();
  mark.classList.add("is-dragging");
  try { mark.setPointerCapture(event.pointerId); } catch (error) { /* untrusted test events */ }
  launch.samples = [{ x: event.clientX, y: event.clientY, t: performance.now() }];
  moveLaunchToClient(event.clientX, event.clientY);
}

function onLaunchPointerMove(event) {
  if (!launching || !launch || !launch.dragging) return;
  const now = performance.now();
  launch.samples.push({ x: event.clientX, y: event.clientY, t: now });
  launch.samples = launch.samples.filter((sample) => now - sample.t < 90);
  moveLaunchToClient(event.clientX, event.clientY);
}

function onLaunchPointerUp(event) {
  if (!launching || !launch || !launch.dragging) return;
  launch.dragging = false;
  centerMark.getElement().classList.remove("is-dragging");
  moveLaunchToClient(event.clientX, event.clientY);
  const samples = launch.samples;
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = Math.max(16, last.t - first.t) / 1000;
    launch.vx = (last.x - first.x) / dt;
    launch.vy = (last.y - first.y) / dt;
  } else {
    launch.vx = 0;
    launch.vy = 0;
  }
  let speed = Math.hypot(launch.vx, launch.vy);
  const travel = samples.length >= 2
    ? Math.hypot(samples[samples.length - 1].x - samples[0].x, samples[samples.length - 1].y - samples[0].y)
    : 0;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (travel > 8) {
      centerMark.getElement().classList.add("is-flying");
      settleLaunch(true);
    }
    return;
  }
  if (!maskInside(launch.x, launch.y)) {
    const gap = seaGap(launch.x, launch.y, launch.vx, launch.vy, -1);
    if (gap > 0 && speed >= 40) {
      launch.sea = gap + 18;
    } else {
      const back = pullToFrance(launch.x, launch.y);
      launch.x = back.x;
      launch.y = back.y;
      const normal = franceNormal(launch.x, launch.y);
      if (normal) {
        const reflected = reflectInside(launch.vx, launch.vy, normal, 1);
        launch.vx = reflected.vx;
        launch.vy = reflected.vy;
      }
      placeCenterPixels(launch.x, launch.y);
      speed = Math.hypot(launch.vx, launch.vy);
    }
  }
  if (speed < 40) {
    if (travel > 18) {
      centerMark.getElement().classList.add("is-flying");
      settleLaunch(false);
    }
    return;
  }
  speed *= 2.6;
  const max = 5600;
  if (speed > max) speed = max;
  const scale = speed / Math.hypot(launch.vx, launch.vy);
  launch.vx *= scale;
  launch.vy *= scale;
  launch.last = performance.now();
  centerMark.getElement().classList.add("is-flying");
  launchFrame = requestAnimationFrame(tickLaunch);
}

function tickLaunch(now) {
  if (!launching || !launch || launch.dragging) return;
  const dt = Math.min(0.032, (now - launch.last) / 1000);
  launch.last = now;
  ensureFranceMask();
  const drag = Math.exp(-0.62 * dt);
  launch.vx *= drag;
  launch.vy *= drag;
  const speed = Math.hypot(launch.vx, launch.vy);
  if (speed < 36) {
    placeCenterPixels(launch.x, launch.y);
    settleLaunch(false);
    return;
  }
  const steps = Math.min(64, Math.max(1, Math.ceil(speed * dt / 5)));
  const slice = dt / steps;
  const bounce = 0.92;
  for (let step = 0; step < steps; step += 1) {
    const nextX = launch.x + launch.vx * slice;
    const nextY = launch.y + launch.vy * slice;
    if (maskInside(nextX, nextY)) {
      launch.x = nextX;
      launch.y = nextY;
      launch.sea = 0;
      continue;
    }
    const stepLength = Math.hypot(nextX - launch.x, nextY - launch.y);
    if (launch.sea > 0) {
      if (launch.sea < stepLength) {
        launch.sea = 0;
        launch.vx *= -bounce;
        launch.vy *= -bounce;
        continue;
      }
      launch.sea -= stepLength;
      launch.x = nextX;
      launch.y = nextY;
      continue;
    }
    const fromPolygon = polygonAtPixel(launch.x, launch.y);
    const gap = fromPolygon < 0 ? 0 : seaGap(launch.x, launch.y, launch.vx, launch.vy, fromPolygon);
    if (gap > 0) {
      launch.sea = gap + 18 - stepLength;
      launch.x = nextX;
      launch.y = nextY;
      continue;
    }
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i += 1) {
      const mid = (lo + hi) / 2;
      const probeX = launch.x + (nextX - launch.x) * mid;
      const probeY = launch.y + (nextY - launch.y) * mid;
      if (maskInside(probeX, probeY)) lo = mid;
      else hi = mid;
    }
    launch.x += (nextX - launch.x) * lo;
    launch.y += (nextY - launch.y) * lo;
    const normal = franceNormal(launch.x, launch.y);
    if (normal) {
      const reflected = reflectInside(launch.vx, launch.vy, normal, bounce);
      launch.vx = reflected.vx;
      launch.vy = reflected.vy;
      launch.x += normal.x * 2.5;
      launch.y += normal.y * 2.5;
    } else {
      launch.vx *= -bounce;
      launch.vy *= -bounce;
    }
    if (!maskInside(launch.x, launch.y)) {
      const back = pullToFrance(launch.x, launch.y);
      launch.x = back.x;
      launch.y = back.y;
    }
  }
  placeCenterPixels(launch.x, launch.y);
  launchFrame = requestAnimationFrame(tickLaunch);
}

function playableCenter(pixelX, pixelY) {
  const ll = map.unproject([pixelX, pixelY]);
  const [x, y] = mapToLambert(ll.lng, ll.lat);
  if (!franceContains(ll.lng, ll.lat)) return null;
  if (countInside(x, y, RADII[RADII.length - 1]) < NEED) return null;
  return { x, y };
}

function settleLaunch(reduced) {
  const found = playableCenter(launch.x, launch.y);
  if (found) {
    finishLaunch(found);
    return;
  }
  if (reduced || launch.kicks > 6) {
    finishLaunch(randomCenter());
    return;
  }
  launch.kicks += 1;
  const fallback = randomCenter();
  const target = map.project(lambertToMap(fallback.x, fallback.y));
  const dx = target.x - launch.x;
  const dy = target.y - launch.y;
  const dist = Math.hypot(dx, dy) || 1;
  launch.vx = dx / dist * 760;
  launch.vy = dy / dist * 760;
  launch.last = performance.now();
  launchFrame = requestAnimationFrame(tickLaunch);
}

function finishLaunch(nextCenter) {
  cancelAnimationFrame(launchFrame);
  launchFrame = 0;
  launching = false;
  launch = null;
  center = nextCenter;
  if (centerMark) centerMark.getElement().classList.remove("is-live", "is-dragging", "is-flying");
  beginRound();
}

function stopLaunch() {
  cancelAnimationFrame(launchFrame);
  launchFrame = 0;
  launching = false;
  launch = null;
  if (centerMark) centerMark.getElement().classList.remove("is-live", "is-dragging", "is-flying");
}

function startLaunch() {
  stopLaunch();
  launching = true;
  ui.chrome.hidden = true;
  ui.timerBlock.hidden = true;
  ui.ask.hidden = true;
  ui.feedback.hidden = true;
  ui.dock.hidden = true;
  framedSize = "";
  frameFrance();
  ensureFranceMask();
  const bounds = launchBounds();
  const origin = nearestInside((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
  launch = {
    x: origin.x,
    y: origin.y,
    home: origin,
    sea: 0,
    vx: 0,
    vy: 0,
    dragging: false,
    samples: [],
    kicks: 0,
    last: 0,
  };
  ensureCenterMark();
  centerMark.getElement().classList.add("is-live");
  centerMark.getElement().classList.remove("is-flying", "is-dragging");
  placeCenterPixels(launch.x, launch.y);
  scheduleFit();
}

function hideCenter() {
  if (!centerMark) return;
  centerMark.remove();
  centerMark = null;
}

function quietMarks() {
  markers.forEach((marker) => {
    const el = marker.getElement();
    el.classList.add("is-quiet");
    el.classList.toggle("is-tip-below", map.project(marker.getLngLat()).y < 52);
  });
}

function clearMarks() {
  markers.forEach((marker) => marker.remove());
  markers = [];
}

const LABEL_GAP = 8;
const LABEL_PAD = 2;
const DOT_RADIUS = 5;

function labelChoices(limit) {
  const shifts = [0];
  for (let dy = 4; dy <= limit; dy += 4) shifts.push(-dy, dy);
  return shifts.flatMap((dy) => (
    ["right", "left"].map((side) => ({
      side,
      dy,
      cost: Math.abs(dy) + (side === "left" ? 6 : 0),
    }))
  )).sort((a, b) => a.cost - b.cost || Math.abs(a.dy) - Math.abs(b.dy));
}

const LABEL_CHOICES = labelChoices(20);
const LABEL_FALLBACK = labelChoices(48);
let labelDots = [];

function labelRect(item, choice) {
  const top = item.y + choice.dy - item.h / 2;
  if (choice.side === "right") return { x: item.x + LABEL_GAP, y: top, w: item.w, h: item.h };
  return { x: item.x - LABEL_GAP - item.w, y: top, w: item.w, h: item.h };
}

function rectsOverlap(a, b, pad) {
  return a.x < b.x + b.w + pad
    && b.x < a.x + a.w + pad
    && a.y < b.y + b.h + pad
    && b.y < a.y + a.h + pad;
}

function dotRect(item) {
  const radius = item.radius || DOT_RADIUS;
  return { x: item.x - radius, y: item.y - radius, w: radius * 2, h: radius * 2 };
}

function choiceClashes(group, index, choice, placed) {
  const rect = labelRect(group[index], choice);
  const self = group[index].marker;
  for (let j = 0; j < labelDots.length; j += 1) {
    if (labelDots[j].marker === self) continue;
    if (rectsOverlap(rect, dotRect(labelDots[j]), 1)) return true;
  }
  for (let j = 0; j < placed.length; j += 1) {
    if (rectsOverlap(rect, labelRect(group[j], placed[j]), LABEL_PAD)) return true;
  }
  return false;
}

function labelExtraCost(rect) {
  const box = map.getContainer();
  let cost = 0;
  if (rect.x < 2) cost += 5;
  if (rect.y < 2) cost += 3;
  if (rect.x + rect.w > box.clientWidth - 2) cost += 5;
  if (rect.y + rect.h > box.clientHeight - 2) cost += 3;
  return cost;
}

function applyChoice(item, choice) {
  item.name.style.top = `${choice.dy}px`;
  item.marker.getElement().classList.toggle("is-left", choice.side === "left");
}

function solveGroup(group) {
  if (group.length === 1) {
    applyChoice(group[0], LABEL_CHOICES[0]);
    return;
  }
  const chosen = new Array(group.length);
  let best = null;
  let bestCost = Infinity;
  let nodes = 0;

  function search(index, cost) {
    if (cost >= bestCost || nodes > 25000) return;
    nodes += 1;
    if (index === group.length) {
      bestCost = cost;
      best = chosen.slice();
      return;
    }
    for (let k = 0; k < LABEL_CHOICES.length; k += 1) {
      const choice = LABEL_CHOICES[k];
      const next = cost + choice.cost + labelExtraCost(labelRect(group[index], choice));
      if (next >= bestCost || choiceClashes(group, index, choice, chosen.slice(0, index))) continue;
      chosen[index] = choice;
      search(index + 1, next);
    }
  }

  if (group.length <= 4) search(0, 0);
  if (!best) {
    best = [];
    group.forEach((_, index) => {
      best[index] = LABEL_FALLBACK.find((choice) => (
        !choiceClashes(group, index, choice, best.slice(0, index))
      )) || LABEL_CHOICES[0];
    });
  }
  group.forEach((item, index) => applyChoice(item, best[index]));
}

function layoutMarks() {
  if (!markers.length || !map.getContainer().clientWidth) return;
  const all = markers.map((marker) => {
    const name = marker.getElement().querySelector(".pin-name");
    const point = map.project(marker.getLngLat());
    return {
      marker,
      name,
      quiet: marker.getElement().classList.contains("is-quiet"),
      x: point.x,
      y: point.y,
      w: Math.max(name.offsetWidth, 8),
      h: Math.max(name.offsetHeight, 12),
    };
  });
  labelDots = all;
  if (centerMark) {
    const point = map.project(centerMark.getLngLat());
    labelDots = all.concat([{ marker: centerMark, x: point.x, y: point.y, radius: 8 }]);
  }
  const items = all.filter((item) => !item.quiet);
  if (!items.length) return;
  const parent = items.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const reach = items[i].w + items[j].w + LABEL_GAP * 2 + 8;
      const dx = items[i].x - items[j].x;
      const dy = items[i].y - items[j].y;
      if (dx * dx + dy * dy < reach * reach) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });
  groups.forEach((group) => solveGroup(group));
}

function placeMark(i, hit) {
  const lngLat = lambertToMap(index.cx[i], index.cy[i]);
  const pin = document.createElement("div");
  pin.className = `pin ${hit ? "is-hit" : "is-miss"}`;
  pin.innerHTML = `<span class="pin-dot"></span><span class="pin-name">${escapeHtml(places[i].name)}</span>`;
  const marker = new maplibregl.Marker({ element: pin, anchor: "center" })
    .setLngLat(lngLat)
    .addTo(map);
  markers.push(marker);
  layoutMarks();
}

function buildPlaces() {
  places = index.names.map((name, i) => ({
    i,
    name,
    dep: index.depNames[index.dep[i]] || index.dep[i],
    fold: fold(name),
    tight: fold(name).replace(/ /g, ""),
    pop: index.pop[i],
  }));
}

function byPop(a, b) {
  return b.pop - a.pop || a.name.localeCompare(b.name, "fr");
}

function suggestionsFor(query) {
  const q = fold(query);
  const tight = q.replace(/ /g, "");
  if (!tight) return [];
  const exact = [];
  const starts = [];
  const contains = [];
  for (let i = 0; i < places.length; i += 1) {
    const place = places[i];
    if (place.fold === q || place.tight === tight) exact.push(place);
    else if (place.fold.startsWith(q) || (tight.length >= 2 && place.tight.startsWith(tight))) starts.push(place);
    else if (q.length >= 3 && place.fold.includes(q)) contains.push(place);
  }
  exact.sort(byPop);
  starts.sort(byPop);
  contains.sort(byPop);
  return exact.concat(starts, contains).slice(0, 8);
}

function resolveGuess(query) {
  const q = fold(query);
  const tight = q.replace(/ /g, "");
  if (!q) return { kind: "empty" };
  const exact = [];
  for (let i = 0; i < places.length; i += 1) {
    const place = places[i];
    if (place.fold === q || place.tight === tight) exact.push(place);
  }
  if (exact.length === 1) return { kind: "one", place: exact[0] };
  if (exact.length > 1) return { kind: "many", places: exact.sort(byPop) };
  return { kind: "none" };
}

function showSuggestions(items) {
  suggestItems = items;
  suggestIndex = 0;
  if (!items.length) {
    ui.suggest.hidden = true;
    ui.suggest.innerHTML = "";
    return;
  }
  ui.suggest.innerHTML = items.map((place, itemIndex) => (
    `<li role="option" data-i="${itemIndex}" class="${itemIndex === 0 ? "is-active" : ""}">${escapeHtml(place.name)} <span class="dep">· ${escapeHtml(place.dep)}</span></li>`
  )).join("");
  ui.suggest.hidden = false;
}

function pickSuggestion(li) {
  if (!li || suggestLock) return;
  const place = suggestItems[Number(li.dataset.i)];
  if (!place) return;
  suggestLock = true;
  window.setTimeout(() => { suggestLock = false; }, 400);
  suggestIndex = Number(li.dataset.i);
  ignoreSubmit = true;
  window.setTimeout(() => { ignoreSubmit = false; }, 400);
  ui.guess.value = place.name;
  submitQuery(place);
}

function moveSuggestion(delta) {
  if (!suggestItems.length) return;
  suggestIndex = (suggestIndex + delta + suggestItems.length) % suggestItems.length;
  [...ui.suggest.children].forEach((li, itemIndex) => {
    li.classList.toggle("is-active", itemIndex === suggestIndex);
  });
  ui.suggest.children[suggestIndex].scrollIntoView({ block: "nearest" });
}

function setHint(kind, text) {
  ui.hint.classList.remove("is-hit", "is-soft");
  if (kind === "hit") ui.hint.classList.add("is-hit");
  if (kind === "soft") ui.hint.classList.add("is-soft");
  ui.hint.textContent = text;
}

function shakeField() {
  ui.guessWrap.classList.remove("is-shake");
  void ui.guessWrap.offsetWidth;
  ui.guessWrap.classList.add("is-shake");
}

function paintScore() {
  ui.scoreLine.innerHTML = `Score ${formatTotalTime(banked)}`;
}

function stopRoundTimer() {
  cancelAnimationFrame(timerFrame);
  timerFrame = 0;
}

function tickRoundTimer() {
  if (locked || !round || round.closed) return;
  const left = roundEndsAt - Date.now();
  if (left <= 0) {
    ui.timerFill.style.width = "0%";
    ui.timerBar.setAttribute("aria-valuenow", "0");
    ui.timerValue.textContent = "0 s";
    closeRound("timeout");
    return;
  }
  const pct = Math.max(0, Math.min(100, (left / ROUND_MS) * 100));
  ui.timerFill.style.width = `${pct}%`;
  ui.timerBar.setAttribute("aria-valuenow", String(Math.round(pct)));
  ui.timerValue.textContent = `${Math.max(0, Math.ceil(left / 1000))} s`;
  timerFrame = requestAnimationFrame(tickRoundTimer);
}

function startRoundTimer() {
  stopRoundTimer();
  roundStartedAt = Date.now();
  roundEndsAt = roundStartedAt + ROUND_MS;
  ui.timerBlock.hidden = false;
  ui.timerFill.style.width = "100%";
  ui.timerBar.setAttribute("aria-valuenow", "100");
  ui.timerValue.textContent = `${ROUND_MS / 1000} s`;
  timerFrame = requestAnimationFrame(tickRoundTimer);
}

function renderHistory() {
  const done = rounds.filter((item) => item.closed);
  ui.historyWrap.hidden = done.length === 0;
  const items = done.map((item) => {
    const miss = item.timedOut ? " is-miss" : "";
    const names = item.found.length
      ? item.found.map((place) => escapeHtml(place.name)).join(", ")
      : "Temps écoulé";
    return `<li><span class="names"><span class="round-km">${item.radius / 1000} km</span> ${names}</span><span class="score-num${miss}">${formatShortTime(item.centis)}</span></li>`;
  });
  if (done.length) {
    items.push(`<li class="score-history-total"><span>Score</span><span class="score-num">${formatTotalTime(banked)}</span></li>`);
  }
  ui.history.innerHTML = items.join("");
}

function acceptPlace(place) {
  if (round.guessed.has(place.i)) {
    setHint("soft", "Déjà proposée");
    shakeField();
    return;
  }
  round.guessed.add(place.i);
  const hit = isInside(place.i, round.x, round.y, round.radius);
  placeMark(place.i, hit);
  ui.guess.value = "";
  showSuggestions([]);
  if (hit) {
    round.found.push(place);
    const left = NEED - round.found.length;
    if (left <= 0) {
      setHint("hit", "Dans le cercle");
      closeRound("complete");
      return;
    }
    setHint("hit", "Dans le cercle");
    ui.askLabel.textContent = encoreText(left);
  } else {
    round.misses += 1;
    setHint("", "Hors du cercle");
  }
  if (keepKeyboard) focusGuess();
  else ui.guess.focus();
}

function submitQuery(picked) {
  if (locked || !round || round.closed) return;
  const typed = ui.guess.value.trim();
  if (picked) {
    acceptPlace(picked);
    return;
  }
  if (!typed) return;
  const resolved = resolveGuess(typed);
  if (resolved.kind === "one") {
    acceptPlace(resolved.place);
    return;
  }
  if (resolved.kind === "many") {
    showSuggestions(resolved.places.slice(0, 8));
    setHint("soft", "Plusieurs communes portent ce nom");
    shakeField();
    return;
  }
  setHint("", "Cette commune n'existe pas");
  shakeField();
}

function closeRound(kind) {
  if (locked || !round || round.closed) return;
  stopRoundTimer();
  ui.timerBlock.hidden = true;
  const elapsed = Math.max(0, Math.round((Date.now() - roundStartedAt) / 10));
  round.timedOut = kind === "timeout";
  round.centis = round.timedOut ? ROUND_CENTIS : Math.min(ROUND_CENTIS, elapsed);
  round.closed = true;
  banked += round.centis;
  rounds.push(round);
  quietMarks();
  locked = true;
  paintScore();
  renderHistory();
  ui.feedback.hidden = false;
  ui.feedback.classList.toggle("is-miss", round.timedOut);
  if (keepKeyboard) ui.askLabel.hidden = true;
  else {
    ui.ask.hidden = true;
    ui.guess.blur();
  }
  if (round.timedOut) {
    ui.feedbackKicker.textContent = "Temps écoulé";
    const left = NEED - round.found.length;
    const names = round.found.length ? `${joinNames(round.found.map((place) => place.name))} · ` : "";
    const missing = left > 1 ? `Il manquait ${left} villes.` : "Il manquait 1 ville.";
    ui.feedbackDetail.textContent = `${names}Temps : ${formatShortTime(round.centis)}. ${missing}`;
  } else {
    ui.feedbackKicker.textContent = "Bravo !";
    const extra = missPhrase(round.misses);
    ui.feedbackDetail.textContent = `${joinNames(round.found.map((place) => place.name))} · ${formatShortTime(round.centis)}${extra ? ` · ${extra}` : ""}`;
  }
  ui.next.textContent = rounds.length >= ROUNDS ? "Voir le score" : "Manche suivante";
  scheduleFit();
}

function beginRound() {
  const radius = RADII[rounds.length];
  const [lng, lat] = lambertToMap(center.x, center.y);
  round = {
    x: center.x,
    y: center.y,
    lng,
    lat,
    radius,
    found: [],
    misses: 0,
    guessed: seen,
    centis: 0,
    closed: false,
  };
  showCircle(center.x, center.y, radius);
  showCenter(center.x, center.y);
  locked = false;
  ui.feedback.hidden = true;
  ui.feedback.classList.remove("is-miss");
  ui.ask.hidden = false;
  ui.askLabel.hidden = false;
  ui.dock.hidden = false;
  ui.chrome.hidden = false;
  ui.kicker.textContent = `Manche ${rounds.length + 1} / ${ROUNDS} · ${radius / 1000} km`;
  ui.askLabel.textContent = encoreText(NEED);
  ui.guess.value = "";
  setHint("", "");
  showSuggestions([]);
  frameFrance();
  paintScore();
  startRoundTimer();
  scheduleFit();
  keepKeyboard = isPhone();
  if (keepKeyboard) focusGuess();
  else ui.guess.focus();
}

function ordinal(rank) {
  return rank === 1 ? "1er" : `${rank}e`;
}

function boardOrigin() {
  return BOARD_ORIGIN;
}

function rememberedName() {
  try { return localStorage.getItem(BOARD_NAME_KEY) || ""; } catch { return ""; }
}

function paintBoard(data) {
  ui.boardList.replaceChildren();
  (data.entries || []).forEach((entry) => {
    const li = document.createElement("li");
    if (entry.yours) li.className = "is-you";
    const rank = document.createElement("span");
    rank.className = "board-rank";
    rank.textContent = ordinal(entry.rank);
    const name = document.createElement("span");
    name.className = "board-name";
    name.textContent = entry.name;
    const score = document.createElement("span");
    score.className = "board-score";
    score.textContent = formatShortTime(entry.score);
    li.append(rank, name, score);
    ui.boardList.append(li);
  });
}

function boardMessage(data, status) {
  if (!data.total) return "Personne n'a encore enregistré de score.";
  if (!data.rank) return `${data.total} score${data.total > 1 ? "s" : ""}.`;
  const place = `Vous êtes ${ordinal(data.rank)} sur ${data.total}.`;
  if (status === "created") return `Score enregistré. ${place}`;
  if (status === "improved") return `Nouveau record. ${place}`;
  if (status === "kept") return `Votre meilleur temps reste ${formatShortTime(data.best)}. ${place}`;
  return place;
}

async function loadBoard() {
  const name = ui.boardName.value.trim();
  ui.boardNote.textContent = "Chargement du classement…";
  try {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    const query = params.toString();
    const response = await fetch(`${boardOrigin()}/scores${query ? `?${query}` : ""}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    paintBoard(data);
    ui.boardNote.textContent = boardMessage(data);
  } catch {
    ui.boardList.replaceChildren();
    ui.boardNote.textContent = "Le classement ne répond pas pour le moment.";
  }
}

async function saveBoard(event) {
  event.preventDefault();
  const name = ui.boardName.value.trim();
  if (!name) {
    ui.boardNote.textContent = "Indiquez un pseudo.";
    return;
  }
  ui.boardSave.disabled = true;
  try {
    const response = await fetch(`${boardOrigin()}/scores`, {
      signal: AbortSignal.timeout(8000),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, score: banked }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 400 && data.error === "pseudo") {
      ui.boardNote.textContent = "Deux caractères minimum, sans symbole bizarre.";
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    try { localStorage.setItem(BOARD_NAME_KEY, name); } catch { /* mode privé */ }
    paintBoard(data);
    ui.boardNote.textContent = boardMessage(data, data.status);
  } catch {
    ui.boardNote.textContent = "Le classement ne répond pas pour le moment.";
  } finally {
    ui.boardSave.disabled = false;
  }
}

function showFinish() {
  releaseKeyboard();
  stopRoundTimer();
  ui.timerBlock.hidden = true;
  ui.dock.hidden = true;
  ui.chrome.hidden = true;
  ui.historyWrap.hidden = true;
  ui.finish.hidden = false;
  ui.finalScore.innerHTML = formatTotalTime(banked);
  ui.finishRecap.innerHTML = rounds.map((item, itemIndex) => {
    const extra = missPhrase(item.misses);
    const names = item.found.length ? joinNames(item.found.map((place) => place.name)) : "Temps écoulé";
    const miss = item.timedOut ? " is-miss" : "";
    return `<li>
      <p class="finish-recap-name">Manche ${itemIndex + 1} · ${item.radius / 1000} km</p>
      <p class="finish-recap-score${miss}">${formatShortTime(item.centis)}</p>
      <p class="finish-recap-detail">${escapeHtml(names)}${extra ? ` · ${escapeHtml(extra)}` : ""}</p>
    </li>`;
  }).join("");
  ui.reviewBar.hidden = true;
  if (!ui.boardName.value) ui.boardName.value = rememberedName();
  loadBoard();
  scheduleFit();
}

function showMyMap() {
  ui.finish.hidden = true;
  ui.reviewBar.hidden = false;
  markers.forEach((marker) => {
    const el = marker.getElement();
    if (!el.classList.contains("is-hit")) return;
    el.classList.remove("is-quiet", "is-tip-below");
  });
  framedSize = "";
  frameFrance();
  scheduleFit();
}

function showScore() {
  ui.reviewBar.hidden = true;
  quietMarks();
  ui.finish.hidden = false;
  framedSize = "";
  frameFrance();
  scheduleFit();
}

function startGame() {
  rounds = [];
  banked = 0;
  seen = new Set();
  clearMarks();
  hideCenter();
  ui.intro.hidden = true;
  ui.finish.hidden = true;
  ui.reviewBar.hidden = true;
  ui.history.innerHTML = "";
  ui.historyWrap.hidden = true;
  startLaunch();
  if (!isPhone()) return;
  keepKeyboard = true;
  ui.ask.hidden = false;
  ui.askLabel.hidden = true;
  ui.feedback.hidden = true;
  ui.dock.hidden = false;
  ui.guess.value = "";
  setHint("", "");
  framedSize = "";
  frameFrance();
  focusGuess();
}

function backToIntro() {
  releaseKeyboard();
  stopRoundTimer();
  stopLaunch();
  ui.timerBlock.hidden = true;
  clearMarks();
  hideCenter();
  if (map.getSource("circle")) map.getSource("circle").setData(emptyCollection());
  if (map.getSource("circle-stroke")) map.getSource("circle-stroke").setData(emptyCollection());
  round = null;
  locked = false;
  ui.finish.hidden = true;
  ui.reviewBar.hidden = true;
  ui.chrome.hidden = true;
  ui.historyWrap.hidden = true;
  ui.dock.hidden = true;
  ui.intro.hidden = false;
  framedSize = "";
  frameFrance();
  scheduleFit();
}

function assertLandmarks() {
  ["75056", "2A004", "85163", "29155"].forEach((code) => {
    const i = index.codes.indexOf(code);
    if (i < 0) throw new Error(`commune ${code} absente`);
    const [lng, lat] = lambertToMap(index.cx[i], index.cy[i]);
    if (!franceContains(lng, lat)) throw new Error(`${index.names[i]} hors du territoire`);
  });
}

async function loadJson(url, slot, slots) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body && response.body.getReader();
  if (!reader) {
    slots[slot.key] = 1;
    paintLoad(slots);
    return response.json();
  }
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    slots[slot.key] = total ? received / total : 1;
    paintLoad(slots);
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    buffer.set(chunk, offset);
    offset += chunk.length;
  });
  slots[slot.key] = 1;
  paintLoad(slots);
  return JSON.parse(new TextDecoder().decode(buffer));
}

function paintLoad(slots) {
  let sum = 0;
  slots.list.forEach((slot) => {
    sum += slot.weight * (slots[slot.key] || 0);
  });
  setProgress(sum);
}

function bindViewport() {
  const viewport = window.visualViewport;
  if (viewport) {
    viewport.addEventListener("resize", scheduleFit);
    viewport.addEventListener("scroll", scheduleFit);
  }
  window.addEventListener("resize", () => {
    framedSize = "";
    scheduleFit();
    if (map.loaded()) frameFrance();
  });
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      scheduleFit();
      if (map.loaded()) frameFrance();
    }).observe(ui.dock);
  }
  ui.guess.addEventListener("focus", () => {
    window.scrollTo(0, 0);
    scheduleFit();
  });
  ui.guess.addEventListener("blur", scheduleFit);
  scheduleFit();
}

function fitPlayfield() {
  const viewport = window.visualViewport;
  const top = viewport ? viewport.offsetTop : 0;
  const height = viewport ? viewport.height : window.innerHeight;
  const root = document.documentElement;
  const focused = document.activeElement === ui.guess;
  const shrunk = fullHeight - height > 120;
  const keyboard = shrunk && (focused || root.classList.contains("is-keyboard"));
  if (!keyboard) fullHeight = Math.max(window.innerHeight, height);
  root.classList.toggle("is-keyboard", keyboard);
  root.style.setProperty("--vv-top", `${top}px`);
  root.style.setProperty("--vv-height", `${height}px`);
  const dockH = ui.dock && !ui.dock.hidden ? ui.dock.offsetHeight : 0;
  root.style.setProperty("--dock-h", `${dockH}px`);
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  if (isPhone() && map.loaded()) frameFrance();
}

function scheduleFit() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(fitPlayfield);
}

function bindPlay() {
  ui.start.addEventListener("click", startGame);
  ui.next.addEventListener("click", () => {
    if (ui.next.dataset.lock === "1") return;
    ui.next.dataset.lock = "1";
    window.setTimeout(() => { ui.next.dataset.lock = "0"; }, 400);
    if (rounds.length >= ROUNDS) showFinish();
    else beginRound();
  });
  ui.next.addEventListener("pointerdown", (event) => {
    if (!keepKeyboard) return;
    event.preventDefault();
    ui.next.click();
  });
  ui.validate.addEventListener("pointerdown", (event) => {
    if (!keepKeyboard) return;
    event.preventDefault();
    ui.form.requestSubmit();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.repeat || event.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (!ui.intro.hidden) {
      event.preventDefault();
      startGame();
      return;
    }
    if (!ui.reviewBar.hidden) return;
    if (!ui.finish.hidden || ui.feedback.hidden) return;
    event.preventDefault();
    ui.next.click();
  });
  ui.replay.addEventListener("click", backToIntro);
  ui.boardForm.addEventListener("submit", saveBoard);
  ui.mapReview.addEventListener("click", showMyMap);
  ui.backScore.addEventListener("click", showScore);
  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (ui.form.dataset.lock === "1") return;
    ui.form.dataset.lock = "1";
    window.setTimeout(() => { ui.form.dataset.lock = "0"; }, 300);
    if (ignoreSubmit) {
      ignoreSubmit = false;
      return;
    }
    const picked = !ui.suggest.hidden && suggestItems[suggestIndex] ? suggestItems[suggestIndex] : null;
    submitQuery(picked);
  });
  ui.guess.addEventListener("input", () => {
    if (ui.hint.textContent) setHint("", "");
    showSuggestions(suggestionsFor(ui.guess.value));
  });
  ui.guess.addEventListener("blur", (event) => {
    if (!keepKeyboard) return;
    const next = event.relatedTarget;
    if (next && next.closest && (next.closest("button") || next.closest("input, textarea"))) return;
    focusGuess();
  });
  ui.guess.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSuggestion(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSuggestion(-1);
    } else if (event.key === "Escape") {
      showSuggestions([]);
    }
  });
  ui.suggest.addEventListener("pointerover", (event) => {
    const li = event.target.closest("li");
    if (!li || ui.suggest.hidden) return;
    const itemIndex = Number(li.dataset.i);
    if (!suggestItems[itemIndex]) return;
    suggestIndex = itemIndex;
    [...ui.suggest.children].forEach((row, i) => {
      row.classList.toggle("is-active", i === suggestIndex);
    });
  });
  ui.suggest.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (keepKeyboard && event.pointerType === "touch") return;
    pickSuggestion(event.target.closest("li"));
  });
  ui.suggest.addEventListener("touchstart", (event) => {
    if (!keepKeyboard) return;
    event.preventDefault();
    const touch = event.changedTouches[0] || event.touches[0];
    suggestTouch = {
      y: touch ? touch.clientY : 0,
      scroll: ui.suggest.scrollTop,
      moved: false,
      li: event.target.closest("li"),
    };
  }, { passive: false });
  ui.suggest.addEventListener("touchmove", (event) => {
    if (!keepKeyboard || !suggestTouch) return;
    event.preventDefault();
    const touch = event.touches[0];
    if (!touch) return;
    const dy = suggestTouch.y - touch.clientY;
    if (Math.abs(dy) > 8) suggestTouch.moved = true;
    ui.suggest.scrollTop = suggestTouch.scroll + dy;
  }, { passive: false });
  ui.suggest.addEventListener("touchend", (event) => {
    if (!keepKeyboard || !suggestTouch) return;
    event.preventDefault();
    const state = suggestTouch;
    suggestTouch = null;
    if (state.moved) return;
    pickSuggestion(state.li);
  }, { passive: false });
  ui.suggest.addEventListener("touchcancel", () => {
    suggestTouch = null;
  });
  ui.suggest.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

async function boot() {
  bindViewport();
  bindPlay();
  const slots = {
    list: [
      { key: "index", weight: 0.84 },
      { key: "france", weight: 0.08 },
      { key: "dep", weight: 0.08 },
    ],
  };
  try {
    const pending = Promise.all([
      loadJson("data/index.json", slots.list[0], slots),
      loadJson("data/france.geojson", slots.list[1], slots),
      loadJson("data/departements.geojson", slots.list[2], slots),
    ]);
    const ready = map.loaded() ? Promise.resolve() : new Promise((resolve) => map.on("load", resolve));
    const [indexData, france, departements] = await pending;
    await ready;
    index = indexData;
    buildPlaces();
    paintMap(france, departements);
    assertLandmarks();
    setProgress(1);
    ui.load.classList.add("is-done");
    ui.load.setAttribute("aria-busy", "false");
    ui.intro.hidden = false;
  } catch (error) {
    ui.loadText.textContent = "Le chargement a échoué.";
    console.error(error);
  }
}

boot();
