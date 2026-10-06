/* =============================================================================
 * مصروفي — views/expenses.js
 * «المصروفات»: إضافة سريعة بضغطة + رسم دائري للفئات + قائمة الفترة بتعديل/حذف.
 * كل التعديلات عبر Fin.Store فقط (Store يُشعر App فيُعاد الرسم تلقائياً).
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

  /* ------------------------------------------------- أدوات محلية (بلا DOM عام) */

  // القوائم المنسدلة تعرض النص فقط — الأيقونة لا تظهر داخل <option>
  function catOptions() {
    return C.EXPENSE_CATEGORIES.map(function (c) { return { value: c.key, label: c.label }; });
  }
  function accountOptions(state) {
    return (state.accounts || []).map(function (a) { return { value: a.id, label: a.name }; });
  }
  function methodOptions() {
    return C.PAYMENT_METHODS.map(function (m) { return { value: m.key, label: m.label }; });
  }
  function locationOptions(state) {
    return [{ value: '', label: '— بلا مكان —' }].concat((state.locations || C.LOCATIONS).map(function (l) {
      return { value: l.id, label: l.name };
    }));
  }
  function matchRange(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[0];
  }
  function money(v) { return UI.money(v, { html: true }); }

  /* ------------------------------------------------------------- حالة الوحدة */
  /* تُحفظ بين عمليات الرسم حتى لا يفقد المستخدم اختياره عند أي تحديث */

  var activeKey = 'month';
  var payFilter = 'all';
  var query = '';
  var searchTimer = null;

  /* ============================================================ نافذة الإضافة */

  function openAddModal(ctx, presetCatKey) {
    var state = ctx.state;
    var preset = presetCatKey ? C.catExpense(presetCatKey) : null;
    var values = {
      amount: (preset && preset.quick) ? preset.quick : '',
      category: presetCatKey || 'vegetables',
      date: ctx.asOf || U.todayISO(),
      method: 'cash',
      accountId: (state.accounts && state.accounts[0]) ? state.accounts[0].id : 'cash',
      locationId: '',
      unpaid: false,
      note: ''
    };
    var form = UI.form([
      { name: 'amount', label: 'المبلغ (د.ل)', type: 'money', required: true, placeholder: '0' },
      { name: 'category', label: 'الفئة', type: 'select', options: catOptions(), required: true },
      { name: 'date', label: 'التاريخ', type: 'date', required: true },
      { name: 'method', label: 'طريقة الدفع', type: 'select', options: methodOptions() },
      { name: 'accountId', label: 'الحساب', type: 'select', options: accountOptions(state) },
      { name: 'locationId', label: 'المكان (اختياري)', type: 'select', options: locationOptions(state) },
      { name: 'unpaid', label: 'لم أدفعه بعد (مخطّط)', type: 'checkbox', span: 2, hint: 'لن يُخصم من الرصيد حتى تدفعه، وسيظهر في «مصروفات مخطّطة» — هذا ليس ديناً' },
      { name: 'note', label: 'ملاحظة', type: 'text', placeholder: 'مثال: خضار من السوق', span: 2 }
    ], { values: values });

    // اختيار «على الحساب» في طريقة الدفع يفعّل المفتاح تلقائياً
    var methodInput = form.inputs.method, unpaidInput = form.inputs.unpaid;
    if (methodInput && unpaidInput) {
      methodInput.addEventListener('change', function () {
        if (methodInput.value === 'credit') unpaidInput.checked = true;
      });
    }

    UI.modal({
      title: preset ? 'إضافة سريعة: ' + preset.label : 'مصروف جديد',
      body: form.el,
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'إضافة', tone: 'primary', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return { ok: false }; }
        if (!v.date) { UI.toast('اختر التاريخ', 'danger'); return { ok: false }; }
        var cat = C.catExpense(v.category);
        Store.addTransaction({
          type: 'expense',
          date: v.date,
          amount: v.amount,
          category: v.category,
          label: cat.label,
          accountId: v.accountId || 'cash',
          locationId: v.locationId || null,
          method: v.unpaid ? 'credit' : (v.method || 'cash'),
          paid: !v.unpaid,
          planned: !!v.unpaid,
          note: v.note || ''
        });
        UI.toast('تم إضافة ' + U.fmtMoney(v.amount) + ' — ' + cat.label, 'success');
        return { ok: true };
      }
    });
  }

  /* ============================================================ نافذة التعديل */

  function openEditModal(tx, ctx) {
    var state = ctx.state;
    var form = UI.form([
      { name: 'amount', label: 'المبلغ (د.ل)', type: 'money', required: true },
      { name: 'category', label: 'الفئة', type: 'select', options: catOptions(), required: true },
      { name: 'date', label: 'التاريخ', type: 'date', required: true },
      { name: 'method', label: 'طريقة الدفع', type: 'select', options: methodOptions() },
      { name: 'accountId', label: 'الحساب', type: 'select', options: accountOptions(state) },
      { name: 'locationId', label: 'المكان (اختياري)', type: 'select', options: locationOptions(state) },
      { name: 'unpaid', label: 'على الحساب (لم أسدّد)', type: 'checkbox', span: 2, hint: 'إلغاء التحديد يعني أنه مدفوع وسيُخصم من الرصيد' },
      { name: 'note', label: 'ملاحظة', type: 'text', span: 2 }
    ], {
      values: {
        amount: tx.amount,
        category: tx.category,
        date: tx.date,
        method: tx.method || 'cash',
        accountId: tx.accountId || 'cash',
        locationId: tx.locationId || '',
        unpaid: tx.paid === false,
        note: tx.note || ''
      }
    });

    UI.modal({
      title: 'تعديل مصروف',
      body: form.el,
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'حفظ', tone: 'primary', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return { ok: false }; }
        Store.updateTransaction(tx.id, {
          amount: v.amount,
          category: v.category,
          date: v.date,
          method: v.unpaid ? 'credit' : (v.method || 'cash'),
          accountId: v.accountId || tx.accountId,
          locationId: v.locationId || null,
          paid: !v.unpaid,
          planned: !!v.unpaid,
          note: v.note || ''
        });
        UI.toast('تم تعديل المصروف', 'success');
        return { ok: true };
      }
    });
  }

  function deleteTx(tx) {
    UI.confirm('حذف «' + (tx.label || C.catExpense(tx.category).label) + '» بمبلغ ' + U.fmtMoney(tx.amount) + '؟', { title: 'تأكيد الحذف', okLabel: 'حذف' })
      .then(function (ok) {
        if (!ok) return;
        Store.removeTransaction(tx.id);
        UI.toast('تم الحذف', 'success');
      });
  }

  /* ============================================================== البناء */

  function render(rootEl, ctx) {
    var state = ctx.state || Store.state;

    rootEl.appendChild(U.el('div', { class: 'section' }, [
      UI.rangeTabs(UI.standardRanges(ctx.asOf), activeKey, function (r) {
        activeKey = r.key;
        render(rootEl, ctx);
      })
    ]));

    var ranges = UI.standardRanges(ctx.asOf);
    var range = matchRange(ranges, activeKey);
    var sum = F.rangeSummary(state, range.from, range.to);
    var days = Math.max(1, U.rangeDays(range.from, range.to).length);
    var avg = sum.expense / days;

    /* ---------------------------------------------------------- الأرقام */
    rootEl.appendChild(UI.statGrid([
      UI.stat({ icon: 'trendDown', label: 'مصروف الفترة', tone: 'expense', valueClass: 'tx-expense', value: U.fmtMoney(sum.expense), sub: range.label }),
      UI.stat({ icon: 'receipt', label: 'عدد المعاملات', value: U.fmtNumber(sum.txCount), sub: sum.unpaidCount ? (sum.unpaidCount + ' لم تُسدَّد بـ ' + U.fmtMoney(sum.unpaid)) : 'كلها مدفوعة' }),
      UI.stat({ icon: 'calendar', label: 'متوسط اليوم', value: U.fmtMoney(U.round1(avg)), sub: days + ' يوم في الفترة', tone: 'warn', valueClass: 'tx-warn' }),
      UI.stat({ icon: 'trendUp', label: 'الصافي (دخل − مصروف)', tone: sum.net >= 0 ? 'income' : 'expense', valueClass: sum.net >= 0 ? 'tx-income' : 'tx-expense', value: U.fmtMoney(sum.net, { sign: true }), sub: 'دخل ' + U.fmtMoney(sum.income) })
    ]));

    /* --------------------------------------------------------- إضافة سريعة */
    var quickGrid = U.el('div', { class: 'quick-grid' }, C.QUICK_ADD.map(function (key) {
      var cat = C.catExpense(key);
      return U.el('button', {
        type: 'button',
        class: 'quick-btn',
        title: 'إضافة ' + cat.label + (cat.quick ? ' — ' + U.fmtMoney(cat.quick) : ''),
        onClick: function () { openAddModal(ctx, key); }
      }, [
        U.el('span', { class: 'quick-ico' }, [icon(cat.icon, { size: 22, tone: 'out', fallback: 'package' })]),
        U.el('span', { class: 'quick-label', text: cat.label }),
        U.el('span', { class: 'quick-hint', text: cat.quick ? U.fmtMoney(cat.quick, { currency: false }) : 'بالمبلغ' })
      ]);
    }));

    rootEl.appendChild(UI.section('إضافة سريعة بضغطة', [
      quickGrid,
      U.el('div', { class: 'summary-strip' }, [
        U.el('span', { class: 'muted', text: 'اضغط الفئة → مبلغ مقترح → «إضافة».' }),
        UI.btn('مصروف بالتفصيل', { icon: 'plus', tone: 'primary', className: 'btn-sm', onClick: function () { openAddModal(ctx, null); } })
      ])
    ]));

    /* ------------------------------------------------------------- الدائري */
    var cats = F.expenseByCategory(state, range.from, range.to);
    if (cats.length) {
      var items = cats.map(function (c) { return { label: c.label, amount: c.amount, color: c.color || 'var(--c-primary)' }; });
      var totalDonut = U.sum(cats, function (c) { return c.amount; });
      var donutBox = U.el('div', { class: 'chart-row' }, [
        U.el('div', { html: UI.donut(items, { size: 168, centerValue: U.fmtCompact ? U.fmtCompact(totalDonut) : String(totalDonut), centerLabel: 'إجمالي الفترة' }) }),
        UI.legend(items.slice(0, 8).map(function (it, i) {
          return {
            label: it.label + ' (' + U.fmtPct(cats[i].pct) + ')',
            color: it.color,
            amount: it.amount
          };
        }))
      ]);

      var topRows = cats.slice(0, 6).map(function (c) {
        return U.el('div', { class: 'list-item' }, [
          UI.catIcon({ key: c.key, type: 'expense' }, 'out'),
          U.el('div', { class: 'tx-main' }, [
            U.el('div', { class: 'tx-title', text: c.label }),
            U.el('div', { class: 'tx-meta' }, [U.el('span', { text: c.count + ' معاملة · ' + U.fmtPct(c.pct) + ' من المصروف' })])
          ]),
          UI.amountBlock(c.amount, false, { currency: false })
        ]);
      });

      rootEl.appendChild(UI.section('توزيع الفئات', [
        UI.card({ body: donutBox }),
        UI.card({ title: 'أكبر البنود', icon: 'chart', body: UI.list(topRows, { empty: null }) })
      ]));
    }

    /* ------------------------------------------------------ الفلترة والقائمة */
    var searchInput = U.el('input', {
      class: 'input',
      type: 'search',
      placeholder: 'ابحث في الملاحظات والفئات…',
      value: query,
      autocomplete: 'off'
    });
    searchInput.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        query = searchInput.value;
        render(rootEl, ctx);
        var again = rootEl.querySelector('input[type="search"]');
        if (again) { again.focus(); try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) { /* تجاهل */ } }
      }, 320);
    });

    var filterTabs = U.el('div', { class: 'tabs' }, [
      ['all', 'الكل'], ['paid', 'مدفوع'], ['unpaid', 'لم يُدفع']
    ].map(function (pair) {
      return U.el('button', {
        type: 'button',
        class: 'tab' + (payFilter === pair[0] ? ' is-active' : ''),
        text: pair[1],
        onClick: function () { payFilter = pair[0]; render(rootEl, ctx); }
      });
    }));

    rootEl.appendChild(UI.section('معاملات الفترة', [
      U.el('div', { class: 'range-row' }, [searchInput]),
      filterTabs,
      buildTxList(state, range, ctx)
    ]));

    /* ------------------------------------------------------- زر كامل العرض */
    rootEl.appendChild(UI.btn('إضافة مصروف', { icon: 'plus', tone: 'primary', className: 'btn-block', onClick: function () { openAddModal(ctx, null); } }));
  }

  function buildTxList(state, range, ctx) {
    var opts = { type: 'expense', includePlanned: false };
    if (query) opts.query = query;
    if (payFilter === 'paid') opts.paidOnly = true;
    if (payFilter === 'unpaid') opts.unpaidOnly = true;

    var txs = F.txInRange(state, range.from, range.to, opts);

    if (!txs.length) {
      return emptyBox('search', 'لا توجد مصروفات مطابقة', query ? ('لا نتائج لـ «' + query + '»') : 'جرّب توسيع الفترة أو أضف مصروفاً بضغطة.');
    }

    /* تجميع حسب اليوم (الأحدث أولاً) */
    var byDay = U.groupBy(txs, function (tx) { return tx.date; });
    var dayKeys = Object.keys(byDay).sort(function (a, b) { return a < b ? 1 : -1; });
    var listNode = U.el('div', { class: 'list' });

    dayKeys.forEach(function (day, idx) {
      var dayTxs = byDay[day];
      var paidSum = U.sum(dayTxs.filter(function (t) { return t.paid !== false; }), function (t) { return t.amount; });
      var unpaidSum = U.sum(dayTxs.filter(function (t) { return t.paid === false; }), function (t) { return t.amount; });

      var head = U.el('span', {}, [
        U.el('span', { text: U.dateLabel(day, 'weekday') + ' · ' + dayTxs.length + ' معاملة' }),
        U.el('span', { class: 'muted', text: '   ' + U.fmtMoney(paidSum) + (unpaidSum > 0 ? ' (+' + U.fmtMoney(unpaidSum, { currency: false }) + ' غير مسدَّد)' : '') })
      ]);

      var group = U.el('details', { class: 'day-group', open: idx < 3 });
      group.appendChild(U.el('summary', {}, [head]));
      dayTxs.forEach(function (tx) {
        group.appendChild(UI.txRow(tx, {
          onEdit: function (t) { openEditModal(t, ctx); },
          onDelete: function (t) { deleteTx(t); }
        }));
      });
      listNode.appendChild(group);
    });

    return listNode;
  }

  Fin.Views.expenses = {
    id: 'expenses',
    title: 'المصروفات',
    icon: 'receipt',
    order: 2,
    subtitle: 'إضافة بضغطة وتوزيع الفئات',
    render: render,
    destroy: function () { if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; } }
  };
})();
