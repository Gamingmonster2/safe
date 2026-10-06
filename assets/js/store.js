/* =============================================================================
 * مصروفي — store.js
 * الحالة + التخزين المحلي + البذرة (بيانات 5 أكتوبر 2026) + التصدير/الاستيراد.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U, F = Fin.Finance;
  var S = {};
  Fin.Store = S;

  var KEY = C.STORAGE_KEY;
  var state = null;
  var listeners = [];
  var muted = false;
  var lastChange = { type: 'init' };

  /* --------------------------------------------------------------- أدوات داخلية */

  function hasLS() {
    try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch (e) { return false; }
  }

  function stamp(iso) {
    var t = (iso && iso !== U.todayISO()) ? 'T12:00:00' : 'T' + nowClock();
    return (iso || U.todayISO()) + t + C.TZ_OFFSET;
  }

  function nowClock() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function notify(type, extra) {
    lastChange = Object.assign({ type: type || 'change' }, extra || {});
    if (muted) return;
    listeners.slice().forEach(function (fn) {
      try { fn(state, lastChange); } catch (e) { console.error('[store] listener error', e); }
    });
  }

  function touch(type, extra) { S.save(); notify(type, extra); }

  function clean(tx) {
    var out = {
      id: tx.id || U.uid('tx'),
      type: tx.type || 'expense',
      date: tx.date || U.todayISO(),
      amount: U.round(Number(tx.amount) || 0, 2),
      category: tx.category || (tx.type === 'income' ? 'other_income' : 'other'),
      accountId: tx.accountId || 'cash',
      locationId: tx.locationId || null,
      chargeId: tx.chargeId || null,
      toAccountId: tx.toAccountId || null,
      method: tx.method || 'cash',
      paid: tx.paid !== false,
      planned: !!tx.planned,
      note: tx.note || '',
      label: tx.label || '',
      tags: Array.isArray(tx.tags) ? tx.tags.slice() : [],
      createdAt: tx.createdAt || stamp(tx.date)
    };
    return out;
  }

  /* ============================================================ البذرة */

  S.seed = function () {
    var today = C.TODAY;
    var st = {
      version: C.SCHEMA_VERSION,
      // تاريخ البذرة ثابت (2026-10-05) حتى لا تتغيّر أرقام القصة مع ساعة الجهاز
      createdAt: C.TODAY + 'T12:00:00' + C.TZ_OFFSET,
      seededAt: new Date().toISOString(),
      settings: {
        theme: 'light',
        currency: C.CURRENCY,
        locale: C.LOCALE,
        domain: '',
        agent: { provider: 'deepseek', model: 'deepseek-chat', apiKey: '', voice: false }
      },
      accounts: U.deepClone(C.ACCOUNTS),
      locations: U.deepClone(C.LOCATIONS),
      templates: U.deepClone(C.TEMPLATES),
      domains: U.deepClone(C.DOMAINS),
      fundOpening: C.FUND_OPENING,
      fundSources: U.deepClone(C.FUND_SOURCES),
      commitments: U.deepClone(C.COMMITMENTS),
      charges: [],
      transactions: [],
      receipts: [],
      agentChat: []
    };

    // 1) إنشاء استحقاقات الشهر الحالي (وربع الاستوديو) حتى اليوم
    S.ensureCharges(C.TODAY, st);

    // 2) تحصيلات اليوم: 3,400 من الورشتين
    C.RECEIPTS_TODAY.forEach(function (r) {
      var tpl = C.template(r.templateId);
      var charge = st.charges.filter(function (c) { return c.templateId === r.templateId && c.status !== 'paid'; })[0];
      var tx = clean({
        type: 'income',
        date: today,
        amount: r.amount,
        category: (tpl && tpl.category) || 'rent_workshop',
        accountId: r.accountId || 'cash',
        locationId: r.locationId,
        chargeId: charge ? charge.id : null,
        method: r.method || 'cash',
        label: (tpl ? tpl.label : ''),
        note: (r.paidTo ? 'من ' + r.paidTo + ' — ' : '') + (r.ref ? 'سند ' + r.ref + ' — ' : '') + (r.note || ''),
        tags: ['إيجار', 'تحصيل']
      });
      st.transactions.push(tx);
      if (charge) {
        st.receipts.push({
          id: U.uid('rc'), chargeId: charge.id, date: today, amount: tx.amount,
          accountId: tx.accountId, txId: tx.id, method: tx.method, ref: r.ref || null, note: r.note || ''
        });
        F.ensureChargeStatus(st, charge);
      }
    });

    // 3) مصروفات اليوم الخمسة (302)
    C.DAILY_EXPENSES.forEach(function (e) {
      st.transactions.push(clean({
        type: 'expense',
        date: today,
        amount: e.amount,
        category: e.category,
        accountId: 'cash',
        method: 'cash',
        label: e.label,
        note: e.note || '',
        tags: ['مصروف يومي'],
        key: e.key
      }));
    });

    // 4) مصروفات مخطّطة/معلّقة (لا تُخصم من الرصيد حتى الدفع) — ليست ديوناً
    C.OBLIGATIONS.forEach(function (o) {
      st.transactions.push(clean({
        type: 'expense',
        date: today,
        amount: o.amount,
        category: o.category,
        accountId: 'cash',
        method: 'credit',
        paid: false,
        planned: true,
        label: o.label,
        note: o.note || '',
        tags: ['مصروف مخطط'],
        key: o.key
      }));
    });

    // 5) رسالة ترحيب من المساعد
    st.agentChat = [{
      role: 'assistant',
      content: 'أهلاً 👋 سجّلت لك حركات اليوم ' + U.dateLabel(C.TODAY) + ':\n' +
        '• دخل ' + U.fmtMoney(C.RECEIVED_TODAY_TOTAL) + ' (' + C.RECEIVED_TODAY_LABEL + ')\n' +
        '• مصروف ' + U.fmtMoney(C.DAILY_EXPENSES_TOTAL) + ' (خضار، مواد غذائية، خبز، قهوة، تصريف مياه)\n' +
        '• صافي اليوم ' + U.fmtMoney(C.RECEIVED_TODAY_TOTAL - C.DAILY_EXPENSES_TOTAL, { sign: true }) + '\n' +
        '• النقد في الصندوق ' + U.fmtMoney(C.OPENING.cash + C.RECEIVED_TODAY_TOTAL - C.DAILY_EXPENSES_TOTAL) + '\n' +
        'اسألني: كم صرفت هذا الأسبوع؟ ما الذي لم أحصّله؟ وين راحت الفلوس؟',
      at: stamp(today)
    }];

    return st;
  };

  /* ============================================ توليد الاستحقاقات من القوالب */

  S.chargeId = function (templateId, period) { return 'c-' + period + '-' + templateId.replace(/^t-/, ''); };

  S.periodFor = function (tpl, cursorISO) {
    if (tpl.cycle === 'quarterly') {
      var q = U.quarterRange(cursorISO);
      return { key: q.key, from: q.from, to: q.to, due: q.from };
    }
    if (tpl.cycle === 'yearly') {
      var y = String(cursorISO).slice(0, 4);
      return { key: y, from: y + '-01-01', to: y + '-12-31', due: y + '-' + pad2(tpl.anchorMonth || 1) + '-' + pad2(tpl.dayOfMonth || 1) };
    }
    var m = U.monthRange(cursorISO);
    var day = Math.min(tpl.dayOfMonth || 1, +m.to.slice(8, 10));
    return { key: m.key, from: m.from, to: m.to, due: m.key + '-' + pad2(day) };
  };

  // يُنشئ كل الاستحقاقات الناقصة من بداية النطاق حتى uptoISO.
  // البذرة مثبّتة على C.TODAY (وليس ساعة الجهاز) لتبقى أرقام القصة حتمية في أي يوم يُفتح فيه التطبيق.
  S.ensureCharges = function (uptoISO, target) {
    var st = target || state;
    if (!st) return 0;
    var upto = uptoISO || U.todayISO();
    var created = 0;
    (st.templates || []).forEach(function (tpl) {
      var start = tpl.firstPeriod || C.TODAY;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) start = C.TODAY;
      // نبدأ من أول فترة قد تكون مستحقة: نرجع خطوة للخلف لضمان تغطية الشهر الحالي
      var cursor = tpl.cycle === 'quarterly' ? U.quarterRange(start).from : U.monthRange(start).from;
      var guard = 0;
      while (cursor <= upto && guard++ < 400) {
        var p = S.periodFor(tpl, cursor);
        var id = S.chargeId(tpl.id, p.key);
        var exists = (st.charges || []).some(function (c) { return c.id === id; });
        if (!exists && p.from <= upto) {
          st.charges.push({
            id: id,
            templateId: tpl.id,
            locationId: tpl.locationId,
            label: tpl.label,
            period: p.key,
            periodStart: p.from,
            periodEnd: p.to,
            dueDate: p.due,
            amount: U.round(Number(tpl.amount) || 0, 2),
            cycle: tpl.cycle,
            kind: tpl.kind || 'rent',
            receiptNo: tpl.receiptNo || null,
            status: 'pending',
            createdAt: stamp(p.due)
          });
          created++;
        }
        cursor = (tpl.cycle === 'quarterly') ? U.addMonths(cursor, 3) : (tpl.cycle === 'yearly' ? U.addMonths(cursor, 12) : U.addMonths(cursor, 1));
      }
    });
    if (created && !target) touch('charges', { created: created });
    return created;
  };

  S.ensureStatuses = function (st) {
    (st.charges || []).forEach(function (c) { F.ensureChargeStatus(st, c); });
  };

  /* ============================================================== التحميل */

  /* هل يوجد نظام حماية (خزنة مشفّرة)؟ إن لم يوجد نعمل بالوضع القديم غير المشفّر
     حتى يُنشئ المستخدم حسابه، ثم تُنقل البيانات وتُحذف النسخة النصية. */
  function vault() { return Fin.Vault || null; }
  function vaultActive() {
    var V = vault();
    return !!(V && typeof V.isConfigured === 'function' && V.isConfigured());
  }

  // يقرأ النسخة القديمة غير المشفّرة (للترحيل فقط)
  function readLegacy() {
    if (!hasLS()) return null;
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? S.migrate(JSON.parse(raw)) : null;
    } catch (e) {
      console.error('[store] تلف في البيانات المحفوظة القديمة', e);
      return null;
    }
  }

  function dropLegacy() {
    if (!hasLS()) return;
    try { localStorage.removeItem(KEY); } catch (e) { /* تجاهل */ }
  }

  S.vaultActive = vaultActive;

  // تحميل متزامن (الوضع القديم أو بعد أن تُعيد البوابة الحالة المفكوكة)
  S.load = function (force) {
    if (state && !force) return state;

    // خزنة مشفّرة موجودة ولم تُفتح بعد: لا نُحمّل شيئاً — البوابة تتولّى الأمر
    if (vaultActive() && !(vault().isUnlocked && vault().isUnlocked())) return null;

    var legacy = readLegacy();
    if (legacy) {
      state = legacy;
      S.ensureStatuses(state);
      return state;
    }
    state = S.seed();
    S.ensureStatuses(state);
    S.save(true);
    return state;
  };

  /* ترطيب الحالة من الخزنة بعد الدخول (تُنادى من البوابة في app.js) */
  S.hydrate = function (data) {
    state = data ? S.migrate(data) : S.seed();
    S.ensureStatuses(state);
    notify('hydrate', {});
    return state;
  };

  // إنشاء الخزنة أول مرة: نأخذ الحالة الحالية (البذرة أو النسخة القديمة) ونشفّرها
  S.snapshotForVault = function () {
    var current = state || readLegacy();
    var data = current ? S.migrate(U.deepClone(current)) : S.seed();
    return data;
  };

  // بعد أول تشفير ناجح: نحذف النسخة النصية القديمة
  S.confirmVaultMigration = function () {
    dropLegacy();
    try { localStorage.removeItem(KEY + '.savedAt'); } catch (e) { /* تجاهل */ }
    notify('vault-migrated', {});
    return true;
  };

  // هل توجد بيانات قديمة غير مشفّرة تنتظر النقل؟
  S.hasLegacyData = function () {
    if (!hasLS()) return false;
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  };

  S.migrate = function (data) {
    var st = data || {};
    st.version = C.SCHEMA_VERSION;
    st.settings = Object.assign({ theme: 'light', currency: C.CURRENCY, locale: C.LOCALE, domain: '' }, st.settings || {});
    st.settings.agent = Object.assign({ provider: 'deepseek', model: 'deepseek-chat', apiKey: '', voice: false }, st.settings.agent || {});
    st.accounts = (st.accounts && st.accounts.length) ? st.accounts : U.deepClone(C.ACCOUNTS);
    st.locations = (st.locations && st.locations.length) ? st.locations : U.deepClone(C.LOCATIONS);
    st.templates = (st.templates && st.templates.length) ? st.templates : U.deepClone(C.TEMPLATES);
    // النسخ القديمة لا تحتوي نطاقات — نزرع القائمة الأولية مرة واحدة فقط
    st.domains = (st.domains && st.domains.length) ? st.domains : U.deepClone(C.DOMAINS);
    // الأموال المجمّعة والالتزامات السنوية (خطط، لا ديون)
    if (st.fundOpening === undefined) st.fundOpening = C.FUND_OPENING;
    if (!st.fundSources || !st.fundSources.length) st.fundSources = U.deepClone(C.FUND_SOURCES);
    if (!st.commitments || !st.commitments.length) st.commitments = U.deepClone(C.COMMITMENTS);
    // ترقية: أي معاملة كانت معلَّمة «دين» تُصبح مصروفاً مخطّطاً (لا ديون في هذا التطبيق)
    (st.transactions || []).forEach(function (tx) {
      if (tx.debt) { tx.planned = true; }
      delete tx.debt;
    });
    // ترقية: نطاقات قديمة بلا معرّف لا يمكن تعديلها — نمنحها معرّفاً ثابتاً
    st.domains = st.domains.map(function (d, i) {
      if (!d.id) d.id = 'dm-' + U.hashCode(String(d.domain || '') + i) + '-' + (i + 1);
      return d;
    });
    st.charges = st.charges || [];
    st.transactions = (st.transactions || []).map(clean);
    st.receipts = st.receipts || [];
    st.agentChat = st.agentChat || [];
    if (!st.createdAt) st.createdAt = new Date().toISOString();
    return st;
  };

  S.save = function (immediate) {
    if (!state) return;
    if (muted && !immediate) return;

    var doSave = function () {
      if (!hasLS()) return;
      // الخزنة المشفّرة: كل كتابة تمرّ عبرها
      if (vaultActive()) {
        var V = vault();
        if (!V.isUnlocked()) return; // مقفلة: لا نكتب شيئاً إطلاقاً
        Promise.resolve(V.save(state)).then(function (res) {
          if (res && res.ok === false) notify('save-error', { error: res.error || 'فشل الحفظ المشفّر' });
          else {
            try { localStorage.setItem(KEY + '.savedAt', new Date().toISOString()); } catch (e) { /* تجاهل */ }
          }
        }, function (err) {
          notify('save-error', { error: String(err && err.message || err) });
        });
        return;
      }
      // الوضع القديم غير المشفّر
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        localStorage.setItem(KEY + '.savedAt', new Date().toISOString());
      } catch (e) {
        console.error('[store] فشل الحفظ', e);
        notify('save-error', { error: String(e && e.message || e) });
      }
    };

    if (immediate) doSave();
    else if (!S._saveDebounced) { S._saveDebounced = U.debounce(doSave, 400); S._saveDebounced(); }
    else S._saveDebounced();
  };

  S.savedAt = function () {
    if (!hasLS()) return null;
    try { return localStorage.getItem(KEY + '.savedAt'); } catch (e) { return null; }
  };

  S.subscribe = function (fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  };

  S.silent = function (fn) {
    muted = true;
    try { fn(); } finally { muted = false; }
  };

  S.reset = function (opts) {
    opts = opts || {};
    if (opts.empty) {
      state = {
        version: C.SCHEMA_VERSION,
        createdAt: C.TODAY + 'T12:00:00' + C.TZ_OFFSET,
        seededAt: new Date().toISOString(),
        settings: { theme: (state && state.settings && state.settings.theme) || 'dark', currency: C.CURRENCY, locale: C.LOCALE, domain: '', agent: Object.assign({ provider: 'deepseek', model: 'deepseek-chat', apiKey: '', voice: false }, (state && state.settings && state.settings.agent) || {}) },
        accounts: U.deepClone(C.ACCOUNTS),
        locations: U.deepClone(C.LOCATIONS),
        templates: U.deepClone(C.TEMPLATES),
        domains: U.deepClone(C.DOMAINS),
        fundOpening: C.FUND_OPENING,
        fundSources: U.deepClone(C.FUND_SOURCES),
        commitments: U.deepClone(C.COMMITMENTS),
        charges: [], transactions: [], receipts: [], agentChat: []
      };
    } else {
      state = S.seed();
    }
    S.ensureStatuses(state);
    S.save(true);
    notify('reset', { empty: !!opts.empty });
    return state;
  };

  /* =========================================================== المعاملات */

  S.addTransaction = function (tx) {
    var item = clean(tx);
    state.transactions.push(item);
    touch('add-transaction', { transaction: item });
    return item;
  };

  S.addTransactions = function (list) {
    var items = (list || []).map(function (tx) { var it = clean(tx); state.transactions.push(it); return it; });
    if (items.length) touch('add-transactions', { transactions: items });
    return items;
  };

  S.updateTransaction = function (id, patch) {
    var idx = -1;
    state.transactions.forEach(function (t, i) { if (t.id === id) idx = i; });
    if (idx < 0) return null;
    var current = state.transactions[idx];
    var p = Object.assign({}, patch);
    // اتساق الحالة: الدفع يعني أنه لم يعد مخطّطاً (وإلا لن يُخصم من الرصيد أبداً)
    if (p.paid === true) p.planned = false;
    if (p.planned === true && p.paid === undefined) p.paid = false;
    var merged = clean(Object.assign({}, current, p, { id: id }));
    state.transactions[idx] = merged;
    touch('update-transaction', { transaction: merged });
    return merged;
  };

  S.removeTransaction = function (id) {
    var before = state.transactions.length;
    state.transactions = state.transactions.filter(function (t) { return t.id !== id; });
    if (state.transactions.length !== before) touch('remove-transaction', { id: id });
  };

  S.addExpense = function (partial) {
    return S.addTransaction(Object.assign({ type: 'expense', date: U.todayISO(), accountId: 'cash', method: 'cash', paid: true }, partial || {}));
  };

  S.addIncome = function (partial) {
    return S.addTransaction(Object.assign({ type: 'income', date: U.todayISO(), accountId: 'cash', method: 'cash', paid: true }, partial || {}));
  };

  S.transfer = function (fromId, toId, amount, date, note) {
    return S.addTransaction({
      type: 'transfer', date: date || U.todayISO(), amount: amount,
      accountId: fromId, toAccountId: toId, category: 'transfer',
      note: note || ('تحويل من ' + fromId + ' إلى ' + toId), paid: true
    });
  };

  /* ========================================================= الاستحقاقات */

  S.addCharge = function (charge) {
    var item = Object.assign({
      id: charge.id || U.uid('c'), status: 'pending', createdAt: stamp(charge.dueDate)
    }, charge);
    state.charges.push(item);
    touch('add-charge', { charge: item });
    return item;
  };

  S.updateCharge = function (id, patch) {
    var idx = -1;
    state.charges.forEach(function (c, i) { if (c.id === id) idx = i; });
    if (idx < 0) return null;
    state.charges[idx] = Object.assign({}, state.charges[idx], patch, { id: id });
    F.ensureChargeStatus(state, state.charges[idx]);
    touch('update-charge', { charge: state.charges[idx] });
    return state.charges[idx];
  };

  S.removeCharge = function (id) {
    state.charges = state.charges.filter(function (c) { return c.id !== id; });
    state.receipts = state.receipts.filter(function (r) { return r.chargeId !== id; });
    touch('remove-charge', { id: id });
  };

  // تحصيل استحقاق: ينشئ معاملة دخل + سند قبض، ويحدّث الحالة
  S.recordReceipt = function (chargeId, amount, opts) {
    opts = opts || {};
    var charge = null;
    state.charges.forEach(function (c) { if (c.id === chargeId) charge = c; });
    if (!charge) return { ok: false, error: 'الاستحقاق غير موجود' };
    var tpl = C.template(charge.templateId) || {};
    var remaining = U.round((Number(charge.amount) || 0) - F.chargePaid(state, chargeId));
    var amt = (amount === undefined || amount === null || amount === '') ? remaining : U.round(Number(amount) || 0, 2);
    if (amt <= 0) return { ok: false, error: 'المبلغ غير صحيح' };
    if (amt > remaining + 0.01) amt = remaining;

    var tx = clean({
      type: 'income',
      date: opts.date || U.todayISO(),
      amount: amt,
      category: opts.category || tpl.category || 'rent_other',
      accountId: opts.accountId || 'cash',
      locationId: charge.locationId,
      chargeId: charge.id,
      method: opts.method || 'cash',
      label: charge.label,
      note: opts.note || ('تحصيل ' + charge.label + ' — ' + U.periodLabel(charge.period)),
      tags: ['إيجار', 'تحصيل']
    });
    state.transactions.push(tx);
    var receipt = {
      id: U.uid('rc'), chargeId: charge.id, date: tx.date, amount: amt,
      accountId: tx.accountId, txId: tx.id, method: tx.method,
      ref: opts.ref || charge.receiptNo || null, note: opts.note || ''
    };
    state.receipts.push(receipt);
    F.ensureChargeStatus(state, charge);
    touch('receipt', { charge: charge, transaction: tx, receipt: receipt });
    return { ok: true, transaction: tx, receipt: receipt, charge: charge };
  };

  S.unrecordReceipt = function (receiptId) {
    var rc = null;
    state.receipts.forEach(function (r) { if (r.id === receiptId) rc = r; });
    if (!rc) return false;
    state.receipts = state.receipts.filter(function (r) { return r.id !== receiptId; });
    if (rc.txId) state.transactions = state.transactions.filter(function (t) { return t.id !== rc.txId; });
    var charge = null;
    state.charges.forEach(function (c) { if (c.id === rc.chargeId) charge = c; });
    if (charge) F.ensureChargeStatus(state, charge);
    touch('unreceipt', { receiptId: receiptId });
    return true;
  };

  S.receiptsOf = function (chargeId) {
    return state.receipts.filter(function (r) { return r.chargeId === chargeId; });
  };

  /* ========================================================== الحسابات والإعدادات */

  S.addAccount = function (acc) {
    var item = Object.assign({ id: U.uid('acc'), name: 'حساب', kind: 'cash', opening: 0, order: (state.accounts.length + 1) }, acc);
    state.accounts.push(item);
    touch('add-account', { account: item });
    return item;
  };

  S.updateAccount = function (id, patch) {
    var idx = -1;
    state.accounts.forEach(function (a, i) { if (a.id === id) idx = i; });
    if (idx < 0) return null;
    state.accounts[idx] = Object.assign({}, state.accounts[idx], patch, { id: id });
    touch('update-account', { account: state.accounts[idx] });
    return state.accounts[idx];
  };

  S.removeAccount = function (id) {
    var used = state.transactions.some(function (t) { return t.accountId === id || t.toAccountId === id; });
    if (used) return { ok: false, error: 'الحساب مستخدم في معاملات — لا يمكن حذفه' };
    state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
    touch('remove-account', { id: id });
    return { ok: true };
  };

  S.updateSettings = function (patch) {
    state.settings = Object.assign({}, state.settings, patch || {});
    if (patch && patch.agent) state.settings.agent = Object.assign({}, state.settings.agent, patch.agent);
    touch('settings', { settings: state.settings });
    return state.settings;
  };

  S.addLocation = function (loc) {
    var item = Object.assign({ id: U.uid('loc'), name: 'مكان', kind: 'rent', icon: '📍' }, loc);
    state.locations.push(item);
    touch('add-location', { location: item });
    return item;
  };

  S.updateTemplate = function (id, patch) {
    var idx = -1;
    state.templates.forEach(function (t, i) { if (t.id === id) idx = i; });
    if (idx < 0) return null;
    state.templates[idx] = Object.assign({}, state.templates[idx], patch, { id: id });
    touch('update-template', { template: state.templates[idx] });
    return state.templates[idx];
  };

  S.addTemplate = function (tpl) {
    var item = Object.assign({ id: U.uid('t'), cycle: 'monthly', dayOfMonth: 1, amount: 0, kind: 'rent' }, tpl);
    state.templates.push(item);
    touch('add-template', { template: item });
    return item;
  };

  /* ================================================================ المحادثة */

  S.addChatMessage = function (role, content, extra) {
    var msg = Object.assign({ role: role, content: String(content || ''), at: stamp(U.todayISO()) }, extra || {});
    state.agentChat.push(msg);
    if (state.agentChat.length > 200) state.agentChat = state.agentChat.slice(-200);
    touch('chat', { message: msg });
    return msg;
  };

  S.clearChat = function () {
    state.agentChat = [];
    touch('chat-clear');
  };

  /* ========================================================= التصدير/الاستيراد */

  S.exportJSON = function () {
    var payload = {
      app: C.APP_NAME,
      schema: C.SCHEMA_VERSION,
      version: C.VERSION,
      exportedAt: new Date().toISOString(),
      exportedAtLocal: stamp(U.todayISO()),
      counts: {
        transactions: state.transactions.length,
        charges: state.charges.length,
        receipts: state.receipts.length
      },
      summary: {
        income: F.rangeSummary(state, '0000-01-01', '9999-12-31').income,
        expense: F.rangeSummary(state, '0000-01-01', '9999-12-31').expense,
        balance: F.totalBalance(state)
      },
      state: state
    };
    return JSON.stringify(payload, null, 2);
  };

  S.exportCSV = function () {
    var rows = [['النوع', 'التاريخ', 'المبلغ', 'الفئة', 'الحساب', 'المكان', 'مدفوع', 'مخطط', 'ملاحظة']];
    state.transactions.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) {
      var cat = t.type === 'income' ? C.catIncome(t.category) : C.catExpense(t.category);
      var loc = C.location(t.locationId);
      rows.push([
        t.type === 'income' ? 'دخل' : (t.type === 'expense' ? 'مصروف' : 'تحويل'),
        t.date, t.amount, cat.label, t.accountId, loc ? loc.name : '',
        t.paid === false ? 'لا' : 'نعم', t.planned ? 'نعم' : 'لا',
        (t.label ? t.label + ' — ' : '') + (t.note || '')
      ]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c === null || c === undefined ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    return '\ufeff' + csv; // BOM ليفتح صحيحاً في Excel العربي
  };

  S.importJSON = function (text) {
    try {
      var data = JSON.parse(text);
      var incoming = data && data.state ? data.state : data;
      if (!incoming || (!incoming.transactions && !incoming.accounts)) return { ok: false, error: 'الملف لا يحتوي بيانات تطبيق صالحة' };
      var merged = S.migrate(incoming);
      // لا نستورد مفتاح API من ملف خارجي (أمان)
      if (state && state.settings && state.settings.agent) merged.settings.agent.apiKey = state.settings.agent.apiKey || '';
      S.ensureCharges(U.todayISO(), merged);
      S.ensureStatuses(merged);
      state = merged;
      S.save(true);
      notify('import', { counts: { transactions: state.transactions.length } });
      return { ok: true, state: state };
    } catch (e) {
      return { ok: false, error: 'ملف غير صالح: ' + (e && e.message ? e.message : e) };
    }
  };

  S.clearAllData = function (keepSettings) {
    var settings = null, accounts = null, locations = null, templates = null;
    if (keepSettings) {
      settings = state.settings;
      accounts = state.accounts;
    }
    locations = state.locations;
    templates = state.templates;
    var domains = state.domains;
    state = {
      version: C.SCHEMA_VERSION,
      createdAt: C.TODAY + 'T12:00:00' + C.TZ_OFFSET,
      seededAt: new Date().toISOString(),
      settings: settings || state.settings,
      accounts: accounts || U.deepClone(C.ACCOUNTS),
      locations: locations,
      templates: templates,
      domains: domains || U.deepClone(C.DOMAINS),
      fundOpening: state.fundOpening !== undefined ? state.fundOpening : C.FUND_OPENING,
      fundSources: state.fundSources || U.deepClone(C.FUND_SOURCES),
      commitments: state.commitments || U.deepClone(C.COMMITMENTS),
      charges: [], transactions: [], receipts: [], agentChat: []
    };
    S.save(true);
    notify('clear-all');
    return state;
  };

  /* الرصيد السابق في الصندوق (الأموال المجمّعة قبل حركات اليوم) */
  S.updateFundOpening = function (opening, sources) {
    if (!state) return null;
    state.fundOpening = U.round1(Number(opening) || 0);
    if (Array.isArray(sources)) state.fundSources = sources;
    touch('fund-opening', { opening: state.fundOpening });
    return state.fundOpening;
  };

  /* الالتزامات السنوية (خطط مثل رسوم المدرسة) — قابلة للتعديل */
  S.updateCommitment = function (key, patch) {
    if (!state || !Array.isArray(state.commitments)) return null;
    var idx = -1;
    state.commitments.forEach(function (c, i) { if (c.key === key) idx = i; });
    if (idx < 0) return null;
    state.commitments[idx] = Object.assign({}, state.commitments[idx], patch || {}, { key: key });
    var c = state.commitments[idx];
    c.remaining = U.round1(Math.max(0, (Number(c.annual) || 0) - (Number(c.paidThisYear) || 0)));
    touch('commitment', { commitment: c });
    return c;
  };

  S.stats = function () {
    return {
      transactions: state.transactions.length,
      charges: state.charges.length,
      receipts: state.receipts.length,
      accounts: state.accounts.length,
      templates: state.templates.length,
      locations: state.locations.length,
      domains: (state.domains || []).length,
      bytes: (function () { try { return JSON.stringify(state).length; } catch (e) { return 0; } })()
    };
  };

  /* ============================================================== النطاقات
     كل عملية هنا تعيد حساب الأيام المتبقية والحالة فوراً. */

  function domainDaysLeft(expiry, asOf) {
    return U.daysBetween(asOf || U.todayISO(), expiry);
  }

  function decorateDomain(d, asOf) {
    var daysLeft = domainDaysLeft(d.expiry, asOf);
    var status = C.domainStatusOf(daysLeft);
    return Object.assign({}, d, {
      daysLeft: daysLeft,
      status: status,
      statusLabel: C.DOMAIN_STATUS[status].label,
      statusTone: C.DOMAIN_STATUS[status].tone,
      statusIcon: C.DOMAIN_STATUS[status].icon,
      dueLabel: daysLeft < 0
        ? ('منتهي منذ ' + Math.abs(daysLeft) + ' يوم')
        : (daysLeft === 0 ? 'ينتهي اليوم' : (daysLeft === 1 ? 'ينتهي غداً' : 'بعد ' + daysLeft + ' يوم')),
      tld: C.domainTld(d.domain)
    });
  }

  S.addDomain = function (item) {
    var name = String(item.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!name) return { ok: false, error: 'أدخل اسم النطاق' };
    if ((state.domains || []).some(function (d) { return d.domain === name; })) {
      return { ok: false, error: 'النطاق موجود مسبقاً: ' + name };
    }
    var rec = {
      id: U.uid('dm'),
      domain: name,
      expiry: item.expiry || U.todayISO(),
      price: U.round1(Number(item.price) || C.domainDefaultPrice(name, item.currency)),
      currency: item.currency || C.CURRENCY,
      autoRenew: !!item.autoRenew,
      registrar: item.registrar || '',
      note: item.note || '',
      createdAt: U.todayISO()
    };
    state.domains = state.domains || [];
    state.domains.push(rec);
    touch('domain-add', { domain: rec });
    return { ok: true, domain: rec };
  };

  S.addDomains = function (list) {
    var added = [], skipped = [];
    (list || []).forEach(function (item) {
      var res = S.addDomain(item);
      if (res.ok) added.push(res.domain); else skipped.push(item.domain || item);
    });
    if (added.length) touch('domains-add', { added: added.length });
    return { added: added, skipped: skipped };
  };

  S.updateDomain = function (id, patch) {
    var idx = -1;
    if (!id) return { ok: false, error: 'معرّف النطاق مطلوب' };
    (state.domains || []).forEach(function (d, i) { if (d.id === id) idx = i; });
    if (idx < 0) return { ok: false, error: 'النطاق غير موجود' };
    state.domains[idx] = Object.assign({}, state.domains[idx], patch, { id: id });
    touch('domain-update', { domain: state.domains[idx] });
    return { ok: true, domain: state.domains[idx] };
  };

  S.removeDomain = function (id) {
    var before = (state.domains || []).length;
    state.domains = (state.domains || []).filter(function (d) { return d.id !== id; });
    if (state.domains.length !== before) touch('domain-remove', { id: id });
    return state.domains.length !== before;
  };

  // تجديد نطاق: يمدّد سنة (أو المدة المطلوبة) ويسجّل المصروف إن طُلب
  S.renewDomain = function (id, opts) {
    opts = opts || {};
    if (!id) return { ok: false, error: 'معرّف النطاق مطلوب' };
    var d = null;
    (state.domains || []).forEach(function (x) { if (x.id === id) d = x; });
    if (!d) return { ok: false, error: 'النطاق غير موجود' };
    var years = Number(opts.years) || 1;
    var newExpiry = U.addMonths(d.expiry, years * 12);
    if (newExpiry < U.todayISO()) newExpiry = U.addMonths(U.todayISO(), years * 12);
    var amount = opts.amount !== undefined ? Number(opts.amount) : (Number(d.price) || C.domainDefaultPrice(d.domain)) * years;

    S.updateDomain(id, { expiry: newExpiry, price: U.round1(Number(d.price) || C.domainDefaultPrice(d.domain)) });

    var tx = null;
    if (opts.recordExpense !== false && amount > 0) {
      tx = clean({
        type: 'expense',
        date: opts.date || U.todayISO(),
        amount: U.round1(amount),
        category: 'domain_hosting',
        accountId: opts.accountId || 'cash',
        method: opts.method || 'cash',
        paid: opts.paid !== false,
        label: 'تجديد نطاق ' + d.domain + (years > 1 ? ' (' + years + ' سنوات)' : ''),
        note: opts.note || ('من ' + U.dateLabel(d.expiry, 'short') + ' إلى ' + U.dateLabel(newExpiry, 'short')),
        tags: ['نطاق', 'تجديد']
      });
      state.transactions.push(tx);
    }
    touch('domain-renew', { domain: d, transaction: tx });
    return { ok: true, domain: d, expiry: newExpiry, transaction: tx, amount: amount };
  };

  // كل النطاقات مرتّبة بالأقرب انتهاءً + إحصاءات
  S.domains = function (asOf) {
    var list = (state.domains || []).map(function (d) { return decorateDomain(d, asOf); });
    list.sort(function (a, b) {
      if (a.expiry !== b.expiry) return a.expiry < b.expiry ? -1 : 1;
      return String(a.domain).localeCompare(String(b.domain));
    });
    var byStatus = { expired: [], critical: [], soon: [], watch: [], ok: [] };
    list.forEach(function (d) { byStatus[d.status].push(d); });
    var renewNow = list.filter(function (d) { return d.status === 'expired' || d.status === 'critical' || d.status === 'soon'; });
    var yearCost = U.sum(list, function (d) { return Number(d.price) || 0; });
    var byTld = {};
    list.forEach(function (d) {
      var k = d.tld || 'أخرى';
      if (!byTld[k]) byTld[k] = { tld: k, count: 0, cost: 0 };
      byTld[k].count++;
      byTld[k].cost += Number(d.price) || 0;
    });
    return {
      asOf: asOf || U.todayISO(),
      list: list,
      total: list.length,
      byStatus: byStatus,
      criticalCount: byStatus.expired.length + byStatus.critical.length,
      soonCount: byStatus.soon.length,
      renewNow: renewNow,
      renewNowCost: U.sum(renewNow, function (d) { return Number(d.price) || 0; }),
      yearCost: U.round1(yearCost),
      monthlyAvgCost: list.length ? U.round1(yearCost / 12) : 0,
      byTld: Object.keys(byTld).map(function (k) { return byTld[k]; }).sort(function (a, b) { return b.cost - a.cost; }),
      next: list[0] || null,
      countHint: C.DOMAINS_COUNT_HINT
    };
  };

  // تنبيهات النطاقات (تُدمج في لوحة اليوم)
  S.domainAlerts = function (asOf) {
    var d = S.domains(asOf);
    var out = [];
    if (!d.total) return out;
    var expired = d.byStatus.expired, critical = d.byStatus.critical, soon = d.byStatus.soon;
    if (expired.length) {
      out.push({
        level: 'danger', icon: '⛔',
        title: expired.length + ' نطاق سقط فعلاً!',
        body: expired.slice(0, 4).map(function (x) { return x.domain + ' (' + x.dueLabel + ')'; }).join('، '),
        go: 'domains'
      });
    }
    if (critical.length) {
      out.push({
        level: 'danger', icon: '🔥',
        title: critical.length + ' نطاق ينتهي خلال ' + C.DOMAIN_ALERT_DAYS.critical + ' أيام — جدّده الآن',
        body: critical.slice(0, 4).map(function (x) { return x.domain + ' ' + x.dueLabel + ' · ' + U.fmtMoney(x.price); }).join('، '),
        go: 'domains'
      });
    }
    if (soon.length) {
      out.push({
        level: 'warn', icon: '⏰',
        title: soon.length + ' نطاق ينتهي خلال شهر',
        body: soon.slice(0, 5).map(function (x) { return x.domain + ' (' + x.daysLeft + ' يوم)'; }).join('، '),
        go: 'domains'
      });
    }
    if (d.renewNowCost > 0) {
      out.push({
        level: 'info', icon: '💳',
        title: 'تكلفة التجديد القريبة ' + U.fmtMoney(d.renewNowCost),
        body: 'تجديد ' + d.renewNow.length + ' نطاقاً · إجمالي نطاقاتك ' + d.total + ' بتكلفة سنوية ' + U.fmtMoney(d.yearCost) + ' (~' + U.fmtMoney(d.monthlyAvgCost) + ' شهرياً)',
        go: 'domains'
      });
    }
    return out;
  };

  Object.defineProperty(S, 'state', { get: function () { return state; } });
})();
