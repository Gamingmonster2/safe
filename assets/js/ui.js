/* =============================================================================
 * مصروفي — ui.js
 * مكوّنات واجهة + رسوم SVG محلية (تعمل أوفلاين بلا Chart.js).
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U;
  var UI = {};
  Fin.UI = UI;

  function el(tag, attrs, children) { return U.el(tag, attrs, children); }

  // أيقونة SVG احترافية بالأيقونة المطلوبة (اسم أو إيموجي قديم → أيقونة مناسبة)
  function icoNode(name, tone) {
    var I = Fin.I;
    if (!I) return el('span', { class: 'ic-wrap', text: '' });
    var key = I.has(name) ? name : (I.has(String(name || '')) ? name : 'package');
    if (!I.has(name)) key = 'package';
    return I.el(key, { size: 22, tone: tone || null });
  }
  UI.ico = icoNode;
  function iconEl(icon, cls) {
    var node = icoNode(icon);
    if (cls) node.className += ' ' + cls;
    return node;
  }
  // رمز الفئة المالية (يجمع بين الفئة والنوع)
  function catIcon(cat, tone) {
    var I = Fin.I;
    if (!I) return el('span', { class: 'ic-wrap' });
    var name = I.forCategory(cat && cat.key, cat && cat.type);
    return I.el(name, { size: 22, tone: tone || null });
  }
  UI.catIcon = catIcon;

  // شارة اتجاه واضحة: ▲ دخل · ▼ مصروف
  UI.dirBadge = function (isIncome, label) {
    var I = Fin.I;
    var node = el('span', { class: 'dir-badge ' + (isIncome ? 'in' : 'out') });
    if (I) node.appendChild(I.el(isIncome ? 'arrowUp' : 'arrowDown', { size: 14, width: 2.2 }));
    node.appendChild(el('span', { text: label || (isIncome ? 'دخل' : 'مصروف') }));
    return node;
  };

  // عنصر مبلغ مع سهم الاتجاه
  UI.amountBlock = function (amount, isIncome, opts) {
    opts = opts || {};
    var I = Fin.I;
    var wrap = el('div', { class: 'amount-block ' + (isIncome ? 'in' : 'out') });
    if (I && opts.arrow !== false) wrap.appendChild(I.el(isIncome ? 'arrowUp' : 'arrowDown', { size: 18, width: 2.2 }));
    wrap.appendChild(el('span', {
      class: 'amount-value ' + (isIncome ? 'amount-in' : 'amount-out'),
      text: (isIncome ? '+' : '−') + U.fmtMoney(amount, { currency: false })
    }));
    if (opts.currency !== false) wrap.appendChild(el('span', { class: 'amount-cur', text: C.CURRENCY_LABEL }));
    return wrap;
  };

  // إزالة آمنة: تعمل مع DOM كامل ومع بيئات مصغّرة لا توفّر Element.remove
  function detach(node) {
    if (!node) return;
    if (typeof node.remove === 'function') { node.remove(); return; }
    if (node.parentNode) node.parentNode.removeChild(node);
  }
  UI.detach = detach;

  /* ============================================================ الوضع/الثيم */

  UI.theme = {
    get: function () {
      var st = Fin.Store && Fin.Store.state;
      return (st && st.settings && st.settings.theme) || 'dark';
    },
    resolve: function (mode) {
      var m = mode || UI.theme.get();
      if (m === 'auto') {
        try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch (e) { return 'dark'; }
      }
      return m === 'light' ? 'light' : 'dark';
    },
    apply: function (mode) {
      var resolved = UI.theme.resolve(mode);
      document.documentElement.setAttribute('data-theme', resolved);
      document.documentElement.setAttribute('data-theme-mode', mode || UI.theme.get());
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'light' ? '#ffffff' : '#061428');
      var btn = document.getElementById('theme-toggle');
      if (btn) {
        U.clear(btn);
        if (Fin.I) btn.appendChild(Fin.I.el(resolved === 'light' ? 'moon' : 'sun', { size: 21 }));
        btn.setAttribute('aria-label', resolved === 'light' ? 'الوضع الليلي' : 'الوضع النهاري');
        btn.title = resolved === 'light' ? 'الوضع الليلي' : 'الوضع النهاري';
      }
      var logo = document.getElementById('app-logo');
      if (logo && Fin.I) { U.clear(logo); logo.appendChild(Fin.I.el('wallet', { size: 20 })); }
      return resolved;
    },
    set: function (mode) {
      var m = C.THEMES.indexOf(mode) >= 0 ? mode : 'dark';
      if (Fin.Store && Fin.Store.state) Fin.Store.updateSettings({ theme: m });
      return UI.theme.apply(m);
    },
    toggle: function () {
      var current = UI.theme.get();
      var resolved = UI.theme.resolve(current);
      var next = resolved === 'light' ? 'dark' : 'light';
      return UI.theme.set(next);
    },
    init: function () {
      UI.theme.apply();
      try {
        var mq = window.matchMedia('(prefers-color-scheme: light)');
        var onChange = function () { if (UI.theme.get() === 'auto') UI.theme.apply('auto'); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      } catch (e) { /* تجاهل */ }
    }
  };

  /* ================================================================ التنسيق */

  UI.money = function (n, opts) {
    opts = opts || {};
    var v = Number(n) || 0;
    var cls = opts.cls || (opts.tone === 'income' ? 'tx-income' : opts.tone === 'expense' ? 'tx-expense' : (v > 0 && opts.sign ? 'tx-income' : v < 0 ? 'tx-expense' : ''));
    var html = '<span class="money ' + cls + '">' + U.escapeHtml(U.fmtMoney(v, opts)) + '</span>';
    return opts.html ? html : U.fmtMoney(v, opts);
  };

  UI.badge = function (text, tone) {
    return el('span', { class: 'badge badge-' + (tone || 'muted'), text: text });
  };

  UI.chip = function (label, opts) {
    opts = opts || {};
    return el('button', {
      type: 'button',
      class: 'chip' + (opts.active ? ' is-active' : '') + (opts.className ? ' ' + opts.className : ''),
      onClick: opts.onClick || function () {},
      title: opts.title || ''
    }, [opts.icon ? iconEl(opts.icon) : null, el('span', { text: label })]);
  };

  UI.progress = function (pct, tone) {
    var p = U.clamp(pct, 0, 100);
    return el('div', { class: 'progress' + (tone ? ' progress-' + tone : '') }, [
      el('div', { class: 'progress-bar', style: { width: p + '%' } })
    ]);
  };

  UI.emptyState = function (icon, title, body, action) {
    var I = Fin.I;
    var box = el('div', { class: 'empty' }, [
      el('div', { class: 'empty-ico' }, [
        I ? I.el(I.has(icon) ? icon : 'package', { size: 34, width: 1.4 }) : null
      ]),
      el('div', { class: 'empty-title', text: title || 'لا يوجد شيء بعد' }),
      body ? el('div', { class: 'empty-body', text: body }) : null,
      action || null
    ]);
    return box;
  };

  UI.card = function (opts) {
    opts = opts || {};
    var head = null;
    if (opts.title || opts.icon || opts.extra) {
      head = el('div', { class: 'card-head' }, [
        opts.icon ? iconEl(opts.icon) : null,
        opts.title ? el('div', { class: 'card-title', text: opts.title }) : null,
        opts.extra ? el('div', { class: 'card-extra' }, [opts.extra]) : null
      ]);
    }
    var body = el('div', { class: 'card-body' }, [
      opts.value !== undefined && opts.value !== null ? el('div', { class: 'card-value ' + (opts.valueClass || ''), text: String(opts.value) }) : null,
      opts.sub ? el('div', { class: 'card-sub', text: opts.sub }) : null,
      opts.body || null
    ]);
    var node = el('div', {
      class: 'card' + (opts.tone ? ' card-' + opts.tone : '') + (opts.onClick ? ' tappable' : '') + (opts.className ? ' ' + opts.className : ''),
      onClick: opts.onClick || null,
      role: opts.onClick ? 'button' : null,
      tabindex: opts.onClick ? '0' : null
    }, [head, body]);
    return node;
  };

  UI.statGrid = function (cards) {
    return el('div', { class: 'stat-grid' }, (cards || []).filter(Boolean));
  };

  UI.stat = function (opts) {
    opts = opts || {};
    return el('div', {
      class: 'stat' + (opts.tone ? ' stat-' + opts.tone : '') + (opts.onClick ? ' tappable' : ''),
      onClick: opts.onClick || null
    }, [
      el('div', { class: 'stat-top' }, [opts.icon ? iconEl(opts.icon) : null, el('span', { class: 'stat-label', text: opts.label || '' })]),
      el('div', { class: 'stat-value ' + (opts.valueClass || ''), text: opts.value === undefined ? '—' : String(opts.value) }),
      opts.sub ? el('div', { class: 'stat-sub', text: opts.sub }) : null
    ]);
  };

  UI.list = function (items, opts) {
    opts = opts || {};
    var arr = items || [];
    if (!arr.length) return opts.empty || UI.emptyState(opts.emptyIcon || 'package', opts.emptyTitle || 'لا يوجد شيء', opts.emptyBody || '');
    return el('div', { class: 'list' + (opts.className ? ' ' + opts.className : '') },
      arr.map(function (item, i) { return opts.render ? opts.render(item, i) : el('div', { class: 'list-item', text: String(item) }); }));
  };

  UI.section = function (title, children, opts) {
    opts = opts || {};
    return el('section', { class: 'section' + (opts.className ? ' ' + opts.className : ''), id: opts.id || null }, [
      title ? el('div', { class: 'section-head' }, [
        el('h2', { class: 'section-title', text: title }),
        opts.extra || null
      ]) : null,
      el('div', { class: 'section-body' }, [].concat(children || []).filter(Boolean))
    ]);
  };

  /* ============================================================= صف معاملة */

  UI.txRow = function (tx, opts) {
    opts = opts || {};
    var isIncome = tx.type === 'income';
    var cat = isIncome ? C.catIncome(tx.category) : C.catExpense(tx.category);
    var loc = C.location(tx.locationId);
    var flags = [];
    if (tx.planned) flags.push(UI.badge('مخطّط', 'muted'));
    if (tx.paid === false && !tx.planned) flags.push(UI.badge('لم يُدفع', 'warn'));
    if (tx.chargeId) flags.push(UI.badge('إيجار', 'info'));

    var row = el('div', {
      class: 'tx-row' + (opts.compact ? ' compact' : '') + (tx.paid === false ? ' is-unpaid' : '') + (tx.planned ? ' is-planned' : '') + (isIncome ? ' is-in' : ' is-out'),
      onClick: opts.onClick || null
    }, [
      el('div', { class: 'tx-ico' + (isIncome ? ' in' : ' out') }, [
        catIcon({ key: tx.category, type: tx.type })
      ]),
      el('div', { class: 'tx-main' }, [
        el('div', { class: 'tx-title', text: (tx.label || cat.label) }),
        el('div', { class: 'tx-meta' }, [
          el('span', { text: U.dateLabel(tx.date, opts.compact ? 'short' : undefined) + (opts.showRelative ? ' · ' + U.relativeDay(tx.date) : '') }),
          loc ? el('span', { text: ' · ' + loc.name }) : null,
          tx.note ? el('span', { class: 'tx-note', text: ' · ' + tx.note }) : null
        ]),
        flags.length ? el('div', { class: 'tx-flags' }, flags) : null
      ]),
      UI.amountBlock(tx.amount, isIncome, { arrow: opts.arrow !== false }),
      (opts.onEdit || opts.onDelete) ? el('div', { class: 'tx-actions' }, [
        opts.onEdit ? UI.iconBtn('edit', 'تعديل', function (e) { e.stopPropagation(); opts.onEdit(tx); }) : null,
        opts.onDelete ? UI.iconBtn('trash', 'حذف', function (e) { e.stopPropagation(); opts.onDelete(tx); }) : null
      ]) : null
    ]);
    return row;
  };

  /* ================================================================= الرسوم */

  function svg(attrs, children) {
    var parts = [];
    Object.keys(attrs || {}).forEach(function (k) { parts.push(k + '="' + U.escapeHtml(attrs[k]) + '"'); });
    return '<svg ' + parts.join(' ') + '>' + (children || []).join('') + '</svg>';
  }

  // رسم أعمدة/خط بسيط
  UI.sparkline = function (values, opts) {
    opts = opts || {};
    var vals = (values || []).map(function (v) { return Number(v) || 0; });
    var w = opts.width || 240, h = opts.height || 48, pad = 2;
    if (!vals.length) return svg({ viewBox: '0 0 ' + w + ' ' + h, class: 'svg-chart' }, []);
    var max = Math.max.apply(null, vals.concat([0]));
    var min = Math.min.apply(null, vals.concat([0]));
    var span = (max - min) || 1;
    var step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
    var pts = vals.map(function (v, i) {
      var x = pad + i * step;
      var y = h - pad - ((v - min) / span) * (h - pad * 2);
      return [U.round(x, 2), U.round(y, 2)];
    });
    var color = opts.color || 'var(--c-primary)';
    var children = [];
    if (opts.fill) {
      var d = 'M' + pts[0][0] + ',' + (h - pad) + ' ' + pts.map(function (p) { return 'L' + p[0] + ',' + p[1]; }).join(' ') + ' L' + pts[pts.length - 1][0] + ',' + (h - pad) + ' Z';
      children.push('<path d="' + d + '" fill="' + color + '" opacity="0.15"></path>');
    }
    children.push('<polyline fill="none" stroke="' + color + '" stroke-width="' + (opts.strokeWidth || 2) + '" stroke-linejoin="round" stroke-linecap="round" points="' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '"></polyline>');
    if (opts.dot !== false && pts.length) {
      var last = pts[pts.length - 1];
      children.push('<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.5" fill="' + color + '"></circle>');
    }
    return svg({ viewBox: '0 0 ' + w + ' ' + h, class: 'svg-chart ' + (opts.className || ''), preserveAspectRatio: 'none' }, children);
  };

  // أعمدة شهرية/يومية: items = [{label, income, expense, net}]
  UI.bars = function (items, opts) {
    opts = opts || {};
    var arr = items || [];
    var w = opts.width || 320, h = opts.height || 140;
    var padB = 20, padT = 8, padX = 4;
    if (!arr.length) return svg({ viewBox: '0 0 ' + w + ' ' + h, class: 'svg-chart' }, []);
    var max = Math.max.apply(null, arr.map(function (it) { return Math.max(Number(it.income) || 0, Number(it.expense) || 0, Math.abs(Number(it.net) || 0)); }).concat([1]));
    var n = arr.length;
    var slot = (w - padX * 2) / n;
    var barW = Math.max(3, Math.min(opts.barWidth || 14, slot / 2.6));
    var children = [];
    // خطوط إرشادية
    for (var g = 0; g <= 2; g++) {
      var gy = padT + (h - padT - padB) * g / 2;
      children.push('<line x1="' + padX + '" y1="' + U.round(gy, 1) + '" x2="' + (w - padX) + '" y2="' + U.round(gy, 1) + '" stroke="var(--c-border)" stroke-width="0.6" stroke-dasharray="3 4"></line>');
    }
    arr.forEach(function (it, i) {
      var cx = padX + slot * i + slot / 2;
      var inc = Number(it.income) || 0, exp = Number(it.expense) || 0;
      var hi = (h - padT - padB) * (inc / max);
      var he = (h - padT - padB) * (exp / max);
      var base = h - padB;
      if (opts.showIncome !== false) children.push('<rect x="' + U.round(cx - barW - 1, 2) + '" y="' + U.round(base - hi, 2) + '" width="' + barW + '" height="' + Math.max(0.6, U.round(hi, 2)) + '" rx="2" fill="var(--c-income)" opacity="0.9"></rect>');
      children.push('<rect x="' + U.round(cx + 1, 2) + '" y="' + U.round(base - he, 2) + '" width="' + barW + '" height="' + Math.max(0.6, U.round(he, 2)) + '" rx="2" fill="var(--c-expense)" opacity="0.9"></rect>');
      if (opts.labels !== false) {
        children.push('<text x="' + U.round(cx, 1) + '" y="' + (h - 6) + '" text-anchor="middle" font-size="9" fill="var(--c-muted)">' + U.escapeHtml(String(it.label || '').slice(0, 8)) + '</text>');
      }
    });
    return svg({ viewBox: '0 0 ' + w + ' ' + h, class: 'svg-chart', preserveAspectRatio: 'xMidYMid meet' }, children);
  };

  // دائرة نسبية: items = [{label, amount, color}]
  UI.donut = function (items, opts) {
    opts = opts || {};
    var arr = (items || []).filter(function (i) { return (Number(i.amount) || 0) > 0; });
    var size = opts.size || 160, r = size / 2 - 10, ir = r * 0.62;
    var cx = size / 2, cy = size / 2;
    var total = U.sum(arr, function (i) { return Number(i.amount) || 0; });
    var children = [];
    if (!arr.length || total <= 0) {
      children.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--c-border)" stroke-width="' + (r - ir) + '"></circle>');
    } else {
      var start = -Math.PI / 2;
      arr.forEach(function (it) {
        var frac = (Number(it.amount) || 0) / total;
        var end = start + frac * Math.PI * 2;
        var large = frac > 0.5 ? 1 : 0;
        var x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
        var x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
        var x3 = cx + ir * Math.cos(end), y3 = cy + ir * Math.sin(end);
        var x4 = cx + ir * Math.cos(start), y4 = cy + ir * Math.sin(start);
        var d = 'M' + U.round(x1, 2) + ',' + U.round(y1, 2) +
          ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + U.round(x2, 2) + ',' + U.round(y2, 2) +
          ' L' + U.round(x3, 2) + ',' + U.round(y3, 2) +
          ' A' + ir + ',' + ir + ' 0 ' + large + ' 0 ' + U.round(x4, 2) + ',' + U.round(y4, 2) + ' Z';
        children.push('<path d="' + d + '" fill="' + (it.color || 'var(--c-primary)') + '"></path>');
        start = end;
      });
    }
    if (opts.centerLabel || opts.centerValue) {
      children.push('<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="15" font-weight="700" fill="var(--c-text)">' + U.escapeHtml(opts.centerValue || '') + '</text>');
      children.push('<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="9" fill="var(--c-muted)">' + U.escapeHtml(opts.centerLabel || '') + '</text>');
    }
    return svg({ viewBox: '0 0 ' + size + ' ' + size, class: 'svg-chart svg-donut', width: size, height: size }, children);
  };

  UI.legend = function (items) {
    return el('div', { class: 'legend' }, (items || []).map(function (it) {
      return el('div', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: { background: it.color || 'var(--c-primary)' } }),
        el('span', { class: 'legend-label', text: it.label }),
        el('span', { class: 'legend-value', text: it.valueText || U.fmtMoney(it.amount) })
      ]);
    }));
  };

  // شريط تقدم أفقي بسيط
  UI.hbar = function (pct, opts) {
    opts = opts || {};
    return el('div', { class: 'hbar' }, [
      el('div', { class: 'hbar-fill', style: { width: U.clamp(pct, 0, 100) + '%', background: opts.color || 'var(--c-primary)' } })
    ]);
  };

  /* ============================================================== النوافذ */

  UI.modal = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = el('div', { class: 'modal-overlay', role: 'dialog', 'aria-modal': 'true' });
      var closed = false;
      function close(result) {
        if (closed) return;
        closed = true;
        overlay.classList.remove('is-open');
        setTimeout(function () { detach(overlay); }, 180);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) { if (e.key === 'Escape') close(null); }
      var bodyNode = el('div', { class: 'modal-body' });
      if (typeof opts.body === 'string') bodyNode.innerHTML = opts.body;
      else if (opts.body) bodyNode.appendChild(opts.body);

      var actions = el('div', { class: 'modal-actions' });
      var form = el('form', { class: 'modal-form', onSubmit: function (e) { e.preventDefault(); if (opts.onSubmit) { var res = opts.onSubmit(); if (res && res.ok === false) return; } close('submit'); } });
      (opts.actions || [{ label: 'إغلاق', tone: 'ghost' }]).forEach(function (a) {
        actions.appendChild(el('button', {
          type: a.type || 'button',
          class: 'btn btn-' + (a.tone || 'primary'),
          text: a.label,
          onClick: function () {
            if (a.onClick) { var r = a.onClick(); if (r === false) return; }
            if (a.close !== false) close(a.value !== undefined ? a.value : a.label);
          }
        }));
      });
      form.appendChild(bodyNode);
      form.appendChild(actions);
      var card = el('div', { class: 'modal' + (opts.wide ? ' modal-wide' : '') }, [
        el('div', { class: 'modal-head' }, [
          el('h3', { class: 'modal-title', text: opts.title || '' }),
          UI.iconBtn('close', 'إغلاق', function () { close(null); })
        ]),
        form
      ]);
      overlay.appendChild(card);
      overlay.addEventListener('click', function (e) { if (e.target === overlay && opts.dismissable !== false) close(null); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.classList.add('is-open'); });
      if (opts.onMount) opts.onMount(card, close);
      var first = card.querySelector('input,select,textarea,button');
      if (first && opts.focus !== false) setTimeout(function () { try { first.focus(); } catch (e) {} }, 60);
    });
  };

  UI.toast = function (message, tone, ms) {
    var host = document.getElementById('toasts');
    if (!host) {
      host = el('div', { id: 'toasts', class: 'toasts' });
      document.body.appendChild(host);
    }
    var toneName = tone || 'info';
    var toastIco = toneName === 'danger' ? 'alert' : toneName === 'success' ? 'checkCircle' : 'info';
    var node = el('div', { class: 'toast toast-' + toneName }, [
      Fin.I ? Fin.I.el(toastIco, { size: 18 }) : null,
      el('span', { text: message })
    ]);
    host.appendChild(node);
    setTimeout(function () { node.classList.add('is-out'); setTimeout(function () { detach(node); }, 250); }, ms || 2600);
    return node;
  };

  UI.confirm = function (message, opts) {
    opts = opts || {};
    return UI.modal({
      title: opts.title || 'تأكيد',
      body: el('p', { class: 'modal-text', text: message }),
      actions: [
        { label: opts.cancelLabel || 'إلغاء', tone: 'ghost', value: false },
        { label: opts.okLabel || 'تأكيد', tone: opts.tone || 'danger', value: true }
      ]
    }).then(function (r) { return r === true; });
  };

  /* =============================================================== النماذج */

  // fields: [{name,label,type,value,options,required,min,max,step,placeholder,hint,span}]
  UI.form = function (fields, opts) {
    opts = opts || {};
    var values = Object.assign({}, opts.values || {});
    var inputs = {};
    var node = el('div', { class: 'form' });

    (fields || []).forEach(function (f) {
      if (f.type === 'hidden') { inputs[f.name] = { value: values[f.name] }; return; }
      var id = 'f-' + f.name + '-' + U.uid('').slice(-4);
      var input;
      var val = values[f.name] !== undefined ? values[f.name] : (f.value !== undefined ? f.value : '');
      if (f.type === 'select') {
        input = el('select', { id: id, class: 'input', name: f.name });
        (f.options || []).forEach(function (o) {
          var opt = el('option', { value: o.value, text: o.label });
          if (String(o.value) === String(val)) opt.selected = true;
          input.appendChild(opt);
        });
      } else if (f.type === 'textarea') {
        input = el('textarea', { id: id, class: 'input', name: f.name, rows: f.rows || 3, placeholder: f.placeholder || '' });
        input.value = val === undefined || val === null ? '' : val;
      } else if (f.type === 'checkbox') {
        input = el('input', { id: id, class: 'switch-input', type: 'checkbox', name: f.name });
        input.checked = !!val;
      } else if (f.type === 'money') {
        input = el('input', { id: id, class: 'input input-money', type: 'text', inputmode: 'decimal', name: f.name, placeholder: f.placeholder || '0', autocomplete: 'off' });
        input.value = (val === '' || val === null || val === undefined) ? '' : U.fmtMoneyPlain(val);
        input.addEventListener('input', function () {
          var caretEnd = input.selectionStart === input.value.length;
          var clean = input.value.replace(/[^\d.,٠-٩]/g, '');
          if (clean !== input.value) {
            input.value = clean;
            if (caretEnd) input.setSelectionRange(input.value.length, input.value.length);
          }
        });
        input.addEventListener('blur', function () {
          var n = U.toNumber(input.value);
          input.value = input.value === '' ? '' : U.fmtMoneyPlain(n);
        });
      } else {
        input = el('input', { id: id, class: 'input', type: f.type || 'text', name: f.name, placeholder: f.placeholder || '', autocomplete: f.autocomplete || 'off' });
        input.value = val === undefined || val === null ? '' : val;
        if (f.type === 'date' && !val) input.value = U.todayISO();
        if (f.min !== undefined) input.setAttribute('min', f.min);
        if (f.max !== undefined) input.setAttribute('max', f.max);
        if (f.step !== undefined) input.setAttribute('step', f.step);
      }
      if (f.required) input.required = true;
      inputs[f.name] = input;

      var labelNode = f.label ? el('label', { class: 'field-label', for: id, text: f.label }) : null;
      var wrap = el('div', { class: 'field' + (f.span === 2 ? ' span-2' : '') + (f.type === 'checkbox' ? ' field-switch' : '') }, [
        labelNode,
        f.type === 'checkbox'
          ? el('label', { class: 'switch', for: id }, [input, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])])
          : input,
        f.hint ? el('div', { class: 'field-hint', text: f.hint }) : null
      ]);
      node.appendChild(wrap);
    });

    function getValues() {
      var out = {};
      Object.keys(inputs).forEach(function (name) {
        var input = inputs[name];
        if (!input || !input.tagName) { out[name] = input ? input.value : undefined; return; }
        if (input.type === 'checkbox') out[name] = input.checked;
        else if (input.classList && input.classList.contains('input-money')) out[name] = U.toNumber(input.value);
        else out[name] = input.value;
      });
      Object.keys(values).forEach(function (k) { if (out[k] === undefined) out[k] = values[k]; });
      return out;
    }

    function validate() {
      var errors = [];
      (fields || []).forEach(function (f) {
        if (!f.required) return;
        var v = getValues()[f.name];
        if (v === '' || v === null || v === undefined || (f.type === 'money' && !(Number(v) > 0))) {
          errors.push(f.label || f.name);
        }
      });
      return { ok: errors.length === 0, errors: errors };
    }

    function setValue(name, v) {
      var input = inputs[name];
      if (!input || !input.tagName) return;
      if (input.type === 'checkbox') input.checked = !!v;
      else if (input.classList && input.classList.contains('input-money')) input.value = U.fmtMoneyPlain(v);
      else input.value = v;
    }

    return { el: node, getValues: getValues, validate: validate, inputs: inputs, setValue: setValue };
  };

  UI.field = function (label, control, hint) {
    return el('div', { class: 'field' }, [
      label ? el('label', { class: 'field-label', text: label }) : null,
      control,
      hint ? el('div', { class: 'field-hint', text: hint }) : null
    ]);
  };

  /* ============================================================== شرائح الفلترة */

  // ranges: [{key,label,from,to}]
  UI.rangeTabs = function (ranges, activeKey, onPick) {
    return el('div', { class: 'tabs tabs-scroll' }, (ranges || []).map(function (r) {
      return el('button', {
        type: 'button',
        class: 'tab' + (r.key === activeKey ? ' is-active' : ''),
        text: r.label,
        onClick: function () { onPick(r); }
      });
    }));
  };

  UI.standardRanges = function (asOfISO) {
    var asOf = asOfISO || U.todayISO();
    var m = U.monthRange(asOf);
    var lastMonthEnd = U.addDays(m.from, -1);
    var lm = U.monthRange(lastMonthEnd);
    var q = U.quarterRange(asOf);
    var y = U.startOfYear(asOf);
    return [
      { key: 'today', label: 'اليوم', from: asOf, to: asOf },
      { key: 'week', label: 'آخر 7 أيام', from: U.addDays(asOf, -6), to: asOf },
      { key: 'month', label: 'هذا الشهر', from: m.from, to: asOf },
      { key: 'lastMonth', label: 'الشهر الماضي', from: lm.from, to: lm.to },
      { key: 'quarter', label: 'هذا الربع', from: q.from, to: asOf },
      { key: 'year', label: 'هذه السنة', from: y, to: asOf },
      { key: 'all', label: 'الكل', from: '0000-01-01', to: '9999-12-31' }
    ];
  };

  /* ============================================================ أدوات أخرى */

  UI.kv = function (label, value, opts) {
    opts = opts || {};
    return el('div', { class: 'kv' + (opts.className ? ' ' + opts.className : '') }, [
      el('span', { class: 'kv-key', text: label }),
      el('span', { class: 'kv-val ' + (opts.valueClass || ''), text: value })
    ]);
  };

  UI.alertBox = function (alert) {
    var I = Fin.I;
    var level = alert.level || 'info';
    var fallback = level === 'danger' ? 'alert' : level === 'warn' ? 'hourglass' : 'info';
    var icoName = I && I.has(alert.icon) ? alert.icon : fallback;
    return el('div', { class: 'alert alert-' + level }, [
      el('div', { class: 'alert-ico' }, [I ? I.el(icoName, { size: 15, width: 2 }) : null]),
      el('div', { class: 'alert-main' }, [
        el('div', { class: 'alert-title', text: alert.title || '' }),
        alert.body ? el('div', { class: 'alert-body', text: alert.body }) : null
      ]),
      alert.onClick ? el('button', { type: 'button', class: 'icon-btn', text: '›', onClick: alert.onClick }) : null
    ]);
  };

  UI.chargeRow = function (item, opts) {
    opts = opts || {};
    var I = Fin.I;
    var tone = item.daysLate > 0 ? 'loss' : item.status === 'partial' ? 'warn' : 'info';
    return el('div', { class: 'charge-row charge-' + (item.daysLate > 0 ? 'late' : item.status) }, [
      el('div', { class: 'charge-ico' }, [I ? I.el(I.forLocation(item.locationId), { size: 22, tone: 'brand' }) : null]),
      el('div', { class: 'charge-main' }, [
        el('div', { class: 'charge-title', text: item.label }),
        el('div', { class: 'charge-meta', text: item.periodLabel + ' · استحقاق ' + U.dateLabel(item.dueDate, 'short') + (item.daysLate > 0 ? ' · متأخر ' + item.daysLate + ' يوم' : '') })
      ]),
      el('div', { class: 'charge-side' }, [
        UI.amountBlock(item.remaining, true, { arrow: false }),
        UI.badge(item.status === 'partial' ? 'جزئي' : 'لم يُحصَّل', tone),
        opts.onCollect ? UI.btn('تحصيل', { tone: 'primary', size: 'sm', onClick: function () { opts.onCollect(item); } }) : null
      ])
    ]);
  };

  UI.iconBtn = function (icon, title, onClick) {
    var btn = el('button', { type: 'button', class: 'icon-btn', title: title, onClick: onClick });
    if (Fin.I) btn.appendChild(Fin.I.el(Fin.I.has(icon) ? icon : 'list', { size: 18 }));
    else btn.textContent = icon;
    return btn;
  };

  UI.btn = function (label, opts) {
    opts = opts || {};
    var btn = el('button', {
      type: opts.type || 'button',
      class: 'btn btn-' + (opts.tone || 'primary') + (opts.size ? ' btn-' + opts.size : '') + (opts.className ? ' ' + opts.className : ''),
      onClick: opts.onClick || null,
      disabled: !!opts.disabled,
      title: opts.title || null
    });
    if (opts.icon && Fin.I) btn.appendChild(Fin.I.el(opts.icon, { size: opts.size === 'sm' ? 16 : 18 }));
    btn.appendChild(el('span', { text: label }));
    return btn;
  };
})();
