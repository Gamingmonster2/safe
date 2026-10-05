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

  Fin.Views.agent = {
    id: 'agent',
    title: 'المساعد',
    icon: '🤖',
    order: 6,
    subtitle: 'اسأل عن أموالك بالكتابة أو الصوت',

    render: function (rootEl, ctx) {
      var A = agent();

      if (!A || typeof A.mount !== 'function') {
        rootEl.appendChild(UI.emptyState(
          '🤖',
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
        host.appendChild(UI.emptyState('💥', 'تعذّر تشغيل المساعد', String(e && e.message || e)));
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
