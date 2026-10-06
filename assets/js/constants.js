/* =============================================================================
 * مصروفي — constants.js
 * كل الأرقام الحقيقية من قصة المستخدم + الفئات + المصادر + الالتزامات.
 * لا DOM هنا. يعتمد على window.Fin (يُنشأ إن لم يوجد) حتى يعمل في node للاختبار.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = {};
  Fin.C = C;

  /* ---------------------------------------------------------------- أساسيات */
  C.APP_NAME = 'مصروفي';
  C.APP_TAGLINE = 'إيرادات، مصروفات، وادخار — بلا ورق';
  C.VERSION = '1.1.1';
  C.SCHEMA_VERSION = 1;
  C.STORAGE_KEY = 'finapp.v1';
  C.LOCALE = 'ar-LY';
  C.CURRENCY = 'LYD';
  C.CURRENCY_LABEL = 'د.ل';
  C.TZ = 'Africa/Tripoli';
  C.TZ_OFFSET = '+02:00'; // ليبيا: UTC+2 بلا توقيت صيفي
  C.BALANCE_TOLERANCE = 0.01;

  /* تاريخ البذرة = اليوم الذي سُجّلت فيه الحركات في القصة */
  C.TODAY = '2026-10-05';
  C.SEED_DATE = C.TODAY;

  C.QUARTER_MONTHS = [1, 4, 7, 10]; // أشهر بداية الربع

  /* ------------------------------------------------------------ الأرصدة الافتتاحية */
  C.OPENING = {
    cash: 5000,
    saving: 1500,
    total: 6500,
    note: '5,000 نقود مجموعة في الصندوق (لا ديون ولا قروض — أموال مجمّعة من إيرادات سابقة) + 1,500 مدخرات محفوظة.'
  };

  C.ACCOUNTS = [
    { id: 'cash', name: 'الصندوق (نقد)', kind: 'cash', opening: C.OPENING.cash, icon: 'cash', order: 1 },
    { id: 'saving', name: 'مدخرات / احتياطي', kind: 'saving', opening: C.OPENING.saving, icon: 'bank', order: 2 }
  ];

  /* ---------------------------------------------------------------- الأماكن */
  C.LOCATIONS = [
    { id: 'shop', name: 'المحل (بجانب البيت)', kind: 'rent', icon: 'store', note: 'إيجار شهري 1,500 — يُدفع كل شهر' },
    { id: 'studio', name: 'استوديو فوق المحل', kind: 'rent', icon: 'house', note: '2,000 كل ثلاثة أشهر (أكتوبر + نوفمبر + ديسمبر)' },
    { id: 'workshops', name: 'ورشة السمكرة والطلاء', kind: 'workshop', area: 300, icon: 'workshop', note: 'أرض ~300م² حُوّلت إلى ورشة سمكرة وطلاء — 1,900' },
    { id: 'mech', name: 'الورشة الميكانيكية', kind: 'workshop', icon: 'wrench', note: '1,500' },
    { id: 'rooms', name: 'حجرات العمال', kind: 'rent', icon: 'bed', note: 'كانت ورشة وحُوّلت إلى حجرات — 2,000' },
    { id: 'other', name: 'مصادر أخرى', kind: 'other', icon: 'plus', note: 'دعم الوالد، بيع شيء، دخل إنترنت…' }
  ];

  /* ---------------------------------------------------- قوالب الإيجار (الاستحقاق) */
  C.TEMPLATES = [
    {
      id: 't-shop-rent', locationId: 'shop', label: 'إيجار المحل', amount: 1500,
      cycle: 'monthly', dayOfMonth: 1, kind: 'rent', receiptNo: 'RCP-2401',
      category: 'rent_shop', note: 'كل شهر — لشهر أكتوبر لم يُحصَّل بعد'
    },
    {
      id: 't-studio-rent', locationId: 'studio', label: 'إيجار الاستوديو', amount: 2000,
      cycle: 'quarterly', anchorMonth: 10, dayOfMonth: 1, kind: 'rent', receiptNo: 'RCP-2402',
      category: 'rent_studio', note: 'دفعة ثلاثة أشهر (10+11+12) — سيأخذها هذا الشهر، ولم تُستلم بعد'
    },
    {
      id: 't-ws-paint', locationId: 'workshops', label: 'ورشة السمكرة والطلاء', amount: 1900,
      cycle: 'monthly', dayOfMonth: 5, kind: 'rent', receiptNo: 'RCP-2403',
      category: 'rent_workshop', payTo: 'أ. محمد الفيتوري'
    },
    {
      id: 't-ws-mech', locationId: 'mech', label: 'الورشة الميكانيكية', amount: 1500,
      cycle: 'monthly', dayOfMonth: 5, kind: 'rent', receiptNo: 'RCP-2404',
      category: 'rent_workshop', payTo: 'أ. عبد السلام بن سعيد'
    },
    {
      id: 't-rooms', locationId: 'rooms', label: 'إيجار حجرات العمال', amount: 2000,
      cycle: 'monthly', dayOfMonth: 5, kind: 'rent', receiptNo: 'RCP-2405',
      category: 'rent_rooms'
    }
  ];

  /* --------------------------------------- ما حُصِّل فعلاً اليوم 2026-10-05 */
  C.RECEIPTS_TODAY = [
    {
      templateId: 't-ws-paint', locationId: 'workshops', amount: 1900,
      accountId: 'cash', method: 'cash', paidTo: 'أ. محمد الفيتوري', ref: 'RCP-2403',
      note: 'ورشة السمكرة والطلاء'
    },
    {
      templateId: 't-ws-mech', locationId: 'mech', amount: 1500,
      accountId: 'cash', method: 'cash', paidTo: 'أ. عبد السلام بن سعيد', ref: 'RCP-2404',
      note: 'الورشة الميكانيكية'
    }
  ];
  C.RECEIVED_TODAY_TOTAL = 3400;
  C.RECEIVED_TODAY_LABEL = 'ورشة السمكرة والطلاء + الورشة الميكانيكية';
  C.RECEIVED_TODAY_SHORT = 'إيرادات الإيجارات المحصَّلة اليوم';

  /* ------------------------------- استحقاقات لم تُحصَّل بعد (يوم 5 أكتوبر) */
  C.PENDING_CHARGES = [
    { templateId: 't-shop-rent', note: 'إيجار شهر أكتوبر — لم أستلمه بعد (اليوم 5 من الشهر)' },
    { templateId: 't-studio-rent', note: 'دفعة الربع الرابع (10+11+12) — سيأخذها هذا الشهر ولم تُستلم بعد' },
    { templateId: 't-rooms', note: 'إيجار حجرات العمال — لم أستلمه بعد' }
  ];

  /* ================== مصروفات مخطّطة/معلّقة (لا تُخصم من الرصيد حتى الدفع) ==================
     ملاحظة مهمة: هذه ليست ديوناً. المستخدم لا ديون عليه.
     - رسوم المدرسة السنوية 6,000 دُفعت منها 1,000 → المتبقي 5,000 خطّة سنوية (C.COMMITMENTS).
     - بطاقة النطاق 180 وصلت بيد شخص وسيُسدَّد له عند التجديد. */
  C.OBLIGATIONS = [
    { key: 'domain_renewal', label: 'تجديد نطاق .org (القرآن الكريم — صدقة)', amount: 180, category: 'domain_hosting', icon: 'globe', paid: false, note: 'البطاقة وصلتني من شخص وسأسدّد عند التجديد', upcoming: true },
    { key: 'school_books', label: 'كتب ابنتي (مدرسة خاصة)', amount: 950, category: 'school_books', icon: 'book', paid: false, note: 'لم أشترِها بعد', upcoming: true },
    { key: 'school_uniform', label: 'الزي الجديد', amount: 450, category: 'clothes', icon: 'shirt', paid: false, note: 'تقديري', upcoming: true },
    { key: 'fuel', label: 'تعبئة البنزين', amount: 100, category: 'fuel', icon: 'fuel', paid: false, note: 'مصروف متكرر — قيمة تقديرية', upcoming: true }
  ];
  C.OBLIGATIONS_TOTAL = C.OBLIGATIONS.reduce(function (s, e) { return s + e.amount; }, 0); // 1,680

  /* التزامات سنوية (خطط، ليست ديوناً): تُعرض كمعلومة فقط ولا تدخل في الالتزامات الفورية */
  C.COMMITMENTS = [
    {
      key: 'school_annual', label: 'رسوم المدرسة السنوية', icon: 'school',
      annual: 6000, paidThisYear: 1000, remaining: 5000,
      paidOn: '2026-10-05', category: 'school_tuition',
      note: 'التكلفة 6,000 في السنة — دُفعت 1,000، والمتبقي يُسدَّد على دفعات خلال السنة'
    }
  ];
  C.COMMITMENTS_REMAINING = C.COMMITMENTS.reduce(function (s, c) { return s + (c.remaining || 0); }, 0);

  /* ==================================== الأموال المجمّعة (الصندوق) ====================================
     ليست ديوناً ولا قروضاً — نقود مجموعة في الصندوق، منها ما كان موجوداً قبل هذا الشهر. */
  C.FUND_OPENING = 5000;         // ما كان في الصندوق قبل إيرادات اليوم
  C.FUND_OPENING_NOTE = 'نقود مجموعة في الصندوق قبل إيرادات اليوم (من إيرادات الأشهر السابقة)';
  C.FUND_SOURCES = [
    { key: 'previous_balance', label: 'رصيد سابق في الصندوق', amount: 5000, note: 'مجموع من إيرادات سابقة' },
    { key: 'today_rents', label: 'إيرادات اليوم (تحصيل إيجارات)', amount: 3400, note: 'ورشة السمكرة 1,900 + الميكانيكا 1,500', fromToday: true },
    { key: 'today_expenses', label: 'مصروفات اليوم', amount: -302, note: 'خضار ومواد غذائية وخبز وقهوة وتصريف مياه', fromToday: true }
  ];
  C.FUND_SOURCES_TOTAL = C.FUND_SOURCES.reduce(function (s, f) { return s + f.amount; }, 0); // 8,098

  /* =========================================================== مصروفات اليوم */
  /* 5 أكتوبر: 302 د.ل موزّعة كما في القصة بالحرف */
  C.DAILY_EXPENSES = [
    { key: 'plumbing_help', label: 'أنبوب حديدي لتصريف مياه المطر + أجرة الصديق السوداني', amount: 120, category: 'other', icon: 'wrench', note: 'خدمة الماء في ورشة السمكرة — 100 أجرة + 20 أنبوب، جاء بتاكسي' },
    { key: 'coffee_cigarettes', label: 'قهوة وسجائر وفطور', amount: 22, category: 'coffee_cigarettes', icon: 'coffee' },
    { key: 'vegetables', label: 'خضار وفواكه', amount: 85, category: 'vegetables', icon: 'leaf' },
    { key: 'groceries', label: 'مواد غذائية من محل المواد الغذائية', amount: 60, category: 'groceries', icon: 'basket' },
    { key: 'bread', label: 'خبز + ملحقات (مخبز)', amount: 15, category: 'bakery', icon: 'bread' }
  ];
  C.DAILY_EXPENSES_TOTAL = C.DAILY_EXPENSES.reduce(function (s, e) { return s + e.amount; }, 0); // 302

  /* ------------------------------------------------------------ فئات المصروفات */
  C.EXPENSE_CATEGORIES = [
    { key: 'household', label: 'مصروف البيت', icon: 'house', group: 'الأساسيات', color: 'var(--c-expense)' },
    { key: 'vegetables', label: 'خضار وفواكه', icon: 'leaf', group: 'الأساسيات', color: '#22c55e', quick: 85 },
    { key: 'groceries', label: 'مواد غذائية', icon: 'basket', group: 'الأساسيات', color: '#16a34a', quick: 60 },
    { key: 'bakery', label: 'خبز ومخبز', icon: 'bread', group: 'الأساسيات', color: '#d97706', quick: 15 },
    { key: 'meat', label: 'لحم ودجاج', icon: 'meat', group: 'الأساسيات', color: '#dc2626' },
    { key: 'fuel', label: 'بنزين ووقود', icon: 'fuel', group: 'التنقل', color: '#0ea5e9', quick: 100 },
    { key: 'transport', label: 'مواصلات وتاكسي', icon: 'car', group: 'التنقل', color: '#0284c7' },
    { key: 'coffee_cigarettes', label: 'قهوة وسجائر', icon: 'coffee', group: 'اليوميات', color: '#a16207', quick: 22 },
    { key: 'restaurant', label: 'مطعم / أكل جاهز', icon: 'utensils', group: 'اليوميات', color: '#ea580c' },
    { key: 'clothes', label: 'ملابس وأزياء', icon: 'shirt', group: 'الشخصي', color: '#7c3aed' },
    { key: 'phone_internet', label: 'هاتف وإنترنت', icon: 'phone', group: 'الشخصي', color: '#4f46e5' },
    { key: 'health', label: 'صحة وعلاج', icon: 'pills', group: 'الشخصي', color: '#e11d48' },
    { key: 'school_tuition', label: 'رسوم المدرسة', icon: 'school', group: 'الأسرة والتعليم', color: '#2563eb' },
    { key: 'school_books', label: 'كتب وقرطاسية', icon: 'book', group: 'الأسرة والتعليم', color: '#1d4ed8' },
    { key: 'family', label: 'مصروف الأسرة', icon: 'family', group: 'الأسرة والتعليم', color: '#0891b2' },
    { key: 'maintenance', label: 'صيانة وتصليح', icon: 'tools', group: 'الأعمال', color: '#65a30d', quick: 120 },
    { key: 'workshop_supplies', label: 'مواد ومستلزمات الورشة', icon: 'tools', group: 'الأعمال', color: '#ca8a04' },
    { key: 'workers', label: 'أجور عمال', icon: 'helmet', group: 'الأعمال', color: '#f97316' },
    { key: 'domain_hosting', label: 'نطاقات واستضافة', icon: 'globe', group: 'الأعمال', color: '#7c3aed', quick: 180 },
    { key: 'charity', label: 'صدقة وزكاة', icon: 'prayer', group: 'أخرى', color: '#10b981' },
    { key: 'family_support', label: 'مساعدة الأهل', icon: 'handshake', group: 'أخرى', color: '#059669' },
    { key: 'debt_payment', label: 'سداد دين / سلفة', icon: 'trendDown', group: 'أخرى', color: '#9f1239' },
    { key: 'other', label: 'مصروف آخر', icon: 'package', group: 'أخرى', color: '#64748b' }
  ];

  /* ------------------------------------------------------------ فئات الإيرادات */
  C.INCOME_CATEGORIES = [
    { key: 'rent_shop', label: 'إيجار المحل', icon: 'store', group: 'الإيجارات', color: '#22c55e' },
    { key: 'rent_studio', label: 'إيجار الاستوديو', icon: 'house', group: 'الإيجارات', color: '#16a34a' },
    { key: 'rent_workshop', label: 'إيجار الورش (سمكرة/ميكانيكا)', icon: 'wrench', group: 'الإيجارات', color: '#15803d' },
    { key: 'rent_rooms', label: 'إيجار حجرات العمال', icon: 'bed', group: 'الإيجارات', color: '#166534' },
    { key: 'rent_other', label: 'إيجار آخر', icon: 'building', group: 'الإيجارات', color: '#4ade80' },
    { key: 'family', label: 'من الوالد / الأسرة', icon: 'family', group: 'أخرى', color: '#0891b2' },
    { key: 'online', label: 'دخل إنترنت / عمل حر', icon: 'globe', group: 'أخرى', color: '#6366f1' },
    { key: 'sale', label: 'بيع شيء', icon: 'tag', group: 'أخرى', color: '#f59e0b' },
    { key: 'reimbursement', label: 'استرداد / سلفة رجعت', icon: 'swap', group: 'أخرى', color: '#14b8a6' },
    { key: 'gift', label: 'هدية / صدقة لي', icon: 'sparkles', group: 'أخرى', color: '#a855f7' },
    { key: 'other_income', label: 'دخل آخر', icon: 'plus', group: 'أخرى', color: '#64748b' }
  ];

  C.PAYMENT_METHODS = [
    { key: 'cash', label: 'نقد', icon: 'cash' },
    { key: 'transfer', label: 'تحويل / مصرف', icon: 'bank' },
    { key: 'card', label: 'بطاقة', icon: 'creditCard' },
    { key: 'credit', label: 'على الحساب (لم أسدّد)', icon: 'receipt' }
  ];

  C.THEMES = ['dark', 'light', 'auto'];

  /* ============================================================== النطاقات */
  /* عتبات التذكير بالأيام قبل الانتهاء */
  C.DOMAIN_ALERT_DAYS = { critical: 7, soon: 45, watch: 90 };

  // سعر التجديد الافتراضي حسب الامتداد (د.ل) — يُستخدم عند إضافة نطاق جديد
  C.DOMAIN_PRICE_BY_TLD = { 'com': 180, 'org': 180, 'net': 180, 'com.ly': 15, 'ly': 15, 'org.ly': 15 };

  C.DOMAIN_STATUS = {
    expired: { label: 'سقط — جدّده فوراً', tone: 'danger', icon: 'alert', order: 0 },
    critical: { label: 'تجديد فوري', tone: 'danger', icon: 'flame', order: 1 },
    soon: { label: 'قريب الانتهاء', tone: 'warn', icon: 'clock', order: 2 },
    watch: { label: 'للمتابعة', tone: 'info', icon: 'eye', order: 3 },
    ok: { label: 'بعيد', tone: 'muted', icon: 'checkCircle', order: 4 }
  };

  /* أول دفعة من النطاقات (ما أدخله المستخدم اليوم 5 أكتوبر 2026).
     السعر = تجديد سنة واحدة بالدينار الليبي. الباقي (حتى ~150 نطاقاً) يُضاف من شاشة النطاقات. */
  C.DOMAINS = [
    { domain: 'toolseer.com',   expiry: '2026-10-12', price: 180, currency: 'LYD', note: 'الأقرب للانتهاء — جدّده أولاً (7 أيام)' },
    { domain: 'html.com.ly',    expiry: '2026-11-05', price: 15,  currency: 'LYD' },
    { domain: 'game.com.ly',    expiry: '2026-11-06', price: 15,  currency: 'LYD' },
    { domain: 'tool.com.ly',    expiry: '2026-11-06', price: 15,  currency: 'LYD' },
    { domain: 'maplivepro.com', expiry: '2026-12-09', price: 180, currency: 'LYD' },
    { domain: 'w.com.ly',       expiry: '2026-12-20', price: 15,  currency: 'LYD' },
    { domain: 'f.com.ly',       expiry: '2026-12-20', price: 15,  currency: 'LYD' },
    { domain: 'p.com.ly',       expiry: '2026-12-20', price: 15,  currency: 'LYD' }
  ];
  C.DOMAINS_COUNT_HINT = 'لديك نحو 150 نطاقاً — هذه أول دفعة، والباقي يُضاف من شاشة النطاقات.';

  C.NAV = [
    { id: 'dashboard', title: 'اليوم', icon: 'home', order: 1 },
    { id: 'expenses', title: 'المصروفات', icon: 'receipt', order: 2 },
    { id: 'income', title: 'الإيرادات', icon: 'wallet', order: 3 },
    { id: 'accounts', title: 'الحسابات', icon: 'bank', order: 4 },
    { id: 'reports', title: 'التقارير', icon: 'chart', order: 5 },
    { id: 'domains', title: 'النطاقات', icon: 'globe', order: 6 },
    { id: 'settings', title: 'الإعدادات', icon: 'settings', order: 7 }
  ];

  /* ترتيب التبويبات السفلية. شاشات موجودة لكنها ليست تبويباً:
     agent → يُفتح من أيقونة المساعد في الرأس، لأن 7 تبويبات هو أقصى ما يتحمله عرض الجوال. */
  C.NAV_ORDER = ['dashboard', 'expenses', 'income', 'accounts', 'reports', 'domains', 'settings'];
  C.HEADER_LINKS = [{ id: 'agent', title: 'المساعد الذكي', icon: 'robot' }];

  /* معرّفات ثابتة لنطاقات البذرة — ضرورية للتعديل/التجديد/الحذف.
     النطاقات المضافة لاحقاً تأخذ معرّفاً مُولَّداً من Store.addDomain. */
  C.DOMAINS.forEach(function (d, i) { d.id = 'dm-seed-' + (i + 1); });

  /* فئات مفضّلة تظهر كأزرار «+» بضغطة واحدة في لوحة اليوم */
  C.QUICK_ADD = ['vegetables', 'groceries', 'bakery', 'coffee_cigarettes', 'fuel', 'maintenance', 'domain_hosting', 'other'];

  /* ------------------------------------------------------------- دوال مساعدة */
  C.catExpense = function (key) {
    for (var i = 0; i < C.EXPENSE_CATEGORIES.length; i++) if (C.EXPENSE_CATEGORIES[i].key === key) return C.EXPENSE_CATEGORIES[i];
    return { key: key || 'other', label: key || 'أخرى', icon: 'package', group: 'أخرى', color: 'var(--c-muted)' };
  };
  C.catIncome = function (key) {
    for (var i = 0; i < C.INCOME_CATEGORIES.length; i++) if (C.INCOME_CATEGORIES[i].key === key) return C.INCOME_CATEGORIES[i];
    return { key: key || 'other_income', label: key || 'دخل آخر', icon: 'plus', group: 'أخرى', color: 'var(--c-muted)' };
  };
  C.cat = function (key, type) { return type === 'income' ? C.catIncome(key) : C.catExpense(key); };
  C.location = function (id) {
    for (var i = 0; i < C.LOCATIONS.length; i++) if (C.LOCATIONS[i].id === id) return C.LOCATIONS[i];
    return null;
  };
  C.template = function (id) {
    for (var i = 0; i < C.TEMPLATES.length; i++) if (C.TEMPLATES[i].id === id) return C.TEMPLATES[i];
    return null;
  };
  C.method = function (key) {
    for (var i = 0; i < C.PAYMENT_METHODS.length; i++) if (C.PAYMENT_METHODS[i].key === key) return C.PAYMENT_METHODS[i];
    return { key: key, label: key, icon: 'box' };
  };
  C.domainTld = function (name) {
    var s = String(name || '').toLowerCase().replace(/^www\./, '');
    var parts = s.split('.');
    if (parts.length >= 3 && parts.slice(-2).join('.') === 'com.ly') return 'com.ly';
    return parts.length > 1 ? parts[parts.length - 1] : '';
  };
  C.domainDefaultPrice = function (name, currency) {
    if (currency === 'USD') return 12;
    var tld = C.domainTld(name);
    return C.DOMAIN_PRICE_BY_TLD[tld] !== undefined ? C.DOMAIN_PRICE_BY_TLD[tld] : 180;
  };
  C.domainStatusOf = function (daysLeft) {
    var d = C.DOMAIN_ALERT_DAYS;
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= d.critical) return 'critical';
    if (daysLeft <= d.soon) return 'soon';
    if (daysLeft <= d.watch) return 'watch';
    return 'ok';
  };
  C.EXPENSE_GROUPS = (function () {
    var seen = [], out = [];
    C.EXPENSE_CATEGORIES.forEach(function (c) { if (seen.indexOf(c.group) < 0) { seen.push(c.group); out.push(c.group); } });
    return out;
  })();
})();
