/* 视觉验收：「线擦到珠子」到底是不是肉眼可见的事故？ —— 2026-10-14 深夜
 *
 * 背景：几何断言报出 R4（按需展开 8 条支）仍有 2 处"线心到珠心 < 珠半径"。
 *      但 `treePaint` 是**先画线、后画珠子**（珠子压在线上面），所以"擦"可能只是
 *      "线从珠子背后穿过去"——肉眼未必是事故。
 *      首相的规矩是"拿像素说话"，所以这里不推理，直接**截图看**。
 *
 * 造景：复刻 `_inject_orderreal.js` 的 8 条支展开（就是报出 2 处过近的那一轮），
 *      然后对准 depth 3..9 / 行 0..7 的区域截两张（scrollTop=0 与 160）。
 *
 * 用法：node dev/_shot_worst.mjs [端口]   输出 dev/_shot_worst_a.png / _b.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.argv[2] || 9555;
const OUTA = path.join(ROOT, 'dev', '_shot_worst_a.png');
const OUTB = path.join(ROOT, 'dev', '_shot_worst_b.png');

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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 }, sid);
  if (r.timeout) return { timeout: true };
  if (r.result && r.result.exceptionDetails) return { err: String(r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 5).join(' | ') };
  return { value: r.result && r.result.result && r.result.result.value };
}

const setup = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const REC = '152724_柯洁_B+R_芈昱廷_2025.11.05_第27届中国围甲联赛第9轮 深圳龙华VS江苏洋河_张香槟＆夏夏＆绝艺解说_.sgf';
  try { await openRecord(REC); } catch (e) { return 'ERR openRecord ' + e; }
  await sleep(1300);
  [...document.querySelectorAll('#seg-moves button')].find(b=>b.dataset.v==='tree').click();
  await sleep(420);

  const mainNodeAt = d => { let n = branchRoot; for (let i=0;i<d;i++) n = n._cs[0]; return n; };
  const expandNode = async d => {
    const node = mainNodeAt(d);
    if (!node || !(node._cs && node._cs.length > 1)) return false;
    if (!treeExpanded.has(node)) { treeExpanded.add(node); treeExpandSeq.set(node, ++treeExpandCounter); }
    renderMoveTree(); await sleep(90);
    return true;
  };
  const mb = [];
  { let n = branchRoot, d = 0;
    for(;;){ const cs = n._cs || []; if(!cs.length) break; if(cs.length>1 && d>=1) mb.push(d); n = cs[0]; d++; } }
  const picks = [mb[Math.floor(mb.length*0.15)], mb[Math.floor(mb.length*0.5)], mb[Math.floor(mb.length*0.85)]];
  for (const d of picks) await expandNode(d);
  const other = mb.find(d=>!picks.includes(d)) || mb[0];
  await expandNode(other);
  const more = mb.filter(d=>!picks.includes(d) && d!==other).slice(0,4);
  for (const d of more) await expandNode(d);

  const box = document.getElementById('branch-tree');
  box.scrollLeft = 0; box.scrollTop = 0;
  await sleep(300);
  const r = box.getBoundingClientRect();
  const card = box.closest('.card').getBoundingClientRect();
  /* 过近明细（口径与 orderreal 的 countTouch 一致：R = STP/2 - 1） */
  const R = STP/2 - 1;
  const d2s = (px,py,x1,y1,x2,y2) => { const dx=x2-x1, dy=y2-y1, L2=dx*dx+dy*dy;
    let t = L2 ? ((px-x1)*dx+(py-y1)*dy)/L2 : 0; t = Math.max(0,Math.min(1,t));
    return Math.hypot(px-(x1+t*dx), py-(y1+t*dy)); };
  const det = [];
  for (const c of treeCells) {
    const pp = treePosOf.get(c.node._p); if (!pp) continue;
    const x1 = stoneX(pp.d)+STP/2, y1 = stoneCy(pp.r);
    const x2 = stoneX(c.depth)+STP/2, y2 = stoneCy(c.row);
    for (const o of treeCells) {
      const ox = stoneX(o.depth)+STP/2, oy = stoneCy(o.row);
      if (Math.hypot(ox-x1,oy-y1)<1 || Math.hypot(ox-x2,oy-y2)<1) continue;
      const d = d2s(ox,oy,x1,y1,x2,y2);
      if (d < R) det.push({ px: Math.round(ox), py: Math.round(oy), dist: +d.toFixed(1),
        line: '第'+pp.d+'手(行'+pp.r+')→第'+c.depth+'手(行'+c.row+')', hit: '第'+o.depth+'手(行'+o.row+')' });
    }
  }
  return JSON.stringify({
    boxRect: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.floor(r.width), height: Math.floor(r.height) },
    cardRect: { x: Math.floor(card.x)-4, y: Math.floor(card.y)-4, width: Math.ceil(card.width)+8, height: Math.ceil(card.height)+8 },
    boxH: box.clientHeight, boxScrollH: box.scrollHeight, boxScrollW: box.scrollWidth, boxClientW: box.clientWidth,
    cells: treeCells.length, lanes: treeLanes,
    bad: det.length, det: det.slice(0, 6)
  });
})()`;

const s = await ev(setup);
if (s.err || s.timeout) { console.log('FAIL setup: ' + (s.err || 'timeout')); process.exit(3); }
const info = JSON.parse(s.value);
console.log('珠子 ' + info.cells + ' / 行 ' + info.lanes + ' | box ' + info.boxClientW + 'x' + info.boxH
  + ' 内容 ' + info.boxScrollW + 'x' + info.boxScrollH + ' | 过近 ' + info.bad + ' 处');
for (const d of info.det) console.log('   · ' + d.line + ' 撞 ' + d.hit + ' 距 ' + d.dist + 'px  @(' + d.px + ',' + d.py + ')');

/* box 可视高只有 126px（≈2.4 行），所以按过近处所在的行**逐个对准**截 */
const shots = [
  { file: OUTA, top: 0 },
  { file: OUTB, top: 150 },
  { file: path.join(ROOT, 'dev', '_shot_worst_c.png'), top: 230 },
];
for (const sh of shots) {
  await ev(`(function(){ const b=document.getElementById('branch-tree'); b.scrollTop=${sh.top}; b.scrollLeft=0; return b.scrollTop; })()`);
  await new Promise(r => setTimeout(r, 350));
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...info.boxRect, scale: 3 } }, sid);
  if (!shot.result || !shot.result.data) { console.log('FAIL shot: ' + JSON.stringify(shot).slice(0, 160)); continue; }
  fs.writeFileSync(sh.file, Buffer.from(shot.result.data, 'base64'));
  console.log('已存 ' + sh.file + ' (scrollTop=' + sh.top + ')');
}
ws.close();
process.exit(0);
