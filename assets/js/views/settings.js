/* =============================================================================
 * مصروفي — views/settings.js
 * الإعدادات: الوضع، الوكيل الذكي ومفتاح DeepSeek، النسخ الاحتياطي، البيانات.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U, UI = Fin.UI, Store = Fin.Store, F = Fin.Finance;
  Fin.Views = Fin.Views || {};

  function saveSettings(patch) { Store.updateSettings(patch); }

  /* --------------------------------------------------------- المظهر */

  function appearanceSection(state) {
    var current = state.settings.theme || 'dark';
    var labels = { dark: '🌙 ليلي', light: '☀️ نهاري', auto: '🖥️ تلقائي (حسب الجهاز)' };
    var chips = U.el('div', { class: 'tabs' }, C.THEMES.map(function (t) {
      return UI.chip(labels[t], {
        active: t === current,
        onClick: function () {
          saveSettings({ theme: t });
          UI.theme.apply(t);
          UI.toast('تم تغيير المظهر', 'success');
        }
      });
    }));
    return UI.section('المظهر', [chips]);
  }

  /* --------------------------------------------------------- الوكيل الذكي */

  function agentSection(state) {
    var agent = state.settings.agent || {};
    var hasKey = !!agent.apiKey;
    var form = UI.form([
      {
        name: 'apiKey', label: 'مفتاح DeepSeek API', type: 'password',
        placeholder: 'sk-…',
        hint: 'يُحفظ في هذا الجهاز فقط (localStorage) ولا يُرفع للمستودع أبداً. الصقه مرة واحدة ثم اضغط حفظ.'
      },
      {
        name: 'model', label: 'النموذج', type: 'select',
        options: [
          { value: 'deepseek-chat', label: 'deepseek-chat — سريع واقتصادي (مُستحسن)' },
          { value: 'deepseek-reasoner', label: 'deepseek-reasoner — تحليل أعمق وأبطأ' }
        ]
      },
      {
        name: 'voice', label: 'النطق الصوتي للردود (مُطفأ افتراضياً)',
        type: 'checkbox',
        hint: 'مُطفأ افتراضياً لأن التطبيق منظومة تسجيل. فعّله فقط إذا أردت أن يقرأ المساعد ردوده بصوت عالٍ.'
      },
      {
        name: 'voiceInput', label: 'زر الإدخال الصوتي 🎤 في شاشة المساعد',
        type: 'checkbox',
        hint: 'يتيح لك التكلّم بدل الكتابة (يحتاج دعم المتصفح). لا يُشغّل أي صوت.'
      }
    ], {
      values: {
        apiKey: agent.apiKey || '',
        model: agent.model || 'deepseek-chat',
        voice: agent.voice === true,
        voiceInput: agent.voiceInput !== false
      }
    });

    var status = U.el('div', { class: 'alert alert-' + (hasKey ? 'info' : 'warn') }, [
      U.el('div', { class: 'alert-ico', text: hasKey ? '✅' : '🔑' }),
      U.el('div', { class: 'alert-main' }, [
        U.el('div', { class: 'alert-title', text: hasKey ? 'المفتاح محفوظ ومفعّل' : 'لم تُضف مفتاحاً بعد' }),
        U.el('div', { class: 'alert-body', text: hasKey ? 'المساعد يجيب من DeepSeek مع أدوات تحليل بياناتك. وبدون إنترنت يعمل المحرّك المحلي، والتطبيق كله يعمل أوفلاين.' : 'بدون مفتاح يعمل المحرّك المحلي فقط (أرقامك وملخصاتك بلا إنترنت). المفتاح يضيف التحليل الذكي فقط — ولا علاقة له بالصوت.' })
      ])
    ]);

    var actions = U.el('div', { class: 'btn-row' }, [
      UI.btn('حفظ المفتاح والإعدادات', {
        tone: 'primary',
        onClick: function () {
          var v = form.getValues();
          var key = String(v.apiKey || '').trim();
          saveSettings({ agent: { apiKey: key, model: v.model, voice: v.voice === true, voiceInput: v.voiceInput !== false } });
          if (v.voice !== true && Fin.Agent && Fin.Agent.silence) Fin.Agent.silence();
          UI.toast(key ? 'تم حفظ المفتاح محلياً' : 'أُزيل المفتاح — المحرّك المحلي فقط', 'success');
          if (Fin.App) Fin.App.refresh();
        }
      }),
      UI.btn('اختبار المفتاح', {
        tone: 'ghost',
        onClick: function () {
          var v = form.getValues();
          var key = String(v.apiKey || '').trim();
          if (!key) { UI.toast('أدخل المفتاح أولاً', 'danger'); return; }
          if (!Fin.Agent || !Fin.Agent.testKey) { UI.toast('وحدة الوكيل غير محمّلة', 'danger'); return; }
          UI.toast('جارٍ الاختبار…', 'info');
          Fin.Agent.testKey(key, v.model).then(function (res) {
            UI.toast(res.ok ? 'المفتاح يعمل ✅' : 'فشل: ' + res.error, res.ok ? 'success' : 'danger', 5000);
          });
        }
      }),
      UI.btn('فتح المساعد', { tone: 'ghost', onClick: function () { if (Fin.App) Fin.App.go('agent'); } })
    ]);

    var voiceNote = UI.kv('دعم إدخال الصوت في هذا المتصفح', (Fin.Agent && Fin.Agent.hasVoice && Fin.Agent.hasVoice()) ? 'مدعوم ✅' : 'غير مدعوم في هذا المتصفح');
    var voiceState = UI.kv('حالة النطق الصوتي', agent.voice === true ? 'مفعّل (يقرأ الردود)' : 'مُطفأ — لن تسمع أي صوت');

    return UI.section('المساعد الذكي (اختياري)', [
      U.el('div', { class: 'muted', text: 'هذا التطبيق منظومة تسجيل: كل الحسابات والتقارير تعمل بلا مفتاح وبلا صوت. المساعد إضافة اختيارية للتحليل.' }),
      status,
      form.el,
      voiceState,
      voiceNote,
      actions,
      U.el('div', { class: 'muted', text: 'ملاحظة أمنية: أي مفتاح في الواجهة الأمامية يمكن استخراجه من الجهاز نفسه. لا تشارك رابط تطبيقك مع مفتاح محفوظ، وامسح المفتاح عند استخدام جهاز مستعار.' })
    ]);
  }

  /* ------------------------------------------------------ النسخ الاحتياطي */

  function backupSection(state) {
    var stats = Store.stats();

    var importInput = U.el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      if (!file) return;
      U.readFile(file).then(function (text) {
        UI.confirm('استيراد نسخة احتياطية سيستبدل كل البيانات الحالية. متابعة؟', { okLabel: 'استيراد', tone: 'danger' }).then(function (ok) {
          if (!ok) { importInput.value = ''; return; }
          var res = Store.importJSON(text);
          if (res.ok) { UI.toast('تم الاستيراد بنجاح', 'success'); if (Fin.App) Fin.App.refresh(); }
          else UI.toast(res.error, 'danger', 5000);
          importInput.value = '';
        });
      }).catch(function (e) { UI.toast('تعذّر قراءة الملف: ' + e.message, 'danger'); });
    });

    return UI.section('النسخ الاحتياطي والبيانات', [
      U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card-body' }, [
          UI.kv('عدد الحركات', String(stats.transactions)),
          UI.kv('الاستحقاقات', String(stats.charges)),
          UI.kv('سندات القبض', String(stats.receipts)),
          UI.kv('حجم البيانات', U.fmtNumber(stats.bytes / 1024, 1) + ' كيلوبايت'),
          UI.kv('آخر حفظ', Store.savedAt() ? U.dateLabel(String(Store.savedAt()).slice(0, 10), 'short') + ' ' + String(Store.savedAt()).slice(11, 16) : '—')
        ])
      ]),
      U.el('div', { class: 'btn-row' }, [
        UI.btn('⬇️ تصدير نسخة (JSON)', {
          tone: 'primary',
          onClick: function () {
            U.download('masrofi-backup-' + U.todayISO() + '.json', Store.exportJSON(), 'application/json;charset=utf-8');
            UI.toast('نُزّلت النسخة الاحتياطية', 'success');
          }
        }),
        UI.btn('⬆️ استيراد نسخة', { tone: 'ghost', onClick: function () { importInput.click(); } }),
        UI.btn('📄 تصدير Excel/CSV', {
          tone: 'ghost',
          onClick: function () {
            U.download('masrofi-' + U.todayISO() + '.csv', Store.exportCSV(), 'text/csv;charset=utf-8');
            UI.toast('نُزّل ملف CSV (يفتح في Excel)', 'success');
          }
        })
      ]),
      importInput,
      U.el('div', { class: 'muted', text: 'نصيحة: صدّر نسخة كل أسبوع واحفظها في مكان آمن (Google Drive أو بريدك). البيانات محفوظة في هذا المتصفح فقط؛ مسح بيانات المتصفح يمسحها.' })
    ]);
  }

  /* ------------------------------------------------------------ الدومين */

  function deploySection(state) {
    var form = UI.form([
      { name: 'domain', label: 'الدومين الخاص بك', type: 'text', placeholder: 'masrofi.org', hint: 'مثال: اسمك.org — يوضع في ملف CNAME بالمستودع' }
    ], { values: { domain: state.settings.domain || '' } });

    return UI.section('النشر والدومين', [
      form.el,
      U.el('div', { class: 'btn-row' }, [
        UI.btn('حفظ الدومين', {
          tone: 'primary',
          onClick: function () {
            var v = form.getValues();
            saveSettings({ domain: String(v.domain || '').trim() });
            UI.toast('تم الحفظ', 'success');
          }
        }),
        UI.btn('نسخ خطوات الرفع على GitHub', {
          tone: 'ghost',
          onClick: function () {
            var text = [
              'خطوات رفع «مصروفي» على GitHub Pages:',
              '1) أنشئ مستودعاً جديداً على GitHub (خاص أو عام).',
              '2) من مجلد المشروع: git init && git add . && git commit -m "مصروفي v' + C.VERSION + '"',
              '3) git branch -M main && git remote add origin https://github.com/<اسمك>/<المستودع>.git && git push -u origin main',
              '4) Settings ← Pages ← Source: GitHub Actions (الملف .github/workflows/deploy.yml جاهز).',
              '5) للدومين المخصص: ضع دومينك في ملف CNAME ثم أضف في مزوّد الدومين سجل CNAME يشير إلى <اسمك>.github.io',
              '6) بعد أول نشر: افتح الرابط على الجوال ← «إضافة إلى الشاشة الرئيسية» ليصبح تطبيقاً.'
            ].join('\n');
            U.copy(text).then(function (ok) { UI.toast(ok ? 'نُسخت الخطوات' : 'تعذّر النسخ', ok ? 'success' : 'danger'); });
          }
        })
      ]),
      U.el('div', { class: 'muted', text: 'الموقع ثابت بلا سيرفر: ملفات فقط. مجاني تماماً على GitHub Pages ويعمل مع دومينك المخصص.' })
    ]);
  }

  /* ------------------------------------------------------- منطقة الخطر */

  function dangerSection(state) {
    return UI.section('منطقة الخطر', [
      U.el('div', { class: 'btn-row' }, [
        UI.btn('إعادة تعيين إلى بيانات 5 أكتوبر', {
          tone: 'ghost',
          onClick: function () {
            UI.confirm('سيُستبدل كل شيء ببيانات البذرة (حركات 5 أكتوبر 2026). متابعة؟', { okLabel: 'إعادة تعيين', tone: 'danger' }).then(function (ok) {
              if (!ok) return;
              Store.reset();
              UI.toast('تمت إعادة التعيين', 'success');
              if (Fin.App) Fin.App.go('dashboard', { force: true });
            });
          }
        }),
        UI.btn('مسح كل الحركات (إبقاء الحسابات)', {
          tone: 'danger',
          onClick: function () {
            UI.confirm('سيُمسح كل السجل: الحركات والاستحقاقات والسندات. الحسابات والقوالب تبقى. متابعة؟', { okLabel: 'امسح', tone: 'danger' }).then(function (ok) {
              if (!ok) return;
              Store.clearAllData(true);
              UI.toast('تم المسح — ابدأ من جديد', 'success');
              if (Fin.App) Fin.App.go('dashboard', { force: true });
            });
          }
        })
      ]),
      U.el('div', { class: 'muted', text: 'صدّر نسخة احتياطية قبل أي مسح.' })
    ]);
  }

  /* ------------------------------------------------------------- الشاشة */

  Fin.Views.settings = {
    id: 'settings',
    title: 'الإعدادات',
    icon: '⚙️',
    order: 7,

    render: function (rootEl, ctx) {
      var state = Store.state;

      rootEl.appendChild(UI.section('عن التطبيق', [
        U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-head' }, [
            U.el('span', { class: 'ico', text: '💼' }),
            U.el('div', { class: 'card-title', text: C.APP_NAME + ' — الإصدار ' + C.VERSION }),
            U.el('div', { class: 'card-extra' }, [UI.badge('د.ل LYD', 'info')])
          ]),
          U.el('div', { class: 'card-body' }, [
            U.el('div', { class: 'card-sub', text: C.APP_TAGLINE }),
            UI.kv('الأماكن المسجّلة', String(state.locations.length)),
            UI.kv('القوالب (الإيجارات)', String(state.templates.length)),
            UI.kv('الحسابات', String(state.accounts.length)),
            UI.kv('التخزين', 'محلي في هذا المتصفح (localStorage)')
          ])
        ])
      ]));

      rootEl.appendChild(appearanceSection(state));
      rootEl.appendChild(agentSection(state));
      rootEl.appendChild(backupSection(state));
      rootEl.appendChild(deploySection(state));
      rootEl.appendChild(dangerSection(state));

      rootEl.appendChild(UI.section('اختصارات', [
        U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-body' }, [
            UI.kv('إضافة مصروف سريع', 'اضغط ＋ في الأعلى أو حرف  n'),
            UI.kv('تبديل الوضع الليلي', 'حرف  t'),
            UI.kv('الرئيسية', 'حرف  Esc ثم اختر من الشريط')
          ])
        ])
      ]));
    }
  };
})();
