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
  C.VERSION = '1.0.0';
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
    note: 'كما هي اليوم في الشنطة (5,000) والمدخرات السابقة (1,500) — من إيرادات سابقة + 3,000 سُلّفت اليوم من الأجانب و400 أُعيدت، والصافي المتبقي 5,000.'
  };

  C.ACCOUNTS = [
    { id: 'cash', name: 'الشنطة (نقد)', kind: 'cash', opening: C.OPENING.cash, icon: '💵', order: 1 },
    { id: 'saving', name: 'مدخرات / احتياطي', kind: 'saving', opening: C.OPENING.saving, icon: '🏦', order: 2 }
  ];

  /* ---------------------------------------------------------------- الأماكن */
  C.LOCATIONS = [
    { id: 'shop', name: 'المحل (بجانب البيت)', kind: 'rent', icon: '🏪', note: 'إيجار شهري 1,500 — يُدفع كل شهر' },
    { id: 'studio', name: 'استوديو فوق المحل', kind: 'rent', icon: '🏠', note: '2,000 كل ثلاثة أشهر (أكتوبر + نوفمبر + ديسمبر)' },
    { id: 'workshops', name: 'ورشة السمكرة والطلاء', kind: 'workshop', area: 300, icon: '🎨', note: 'أرض ~300م² حُوّلت إلى ورشة سمكرة وطلاء — 1,900' },
    { id: 'mech', name: 'الورشة الميكانيكية', kind: 'workshop', icon: '🔧', note: '1,500' },
    { id: 'rooms', name: 'حجرات العمال', kind: 'rent', icon: '🛏️', note: 'كانت ورشة وحُوّلت إلى حجرات — 2,000' },
    { id: 'other', name: 'مصادر أخرى', kind: 'other', icon: '➕', note: 'دعم الوالد، بيع شيء، دخل إنترنت…' }
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
      category: 'rent_studio', note: 'دفعة ثلاثة أشهر (10+11+12)'
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

  /* ------------------------------- استحقاقات مستحقة ولم تُحصَّل (يوم 5 أكتوبر) */
  C.PENDING_CHARGES = [
    { templateId: 't-shop-rent', note: 'إيجار شهر أكتوبر — لم أستلمه بعد (اليوم 5 من الشهر)' },
    { templateId: 't-studio-rent', note: 'دفعة الربع الرابع (10+11+12) — لم أستلمها بعد' },
    { templateId: 't-rooms', note: 'إيجار حجرات العمال — لم أستلمه بعد' }
  ];

  /* =========================================================== مصروفات اليوم */
  /* 5 أكتوبر: 302 د.ل موزّعة كما في القصة بالحرف */
  C.DAILY_EXPENSES = [
    { key: 'plumbing_help', label: 'أنبوب حديدي لتصريف مياه المطر + أجرة الصديق السوداني', amount: 120, category: 'other', icon: '🚰', note: 'خدمة الماء في ورشة السمكرة — 100 أجرة + 20 أنبوب، جاء بتاكسي' },
    { key: 'coffee_cigarettes', label: 'قهوة وسجائر وفطور', amount: 22, category: 'coffee_cigarettes', icon: '☕' },
    { key: 'vegetables', label: 'خضار وفواكه', amount: 85, category: 'vegetables', icon: '🥬' },
    { key: 'groceries', label: 'مواد غذائية من محل المواد الغذائية', amount: 60, category: 'groceries', icon: '🛒' },
    { key: 'bread', label: 'خبز + ملحقات (مخبز)', amount: 15, category: 'bakery', icon: '🍞' }
  ];
  C.DAILY_EXPENSES_TOTAL = C.DAILY_EXPENSES.reduce(function (s, e) { return s + e.amount; }, 0); // 302

  /* ====================== التزامات لم تُسدَّد (لا تُخصم من الرصيد حتى السداد) */
  C.OBLIGATIONS = [
    { key: 'domain_renewal', label: 'تجديد نطاق .org (القرآن الكريم — صدقة)', amount: 180, category: 'domain_hosting', icon: '🌐', paid: false, note: 'وصلتني البطاقة من شخص وسأسدّد له', debt: true },
    { key: 'school_tuition', label: 'بقية رسوم المدرسة السنوية', amount: 5000, category: 'school_tuition', icon: '🏫', paid: false, note: 'الرسوم السنوية 6,000 ودُفعت 1,000', debt: true },
    { key: 'school_books', label: 'كتب ابنتي (مدرسة خاصة)', amount: 950, category: 'school_books', icon: '📚', paid: false, note: 'لم أشترِها بعد', debt: false },
    { key: 'school_uniform', label: 'الزي الجديد', amount: 450, category: 'clothes', icon: '👕', paid: false, note: 'تقديري', debt: false },
    { key: 'fuel', label: 'تعبئة البنزين', amount: 100, category: 'fuel', icon: '⛽', paid: false, note: 'مصروف متكرر — قيمة تقديرية', debt: false }
  ];
  C.OBLIGATIONS_TOTAL = C.OBLIGATIONS.reduce(function (s, e) { return s + e.amount; }, 0);

  /* الرصيد النقدي المتوقّع بعد سداد كل الالتزامات: 8,098 − 6,680 = 1,418 */
  C.OBLIGATIONS_DEBT_ONLY = C.OBLIGATIONS
    .filter(function (o) { return o.debt; })
    .reduce(function (s, o) { return s + o.amount; }, 0);

  /* ------------------------------------------------------------ فئات المصروفات */
  C.EXPENSE_CATEGORIES = [
    { key: 'household', label: 'مصروف البيت', icon: '🏠', group: 'الأساسيات', color: 'var(--c-expense)' },
    { key: 'vegetables', label: 'خضار وفواكه', icon: '🥬', group: 'الأساسيات', color: '#22c55e', quick: 85 },
    { key: 'groceries', label: 'مواد غذائية', icon: '🛒', group: 'الأساسيات', color: '#16a34a', quick: 60 },
    { key: 'bakery', label: 'خبز ومخبز', icon: '🍞', group: 'الأساسيات', color: '#d97706', quick: 15 },
    { key: 'meat', label: 'لحم ودجاج', icon: '🍗', group: 'الأساسيات', color: '#dc2626' },
    { key: 'fuel', label: 'بنزين ووقود', icon: '⛽', group: 'التنقل', color: '#0ea5e9', quick: 100 },
    { key: 'transport', label: 'مواصلات وتاكسي', icon: '🚕', group: 'التنقل', color: '#0284c7' },
    { key: 'coffee_cigarettes', label: 'قهوة وسجائر', icon: '☕', group: 'اليوميات', color: '#a16207', quick: 22 },
    { key: 'restaurant', label: 'مطعم / أكل جاهز', icon: '🍽️', group: 'اليوميات', color: '#ea580c' },
    { key: 'clothes', label: 'ملابس وأزياء', icon: '👕', group: 'الشخصي', color: '#7c3aed' },
    { key: 'phone_internet', label: 'هاتف وإنترنت', icon: '📱', group: 'الشخصي', color: '#4f46e5' },
    { key: 'health', label: 'صحة وعلاج', icon: '💊', group: 'الشخصي', color: '#e11d48' },
    { key: 'school_tuition', label: 'رسوم المدرسة', icon: '🏫', group: 'الأسرة والتعليم', color: '#2563eb' },
    { key: 'school_books', label: 'كتب وقرطاسية', icon: '📚', group: 'الأسرة والتعليم', color: '#1d4ed8' },
    { key: 'family', label: 'مصروف الأسرة', icon: '👨‍👩‍👧', group: 'الأسرة والتعليم', color: '#0891b2' },
    { key: 'maintenance', label: 'صيانة وتصليح', icon: '🧰', group: 'الأعمال', color: '#65a30d', quick: 120 },
    { key: 'workshop_supplies', label: 'مواد ومستلزمات الورشة', icon: '🪛', group: 'الأعمال', color: '#ca8a04' },
    { key: 'workers', label: 'أجور عمال', icon: '👷', group: 'الأعمال', color: '#f97316' },
    { key: 'domain_hosting', label: 'نطاقات واستضافة', icon: '🌐', group: 'الأعمال', color: '#7c3aed', quick: 180 },
    { key: 'charity', label: 'صدقة وزكاة', icon: '🤲', group: 'أخرى', color: '#10b981' },
    { key: 'family_support', label: 'مساعدة الأهل', icon: '🤝', group: 'أخرى', color: '#059669' },
    { key: 'debt_payment', label: 'سداد دين / سلفة', icon: '📉', group: 'أخرى', color: '#9f1239' },
    { key: 'other', label: 'مصروف آخر', icon: '📦', group: 'أخرى', color: '#64748b' }
  ];

  /* ------------------------------------------------------------ فئات الإيرادات */
  C.INCOME_CATEGORIES = [
    { key: 'rent_shop', label: 'إيجار المحل', icon: '🏪', group: 'الإيجارات', color: '#22c55e' },
    { key: 'rent_studio', label: 'إيجار الاستوديو', icon: '🏠', group: 'الإيجارات', color: '#16a34a' },
    { key: 'rent_workshop', label: 'إيجار الورش (سمكرة/ميكانيكا)', icon: '🔧', group: 'الإيجارات', color: '#15803d' },
    { key: 'rent_rooms', label: 'إيجار حجرات العمال', icon: '🛏️', group: 'الإيجارات', color: '#166534' },
    { key: 'rent_other', label: 'إيجار آخر', icon: '🏘️', group: 'الإيجارات', color: '#4ade80' },
    { key: 'family', label: 'من الوالد / الأسرة', icon: '👨‍👦', group: 'أخرى', color: '#0891b2' },
    { key: 'online', label: 'دخل إنترنت / عمل حر', icon: '💻', group: 'أخرى', color: '#6366f1' },
    { key: 'sale', label: 'بيع شيء', icon: '🏷️', group: 'أخرى', color: '#f59e0b' },
    { key: 'reimbursement', label: 'استرداد / سلفة رجعت', icon: '↩️', group: 'أخرى', color: '#14b8a6' },
    { key: 'gift', label: 'هدية / صدقة لي', icon: '🎁', group: 'أخرى', color: '#a855f7' },
    { key: 'other_income', label: 'دخل آخر', icon: '➕', group: 'أخرى', color: '#64748b' }
  ];

  C.PAYMENT_METHODS = [
    { key: 'cash', label: 'نقد', icon: '💵' },
    { key: 'transfer', label: 'تحويل / مصرف', icon: '🏦' },
    { key: 'card', label: 'بطاقة', icon: '💳' },
    { key: 'credit', label: 'على الحساب (لم أسدّد)', icon: '🧾' }
  ];

  C.THEMES = ['dark', 'light', 'auto'];

  /* ============================================================== النطاقات */
  /* عتبات التذكير بالأيام قبل الانتهاء */
  C.DOMAIN_ALERT_DAYS = { critical: 7, soon: 45, watch: 90 };

  // سعر التجديد الافتراضي حسب الامتداد (د.ل) — يُستخدم عند إضافة نطاق جديد
  C.DOMAIN_PRICE_BY_TLD = { 'com': 180, 'org': 180, 'net': 180, 'com.ly': 15, 'ly': 15, 'org.ly': 15 };

  C.DOMAIN_STATUS = {
    expired: { label: 'سقط — جدّده فوراً', tone: 'danger', icon: '⛔', order: 0 },
    critical: { label: 'تجديد فوري', tone: 'danger', icon: '🔥', order: 1 },
    soon: { label: 'قريب الانتهاء', tone: 'warn', icon: '⏰', order: 2 },
    watch: { label: 'للمتابعة', tone: 'info', icon: '👀', order: 3 },
    ok: { label: 'بعيد', tone: 'muted', icon: '✅', order: 4 }
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
    { id: 'dashboard', title: 'اليوم', icon: '🏠', order: 1 },
    { id: 'expenses', title: 'المصروفات', icon: '💸', order: 2 },
    { id: 'income', title: 'الإيرادات', icon: '💰', order: 3 },
    { id: 'accounts', title: 'الحسابات', icon: '🏦', order: 4 },
    { id: 'reports', title: 'التقارير', icon: '📊', order: 5 },
    { id: 'domains', title: 'النطاقات', icon: '🌐', order: 6 },
    { id: 'settings', title: 'الإعدادات', icon: '⚙️', order: 7 }
  ];

  /* ترتيب التبويبات السفلية. شاشات موجودة لكنها ليست تبويباً:
     agent → يُفتح من أيقونة 🤖 في الرأس، لأن 7 تبويبات هو أقصى ما يتحمله عرض الجوال. */
  C.NAV_ORDER = ['dashboard', 'expenses', 'income', 'accounts', 'reports', 'domains', 'settings'];
  C.HEADER_LINKS = [{ id: 'agent', title: 'المساعد الذكي', icon: '🤖' }];

  /* معرّفات ثابتة لنطاقات البذرة — ضرورية للتعديل/التجديد/الحذف.
     النطاقات المضافة لاحقاً تأخذ معرّفاً مُولَّداً من Store.addDomain. */
  C.DOMAINS.forEach(function (d, i) { d.id = 'dm-seed-' + (i + 1); });

  /* فئات مفضّلة تظهر كأزرار «+» بضغطة واحدة في لوحة اليوم */
  C.QUICK_ADD = ['vegetables', 'groceries', 'bakery', 'coffee_cigarettes', 'fuel', 'maintenance', 'domain_hosting', 'other'];

  /* ------------------------------------------------------------- دوال مساعدة */
  C.catExpense = function (key) {
    for (var i = 0; i < C.EXPENSE_CATEGORIES.length; i++) if (C.EXPENSE_CATEGORIES[i].key === key) return C.EXPENSE_CATEGORIES[i];
    return { key: key || 'other', label: key || 'أخرى', icon: '📦', group: 'أخرى', color: 'var(--c-muted)' };
  };
  C.catIncome = function (key) {
    for (var i = 0; i < C.INCOME_CATEGORIES.length; i++) if (C.INCOME_CATEGORIES[i].key === key) return C.INCOME_CATEGORIES[i];
    return { key: key || 'other_income', label: key || 'دخل آخر', icon: '➕', group: 'أخرى', color: 'var(--c-muted)' };
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
    return { key: key, label: key, icon: '•' };
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
