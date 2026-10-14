/* 性能与规模检查：真实棋谱「全部展开」要多久（新算法带几何判碰，必须实测，不能猜）。
 * 用法：node dev/_diag_treeperf.mjs [端口] */
const PORT = process.argv[2] || 9555;
const REC = '152724_柯洁_B+R_芈昱廷_2025.11.05_第27届中国围甲联赛第9轮 深圳龙华VS江苏洋河_张香槟＆夏夏＆绝艺解说_.sgf';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl && !/^(edge|devtools|chrome):/.test(x.url));
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
const send = (method, params, sessionId) => new Promise(res => {
  const i = ++seq; const t = setTimeout(() => res({ timeout: true }), 120000);
  pending.set(i, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
});
const att = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const sid = att.result && att.result.sessionId;
const ev = async (expr, tmo) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 120000 }, sid);
  if (r.timeout) return 'TIMEOUT';
  if (r.result && r.result.exceptionDetails) return 'ERR ' + String(r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result && r.result.result && r.result.result.value;
};

console.log(await ev(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  try { await openRecord(${JSON.stringify(REC)}); } catch (e) { return 'ERR 打开棋谱: ' + e; }
  await sleep(1200);
  [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree').click();
  await sleep(400);
  const box = document.getElementById('branch-tree');

  const t0 = performance.now();
  renderMoveTree();
  const tCollapsed = performance.now() - t0;
  out.push('默认收起：' + treeCells.length + ' 颗 / ' + treeLanes + ' 行 / 重绘 ' + tCollapsed.toFixed(1) + ' ms');

  const t1 = performance.now();
  treeExpandAll(true);
  const tAll = performance.now() - t1;
  out.push('全部展开：' + treeCells.length + ' 颗 / ' + treeLanes + ' 行 / 重绘 ' + tAll.toFixed(1) + ' ms');

  /* 再测一次"只多展开一条"的增量代价（用户点角标的体感） */
  treeExpandAll(false); await sleep(200);
  const tf = document.querySelector('#branch-tree .cap .tf');
  const t2 = performance.now();
  if (tf) tf.click();
  const tOne = performance.now() - t2;
  out.push('点一个角标展开一条：' + tOne.toFixed(1) + ' ms（展开后 ' + treeCells.length + ' 颗 / ' + treeLanes + ' 行）');

  /* 零接触自查（在最复杂的那一帧上做） */
  treeExpandAll(true); await sleep(100);
  const R = STP / 2 - 1;
  const d2s = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  let bad = 0, worst = 999, worstAt = '';
  for (const c of treeCells) {
    const pp = treePosOf.get(c.node._p);
    if (!pp) continue;
    const x1 = stoneX(pp.d) + STP / 2, y1 = stoneCy(pp.r);
    const x2 = stoneX(c.depth) + STP / 2, y2 = stoneCy(c.row);
    for (const o of treeCells) {
      const ox = stoneX(o.depth) + STP / 2, oy = stoneCy(o.row);
      if (Math.hypot(ox - x1, oy - y1) < 1 || Math.hypot(ox - x2, oy - y2) < 1) continue;
      const d = d2s(ox, oy, x1, y1, x2, y2);
      if (d < worst) { worst = d; worstAt = '第' + o.depth + '手'; }
      if (d < R) bad++;
    }
  }
  out.push('全展开后零接触自查：过近 ' + bad + ' 处；最近距离 ' + worst.toFixed(1) + 'px（珠半径 ' + R + '）' + (bad ? ' @' + worstAt : ' ✓'));
  treeExpandAll(false); await sleep(150);
  return out.join('\\n');
})()`, 120000));
ws.close();
process.exit(0);
