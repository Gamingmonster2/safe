/* =============================================================================
 * مصروفي — views/lock.js
 * شاشة القفل (hidden: لا تظهر في شريط التنقل) ولها ثلاث حالات:
 *   1) setup  — لا توجد خزنة: إنشاء الحساب + مؤشر قوة كلمة السر + مفتاح الثنائية.
 *   2) totp   — عرض سرّ المصادقة الثنائية مرة واحدة + تأكيد الرمز.
 *   3) unlock — توجد خزنة: كلمة السر (+ الرمز إن كانت الثنائية مفعّلة) وعدّاد التجديد.
 *
 * العقد الملزم: docs/AUTH.md §3 (Fin.Vault) و§5 (هذه الشاشة).
 * قواعد: بلا إيموجي (كل رمز من Fin.I) · كل عنصر يُبنى بـ U.el بلا حقن HTML خام · بلا طبع أي سرّ.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var U = Fin.U, UI = Fin.UI;
  Fin.Views = Fin.Views || {};

  /* ------------------------------------------------------- سياسة الشاشة */
  var MIN_USER = 3;          // أقل طول لاسم المستخدم
  var MIN_PW = 8;            // أقل طول لكلمة السر (AUTH §5)
  var STRONG_LEN = 12;       // «قوية» = 12 محرفاً مع تنوّع
  var OTP_DIGITS = 6;
  var OTP_PERIOD = 30;       // ثواني صلاحية رمز TOTP
  var MAX_FAILS = 5;         // بعدها تعطيل مؤقت
  var LOCKOUT_MS = 30000;    // مدة التعطيل
  var GUARD_KEY = 'masrofi.lock.guard.v1';   // sessionStorage فقط
  var APPS = 'Google Authenticator · Authy · Microsoft Authenticator · FreeOTP';
  var RECOVERY_NOTE = 'لا يوجد خادم يحفظ كلمة السر: صدّر نسخة احتياطية مشفّرة بعد التسجيل، فهي وسيلتك الوحيدة للتعافي.';

  /* سرّ الثنائية يبقى في الذاكرة فقط حتى يؤكّده المستخدم أو يتخطّاه — لا يُحفظ أبداً */
  var pendingTotp = null;
  /* دوال تنظيف المؤقتات (تُنفَّذ عند destroy) */
  var cleanups = [];

  function onDestroy(fn) { cleanups.push(fn); }
  function runCleanups() {
    for (var i = 0; i < cleanups.length; i++) {
      try { cleanups[i](); } catch (e) { /* تجاهل */ }
    }
    cleanups = [];
  }

  /* --------------------------------------------------------- أدوات صغيرة */

  function el(tag, attrs, children) { return U.el(tag, attrs, children); }

  function icon(name, opts) {
    opts = opts || {};
    if (!Fin.I) return el('span', { class: 'ic-wrap' });
    var key = (name && Fin.I.has(name)) ? name : (opts.fallback || 'lock');
    return Fin.I.el(key, { size: opts.size || 20, tone: opts.tone || null, width: opts.width });
  }

  function insertAfter(parent, node, ref) {
    if (!parent) return;
    var kids = Array.prototype.slice.call(parent.children || []);
    var i = kids.indexOf(ref);
    parent.insertBefore(node, (i >= 0 && i + 1 < kids.length) ? kids[i + 1] : null);
  }

  /* صندوق تنبيه بعنوان ونص يمكن تحديثهما بلا إعادة بناء */
  function statusBox(tone, icoName) {
    var title = el('div', { class: 'alert-title', text: '' });
    var body = el('div', { class: 'alert-body', text: '' });
    var box = el('div', { class: 'alert alert-' + tone + ' hidden' }, [
      el('div', { class: 'alert-ico' }, [icon(icoName, { size: 15, width: 2 })]),
      el('div', { class: 'alert-main' }, [title, body])
    ]);
    return {
      el: box,
      body: body,
      show: function (t, b) {
        title.textContent = t || '';
        body.textContent = b || '';
        box.classList.remove('hidden');
      },
      hide: function () { box.classList.add('hidden'); }
    };
  }

  function staticAlert(tone, icoName, titleText, bodyText) {
    var box = statusBox(tone, icoName);
    box.show(titleText, bodyText);
    return box.el;
  }

  function note(icoName, value) {
    return el('div', { class: 'lock-note' }, [icon(icoName, { size: 15 }), el('span', { text: value })]);
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (!label) return;
    var spans = btn.querySelectorAll ? btn.querySelectorAll('span') : [];
    var last = spans && spans.length ? spans[spans.length - 1] : null;
    if (last) last.textContent = label;
  }

  function setInputType(input, type) {
    if (!input) return;
    try { input.setAttribute('type', type); } catch (e) { /* تجاهل */ }
    try { input.type = type; } catch (e2) { /* تجاهل */ }
  }

  function copyText(value, okMessage) {
    var failMessage = 'تعذّر النسخ تلقائياً — حدّد النص وانسخه يدوياً.';
    Promise.resolve(U.copy(value)).then(function (done) {
      UI.toast(done ? okMessage : failMessage, done ? 'success' : 'info');
    }, function () { UI.toast(failMessage, 'info'); });
  }

  function reloadPage() {
    try {
      if (root.location && typeof root.location.reload === 'function') { root.location.reload(); return; }
    } catch (e) { /* تجاهل */ }
    try { if (root.location) root.location.href = root.location.href; } catch (e2) { /* تجاهل */ }
  }

  /* إنهاء المصادقة: المفتاح الرئيسي يعيش في الذاكرة فقط، فإعادة تحميل الصفحة بعده
     تُقفل الخزنة من جديد. لذلك نُسلّم الأمر إلى بوابة app.js (App.afterAuth) التي
     تُرطّب المخزن وتفتح التطبيق، ولا نعود لإعادة التحميل إلا إن غابت البوابة. */
  function finishAuth() {
    var App = Fin.App;
    if (App && typeof App.afterAuth === 'function') {
      try {
        return Promise.resolve(App.afterAuth()).then(function (ok) {
          if (ok === false) reloadPage();
        }, function () { reloadPage(); });
      } catch (e) { /* نكمل بالاحتياط */ }
    }
    reloadPage();
    return Promise.resolve(false);
  }

  /* ------------------------------------------------------- حالة Fin.Vault */

  function safeMeta(V) {
    try {
      var m = (V && typeof V.meta === 'function') ? V.meta() : null;
      return m || {};
    } catch (e) { return {}; }
  }
  function isConfigured(V) {
    try { return !!(V && typeof V.isConfigured === 'function' && V.isConfigured()); }
    catch (e) { return false; }
  }
  function has2FA(V) {
    try {
      if (V && typeof V.has2FA === 'function') return !!V.has2FA();
    } catch (e) { /* تجاهل */ }
    return !!safeMeta(V).has2fa;
  }

  /* عدّاد المحاولات — تخزين الجلسة فقط (sessionStorage، ولا تخزين دائم) */
  function guardStore() {
    try {
      var s = root.sessionStorage;
      if (s && typeof s.getItem === 'function') return s;
    } catch (e) { /* محجوب */ }
    return null;
  }
  function readGuard() {
    var s = guardStore();
    if (!s) return { fails: 0, until: 0 };
    try {
      var raw = s.getItem(GUARD_KEY);
      if (!raw) return { fails: 0, until: 0 };
      var o = JSON.parse(raw) || {};
      return { fails: Math.max(0, Number(o.fails) || 0), until: Math.max(0, Number(o.until) || 0) };
    } catch (e) { return { fails: 0, until: 0 }; }
  }
  function writeGuard(fails, until) {
    var s = guardStore();
    if (!s) return;
    try { s.setItem(GUARD_KEY, JSON.stringify({ fails: fails, until: until || 0, at: Date.now() })); } catch (e) { /* تجاهل */ }
  }
  function clearGuard() {
    var s = guardStore();
    if (!s) return;
    try { s.removeItem(GUARD_KEY); } catch (e) { /* تجاهل */ }
  }

  /* ------------------------------------------------- قوة كلمة السر */

  function varietyOf(s) {
    var n = 0;
    if (/[a-z]/.test(s)) n++;
    if (/[A-Z]/.test(s)) n++;
    if (/[0-9]/.test(s)) n++;
    if (/[^a-zA-Z0-9]/.test(s)) n++;
    return n;
  }
  function isRepeated(s) {
    if (s.length < 4) return false;
    if (/^(.)\1*$/.test(s)) return true;          // الحرف نفسه مكرّراً
    if (/(.)\1{2,}/.test(s)) return true;         // ثلاث نسخ متتالية على الأقل
    var seen = {}, i, count = 0;
    for (i = 0; i < s.length; i++) { if (!seen[s.charAt(i)]) { seen[s.charAt(i)] = 1; count++; } }
    return count <= 3 && s.length >= MIN_PW;      // أبجدية ضيقة جداً
  }
  var COMMON_PW = /^(?:password|passw0rd|123456|1234567|12345678|123456789|qwerty|azerty|iloveyou|welcome|admin|letmein|abc123|000000|111111|masrofi)/i;

  function evaluatePassword(pw) {
    var s = String(pw || '');
    if (!s.length) return { level: 'empty', label: 'لم تُكتب بعد', pct: 0, tone: '', reasons: [] };

    var len = s.length, reasons = [];
    var digitOnly = /^\d+$/.test(s);
    var letterOnly = /^[a-zA-Z]+$/.test(s);
    var repeated = isRepeated(s);
    var common = COMMON_PW.test(s);
    var variety = varietyOf(s);

    if (len < MIN_PW) reasons.push('أقل من ' + MIN_PW + ' محارف');
    if (digitOnly) reasons.push('أرقام فقط');
    else if (letterOnly) reasons.push('حروف لاتينية فقط بلا أرقام أو رموز');
    if (repeated) reasons.push('محارف مكرّرة أو نمط متكرّر');
    if (common) reasons.push('نمط شائع يسهل تخمينه');
    if (len >= MIN_PW && variety < 3) reasons.push('نوّع المحارف (كبيرة/صغيرة وأرقام ورموز)');

    var strong = len >= STRONG_LEN && variety >= 3 && !repeated && !common && !digitOnly;
    if (strong) return { level: 'strong', label: 'قوية', pct: 100, tone: '', reasons: [] };
    if (len < MIN_PW) {
      return { level: 'weak', label: 'قصيرة جداً', pct: Math.max(8, Math.round(len / MIN_PW * 55)), tone: 'progress-danger', reasons: reasons };
    }
    return { level: 'ok', label: 'مقبولة', pct: Math.min(80, 55 + (len - MIN_PW) * 3), tone: 'progress-warn', reasons: reasons };
  }

  /* ------------------------------------------------- 1) حالة الإعداد */

  function renderSetup(rootEl) {
    /* لا خزنة على الجهاز: أي سرّ ثنائية معلّق يخصّ خزنة زالت (reset أو استيراد) */
    pendingTotp = null;
    var shell = el('div', { class: 'lock-shell' });
    var card = el('div', { class: 'card lock-card' });

    card.appendChild(el('div', { class: 'lock-brand' }, [
      el('div', { class: 'lock-logo' }, [icon('lock', { size: 26 })]),
      el('div', { class: 'lock-brand-text' }, [
        el('h1', { class: 'lock-title', text: 'أنشئ حسابك لحماية بياناتك' }),
        el('div', { class: 'lock-sub', text: 'خطوة واحدة ثم يبقى كل شيء مشفّراً على جهازك.' })
      ])
    ]));

    card.appendChild(staticAlert('info', 'shield', 'تشفير على جهازك، بلا خادم',
      'كلمة السر لا تُرسل إلى أي خادم ولا تُحفظ كنص: يُشتقّ منها مفتاح التشفير داخل متصفحك، وتبقى حركاتك وأرصدتك مشفّرة في هذا الجهاز.'));

    var form = UI.form([
      {
        name: 'username', label: 'اسم المستخدم', type: 'text', required: true,
        autocomplete: 'username', placeholder: 'مثال: سيف',
        hint: 'يظهر في شاشة الدخول فقط — ' + MIN_USER + ' محارف على الأقل.'
      },
      {
        name: 'password', label: 'كلمة السر', type: 'password', required: true,
        autocomplete: 'new-password', placeholder: 'كلمة سر طويلة تتذكّرها',
        hint: MIN_PW + ' محارف على الأقل. لا يمكن استعادتها إن نُسيت — احفظها في مكان آمن.'
      },
      {
        name: 'confirm', label: 'تأكيد كلمة السر', type: 'password', required: true,
        autocomplete: 'new-password', placeholder: 'أعد كتابتها'
      },
      {
        name: 'hint', label: 'تلميح يتذكّرك بكلمة السر (اختياري)', type: 'text',
        hint: 'يُحفظ غير مشفّر في البيانات الوصفية — لا تكتب كلمة السر نفسها.'
      },
      {
        name: 'enable2FA', label: 'المصادقة الثنائية (TOTP) — موصى بها', type: 'checkbox',
        hint: 'رمز من ' + OTP_DIGITS + ' أرقام من تطبيق المصادقة مع كل دخول.'
      }
    ], { values: { enable2FA: true } });

    /* مؤشر القوة يُدرج مباشرة بعد خانة كلمة السر */
    var strengthLabel = el('div', { class: 'lock-strength-label', text: 'قوة كلمة السر: لم تُكتب بعد' });
    var strengthBar = el('div', { class: 'progress-bar' });
    var strengthTrack = el('div', { class: 'progress' }, [strengthBar]);
    var strengthReasons = el('div', { class: 'lock-strength-reasons', text: '' });
    var meter = el('div', { class: 'lock-strength', id: 'lock-strength' }, [strengthLabel, strengthTrack, strengthReasons]);

    var pwWrap = form.inputs.password && form.inputs.password.parentNode;
    if (pwWrap && pwWrap.parentNode) insertAfter(pwWrap.parentNode, meter, pwWrap);
    else form.el.appendChild(meter);

    function paintStrength() {
      var values = form.getValues();
      var r = evaluatePassword(values.password);
      strengthLabel.textContent = 'قوة كلمة السر: ' + r.label;
      strengthBar.style.width = r.pct + '%';
      strengthTrack.className = 'progress' + (r.tone ? ' ' + r.tone : '');
      if (r.level === 'strong') strengthReasons.textContent = 'كلمة سر قوية — أحسنت.';
      else if (r.reasons.length) strengthReasons.textContent = 'لتقويتها: ' + r.reasons.join(' · ');
      else strengthReasons.textContent = '';
    }
    if (form.inputs.password) form.inputs.password.addEventListener('input', paintStrength);

    card.appendChild(form.el);

    var errorBox = statusBox('danger', 'alert');
    errorBox.el.setAttribute('id', 'lock-error');
    card.appendChild(errorBox.el);

    var submit = UI.btn('أنشئ الحساب', { icon: 'shield', tone: 'primary', className: 'btn-block', onClick: onSubmit });
    submit.setAttribute('id', 'lock-setup-submit');
    card.appendChild(el('div', { class: 'lock-actions' }, [submit]));
    card.appendChild(note('download', RECOVERY_NOTE));

    var V = Fin.Vault;

    function onSubmit() {
      errorBox.hide();
      var values = form.getValues();
      var username = String(values.username === undefined || values.username === null ? '' : values.username).trim();
      var password = String(values.password === undefined || values.password === null ? '' : values.password);
      var confirm = String(values.confirm === undefined || values.confirm === null ? '' : values.confirm);
      var hint = String(values.hint === undefined || values.hint === null ? '' : values.hint).trim();

      if (username.length < MIN_USER) {
        errorBox.show('اسم المستخدم قصير', 'اكتب ' + MIN_USER + ' محارف على الأقل في اسم المستخدم.');
        var un = form.inputs.username; if (un && un.focus) un.focus();
        return;
      }
      if (password.length < MIN_PW) {
        paintStrength();
        errorBox.show('كلمة السر قصيرة جداً', 'كلمة السر يجب أن تكون ' + MIN_PW + ' محارف على الأقل. المؤشر بالأعلى يشرح سبب الضعف.');
        return;
      }
      if (password !== confirm) {
        errorBox.show('كلمتا السر غير متطابقتين', 'أعد كتابة كلمة السر نفسها في خانة التأكيد.');
        return;
      }
      if (!V || typeof V.setup !== 'function') {
        errorBox.show('وحدة الحماية غير متوفرة', 'لم يتم تحميل Fin.Vault — أعد تحميل الصفحة.');
        return;
      }

      var enable2FA = values.enable2FA !== false;
      var payload = { username: username, password: password, hint: hint, enable2FA: enable2FA };
      /* تهجير ما هو موجود (البذرة أو finapp.v1) إلى الخزنة عند إنشائها أول مرة */
      try {
        if (Fin.Store && typeof Fin.Store.snapshotForVault === 'function') payload.state = Fin.Store.snapshotForVault();
      } catch (e) { /* نُنشئ الخزنة فارغة على أي حال */ }

      setBusy(submit, true, 'جارٍ إنشاء الحساب…');
      Promise.resolve(V.setup(payload))
        .then(function (res) {
          if (!res || res.ok !== true) {
            setBusy(submit, false, 'أنشئ الحساب');
            errorBox.show('تعذّر إنشاء الخزنة', (res && res.error) ? String(res.error) : 'حدث خطأ غير متوقّع أثناء التشفير. حاول مرة أخرى.');
            return;
          }
          if (enable2FA && res.totpSecret) {
            showTotpState(rootEl, res.totpSecret, res.otpauthURI || '');
            return;
          }
          UI.toast('تم إنشاء الحساب وتشفير بياناتك', 'success');
          finishAuth();
        })
        .catch(function (err) {
          setBusy(submit, false, 'أنشئ الحساب');
          errorBox.show('خطأ غير متوقّع', String((err && err.message) || err || '').slice(0, 200));
        });
    }

    [form.inputs.username, form.inputs.password, form.inputs.confirm, form.inputs.hint].forEach(function (input) {
      if (!input || !input.addEventListener) return;
      input.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') onSubmit(); });
    });

    shell.appendChild(card);
    rootEl.appendChild(shell);
    paintStrength();
  }

  /* ------------------------------------- 2) حالة سرّ المصادقة الثنائية */

  function showTotpState(rootEl, secret, uri) {
    pendingTotp = { secret: String(secret), uri: String(uri || '') };
    renderTotp(rootEl, pendingTotp.secret, pendingTotp.uri);
  }

  function renderTotp(rootEl, secret, uri) {
    runCleanups();
    U.clear(rootEl);

    var shell = el('div', { class: 'lock-shell' });
    var card = el('div', { class: 'card lock-card' });

    card.appendChild(el('div', { class: 'lock-brand' }, [
      el('div', { class: 'lock-logo' }, [icon('shield', { size: 26 })]),
      el('div', { class: 'lock-brand-text' }, [
        el('h1', { class: 'lock-title', text: 'فعّل المصادقة الثنائية في تطبيق المصادقة' }),
        el('div', { class: 'lock-sub', text: 'خطوة أخيرة: اربط التطبيق ثم أكّد الرمز.' })
      ])
    ]));

    card.appendChild(staticAlert('info', 'phone', 'معظم الحاسبات لا تحتاج رمز QR',
      'اختر «إدخال مفتاح الإعداد» (Enter a setup key) في تطبيق المصادقة والصق السرّ أدناه يدوياً — بلا كاميرا وبلا مكتبات خارجية.'));

    card.appendChild(el('ol', { class: 'lock-steps' }, [
      el('li', { text: 'افتح تطبيق مصادقة: ' + APPS + '.' }),
      el('li', { text: 'أضف حساباً جديداً ثم اختر الإدخال اليدوي للمفتاح.' }),
      el('li', { text: 'الصق هذا السرّ (أو الرابط) في التطبيق ثم أدخل الرمز الظاهر للتأكيد.' })
    ]));

    var secretNode = el('div', {
      class: 'mono lock-secret', id: 'lock-secret', dir: 'ltr', tabindex: '0',
      role: 'textbox', 'aria-label': 'سرّ المصادقة الثنائية', text: secret
    });
    var copySecret = UI.btn('انسخ السرّ', { icon: 'copy', tone: 'ghost', size: 'sm', onClick: function () { copyText(secret, 'تم نسخ السرّ'); } });
    copySecret.setAttribute('id', 'lock-copy-secret');

    card.appendChild(el('div', { class: 'lock-field' }, [
      el('div', { class: 'field-label', text: 'السرّ (المفتاح اليدوي)' }),
      secretNode,
      copySecret,
      el('div', { class: 'field-hint', text: 'يُعرض مرة واحدة الآن ولا يمكن استرجاعه من التطبيق لاحقاً — احفظه في مكان آمن.' })
    ]));

    if (uri) {
      var uriNode = el('div', {
        class: 'mono lock-uri', id: 'lock-uri', dir: 'ltr', tabindex: '0',
        role: 'textbox', 'aria-label': 'رابط otpauth', text: uri
      });
      var copyUri = UI.btn('انسخ الرابط', { icon: 'copy', tone: 'ghost', size: 'sm', onClick: function () { copyText(uri, 'تم نسخ الرابط'); } });
      copyUri.setAttribute('id', 'lock-copy-uri');
      card.appendChild(el('div', { class: 'lock-field' }, [
        el('div', { class: 'field-label', text: 'رابط الإعداد (otpauth)' }),
        uriNode,
        copyUri
      ]));
    }

    var codeInput = el('input', {
      id: 'lock-totp-code', class: 'input lock-code', type: 'text', name: 'code',
      inputmode: 'numeric', maxlength: String(OTP_DIGITS), autocomplete: 'one-time-code',
      placeholder: '000000', 'aria-label': 'رمز المصادقة الثنائية'
    });
    codeInput.addEventListener('input', function () {
      var clean = String(codeInput.value || '').replace(/[^0-9]/g, '').slice(0, OTP_DIGITS);
      if (clean !== codeInput.value) codeInput.value = clean;
    });

    var verifyError = statusBox('danger', 'alert');
    verifyError.el.setAttribute('id', 'lock-totp-error');

    var verify = UI.btn('تأكيد وتفعيل', { icon: 'checkCircle', tone: 'primary', className: 'btn-block', onClick: onVerify });
    verify.setAttribute('id', 'lock-totp-verify');

    var skip = UI.btn('تخطّي — الدخول بكلمة السر فقط', { icon: 'key', tone: 'ghost', className: 'btn-block', onClick: onSkip });
    skip.setAttribute('id', 'lock-totp-skip');

    card.appendChild(el('div', { class: 'lock-field' }, [
      el('label', { class: 'field-label', for: 'lock-totp-code', text: 'أدخل الرمز المكوّن من ' + OTP_DIGITS + ' أرقام للتأكيد' }),
      codeInput
    ]));
    card.appendChild(verifyError.el);
    card.appendChild(el('div', { class: 'lock-actions' }, [verify, skip]));
    card.appendChild(staticAlert('warn', 'alert', 'التخطّي يضعف الحماية',
      'بلا مصادقة ثنائية تكفي كلمة السر وحدها لفتح الخزنة. إن كانت قد سُجّلت فعليك الاحتفاظ بالسرّ أعلاه.'));

    var V = Fin.Vault;

    function onVerify() {
      verifyError.hide();
      var code = String(codeInput.value || '').replace(/[^0-9]/g, '');
      if (code.length !== OTP_DIGITS) {
        verifyError.show('الرمز غير مكتمل', 'أدخل ' + OTP_DIGITS + ' أرقام من تطبيق المصادقة.');
        return;
      }
      var verified = false;
      try {
        if (V && V.totp && typeof V.totp.verify === 'function') verified = !!V.totp.verify(secret, code);
      } catch (e) { verified = false; }
      if (!verified) {
        verifyError.show('الرمز غير صحيح', 'تأكد أن ساعة الجهاز مضبوطة تلقائياً ثم أدخل الرمز الحالي. السرّ ما زال معروضاً أعلاه.');
        return;
      }
      pendingTotp = null;
      UI.toast('تم تفعيل المصادقة الثنائية', 'success');
      finishAuth();
    }

    function onSkip() {
      /* يُخفي خانة التحقق ثم يتابع بلا تأكيد — والثنائية تبقى مسجّلة في الخزنة،
         فنُبقي السرّ في الذاكرة (إعادة التحميل كانت ستُضيّعه وتقفل الحساب). */
      var field = codeInput.parentNode;
      if (field && field.classList) field.classList.add('hidden');
      if (verifyError && verifyError.hide) verifyError.hide();
      UI.toast('تخطّيت التفعيل — الثنائية مسجّلة وستُطلب في الدخول القادم، فاحفظ السرّ أعلاه', 'info');
      finishAuth();
    }

    codeInput.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') onVerify(); });

    shell.appendChild(card);
    rootEl.appendChild(shell);
    if (codeInput.focus) { try { codeInput.focus(); } catch (e) { /* تجاهل */ } }
  }

  /* ------------------------------------------------- 3) حالة الدخول */

  function renderUnlock(rootEl) {
    var V = Fin.Vault;
    var meta = safeMeta(V);
    var twoFactor = has2FA(V);
    var username = String(meta.username || (typeof V.username === 'function' ? V.username() : '') || '');
    var hint = String(meta.hint || '');

    var shell = el('div', { class: 'lock-shell' });
    var card = el('div', { class: 'card lock-card' });

    card.appendChild(el('div', { class: 'lock-brand' }, [
      el('div', { class: 'lock-logo' }, [icon('lock', { size: 26 })]),
      el('div', { class: 'lock-brand-text' }, [
        el('h1', { class: 'lock-title', text: 'مرحباً بعودتك' }),
        el('div', { class: 'lock-sub', text: 'بياناتك مشفّرة على هذا الجهاز — أدخل كلمة السر لفتحها.' })
      ])
    ]));

    card.appendChild(el('div', { class: 'lock-user-row' }, [
      icon('user', { size: 18, tone: 'brand' }),
      el('span', { class: 'lock-user-name', text: username || 'مستخدم' }),
      twoFactor ? UI.badge('ثنائية', 'info') : null
    ]));
    if (hint) card.appendChild(el('div', { class: 'lock-hint' }, [icon('info', { size: 14 }), el('span', { text: 'تلميحك: ' + hint })]));

    var pwInput = el('input', {
      id: 'lock-password', class: 'input lock-password', type: 'password', name: 'password',
      autocomplete: 'current-password', placeholder: 'كلمة السر', 'aria-label': 'كلمة السر'
    });
    var shown = false;
    var eye = el('button', {
      type: 'button', id: 'lock-pw-toggle', class: 'icon-btn lock-eye',
      title: 'إظهار كلمة السر', 'aria-label': 'إظهار كلمة السر',
      onClick: function () {
        shown = !shown;
        setInputType(pwInput, shown ? 'text' : 'password');
        var label = shown ? 'إخفاء كلمة السر' : 'إظهار كلمة السر';
        eye.setAttribute('aria-label', label);
        eye.setAttribute('title', label);
        eye.classList.toggle('is-on');
      }
    }, [icon('eye', { size: 20 })]);

    card.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'lock-password', text: 'كلمة السر' }),
      el('div', { class: 'lock-input-row' }, [pwInput, eye])
    ]));

    /* --------- خانة الرمز + العدّاد التنازلي + شريط التقدّم --------- */
    var codeInput = null;
    var timerText = null;
    var timerBar = null;
    var timerTrack = null;
    var otpTick = null;

    function remainingNow() {
      try {
        if (V && V.totp && typeof V.totp.remainingSeconds === 'function') {
          var s = Number(V.totp.remainingSeconds({}));
          if (isFinite(s)) return Math.max(0, Math.min(OTP_PERIOD, Math.round(s)));
        }
      } catch (e) { /* تجاهل */ }
      return Math.max(0, OTP_PERIOD - (Math.floor(Date.now() / 1000) % OTP_PERIOD));
    }
    function paintCountdown() {
      if (!timerText || !timerBar || !timerTrack) return;
      var rem = remainingNow();
      timerText.textContent = 'يتجدّد الرمز بعد ' + rem + ' ثانية';
      timerBar.style.width = Math.round(rem / OTP_PERIOD * 100) + '%';
      timerTrack.className = 'progress lock-otp-bar' + (rem <= 5 ? ' progress-danger' : rem <= 10 ? ' progress-warn' : '');
    }

    if (twoFactor) {
      codeInput = el('input', {
        id: 'lock-code', class: 'input lock-code', type: 'text', name: 'code',
        inputmode: 'numeric', maxlength: String(OTP_DIGITS), autocomplete: 'one-time-code',
        placeholder: '000000', 'aria-label': 'رمز المصادقة الثنائية'
      });
      codeInput.addEventListener('input', function () {
        var clean = String(codeInput.value || '').replace(/[^0-9]/g, '').slice(0, OTP_DIGITS);
        if (clean !== codeInput.value) codeInput.value = clean;
      });

      timerText = el('span', { class: 'lock-otp-timer-text', id: 'lock-otp-timer', text: '' });
      timerBar = el('div', { class: 'progress-bar' });
      timerTrack = el('div', { class: 'progress lock-otp-bar' }, [timerBar]);
      var refresh = UI.btn('جدّد الرمز', {
        icon: 'refresh', tone: 'ghost', size: 'sm', title: 'يعيد ضبط المؤقّت في الواجهة فقط',
        onClick: function () {
          if (otpTick) { clearInterval(otpTick); otpTick = null; }
          paintCountdown();
          otpTick = setInterval(paintCountdown, 1000);
        }
      });
      refresh.setAttribute('id', 'lock-refresh-code');

      card.appendChild(el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: 'lock-code', text: 'رمز المصادقة (' + OTP_DIGITS + ' أرقام)' }),
        codeInput,
        el('div', { class: 'lock-otp-head' }, [
          el('span', { class: 'lock-otp-timer' }, [icon('hourglass', { size: 14 }), timerText]),
          refresh
        ]),
        timerTrack
      ]));
    }

    var errorBox = statusBox('danger', 'alert');
    errorBox.el.setAttribute('id', 'lock-error');
    card.appendChild(errorBox.el);

    var lockBox = statusBox('warn', 'hourglass');
    lockBox.el.setAttribute('id', 'lock-lockout');
    card.appendChild(lockBox.el);

    var submit = UI.btn('دخول', { icon: 'lock', tone: 'primary', className: 'btn-block', onClick: doUnlock });
    submit.setAttribute('id', 'lock-unlock-submit');

    var forgot = UI.btn('نسيت كلمة السر؟', { icon: 'key', tone: 'ghost', size: 'sm', className: 'lock-forgot-btn', onClick: openForgot });
    forgot.setAttribute('id', 'lock-forgot');

    card.appendChild(el('div', { class: 'lock-actions' }, [submit]));
    card.appendChild(el('div', { class: 'lock-foot' }, [forgot, note('server', 'لا خادم: لا شيء يُرسل خارج جهازك.')]));

    /* --------- تعطيل مؤقت بعد محاولات فاشلة --------- */
    var guard = readGuard();
    var fails = guard.fails;
    var lockedUntil = 0;
    var lockTick = null;

    if (guard.until && guard.until > Date.now()) {
      lockedUntil = guard.until;
    } else if (guard.until || guard.fails) {
      fails = 0;
      clearGuard();
    }

    function remainingLockSeconds() {
      return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
    }
    function paintLock(seconds) {
      lockBox.body.textContent = 'خمس محاولات فاشلة على الأقل. أعد المحاولة بعد ' + seconds + ' ثانية (العدّاد محفوظ في هذه الجلسة فقط).';
    }
    function startLock() {
      submit.disabled = true;
      lockBox.show('تم إيقاف المحاولات مؤقتاً', '');
      paintLock(remainingLockSeconds());
      if (lockTick) return;
      lockTick = setInterval(function () {
        var remain = remainingLockSeconds();
        if (remain > 0) { paintLock(remain); return; }
        clearInterval(lockTick);
        lockTick = null;
        lockedUntil = 0;
        fails = 0;
        clearGuard();
        submit.disabled = false;
        lockBox.hide();
        errorBox.hide();
      }, 1000);
    }
    function registerFailure(res) {
      var reason = (res && res.reason) || '';
      if (reason === 'not-configured') return;
      if (reason === 'locked-out' || ++fails >= MAX_FAILS) {
        fails = Math.max(fails, MAX_FAILS);
        lockedUntil = Date.now() + LOCKOUT_MS;
        writeGuard(fails, lockedUntil);
        startLock();
        return;
      }
      writeGuard(fails, 0);
    }

    function reasonTitle(res) {
      var reason = (res && res.reason) || '';
      if (reason === 'bad-password') return 'كلمة السر غير صحيحة';
      if (reason === 'bad-code') return 'رمز المصادقة غير صحيح';
      if (reason === 'locked-out') return 'المحاولات موقوفة مؤقتاً';
      if (reason === 'not-configured') return 'لا توجد خزنة على هذا الجهاز';
      return 'تعذّر الدخول';
    }
    function reasonMessage(res) {
      var reason = (res && res.reason) || '';
      if (reason === 'bad-password') return 'كلمة السر غير صحيحة. تحقّق من لوحة المفاتيح وحاول مرة أخرى.';
      if (reason === 'bad-code') return 'رمز المصادقة غير صحيح أو انتهت صلاحيته — أدخل الرمز الحالي من التطبيق.';
      if (reason === 'locked-out') return 'محاولات كثيرة فاشلة — انتظر انتهاء العدّاد ثم أعد المحاولة.';
      if (reason === 'not-configured') return 'لا توجد خزنة على هذا الجهاز — أنشئ حسابك من شاشة الإعداد.';
      if (res && res.error) return String(res.error);
      return 'تعذّر فتح الخزنة. تأكد من كلمة السر وحاول مرة أخرى.';
    }

    function doUnlock() {
      if (lockedUntil > Date.now()) return;
      errorBox.hide();
      var password = String(pwInput.value || '');
      var code = codeInput ? String(codeInput.value || '').replace(/[^0-9]/g, '') : '';
      if (!password) {
        errorBox.show('كلمة السر مطلوبة', 'أدخل كلمة السر لفتح الخزنة.');
        return;
      }
      if (twoFactor && code.length !== OTP_DIGITS) {
        errorBox.show('الرمز مطلوب', 'أدخل الرمز الحالي المكوّن من ' + OTP_DIGITS + ' أرقام من تطبيق المصادقة.');
        return;
      }
      if (!V || typeof V.unlock !== 'function') {
        errorBox.show('وحدة الحماية غير متوفرة', 'لم يتم تحميل Fin.Vault — أعد تحميل الصفحة.');
        return;
      }
      setBusy(submit, true, 'جارٍ التحقق…');
      Promise.resolve(V.unlock({ password: password, code: code }))
        .then(function (res) {
          if (res && res.ok === true) {
            UI.toast('تم فتح الخزنة', 'success');
            finishAuth();
            return;
          }
          setBusy(submit, false, 'دخول');
          errorBox.show(reasonTitle(res), reasonMessage(res));
          registerFailure(res);
        })
        .catch(function (err) {
          setBusy(submit, false, 'دخول');
          errorBox.show('خطأ غير متوقّع', String((err && err.message) || err || '').slice(0, 200));
        });
    }

    /* --------------------------------------------------- نسيت كلمة السر */
    function openForgot() {
      var fileInput = el('input', {
        id: 'lock-import-file', class: 'input lock-file', type: 'file',
        accept: '.json,application/json,text/plain', 'aria-label': 'ملف النسخة الاحتياطية المشفّر'
      });
      var importPw = el('input', {
        id: 'lock-import-password', class: 'input', type: 'password', autocomplete: 'current-password',
        placeholder: 'كلمة سر الخزنة', 'aria-label': 'كلمة السر الخاصة بالنسخة'
      });
      var importCode = twoFactor ? el('input', {
        id: 'lock-import-code', class: 'input lock-code', type: 'text', inputmode: 'numeric',
        maxlength: String(OTP_DIGITS), autocomplete: 'one-time-code', placeholder: '000000',
        'aria-label': 'رمز المصادقة الثنائية للنسخة'
      }) : null;

      var importError = statusBox('danger', 'alert');
      importError.el.setAttribute('id', 'lock-import-error');

      var body = el('div', { class: 'modal-body lock-forgot' }, [
        staticAlert('warn', 'alert', 'لا يمكن استعادة كلمة السر',
          'لا يوجد خادم يحفظ كلمة السر ولا يملك مفتاحها. التشفير يجري في متصفحك، فلا أحد — ولا هذا التطبيق — يستطيع إعادة تعيينها.'),
        el('p', { class: 'modal-text', text: 'التعافي الوحيد هو ملف نسخة احتياطية مشفّر صدّرته سابقاً وتعرف كلمة السر الخاصة به. لن يفيد تخمين كلمة السر هنا؛ الاستيراد نفسه يفكّ التشفير بالكلمة الصحيحة.' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'lock-import-file', text: 'ملف النسخة المشفّرة (.json)' }),
          fileInput,
          el('div', { class: 'field-hint', text: 'من الإعدادات: «صدّر نسخة احتياطية مشفّرة».' })
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'lock-import-password', text: 'كلمة السر الخاصة بالنسخة' }),
          importPw
        ]),
        importCode ? el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'lock-import-code', text: 'رمز المصادقة الثنائية' }),
          importCode
        ]) : null,
        importError.el
      ]);

      function doImport() {
        importError.hide();
        var file = (fileInput.files && fileInput.files[0]) ? fileInput.files[0] : null;
        if (!file) {
          importError.show('اختر ملفاً', 'حدّد ملف النسخة الاحتياطية المشفّر أولاً.');
          return false;
        }
        var password = String(importPw.value || '');
        if (!password) {
          importError.show('كلمة السر مطلوبة', 'أدخل كلمة السر الخاصة بالنسخة الاحتياطية.');
          return false;
        }
        if (!V || typeof V.importEncrypted !== 'function') {
          importError.show('الاستيراد غير متاح', 'وحدة الحماية لا توفّر هذه الوظيفة.');
          return false;
        }
        var code = importCode ? String(importCode.value || '').replace(/[^0-9]/g, '') : '';
        UI.toast('جارٍ التحقق من النسخة…', 'info');
        U.readFile(file).then(function (content) {
          return V.importEncrypted(String(content || ''), { password: password, code: code });
        }).then(function (res) {
          if (res && res.ok === true) {
            UI.toast('تم استيراد النسخة المشفّرة', 'success');
            reloadPage();
            return;
          }
          importError.show('تعذّر الاستيراد', (res && res.error) ? String(res.error) : 'تأكد من الملف ومن كلمة السر (ورمز المصادقة إن كانت مفعّلة).');
        }).catch(function (err) {
          importError.show('تعذّر قراءة الملف', String((err && err.message) || err || '').slice(0, 200));
        });
        return false;   // يُبقي الحوار مفتوحاً حتى تنتهي العملية
      }

      UI.modal({
        title: 'نسيت كلمة السر؟',
        body: body,
        actions: [
          { label: 'استورد نسخة مشفّرة', tone: 'primary', onClick: doImport },
          { label: 'إغلاق', tone: 'ghost' }
        ]
      });
    }

    if (codeInput) codeInput.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') doUnlock(); });
    pwInput.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') doUnlock(); });

    shell.appendChild(card);
    rootEl.appendChild(shell);

    if (twoFactor) {
      paintCountdown();
      otpTick = setInterval(paintCountdown, 1000);
    }
    if (lockedUntil) startLock();

    onDestroy(function () {
      if (otpTick) clearInterval(otpTick);
      if (lockTick) clearInterval(lockTick);
    });
  }

  /* ------------------------------------------------------ الحالة العامة */

  function renderMissing(rootEl) {
    var shell = el('div', { class: 'lock-shell' });
    var card = el('div', { class: 'card lock-card' });
    card.appendChild(el('div', { class: 'lock-brand' }, [
      el('div', { class: 'lock-logo' }, [icon('alert', { size: 26 })]),
      el('div', { class: 'lock-brand-text' }, [
        el('h1', { class: 'lock-title', text: 'تعذّر تشغيل وحدة الحماية' }),
        el('div', { class: 'lock-sub', text: 'لم يتم تحميل Fin.Vault — أعد تحميل الصفحة.' })
      ])
    ]));
    card.appendChild(staticAlert('danger', 'alert', 'وحدة الحماية غير متوفرة',
      'لا يمكن فتح البيانات أو إنشائها بلا Fin.Vault. تأكد من تحميل ملفات assets/js ثم أعد التحميل.'));
    card.appendChild(UI.btn('إعادة التحميل', { icon: 'refresh', tone: 'primary', className: 'btn-block', onClick: reloadPage }));
    shell.appendChild(card);
    rootEl.appendChild(shell);
  }

  Fin.Views.lock = {
    id: 'lock',
    title: 'الدخول',
    icon: 'lock',
    order: 0,
    hidden: true,

    render: function (rootEl, ctx) {
      if (!rootEl) return;
      runCleanups();
      U.clear(rootEl);

      var V = Fin.Vault;
      if (!V) { renderMissing(rootEl); return; }
      if (pendingTotp && pendingTotp.secret && isConfigured(V)) { renderTotp(rootEl, pendingTotp.secret, pendingTotp.uri); return; }
      if (isConfigured(V)) renderUnlock(rootEl);
      else renderSetup(rootEl, ctx);
    },

    destroy: function () {
      /* يوقف المؤقتات فقط. سرّ الثنائية غير المؤكَّد يبقى في الذاكرة عمداً:
         لو فقدناه بمجرد مغادرة الشاشة لَبقي المستخدم خارج خزنة أنشأها للتوّ. */
      runCleanups();
    }
  };
})();
