/* =============================================================================
 * مصروفي — views/accounts.js
 * «الحسابات»: الأرصدة، الديون والالتزامات، الادخار، وصافي الثروة.
 * كل التعديلات عبر Fin.Store (updateAccount / updateTransaction / transfer).
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

  function kindLabel(kind) {
    if (kind === 'saving') return 'ادخار';
    if (kind === 'cash') return 'نقد';
    return 'حساب';
  }
  // اسم أيقونة صالح دائماً (يتعامل مع الحسابات القديمة التي حُفظت بإيموجي)
  function accountIconName(acc) {
    if (acc && acc.icon && Fin.I && Fin.I.has(acc.icon)) return acc.icon;
    return (acc && acc.kind === 'saving') ? 'bank' : 'cash';
  }

  /* ================================================ نافذة تعديل الحساب */

  function openAccountModal(acc, ctx) {
    var form = UI.form([
      { name: 'name', label: 'اسم الحساب', type: 'text', required: true, span: 2 },
      { name: 'opening', label: 'الرصيد الافتتاحي (د.ل)', type: 'money', required: true, hint: 'الرصيد الحالي = الافتتاحي + الدخل − المصروف' },
      { name: 'kind', label: 'النوع', type: 'select', options: [
        { value: 'cash', label: 'نقد' },
        { value: 'saving', label: 'ادخار' },
        { value: 'bank', label: 'مصرفي' }
      ] }
    ], { values: { name: acc.name, opening: acc.opening, kind: acc.kind || 'cash' } });

    UI.modal({
      title: 'تعديل حساب: ' + acc.name,
      body: U.el('div', {}, [
        U.el('div', { class: 'summary-strip' }, [
          U.el('span', { class: 'muted', text: 'الرصيد الحالي (محسوب):' }),
          U.el('strong', { text: U.fmtMoney(F.balanceOf(ctx.state, acc.id)) })
        ]),
        form.el
      ]),
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'حفظ', tone: 'primary', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        if (!v.name) { UI.toast('أدخل اسم الحساب', 'danger'); return { ok: false }; }
        Store.updateAccount(acc.id, { name: v.name, opening: Number(v.opening) || 0, kind: v.kind });
        UI.toast('تم تحديث الحساب', 'success');
        return { ok: true };
      }
    });
  }

  /* =============================================== نافذة دفع مصروف مخطّط */

  function openPayModal(tx, ctx) {
    var form = UI.form([
      { name: 'date', label: 'تاريخ الدفع', type: 'date', required: true },
      { name: 'accountId', label: 'من حساب', type: 'select', options: (ctx.state.accounts || []).map(function (a) { return { value: a.id, label: a.name }; }) },
      { name: 'note', label: 'ملاحظة', type: 'text', span: 2, placeholder: 'اختياري' }
    ], { values: { date: ctx.asOf || U.todayISO(), accountId: tx.accountId || 'cash', note: tx.note || '' } });

    UI.modal({
      title: 'تسجيل دفع: ' + (tx.label || C.catExpense(tx.category).label),
      body: U.el('div', {}, [
        U.el('div', { class: 'alert alert-warn' }, [
          U.el('div', { class: 'alert-ico' }, [icon('creditCard', { size: 14 })]),
          U.el('div', { class: 'alert-main' }, [
            U.el('div', { class: 'alert-title', text: 'سيُخصم ' + U.fmtMoney(tx.amount) + ' من الرصيد' }),
            U.el('div', { class: 'alert-body' }, [
              U.el('span', { text: 'قبل الدفع: ' + U.fmtMoney(F.totalBalance(ctx.state)) + ' — بعده: ' + U.fmtMoney(U.round(F.totalBalance(ctx.state) - (Number(tx.amount) || 0))) + '. ' }),
              U.el('span', { text: 'هذا مصروف مخطّط لم يُدفع بعد (ليس ديناً)، وسيختفي من القائمة بعد الدفع.' })
            ])
          ])
        ]),
        form.el
      ]),
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'دفعت', tone: 'success', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        Store.updateTransaction(tx.id, {
          paid: true,
          planned: false,
          date: v.date || tx.date,
          accountId: v.accountId || tx.accountId,
          method: 'cash',
          note: v.note || tx.note
        });
        UI.toast('تم تسجيل دفع ' + U.fmtMoney(tx.amount), 'success');
        return { ok: true };
      }
    });
  }

  /* ============================================== نافذة التحويل إلى الادخار */

  function openTransferModal(state, ctx, presetFrom) {
    var accounts = state.accounts || [];
    var fromOptions = accounts.map(function (a) { return { value: a.id, label: a.name + ' — ' + U.fmtMoney(F.balanceOf(state, a.id)) }; });
    var toOptions = accounts.map(function (a) { return { value: a.id, label: a.name }; });
    var from = presetFrom || (accounts[0] ? accounts[0].id : 'cash');
    var to = (accounts.filter(function (a) { return a.id !== from && a.kind === 'saving'; })[0] || accounts.filter(function (a) { return a.id !== from; })[0] || {}).id || 'saving';

    var form = UI.form([
      { name: 'amount', label: 'المبلغ (د.ل)', type: 'money', required: true },
      { name: 'date', label: 'التاريخ', type: 'date', required: true },
      { name: 'fromId', label: 'من حساب', type: 'select', options: fromOptions },
      { name: 'toId', label: 'إلى حساب', type: 'select', options: toOptions },
      { name: 'note', label: 'ملاحظة', type: 'text', span: 2, placeholder: 'مثال: ادخار احتياطي' }
    ], { values: { amount: '', date: ctx.asOf || U.todayISO(), fromId: from, toId: to, note: '' } });

    UI.modal({
      title: 'تحويل إلى الادخار',
      body: U.el('div', {}, [
        U.el('div', { class: 'summary-strip' }, [
          U.el('span', { text: 'نقد: ' + U.fmtMoney(F.cashBalance(state)) }),
          U.el('span', { text: 'ادخار: ' + U.fmtMoney(F.savingsBalance(state)) })
        ]),
        form.el
      ]),
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'حوّل', tone: 'primary', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        var amount = Number(v.amount) || 0;
        if (amount <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return { ok: false }; }
        if (v.fromId === v.toId) { UI.toast('اختر حسابين مختلفين', 'danger'); return { ok: false }; }
        var available = F.balanceOf(state, v.fromId);
        if (amount > available) {
          UI.toast('المبلغ أكبر من رصيد الحساب (' + U.fmtMoney(available) + ')', 'danger');
          return { ok: false };
        }
        var fromName = (accounts.filter(function (a) { return a.id === v.fromId; })[0] || {}).name || v.fromId;
        var toName = (accounts.filter(function (a) { return a.id === v.toId; })[0] || {}).name || v.toId;
        Store.transfer(v.fromId, v.toId, amount, v.date, v.note || ('تحويل من ' + fromName + ' إلى ' + toName));
        UI.toast('تم تحويل ' + U.fmtMoney(amount) + ' إلى ' + toName, 'success');
        return { ok: true };
      }
    });
  }

  /* ================================================ نافذة إضافة حساب جديد */

  function openAddAccountModal(ctx) {
    var form = UI.form([
      { name: 'name', label: 'اسم الحساب', type: 'text', required: true, span: 2 },
      { name: 'opening', label: 'الرصيد الافتتاحي (د.ل)', type: 'money', required: true },
      { name: 'kind', label: 'النوع', type: 'select', options: [
        { value: 'cash', label: 'نقد' },
        { value: 'saving', label: 'ادخار' },
        { value: 'bank', label: 'مصرفي' }
      ] }
    ], { values: { name: '', opening: 0, kind: 'cash' } });

    UI.modal({
      title: 'حساب جديد',
      body: form.el,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'إضافة', tone: 'primary', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        if (!v.name) { UI.toast('أدخل اسم الحساب', 'danger'); return { ok: false }; }
        Store.addAccount({ name: v.name, opening: Number(v.opening) || 0, kind: v.kind, icon: v.kind === 'saving' ? 'bank' : 'cash' });
        UI.toast('تم إضافة الحساب', 'success');
        return { ok: true };
      }
    });
  }

  /* ============================================================== البناء */

  function render(rootEl, ctx) {
    var state = ctx.state || Store.state;
    var asOf = ctx.asOf || U.todayISO();

    var total = F.totalBalance(state);
    var cash = F.cashBalance(state);
    var saving = F.savingsBalance(state);
    var sav = F.savingsStats(state, U.monthKey(asOf), asOf);
    var rec = F.receivables(state, asOf);
    var ob = F.obligations(state);
    var funds = F.accumulatedFunds(state);
    var cm = F.commitments(state);
    var planned = ob.items;
    var plannedTotal = U.round(ob.total);
    var netWealth = U.round(total + rec.total);

    /* ================================================ 1) بطاقات الحسابات */
    var accCards = (state.accounts || []).map(function (acc) {
      var bal = F.balanceOf(state, acc.id);
      return U.el('div', { class: 'card ' + (acc.kind === 'saving' ? 'card-primary' : 'card-income'), onClick: function () { openAccountModal(acc, ctx); }, role: 'button', tabindex: '0' }, [
        U.el('div', { class: 'card-head' }, [
          icon(accountIconName(acc), { size: 20 }),
          U.el('div', { class: 'card-title', text: acc.name }),
          U.el('div', { class: 'card-extra', text: kindLabel(acc.kind) })
        ]),
        U.el('div', { class: 'card-body' }, [
          U.el('div', { class: 'card-value', text: U.fmtMoney(bal) }),
          U.el('div', { class: 'card-sub', text: 'الافتتاحي ' + U.fmtMoney(acc.opening) + ' · الحركة ' + U.fmtMoney(U.round(bal - (Number(acc.opening) || 0)), { sign: true }) }),
          U.el('div', { class: 'card-sub' }, [
            U.el('span', { text: 'نسبته من الإجمالي: ' }),
            U.el('strong', { text: total > 0 ? U.fmtPct(U.pct(Math.max(0, bal), total)) : '0%' })
          ])
        ])
      ]);
    });

    rootEl.appendChild(UI.section('الحسابات', [
      U.el('div', { class: 'stat-grid' }, [
        UI.stat({ icon: 'coins', label: 'إجمالي الأموال', tone: 'primary', value: U.fmtMoney(total), sub: (state.accounts || []).length + ' حساب · نقد + ادخار' }),
        UI.stat({ icon: 'cash', label: 'النقد (الصندوق)', valueClass: 'tx-income', value: U.fmtMoney(cash), sub: total > 0 ? U.fmtPct(U.pct(cash, total)) + ' من الإجمالي' : '' }),
        UI.stat({ icon: 'piggy', label: 'ادخار', tone: 'primary', value: U.fmtMoney(saving), sub: total > 0 ? U.fmtPct(U.pct(saving, total)) + ' من الإجمالي' : '' }),
        UI.stat({ icon: 'percent', label: 'نسبة الادخار هذا الشهر', tone: sav.rate >= 0 ? 'income' : 'expense', valueClass: sav.rate >= 0 ? 'tx-income' : 'tx-expense', value: U.fmtPct(sav.rate), sub: 'صافي ' + U.fmtMoney(sav.net, { sign: true }) + ' من دخل ' + U.fmtMoney(sav.income) })
      ]),
      U.el('div', { class: 'stat-grid' }, accCards),
      UI.btn('حساب جديد', { icon: 'plus', tone: 'ghost', className: 'btn-block', onClick: function () { openAddAccountModal(ctx); } })
    ]));

    /* ============================== 2) الأموال المجمّعة (من أين جاء النقد) */
    var fundRows = funds.sources.map(function (s) {
      var isIn = s.amount >= 0;
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'tx-ico ' + (isIn ? 'in' : 'out') }, [icon(isIn ? 'arrowUp' : 'arrowDown', { size: 20 })]),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: s.label }),
          U.el('div', { class: 'tx-meta' }, [
            U.el('span', { text: s.note || '' }),
            s.fromToday ? U.el('span', { class: 'tx-note', text: ' · اليوم' }) : null
          ])
        ]),
        UI.amountBlock(Math.abs(s.amount), isIn, { currency: false })
      ]);
    });

    rootEl.appendChild(UI.section('الأموال المجمّعة في الصندوق', [
      U.el('div', { class: 'stat-grid' }, [
        UI.stat({ icon: 'cash', label: 'النقد الآن', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(funds.total), sub: 'في الصندوق' }),
        UI.stat({ icon: 'clock', label: 'كان قبل اليوم', value: U.fmtMoney(funds.opening), sub: funds.openingNote }),
        UI.stat({ icon: 'arrowUp', label: 'دخل اليوم', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(funds.todayIncome), sub: 'إيجارات محصَّلة' }),
        UI.stat({ icon: 'arrowDown', label: 'مصروف اليوم', tone: 'expense', valueClass: 'tx-expense', value: U.fmtMoney(funds.todayExpense), sub: 'خضار ومواد وخبز وقهوة' })
      ]),
      UI.card({ title: 'من أين جاء النقد الموجود', icon: 'grid', body: U.el('div', { class: 'list' }, fundRows) }),
      U.el('div', { class: 'alert alert-info' }, [
        U.el('div', { class: 'alert-ico' }, [icon('checkCircle', { size: 14 })]),
        U.el('div', { class: 'alert-main' }, [
          U.el('div', { class: 'alert-title', text: 'لا ديون عليك' }),
          U.el('div', { class: 'alert-body', text: 'كل ما في الصندوق أموال مجمّعة من إيراداتك. المصروفات المخطّطة أدناه لم تُدفع بعد، ولا تُخصم من الرصيد إلا عند الدفع.' })
        ])
      ])
    ]));

    /* ============================== 3) المصروفات المخطّطة (ليست ديوناً) */
    var plannedRows = planned.map(function (tx) {
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'tx-ico out' }, [UI.catIcon({ key: tx.category, type: 'expense' }, 'out')]),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: tx.label || C.catExpense(tx.category).label }),
          U.el('div', { class: 'tx-meta' }, [
            U.el('span', { text: 'متوقّع ' + U.dateLabel(tx.date, 'short') }),
            tx.note ? U.el('span', { text: ' · ' + tx.note }) : null
          ]),
          U.el('div', { class: 'tx-flags' }, [UI.badge('لم يُدفع', 'warn')])
        ]),
        UI.amountBlock(tx.amount, false, { currency: false }),
        U.el('div', { class: 'tx-actions' }, [
          U.el('button', {
            type: 'button', class: 'btn btn-sm btn-success', text: 'دفعت',
            onClick: function () { openPayModal(tx, ctx); }
          })
        ])
      ]);
    });

    rootEl.appendChild(UI.section('مصروفات مخطّطة — ليست ديوناً', [
      U.el('div', { class: 'stat-grid' }, [
        UI.stat({ icon: 'hourglass', label: 'لم تُدفع بعد', tone: 'warn', valueClass: 'tx-warn', value: U.fmtMoney(plannedTotal), sub: planned.length + ' بند — غير محسوبة في الرصيد' }),
        UI.stat({ icon: 'cash', label: 'يكفيها من النقد؟', tone: cash >= plannedTotal ? 'income' : 'expense', value: cash >= plannedTotal ? 'نعم' : 'لا', sub: 'النقد ' + U.fmtMoney(cash) + ' مقابل ' + U.fmtMoney(plannedTotal) }),
        UI.stat({ icon: 'minus', label: 'المتبقي بعد دفعها', valueClass: 'tx-warn', value: U.fmtMoney(U.round(total - plannedTotal)), sub: 'من إجمالي ' + U.fmtMoney(total) })
      ]),
      planned.length ? UI.card({ title: 'المخطّط (' + U.fmtMoney(plannedTotal) + ')', icon: 'hourglass', tone: 'warn', body: U.el('div', { class: 'list' }, plannedRows) }) : emptyBox('checkCircle', 'لا مصروفات معلّقة', 'كل شيء مدفوع.')
    ]));

    /* ============================== 4) الالتزامات السنوية (خطط سنوية) */
    if (cm.count) {
      var commitCards = cm.list.map(function (c) {
        return U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-head' }, [
            icon(c.icon, { size: 20, fallback: 'calendar' }),
            U.el('div', { class: 'card-title', text: c.label }),
            U.el('div', { class: 'card-extra' }, [UI.badge('سنوي', 'info')])
          ]),
          U.el('div', { class: 'card-body' }, [
            UI.kv('التكلفة السنوية', U.fmtMoney(c.annual)),
            UI.kv('المدفوع هذا العام', U.fmtMoney(c.paidThisYear), { valueClass: 'tx-income' }),
            UI.kv('المتبقي', U.fmtMoney(c.remaining), { valueClass: 'tx-warn' }),
            UI.progress(c.pct),
            U.el('div', { class: 'card-sub', text: 'أُنجز ' + U.fmtPct(c.pct) + ' — ' + (c.note || '') })
          ])
        ]);
      });
      rootEl.appendChild(UI.section('التزامات سنوية (خطط)', [
        U.el('div', { class: 'stat-grid' }, [
          UI.stat({ icon: 'calendar', label: 'إجمالي السنوي', value: U.fmtMoney(cm.annualTotal), sub: cm.count + ' التزام' }),
          UI.stat({ icon: 'checkCircle', label: 'المدفوع', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(cm.paidTotal) }),
          UI.stat({ icon: 'hourglass', label: 'المتبقي', tone: 'warn', valueClass: 'tx-warn', value: U.fmtMoney(cm.remainingTotal), sub: 'يُسدَّد على دفعات خلال السنة' })
        ]),
        U.el('div', { class: 'stat-grid' }, commitCards),
        U.el('div', { class: 'muted', text: 'هذه خطط سنوية وليست ديوناً — التطبيق يعرضها للمتابعة فقط.' })
      ]));
    }

    /* =================================================== 3) الادخار */
    var monthsText = sav.monthsCovered > 0 ? U.fmtNumber(sav.monthsCovered, 1) + ' شهر' : '—';
    var savingNote = sav.savingBalance <= 0
      ? 'لا يوجد ادخار بعد.'
      : 'ادخارك الحالي يكفي مصاريفك لمدة ' + monthsText + ' فقط.';

    rootEl.appendChild(UI.section('الادخار', [
      U.el('div', { class: 'stat-grid' }, [
        UI.stat({ icon: 'piggy', label: 'رصيد الادخار', tone: 'primary', value: U.fmtMoney(saving), sub: 'من إجمالي ثروة ' + U.fmtMoney(total) }),
        UI.stat({ icon: 'hourglass', label: 'يكفي مصاريفك', value: monthsText, sub: 'بمتوسط صرف شهري ' + U.fmtMoney(sav.avgMonthlyExpense) }),
        UI.stat({ icon: 'flame', label: 'مصروف الشهر الجاري', tone: 'expense', valueClass: 'tx-expense', value: U.fmtMoney(sav.expense), sub: 'من دخل ' + U.fmtMoney(sav.income) })
      ]),
      U.el('div', { class: 'alert alert-warn' }, [
        U.el('div', { class: 'alert-ico' }, [icon('flame', { size: 14 })]),
        U.el('div', { class: 'alert-main' }, [
          U.el('div', { class: 'alert-title', text: savingNote + ' التضخم في ليبيا يرفع الأسعار بسرعة' }),
          U.el('div', { class: 'alert-body', text: 'المعنى العملي: ' + U.fmtMoney(sav.savingBalance) + ' مدخرة اليوم لا تشتري ما كانت تشتريه قبل سنة. لا تنتظر — حوّل مبلغاً صغيراً كل شهر.' })
        ])
      ]),
      UI.btn('حوّل إلى الادخار', { icon: 'piggy', tone: 'primary', className: 'btn-block', onClick: function () { openTransferModal(state, ctx, null); } }),
      U.el('div', { class: 'summary-strip' }, [
        U.el('span', { class: 'muted', text: 'التحويل ينقل المبلغ من النقد إلى الادخار بلا تغيير في إجمالي ثروتك.' }),
        UI.btn('من النقد', { icon: 'cash', tone: 'ghost', className: 'btn-sm', onClick: function () { openTransferModal(state, ctx, 'cash'); } })
      ])
    ]));

    /* ============================================== 5) صافي الموجود */
    var netCard = UI.card({
      title: 'صافي الموجود',
      icon: 'scale',
      tone: 'income',
      value: U.fmtMoney(netWealth),
      sub: 'ما عندك فعلاً + ما سيصلك من إيجارات',
      body: U.el('div', {}, [
        UI.kv('أموال في اليد (نقد + ادخار)', U.fmtMoney(total), { valueClass: 'tx-income' }),
        UI.kv('+ مستحق لي ولم يُحصَّل', U.fmtMoney(rec.total), { valueClass: 'tx-income' }),
        U.el('hr', { class: 'divider' }),
        UI.kv('= صافي الموجود', U.fmtMoney(netWealth), { valueClass: 'tx-income' }),
        U.el('div', { class: 'card-sub' }, [
          U.el('span', { text: 'لو حصّلت كل الإيجارات المستحقة يصبح لديك ' + U.fmtMoney(U.round(total + rec.total)) + ' (قبل المصروفات المخطّطة).' })
        ])
      ])
    });

    var compCard = UI.card({
      title: 'من أين تتكوّن أموالك',
      icon: 'grid',
      body: U.el('div', {}, [
        UI.kv('نقد في الصندوق', U.fmtMoney(cash) + ' (' + (total > 0 ? U.fmtPct(U.pct(cash, total)) : '0%') + ')'),
        UI.kv('ادخار', U.fmtMoney(saving) + ' (' + (total > 0 ? U.fmtPct(U.pct(saving, total)) : '0%') + ')'),
        UI.kv('مستحق لي', U.fmtMoney(rec.total) + ' (' + rec.count + ' استحقاق)'),
        UI.kv('مصروفات مخطّطة', U.fmtMoney(plannedTotal) + ' (' + planned.length + ' بند)', { valueClass: 'tx-warn' }),
        UI.kv('التزامات سنوية متبقية', U.fmtMoney(cm.remainingTotal), { valueClass: 'tx-warn' }),
        U.el('div', { class: 'card-sub' }, [
          U.el('span', { text: 'لا ديون عليك — المخطّط والسنوي لا يُخصمان من رصيدك حتى تدفعهما.' })
        ])
      ])
    });

    rootEl.appendChild(UI.section('صافي الموجود', [
      U.el('div', { class: 'stat-grid' }, [netCard, compCard])
    ]));
  }

  Fin.Views.accounts = {
    id: 'accounts',
    title: 'الحسابات',
    icon: 'bank',
    order: 4,
    subtitle: 'الأموال المجمّعة والادخار والمخطّط',
    render: render,
    destroy: function () {}
  };
})();
