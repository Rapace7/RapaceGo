/* 行复用 + 穿心连线的验收（走 _cdp_run2.mjs 注入，别自己写 ws 客户端）。
 * 造「两条侧支列区间互不相交」的局面，验证首相 2026-10-13 定的三条：
 *   ① 前后不碰的侧支共用一行；② 下落线不穿中间行的珠子（不交叉）；③ 连线穿珠心。
 * 用法：node dev/_cdp_run2.mjs ./_inject_reuse.js 9333
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(300);
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6', 'E6', 'F3', 'P3']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  /* 侧支A：从第 3 手岔出，走 2 手（占列 4-5） */
  gotoView(3); await sleep(60);
  let a1 = G('K10'); tryPlay(a1.x, a1.y); await sleep(80);
  let a2 = G('L10'); tryPlay(a2.x, a2.y); await sleep(80);
  const nodeA1 = state.moves[3], nodeA2 = state.moves[4];
  /* 先切回主线（第 3 手分叉点的 _cs[0] 那条），否则 gotoView(7) 落在 A 支上、
     B 支会接成 A 的尾巴 —— 上一版 R1/R2 假失败就是这个时序错。 */
  switchBranch(3, 0); await sleep(120);
  gotoView(7); await sleep(60);
  let b1 = G('R10'); tryPlay(b1.x, b1.y); await sleep(80);
  let b2 = G('R14'); tryPlay(b2.x, b2.y); await sleep(80);
  const nodeB1 = state.moves[7], nodeB2 = state.moves[8];
  gotoView(8); await sleep(80);
  movesView = 'tree'; $('movelist').hidden = true; $('branch-tree').hidden = false;
  renderMoveTree(); await sleep(200);
  const box = $('branch-tree'); box.scrollLeft = 0; await sleep(150);
  const rowOf = n => { const c = treeCells.find(x => x.node === n); return c ? c.row : -1; };
  const rA = rowOf(nodeA1), rB = rowOf(nodeB1);

  ok('R1 两条侧支都在（A 行=' + rA + ' B 行=' + rB + '）', rA > 0 && rB > 0);
  ok('R2 前后不碰（列区间不相交）→ 共用同一行', rA === rB, 'A行' + rA + ' B行' + rB);
  ok('R3 没为它们白开新行（总行=2：主线+复用行）', treeLanes === 2, treeLanes);

  /* 下落线不穿中间行的珠子 */
  let crossings = 0;
  for (const b of treeBranches) {
    const lo = Math.min(b.fromRow, b.toRow) + 1, hi = Math.max(b.fromRow, b.toRow);
    for (let r = lo; r <= hi; r++) if (treeCells.some(c => c.row === r && c.depth === b.col)) crossings++;
  }
  ok('R4 下落线不穿过任何中间行的珠子（零交叉）', crossings === 0, crossings);

  /* 同一行不许两颗珠占同一列 */
  const seen = new Set(); let sameCell = 0;
  for (const c of treeCells) { const k = c.row + '_' + c.depth; if (seen.has(k)) sameCell++; seen.add(k); }
  ok('R5 无同行同列冲突', sameCell === 0, sameCell);

  /* 连线穿珠心：水平段左端 = 父列中心，右端 = 子列中心 */
  const ln = box.querySelector('.ln:not(.ln-br)');
  const cx = d => 6 + (d - 1) * TREE_W + STP / 2;
  ok('R6 水平连线端点落在两颗珠的中心列', !!ln &&
     Math.abs(parseFloat(ln.style.left) - cx(1)) < 1 &&
     Math.abs(parseFloat(ln.style.left) + parseFloat(ln.style.width) - cx(2)) < 1,
     ln ? (ln.style.left + ' + ' + ln.style.width) : '无');
  /* 侧支竖线从父珠心列起（left = 父列中心 - 1，宽 2px 居中） */
  const vline = box.querySelector('.ln.ln-br');
  const vOk = (() => {
    if (!vline) return false;
    const lx = parseFloat(vline.style.left);
    /* 侧支A 从第 3 手（列 3）岔出 → 竖线在 cx(3)-1 */
    return Math.abs(lx - (cx(3) - 1)) < 1 || Math.abs(lx - (cx(7) - 1)) < 1;
  })();
  ok('R7 侧支竖线挂在父珠中心列', vOk, vline ? vline.style.left : '无');

  /* 视觉：截图由外层做，这里只保证 DOM 有金圈主线 */
  ok('R8 主线串仍有金圈', box.querySelectorAll('.cap.main').length >= 8,
     box.querySelectorAll('.cap.main').length);

  applyNewGame(); await sleep(150);
  return L.join('\n');
})()
