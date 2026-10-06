/* =============================================================================
 * مصروفي — views/domains.js
 * إدارة النطاقات: الأقرب انتهاءً أولاً، تذكيرات تصاعدية، وتجديد يسجّل المصروف.
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

  var filter = 'all';   // all | renew | expired | watch
  var query = '';
  var sortMode = 'expiry'; // expiry | name | price

  function go(id) { if (Fin.App && Fin.App.go) Fin.App.go(id); }

  function closeModal() {
    var overlay = document.querySelector('.modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () { UI.detach(overlay); }, 180);
  }

  /* ------------------------------------------------------------- التذكيرات */

  function alertBanner(stats) {
    if (!stats.total) return null;
    var crit = stats.byStatus.expired.concat(stats.byStatus.critical);
    if (!crit.length && !stats.byStatus.soon.length) {
      return U.el('div', { class: 'alert alert-info' }, [
        U.el('div', { class: 'alert-ico' }, [icon('checkCircle', { size: 14 })]),
        U.el('div', { class: 'alert-main' }, [
          U.el('div', { class: 'alert-title', text: 'لا شيء عاجل الآن' }),
          U.el('div', { class: 'alert-body', text: 'أقرب نطاق للانتهاء: ' + (stats.next ? stats.next.domain + ' ' + stats.next.dueLabel : '—') })
        ])
      ]);
    }
    var nearest = crit[0] || stats.byStatus.soon[0];
    return U.el('div', { class: 'alert alert-' + (crit.length ? 'danger' : 'warn') }, [
      U.el('div', { class: 'alert-ico' }, [icon(crit.length ? 'flame' : 'clock', { size: 14 })]),
      U.el('div', { class: 'alert-main' }, [
        U.el('div', { class: 'alert-title', text: crit.length
          ? (crit.length + ' نطاق يحتاج تجديداً فورياً')
          : (stats.byStatus.soon.length + ' نطاق ينتهي خلال شهر') }),
        U.el('div', { class: 'alert-body', text: 'الأقرب: ' + nearest.domain + ' — ' + nearest.dueLabel + ' (' + U.fmtMoney(nearest.price) + ')' +
          (crit.length ? '' : ' · تكلفة القريبة ' + U.fmtMoney(stats.renewNowCost)) })
      ])
    ]);
  }

  function summaryCards(stats) {
    return UI.statGrid([
      UI.stat({ label: 'عدد النطاقات', value: String(stats.total), icon: 'globe', sub: 'لديك نحو 150 — أضف الباقي' }),
      UI.stat({ label: 'تجديد فوري', value: String(stats.criticalCount), tone: stats.criticalCount ? 'warn' : null, icon: 'flame', valueClass: stats.criticalCount ? 'tx-expense' : '' }),
      UI.stat({ label: 'تكلفة القريبة', value: U.fmtMoney(stats.renewNowCost), icon: 'creditCard', valueClass: 'tx-expense', sub: stats.renewNow.length + ' نطاقاً' }),
      UI.stat({ label: 'التكلفة السنوية', value: U.fmtMoney(stats.yearCost), icon: 'calendar', valueClass: 'tx-expense', sub: '~' + U.fmtMoney(stats.monthlyAvgCost) + ' شهرياً' })
    ]);
  }

  /* ------------------------------------------------------------ صف نطاق */

  function domainRow(d) {
    var tone = d.statusTone;
    return U.el('div', { class: 'domain-row domain-' + d.status }, [
      U.el('div', { class: 'domain-ico' }, [icon(d.statusIcon, { size: 20, fallback: 'globe' })]),
      U.el('div', { class: 'domain-main' }, [
        U.el('div', { class: 'domain-name', text: d.domain }),
        U.el('div', { class: 'domain-meta' }, [
          U.el('span', { text: 'ينتهي ' + U.dateLabel(d.expiry, 'short') + ' · ' + d.dueLabel }),
          d.note ? U.el('span', { class: 'tx-note', text: ' · ' + d.note }) : null
        ]),
        U.el('div', { class: 'tx-flags' }, [
          UI.badge(d.statusLabel, tone),
          UI.badge(U.fmtMoney(d.price) + ' / سنة', 'muted'),
          UI.badge(d.tld, 'info')
        ])
      ]),
      U.el('div', { class: 'domain-actions' }, [
        UI.btn('جدّد', {
          tone: d.status === 'expired' || d.status === 'critical' ? 'primary' : 'ghost',
          size: 'sm',
          onClick: function () { renewDialog(d); }
        }),
        UI.iconBtn('edit', 'تعديل', function () { editDialog(d); })
      ])
    ]);
  }

  /* ------------------------------------------------------------ الحوارات */

  function renewDialog(d) {
    var form = null;
    var tldPrice = C.domainDefaultPrice(d.domain);
    UI.modal({
      title: 'تجديد: ' + d.domain,
      body: null,
      onMount: function (card) {
        form = UI.form([
          { name: 'years', label: 'عدد السنوات', type: 'select', value: '1', options: [1, 2, 3, 5].map(function (y) { return { value: String(y), label: y + ' سنة' }; }) },
          { name: 'amount', label: 'المبلغ المدفوع', type: 'money', required: true, hint: 'السعر المعتاد ' + U.fmtMoney(tldPrice) + ' لسنة' },
          { name: 'date', label: 'تاريخ الدفع', type: 'date', value: U.todayISO(), required: true },
          { name: 'accountId', label: 'من حساب', type: 'select', value: 'cash', options: Fin.Store.state.accounts.map(function (a) { return { value: a.id, label: a.name }; }) },
          { name: 'paid', label: 'دفعت فعلاً (إن ألغيت سيُسجَّل كدين)', type: 'checkbox' },
          { name: 'note', label: 'ملاحظة', type: 'text', placeholder: 'اختياري' }
        ], { values: { years: '1', amount: Number(d.price) || tldPrice, date: U.todayISO(), accountId: 'cash', paid: true } });
        card.querySelector('.modal-body').appendChild(form.el);
        var yearsInput = form.inputs.years;
        if (yearsInput) {
          yearsInput.addEventListener('change', function () {
            var y = Number(yearsInput.value) || 1;
            form.setValue('amount', (Number(d.price) || tldPrice) * y);
          });
        }
      },
      actions: [
        { label: 'إلغاء', tone: 'ghost', value: null },
        {
          label: 'سجّل التجديد',
          tone: 'primary',
          close: false,
          onClick: function () {
            var v = form.getValues();
            if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return false; }
            var res = Store.renewDomain(d.id, {
              years: Number(v.years) || 1,
              amount: v.amount,
              date: v.date,
              accountId: v.accountId,
              paid: !!v.paid,
              method: v.paid ? 'cash' : 'credit',
              note: v.note
            });
            if (!res.ok) { UI.toast(res.error || 'تعذّر التجديد', 'danger'); return false; }
            UI.toast('جُدّد ' + d.domain + ' حتى ' + U.dateLabel(res.expiry, 'short') + ' — سُجّل ' + U.fmtMoney(res.amount), 'success', 4000);
            closeModal();
            return true;
          }
        }
      ]
    });
  }

  function editDialog(d) {
    var form = null;
    UI.modal({
      title: 'تعديل النطاق',
      body: null,
      onMount: function (card) {
        form = UI.form([
          { name: 'domain', label: 'اسم النطاق', type: 'text', required: true },
          { name: 'expiry', label: 'تاريخ الانتهاء', type: 'date', required: true },
          { name: 'price', label: 'سعر التجديد السنوي', type: 'money' },
          { name: 'note', label: 'ملاحظة', type: 'text' }
        ], { values: { domain: d.domain, expiry: d.expiry, price: d.price, note: d.note } });
        card.querySelector('.modal-body').appendChild(form.el);
      },
      actions: [
        {
          label: 'حذف',
          tone: 'danger',
          close: false,
          onClick: function () {
            UI.confirm('حذف «' + d.domain + '» من القائمة؟ (لن تُحذف الحركات المسجّلة)').then(function (ok) {
              if (!ok) return;
              Store.removeDomain(d.id);
              UI.toast('حُذف ' + d.domain, 'success');
              closeModal();
            });
            return false;
          }
        },
        { label: 'إلغاء', tone: 'ghost', value: null },
        {
          label: 'حفظ',
          tone: 'primary',
          close: false,
          onClick: function () {
            var v = form.getValues();
            if (!v.domain) { UI.toast('أدخل اسم النطاق', 'danger'); return false; }
            var res = Store.updateDomain(d.id, {
              domain: String(v.domain).trim().toLowerCase(),
              expiry: v.expiry,
              price: U.toNumber(v.price),
              note: v.note || ''
            });
            if (!res.ok) { UI.toast(res.error, 'danger'); return false; }
            UI.toast('تم الحفظ', 'success');
            closeModal();
            return true;
          }
        }
      ]
    });
  }

  function addDialog() {
    var form = null;
    UI.modal({
      title: 'إضافة نطاق',
      body: U.el('p', { class: 'modal-text', text: 'أضف نطاقاً واحداً في كل مرة، أو الصق قائمة كاملة من زر «لصق قائمة».' }),
      onMount: function (card) {
        form = UI.form([
          { name: 'domain', label: 'النطاق', type: 'text', required: true, placeholder: 'example.com' },
          { name: 'expiry', label: 'تاريخ الانتهاء', type: 'date', required: true, value: U.todayISO() },
          { name: 'price', label: 'سعر التجديد (سنة)', type: 'money', hint: 'إن تركته فارغاً يُقدَّر حسب الامتداد: .com = 180 · .com.ly = 15' },
          { name: 'note', label: 'ملاحظة', type: 'text' }
        ], { values: { expiry: U.todayISO() } });
        card.querySelector('.modal-body').appendChild(form.el);
        var nameInput = form.inputs.domain;
        if (nameInput) {
          nameInput.addEventListener('blur', function () {
            if (!nameInput.value) return;
            var current = form.getValues().price;
            if (!current) form.setValue('price', C.domainDefaultPrice(nameInput.value));
          });
        }
      },
      actions: [
        { label: 'إلغاء', tone: 'ghost', value: null },
        {
          label: 'إضافة',
          tone: 'primary',
          close: false,
          onClick: function () {
            var v = form.getValues();
            if (!v.domain) { UI.toast('أدخل اسم النطاق', 'danger'); return false; }
            var res = Store.addDomain({
              domain: v.domain, expiry: v.expiry,
              price: v.price ? v.price : undefined, note: v.note || ''
            });
            if (!res.ok) { UI.toast(res.error, 'danger'); return false; }
            UI.toast('أُضيف ' + res.domain.domain, 'success');
            closeModal();
            return true;
          }
        }
      ]
    });
  }

  // لصق قائمة كاملة: كل سطر «domain,YYYY-MM-DD,price» أو «domain YYYY-MM-DD»
  function pasteDialog() {
    var form = null;
    UI.modal({
      wide: true,
      title: 'لصق قائمة نطاقات',
      body: null,
      onMount: function (card) {
        form = UI.form([
          {
            name: 'list', type: 'textarea', rows: 10, required: true,
            label: 'كل سطر: النطاق ثم التاريخ (اختياري السعر)',
            placeholder: 'example.com, 2026-10-12, 180\nhtml.com.ly, 2026-11-05, 15\nanother.org 2027-01-01',
            hint: 'الفاصل: فاصلة أو مسافة أو تاب. السعر اختياري.'
          }
        ]);
        card.querySelector('.modal-body').appendChild(form.el);
      },
      actions: [
        { label: 'إلغاء', tone: 'ghost', value: null },
        {
          label: 'أضف الكل',
          tone: 'primary',
          close: false,
          onClick: function () {
            var text = String(form.getValues().list || '');
            var rows = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
            var items = [];
            rows.forEach(function (line) {
              var parts = line.split(/[,\t;]+|\s{2,}|\s+/).filter(Boolean);
              var domain = parts[0];
              var date = null, price = null;
              for (var i = 1; i < parts.length; i++) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(parts[i])) date = parts[i];
                else if (/^\d+(\.\d+)?$/.test(parts[i]) && price === null) price = Number(parts[i]);
              }
              if (!domain) return;
              items.push({ domain: domain, expiry: date || U.todayISO(), price: price === null ? undefined : price });
            });
            if (!items.length) { UI.toast('لم أفهم أي سطر — تأكد من الصيغة', 'danger'); return false; }
            var res = Store.addDomains(items);
            UI.toast('أُضيف ' + res.added.length + ' نطاقاً' + (res.skipped.length ? ' · تُخطّي ' + res.skipped.length + ' (مكرر)' : ''), 'success', 4000);
            closeModal();
            return true;
          }
        }
      ]
    });
  }

  /* --------------------------------------------------------------- الشاشة */

  Fin.Views.domains = {
    id: 'domains',
    title: 'النطاقات',
    icon: 'globe',
    order: 6,
    subtitle: 'تجديدات وتذكيرات',

    render: function (rootEl, ctx) {
      var asOf = ctx.asOf || U.todayISO();
      var stats = F.domainStats(Store.state, asOf);

      rootEl.appendChild(UI.section('ملخص النطاقات', [
        alertBanner(stats),
        summaryCards(stats),
        U.el('div', { class: 'btn-row' }, [
          UI.btn('إضافة نطاق', { icon: 'plus', tone: 'primary', onClick: addDialog }),
          UI.btn('لصق قائمة كاملة', { icon: 'list', tone: 'ghost', onClick: pasteDialog }),
          UI.btn('تصدير CSV', {
            icon: 'download',
            tone: 'ghost',
            onClick: function () {
              var rows = [['النطاق', 'الانتهاء', 'الأيام المتبقية', 'الحالة', 'السعر', 'ملاحظة']];
              stats.list.forEach(function (d) {
                rows.push([d.domain, d.expiry, d.daysLeft, d.statusLabel, d.price, d.note || '']);
              });
              var csv = '\ufeff' + rows.map(function (r) {
                return r.map(function (c) { return '"' + String(c === null || c === undefined ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
              }).join('\r\n');
              U.download('domains-' + asOf + '.csv', csv, 'text/csv;charset=utf-8');
              UI.toast('نُزّل ملف النطاقات', 'success');
            }
          })
        ])
      ]));

      // القسم العاجل أولاً
      if (stats.renewNow.length) {
        rootEl.appendChild(UI.section('يحتاج تجديداً قريباً (' + stats.renewNow.length + ')', [
          U.el('div', { class: 'muted', text: 'التكلفة الإجمالية: ' + U.fmtMoney(stats.renewNowCost) + ' — جدّد بالأقرب أولاً' }),
          UI.list(stats.renewNow, { render: domainRow })
        ]));
      }

      // كل النطاقات + تصفية
      var filters = [
        { key: 'all', label: 'الكل (' + stats.total + ')' },
        { key: 'renew', label: 'قريبة (' + stats.renewNow.length + ')' },
        { key: 'expired', label: 'ساقطة (' + stats.byStatus.expired.length + ')' },
        { key: 'watch', label: 'للمتابعة (' + stats.byStatus.watch.length + ')' }
      ];

      var searchInput = U.el('input', {
        class: 'input', type: 'search', placeholder: 'ابحث باسم النطاق…', value: query,
        onInput: U.debounce(function (e) { query = e.target.value; if (Fin.App) Fin.App.refresh(); }, 220)
      });

      var sortSelect = U.el('select', { class: 'input', onChange: function (e) { sortMode = e.target.value; if (Fin.App) Fin.App.refresh(); } }, [
        U.el('option', { value: 'expiry', text: 'الأقرب انتهاءً' }),
        U.el('option', { value: 'name', text: 'الاسم' }),
        U.el('option', { value: 'price', text: 'الأغلى' })
      ]);
      sortSelect.value = sortMode;

      var list = stats.list.filter(function (d) {
        if (filter === 'renew' && !(d.status === 'expired' || d.status === 'critical' || d.status === 'soon')) return false;
        if (filter === 'expired' && d.status !== 'expired') return false;
        if (filter === 'watch' && d.status !== 'watch') return false;
        if (query && d.domain.indexOf(query.trim().toLowerCase()) < 0) return false;
        return true;
      });
      if (sortMode === 'name') list = list.slice().sort(function (a, b) { return a.domain.localeCompare(b.domain); });
      if (sortMode === 'price') list = list.slice().sort(function (a, b) { return b.price - a.price; });

      rootEl.appendChild(UI.section('كل النطاقات', [
        U.el('div', { class: 'range-row' }, [
          UI.chip('الكل', { active: filter === 'all', onClick: function () { filter = 'all'; if (Fin.App) Fin.App.refresh(); } }),
          UI.chip('قريبة', { active: filter === 'renew', onClick: function () { filter = 'renew'; if (Fin.App) Fin.App.refresh(); } }),
          UI.chip('ساقطة', { active: filter === 'expired', onClick: function () { filter = 'expired'; if (Fin.App) Fin.App.refresh(); } }),
          UI.chip('للمتابعة', { active: filter === 'watch', onClick: function () { filter = 'watch'; if (Fin.App) Fin.App.refresh(); } })
        ]),
        U.el('div', { class: 'form-inline' }, [searchInput, sortSelect]),
        UI.list(list, {
          empty: emptyBox(
            'globe',
            query ? 'لا نتائج للبحث' : 'لا نطاقات في هذه التصفية',
            'أضف نطاقاً من الزر في الأعلى'
          ),
          render: domainRow
        }),
        filters.length ? U.el('div', { class: 'muted', text: stats.list.length + ' نطاقاً في القائمة · اضغط «تعديل» لتعديل أي نطاق أو حذفه' }) : null
      ]));

      // توزيع الامتدادات
      if (stats.byTld.length) {
        rootEl.appendChild(UI.section('التوزيع حسب الامتداد', [
          U.el('div', { class: 'card' }, [
            U.el('div', { class: 'card-body' }, stats.byTld.map(function (t) {
              var pct = stats.yearCost > 0 ? U.round(t.cost / stats.yearCost * 100, 0) : 0;
              return U.el('div', { class: 'tld-row' }, [
                U.el('div', { class: 'tld-head' }, [
                  U.el('span', { class: 'mono', text: '.' + t.tld }),
                  U.el('span', { class: 'muted', text: t.count + ' نطاق · ' + U.fmtMoney(t.cost) + ' (' + pct + '%)' })
                ]),
                UI.hbar(pct)
              ]);
            }))
          ]),
          U.el('div', { class: 'muted', text: 'الامتدادات الليبية (.com.ly) رخيصة جداً (15 د.ل) — لو أردت تقليل التكلفة السنوية انقل ما يمكن نقله.' })
        ]));
      }

      // مصروف النطاقات المسجّل
      var spend = F.domainSpend(Store.state, U.startOfYear(asOf), asOf);
      rootEl.appendChild(UI.section('ما دفعته فعلاً على النطاقات هذه السنة', [
        U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-body' }, [
            UI.kv('الإجمالي المدفوع', U.fmtMoney(spend.total), { valueClass: 'tx-expense' }),
            UI.kv('عدد عمليات التجديد', String(spend.count)),
            spend.items.length ? UI.list(spend.items, {
              render: function (tx) {
                return UI.txRow(tx, { compact: true, showRelative: true });
              }
            }) : U.el('div', { class: 'muted', text: 'لم تُسجّل أي عملية تجديد بعد — اضغط «جدّد» على أي نطاق وسيُسجَّل المصروف تلقائياً.' })
          ])
        ])
      ]));
    }
  };
})();
