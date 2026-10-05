#!/usr/bin/env node
/* =============================================================================
 * مصروفي — tests/_pwa.check.mjs   (ملك pwa-dev)
 * تحقق ذاتي لطبقة PWA بلا أي مكتبة خارجية:
 *   • كل أيقونة: توقيع PNG، IHDR (أبعاد/عمق/نوع لون)، CRC32 لكل مقطع،
 *     فك ضغط IDAT وفحص البكسلات (شفافية/تغطية/ليست فارغة).
 *   • favicon.ico: بنية ICONDIR + ICONDIRENTRY + PNG 32×32 بالداخل.
 *   • manifest.webmanifest: JSON صالح + كل الحقول المطلوبة.
 *   • sw.js: قائمة precache موجودة فعلاً على القرص + مقارنة عكسية مع ملفات
 *     المشروع (كل ملف تشغيل على القرص لازم يكون في القائمة) + الإصدار.
 *   • deploy.yml / .nojekyll / CNAME / assets/img/README.md.
 * التشغيل: node tests/_pwa.check.mjs   (يفشل بـ exit code 1 عند أي FAIL)
 * ========================================================================== */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = (rel) => join(ROOT, rel);

let pass = 0;
let fail = 0;
const warns = [];

function ok(msg) { pass++; console.log('  \u2713 ' + msg); }
function bad(msg) { fail++; console.log('  \u2717 ' + msg); }
function check(cond, msg) { if (cond) ok(msg); else bad(msg); return !!cond; }
function warn(msg) { warns.push(msg); console.log('  ! ' + msg); }
function section(title) { console.log('\n' + title); }

/* ============================================================ CRC32 ======= */
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

/* ======================================================= PNG decoder ===== */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePNG(rel) {
  const buf = readFileSync(P(rel));
  const out = {
    rel, bytes: buf.length, sigOk: false, chunks: [], crcOk: true,
    ihdr: null, idat: [], endsWithIEND: false, fullyParsed: false,
    inflated: null, pixels: null, decodeError: null,
  };
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG)) out.sigOk = true;
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) break;
    const data = buf.subarray(off + 8, off + 8 + len);
    const stored = buf.readUInt32BE(off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== stored) out.crcOk = false;
    out.chunks.push(type);
    if (type === 'IHDR') {
      out.ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], colorType: data[9], compression: data[10],
        filter: data[11], interlace: data[12],
      };
    }
    if (type === 'IDAT') out.idat.push(Buffer.from(data));
    off += 12 + len;
    if (type === 'IEND') { out.endsWithIEND = true; break; }
  }
  out.fullyParsed = off === buf.length;

  if (out.ihdr && out.idat.length) {
    try {
      const raw = inflateSync(Buffer.concat(out.idat));
      out.inflated = raw;
      const w = out.ihdr.width;
      const h = out.ihdr.height;
      const bpp = 4;
      const stride = w * bpp;
      if (raw.length === (stride + 1) * h) {
        const px = Buffer.alloc(stride * h);
        for (let y = 0; y < h; y++) {
          const f = raw[y * (stride + 1)];
          for (let i = 0; i < stride; i++) {
            const x = raw[y * (stride + 1) + 1 + i];
            const a = i >= bpp ? px[y * stride + i - bpp] : 0;
            const b = y > 0 ? px[(y - 1) * stride + i] : 0;
            const c = (i >= bpp && y > 0) ? px[(y - 1) * stride + i - bpp] : 0;
            let v;
            if (f === 0) v = x;
            else if (f === 1) v = x + a;
            else if (f === 2) v = x + b;
            else if (f === 3) v = x + ((a + b) >> 1);
            else {
              const p = a + b - c;
              const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
              v = x + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
            }
            px[y * stride + i] = v & 0xff;
          }
        }
        out.pixels = { w, h, data: px };
      } else {
        out.decodeError = 'حجم IDAT بعد فك الضغط غير مطابق: ' + raw.length + ' ≠ ' + (stride + 1) * h;
      }
    } catch (e) {
      out.decodeError = e.message;
    }
  }
  return out;
}

function pixelAt(pixels, x, y) {
  const o = (y * pixels.w + x) * 4;
  return [pixels.data[o], pixels.data[o + 1], pixels.data[o + 2], pixels.data[o + 3]];
}
function minAlpha(pixels) {
  let m = 255;
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] < m) m = pixels.data[i];
  return m;
}
function distinctColors(pixels) {
  const set = new Set();
  for (let i = 0; i < pixels.data.length; i += 4) {
    set.add((pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2]);
    if (set.size > 400) break;
  }
  return set.size;
}

/* =============================================== 0) صحة صياغة ملفات JS ==== */
section('0) صحة صياغة ملفات JS — نفس بوابة النشر (node --check)');

const jsFiles = [];
(function walkJS(dir) {
  if (!existsSync(P(dir))) return;
  for (const e of readdirSync(P(dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walkJS(rel);
    else if (e.name.endsWith('.js')) jsFiles.push(rel);
  }
})('assets/js');

if (!jsFiles.length) {
  bad('لا توجد ملفات JS تحت assets/js');
} else {
  const { spawnSync } = await import('node:child_process');
  const VM = await import('node:vm');
  let broken = 0;
  for (const f of jsFiles.sort()) {
    let fileOk = true;
    let detail = '';
    try {
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      if (r.error) throw r.error;
      fileOk = r.status === 0;
      if (!fileOk) {
        detail = String(r.stderr || '').split('\n').find((l) => /SyntaxError/.test(l)) || 'node --check فشل';
      }
    } catch (e) {
      /* احتياطي بلا عملية فرعية: تصريف النص كما يفعل node --check */
      try {
        new VM.Script(readFileSync(P(f), 'utf8'), { filename: f });
      } catch (err) {
        fileOk = false;
        detail = err.message;
      }
    }
    if (fileOk) ok(f + ' — صياغته سليمة');
    else { bad(f + ' — خطأ صياغة يمنع تحميل الملف: ' + detail); broken++; }
  }
  check(broken === 0, 'كل ملفات JS التي سيُخزّنها الكاش سليمة (' + jsFiles.length + ' ملفاً)');
}

/* ========================================================== 1) الأيقونات = */
section('1) الأيقونات — PNG حقيقي (توقيع + IHDR + CRC32 + IDAT + IEND + بكسلات)');

const ICONS = [
  { file: 'assets/img/icon-192.png', size: 192, opaque: false },
  { file: 'assets/img/icon-512.png', size: 512, opaque: false },
  { file: 'assets/img/icon-maskable-192.png', size: 192, opaque: true },
  { file: 'assets/img/icon-maskable-512.png', size: 512, opaque: true },
  { file: 'assets/img/apple-touch-icon.png', size: 180, opaque: true },
  { file: 'assets/img/favicon-32.png', size: 32, opaque: false },
];

for (const spec of ICONS) {
  const label = spec.file.replace('assets/img/', '');
  if (!existsSync(P(spec.file))) { bad(label + ' — الملف غير موجود'); continue; }

  const png = parsePNG(spec.file);
  const sizeOk = png.ihdr && png.ihdr.width === spec.size && png.ihdr.height === spec.size;
  const meta = png.ihdr ? png.ihdr.width + '×' + png.ihdr.height : 'بلا IHDR';
  const bytes = (png.bytes / 1024).toFixed(1) + ' KB';

  check(png.sigOk, label + ' — توقيع PNG صحيح (8 بايت)');
  check(!!png.ihdr && sizeOk, label + ' — IHDR أبعاد ' + meta + ' (المطلوب ' + spec.size + '×' + spec.size + ')');
  check(!!png.ihdr && png.ihdr.colorType === 6 && png.ihdr.depth === 8,
    label + ' — نوع اللون 6 (RGBA) وعمق 8 بت');
  check(png.crcOk, label + ' — CRC32 لكل المقاطع صحيح');
  check(png.endsWithIEND && png.fullyParsed && png.chunks[0] === 'IHDR',
    label + ' — ترتيب المقاطع IHDR…IDAT…IEND بلا بايتات زائدة');
  check(!!png.idat.length && !png.decodeError, label + ' — IDAT يُفكّ بـ zlib' + (png.decodeError ? ': ' + png.decodeError : ''));
  check(!!png.pixels, label + ' — البكسلات قابلة للفك (RGBA كامل)');

  if (png.pixels) {
    const px = png.pixels;
    check(distinctColors(px) > 20, label + ' — الصورة ليست فارغة (' + distinctColors(px) + '+ لون)');
    const center = pixelAt(px, px.w >> 1, px.h >> 1);
    check(center[3] === 255, label + ' — مركز الأيقونة معتم (alpha=255)');
    if (spec.opaque) {
      const min = minAlpha(px);
      check(min === 255, label + ' — بلا شفافية إطلاقاً (min alpha=' + min + ')');
    } else {
      const corner = pixelAt(px, 1, 1);
      check(corner[3] === 0, label + ' — الزاوية شفافة (alpha=0)');
    }
    /* المنطقة الآمنة للـ maskable: كل المحتوى داخل 80% المركزية (نصف قطر 0.4×الضلع) */
    if (/maskable/.test(label)) {
      let maxR = 0;
      for (let y = 0; y < px.h; y++) {
        for (let x = 0; x < px.w; x++) {
          const p = pixelAt(px, x, y);
          if (p[0] > 200 && p[1] > 200 && p[2] > 200) {   // جسم المحفظة الفاتح
            const r = Math.hypot(x + 0.5 - px.w / 2, y + 0.5 - px.h / 2);
            if (r > maxR) maxR = r;
          }
        }
      }
      const limit = px.w * 0.4 + 2; // +2 بكسل سماح للحواف الملساء
      check(maxR > 0 && maxR <= limit,
        label + ' — المحتوى داخل 80% المركزية (أقصى بعد ' + maxR.toFixed(1) + ' ≤ ' + limit.toFixed(1) + ' بكسل)');
    }
    /* الطبقة الوسطى: نتحقق أن هناك محتوى فاتح/ذهبي داخل الإطار (لا مجرد تدرّج) */
    let bright = 0;
    for (let i = 0; i < px.data.length; i += 4) {
      if (px.data[i + 3] > 200 && px.data[i] > 240 && px.data[i + 1] > 240 && px.data[i + 2] > 240) bright++;
    }
    check(bright > (px.w * px.h) / 200,
      label + ' — رمز المحفظة مرسوم فعلاً (' + bright + ' بكسل أبيض) — ' + bytes);
  } else {
    bad(label + ' — تعذّر فحص البكسلات');
  }
}

/* ============================================================ 2) favicon.ico */
section('2) favicon.ico — حاوية ICO تحتوي PNG 32×32');

if (!existsSync(P('assets/img/favicon.ico'))) {
  bad('favicon.ico غير موجود');
} else {
  const ico = readFileSync(P('assets/img/favicon.ico'));
  check(ico.length > 30, 'favicon.ico موجود (' + ico.length + ' بايت)');
  check(ico.readUInt16LE(0) === 0, 'ICONDIR.reserved = 0');
  check(ico.readUInt16LE(2) === 1, 'ICONDIR.type = 1 (أيقونة)');
  const count = ico.readUInt16LE(4);
  check(count >= 1, 'ICONDIR.count = ' + count);
  const w = ico[6] === 0 ? 256 : ico[6];
  const h = ico[7] === 0 ? 256 : ico[7];
  check(w === 32 && h === 32, 'ICONDIRENTRY الأبعاد 32×32');
  check(ico.readUInt16LE(10) === 1 && ico.readUInt16LE(12) === 32, 'ICONDIRENTRY planes=1، bitCount=32');
  const imgLen = ico.readUInt32LE(14);
  const imgOff = ico.readUInt32LE(18);
  check(imgOff === 22, 'ICONDIRENTRY إزاحة البيانات = 22');
  check(imgOff + imgLen === ico.length, 'حجم بيانات الصورة مطابق للملف (' + imgLen + ' بايت)');
  const inner = ico.subarray(imgOff, imgOff + imgLen);
  check(inner.subarray(0, 8).equals(PNG_SIG), 'البيانات داخل ICO هي PNG حقيقي');
  if (inner.length > 24) {
    check(inner.readUInt32BE(16) === 32 && inner.readUInt32BE(20) === 32,
      'PNG الداخلي 32×32 (IHDR)');
  }
}

/* ============================================================ 3) manifest = */
section('3) manifest.webmanifest');

const MANIFEST_REQUIRED = {
  name: 'مصروفي', short_name: 'مصروفي', lang: 'ar', dir: 'rtl',
  start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#0b1020', theme_color: '#0b1020',
};
let manifest = null;
if (!existsSync(P('manifest.webmanifest'))) {
  bad('manifest.webmanifest غير موجود');
} else {
  try {
    manifest = JSON.parse(readFileSync(P('manifest.webmanifest'), 'utf8'));
    ok('manifest.webmanifest — JSON صالح');
  } catch (e) {
    bad('manifest.webmanifest — JSON غير صالح: ' + e.message);
  }
}

if (manifest) {
  for (const [key, value] of Object.entries(MANIFEST_REQUIRED)) {
    check(manifest[key] === value, 'الحقل ' + key + ' = ' + JSON.stringify(manifest[key]) +
      (manifest[key] === value ? '' : ' (المطلوب ' + JSON.stringify(value) + ')'));
  }
  check(typeof manifest.description === 'string' && manifest.description.length > 20,
    'وصف عربي موجود: ' + String(manifest.description).slice(0, 40) + '…');
  check(Array.isArray(manifest.categories) && manifest.categories.includes('finance') &&
    manifest.categories.includes('productivity'), 'categories = finance + productivity');

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const has = (size, purpose) => icons.some((i) =>
    i.sizes === size && String(i.purpose || 'any').split(/\s+/).includes(purpose));
  check(has('192x192', 'any'), 'أيقونة 192x192 purpose=any');
  check(has('512x512', 'any'), 'أيقونة 512x512 purpose=any');
  check(has('192x192', 'maskable'), 'أيقونة 192x192 purpose=maskable');
  check(has('512x512', 'maskable'), 'أيقونة 512x512 purpose=maskable');
  check(icons.some((i) => i.src === './assets/img/apple-touch-icon.png'),
    'أيقونة apple-touch-icon ضمن القائمة');
  check(icons.every((i) => typeof i.src === 'string' && i.src.startsWith('./')),
    'كل مسارات الأيقونات نسبية (تبدأ بـ ./)');
  for (const i of icons) {
    const rel = String(i.src || '').replace(/^\.\//, '');
    if (rel && !existsSync(P(rel))) bad('الأيقونة المذكورة في manifest غير موجودة: ' + i.src);
  }

  const shorts = Array.isArray(manifest.shortcuts) ? manifest.shortcuts : [];
  check(shorts.length >= 3, 'عدد الـ shortcuts = ' + shorts.length);
  for (const want of ['#/expenses', '#/income', '#/agent']) {
    check(shorts.some((s) => String(s.url || '').includes(want)), 'اختصار يشير إلى ' + want);
  }
}

/* ================================================================ 4) sw.js */
section('4) sw.js — قائمة precache مقابل القرص');

let precache = [];
let swText = '';
if (!existsSync(P('sw.js'))) {
  bad('sw.js غير موجود');
} else {
  swText = readFileSync(P('sw.js'), 'utf8');
  ok('sw.js موجود');
  const block = swText.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  if (!block) {
    bad('لا أجد قائمة PRECACHE الصريحة في sw.js');
  } else {
    precache = (block[1].match(/["'](\.\/[^"']*)["']/g) || []).map((s) => s.slice(1, -1));
    check(precache.length >= 20, 'قائمة precache صريحة وفيها ' + precache.length + ' مدخلاً');
    check(new Set(precache).size === precache.length, 'قائمة precache بلا تكرار');
  }
  check(/addEventListener\(\s*['"]install['"]/.test(swText), 'يستمع لحدث install');
  check(/addEventListener\(\s*['"]activate['"]/.test(swText), 'يستمع لحدث activate');
  check(/addEventListener\(\s*['"]fetch['"]/.test(swText), 'يستمع لحدث fetch');
  check(/Promise\.allSettled/.test(swText), 'install يستخدم Promise.allSettled (لا يفشل لو غاب ملف)');
  check(/skipWaiting/.test(swText), 'install ينادي skipWaiting');
  check(/clients\.claim/.test(swText), 'activate ينادي clients.claim');
  check(/caches\.delete/.test(swText), 'activate يحذف الكاشات القديمة');
  check(/req\.method\s*!==\s*['"]GET['"]/.test(swText), 'يتجاهل أي طلب ليس GET');
  check(/url\.origin\s*!==\s*self\.location\.origin/.test(swText), 'يتجاهل أي أصل خارجي (DeepSeek وغيره)');
  check(/authorization/i.test(swText), 'لا يخزّن طلبات فيها Authorization');
  check(/stale|revalidat/i.test(swText), 'يوجد مسار stale-while-revalidate للملفات الثابتة');
  check(/networkFirst|network-first/i.test(swText), 'يوجد مسار network-first لهيكل التطبيق');
  check(/mode\s*===\s*['"]navigate['"]/.test(swText), 'يتعامل مع طلبات التنقّل (navigate)');

  /* اسم الكاش لازم يحمل نفس إصدار C.VERSION */
  const constants = existsSync(P('assets/js/constants.js')) ? readFileSync(P('assets/js/constants.js'), 'utf8') : '';
  const vMatch = constants.match(/C\.VERSION\s*=\s*['"]([^'"]+)['"]/);
  const cacheMatch = swText.match(/CACHE\s*=\s*['"]([^'"]+)['"]/);
  if (vMatch && cacheMatch) {
    check(cacheMatch[1].includes(vMatch[1]),
      'اسم الكاش "' + cacheMatch[1] + '" يحمل إصدار constants.js (' + vMatch[1] + ')');
  } else {
    warn('تعذّر استخراج C.VERSION أو CACHE للمقارنة');
  }

  /* (أ) كل مدخل في القائمة موجود فعلاً على القرص */
  const toDisk = (p) => (p === './' ? 'index.html' : p.replace(/^\.\//, ''));
  const missing = precache.filter((p) => !existsSync(P(toDisk(p))));
  check(missing.length === 0,
    'كل ملف في قائمة precache موجود على القرص (' + precache.length + ' مدخلاً)' +
    (missing.length ? ' — مفقود: ' + missing.join(', ') : ''));

  /* (ب) مقارنة عكسية: كل ملف تشغيل على القرص لازم يكون في القائمة */
  const runtimeFiles = new Set(['index.html', 'manifest.webmanifest']);
  const walk = (dir) => {
    if (!existsSync(P(dir))) return;
    for (const e of readdirSync(P(dir), { withFileTypes: true })) {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (!/\.(md|txt)$/i.test(e.name)) runtimeFiles.add(rel);
    }
  };
  walk('assets');
  const listed = new Set(precache.map(toDisk));
  const notListed = [...runtimeFiles].filter((f) => !listed.has(f)).sort();
  check(notListed.length === 0,
    'كل ملفات التشغيل على القرص مذكورة في precache (' + runtimeFiles.size + ' ملفاً)' +
    (notListed.length ? ' — ناقص: ' + notListed.join(', ') : ''));
  const extra = precache.map(toDisk).filter((f) => !runtimeFiles.has(f)).sort();
  check(extra.length === 0, 'لا مدخلات زائدة في precache' + (extra.length ? ': ' + extra.join(', ') : ''));
}

/* ====================================================== 5) النشر والملفات */
section('5) النشر على GitHub Pages');

const DEPLOY = '.github/workflows/deploy.yml';
if (!existsSync(P(DEPLOY))) {
  bad(DEPLOY + ' غير موجود');
} else {
  const y = readFileSync(P(DEPLOY), 'utf8');
  ok('workflow النشر موجود');
  check(/actions\/checkout@v4/.test(y), 'actions/checkout@v4');
  check(/actions\/configure-pages@v5/.test(y), 'actions/configure-pages@v5');
  check(/actions\/upload-pages-artifact@v3/.test(y), 'actions/upload-pages-artifact@v3');
  check(/actions\/deploy-pages@v4/.test(y), 'actions/deploy-pages@v4');
  check(/path:\s*['"]?\.['"]?\s*($|\n)/m.test(y), "upload-pages-artifact path: '.' (المجلد الجذر)");
  check(/pages:\s*write/.test(y) && /id-token:\s*write/.test(y), 'permissions: pages: write + id-token: write');
  check(/branches:\s*\[?\s*main/.test(y), 'يشغَّل على push إلى main');
  check(/workflow_dispatch/.test(y), 'يدعم workflow_dispatch');
  check(/--check/.test(y) && /readdirSync/.test(y), 'خطوة تحقق node --check لكل ملفات JS');
  check(/deploy-pages/.test(y) && /needs:/.test(y), 'وظيفة النشر تعتمد على وظيفة الفحص');

  /* فحص بنية YAML مبسّط (لا محلّل YAML في node بلا مكتبات):
     لا TAB + كل block scalar (run: |) بإزاحة متسقة وغير فارغ. */
  const yLines = y.split(/\r?\n/);
  check(yLines.every((l) => !l.includes('\t')), 'deploy.yml بلا أي TAB (خطره كسر YAML)');
  let yamlIssues = 0;
  let blocks = 0;
  for (let i = 0; i < yLines.length; i++) {
    if (!/:\s*\|-?\s*$/.test(yLines[i])) continue;
    blocks++;
    const keyIndent = yLines[i].match(/^\s*/)[0].length;
    let first = -1;
    for (let j = i + 1; j < yLines.length; j++) {
      if (yLines[j].trim() === '') continue;
      const ind = yLines[j].match(/^\s*/)[0].length;
      if (ind <= keyIndent) break;
      if (first < 0) first = ind;
      else if (ind < first) { yamlIssues++; break; }
    }
    if (first < 0) yamlIssues++;
  }
  check(blocks > 0 && yamlIssues === 0,
    'كتل shell في deploy.yml (' + blocks + ') بإزاحة متسقة وغير فارغة');
}

check(existsSync(P('.nojekyll')), '.nojekyll موجود');
if (existsSync(P('.nojekyll'))) {
  check(statSync(P('.nojekyll')).size === 0, '.nojekyll فارغ (0 بايت)');
}

if (!existsSync(P('CNAME'))) {
  bad('CNAME غير موجود');
} else {
  const cname = readFileSync(P('CNAME'), 'utf8').trim();
  if (cname.startsWith('#')) {
    check(true, 'CNAME موجود — ما زال placeholder بانتظار دومين المستخدم');
    warn('CNAME ما زال placeholder: «' + cname + '» — يجب على المستخدم استبداله بدومينه الحقيقي (سطر واحد، مثال: masrofi.org)');
  } else {
    check(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cname), 'CNAME يحمل دوميناً صالحاً: ' + cname);
  }
}

check(existsSync(P('assets/img/README.md')), 'assets/img/README.md موجود (توثيق الأيقونات والتثبيت)');

/* ================================================== 6) اختبار سلوكي للـ SW */
section('6) sw.js — اختبار سلوكي حقيقي (install / activate / fetch) في بيئة وهمية');

async function swBehaviorTest() {
  const VM = await import('node:vm');
  const SW_URL = 'https://user.github.io/safe/sw.js';
  const SCOPE = 'https://user.github.io/safe/';
  const sources = new Map();       // url → نص الرد (يُتحكَّم به لكل اختبار)
  const fail = new Set();          // urls تفشل شبكياً
  const stores = new Map();        // اسم الكاش → Map(url → Response)
  const net = { calls: [] };

  const keyOf = (req) => (typeof req === 'string' ? new URL(req, SW_URL).href : req.url);

  const cachesImpl = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async add(req) {
          const res = await fetchStub(req);
          if (!res || !res.ok) throw new TypeError('add: bad response');
          store.set(keyOf(req), res);
        },
        async put(req, res) { store.set(keyOf(req), res); },
        async match(req, opts) {
          const k = keyOf(req);
          if (store.has(k)) return store.get(k).clone();
          if (opts && opts.ignoreSearch) {
            const bare = k.split('?')[0];
            for (const [kk, v] of store) if (kk.split('?')[0] === bare) return v.clone();
          }
          return undefined;
        },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };

  async function fetchStub(req) {
    const url = keyOf(req);
    net.calls.push(url);
    if (fail.has(url)) throw new TypeError('Failed to fetch');
    const body = sources.has(url) ? sources.get(url) : 'body:' + url;
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const env = { skipWaiting: 0, claim: 0, warns: [], handlers: {} };
  const selfObj = {
    location: new URL(SW_URL),
    skipWaiting() { env.skipWaiting++; return Promise.resolve(); },
    clients: { claim() { env.claim++; return Promise.resolve(); } },
    addEventListener(type, fn) { (env.handlers[type] = env.handlers[type] || []).push(fn); },
    registration: { scope: SCOPE },
  };

  const sandbox = {
    self: selfObj, caches: cachesImpl, fetch: fetchStub,
    Response, Request, Headers, URL,
    console: { warn: (m) => env.warns.push(String(m)), log() {}, error() {} },
  };
  VM.runInNewContext(readFileSync(P('sw.js'), 'utf8'), sandbox, { filename: 'sw.js' });

  const dispatch = (type, request) => {
    const event = {
      request, waits: [], response: null, respondWithCalled: false,
      waitUntil(p) { this.waits.push(Promise.resolve(p)); },
      respondWith(p) { this.respondWithCalled = true; this.response = Promise.resolve(p); },
    };
    for (const fn of env.handlers[type] || []) fn(event);
    return event;
  };
  const settle = async (event) => { await Promise.all(event.waits); };

  const CACHE_NAME = (swText.match(/CACHE\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  const precacheUrls = precache.map((p) => new URL(p, SW_URL).href);

  /* --- install --- */
  /* نفشّل ملفاً واحداً عمداً للتأكد أن install لا يفشل (Promise.allSettled) */
  const missingUrl = new URL('./assets/js/views/settings.js', SW_URL).href;
  fail.add(missingUrl);
  const installEvent = dispatch('install', null);
  await settle(installEvent);
  const store = stores.get(CACHE_NAME) || new Map();
  check(store.size === precacheUrls.length - 1,
    'install خزّن ' + store.size + '/' + precacheUrls.length + ' ملفاً وتجاوز المفقود بلا فشل');
  check(env.warns.some((w) => w.includes('settings.js')),
    'install سجّل تحذيراً بالملف المفقود بدل الفشل');
  check(env.skipWaiting === 1, 'install نادى skipWaiting');
  check([...store.keys()].every((u) => u.startsWith(SCOPE)),
    'كل مفاتيح الكاش تحت نطاق التطبيق (تعمل تحت مسار فرعي)');

  /* --- activate --- */
  await cachesImpl.open('masrofi-v0.9.0-old');
  await cachesImpl.open('some-other-app');
  const activateEvent = dispatch('activate', null);
  await settle(activateEvent);
  const keysAfter = await cachesImpl.keys();
  check(keysAfter.length === 1 && keysAfter[0] === CACHE_NAME,
    'activate حذف الكاشات القديمة وأبقى "' + CACHE_NAME + '" فقط');
  check(env.claim === 1, 'activate نادى clients.claim');

  /* --- fetch: الطلبات التي يجب ألا يتدخّل فيها --- */
  const notHandled = (label, request) => {
    const e = dispatch('fetch', request);
    check(!e.respondWithCalled, label);
  };
  notHandled('fetch: طلب POST لا يتدخّل فيه',
    { method: 'POST', url: SCOPE + 'assets/js/app.js', mode: 'cors', headers: new Headers() });
  notHandled('fetch: أصل خارجي (api.deepseek.com) يمرّ للشبكة',
    { method: 'GET', url: 'https://api.deepseek.com/v1/chat/completions', mode: 'cors', headers: new Headers() });
  notHandled('fetch: طلب فيه Authorization لا يُخزَّن ولا يُتدخَّل فيه',
    { method: 'GET', url: SCOPE + 'api/secret', mode: 'cors', headers: new Headers({ authorization: 'Bearer sk-test' }) });
  notHandled('fetch: sw.js نفسه لا يمرّ عبر الكاش',
    { method: 'GET', url: SW_URL, mode: 'cors', headers: new Headers() });
  check(!stores.get(CACHE_NAME).has(SCOPE + 'api/secret'),
    'رد الـ API المحمي لم يُخزَّن في الكاش');

  /* --- fetch: ملف ثابت جديد (stale-while-revalidate) --- */
  const assetUrl = SCOPE + 'assets/css/extra.css';
  sources.set(assetUrl, 'css-v1');
  let e = dispatch('fetch', { method: 'GET', url: assetUrl, mode: 'cors', headers: new Headers() });
  check(e.respondWithCalled, 'fetch: ملف assets يُخدَم عبر Service Worker');
  let res = await e.response;
  await settle(e);
  check(res && (await res.text()) === 'css-v1', 'fetch: أول طلب لملف ثابت يعود من الشبكة');
  await new Promise((r) => setTimeout(r, 10));
  check(stores.get(CACHE_NAME).has(assetUrl), 'fetch: الملف الثابت خُزّن في الكاش');

  sources.set(assetUrl, 'css-v2');
  fail.add(assetUrl);
  e = dispatch('fetch', { method: 'GET', url: assetUrl, mode: 'cors', headers: new Headers() });
  res = await e.response;
  await settle(e);
  check(res && (await res.text()) === 'css-v1',
    'fetch: عند انقطاع الشبكة يخدم الكاش (stale) بدل الفشل');

  /* --- fetch: التنقّل (app shell) --- */
  const deepUrl = SCOPE + 'deep/link';
  sources.set(deepUrl, 'fresh-page');
  e = dispatch('fetch', { method: 'GET', url: deepUrl, mode: 'navigate', headers: new Headers() });
  res = await e.response;
  await settle(e);
  check(res && (await res.text()) === 'fresh-page', 'fetch: التنقّل مع شبكة سليمة → network-first');

  /* انقطاع الشبكة بعد تنقّل ناجح → يخدم نسخة الكاش لنفس الرابط (network-first → cache) */
  fail.add(deepUrl);
  e = dispatch('fetch', { method: 'GET', url: deepUrl, mode: 'navigate', headers: new Headers() });
  res = await e.response;
  await settle(e);
  check(res.status === 200 && (await res.text()) === 'fresh-page',
    'fetch: التنقّل بلا شبكة لرابط زاره المستخدم → نسخة الكاش');

  /* انقطاع الشبكة لرابط لم يُخزَّن قط → يرجع لهيكل التطبيق index.html */
  const deepNever = SCOPE + 'deep/never-seen';
  fail.add(deepNever);
  e = dispatch('fetch', { method: 'GET', url: deepNever, mode: 'navigate', headers: new Headers() });
  res = await e.response;
  await settle(e);
  const shellBody = await res.text();
  check(res.status === 200 && shellBody === 'body:' + SCOPE + 'index.html',
    'fetch: التنقّل بلا شبكة لرابط جديد → index.html من الكاش (app shell)');

  /* --- fetch: ملف غير مخزَّن بلا شبكة → رد أوفلاين لا انهيار --- */
  const unknown = SCOPE + 'assets/img/not-there.png';
  fail.add(unknown);
  e = dispatch('fetch', { method: 'GET', url: unknown, mode: 'cors', headers: new Headers() });
  res = await e.response;
  await settle(e);
  check(res.status >= 500, 'fetch: ملف غير مخزَّن بلا شبكة → رد أوفلاين (' + res.status + ') بلا استثناء');
}

if (typeof Response !== 'function' || typeof Request !== 'function' || typeof Headers !== 'function') {
  warn('node الحالي بلا Fetch API عالمي — تخطّي الاختبار السلوكي للـ Service Worker');
} else {
  try {
    await swBehaviorTest();
  } catch (err) {
    bad('الاختبار السلوكي للـ Service Worker انهار: ' + (err && err.message));
  }
}

/* ==================================== 7) محاكاة النشر تحت مسار فرعي (HTTP) */
section('7) محاكاة GitHub Pages تحت مسار فرعي — كل رابط يُخدَم فعلاً (200)');

async function httpSubpathTest() {
  const http = await import('node:http');
  const BASE_PATH = '/safe/';           // مثل user.github.io/safe/
  const TYPES = {
    html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8', json: 'application/json',
    webmanifest: 'application/manifest+json', png: 'image/png',
    ico: 'image/x-icon', svg: 'image/svg+xml', md: 'text/markdown; charset=utf-8',
  };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(String(req.url).split('?')[0].split('#')[0]);
    if (!p.startsWith(BASE_PATH)) { res.writeHead(404); res.end('outside base'); return; }
    p = p.slice(BASE_PATH.length);
    if (p === '' || p.endsWith('/')) p += 'index.html';
    const file = P(p);
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    const ext = p.split('.').pop().toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + BASE_PATH;

  try {
    /* كل مدخل في precache */
    const failed = [];
    for (const entry of precache) {
      const url = new URL(entry, base).href;
      const r = await fetch(url).catch(() => null);
      if (!r || r.status !== 200) failed.push(entry + ' → ' + (r ? r.status : 'شبكة'));
    }
    check(failed.length === 0,
      'كل مدخلات precache تُخدَم بـ 200 تحت مسار فرعي (' + precache.length + ' رابطاً)' +
      (failed.length ? ' — فشل: ' + failed.join(', ') : ''));

    /* كل مرجع نسبي داخل index.html (href/src) */
    const html = readFileSync(P('index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:href|src)\s*=\s*["'](\.\/[^"'#]+)["']/g)].map((m) => m[1]);
    const refFail = [];
    for (const ref of [...new Set(refs)]) {
      const r = await fetch(new URL(ref, base).href).catch(() => null);
      if (!r || r.status !== 200) refFail.push(ref + ' → ' + (r ? r.status : 'شبكة'));
    }
    check(refFail.length === 0,
      'كل مرجع نسبي في index.html موجود (' + new Set(refs).size + ' مرجعاً: سكربتات/أنماط/أيقونات)' +
      (refFail.length ? ' — فشل: ' + refFail.join(', ') : ''));

    /* الـ manifest نفسه عبر HTTP */
    const mres = await fetch(base + 'manifest.webmanifest');
    check(mres.status === 200, 'manifest.webmanifest يُخدَم بـ 200');
    const mjson = await mres.json().catch(() => null);
    check(!!mjson && mjson.name === 'مصروفي', 'المتصفح سيقرأ manifest كـ JSON صالح');
    const iconFail = [];
    for (const icon of (mjson && mjson.icons) || []) {
      const r = await fetch(new URL(icon.src, base).href).catch(() => null);
      if (!r || r.status !== 200) iconFail.push(icon.src);
    }
    check(iconFail.length === 0, 'كل أيقونات manifest تُحمَّل فعلاً (' + ((mjson && mjson.icons) || []).length + ' أيقونات)');

    /* sw.js يُخدَم من الجذر ليعمل نطاقه على كل الموقع */
    const sres = await fetch(base + 'sw.js');
    check(sres.status === 200 && /PRECACHE/.test(await sres.text()),
      'sw.js يُخدَم من جذر النطاق (scope = كل الموقع تحت المسار الفرعي)');
  } finally {
    await new Promise((r) => server.close(r));
  }
}

if (typeof fetch !== 'function') {
  warn('node الحالي بلا fetch عالمي — تخطّي محاكاة النشر عبر HTTP');
} else {
  try {
    await httpSubpathTest();
  } catch (err) {
    bad('محاكاة النشر عبر HTTP انهارت: ' + (err && err.message));
  }
}

/* ================================================================ الحصيلة */
console.log('\n' + '─'.repeat(62));
if (warns.length) {
  console.log('تنبيهات (' + warns.length + '):');
  for (const w of warns) console.log('  ! ' + w);
}
console.log(fail === 0
  ? 'PASS — ' + pass + ' فحصاً ناجحاً، صفر فشل' + (warns.length ? '، ' + warns.length + ' تنبيه' : '')
  : 'FAIL — ' + fail + ' فشل من ' + (pass + fail) + ' فحصاً');
if (fail) process.exitCode = 1;
