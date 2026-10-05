/* =============================================================================
 * مصروفي — util.js
 * أدوات التاريخ (بتوقيت ليبيا)، الأرقام، DOM، والتنزيل. لا منطق مالي هنا.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C;
  var U = {};
  Fin.U = U;

  /* ------------------------------------------------------------------ التواريخ */

  // تاريخ ISO (YYYY-MM-DD) لتوقيت ليبيا — لا نستعمل toISOString لأنه UTC
  U.isoOf = function (date) {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: C.TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date || new Date());
      var o = {};
      parts.forEach(function (p) { o[p.type] = p.value; });
      if (o.year && o.month && o.day) return o.year + '-' + o.month + '-' + o.day;
    } catch (e) { /* متصفح قديم */ }
    var d = date || new Date();
    var mm = String(d.getMonth() + 1); if (mm.length < 2) mm = '0' + mm;
    var dd = String(d.getDate()); if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
  };

  U.todayISO = function () { return U.isoOf(new Date()); };
  U.today = function () { return U.todayISO(); };
  U.nowISO = function () { return U.todayISO(); };

  U.parseISO = function (iso) {
    if (!iso) return null;
    var s = String(iso).slice(0, 10);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  };
  U.toISO = function (date) { return U.isoOf(date); };
  U.isValidISO = function (iso) { return !!U.parseISO(iso); };

  U.addDays = function (iso, n) {
    var d = U.parseISO(iso) || U.parseISO(U.todayISO());
    d.setUTCDate(d.getUTCDate() + (Number(n) || 0));
    return U.isoOf(d);
  };
  U.addMonths = function (iso, n) {
    var d = U.parseISO(iso) || U.parseISO(U.todayISO());
    var day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (Number(n) || 0));
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return U.isoOf(d);
  };
  U.startOfMonth = function (iso) { return String(iso || U.todayISO()).slice(0, 7) + '-01'; };
  U.endOfMonth = function (iso) {
    var y = +String(iso).slice(0, 4), m = +String(iso).slice(5, 7);
    var last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
    return String(iso).slice(0, 7) + '-' + (last < 10 ? '0' + last : last);
  };
  U.startOfYear = function (iso) { return String(iso).slice(0, 4) + '-01-01'; };
  U.endOfYear = function (iso) { return String(iso).slice(0, 4) + '-12-31'; };

  U.monthKey = function (iso) { return String(iso || U.todayISO()).slice(0, 7); };
  U.dayOfMonth = function (iso) { return +String(iso).slice(8, 10); };
  U.quarterOf = function (iso) { return Math.floor((+String(iso).slice(5, 7) - 1) / 3) + 1; };
  U.quarterKey = function (iso) { return String(iso).slice(0, 4) + '-Q' + U.quarterOf(iso); };
  U.quarterStartMonth = function (iso) { return (U.quarterOf(iso) - 1) * 3 + 1; };

  U.quarterRange = function (iso) {
    var y = +String(iso).slice(0, 4);
    var startMonth = U.quarterStartMonth(iso);
    var from = y + '-' + pad2(startMonth) + '-01';
    var to = U.endOfMonth(y + '-' + pad2(startMonth + 2) + '-01');
    return { from: from, to: to, key: U.quarterKey(iso) };
  };
  U.monthRange = function (iso) {
    return { from: U.startOfMonth(iso), to: U.endOfMonth(iso), key: U.monthKey(iso) };
  };
  U.rangeOfPeriod = function (periodKey) {
    if (!periodKey) return null;
    if (/-Q[1-4]$/.test(periodKey)) {
      var y = +periodKey.slice(0, 4), q = +periodKey.slice(6);
      var sm = (q - 1) * 3 + 1;
      return { from: y + '-' + pad2(sm) + '-01', to: U.endOfMonth(y + '-' + pad2(sm + 2) + '-01'), key: periodKey };
    }
    if (/^\d{4}-\d{2}$/.test(periodKey)) return U.monthRange(periodKey + '-01');
    if (/^\d{4}$/.test(periodKey)) return { from: periodKey + '-01-01', to: periodKey + '-12-31', key: periodKey };
    return null;
  };
  U.daysBetween = function (a, b) {
    var da = U.parseISO(a), db = U.parseISO(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  };
  U.rangeDays = function (from, to) {
    var out = [], d = from, guard = 0;
    if (U.daysBetween(from, to) < 0) return out;
    while (d <= to && guard++ < 3000) { out.push(d); d = U.addDays(d, 1); }
    return out;
  };
  U.lastNDays = function (n, endISO) {
    var end = endISO || U.todayISO();
    return U.rangeDays(U.addDays(end, -(Math.max(1, n) - 1)), end);
  };
  U.nMonthsEnding = function (n, endISO) {
    var end = endISO || U.todayISO(), out = [], i;
    for (i = n - 1; i >= 0; i--) {
      var iso = U.addMonths(end, -i);
      out.push(U.monthRange(iso));
    }
    return out;
  };
  U.monthName = function (m) {
    return ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][m - 1] || '';
  };
  U.monthLabel = function (isoOrKey) {
    if (!isoOrKey) return '';
    var s = String(isoOrKey);
    if (/^\d{4}-\d{2}$/.test(s)) s = s + '-01';
    var y = s.slice(0, 4), m = +s.slice(5, 7);
    return U.monthName(m) + ' ' + y;
  };
  U.periodLabel = function (periodKey) {
    if (!periodKey) return '';
    var s = String(periodKey);
    if (/-Q([1-4])$/.test(s)) {
      var q = +s.slice(6), y = s.slice(0, 4);
      var months = [1, 2, 3].map(function (i) { return U.monthName((q - 1) * 3 + i); }).join(' + ');
      return 'الربع ' + q + ' ' + y + ' (' + months + ')';
    }
    if (/^\d{4}-\d{2}$/.test(s)) return U.monthLabel(s);
    return s;
  };
  U.dateLabel = function (iso, style) {
    var s = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var y = s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    var wd = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    var dt = U.parseISO(s);
    var dayName = dt ? wd[dt.getUTCDay()] : '';
    if (style === 'short') return d + ' ' + U.monthName(m);
    if (style === 'weekday') return dayName + ' ' + d + ' ' + U.monthName(m);
    if (style === 'iso') return s;
    return dayName + '، ' + d + ' ' + U.monthName(m) + ' ' + y;
  };
  U.fmtDate = U.dateLabel;
  U.relativeDay = function (iso, baseISO) {
    var base = baseISO || U.todayISO();
    var diff = U.daysBetween(iso, base); // موجب = في الماضي
    if (diff === 0) return 'اليوم';
    if (diff === 1) return 'أمس';
    if (diff === 2) return 'أول أمس';
    if (diff === -1) return 'غداً';
    if (diff === -2) return 'بعد غد';
    if (diff > 0 && diff < 30) return 'قبل ' + diff + ' يوم';
    if (diff < 0 && diff > -30) return 'بعد ' + Math.abs(diff) + ' يوم';
    return U.dateLabel(iso, 'short');
  };
  U.daysLate = function (dueISO, asOfISO) {
    var d = U.daysBetween(dueISO, asOfISO || U.todayISO());
    return d > 0 ? d : 0;
  };

  /* -------------------------------------------------------------------- الأرقام */
  U.round = function (n, digits) {
    var f = Math.pow(10, digits || 0);
    return Math.round((Number(n) || 0) * f) / f;
  };
  U.round1 = function (n) { return U.round(n, 1); };
  U.clamp = function (n, lo, hi) { return Math.min(hi, Math.max(lo, Number(n) || 0)); };
  U.isNum = function (n) { return typeof n === 'number' && isFinite(n); };

  U.fmtNumber = function (n, digits) {
    var d = (digits === undefined) ? (Math.abs(n % 1) > 0.001 ? 1 : 0) : digits;
    var s = (Number(n) || 0).toFixed(d);
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var parts = s.split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + int + (parts[1] ? '.' + parts[1] : '');
  };
  U.fmtMoneyPlain = function (n, digits) { return U.fmtNumber(n, digits); };
  U.fmtMoney = function (n, opts) {
    opts = opts || {};
    var v = Number(n) || 0;
    var body = U.fmtNumber(Math.abs(v), opts.digits);
    var sign = '';
    if (opts.sign && v > 0) sign = '+';
    if (v < 0) sign = '−';
    var tail = (opts.currency === false) ? '' : ' ' + (opts.currencyLabel || C.CURRENCY_LABEL);
    return sign + body + tail;
  };
  U.fmtCompact = function (n) {
    var v = Math.abs(Number(n) || 0);
    if (v >= 1000000) return U.fmtNumber(v / 1000000, 1) + 'M';
    if (v >= 10000) return U.fmtNumber(v / 1000, 1) + 'K';
    return U.fmtNumber(v, 0);
  };
  U.fmtPct = function (n, digits) { return U.fmtNumber(n || 0, digits === undefined ? 0 : digits) + '%'; };
  U.toNumber = function (v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return 0;
    var s = String(v).replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[,\s٬]/g, '').replace(/[٫]/g, '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  };
  U.pct = function (part, whole) {
    if (!whole) return 0;
    return U.round((Number(part) || 0) / whole * 100, 1);
  };

  /* ---------------------------------------------------------------------- DOM */
  U.$ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  U.$$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  U.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class' || k === 'className') { node.className = v; return; }
        if (k === 'text') { node.textContent = v; return; }
        if (k === 'html') { node.innerHTML = v; return; }
        if (k === 'dataset') { Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; }); return; }
        if (k === 'style' && typeof v === 'object') { Object.keys(v).forEach(function (s) { node.style[s] = v[s]; }); return; }
        if (k.indexOf('on') === 0 && typeof v === 'function') { node.addEventListener(k.slice(2).toLowerCase(), v); return; }
        node.setAttribute(k, v === true ? '' : v);
      });
    }
    U.append(node, children);
    return node;
  };
  U.append = function (node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) { children.forEach(function (c) { U.append(node, c); }); return node; }
    if (children instanceof Node) { node.appendChild(children); return node; }
    node.appendChild(document.createTextNode(String(children)));
    return node;
  };
  U.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };
  U.escapeHtml = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  U.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    try {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      return Promise.resolve(true);
    } catch (e) { return Promise.resolve(false); }
  };
  U.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  };
  U.readFile = function (file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file, 'utf-8');
    });
  };
  U.debounce = function (fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
    };
  };
  U.throttle = function (fn, ms) {
    var last = 0, timer = null;
    return function () {
      var args = arguments, self = this, now = Date.now();
      if (now - last >= (ms || 200)) { last = now; fn.apply(self, args); }
      else if (!timer) {
        timer = setTimeout(function () { timer = null; last = Date.now(); fn.apply(self, args); }, (ms || 200) - (now - last));
      }
    };
  };

  /* ------------------------------------------------------------------- مساعدات */
  U.uid = function (prefix) {
    var t = Date.now().toString(36);
    var r = Math.random().toString(36).slice(2, 8);
    return (prefix ? prefix + '-' : '') + t + r;
  };
  U.sum = function (arr, fn) {
    if (!arr) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += Number(fn ? fn(arr[i], i) : arr[i]) || 0;
    return U.round(s, 2);
  };
  U.groupBy = function (arr, fn) {
    var out = {};
    (arr || []).forEach(function (item, i) {
      var k = fn(item, i);
      if (!out[k]) out[k] = [];
      out[k].push(item);
    });
    return out;
  };
  U.sortBy = function (arr, fn, dir) {
    var d = dir === 'desc' ? -1 : 1;
    return (arr || []).slice().sort(function (a, b) {
      var va = fn(a), vb = fn(b);
      if (va < vb) return -1 * d;
      if (va > vb) return 1 * d;
      return 0;
    });
  };
  U.unique = function (arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  };
  U.hashCode = function (s) {
    var h = 0, str = String(s || '');
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  };
  U.isRTLText = function (s) { return /[\u0600-\u06FF]/.test(String(s || '')); };
  U.slug = function (s) {
    return String(s || '').trim().toLowerCase()
      .replace(/[\s\/\\]+/g, '-').replace(/[^\w\u0600-\u06FF-]/g, '').replace(/-+/g, '-').slice(0, 60);
  };
  U.deepClone = function (o) { return JSON.parse(JSON.stringify(o)); };
  U.pick = function (obj, keys) {
    var out = {};
    keys.forEach(function (k) { if (obj && obj[k] !== undefined) out[k] = obj[k]; });
    return out;
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  U.pad2 = pad2;
})();
