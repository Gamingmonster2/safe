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

  /* أيقونة SVG احترافية من icons.js (بديل الإيموجي) */
  function icon(name, opts) {
    opts = opts || {};
    if (!Fin.I) return U.el('span', { class: 'ic-wrap' });
    var key = (name && Fin.I.has(name)) ? name : (opts.fallback || 'package');
    return Fin.I.el(key, { size: opts.size || 20, tone: opts.tone || null });
  }

  function saveSettings(patch) { Store.updateSettings(patch); }

  function closeModalQuiet() {
    var overlay = document.querySelector('.modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () { UI.detach(overlay); }, 180);
  }

  /* ============================================================ الأمان */

  function vault() { return Fin.Vault || null; }

  function securitySection(state) {
    var V = vault();
    var configured = !!(V && V.isConfigured && V.isConfigured());
    var has2fa = !!(V && V.has2FA && V.has2FA());
    var unsupported = !(V && V.isSupported && V.isSupported());

    if (unsupported) {
      return UI.section('الأمان والحماية', [
        U.el('div', { class: 'alert alert-warn' }, [
          U.el('div', { class: 'alert-ico' }, [icon('alert', { size: 15, tone: 'warn' })]),
          U.el('div', { class: 'alert-main' }, [
            U.el('div', { class: 'alert-title', text: 'التشفير غير مدعوم في هذا المتصفح' }),
            U.el('div', { class: 'alert-body', text: 'هذا المتصفح لا يدعم Web Crypto. بياناتك تُحفظ غير مشفّرة — استخدم متصفحاً حديثاً لتفعيل الحماية.' })
          ])
        ])
      ]);
    }

    var rows = [
      U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card-head' }, [
          icon(configured ? 'shield' : 'alert', { size: 20, tone: configured ? 'in' : 'warn' }),
          U.el('div', { class: 'card-title', text: configured ? 'بياناتك مشفّرة' : 'لا توجد حماية بعد' }),
          U.el('div', { class: 'card-extra' }, [UI.badge(has2fa ? 'مع مصادقة ثنائية' : (configured ? 'كلمة سر فقط' : 'غير محمي'), has2fa ? 'income' : (configured ? 'warn' : 'danger'))])
        ]),
        U.el('div', { class: 'card-body' }, [
          UI.kv('اسم المستخدم', (V.username && V.username()) || '—'),
          UI.kv('التشفير', 'AES-GCM 256 + PBKDF2-SHA256 (' + ((V.iter && V.iter()) || 310000) + ' دورة)'),
          UI.kv('المصادقة الثنائية', has2fa ? 'مفعّلة (تطبيق المصادقة)' : 'غير مفعّلة'),
          U.el('div', { class: 'card-sub', text: configured
            ? 'كل شيء (الحركات، الأرصدة، النطاقات) مشفّر في هذا المتصفح. لا يمكن فتحه بلا كلمة السر، ولا يُرسَل لأي خادم.'
            : 'أنشئ حساباً من شاشة الدخول لتفعيل التشفير.' })
        ])
      ])
    ];

    rows.push(U.el('div', { class: 'btn-row' }, [
      UI.btn('اقفل الآن', { tone: 'primary', icon: 'lock', onClick: function () {
        if (!configured) { UI.toast('لا توجد خزنة بعد', 'danger'); return; }
        UI.confirm('سيُقفل التطبيق ويُمسح المفتاح من الذاكرة. متابعة؟', { okLabel: 'اقفل', tone: 'primary' }).then(function (ok) {
          if (!ok) return;
          V.lock();
          location.reload();
        });
      } }),
      UI.btn('تغيير كلمة السر', { tone: 'ghost', icon: 'key', onClick: function () { openChangePassword(V, has2fa); } }),
      UI.btn(has2fa ? 'عطّل المصادقة الثنائية' : 'المصادقة الثنائية غير مفعّلة', {
        tone: 'ghost', icon: 'shield', disabled: !has2fa,
        onClick: function () { openDisable2FA(V); }
      }),
      UI.btn('نسخة مشفّرة', { tone: 'ghost', icon: 'download', onClick: function () {
        Promise.resolve(V.exportEncrypted()).then(function (res) {
          if (!res || !res.ok) { UI.toast((res && res.error) || 'تعذّر التصدير', 'danger'); return; }
          U.download('masrofi-vault-' + U.todayISO() + '.json', res.text, 'application/json;charset=utf-8');
          UI.toast('نُزّلت نسخة مشفّرة — احفظها في مكان آمن', 'success', 4000);
        });
      } })
    ]));

    rows.push(U.el('div', { class: 'alert alert-warn' }, [
      U.el('div', { class: 'alert-ico' }, [icon('alert', { size: 15, tone: 'warn' })]),
      U.el('div', { class: 'alert-main' }, [
        U.el('div', { class: 'alert-title', text: 'احفظ نسخة احتياطية مشفّرة' }),
        U.el('div', { class: 'alert-body', text: 'لا يوجد خادم يستعيد كلمة السر. إن نسيتها، ملف النسخة الاحتياطية + كلمة السر هما طريقك الوحيد للعودة.' })
      ])
    ]));

    return UI.section('الأمان والحماية', rows);
  }

  function openChangePassword(V, has2fa) {
    var form = UI.form([
      { name: 'currentPassword', label: 'كلمة السر الحالية', type: 'password', required: true, autocomplete: 'current-password' },
      has2fa ? { name: 'code', label: 'رمز المصادقة الثنائية', type: 'text', required: true, placeholder: '6 أرقام' } : null,
      { name: 'newPassword', label: 'كلمة السر الجديدة', type: 'password', required: true, hint: '8 محارف على الأقل' },
      { name: 'confirmPassword', label: 'تأكيد كلمة السر الجديدة', type: 'password', required: true }
    ].filter(Boolean), { values: {} });

    UI.modal({
      title: 'تغيير كلمة السر',
      body: U.el('div', {}, [
        U.el('div', { class: 'muted', text: 'يُعاد لفّ المفتاح فقط — لا تُعاد كتابة البيانات، فالحركات والأرصدة تبقى كما هي.' }),
        form.el
      ]),
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'تغيير', tone: 'primary', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        if (!v.currentPassword || !v.newPassword) { UI.toast('أكمل الحقول', 'danger'); return { ok: false }; }
        if (String(v.newPassword).length < 8) { UI.toast('كلمة السر الجديدة قصيرة (8 على الأقل)', 'danger'); return { ok: false }; }
        if (v.newPassword !== v.confirmPassword) { UI.toast('كلمتا السر غير متطابقتين', 'danger'); return { ok: false }; }
        Promise.resolve(V.changePassword({
          currentPassword: v.currentPassword, newPassword: v.newPassword, code: v.code
        })).then(function (res) {
          if (res && res.ok) { UI.toast('تم تغيير كلمة السر', 'success'); closeModalQuiet(); }
          else UI.toast((res && res.error) || 'تعذّر التغيير', 'danger', 4200);
        });
        return { ok: false };
      }
    });
  }

  function openDisable2FA(V) {
    var form = UI.form([
      { name: 'password', label: 'كلمة السر', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'code', label: 'رمز المصادقة الثنائية الحالي', type: 'text', required: true, placeholder: '6 أرقام' }
    ], { values: {} });

    UI.modal({
      title: 'تعطيل المصادقة الثنائية',
      body: U.el('div', {}, [
        U.el('div', { class: 'alert alert-warn' }, [
          U.el('div', { class: 'alert-ico' }, [icon('alert', { size: 15, tone: 'warn' })]),
          U.el('div', { class: 'alert-main' }, [
            U.el('div', { class: 'alert-title', text: 'الحماية ستضعف' }),
            U.el('div', { class: 'alert-body', text: 'بعد التعطيل تكفي كلمة السر لفتح بياناتك. البيانات تبقى مشفّرة كما هي.' })
          ])
        ]),
        form.el
      ]),
      wide: true,
      actions: [
        { label: 'إلغاء', tone: 'ghost' },
        { label: 'عطّل', tone: 'danger', type: 'submit' }
      ],
      onSubmit: function () {
        var v = form.getValues();
        if (!v.password || !v.code) { UI.toast('أكمل الحقول', 'danger'); return { ok: false }; }
        Promise.resolve(V.disable2FA({ password: v.password, code: v.code })).then(function (res) {
          if (res && res.ok) { UI.toast('تم تعطيل المصادقة الثنائية', 'success'); closeModalQuiet(); if (Fin.App) Fin.App.refresh(); }
          else UI.toast((res && res.error) || 'تعذّر التعطيل', 'danger', 4200);
        });
        return { ok: false };
      }
    });
  }

  /* --------------------------------------------------------- المظهر */

  function appearanceSection(state) {
    var current = state.settings.theme || 'dark';
    var labels = { dark: 'ليلي', light: 'نهاري', auto: 'تلقائي (حسب الجهاز)' };
    var icons = { dark: 'moon', light: 'sun', auto: 'sliders' };
    var chips = U.el('div', { class: 'tabs' }, C.THEMES.map(function (t) {
      return UI.chip(labels[t], {
        icon: icons[t],
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
        name: 'voiceInput', label: 'زر الإدخال الصوتي في شاشة المساعد',
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
      U.el('div', { class: 'alert-ico' }, [icon(hasKey ? 'checkCircle' : 'key', { size: 14 })]),
      U.el('div', { class: 'alert-main' }, [
        U.el('div', { class: 'alert-title', text: hasKey ? 'المفتاح محفوظ ومفعّل' : 'لم تُضف مفتاحاً بعد' }),
        U.el('div', { class: 'alert-body', text: hasKey ? 'المساعد يجيب من DeepSeek مع أدوات تحليل بياناتك. وبدون إنترنت يعمل المحرّك المحلي، والتطبيق كله يعمل أوفلاين.' : 'بدون مفتاح يعمل المحرّك المحلي فقط (أرقامك وملخصاتك بلا إنترنت). المفتاح يضيف التحليل الذكي فقط — ولا علاقة له بالصوت.' })
      ])
    ]);

    var actions = U.el('div', { class: 'btn-row' }, [
      UI.btn('حفظ المفتاح والإعدادات', {
        icon: 'check',
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
            UI.toast(res.ok ? 'المفتاح يعمل' : 'فشل: ' + res.error, res.ok ? 'success' : 'danger', 5000);
          });
        }
      }),
      UI.btn('فتح المساعد', { icon: 'robot', tone: 'ghost', onClick: function () { if (Fin.App) Fin.App.go('agent'); } })
    ]);

    var voiceNote = UI.kv('دعم إدخال الصوت في هذا المتصفح', (Fin.Agent && Fin.Agent.hasVoice && Fin.Agent.hasVoice()) ? 'مدعوم' : 'غير مدعوم في هذا المتصفح');
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
        UI.btn('تصدير نسخة (JSON)', {
          icon: 'download',
          tone: 'primary',
          onClick: function () {
            U.download('masrofi-backup-' + U.todayISO() + '.json', Store.exportJSON(), 'application/json;charset=utf-8');
            UI.toast('نُزّلت النسخة الاحتياطية', 'success');
          }
        }),
        UI.btn('استيراد نسخة', { icon: 'upload', tone: 'ghost', onClick: function () { importInput.click(); } }),
        UI.btn('تصدير Excel/CSV', {
          icon: 'file',
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
          icon: 'check',
          tone: 'primary',
          onClick: function () {
            var v = form.getValues();
            saveSettings({ domain: String(v.domain || '').trim() });
            UI.toast('تم الحفظ', 'success');
          }
        }),
        UI.btn('نسخ خطوات الرفع على GitHub', {
          icon: 'file',
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
          icon: 'refresh',
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
          icon: 'trash',
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
    icon: 'settings',
    order: 7,

    render: function (rootEl, ctx) {
      var state = Store.state;

      rootEl.appendChild(UI.section('عن التطبيق', [
        U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-head' }, [
            icon('wallet', { size: 20 }),
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
      rootEl.appendChild(securitySection(state));
      rootEl.appendChild(agentSection(state));
      rootEl.appendChild(backupSection(state));
      rootEl.appendChild(deploySection(state));
      rootEl.appendChild(dangerSection(state));

      rootEl.appendChild(UI.section('اختصارات', [
        U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-body' }, [
            UI.kv('إضافة مصروف سريع', 'اضغط زر الإضافة في الأعلى أو حرف  n'),
            UI.kv('تبديل الوضع الليلي', 'حرف  t'),
            UI.kv('الرئيسية', 'حرف  Esc ثم اختر من الشريط')
          ])
        ])
      ]));
    }
  };
})();
