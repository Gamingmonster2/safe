/* =============================================================================
 * مصروفي — views/dashboard.js
 * لوحة اليوم: أرقام اليوم، إضافة سريعة بضغطة، المستحق غير المحصَّل، والتنبيهات.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U, UI = Fin.UI, Store = Fin.Store, F = Fin.Finance;
  Fin.Views = Fin.Views || {};

  /* حالة الشاشة: اليوم المعروض + إظهار الأيام السابقة.
     القاعدة: يوم واحد فقط يُعرض (الافتراضي اليوم)، والأيام السابقة تُطلب بضغطة. */
  var dashDay = null;
  var dashHistory = false;
  try { dashDay = sessionStorage.getItem('masrofi.dashDay') || null; } catch (e) { dashDay = null; }

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

  function go(id) { if (Fin.App && Fin.App.go) Fin.App.go(id); }

  // إغلاق يدوي للنافذة بعد نجاح العملية (نستخدمه داخل أزرار close:false)
  function closeModal() {
    var overlay = document.querySelector('.modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () { UI.detach(overlay); }, 180);
  }

  function moneyText(n, tone) {
    return U.fmtMoney(n, { sign: tone === 'net' });
  }

  /* --------------------------------------------------- إضافة سريعة بضغطة */

  function quickAdd(categoryKey, dayISO) {
    var cat = C.catExpense(categoryKey);
    var suggested = cat.quick || '';
    var defaultDay = dayISO || U.todayISO();
    var form = null;

    UI.modal({
      title: cat.label,
      body: null,
      onMount: function (card) {
        form = UI.form([
          { name: 'amount', label: 'المبلغ', type: 'money', required: true, hint: suggested ? 'المقترح: ' + U.fmtMoney(suggested) + ' — عدّله إن اختلف' : '' },
          { name: 'date', label: 'التاريخ', type: 'date', value: defaultDay, required: true },
          { name: 'note', label: 'ملاحظة', type: 'text', placeholder: 'اختياري (مثال: من مخبز الحاج)' },
          { name: 'unpaid', label: 'لم أدفعه بعد (مخطّط)', type: 'checkbox' }
        ], { values: { amount: suggested, date: defaultDay } });
        card.querySelector('.modal-body').appendChild(form.el);
      },
      actions: [
        { label: 'إلغاء', tone: 'ghost', value: null },
        {
          label: 'إضافة',
          tone: 'primary',
          close: false,
          onClick: function () {
            var v = form.getValues();
            if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return false; }
            Store.addTransaction({
              type: 'expense',
              amount: v.amount,
              category: cat.key,
              date: v.date || U.todayISO(),
              label: cat.label,
              note: v.note || '',
              method: v.unpaid ? 'credit' : 'cash',
              paid: !v.unpaid,
              planned: !!v.unpaid
            });
            UI.toast('أُضيف ' + cat.label + ' ' + U.fmtMoney(v.amount) + (v.unpaid ? ' (لم يُدفع بعد)' : ''), 'success');
            closeModal();
          }
        }
      ]
    });
  }

  /* -------------------------------------------------------------- البطاقات */

  function dayHero(d) {
    var balance = F.totalBalance(Store.state);
    var net = d.net;
    return U.el('div', { class: 'card card-hero' + (net >= 0 ? ' card-income' : ' card-expense') }, [
      U.el('div', { class: 'card-head' }, [
        icon('calendar', { size: 20 }),
        U.el('div', { class: 'card-title', text: 'يوم ' + U.dateLabel(d.date) }),
        U.el('div', { class: 'card-extra' }, [
          U.el('span', { class: 'badge badge-' + (net >= 0 ? 'income' : 'danger'), text: 'صافي اليوم ' + U.fmtMoney(net, { sign: true }) })
        ])
      ]),
      U.el('div', { class: 'summary-strip' }, [
        U.el('div', { class: 'summary-cell' }, [
          U.el('div', { class: 'summary-label', text: 'دخل اليوم' }),
          U.el('div', { class: 'summary-value tx-income', text: U.fmtMoney(d.income) })
        ]),
        U.el('div', { class: 'summary-cell' }, [
          U.el('div', { class: 'summary-label', text: 'مصروف اليوم' }),
          U.el('div', { class: 'summary-value tx-expense', text: U.fmtMoney(d.expense) })
        ]),
        U.el('div', { class: 'summary-cell' }, [
          U.el('div', { class: 'summary-label', text: 'رصيد الشنطة' }),
          U.el('div', { class: 'summary-value', text: U.fmtMoney(F.cashBalance(Store.state)) })
        ])
      ]),
      U.el('div', { class: 'card-sub', text: 'إجمالي ما عندك: ' + U.fmtMoney(balance) + ' · ادخار ' + U.fmtMoney(F.savingsBalance(Store.state)) })
    ]);
  }

  function quickGrid(dayISO) {
    var grid = U.el('div', { class: 'quick-grid' });
    C.QUICK_ADD.forEach(function (key) {
      var cat = C.catExpense(key);
      grid.appendChild(U.el('button', {
        type: 'button',
        class: 'quick-btn',
        title: 'إضافة ' + cat.label + (cat.quick ? ' — المقترح ' + U.fmtMoney(cat.quick) : ''),
        onClick: function () { quickAdd(key, dayISO); }
      }, [
        U.el('span', { class: 'quick-ico' }, [icon(cat.icon, { size: 22, tone: 'out', fallback: 'package' })]),
        U.el('span', { class: 'quick-label', text: cat.label }),
        cat.quick ? U.el('span', { class: 'quick-hint', text: U.fmtMoneyPlain(cat.quick) }) : null
      ]));
    });
    return grid;
  }

  function receivingSection(rec) {
    var body = [];
    if (!rec.items.length) {
      body.push(emptyBox('checkCircle', 'كل الاستحقاقات محصَّلة', 'لا يوجد إيجار متأخر أو غير محصَّل'));
    } else {
      body.push(U.el('div', { class: 'summary-strip' }, [
        U.el('div', { class: 'summary-cell' }, [
          U.el('div', { class: 'summary-label', text: 'مستحق لي' }),
          U.el('div', { class: 'summary-value tx-warn', text: U.fmtMoney(rec.total) })
        ]),
        U.el('div', { class: 'summary-cell' }, [
          U.el('div', { class: 'summary-label', text: 'عدد الاستحقاقات' }),
          U.el('div', { class: 'summary-value', text: String(rec.count) })
        ]),
        U.el('div', { class: 'summary-cell' }, [
          U.el('div', { class: 'summary-label', text: 'متأخر' }),
          U.el('div', { class: 'summary-value tx-expense', text: U.fmtMoney(rec.overdueTotal) })
        ])
      ]));
      rec.items.forEach(function (item) {
        body.push(UI.chargeRow(item, {
          onCollect: function (it) { collect(it); }
        }));
      });
    }
    return UI.section('مستحق لي ولم يُحصَّل', body, {
      extra: UI.btn('كل الإيرادات', { tone: 'ghost', size: 'sm', onClick: function () { go('income'); } })
    });
  }

  function collect(item) {
    var form = null;
    UI.modal({
      title: 'تحصيل: ' + item.label,
      body: null,
      onMount: function (card) {
        form = UI.form([
          { name: 'amount', label: 'المبلغ المحصَّل', type: 'money', required: true, hint: 'المتبقي: ' + U.fmtMoney(item.remaining) + ' — ' + item.periodLabel },
          { name: 'date', label: 'تاريخ التحصيل', type: 'date', value: U.todayISO(), required: true },
          { name: 'method', label: 'الطريقة', type: 'select', value: 'cash', options: C.PAYMENT_METHODS.map(function (m) { return { value: m.key, label: m.label }; }) },
          { name: 'note', label: 'ملاحظة / رقم السند', type: 'text', placeholder: item.receiptNo || 'اختياري' }
        ], { values: { amount: item.remaining, date: U.todayISO() } });
        card.querySelector('.modal-body').appendChild(form.el);
      },
      actions: [
        { label: 'إلغاء', tone: 'ghost', value: null },
        {
          label: 'تسجيل التحصيل',
          tone: 'primary',
          close: false,
          onClick: function () {
            var v = form.getValues();
            if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return false; }
            var res = Store.recordReceipt(item.chargeId, v.amount, {
              date: v.date, method: v.method, note: v.note, ref: v.note
            });
            if (!res.ok) { UI.toast(res.error || 'تعذّر التسجيل', 'danger'); return false; }
            UI.toast('تم تحصيل ' + U.fmtMoney(v.amount) + ' من ' + item.label, 'success');
            closeModal();
            return true;
          }
        }
      ]
    });
  }

  /* تنبيهات finance.js — تُعرض بأيقونات SVG لا بإيموجي */
  var ALERT_ICON = { danger: 'flame', warn: 'alert', info: 'info', success: 'checkCircle' };

  function alertNode(a) {
    var level = a.level || 'info';
    var name = (Fin.I && Fin.I.has(a.icon)) ? a.icon : (ALERT_ICON[level] || 'info');
    return U.el('div', { class: 'alert alert-' + level }, [
      U.el('div', { class: 'alert-ico' }, [icon(name, { size: 14 })]),
      U.el('div', { class: 'alert-main' }, [
        U.el('div', { class: 'alert-title', text: a.title || '' }),
        a.body ? U.el('div', { class: 'alert-body', text: a.body }) : null
      ]),
      a.onClick ? UI.iconBtn('chevronLeft', 'فتح', a.onClick) : null
    ]);
  }

  function alertsSection(alerts) {
    if (!alerts.length) return null;
    return UI.section('تنبيهات', alerts.slice(0, 5).map(function (a) {
      if (a.go) a.onClick = function () { go(a.go); };
      return alertNode(a);
    }));
  }

  /* ------------------------------------------------------- النطاقات القريبة */

  function domainsSection(state, asOf) {
    var stats = F.domainStats(state, asOf);
    if (!stats.total) return null;
    var urgent = stats.byStatus.expired.concat(stats.byStatus.critical, stats.byStatus.soon);
    var nearest = urgent.length ? urgent : stats.list.slice(0, 3);
    var isUrgent = urgent.length > 0;

    return UI.section('النطاقات — الأقرب للانتهاء', [
      U.el('div', { class: 'card' + (isUrgent ? ' card-expense' : '') }, [
        U.el('div', { class: 'card-head' }, [
          icon(isUrgent ? 'flame' : 'globe', { size: 20 }),
          U.el('div', { class: 'card-title', text: isUrgent
            ? (urgent.length + ' نطاق يحتاج تجديداً — أقربها ' + stats.next.domain)
            : ('كل النطاقات بعيدة — أقربها ' + stats.next.domain) }),
          U.el('div', { class: 'card-extra' }, [
            U.el('span', { class: 'badge badge-' + (isUrgent ? 'danger' : 'muted'), text: U.fmtMoney(stats.renewNowCost) + ' للتجديد' })
          ])
        ]),
        U.el('div', { class: 'card-body' }, [
          UI.list(nearest.slice(0, 4), { render: function (d) { return domainMini(d); } }),
          UI.kv('إجمالي النطاقات', stats.total + ' نطاقاً'),
          UI.kv('التكلفة السنوية', U.fmtMoney(stats.yearCost) + ' (~' + U.fmtMoney(stats.monthlyAvgCost) + ' شهرياً)')
        ])
      ]),
      UI.btn(isUrgent ? 'جدّد النطاقات المطلوبة' : 'إدارة النطاقات', {
        tone: isUrgent ? 'primary' : 'ghost', size: 'sm', onClick: function () { go('domains'); }
      })
    ]);
  }

  function domainMini(d) {
    return U.el('div', { class: 'domain-row domain-' + d.status }, [
      U.el('div', { class: 'domain-ico' }, [icon(d.statusIcon, { size: 20, fallback: 'globe' })]),
      U.el('div', { class: 'domain-main' }, [
        U.el('div', { class: 'domain-name', text: d.domain }),
        U.el('div', { class: 'domain-meta', text: U.dateLabel(d.expiry, 'short') + ' · ' + d.dueLabel + ' · ' + U.fmtMoney(d.price) })
      ])
    ]);
  }

  function chartSection(state, asOf) {
    var series = F.dailySeries(state, U.addDays(asOf, -29), asOf);
    var values = series.map(function (d) { return d.balance; });
    var months = F.monthlySeries(state, 6, asOf, asOf);
    return UI.section('نظرة سريعة', [
      U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card-head' }, [
          icon('trendUp', { size: 20 }),
          U.el('div', { class: 'card-title', text: 'الرصيد — آخر 30 يوماً' }),
          U.el('div', { class: 'card-extra' }, [
            U.el('span', { class: 'muted', text: 'من ' + U.fmtMoney(values.length ? values[0] : 0) + ' إلى ' + U.fmtMoney(F.totalBalance(state)) })
          ])
        ]),
        U.el('div', { class: 'card-body', html: UI.sparkline(values, { width: 320, height: 64, fill: true, color: 'var(--c-primary)' }) })
      ]),
      U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card-head' }, [
          icon('chart', { size: 20 }),
          U.el('div', { class: 'card-title', text: 'دخل ومصروف — 6 أشهر' }),
          U.el('div', { class: 'card-extra' }, [U.el('span', { class: 'muted', text: 'أخضر دخل · برتقالي مصروف' })])
        ]),
        U.el('div', { class: 'card-body', html: UI.bars(months, { width: 340, height: 150 }) })
      ]),
      UI.btn('التقارير التفصيلية', { tone: 'ghost', size: 'sm', onClick: function () { go('reports'); } })
    ]);
  }

  function topCatsSection(state, asOf) {
    var cats = F.expenseByCategory(state, U.startOfMonth(asOf), asOf);
    if (!cats.length) return null;
    var total = U.sum(cats, function (c) { return c.amount; });
    return UI.section('أين ذهبت فلوس هذا الشهر', [
      U.el('div', { class: 'donut-row' }, [
        U.el('div', { class: 'donut-holder', html: UI.donut(cats.slice(0, 6), {
          size: 150, centerValue: U.fmtCompact(total), centerLabel: 'مصروف الشهر'
        }) }),
        UI.legend(cats.slice(0, 6).map(function (c) {
          return { label: c.label, color: c.color, amount: c.amount, valueText: U.fmtMoney(c.amount) + ' · ' + c.pct + '%' };
        }))
      ]),
      UI.btn('كل المصروفات', { tone: 'ghost', size: 'sm', onClick: function () { go('expenses'); } })
    ]);
  }

  function monthBars(state, asOf) {
    var m = F.monthSummary(state, U.monthKey(asOf), asOf);
    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card-head' }, [
        icon('calendar', { size: 20 }),
        U.el('div', { class: 'card-title', text: 'شهر ' + m.label + (m.partial ? ' (حتى اليوم)' : '') }),
        U.el('div', { class: 'card-extra' }, [
          U.el('span', { class: 'badge badge-' + (m.net >= 0 ? 'income' : 'danger'), text: U.fmtMoney(m.net, { sign: true }) })
        ])
      ]),
      U.el('div', { class: 'card-body' }, [
        UI.kv('الدخل', U.fmtMoney(m.income), { valueClass: 'tx-income' }),
        UI.kv('المصروف', U.fmtMoney(m.expense), { valueClass: 'tx-expense' }),
        UI.kv('متوسط الصرف اليومي', U.fmtMoney(m.avgDailyExpense)),
        UI.kv('نسبة الادخار', U.fmtPct(m.savingRate))
      ])
    ]);
  }

  /* ------------------------------------------- منتقي اليوم (اليوم فقط افتراضياً) */

  // اليوم المعروض: من التخزين المحلي للجلسة إن اختار المستخدم يوماً آخر
  function pickedDay(ctx) {
    if (dashDay) return dashDay;
    return (ctx && (ctx.asOf || ctx.today)) || U.todayISO();
  }

  function setDay(iso) {
    dashDay = iso;
    try { sessionStorage.setItem('masrofi.dashDay', iso); } catch (e) { /* تجاهل */ }
    if (Fin.App) Fin.App.refresh();
  }

  function dayNavigator(state, asOf, today) {
    var days = activityDays(state, 30);
    var isToday = asOf === today;
    var row = U.el('div', { class: 'day-nav' });

    row.appendChild(UI.iconBtn('chevronRight', 'اليوم السابق', function () { setDay(U.addDays(asOf, -1)); }));
    row.appendChild(U.el('input', {
      type: 'date', class: 'input day-picker', value: asOf,
      max: today,
      onChange: function (e) { if (e.target.value) setDay(e.target.value); }
    }));
    row.appendChild(UI.iconBtn('chevronLeft', 'اليوم التالي', function () {
      var next = U.addDays(asOf, 1);
      setDay(next > today ? today : next);
    }));
    if (!isToday) {
      row.appendChild(UI.btn('اليوم', { tone: 'primary', size: 'sm', onClick: function () { setDay(today); } }));
    } else {
      row.appendChild(UI.badge('أنت في اليوم الحالي', 'income'));
    }
    if (days.length) {
      row.appendChild(UI.chip('أيام فيها حركات (' + days.length + ')', {
        icon: 'list',
        active: dashHistory,
        onClick: function () { dashHistory = !dashHistory; if (Fin.App) Fin.App.refresh(); }
      }));
    }
    return U.el('div', { class: 'day-nav-wrap' }, [
      row,
      U.el('div', { class: 'muted day-nav-hint', text: isToday
        ? 'تعرض حركات اليوم فقط. اختر تاريخاً لعرض يوم آخر، أو اضغط «أيام فيها حركات».'
        : 'تعرض حركات ' + U.dateLabel(asOf) + ' — اضغط «اليوم» للعودة.' })
    ]);
  }

  // الأيام التي فيها حركات فعلية (الأحدث أولاً) — للاختيار السريع
  function activityDays(state, limit) {
    var seen = {};
    ((state && state.transactions) || []).forEach(function (tx) {
      if (tx && tx.date) seen[tx.date] = (seen[tx.date] || 0) + 1;
    });
    return Object.keys(seen).sort(function (a, b) { return a < b ? 1 : -1; }).slice(0, limit || 30)
      .map(function (d) { return { date: d, count: seen[d] }; });
  }

  function historySection(state, asOf, today) {
    var days = activityDays(state, 30);
    if (!days.length) return null;
    var rows = days.map(function (d) {
      var s = F.daySummary(state, d.date);
      var isCurrent = d.date === asOf;
      return U.el('div', {
        class: 'day-row' + (isCurrent ? ' is-current' : ''),
        onClick: function () { setDay(d.date); }
      }, [
        U.el('div', { class: 'day-row-main' }, [
          U.el('div', { class: 'day-row-title', text: U.dateLabel(d.date, 'weekday') }),
          U.el('div', { class: 'day-row-meta', text: d.count + ' حركة · ' + U.relativeDay(d.date, today) })
        ]),
        U.el('div', { class: 'day-row-nums' }, [
          s.income ? U.el('span', { class: 'amount-in', text: '+' + U.fmtMoney(s.income, { currency: false }) }) : null,
          s.expense ? U.el('span', { class: 'amount-out', text: '−' + U.fmtMoney(s.expense, { currency: false }) }) : null
        ]),
        U.el('span', { class: 'badge badge-' + (s.net >= 0 ? 'income' : 'expense'), text: U.fmtMoney(s.net, { sign: true }) })
      ]);
    });
    return UI.section('أيام سابقة (اختر يوماً لعرضه)', [
      U.el('div', { class: 'card' }, [U.el('div', { class: 'card-body' }, rows)]),
      UI.btn('عرض كل التقارير', { tone: 'ghost', size: 'sm', onClick: function () { go('reports'); } })
    ]);
  }

  /* --------------------------------------------------------------- الشاشة */

  Fin.Views.dashboard = {
    id: 'dashboard',
    title: 'لوحة اليوم',
    icon: 'home',
    order: 1,
    subtitle: 'اليوم فقط — واختر أي يوم لعرضه',

    render: function (rootEl, ctx) {
      var state = Store.state;
      var today = ctx.today || U.todayISO();
      // القاعدة: نعرض يوماً واحداً فقط (الافتراضي اليوم). لا تختلط الأيام.
      var asOf = pickedDay(ctx);
      if (asOf > today) asOf = today;
      var d = F.daySummary(state, asOf);
      var rec = F.receivables(state, today);

      rootEl.appendChild(dayNavigator(state, asOf, today));
      rootEl.appendChild(dayHero(d));

      var hasAny = d.txCount > 0 || d.planned > 0;
      if (!hasAny) {
        rootEl.appendChild(U.el('div', { class: 'alert alert-info' }, [
          U.el('div', { class: 'alert-ico' }, [icon('calendar', { size: 14 })]),
          U.el('div', { class: 'alert-main' }, [
            U.el('div', { class: 'alert-title', text: 'لا حركات في ' + U.dateLabel(asOf) }),
            U.el('div', { class: 'alert-body', text: asOf === today
              ? 'أضف مصروفاً من الأعلى (بضغطة واحدة) وسيظهر هنا فوراً.'
              : 'اختر يوماً آخر من الأعلى، أو أضف حركة بتاريخ هذا اليوم.' })
          ])
        ]));
      }

      rootEl.appendChild(UI.section('إضافة بضغطة واحدة', [
        quickGrid(asOf),
        U.el('div', { class: 'muted center', text: 'اضغط الفئة ثم «إضافة» — المبلغ مقترح وتقدر تعدّله' })
      ]));

      // حركات اليوم المعروض فقط (لا تختلط بأيام أخرى)
      var dayTx = F.txInRange(state, asOf, asOf, { includePlanned: false });
      rootEl.appendChild(UI.section('حركات ' + (asOf === today ? 'اليوم' : U.dateLabel(asOf, 'short')), [
        UI.list(dayTx, {
          emptyIcon: 'receipt',
          emptyTitle: 'لا حركات مسجّلة',
          emptyBody: 'أضف مصروفاً أو سجّل تحصيلاً من الأعلى',
          render: function (tx) {
            return UI.txRow(tx, {
              onEdit: function (t) { editTx(t); },
              onDelete: function (t) { deleteTx(t); }
            });
          }
        }),
        d.planned > 0 ? U.el('div', { class: 'muted', text: 'ملاحظة: ' + U.fmtMoney(d.planned) + ' مصروفات مخطّطة لم تُدفع (لا تُخصم من الرصيد).' }) : null
      ]));

      // أيام سابقة: مطويّة حتى يطلبها المستخدم
      if (dashHistory) {
        var hist = historySection(state, asOf, today);
        if (hist) rootEl.appendChild(hist);
      }

      rootEl.appendChild(receivingSection(rec));

      var ob = F.obligations(state);
      if (ob.count) {
        rootEl.appendChild(UI.section('مصروفات مخطّطة (ليست ديوناً)', [
          U.el('div', { class: 'summary-strip' }, [
            U.el('div', { class: 'summary-cell' }, [
              U.el('div', { class: 'summary-label', text: 'لم تُدفع بعد' }),
              U.el('div', { class: 'summary-value tx-warn', text: U.fmtMoney(ob.total) })
            ]),
            U.el('div', { class: 'summary-cell' }, [
              U.el('div', { class: 'summary-label', text: 'عدد البنود' }),
              U.el('div', { class: 'summary-value', text: String(ob.count) })
            ]),
            U.el('div', { class: 'summary-cell' }, [
              U.el('div', { class: 'summary-label', text: 'بعد دفعها يبقى' }),
              U.el('div', { class: 'summary-value', text: U.fmtMoney(F.totalBalance(state) - ob.total) })
            ])
          ]),
          UI.list(ob.items.slice(0, 5), {
            render: function (tx) {
              return UI.txRow(tx, {
                compact: true,
                onEdit: function (t) { markPaid(t); }
              });
            }
          }),
          U.el('div', { class: 'muted', text: 'هذه مصروفات قادمة مخطّطة، وليست ديوناً — لا تُخصم من رصيدك حتى تدفعها.' }),
          UI.btn('إدارة المصروفات المخطّطة', { tone: 'ghost', size: 'sm', onClick: function () { go('accounts'); } })
        ]));
      }

      // الأموال المجمّعة (الصندوق)
      var funds = F.accumulatedFunds(state);
      rootEl.appendChild(UI.section('الأموال المجمّعة في الصندوق', [
        U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-head' }, [
            icon('cash', { size: 20 }),
            U.el('div', { class: 'card-title', text: 'النقد الموجود: ' + U.fmtMoney(funds.total) }),
            U.el('div', { class: 'card-extra' }, [UI.badge('لا ديون', 'income')])
          ]),
          U.el('div', { class: 'card-body' }, [
            UI.kv('كان في الصندوق قبل اليوم', U.fmtMoney(funds.opening)),
            UI.kv('إيرادات اليوم المحصَّلة', U.fmtMoney(funds.todayIncome), { valueClass: 'tx-income' }),
            UI.kv('مصروفات اليوم', U.fmtMoney(funds.todayExpense), { valueClass: 'tx-expense' }),
            UI.kv('مدخرات محفوظة (منفصلة)', U.fmtMoney(funds.saving)),
            UI.kv('الإجمالي', U.fmtMoney(funds.grandTotal), { valueClass: 'tx-income' })
          ])
        ]),
        UI.btn('تفصيل الأرصدة', { tone: 'ghost', size: 'sm', onClick: function () { go('accounts'); } })
      ]));

      var al = alertsSection(F.alerts(state, today));
      if (al) rootEl.appendChild(al);

      var dom = domainsSection(state, asOf);
      if (dom) rootEl.appendChild(dom);

      rootEl.appendChild(monthBars(state, asOf));
      var tc = topCatsSection(state, asOf);
      if (tc) rootEl.appendChild(tc);
      rootEl.appendChild(chartSection(state, asOf));

      // آخر الحركات
      var recent = F.txInRange(state, U.addDays(asOf, -14), asOf, { includePlanned: false }).slice(0, 8);
      rootEl.appendChild(UI.section('آخر الحركات', [
        UI.list(recent, {
          empty: emptyBox('receipt', 'لا حركات بعد', 'ابدأ بإضافة مصروف من الأعلى'),
          render: function (tx) {
            return UI.txRow(tx, {
              showRelative: true,
              onEdit: function (t) { editTx(t); },
              onDelete: function (t) { deleteTx(t); }
            });
          }
        })
      ]));
    }
  };

  /* ------------------------------------------------------- تعديل/سداد/حذف */

  function markPaid(tx) {
    UI.modal({
      title: 'تعديل: ' + (tx.label || C.catExpense(tx.category).label),
      body: U.el('div', {}, [
        U.el('p', { class: 'modal-text', text: 'المبلغ ' + U.fmtMoney(tx.amount) + (tx.paid === false ? ' — هذا التزام لم يُسدَّد؛ عند تأكيد السداد سيُخصم من الرصيد.' : '') })
      ]),
      actions: [
        { label: 'إغلاق', tone: 'ghost', value: null },
        tx.paid === false ? {
          label: 'سدّدت (' + U.fmtMoney(tx.amount) + ')',
          tone: 'success',
          onClick: function () {
            Store.updateTransaction(tx.id, { paid: true, planned: false, method: 'cash' });
            UI.toast('تم السداد — خُصم ' + U.fmtMoney(tx.amount), 'success');
          }
        } : null,
        {
          label: 'حذف',
          tone: 'danger',
          onClick: function () {
            UI.confirm('حذف «' + (tx.label || tx.category) + '» نهائياً؟').then(function (ok) {
              if (ok) { Store.removeTransaction(tx.id); UI.toast('تم الحذف', 'success'); }
            });
            return false;
          }
        }
      ].filter(Boolean)
    });
  }

  function editTx(tx) {
    var form = null;
    UI.modal({
      title: 'تعديل الحركة',
      body: null,
      onMount: function (card) {
        form = UI.form([
          { name: 'amount', label: 'المبلغ', type: 'money', required: true },
          {
            name: 'category', label: 'الفئة', type: 'select',
            options: (tx.type === 'income' ? C.INCOME_CATEGORIES : C.EXPENSE_CATEGORIES).map(function (c) { return { value: c.key, label: c.label }; })
          },
          { name: 'date', label: 'التاريخ', type: 'date', required: true },
          { name: 'note', label: 'ملاحظة', type: 'text' },
          { name: 'paid', label: 'مدفوع فعلاً', type: 'checkbox' }
        ], {
          values: {
            amount: tx.amount, category: tx.category, date: tx.date, note: tx.note || '', paid: tx.paid !== false
          }
        });
        card.querySelector('.modal-body').appendChild(form.el);
      },
      actions: [
        { label: 'إلغاء', tone: 'ghost', value: null },
        {
          label: 'حفظ',
          tone: 'primary',
          close: false,
          onClick: function () {
            var v = form.getValues();
            if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return false; }
            Store.updateTransaction(tx.id, {
              amount: v.amount, category: v.category, date: v.date, note: v.note,
              paid: !!v.paid, planned: v.paid ? false : tx.planned,
              method: v.paid ? (tx.method === 'credit' ? 'cash' : tx.method) : 'credit'
            });
            UI.toast('تم الحفظ', 'success');
            closeModal();
            return true;
          }
        },
        {
          label: 'حذف',
          tone: 'danger',
          onClick: function () {
            UI.confirm('حذف هذه الحركة نهائياً؟').then(function (ok) {
              if (ok) { Store.removeTransaction(tx.id); UI.toast('تم الحذف', 'success'); }
            });
            return false;
          }
        }
      ]
    });
  }

  function deleteTx(tx) {
    UI.confirm('حذف «' + (tx.label || tx.category) + '» ' + U.fmtMoney(tx.amount) + '؟').then(function (ok) {
      if (!ok) return;
      Store.removeTransaction(tx.id);
      UI.toast('تم الحذف', 'success');
    });
  }
})();
