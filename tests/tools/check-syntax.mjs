/* فحص صياغة كل ملفات assets/js كما يفعل المتصفح (سكربت عادي في النطاق العام) */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'assets/js';
function walk(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
  });
}
let bad = 0;
for (const file of [...walk(ROOT), 'sw.js']) {
  const src = readFileSync(file, 'utf8');
  try {
    new Function(src);          // نفس قواعد <script> الكلاسيكي
    console.log('OK   ' + file);
  } catch (e) {
    bad++;
    console.log('FAIL ' + file + ' → ' + e.message);
    const lines = src.split('\n');
    const m = /(\d+):(\d+)/.exec(e.stack || '');
    if (m) {
      const ln = Number(m[1]) - 2;
      for (let i = Math.max(0, ln - 2); i < Math.min(lines.length, ln + 3); i++) {
        console.log('      ' + (i + 1) + ': ' + lines[i]);
      }
    }
  }
}
console.log(bad ? `\n${bad} ملف فيه خطأ صياغة` : '\nكل الملفات سليمة');
process.exit(bad ? 1 : 0);
