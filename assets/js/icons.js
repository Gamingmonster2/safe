/* =============================================================================
 * مصروفي — icons.js
 * نظام أيقونات SVG احترافي (بلا مكتبات ولا خطوط خارجية — يعمل أوفلاين).
 * كل الأيقونات بخط واحد (stroke) بمقاس 24 وتُلوَّن بـ currentColor.
 *   Fin.I.svg(name, opts)   → نص SVG جاهز للإدراج في حاوية موثوقة
 *   Fin.I.el(name, opts)    → عنصر HTMLElement جاهز
 *   Fin.I.has(name)         → هل الأيقونة موجودة
 *   Fin.I.forCategory(key, type) / Fin.I.forLocation(id) / Fin.I.forDomain(tld)
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var I = {};
  Fin.I = I;
  Fin.Icons = I;

  /* مسارات الأيقونات: كل قيمة = محتوى <svg> (مسارات بخط stroke) */
  var P = {
    /* ---- تنقل عام ---- */
    home: '<path d="M4 10.5 12 3.5l8 7"/><path d="M6 9.8V20h12V9.8"/><path d="M10 20v-5h4v5"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M21 9h-4.5a2.5 2.5 0 0 0 0 5H21z"/>',
    bank: '<path d="M4 10h16"/><path d="M12 3.5 20 8H4z"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/><path d="M3 20h18"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-6M12 16V7M16 16v-4"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.5 3.8 5.4 3.8 8.5S14.5 18 12 20.5C9.5 18 8.2 15.1 8.2 12S9.5 6 12 3.5z"/>',
    settings: '<circle cx="12" cy="12" r="2.8"/><path d="M12 3.5v2M12 18.5v2M4.9 7.5l1.7 1M17.4 15.5l1.7 1M4.9 16.5l1.7-1M17.4 8.5l1.7-1"/>',
    assistant: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3.5V7"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M2.5 12v3M21.5 12v3"/>',

    /* ---- أموال ---- */
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
    creditCard: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h3"/>',
    coins: '<ellipse cx="9" cy="7" rx="5.5" ry="2.6"/><path d="M3.5 7v4c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6V7"/><path d="M14.5 10.6c2.6.3 4.6 1.4 4.6 2.6 0 1.4-2.5 2.6-5.5 2.6-1.6 0-3-.3-4-.8"/>',
    piggy: '<path d="M4 13.5c0-3 2.9-5.5 6.5-5.5S17 10.5 17 13.5c0 2.2-1.6 4.4-4 5.2V21h-4v-1.6c-2.9-.6-5-3-5-5.9z"/><path d="M16 8.4 19 5v4"/><circle cx="9" cy="12.5" r="0.9"/><path d="M4.5 12.5H3"/>',

    /* ---- اتجاه الأموال: صعود/هبوط (PayPal style) ---- */
    arrowUp: '<path d="M12 19V5"/><path d="M6.5 10.5 12 5l5.5 5.5"/>',
    arrowDown: '<path d="M12 5v14"/><path d="M6.5 13.5 12 19l5.5-5.5"/>',
    trendUp: '<path d="M3.5 16.5 9.5 10.5l3.5 3.5 7-7"/><path d="M15 7h5v5"/>',
    trendDown: '<path d="M3.5 7.5 9.5 13.5l3.5-3.5 7 7"/><path d="M15 17h5v-5"/>',
    swap: '<path d="M7 4.5 3.5 8 7 11.5"/><path d="M3.5 8h13a3 3 0 0 1 0 6H13"/><path d="M17 19.5 20.5 16 17 12.5"/>',
    transfer: '<path d="M4 8.5h13l-3-3"/><path d="M20 15.5H7l3 3"/>',
    plus: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
    minus: '<path d="M5.5 12h13"/>',
    equals: '<path d="M6 9.5h12M6 14.5h12"/>',

    /* ---- فئات المصروفات ---- */
    cart: '<circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M3 4h2.2l2.3 10.2h10.3L20 7.5H6.2"/>',
    leaf: '<path d="M5 19c0-8 5.5-13 14-13 0 8-5 13.5-13 13.5H5z"/><path d="M5.5 19.5C9 16 12 13.8 15.5 12"/>',
    basket: '<path d="M3.5 9.5h17l-1.6 9a2 2 0 0 1-2 1.6H7.1a2 2 0 0 1-2-1.6z"/><path d="M8 9.5 11 4M16 9.5 13 4M9.5 13v4M14.5 13v4"/>',
    bread: '<path d="M5 10.5c0-2.5 3-4.5 7-4.5s7 2 7 4.5c0 1-.6 1.7-1.4 2l.4 6.5H6l.4-6.5C5.6 12.2 5 11.5 5 10.5z"/><path d="M9.5 12.5h5"/>',
    meat: '<path d="M8 4.5h8a4 4 0 0 1 0 8h-3l-5 7H5l3-5H6a3 3 0 0 1-3-3v-2a5 5 0 0 1 5-5z"/><circle cx="12" cy="8.5" r="1"/>',
    fuel: '<path d="M6 20V5.5A1.5 1.5 0 0 1 7.5 4h5A1.5 1.5 0 0 1 14 5.5V20"/><path d="M4.5 20h11"/><path d="M14 9h3.5a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 0 3 0v-5l-2-3"/><path d="M7 8h6"/>',
    car: '<path d="M4.5 13l1.6-4.4A2 2 0 0 1 8 7.2h8a2 2 0 0 1 1.9 1.4L19.5 13"/><rect x="3.5" y="13" width="17" height="5" rx="2"/><path d="M7 18v1.5M17 18v1.5"/>',
    coffee: '<path d="M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 9.5h1.8a2.2 2.2 0 0 1 0 4.4H16"/><path d="M4 21h13"/>',
    utensils: '<path d="M7 3v8a2.5 2.5 0 0 0 5 0V3"/><path d="M9.5 11v10"/><path d="M16.5 3c1.8 1 2.5 2.6 2.5 5s-.7 4-2.5 5v8"/>',
    shirt: '<path d="M8 4.5 4.5 7l2 3 1.5-1V20h8V9l1.5 1 2-3L16 4.5 12 7z"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
    pills: '<rect x="3.5" y="9" width="11" height="7" rx="3.5" transform="rotate(-35 9 12.5)"/><path d="M9 9.5l5 5"/>',
    school: '<path d="M3.5 9 12 4.5 20.5 9 12 13.5z"/><path d="M7 11v5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-5"/><path d="M20.5 9v6"/>',
    book: '<path d="M5 4.5h6a2.5 2.5 0 0 1 2.5 2.5V20a2 2 0 0 0-2-2H5z"/><path d="M19 4.5h-3.5A2.5 2.5 0 0 0 13 7v11a2 2 0 0 1 2-2h4z"/>',
    family: '<circle cx="8.5" cy="8" r="2.6"/><circle cx="16" cy="9" r="2.1"/><path d="M4 19v-1.5C4 15 6 13.5 8.5 13.5S13 15 13 17.5V19"/><path d="M14.5 19v-1c0-1.8 1-2.8 2.5-2.8s2.5 1 2.5 2.8v1"/>',
    tools: '<path d="M14.5 6.5a3.5 3.5 0 0 0 4.7 4.7L21 13l-8 8-2-2-6-6 1.8-1.8a3.5 3.5 0 0 0 4.7-4.7z"/><path d="M6.5 17.5 4 20"/>',
    wrench: '<path d="M15.5 3.5a4.5 4.5 0 0 0-3.8 7l-8 8 2.3 2.3 8-8a4.5 4.5 0 0 0 5.5-5.7l-2.6 2.6-2.2-.4-.4-2.2z"/>',
    helmet: '<path d="M4 15a8 8 0 0 1 16 0"/><path d="M3 15h18v2.5H3z"/><path d="M12 7v4"/>',
    building: '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20"/><path d="M15 10h2.5A1.5 1.5 0 0 1 19 11.5V20"/><path d="M3 20h18"/><path d="M8 8h4M8 12h4M8 16h4"/>',
    house: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
    store: '<path d="M4 9.5h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M3.5 9.5 5 4.5h14l1.5 5"/><path d="M9 20v-6h6v6"/>',
    bed: '<path d="M3 18v-8"/><path d="M3 12h13a4 4 0 0 1 4 4v2"/><path d="M3 18h18"/><circle cx="7.5" cy="9.5" r="1.6"/>',
    workshop: '<path d="M3 20V10l9-5.5L21 10v10"/><path d="M7 20v-6h5v6"/><path d="M15 20v-4h3v4"/>',
    handshake: '<path d="M3 12.5 7 8.5l3 1.5 2-2 2 2 3-1.5 4 4"/><path d="M7 8.5V15l2.5 2.5a1.5 1.5 0 0 0 2.1 0L14 15"/><path d="M21 12.5V15"/>',
    prayer: '<path d="M9 20V9.5a3 3 0 0 1 6 0V20"/><path d="M7 20h10"/><path d="M12 4v2"/>',
    globeDots: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.4 5.3 3.4 8.5S14.2 18.1 12 20.5C9.8 18.1 8.6 15.2 8.6 12S9.8 5.9 12 3.5z"/>',
    box: '<path d="M12 3.5 20 7.5v9L12 20.5 4 16.5v-9z"/><path d="M4 7.5 12 11.5l8-4"/><path d="M12 11.5v9"/>',
    package: '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M3.5 11h17"/><path d="M9 7V4.5h6V7"/>',
    tag: '<path d="M11 3.5H20v9l-8.5 8.5L3 12.5z"/><circle cx="16" cy="8" r="1.4"/>',

    /* ---- نطاقات ---- */
    server: '<rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M7 7.2h.01M7 16.7h.01"/>',
    link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 12.8 4.7a3.5 3.5 0 0 1 5 5L16 11.5"/><path d="M13 17.5 11.2 19.3a3.5 3.5 0 0 1-5-5L8 12.5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',

    /* ---- حالات وتنبيهات ---- */
    alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17.2h.01"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 8.2h.01"/>',
    check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3 11 14.8l4.5-5.3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    hourglass: '<path d="M7 3.5h10"/><path d="M7 20.5h10"/><path d="M8 3.5v3.2c0 2 4 3.3 4 5.3s-4 3.3-4 5.3v3.2"/><path d="M16 3.5v3.2c0 2-4 3.3-4 5.3s4 3.3 4 5.3v3.2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3.5V6M16 3.5V6"/>',
    calendarX: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17"/><path d="M9.5 13.5l5 5M14.5 13.5l-5 5"/>',
    bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5"/><path d="M5 16.5h14"/><path d="M10 19.5a2 2 0 0 0 4 0"/>',
    eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><path d="M12 14v2.5"/>',
    key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21"/><path d="M18 12v3M15 12v2"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20v-1.5C5 15.5 8 14 12 14s7 1.5 7 4.5V20"/>',
    users: '<circle cx="9.5" cy="8.5" r="3"/><path d="M3.5 19v-1c0-2.6 2.6-4 6-4s6 1.4 6 4v1"/><path d="M16 6.2a3 3 0 0 1 0 5.6"/><path d="M18 19v-1c0-1.6-.6-2.7-1.6-3.4"/>',
    robot: '<rect x="4" y="7.5" width="16" height="11" rx="3"/><path d="M12 3.5v4"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M2.5 12v2.5M21.5 12v2.5"/>',
    mic: '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
    volume: '<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/><path d="M17.5 7a7 7 0 0 1 0 10"/>',
    volumeOff: '<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z"/><path d="M15.5 10l4 4M19.5 10l-4 4"/>',
    download: '<path d="M12 4v10"/><path d="M8 10.5 12 14.5l4-4"/><path d="M5 19h14"/>',
    upload: '<path d="M12 14.5v-10"/><path d="M8 8.5 12 4.5l4 4"/><path d="M5 19h14"/>',
    file: '<path d="M6 3.5h7l5 5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M13 3.5V9h5"/><path d="M9 13h6M9 16.5h4"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/>',
    filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
    list: '<path d="M8 7h12M8 12h12M8 17h12"/><path d="M4 7h.01M4 12h.01M4 17h.01"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 12.5a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9L17.5 7"/><path d="M10.5 11v6M13.5 11v6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    chevronRight: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    chevronDown: '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
    external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M3 12h2M19 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
    sliders: '<path d="M4 8h9M17 8h3"/><path d="M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
    sparkles: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    shield: '<path d="M12 3.5 19 6v5.5c0 4-3 7.4-7 9-4-1.6-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    scale: '<path d="M12 4v16"/><path d="M7 20h10"/><path d="M4 8h16"/><path d="M4 8 6.5 14h-5z"/><path d="M20 8l2.5 6h-5z"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    flame: '<path d="M12 3.5c3 4 6 6 6 10a6 6 0 0 1-12 0c0-2 .8-3.4 2-4.5.3 1.5 1 2.3 2 2.5-.5-2.5 0-5.5 2-8z"/>',

    /* ---- إضافات احترافية ---- */
    printer: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 14h10v6H7z"/>',
    pin: '<path d="M12 21v-6"/><path d="M9 4h6l-1 6 2.5 2.5H7.5L10 10z"/>',
    calculator: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7"/><path d="M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-2.2 4.8L8 16l2.2-4.8z"/>',
    pieChart: '<path d="M12 4a8 8 0 1 0 8 8h-8z"/><path d="M12 4v8h8"/>',
    inbox: '<path d="M4 13 6.2 5.6A2 2 0 0 1 8.1 4h7.8a2 2 0 0 1 1.9 1.6L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13h4l1.5 2.5h5L16 13h4"/>',
    undo: '<path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="M8 5 4 9l4 4"/>',
    puzzle: '<path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h1.5a2 2 0 1 1 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3H4.5a2 2 0 1 1 0-4H6V7a1 1 0 0 1 1-1h3z"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>',
    map: '<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2z"/><path d="M9 4v14M15 6v14"/>',
    medal: '<circle cx="12" cy="14.5" r="5"/><path d="M8.5 9.5 6 3h12l-2.5 6.5"/><path d="M12 12.5v4"/>',
    ranking: '<path d="M4 20h4v-7H4z"/><path d="M10 20h4V8h-4z"/><path d="M16 20h4V4h-4z"/>',
    zap: '<path d="M13 3 5.5 13.5H11l-1 7.5 7.5-10.5H12z"/>'
  };

  var ALIAS = {
    expense: 'arrowDown',
    income: 'arrowUp',
    success: 'checkCircle',
    error: 'alert',
    warning: 'alert',
    info: 'info',
    money: 'coins',
    saving: 'piggy',
    savings: 'piggy',
    account: 'wallet',
    location: 'house',
    locationOther: 'plus',
    other: 'package',
    otherIncome: 'coins',
    daily: 'receipt'
  };

  /* ربط مفاتيح الفئات (EXPENSE_CATEGORIES / INCOME_CATEGORIES) بالأيقونات */
  var CATEGORY_ICON = {
    /* مصروفات */
    household: 'house', vegetables: 'leaf', groceries: 'basket', bakery: 'bread', meat: 'meat',
    fuel: 'fuel', transport: 'car', coffee_cigarettes: 'coffee', restaurant: 'utensils',
    clothes: 'shirt', phone_internet: 'phone', health: 'pills', school_tuition: 'school',
    school_books: 'book', family: 'family', maintenance: 'wrench', workshop_supplies: 'tools',
    workers: 'helmet', domain_hosting: 'globe', charity: 'prayer', family_support: 'handshake',
    debt_payment: 'arrowDown', other: 'package',
    /* إيرادات */
    rent_shop: 'store', rent_studio: 'house', rent_workshop: 'workshop', rent_rooms: 'bed',
    rent_other: 'building', family_income: 'family', online: 'globe', sale: 'tag',
    reimbursement: 'swap', gift: 'sparkles', other_income: 'coins'
  };

  var LOCATION_ICON = {
    shop: 'store', studio: 'house', workshops: 'workshop', mech: 'wrench', rooms: 'bed', other: 'plus'
  };

  var METHOD_ICON = { cash: 'cash', transfer: 'bank', card: 'creditCard', credit: 'receipt' };

  function normalize(name) {
    if (!name) return null;
    var key = ALIAS[name] || name;
    return P[key] ? key : null;
  }

  I.has = function (name) { return !!normalize(name); };
  I.names = function () { return Object.keys(P); };

  /* نص SVG — يُدرج فقط داخل حاويات موثوقة (U.el مع html=) */
  I.svg = function (name, opts) {
    opts = opts || {};
    var key = normalize(name) || 'box';
    var size = opts.size || 24;
    var sw = opts.width || 1.7;
    var cls = 'ic ic-' + key + (opts.className ? ' ' + opts.className : '');
    return '<svg class="' + cls + '" viewBox="0 0 24 24" width="' + size + '" height="' + size + '"' +
      ' fill="none" stroke="currentColor" stroke-width="' + sw + '"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + P[key] + '</svg>';
  };

  I.el = function (name, opts) {
    opts = opts || {};
    var span = document.createElement('span');
    span.className = 'ic-wrap' + (opts.className ? ' ' + opts.className : '');
    if (opts.tone) span.setAttribute('data-tone', opts.tone);
    span.appendChild(buildSvg(normalize(name) || 'box', opts));
    return span;
  };

  /* بناء عنصر <svg> بعناصر DOM مباشرة — بلا innerHTML إطلاقاً (أمان XSS).
     المُحلِّل يقرأ مسارات SVG الثابتة أعلاه فقط، ولا يلمس أي نص من المستخدم. */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var TAG_RE = /<([a-zA-Z]+)((?:\s+[a-zA-Z-]+\s*=\s*"[^"]*")*)\s*\/?>/g;
  var ATTR_RE = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
  var ALLOWED = { path: 1, circle: 1, rect: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1, g: 1, text: 1 };

  function safeAttr(name, value) {
    if (/^on/i.test(name)) return false;
    if (name === 'd') return /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,+-]+$/.test(value);
    if (name === 'points') return /^[0-9\s.,+-]+$/.test(value);
    if (name === 'transform') return /^[a-zA-Z()\s0-9.,+-]+$/.test(value);
    return /^[0-9a-zA-Z#%.,()\s+-]*$/.test(value);
  }

  function buildSvg(key, opts) {
    var node = document.createElementNS(SVG_NS, 'svg');
    node.setAttribute('class', 'ic ic-' + key + (opts.className ? ' ' + opts.className : ''));
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('width', String(opts.size || 24));
    node.setAttribute('height', String(opts.size || 24));
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', String(opts.width || 1.7));
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('focusable', 'false');

    var markup = P[key] || P.box;
    var tag;
    TAG_RE.lastIndex = 0;
    while ((tag = TAG_RE.exec(markup)) !== null) {
      var tagName = tag[1].toLowerCase();
      if (!ALLOWED[tagName]) continue;
      var child = document.createElementNS(SVG_NS, tagName);
      var attrs = tag[2] || '';
      var attr;
      ATTR_RE.lastIndex = 0;
      while ((attr = ATTR_RE.exec(attrs)) !== null) {
        if (!safeAttr(attr[1], attr[2])) continue;
        child.setAttribute(attr[1], attr[2]);
      }
      node.appendChild(child);
    }
    return node;
  }
  I.buildSvg = buildSvg;

  // اسم الأيقونة لفئة مالية
  I.forCategory = function (key, type) {
    if (CATEGORY_ICON[key]) return CATEGORY_ICON[key];
    var cat = (type === 'income' && Fin.C) ? Fin.C.catIncome(key) : (Fin.C ? Fin.C.catExpense(key) : null);
    if (cat && cat.icon && CATEGORY_ICON[cat.key]) return CATEGORY_ICON[cat.key];
    return type === 'income' ? 'coins' : 'package';
  };

  I.forLocation = function (id) { return LOCATION_ICON[id] || 'building'; };
  I.forMethod = function (key) { return METHOD_ICON[key] || 'cash'; };

  // نطاقات: أيقونة حسب نوع الامتداد
  I.forDomain = function (tld) {
    var t = String(tld || '').toLowerCase();
    if (t === 'ly' || t === 'com.ly' || t === 'org.ly') return 'globe';
    return 'server';
  };

  /* اتجاه المال: صعود = دخل (أخضر)، هبوط = مصروف (برتقالي) */
  I.direction = function (amountOrType) {
    var isIncome = (amountOrType === 'income') ||
      (typeof amountOrType === 'number' && amountOrType > 0);
    return {
      name: isIncome ? 'arrowUp' : 'arrowDown',
      tone: isIncome ? 'in' : 'out',
      label: isIncome ? 'دخل' : 'مصروف'
    };
  };

  I.PATHS = P;
})();
