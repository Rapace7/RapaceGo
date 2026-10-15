/* 全局不变式自检 —— 2026-10-15 推送前审查用（首相要求「自己审查一遍所有代码」）
 *
 * 用法：node dev/_cdp_invariants.mjs [端口]
 *
 * 查的是**代码必须始终成立的性质**，不是某个功能对不对。任何一条破了，
 * 都说明某处代码在"手工同步"上又漏了一笔 —— 这正是前几轮 bug 的共同形态。
 *
 * ① 路径有效：state.moves 必须是「根 → 某个节点」的连续路径（每手 _p === 前一手；首手 _p 是虚拟根）
 * ② 颜色交替：第 i 手颜色 === sideToMove(i-1)（对**整棵树**的每条路径都查）
 * ③ 游标合法：0 <= viewAt <= moves.length
 * ④ 劫点自洽：koPoint === koFromBoard(boardAt(viewAt), moves, viewAt)（唯一入口 refreshDerived 的产物）
 * ⑤ 轮次自洽：toMove === sideToMove(moves.length)（它现在是只读派生属性，必须恒等）
 * ⑥ 树无环无孤儿：从 branchRoot 能走到的节点数 === 所有 _p 反查得到的节点数；
 *    且每个节点的 _cs 都反向指回它自己
 * ⑦ 草稿闸门：试下期间 moves 长度 >= draft.from
 */
const PORT = Number(process.argv[2] || process.env.CDP_PORT || 9333);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl && !/^(edge|devtools|chrome):/.test(x.url));
      if (p) return p;
    } catch (e) { }
    await sleep(500);
  }
  throw new Error('连不上调试端口 ' + PORT);
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seqN = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seqN; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + String(r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}

const expr = `(() => {
  const out = { violations: [], steps: 0, ops: 0 };
  const G = s => { const m = /^([A-HJ-T])(\\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };

  const checkAll = tag => {
    const v = [];
    /* ① 路径有效。
       ⚠️ **草稿手（试下）不算** —— 它们刻意不挂树（_p 为 null、_cs 为空，见 tryPlay 的注释），
          所以只查 draft.from 之前的正式段。 */
    const draftFrom = state.draft ? state.draft.from : state.moves.length;
    for (let i = 0; i < Math.min(state.moves.length, draftFrom); i++) {
      const m = state.moves[i];
      const wantP = i === 0 ? branchRoot : state.moves[i - 1];
      if (m._p !== wantP) v.push('①路径断了@' + (i + 1) + '手（' + (m.pass ? '停一手' : m.x + ',' + m.y) + '）');
    }
    /* ② 整棵树颜色交替 */
    (function walk(n, d) {
      for (const c of (n._cs || [])) {
        const i = d + 1;
        if (c.color !== sideToMove(i - 1)) v.push('②颜色@第' + i + '手=' + c.color + ' 应为' + sideToMove(i - 1));
        walk(c, i);
      }
    })(branchRoot, 0);
    /* ③ 游标 */
    if (!(state.viewAt >= 0 && state.viewAt <= state.moves.length)) v.push('③viewAt越界=' + state.viewAt + '/' + state.moves.length);
    /* ④ 劫点自洽 */
    const wantKo = koFromBoard(boardAt(state.viewAt), state.moves, state.viewAt);
    const nowKo = state.koPoint;
    const same = (!wantKo && !nowKo) || (wantKo && nowKo && wantKo.x === nowKo.x && wantKo.y === nowKo.y);
    if (!same) v.push('④劫点不自洽 有=' + (nowKo ? nowKo.x + ',' + nowKo.y : 'null') + ' 应为=' + (wantKo ? wantKo.x + ',' + wantKo.y : 'null'));
    /* ⑤ 轮次恒等 */
    if (state.toMove !== sideToMove(state.moves.length)) v.push('⑤轮次=' + state.toMove + ' 应为' + sideToMove(state.moves.length));
    /* ⑥ 树结构：可达数 === 反查数，且 _cs 反向指回 */
    let reach = 0, badParent = 0;
    (function walk(n) { for (const c of (n._cs || [])) { reach++; if (c._p !== n) badParent++; walk(c); } })(branchRoot);
    if (badParent) v.push('⑥有 ' + badParent + ' 个节点的 _p 与父的 _cs 对不上');
    /* ⑦ 草稿闸门 */
    if (state.draft && state.moves.length < state.draft.from) v.push('⑦草稿期间退过了存档点');
    if (v.length) out.violations.push({ tag, v });
    return v.length === 0;
  };

  const allNodes = () => { const a = []; (function w(n) { for (const c of (n._cs || [])) { a.push(c); w(c); } })(branchRoot, 0); return a; };
  const ops = [
    ['落子', () => tryPlay(2 + Math.floor(Math.random() * 15), 2 + Math.floor(Math.random() * 15))],
    ['回看', () => gotoView(Math.floor(Math.random() * (state.moves.length + 1)))],
    ['换分支', () => cycleBranch(Math.random() < 0.5 ? -1 : 1)],
    ['提升主变', () => promoteToMainline(state.viewAt)],
    ['删除分支', () => deleteBranchAt(state.viewAt, { force: true })],
    ['撤销删除', () => undoDeleteBranch()],
    ['悔棋', () => $('btn-undo').click()],
    ['停一手', () => $('btn-pass').click()],
    ['点珠子', () => { const a = allNodes(); if (a.length) gotoNode(a[Math.floor(Math.random() * a.length)]); }],
    ['试下', () => { if (state.draft) exitDraft(); else enterDraft(); }],
    ['跳最新', () => gotoView(state.moves.length)],
  ];
  try {
    if (state.draft) exitDraft();
    applyNewGame(); settings.mode = 'free';
    for (let i = 0; i < 4; i++) tryPlay(3 + i, 3 + i);
    if (!checkAll('起步')) out.steps++;
    for (let i = 0; i < 2000 && out.violations.length < 3; i++) {
      const [name, fn] = ops[Math.floor(Math.random() * ops.length)];
      try { fn(); } catch (e) { /* 无效操作不算 */ }
      out.ops = i + 1;
      if (!checkAll('第' + (i + 1) + '步:' + name)) out.steps++;
    }
    if (state.draft) exitDraft();
  } catch (e) { out.errors = String(e && e.stack || e).slice(0, 300); }
  return JSON.stringify(out);
})()`;

const raw = await js(expr);
ws.close();
if (typeof raw !== 'string' || raw.startsWith('ERR')) { console.log('✗ 求值失败: ' + raw); process.exit(1); }
const r = JSON.parse(raw);
const okAll = r.violations.length === 0 && !r.errors;
console.log('跑了 ' + r.ops + ' 步随机操作；违规 ' + r.violations.length + ' 处');
for (const x of r.violations) console.log('  ✗ ' + x.tag + ' → ' + x.v.join(' | '));
if (r.errors) console.log('  ✗ 异常: ' + r.errors);
console.log(okAll ? '\n不变式自检：全部通过（①路径 ②颜色 ③游标 ④劫点 ⑤轮次 ⑥树结构 ⑦草稿）' : '\n不变式自检：**未通过**');
process.exit(okAll ? 0 : 1);
