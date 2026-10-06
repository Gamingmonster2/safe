/* =============================================================================
 * مصروفي — app.js
 * الراوتر + التبويبات + شريط التنقل + دورة التحديث. لا منطق مالي هنا.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U, UI = Fin.UI, Store = Fin.Store;
  var App = {};
  Fin.App = App;
  Fin.Views = Fin.Views || {};

  var views = {};
  var navOrder = [];
  var currentId = null;
  var currentView = null;
  var ctx = null;

  App.container = null;
  App.navEl = null;
  App.headerEl = null;

  /* --------------------------------------------------------------- التسجيل */

  App.register = function (view) {
    if (!view || !view.id) return;
    views[view.id] = view;
    navOrder = Object.keys(views).sort(function (a, b) {
      return (views[a].order || 99) - (views[b].order || 99);
    });
    return view;
  };

  // ترتيب التبويبات السفلية يأتي من C.NAV_ORDER (شاشة موجودة بلا تبويب مثل agent تُستبعد)
  App.tabIds = function () {
    if (C.NAV_ORDER && C.NAV_ORDER.length) {
      return C.NAV_ORDER.filter(function (id) { return !!views[id]; });
    }
    return navOrder.slice();
  };

  App.getView = function (id) { return views[id] || null; };
  App.list = function () { return navOrder.map(function (id) { return views[id]; }); };
  App.currentId = function () { return currentId; };

  // الشاشات تسجّل نفسها في Fin.Views عند التحميل (ARCHITECTURE §4) — الراوتر يتبنّاها هنا.
  // تُستدعى عند الإقلاع وعند أول تنقّل، فلا توجد شاشة تسجّل نفسها ولا تظهر.
  App.adoptViews = function () {
    var registered = 0;
    var bag = root.Fin && root.Fin.Views;
    if (!bag) return 0;
    Object.keys(bag).forEach(function (id) {
      var v = bag[id];
      if (v && v.id && !views[v.id] && typeof v.render === 'function') {
        App.register(v);
        registered++;
      }
    });
    return registered;
  };

  /* ------------------------------------------------------------- التنقل */

  App.go = function (id, opts) {
    opts = opts || {};
    App.adoptViews();
    if (!views[id]) {
      // تبويب غير مسجّل بعد (لم تُحمّل شاشته) — ننتظر قليلاً
      if (!opts._retry) {
        setTimeout(function () { App.go(id, { _retry: true, replace: opts.replace }); }, 120);
        return;
      }
      UI.toast('الشاشة غير متوفرة: ' + id, 'danger');
      return;
    }
    if (currentId === id && opts.force !== true) { App.refresh(); return; }
    if (currentView && typeof currentView.destroy === 'function') {
      try { currentView.destroy(); } catch (e) { console.error(e); }
    }
    // مغادرة شاشة المساعد = إسكات فوري
    if (Fin.Agent && Fin.Agent.silence) Fin.Agent.silence();
    currentId = id;
    currentView = views[id];

    if (location.hash !== '#/' + id) {
      if (opts.replace || !currentId) location.replace('#/' + id);
      else location.hash = '#/' + id;
    }

    U.clear(App.container);
    App.container.setAttribute('data-view', id);
    try {
      currentView.render(App.container, ctx);
    } catch (e) {
      console.error('[app] فشل رسم الشاشة ' + id, e);
      App.container.appendChild(UI.emptyState('alert', 'خطأ في الشاشة', String(e && e.message || e)));
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    App.renderNav();
    App.renderHeader();
  };

  App.refresh = function () {
    if (!currentId || !currentView) return;
    U.clear(App.container);
    try {
      currentView.render(App.container, ctx);
    } catch (e) {
      console.error('[app] فشل تحديث الشاشة ' + currentId, e);
      App.container.appendChild(UI.emptyState('alert', 'خطأ في الشاشة', String(e && e.message || e)));
    }
    App.renderNav();
    App.renderHeader();
  };

  /* --------------------------------------------------------- شريط التنقل */

  App.renderNav = function () {
    var nav = App.navEl || document.getElementById('nav');
    if (!nav) return;
    U.clear(nav);
    App.tabIds().forEach(function (id) {
      var v = views[id];
      if (!v || v.hidden) return;
      var cls = 'nav-item' + (id === currentId ? ' is-active' : '');
      var link = U.el('a', {
        class: cls,
        href: '#/' + id,
        title: v.title || id,
        onClick: function (e) { e.preventDefault(); App.go(id); },
        'aria-current': id === currentId ? 'page' : null
      });
      if (Fin.I) link.appendChild(Fin.I.el(Fin.I.has(v.icon) ? v.icon : 'list', { size: 22, className: 'nav-ico' }));
      link.appendChild(U.el('span', { class: 'nav-label', text: (v.title || id).split(' ')[0] }));
      nav.appendChild(link);
    });
  };

  App.renderHeader = function () {
    var h = App.headerEl || document.getElementById('app-title');
    if (h && currentView) {
      h.textContent = currentView.title + (currentView.subtitle ? ' — ' + currentView.subtitle : '');
    }
    var dateEl = document.getElementById('app-date');
    if (dateEl) dateEl.textContent = U.dateLabel(U.todayISO(), 'weekday');

    // شارة الرأس: أولوية للنطاقات التي ستسقط، ثم الإيجارات غير المحصَّلة
    var badge = document.getElementById('nav-badge');
    var badgeBtn = document.getElementById('nav-badge-btn');
    var badgeIco = document.getElementById('nav-badge-ico');
    if (badge && badgeBtn) {
      var dom = Fin.Finance.domainStats(Store.state, U.todayISO());
      var rec = Fin.Finance.receivables(Store.state, U.todayISO());
      var urgent = dom.criticalCount > 0;
      var show = urgent || rec.total > 0;
      if (badgeIco && Fin.I) {
        U.clear(badgeIco);
        badgeIco.appendChild(Fin.I.el(urgent ? 'flame' : 'hourglass', { size: 21, tone: urgent ? 'loss' : null }));
      }
      if (show) {
        badge.textContent = urgent ? String(dom.criticalCount) : U.fmtCompact(rec.total);
        badge.classList.remove('hidden');
        badgeBtn.title = urgent
          ? (dom.criticalCount + ' نطاق يحتاج تجديداً فورياً — اضغط للذهاب إلى النطاقات')
          : ('مستحق لي ولم يُحصَّل: ' + U.fmtMoney(rec.total) + ' — اضغط للذهاب إلى الإيرادات');
      } else {
        badge.classList.add('hidden');
      }
    }
  };

  /* ----------------------------------------------------------- التنبيهات */

  App.notify = function (message, tone) { UI.toast(message, tone); };

  /* --------------------------------------------------------- التهيئة */

  function parseHash() {
    var h = String(location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return h || null;
  }

  App.init = function () {
    App.container = document.getElementById('view');
    App.navEl = document.getElementById('nav');
    App.headerEl = document.getElementById('app-title');

    if (!App.container) {
      // لا حاوية: لا نخفي الخطأ بصمت
      console.error('[app] العنصر #view غير موجود في index.html');
      return;
    }

    // إيقاف أي نطق جارٍ — التطبيق منظومة تسجيل، ولا يصدر صوتاً بلا طلب صريح
    if (Fin.Agent && Fin.Agent.silence) Fin.Agent.silence();

    Store.load();
    Store.ensureCharges(U.todayISO());
    App.adoptViews();
    UI.theme.init();

    // أيقونات الرأس التي تشير إلى شاشات بلا تبويب (المساعد مثلاً)
    var linksHost = document.getElementById('header-links');
    if (linksHost && C.HEADER_LINKS) {
      U.clear(linksHost);
      C.HEADER_LINKS.forEach(function (l) {
        var link = U.el('a', {
          class: 'header-btn',
          href: '#/' + l.id,
          title: l.title,
          'aria-label': l.title,
          onClick: function (e) { e.preventDefault(); App.go(l.id); }
        });
        if (Fin.I) link.appendChild(Fin.I.el(Fin.I.has(l.icon) ? l.icon : 'robot', { size: 21 }));
        linksHost.appendChild(link);
      });
    }

    // أيقونات أزرار الرأس الثابتة
    [['quick-add-ico', 'plus'], ['settings-ico', 'settings'], ['nav-badge-ico', 'hourglass']].forEach(function (pair) {
      var host = document.getElementById(pair[0]);
      if (host && Fin.I) { U.clear(host); host.appendChild(Fin.I.el(pair[1], { size: 21 })); }
    });

    ctx = {
      state: Store.state,
      refresh: function () { App.refresh(); },
      go: function (id) { App.go(id); },
      // تاريخ العرض: لو فُتح التطبيق في يوم بلا حركات نعرض آخر يوم مسجَّل (لا أصفار مربكة)
      asOf: Fin.Finance.displayDay(Store.state, U.todayISO()),
      today: U.todayISO(),
      store: Store,
      finance: Fin.Finance
    };
    App.ctx = ctx;

    // تحديث تلقائي عند أي تغيير في البيانات
    Store.subscribe(function () {
      ctx.state = Store.state;
      ctx.asOf = Fin.Finance.displayDay(Store.state, U.todayISO());
      App.refresh();
      App.renderHeader();
    });

    window.addEventListener('hashchange', function () {
      var id = parseHash();
      if (id && id !== currentId && views[id]) App.go(id);
    });

    // زر الوضع الليلي/النهاري
    var tbtn = document.getElementById('theme-toggle');
    if (tbtn) tbtn.addEventListener('click', function () { UI.theme.toggle(); });

    // زر الإضافة السريعة
    var qbtn = document.getElementById('quick-add-btn');
    if (qbtn) qbtn.addEventListener('click', function () { App.quickAdd(); });

    // شارة المستحق غير المحصَّل → شاشة الإيرادات
    var badgeBtn = document.getElementById('nav-badge-btn');
    if (badgeBtn) badgeBtn.addEventListener('click', function () { App.go('income'); });

    // اختصارات لوحة المفاتيح
    document.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === 'n') { e.preventDefault(); if (App.quickAdd) App.quickAdd(); }
      if (e.key === 't') { e.preventDefault(); UI.theme.toggle(); }
      if (e.key === '/') {
        e.preventDefault();
        var search = document.getElementById('global-search');
        if (search) search.focus();
      }
    });

    var first = parseHash() || 'dashboard';
    if (!views[first]) first = navOrder[0] || 'dashboard';
    if (!views[first]) first = 'settings';

    if (!navOrder.length) {
      App.container.appendChild(UI.emptyState('⏳', 'جارٍ التحميل…', 'لم تُسجَّل أي شاشة بعد'));
      setTimeout(function () { App.go(first, { force: true, replace: true }); }, 400);
    } else {
      App.go(first, { force: true, replace: true });
    }

    // Service Worker (أوفلاين + تثبيت على الجوال)
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function (e) { console.info('[sw] لم يُسجَّل', e && e.message); });
      });
    }
  };

  // إضافة مصروف سريعة من أي شاشة (اختصار: حرف n)
  App.quickAdd = function (categoryKey) {
    var cat = categoryKey ? C.catExpense(categoryKey) : null;
    var fields = [
      { name: 'amount', label: 'المبلغ', type: 'money', required: true },
      { name: 'category', label: 'الفئة', type: 'select', value: categoryKey || 'other', options: C.EXPENSE_CATEGORIES.map(function (c) { return { value: c.key, label: c.icon + ' ' + c.label }; }) },
      { name: 'date', label: 'التاريخ', type: 'date', value: U.todayISO(), required: true },
      { name: 'note', label: 'ملاحظة', type: 'text', placeholder: 'اختياري' }
    ];
    var f = null;
    UI.modal({
      title: cat ? 'إضافة: ' + cat.label : 'مصروف جديد',
      body: null,
      onMount: function (card, close) {
        f = UI.form(fields, { values: { amount: cat && cat.quick ? cat.quick : '', category: categoryKey || 'other', date: U.todayISO() } });
        card.querySelector('.modal-body').appendChild(f.el);
      },
      onSubmit: function () {
        var v = f.getValues();
        if (!v.amount || Number(v.amount) <= 0) { UI.toast('أدخل مبلغاً صحيحاً', 'danger'); return { ok: false }; }
        Store.addExpense({
          amount: v.amount, category: v.category, date: v.date,
          note: v.note || '', label: C.catExpense(v.category).label, method: 'cash'
        });
        UI.toast('تم إضافة ' + U.fmtMoney(v.amount), 'success');
        return { ok: true };
      }
    });
  };

  /* --------------------------------------------------------------- الإقلاع */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', App.init);
  else App.init();
})();
