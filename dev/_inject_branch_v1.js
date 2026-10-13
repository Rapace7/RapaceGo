/* 手数分支（真分支树）的回归断言 —— 2026-10-13 下午 DSH 写的。
 * 用法：先起带调试端口的实例，再  node dev/_cdp_run.mjs ./_inject_branch_v1.js
 *
 * 覆盖：
 *   A 回看时落子 = 开新分支（原「回看中不能落子」已改成开分支）
 *   B 旧分支整枝仍在树里（节点 _cs 挂得住，pathFromRoot 能回去）
 *   C ↑/↓ 切分支：moves 换成另一条路径、能切回、末端对齐
 *   D 同着不建重复（决策 9：与已有旁支同着 → 跳过去）
 *   E 讲解跟着分支走：离开路径的讲解寄到节点 _ex，切回来能放回按手号的口袋
 *   F 无分支时行为不变（老行为回归：末端落子、列表无 ⑂ 标记）
 *   G 分叉后 boardAt / toMove / viewAt 自洽
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const G = s => { const m = /^([A-T])(\d+)$/.exec(s); return { x: m[1].charCodeAt(0) - 65, y: 19 - parseInt(m[2], 10) }; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  for (const p of ['D4', 'Q16', 'D16', 'Q4', 'C6', 'E3', 'F3', 'C4', 'E7', 'R14']) { const c = G(p); tryPlay(c.x, c.y); }
  await sleep(150);
  ok('前置：正式 10 手', state.moves.length === 10 && state.moves[8].x === G('E7').x, state.moves.length);

  /* ---------- F：无分支时列表不标 ---------- */
  const noBr = document.querySelectorAll('#movelist .br').length;
  ok('F1 无分支时列表上没有 ⑂ 标记', noBr === 0, noBr);

  /* ---------- A：回看第 5 手落子 → 开新分支 ---------- */
  gotoView(5); await sleep(60);
  const oldMoves = state.moves.slice();
  const oldChild6 = oldMoves[5];                       // 旧分支的第 6 手（E3）
  const p = G('K10');
  const played = tryPlay(p.x, p.y);                    // ★ 回看中落子
  await sleep(120);
  ok('A1 回看中能落子（不再被挡）', played === true);
  ok('A2 主线截到分叉点再长出手 → 6 手', state.moves.length === 6, state.moves.length);
  ok('A3 新分支第 6 手就是刚下的 K10', state.moves[5].x === p.x && state.moves[5].y === p.y);
  ok('A4 viewAt 跟着走到末端', state.viewAt === 6, state.viewAt);
  ok('A5 轮次自洽', state.toMove === sideToMove(state.viewAt));

  /* ---------- B：旧分支还在树里 ---------- */
  const parent5 = state.moves[4];                      // 第 5 手节点（分叉点的父亲）
  ok('B1 分叉点的父亲有两个孩子（旧 + 新）', parent5._cs.length === 2, parent5._cs.length);
  ok('B2 旧分支第 6 手（E3）仍在孩子里', parent5._cs.indexOf(oldChild6) >= 0);
  ok('B3 新分支排在第 2 位（不抢主线）', parent5._cs[1] === state.moves[5]);

  /* ---------- E：讲解跟着分支走 ---------- */
  state.coach.explain[9] = { cv: 999, head: 'SENT9', body: 'x' };   // 挂在旧分支第 9 手上
  const exBefore = !!state.coach.explain[9];
  ok('E0 前置：旧分支第 9 手有讲解', exBefore);

  /* ---------- C：切分支 ---------- */
  gotoView(5); await sleep(60);
  const sw1 = cycleBranch(1); await sleep(120);
  ok('C1 切到另一条分支', sw1 === true);
  ok('C2 走的是旧分支（第 6 手 = E3）', state.moves.length === 10 && state.moves[5] === oldChild6,
    state.moves.length + ' / ' + (state.moves[5] && GTP_COLS[state.moves[5].x] + (19 - state.moves[5].y)));
  ok('C3 切回来时讲解放回按手号的口袋', !!state.coach.explain[9] && state.coach.explain[9].head === 'SENT9');
  gotoView(5); await sleep(60);
  const sw2 = cycleBranch(1); await sleep(120);
  ok('C4 再切一下回到新分支（第 6 手 = K10）', state.moves.length === 6 && state.moves[5].x === p.x, state.moves.length);
  ok('C5 离开旧分支后讲解寄到节点 _ex 上（没丢）', !state.coach.explain[9], 'explain[9]=' + JSON.stringify(state.coach.explain[9] || null));

  /* ---------- D：同着不建重复 ---------- */
  gotoView(5); await sleep(60);
  const before = parent5._cs.length;
  const again = tryPlay(p.x, p.y); await sleep(100);
  ok('D1 同着再下一次（跳到已有节点，不建重复）', parent5._cs.length === before && state.moves.length === 6,
    'cs=' + parent5._cs.length + ' moves=' + state.moves.length);

  /* ---------- G：盘面自洽 ---------- */
  const b6 = boardAt(6);
  ok('G1 boardAt(6) 上有 K10 那颗子', b6[idx(p.x, p.y)] !== 0, b6[idx(p.x, p.y)]);
  ok('G2 列表出现分支标记了', document.querySelectorAll('#movelist .br').length >= 1,
    document.querySelectorAll('#movelist .br').length);
  ok('G3 第 6 行标的是 2 种走法', (function () {
    const li = [...document.querySelectorAll('#movelist li')].find(e => e.getAttribute('data-n') === '6');
    const br = li && li.querySelector('.br');
    return !!br && /\/2/.test(br.textContent);
  })());

  /* ---------- 收尾 ---------- */
  applyNewGame(); await sleep(150);
  ok('收尾：新对局清掉分支树', state.moves.length === 0 && branchRoot === null);
  return L.join('\n');
})()
