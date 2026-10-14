/* 性能定位（分步求值 —— 每一步单独一次 Runtime.evaluate，卡在哪一步一目了然）。
 * 用法：node dev/_diag_treeperf2.mjs [端口] */
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
  const i = ++seq; const t = setTimeout(() => res({ timeout: true }), 60000);
  pending.set(i, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
});
const att = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const sid = att.result && att.result.sessionId;
const ev = async (expr, tmo) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 55000 }, sid);
  if (r.timeout) return 'TIMEOUT（>55s）';
  if (r.result && r.result.exceptionDetails) return 'ERR ' + String(r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result && r.result.result && r.result.result.value;
};

console.log('① 打开棋谱: ' + await ev(`(async () => {
  try { await openRecord(${JSON.stringify(REC)}); } catch (e) { return 'ERR ' + e; }
  await new Promise(r => setTimeout(r, 1200));
  return 'OK 手数 ' + state.moves.length;
})()`, 40000));

console.log('② 切树视图 + 默认收起计时: ' + await ev(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree').click();
  await sleep(400);
  const t0 = performance.now(); renderMoveTree(); const dt = performance.now() - t0;
  return treeCells.length + ' 颗 / ' + treeLanes + ' 行 / ' + dt.toFixed(1) + ' ms';
})()`, 40000));

console.log('③ 统计这盘棋的规模（支数 / 最大链长）: ' + await ev(`(() => {
  let branches = 0, maxChain = 0, nodes = 0, maxDepth = 0;
  (function walk(n, d) {
    const cs = n._cs || [];
    nodes += cs.length;
    if (cs.length > 1) branches += cs.length - 1;
    if (d > maxDepth) maxDepth = d;
    for (const c of cs) {
      let k = 0, m = c; while (m) { k += 1; m = (m._cs && m._cs[0]) || null; }
      if (k > maxChain) maxChain = k;
      walk(c, d + 1);
    }
  })(branchRoot, 0);
  return '节点 ' + nodes + ' / 总深度 ' + maxDepth + ' / 需要画的支 ' + branches + ' / 最长链 ' + maxChain;
})()`, 40000));

console.log('④ 全部展开计时: ' + await ev(`(async () => {
  const t1 = performance.now(); treeExpandAll(true); const dt = performance.now() - t1;
  return treeCells.length + ' 颗 / ' + treeLanes + ' 行 / ' + dt.toFixed(1) + ' ms';
})()`, 55000));

console.log('⑤ 收起: ' + await ev(`(async () => { treeExpandAll(false); await new Promise(r => setTimeout(r, 200)); return treeCells.length + ' 颗'; })()`, 30000));
ws.close();
process.exit(0);
