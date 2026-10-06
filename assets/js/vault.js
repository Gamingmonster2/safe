/* =============================================================================
 * مصروفي — vault.js
 * الخزنة المشفّرة: PBKDF2-SHA256 (310,000 دورة) + AES-GCM-256 + TOTP (RFC 6238).
 *
 * الغاية: بيانات المستخدم في localStorage تبقى **بايتات عشوائية** لأي زائر يفتح
 * أدوات المتصفح. لا يوجد خادم، فلا يوجد «تسجيل دخول» — الحماية كلها تشفير.
 *
 * ---------------------------------------------------------------------------
 * اشتقاق المفاتيح (القرار الموثَّق — انظر الملاحظة الأمنية أسفل):
 *
 *   KEK_pw   = PBKDF2-SHA256(password, salt, 310000)            // عامل كلمة السر
 *   verifier = HMAC-SHA256(KEK_pw, 'masrofi-verify')            // تحقق سريع من كلمة السر
 *
 *   إن كان 2FA مفعّلاً:
 *     secret  = سرّ TOTP (base32) — يُخزَّن **مشفّراً** AES-GCM تحت KEK_pw
 *     KEK     = HMAC-SHA256(KEK_pw, 'masrofi-kek' || 0x00 || secretBytes)
 *   وإلا:
 *     KEK     = KEK_pw
 *
 *   MK  = 32 بايت عشوائي (المفتاح الرئيسي) — يُلفّ بـ AES-GCM تحت KEK
 *   data= AES-GCM(MK, JSON(state))
 *
 * لماذا لم أستعمل حرفياً `PBKDF2(password + '\0' + code, salt, iter)` الموصى به؟
 *   لأن `code` رمز **زمني** يتغيّر كل 30 ثانية: أي مفتاح ملفوف يعتمد عليه يصبح
 *   غير قابل للفك بعد انتهاء نافذته، فيُقفل المستخدم خارج خزنته نهائياً (لا خادم
 *   ولا استعادة). لذلك يُدمج **سرّ TOTP الثابت** في اشتقاق KEK (فلا يكفي الملف
 *   وحده ولا كلمة السر وحدها لاشتقاق مفتاح الالتفاف)، ويُتحقَّق من الرمز الزمني
 *   كبوّابة إلزامية بنافذة ±1 فترة قبل فكّ التغليف — على نمط توثيق RFC 6238 §5.2.
 *
 * ملاحظة أمنية صريحة: في تطبيق ثابت بلا خادم، سرّ TOTP لازم ليتحقق العميل من
 *   الرمز، وهو مخزَّن هنا **مشفّراً** بكلمة السر (لا نصاً صريحاً) — أفضل ما يمكن.
 *   من يملك الملف + كلمة السر يستطيع دوماً تجربة الرمز محلياً؛ الثنائية تحمي
 *   أساساً من يعرف كلمة السر دون الجهاز/الملف. هذا قيد بنيوي لا يُصلحه كود العميل.
 *
 * ---------------------------------------------------------------------------
 * قواعد ملزمة (docs/AUTH.md §2):
 *   • salt و iv عشوائيان جديدان لكل عملية (crypto.getRandomValues).
 *   • MK/KEK لا يُكتبان ولا يُطبعان في أي مكان؛ MK يبقى CryptoKey غير قابل للتصدير.
 *   • عند فشل الفك لا تُمس الخزنة ولا البيانات — خطأ فقط.
 *   • لا innerHTML/eval/document.write/مكتبات خارجية، ولا طبع أسرار.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};

  /* --------------------------------------------------------------- ثوابت */
  var VERSION = 1;
  var KEY_VAULT = 'masrofi.vault.v1';   // الخزنة (كل الأسرار مشفّرة)
  var KEY_META = 'masrofi.vault.meta';  // ميتا وصفية بلا أسرار
  var KEY_LEGACY = 'finapp.v1';         // النسخة القديمة غير المشفّرة (لا نلمسها هنا)
  var KEY_LOCK = 'masrofi.vault.lockout'; // عدّاد المحاولات — sessionStorage فقط

  var KDF_NAME = 'PBKDF2-SHA256';
  var ITER = 310000;
  var SALT_LEN = 16;
  var IV_LEN = 12;
  var MK_LEN = 32;
  var TAG_BITS = 128;
  var VERIFY_MSG = 'masrofi-verify';
  var KEK_INFO = 'masrofi-kek';

  var MIN_PW = 8;
  var MAX_FAILS = 5;
  var LOCK_MS = 30000;        // تعطيل مؤقت بعد 5 محاولات
  var FAIL_WINDOW_MS = 300000; // نافذة عدّ المحاولات

  var TOTP_ALGO = 'SHA-1';
  var TOTP_DIGITS = 6;
  var TOTP_PERIOD = 30;
  var TOTP_SECRET_LEN = 20;   // 20 بايت = 160 بت (المعيار)
  var MIN_TOTP_SECRET_BYTES = 16; // أدنى سرّ مقبول من الخارج (128 بت — RFC 4226 §4 R6)
  var TOTP_WINDOW = 1;

  var ISSUER = 'مصروفي';
  var B32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var B64_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  /* ------------------------------------------------------- حالة الذاكرة فقط */
  var _mk = null;      // CryptoKey للمفتاح الرئيسي (extractable:false)
  var _lockedAt = 0;   // آخر قفل (للتشخيص فقط)

  /* ==========================================================================
   * 1) تخزين محلي آمن الاستدعاء (قد يكون معطّلاً في وضع التصفح الخاص)
   * ======================================================================== */
  function storeOf(kind) {
    try {
      var s = root[kind];
      if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') return s;
    } catch (e) { /* وصول ممنوع */ }
    return null;
  }
  function lsGet(k) {
    var s = storeOf('localStorage');
    if (!s) return null;
    try { return s.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    var s = storeOf('localStorage');
    if (!s) throw new Error('no-storage');
    s.setItem(k, v);
  }
  function lsDel(k) {
    var s = storeOf('localStorage');
    if (!s) return;
    try { s.removeItem(k); } catch (e) { /* تجاهل */ }
  }
  function hasLS() { return !!storeOf('localStorage'); }

  function readJSON(key) {
    var raw = lsGet(key);
    if (!raw) return null;
    try {
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) { return null; }
  }
  function readVault() { return readJSON(KEY_VAULT); }
  function readMeta() { return readJSON(KEY_META); }
  function writeVault(v) { lsSet(KEY_VAULT, JSON.stringify(v)); }
  function writeMeta(m) { lsSet(KEY_META, JSON.stringify(m)); }

  /* ==========================================================================
   * 2) أدوات بايتات/نص/base64/base32 (بلا أي مكتبة)
   * ======================================================================== */
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(str));
    var s = unescape(encodeURIComponent(String(str)));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  function utf8d(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }
  function toBytes(v) {
    if (v === null || v === undefined) return new Uint8Array(0);
    if (v instanceof Uint8Array) return v;
    if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return new Uint8Array(v);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(v)) {
      return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    }
    if (Array.isArray(v)) return new Uint8Array(v);
    if (typeof v === 'string') return utf8(v);
    return new Uint8Array(0);
  }
  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  }
  function zero(bytes) { if (bytes && bytes.fill) bytes.fill(0); }

  function b64(v) {
    var bytes = toBytes(v), out = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = (i + 1 < bytes.length) ? bytes[i + 1] : 0;
      var b2 = (i + 2 < bytes.length) ? bytes[i + 2] : 0;
      out += B64_ALPHA.charAt(b0 >> 2);
      out += B64_ALPHA.charAt(((b0 & 3) << 4) | (b1 >> 4));
      out += (i + 1 < bytes.length) ? B64_ALPHA.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '=';
      out += (i + 2 < bytes.length) ? B64_ALPHA.charAt(b2 & 63) : '=';
    }
    return out;
  }
  function b64d(text) {
    var s = String(text === null || text === undefined ? '' : text).replace(/[\s=]/g, '')
      .replace(/-/g, '+').replace(/_/g, '/');
    var out = [], bits = 0, value = 0, i;
    for (i = 0; i < s.length; i++) {
      var idx = B64_ALPHA.indexOf(s.charAt(i));
      if (idx < 0) continue; // نتجاهل أي محرف غريب بدل الانفجار
      value = (value << 6) | idx; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff); }
    }
    return new Uint8Array(out);
  }
  function b32encode(bytes) {
    var out = '', bits = 0, value = 0, i;
    for (i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { bits -= 5; out += B32_ALPHA.charAt((value >>> bits) & 31); }
    }
    if (bits > 0) out += B32_ALPHA.charAt((value << (5 - bits)) & 31);
    return out;
  }
  function b32decode(text) {
    var s = String(text || '').toUpperCase().replace(/[\s=\-]/g, '');
    var out = [], bits = 0, value = 0, i;
    for (i = 0; i < s.length; i++) {
      var idx = B32_ALPHA.indexOf(s.charAt(i));
      if (idx < 0) throw new Error('bad-base32');
      value = (value << 5) | idx; bits += 5;
      if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff); }
    }
    return new Uint8Array(out);
  }

  // تطبيع الرمز: يقبل الأرقام العربية-الهندية (٠١٢…) والفارسية (۰۱۲…) والمسافات
  function normalizeCode(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/\D/g, '');
  }

  function constantTimeEqual(a, b) {
    var x = toBytes(a), y = toBytes(b);
    if (x.length !== y.length || x.length === 0) return false;
    var diff = 0;
    for (var i = 0; i < x.length; i++) diff |= (x[i] ^ y[i]);
    return diff === 0;
  }

  /* ==========================================================================
   * 3) Web Crypto (غير متزامن — لا استعمال متزامن إطلاقاً)
   * ======================================================================== */
  function webCrypto() {
    var c = root.crypto;
    return (c && c.subtle) ? c : null;
  }
  function subtle() {
    var c = webCrypto();
    return c ? c.subtle : null;
  }
  function random(n) {
    var c = webCrypto();
    if (!c || typeof c.getRandomValues !== 'function') throw new Error('no-rng');
    var bytes = new Uint8Array(n);
    c.getRandomValues(bytes);
    return bytes;
  }

  function pbkdf2(password, salt, iterations) {
    var st = subtle();
    return st.importKey('raw', utf8(password), { name: 'PBKDF2' }, false, ['deriveBits'])
      .then(function (key) {
        return st.deriveBits({
          name: 'PBKDF2', salt: toBytes(salt), iterations: iterations, hash: 'SHA-256'
        }, key, 256);
      })
      .then(function (bits) { return new Uint8Array(bits); });
  }

  function hmac256(keyBytes, msgBytes) {
    var st = subtle();
    return st.importKey('raw', toBytes(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (key) { return st.sign({ name: 'HMAC' }, key, toBytes(msgBytes)); })
      .then(function (sig) { return new Uint8Array(sig); });
  }

  function aesKey(bytes, usages) {
    return subtle().importKey('raw', toBytes(bytes), { name: 'AES-GCM' }, false, usages);
  }
  function aesEncrypt(key, bytes) {
    var iv = random(IV_LEN); // IV جديد لكل عملية — إلزامي مع GCM
    return subtle().encrypt({ name: 'AES-GCM', iv: iv, tagLength: TAG_BITS }, key, toBytes(bytes))
      .then(function (ct) { return { iv: b64(iv), ct: b64(new Uint8Array(ct)) }; });
  }
  function aesDecrypt(key, ivB64, ctB64) {
    return subtle().decrypt({ name: 'AES-GCM', iv: b64d(ivB64), tagLength: TAG_BITS }, key, b64d(ctB64))
      .then(function (pt) { return new Uint8Array(pt); });
  }

  /* ==========================================================================
   * 4) TOTP — RFC 6238 (HMAC-SHA1، 6 أرقام، 30 ثانية) بتنفيذ متزامن
   *    متزامن لأن العقد يطلب code() ترجع نصاً مباشرة (والشاشة تحتاج عدّاداً).
   * ======================================================================== */
  function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

  function sha1(bytes) {
    var ml = bytes.length;
    var total = (((ml + 8) >> 6) + 1) << 6;
    var buf = new Uint8Array(total);
    buf.set(bytes, 0);
    buf[ml] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(ml / 536870912));
    dv.setUint32(total - 4, (ml * 8) >>> 0);

    var h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    var w = new Uint32Array(80);
    for (var i = 0; i < total; i += 64) {
      var j;
      for (j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
      for (j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
      for (j = 0; j < 80; j++) {
        var f, k;
        if (j < 20) { f = (b & c) | ((~b) & d); k = 0x5a827999; }
        else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        var tmp = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
        e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0;
      h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
    }
    var out = new Uint8Array(20);
    var odv = new DataView(out.buffer);
    for (i = 0; i < 5; i++) odv.setUint32(i * 4, h[i]);
    return out;
  }

  function hmacSha1(keyBytes, msgBytes) {
    var key = toBytes(keyBytes);
    if (key.length > 64) key = sha1(key);
    var block = new Uint8Array(64);
    block.set(key, 0);
    var ipad = new Uint8Array(64), opad = new Uint8Array(64);
    for (var i = 0; i < 64; i++) {
      ipad[i] = block[i] ^ 0x36;
      opad[i] = block[i] ^ 0x5c;
    }
    var inner = sha1(concatBytes(ipad, toBytes(msgBytes)));
    return sha1(concatBytes(opad, inner));
  }

  function atMs(at) {
    if (at === undefined || at === null) return Date.now();
    if (at instanceof Date) return at.getTime();
    if (typeof at === 'number' && isFinite(at)) return at; // مللي ثانية (حسب العقد)
    var t = Date.parse(String(at));
    return isFinite(t) ? t : Date.now();
  }
  function periodOf(p) { var v = Number(p); return (isFinite(v) && v > 0) ? Math.floor(v) : TOTP_PERIOD; }
  function digitsOf(d) { var v = Number(d); return (isFinite(v) && v >= 4 && v <= 10) ? Math.floor(v) : TOTP_DIGITS; }

  function totpCode(secret, opts) {
    opts = opts || {};
    var period = periodOf(opts.period);
    var digits = digitsOf(opts.digits);
    var counter = Math.floor(Math.floor(atMs(opts.at) / 1000) / period);
    var msg = new Uint8Array(8);
    var dv = new DataView(msg.buffer);
    dv.setUint32(0, Math.floor(counter / 4294967296));
    dv.setUint32(4, counter >>> 0);
    var mac = hmacSha1(b32decode(secret), msg);
    var off = mac[19] & 0x0f;
    var bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    var out = String(bin % Math.pow(10, digits));
    while (out.length < digits) out = '0' + out;
    return out;
  }

  function totpVerify(secret, code, opts) {
    var win = TOTP_WINDOW, at = null, period = TOTP_PERIOD, digits = TOTP_DIGITS;
    if (typeof opts === 'number') win = opts;
    else if (opts && typeof opts === 'object') {
      if (opts.window !== undefined) win = Number(opts.window);
      if (opts.period !== undefined) period = periodOf(opts.period);
      if (opts.digits !== undefined) digits = digitsOf(opts.digits);
      if (opts.at !== undefined) at = opts.at;
    }
    if (!isFinite(win) || win < 0) win = TOTP_WINDOW;
    win = Math.floor(win);
    var given = normalizeCode(code);
    if (given.length !== digits) return false;
    var base = atMs(at);
    var ok = false;
    for (var k = -win; k <= win; k++) {
      var expected;
      try { expected = totpCode(secret, { period: period, digits: digits, at: base + k * period * 1000 }); }
      catch (e) { return false; }
      // مقارنة ثابتة الزمن
      if (constantTimeEqual(utf8(expected), utf8(given))) ok = true;
    }
    return ok;
  }

  function generateSecret() {
    return b32encode(random(TOTP_SECRET_LEN));
  }

  function remainingSeconds(opts) {
    opts = opts || {};
    var period = periodOf(opts.period);
    var secs = Math.floor(atMs(opts.at) / 1000);
    var left = period - (secs % period);
    return left === 0 ? period : left;
  }

  function otpauthURI(opts) {
    opts = opts || {};
    var issuer = opts.issuer ? String(opts.issuer) : ISSUER;
    var label = issuer + ':' + String(opts.username || '');
    var qs = 'secret=' + encodeURIComponent(String(opts.secret || '')) +
      '&issuer=' + encodeURIComponent(issuer) +
      '&algorithm=' + String(opts.algo || TOTP_ALGO).replace('-', '') +
      '&digits=' + digitsOf(opts.digits) +
      '&period=' + periodOf(opts.period);
    return 'otpauth://totp/' + encodeURIComponent(label) + '?' + qs;
  }

  var totp = {
    generateSecret: generateSecret,
    code: totpCode,
    verify: totpVerify,
    otpauthURI: otpauthURI,
    remainingSeconds: remainingSeconds
  };

  /* ==========================================================================
   * 5) عدّاد المحاولات (sessionStorage فقط — لا يمسّ الخزنة)
   * ======================================================================== */
  function readLock() {
    var s = storeOf('sessionStorage');
    if (!s) return null;
    try {
      var o = JSON.parse(s.getItem(KEY_LOCK) || 'null');
      return (o && typeof o === 'object') ? o : null;
    } catch (e) { return null; }
  }
  function writeLock(o) {
    var s = storeOf('sessionStorage');
    if (!s) return;
    try {
      if (o) s.setItem(KEY_LOCK, JSON.stringify(o));
      else s.removeItem(KEY_LOCK);
    } catch (e) { /* تجاهل */ }
  }
  function lockRemainingMs() {
    var o = readLock();
    if (!o || !o.until) return 0;
    var left = Number(o.until) - Date.now();
    return left > 0 ? left : 0;
  }
  function registerFailure() {
    var now = Date.now();
    var o = readLock();
    if (!o || !o.first || (now - Number(o.first)) > FAIL_WINDOW_MS) o = { n: 0, first: now, until: 0 };
    o.n = Number(o.n || 0) + 1;
    if (o.n >= MAX_FAILS) o.until = now + LOCK_MS;
    writeLock(o);
    return o;
  }
  function clearFailures() { writeLock(null); }

  /* ==========================================================================
   * 6) اشتقاق/لفّ المفاتيح
   * ======================================================================== */
  function iterOf(vault) {
    var v = Number(vault && vault.iter);
    return (isFinite(v) && v >= 100000) ? Math.floor(v) : ITER;
  }
  // KEK: مفتاح الالتفاف. عند تفعيل الثنائية يدمج سرّ TOTP (ثابت) لا الرمز الزمني.
  function deriveKEK(kekpwBytes, secretBytes) {
    if (!secretBytes || !secretBytes.length) return Promise.resolve(kekpwBytes);
    var msg = concatBytes(concatBytes(utf8(KEK_INFO), new Uint8Array([0])), secretBytes);
    return hmac256(kekpwBytes, msg);
  }
  function deriveVerifier(kekpwBytes)  { return hmac256(kekpwBytes, utf8(VERIFY_MSG)); }
  function checkVerifier(kekpwBytes, vault) {
    return deriveVerifier(kekpwBytes).then(function (want) {
      return constantTimeEqual(want, b64d(vault.verifier));
    });
  }
  // سرّ TOTP يُخزَّن مشفّراً تحت KEK_pw (لا نصاً صريحاً) — انظر الملاحظة الأمنية.
  function encryptSecret(kekpwBytes, secretText) {
    return aesKey(kekpwBytes, ['encrypt']).then(function (k) { return aesEncrypt(k, utf8(secretText)); });
  }
  function decryptSecret(kekpwBytes, totpRec) {
    if (!totpRec.secretIv) return Promise.resolve(String(totpRec.secret || '')); // توافق مع صيغة نصية
    return aesKey(kekpwBytes, ['decrypt'])
      .then(function (k) { return aesDecrypt(k, totpRec.secretIv, totpRec.secret); })
      .then(function (bytes) { return utf8d(bytes); });
  }
  function totpSecretOf(vault) {
    return (vault && vault.totp && vault.totp.enabled) ? vault.totp : null;
  }
  function totpSecretBytes(secretText) {
    if (!secretText) return null;
    try { return b32decode(secretText); } catch (e) { return null; }
  }
  // معاملات الرمز المخزَّنة في الخزنة (6 أرقام/30ث افتراضاً) — تُحترم في كل تحقق،
  // وإلا لَقَفل المستخدم خارج خزنته لو فعّل ثنائية بـ digits/period مخصّصين.
  function totpParamsOf(rec) {
    return { digits: digitsOf(rec && rec.digits), period: periodOf(rec && rec.period) };
  }
  function verifyStoredCode(secretText, code, rec) {
    var p = totpParamsOf(rec);
    return totpVerify(secretText, code, { window: TOTP_WINDOW, digits: p.digits, period: p.period });
  }

  /* ==========================================================================
   * 7) حالة عامة
   * ======================================================================== */
  function isSupported() {
    return !!(subtle() && webCrypto() && typeof webCrypto().getRandomValues === 'function' && sha1);
  }
  function isConfigured() {
    var v = readVault();
    return !!(v && v.wrap && v.wrap.iv && v.wrap.ct && v.salt && v.verifier);
  }
  function isUnlocked() { return !!_mk; }
  function username() {
    var m = readMeta();
    return (m && m.username) ? String(m.username) : null;
  }
  function has2FA() {
    var m = readMeta();
    if (m && m.has2fa) return true;
    // احتياط: لو ضاعت الميتا أو تعارضت، الحقيقة في الخزنة نفسها
    return !!totpSecretOf(readVault());
  }
  function meta() {
    var m = readMeta();
    if (!m) return null;
    return {
      username: m.username || '',
      has2fa: !!m.has2fa,
      iter: Number(m.iter) || ITER,
      createdAt: m.createdAt || null,
      updatedAt: m.updatedAt || null,
      hint: m.hint || ''
    };
  }
  function lock() {
    _mk = null;
    _lockedAt = Date.now();
    return true;
  }

  function nowISO() { return new Date().toISOString(); }
  function fail(error, reason) {
    var out = { ok: false, error: error };
    if (reason) out.reason = reason;
    return out;
  }
  function guardStorage() {
    if (!isSupported()) return fail('Web Crypto غير مدعوم في هذا المتصفح — استعمل متصفحاً حديثاً');
    if (!hasLS()) return fail('التخزين المحلي (localStorage) غير متاح — لا يمكن إنشاء خزنة');
    return null;
  }

  /* ==========================================================================
   * 8) الإعداد الأول
   * ======================================================================== */
  function setup(opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      var blocked = guardStorage();
      if (blocked) return blocked;
      if (isConfigured()) return fail('توجد خزنة على هذا الجهاز بالفعل — امسحها (reset) قبل الإعداد');

      var name = String(opts.username === null || opts.username === undefined ? '' : opts.username).trim().slice(0, 60);
      if (!name) return fail('اكتب اسم المستخدم');
      var password = String(opts.password === null || opts.password === undefined ? '' : opts.password);
      if (password.length < MIN_PW) return fail('كلمة السر قصيرة جداً — ' + MIN_PW + ' محارف على الأقل');
      var hint = String(opts.hint === null || opts.hint === undefined ? '' : opts.hint).slice(0, 120);
      var enable2FA = !!opts.enable2FA;
      var hasState = (opts.state !== undefined);   // الخزنة الفارغة لا تحفظ data أصلاً
      var state = hasState ? opts.state : null;

      var salt = random(SALT_LEN);
      var mkBytes = random(MK_LEN);
      var secretText = enable2FA ? generateSecret() : null;
      var secretBytes = secretText ? totpSecretBytes(secretText) : null;
      var now = nowISO();

      return pbkdf2(password, salt, ITER).then(function (kekpw) {
        return Promise.all([
          secretText ? encryptSecret(kekpw, secretText) : Promise.resolve(null),
          deriveKEK(kekpw, secretBytes),
          deriveVerifier(kekpw)
        ]).then(function (parts) {
          var secretEnc = parts[0], kekBytes = parts[1], verifier = parts[2];
          if (secretBytes) { zero(kekpw); zero(secretBytes); } // KEK مصفوفة منفصلة عند 2FA

          return aesKey(kekBytes, ['encrypt']).then(function (kekKey) {
            zero(kekBytes);
            return aesEncrypt(kekKey, mkBytes).then(function (wrapRec) {
              return aesKey(mkBytes, ['encrypt', 'decrypt']).then(function (mkKey) {
                zero(mkBytes);
                // خزنة جديدة = بلا data حتى تُحفظ حالة فعلاً. وهذا مقصود:
                // Store.hydrate(null) يعيد بناء البذرة، أما {} فتمنعها وتُفرغ الأرقام.
                var writeData = function () {
                  if (!hasState) return Promise.resolve(null);
                  var text;
                  try { text = JSON.stringify(state); } catch (e) { text = '{}'; }
                  if (text === undefined) text = 'null';
                  return aesEncrypt(mkKey, utf8(text));
                };
                return writeData().then(function (dataRec) {
                  var vault = {
                    v: VERSION, kdf: KDF_NAME, iter: ITER,
                    salt: b64(salt), verifier: b64(verifier),
                    wrap: wrapRec, updatedAt: now
                  };
                  if (dataRec) vault.data = dataRec;
                  if (secretEnc && secretText) {
                    vault.totp = {
                      enabled: true, secret: secretEnc.ct, secretIv: secretEnc.iv,
                      digits: TOTP_DIGITS, period: TOTP_PERIOD, algo: TOTP_ALGO, wrappedAt: now
                    };
                  }
                  var metaRec = {
                    v: VERSION, username: name, has2fa: enable2FA, iter: ITER,
                    createdAt: now, updatedAt: now, hint: hint
                  };
                  try {
                    writeVault(vault);
                    writeMeta(metaRec);
                  } catch (e) {
                    return fail('تعذّر الكتابة في التخزين المحلي — المساحة ممتلئة؟');
                  }
                  _mk = mkKey;
                  clearFailures();
                  var out = { ok: true };
                  if (secretText) {
                    out.totpSecret = secretText;
                    out.otpauthURI = otpauthURI({
                      secret: secretText, username: name, issuer: ISSUER,
                      digits: TOTP_DIGITS, period: TOTP_PERIOD
                    });
                  }
                  return out;
                });
              });
            });
          });
        });
      });
    }).catch(function () { return fail('تعذّر إنشاء الخزنة'); });
  }

  /* ==========================================================================
   * 9) الدخول
   * ======================================================================== */
  function openWith(kekpw, secretBytes, vault) {
    return deriveKEK(kekpw, secretBytes).then(function (kekBytes) {
      return aesKey(kekBytes, ['decrypt']).then(function (kekKey) {
        zero(kekBytes);
        zero(kekpw);
        zero(secretBytes);
        return aesDecrypt(kekKey, vault.wrap.iv, vault.wrap.ct);
      });
    }).then(function (mkBytes) {
      return subtle().importKey('raw', mkBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
        .then(function (mkKey) {
          zero(mkBytes);
          _mk = mkKey;
          clearFailures();
          return { ok: true };
        });
    }, function () {
      registerFailure();
      return fail('تعذّر فك تغليف المفتاح — الملف تالف أو لا يطابق كلمة السر', 'bad-password');
    });
  }

  function unlock(opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (!isSupported()) return fail('Web Crypto غير مدعوم في هذا المتصفح');
      var vault = readVault();
      if (!vault || !vault.wrap || !vault.salt || !vault.verifier) {
        return fail('لا توجد خزنة على هذا الجهاز — أنشئ واحدة أولاً', 'not-configured');
      }
      var left = lockRemainingMs();
      if (left > 0) {
        return fail('محاولات كثيرة — انتظر ' + Math.ceil(left / 1000) + ' ثانية', 'locked-out');
      }

      var password = String(opts.password === null || opts.password === undefined ? '' : opts.password);
      var secretRec = totpSecretOf(vault);
      var digits = secretRec ? digitsOf(secretRec.digits) : TOTP_DIGITS;
      var code = normalizeCode(opts.code);
      if (secretRec && code.length !== digits) {
        registerFailure();
        return fail('أدخل رمز المصادقة الثنائية (' + digits + ' أرقام)', 'bad-code');
      }

      return pbkdf2(password, b64d(vault.salt), iterOf(vault)).then(function (kekpw) {
        return checkVerifier(kekpw, vault).then(function (okPw) {
          if (!okPw) {
            zero(kekpw);
            registerFailure();
            return fail('كلمة السر غير صحيحة', 'bad-password');
          }
          if (!secretRec) return openWith(kekpw, null, vault);

          return decryptSecret(kekpw, secretRec).then(function (secretText) {
            if (!verifyStoredCode(secretText, code, secretRec)) {
              zero(kekpw);
              registerFailure();
              return fail('رمز المصادقة الثنائية غير صحيح', 'bad-code');
            }
            var secretBytes = totpSecretBytes(secretText);
            return openWith(kekpw, secretBytes, vault);
          });
        });
      });
    }).catch(function () { return fail('تعذّر فتح الخزنة'); });
  }

  /* ==========================================================================
   * 10) البيانات
   * ======================================================================== */
  function parseState(text) {
    if (text === null || text === undefined || text === '') return {};
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function load() {
    return Promise.resolve().then(function () {
      if (!_mk) return null;
      var vault = readVault();
      // لا data = خزنة جديدة لم تُحفظ فيها حالة بعد → null (وStore.hydrate يعيد البذرة)
      if (!vault || !vault.data) return null;
      return aesDecrypt(_mk, vault.data.iv, vault.data.ct).then(function (bytes) {
        return parseState(utf8d(bytes));
      }, function () { return null; });
    });
  }

  function writeState(state) {
    return Promise.resolve().then(function () {
      if (!_mk) return fail('الخزنة مقفلة — افتحها أولاً');
      if (state === undefined) return fail('لا توجد بيانات للحفظ');
      var vault = readVault();
      if (!vault) return fail('لا توجد خزنة على هذا الجهاز');
      var text;
      try { text = JSON.stringify(state); } catch (e) { return fail('تعذّر تحويل البيانات إلى JSON'); }
      if (text === undefined) text = 'null';
      return aesEncrypt(_mk, utf8(text)).then(function (rec) {
        var now = nowISO();
        vault.data = rec;
        vault.updatedAt = now;
        try {
          writeVault(vault);
          var m = readMeta();
          if (m) { m.updatedAt = now; writeMeta(m); }
        } catch (e) {
          return fail('تعذّر الكتابة في التخزين المحلي');
        }
        return { ok: true };
      }, function () { return fail('تعذّر تشفير البيانات'); });
    }).catch(function () { return fail('تعذّر حفظ البيانات'); });
  }

  // ملاحظة: التأجيل/debounce مسؤولية الخارج (store.js — قسم 4 من العقد)،
  // لذا save تكتب فوراً مثل saveNow؛ الفرق توثيقي/توافقي فقط.
  function save(state) { return writeState(state); }
  function saveNow(state) { return writeState(state); }

  /* ==========================================================================
   * 11) تغيير كلمة السر — إعادة لفّ MK فقط (بلا إعادة تشفير البيانات)
   * ======================================================================== */
  function changePassword(opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (!isSupported()) return fail('Web Crypto غير مدعوم في هذا المتصفح');
      var vault = readVault();
      if (!vault || !vault.wrap || !vault.salt || !vault.verifier) {
        return fail('لا توجد خزنة على هذا الجهاز', 'not-configured');
      }
      var left = lockRemainingMs();
      if (left > 0) return fail('محاولات كثيرة — انتظر ' + Math.ceil(left / 1000) + ' ثانية', 'locked-out');

      var current = String(opts.currentPassword === null || opts.currentPassword === undefined ? '' : opts.currentPassword);
      var next = String(opts.newPassword === null || opts.newPassword === undefined ? '' : opts.newPassword);
      if (next.length < MIN_PW) return fail('كلمة السر الجديدة قصيرة جداً — ' + MIN_PW + ' محارف على الأقل');
      if (next === current) return fail('كلمة السر الجديدة مطابقة للحالية');

      var secretRec = totpSecretOf(vault);
      var digits = secretRec ? digitsOf(secretRec.digits) : TOTP_DIGITS;
      var code = normalizeCode(opts.code);
      if (secretRec && code.length !== digits) {
        registerFailure();
        return fail('أدخل رمز المصادقة الثنائية (' + digits + ' أرقام)', 'bad-code');
      }

      return pbkdf2(current, b64d(vault.salt), iterOf(vault)).then(function (kekpwOld) {
        return checkVerifier(kekpwOld, vault).then(function (okPw) {
          if (!okPw) {
            zero(kekpwOld);
            registerFailure();
            return fail('كلمة السر الحالية غير صحيحة', 'bad-password');
          }
          return (secretRec ? decryptSecret(kekpwOld, secretRec) : Promise.resolve(null))
            .then(function (secretText) {
              if (secretRec && !verifyStoredCode(secretText, code, secretRec)) {
                zero(kekpwOld); registerFailure();
                return fail('رمز المصادقة الثنائية غير صحيح', 'bad-code');
              }
              var secretBytes = totpSecretBytes(secretText);
              // 1) نفكّ تغليف MK بالمفتاح القديم
              return deriveKEK(kekpwOld, secretBytes).then(function (kekOld) {
                return aesKey(kekOld, ['decrypt']).then(function (k) {
                  zero(kekOld);
                  zero(kekpwOld);
                  return aesDecrypt(k, vault.wrap.iv, vault.wrap.ct);
                });
              }).then(function (mkBytes) {
                // 2) نعيد اللفّ بملح جديد ومفتاح جديد — data تبقى كما هي بلا لمس
                var salt2 = random(SALT_LEN);
                return pbkdf2(next, salt2, ITER).then(function (kekpwNew) {
                  return Promise.all([
                    secretText ? encryptSecret(kekpwNew, secretText) : Promise.resolve(null),
                    deriveKEK(kekpwNew, secretBytes),
                    deriveVerifier(kekpwNew)
                  ]).then(function (parts) {
                    var secretEnc = parts[0], kekNew = parts[1], verifier = parts[2];
                    zero(secretBytes);
                    return aesKey(kekNew, ['encrypt']).then(function (kekKey) {
                      zero(kekNew);
                      return aesEncrypt(kekKey, mkBytes).then(function (wrapRec) {
                        zero(mkBytes);
                        zero(kekpwNew);
                        var now = nowISO();
                        vault.salt = b64(salt2);
                        vault.iter = ITER;
                        vault.kdf = KDF_NAME;
                        vault.verifier = b64(verifier);
                        vault.wrap = wrapRec;
                        vault.updatedAt = now;
                        if (secretEnc && vault.totp) {
                          vault.totp.secret = secretEnc.ct;
                          vault.totp.secretIv = secretEnc.iv;
                          vault.totp.wrappedAt = now;
                        }
                        try {
                          writeVault(vault);
                          var m = readMeta();
                          if (m) { m.iter = ITER; m.updatedAt = now; m.has2fa = !!secretRec; writeMeta(m); }
                        } catch (e) {
                          return fail('تعذّر الكتابة في التخزين المحلي');
                        }
                        clearFailures();
                        // MK نفسه ما زال في الذاكرة إن كانت الخزنة مفتوحة — لا حاجة لإعادة الاستيراد
                        return { ok: true };
                      });
                    });
                  });
                });
              });
            }, function () {
              registerFailure();
              return fail('رمز المصادقة الثنائية غير صحيح', 'bad-code');
            });
        });
      });
    }).catch(function () { return fail('تعذّر تغيير كلمة السر'); });
  }

  /* ==========================================================================
   * 11ب) تعطيل المصادقة الثنائية (إعادة اللفّ بكلمة السر وحدها)
   * ========================================================================
   * لا نمسّ البيانات المشفّرة إطلاقاً — نغيّر فقط طريقة لفّ المفتاح الرئيسي.
   * ملاحظة أمنية: بعد التعطيل تكفي كلمة السر لفتح الخزنة، وهذا اختيار المستخدم.
   * ======================================================================== */
  function disable2FA(opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (!isSupported()) return fail('Web Crypto غير مدعوم في هذا المتصفح');
      var vault = readVault();
      if (!vault || !vault.wrap || !vault.salt || !vault.verifier) {
        return fail('لا توجد خزنة على هذا الجهاز', 'not-configured');
      }
      var left = lockRemainingMs();
      if (left > 0) return fail('محاولات كثيرة — انتظر ' + Math.ceil(left / 1000) + ' ثانية', 'locked-out');
      if (!totpSecretOf(vault)) return fail('المصادقة الثنائية غير مفعّلة أصلاً');

      var password = String(opts.password === null || opts.password === undefined ? '' : opts.password);
      var digits = digitsOf(totpSecretOf(vault).digits);
      var code = normalizeCode(opts.code);
      if (code.length !== digits) {
        registerFailure();
        return fail('أدخل رمز المصادقة الثنائية (' + digits + ' أرقام)', 'bad-code');
      }

      return pbkdf2(password, b64d(vault.salt), iterOf(vault)).then(function (kekpw) {
        return checkVerifier(kekpw, vault).then(function (okPw) {
          if (!okPw) {
            zero(kekpw);
            registerFailure();
            return fail('كلمة السر غير صحيحة', 'bad-password');
          }
          var secretRec = totpSecretOf(vault);
          return decryptSecret(kekpw, secretRec).then(function (secretText) {
            if (!verifyStoredCode(secretText, code, secretRec)) {
              zero(kekpw); registerFailure();
              return fail('رمز المصادقة الثنائية غير صحيح', 'bad-code');
            }
            var secretBytes = totpSecretBytes(secretText);
            // 1) نفكّ تغليف MK بالمفتاح الذي يدمج السرّ
            return deriveKEK(kekpw, secretBytes).then(function (kekOld) {
              return aesKey(kekOld, ['decrypt']).then(function (k) {
                zero(kekOld);
                zero(secretBytes);
                return aesDecrypt(k, vault.wrap.iv, vault.wrap.ct);
              });
            }).then(function (mkBytes) {
              // 2) نعيد اللفّ بملح جديد وبلا سرّ (كلمة السر وحدها)
              var salt2 = random(SALT_LEN);
              return pbkdf2(password, salt2, ITER).then(function (kekpwNew) {
                return Promise.all([
                  deriveKEK(kekpwNew, null),
                  deriveVerifier(kekpwNew)
                ]).then(function (parts) {
                  var kekNew = parts[0], verifier = parts[1];
                  return aesKey(kekNew, ['encrypt']).then(function (kekKey) {
                    zero(kekNew);
                    return aesEncrypt(kekKey, mkBytes).then(function (wrapRec) {
                      zero(mkBytes);
                      zero(kekpwNew);
                      zero(kekpw);
                      var now = nowISO();
                      vault.salt = b64(salt2);
                      vault.iter = ITER;
                      vault.kdf = KDF_NAME;
                      vault.verifier = b64(verifier);
                      vault.wrap = wrapRec;
                      vault.updatedAt = now;
                      delete vault.totp;
                      try {
                        writeVault(vault);
                        var m = readMeta();
                        if (m) { m.iter = ITER; m.updatedAt = now; m.has2fa = false; writeMeta(m); }
                      } catch (e) {
                        return fail('تعذّر الكتابة في التخزين المحلي');
                      }
                      clearFailures();
                      return { ok: true };
                    });
                  });
                });
              });
            });
          });
        });
      });
    }).catch(function () { return fail('تعذّر تعطيل المصادقة الثنائية'); });
  }

  /* ==========================================================================
   * 11ج) مخرج الطوارئ: تعطيل الثنائية بكلمة السر وحدها (بلا رمز)
   * ========================================================================
   * الغرض: من سجّل الثنائية وتخطّى تأكيدها (أو ضاع هاتفه) فيبقى قادراً على
   * الوصول لبياناته بكلمة السر. لا يفتح شيئاً بلا كلمة السر الصحيحة.
   * ملاحظة أمنية: من يعرف كلمة السر يستطيع بهذه الدالة تعطيل الثنائية —
   * وهذا مقبول لأن كلمة السر هي العامل الأساسي، والمستخدم قد اختار بلا هاتف.
   * ======================================================================== */
  function disable2FAWithPassword(opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (!isSupported()) return fail('Web Crypto غير مدعوم في هذا المتصفح');
      var vault = readVault();
      if (!vault || !vault.wrap || !vault.salt || !vault.verifier) {
        return fail('لا توجد خزنة على هذا الجهاز', 'not-configured');
      }
      var left = lockRemainingMs();
      if (left > 0) return fail('محاولات كثيرة — انتظر ' + Math.ceil(left / 1000) + ' ثانية', 'locked-out');
      var secretRec = totpSecretOf(vault);
      if (!secretRec) return { ok: true, already: true };

      var password = String(opts.password === null || opts.password === undefined ? '' : opts.password);
      if (!password) return fail('أدخل كلمة السر');

      return pbkdf2(password, b64d(vault.salt), iterOf(vault)).then(function (kekpw) {
        return checkVerifier(kekpw, vault).then(function (okPw) {
          if (!okPw) {
            zero(kekpw);
            registerFailure();
            return fail('كلمة السر غير صحيحة', 'bad-password');
          }
          return decryptSecret(kekpw, secretRec).then(function (secretText) {
            var secretBytes = totpSecretBytes(secretText);
            return deriveKEK(kekpw, secretBytes).then(function (kekOld) {
              return aesKey(kekOld, ['decrypt']).then(function (k) {
                zero(kekOld);
                zero(secretBytes);
                return aesDecrypt(k, vault.wrap.iv, vault.wrap.ct);
              });
            }).then(function (mkBytes) {
              var salt2 = random(SALT_LEN);
              return pbkdf2(password, salt2, ITER).then(function (kekpwNew) {
                return Promise.all([deriveKEK(kekpwNew, null), deriveVerifier(kekpwNew)]).then(function (parts) {
                  var kekNew = parts[0], verifier = parts[1];
                  return aesKey(kekNew, ['encrypt']).then(function (kekKey) {
                    zero(kekNew);
                    return aesEncrypt(kekKey, mkBytes).then(function (wrapRec) {
                      zero(mkBytes);
                      zero(kekpwNew);
                      zero(kekpw);
                      var now = nowISO();
                      vault.salt = b64(salt2);
                      vault.iter = ITER;
                      vault.kdf = KDF_NAME;
                      vault.verifier = b64(verifier);
                      vault.wrap = wrapRec;
                      vault.updatedAt = now;
                      delete vault.totp;
                      try {
                        writeVault(vault);
                        var m = readMeta();
                        if (m) { m.iter = ITER; m.updatedAt = now; m.has2fa = false; writeMeta(m); }
                      } catch (e) {
                        return fail('تعذّر الكتابة في التخزين المحلي');
                      }
                      clearFailures();
                      return { ok: true };
                    });
                  });
                });
              });
            });
          });
        });
      });
    }).catch(function () { return fail('تعذّر تعطيل المصادقة الثنائية'); });
  }

  /* ==========================================================================
   * 11د) تفعيل الثنائية لاحقاً (من الإعدادات) — بلا إعادة تشفير البيانات
   * ========================================================================
   * يولّد سرّاً جديداً، يعيد لفّ MK بمفتاح يدمج السرّ، ويرجّع السرّ للمستخدم
   * ليضيفه في تطبيق المصادقة. لا تُطلب البيانات مرتين.
   * ======================================================================== */
  function enable2FA(opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (!isSupported()) return fail('Web Crypto غير مدعوم في هذا المتصفح');
      var vault = readVault();
      if (!vault || !vault.wrap || !vault.salt || !vault.verifier) {
        return fail('لا توجد خزنة على هذا الجهاز', 'not-configured');
      }
      if (totpSecretOf(vault)) return fail('المصادقة الثنائية مفعّلة بالفعل');
      var left = lockRemainingMs();
      if (left > 0) return fail('محاولات كثيرة — انتظر ' + Math.ceil(left / 1000) + ' ثانية', 'locked-out');

      var password = String(opts.password === null || opts.password === undefined ? '' : opts.password);
      if (!password) return fail('أدخل كلمة السر');
      if (!isUnlocked()) return fail('افتح الخزنة أولاً', 'locked-out');

      // سرّ مُمرَّر من الخارج (أو مُولَّد): لا بد أن يكون Base32 صالحاً بطول كافٍ،
      // وإلا أُنشئت ثنائية لا يمكن التحقق من رمزها أبداً ⇒ قفل لا مخرج منه إلا بكلمة السر.
      var fromCaller = (opts.secret !== undefined && opts.secret !== null && String(opts.secret) !== '');
      var secretText = fromCaller ? String(opts.secret).trim().toUpperCase().replace(/\s/g, '') : generateSecret();
      var secretBytes = totpSecretBytes(secretText);
      if (!secretBytes || secretBytes.length < MIN_TOTP_SECRET_BYTES) {
        return fail('سرّ المصادقة غير صالح — يجب أن يكون Base32 بطول ' +
          (MIN_TOTP_SECRET_BYTES * 8 / 5) + ' محرفاً على الأقل');
      }
      var digits = digitsOf(opts.digits);
      var period = periodOf(opts.period);

      return pbkdf2(password, b64d(vault.salt), iterOf(vault)).then(function (kekpw) {
        return checkVerifier(kekpw, vault).then(function (okPw) {
          if (!okPw) {
            zero(kekpw);
            registerFailure();
            return fail('كلمة السر غير صحيحة', 'bad-password');
          }
          return deriveKEK(kekpw, null).then(function (kekOld) {
            return aesKey(kekOld, ['decrypt']).then(function (k) {
              zero(kekOld);
              return aesDecrypt(k, vault.wrap.iv, vault.wrap.ct);
            });
          }).then(function (mkBytes) {
            var salt2 = random(SALT_LEN);
            return pbkdf2(password, salt2, ITER).then(function (kekpwNew) {
              return Promise.all([
                encryptSecret(kekpwNew, secretText),
                deriveKEK(kekpwNew, secretBytes),
                deriveVerifier(kekpwNew)
              ]).then(function (parts) {
                var secretEnc = parts[0], kekNew = parts[1], verifier = parts[2];
                zero(secretBytes); // لم نعد نحتاجه بعد HMAC
                return aesKey(kekNew, ['encrypt']).then(function (kekKey) {
                  zero(kekNew);
                  return aesEncrypt(kekKey, mkBytes).then(function (wrapRec) {
                    zero(mkBytes);
                    zero(kekpwNew);
                    zero(kekpw);
                    var now = nowISO();
                    vault.salt = b64(salt2);
                    vault.iter = ITER;
                    vault.kdf = KDF_NAME;
                    vault.verifier = b64(verifier);
                    vault.wrap = wrapRec;
                    vault.updatedAt = now;
                    vault.totp = {
                      enabled: true,
                      secret: secretEnc.ct,
                      secretIv: secretEnc.iv,
                      digits: digits,
                      period: period,
                      algo: TOTP_ALGO,
                      wrappedAt: now
                    };
                    try {
                      writeVault(vault);
                      var m = readMeta();
                      if (m) { m.iter = ITER; m.updatedAt = now; m.has2fa = true; writeMeta(m); }
                    } catch (e) {
                      return fail('تعذّر الكتابة في التخزين المحلي');
                    }
                    clearFailures();
                    return {
                      ok: true,
                      totpSecret: secretText,
                      otpauthURI: otpauthURI({
                        secret: secretText, username: (readMeta() || {}).username || 'masrofi',
                        issuer: ISSUER, digits: digits, period: period
                      }),
                      digits: digits,
                      period: period
                    };
                  });
                });
              });
            });
          });
        });
      });
    }).catch(function () { return fail('تعذّر تفعيل المصادقة الثنائية'); });
  }

  /* ==========================================================================
   * 12) نسخة احتياطية مشفّرة + استيراد
   * ======================================================================== */
  function exportEncrypted() {
    return Promise.resolve().then(function () {
      var vault = readVault();
      if (!vault || !vault.wrap) return fail('لا توجد خزنة لتصديرها');
      var payload = {
        app: 'masrofi',
        type: 'vault-backup',
        v: VERSION,
        exportedAt: nowISO(),
        vault: vault,
        meta: readMeta()
      };
      return { ok: true, text: JSON.stringify(payload, null, 2) };
    }).catch(function () { return fail('تعذّر تجهيز النسخة الاحتياطية'); });
  }

  // يستورد نسخة (خزنة + ميتا) ويفتحها بكلمة السر/الرمز، ثم **يستبدل** الخزنة المحلية
  // ويعيد الحالة المفكوكة. الشاشة مسؤولة عن طلب التأكيد قبل الاستدعاء.
  function importEncrypted(text, opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (!isSupported()) return fail('Web Crypto غير مدعوم في هذا المتصفح');
      var parsed;
      try { parsed = JSON.parse(String(text === null || text === undefined ? '' : text)); }
      catch (e) { return fail('ملف النسخة غير صالح (JSON)'); }
      var vault = null, metaRec = null;
      if (parsed && parsed.vault && typeof parsed.vault === 'object') {
        vault = parsed.vault;
        metaRec = (parsed.meta && typeof parsed.meta === 'object') ? parsed.meta : null;
      } else if (parsed && parsed.wrap && parsed.salt) {
        vault = parsed;
      }
      if (!vault || !vault.wrap || !vault.salt || !vault.verifier) {
        return fail('ملف النسخة لا يحتوي خزنة صالحة');
      }

      var secretRec = totpSecretOf(vault);
      var digits = secretRec ? digitsOf(secretRec.digits) : TOTP_DIGITS;
      var password = String(opts.password === null || opts.password === undefined ? '' : opts.password);
      var code = normalizeCode(opts.code);
      if (secretRec && code.length !== digits) {
        return fail('أدخل رمز المصادقة الثنائية (' + digits + ' أرقام)', 'bad-code');
      }

      return pbkdf2(password, b64d(vault.salt), iterOf(vault)).then(function (kekpw) {
        return checkVerifier(kekpw, vault).then(function (okPw) {
          if (!okPw) {
            zero(kekpw);
            return fail('كلمة السر غير صحيحة أو الملف تالف', 'bad-password');
          }
          return (secretRec ? decryptSecret(kekpw, secretRec) : Promise.resolve(null))
            .then(function (secretText) {
              if (secretRec && !verifyStoredCode(secretText, code, secretRec)) {
                zero(kekpw);
                return fail('رمز المصادقة الثنائية غير صحيح', 'bad-code');
              }
              var secretBytes = totpSecretBytes(secretText);
              return deriveKEK(kekpw, secretBytes).then(function (kekBytes) {
                return aesKey(kekBytes, ['decrypt']).then(function (kekKey) {
                  zero(kekBytes);
                  zero(kekpw);
                  zero(secretBytes);
                  return aesDecrypt(kekKey, vault.wrap.iv, vault.wrap.ct);
                });
              }).then(function (mkBytes) {
                return subtle().importKey('raw', mkBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
                  .then(function (mkKey) {
                    zero(mkBytes);
                    var stateP = vault.data
                      ? aesDecrypt(mkKey, vault.data.iv, vault.data.ct).then(function (b) { return parseState(utf8d(b)); },
                        function () { return false; })
                      : Promise.resolve(null);
                    return stateP.then(function (state) {
                      if (state === false) return fail('تعذّر فك بيانات النسخة — الملف تالف');
                      var now = nowISO();
                      if (!metaRec) {
                        metaRec = {
                          v: VERSION, username: '', has2fa: !!secretRec, iter: iterOf(vault),
                          createdAt: now, updatedAt: now, hint: ''
                        };
                      } else {
                        metaRec.has2fa = !!secretRec;
                        metaRec.iter = iterOf(vault);
                        metaRec.updatedAt = now;
                      }
                      try {
                        writeVault(vault);
                        writeMeta(metaRec);
                      } catch (e) { return fail('تعذّر الكتابة في التخزين المحلي'); }
                      _mk = mkKey;
                      clearFailures();
                      return { ok: true, state: state };
                    });
                  });
              });
            }, function () {
              return fail('تعذّر فتح سرّ المصادقة الثنائية — الملف تالف', 'bad-code');
            });
        });
      });
    }).catch(function () { return fail('تعذّر استيراد النسخة الاحتياطية'); });
  }

  /* ==========================================================================
   * 13) المسح — الخزنة والميتا فقط (لا يمسّ finapp.v1 ولا أي شيء آخر)
   * ======================================================================== */
  function reset() {
    _mk = null;
    lsDel(KEY_VAULT);
    lsDel(KEY_META);
    clearFailures();
    return { ok: true };
  }

  /* ==========================================================================
   * 14) الواجهة العامة
   * ======================================================================== */
  Fin.Vault = {
    version: VERSION,
    KEYS: { vault: KEY_VAULT, meta: KEY_META, legacy: KEY_LEGACY, lock: KEY_LOCK },
    iter: ITER,

    isSupported: isSupported,
    isConfigured: isConfigured,
    isUnlocked: isUnlocked,
    username: username,
    has2FA: has2FA,
    meta: meta,
    lock: lock,

    setup: setup,
    unlock: unlock,
    load: load,
    save: save,
    saveNow: saveNow,

    changePassword: changePassword,
    disable2FA: disable2FA,
    disable2FAWithPassword: disable2FAWithPassword,
    enable2FA: enable2FA,
    exportEncrypted: exportEncrypted,
    importEncrypted: importEncrypted,
    reset: reset,

    totp: totp,
    utils: {
      b64: b64,
      b64d: b64d,
      utf8: utf8,
      utf8d: utf8d,
      random: random,
      constantTimeEqual: constantTimeEqual
    }
  };
})();
