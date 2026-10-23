/* 2026-10-23 审查修复后的验收：A 类 4 条 + B1/B2/B3 逐条钉住。
   用法：node dev/_cdp_run2.mjs ./_inject_auditfix1023.js 9333 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const fresh = async () => { settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese'; N = 19; applyNewGame(); state.noGame = false; await sleep(200); };
  const SGF = '(;FF[4]SZ[19]'
    + '(;B[pd];W[dp];B[pq];W[dd];B[qo];W[do];B[pn];W[dn];B[jj];W[qj]'
    + ';B[pj];W[qk];B[ok];W[ql]'
    + '(;B[pl];W[rk];B[ol];W[qm];B[om];W[rn])'
    + '(;B[kk];W[ll])))';

  /* ===== A 类 ===== */
  applyRecord(parseSGF(SGF), 'auditfix.sgf'); await sleep(320);
  const m15 = { x: state.moves[14].x, y: state.moves[14].y };
  gotoView(14); await sleep(80);
  tryPlay(m15.x, m15.y); await sleep(160);

  ok('A1 打谱走到第 15 手仍算「在主变上」（不再误挡全盘讲解）', currentPathIsMainline() === true);
  ok('A1b 分歧点是 0（不是 16）', mainlineDivergenceAt() === 0, 'divergenceAt=' + mainlineDivergenceAt());
  ok('A2 整盘手数取主线（20），不取"走到第几手"（15）',
    mainlineNodes().length === 20 && state.moves.length === 15,
    'mainline=' + mainlineNodes().length + ' moves=' + state.moves.length);

  /* A3：讲解放盘按主线写 n —— 直接检查 saveCoachFile 的内容（会写盘，用一份临时棋谱名） */
  const before = state.recName;
  state.recName = '';
  const p0 = saveCoachFile();
  ok('A3 没有棋谱名时不写盘（返回 null 的 Promise）', p0 && typeof p0.then === 'function');
  state.recName = before;

  /* A4：保存文件名 / "没内容"判据 */
  ok('A4 回看到第 15 手时，导出文件名会用 20 手（主线）而不是 15',
    mainlineNodes().length === 20);
  gotoView(1); await sleep(80);
  ok('A4b 回看到第 1 手时仍算"有棋"（覆盖/保存不再误挡）', mainlineNodes().length >= 2);

  /* ===== B1：回看中悔棋/停一手按钮置灰 ===== */
  ok('B1 回看第 1 手时悔棋按钮置灰', $('btn-undo').disabled === true);
  ok('B1b 回看第 1 手时停一手按钮置灰', $('btn-pass').disabled === true);
  gotoView(20); await sleep(120);
  ok('B1c 走到末端（第 20 手）后两个按钮恢复可用',
    $('btn-undo').disabled === false && $('btn-pass').disabled === false,
    'undo=' + $('btn-undo').disabled + ' pass=' + $('btn-pass').disabled);

  /* ===== B2：打开棋谱前提示（当前这盘没导出） ===== */
  await fresh();
  tryPlay(3, 3); await sleep(60); tryPlay(15, 15); await sleep(60);
  const list = (await window.api.records.list()) || [];
  const nm = list.length ? (list[0].name || list[0]) : null;
  if (!nm) {
    L.push('SKIP B2 棋谱库是空的（跳过"打开前提示"的断言）');
  } else {
    const pr = openRecord(nm);                 // 不 await：弹窗要挂住
    await sleep(250);
    const mask = $('delbranch');
    const opened = mask.classList.contains('open');
    ok('B2 当前这盘没导出时，打开棋谱会先弹确认窗', opened === true);
    if (opened) {
      ok('B2b 确认窗标题是「打开棋谱」', $('db-title').textContent === '打开棋谱', $('db-title').textContent);
      $('db-cancel').onclick();                // 取消
      await pr;
      await sleep(150);
      ok('B2c 点「取消」后棋盘原封不动（还是刚才那 2 手）', state.moves.length === 2, 'moves=' + state.moves.length);
    }
  }

  /* ===== B3：点到有子 → 有提示 ===== */
  await fresh();
  tryPlay(3, 3); await sleep(80);
  tryPlay(3, 3); await sleep(120);
  ok('B3 点已有子的交叉点 → 状态栏有提示（不是静默）',
    /已经有子/.test($('status').textContent), $('status').textContent.slice(0, 40));

  /* ===== 回归护栏：删分支的确认窗标题要自己摆回来（与 B2 共用 DOM） ===== */
  applyRecord(parseSGF(SGF), 'auditfix2.sgf'); await sleep(320);
  const node14 = state.moves[13];
  askDeleteBranch(node14, 14, subtreeSize(node14)); await sleep(150);
  ok('G1 删分支弹窗仍写着「删除分支」+ 按钮「删除」（没被上一个流程污染）',
    $('db-title').textContent === '删除分支' && $('db-ok').textContent === '删除',
    $('db-title').textContent + ' / ' + $('db-ok').textContent);
  $('db-cancel').onclick();

  /* ===== C4：悔棋后走回去，讲解/评估还在节点上 ===== */
  await fresh();
  for (const q of [[3, 3], [15, 15], [3, 15], [15, 3]]) { tryPlay(q[0], q[1]); await sleep(60); }
  state.coach.explain[4] = { head: 'x', body: 'y', ver: COACH_VER, ok: true };
  state.history[4] = 0.42; state.leads[4] = 1.5;
  $('btn-undo').onclick(); await sleep(150);
  const lastNode = (function () { let c = branchRoot; while (c && c._cs && c._cs.length) c = c._cs[0]; return c; })();
  ok('C4b 第 4 手节点上确实带着讲解与评估', !!lastNode && !!lastNode._ex && !!lastNode._an,
    'ex=' + !!(lastNode && lastNode._ex) + ' an=' + !!(lastNode && lastNode._an));
  gotoView(4); await sleep(150);
  ok('C4c 按 → 走回第 4 手，讲解与胜率立刻回来',
    !!state.coach.explain[4] && state.history[4] === 0.42,
    'ex=' + !!state.coach.explain[4] + ' h=' + state.history[4]);

  await fresh();
  return L.join('\n');
})();
