/* 树面板「密集分支」视觉验收 —— 2026-10-14。
 * 为什么新写一个：dev/_shot_tree.mjs 是**滚到中段**拍的，看不到树顶；
 * 而首相这次的抱怨正是「最上面拉不上去」+「手全重叠」——要一眼看全整棵树。
 * 造：20 手主线 + 5 条侧支（其中一条再分叉），切树视图，scrollLeft=0，整卡片 scale2 截图。
 * 用法：node dev/_shot_tree1014.mjs [端口]   输出 dev/_shot_tree1014.png */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.argv[2] || 9555;
const OUT = path.join(ROOT, 'dev', '_shot_tree1014.png');

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl && !x.url.startsWith('edge://'));
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

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 40000 }, sid);
  if (r.timeout) return { timeout: true };
  if (r.result && r.result.exceptionDetails) return { err: String(r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 4).join(' | ') };
  return { value: r.result && r.result.result && r.result.result.value };
}

const setup = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => { const m = /^([A-HJ-T])(\\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  const put = async (s) => { const c = G(s); tryPlay(c.x, c.y); await sleep(70); };
  settings.mode='free'; settings.size=19; settings.handicap=0; settings.rules='chinese';
  applyNewGame(); await sleep(220);

  /* 主线 12 手 —— 长到需要横向滚动 */
  const main = ['Q16','C16','D14','E17','D16','D17','E16','C17','F16','R5','Q3','R3'];
  for (const q of main) await put(q);

  /* 侧支 ①：第 4 手分叉，走 2 手 */
  gotoView(4); await put('K10'); await put('L10');
  /* 侧支 ②：第 5 手分叉，走 3 手（更深，要占更下面的行） */
  gotoView(5); await put('M11'); await put('N11'); await put('O11');
  /* 侧支 ③：第 4 手分叉，只有 1 手（与侧支①同一父，最容易挤在一起） */
  gotoView(4); await put('R14');
  /* 侧支 ④：第 6 手分叉 */
  gotoView(6); await put('S10'); await put('S11');
  /* 侧支 ⑤：挂在侧支②的第 2 手上（**支上再生支**，旧布局的经典翻车点） */
  gotoView(7); await put('P14'); await put('P15');

  [...document.querySelectorAll('#seg-moves button')].find(b=>b.dataset.v==='tree').click();
  await sleep(400);
  const box = document.getElementById('branch-tree');
  box.scrollLeft = 0; box.scrollTop = 0;
  await sleep(300);
  const card = box.closest('.card').getBoundingClientRect();
  return JSON.stringify({
    rect: { x: Math.floor(card.x) - 4, y: Math.floor(card.y) - 4, width: Math.ceil(card.width) + 8, height: Math.ceil(card.height) + 8 },
    cells: treeCells.length, lanes: treeLanes, maxDepth: treeMaxDepth,
    scrollW: box.scrollWidth, clientW: box.clientWidth, scrollTop: Math.round(box.scrollTop),
    手数: state.moves.length,
  });
})()`;

const s = await ev(setup);
if (s.err || s.timeout) { console.log('FAIL setup: ' + (s.err || 'timeout')); process.exit(3); }
const info = JSON.parse(s.value);
console.log('树: 珠子 ' + info.cells + ' / 行数 ' + info.lanes + ' / 最大深度 ' + info.maxDepth
  + ' | 手数 ' + info.手数 + ' | 内容宽 ' + info.scrollW + ' 可视 ' + info.clientW + ' | scrollTop=' + info.scrollTop);

const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...info.rect, scale: 2 } }, sid);
if (!shot.result || !shot.result.data) { console.log('FAIL shot: ' + JSON.stringify(shot).slice(0, 200)); process.exit(4); }
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('已存 ' + OUT);
ws.close();
process.exit(0);
