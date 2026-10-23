/* 2026-10-23 第二轮审查：计时错方 · 新对局顶掉当前盘 · 注释乱码 —— 逐条钉住。 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const fresh = async (clock) => {
    settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
    settings.clock = clock || 'none';
    N = 19; applyNewGame(); state.noGame = false; await sleep(200);
  };
  const pts = [[3, 3], [15, 15], [3, 15], [15, 3], [9, 9], [9, 3]];

  /* ===== T1 回看中落子：扣的是**落子方**的时间 ===== */
  await fresh('rapid');                       // 无每手加时，便于比较
  for (let i = 0; i < 4; i++) { tryPlay(pts[i][0], pts[i][1]); await sleep(120); }
  const b0 = state.clock.b.t, w0 = state.clock.w.t;
  gotoView(1); await sleep(350);
  tryPlay(pts[1][0], pts[1][1]);              // 回看第 1 手，落第 2 手（白）
  await sleep(120);
  const dW = w0 - state.clock.w.t, dB = b0 - state.clock.b.t;
  ok('T1 回看落第 2 手（白）→ 扣白方时间、黑方不动', dW > 0.05 && Math.abs(dB) < 0.02,
    '扣白=' + dW.toFixed(2) + 's 扣黑=' + dB.toFixed(2) + 's');
  ok('T1b 落子后"轮到谁"与手数一致（第 2 手后轮到黑）', state.clock.side === 'b', 'side=' + state.clock.side);

  /* ===== T2 悔棋后"轮到谁"跟着手数走 ===== */
  await fresh('rapid');
  for (let i = 0; i < 3; i++) { tryPlay(pts[i][0], pts[i][1]); await sleep(120); }
  const sideBefore = state.clock.side;
  $('btn-undo').onclick(); await sleep(200);
  ok('T2 悔棋后 side 回到「该谁走」（3 手→2 手，轮到黑）',
    state.clock.side === 'b' && state.moves.length === 2,
    'before=' + sideBefore + ' after=' + state.clock.side + ' moves=' + state.moves.length);
  const c0 = state.clock.b.t;
  await sleep(400);
  ok('T2b 校准后时间仍照常走（没有把表停掉）', state.clock.b.t <= c0 + 0.01, 'b=' + state.clock.b.t);

  /* ===== T3 新建对局会先问（当前这盘还没导出） ===== */
  await fresh();
  tryPlay(3, 3); await sleep(80); tryPlay(15, 15); await sleep(80);
  const pr = $('m-start').onclick();           // 不 await：弹窗要挂住
  await sleep(250);
  const mask = $('delbranch');
  const opened = mask.classList.contains('open');
  ok('T3 当前这盘有内容时，点「新对局 → 开始」先弹确认', opened === true);
  if (opened) {
    ok('T3b 确认窗标题是「新建对局」', $('db-title').textContent === '新建对局', $('db-title').textContent);
    $('db-cancel').onclick(); await pr; await sleep(150);
    ok('T3c 点「取消」后棋盘原封不动', state.moves.length === 2, 'moves=' + state.moves.length);
  }
  /* 空盘时不该问 */
  await fresh();
  const pr2 = $('m-start').onclick(); await sleep(200);
  ok('T3d 空盘时点「新对局」不弹窗（直接开）', !mask.classList.contains('open'));
  await pr2; await sleep(100);

  /* ===== T4 打谱按记录落子：这一手自带的解说词 / 讲解不能被当成"旧棋"清掉 ===== */
  const SGF = '(;FF[4]SZ[19]'
    + '(;B[pd];W[dp];B[pq];W[dd];B[qo];W[do];B[pn];W[dn];B[jj];W[qj]'
    + ';B[pj];W[qk];B[ok];W[ql]'
    + '(;B[pl]C[第15手：这一手拆边很扎实。];W[rk];B[ol];W[qm];B[om];W[rn])'
    + '(;B[kk];W[ll])))';
  applyRecord(parseSGF(SGF), 'audit2.sgf'); await sleep(320);
  const m15 = { x: state.moves[14].x, y: state.moves[14].y };
  gotoView(14); await sleep(80);
  state.coach.explain[15] = { head: '第15手', body: '这条线自己的讲解', ver: COACH_VER, ok: true };
  ok('T4 前置：第 15 手有棋谱解说词', !!(state.sgfComments && state.sgfComments[15]),
    JSON.stringify(state.sgfComments && state.sgfComments[15] || null));
  tryPlay(m15.x, m15.y); await sleep(180);
  ok('T4b 按记录落第 15 手后，它自带的解说词还在',
    !!(state.sgfComments && state.sgfComments[15]),
    JSON.stringify(state.sgfComments && state.sgfComments[15] || null));
  /* ★ 这条才是修前的真症状：复用同一手时 clearCoachAt 把这一手的讲解清掉了 */
  ok('T4c 复用同一手时，这一手自己的讲解不被清掉',
    !!(state.coach.explain && state.coach.explain[15]),
    JSON.stringify(state.coach.explain && state.coach.explain[15] || null));

  /* ===== T5 restore 不拿旧评估盖掉更准的新值 ===== */
  (function () {
    const node = state.moves[14];
    node._an = { h: 0.10, l: 0, v: 100 };
    state.history[15] = 0.50; state.leads[15] = 3; state.histVisits[15] = 500;
    restoreAnalysisForPath();
    ok('T5 节点上寄存的旧值（100 搜索量）不会盖掉已有的 500 搜索量结果',
      state.history[15] === 0.50, 'h=' + state.history[15]);
  })();

  await fresh();
  return L.join('\n');
})();
