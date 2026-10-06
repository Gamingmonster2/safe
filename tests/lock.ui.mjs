/* =============================================================================
 * مصروفي — tests/lock.ui.mjs
 * اختبار ذاتي لشاشة القفل (assets/js/views/lock.js) على DOM مصغّر + Fin.Vault مزيّف.
 * يغطّي: الإعداد · قوة كلمة السر · سرّ TOTP · الدخول · التعطيل المؤقت · فحوص الملفات.
 * التشغيل:  node tests/lock.ui.mjs
 * ========================================================================== */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { webcrypto } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function eq(name, actual, expected) {
  ok(name + ' = ' + JSON.stringify(expected), actual === expected, 'الفعلي: ' + JSON.stringify(actual));
}

/* ------------------------------------------------------- DOM مصغّر
 * مبني على بنية tests/dom-smoke.mjs (بلا تعديل عليه) — يكفي لمكوّنات ui.js. */
class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); this._sync(); }
  _sync() { this.node._class = [...this.set].join(' '); }
}
class Node2 {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this._text = '';
    this._listeners = {};
    this.classList = new ClassList(this);
    this._class = '';
    this.parentNode = null;
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.files = null;
    this.type = '';
    this.disabled = false;
  }
  get className() { return this._class; }
  set className(v) { this._class = String(v || ''); this.classList.set = new Set(this._class.split(/\s+/).filter(Boolean)); }
  get firstChild() { return this.children[0] || null; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this.children.forEach((c) => (c.parentNode = null)); this.children.length = 0; this._text = String(v == null ? '' : v); }
  set innerHTML(v) { this._html = String(v || ''); this._text = String(v || '').replace(/<[^>]*>/g, ' '); }
  get innerHTML() { return this._html || ''; }
  appendChild(child) {
    if (!child) return child;
    if (child.__fragment) { child.children.slice().forEach((c) => this.appendChild(c)); child.children.length = 0; return child; }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, ref) {
    const i = this.children.indexOf(ref);
    child.parentNode = this;
    if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
    return child;
  }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; if (k === 'id') this.id = v; }
  getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return this.attributes[k] !== undefined; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); }
  dispatch(type, ev) { (this._listeners[type] || []).forEach((f) => f(Object.assign({ target: this, key: undefined, stopPropagation() {}, preventDefault() {} }, ev))); }
  click() { this.dispatch('click'); }
  focus() {}
  select() {}
  setSelectionRange() {}
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const match2 = (n, s) => (s.startsWith('.') ? n.classList.contains(s.slice(1)) : s.startsWith('#') ? n.id === s.slice(1) : n.tagName === s.toUpperCase());
    const match = (n) => {
      const s = String(sel).trim();
      if (s.startsWith('.')) return n.classList.contains(s.slice(1));
      if (s.startsWith('#')) return n.id === s.slice(1);
      if (s.includes(',')) return s.split(',').some((part) => match2(n, part.trim()));
      return n.tagName === s.toUpperCase();
    };
    const walk = (n) => n.children.forEach((c) => { if (match(c)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  get outerHTML() { return this.innerHTML; }
}
class TextNode extends Node2 {
  constructor(t) { super('#text'); this._text = String(t); }
}

const documentStub = {
  readyState: 'complete',
  documentElement: new Node2('html'),
  body: new Node2('body'),
  head: new Node2('head'),
  createElement(tag) { return new Node2(tag); },
  createElementNS(ns, tag) { return new Node2(tag); },
  createTextNode(t) { return new TextNode(t); },
  createDocumentFragment() { const f = new Node2('#fragment'); f.__fragment = true; return f; },
  getElementById(id) { return this.body.querySelector('#' + id) || this.documentElement.querySelector('#' + id); },
  querySelector(sel) { return this.body.querySelector(sel) || this.documentElement.querySelector(sel); },
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); },
  addEventListener() {},
  removeEventListener() {}
};
documentStub.documentElement.ownerDocument = documentStub;
documentStub.body.ownerDocument = documentStub;

/* sessionStorage مزيّف — للعدّاد فقط */
const sessionMap = new Map();
const sessionStorageStub = {
  getItem: (k) => (sessionMap.has(String(k)) ? sessionMap.get(String(k)) : null),
  setItem: (k, v) => { sessionMap.set(String(k), String(v)); },
  removeItem: (k) => { sessionMap.delete(String(k)); },
  clear: () => sessionMap.clear(),
  key: (i) => Array.from(sessionMap.keys())[i] || null,
  get length() { return sessionMap.size; }
};

let reloads = 0;
const locationStub = {
  hash: '#/lock',
  protocol: 'https:',
  href: 'https://ly.id.ly/safe/',
  reload() { reloads++; },
  replace() {}
};

const windowStub = {
  document: documentStub,
  location: locationStub,
  navigator: { userAgent: 'node', clipboard: null, serviceWorker: undefined },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  scrollTo() {},
  addEventListener() {},
  setTimeout,
  clearTimeout,
  Intl, Date, Math, JSON, console,
  sessionStorage: sessionStorageStub
};
windowStub.window = windowStub;

const sandbox = {
  window: windowStub,
  document: documentStub,
  navigator: windowStub.navigator,
  location: locationStub,
  matchMedia: windowStub.matchMedia,
  requestAnimationFrame: windowStub.requestAnimationFrame,
  scrollTo: windowStub.scrollTo,
  setTimeout, clearTimeout, setInterval, clearInterval,
  console, Intl, Date, Math, JSON, Promise, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, parseFloat, parseInt,
  Node: Node2,
  Blob: class Blob { constructor(p) { this.parts = p; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  FileReader: class { readAsText() {} },
  sessionStorage: sessionStorageStub
};
sandbox.globalThis = sandbox;
/* لو لمس lock.js التخزين الدائم يفشل الاختبار فوراً وبصراحة */
Object.defineProperty(sandbox, 'localStorage', {
  configurable: true,
  get() { throw new Error('lock.js يجب ألا يستعمل localStorage — العدّاد في sessionStorage فقط'); }
});

const ctx = vm.createContext(sandbox);
const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });

console.log('\n=== 0) تحميل الوحدات + تزييف Fin.Vault ===');
['assets/js/constants.js', 'assets/js/icons.js', 'assets/js/util.js', 'assets/js/ui.js'].forEach((f) => {
  try { load(f); ok('حُمّل ' + f, true); }
  catch (e) { ok('حُمّل ' + f, false, String((e && e.message) || e)); }
});

const Fin = vm.runInContext('globalThis.Fin', ctx);
ok('Fin.I و Fin.UI و Fin.U جاهزة', !!(Fin.I && Fin.UI && Fin.U));

function makeVault(o) {
  o = o || {};
  const v = {
    configured: !!o.configured,
    twofa: !!o.twofa,
    user: o.user === undefined ? null : o.user,
    hint: o.hint || '',
    remaining: o.remaining === undefined ? 17 : o.remaining,
    setupResult: o.setupResult || { ok: true },
    unlockResult: o.unlockResult || { ok: true },
    verifyResult: o.verifyResult !== false,
    calls: [],
    isConfigured() { return v.configured; },
    isUnlocked() { return false; },
    has2FA() { return v.twofa; },
    username() { return v.user; },
    meta() { return { v: 1, username: v.user, has2fa: v.twofa, iter: 310000, hint: v.hint }; },
    setup(args) { v.calls.push({ fn: 'setup', args }); v.configured = true; if (args && args.enable2FA) v.twofa = true; return Promise.resolve(v.setupResult); },
    unlock(args) { v.calls.push({ fn: 'unlock', args }); return Promise.resolve(v.unlockResult); },
    importEncrypted(text, args) { v.calls.push({ fn: 'importEncrypted', args }); return Promise.resolve({ ok: true }); },
    lock() {},
    totp: {
      remainingSeconds() { return v.remaining; },
      verify(secret, code) { v.calls.push({ fn: 'verify', args: { secret, code } }); return v.verifyResult; },
      otpauthURI() { return 'otpauth://totp/x'; }
    }
  };
  return v;
}

Fin.Vault = makeVault({ configured: false });
try { load('assets/js/views/lock.js'); ok('حُمّل assets/js/views/lock.js', true); }
catch (e) { ok('حُمّل assets/js/views/lock.js', false, String((e && e.message) || e)); }

const lock = Fin.Views && Fin.Views.lock;
ok('Fin.Views.lock مسجّلة', !!lock && typeof lock.render === 'function');
if (!lock) { console.log('\nPASS ' + pass + ' / FAIL ' + fail); process.exitCode = 1; process.exit(1); }
eq('id', lock.id, 'lock');
eq('hidden', lock.hidden, true);
ok('destroy دالة', typeof lock.destroy === 'function');

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = 'otpauth://totp/Masrofi:saif?secret=' + SECRET + '&issuer=Masrofi';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function flush(n) { for (let i = 0; i < (n || 4); i++) await delay(0); }
function newHost() { const h = documentStub.createElement('div'); documentStub.body.appendChild(h); return h; }
function fresh(vaultOpts) {
  lock.destroy();
  sessionMap.clear();
  reloads = 0;
  /* محاكاة صفحة نظيفة: المرور بشاشة الإعداد (لا خزنة) يُلغي أي سرّ ثنائية معلّق،
     تماماً كما يحدث عند إعادة تحميل الصفحة. */
  Fin.Vault = makeVault({ configured: false });
  lock.render(newHost(), {});
  lock.destroy();
  Fin.Vault = makeVault(vaultOpts);
  const host = newHost();
  lock.render(host, { refresh() {}, go() {} });
  return { vault: Fin.Vault, host };
}
const byName = (host, name) => host.querySelectorAll('.input').filter((n) => n.getAttribute('name') === name)[0];
const click = (node) => { node.click(); };

/* ==================================================================== 1 */
console.log('\n=== 1) لا خزنة → شاشة الإعداد ===');
{
  const { host } = fresh({ configured: false });
  const text = host.textContent;
  ok('عنوان الترحيب ظاهر', text.includes('أنشئ حسابك لحماية بياناتك'), text.slice(0, 80));
  ok('شرح التشفير المحلي بلا خادم ظاهر', text.includes('لا تُرسل') || text.includes('بلا خادم'));
  ['username', 'password', 'confirm', 'hint'].forEach((n) => ok('حقل ' + n + ' موجود', !!byName(host, n)));
  const sw = host.querySelector('.switch-input');
  ok('مفتاح المصادقة الثنائية موجود ومفعّل افتراضياً', !!sw && sw.checked === true);
  ok('مؤشر قوة كلمة السر موجود', !!host.querySelector('#lock-strength'));
  ok('زر الإنشاء موجود', !!host.querySelector('#lock-setup-submit'));
}

/* ==================================================================== 2 */
console.log('\n=== 2) كلمة سر قصيرة (5 محارف) → رفض بلا نداء setup ===');
{
  const { vault, host } = fresh({ configured: false });
  byName(host, 'username').value = 'سيف';
  const pw = byName(host, 'password');
  pw.value = '12345';
  pw.dispatch('input');
  byName(host, 'confirm').value = '12345';
  ok('المؤشر يقول «قصيرة جداً» أثناء الكتابة', host.textContent.includes('قصيرة جداً'));
  const meter = host.querySelector('#lock-strength');
  ok('شريط القوة بلون الخطر', meter.children[1].classList.contains('progress-danger'));
  ok('تلميح أسباب الضعف ظاهر', host.textContent.includes('لتقويتها'));
  click(host.querySelector('#lock-setup-submit'));
  await flush();
  eq('setup لم يُنادَ', vault.calls.filter((c) => c.fn === 'setup').length, 0);
  const err = host.querySelector('#lock-error');
  ok('خطأ ظاهر بالعربية', !!err && !err.classList.contains('hidden') && err.textContent.includes('قصيرة'));
}

/* ==================================================================== 3 */
console.log('\n=== 3) كلمتا سر مختلفتان → خطأ «غير متطابقتين» ===');
{
  const { vault, host } = fresh({ configured: false });
  byName(host, 'username').value = 'سيف';
  byName(host, 'password').value = 'Masrofi-2026-pass';
  byName(host, 'confirm').value = 'Masrofi-2026-PASS';
  click(host.querySelector('#lock-setup-submit'));
  await flush();
  eq('setup لم يُنادَ', vault.calls.filter((c) => c.fn === 'setup').length, 0);
  const err = host.querySelector('#lock-error');
  ok('رسالة عدم التطابق ظاهرة', !!err && !err.classList.contains('hidden') && err.textContent.includes('غير متطابقتين'), err && err.textContent);
}

/* ==================================================================== 4 */
console.log('\n=== 4) إعداد ناجح مع 2FA → سرّ TOTP وبطاقة التعليمات ===');
{
  const { vault, host } = fresh({ configured: false, setupResult: { ok: true, totpSecret: SECRET, otpauthURI: URI } });
  byName(host, 'username').value = 'سيف';
  byName(host, 'password').value = 'Masrofi-2026-pass';
  byName(host, 'confirm').value = 'Masrofi-2026-pass';
  byName(host, 'hint').value = 'تاريخ ميلادي';
  click(host.querySelector('#lock-setup-submit'));
  await flush();

  const calls = vault.calls.filter((c) => c.fn === 'setup');
  eq('setup نُودي مرة واحدة', calls.length, 1);
  const args = (calls[0] || {}).args || {};
  eq('اسم المستخدم المُرسل', args.username, 'سيف');
  eq('كلمة السر المُرسلة', args.password, 'Masrofi-2026-pass');
  eq('التلميح المُرسل', args.hint, 'تاريخ ميلادي');
  eq('enable2FA مفعّل', args.enable2FA, true);
  eq('مفاتيح الوسيط كما في العقد', Object.keys(args).join(','), 'username,password,hint,enable2FA');

  ok('السرّ معروض في صندوق mono', host.textContent.includes(SECRET) && !!host.querySelector('#lock-secret'));
  ok('السرّ باتجاه ltr', host.querySelector('#lock-secret').getAttribute('dir') === 'ltr');
  ok('رابط otpauth معروض', host.textContent.includes(URI) && !!host.querySelector('#lock-uri'));
  ok('زر «انسخ السرّ» موجود', !!host.querySelector('#lock-copy-secret'));
  ok('زر «انسخ الرابط» موجود', !!host.querySelector('#lock-copy-uri'));
  ok('بطاقة التعليمات المرقّمة ظاهرة', !!host.querySelector('.lock-steps') && host.textContent.includes('تطبيق مصادقة'));
  ok('خانة تأكيد الرمز ظاهرة', !!host.querySelector('#lock-totp-code'));
  ok('شاشة الإعداد اختفت', !host.querySelector('#lock-setup-submit'));
  ok('كلمة السر لا تظهر في نص الشاشة', !host.textContent.includes('Masrofi-2026-pass'));
}

/* ==================================================================== 5 */
console.log('\n=== 5) خزنة + 2FA → خانة الرمز والعدّاد ثم unlock({password, code}) ===');
{
  const { vault, host } = fresh({ configured: true, twofa: true, user: 'سيف', hint: 'تاريخ ميلادي', remaining: 17 });
  ok('اسم المستخدم معروض بلا حقل تعديل', host.textContent.includes('سيف') && !byName(host, 'username'));
  ok('التلميح معروض', host.textContent.includes('تاريخ ميلادي'));
  ok('خانة الرمز ظاهرة', !!host.querySelector('#lock-code'));
  const timer = host.querySelector('#lock-otp-timer');
  ok('العدّاد يعرض الثواني المتبقية', !!timer && timer.textContent.includes('17'), timer && timer.textContent);
  const track = host.querySelector('.lock-otp-bar');
  eq('شريط العدّاد يتناسب مع المتبقي', track.children[0].style.width, '57%');
  ok('زر «جدّد الرمز» موجود', !!host.querySelector('#lock-refresh-code'));

  const pw = host.querySelector('#lock-password');
  eq('نوع حقل كلمة السر قبل الإظهار', pw.getAttribute('type'), 'password');
  click(host.querySelector('#lock-pw-toggle'));
  eq('نوع الحقل بعد «إظهار»', pw.getAttribute('type'), 'text');
  click(host.querySelector('#lock-pw-toggle'));
  eq('نوع الحقل بعد «إخفاء»', pw.getAttribute('type'), 'password');

  pw.value = 'Masrofi-2026-pass';
  host.querySelector('#lock-code').value = '123456';
  click(host.querySelector('#lock-unlock-submit'));
  await flush();
  const calls = vault.calls.filter((c) => c.fn === 'unlock');
  eq('unlock نُودي مرة واحدة', calls.length, 1);
  const args = (calls[0] || {}).args || {};
  eq('كلمة السر المُرسلة', args.password, 'Masrofi-2026-pass');
  eq('الرمز المُرسل', args.code, '123456');
  eq('مفاتيح الوسيط كما في العقد', Object.keys(args).join(','), 'password,code');
  ok('بعد النجاح يُعاد تحميل الصفحة', reloads > 0, 'عدد مرات reload: ' + reloads);
}

/* ==================================================================== 6 */
console.log('\n=== 6) كلمة سر خاطئة → رسالة عربية واضحة والشاشة تبقى ===');
{
  const { host } = fresh({ configured: true, twofa: false, user: 'سيف', unlockResult: { ok: false, reason: 'bad-password', error: 'bad password' } });
  host.querySelector('#lock-password').value = 'wrong-password';
  click(host.querySelector('#lock-unlock-submit'));
  await flush();
  const err = host.querySelector('#lock-error');
  ok('رسالة الخطأ ظاهرة', !!err && !err.classList.contains('hidden'));
  ok('الرسالة عربية وتذكر كلمة السر', !!err && err.textContent.includes('كلمة السر غير صحيحة'), err && err.textContent);
  ok('الشاشة باقية (الزر والحقل موجودان)', !!host.querySelector('#lock-unlock-submit') && !!host.querySelector('#lock-password'));
  eq('لم تُعَد الصفحة للتحميل', reloads, 0);
}

/* ==================================================================== 7 */
console.log('\n=== 7) خمس محاولات فاشلة → تعطيل الزر 30 ثانية ===');
{
  const { vault, host } = fresh({ configured: true, twofa: false, user: 'سيف', unlockResult: { ok: false, reason: 'bad-password' } });
  const pw = host.querySelector('#lock-password');
  const btn = host.querySelector('#lock-unlock-submit');
  for (let i = 0; i < 5; i++) {
    pw.value = 'wrong-' + i;
    click(btn);
    await flush(3);
  }
  eq('خمس محاولات وصلت للخزنة', vault.calls.filter((c) => c.fn === 'unlock').length, 5);
  ok('الزر معطّل الآن', btn.disabled === true);
  const lockout = host.querySelector('#lock-lockout');
  ok('عدّاد التعطيل ظاهر', !!lockout && !lockout.classList.contains('hidden'));
  ok('العدّاد يذكر الثواني', !!lockout && /\d/.test(lockout.textContent) && lockout.textContent.includes('ثانية'), lockout && lockout.textContent);
  ok('العدّاد محفوظ في sessionStorage', !!sessionStorageStub.getItem('masrofi.lock.guard.v1'));
}

/* ==================================================================== 8-10 */
console.log('\n=== 8) فحص الملفات: بلا إيموجي · بلا innerHTML · أيقونات موجودة ===');
const lockJs = fs.readFileSync(path.join(ROOT, 'assets/js/views/lock.js'), 'utf8');
const lockCss = fs.readFileSync(path.join(ROOT, 'assets/css/lock.css'), 'utf8');

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}]/u;
function emojiHits(src) {
  const hits = [];
  src.split('\n').forEach((line, i) => { if (EMOJI.test(line)) hits.push((i + 1) + ': ' + line.trim().slice(0, 60)); });
  return hits;
}
const jsEmoji = emojiHits(lockJs);
const cssEmoji = emojiHits(lockCss);
ok('صفر إيموجي في views/lock.js', jsEmoji.length === 0, jsEmoji.slice(0, 3).join(' | '));
ok('صفر إيموجي في lock.css', cssEmoji.length === 0, cssEmoji.slice(0, 3).join(' | '));

ok('صفر innerHTML في views/lock.js', !/innerHTML/i.test(lockJs));
ok('صفر localStorage في views/lock.js', !/localStorage/.test(lockJs));
ok('صفر ألوان hex جديدة في lock.css', !/#[0-9a-fA-F]{3,8}\b/.test(lockCss));

const iconNames = new Set();
let m;
const RE1 = /\bicon\(\s*'([A-Za-z0-9_-]+)'/g;
const RE2 = /\bicon:\s*'([A-Za-z0-9_-]+)'/g;
while ((m = RE1.exec(lockJs)) !== null) iconNames.add(m[1]);
while ((m = RE2.exec(lockJs)) !== null) iconNames.add(m[1]);
ok('استُخرجت أسماء أيقونات من الملف (' + iconNames.size + ')', iconNames.size >= 8, [...iconNames].join(', '));
const missingIcons = [...iconNames].filter((n) => !Fin.I.has(n));
ok('كل الأيقونات موجودة في Fin.I' + (missingIcons.length ? ' — الناقص: ' + missingIcons.join(', ') : ''), missingIcons.length === 0);
['lock', 'key', 'shield', 'user', 'eye', 'copy', 'hourglass', 'refresh'].forEach((n) => ok('الأيقونة المطلوبة «' + n + '» موجودة', Fin.I.has(n)));

/* ==================================================================== 11 */
console.log('\n=== 11) إضافات: حوار «نسيت كلمة السر؟» + التخطّي في شاشة السرّ ===');
{
  const { host } = fresh({ configured: true, twofa: true, user: 'سيف' });
  click(host.querySelector('#lock-forgot'));
  await flush();
  const modalText = documentStub.body.textContent;
  ok('الحوار يفتح ويشرح بصدق عدم إمكانية الاستعادة', modalText.includes('لا يمكن استعادة كلمة السر'));
  ok('يذكر النسخة الاحتياطية المشفّرة كتعافٍ وحيد', modalText.includes('نسخة احتياطية مشفّر'));
  ok('فيه حقل ملف الاستيراد', !!documentStub.body.querySelector('#lock-import-file'));
  ok('فيه زر الاستيراد', documentStub.body.textContent.includes('استورد نسخة مشفّرة'));
}

{
  const { vault, host } = fresh({ configured: false, setupResult: { ok: true, totpSecret: SECRET, otpauthURI: URI } });
  byName(host, 'username').value = 'سيف';
  byName(host, 'password').value = 'Masrofi-2026-pass';
  byName(host, 'confirm').value = 'Masrofi-2026-pass';
  click(host.querySelector('#lock-setup-submit'));
  await flush();
  ok('زر التخطّي موجود', !!host.querySelector('#lock-totp-skip'));
  host.querySelector('#lock-totp-code').value = '000000';
  vault.verifyResult = false;
  click(host.querySelector('#lock-totp-verify'));
  await flush();
  const err = host.querySelector('#lock-totp-error');
  ok('رمز خاطئ → خطأ والسرّ يبقى معروضاً', !!err && !err.classList.contains('hidden') && host.textContent.includes(SECRET), err && err.textContent);
  vault.verifyResult = true;
  host.querySelector('#lock-totp-code').value = '123456';
  click(host.querySelector('#lock-totp-verify'));
  await flush();
  ok('رمز صحيح → يُنادى verify (secret, code)', vault.calls.some((c) => c.fn === 'verify' && c.args.code === '123456' && c.args.secret === SECRET));
  ok('رمز صحيح → إعادة تحميل', reloads > 0);
}

lock.destroy();
sessionMap.clear();

/* ==================================================================== 12 */
console.log('\n=== 12) تكامل حقيقي مع assets/js/vault.js (Web Crypto في Node) ===');
const vaultPath = path.join(ROOT, 'assets/js/vault.js');
if (!fs.existsSync(vaultPath)) {
  console.log('  (تخطّي) vault.js غير موجود بعد — الواجهة مختبَرة على المزيّف وحده');
} else {
  /* بيئة ثانية بمستند مستقل وتخزين حقيقي الشكل + Web Crypto */
  const envDoc = (() => {
    const d = {
      readyState: 'complete',
      documentElement: new Node2('html'),
      body: new Node2('body'),
      head: new Node2('head'),
      createElement: (t) => new Node2(t),
      createElementNS: (ns, t) => new Node2(t),
      createTextNode: (t) => new TextNode(t),
      createDocumentFragment() { const f = new Node2('#fragment'); f.__fragment = true; return f; },
      getElementById(id) { return this.body.querySelector('#' + id) || this.documentElement.querySelector('#' + id); },
      querySelector(sel) { return this.body.querySelector(sel) || this.documentElement.querySelector(sel); },
      querySelectorAll(sel) { return this.body.querySelectorAll(sel); },
      addEventListener() {},
      removeEventListener() {}
    };
    d.documentElement.ownerDocument = d;
    d.body.ownerDocument = d;
    return d;
  })();
  const makeStorage = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => { map.set(String(k), String(v)); },
      removeItem: (k) => { map.delete(String(k)); },
      clear: () => map.clear(),
      key: (i) => Array.from(map.keys())[i] || null,
      get length() { return map.size; },
      _map: map
    };
  };
  const lsReal = makeStorage();
  const ssReal = makeStorage();
  let realReloads = 0;
  const locReal = { hash: '#/lock', protocol: 'https:', href: 'https://ly.id.ly/safe/', reload() { realReloads++; }, replace() {} };
  const sbox = {
    document: envDoc,
    location: locReal,
    navigator: { userAgent: 'node', clipboard: null },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    scrollTo() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, Promise, JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, parseFloat, parseInt,
    Uint8Array, DataView, ArrayBuffer, TextEncoder, TextDecoder,
    crypto: webcrypto,
    localStorage: lsReal,
    sessionStorage: ssReal,
    Blob: class Blob { constructor(p) { this.parts = p; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    FileReader: class { readAsText() {} },
    Node: Node2
  };
  sbox.globalThis = sbox;
  const ctxReal = vm.createContext(sbox);
  const loadReal = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctxReal, { filename: rel });
  const realFiles = ['assets/js/constants.js', 'assets/js/icons.js', 'assets/js/util.js', 'assets/js/ui.js', 'assets/js/vault.js', 'assets/js/views/lock.js'];
  let envOk = true;
  realFiles.forEach((f) => {
    try { loadReal(f); }
    catch (e) { envOk = false; ok('حُمّل ' + f + ' في بيئة التكامل', false, String((e && e.message) || e)); }
  });
  if (envOk) ok('حُمّلت كل ملفات بيئة التكامل (' + realFiles.length + ')', true);

  const FinB = vm.runInContext('globalThis.Fin', ctxReal);
  const VB = FinB.Vault, lockB = FinB.Views.lock;
  /* مخزن مصغّر: snapshotForVault تحمل بيانات ما قبل الخزنة، ويجب أن تصل مشفّرة إلى الخزنة */
  FinB.Store = { snapshotForVault: () => ({ marker: 'legacy-state', transactions: [{ id: 'tx-1' }] }) };
  async function waitFor(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 30000)) { if (fn()) return true; await delay(20); }
    return false;
  }
  ok('vault.js يدعم Web Crypto في Node', !!VB && VB.isSupported() === true);
  ok('لا خزنة في البداية', VB.isConfigured() === false);

  const hostR = envDoc.createElement('div');
  envDoc.body.appendChild(hostR);
  lockB.render(hostR, {});
  const inputR = (name) => hostR.querySelectorAll('.input').filter((n) => n.getAttribute('name') === name)[0];
  ok('الشاشة تعرض الإعداد (لا خزنة)', !!hostR.querySelector('#lock-setup-submit'));

  inputR('username').value = 'سيف';
  inputR('password').value = 'Masrofi-2026-pass';
  inputR('confirm').value = 'Masrofi-2026-pass';
  hostR.querySelector('#lock-setup-submit').click();
  const gotSecret = await waitFor(() => !!hostR.querySelector('#lock-secret'), 40000);
  ok('setup الحقيقي أنشأ الخزنة وعرض السرّ', gotSecret);

  if (gotSecret) {
    const secret = hostR.querySelector('#lock-secret').textContent;
    eq('طول السرّ 32 محرفاً base32', secret.length, 32);
    ok('الخزنة صارت مُعدّة', VB.isConfigured() === true);
    ok('has2FA صحيح بعد الإعداد', VB.has2FA() === true);
    eq('اسم المستخدم من meta', VB.meta().username, 'سيف');
    const code = VB.totp.code(secret, {});
    eq('طول رمز TOTP', code.length, 6);
    ok('verify يقبل الرمز الحالي', VB.totp.verify(secret, code, { window: 1 }) === true);
    const remain = VB.totp.remainingSeconds({});
    ok('remainingSeconds بين 1 و30', remain >= 1 && remain <= 30, String(remain));

    hostR.querySelector('#lock-totp-code').value = code;
    hostR.querySelector('#lock-totp-verify').click();
    await waitFor(() => realReloads > 0, 10000);
    ok('تأكيد الرمز نجح وأعاد التحميل', realReloads > 0);
    ok('لا خطأ في شاشة السرّ', hostR.querySelector('#lock-totp-error').classList.contains('hidden'));

    /* محاكاة إعادة تحميل الصفحة: قفل الخزنة ثم رسم الشاشة من جديد */
    VB.lock();
    ok('الخزنة مقفلة الآن', VB.isUnlocked() === false);
    const hostU = envDoc.createElement('div');
    envDoc.body.appendChild(hostU);
    lockB.destroy();
    lockB.render(hostU, {});
    ok('شاشة الدخول تظهر بعد إعادة التحميل', !!hostU.querySelector('#lock-unlock-submit'));
    ok('خانة الرمز تظهر (الثنائية مفعّلة)', !!hostU.querySelector('#lock-code'));
    ok('اسم المستخدم معروض من الخزنة الحقيقية', hostU.textContent.includes('سيف'));
    const timerTxt = hostU.querySelector('#lock-otp-timer').textContent;
    ok('عدّاد الرمز يعمل من vault الحقيقي', /\d+\s*ثانية/.test(timerTxt), timerTxt);

    hostU.querySelector('#lock-password').value = 'wrong-password-2026';
    hostU.querySelector('#lock-code').value = VB.totp.code(secret, {});
    hostU.querySelector('#lock-unlock-submit').click();
    await waitFor(() => !hostU.querySelector('#lock-error').classList.contains('hidden'), 40000);
    const errR = hostU.querySelector('#lock-error');
    ok('كلمة سر خاطئة → رسالة «كلمة السر غير صحيحة»', errR.textContent.includes('كلمة السر غير صحيحة'), errR.textContent);
    ok('الخزنة ما زالت مقفلة', VB.isUnlocked() === false);

    realReloads = 0;
    hostU.querySelector('#lock-password').value = 'Masrofi-2026-pass';
    hostU.querySelector('#lock-code').value = VB.totp.code(secret, {});
    hostU.querySelector('#lock-unlock-submit').click();
    const opened = await waitFor(() => VB.isUnlocked() === true, 40000);
    ok('الدخول الصحيح يفتح الخزنة الحقيقية', opened);
    ok('وإعادة تحميل الصفحة تحدث بعد النجاح', realReloads > 0);
    const stateReal = await VB.load();
    eq('load() يعيد الحالة المهاجَرة من الخزنة الحقيقية', stateReal && stateReal.marker, 'legacy-state');
    eq('حركات ما قبل الخزنة وصلت مشفّرة', stateReal && stateReal.transactions && stateReal.transactions.length, 1);
  }
  lockB.destroy();
}

/* ==================================================================== 13 */
console.log('\n=== 13) تكامل البوابة: تهجير الحالة إلى الخزنة + App.afterAuth بدل إعادة التحميل ===');
{
  /* أ) تمرير الحالة الحالية إلى setup حتى لا تضيع بيانات ما قبل الخزنة */
  const first = fresh({ configured: false, setupResult: { ok: true } });
  const savedStore = Fin.Store;
  Fin.Store = { snapshotForVault: () => ({ marker: 'legacy-state', transactions: [{ id: 't1' }] }) };
  byName(first.host, 'username').value = 'سيف';
  byName(first.host, 'password').value = 'Masrofi-2026-pass';
  byName(first.host, 'confirm').value = 'Masrofi-2026-pass';
  click(first.host.querySelector('#lock-setup-submit'));
  await flush();
  const setupArgs = (first.vault.calls.filter((c) => c.fn === 'setup')[0] || {}).args || {};
  eq('setup يستلم الحالة الحالية في state', setupArgs.state && setupArgs.state.marker, 'legacy-state');
  ok('مفاتيح العقد أولاً كما هي', Object.keys(setupArgs).join(',').indexOf('username,password,hint,enable2FA') === 0, Object.keys(setupArgs).join(','));
  Fin.Store = savedStore;

  /* ب) نجاح الدخول مع بوابة app.js: afterAuth بدل إعادة التحميل (المفتاح يبقى في الذاكرة) */
  const s2 = fresh({ configured: true, twofa: false, user: 'سيف' });
  let authCalls = 0;
  Fin.App = { afterAuth() { authCalls++; return Promise.resolve(true); } };
  reloads = 0;
  s2.host.querySelector('#lock-password').value = 'Masrofi-2026-pass';
  click(s2.host.querySelector('#lock-unlock-submit'));
  await flush();
  eq('App.afterAuth نُودي مرة واحدة', authCalls, 1);
  eq('ولا إعادة تحميل بعده', reloads, 0);

  /* ج) لو رجعت البوابة false نعود لإعادة التحميل */
  const s3 = fresh({ configured: true, twofa: false, user: 'سيف' });
  Fin.App = { afterAuth() { return Promise.resolve(false); } };
  reloads = 0;
  s3.host.querySelector('#lock-password').value = 'Masrofi-2026-pass';
  click(s3.host.querySelector('#lock-unlock-submit'));
  await flush();
  eq('afterAuth = false → إعادة تحميل احتياطية', reloads, 1);

  /* د) بلا بوابة (اختبار مستقل): إعادة التحميل هي السلوك */
  const s4 = fresh({ configured: true, twofa: false, user: 'سيف' });
  Fin.App = undefined;
  reloads = 0;
  s4.host.querySelector('#lock-password').value = 'Masrofi-2026-pass';
  click(s4.host.querySelector('#lock-unlock-submit'));
  await flush();
  eq('بلا App.afterAuth → إعادة تحميل', reloads, 1);
  lock.destroy();
}

console.log('\n────────────────────────────────────────');
console.log('PASS ' + pass + ' / FAIL ' + fail);
if (failures.length) {
  console.log('\nالإخفاقات:');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exitCode = fail ? 1 : 0;
