'use strict';

/**
 * ============================================================================
 * TRIANREX v0.9.9
 * ============================================================================
 */

const { app } = require('/application');
const { Document } = require('/document');
const { Dialog, DialogResult } = require('/dialog');
const { AddChildNodesCommandBuilder } = require('/commands');
const { ContainerNodeDefinition, NodeChildType, PolyCurveNodeDefinition } = require('/nodes');
const { CurveBuilder, PolyCurve } = require('/geometry');
const { FillDescriptor } = require('/fills');
const { LineStyleDescriptor } = require('/linestyle');
const { RGBA8 } = require('/colours');
const { UnitType } = require('/units');
const { BlendMode } = require('affinity:common');

const APP_NAME      = 'TrianRex 0.9.9';
const MAX_TRIANGLES = 12000;
const MAX_POINTS    = 6000;
const GRID_BUDGET   = 4000;
const MAX_BOUNDARY  = 3500;
const BEZ_STEPS     = 8;
var FILL_SPACE_MAP = null;

// ── Basis-Helfer ──────────────────────────────────────────────────────────

function fail(msg) { throw new Error(msg); }

function alertBox(text) {
  try { app.alert(text, APP_NAME); }
  catch (e) { console.log('ALERT FEHLGESCHLAGEN: ' + text); }
}

function runModal(d) {
  try { return d.runModal(); }
  catch (e) { if (String(e).indexOf('ABORTED') >= 0) return null; throw e; }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function numberField(group, label, value, min, max, desc) {
  const c = group.addUnitValueEditor(label, UnitType.Number, UnitType.Number, value, min, max);
  c.precision = 1;
  c.showPopupSlider = true;
  if (desc) c.description = desc;
  return c;
}

function makeRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 429497296;
  };
}

function solidFill(r, g, b) {
  return FillDescriptor.createSolid(new RGBA8(r, g, b, 255), BlendMode.Normal);
}

// ── Collection-Zugriff ────────────────────────────────────────────────────

function collLength(coll) {
  try { if (typeof coll.count === 'number') return coll.count; } catch (e) {}
  try { if (typeof coll.getCount === 'function') { const c = coll.getCount(); if (isFinite(c)) return c; } } catch (e) {}
  try { if (isFinite(coll.length)) return coll.length; } catch (e) {}
  try { if (typeof coll.size === 'number') return coll.size; } catch (e) {}
  return 0;
}

function itemAt(coll, i) {
  if (coll == null) return null;
  try { if (typeof coll.at === 'function') { const v = coll.at(i); if (v != null) return v; } } catch (e) {}
  try { if (typeof coll.item === 'function') { const v = coll.item(i); if (v != null) return v; } } catch (e) {}
  try { if (typeof coll.getNodeAt === 'function') { const v = coll.getNodeAt(i); if (v != null) return v; } } catch (e) {}
  try { const v = coll[i]; if (v != null) return v; } catch (e) {}
  return null;
}

function forEachIn(coll, fn) {
  if (coll == null) return;
  if (typeof coll.toArray === 'function') {
    try {
      const arr = coll.toArray();
      for (let i = 0; i < arr.length; i++) if (arr[i]) fn(arr[i], i);
      return;
    } catch (e) {}
  }
  const n = collLength(coll);
  for (let i = 0; i < n; i++) {
    const v = itemAt(coll, i);
    if (v) fn(v, i);
  }
}

// ── Box-Helfer ────────────────────────────────────────────────────────────

function boxToStr(b) {
  if (!b) return 'n/a';
  return Math.round(b.x) + ',' + Math.round(b.y) + ' (' + Math.round(b.width) + 'x' + Math.round(b.height) + ')';
}

function boxDiff(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) +
         Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
}

// ── NEU: PROPERTY-DUMP (Transform-Jagd) ───────────────────────────────────

function propSummary(obj) {
  try {
    const names = Object.getOwnPropertyNames(obj);
    const parts = [];
    for (let i = 0; i < names.length && parts.length < 40; i++) {
      const nm = names[i];
      let val = '?';
      try {
        val = String(obj[nm]);
        if (val.length > 70) val = val.slice(0, 70);
      } catch (e) { val = '!'; }
      parts.push(nm + '=' + val);
    }
    return parts.join(' | ');
  } catch (e) { return '(fehler)'; }
}

function dumpObject(obj, label) {
  if (!obj) { console.log('DUMP[' + label + ']: (null)'); return; }
  console.log('=== DUMP ' + label + ' ===');
  try { console.log('  PROTO0: ' + propSummary(obj)); } catch (e) {}
  try {
    const p = Object.getPrototypeOf(obj);
    if (p) console.log('  PROTO1: ' + propSummary(p));
    const p2 = Object.getPrototypeOf(p);
    if (p2) console.log('  PROTO2: ' + propSummary(p2));
  } catch (e) {}
}

// Versucht die Node-Transform zu finden und anzuwenden
const TRANSFORM_PROPS = ['transform', 'nodeTransform', 'relativeTransform',
  'absoluteTransform', 'matrix', 'transformMatrix', 'placement', 'placementMatrix',
  'nodeMatrix', 'affineTransform'];

function findNodeTransform(n, idx) {
  let found = null;
  for (let i = 0; i < TRANSFORM_PROPS.length; i++) {
    const pn = TRANSFORM_PROPS[i];
    try {
      const t = n[pn];
      if (t == null) continue;
      const m = readMatrix(t);
      if (m) {
        console.log('NODE-TRANSFORM[' + idx + ']: ' + pn + ' = [' + m.join(', ') + ']');
        found = { prop: pn, matrix: m };
        break;
      } else {
        // Objekt existiert, aber andere Prop-Namen → Dump!
        console.log('NODE-TRANSFORM[' + idx + ']: ' + pn + ' vorhanden, aber unlesbar →');
        dumpObject(t, 'transform-objekt-' + pn);
      }
    } catch (e) {}
  }
  if (!found) {
    // Funktionen probieren
    const fns = ['getTransform', 'getNodeTransform', 'getMatrix', 'getAffineTransform'];
    for (let i = 0; i < fns.length; i++) {
      try {
        if (typeof n[fns[i]] !== 'function') continue;
        const t = n[fns[i]]();
        const m = readMatrix(t);
        if (m) {
          console.log('NODE-TRANSFORM[' + idx + ']: ' + fns[i] + '() = [' + m.join(', ') + ']');
          found = { prop: fns[i] + '()', matrix: m };
          break;
        }
      } catch (e) {}
    }
  }
  if (!found) {
    console.log('NODE-TRANSFORM[' + idx + ']: KEINE gefunden → DUMP des kompletten Nodes:');
    dumpObject(n, 'node-' + idx);
  }
  return found;
}

function applyForward(m, p) {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5]
  };
}

function toNum(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  try { if (typeof v.toPixels === 'function') { const p = Number(v.toPixels()); if (isFinite(p)) return p; } } catch (e) {}
  try { if (v.value != null) { const p = Number(v.value); if (isFinite(p)) return p; } } catch (e) {}
  try { const p = Number(v); if (isFinite(p)) return p; } catch (e) {}
  try { const p = parseFloat(String(v)); if (isFinite(p)) return p; } catch (e) {}
  return NaN;
}

function rect(x) {
  if (!x) return null;
  try {
    const nx = toNum(x.x), ny = toNum(x.y);
    let nw = toNum(x.width), nh = toNum(x.height);
    if (!isFinite(nw) && x.size) nw = toNum(x.size.width);
    if (!isFinite(nh) && x.size) nh = toNum(x.size.height);
    if (isFinite(nx) && isFinite(ny) && nw > 0 && nh > 0) return { x: nx, y: ny, width: nw, height: nh };
  } catch (e) {}
  return null;
}

function rectFromCentre(b) {
  const w = toNum(b.width), h = toNum(b.height);
  const cx = toNum(b.centre && b.centre.x), cy = toNum(b.centre && b.centre.y);
  const px = toNum(b.x), py = toNum(b.y);
  if (isFinite(w) && isFinite(h) && w > 0 && h > 0) {
    if (isFinite(px) && isFinite(py)) return { x: px, y: py, width: w, height: h };
    if (isFinite(cx) && isFinite(cy)) return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
  }
  try {
    const tl = b.topLeft || b.tl, br = b.bottomRight || b.br;
    if (tl && br) {
      const x1 = toNum(tl.x), y1 = toNum(tl.y), x2 = toNum(br.x), y2 = toNum(br.y);
      if ([x1, y1, x2, y2].every(function (v) { return isFinite(v); }) && x2 > x1 && y2 > y1) {
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      }
    }
  } catch (e) {}
  return null;
}

function nodeBox(n) {
  try {
    if (typeof n.getSpreadBaseBox === 'function') {
      const b = n.getSpreadBaseBox();
      const r = rectFromCentre(b) || rect(b);
      if (r) return r;
    }
  } catch (e) {}
  const props = ['exactBoundingBox', 'boundingBox', 'bounds', 'bbox', 'frame', 'rect'];
  for (let i = 0; i < props.length; i++) {
    try { const b = rect(n[props[i]]) || rectFromCentre(n[props[i]]); if (b) return b; } catch (e) {}
  }
  try { if (typeof n.getApproxBoundingBox === 'function') { const b = rect(n.getApproxBoundingBox()); if (b) return b; } } catch (e) {}
  try { if (typeof n.getBoundingBox === 'function') { const b = rect(n.getBoundingBox()); if (b) return b; } } catch (e) {}
  return null;
}

function boxFromContours(contours) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < contours.length; i++) {
    for (let j = 0; j < contours[i].length; j++) {
      const p = contours[i][j];
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unionBox(nodes, fallbackContours) {
  let bx = null;
  for (let i = 0; i < nodes.length; i++) {
    const b = nodeBox(nodes[i]);
    if (!b) continue;
    if (!bx) bx = { x: b.x, y: b.y, width: b.width, height: b.height };
    else {
      const x2 = Math.max(bx.x + bx.width, b.x + b.width);
      const y2 = Math.max(bx.y + bx.height, b.y + b.height);
      bx.x = Math.min(bx.x, b.x); bx.y = Math.min(bx.y, b.y);
      bx.width = x2 - bx.x; bx.height = y2 - bx.y;
    }
  }
  if (!bx) bx = boxFromContours(fallbackContours || []);
  return bx;
}

// ── NEU: Sync + Diagnose ──────────────────────────────────────────────────

function methodNamesMatching(obj, pattern) {
  const out = [];
  try {
    let o = obj, depth = 0;
    while (o && depth < 4) {
      const names = Object.getOwnPropertyNames(o);
      for (let i = 0; i < names.length; i++) {
        if (pattern.test(names[i]) && out.indexOf(names[i]) < 0) out.push(names[i]);
      }
      o = Object.getPrototypeOf(o);
      depth++;
    }
  } catch (e) {}
  return out;
}

function forceDocumentSync(doc) {
  const pat = /^(update|commit|refresh|redraw|sync|synchronise|synchronize|flush)/i;
  const cands = methodNamesMatching(doc, pat);
  console.log('SYNC-KANDIDATEN (doc): ' + (cands.length ? cands.join(', ') : 'keine'));
  for (let i = 0; i < cands.length; i++) {
    try {
      doc[cands[i]]();
      console.log('SYNC: doc.' + cands[i] + '() aufgerufen');
    } catch (e) {
      console.log('SYNC: doc.' + cands[i] + '() nicht möglich');
    }
  }
  const appCands = methodNamesMatching(app, pat);
  console.log('SYNC-KANDIDATEN (app): ' + (appCands.length ? appCands.join(', ') : 'keine'));
}

function logSelectionDiagnostics(doc, tag) {
  const sel = getSelectedNodes(doc);
  console.log('DIAG[' + tag + ']: ' + sel.length + ' ausgewählte(s) Objekt(e).');
  for (let i = 0; i < sel.length; i++) {
    const n = sel[i];
    let nm = '?', tp = '?', tr = 'n/a';
    try { nm = String(n.userDescription); } catch (e) {}
    try { tp = n.constructor ? n.constructor.name : '?'; } catch (e) {}
    try {
      const t = n.transform;
      if (t && isFinite(t.a)) tr = [t.a, t.b, t.c, t.d, t.e, t.f].join(',');
    } catch (e) {}
    console.log('  SEL[' + i + ']: name="' + nm + '" typ=' + tp
      + ' box=' + boxToStr(nodeBox(n))
      + ' polyCurve=' + (n.polyCurve ? 'JA' : 'NEIN')
      + ' transform=[' + tr + ']');
  }
  return sel;
}

function contourFingerprint(contours) {
  if (!contours.length) return 'leer';
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < contours.length; i++) {
    for (let j = 0; j < contours[i].length; j++) { sx += contours[i][j].x; sy += contours[i][j].y; n++; }
  }
  const c = contours[0];
  return 'punkte=' + n
    + ' mittel=(' + Math.round(sx / n) + ',' + Math.round(sy / n) + ')'
    + ' start=(' + Math.round(c[0].x) + ',' + Math.round(c[0].y) + ')';
}

// ── Farben ────────────────────────────────────────────────────────────────

function colourToRGB(c) {
  if (!c) return null;
  try {
    const ra = c.rgba8;
    if (ra && isFinite(ra.r) && isFinite(ra.g) && isFinite(ra.b)) {
      return { r: Math.round(ra.r), g: Math.round(ra.g), b: Math.round(ra.b) };
    }
  } catch (e) {}
  try {
    if (isFinite(c.r) && isFinite(c.g) && isFinite(c.b)) {
      const scale = Math.max(c.r, c.g, c.b) <= 1 ? 255 : 1;
      return {
        r: Math.round(clamp(c.r * scale, 0, 255)),
        g: Math.round(clamp(c.g * scale, 0, 255)),
        b: Math.round(clamp(c.b * scale, 0, 255))
      };
    }
  } catch (e) {}
  try { if (c.colour) return colourToRGB(c.colour); } catch (e) {}
  return null;
}

function colourFromStop(ch, idx) {
  if (!ch) return null;
  const direct = colourToRGB(ch);
  if (direct) return direct;

  let h = null;
  try { h = ch.handle; } catch (e) {}

  try {
    const mod = require('/colours');
    const ColourCls = mod && mod.Colour;
    if (ColourCls) {
      const tries = [];
      if (h !== null && h !== undefined) {
        tries.push(function () { return new ColourCls(h); });
        tries.push(function () { return new ColourCls(ch); });
      } else {
        tries.push(function () { return new ColourCls(ch); });
      }
      for (let i = 0; i < tries.length; i++) {
        try { const col = colourToRGB(tries[i]()); if (col) return col; } catch (e) {}
      }
    }
  } catch (e) {}

  if (idx === 0) {
    let exportsStr = 'n/a';
    try { exportsStr = Object.getOwnPropertyNames(require('/colours')).join(', '); } catch (e) {}
    console.log('STOP-COLOUR[0]: FEHLGESCHLAGEN | MODUL-EXPORTS /colours: ' + exportsStr);
    try {
      const proto = Object.getPrototypeOf(ch);
      if (proto) console.log('COLOURHANDLE-PROTO: ' + Object.getOwnPropertyNames(proto).join(', '));
    } catch (e) {}
  }
  return null;
}

// ── Matrix ────────────────────────────────────────────────────────────────

function readMatrix(tf) {
  if (!tf) return null;
  try {
    const d = tf.data;
    if (d != null) {
      const v = [];
      for (let i = 0; i < 6; i++) {
        let x = NaN;
        try { x = toNum(typeof d.at === 'function' ? d.at(i) : d[i]); } catch (e2) {}
        if (!isFinite(x)) return null;
        v.push(x);
      }
      return v;
    }
  } catch (e) {}

  try {
    if (isFinite(tf.a) && isFinite(tf.b) && isFinite(tf.c) &&
        isFinite(tf.d) && isFinite(tf.e) && isFinite(tf.f)) {
      return [tf.a, tf.b, tf.c, tf.d, tf.e, tf.f];
    }
  } catch (e) {}

  return null;
}
function applyInvMatrix(m, px, py) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  const ix = px - m[4], iy = py - m[5];
  return { x: (m[3] * ix - m[2] * iy) / det, y: (m[0] * iy - m[1] * ix) / det };
}

// Punkt durch ein Transform-Objekt mappen (invertierbar) — nutzt die
// offiziellen Methoden statt manueller Matrizen-Rechnung
function mapThroughTransform(tfObj, px, py, invert) {
  if (!tfObj) return null;
  try {
    let t = tfObj;
    if (invert) t = tfObj.clone().invert();
    const r = t.applyToPoint({ x: px, y: py });
    if (r && isFinite(r.x) && isFinite(r.y)) return { x: r.x, y: r.y };
  } catch (e) {}
  return null;
}
// Kalibriert, in welchem Raum die Verlaufs-Matrix arbeitet:
// 'local' (objektlokal, 0/0 = linke obere Ecke) oder 'abs' (Spread-Koordinaten)
// Wählt den Koordinatenraum, in dem die Verlaufs-Matrix arbeitet.
// Bewertet: Wie nah liegt der t-Bereich der Objekt-Box bei [0..1]?
// Wählt den Koordinatenraum, in dem die Verlaufs-Matrix arbeitet.
// Score: Anteil der Testpunkte mit t in [0..1] — robust gegen
// über das Ziel hinausschießende Eckwerte (diagonale Verläufe).
function chooseGradientSpace(fillInfo, dstBox) {
  const inv = fillInfo.invTransform;
  if (!inv) return null;
  const a = fillInfo.align;
  const srcBox = a ? a.src : fillInfo.box;

  // Dichtes 5x5-Raster über die dst-Box (statt nur Ecken)
  const probes = [];
  const NP = 5;
  for (let rr = 0; rr < NP; rr++) {
    for (let cc = 0; cc < NP; cc++) {
      probes.push({
        x: dstBox.x + (cc / (NP - 1)) * dstBox.width,
        y: dstBox.y + (rr / (NP - 1)) * dstBox.height
      });
    }
  }

  const toSrc = function (p) {
    if (!a) return { x: p.x, y: p.y };
    const sx = (a.dst.width / a.src.width) || 1;
    const sy = (a.dst.height / a.src.height) || 1;
    return { x: a.src.x + (p.x - a.dst.x) / sx, y: a.src.y + (p.y - a.dst.y) / sy };
  };

  const defs = [
    ['srcAbs',   function (p) { return toSrc(p); }],
    ['srcLocal', function (p) { const q = toSrc(p); return { x: q.x - srcBox.x, y: q.y - srcBox.y }; }],
    ['srcUnit',  function (p) { const q = toSrc(p); return { x: (q.x - srcBox.x) / (srcBox.width || 1), y: (q.y - srcBox.y) / (srcBox.height || 1) }; }],
    ['dstAbs',   function (p) { return { x: p.x, y: p.y }; }],
    ['dstLocal', function (p) { return { x: p.x - dstBox.x, y: p.y - dstBox.y }; }],
    ['dstUnit',  function (p) { return { x: (p.x - dstBox.x) / (dstBox.width || 1), y: (p.y - dstBox.y) / (dstBox.height || 1) }; }],
    ['chainRaw',  function (p) {
      const ni = fillInfo.nodeInvTransform;
      if (!ni) return null;
      return ni.applyToPoint({ x: p.x, y: p.y });
    }],
    ['chainGeom', function (p) {
      const ni = fillInfo.nodeInvTransform;
      if (!ni) return null;
      const q = ni.applyToPoint({ x: p.x, y: p.y });
      return { x: q.x - srcBox.x, y: q.y - srcBox.y };
    }]
  ];

  let best = null;
  for (let d = 0; d < defs.length; d++) {
    let inRange = 0, mn = Infinity, mx = -Infinity, ok = true;
    for (let i = 0; i < probes.length; i++) {
      let t = null;
      try {
        const uv = inv.applyToPoint(defs[d][1](probes[i]));
        if (uv && isFinite(uv.x)) t = uv.x;
      } catch (e) {}
      if (t === null) { ok = false; break; }
      if (t < mn) mn = t;
      if (t > mx) mx = t;
      if (t >= -0.05 && t <= 1.05) inRange++;
    }
    if (!ok) continue;

    const frac = inRange / probes.length;           // Primär-Score
    const spreadPen = Math.abs((mx - mn) - 1) * 0.1; // Feinjustierung
    const centerPen = Math.abs(((mn + mx) / 2) - 0.5) * 0.2;  // ⬅️ NEU: Bestraft Räume, die nicht zentriert sind!
    const score = frac - spreadPen - centerPen;
    console.log('  GRAD-SPACE[' + defs[d][0] + ']: t=[' + mn.toFixed(2) + '..' + mx.toFixed(2)
      + '] imBereich=' + Math.round(frac * 100) + '% score=' + score.toFixed(2));
    if (!best || score > best.score) best = { name: defs[d][0], score: score };
  }
  console.log(APP_NAME + ': GRAD-SPACE gewählt: ' + (best ? best.name + ' (' + best.score.toFixed(2) + ')' : 'KEINER'));
  return best ? best.name : null;
}
// ── Füllung lesen ─────────────────────────────────────────────────────────
function readFillInfo(n, box) {
  let fd = null;
  let mat = null;
  let gradSpace = null;           // 'local' | 'abs' | null
  let gradientInvTransform = null; // inverse Transform der Verlaufs-Matrix
  try { fd = n.brushFillDescriptor; } catch (e) {}
  if (!fd) {
    try {
      if (n.brushFillInterface && n.brushFillInterface.fillDescriptor) {
        fd = n.brushFillInterface.fillDescriptor;
      }
    } catch (e) {}
  }
  if (!fd || !fd.fill) fail('Das Objekt hat keine lesbare Füllung.');
  const fill = fd.fill;

  let stops = null;
  try {
    if (fill.gradient && fill.gradient.stops && collLength(fill.gradient.stops)) {
      stops = fill.gradient.stops;
    }
  } catch (e) {}

  if (stops && collLength(stops)) {
    const stopArr = [];
    forEachIn(stops, function (st) { stopArr.push(st); });
    console.log(APP_NAME + ': Verlauf erkannt (' + stopArr.length + ' Stops).');

    let mat = null;  // ⬅️ HIER HERAUF VERSCHIEBEN (ganz nach oben!)

    // NEU: Verlaufs-Geometrie jagen (Richtung!)
    console.log('--- GRADIENT-DIAGNOSE ---');
    dumpObject(fd, 'filldescriptor');
    try { dumpObject(fd.fill, 'fill'); } catch (e) {}
    try { dumpObject(fd.fill.gradient, 'gradient'); } catch (e) {}

    // NEU: getTransformInfo() ist der offizielle Weg zur Verlaufs-Geometrie!
    let ti = null;
    try {
      ti = fd.getTransformInfo();
      console.log('--- TRANSFORMINFO-DUMP ---');
      dumpObject(ti, 'transforminfo');
      console.log('--- ENDE ---');
    } catch (e) {
      console.log('TRANSFORMINFO: nicht lesbar (' + e + ')');
    }
    if (ti) {
      // Inverse Transform EINMAL vorbereiten (clone, damit wir nichts am Original ändern)
      let invTf = null;
      try {
        invTf = ti.transform ? ti.transform.clone().invert() : null;
      } catch (e) {
        console.log(APP_NAME + ': Verlaufs-Inverse fehlgeschlagen (' + e + ')');
      }
      if (invTf) {
        // Sanity-Check:inventiert erfolgreich?
        const testP = invTf.applyToPoint({ x: ti.transform.applyToPoint({ x: 0, y: 0 }).x, y: ti.transform.applyToPoint({ x: 0, y: 0 }).y });
        console.log(APP_NAME + ': Verlaufs-Inverse OK (Roundtrip=' + testP.x.toFixed(3) + ',' + testP.y.toFixed(3) + ')');
        mat = readMatrix(ti.transform);
        if (mat) console.log(APP_NAME + ': Verlaufs-Transform via getTransformInfo: [' + mat.join(', ') + ']');
        // Hänge inverse Transform + Rauminfo an fillInfo (via externe Variablen s.u.)
        gradientInvTransform = invTf;
      }
    }
    try { console.log('  gradientFillType: ' + String(fd.fill.gradientFillType)); } catch (e) {}
    console.log('--- ENDE GRADIENT-DIAGNOSE ---');

    // Versuch, Start/End-Punkte zu lesen (für echte Richtung)
    let geo = null;
    try {
      const g = fill.gradient;
      let s = g.startPoint || g.start || g.p1 || g.begin;
      let e = g.endPoint   || g.end   || g.p2 || g.finish;
      if (s && e && isFinite(toNum(s.x)) && isFinite(toNum(e.x))) {
        geo = {
          start: { x: toNum(s.x), y: toNum(s.y) },
          end:   { x: toNum(e.x), y: toNum(e.y) }
        };
        console.log('GRADIENT-GEO: start=(' + geo.start.x + ',' + geo.start.y + ') end=(' + geo.end.x + ',' + geo.end.y + ')');
      }
    } catch (e) {}

    // ALTE MATRIX-PRÜFUNG (Backup)
    try {
      const oldMat = readMatrix(fd.transform);
      if (oldMat && !mat) {  // Nur verwenden, wenn getTransformInfo nichts geliefert hat
        mat = oldMat;
        console.log(APP_NAME + ': ORIGINAL-TRANSFORM: [' + mat.join(', ') + ']');
      } else {
        console.log(APP_NAME + ': ORIGINAL-TRANSFORM: nicht lesbar');
      }
    } catch (e) {}

    const stopList = [];
    for (let i = 0; i < stopArr.length; i++) {
      const st = stopArr[i];
      let pos = null;
      if (st.position !== undefined) pos = st.position;
      else if (st.pos !== undefined) pos = st.pos;
      const col = colourFromStop(st.colour, i);
      if (pos !== null && col) {
        stopList.push({ pos: clamp(pos, 0, 1), col: col });
        console.log('  Stop[' + i + ']: pos=' + pos + ' rgb(' + col.r + ',' + col.g + ',' + col.b + ')');
      }
    }
    stopList.sort(function (a, b) { return a.pos - b.pos; });

    if (stopList.length >= 2) return {
      type: 'gradient', stops: stopList, matrix: mat, box: box, geo: geo,
      gradSpace: gradSpace, invTransform: gradientInvTransform,
      align: FILL_SPACE_MAP
    };
    if (stopList.length === 1) return { type: 'solid', solid: stopList[0].col };
    fail('Verlauf erkannt, aber Stopfarben konnten nicht gelesen werden.');
  }

  const solid = colourToRGB(fill.colour);
  if (solid) {
    console.log(APP_NAME + ': Vollton erkannt rgb(' + solid.r + ',' + solid.g + ',' + solid.b + ')');
    return { type: 'solid', solid: solid };
  }
  fail('Die Füllfarbe konnte nicht gelesen werden.');
}
// ── Stop-Interpolation (eigener Helfer) ───────────────────────────────────

function sampleStops(stops, t) {
  t = clamp(t, 0, 1);
  if (t <= stops[0].pos) return stops[0].col;
  if (t >= stops[stops.length - 1].pos) return stops[stops.length - 1].col;
  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i], s2 = stops[i + 1];
    if (t >= s1.pos && t <= s2.pos) {
      const span = (s2.pos - s1.pos) || 1;
      const f = (t - s1.pos) / span;
      return {
        r: Math.round(s1.col.r + (s2.col.r - s1.col.r) * f),
        g: Math.round(s1.col.g + (s2.col.g - s1.col.g) * f),
        b: Math.round(s1.col.b + (s2.col.b - s1.col.b) * f)
      };
    }
  }
  return stops[stops.length - 1].col;
}

// ── Farbe am Punkt (px, py) aus Original-Füllung sampeln ─────────────────
function sampleOriginalFillAt(fillInfo, px, py, origBox) {
  const stops = fillInfo.stops;
  if (stops.length === 1) return stops[0].col;

  // 1) BESTER WEG: API-Inverse + gewählter Raum
  if (fillInfo.invTransform && fillInfo.gradSpace) {
    const a = fillInfo.align;
    const sp = fillInfo.gradSpace;
    let inp = null;

    if (sp === 'dstAbs') {
      inp = { x: px, y: py };
    } else if (sp === 'dstLocal') {
      inp = { x: px - origBox.x, y: py - origBox.y };
    } else if (sp === 'dstUnit') {
      inp = { x: (px - origBox.x) / (origBox.width || 1), y: (py - origBox.y) / (origBox.height || 1) };
    } else if (sp === 'chainRaw' && fillInfo.nodeInvTransform) {
      inp = fillInfo.nodeInvTransform.applyToPoint({ x: px, y: py });
    } else if (sp === 'chainGeom' && fillInfo.nodeInvTransform && a) {
      const q = fillInfo.nodeInvTransform.applyToPoint({ x: px, y: py });
      inp = { x: q.x - a.src.x, y: q.y - a.src.y };
    } else if (a) {
      const sx = (a.dst.width / a.src.width) || 1;
      const sy = (a.dst.height / a.src.height) || 1;
      const s = { x: a.src.x + (px - a.dst.x) / sx, y: a.src.y + (py - a.dst.y) / sy };
      if (sp === 'srcAbs') inp = s;
      else if (sp === 'srcLocal') inp = { x: s.x - a.src.x, y: s.y - a.src.y };
      else if (sp === 'srcUnit') inp = { x: (s.x - a.src.x) / (a.src.width || 1), y: (s.y - a.src.y) / (a.src.height || 1) };
    }

    if (inp) {
      try {
        const uv = fillInfo.invTransform.applyToPoint(inp);
        if (uv && isFinite(uv.x)) return sampleStops(stops, uv.x);
      } catch (e) {}
    }
  }

  // 2) Geo-Punkte (Start → End des Verlaufs)
  if (fillInfo.geo) {
    const gs = fillInfo.geo.start, ge = fillInfo.geo.end;
    const vx = ge.x - gs.x, vy = ge.y - gs.y;
    const len2 = vx * vx + vy * vy;
    if (len2 > 1e-9) {
      const tGeo = ((px - gs.x) * vx + (py - gs.y) * vy) / len2;
      return sampleStops(stops, tGeo);
    }
  }

  // 3) FALLBACK: Heuristik (im Quell-Raum!)
  const sBox = (fillInfo.align && fillInfo.align.src) ? fillInfo.align.src : fillInfo.box;
  let tVal = 0;
  const relX = (px - sBox.x) / (sBox.width || 1);
  const relY = (py - sBox.y) / (sBox.height || 1);
  if (sBox.width >= sBox.height * 1.5) tVal = clamp(relX, 0, 1);
  else if (sBox.height >= sBox.width * 1.5) tVal = clamp(1 - relY, 0, 1);
  else tVal = clamp((relX + (1 - relY)) / 2, 0, 1);
  return sampleStops(stops, tVal);
}
// ── HSL ───────────────────────────────────────────────────────────────────

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = ((b - r) / d + 2);
    else h = ((r - g) / d + 4);
    h /= 6;
  }
  return { h: h, s: s, l: l };
}

function hslToRgb(h, s, l) {
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1/3) * 255)
  };
}

// ── Auswahl / Spread ──────────────────────────────────────────────────────

function getSelectedNodes(doc) {
  const out = [];
  try {
    if (doc.selection && doc.selection.nodes) forEachIn(doc.selection.nodes, function (n) { out.push(n); });
  } catch (e) {}
  if (!out.length) {
    try { if (doc.selectedNodes) forEachIn(doc.selectedNodes, function (n) { out.push(n); }); } catch (e) {}
  }
  return out;
}

function nodeNameOf(n) {
  try { const s = n.userDescription; if (typeof s === 'string' && s.trim()) return s.trim(); } catch (e) {}
  try { const s = n.name; if (typeof s === 'string' && s.trim()) return s.trim(); } catch (e) {}
  return null;
}

function getCurrentSpread(doc) {
  try { if (doc.currentSpread) return doc.currentSpread; } catch (e) {}
  try { if (doc.spreads && doc.spreads.first) return doc.spreads.first; } catch (e) {}
  try { if (doc.spreads) { let found = null; forEachIn(doc.spreads, function (s) { if (!found) found = s; }); if (found) return found; } } catch (e) {}
  try { const sel = doc.selection; if (sel && sel.spread) return sel.spread; } catch (e) {}
  return null;
}

function nodeKey(n) {
  try { if (n.handle !== undefined && n.handle !== null) return 'h:' + String(n.handle); } catch (e) {}
  try { return 'd:' + String(n.userDescription); } catch (e) {}
  return 'x:' + Math.random();
}

// ── Konturen ──────────────────────────────────────────────────────────────

// Nullstellen einer quadratischen Gleichung a*t² + b*t + c = 0
function quadRootsInRange(a, b, c, out) {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t > 0 && t < 1) out.push(t);
    }
    return;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return;
  const sq = Math.sqrt(disc);
  const t1 = (-b + sq) / (2 * a);
  const t2 = (-b - sq) / (2 * a);
  if (t1 > 0 && t1 < 1) out.push(t1);
  if (t2 > 0 && t2 < 1) out.push(t2);
}

function bezPoint(p0, c1, c2, p3, t) {
  const u = 1 - t;
  return {
    x: u*u*u*p0.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*p3.y
  };
}

function flattenToPoints(beziers) {
  const pts = [];
  const count = collLength(beziers);
  for (let j = 0; j < count; j++) {
    const bez = itemAt(beziers, j);
    if (!bez) continue;
    const p0 = bez.start, p3 = bez.end;
    if (!p0 || !p3) continue;
    const c1 = bez.c1 || { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
    const c2 = bez.c2 || { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };

    // 1) REGELMÄSSIGE ABTASTUNG (für die Dreiecks-Kantenqualität)
    for (let i = 0; i <= BEZ_STEPS; i++) pts.push(bezPoint(p0, c1, c2, p3, i / BEZ_STEPS));

    // 2) EXAKTE EXTREMPUNKTE (für exakte Bounding-Box!)
    //    x'(t) = 3[(−p0+3c1−3c2+p3)t² + 2(p0−2c1+c2)t + (c1−p0)]
    const extT = [];
    quadRootsInRange(-p0.x + 3*c1.x - 3*c2.x + p3.x,
                     2*(p0.x - 2*c1.x + c2.x),
                     c1.x - p0.x, extT);
    quadRootsInRange(-p0.y + 3*c1.y - 3*c2.y + p3.y,
                     2*(p0.y - 2*c1.y + c2.y),
                     c1.y - p0.y, extT);
    for (let i = 0; i < extT.length; i++) pts.push(bezPoint(p0, c1, c2, p3, extT[i]));
  }
  return pts;
}

function contoursFromPolyCurve(polyCurve, out) {
  if (!polyCurve) return false;
  const before = out.length;
  try {
    const curveCount = typeof polyCurve.curveCount === 'number' ? polyCurve.curveCount : 0;
    for (let i = 0; i < curveCount; i++) {
      const cv = polyCurve.at ? polyCurve.at(i) : itemAt(polyCurve, i);
      if (cv && cv.beziers) {
        const pts = flattenToPoints(cv.beziers);
        if (pts.length >= 3) out.push(pts);
      }
    }
  } catch (e) {}
  return out.length > before;
}

function contoursFromCurvesInterface(node, out) {
  const before = out.length;
  try {
    if (node.curvesInterface && node.curvesInterface.polyCurve) {
      contoursFromPolyCurve(node.curvesInterface.polyCurve, out);
    }
  } catch (e) {}
  return out.length > before;
}

function extractContours(nodes) {
  const contours = [];
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const nb = nodeBox(nd);
    const before = contours.length;

    // DREI Kandidaten sammeln, den besten (Box-Distanz zur ObjektBox) wählen
    const candRaw = [];    // polyCurve 1:1
    const candMapped = []; // polyCurve durch node.transform
    const candCI = [];     // curvesInterface.polyCurve 1:1

    try { contoursFromPolyCurve(nd.polyCurve, candRaw); } catch (e) {}
    try {
      if (nd.curvesInterface && nd.curvesInterface.polyCurve) {
        contoursFromPolyCurve(nd.curvesInterface.polyCurve, candCI);
      }
    } catch (e) {}
    for (let ci = 0; ci < candRaw.length; ci++) {
      const m = [];
      try {
        for (let pi = 0; pi < candRaw[ci].length; pi++) {
          const q = (nd.transform && typeof nd.transform.applyToPoint === 'function')
            ? nd.transform.applyToPoint(candRaw[ci][pi])
            : candRaw[ci][pi];
          m.push(q && isFinite(q.x) ? q : candRaw[ci][pi]);
        }
      } catch (e) { continue; }
      candMapped.push(m);
    }

    let collected = null, chosen = 'keine';
    if (candRaw.length + candMapped.length + candCI.length > 0) {
      const score = function (cs) {
        const b = boxFromContours(cs);
        return (b && nb) ? boxDiff(b, nb) : Infinity;
      };
      const best = [
        ['polyCurve-roh', candRaw, score(candRaw)],
        ['polyCurve-gemappt', candMapped, score(candMapped)],
        ['curvesInterface', candCI, score(candCI)]
      ].sort(function (x, y) { return x[2] - y[2]; })[0];
      collected = best[1]; chosen = best[0];
      console.log('KONTUR[' + i + ']: Quelle gewählt → ' + chosen
        + ' (Diff=' + Math.round(best[2]) + 'px | roh=' + Math.round(score(candRaw))
        + ' | gemappt=' + Math.round(score(candMapped))
        + ' | curvesIface=' + Math.round(score(candCI)) + ')');
    }
    const found = !!collected;

    if (found && i === 0 && nb) {
      // WICHTIG: src muss der LOKALE Raum sein (vor Transform!), sonst
      // brechen die Verlaufs-Kandidaten, sobald 'polyCurve-gemappt' gewinnt.
      const localCs = candRaw.length ? candRaw : (candCI.length ? candCI : collected);
      FILL_SPACE_MAP = { src: boxFromContours(localCs), dst: nb };
    }
    if (collected) {
      for (let ci = 0; ci < collected.length; ci++) contours.push(collected[ci]);
    }

    if (contours.length > before) {
      const newOnes = contours.slice(before);
      console.log('KONTUR[' + i + ']: ' + newOnes.length + ' Kontur(en)'
        + ' | KonturBox=' + boxToStr(boxFromContours(newOnes))
        + ' | ObjektBox=' + boxToStr(nb));
    } else {
      let ctorName = 'unbekannt';
      try { ctorName = nd.constructor ? nd.constructor.name : 'unbekannt'; } catch (e) {}
      console.log('KONTUR[' + i + ']: NICHT LESBAR (Typ: ' + ctorName + ')');
    }

    // Kinder nur durchsuchen, wenn dieser Knoten nichts lieferte
    if (contours.length === before) {
      try {
        if (nd.children) {
          forEachIn(nd.children, function (child) {
            const sub = extractContours([child]);
            for (let j = 0; j < sub.length; j++) contours.push(sub[j]);
          });
        }
      } catch (e) {}
    }
  }
  return contours;
}

function pointInside(px, py, contours) {
  if (contours.length === 0) return true;
  let inside = false;
  for (let i = 0; i < contours.length; i++) {
    const c = contours[i];
    for (let j = 0, k = c.length - 1; j < c.length; k = j++) {
      const xi = c[j].x, yi = c[j].y, xk = c[k].x, yk = c[k].y;
      const tolerance = 0.5;
      if (((yi > py - tolerance) !== (yk > py - tolerance)) &&
          (px < (xk - xi) * (py - yi) / (yk - yi + 0.0001) + xi + tolerance)) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// Minimaler Abstand eines Punktes zur Konturlinie (für Ecken-Regel)
function distToContour(px, py, contours) {
  let best = Infinity;
  for (let i = 0; i < contours.length; i++) {
    const c = contours[i];
    for (let j = 0; j < c.length; j++) {
      const a = c[j], b = c[(j + 1) % c.length];
      const vx = b.x - a.x, vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      let t = len2 > 1e-9 ? ((px - a.x) * vx + (py - a.y) * vy) / len2 : 0;
      t = clamp(t, 0, 1);
      const dx = a.x + t * vx - px, dy = a.y + t * vy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}
// Fläche eines Dreiecks (für Splitter-Filter)
function triArea(a, b, c) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

function contourLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  return L;
}

function resampleContour(pts, spacing) {
  if (pts.length < 2 || spacing <= 0) {
    const out = [];
    for (let i = 0; i < pts.length; i++) out.push({ x: pts[i].x, y: pts[i].y });
    return out;
  }
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let prev = pts[0];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    let segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    let guard = 0;
    while (carry + segLen >= spacing && guard++ < 100000) {
      const t = (spacing - carry) / segLen;
      prev = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push({ x: prev.x, y: prev.y });
      segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      carry = 0;
      if (segLen < 1e-9) break;
    }
    carry += segLen;
    prev = cur;
  }
  return out;
}

function minTriSizeFor(box) {
  let size = 2;
  while (size < 5000) {
    const cols = Math.ceil(box.width / size) + 1;
    const rows = Math.ceil(box.height / size) + 1;
    if (cols * rows <= GRID_BUDGET) break;
    size = Math.ceil(size * 1.15);
  }
  return size;
}

// ── Delaunay ──────────────────────────────────────────────────────────────

function circumcircle(pts, i, j, k) {
  const a = pts[i], b = pts[j], c = pts[k];
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((a.x*a.x + a.y*a.y) * (b.y - c.y) + (b.x*b.x + b.y*b.y) * (c.y - a.y) + (c.x*c.x + c.y*c.y) * (a.y - b.y)) / d;
  const uy = ((a.x*a.x + a.y*a.y) * (c.x - b.x) + (b.x*b.x + b.y*b.y) * (a.x - c.x) + (c.x*c.x + c.y*c.y) * (b.x - a.x)) / d;
  const r2 = (a.x - ux)*(a.x - ux) + (a.y - uy)*(a.y - uy);
  return { x: ux, y: uy, r2: r2 };
}

function delaunay(input) {
  const points = input.slice();
  const n = points.length;
  if (n < 3) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i].x < minX) minX = points[i].x; if (points[i].x > maxX) maxX = points[i].x;
    if (points[i].y < minY) minY = points[i].y; if (points[i].y > maxY) maxY = points[i].y;
  }
  const dx = maxX - minX || 1, dy = maxY - minY || 1;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const dmax = Math.max(dx, dy) * 20;
  points.push({ x: midX - dmax, y: midY - dmax });
  points.push({ x: midX + dmax, y: midY - dmax });
  points.push({ x: midX, y: midY + dmax });

  let tris = [[n, n + 1, n + 2]];

  for (let pi = 0; pi < n; pi++) {
    const p = points[pi];
    const bad = [];
    for (let ti = 0; ti < tris.length; ti++) {
      const t = tris[ti];
      const cc = circumcircle(points, t[0], t[1], t[2]);
      if (cc) {
        const dxp = p.x - cc.x, dyp = p.y - cc.y;
        if (dxp*dxp + dyp*dyp <= cc.r2 * 1.0000001) bad.push(t);
      }
    }
    const edges = [];
    for (let bi = 0; bi < bad.length; bi++) {
      const t = bad[bi];
      edges.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]);
    }
    const badSet = new Set(bad.map(function (t) { return t.join(','); }));
    tris = tris.filter(function (t) { return !badSet.has(t.join(',')); });

    const counts = {};
    const key = function (e) { return e[0] < e[1] ? e[0] + '_' + e[1] : e[1] + '_' + e[0]; };
    for (let ei = 0; ei < edges.length; ei++) counts[key(edges[ei])] = (counts[key(edges[ei])] || 0) + 1;
    for (let ei = 0; ei < edges.length; ei++) {
      if (counts[key(edges[ei])] === 1) tris.push([edges[ei][0], edges[ei][1], pi]);
    }
  }

  return tris.filter(function (t) { return t[0] < n && t[1] < n && t[2] < n; });
}

// ── Node-Erzeugung ────────────────────────────────────────────────────────

function createPolyCurve(points, closed) {
  const builder = CurveBuilder.create();
  builder.begin(points[0]);
  for (let i = 1; i < points.length; i++) builder.lineTo(points[i]);
  if (closed) builder.close();
  const pc = PolyCurve.create();
  pc.addCurve(builder.createCurve());
  return pc;
}

function triangleDefinition(a, b, c, col) {
  const pc = createPolyCurve([a, b, c], true);
  const fill = solidFill(col.r, col.g, col.b);
  const noFill = FillDescriptor.createNone();
  const noLine = LineStyleDescriptor.createDefault(0);
  const def = PolyCurveNodeDefinition.create(pc, fill, noFill, noLine, noFill);
  def.userDescription = 'Tri';
  return def;
}

// ── Gruppe mit automatischer Nummerierung ──────────────────────────────────

function isContainerLike(n) {
  try { return !!n.isContainerNode; } catch (e) { return true; }
}

function findUniqueGroupName(baseName, spread) {
  let candidate = baseName;
  let counter = 1;

  const existingNames = [];
  try {
    forEachIn(spread.children, function (child) {
      if (child && child.userDescription) {
        existingNames.push(String(child.userDescription));
      }
    });
  } catch (e) {}

  if (existingNames.indexOf(candidate) < 0) return candidate;

  while (counter < 1000) {
    candidate = baseName + '-' + counter;
    if (existingNames.indexOf(candidate) < 0) return candidate;
    counter++;
  }
  return baseName + '-X';
}

function findNewContainer(doc, spread, beforeKeys, selectedBeforeKeys, groupName) {
  findNewContainer.result = null;
  try {
    forEachIn(spread.children, function (child) {
      if (!findNewContainer.result && beforeKeys.indexOf(nodeKey(child)) < 0 && isContainerLike(child)) {
        console.log(APP_NAME + ': Gruppe via Handle-Differenz gefunden.');
        findNewContainer.result = child;
      }
    });
    if (findNewContainer.result) return findNewContainer.result;
  } catch (e) { console.log(APP_NAME + ': Handle-Differenz fehlgeschlagen: ' + e); }

  try {
    forEachIn(spread.children, function (child, i) {
      if (!findNewContainer.result && child && child.userDescription === groupName) {
        console.log(APP_NAME + ': Gruppe via Namenssuche gefunden (Index ' + i + ').');
        findNewContainer.result = child;
      }
    });
    if (findNewContainer.result) return findNewContainer.result;
  } catch (e) {}

  try {
    const nowSel = getSelectedNodes(doc);
    for (let i = 0; i < nowSel.length; i++) {
      if (selectedBeforeKeys.indexOf(nodeKey(nowSel[i])) < 0 && isContainerLike(nowSel[i])) {
        console.log(APP_NAME + ': Gruppe via Auswahl gefunden.');
        return nowSel[i];
      }
    }
  } catch (e) {}

  try {
    forEachIn(spread.children, function (child, i) {
      if (!child) { console.log('CHILD-DUMP[' + i + ']: (null)'); return; }
      let ud = '?', ic = '?';
      try { ud = String(child.userDescription); } catch (e) {}
      try { ic = String(child.isContainerNode); } catch (e) {}
      console.log('CHILD-DUMP[' + i + ']: desc="' + ud + '", container=' + ic + ', key=' + nodeKey(child));
    });
  } catch (e) {}
  return null;
}

// ── PREVIEW-HELFER ────────────────────────────────────────────────────────
let METHODS_DUMPED = false;

function dumpAddMethods(obj, label) {
  if (METHODS_DUMPED) return;
  METHODS_DUMPED = true;
  try {
    const names = [];
    let o = obj, depth = 0;
    while (o && depth < 4) {
      const ns = Object.getOwnPropertyNames(o);
      for (let i = 0; i < ns.length; i++)
        if (/^add/.test(ns[i]) && names.indexOf(ns[i]) < 0) names.push(ns[i]);
      o = Object.getPrototypeOf(o);
      depth++;
    }
    console.log(APP_NAME + ': VERFÜGBARE ' + label + '-METHODEN: ' + names.join(', '));
  } catch (e) {}
}

function dumpControlProps(ctrl, label) {
  try {
    const names = [];
    let o = ctrl, depth = 0;
    while (o && depth < 5) {
      const ns = Object.getOwnPropertyNames(o);
      for (let i = 0; i < ns.length; i++)
        if (names.indexOf(ns[i]) < 0) names.push(ns[i]);
      o = Object.getPrototypeOf(o);
      depth++;
    }
    console.log(APP_NAME + ': ' + label + '-PROPS: ' + names.join(', '));
  } catch (e) {}
}

function runParamsDialog(d, minSize, showWarn) {
  const dlg = Dialog.create(APP_NAME);
  dlg.initialWidth = 420;
  dlg.isResizable = true;
  const col = dlg.addColumn();

  const gGeom = col.addGroup('Geometrie');
  const sizeCtrl = numberField(gGeom, 'Ø Dreiecksgröße (px)', d.size, minSize, Math.max(1000, minSize * 2),
    'Kleinere Werte = mehr und kleinere Dreiecke. Minimum: ' + minSize + ' px.');
  const jitterCtrl = numberField(gGeom, 'Unregelmäßigkeit (%)', d.jitter, 0, 100,
    'Verschiebt die Gitterpunkte zufällig – 0 = perfektes Raster.');

  const gCol = col.addGroup('Farbe');
  const comboItems = ['Objektfarbe', 'Zufällig', 'Verlauf oben → unten', 'Verlauf unten → oben', 'Verlauf links → rechts'];
  const dirCtrl = gCol.addComboBox('Verteilung', comboItems, d.mode);
  try { dirCtrl.isFullWidth = true; } catch (e) {}
  const varCtrl = numberField(gCol, 'Farbvariation (%)', d.varv, 0, 100,
    'Leichte Helligkeits-Shades pro Dreieck. 0 = exakte Objektfarbe.');

  const gOpt = col.addGroup('Optionen');                                    // ⬅️ DARF NICHT FEHLEN!
  const seedCtrl = numberField(gOpt, 'Zufalls-Seed', d.seed, 0, 9999, 'Gleicher Seed = gleiches Ergebnis.');

  if (showWarn) {
    const wt = gOpt.addStaticText('', '\u26A0 Warnung: Konturen nicht lesbar — Form wird möglicherweise nicht exakt getroffen.');
    wt.isFullWidth = true;
    try { wt.textColour = RGBA8(140, 95, 0, 255); } catch (e) {}
  }

  const r = runModal(dlg);
  if (!r || !r.equals(DialogResult.Ok)) return null;

  return {
    size: Math.max(minSize, Number(sizeCtrl.value) || d.size),
    jitter: clamp(Number(jitterCtrl.value) || 0, 0, 100),
    varv: clamp(Number(varCtrl.value) || 0, 0, 100),
    seed: clamp(Math.floor(Number(seedCtrl.value) || 0), 0, 9999),
    mode: Math.max(0, dirCtrl.selectedIndex)
  };
}
// Rollt die zuletzt ausgeführten Commands zurück (1 Command = 1 Undo-Schritt).
// Gibt true zurück, wenn alles sauber entfernt wurde.
function undoCommands(doc, n) {
  for (let i = 0; i < n; i++) {
    try { doc.undo(); }
    catch (e) {
      const cands = methodNamesMatching(doc, /^(undo|revert|roll)/i);
      console.log(APP_NAME + ': doc.undo() fehlgeschlagen. Kandidaten: ' + (cands.length ? cands.join(', ') : 'KEINE'));
      return false;
    }
  }
  return true;
}

function main() {
  const doc = Document.current;
  if (!doc) fail('Bitte zuerst ein Dokument öffnen.');

  const spread = getCurrentSpread(doc);
  if (!spread) fail('Keine Seite (Spread) gefunden.');

  let selected = getSelectedNodes(doc);
  if (!selected.length) fail('Bitte zuerst ein Vektorelement auswählen.');

  const srcName = (selected.map(nodeNameOf).filter(Boolean))[0] || 'Objekt';

  // ── ERSTE LESUNG (für Dialog: Warnung, Slider-Grenzen) ─────────────────
  logSelectionDiagnostics(doc, 'VOR-DIALOG');
  let contours = extractContours(selected);
  let origBox = unionBox(selected, contours);
  if (!origBox) fail('Konnte Größe nicht bestimmen. Objekt in Kurven umwandeln.');
  console.log('FINGERPRINT[VOR-DIALOG]: ' + contourFingerprint(contours));

  const diag = Math.sqrt(origBox.width * origBox.width + origBox.height * origBox.height);
  const minSize = minTriSizeFor(origBox);
  const startSize = clamp(clamp(Math.round(diag / 12), 4, 400), minSize, Math.max(minSize, 400));

  // ── FÜLLUNG + VERLAUFSRAUM ─────────────────────────────────────────────
  const fillInfo = readFillInfo(selected[0], origBox);

  try {
    if (fillInfo.type === 'gradient' && selected[0] && selected[0].transform) {
      fillInfo.nodeInvTransform = selected[0].transform.clone().invert();
      console.log(APP_NAME + ': Node-InvTransform bereit (echte Kette aktiv).');
    }
  } catch (e) {
    console.log(APP_NAME + ': Node-InvTransform fehlgeschlagen: ' + e);
  }

  if (fillInfo.type === 'gradient') {
    fillInfo.gradSpace = chooseGradientSpace(fillInfo, origBox);
  }
     function buildDefs(p) {
    const triSize = p.size;
    const jitter = p.jitter / 100;
    const variance = p.varv / 100;
    const rand = makeRandom(p.seed || Math.floor(Math.random() * 9999));

    function isValidPoint(pt) {
      return !!pt && isFinite(pt.x) && isFinite(pt.y);
    }

    // ── PUNKTE ────────────────────────────────────────────────────────
    const points = [];

    if (contours.length) {
      let totalLen = 0;
      for (let i = 0; i < contours.length; i++) totalLen += contourLength(contours[i]);

      let spacing = Math.max(2, triSize * 0.3);
      while (totalLen / spacing > MAX_BOUNDARY) spacing *= 1.3;
      const minBoundaryPoints = Math.max(60, Math.round(totalLen / Math.max(6, triSize * 0.5)));
      if (totalLen / spacing < minBoundaryPoints) spacing = totalLen / minBoundaryPoints;

      for (let i = 0; i < contours.length; i++) {
        const rs = resampleContour(contours[i], spacing).filter(isValidPoint);
        if (rs.length < 3) continue;

        const n = rs.length;
        let ccx = 0, ccy = 0;
        for (let j = 0; j < n; j++) { ccx += rs[j].x; ccy += rs[j].y; }
        ccx /= n; ccy /= n;

        const eps = Math.max(1.0, triSize * 0.012);

        // Randpunkte mit Mini-Nudge nach innen (damit sie sicher innen liegen)
        for (let j = 0; j < n; j++) {
          const nx = ccx - rs[j].x, ny = ccy - rs[j].y;
          const nl = Math.hypot(nx, ny) || 1;
          points.push({ x: rs[j].x + (nx / nl) * eps, y: rs[j].y + (ny / nl) * eps });
        }

        // ── ECKEN aus der DICHTEN Originalkontur (genauer als nach Resampling)
        const dc = contours[i];
        const dn = dc.length;
        if (dn >= 7) {
          const CORNER_COS = Math.cos((130 / 180) * Math.PI);
          const dlook = 3;                       // fest, klein — nie > dn/2
          let lastCx = Infinity, lastCy = Infinity;
          for (let j = 0; j < dn; j++) {
            const pj = dc[j];
            const pa = dc[((j - dlook) % dn + dn) % dn];   // ⬅️ POSITIVER Modulo
            const pb = dc[(j + dlook) % dn];
            const v1x = pa.x - pj.x, v1y = pa.y - pj.y;
            const v2x = pb.x - pj.x, v2y = pb.y - pj.y;
            const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
            if (l1 < 1e-6 || l2 < 1e-6) continue;
            if ((v1x * v2x + v1y * v2y) / (l1 * l2) < CORNER_COS) {
              // Nur einen Punkt pro Ecke setzen (Cluster vermeiden)
              if (Math.hypot(pj.x - lastCx, pj.y - lastCy) < spacing * 0.5) continue;
              lastCx = pj.x; lastCy = pj.y;
              const nx = ccx - pj.x, ny = ccy - pj.y;
              const nl = Math.hypot(nx, ny) || 1;
              const cp = { x: pj.x + (nx / nl) * eps, y: pj.y + (ny / nl) * eps };
              if (isValidPoint(cp)) points.push(cp);
            }
          }
        }
      }
    }

    // Innergrid (mit Jitter)
    const margin = 0.005;
    const colsN = Math.max(2, Math.ceil(origBox.width / triSize) + 1);
    const rowsN = Math.max(2, Math.ceil(origBox.height / triSize) + 1);
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < colsN; c++) {
        const gx = origBox.x + margin + ((c + 0.5) / colsN) * origBox.width * (1 - 2 * margin);
        const gy = origBox.y + margin + ((r + 0.5) / rowsN) * origBox.height * (1 - 2 * margin);
        const px = gx + (rand() - 0.5) * 2 * triSize * jitter;
        const py = gy + (rand() - 0.5) * 2 * triSize * jitter;
        if (contours.length && !pointInside(px, py, contours)) continue;
        if (isValidPoint({ x: px, y: py })) points.push({ x: px, y: py });
      }
    }

    console.log(APP_NAME + ': ' + points.length + ' Punkte für Triangulation.');

    if (points.length < 3) {
      alertBox('Nicht genug Punkte für Triangulation.\nBitte Dreiecksgröße verringern.');
      return null;
    }
    if (points.length > MAX_POINTS) {
      alertBox('Zu viele Punkte (' + points.length + ').\n\nBitte Dreiecksgröße erhöhen — Minimum: ' + minSize + ' px.');
      return null;
    }

    // ── TRIANGULATION + FARBEN ───────────────────────────────────────
    const tris = delaunay(points);
    console.log(APP_NAME + ': ' + tris.length + ' Roh-Dreiecke.');

    const baseSolid = fillInfo.type === 'solid'
      ? fillInfo.solid
      : fillInfo.stops[Math.floor(fillInfo.stops.length / 2)].col;
    const hsl = rgbToHsl(baseSolid.r, baseSolid.g, baseSolid.b);
    const multFactor = 0.01;
    const addFactor = 0.15;
    const defs = [];
    const minTriArea = Math.max(0.5, triSize * triSize * 0.003);

    for (let ti = 0; ti < tris.length; ti++) {
      const t = tris[ti];
      if (t[0] >= points.length || t[1] >= points.length || t[2] >= points.length) continue;

      const a = points[t[0]], b = points[t[1]], c = points[t[2]];
      if (!isValidPoint(a) || !isValidPoint(b) || !isValidPoint(c)) continue;

      const cx = (a.x + b.x + c.x) / 3;
      const cy = (a.y + b.y + c.y) / 3;

           // ── FILTER (mit Ecken-Rettung) ───────────────────────────────────
            // ── FILTER: Ecken-Sliver retten, Auswüchse & Brücken töten ─────────
      if (contours.length) {
        if (triArea(a, b, c) < Math.max(0.5, triSize * triSize * 0.0015)) continue;

        let vi = 0;
        if (pointInside(a.x, a.y, contours)) vi++;
        if (pointInside(b.x, b.y, contours)) vi++;
        if (pointInside(c.x, c.y, contours)) vi++;

        // Kanten-Mittelpunkte prüfen: Zählt nur als "draußen", wenn der
        // Abstand zur Kontur die Toleranz übersteigt (numerische Nähe am
        // Rand zählt als innen — sonst sterben die Quadrat-Ecken).
        const tolM = Math.max(2, triSize * 0.08);
        const mids = [
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 },
          { x: (c.x + a.x) / 2, y: (c.y + a.y) / 2 }
        ];
        let mo = 0;
        for (let mi = 0; mi < 3; mi++) {
          if (!pointInside(mids[mi].x, mids[mi].y, contours) &&
              distToContour(mids[mi].x, mids[mi].y, contours) > tolM) mo++;
        }

        const cin = pointInside(cx, cy, contours);

        if (!cin) {
          // Schwerpunkt DRAUSSEN: Rettung NUR als Eck-Sliver —
          // ALLE Ecken innen, KEINE Kantenmitte draußen, nah am Rand.
          if (vi < 3 || mo > 0) continue;
          if (distToContour(cx, cy, contours) > Math.max(4, triSize * 0.3)) continue;
        } else {
          // Schwerpunkt INNEN: akzeptieren — außer es ist eine Brücke
          // über eine Kerbe (2+ Kantenmitten deutlich draußen).
          if (mo >= 2) continue;
          if (vi === 0) continue;
        }
      }

      let col;
      if (p.mode === 0) {
        col = fillInfo.type === 'gradient'
          ? sampleOriginalFillAt(fillInfo, cx, cy, origBox)
          : fillInfo.solid;
        if (variance > 0) {
          const vhsl = rgbToHsl(col.r, col.g, col.b);
          const f = 1 + (rand() - 0.5) * 2 * variance * multFactor;
          col = hslToRgb(vhsl.h, vhsl.s, clamp(vhsl.l * f, 0.02, 0.98));
        }
      } else if (p.mode === 1) {
        const base = fillInfo.type === 'gradient'
          ? sampleOriginalFillAt(fillInfo, cx, cy, origBox)
          : fillInfo.solid;
        const bhsl = rgbToHsl(base.r, base.g, base.b);
        const strength = variance * variance;
        let h = bhsl.h + (rand() - 0.5) * variance;
        h = h - Math.floor(h);
        const s = clamp(bhsl.s * (1 - (rand() - 0.5) * 2 * strength * 0.5), 0, 1);
        const rdm = rand();
        let l;
        if (rdm >= 0.5) l = bhsl.l * (1 + (rdm - 0.5) * 2 * 0.6 * strength);
        else l = bhsl.l * (1 - ((0.5 - rdm) * 2) * strength);
        col = hslToRgb(h, s, clamp(l, 0.02, 0.98));
      } else {
        let dl = 0;
        if (p.mode === 2) {
          const f = (cy - origBox.y) / origBox.height;
          dl = f * variance * addFactor;
        } else if (p.mode === 3) {
          const f = 1 - (cy - origBox.y) / origBox.height;
          dl = f * variance * addFactor;
        } else {
          const f = (cx - origBox.x) / origBox.width;
          dl = f * variance * addFactor;
        }
        col = hslToRgb(hsl.h, hsl.s, clamp(hsl.l + dl, 0.05, 0.95));
      }

      defs.push(triangleDefinition(a, b, c, col));
      if (defs.length >= MAX_TRIANGLES) break;
    }

    if (!defs.length) {
      alertBox('Keine Dreiecke lagen innerhalb der Form.\nVersuche es mit anderen Parametern.');
      return null;
    }
    console.log(APP_NAME + ': ' + defs.length + ' gültige Dreiecke.');
    return defs;
  }

  // ── EINFÜGEN: Gruppe anlegen + Dreiecke rein ─────────────────────────────
  function insertResult(defs, gName) {
    const childrenBeforeKeys = [];
    try { forEachIn(spread.children, function (child) { childrenBeforeKeys.push(nodeKey(child)); }); } catch (e) {}
    const selectedBeforeKeys = selected.map(nodeKey);

    let container = null;
    try {
      const gb = AddChildNodesCommandBuilder.create();
      gb.addNode(ContainerNodeDefinition.create(gName));
      gb.setInsertionTarget(spread);
      doc.executeCommand(gb.createCommand(false, NodeChildType.Main));
    } catch (e) {
      console.log(APP_NAME + ': Gruppen-Anlegen warf Fehler: ' + e);
    }
    container = findNewContainer(doc, spread, childrenBeforeKeys, selectedBeforeKeys, gName);

    const target = container || spread;
    const nb = AddChildNodesCommandBuilder.create();
    nb.setInsertionTarget(target);
    for (let i = 0; i < defs.length; i++) nb.addNode(defs[i]);
    doc.executeCommand(nb.createCommand(false, NodeChildType.Main));

    return container;
  }

  // ── ABLAUF ─────────────────────────────────────────────────────────────
  let d = { size: startSize, jitter: 50, varv: 0, seed: 0, mode: 0 };

  const p = runParamsDialog(d, minSize, !contours.length);
  if (!p) return;                     // Abbruch

  const defs = buildDefs(p);
  if (!defs) return;                  // Fehlermeldung kam schon via alertBox

  const groupName = findUniqueGroupName(srcName + '-Triangulated', spread);
  insertResult(defs, groupName);
  alertBox(defs.length + ' Dreiecke erzeugt!\nGruppe: ' + groupName);
}

try {
  main();
} catch (e) {
  const s = String((e && e.message) || e);
  if (s.indexOf('ABORTED') < 0) alertBox(s);
}