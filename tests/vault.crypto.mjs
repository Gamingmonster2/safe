#!/usr/bin/env node
/* =============================================================================
 * مصروفي — tests/vault.crypto.mjs   (ملك vault-dev)
 *
 * تحقق ذاتي لخزنة التشفير (assets/js/vault.js) بلا أي مكتبة خارجية:
 *   • يحمّل constants.js + util.js + vault.js في globalThis عبر vm.runInThisContext.
 *   • يوفّر localStorage و sessionStorage وهميين (Map) كي لا نلمس قرصاً.
 *   • يغطي حالات القسم 7 من docs/AUTH.md + الحالات العشر المطلوبة في المهمة.
 *   • فحص ساكن للأمان: لا innerHTML/eval/document.write/console.log في vault.js.
 *
 * التشغيل: node tests/vault.crypto.mjs      (exit code 1 عند أي FAIL)
 * ========================================================================== */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = (rel) => join(ROOT, rel);

/* ============================================================ عدّاد النتائج */
let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    fail++;
    console.log('  \u2717 ' + name + '  →  ' + (e && e.message ? e.message : String(e)));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'شرط غير محقق'); }
function eq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error((msg || 'عدم تطابق') + ': ' + ja + '  ≠  ' + jb);
}
function section(t) { console.log('\n' + t); }

/* ======================================================= تخزين وهمي (Map) */
function makeStorage(label) {
  const map = new Map();
  return {
    _label: label,
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { const s = String(k); return map.has(s) ? map.get(s) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    _dump() {
      const out = {};
      for (const k of Array.from(map.keys()).sort()) out[k] = map.get(k);
      return out;
    }
  };
}
const LS = makeStorage('localStorage');
const SS = makeStorage('sessionStorage');
globalThis.localStorage = LS;
globalThis.sessionStorage = SS;

/* ======================================================== تحميل ملفات المشروع */
function loadScript(rel) {
  const src = readFileSync(P(rel), 'utf8');
  vm.runInThisContext(src, { filename: rel });
}
loadScript('assets/js/constants.js');
loadScript('assets/js/util.js');
loadScript('assets/js/vault.js');

const Fin = globalThis.Fin;
const V = Fin && Fin.Vault;
assert(V, 'Fin.Vault غير معرّف بعد تحميل vault.js');

const VAULT_SRC = readFileSync(P('assets/js/vault.js'), 'utf8');

/* ================================================================== بيانات */
const USER = 'سيف الدين';
const PW = 'كلمة-سر-قوية-2026!';
const PW2 = 'كلمة-سر-جديدة-2027!';
const DATA = {
  owner: 'سيف الدين',
  opened: { cash: 5000, saving: 1500, total: 6500 },
  accounts: [
    { id: 'cash', name: 'الصندوق (نقد)', balance: 8098 },
    { id: 'saving', name: 'مدخرات / احتياطي', balance: 1500 }
  ],
  transactions: [
    { date: '2026-10-05', type: 'expense', amount: 5500, category: 'school_tuition', note: 'رسوم مدرسة ابنتي' },
    { date: '2026-10-05', type: 'income', amount: 1900, category: 'rent_workshop', note: 'ورشة السمكرة والطلاء' }
  ],
  note: 'ابنتي'
};
const SECRET_PATTERNS = ['8098', '5500', 'ابنتي', 'school_tuition', PW, 'السمكرة'];

/* ================================================================== مساعدات */
async function freshVault(opts) {
  V.lock();
  V.reset();
  LS.clear();
  SS.clear();
  const r = await V.setup(Object.assign({ username: USER, password: PW }, opts || {}));
  assert(r.ok, 'setup فشل: ' + JSON.stringify(r));
  return r;
}
function storageText(s) { return JSON.stringify(s._dump()); }
function vaultRaw() { return JSON.parse(LS.getItem('masrofi.vault.v1')); }
function metaRaw() { return JSON.parse(LS.getItem('masrofi.vault.meta')); }
function codeNotInWindow(secret) {
  const now = Date.now();
  const valid = new Set([-1, 0, 1].map((k) => V.totp.code(secret, { at: now + k * 30000 })));
  for (let i = 0; i < 50; i++) {
    const c = String(100000 + i * 7919).slice(0, 6);
    if (!valid.has(c)) return c;
  }
  throw new Error('تعذّر إيجاد رمز غير صالح');
}
async function expectFail(p, reason, label) {
  const r = await p;
  assert(r && r.ok === false, (label || '') + ' كان يجب أن يفشل لكنه نجح: ' + JSON.stringify(r));
  if (reason) eq(r.reason, reason, (label || '') + ' reason');
  return r;
}

/* ===========================================================================
 * 1) الإعداد → القفل → الفتح بكلمة صحيحة → نفس البيانات
 * ======================================================================== */
section('1) الإعداد ثم القفل ثم الفتح بكلمة سر صحيحة');

await test('الواجهة العامة تحتوي كل دوال القسم 3', () => {
  ['isSupported', 'isConfigured', 'isUnlocked', 'username', 'has2FA', 'meta', 'lock',
    'setup', 'unlock', 'load', 'save', 'saveNow', 'changePassword',
    'exportEncrypted', 'importEncrypted', 'reset'].forEach((k) => {
    assert(typeof V[k] === 'function', 'Vault.' + k + ' مفقودة أو ليست دالة');
  });
  ['generateSecret', 'code', 'verify', 'otpauthURI', 'remainingSeconds'].forEach((k) => {
    assert(typeof V.totp[k] === 'function', 'Vault.totp.' + k + ' مفقودة');
  });
  ['b64', 'b64d', 'utf8', 'random', 'constantTimeEqual'].forEach((k) => {
    assert(typeof V.utils[k] === 'function', 'Vault.utils.' + k + ' مفقودة');
  });
  assert(V.isSupported() === true, 'isSupported يجب أن تكون true في node 24');
});

await test('لا خزنة: isConfigured=false و unlock يعطي not-configured', async () => {
  V.lock(); V.reset(); LS.clear(); SS.clear();
  assert(V.isConfigured() === false, 'isConfigured يجب أن تكون false');
  assert(V.isUnlocked() === false, 'isUnlocked يجب أن تكون false');
  assert(V.username() === null, 'username يجب أن تكون null');
  assert(V.meta() === null, 'meta يجب أن تكون null');
  const r = await V.unlock({ password: PW });
  eq(r.reason, 'not-configured', 'reason');
  assert(V.load() === null || (await V.load()) === null, 'load يجب أن ترجع null');
});

await test('setup ينشئ خزنة مشفّرة ويفتحها ويضبط الميتا', async () => {
  const r = await freshVault({ hint: 'تلميح للذاكرة' });
  assert(r.ok === true, 'setup ok');
  assert(r.totpSecret === undefined, 'بلا 2FA لا يُرجَع سرّ');
  assert(V.isConfigured() === true, 'isConfigured');
  assert(V.isUnlocked() === true, 'isUnlocked بعد setup');
  eq(V.username(), USER, 'username');
  assert(V.has2FA() === false, 'has2FA=false');
  const m = V.meta();
  eq(m.username, USER, 'meta.username');
  assert(m.iter === 310000, 'iter=310000');
  eq(m.hint, 'تلميح للذاكرة', 'meta.hint');
  assert(typeof m.createdAt === 'string' && m.createdAt.length > 10, 'createdAt');
  const v = vaultRaw();
  assert(v.v === 1 && v.kdf === 'PBKDF2-SHA256' && v.iter === 310000, 'ترويسة الخزنة');
  assert(v.salt && V.utils.b64d(v.salt).length === 16, 'salt = 16 بايت');
  assert(v.verifier && V.utils.b64d(v.verifier).length === 32, 'verifier = 32 بايت');
  assert(V.utils.b64d(v.wrap.iv).length === 12, 'wrap.iv = 12 بايت');
  assert(V.utils.b64d(v.wrap.ct).length === 32 + 16, 'wrap.ct = MK(32) + tag(16)');
  assert(v.data === undefined, 'الخزنة الجديدة بلا data (فارغة حسب العقد)');
  assert(!v.totp, 'لا سجل totp بلا تفعيل');
  assert(metaRaw().username === USER, 'الميتا في localStorage');
  // بعد أول حفظ يظهر data
  await V.saveNow(DATA);
  assert(V.utils.b64d(vaultRaw().data.iv).length === 12, 'data.iv = 12 بايت');
});

await test('خزنة فارغة: load=null (كي يعيد Store البذرة) و setup({state}) يحفظ الحالة', async () => {
  await freshVault();
  assert((await V.load()) === null, 'load على خزنة فارغة = null');
  await V.saveNow(DATA);
  eq(await V.load(), DATA, 'بعد الحفظ');
  // تمرير الحالة وقت الإعداد يُشفّرها فوراً
  V.lock(); V.reset(); LS.clear(); SS.clear();
  const r = await V.setup({ username: USER, password: PW, state: DATA });
  assert(r.ok === true, 'setup بمعلَمة state');
  eq(await V.load(), DATA, 'الحالة الممرَّرة محفوظة');
});

await test('القفل يمسح المفتاح من الذاكرة فقط (الخزنة تبقى)', async () => {
  await freshVault();
  await V.saveNow(DATA);
  const before = storageText(LS);
  V.lock();
  assert(V.isUnlocked() === false, 'isUnlocked=false بعد القفل');
  eq(storageText(LS), before, 'القفل لا يغيّر التخزين');
  eq(await V.load(), null, 'load بعد القفل = null');
  const w = await V.save(DATA);
  assert(w.ok === false, 'save والخزنة مقفلة يجب أن تفشل');
});

await test('فتح بكلمة صحيحة يعيد نفس البيانات بالحرف', async () => {
  await freshVault();
  await V.saveNow(DATA);
  V.lock();
  const u = await V.unlock({ password: PW });
  eq(u, { ok: true }, 'unlock');
  eq(await V.load(), DATA, 'البيانات بعد الفتح');
  // البايتات المشفّرة لم تتغيّر بالفتح
  const v1 = vaultRaw();
  V.lock();
  await V.unlock({ password: PW });
  eq(vaultRaw().data.ct, v1.data.ct, 'data.ct ثابت (الفتح لا يكتب)');
});

/* ===========================================================================
 * 2) كلمة سر خاطئة → bad-password والخزنة سليمة
 * ======================================================================== */
section('2) كلمة سر خاطئة: رفض + سلامة الخزنة والبيانات');

await test('كلمة خطأ: reason=bad-password ولا تتغير بايتات localStorage', async () => {
  await freshVault();
  await V.saveNow(DATA);
  V.lock();
  const before = storageText(LS);
  const r = await expectFail(V.unlock({ password: PW + 'x' }), 'bad-password', 'unlock');
  assert(!/kek|mk|key/i.test(JSON.stringify(r)), 'رسالة الخطأ لا تسرّب شيئاً عن المفاتيح');
  eq(storageText(LS), before, 'localStorage قبل/بعد كلمة الخطأ');
  assert(V.isUnlocked() === false, 'لا فتح عند الخطأ');
  SS.clear();
  const ok = await V.unlock({ password: PW });
  eq(ok, { ok: true }, 'الفتح الصحيح بعد محاولة فاشلة');
  eq(await V.load(), DATA, 'البيانات سليمة بعد المحاولة الفاشلة');
});

/* ===========================================================================
 * 3) المصادقة الثنائية
 * ======================================================================== */
section('3) المصادقة الثنائية (TOTP)');

await test('setup مع 2FA يرجّع السرّ و otpauthURI ولا يخزّن السرّ نصاً صريحاً', async () => {
  const r = await freshVault({ enable2FA: true });
  assert(typeof r.totpSecret === 'string' && /^[A-Z2-7]{32}$/.test(r.totpSecret), 'سرّ base32 (20 بايت بلا حشو)');
  assert(/^otpauth:\/\/totp\//.test(r.otpauthURI), 'otpauth URI');
  assert(r.otpauthURI.indexOf(encodeURIComponent(r.totpSecret)) > 0, 'السرّ داخل الـ URI');
  assert(V.has2FA() === true, 'has2FA');
  const v = vaultRaw();
  assert(v.totp && v.totp.enabled === true, 'سجل totp مفتوح');
  assert(v.totp.digits === 6 && v.totp.period === 30 && v.totp.algo === 'SHA-1', 'معاملات TOTP');
  assert(v.totp.secret !== r.totpSecret, 'السرّ مخزَّن مشفّراً لا نصاً');
  assert(storageText(LS).indexOf(r.totpSecret) < 0, 'السرّ غير موجود نصاً في localStorage');
});

await test('رمز صحيح يفتح · رمز خاطئ bad-code · بلا رمز bad-code', async () => {
  const r = await freshVault({ enable2FA: true });
  const secret = r.totpSecret;
  await V.saveNow(DATA);
  V.lock();

  const good = V.totp.code(secret);
  eq(await V.unlock({ password: PW, code: good }), { ok: true }, 'رمز صحيح');
  eq(await V.load(), DATA, 'البيانات بالرمز الصحيح');
  V.lock();

  SS.clear();
  await expectFail(V.unlock({ password: PW, code: codeNotInWindow(secret) }), 'bad-code', 'رمز خاطئ');
  assert(V.isUnlocked() === false, 'لا فتح برمز خاطئ');

  SS.clear();
  await expectFail(V.unlock({ password: PW }), 'bad-code', 'بلا رمز');

  SS.clear();
  await expectFail(V.unlock({ password: PW + 'x', code: good }), 'bad-password', 'كلمة خطأ مع رمز صحيح');

  SS.clear();
  eq(await V.unlock({ password: PW, code: good }), { ok: true }, 'يفتح بعد المحاولات الفاشلة');
  eq(await V.load(), DATA, 'البيانات سليمة');
});

await test('نافذة ±1 فترة تُقبل (RFC 6238 §5.2)', async () => {
  const r = await freshVault({ enable2FA: true });
  const secret = r.totpSecret;
  await V.saveNow(DATA);
  const now = Date.now();

  V.lock(); SS.clear();
  eq(await V.unlock({ password: PW, code: V.totp.code(secret, { at: now - 30000 }) }), { ok: true }, 'الفترة السابقة');
  eq(await V.load(), DATA, 'البيانات مع الفترة السابقة');

  V.lock(); SS.clear();
  eq(await V.unlock({ password: PW, code: V.totp.code(secret, { at: now + 30000 }) }), { ok: true }, 'الفترة التالية');

  V.lock(); SS.clear();
  await expectFail(V.unlock({ password: PW, code: V.totp.code(secret, { at: now + 90000 }) }), 'bad-code', 'خارج النافذة (‎+3 فترات)');

  SS.clear();
  eq(await V.unlock({ password: PW, code: V.totp.code(secret) }), { ok: true }, 'الرمز الحالي بعد كل ذلك');

  // لمسة عربية: الرمز بالأرقام العربية-الهندية (٠١٢…) يُقبل أيضاً
  const toArabic = (s) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
  V.lock(); SS.clear();
  const arCode = toArabic(V.totp.code(secret));
  assert(arCode !== V.totp.code(secret), 'التحويل إلى أرقام عربية');
  eq(await V.unlock({ password: PW, code: arCode }), { ok: true }, 'رمز بالأرقام العربية');
});

await test('remainingSeconds دائماً بين 1 و period', () => {
  for (let t = 0; t < 130; t += 7) {
    const s = V.totp.remainingSeconds({ at: t * 1000 });
    assert(s >= 1 && s <= 30, 'المتبقي خارج المدى عند t=' + t + ' (' + s + ')');
  }
  eq(V.totp.remainingSeconds({ period: 60, at: 0 }), 60, 'period=60');
});

/* ===========================================================================
 * 4) متجهات RFC 6238
 * ======================================================================== */
section('4) متجهات RFC 6238 المعروفة');

await test('السرّ القياسي 12345678901234567890 عند 59s/1111111109s/1234567890s', () => {
  const s = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  eq(V.totp.code(s, { at: 59000 }), '287082', 't=59s');
  eq(V.totp.code(s, { at: 1111111109000 }), '081804', 't=1111111109s');
  eq(V.totp.code(s, { at: 1234567890 * 1000 }), '005924', 't=1234567890s');
  eq(V.totp.code(s, { at: new Date(59000) }), '287082', 'at كائن Date');
  assert(V.totp.verify(s, '287082', { window: 0, at: 59000 }) === true, 'verify صحيح');
  assert(V.totp.verify(s, '287082', { window: 0, at: 59000 + 30000 }) === false, 'verify خارج النافذة');
  assert(V.totp.verify(s, '287082', { window: 1, at: 59000 + 30000 }) === true, 'verify داخل النافذة');
  eq(V.totp.remainingSeconds({ at: 59000 }), 1, 'المتبقي عند 59s');
  eq(V.totp.remainingSeconds({ at: 60000 }), 30, 'المتبقي عند 60s');
});

/* ===========================================================================
 * 5) لا تسريب في localStorage
 * ======================================================================== */
section('5) localStorage بعد التشفير لا يحوي أرقام المستخدم ولا كلمة السر');

await test('فحص نصي: لا 8098 ولا 5500 ولا ابنتي ولا كلمة السر', async () => {
  await freshVault();
  await V.saveNow(DATA);
  const raw = storageText(LS) + '\u0000' + vaultRaw().data.ct;
  SECRET_PATTERNS.forEach((p) => {
    assert(raw.indexOf(p) < 0, 'التسريب: النص «' + p + '» ظهر في localStorage');
  });
  assert(LS.length >= 2, 'المفتاحان مخزّنان');
  console.log('      (حجم الخزنة المشفّرة: ' + LS.getItem('masrofi.vault.v1').length + ' محرفاً)');
});

/* ===========================================================================
 * 6) تصدير → استيراد
 * ======================================================================== */
section('6) exportEncrypted → importEncrypted');

await test('نسخة كاملة (خزنة + ميتا) تُستورد بنفس الأرقام', async () => {
  await freshVault();
  await V.saveNow(DATA);
  const ex = await V.exportEncrypted();
  assert(ex.ok === true && typeof ex.text === 'string', 'export ok');
  const parsed = JSON.parse(ex.text);
  assert(parsed.vault && parsed.vault.wrap, 'الملف يحوي خزنة');
  assert(parsed.meta && parsed.meta.username === USER, 'الملف يحوي ميتا');
  assert(ex.text.indexOf('8098') < 0 && ex.text.indexOf(PW) < 0, 'الملف المشفّر لا يحوي بيانات صريحة');

  V.reset();
  LS.clear();
  SS.clear();
  assert(V.isConfigured() === false, 'بعد المسح');
  const im = await V.importEncrypted(ex.text, { password: PW });
  assert(im.ok === true, 'import ok: ' + JSON.stringify(im));
  eq(im.state, DATA, 'الحالة المستوردة');
  assert(V.isConfigured() === true && V.isUnlocked() === true, 'الخزنة استُعيدت ومفتوحة');
  eq(V.username(), USER, 'الاسم بعد الاستيراد');
  eq(await V.load(), DATA, 'load بعد الاستيراد');
});

await test('استيراد بكلمة خطأ يُرفض ولا يكتب شيئاً', async () => {
  await freshVault();
  await V.saveNow(DATA);
  const ex = await V.exportEncrypted();
  V.reset(); LS.clear(); SS.clear();
  const before = storageText(LS);
  await expectFail(V.importEncrypted(ex.text, { password: PW + 'x' }), 'bad-password', 'استيراد بكلمة خطأ');
  eq(storageText(LS), before, 'لا كتابة عند الفشل');
  await expectFail(V.importEncrypted('{ليس JSON', { password: PW }), null, 'ملف تالف');
  await expectFail(V.importEncrypted('{"a":1}', { password: PW }), null, 'ملف بلا خزنة');
});

await test('استيراد نسخة بـ 2FA يتطلب الرمز الصحيح', async () => {
  const r = await freshVault({ enable2FA: true });
  await V.saveNow(DATA);
  const ex = await V.exportEncrypted();
  V.reset(); LS.clear(); SS.clear();
  await expectFail(V.importEncrypted(ex.text, { password: PW, code: codeNotInWindow(r.totpSecret) }), 'bad-code', 'رمز خاطئ');
  const im = await V.importEncrypted(ex.text, { password: PW, code: V.totp.code(r.totpSecret) });
  assert(im.ok === true, 'import بـ 2FA');
  eq(im.state, DATA, 'البيانات');
  assert(V.has2FA() === true, 'has2FA بعد الاستيراد');
});

/* ===========================================================================
 * 7) دورة كاملة
 * ======================================================================== */
section('7) دورة كاملة: setup → save → lock → unlock → load');

await test('نفس الحالة بالحرف عبر Web Crypto حقيقي في node', async () => {
  V.lock(); V.reset(); LS.clear(); SS.clear();
  const s = await V.setup({ username: USER, password: PW });
  assert(s.ok === true, 'setup');
  const w1 = await V.save(DATA);
  assert(w1.ok === true, 'save');
  V.lock();
  assert((await V.load()) === null, 'load مقفلة');
  assert((await V.unlock({ password: PW })).ok === true, 'unlock');
  eq(await V.load(), DATA, 'نفس الحالة');
  const w2 = await V.saveNow(Object.assign({}, DATA, { note: 'تحديث' }));
  assert(w2.ok === true, 'saveNow');
  V.lock();
  assert((await V.unlock({ password: PW })).ok === true, 'unlock ثانٍ');
  eq((await V.load()).note, 'تحديث', 'التحديث محفوظ');
});

/* ===========================================================================
 * 8) changePassword
 * ======================================================================== */
section('8) changePassword — إعادة لفّ المفتاح فقط');

await test('كلمة حالية خطأ تُرفض ولا تغيّر شيئاً', async () => {
  await freshVault();
  await V.saveNow(DATA);
  const before = storageText(LS);
  await expectFail(V.changePassword({ currentPassword: PW + 'x', newPassword: PW2 }), 'bad-password', 'تغيير بكلمة خطأ');
  eq(storageText(LS), before, 'لا تغيير في التخزين');
  await expectFail(V.changePassword({ currentPassword: PW, newPassword: 'قصيرة' }), null, 'كلمة جديدة قصيرة');
  eq(storageText(LS), before, 'لا تغيير بعد كلمة قصيرة');
});

await test('بالكلمة الصحيحة: تنجح، data لا يُعاد تشفيره، والقديمة تفشل', async () => {
  await freshVault();
  await V.saveNow(DATA);
  V.lock();
  await V.unlock({ password: PW });
  const v1 = vaultRaw();
  SS.clear();
  const r = await V.changePassword({ currentPassword: PW, newPassword: PW2 });
  assert(r.ok === true, 'changePassword: ' + JSON.stringify(r));
  const v2 = vaultRaw();
  eq(v2.data, v1.data, 'data لم يُعد تشفيره (نفس IV ونفس CT)');
  assert(v2.salt !== v1.salt, 'ملح جديد');
  assert(v2.verifier !== v1.verifier, 'verifier جديد');
  assert(v2.wrap.ct !== v1.wrap.ct, 'التغليف أُعيد');
  assert(V.isUnlocked() === true, 'ما زالت مفتوحة بعد التغيير');
  eq(await V.load(), DATA, 'البيانات بعد التغيير');

  V.lock(); SS.clear();
  await expectFail(V.unlock({ password: PW }), 'bad-password', 'الكلمة القديمة');
  SS.clear();
  eq(await V.unlock({ password: PW2 }), { ok: true }, 'الكلمة الجديدة');
  eq(await V.load(), DATA, 'البيانات بالكلمة الجديدة');
});

await test('تغيير كلمة السر مع 2FA يتطلب الرمز ويحافظ على الثنائية', async () => {
  const s = await freshVault({ enable2FA: true });
  const secret = s.totpSecret;
  await V.saveNow(DATA);
  V.lock();
  SS.clear();
  await expectFail(V.changePassword({ currentPassword: PW, code: codeNotInWindow(secret), newPassword: PW2 }), 'bad-code', 'رمز خاطئ');
  SS.clear();
  const r = await V.changePassword({ currentPassword: PW, code: V.totp.code(secret), newPassword: PW2 });
  assert(r.ok === true, 'تغيير مع 2FA: ' + JSON.stringify(r));
  assert(V.has2FA() === true, 'الثنائية باقية');
  V.lock(); SS.clear();
  await expectFail(V.unlock({ password: PW, code: V.totp.code(secret) }), 'bad-password', 'الكلمة القديمة');
  SS.clear();
  eq(await V.unlock({ password: PW2, code: V.totp.code(secret) }), { ok: true }, 'الجديدة + الرمز');
  eq(await V.load(), DATA, 'البيانات');
});

/* ===========================================================================
 * 9) الأدوات
 * ======================================================================== */
section('9) utils.random و utils.constantTimeEqual');

await test('random: بلا تكرار، بالطول المطلوب، وعشوائي فعلاً', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const r = V.utils.random(16);
    assert(r instanceof Uint8Array && r.length === 16, 'random(16)');
    seen.add(V.utils.b64(r));
  }
  eq(seen.size, 200, 'قيم random متمايزة');
  const bytes = V.utils.random(32);
  assert(new Set(Array.from(bytes)).size > 3, 'البايتات ليست ثابتة');
});

await test('constantTimeEqual: صحيحة للحالات كلها', () => {
  const ct = V.utils.constantTimeEqual;
  assert(ct(V.utils.utf8('abc'), V.utils.utf8('abc')) === true, 'متساويان');
  assert(ct(V.utils.utf8('abc'), V.utils.utf8('abd')) === false, 'مختلفان');
  assert(ct(V.utils.utf8('abc'), V.utils.utf8('abcd')) === false, 'طولان مختلفان');
  assert(ct(V.utils.b64d('AAAA'), V.utils.b64d('AAAA')) === true, 'base64');
  assert(ct(V.utils.b64d('AAAA'), V.utils.b64d('AAAB')) === false, 'base64 مختلف');
  assert(ct(new Uint8Array(0), new Uint8Array(0)) === false, 'فراغ = false');
  assert(ct(null, V.utils.utf8('a')) === false, 'null');
});

await test('b64/b64d/utf8 تروح وتجيء بلا خسارة (نص عربي)', () => {
  const s = 'ورشة السمكرة 1,900 د.ل — ابنتي';
  eq(V.utils.utf8d(V.utils.utf8(s)), s, 'utf8');
  const bytes = V.utils.random(37);
  eq(Array.from(V.utils.b64d(V.utils.b64(bytes))), Array.from(bytes), 'base64 37 بايت');
  eq(V.utils.b64(new Uint8Array([0, 1, 2])), 'AAEC', 'base64 معروف');
  eq(V.utils.b64d('AAEC').length, 3, 'فك base64');
});

/* ===========================================================================
 * 10) الأداء
 * ======================================================================== */
section('10) أداء PBKDF2 (310,000 دورة)');

await test('الاشتقاق الواحد أقل من 3 ثوان', async () => {
  await freshVault();
  await V.saveNow(DATA);
  V.lock();
  SS.clear();
  const t0 = Date.now();
  await expectFail(V.unlock({ password: PW + 'x' }), 'bad-password', 'قياس');
  const one = Date.now() - t0;
  const t1 = Date.now();
  await V.unlock({ password: PW });
  const open = Date.now() - t1;
  console.log('      PBKDF2 310k: اشتقاق واحد = ' + one + 'ms · فتح كامل = ' + open + 'ms');
  assert(one < 3000, 'PBKDF2 أبطأ من 3 ثوان (' + one + 'ms)');
  assert(open < 3000, 'الفتح أبطأ من 3 ثوان (' + open + 'ms)');
});

/* ===========================================================================
 * 11) إضافات: القفل المؤقت، reset، سلامة البيانات
 * ======================================================================== */
section('11) إضافات: القفل المؤقت و reset والعزل');

await test('بعد 5 محاولات فاشلة: reason=locked-out في sessionStorage فقط', async () => {
  await freshVault();
  await V.saveNow(DATA);
  V.lock();
  SS.clear();
  const before = storageText(LS);
  for (let i = 0; i < 5; i++) {
    await expectFail(V.unlock({ password: 'خطأ-' + i }), 'bad-password', 'محاولة ' + (i + 1));
  }
  const r = await expectFail(V.unlock({ password: PW }), 'locked-out', 'المحاولة السادسة');
  assert(/انتظر/.test(r.error), 'رسالة الانتظار');
  eq(storageText(LS), before, 'الخزنة لم تُمس خلال القفل المؤقت');
  assert(SS.getItem('masrofi.vault.lockout'), 'العدّاد في sessionStorage');
  SS.clear();
  eq(await V.unlock({ password: PW }), { ok: true }, 'يفتح بعد انتهاء/مسح العدّاد');
});

await test('reset يمسح الخزنة والميتا فقط ولا يمسّ finapp.v1', async () => {
  await freshVault();
  await V.saveNow(DATA);
  LS.setItem('finapp.v1', '{"legacy":true}');
  LS.setItem('masrofi.theme', 'dark');
  const r = V.reset();
  assert(r && r.ok === true, 'reset ok');
  assert(LS.getItem('masrofi.vault.v1') === null, 'الخزنة مُسحت');
  assert(LS.getItem('masrofi.vault.meta') === null, 'الميتا مُسحت');
  eq(LS.getItem('finapp.v1'), '{"legacy":true}', 'finapp.v1 باقية (مسؤولية store.js)');
  eq(LS.getItem('masrofi.theme'), 'dark', 'مفاتيح أخرى باقية');
  assert(V.isUnlocked() === false, 'مقفلة بعد المسح');
  assert(V.isConfigured() === false, 'غير مهيّأة');
});

await test('setup مرفوض إن وُجدت خزنة، وكلمة السر القصيرة مرفوضة', async () => {
  await freshVault();
  const again = await V.setup({ username: USER, password: PW2 });
  assert(again.ok === false, 'لا إعداد فوق خزنة قائمة');
  V.reset(); LS.clear();
  const short = await V.setup({ username: USER, password: '1234567' });
  assert(short.ok === false && /8/.test(short.error), 'كلمة 7 محارف مرفوضة');
  const noName = await V.setup({ username: '   ', password: PW });
  assert(noName.ok === false, 'اسم فارغ مرفوض');
  assert(LS.getItem('masrofi.vault.v1') === null, 'لا خزنة بعد محاولات فاشلة');
});

/* ===========================================================================
 * 12) فحص ساكن للأمان + عدم تسريب المفاتيح في العائدات
 * ======================================================================== */
section('12) فحص ساكن للأمان');

await test('vault.js: لا innerHTML ولا eval ولا document.write ولا console.log', () => {
  // نفحص الكود بعد إزالة التعليقات (التعليقات تذكر هذه الكلمات للتحذير فقط)
  const codeOnly = VAULT_SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
  const banned = [
    [/innerHTML/, 'innerHTML'],
    [/\beval\s*\(/, 'eval'],
    [/document\s*\.\s*write/, 'document.write'],
    [/console\s*\./, 'console'],
    [/\bnew\s+Function\b/, 'new Function'],
    [/\bimport\s+[\w{*]/, 'import'],
    [/\bexport\s+(default|const|function|\{)/, 'export']
  ];
  banned.forEach(([re, name]) => assert(!re.test(codeOnly), 'ممنوع: ' + name));
  assert(/use strict/.test(VAULT_SRC), "'use strict'");
  assert(/crypto\.subtle|subtle\(\)/.test(VAULT_SRC), 'يستعمل Web Crypto');
  assert(/PBKDF2/.test(VAULT_SRC) && /310000|ITER/.test(VAULT_SRC), 'PBKDF2 310k');
  assert(/AES-GCM/.test(VAULT_SRC), 'AES-GCM');
});

await test('يعمل في سياق معزول بلا TextEncoder/TextDecoder (مسار الاحتياط)', async () => {
  const ctx = vm.createContext({ crypto: globalThis.crypto, localStorage: LS, sessionStorage: SS });
  vm.runInContext(VAULT_SRC, ctx, { filename: 'vault.js@isolated' });
  const V2 = ctx.Fin && ctx.Fin.Vault;
  assert(V2 && typeof V2.setup === 'function', 'Fin.Vault داخل السياق المعزول');
  eq(Array.from(V2.utils.utf8('ابنتي 8098 — ورشة')), Array.from(V.utils.utf8('ابنتي 8098 — ورشة')), 'utf8 بلا TextEncoder');
  eq(V2.utils.utf8d(V.utils.utf8('ورشة السمكرة والطلاء')), 'ورشة السمكرة والطلاء', 'utf8d بلا TextDecoder');

  V.lock(); V.reset(); LS.clear(); SS.clear();
  const r = await V2.setup({ username: USER, password: PW });
  assert(r.ok === true, 'setup في السياق المعزول: ' + JSON.stringify(r));
  await V2.saveNow(DATA);
  V2.lock();
  assert((await V2.unlock({ password: PW })).ok === true, 'unlock في السياق المعزول');
  eq(await V2.load(), DATA, 'البيانات في السياق المعزول');
});

await test('لا يُصدَّر أي مفتاح أو سرّ في العائدات أو في الميتا', async () => {
  const s = await freshVault({ enable2FA: true });
  await V.saveNow(DATA);
  const keys = ['mk', 'kek', 'key', 'masterKey', 'password', 'secret'];
  const m = V.meta();
  keys.forEach((k) => assert(!(k in m), 'meta تحوي ' + k));
  const ex = await V.exportEncrypted();
  const v = JSON.parse(ex.text).vault;
  keys.forEach((k) => assert(!(k in v), 'الخزنة تحوي ' + k));
  assert(JSON.stringify(s).indexOf(PW) < 0, 'setup لا يرجّع كلمة السر');
  const ls = vaultRaw();
  ls.totp.secretIv && assert(V.utils.b64d(ls.totp.secretIv).length === 12, 'IV السرّ 12 بايت');
});

/* ===========================================================================
 * النتيجة
 * ======================================================================== */
console.log('\n' + '='.repeat(56));
console.log('PASS ' + pass + ' / FAIL ' + fail);
console.log('='.repeat(56));
if (fail > 0) process.exitCode = 1;
