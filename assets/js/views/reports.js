/* =============================================================================
 * مصروفي — views/reports.js
 * «التقارير»: مقارنة بالفترة السابقة، 6 أشهر، توزيع الفئات، تحليل النطاقات،
 * تنبؤ التدفق النقدي 60 يوماً، أهم المصروفات، وتصدير CSV / طباعة.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U, UI = Fin.UI, Store = Fin.Store, F = Fin.Finance;
  Fin.Views = Fin.Views || {};

  /* ------------------------------------------------------ أدوات محلية */

  var PERIODS = [
    { key: 'month', label: 'هذا الشهر', offset: 0, unit: 'month' },
    { key: 'lastMonth', label: 'الشهر الماضي', offset: -1, unit: 'month' },
    { key: 'quarter', label: 'هذا الربع', offset: 0, unit: 'quarter' },
    { key: 'lastQuarter', label: 'الربع الماضي', offset: -1, unit: 'quarter' },
    { key: 'year', label: 'هذه السنة', offset: 0, unit: 'year' },
    { key: 'all', label: 'الكل', offset: 0, unit: 'all' }
  ];

  var periodKey = 'month';

  function findPeriod(key) {
    for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].key === key) return PERIODS[i];
    return PERIODS[0];
  }

  function resolveRange(asOf, def) {
    if (def.unit === 'all') return { from: '0000-01-01', to: '9999-12-31', label: 'كل الفترات' };
    var anchor = asOf;
    if (def.offset) {
      anchor = def.unit === 'month' ? U.addMonths(asOf, def.offset * 1)
        : (def.unit === 'quarter' ? U.addMonths(asOf, def.offset * 3) : U.addMonths(asOf, def.offset * 12));
    }
    if (def.unit === 'month') {
      var m = U.monthRange(anchor);
      return { from: m.from, to: m.to, label: U.monthLabel(m.key), key: m.key };
    }
    if (def.unit === 'quarter') {
      var q = U.quarterRange(anchor);
      return { from: q.from, to: q.to, label: U.periodLabel(q.key), key: q.key };
    }
    var y = String(anchor).slice(0, 4);
    return { from: y + '-01-01', to: y + '-12-31', label: 'سنة ' + y, key: y };
  }

  // الفترة السابقة المكافئة (نفس عدد الأيام مباشرة قبل البداية)
  function comparableRange(cur) {
    var days = U.rangeDays(cur.from, cur.to).length;
    if (!days) days = 1;
    var to = U.addDays(cur.from, -1);
    var from = U.addDays(to, -(days - 1));
    return { from: from, to: to, label: U.dateLabel(from, 'short') + ' → ' + U.dateLabel(to, 'short') };
  }

  function deltaNode(value, opts) {
    opts = opts || {};
    var up = value > 0, flat = Math.abs(value) < 0.005;
    var tone = flat ? 'muted' : (opts.invert ? (up ? 'danger' : 'income') : (up ? 'income' : 'expense'));
    var arrow = flat ? '▬' : (up ? '▲' : '▼');
    var text = (flat ? 'بلا تغيير' : (arrow + ' ' + U.fmtMoney(Math.abs(value), { currency: false }) + (opts.pct !== null && opts.pct !== undefined ? ' (' + U.fmtPct(Math.abs(opts.pct)) + ')' : '')));
    return { node: UI.badge(text, tone), up: up, flat: flat };
  }

  /* ----------------------------------------------------------- حالة الوحدة */

  var forecastDays = 60;

  /* ============================================================== البناء */

  function render(rootEl, ctx) {
    var state = ctx.state || Store.state;
    var asOf = ctx.asOf || U.todayISO();

    /* ------------------------------------------------------ 1) التبويبات */
    rootEl.appendChild(U.el('div', { class: 'section' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('h2', { class: 'section-title', text: 'الفترة' }),
        U.el('div', { class: 'card-extra', text: 'اليوم ' + U.dateLabel(asOf, 'short') })
      ]),
      UI.rangeTabs(PERIODS.map(function (p) {
        var r = resolveRange(asOf, p);
        return { key: p.key, label: p.label, from: r.from, to: r.to };
      }), periodKey, function (r) { periodKey = r.key; render(rootEl, ctx); })
    ]));

    var def = findPeriod(periodKey);
    var cur = resolveRange(asOf, def);
    var sum = F.rangeSummary(state, cur.from, cur.to);
    var prev = def.unit === 'all' ? null : F.compareRanges(state,
      { from: cur.from, to: cur.to, label: cur.label },
      comparableRange(cur));

    /* ------------------------------------------------- 2) الملخص والمقارنة */
    var cmpCards = [];
    if (prev) {
      var inc = deltaNode(prev.delta.income, { pct: prev.b.income > 0 ? U.round(prev.delta.income / prev.b.income * 100, 1) : null });
      var exp = deltaNode(prev.delta.expense, { invert: true, pct: prev.delta.expensePct });
      var net = deltaNode(prev.delta.net, {});
      cmpCards.push(UI.card({
        title: 'الدخل مقابل ' + prev.b.label, icon: '💰', tone: 'income',
        value: U.fmtMoney(sum.income),
        sub: 'السابق: ' + U.fmtMoney(prev.b.income),
        body: U.el('div', {}, [inc.node])
      }));
      cmpCards.push(UI.card({
        title: 'المصروف مقابل ' + prev.b.label, icon: '💸', tone: 'expense',
        value: U.fmtMoney(sum.expense),
        sub: 'السابق: ' + U.fmtMoney(prev.b.expense),
        body: U.el('div', {}, [exp.node])
      }));
      cmpCards.push(UI.card({
        title: 'الصافي مقابل ' + prev.b.label, icon: sum.net >= 0 ? '📈' : '📉',
        tone: sum.net >= 0 ? 'income' : 'expense',
        value: U.fmtMoney(sum.net, { sign: true }),
        sub: 'السابق: ' + U.fmtMoney(prev.b.net, { sign: true }) + ' — ' + prev.b.label,
        body: U.el('div', {}, [net.node])
      }));
    }

    rootEl.appendChild(UI.section('ملخص ' + cur.label, [
      UI.statGrid([
        UI.stat({ icon: '💰', label: 'الدخل', tone: 'income', value: U.fmtMoney(sum.income), sub: sum.txCount + ' معاملة · ' + sum.days + ' يوم' }),
        UI.stat({ icon: '💸', label: 'المصروف', tone: 'expense', value: U.fmtMoney(sum.expense), sub: 'متوسط يومي ' + U.fmtMoney(sum.avgDailyExpense) }),
        UI.stat({ icon: '📊', label: 'الصافي', tone: sum.net >= 0 ? 'income' : 'expense', value: U.fmtMoney(sum.net, { sign: true }), sub: sum.income > 0 ? 'نسبة الادخار ' + U.fmtPct(sum.savingRate) : 'لا دخل في الفترة' }),
        UI.stat({ icon: '⏳', label: 'غير مسدَّد في الفترة', tone: sum.unpaid > 0 ? 'warn' : 'primary', value: U.fmtMoney(sum.unpaid), sub: sum.unpaidCount + ' معاملة · مخطّط ' + U.fmtMoney(sum.planned) })
      ]),
      prev ? U.el('div', { class: 'stat-grid' }, cmpCards) : null,
      prev ? UI.card({
        title: 'مقارنة مفصّلة بالفترة السابقة',
        icon: '🔁',
        body: U.el('div', {}, [
          UI.kv('الفترة الحالية', cur.label + ' (' + U.dateLabel(cur.from, 'short') + ' → ' + U.dateLabel(cur.to, 'short') + ')'),
          UI.kv('الفترة المقارنة', prev.b.label),
          UI.kv('فرق الدخل', U.fmtMoney(prev.delta.income, { sign: true }), { valueClass: prev.delta.income >= 0 ? 'tx-income' : 'tx-expense' }),
          UI.kv('فرق المصروف', U.fmtMoney(prev.delta.expense, { sign: true }), { valueClass: prev.delta.expense > 0 ? 'tx-expense' : 'tx-income' }),
          UI.kv('فرق الصافي', U.fmtMoney(prev.delta.net, { sign: true }), { valueClass: prev.delta.net >= 0 ? 'tx-income' : 'tx-expense' }),
          UI.kv('نسبة تغيّر المصروف', U.fmtPct(prev.delta.expensePct, 1), { valueClass: prev.delta.expensePct > 0 ? 'tx-expense' : 'tx-income' })
        ])
      }) : null
    ]));

    /* ------------------------------------------------ 3) آخر 6 أشهر */
    var series6 = F.monthlySeries(state, 6, asOf, asOf);
    rootEl.appendChild(UI.section('آخر 6 أشهر', [
      UI.card({
        title: 'الدخل والمصروف شهرياً',
        icon: '📊',
        extra: U.el('span', { class: 'muted', text: 'الأخضر دخل · الأحمر مصروف' }),
        body: U.el('div', {}, [
          U.el('div', { class: 'spark-wrap', html: UI.bars(series6, { height: 150 }) }),
          U.el('div', { class: 'list' }, series6.slice().reverse().map(function (m) {
            return U.el('div', { class: 'list-item' }, [
              U.el('div', { class: 'tx-main' }, [
                U.el('div', { class: 'tx-title', text: m.label + (m.partial ? ' (جاري)' : '') }),
                U.el('div', { class: 'tx-meta' }, [
                  U.el('span', { text: 'دخل ' + U.fmtMoney(m.income) + ' · مصروف ' + U.fmtMoney(m.expense) })
                ])
              ]),
              U.el('div', { class: 'tx-amount ' + (m.net >= 0 ? 'tx-income' : 'tx-expense'), text: U.fmtMoney(m.net, { sign: true }) })
            ]);
          }))
        ])
      })
    ]));

    /* ------------------------------------------- 4) توزيع المصروف بالفئات */
    var cats = F.expenseByCategory(state, cur.from, cur.to);
    if (cats.length) {
      var items = cats.map(function (c) { return { label: c.label, amount: c.amount, color: c.color || 'var(--c-primary)' }; });
      rootEl.appendChild(UI.section('أين راحت الفلوس؟', [
        UI.card({
          title: 'توزيع المصروف حسب الفئة',
          icon: '🥧',
          body: U.el('div', { class: 'chart-row' }, [
            U.el('div', { html: UI.donut(items, { size: 168, centerValue: U.fmtCompact ? U.fmtCompact(sum.expense) : String(sum.expense), centerLabel: 'مصروف الفترة' }) }),
            UI.legend(items.map(function (it, i) {
              return { label: it.label + ' (' + U.fmtPct(cats[i].pct) + ')', color: it.color, amount: it.amount };
            }))
          ])
        }),
        UI.card({
          title: 'النِسَب بالتفصيل',
          icon: '📋',
          body: U.el('div', { class: 'list' }, cats.map(function (c) {
            return U.el('div', { class: 'list-item' }, [
              U.el('span', { class: 'ico', text: c.icon || '📦' }),
              U.el('div', { class: 'tx-main' }, [
                U.el('div', { class: 'tx-title', text: c.label }),
                U.el('div', { class: 'tx-meta' }, [U.el('span', { text: c.count + ' معاملة · ' + U.fmtPct(c.pct) + ' من المصروف' })]),
                UI.hbar(c.pct, { color: c.color || 'var(--c-primary)' })
              ]),
              U.el('div', { class: 'tx-amount tx-expense', text: U.fmtMoney(c.amount) })
            ]);
          }))
        })
      ]));
    } else {
      rootEl.appendChild(UI.section('أين راحت الفلوس؟', [
        UI.emptyState('🥧', 'لا مصروف في هذه الفترة', 'اختر فترة أوسع أو تبويب «الكل».')
      ]));
    }

    /* ------------------------------------------------ 5) تحليل النطاقات */
    var byLoc = F.incomeByLocation(state, cur.from, cur.to);
    var rec = F.receivables(state, asOf);
    var locKeys = U.unique(byLoc.map(function (l) { return l.key; })
      .concat(rec.items.map(function (i) { return i.locationId || 'other'; })));

    var locRows = locKeys.map(function (key) {
      var loc = C.location(key) || { name: 'أخرى', icon: '➕' };
      var collected = 0, cnt = 0;
      byLoc.forEach(function (l) { if (l.key === key) { collected = l.amount; cnt = l.count; } });
      var due = U.sum(rec.items.filter(function (i) { return (i.locationId || 'other') === key; }), function (i) { return i.remaining; });
      var expected = U.round(collected + due);
      var pct = expected > 0 ? U.pct(collected, expected) : 0;
      var overdue = rec.items.filter(function (i) { return (i.locationId || 'other') === key && i.daysLate > 0; });
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'ico', text: loc.icon || '📍' }),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: loc.name }),
          U.el('div', { class: 'tx-meta' }, [
            U.el('span', { text: 'حُصِّل ' + U.fmtMoney(collected) + ' من متوقّع ' + U.fmtMoney(expected) + ' (' + U.fmtPct(pct) + ')' }),
            cnt ? U.el('span', { text: ' · ' + cnt + ' دفعة' }) : null
          ]),
          UI.progress(pct, pct >= 100 ? '' : (pct >= 50 ? 'warn' : 'danger')),
          overdue.length ? U.el('div', { class: 'tx-flags' }, [UI.badge('متأخر ' + overdue.length + ' استحقاق بـ ' + U.fmtMoney(U.sum(overdue, function (i) { return i.remaining; })), 'danger')]) : null
        ]),
        U.el('div', { class: 'tx-amount ' + (due > 0 ? 'tx-expense' : 'tx-income') }, [
          U.el('span', { text: due > 0 ? U.fmtMoney(due) : '✓' }),
          U.el('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '400' }, text: due > 0 ? ' متبقٍ' : ' مكتمل' })
        ])
      ]);
    });

    rootEl.appendChild(UI.section('تحليل النطاقات (الأماكن)', [
      locKeys.length ? UI.card({
        title: 'التحصيل مقابل المستحق لكل نطاق',
        icon: '🗺️',
        body: U.el('div', { class: 'list' }, locRows)
      }) : UI.emptyState('🗺️', 'لا نطاقات بعد', 'لا إيرادات ولا استحقاقات في هذه الفترة.'),
      UI.statGrid([
        UI.stat({ icon: '✅', label: 'محصَّل في الفترة', tone: 'income', value: U.fmtMoney(sum.income), sub: 'من ' + byLoc.length + ' نطاق' }),
        UI.stat({ icon: '⏳', label: 'متبقٍ غير محصَّل', tone: 'expense', value: U.fmtMoney(rec.total), sub: rec.count + ' استحقاق حتى اليوم' })
      ])
    ]));

    /* ------------------------------------------ 6) تنبؤ التدفق النقدي */
    var fc = F.cashFlowForecast(state, asOf, forecastDays);
    var forecastCard = UI.card({
      title: 'الرصيد المتوقع خلال ' + forecastDays + ' يوماً',
      icon: '🔮',
      extra: U.el('button', {
        type: 'button', class: 'chip', text: forecastDays === 60 ? '90 يوماً' : '60 يوماً',
        onClick: function () { forecastDays = forecastDays === 60 ? 90 : 60; render(rootEl, ctx); }
      }),
      body: U.el('div', {}, [
        U.el('div', { class: 'stat-grid' }, [
          UI.stat({ icon: '🏦', label: 'الرصيد الحالي', tone: 'primary', value: U.fmtMoney(fc.openingBalance), sub: 'نقطة البداية' }),
          UI.stat({ icon: '📥', label: 'المتوقع تحصيله', tone: 'income', value: U.fmtMoney(fc.totalExpected), sub: fc.events.length + ' حدث متوقّع' }),
          UI.stat({ icon: '🎯', label: 'الرصيد بعد ' + forecastDays + ' يوماً', tone: 'income', value: U.fmtMoney(fc.closingBalance), sub: 'حتى ' + U.dateLabel(fc.horizon, 'short') })
        ]),
        U.el('div', { class: 'spark-wrap', html: UI.sparkline(fc.series.map(function (s) { return s.balance; }), { height: 64, fill: true }) }),
        U.el('div', { class: 'card-sub' }, [U.el('span', { text: 'الخط = الرصيد المتوقع يوماً بيوم (تشمل الاستحقاقات القائمة والقادمة من القوالب — بلا مصروفات جديدة).' })]),
        fc.events.length ? U.el('div', { class: 'list' }, fc.events.map(function (e) {
          return U.el('div', { class: 'list-item' }, [
            U.el('span', { class: 'ico', text: e.kind === 'receivable' ? '⏳' : '📅' }),
            U.el('div', { class: 'tx-main' }, [
              U.el('div', { class: 'tx-title', text: e.label }),
              U.el('div', { class: 'tx-meta' }, [
                U.el('span', { text: U.dateLabel(e.date, 'short') }),
                U.el('span', { text: ' · ' + (e.kind === 'receivable' ? 'استحقاق قائم غير محصَّل' : 'استحقاق قادم من القالب') })
              ])
            ]),
            U.el('div', { class: 'tx-amount tx-income', text: U.fmtMoney(e.expected) })
          ]);
        })) : UI.emptyState('🔮', 'لا أحداث متوقعة', 'لا استحقاقات قائمة ولا قادمة خلال ' + forecastDays + ' يوماً.')
      ])
    });
    rootEl.appendChild(UI.section('تنبؤ التدفق النقدي', [forecastCard]));

    /* --------------------------------- 7) أهم المصروفات وأعلى الأيام */
    var top = F.topExpenses(state, cur.from, cur.to, 10);
    var dayList = Object.keys(sum.byDay).map(function (d) { return sum.byDay[d]; })
      .filter(function (d) { return d.expense > 0; })
      .sort(function (a, b) { return b.expense - a.expense; })
      .slice(0, 5);

    rootEl.appendChild(UI.section('التفاصيل', [
      UI.card({
        title: 'أهم 10 مصروفات',
        icon: '🔝',
        body: top.length ? U.el('div', { class: 'list' }, top.map(function (tx, i) {
          var cat = C.catExpense(tx.category);
          return U.el('div', { class: 'list-item' }, [
            U.el('span', { class: 'ico', text: String(i + 1) + '️⃣' }),
            U.el('div', { class: 'tx-main' }, [
              U.el('div', { class: 'tx-title', text: tx.label || cat.label }),
              U.el('div', { class: 'tx-meta' }, [
                U.el('span', { text: U.dateLabel(tx.date, 'short') + ' · ' + cat.label }),
                tx.note ? U.el('span', { text: ' · ' + tx.note }) : null
              ])
            ]),
            U.el('div', { class: 'tx-amount tx-expense', text: U.fmtMoney(tx.amount) })
          ]);
        })) : UI.emptyState('🔝', 'لا مصروفات', 'لا يوجد ما يُعرض في هذه الفترة.')
      }),
      UI.card({
        title: 'أعلى الأيام صرفاً',
        icon: '📆',
        body: dayList.length ? U.el('div', { class: 'list' }, dayList.map(function (d) {
          return U.el('div', { class: 'list-item' }, [
            U.el('span', { class: 'ico', text: '📆' }),
            U.el('div', { class: 'tx-main' }, [
              U.el('div', { class: 'tx-title', text: U.dateLabel(d.date, 'weekday') }),
              U.el('div', { class: 'tx-meta' }, [
                U.el('span', { text: 'دخل ' + U.fmtMoney(d.income) + ' · صافي ' + U.fmtMoney(d.net, { sign: true }) })
              ])
            ]),
            U.el('div', { class: 'tx-amount tx-expense', text: U.fmtMoney(d.expense) })
          ]);
        })) : UI.emptyState('📆', 'لا أيام بصرف', 'لا مصروف في هذه الفترة.')
      })
    ]));

    /* --------------------------------------------------- 8) التصدير والطباعة */
    var exportCard = UI.card({
      title: 'تصدير وطباعة',
      icon: '📤',
      body: U.el('div', {}, [
        U.el('div', { class: 'stat-grid' }, [
          UI.btn('⬇️ تصدير CSV', {
            tone: 'ghost',
            onClick: function () {
              try {
                U.download('masrofi-' + U.todayISO() + '.csv', Store.exportCSV(), 'text/csv;charset=utf-8');
                UI.toast('تم تصدير CSV (كل المعاملات)', 'success');
              } catch (e) {
                UI.toast('تعذّر التصدير', 'danger');
              }
            }
          }),
          UI.btn('🖨️ طباعة / PDF', {
            tone: 'ghost',
            onClick: function () {
              try { window.print(); } catch (e) { UI.toast('تعذّرت الطباعة', 'danger'); }
            }
          })
        ]),
        U.el('div', { class: 'card-sub' }, [
          U.el('span', { text: 'CSV يحوي كل المعاملات (لا الفترة المعروضة) وبترميز UTF-8 مع BOM ليفتح صحيحاً في Excel العربي. الطباعة تخفي شريط التنقل والأزرار.' })
        ]),
        U.el('hr', { class: 'divider' }),
        UI.kv('عدد المعاملات الكلي', U.fmtNumber((state.transactions || []).length)),
        UI.kv('عدد الاستحقاقات', U.fmtNumber((state.charges || []).length)),
        UI.kv('عدد السندات', U.fmtNumber((state.receipts || []).length)),
        UI.kv('حجم البيانات', U.fmtNumber(Math.round(JSON.stringify(state).length / 1024), 1) + ' ك.ب')
      ])
    });
    rootEl.appendChild(UI.section('أدوات', [exportCard]));
  }

  Fin.Views.reports = {
    id: 'reports',
    title: 'التقارير',
    icon: '📊',
    order: 5,
    subtitle: 'مقارنات ورسوم وتنبؤ',
    render: render,
    destroy: function () {}
  };
})();
