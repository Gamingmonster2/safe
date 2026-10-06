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

  // شارة فرق مع سهم اتجاه SVG (صعود أخضر / هبوط برتقالي / بلا تغيير)
  function deltaNode(value, opts) {
    opts = opts || {};
    var up = value > 0, flat = Math.abs(value) < 0.005;
    var tone = flat ? 'muted' : (opts.invert ? (up ? 'danger' : 'income') : (up ? 'income' : 'expense'));
    var badge = UI.badge('', tone);
    badge.appendChild(icon(flat ? 'equals' : (up ? 'trendUp' : 'trendDown'), { size: 13 }));
    badge.appendChild(U.el('span', {
      text: flat
        ? 'بلا تغيير'
        : (U.fmtMoney(Math.abs(value), { currency: false }) + (opts.pct !== null && opts.pct !== undefined ? ' (' + U.fmtPct(Math.abs(opts.pct)) + ')' : ''))
    }));
    return { node: badge, up: up, flat: flat };
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
        title: 'الدخل مقابل ' + prev.b.label, icon: 'arrowUp', tone: 'income',
        value: U.fmtMoney(sum.income),
        sub: 'السابق: ' + U.fmtMoney(prev.b.income),
        body: U.el('div', {}, [inc.node])
      }));
      cmpCards.push(UI.card({
        title: 'المصروف مقابل ' + prev.b.label, icon: 'arrowDown', tone: 'expense',
        value: U.fmtMoney(sum.expense),
        sub: 'السابق: ' + U.fmtMoney(prev.b.expense),
        body: U.el('div', {}, [exp.node])
      }));
      cmpCards.push(UI.card({
        title: 'الصافي مقابل ' + prev.b.label, icon: sum.net >= 0 ? 'trendUp' : 'trendDown',
        tone: sum.net >= 0 ? 'income' : 'expense',
        value: U.fmtMoney(sum.net, { sign: true }),
        sub: 'السابق: ' + U.fmtMoney(prev.b.net, { sign: true }) + ' — ' + prev.b.label,
        body: U.el('div', {}, [net.node])
      }));
    }

    rootEl.appendChild(UI.section('ملخص ' + cur.label, [
      UI.statGrid([
        UI.stat({ icon: 'arrowUp', label: 'الدخل', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(sum.income), sub: sum.txCount + ' معاملة · ' + sum.days + ' يوم' }),
        UI.stat({ icon: 'arrowDown', label: 'المصروف', tone: 'expense', valueClass: 'tx-expense', value: U.fmtMoney(sum.expense), sub: 'متوسط يومي ' + U.fmtMoney(sum.avgDailyExpense) }),
        UI.stat({ icon: sum.net >= 0 ? 'trendUp' : 'trendDown', label: 'الصافي', tone: sum.net >= 0 ? 'income' : 'expense', valueClass: sum.net >= 0 ? 'tx-income' : 'tx-expense', value: U.fmtMoney(sum.net, { sign: true }), sub: sum.income > 0 ? 'نسبة الادخار ' + U.fmtPct(sum.savingRate) : 'لا دخل في الفترة' }),
        UI.stat({ icon: 'hourglass', label: 'غير مسدَّد في الفترة', tone: sum.unpaid > 0 ? 'warn' : 'primary', valueClass: sum.unpaid > 0 ? 'tx-warn' : '', value: U.fmtMoney(sum.unpaid), sub: sum.unpaidCount + ' معاملة · مخطّط ' + U.fmtMoney(sum.planned) })
      ]),
      prev ? U.el('div', { class: 'stat-grid' }, cmpCards) : null,
      prev ? UI.card({
        title: 'مقارنة مفصّلة بالفترة السابقة',
        icon: 'swap',
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
        icon: 'chart',
        extra: U.el('span', { class: 'muted', text: 'الأخضر دخل · البرتقالي مصروف' }),
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
              UI.amountBlock(Math.abs(m.net), m.net >= 0, { currency: false })
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
          icon: 'chart',
          body: U.el('div', { class: 'chart-row' }, [
            U.el('div', { html: UI.donut(items, { size: 168, centerValue: U.fmtCompact ? U.fmtCompact(sum.expense) : String(sum.expense), centerLabel: 'مصروف الفترة' }) }),
            UI.legend(items.map(function (it, i) {
              return { label: it.label + ' (' + U.fmtPct(cats[i].pct) + ')', color: it.color, amount: it.amount };
            }))
          ])
        }),
        UI.card({
          title: 'النِسَب بالتفصيل',
          icon: 'list',
          body: U.el('div', { class: 'list' }, cats.map(function (c) {
            return U.el('div', { class: 'list-item' }, [
              U.el('span', { class: 'tx-ico out' }, [UI.catIcon({ key: c.key, type: 'expense' }, 'out')]),
              U.el('div', { class: 'tx-main' }, [
                U.el('div', { class: 'tx-title', text: c.label }),
                U.el('div', { class: 'tx-meta' }, [U.el('span', { text: c.count + ' معاملة · ' + U.fmtPct(c.pct) + ' من المصروف' })]),
                UI.hbar(c.pct, { color: c.color || 'var(--c-primary)' })
              ]),
              UI.amountBlock(c.amount, false, { currency: false })
            ]);
          }))
        })
      ]));
    } else {
      rootEl.appendChild(UI.section('أين راحت الفلوس؟', [
        emptyBox('chart', 'لا مصروف في هذه الفترة', 'اختر فترة أوسع أو تبويب «الكل».')
      ]));
    }

    /* ------------------------------------------------ 5) تحليل النطاقات */
    var byLoc = F.incomeByLocation(state, cur.from, cur.to);
    var rec = F.receivables(state, asOf);
    var locKeys = U.unique(byLoc.map(function (l) { return l.key; })
      .concat(rec.items.map(function (i) { return i.locationId || 'other'; })));

    var locRows = locKeys.map(function (key) {
      var loc = C.location(key) || { name: 'أخرى', icon: 'building' };
      var collected = 0, cnt = 0;
      byLoc.forEach(function (l) { if (l.key === key) { collected = l.amount; cnt = l.count; } });
      var due = U.sum(rec.items.filter(function (i) { return (i.locationId || 'other') === key; }), function (i) { return i.remaining; });
      var expected = U.round(collected + due);
      var pct = expected > 0 ? U.pct(collected, expected) : 0;
      var overdue = rec.items.filter(function (i) { return (i.locationId || 'other') === key && i.daysLate > 0; });
      return U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'tx-ico' }, [icon(loc.icon, { size: 20, fallback: 'building' })]),
        U.el('div', { class: 'tx-main' }, [
          U.el('div', { class: 'tx-title', text: loc.name }),
          U.el('div', { class: 'tx-meta' }, [
            U.el('span', { text: 'حُصِّل ' + U.fmtMoney(collected) + ' من متوقّع ' + U.fmtMoney(expected) + ' (' + U.fmtPct(pct) + ')' }),
            cnt ? U.el('span', { text: ' · ' + cnt + ' دفعة' }) : null
          ]),
          UI.progress(pct, pct >= 100 ? '' : (pct >= 50 ? 'warn' : 'danger')),
          overdue.length ? U.el('div', { class: 'tx-flags' }, [UI.badge('متأخر ' + overdue.length + ' استحقاق بـ ' + U.fmtMoney(U.sum(overdue, function (i) { return i.remaining; })), 'danger')]) : null
        ]),
        due > 0
          ? U.el('div', { class: 'tx-amount' }, [
            UI.amountBlock(due, true, { arrow: false, currency: false }),
            U.el('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '400' }, text: ' متبقٍ' })
          ])
          : U.el('div', { class: 'tx-amount tx-income' }, [
            icon('checkCircle', { size: 16 }),
            U.el('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '400' }, text: ' مكتمل' })
          ])
      ]);
    });

    rootEl.appendChild(UI.section('تحليل النطاقات (الأماكن)', [
      locKeys.length ? UI.card({
        title: 'التحصيل مقابل المستحق لكل نطاق',
        icon: 'building',
        body: U.el('div', { class: 'list' }, locRows)
      }) : emptyBox('building', 'لا نطاقات بعد', 'لا إيرادات ولا استحقاقات في هذه الفترة.'),
      UI.statGrid([
        UI.stat({ icon: 'checkCircle', label: 'محصَّل في الفترة', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(sum.income), sub: 'من ' + byLoc.length + ' نطاق' }),
        UI.stat({ icon: 'hourglass', label: 'متبقٍ غير محصَّل', tone: 'warn', valueClass: 'tx-warn', value: U.fmtMoney(rec.total), sub: rec.count + ' استحقاق حتى اليوم' })
      ])
    ]));

    /* ------------------------------------------ 6) تنبؤ التدفق النقدي */
    var fc = F.cashFlowForecast(state, asOf, forecastDays);
    var forecastCard = UI.card({
      title: 'الرصيد المتوقع خلال ' + forecastDays + ' يوماً',
      icon: 'trendUp',
      extra: U.el('button', {
        type: 'button', class: 'chip', text: forecastDays === 60 ? '90 يوماً' : '60 يوماً',
        onClick: function () { forecastDays = forecastDays === 60 ? 90 : 60; render(rootEl, ctx); }
      }),
      body: U.el('div', {}, [
        U.el('div', { class: 'stat-grid' }, [
          UI.stat({ icon: 'wallet', label: 'الرصيد الحالي', tone: 'primary', value: U.fmtMoney(fc.openingBalance), sub: 'نقطة البداية' }),
          UI.stat({ icon: 'arrowUp', label: 'المتوقع تحصيله', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(fc.totalExpected), sub: fc.events.length + ' حدث متوقّع' }),
          UI.stat({ icon: 'target', label: 'الرصيد بعد ' + forecastDays + ' يوماً', tone: 'income', valueClass: 'tx-income', value: U.fmtMoney(fc.closingBalance), sub: 'حتى ' + U.dateLabel(fc.horizon, 'short') })
        ]),
        U.el('div', { class: 'spark-wrap', html: UI.sparkline(fc.series.map(function (s) { return s.balance; }), { height: 64, fill: true }) }),
        U.el('div', { class: 'card-sub' }, [U.el('span', { text: 'الخط = الرصيد المتوقع يوماً بيوم (تشمل الاستحقاقات القائمة والقادمة من القوالب — بلا مصروفات جديدة).' })]),
        fc.events.length ? U.el('div', { class: 'list' }, fc.events.map(function (e) {
          return U.el('div', { class: 'list-item' }, [
            U.el('span', { class: 'tx-ico in' }, [icon(e.kind === 'receivable' ? 'hourglass' : 'calendar', { size: 20 })]),
            U.el('div', { class: 'tx-main' }, [
              U.el('div', { class: 'tx-title', text: e.label }),
              U.el('div', { class: 'tx-meta' }, [
                U.el('span', { text: U.dateLabel(e.date, 'short') }),
                U.el('span', { text: ' · ' + (e.kind === 'receivable' ? 'استحقاق قائم غير محصَّل' : 'استحقاق قادم من القالب') })
              ])
            ]),
            UI.amountBlock(e.expected, true, { currency: false })
          ]);
        })) : emptyBox('target', 'لا أحداث متوقعة', 'لا استحقاقات قائمة ولا قادمة خلال ' + forecastDays + ' يوماً.')
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
        icon: 'list',
        body: top.length ? U.el('div', { class: 'list' }, top.map(function (tx, i) {
          var cat = C.catExpense(tx.category);
          return U.el('div', { class: 'list-item' }, [
            UI.badge(String(i + 1), 'muted'),
            U.el('div', { class: 'tx-main' }, [
              U.el('div', { class: 'tx-title', text: tx.label || cat.label }),
              U.el('div', { class: 'tx-meta' }, [
                U.el('span', { text: U.dateLabel(tx.date, 'short') + ' · ' + cat.label }),
                tx.note ? U.el('span', { text: ' · ' + tx.note }) : null
              ])
            ]),
            UI.amountBlock(tx.amount, false, { currency: false })
          ]);
        })) : emptyBox('list', 'لا مصروفات', 'لا يوجد ما يُعرض في هذه الفترة.')
      }),
      UI.card({
        title: 'أعلى الأيام صرفاً',
        icon: 'calendar',
        body: dayList.length ? U.el('div', { class: 'list' }, dayList.map(function (d) {
          return U.el('div', { class: 'list-item' }, [
            U.el('span', { class: 'tx-ico out' }, [icon('calendar', { size: 20 })]),
            U.el('div', { class: 'tx-main' }, [
              U.el('div', { class: 'tx-title', text: U.dateLabel(d.date, 'weekday') }),
              U.el('div', { class: 'tx-meta' }, [
                U.el('span', { text: 'دخل ' + U.fmtMoney(d.income) + ' · صافي ' + U.fmtMoney(d.net, { sign: true }) })
              ])
            ]),
            UI.amountBlock(d.expense, false, { currency: false })
          ]);
        })) : emptyBox('calendar', 'لا أيام بصرف', 'لا مصروف في هذه الفترة.')
      })
    ]));

    /* --------------------------------------------------- 8) التصدير والطباعة */
    var exportCard = UI.card({
      title: 'تصدير وطباعة',
      icon: 'download',
      body: U.el('div', {}, [
        U.el('div', { class: 'stat-grid' }, [
          UI.btn('تصدير CSV', {
            icon: 'download',
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
          UI.btn('طباعة / PDF', {
            icon: 'file',
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
    icon: 'chart',
    order: 5,
    subtitle: 'مقارنات ورسوم وتنبؤ',
    render: render,
    destroy: function () {}
  };
})();
