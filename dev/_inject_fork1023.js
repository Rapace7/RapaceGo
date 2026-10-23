/* 2026-10-23 首相报：回看到第 14 手 → 按棋谱记录下第 15 手 → 直接跳到该分支最后一手。
 * 复现 + 回归断言。构造 5 手棋（不依赖棋谱文件，避坑位 31 撞子）。
 *
 * 期望口径（照 Sabaki 的做法）：
 *   · 落在**树上已有的手**上 → 视图停在这一手（Sabaki: appendNode 合并到已有子节点 → setCurrentTreePosition 到该节点）
 *   · 尾巴不丢：翻页 / 滑杆 / 跳末仍能沿树走到整条支的末端
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const fresh = async () => { settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese'; N = 19; applyNewGame(); state.noGame = false; await sleep(200); };
  const pts = [[3, 3], [15, 15], [3, 15], [15, 3], [9, 9]];

  /* ---------- 造一个 5 手的局 ---------- */
  await fresh();
  for (const p of pts) { tryPlay(p[0], p[1]); await sleep(60); }
  ok('前置：5 手', state.moves.length === 5, 'moves=' + state.moves.length);

  /* ---------- A 回看中按记录落子：停在第 4 手 ---------- */
  gotoView(3); await sleep(80);
  ok('A0 前置：回看到第 3 手（路径仍 5 手）', state.viewAt === 3 && state.moves.length === 5,
    'viewAt=' + state.viewAt + ' moves=' + state.moves.length);
  tryPlay(15, 3); await sleep(120);        // 第 4 手（树上已有）
  ok('A1 ★ 回看中按记录落第 4 手 → 视图停在第 4 手（修前：直接跳到第 5 手/该支末端）', state.viewAt === 4,
    'viewAt=' + state.viewAt + ' moves=' + state.moves.length);
  ok('A2 落子后路径也只到第 4 手', state.moves.length === 4, 'moves=' + state.moves.length);

  /* ---------- B 接着按记录落第 5 手（此时 viewAt === moves.length） ---------- */
  tryPlay(9, 9); await sleep(120);
  ok('B1 从第 4 手按记录落第 5 手 → 视图停在第 5 手', state.viewAt === 5,
    'viewAt=' + state.viewAt + ' moves=' + state.moves.length);

  /* ---------- C 悔棋后重下同一手：尾巴靠翻页够得着（P1-1 的承诺不能丢） ---------- */
  await fresh();
  for (const p of pts) { tryPlay(p[0], p[1]); await sleep(60); }
  $('btn-undo').onclick(); await sleep(100);
  $('btn-undo').onclick(); await sleep(150);
  ok('C0 前置：悔棋两次后 3 手', state.moves.length === 3, 'moves=' + state.moves.length);
  tryPlay(15, 3); await sleep(120);        // 重下原来第 4 手
  ok('C1 重下同一手 → 路径到第 4 手（不前跳）', state.moves.length === 4, 'moves=' + state.moves.length);
  gotoView(state.moves.length + 1); await sleep(120);   // → 键：前进一手
  ok('C2 ★ 重下后按 → 能走回第 5 手（P1-1：尾巴够得着）', state.viewAt === 5,
    'viewAt=' + state.viewAt + ' moves=' + state.moves.length);

  /* ---------- D 跳末：走到整条支的末端 ---------- */
  await fresh();
  for (const p of pts) { tryPlay(p[0], p[1]); await sleep(60); }
  gotoView(2); await sleep(80);
  $('btn-last').onclick(); await sleep(150);
  ok('D1 回看中按「跳末」→ 走到这条支的最后一手', state.viewAt === 5,
    'viewAt=' + state.viewAt + ' moves=' + state.moves.length);

  /* ---------- E 切分支仍要看到那条支走到哪（2026-10-13 首相定的口径，不能改坏） ---------- */
  const rec = parseSGF('(;FF[4]SZ[19](;B[pd];W[dp];B[pq];W[dd])(;B[dd];W[pp];B[dc]))');
  applyRecord(rec, ''); await sleep(300);
  gotoView(0); await sleep(80);
  switchBranch(0, 1); await sleep(200);          // 分叉点在**第 0 手**（两条开局）
  ok('E1 切分支 → 沿新支走到尽头（旧口径不变）', state.viewAt === state.moves.length && state.viewAt === 3,
    'viewAt=' + state.viewAt + ' moves=' + state.moves.length);

  /* ---------- F 真实形态：**带变着的棋谱**，回看第 14 手，一手一手按记录走 ----------
     主线 20 手 + 第 14 手后一条旁支（与首相截图同一形态）。 */
  const SGF = '(;FF[4]SZ[19]'
    + '(;B[pd];W[dp];B[pq];W[dd];B[qo];W[do];B[pn];W[dn];B[jj];W[qj]'
    + ';B[pj];W[qk];B[ok];W[ql]'
    + '(;B[pl];W[rk];B[ol];W[qm];B[om];W[rn])'
    + '(;B[kk];W[ll])))';
  applyRecord(parseSGF(SGF), 'fork1023.sgf'); await sleep(320);
  ok('F0 前置：主线 20 手', state.moves.length === 20, 'moves=' + state.moves.length);
  const m15 = { x: state.moves[14].x, y: state.moves[14].y };
  const m16 = { x: state.moves[15].x, y: state.moves[15].y };

  gotoView(14); await sleep(100);
  tryPlay(m15.x, m15.y); await sleep(160);
  ok('F1 ★ 按记录落第 15 手 → 停在第 15 手（首相报的 bug）',
    state.viewAt === 15 && state.moves.length === 15, 'viewAt=' + state.viewAt + ' moves=' + state.moves.length);
  ok('F2 底栏总数仍是整条支的 20（不是 15）',
    $('counter').textContent === '15 / 20' && $('slider').max === '20',
    'counter=' + $('counter').textContent + ' max=' + $('slider').max);

  tryPlay(m16.x, m16.y); await sleep(160);
  ok('F3 接着按记录落第 16 手 → 停在第 16 手',
    state.viewAt === 16 && state.moves.length === 16, 'viewAt=' + state.viewAt + ' moves=' + state.moves.length);

  gotoView(20); await sleep(160);
  ok('F4 滑杆拉到第 20 手 → 能走到谱末（尾巴够得着）',
    state.viewAt === 20 && state.moves.length === 20, 'viewAt=' + state.viewAt + ' moves=' + state.moves.length);

  gotoView(14); await sleep(100);
  $('btn-last').onclick(); await sleep(160);
  ok('F5 第 14 手按「跳末」→ 走到第 20 手', state.viewAt === 20, 'viewAt=' + state.viewAt);

  gotoView(14); await sleep(100);
  const sib = (function () { ensureBranch(); const p = state.moves[13]; return p && p._cs ? p._cs.length : -1; })();
  ok('F6 第 14 手后仍是两条支（主线 + 旁支）', sib === 2, 'sib=' + sib);

  await fresh();
  return L.join('\n');
})();
