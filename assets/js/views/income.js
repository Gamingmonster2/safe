/* =============================================================================
 * مصروفي — views/income.js
 * «الإيرادات»: المستحق لي ولم يُحصَّل + التحصيل بالسندات + القوالب الخمسة.
 * كل التعديلات عبر Fin.Store (recordReceipt / updateTemplate / addTransaction).
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U, UI = Fin.UI, Store = Fin.Store, F = Fin.Finance;
  Fin.Views = Fin.Views || {};

  /* أيقونة SVG احترافية من icons.js (بديل الإيموجي) */
  function icon(name, opts) {
    opts = opts || {};
    if (!Fin.I) return U.el('span', { class: 'ic-wrap' });
    var key = (name && Fin.I.has(name)) ? name : (opts.fallback || 'package');
    return Fin.I.el(key, { size: opts.size || 20, tone: opts.tone || null });
  }

  /* حالة فراغ بأيقونة SVG (بنفس بنية UI.emptyState) */
  function emptyBox(name, title, body) {
    return U.el('div', { class: 'empty' }, [
      U.el('div', { class: 'empty-ico' }, [icon(name, { size: 36 })]),
      U.el('div', { class: 'empty-title', text: title || 'لا يوجد شيء بعد' }),
      body ? U.el('div', { class: 'empty-body', text: body }) : null
    ]);
  }

  /* ------------------------------------------------------ أدوات محلية */

  // القوائم المنسدلة تعرض النص فقط — الأيقونة لا تظهر داخل <option>
  function incomeCatOptions() {
    return C.INCOME_CATEGORIES.map(function (c) { return { value: c.key, label: c.label }; });
  }
  function accountOptions(state) {
    return (state.accounts || []).map(function (a) { return { value: a.id, label: a.name }; });
  }
  function methodOptions() {
    return C.PAYMENT_METHODS.filter(function (m) { return m.key !== 'credit'; })
      .map(function (m) { return { value: m.key, label: m.label }; });
  }
  function locationOptions(state) {
    return [{ value: '', label: '— بلا مكان —' }].concat((state.locations || C.LOCATIONS).map(function (l) {
      return { value: l.id, label: l.name };
    }));
  }
  function cycleLabel(tpl) {
    if (tpl.cycle === 'quarterly') return 'كل 3 أشهر';
    if (tpl.cycle === 'yearly') return 'سنوي';
    return 'شهري';
  }
  function suggestedPeriod(tpl, asOf) {
    return U.periodLabel(Store.periodFor(tpl, asOf).key);
  }
  function matchRange(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[0];
  }
  function chargeStatusOf(state, ch) {
    var paid = F.chargePaid(state, ch.id);
    var amount = Number(ch.amount) || 0;
    var remaining = U.round(amount - paid);
    var status = remaining <= 0.001 ? 'paid' : (paid > 0.001 ? 'partial' : 'pending');
    return { paid: paid, amount: amount, remaining: remaining < 0 ? 0 : remaining, status: status, receiptCount: Store.receiptsOf(ch.id).length };
  }

  /* ----------------------------------------------------------- حالة الوحدة */

  var activeKey = 'month';   // فترة ملخص الإيرادات
  var chargeFilter = 'all';  // كل / لم يُحصَّل / محصَّل

  /* ====================================================== نافذة التحصيل */

  function openCollectModal(item, ctx) {
    var state = ctx.state;
    var charge = null;
    state.charges.forEach(function (c) { if (c.id === item.chargeId) charge = c; });
    if (!charge) { UI.toast('الاستحقاق غير موجود', 'danger'); return; }

    var st = chargeStatusOf(state, charge);
    var form = UI.form([
      { name: 'amount', label: 'المبلغ المحصَّل (د.ل)', type: 'money', required: true, hint: 'المتبقي ' + U.fmtMoney(st.remaining) + ' من أصل ' + U.fmtMoney(st.amount) },
      { name: 'date', label: 'تاريخ التحصيل', type: 'date', required: true },
      { name: 'accountId', label: 'إلى حساب', type: 'select', options: accountOptions(state) },
      { name: 'method', label: 'طريقة القبض', type: 'select', options: methodOptions() },
      { name: 'ref', label: 'رقم السند / المرجع', type: 'text', span: 2, placeholder: charge.receiptNo || 'اختياري' },
      { name: 'note', label: 'ملاحظة', type: 'text', span: 2, placeholder: 'مثال: استلمت نصف المبلغ والباقي آخر الشهر' }
    ], {
      values: {
        amount: st.remaining,
        date: ctx.asOf || U.todayISO(),
        accountId: (state.accounts && state.accounts[0]) ? state.accounts[0].id : 'cash',
        method: 'cash',
        ref: charge.receiptNo || '',
        note: ''
      }
    });

    UI.modal({
      title: 'تحصيل: ' + charge.label,
      body: U.el('div', {}, [
        U.el('div', { class: 'summary-strip' }, [
          U.el('span', { text: U.periodLabel(charge.period) }),
          U.el('span', { class: 'muted', text: 'استحقاق ' + U.dateLabel(charge.dueDate, 'short') }),
          item.daysLate > 0 ? UI.badge('متأخر ' + item.daysLate + ' يوم', 'danger') : null,
          st.status === 'partial' ? UI.badge('جزئي', 'warn') : null
        ]),
        form.el
      ]),
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'تسجيل التحصيل', tone: 'success', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        var amount = Number(v.amount) || 0;
        if (amount <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return { ok: false }; }
        if (amount > st.remaining + 0.01) {
          UI.toast('المبلغ أكبر من المتبقي (' + U.fmtMoney(st.remaining) + ')', 'danger');
          return { ok: false };
        }
        var res = Store.recordReceipt(charge.id, amount, {
          date: v.date,
          accountId: v.accountId || 'cash',
          method: v.method || 'cash',
          ref: v.ref || undefined,
          note: v.note || ''
        });
        if (!res || res.ok === false) { UI.toast((res && res.error) || 'تعذّر تسجيل التحصيل', 'danger'); return { ok: false }; }
        var after = F.chargePaid(Store.state, charge.id);
        UI.toast(
          'تم تحصيل ' + U.fmtMoney(amount) + ' — ' + (after + 0.01 >= st.amount ? 'الاستحقاق صار مسدَّداً بالكامل' : 'بقي ' + U.fmtMoney(U.round(st.amount - after))),
          'success'
        );
        return { ok: true };
      }
    });
  }

  /* ================================================ نافذة سندات الاستحقاق */

  function openReceiptsModal(charge, ctx) {
    var receipts = Store.receiptsOf(charge.id);
    var body = receipts.length
      ? UI.list(receipts.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }), {
        render: function (r) {
          return U.el('div', { class: 'list-item' }, [
            U.el('span', { class: 'tx-ico in' }, [icon('receipt', { size: 20 })]),
            U.el('div', { class: 'tx-main' }, [
              U.el('div', { class: 'tx-title', text: U.dateLabel(r.date) }),
              U.el('div', { class: 'tx-meta' }, [
                U.el('span', { text: 'إلى حساب ' + r.accountId + (r.ref ? ' · سند ' + r.ref : '') }),
                r.note ? U.el('span', { text: ' · ' + r.note }) : null
              ])
            ]),
            UI.amountBlock(r.amount, true, { currency: false }),
            UI.iconBtn('refresh', 'تراجع عن التحصيل', function () {
              if (!Store.unrecordReceipt) { UI.toast('التراجع غير متاح', 'danger'); return; }
              UI.confirm('التراجع عن سند ' + U.fmtMoney(r.amount) + ' بتاريخ ' + U.dateLabel(r.date, 'short') + '؟ سيُحذف معه سجل الدخل المرتبط.', { title: 'تراجع عن تحصيل' })
                .then(function (ok) {
                  if (!ok) return;
                  Store.unrecordReceipt(r.id);
                  UI.toast('تم التراجع عن التحصيل', 'success');
                  openReceiptsModal(charge, ctx);
                });
            })
          ]);
        }
      })
      : emptyBox('receipt', 'لا سندات بعد', 'لم يُسجَّل أي تحصيل على هذا الاستحقاق.');

    UI.modal({
      title: 'سندات: ' + charge.label,
      body: body,
      actions: [{ label: 'إغلاق', tone: 'ghost' }]
    });
  }

  /* =================================================== نافذة تعديل القالب */

  function openTemplateModal(tpl) {
    var form = UI.form([
      { name: 'label', label: 'الاسم', type: 'text', required: true, span: 2 },
      { name: 'amount', label: 'المبلغ لكل فترة (د.ل)', type: 'money', required: true, hint: 'مثال: 2,000 للاستوديو = مبلغ الثلاثة أشهر كاملاً، وليس شهرياً' },
      { name: 'dayOfMonth', label: 'يوم الاستحقاق في الشهر', type: 'number', min: 1, max: 28 },
      { name: 'cycle', label: 'التكرار', type: 'select', options: [
        { value: 'monthly', label: 'شهري' },
        { value: 'quarterly', label: 'كل 3 أشهر (ربعي)' },
        { value: 'yearly', label: 'سنوي' }
      ] },
      { name: 'receiptNo', label: 'رقم السند الافتراضي', type: 'text', placeholder: 'اختياري' }
    ], {
      values: {
        label: tpl.label,
        amount: tpl.amount,
        dayOfMonth: tpl.dayOfMonth || 1,
        cycle: tpl.cycle || 'monthly',
        receiptNo: tpl.receiptNo || ''
      }
    });

    var recalc = null;

    UI.modal({
      title: 'تعديل القالب: ' + tpl.label,
      body: U.el('div', {}, [
        U.el('div', { class: 'alert alert-info' }, [
          U.el('div', { class: 'alert-ico' }, [icon('info', { size: 14 })]),
          U.el('div', { class: 'alert-main' }, [
            U.el('div', { class: 'alert-title', text: 'تعديل القالب لا يغيّر الاستحقاقات المُنشأة' }),
            U.el('div', { class: 'alert-body', text: 'يُطبَّق على الاستحقاقات القادمة. لو أردت تغيير استحقاق قائم، عدّل مبلغه من قائمة الاستحقاقات.' })
          ])
        ]),
        form.el
      ]),
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'حفظ القالب', tone: 'primary', type: 'submit' }
      ],
      onMount: function () { recalc = true; },
      onSubmit: function () {
        var v = form.getValues();
        if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return { ok: false }; }
        Store.updateTemplate(tpl.id, {
          label: v.label,
          amount: v.amount,
          dayOfMonth: U.clamp(Number(v.dayOfMonth) || 1, 1, 28),
          cycle: v.cycle,
          receiptNo: v.receiptNo || null
        });
        UI.toast('تم تحديث القالب', 'success');
        return { ok: true };
      }
    });
    return recalc;
  }

  /* ================================================ نافذة تعديل استحقاق */

  function openChargeModal(charge) {
    var form = UI.form([
      { name: 'amount', label: 'مبلغ الاستحقاق (د.ل)', type: 'money', required: true },
      { name: 'dueDate', label: 'تاريخ الاستحقاق', type: 'date', required: true },
      { name: 'label', label: 'الوصف', type: 'text', span: 2 }
    ], { values: { amount: charge.amount, dueDate: charge.dueDate, label: charge.label } });

    UI.modal({
      title: 'تعديل استحقاق ' + U.periodLabel(charge.period),
      body: form.el,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'حفظ', tone: 'primary', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return { ok: false }; }
        Store.updateCharge(charge.id, { amount: Number(v.amount), dueDate: v.dueDate, label: v.label });
        UI.toast('تم تحديث الاستحقاق', 'success');
        return { ok: true };
      }
    });
  }

  /* ======================================================== نافذة دخل جديد */

  function openIncomeModal(ctx) {
    var state = ctx.state;
    var form = UI.form([
      { name: 'amount', label: 'المبلغ (د.ل)', type: 'money', required: true },
      { name: 'category', label: 'المصدر', type: 'select', options: incomeCatOptions(), required: true },
      { name: 'date', label: 'التاريخ', type: 'date', required: true },
      { name: 'locationId', label: 'المكان', type: 'select', options: locationOptions(state) },
      { name: 'accountId', label: 'الحساب', type: 'select', options: accountOptions(state) },
      { name: 'method', label: 'طريقة القبض', type: 'select', options: methodOptions() },
      { name: 'note', label: 'ملاحظة', type: 'text', span: 2, placeholder: 'مثال: دعم الوالد' }
    ], {
      values: {
        amount: '',
        category: 'other_income',
        date: ctx.asOf || U.todayISO(),
        locationId: 'other',
        accountId: (state.accounts && state.accounts[0]) ? state.accounts[0].id : 'cash',
        method: 'cash',
        note: ''
      }
    });

    UI.modal({
      title: 'إيراد جديد',
      body: form.el,
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'إضافة', tone: 'primary', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return { ok: false }; }
        var cat = C.catIncome(v.category);
        Store.addTransaction({
          type: 'income',
          date: v.date,
          amount: v.amount,
          category: v.category,
          label: cat.label,
          accountId: v.accountId || 'cash',
          locationId: v.locationId || null,
          method: v.method || 'cash',
          paid: true,
          note: v.note || ''
        });
        UI.toast('تم إضافة دخل ' + U.fmtMoney(v.amount), 'success');
        return { ok: true };
      }
    });
  }

  /* ============================================================== البناء */

  function render(rootEl, ctx) {
    var state = ctx.state || Store.state;
    var asOf = ctx.asOf || U.todayISO();
    var rec = F.receivables(state, asOf);

    /* ============================ 1) المستحق لي ولم يُحصَّل (أعلى الشاشة) */
    var recCard = U.el('div', { class: 'card card-expense' }, [
      U.el('div', { class: 'card-head' }, [
        icon('hourglass', { size: 20 }),
        U.el('div', { class: 'card-title', text: 'مستحق لي ولم يُحصَّل' }),
        U.el('div', { class: 'card-extra', text: rec.count + ' استحقاق' })
      ]),
      U.el('div', { class: 'card-body' }, [
        U.el('div', { class: 'card-value tx-warn', text: U.fmtMoney(rec.total) }),
        U.el('div', { class: 'card-sub' }, [
          U.el('span', { text: rec.overdueTotal > 0 ? ('متأخر منها ' + U.fmtMoney(rec.overdueTotal)) : 'لا شيء متأخر — كل الاستحقاقات في موعدها' })
        ])
      ])
    ]);

    var recRows = rec.items.map(function (item) {
      return UI.chargeRow(item, { onCollect: function (it) { openCollectModal(it, ctx); } });
    });

    rootEl.appendChild(UI.section('المستحق لي', [
      recCard,
      rec.items.length ? U.el('div', { class: 'list' }, recRows)
        : emptyBox('checkCircle', 'لا مستحق غير محصَّل', 'كل الاستحقاقات محصَّلة حتى ' + U.dateLabel(asOf, 'short')),
      U.el('div', { class: 'summary-strip' }, [
        U.el('span', { class: 'muted', text: 'التحصيل يُنشئ سجل دخل وسنداً ويربطه بالاستحقاق تلقائياً.' }),
        UI.btn('دخل يدوي', { icon: 'plus', tone: 'ghost', className: 'btn-sm', onClick: function () { openIncomeModal(ctx); } })
      ])
    ]));

    /* ============================ 2) الاستحقاقات والدفعات (كل الفترات) */
    var charges = (state.charges || []).slice().sort(function (a, b) {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? 1 : -1;
      return String(a.label).localeCompare(String(b.label));
    });
    var rows = charges.map(function (ch) { return { ch: ch, st: chargeStatusOf(state, ch) }; });
    var shown = rows.filter(function (r) {
      if (chargeFilter === 'open') return r.st.remaining > 0.001;
      if (chargeFilter === 'paid') return r.st.status === 'paid';
      return true;
    });
    var totals = {
      all: U.sum(rows, function (r) { return r.st.amount; }),
      paid: U.sum(rows.filter(function (r) { return r.st.status === 'paid'; }), function (r) { return r.st.amount; }),
      open: U.sum(rows.filter(function (r) { return r.st.remaining > 0.001; }), function (r) { return r.st.remaining; })
    };

    var filterTabs = U.el('div', { class: 'tabs tabs-scroll' }, [
      ['all', 'الكل (' + rows.length + ')'],
      ['open', 'لم تُحصَّل (' + rows.filter(function (r) { return r.st.remaining > 0.001; }).length + ')'],
      ['paid', 'محصَّلة (' + rows.filter(function (r) { return r.st.status === 'paid'; }).length + ')']
    ].map(function (pair) {
      return U.el('button', {
        type: 'button',
        class: 'tab' + (chargeFilter === pair[0] ? ' is-active' : ''),
        text: pair[1],
        onClick: function () { chargeFilter = pair[0]; render(rootEl, ctx); }
      });
    }));

    var chargeList = shown.length ? U.el('div', { class: 'list' }, shown.map(function (r) {
      var ch = r.ch, st = r.st;
      var tpl = C.template(ch.templateId);
      var loc = C.location(ch.locationId);
      var tone = st.status === 'paid' ? 'income' : (st.status === 'partial' ? 'warn' : 'danger');
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'tx-ico ' + (st.status === 'paid' ? 'in' : 'out') }, [icon(loc ? loc.icon : null, { size: 20, fallback: 'building' })]),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: ch.label + ' — ' + U.periodLabel(ch.period) }),
          U.el('div', { class: 'tx-meta' }, [
            U.el('span', { text: 'استحقاق ' + U.dateLabel(ch.dueDate, 'short') }),
            tpl ? U.el('span', { text: ' · قالب ' + cycleLabel(tpl) + ' ' + U.fmtMoney(tpl.amount) }) : null,
            st.paid > 0 ? U.el('span', { text: ' · حُصِّل ' + U.fmtMoney(st.paid) }) : null
          ]),
          U.el('div', { class: 'tx-flags' }, [
            UI.badge(st.status === 'paid' ? 'محصَّل' : (st.status === 'partial' ? 'جزئي' : 'لم يُحصَّل'), tone),
            st.receiptCount ? UI.badge(st.receiptCount + ' سند', 'info') : null
          ])
        ]),
        U.el('div', { class: 'tx-amount ' + (st.status === 'paid' ? 'tx-income' : '') }, [
          U.el('span', { text: U.fmtMoney(st.status === 'paid' ? st.amount : st.remaining) }),
          U.el('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '400' }, text: st.status === 'paid' ? ' محصَّل' : ' متبقٍ' })
        ]),
        U.el('div', { class: 'tx-actions' }, [
          st.remaining > 0.001 ? UI.iconBtn('cash', 'تحصيل', function () {
            openCollectModal({
              chargeId: ch.id, label: ch.label, locationId: ch.locationId,
              daysLate: U.daysLate(ch.dueDate, asOf), status: st.status, periodLabel: U.periodLabel(ch.period),
              remaining: st.remaining, amount: st.amount, dueDate: ch.dueDate, paid: st.paid
            }, ctx);
          }) : null,
          UI.iconBtn('receipt', 'السندات', function () { openReceiptsModal(ch, ctx); }),
          UI.iconBtn('edit', 'تعديل المبلغ/الاستحقاق', function () { openChargeModal(ch); })
        ])
      ]);
    })) : emptyBox('receipt', 'لا استحقاقات في هذا التصنيف', 'غيّر التصنيف لعرض الباقي.');

    rootEl.appendChild(UI.section('الاستحقاقات والدفعات', [
      U.el('div', { class: 'stat-grid' }, [
        UI.stat({ icon: 'receipt', label: 'إجمالي الاستحقاقات', value: U.fmtMoney(totals.all), sub: rows.length + ' استحقاق من ' + (state.templates || []).length + ' قالب' }),
        UI.stat({ icon: 'checkCircle', label: 'محصَّل', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(totals.paid), sub: totals.all > 0 ? U.fmtPct(U.pct(totals.paid, totals.all)) + ' من الإجمالي' : '' }),
        UI.stat({ icon: 'hourglass', label: 'متبقٍ', tone: 'warn', valueClass: 'tx-warn', value: U.fmtMoney(totals.open), sub: 'على ' + rows.filter(function (r) { return r.st.remaining > 0.001; }).length + ' استحقاق' })
      ]),
      filterTabs,
      chargeList
    ]));

    /* ============================ 3) ملخص إيرادات الفترة */
    var range = matchRange(UI.standardRanges(asOf), activeKey);
    var sum = F.rangeSummary(state, range.from, range.to);
    var bySource = F.incomeBySource(state, range.from, range.to);
    var byLocation = F.incomeByLocation(state, range.from, range.to);

    var srcItems = bySource.map(function (s) { return { label: s.label, amount: s.amount, color: s.color || 'var(--c-income)' }; });
    var locItems = byLocation.map(function (s, i) {
      var palette = ['var(--c-income)', 'var(--c-primary)', 'var(--c-warn)', 'var(--c-info)', 'var(--c-expense)', 'var(--c-muted)'];
      return { label: s.label, amount: s.amount, color: palette[i % palette.length] };
    });

    var mixBox = (bySource.length || byLocation.length) ? U.el('div', { class: 'chart-row' }, [
      U.el('div', { html: UI.donut(srcItems.length ? srcItems : locItems, {
        size: 168,
        centerValue: U.fmtCompact ? U.fmtCompact(sum.income) : String(sum.income),
        centerLabel: 'دخل الفترة'
      }) }),
      UI.legend((srcItems.length ? bySource : byLocation).slice(0, 8).map(function (s, i) {
        return {
          label: s.label + ' (' + U.fmtPct(s.pct) + ')',
          color: (srcItems.length ? srcItems : locItems)[i].color,
          amount: s.amount
        };
      }))
    ]) : emptyBox('chart', 'لا دخل في هذه الفترة', 'جرّب فترة أخرى أو سجّل تحصيلاً.');

    var locRows = byLocation.map(function (s) {
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'tx-ico in' }, [icon(s.icon, { size: 20, fallback: 'building' })]),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: s.label }),
          U.el('div', { class: 'tx-meta' }, [U.el('span', { text: s.count + ' دفعة · ' + U.fmtPct(s.pct) })])
        ]),
        UI.amountBlock(s.amount, true, { currency: false })
      ]);
    });

    rootEl.appendChild(UI.section('ملخص إيرادات الفترة', [
      UI.rangeTabs(UI.standardRanges(asOf), activeKey, function (r) { activeKey = r.key; render(rootEl, ctx); }),
      UI.statGrid([
        UI.stat({ icon: 'arrowUp', label: 'إجمالي الدخل', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(sum.income), sub: range.label }),
        UI.stat({ icon: 'receipt', label: 'عدد الدفعات', value: U.fmtNumber(sum.txCount), sub: sum.income > 0 ? 'متوسط ' + U.fmtMoney(U.round1(sum.income / Math.max(1, sum.txCount))) : '' }),
        UI.stat({ icon: 'target', label: 'أعلى مصدر', tone: 'primary', value: bySource.length ? U.fmtMoney(bySource[0].amount) : '—', sub: bySource.length ? bySource[0].label + ' (' + U.fmtPct(bySource[0].pct) + ')' : 'لا دخل' })
      ]),
      UI.card({ title: 'حسب المصدر', icon: 'chart', body: mixBox }),
      locRows.length ? UI.card({ title: 'حسب المكان', icon: 'building', body: UI.list(locRows, { empty: null }) }) : null
    ]));

    /* ============================ 4) إدارة القوالب الخمسة */
    var tplRows = (state.templates || []).map(function (tpl) {
      var loc = C.location(tpl.locationId);
      var related = rows.filter(function (r) { return r.ch.templateId === tpl.id; });
      var openCount = related.filter(function (r) { return r.st.remaining > 0.001; }).length;
      var openTotal = U.sum(related.filter(function (r) { return r.st.remaining > 0.001; }), function (r) { return r.st.remaining; });
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'tx-ico' }, [icon(loc ? loc.icon : null, { size: 20, fallback: 'building' })]),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: tpl.label }),
          U.el('div', { class: 'tx-meta' }, [
            U.el('span', { text: (loc ? loc.name : '—') + ' · ' + cycleLabel(tpl) + ' · يوم ' + (tpl.dayOfMonth || 1) }),
            U.el('span', { text: ' · القادم: ' + suggestedPeriod(tpl, asOf) })
          ]),
          U.el('div', { class: 'tx-flags' }, [
            UI.badge(U.fmtMoney(tpl.amount), 'income'),
            openCount ? UI.badge(openCount + ' غير محصَّل (' + U.fmtMoney(openTotal, { currency: false }) + ')', 'danger') : UI.badge('لا متأخرات', 'muted'),
            tpl.receiptNo ? UI.badge(tpl.receiptNo, 'info') : null
          ])
        ]),
        U.el('div', { class: 'tx-actions' }, [
          UI.iconBtn('edit', 'تعديل المبلغ/يوم الاستحقاق', function () { openTemplateModal(tpl); })
        ])
      ]);
    });

    rootEl.appendChild(UI.section('قوالب الاستحقاق', [
      U.el('div', { class: 'alert alert-info' }, [
        U.el('div', { class: 'alert-ico' }, [icon('info', { size: 14 })]),
        U.el('div', { class: 'alert-main' }, [
          U.el('div', { class: 'alert-title', text: 'المبلغ = قيمة الفترة الواحدة' }),
          U.el('div', { class: 'alert-body', text: 'استوديو فوق المحل: 2,000 كل ثلاثة أشهر (وليست شهرياً). إيجار المحل 1,500 شهرياً، والورشتان 1,900 + 1,500 كل شهر يوم 5، وحجرات العمال 2,000.' })
        ])
      ]),
      U.el('div', { class: 'list' }, tplRows)
    ]));

    rootEl.appendChild(UI.btn('دخل جديد (تحصيل يدوي)', { icon: 'plus', tone: 'primary', className: 'btn-block', onClick: function () { openIncomeModal(ctx); } }));
  }

  Fin.Views.income = {
    id: 'income',
    title: 'الإيرادات',
    icon: 'wallet',
    order: 3,
    subtitle: 'المستحق لي والتحصيل',
    render: render,
    destroy: function () {}
  };
})();
