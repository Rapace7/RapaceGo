/* 行复用 + 穿心连线的肉眼验收 —— 2026-10-13 千问。
 * 造一个「两条侧支列区间互不相交」的局面，验证：
 *   ① 它们被排在同一行（首相要求：前后不碰就允许同行）
 *   ② 下落线不穿过中间行的珠子（不交叉）
 *   ③ 连线从父珠心穿到子珠心（手串效果）
 * 输出 dev/_shot_reuse.png
 */
import fs from 'node:fs';
const PORT = process.argv[2] || 9333;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page');
if (!page) { console.log('没有页面'); process.exit(1); }
const bs = new WebSocket(page.webSocketDebuggerUrl.replace(/devtools\/page\//, 'devtools/browser/'));
await new Promise((r, j) => { bs.onopen = r; bs.onerror = j; });
let mid = 0; const pend = new Map(); const SID = 'qw1';
bs.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Target.attachedToTarget') pend.set(m.params.sessionId + '_attach', m); if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.error ? { err: m.error } : { ok: m.result }); } };
const raw = (m, p) => new Promise((res, rej) => { const id = ++mid; pend.set(id, r => r.err ? rej(new Error(JSON.stringify(r.err))) : res(r.ok)); bs.send(JSON.stringify({ id, method: m, params: { ...p, sessionId: SID } })); });
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++mid; pend.set(id, r => r.err ? rej(new Error(JSON.stringify(r.err))) : res(r.ok)); bs.send(JSON.stringify({ id, method: m, params: p })); });
await send('Target.attachToTarget', { targetId: page.id, flatten: true });
await raw('Runtime.enable');
const ev = async expr => {
  const r = await raw('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400));
  return r.result.value;
};
await new Promise(r => setTimeout(r, 1200));

const info = await ev(`
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => { const m = /^([A-HJ-T])(\\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  settings.mode='free'; settings.size=19; settings.handicap=0; settings.rules='chinese';
  applyNewGame(); await sleep(300);
  /* 主线 8 手 */
  for (const q of ['D4','Q16','D16','Q4','C6','E6','F3','P3']) { const c=G(q); tryPlay(c.x,c.y); }
  await sleep(150);
  /* 侧支A：从第 3 手岔出，只走 2 手（列 4-5） */
  gotoView(3); await sleep(60);
  let a1=G('K10'); tryPlay(a1.x,a1.y); await sleep(80);
  let a2=G('L10'); tryPlay(a2.x,a2.y); await sleep(80);
  const nodeA1 = state.moves[3], nodeA2 = state.moves[4];
  /* 回主线，从第 7 手再岔一条（列 8-9）—— 与侧支A 列区间不相交 */
  gotoView(7); await sleep(60);
  let b1=G('R10'); tryPlay(b1.x,b1.y); await sleep(80);
  let b2=G('R14'); tryPlay(b2.x,b2.y); await sleep(80);
  const nodeB1 = state.moves[7], nodeB2 = state.moves[8];
  gotoView(8); await sleep(80);            // 回主线末端
  movesView='tree'; $('movelist').hidden=true; $('branch-tree').hidden=false;
  renderMoveTree(); await sleep(200);
  const box=$('branch-tree'); box.scrollLeft=0; await sleep(150);
  const rowOf = n => { const c = treeCells.find(x=>x.node===n); return c?c.row:-1; };
  /* 交叉检查：任何一条下落线，途经行上不许有珠子压在同一列 */
  let crossings = 0;
  for (const b of treeBranches) {
    const lo = Math.min(b.fromRow,b.toRow)+1, hi = Math.max(b.fromRow,b.toRow);
    for (let r=lo; r<=hi; r++) if (treeCells.some(c=>c.row===r && c.depth===b.col)) crossings++;
  }
  /* 同行珠子列冲突检查（同一行不允许两颗珠占同一列） */
  const seen = new Set(); let sameCell = 0;
  for (const c of treeCells) { const k=c.row+'_'+c.depth; if (seen.has(k)) sameCell++; seen.add(k); }
  /* 线是否真的穿到珠心：取一条同航道的线，比对它的左右端与两颗珠的中心 */
  const lnSample = (() => {
    const el = box.querySelector('.ln:not(.ln-br)');
    if (!el) return null;
    return { left: parseFloat(el.style.left), width: parseFloat(el.style.width), top: parseFloat(el.style.top) };
  })();
  return JSON.stringify({
    侧支A行: rowOf(nodeA1), 侧支B行: rowOf(nodeB1),
    两条侧支共用一行: rowOf(nodeA1) === rowOf(nodeB1) && rowOf(nodeA1) > 0,
    总行数: treeLanes, 布局格数: treeCells.length,
    下落线穿越中间行: crossings, 同行同列冲突: sameCell,
    落线记录: treeBranches.map(b=>b.col+'列 '+b.fromRow+'→'+b.toRow),
    水平线样本: lnSample,
  }, null, 1);
`);
console.log(info);

const shot = await raw('Page.captureScreenshot', { format: 'png' });
const el = await raw('Runtime.evaluate', { expression: `(()=>{const r=$('branch-tree').getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`, returnByValue: true });
console.log('面板矩形', el.result.value);
fs.writeFileSync('D:/Git by Rapace/Go/RapaceGo-src/dev/_shot_reuse.png', Buffer.from(shot.data, 'base64'));
console.log('已存 dev/_shot_reuse.png（整屏，看左栏树面板）');
bs.close(); process.exit(0);
