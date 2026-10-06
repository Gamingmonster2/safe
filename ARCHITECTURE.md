# تطبيق «مصروفي» — مواصفة معمارية ملزمة (v1)

> هذا الملف هو **العقد الملزم** لكل من يعمل على المشروع. لا تغيّر أسماء الدوال أو شكل البيانات
> دون تحديث هذا الملف والملفات التابعة له.

## 1. نظرة عامة

تطبيق إدارة أموال شخصي **عربي (RTL)** لمستخدم واحد، يعمل كموقع ثابت (Static PWA) يمكن رفعه
على GitHub Pages ودومين مجاني، ويُثبَّت على الجوال، ويعمل **أوفلاين**.

- **العملة:** الدينار الليبي — الرمز `LYD`، يُعرض بالشكل `3,400 د.ل` (خانة عشرية واحدة كحد أقصى).
- **المنطقة الزمنية:** `Africa/Tripoli` (UTC+2، بلا توقيت صيفي).
- **اللغة:** العربية فقط، الاتجاه RTL.
- **حالة البذرة (Seed):** `2026-10-05` — تاريخ اليوم الذي سُجّلت فيه الحركات.
- **لا مكتبات بناء:** لا npm، لا bundler. ملفات `.js` عادية تُحمَّل بـ `<script defer>` بالترتيب،
  وتعتمد جميعها على كائن عام واحد `window.Fin`. الوحدات **لا تستخدم** `import/export` إطلاقاً
  (حتى تعمل من `file://` وتُختبر بـ node مباشرة).
- **الرسم البياني:** Chart.js من CDN + **بديل SVG محلي** إن فشل التحميل (لازم أوفلاين).
  عملياً: `assets/js/ui.js` يرسم sparkline/bars بـ SVG فقط، ولا اعتماد على CDN إطلاقاً في v1.

## 2. هيكل الملفات ونطاق الكتابة

```
C:\vpn\safe\
├─ index.html                 # [LEAD] الهيكل، ترتيب تحميل السكربتات، شريط التنقل، حوارات
├─ ARCHITECTURE.md            # [LEAD] هذا الملف
├─ README.md                  # [LEAD]
├─ sw.js                      # [pwa] Service Worker (أوفلاين)
├─ manifest.webmanifest       # [pwa]
├─ assets/
│  ├─ css/
│  │  ├─ theme.css            # [LEAD] المتغيرات: الوضع الليلي/النهاري + الألوان
│  │  └─ app.css              # [views] تنسيق الشاشات والمكوّنات
│  ├─ img/                    # [pwa] الأيقونات PNG 192/512/180 + favicon + maskable
│  └─ js/
│     ├─ constants.js         # [LEAD] ✅ منتهي — كل الأرقام والفئات
│     ├─ util.js              # [LEAD] ✅ منتهي — تواريخ/أرقام/DOM
│     ├─ store.js             # [LEAD] ✅ منتهي — التخزين + seed + تصدير/استيراد
│     ├─ finance.js           # [LEAD] ✅ منتهي — محرّك الحسابات (لا DOM)
│     ├─ ui.js                # [LEAD] ✅ منتهي — مكوّنات ورسوم SVG
│     ├─ agent.js             # [agent] الوكيل الذكي (DeepSeek + صوت) + محرّك ملخصات محلي
│     ├─ views/
│     │  ├─ dashboard.js      # [views] لوحة اليوم
│     │  ├─ income.js         # [views] الإيرادات + الاستحقاقات غير المحصَّلة
│     │  ├─ expenses.js       # [views] المصروفات + إضافة سريعة بضغطة
│     │  ├─ accounts.js       # [views] الحسابات، الأموال المجمّعة، الادخار، المخطّط
│     │  └─ reports.js        # [views] التقارير والرسوم البيانية
│     └─ app.js               # [LEAD] الراوتر + التبويبات + الوضع الليلي
└─ tests/
   ├─ check.mjs               # [verify] اختبارات المبالغ الحقيقية (node)
   └─ screenshots/            # [verify] صور الشاشات
```

## 3. نموذج البيانات (localStorage key: `finapp.v1`)

```jsonc
{
  "version": 1,
  "settings": {
    "theme": "dark",              // "dark" | "light" | "auto"
    "currency": "LYD",
    "locale": "ar-LY",
    "agent": { "provider": "deepseek", "model": "deepseek-chat", "apiKey": "", "voice": true },
    "domain": ""
  },
  "accounts": [
    { "id": "cash",   "name": "الشنطة (نقد)",        "kind": "cash",    "opening": 5000, "order": 1 },
    { "id": "saving", "name": "مدخرات / احتياطي",     "kind": "saving",  "opening": 1500, "order": 2 }
  ],
  "locations": [
    { "id": "shop",      "name": "المحل (بجانب البيت)",         "note": "إيجار شهري 1,500", "kind": "rent" },
    { "id": "studio",    "name": "استوديو فوق المحل",           "note": "إيجار كل 3 أشهر 2,000", "kind": "rent" },
    { "id": "workshops", "name": "ورشة السمكرة + الطلاء (أرض ~300م²)", "kind": "workshop" },
    { "id": "mech",      "name": "الورشة الميكانيكية",           "kind": "workshop" },
    { "id": "rooms",     "name": "حجرات العمال",                "kind": "rent" },
    { "id": "other",     "name": "مصادر أخرى",                  "kind": "other" }
  ],
  "templates": [
    { "id": "t-shop-rent",  "locationId": "shop",      "label": "إيجار المحل",        "amount": 1500, "cycle": "monthly",   "dayOfMonth": 1, "kind": "rent", "receiptNo": "RCP-2401" },
    { "id": "t-studio-rent","locationId": "studio",    "label": "إيجار الاستوديو",    "amount": 2000, "cycle": "quarterly", "anchorMonth": 10, "kind": "rent", "receiptNo": "RCP-2402" },
    { "id": "t-ws-paint",   "locationId": "workshops", "label": "ورشة السمكرة والطلاء","amount": 1900, "cycle": "monthly", "dayOfMonth": 5, "kind": "rent", "receiptNo": "RCP-2403" },
    { "id": "t-ws-mech",    "locationId": "mech",      "label": "الورشة الميكانيكية",  "amount": 1500, "cycle": "monthly", "dayOfMonth": 5, "kind": "rent", "receiptNo": "RCP-2404" },
    { "id": "t-rooms",      "locationId": "rooms",     "label": "إيجار حجرات العمال",  "amount": 2000, "cycle": "monthly", "dayOfMonth": 5, "kind": "rent", "receiptNo": "RCP-2405" }
  ],
  "charges": [
    {
      "id": "c-2026-10-shop",
      "templateId": "t-shop-rent",
      "locationId": "shop",
      "label": "إيجار المحل",
      "period": "2026-10",         // مفتاح الفترة: شهري YYYY-MM | ربعي YYYY-Q4
      "periodStart": "2026-10-01",
      "periodEnd": "2026-10-31",
      "dueDate": "2026-10-01",
      "amount": 1500,
      "status": "pending"           // "pending" | "partial" | "paid"
    }
  ],
  "transactions": [
    {
      "id": "tx-...",
      "type": "income",             // "income" | "expense" | "transfer"
      "date": "2026-10-05",
      "amount": 3400,
      "category": "rent_workshop",  // مفتاح من CATEGORIES
      "accountId": "cash",
      "locationId": "workshops",
      "chargeId": null,             // إن كان تحصيل إيجار
      "toAccountId": null,          // للتحويل فقط
      "method": "cash",             // "cash" | "transfer" | "card" | "credit"
      "paid": true,                 // false = لم يُدفع بعد
      "planned": true,              // true = مخطّط/لم يُدفع (لا يؤثر على الرصيد)
      "note": "",
      "tags": [],
      "createdAt": "2026-10-05T21:00:00+02:00"
    }
  ],
  "receipts": [
    { "id": "rc-...", "chargeId": "c-2026-10-mech", "date": "2026-10-05", "amount": 3400, "accountId": "cash", "txId": "tx-..." }
  ],
  "fundOpening": 5000,              // ما كان في الصندوق قبل حركات اليوم (أموال مجمّعة)
  "fundSources": [                  // تفصيل «من أين جاء النقد»
    { "key": "previous_balance", "label": "رصيد سابق في الصندوق", "amount": 5000 },
    { "key": "today_rents", "label": "إيرادات اليوم (تحصيل إيجارات)", "amount": 3400, "fromToday": true },
    { "key": "today_expenses", "label": "مصروفات اليوم", "amount": -302, "fromToday": true }
  ],
  "commitments": [                  // التزامات سنوية = خطط متابعة، ليست ديوناً
    { "key": "school_annual", "label": "رسوم المدرسة السنوية", "annual": 6000, "paidThisYear": 1000, "remaining": 5000 }
  ],
  "agentChat": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ]
}
```
> **لا يوجد حقل `debt`** — التطبيق لا يعرف الديون أصلاً (انظر القاعدة 4).

### قواعد محاسبية إلزامية

1. **الرصيد** = رصيد افتتاحي + (الدخل المدفوع) − (المصروف المدفوع)، **ولا يُحسب**:
   - `planned: true` (مخطّط/لم يُدفع)
   - `paid: false`
   - `type: "transfer"` (يُطبَّق على الحسابين)
2. **التحصيل لا يُنشئ استحقاقاً جديداً**: `Finance.recordReceipt(chargeId, amount)` يسدّد الاستحقاق
   وينشئ معاملة دخل مربوطة بـ `chargeId` تلقائياً.
3. **المستحق لي (ذمم)** = مجموع `charge.amount − مدفوعات الاستحقاق` لكل استحقاق غير مسدَّد.
4. ⚠️ **لا ديون في هذا التطبيق إطلاقاً.** المستخدم لا ديون عليه. لذلك:
   - لا يوجد حقل `debt` في المعاملات، ولا دالة `Debts` تُرجع غير صفر.
   - ما لم يُدفع بعد يسمى **«مصروفات مخطّطة»** (`planned: true`, `paid: false`) ولا يُخصم من الرصيد
     حتى يُدفع (`Store.updateTransaction(id, {paid:true})` — وضبط `paid:true` يلغي `planned` تلقائياً).
   - **الالتزامات السنوية** (مثل رسوم المدرسة 6,000/سنة) تُحفظ في `state.commitments` كخطط متابعة،
     ولا تُسجَّل كمعاملات ولا تدخل مجموع المخطّط.
5. ⚠️ **الأموال المجمّعة**: النقد في الصندوق أموال مجموعة من الإيرادات، ليس قروضاً. `state.fundOpening`
   = ما كان في الصندوق قبل حركات اليوم (5,000)، و`state.fundSources` = تفصيل «من أين جاء النقد»
   (رصيد سابق 5,000 + إيرادات اليوم 3,400 − مصروف اليوم 302 = 8,098). `Finance.accumulatedFunds`.
6. **النطاق الربعي للاستوديو**: الفترة `2026-Q4` تغطي أكتوبر+نوفمبر+ديسمبر، والمبلغ 2,000
   **مبلغ الفترة كاملة** (كل ثلاثة أشهر)، تاريخ الاستحقاق `2026-10-01`. وهو **لم يُحصَّل بعد**
   (المستخدم يأخذه هذا الشهر) فيظهر ضمن «مستحق لي».
   > ملاحظة حاسمة: كلام المستخدم «أحصل 2,000 من الاستوديو» هو **دفعة الثلاثة أشهر**، لذلك مبلغ
   > الاستحقاق = 2,000 والفترة ربعية واحدة، وليس 2,000 شهرياً. لو أراد تغييره: تبويب النطاقات ← القوالب.
7. **أرقام البذرة المرجعية (لا تتغيّر بلا سبب)**: افتتاحي الصندوق 5,000 + الادخار 1,500؛
   تحصيل اليوم 3,400 (ورشة السمكرة 1,900 + الميكانيكا 1,500)؛ مصروف اليوم 302؛ صافي اليوم **+3,098**؛
   **النقد = 8,098**؛ **مستحق لي = 5,500** (محل 1,500 + استوديو 2,000 + حجرات 2,000)؛
   **مصروفات مخطّطة = 1,680**؛ **التزامات سنوية متبقية = 5,000**. الاختبارات تتحقق من هذه الأرقام.

## 4. الواجهات الملزمة (APIs)

كل ما يلي موجود فعلياً في ترتيب التحميل هذا بالضبط:
`constants.js` → `util.js` → **`finance.js`** → **`store.js`** → `ui.js`.
> ⚠️ **الترتيب ملزم**: `store.js` يلتقط `Fin.Finance` وقت التحميل (`var F = Fin.Finance`) ويستخدمه داخل
> `seed()` (`F.ensureChargeStatus`)، لذلك `store.js` **يجب** أن يأتي بعد `finance.js`، وإلا انهار
> التطبيق بشاشة بيضاء عند أول `Store.load()`. هذا الفحص مؤتمت في `tests/check.mjs`.
**اقرأ الملفات قبل الاستخدام.** لا تُعِد تعريف أي دالة موجودة.

### `Fin.C` (constants.js)

| الرمز | المعنى |
|---|---|
| `Fin.C.TODAY` | `"2026-10-05"` تاريخ البذرة/العرض الافتراضي |
| `Fin.C.CURRENCY` | `"LYD"` |
| `Fin.C.BALANCE_TOLERANCE` | `0.01` |
| `Fin.C.DAILY_EXPENSES` | مصروفات 5 أكتوبر التفصيلية (انظر الملف) |
| `Fin.C.OBLIGATIONS` | التزامات غير مسدَّدة (نطاق 180، مدرسة/كتب/زي) |
| `Fin.C.RECEIPTS_2026_10_05` | تحصيلات اليوم (ورشة السمكرة 3,400) |
| `Fin.C.OPENING` | `{ cash: 5000, saving: 1500 }` + مصدرها |
| `Fin.C.EXPENSE_CATEGORIES` | `[{key,label,icon,group}]` |
| `Fin.C.INCOME_CATEGORIES` | `[{key,label,icon,group}]` |
| `Fin.C.PAYMENT_METHODS` | `[{key,label}]` |
| `Fin.C.THEMES` | `["dark","light","auto"]` |

### `Fin.U` (util.js)

`Fin.U.todayISO()`, `Fin.U.today()` (Date في توقيت ليبيا), `Fin.U.parseISO(s)`,
`Fin.U.toISO(date)`, `Fin.U.fmtMoney(n, {sign:false})` → `"3,400 د.ل"`,
`Fin.U.fmtMoneyPlain(n)` → `"3,400"`, `Fin.U.fmtNumber(n)`, `Fin.U.fmtDate(iso, style)`,
`Fin.U.addDays(iso, n)`, `Fin.U.addMonths(iso, n)`, `Fin.U.startOfMonth(iso)`, `Fin.U.endOfMonth(iso)`,
`Fin.U.monthKey(iso)` → `"2026-10"`, `Fin.U.monthLabel(iso|key)`, `Fin.U.quarterKey(iso)` → `"2026-Q4"`,
`Fin.C`... , `Fin.U.uid(prefix)`, `Fin.U.clamp`, `Fin.U.round1`,
`Fin.U.sum(arr, fn)`, `Fin.U.groupBy(arr, fn)`, `Fin.U.el(tag, attrs, children)`,
`Fin.U.$`, `Fin.U.$$`, `Fin.U.escapeHtml(s)`, `Fin.U.debounce(fn, ms)`, `Fin.U.download(filename, text, mime)`,
`Fin.U.rangeDays(fromISO, toISO)`, `Fin.U.lastNDays(n, endISO)`, `Fin.U.isRTLText(s)`, `Fin.U.hashCode(s)`.

### `Fin.Store` (store.js)

- `Fin.Store.state` — الحالة الحالية (كائن البيانات أعلاه) — **لا تُعدّله مباشرة**.
- `Fin.Store.load()` → state. `Fin.Store.save()` (debounced). `Fin.Store.reset(seedSlug?)`.
- `Fin.Store.subscribe(fn)` → unsubscribe؛ `fn(state, changeInfo)`.
- `Fin.Store.addTransaction(tx)` → tx كامل (id/createdAt مضمونة).
- `Fin.Store.updateTransaction(id, patch)`, `Fin.Store.removeTransaction(id)`.
- `Fin.Store.addCharge(charge)`, `Fin.Store.updateCharge(id, patch)`.
- `Fin.Store.addReceipt(receipt)` → ينشئ معاملة دخل مرتبطة (يستدعي Finance).
- `Fin.Store.updateSettings(patch)`, `Fin.Store.addAccount(acc)`, `Fin.Store.updateAccount(id, patch)`.
- `Fin.Store.exportJSON()` → نص `BackupFile` مُغلَّف. `Fin.Store.importJSON(text)` → `{ok, error}`.
- `Fin.Store.ensureCharges(uptoISO)` → ينشئ الاستحقاقات الناقصة من القوالب حتى تاريخ معيّن.
- `Fin.Store.addChatMessage(role, content)`, `Fin.Store.clearChat()`.

### `Fin.Finance` (finance.js) — منطق خالص بلا DOM

تواريخ بصيغة `YYYY-MM-DD`، والمقارنات نصية (آمنة).

- `Fin.Finance.balanceOf(state, accountId)` → رقم
- `Fin.Finance.totalBalance(state)` → مجموع كل الحسابات النقدية والادخار
- `Fin.Finance.txInRange(state, from, to, opts)` → مصفوفة معاملات
- `Fin.Finance.daySummary(state, iso)` → `{ income, expense, net, txCount, unpaid }`
- `Fin.Finance.rangeSummary(state, from, to)` → `{ income, expense, net, byCategory, byDay, byAccount, txCount }`
- `Fin.Finance.monthSummary(state, monthKey)` → نفس الشكل + `{ monthKey, label }`
- `Fin.Finance.expenseByCategory(state, from, to)` → `[{key,label,icon,amount,pct,count}]` مرتّبة تنازلياً
- `Fin.Finance.incomeBySource(state, from, to)` → `[{key,label,amount,pct,count}]`
- `Fin.Finance.receivables(state, asOfISO)` → `{ total, items:[{chargeId,label,locationId,amount,dueDate,daysLate,status,paid}] }`
- `Fin.Finance.obligations(state)` → `{ total, plannedTotal, immediateTotal, count, items }` (مصروفات `paid:false`)
- `Fin.Finance.debts(state)` → دائماً `{ total: 0, count: 0, items: [] }` (لا ديون — للتوافق فقط)
- `Fin.Finance.accumulatedFunds(state)` → `{ total, opening, openingNote, sources, todayIncome, todayExpense, saving, grandTotal }`
- `Fin.Finance.commitments(state)` → `{ list:[{annual,paidThisYear,remaining,pct}], count, annualTotal, paidTotal, remainingTotal }`
- `Fin.Finance.dailySeries(state, from, to)` → `[{date, income, expense, net, balance}]`
- `Fin.Finance.monthlySeries(state, n, endISO)` → `[{monthKey,label,income,expense,net}]`
- `Fin.Finance.savingsStats(state, monthKey)` → `{ income, expense, net, rate, savingBalance, monthsCovered }`
- `Fin.Finance.topExpenses(state, from, to, n)` → أكبر المصروفات
- `Fin.Finance.alerts(state, asOfISO)` → `[{level:'warn'|'info'|'danger', icon, title, body}]`
- `Fin.Finance.compareRanges(state, a, b)` → `{a, b, delta:{income,expense,net}}`
- `Fin.Finance.cashFlowForecast(state, asOfISO, days)` → **كائن** (وليس مصفوفة):
  `{ asOf, horizon, openingBalance, totalExpected, closingBalance, events:[{date,expected,label,kind,chargeId?,templateId?}], series:[{date,expected,cumulative,balance}] }`
  - `events` = الاستحقاقات القائمة غير المسدّدة + الاستحقاقات القادمة من القوالب (بلا تكرار: مفتاح `templateId|period`).
  - إن أردت السلسلة اليومية فقط: استخدم `res.series`.
- `Fin.Finance.categoryTotals(state, from, to, type)` → `{key: amount}`
- `Fin.Finance.periodTotals(state, from, to)` → `{income, expense, net, count}` (مدفوع فقط)

### `Fin.UI` (ui.js) — مكوّنات DOM تُرجع HTMLElement أو HTML نصي

- `Fin.UI.theme` → `{ get(), set(mode), toggle(), apply() }`
- `Fin.UI.card({title, value, sub, icon, tone, onClick, extra})` → HTMLElement
- `Fin.UI.statGrid(cards)` → HTMLElement
- `Fin.UI.list(items, {render, empty})` → HTMLElement
- `Fin.UI.badge(text, tone)` → HTMLElement
- `Fin.UI.progress(pct, tone)` → HTMLElement
- `Fin.UI.sparkline(values, opts)` → SVG string (bars/line)
- `Fin.UI.donut(items, opts)` → SVG string
- `Fin.UI.bars(items, opts)` → SVG string
- `Fin.UI.money(n, opts)` → HTML نصي ملوّن
- `Fin.UI.modal({title, body, actions, onSubmit})` → Promise
- `Fin.UI.toast(message, tone)`
- `Fin.UI.confirm(message)` → Promise<boolean>
- `Fin.UI.txRow(tx, {onEdit, onDelete})` → HTMLElement
- `Fin.UI.emptyState(icon, title, body)` → HTMLElement
- `Fin.UI.chip(label, {active, onClick})` → HTMLElement
- `Fin.UI.form(fields, {values, onSubmit})` → {el, getValues, validate}
- `Fin.UI.copy(text)` → Promise<boolean>

### `Fin.Agent` (agent.js) — يكتبه [agent]

- `Fin.Agent.mount(container)` → يبني واجهة الوكيل داخل العنصر
- `Fin.Agent.ask(text)` → Promise<string> (يستخدم DeepSeek إن وُجد مفتاح، وإلا المحرّك المحلي)
- `Fin.Agent.localAnswer(question, state)` → نص (بلا شبكة)
- `Fin.Agent.summarize(period)` → ملخص مكتوب
- `Fin.Agent.speak(text)` / `Fin.Agent.listen()` (Web Speech API اختياري)
- `Fin.Agent.tools` → `{ [name]: {desc, args, run(state,args)} }` للتوسعة لاحقاً

### `Fin.Views` (views/*.js) — كل شاشة

```js
Fin.Views.dashboard = {
  id: 'dashboard',
  title: 'لوحة اليوم',        // يظهر في شريط التنقل
  icon: '🏠',
  order: 1,
  render(root, ctx) { /* يبني المحتوى داخل root */ },
  destroy() {}                // اختياري
};
```

`ctx = { refresh(), go(viewId), state }`. كل شاشة **تسجّل نفسها** في `Fin.Views` عند التحميل.

### `Fin.App` (app.js) — الراوتر

- `Fin.App.register(view)`, `Fin.App.go(id)`, `Fin.App.refresh()`
- المسار: `#/dashboard`, `#/income`, `#/expenses`, `#/accounts`, `#/reports`, `#/agent`, `#/settings`.

## 5. قواعد التصميم

- **RTL** كامل: `<html dir="rtl" lang="ar">`. الأرقام تبقى لاتينية (`1,500`) لأنها أوضح للمستخدم.
- **الوضعان:** نهاري/ليلي عبر `data-theme` على `<html>`، ألوان في `theme.css` فقط.
  - ليلي: خلفية `#0b1020`, سطح `#141a2e`, نص `#e8ecf6`, أساسي `#2f6df6`, دخل `#22c55e`, مصروف `#f43f5e`, ادخار `#f59e0b`.
  - نهاري: خلفية `#f4f6fb`, سطح `#ffffff`, نص `#101527`, أساسي `#1d4ed8`, نفس دلالات الدخل/المصروف.
- **الجوال أولاً:** أهداف لمس ≥ 44px، شريط تنقل سفلي ثابت على الجوال، آمن للمناطق `env(safe-area-inset-*)`.
- **إضافة سريعة:** «+ خضار» بضغطة واحدة من الشاشة الرئيسية (أزرار الفئات المفضّلة).
- **بدون شبكة = بدون كسر:** كل شيء يعمل أوفلاين؛ الوكيل فقط يحتاج إنترنت.
- ⚠️ **لا صوت تلقائي إطلاقاً**: التطبيق **منظومة تسجيل**، لا منظومة صوت. لذلك:
  - `settings.agent.voice` افتراضيه `false`، والنطق لا يعمل إلا إذا فعّله المستخدم بنفسه (`voice === true`).
  - `Agent.silence()` تُنادى عند إقلاع التطبيق وعند مغادرة شاشة المساعد.
  - الإدخال الصوتي (🎤) مستقل (`voiceInput`) ولا يُشغّل أي نطق.
  - لا `aria-live` على حاوية التنبيهات حتى لا ينطق قارئ الشاشة الرسائل تلقائياً.
- لا `innerHTML` بمحتوى مستخدم دون `Fin.U.escapeHtml`.

## 6. معايير القبول (Definition of Done)

1. `node tests/check.mjs` ينجح بصفر فشل.
2. الأرقام الحقيقية تظهر صحيحة في الشاشة (اليوم 2026-10-05):
   - دخل اليوم **3,400** (ورشة السمكرة 1,900 + الميكانيكا 1,500 — وهما محصَّلتان فعلاً اليوم)،
     مصروف اليوم **302**، صافي اليوم **+3,098**.
   - النقد في الصندوق **8,098** (5,000 افتتاحي + 3,400 − 302)، الادخار **1,500**، إجمالي الأموال **9,598**.
   - **مستحق لي ولم يُحصَّل = 5,500**، ويتكوّن من:
     | البند | المبلغ | الفترة | الحالة |
     |---|---|---|---|
     | إيجار المحل | 1,500 | 2026-10 شهري | لم يُحصَّل (متأخر) |
     | إيجار الاستوديو | 2,000 | 2026-Q4 ربعي (10+11+12) | لم يُحصَّل — يأخذه هذا الشهر |
     | إيجار حجرات العمال | 2,000 | 2026-10 شهري | لم يُحصَّل |
     > الورشتان (السمكرة 1,900 + الميكانيكا 1,500 = 3,400) **محصَّلتان اليوم**، فلا تظهران في المستحق.
   - **لا ديون إطلاقاً** (`F.debts().total === 0`). المصروفات المخطّطة **1,680**
     (نطاق .org 180 + كتب 950 + زي 450 + بنزين 100)، والتزامات سنوية متبقية **5,000**
     (رسوم المدرسة 6,000 − مدفوع 1,000) — كلها لا تُخصم من الرصيد حتى تُدفع.
   - النطاق ينشئ الفترة `2026-Q4` للاستوديو فقط، وفترة `2026-10` للأربعة الشهرية.
   - النطاقات: 8 مسجّلة، `toolseer.com` حرج (7 أيام)، تكلفة قريبة 225، سنوية 450.
3. الوكيل: بلا مفتاح يرد محلياً بصدق («أضف المفتاح في الإعدادات»)؛ مع مفتاح يجيب فعلياً.
4. الوضع الليلي/النهاري يعمل ويُحفظ؛ التطبيق يُثبَّت على الجوال (manifest + service worker).
5. لا أخطاء في console.
