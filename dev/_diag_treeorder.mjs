/* 真实棋谱上验证首相报的两件事（合成树测不出来，必须用它自己那盘 181 手的谱）：
 *   ① 「最后展开的那条最靠主干」—— 逐个展开三个分支点，看**最后一个**的行号是不是最小的；
 *   ② 「展开/收起要保持在当前视野」—— 先把视野滚到中间，再展开/收起，看 scrollTop 有没有被甩走。
 * 用法：node dev/_diag_treeorder.mjs [端口] */
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
  const i = ++seq; const t = setTimeout(() => res({ timeout: true }), 90000);
  pending.set(i, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
});
const att = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const sid = att.result && att.result.sessionId;
const ev = async (expr, tmo) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 85000 }, sid);
  if (r.timeout) return 'TIMEOUT';
  if (r.result && r.result.exceptionDetails) return 'ERR ' + String(r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 3).join(' | ');
  return r.result && r.result.result && r.result.result.value;
};

console.log(await ev(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  const box = document.getElementById('branch-tree');
  try { await openRecord(${JSON.stringify(REC)}); } catch (e) { return 'ERR 打开: ' + e; }
  await sleep(1200);
  [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree').click();
  await sleep(400);

  /* 主变上所有"有侧支"的手数（角标挂在这些珠子上，data-d = 它的手数） */
  const mb = [];
  { let n = branchRoot, d = 0;
    for (;;) {
      const cs = n._cs || [];
      if (!cs.length) break;
      if (cs.length > 1 && d >= 1) mb.push(d);
      n = cs[0]; d += 1;
    } }
  out.push('主变上有侧支的手数：' + mb.slice(0, 24).join(',') + (mb.length > 24 ? ' …（共 ' + mb.length + ' 处）' : ''));

  /* ⚠️ 不能靠"找到角标再点"——`treePaint` 是**虚拟化的**，只渲染看得见的列，
     第 28 手的珠子在 5792px 宽里根本还没被画出来，`querySelector` 必然找不到（实测拿到行 -2）。
     改成走**同一个内部路径**：加进 treeExpanded + 发一个展开序号 + renderMoveTree()，
     与 `toggleTreeExpand` 做的事完全一致，也就覆盖了同样的布局代码。 */
  const mainNodeAt = d => { let n = branchRoot; for (let i = 0; i < d; i++) n = n._cs[0]; return n; };
  const expandNode = async (d) => {
    const node = mainNodeAt(d);
    if (!node || !(node._cs && node._cs.length > 1)) return false;
    if (!treeExpanded.has(node)) { treeExpanded.add(node); treeExpandSeq.set(node, ++treeExpandCounter); }
    else { treeExpanded.delete(node); treeExpandSeq.delete(node); }
    renderMoveTree();
    await sleep(160);
    return true;
  };
  const clickFold = expandNode;

  const rowOfFirstSide = (d) => {
    const node = mainNodeAt(d);
    const cs = node._cs || [];
    for (let i = 1; i < cs.length; i++) {
      const c = treeCells.find(x => x.node === cs[i]);
      if (c) return c.row;
    }
    return -1;
  };

  /* ---------- ① 逐个展开三个分支点，最后一个必须最靠上 ---------- */
  const picks = [];
  if (mb.length >= 3) {
    picks.push(mb[Math.floor(mb.length * 0.15)], mb[Math.floor(mb.length * 0.5)], mb[Math.floor(mb.length * 0.85)]);
  }
  const rows = [];
  for (const d of picks) {
    const okc = await clickFold(d);
    const r = okc ? rowOfFirstSide(d) : -2;
    rows.push({ d, r });
    out.push('  展开第 ' + d + ' 手的分支 → 它的第一颗珠子在**行 ' + r + '**（总行数 ' + treeLanes + '）');
  }
  if (rows.length === 3) {
    const last = rows[2], others = [rows[0].r, rows[1].r];
    out.push((last.r <= Math.min(...others) ? 'PASS ' : 'FAIL ')
      + '① 最后展开的（第 ' + last.d + ' 手，行 ' + last.r + '）是最靠上的吗？'
      + ' 参照：第 ' + rows[0].d + ' 手在行 ' + rows[0].r + '、第 ' + rows[1].d + ' 手在行 ' + rows[1].r);
  } else {
    out.push('① 分支点不够三个，跳过');
  }

  /* ---------- ② 视野：滚到中间，再展开 / 收起，看 scrollTop 有没有被甩走 ---------- */
  box.scrollTop = Math.floor((box.scrollHeight - box.clientHeight) * 0.5);
  box.scrollLeft = 0;
  await sleep(150);
  const before = box.scrollTop;
  const maxT = box.scrollHeight - box.clientHeight;
  const still = mb.find(d => !rows.some(x => x.d === d)) || mb[0];
  await clickFold(still); await sleep(200);
  const afterOpen = box.scrollTop;
  await clickFold(still); await sleep(200);
  const afterClose = box.scrollTop;
  out.push('② 视野：滚到 ' + Math.round(before) + '（可滚 ' + Math.round(maxT) + '）→ 展开后 ' + Math.round(afterOpen)
    + ' → 再收起后 ' + Math.round(afterClose));
  out.push((Math.abs(afterOpen - before) <= 8 && Math.abs(afterClose - before) <= 8 ? 'PASS ' : 'FAIL ')
    + '② 展开/收起时视野保住了吗（容差 8px）');

  /* ---------- ③ 全部展开性能 ---------- */
  const t0 = performance.now(); treeExpandAll(true); const dt = performance.now() - t0;
  out.push('③ 全部展开：' + treeCells.length + ' 颗 / ' + treeLanes + ' 行 / ' + dt.toFixed(0) + ' ms');
  treeExpandAll(false); await sleep(150);
  box.scrollTop = 0;
  return out.join('\\n');
})()`, 85000));
ws.close();
process.exit(0);
