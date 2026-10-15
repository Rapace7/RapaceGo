/* dev/_verify_enc_1015.mjs —— 编码层（P0-3 / P2-10 / P3-4 / P3-8）的回归断言。
   做法：从**真实的 main.js 源码文本**里切出编码层那几个函数，在 node 里真跑。
   两个源对比：new = RapaceGo-src（本轮修完），old = RapaceGo（上一版部署副本）——
   规矩是「先证明断言有效」：同一条断言必须在 old 上红、在 new 上绿。
   跑法：node dev/_verify_enc_1015.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_NEW = '../main.js';
const SRC_OLD = '../../RapaceGo/resources/app/main.js';

/* 从源码里切出「编码层」那一段：起点 = looksUtf8 的注释头，终点 = 备份函数（坑位 43）之前 */
function sliceEnc(src, startMark, endMark) {
  const i = src.indexOf(startMark);
  const j = src.indexOf(endMark, i);
  if (i < 0 || j < 0) throw new Error('切片失败：' + startMark.slice(0, 20));
  return src.slice(i, j);
}
function sliceFn(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return '';
  const j = src.indexOf('\n}', i + head.length);
  return j < 0 ? '' : src.slice(i, j + 2);
}
function build(src) {
  const enc = sliceEnc(src, '/* 判断一段字节是不是合法 UTF-8', '/* ★★ 坑位 43');
  const note = sliceFn(src, 'function readNote(file) {');
  const keep = n => '(typeof ' + n + ' === \'undefined\' ? null : ' + n + ')';
  const body = enc + '\n' + note + '\nreturn { readTextSmart, writeTextSmart, gbkEncode: ' + keep('gbkEncode') + ', encodeWith: ' + keep('encodeWith') + ', declaredEncoding: ' + keep('declaredEncoding') + ', fixCharsetDecl: ' + keep('fixCharsetDecl') + ', readNote };';
  return new Function('fs', body)(fs);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const srcNew = fs.readFileSync(path.join(here, SRC_NEW), 'utf8');
const srcOld = fs.readFileSync(path.join(here, SRC_OLD), 'utf8');
const libNew = build(srcNew);
const libOld = build(srcOld);

const DIR = path.join(os.tmpdir(), 'rapacego-enc-check');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const fp = n => path.join(DIR, n);

/* fixture 用**繁体**（Big5 表覆盖繁体字，简化字它本来就没有） */
const TEXT = '(;GM[1]FF[4]SZ[19]CA[%CA%]GN[測試棋譜]C[這一手是中國流的起手];B[pd];W[dd])';
const mk = (ca, lib) => TEXT.replace('%CA%', ca);

const results = [];
function check(who, name, ok, detail) { results.push({ who, name, ok: !!ok, detail: detail || '' }); }

/* ---- 造三份 fixture：UTF-8 / GBK / Big5 ---- */
const fUtf8 = fp('utf8.sgf'); fs.writeFileSync(fUtf8, mk('UTF-8', libNew), 'utf8');
const fGbk = fp('gbk.sgf');
const g = libNew.encodeWith('gbk', mk('GBK', libNew));
fs.writeFileSync(fGbk, g.buf);
const fBig5 = fp('big5.sgf');
const b5 = libNew.encodeWith('big5', mk('Big5', libNew));
fs.writeFileSync(fBig5, b5.buf);
check('fixture', 'Big5 造样本无缺字', b5.missing.length === 0, 'missing=' + JSON.stringify(b5.missing));

const WANT = '這一手是中國流的起手';
const WANT_GN = '測試棋譜';
const gbkBytes = fs.readFileSync(fGbk);
const big5Bytes = fs.readFileSync(fBig5);

for (const [who, lib] of [['old', libOld], ['new', libNew]]) {
  /* 1) GBK 读得对 */
  const gTxt = lib.readTextSmart(fGbk);
  check(who, 'GBK 读取中文正确', gTxt.includes(WANT) && gTxt.includes(WANT_GN));
  /* 2) GBK 写回逐字节不变 */
  lib.writeTextSmart(fGbk, gTxt);
  check(who, 'GBK 原样写回逐字节一致', Buffer.compare(fs.readFileSync(fGbk), gbkBytes) === 0);
  /* 3) Big5 读得对（旧代码按 GBK 解 → 错字） */
  const bTxt = lib.readTextSmart(fBig5);
  check(who, 'Big5 读取中文正确', bTxt.includes(WANT) && bTxt.includes(WANT_GN), bTxt.slice(30, 78));
  /* 4) Big5 改一处后写回：可逆 */
  const edited = bTxt.replace('中國流的起手', '中國流的開局');
  lib.writeTextSmart(fBig5, edited);
  const back = new TextDecoder('big5').decode(fs.readFileSync(fBig5));
  check(who, 'Big5 修改后写回可逆（按 big5 解回）', back.includes('中國流的開局') && back.includes(WANT_GN), back.slice(30, 78));
  /* 5) CA 声明被订正 */
  /* 声明与实际必须自洽：按文件自称的编码解回来，中文必须是对的（不能是错字/乱码） */
  const caVal = (back.match(/CA\[([^\]]*)\]/) || [null, ''])[1];
  let byDecl = '';
  try { byDecl = new TextDecoder(caVal.toLowerCase() === 'big5' ? 'big5' : caVal).decode(fs.readFileSync(fBig5)); } catch (e) { byDecl = ''; }
  check(who, 'CA[] 声明与实际字节自洽', /CA\[Big5\]/.test(back) && byDecl.includes('中國流的開局'), 'CA=' + caVal + ' 解回=' + byDecl.slice(30, 72));
  /* 6) readNote 读 GBK 棋谱 */
  fs.writeFileSync(fGbk, gbkBytes);
  check(who, 'readNote 读 GBK 备注正确', lib.readNote(fGbk) === WANT_GN, lib.readNote(fGbk));
  fs.writeFileSync(fBig5, big5Bytes);
}

const fails = results.filter(r => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.who + '  ' + r.name + (r.detail ? '   [' + r.detail + ']' : ''));
console.log('');
const oldFail = fails.filter(f => f.who === 'old').length;
const newFail = fails.filter(f => f.who === 'new').length;
console.log('旧代码失败 ' + oldFail + ' 条 / 新代码失败 ' + newFail + ' 条');
const valid = oldFail > 0 && newFail === 0;
console.log(valid ? '✓ 断言有效（旧红新绿）' : '✗ 断言无效或无区分度');
process.exit(valid ? 0 : 1);