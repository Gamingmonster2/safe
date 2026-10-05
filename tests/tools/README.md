# أدوات الفحص — كيف تتحقق من التطبيق بنفسك

كل الأوامر تُشغَّل من جذر المشروع: `C:\vpn\safe`

## 1) الحزم الأربع الرسمية (كلها بلا مكتبات)

```powershell
node tests/check.mjs            # الأرقام المالية + الحالات الحدّية + سلامة النشر   (273 فحصاً)
node tests/dom-smoke.mjs        # رسم الشاشات فعلياً في DOM مصغّر + أسئلة الوكيل    (84 فحصاً)
node tests/selftest-agent.mjs   # الوكيل الذكي: أدوات، صوت، مسارات أخطاء DeepSeek  (347 فحصاً)
node tests/selftest-pwa.mjs     # الأيقونات، المانيفست، قائمة الـ precache          (178 فحصاً)
```

النتيجة المتوقعة: صفر فشل في الأربعة. أي فشل يعطي `exit code 1`.

## 2) فحص الصياغة لكل ملف (الدرع الأول)

```powershell
Get-ChildItem -Recurse assets/js -Filter *.js | ForEach-Object { node --check $_.FullName }
node --check sw.js
```

> لماذا؟ لأن أي خطأ صياغة في **أي** ملف يعطّل تحميل السكربت التالي، وقد رأينا ذلك فعلاً ثلاث مرات
> (`store.js`, `agent.js`, وترتيب `store`/`finance`). التطبيق يعرض الآن رسالة واضحة بدل شاشة بيضاء،
> لكن الفحص المسبق يمنع المشكلة أصلاً.

## 3) `tests/tools/` — أدوات مساعدة

| الملف | الوظيفة |
|---|---|
| `check-syntax.mjs` | فحص صياغة سريع لكل ملفات JS في المشروع |
| `check-dom.mjs` | تحقق من أن كل نداءات `Fin.*` تشير إلى أعضاء موجودة فعلاً |
| `smoke-views.mjs` | فحص شاشات `views-dev` الذاتي (الأرقام + التسجيل في `Fin.Views`) |
| `diag.mjs` / `diag2.mjs` | تشخيصات مؤقتة استُخدمت أثناء التطوير (يمكن حذفها بلا أثر) |
| `layout-probe.html` | يفتح في المتصفح ويطبع تقريراً بكل عنصر يتجاوز عرض الشاشة |
| `measure.html` | يقيس عرض شريط التنقل السفلي مقابل عرض الشاشة |

## 4) التحقق البصري الحقيقي (Edge بلا واجهة)

المتصفح المثبَّت عندك: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
& $edge --headless=new --disable-gpu --hide-scrollbars --window-size=430,3000 `
        --virtual-time-budget=8000 `
        --screenshot="C:\vpn\safe\tests\screenshots\dashboard-dark.png" `
        "file:///C:/vpn/safe/index.html"
```

لقياس العرض الحقيقي للصفحة (كشف الانزلاق الأفقي):

```powershell
& $edge --headless=new --disable-gpu --hide-scrollbars --window-size=390,900 `
        --virtual-time-budget=5000 `
        --screenshot="C:\vpn\safe\tests\screenshots\_measure.png" `
        "file:///C:/vpn/safe/tests/tools/measure.html"
```

القاعدة: يجب أن يكون `document.documentElement.scrollWidth == عرض النافذة`
و`nav.scrollWidth <= عرض النافذة`.

## 5) الأرقام المرجعية (البذرة 2026-10-05)

| البند | القيمة |
|---|---|
| دخل اليوم | 3,400 (ورشة السمكرة 1,900 + الميكانيكا 1,500) |
| مصروف اليوم | 302 (120 + 22 + 85 + 60 + 15) |
| صافي اليوم | +3,098 |
| رصيد الشنطة | 8,098 |
| الادخار | 1,500 |
| إجمالي الحسابات | 9,598 |
| **مستحق لي (لم يُحصَّل)** | **5,500** = المحل 1,500 + الاستوديو 2,000 (ربع Q4) + الحجرات 2,000 |
| ديون عليّ | 5,180 = نطاق 180 + بقية رسوم المدرسة 5,000 |
| التزامات قادمة | 1,500 = كتب 950 + زي 450 + بنزين 100 |
| إجمالي الالتزامات | 6,680 |

> ملاحظة موثّقة: الرقم «6,400» الذي ورد في أول وصف للمهمة **غير مشتق** — بنوده المذكورة نفسها
> تساوي 7,400، والمحرّك يعطي 5,500 لأن ورشة السمكرة (1,900) **محصَّلة فعلاً** ومربوطة باستحقاقها.
> المعتمد 5,500 في كل الاختبارات والشاشات.

## 6) تنظيف قبل الرفع

```powershell
Remove-Item tests\screenshots\_*.png -ErrorAction SilentlyContinue
```

الصور التي تبدأ بـ`_` صور قياس مؤقتة لا حاجة لرفعها.
