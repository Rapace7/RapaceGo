/* 轮次（该谁走）回归 —— 2026-10-15 首相报的「连续两手都是白方下棋」
 *
 * 用法：node dev/_cdp_color.mjs [端口]（先起 dev\\_start_cdp.bat 那个实例）
 *
 * 背景（根因）：`state.toMove` 的语义是「**末端**该谁走」，但树上的几个操作
 *   （提升主变 / 删除分支 / 撤销删除）原来按 **viewAt** 重算它 —— 回看态下 viewAt ≠ 手数末端，
 *   算出来的轮次是偏的；之后用户把视图挪回末端再落子，用的还是那个偏值 → **同一方连下两子**。
 *
 * 断言分两层：
 *   ① 定点复现：走"开旁支 → 回看中间 → 提升主变 → 跳回末端 → 落子"，
 *      每一步都要求 `state.toMove === sideToMove(state.moves.length)`，且落子的颜色必须与上一手相反；
 *   ② 随机对拍：400 步随机操作（落子/回看/换分支/提升/删除/撤销/悔棋/停一手/试下/跳末端），
 *      每步都查同一条不变式 + 整棵树颜色交替 —— 这类 bug 靠人点很难碰上，靠随机才碰得到。
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
  const out = { fixed: {}, errors: [] };
  const G = s => { const m = /^([A-HJ-T])(\\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  const treeBad = () => {
    const bad = [];
    (function walk(n, d) {
      for (const c of (n._cs || [])) { const i = d + 1; if (c.color !== sideToMove(i - 1)) bad.push(i + ':' + c.color); walk(c, i); }
    })(branchRoot, 0);
    return bad;
  };
  const state0 = tag => {
    const exp = sideToMove(state.moves.length);
    const last = state.moves.length ? state.moves[state.moves.length - 1] : null;
    return { tag, moves: state.moves.length, viewAt: state.viewAt, toMove: state.toMove, exp,
             toMoveOK: state.toMove === exp, lastColor: last ? last.color : null, treeBad: treeBad() };
  };
  try {
    if (state.draft) exitDraft();
    applyNewGame(); settings.mode = 'free';
    for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(q); tryPlay(c.x, c.y); }
    out.fixed['0 主线 5 手'] = state0('主线 5 手');
    /* 开旁支：回看第 3 手 → 落两手 */
    gotoNode(state.moves[2]);
    const k = G('K10'); tryPlay(k.x, k.y);
    const l = G('L10'); tryPlay(l.x, l.y);
    out.fixed['1 旁支 2 手'] = state0('旁支末端');
    /* ★ 关键：回看到旁支中间那一手，再「提升主变」——
       这一步会让 viewAt(=提升的那一手) 与 moves.length(完整路径) 错开；
       旧代码就是在这里把 toMove 按 viewAt 算错的。 */
    gotoView(4);
    promoteToMainline(4);
    out.fixed['2 回看中间 + 提升主变'] = state0('提升后');
    /* 跳回末端（gotoView 不改 toMove —— 旧代码的错值就留在这里） */
    gotoView(state.moves.length);
    out.fixed['3 跳回末端'] = state0('跳回末端');
    /* 落一手：颜色必须与上一手相反 */
    const before = state.moves.length, lastC = state.moves[before - 1].color;
    const q = G('Q10'); tryPlay(q.x, q.y);
    const m = state.moves[state.moves.length - 1];
    out.fixed['4 落一手'] = Object.assign(state0('落子后'), { played: m ? m.color : null, prev: lastC, sameColour: m ? (m.color === lastC) : null });

    /* ---------- 随机对拍 ---------- */
    if (state.draft) exitDraft();
    applyNewGame(); settings.mode = 'free';
    for (let i = 0; i < 4; i++) tryPlay(3 + i, 3 + i);
    const allNodes = () => { const a = []; (function w(n) { for (const c of (n._cs || [])) { a.push(c); w(c); } })(branchRoot, 0); return a; };
    const ops = [
      () => tryPlay(2 + Math.floor(Math.random() * 15), 2 + Math.floor(Math.random() * 15)),
      () => { gotoView(Math.floor(Math.random() * (state.moves.length + 1))); },
      () => cycleBranch(Math.random() < 0.5 ? -1 : 1),
      () => promoteToMainline(state.viewAt),
      () => deleteBranchAt(state.viewAt, { force: true }),
      () => undoDeleteBranch(),
      () => $('btn-undo').click(),
      () => $('btn-pass').click(),
      () => { const a = allNodes(); if (a.length) gotoNode(a[Math.floor(Math.random() * a.length)]); },
      () => { if (state.draft) exitDraft(); else enterDraft(); },
      () => gotoView(state.moves.length),
    ];
    let fuzzFail = null;
    for (let i = 0; i < 400 && !fuzzFail; i++) {
      const kk = Math.floor(Math.random() * ops.length);
      try { ops[kk](); } catch (e) { /* 无效操作（例如回看中不能落子）不算失败 */ }
      const exp = sideToMove(state.moves.length);
      if (state.toMove !== exp) fuzzFail = { step: i, op: kk, toMove: state.toMove, exp, moves: state.moves.length, viewAt: state.viewAt };
      else if (treeBad().length) fuzzFail = { step: i, op: kk, treeBad: treeBad() };
    }
    out.fuzz = { steps: 400, fail: fuzzFail };
    if (state.draft) exitDraft();
  } catch (e) { out.errors.push(String(e && e.stack || e).slice(0, 300)); }
  return JSON.stringify(out);
})()`;

const raw = await js(expr);
ws.close();
if (typeof raw !== 'string' || raw.startsWith('ERR')) { console.log('✗ 求值失败: ' + raw); process.exit(1); }
const r = JSON.parse(raw);
const f = r.fixed || {};
const checks = [
  ['①0 起步：主线 5 手时轮次正确', f['0 主线 5 手'] && f['0 主线 5 手'].toMoveOK === true],
  ['①1 开旁支后轮次正确', f['1 旁支 2 手'] && f['1 旁支 2 手'].toMoveOK === true],
  ['①2 **回看中间 + 提升主变后轮次仍正确**（旧代码在这里开始错）', f['2 回看中间 + 提升主变'] && f['2 回看中间 + 提升主变'].toMoveOK === true],
  ['①3 跳回末端后轮次仍正确', f['3 跳回末端'] && f['3 跳回末端'].toMoveOK === true],
  ['①4 **落下的子与上一手颜色相反**（不是连续同色）', f['4 落一手'] && f['4 落一手'].sameColour === false],
  ['② 400 步随机操作：轮次始终正确、树里颜色始终交替', r.fuzz && r.fuzz.fail === null],
  ['无运行时异常', r.errors.length === 0]
];
let bad = 0;
for (const [n, ok] of checks) { console.log((ok ? '  ✓ ' : '  ✗ ') + n); if (!ok) bad++; }
console.log(JSON.stringify(r, null, 1).slice(0, 2200));
console.log(bad === 0 ? '\n轮次回归：全绿 ' + checks.length + '/' + checks.length : '\n轮次回归：失败 ' + bad + ' 项');
process.exit(bad === 0 ? 0 : 1);
