#!/usr/bin/env node
/* =============================================================================
 * مصروفي — tools/make-icons.mjs
 * مولّد أيقونات PNG خالص بـ node — **بلا أي مكتبة خارجية** (zlib المدمج فقط).
 *
 * يكتب PNG حقيقياً بالبايت:
 *   [توقيع PNG 8 بايت] + IHDR + IDAT (zlib.deflateSync) + IEND، مع CRC32 محسوب هنا.
 * نوع اللون 6 (RGBA، 8 بت) — الرسم بـ SDF وحواف ملساء (anti-aliased).
 *
 * المخرجات في assets/img/:
 *   icon-192.png  icon-512.png            (any   — زوايا دائرية، شفافية خارجها)
 *   icon-maskable-192.png  -512.png       (maskable — خلفية كاملة + الرسم داخل 80% المركزية)
 *   apple-touch-icon.png  (180×180، بلا شفافية إطلاقاً)
 *   favicon-32.png        (32×32)
 *   favicon.ico           (ICONDIR + ICONDIRENTRY + PNG 32×32)
 *
 * إعادة التشغيل آمنة (idempotent): لا وقت/عشوائية في المخرجات، فالنتيجة ثابتة بايت-ببايت.
 *   الاستخدام:  node tools/make-icons.mjs
 * ========================================================================== */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/* ------------------------------------------------------------------ مسارات */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT_DIR = join(ROOT, 'assets', 'img');

/* ------------------------------------------------------------------- ألوان */
const BLUE = '#2f6df6';   // أساسي التطبيق (بداية التدرّج)
const DEEP = '#0b1020';   // خلفية التطبيق الليلية (نهاية التدرّج)
const INK = '#ffffff';
const PANEL = '#dbe4fb';
const GOLD = '#f59e0b';
const GOLD_DARK = '#b45309';

/* =============================================================== CRC32 ===== */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ============================================================ PNG writer === */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  if (data.length > 0xffffffff) throw new Error('chunk too large: ' + type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * يبني PNG (RGBA 8-bit) من مصفوفة بايتات.
 * يستخدم مرشّحات PNG (0=None, 1=Sub, 2=Up) ويختار الأصغر لكل سطر — ضغط أفضل بلا مكتبات.
 */
function encodePNG(rgba, width, height) {
  const stride = width * 4;
  if (rgba.length !== stride * height) throw new Error('bad buffer size');
  const raw = Buffer.alloc((stride + 1) * height);
  const cur = Buffer.alloc(stride);
  const prior = Buffer.alloc(stride);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];

  for (let y = 0; y < height; y++) {
    for (let i = 0; i < stride; i++) cur[i] = rgba[y * stride + i];

    cand[0].set(cur); // None
    for (let i = 0; i < stride; i++) cand[1][i] = (cur[i] - (i >= 4 ? cur[i - 4] : 0) + 256) & 0xff; // Sub
    for (let i = 0; i < stride; i++) cand[2][i] = (cur[i] - prior[i] + 256) & 0xff; // Up

    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 3; f++) {
      let s = 0;
      for (let i = 0; i < stride; i++) {
        const v = cand[f][i];
        s += v < 128 ? v : 256 - v;
      }
      if (s < bestScore) { bestScore = s; best = f; }
    }
    const off = y * (stride + 1);
    raw[off] = best;
    cand[best].copy(raw, off + 1);
    prior.set(cur);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type 6 = RGBA
  ihdr[10] = 0; // compression = deflate
  ihdr[11] = 0; // filter = adaptive
  ihdr[12] = 0; // interlace = none

  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO بسيط: رأس 6 بايت + مدخل 16 بايت + بيانات PNG (32×32). */
function encodeICO(png, size) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width  (0 تعني 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0;                      // palette colors
  entry[3] = 0;                      // reserved
  entry.writeUInt16LE(1, 4);         // color planes
  entry.writeUInt16LE(32, 6);        // bits per pixel
  entry.writeUInt32LE(png.length, 8);// size of image data
  entry.writeUInt32LE(6 + 16, 12);   // offset of image data

  return Buffer.concat([dir, entry, png]);
}

/* ============================================================== رسم ====== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/* دوال المسافة الموقّعة (SDF) — بوحدات محلية، تُضرب في معامل المقياس لتصير بكسل */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}
/** تغطية من مسافة بالبكسل: 1 داخل الشكل، 0 خارجه، وتدرّج على عرض aa */
function coverage(dPx, aa) {
  return clamp(0.5 - dPx / aa, 0, 1);
}

/**
 * أنماط الأيقونات:
 *  rounded  : أبعاد المحتوى 70% من الضلع، زوايا دائرية 22%، شفاف خارج الزوايا.
 *  maskable : خلفية كاملة بلا شفافية + الرسم داخل 80% المركزية (آمن للقص الدائري).
 *  apple    : خلفية كاملة بلا شفافية (iOS يقصّها بنفسه).
 *  favicon  : محتوى أكبر قليلاً ليُقرأ في 32 بكسل.
 */
const STYLES = {
  rounded: { rounded: true, cornerRatio: 0.22, contentScale: 0.7, opaque: false },
  maskable: { rounded: false, cornerRatio: 0, contentScale: 0.56, opaque: true },
  apple: { rounded: false, cornerRatio: 0, contentScale: 0.68, opaque: true },
  favicon: { rounded: true, cornerRatio: 0.24, contentScale: 0.76, opaque: false },
};

/**
 * يرسم أيقونة «مصروفي»: تدرّج #2f6df6 ← #0b1020 + محفظة وفيها دينار ذهبي.
 * @returns {Uint8Array} RGBA بطول size*size*4
 */
function renderIcon(size, styleName) {
  const st = STYLES[styleName] || STYLES.rounded;
  const data = new Uint8Array(size * size * 4);
  const c = size / 2;
  const k = (size * st.contentScale) / 2;     // بكسل لكل وحدة محلية
  const radius = size * st.cornerRatio;
  const aa = Math.max(1, size / 220);          // عرض الحواف الملساء
  const A = hexToRgb(BLUE);
  const B = hexToRgb(DEEP);
  const shadow = hexToRgb('#040816');
  const panel = hexToRgb(PANEL);
  const gold = hexToRgb(GOLD);
  const goldDark = hexToRgb(GOLD_DARK);
  const ink = hexToRgb(INK);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      /* تراكم فوق بعضه (premultiplied) */
      let pr = 0, pg = 0, pb = 0, pa = 0;
      const over = (r, g, b, alpha) => {
        if (alpha <= 0) return;
        pr = r * alpha + pr * (1 - alpha);
        pg = g * alpha + pg * (1 - alpha);
        pb = b * alpha + pb * (1 - alpha);
        pa = alpha + pa * (1 - alpha);
      };

      /* 1) الخلفية: تدرّج قطري + وهج خفيف أعلى اليسار */
      const bgCov = st.rounded
        ? coverage(sdRoundRect(px, py, c, c, c, c, radius), aa)
        : 1;
      if (bgCov > 0) {
        const t = clamp((px / size) * 0.55 + (py / size) * 0.45, 0, 1);
        const glow = clamp(1 - Math.hypot(px - size * 0.26, py - size * 0.2) / (size * 0.75), 0, 1);
        const g2 = glow * glow * 0.22;
        const r = clamp(mix(A.r, B.r, t) + 90 * g2, 0, 255);
        const g = clamp(mix(A.g, B.g, t) + 90 * g2, 0, 255);
        const b = clamp(mix(A.b, B.b, t) + 90 * g2, 0, 255);
        over(r, g, b, bgCov);
      }

      /* إحداثيات محلية: u,v ∈ [-1,1] */
      const u = (px - c) / k;
      const v = (py - c) / k;

      /* 2) ظل ناعم تحت المحفظة */
      const dShadow = sdRoundRect(u, v + 0.1, 0, -0.1, 0.94, 0.7, 0.24);
      over(shadow.r, shadow.g, shadow.b, clamp((0.16 - dShadow) / 0.4, 0, 1) * 0.32);

      /* 3) ظهر المحفظة (اللوح الخلفي) */
      const dBack = sdRoundRect(u, v, 0, -0.18, 0.92, 0.68, 0.2);
      over(panel.r, panel.g, panel.b, coverage(dBack * k, aa));

      /* 4) واجهة المحفظة (الطيّة الأمامية) */
      over(ink.r, ink.g, ink.b, coverage(sdRoundRect(u, v, 0, 0.34, 0.92, 0.52, 0.2) * k, aa));

      /* 5) الدينار الذهبي فوق الواجهة: قرص + حلقة داخلية + شرطة (إحساس «د» مبسّط) */
      const dCoin = sdCircle(u, v, -0.48, 0.36, 0.3);
      over(gold.r, gold.g, gold.b, coverage(dCoin * k, aa));
      over(goldDark.r, goldDark.g, goldDark.b,
        coverage((Math.abs(sdCircle(u, v, -0.48, 0.36, 0.2)) - 0.032) * k, aa));
      over(goldDark.r, goldDark.g, goldDark.b,
        coverage(sdRoundRect(u, v, -0.48, 0.4, 0.11, 0.024, 0.024) * k, aa));

      /* 6) إبزيم المحفظة (أزرق) + نقطة بيضاء */
      over(A.r, A.g, A.b, coverage(sdCircle(u, v, 0.6, 0.34, 0.2) * k, aa));
      over(ink.r, ink.g, ink.b, coverage(sdCircle(u, v, 0.6, 0.34, 0.085) * k, aa));

      /* كتابة البكسل: pr/pg/pb مُجمَّعة بسلّم 0..255، و pa بسلّم 0..1 */
      const o = (y * size + x) * 4;
      if (pa <= 0) {
        data[o + 3] = 0;
      } else {
        data[o] = clamp(Math.round(pr / pa), 0, 255);
        data[o + 1] = clamp(Math.round(pg / pa), 0, 255);
        data[o + 2] = clamp(Math.round(pb / pa), 0, 255);
        data[o + 3] = clamp(Math.round(pa * 255), 0, 255);
      }
    }
  }
  return data;
}

/* ============================================================== main ===== */
const TARGETS = [
  { file: 'icon-192.png', size: 192, style: 'rounded' },
  { file: 'icon-512.png', size: 512, style: 'rounded' },
  { file: 'icon-maskable-192.png', size: 192, style: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, style: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, style: 'apple' },
  { file: 'favicon-32.png', size: 32, style: 'favicon' },
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const written = [];
  for (const t of TARGETS) {
    const rgba = renderIcon(t.size, t.style);
    const png = encodePNG(rgba, t.size, t.size);
    const abs = join(OUT_DIR, t.file);
    writeFileSync(abs, png);
    written.push({ file: t.file, size: t.size, bytes: png.length });
  }

  /* favicon.ico = PNG 32×32 داخل حاوية ICO */
  const icoPng = encodePNG(renderIcon(32, 'favicon'), 32, 32);
  const ico = encodeICO(icoPng, 32);
  const icoAbs = join(OUT_DIR, 'favicon.ico');
  writeFileSync(icoAbs, ico);
  written.push({ file: 'favicon.ico', size: 32, bytes: ico.length });

  console.log('مصروفي — توليد الأيقونات في ' + OUT_DIR);
  for (const w of written) {
    const kb = (statSync(join(OUT_DIR, w.file)).size / 1024).toFixed(1);
    console.log('  ✓ ' + w.file.padEnd(26) + String(w.size).padStart(4) + '×' +
      String(w.size).padEnd(5) + kb.padStart(7) + ' KB');
  }
  console.log('تم: ' + written.length + ' ملفاً.');
}

/* يُشغَّل عند الاستدعاء المباشر فقط (node tools/make-icons.mjs) */
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

export { encodePNG, encodeICO, crc32, renderIcon, main };
