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

  /* ------------------------------------------------------ أدوات محلية */

  function kindLabel(kind) {
    if (kind === 'saving') return 'ادخار';
    if (kind === 'cash') return 'نقد';
    return 'حساب';
  }
  function accountIcon(acc) {
    if (acc.icon) return acc.icon;
    return acc.kind === 'saving' ? '🏦' : '💵';
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

  /* =============================================== نافذة سداد التزام/دين */

  function openPayModal(tx, ctx) {
    var isDebt = !!tx.debt;
    var form = UI.form([
      { name: 'date', label: 'تاريخ السداد', type: 'date', required: true },
      { name: 'accountId', label: 'من حساب', type: 'select', options: (ctx.state.accounts || []).map(function (a) { return { value: a.id, label: a.name }; }) },
      { name: 'note', label: 'ملاحظة', type: 'text', span: 2, placeholder: 'اختياري' }
    ], { values: { date: ctx.asOf || U.todayISO(), accountId: tx.accountId || 'cash', note: tx.note || '' } });

    UI.modal({
      title: 'تسجيل سداد: ' + (tx.label || C.catExpense(tx.category).label),
      body: U.el('div', {}, [
        U.el('div', { class: 'alert alert-warn' }, [
          U.el('div', { class: 'alert-ico', text: '💳' }),
          U.el('div', { class: 'alert-main' }, [
            U.el('div', { class: 'alert-title', text: 'سيُخصم ' + U.fmtMoney(tx.amount) + ' من الرصيد' }),
            U.el('div', { class: 'alert-body' }, [
              U.el('span', { text: 'قبل السداد: ' + U.fmtMoney(F.totalBalance(ctx.state)) + ' — بعده: ' + U.fmtMoney(U.round(F.totalBalance(ctx.state) - (Number(tx.amount) || 0))) + '. ' }),
              U.el('span', { text: isDebt ? 'هذا دين عليك، وسيختفي من قائمة الديون بعد السداد.' : 'هذا التزام قادم (لم يكن محسوباً في الرصيد).' })
            ])
          ])
        ]),
        form.el
      ]),
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'سدّدت', tone: 'success', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        Store.updateTransaction(tx.id, {
          paid: true,
          planned: false,
          debt: false,
          date: v.date || tx.date,
          accountId: v.accountId || tx.accountId,
          method: 'cash',
          note: v.note || tx.note
        });
        UI.toast('تم تسجيل سداد ' + U.fmtMoney(tx.amount), 'success');
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
        Store.addAccount({ name: v.name, opening: Number(v.opening) || 0, kind: v.kind, icon: v.kind === 'saving' ? '🏦' : '💵' });
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
    var debts = ob.items.filter(function (t) { return t.debt; });
    var planned = ob.items.filter(function (t) { return !t.debt; });
    /* ملاحظة: F.obligations.plannedTotal يجمع بنود debt فقط (لأن البذرة تضبط planned:true عليها)،
       فالصحيح للالتزامات القادمة = الإجمالي − الديون. */
    var plannedTotal = U.round(ob.total - ob.debtTotal);
    var netWealth = U.round(total - ob.debtTotal + rec.total);

    /* ================================================ 1) بطاقات الحسابات */
    var accCards = (state.accounts || []).map(function (acc) {
      var bal = F.balanceOf(state, acc.id);
      return U.el('div', { class: 'card ' + (acc.kind === 'saving' ? 'card-primary' : 'card-income'), onClick: function () { openAccountModal(acc, ctx); }, role: 'button', tabindex: '0' }, [
        U.el('div', { class: 'card-head' }, [
          U.el('span', { class: 'ico', text: accountIcon(acc) }),
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
        UI.stat({ icon: '🧮', label: 'إجمالي الثروة', tone: 'primary', value: U.fmtMoney(total), sub: (state.accounts || []).length + ' حساب · نقد + ادخار' }),
        UI.stat({ icon: '💵', label: 'نقد (الشنطة)', value: U.fmtMoney(cash), sub: total > 0 ? U.fmtPct(U.pct(cash, total)) + ' من الإجمالي' : '' }),
        UI.stat({ icon: '🏦', label: 'ادخار', tone: 'warn', value: U.fmtMoney(saving), sub: total > 0 ? U.fmtPct(U.pct(saving, total)) + ' من الإجمالي' : '' }),
        UI.stat({ icon: '📊', label: 'نسبة الادخار هذا الشهر', tone: sav.rate >= 0 ? 'income' : 'expense', value: U.fmtPct(sav.rate), sub: 'صافي ' + U.fmtMoney(sav.net, { sign: true }) + ' من دخل ' + U.fmtMoney(sav.income) })
      ]),
      U.el('div', { class: 'stat-grid' }, accCards),
      UI.btn('＋ حساب جديد', { tone: 'ghost', className: 'btn-block', onClick: function () { openAddAccountModal(ctx); } })
    ]));

    /* ================================== 2) الديون والالتزامات */
    var debtRows = debts.map(function (tx) {
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'ico', text: (C.catExpense(tx.category) || {}).icon || '🧾' }),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: tx.label || C.catExpense(tx.category).label }),
          U.el('div', { class: 'tx-meta' }, [
            U.el('span', { text: U.dateLabel(tx.date, 'short') }),
            tx.note ? U.el('span', { text: ' · ' + tx.note }) : null
          ]),
          U.el('div', { class: 'tx-flags' }, [
            UI.badge('دين عليّ', 'danger'),
            tx.method === 'credit' ? UI.badge('على الحساب', 'muted') : null
          ])
        ]),
        U.el('div', { class: 'tx-amount tx-expense', text: U.fmtMoney(tx.amount) }),
        U.el('div', { class: 'tx-actions' }, [
          U.el('button', {
            type: 'button', class: 'btn btn-sm btn-success', text: 'سدّدت',
            onClick: function () { openPayModal(tx, ctx); }
          })
        ])
      ]);
    });

    var plannedRows = planned.map(function (tx) {
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'ico', text: (C.catExpense(tx.category) || {}).icon || '📌' }),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: tx.label || C.catExpense(tx.category).label }),
          U.el('div', { class: 'tx-meta' }, [
            U.el('span', { text: 'متوقّع ' + U.dateLabel(tx.date, 'short') }),
            tx.note ? U.el('span', { text: ' · ' + tx.note }) : null
          ]),
          U.el('div', { class: 'tx-flags' }, [UI.badge('التزام قادم', 'warn')])
        ]),
        U.el('div', { class: 'tx-amount', text: U.fmtMoney(tx.amount) }),
        U.el('div', { class: 'tx-actions' }, [
          U.el('button', {
            type: 'button', class: 'btn btn-sm btn-ghost', text: 'سدّدت',
            onClick: function () { openPayModal(tx, ctx); }
          })
        ])
      ]);
    });

    rootEl.appendChild(UI.section('الديون والالتزامات', [
      U.el('div', { class: 'stat-grid' }, [
        UI.stat({ icon: '🧾', label: 'ديون عليّ', tone: 'expense', value: U.fmtMoney(ob.debtTotal), sub: debts.length + ' بند — تُخصم من الرصيد عند السداد' }),
        UI.stat({ icon: '📌', label: 'التزامات قادمة', tone: 'warn', value: U.fmtMoney(plannedTotal), sub: planned.length + ' بند — غير محسوبة في الرصيد' }),
        UI.stat({ icon: 'Σ', label: 'إجمالي المطلوب', tone: 'primary', value: U.fmtMoney(ob.total), sub: 'المتبقي بعد كل السداد: ' + U.fmtMoney(U.round(total - ob.total)) })
      ]),
      debts.length ? UI.card({ title: 'ديون عليّ (' + U.fmtMoney(ob.debtTotal) + ')', icon: '⚠️', tone: 'expense', body: U.el('div', { class: 'list' }, debtRows) }) : null,
      planned.length ? UI.card({ title: 'التزامات قادمة (' + U.fmtMoney(plannedTotal) + ')', icon: '📌', tone: 'warn', body: U.el('div', { class: 'list' }, plannedRows) }) : null,
      !ob.items.length ? UI.emptyState('✅', 'لا ديون ولا التزامات', 'كل شيء مسدَّد.') : null,
      U.el('div', { class: 'alert alert-info' }, [
        U.el('div', { class: 'alert-ico', text: 'ℹ️' }),
        U.el('div', { class: 'alert-main' }, [
          U.el('div', { class: 'alert-title', text: 'الديون تُخصم من الرصيد عند السداد فقط' }),
          U.el('div', { class: 'alert-body', text: 'زر «سدّدت» يحوّل البند إلى مصروف مدفوع فيُخصم فوراً من الحساب. الالتزامات القادمة (كتب، زي، بنزين) لا تُخصم حتى تسدّدها.' })
        ])
      ])
    ]));

    /* =================================================== 3) الادخار */
    var monthsText = sav.monthsCovered > 0 ? U.fmtNumber(sav.monthsCovered, 1) + ' شهر' : '—';
    var savingNote = sav.savingBalance <= 0
      ? 'لا يوجد ادخار بعد.'
      : 'ادخارك الحالي يكفي مصاريفك لمدة ' + monthsText + ' فقط.';

    rootEl.appendChild(UI.section('الادخار', [
      U.el('div', { class: 'stat-grid' }, [
        UI.stat({ icon: '🏦', label: 'رصيد الادخار', tone: 'warn', value: U.fmtMoney(saving), sub: 'من إجمالي ثروة ' + U.fmtMoney(total) }),
        UI.stat({ icon: '📉', label: 'يكفي مصاريفك', value: monthsText, sub: 'بمتوسط صرف شهري ' + U.fmtMoney(sav.avgMonthlyExpense) }),
        UI.stat({ icon: '⚡', label: 'مصروف الشهر الجاري', tone: 'expense', value: U.fmtMoney(sav.expense), sub: 'من دخل ' + U.fmtMoney(sav.income) })
      ]),
      U.el('div', { class: 'alert alert-warn' }, [
        U.el('div', { class: 'alert-ico', text: '🔥' }),
        U.el('div', { class: 'alert-main' }, [
          U.el('div', { class: 'alert-title', text: savingNote + ' التضخم في ليبيا يرفع الأسعار بسرعة' }),
          U.el('div', { class: 'alert-body', text: 'المعنى العملي: ' + U.fmtMoney(sav.savingBalance) + ' مدخرة اليوم لا تشتري ما كانت تشتريه قبل سنة. لا تنتظر — حوّل مبلغاً صغيراً كل شهر.' })
        ])
      ]),
      UI.btn('🏦 حوّل إلى الادخار', { tone: 'primary', className: 'btn-block', onClick: function () { openTransferModal(state, ctx, null); } }),
      U.el('div', { class: 'summary-strip' }, [
        U.el('span', { class: 'muted', text: 'التحويل ينقل المبلغ من النقد إلى الادخار بلا تغيير في إجمالي ثروتك.' }),
        UI.btn('من النقد', { tone: 'ghost', className: 'btn-sm', onClick: function () { openTransferModal(state, ctx, 'cash'); } })
      ])
    ]));

    /* ============================================== 4) صافي الثروة */
    var netCard = UI.card({
      title: 'صافي الثروة',
      icon: '⚖️',
      tone: netWealth >= 0 ? 'income' : 'expense',
      value: U.fmtMoney(netWealth),
      sub: 'إجمالي الحسابات − ديون عليّ + مستحق لي',
      body: U.el('div', {}, [
        UI.kv('إجمالي الحسابات (نقد + ادخار)', U.fmtMoney(total)),
        UI.kv('− ديون عليّ', U.fmtMoney(ob.debtTotal), { valueClass: 'tx-expense' }),
        UI.kv('+ مستحق لي ولم يُحصَّل', U.fmtMoney(rec.total), { valueClass: 'tx-income' }),
        U.el('hr', { class: 'divider' }),
        UI.kv('= صافي الثروة', U.fmtMoney(netWealth), { valueClass: netWealth >= 0 ? 'tx-income' : 'tx-expense' }),
        U.el('div', { class: 'card-sub' }, [
          U.el('span', { text: 'لو حصّلت كل المستحق وسدّدت كل الديون يصبح النقد ' + U.fmtMoney(U.round(total + rec.total - ob.debtTotal)) + '.' })
        ])
      ])
    });

    var compCard = UI.card({
      title: 'من أين تتكوّن ثروتك',
      icon: '🧭',
      body: U.el('div', {}, [
        UI.kv('نقد', U.fmtMoney(cash) + ' (' + (total > 0 ? U.fmtPct(U.pct(cash, total)) : '0%') + ')'),
        UI.kv('ادخار', U.fmtMoney(saving) + ' (' + (total > 0 ? U.fmtPct(U.pct(saving, total)) : '0%') + ')'),
        UI.kv('مستحق لي', U.fmtMoney(rec.total) + ' (' + rec.count + ' استحقاق)'),
        UI.kv('ديون عليّ', U.fmtMoney(ob.debtTotal) + ' (' + debts.length + ' بند)', { valueClass: 'tx-expense' }),
        U.el('div', { class: 'card-sub' }, [
          U.el('span', { text: 'التزامات قادمة (غير محسوبة): ' + U.fmtMoney(plannedTotal) + ' على ' + planned.length + ' بند.' })
        ])
      ])
    });

    rootEl.appendChild(UI.section('صافي الثروة', [
      U.el('div', { class: 'stat-grid' }, [netCard, compCard])
    ]));
  }

  Fin.Views.accounts = {
    id: 'accounts',
    title: 'الحسابات',
    icon: '🏦',
    order: 4,
    subtitle: 'الرصيد والديون والادخار',
    render: render,
    destroy: function () {}
  };
})();
