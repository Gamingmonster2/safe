/* =============================================================================
 * مصروفي — views/agent.js
 * تبويب «المساعد»: يسجّل شاشة #/agent وينادي Fin.Agent.mount داخل الحاوية.
 * الشاشة هنا تفصل الراوتر عن وحدة الوكيل، فإن غابت agent.js لا ينكسر التطبيق.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var U = Fin.U, UI = Fin.UI;
  Fin.Views = Fin.Views || {};

  function agent() { return Fin.Agent || null; }

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

  Fin.Views.agent = {
    id: 'agent',
    title: 'المساعد',
    icon: 'robot',
    order: 6,
    subtitle: 'اسأل عن أموالك بالكتابة أو الصوت',

    render: function (rootEl, ctx) {
      var A = agent();

      if (!A || typeof A.mount !== 'function') {
        rootEl.appendChild(emptyBox(
          'robot',
          'وحدة المساعد غير محمّلة',
          'لم يتم تحميل assets/js/agent.js. تحقق من وجود الملف وترتيب السكربتات في index.html ثم أعد التحميل.'
        ));
        return;
      }

      var host = U.el('div', { class: 'agent-host' });
      rootEl.appendChild(host);
      try {
        A.mount(host);
      } catch (e) {
        console.error('[agent view] فشل تركيب الواجهة', e);
        U.clear(host);
        host.appendChild(emptyBox('alert', 'تعذّر تشغيل المساعد', String(e && e.message || e)));
      }
    },

    destroy: function () {
      var A = agent();
      if (A && typeof A.silence === 'function') {
        try { A.silence(); } catch (e) { /* تجاهل */ }
      }
      if (A && typeof A.unmount === 'function') {
        try { A.unmount(); } catch (e) { /* تجاهل */ }
      }
    }
  };
})();
