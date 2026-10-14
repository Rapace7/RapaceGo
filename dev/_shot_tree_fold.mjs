/* 折叠语义（默认收起 / 按需展开）的**视觉验收** —— 2026-10-14 深夜。
 * 为什么单独写：断言只证明数值对，首相要看的是"一眼看过去乱不乱"。
 * 拍两张：① 默认收起（放大窗里只有主变 + 角标）② 按需展开第4手（子支紧贴父支、后面的支让道）。
 * 用法：node dev/_shot_tree_fold.mjs [端口]   输出 dev/_shot_fold_off.png / _shot_fold_on.png */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.argv[2] || 9555;

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl && !/^(edge|devtools|chrome):/.test(x.url));
if (!page) { console.log('FAIL: 没有 page target'); process.exit(1); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
const send = (method, params, sessionId) => new Promise(res => {
  const i = ++seq; const t = setTimeout(() => res({ timeout: true }), 30000);
  pending.set(i, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
});
const att = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const sid = att.result && att.result.sessionId;
if (!sid) { console.log('FAIL attach'); process.exit(2); }
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);

async function ev(expr, tmo) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 60000 }, sid);
  if (r.timeout) return { timeout: true };
  if (r.result && r.result.exceptionDetails) return { err: String(r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 4).join(' | ') };
  return { value: r.result && r.result.result && r.result.result.value };
}

/* ---------- ① 造树 + 切树视图 + 开放大窗（**不展开任何东西**） ---------- */
const setup = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => { const m = /^([A-HJ-T])(\\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  const put = async s => { const c = G(s); tryPlay(c.x, c.y); await sleep(70); };
  settings.mode='free'; settings.size=19; settings.handicap=0; settings.rules='chinese';
  applyNewGame(); await sleep(240);
  const MAIN = ['Q16','C16','D14','E17','D16','D17','E16','C17','F16','R5','Q3','R3'];
  for (const q of MAIN) await put(q);
  gotoView(4); await sleep(70); await put('K10'); await put('L10');
  gotoView(4); await sleep(70); await put('M11'); await put('N11'); await put('O11');
  gotoView(6); await sleep(70); await put('S6');
  gotoView(4); await sleep(70); await put('R14');
  gotoView(8); await sleep(70); await put('S10'); await put('S11');
  gotoView(3); await sleep(120);
  [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree').click();
  await sleep(300);
  setTreeZoom(true); await sleep(700);
  const box = document.getElementById('branch-tree');
  box.scrollLeft = 0; box.scrollTop = 0; await sleep(300);
  const modal = document.querySelector('#treezoom .modal').getBoundingClientRect();
  return JSON.stringify({
    rect: { x: Math.floor(modal.x), y: Math.floor(modal.y), width: Math.ceil(modal.width), height: Math.ceil(modal.height) },
    珠子: treeCells.length, 行数: treeLanes, 手数: state.moves.length,
  });
})()`;

const s = await ev(setup);
if (s.err || s.timeout) { console.log('FAIL setup: ' + (s.err || 'timeout')); process.exit(3); }
const info = JSON.parse(s.value);
console.log('【默认收起】珠子 ' + info.珠子 + ' / 行数 ' + info.行数 + ' / 手数 ' + info.手数);

async function shoot(rect, out) {
  let shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1.5 } }, sid);
  if (!shot.result || !shot.result.data) {
    console.log('（scale 1.5 失败，退回 scale 1）' + JSON.stringify(shot).slice(0, 160));
    shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } }, sid);
  }
  if (!shot.result || !shot.result.data) { console.log('FAIL 截图: ' + JSON.stringify(shot).slice(0, 240)); return false; }
  fs.writeFileSync(path.join(ROOT, 'dev', out), Buffer.from(shot.result.data, 'base64'));
  console.log('已存 dev/' + out);
  return true;
}

let shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...info.rect, scale: 1.5 } }, sid);
if (!shot.result || !shot.result.data) {
  console.log('（scale 1.5 失败，退回 scale 1）' + JSON.stringify(shot).slice(0, 160));
  shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...info.rect, scale: 1 } }, sid);
}
if (!shot.result || !shot.result.data) { console.log('FAIL 截图: ' + JSON.stringify(shot).slice(0, 240)); process.exit(5); }
fs.writeFileSync(path.join(ROOT, 'dev', '_shot_fold_off.png'), Buffer.from(shot.result.data, 'base64'));
console.log('已存 dev/_shot_fold_off.png');

/* ---------- ② 点「第 4 手」的角标（按需展开那一条），再点它下面第二条支的第 2 手 ---------- */
const on = await ev(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const box = document.getElementById('branch-tree');
  const clickFold = async (d, r) => {
    const tf = document.querySelector('#branch-tree .cap[data-d="' + d + '"][data-r="' + r + '"] .tf');
    if (!tf) return false; tf.click(); await sleep(300); return true;
  };
  const a = await clickFold(4, 0);                       // 展开第 4 手 → 三条支
  const heads5 = treeCells.filter(c => c.depth === 5 && c.row !== 0).map(c => c.row).sort((x, y) => x - y);
  const rowB = heads5[1];
  const b = await clickFold(6, rowB);                    // 展开支 B 的第 2 手 → 子支紧贴、后面的支让道
  box.scrollLeft = 0; box.scrollTop = 0; await sleep(300);
  return JSON.stringify({ 展开4: a, 展开支B第2手: b, 行B: rowB,
    珠子: treeCells.length, 行数: treeLanes,
    各行: treeCells.map(c => c.depth + '@' + c.row).join(' '),
  });
})()`, 60000);
if (on.err || on.timeout) { console.log('FAIL 展开: ' + (on.err || 'timeout')); process.exit(4); }
const o = JSON.parse(on.value);
console.log('【按需展开】' + JSON.stringify({ 展开了第4手: o.展开4, 展开了支B第2手: o.展开支B第2手, 珠子: o.珠子, 行数: o.行数 }));
console.log('  珠子分布(depth@row): ' + o.各行);

shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...info.rect, scale: 1.5 } }, sid);
if (!shot.result || !shot.result.data) {
  shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...info.rect, scale: 1 } }, sid);
}
if (shot.result && shot.result.data) {
  fs.writeFileSync(path.join(ROOT, 'dev', '_shot_fold_on.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('已存 dev/_shot_fold_on.png');
} else {
  console.log('FAIL 第二张截图: ' + JSON.stringify(shot).slice(0, 240));
}

await ev('(async()=>{ setTreeZoom(false); applyNewGame(); await new Promise(r=>setTimeout(r,250)); return 1; })()', 30000);
ws.close();
process.exit(0);
