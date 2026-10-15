/* _inject_fix1015.js —— 2026-10-15「全量修复」的回归断言（OpenCode 施工单那 40 条里，
   凡是**能在渲染进程里真跑出结果**的，一条一条钉住）。
   用法：双击 dev\_start_cdp.bat 起实例，再 node dev/_cdp_run2.mjs ./_inject_fix1015.js 9333

   ★ 每条都写明「修之前会怎样」—— 那是它变红的点，不是装饰。
   跨进程的那些（main.js 的编码/配置/生命周期/写盘）在 dev/_verify_enc_1015.mjs 与
   docs 的审查-OpenCode-20261015.md 里另有交代，这里不重复。 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  const fresh = async () => { settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese'; applyNewGame(); await sleep(230); };
  const put = (x, y) => { const r = tryPlay(x, y); return r; };

  /* ---------- P0-1 「生成讲解」不再一次点废 ---------- */
  await fresh();
  put(G('D4').x, G('D4').y); await sleep(90);
  let thr = '';
  try { pickPositionKey(1); } catch (e) { thr = String(e.message); }
  ok('P0-1 讲解的局面指纹可序列化（修前：循环引用抛 TypeError，按钮从此永久失效）', !thr, thr.slice(0, 50));
  ok('P0-1b 指纹能区分不同局面（不是恒等的常量）',
    pickPositionKey(0) !== pickPositionKey(1));

  /* ---------- P0-2 带摆子的棋谱「覆盖 / 导出」不再丢 AB/AW ---------- */
  await fresh();
  state.setup = [{ x: 3, y: 3, color: 'b' }, { x: 15, y: 15, color: 'b' }, { x: 3, y: 15, color: 'w' }];
  settings.handicap = 0;                    // ★ 打开棋谱之后就是这个状态（修前整段摆子不写）
  const sgfSetup = buildSGF();
  ok('P0-2 盘上有摆子就写出 AB/AW（修前：只看 settings.handicap，摆子全丢）',
    /AB\[/.test(sgfSetup) && /AW\[/.test(sgfSetup) && /HA\[2\]/.test(sgfSetup) === false,
    sgfSetup.slice(sgfSetup.indexOf('PB['), sgfSetup.indexOf('PB[') + 70));

  /* ---------- P1-1 悔棋后重下同一手，尾巴接得回来 ---------- */
  await fresh();
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(q); put(c.x, c.y); }
  await sleep(140);
  $('btn-undo').onclick(); $('btn-undo').onclick(); await sleep(140);
  ok('P1-1 前置：悔棋后 3 手', state.moves.length === 3, state.moves.length);
  const q4 = G('Q4'); put(q4.x, q4.y); await sleep(160);
  const tailLen = pathThrough(state.moves[state.moves.length - 1]).length;
  ok('P1-1 重下原来那一手 → 尾巴仍够得着（修前：moves 只有 4，树里却到 5，翻页全是静默空操作）',
    state.moves.length === 5 && state.moves.length === tailLen, 'moves=' + state.moves.length + ' pathThrough=' + tailLen);

  /* ---------- P2-1 打劫禁着点：不再依赖 captured/capAt ---------- */
  await fresh();
  /* ⚠️ 颜色由**轮次**决定（free 模式也是黑先交替）：第 1/3/5/7/9 手是黑，2/4/6/8 是白。
     劫形：白 (1,1) 被黑三面围住（(0,1)(1,0)(1,2)），只剩 (2,1) 一口气；
     黑落 (2,1) 提掉它，而这颗黑子也是孤子、也只剩 1 口气（那口气正是刚被提的点）→ 成劫。 */
  const seq = [[0, 1], [1, 1], [1, 0], [3, 1], [1, 2], [2, 0], [10, 10], [2, 2], [2, 1]];
  const made = [];
  for (const p of seq) made.push(put(p[0], p[1]));
  await sleep(160);
  ok('P2-1 前置：摆到第 9 手（黑）成劫', made[8] === true && state.moves.length === 9, 'moves=' + state.moves.length + ' 第9手=' + made[8]);
  ok('P2-1 前置：禁着点落在被提点', !!state.koPoint && state.koPoint.x === 1 && state.koPoint.y === 1, JSON.stringify(state.koPoint));
  for (const m of state.moves) { m.captured = undefined; m.capAt = undefined; }   // 派生字段全清掉（= 换路径后的真实状态）
  const ko2 = koFromBoard(boardAt(state.moves.length), state.moves, state.moves.length);
  ok('P2-1b 禁着点只读盘面就成立（修前：读 captured/capAt → 这里是 null，非法提回被放行）',
    !!ko2 && ko2.x === 1 && ko2.y === 1, JSON.stringify(ko2));
  ok('P2-1c 回提仍被拦住', put(1, 1) === false);

  /* ---------- P2-5 「第 1 手就分叉」时两条开局都在树上 ---------- */
  const rec5 = parseSGF('(;FF[4]SZ[19](;B[pd];W[dp])(;B[dd];W[pp]))');
  applyRecord(rec5, ''); await sleep(260);
  switchBranch(0, 1); await sleep(220);                 // 切到「另一下法」那条（分叉点在第 0 手）
  treeLayout();
  const d1n = treeCells.filter(c => c.depth === 1).length;
  ok('P2-5 第 1 手分叉：两条开局的珠子都排得出来（修前：父=虚拟根没位置 → 整支被丢弃）',
    d1n === 2, 'depth1=' + d1n + ' 珠子总数=' + treeCells.length);

  /* ---------- P2-6 侧支深处的珠子能提为主变 ---------- */
  await fresh();
  for (const q of ['D4', 'Q16', 'D16', 'Q4']) { const c = G(q); put(c.x, c.y); }
  await sleep(120);
  gotoView(2); await sleep(80);
  put(G('K10').x, G('K10').y); await sleep(100);        // 侧支第 3 手
  put(G('L10').x, G('L10').y); await sleep(100);        // 侧支第 4 手（深处那颗）
  const deepAt = state.moves.length;
  const pr = promoteToMainline(deepAt); await sleep(150);
  ok('P2-6 侧支**深处**的珠子能提为主变（修前：局部判据把它当成「已经在主变上」挡回）',
    pr === true, 'at=' + deepAt + ' ret=' + pr);

  /* ---------- P2-11 空树 () 不再截断整棵 ---------- */
  const rtA = parseSGF('(;FF[4]SZ[19]();B[pd])');
  ok('P2-11a 空树 () 不再吃掉后面的手（修前：0 手）', rtA.moves.length === 1, rtA.moves.length);
  const rtB = parseSGF('(;FF[4]SZ[19];B[pd]()(;W[dd];B[qq])(;W[pp]))');
  ok('P2-11b 空树后面的顺序手与兄弟变着都还在（修前：只剩 1 手）', rtB.moves.length === 3, rtB.moves.length);

  /* ---------- P2-12 「棋谱说明」不落到没有 C 的那个元数据节点上 ---------- */
  const t12 = '(;FF[4]SZ[19]PB[甲];C[变化图。];B[pd])';
  const o12 = patchSGFComment(t12, -1, '我的新说明');
  const txt12 = (o12 && o12.text) || '';
  ok('P2-12 双根结构下改说明只落一处 C（修前：新 C 插到第一个节点，旧 C 原地不动）',
    (txt12.match(/C\[/g) || []).length === 1 && txt12.indexOf('我的新说明') >= 0, txt12.slice(0, 80));

  /* ---------- P2-13 认 AE[] ---------- */
  const rt13 = parseSGF('(;FF[4]SZ[19]AB[aa][bb]AE[aa])');
  ok('P2-13 AE 的点不再摆上盘（修前：题面多一颗子，用户解的是另一道题）',
    rt13.ok && rt13.ab.length === 1 && !rt13.ab.some(p => p.x === 0 && p.y === 0), JSON.stringify(rt13.ab));

  /* ---------- P2-14 读秒不再多给一次 ---------- */
  state.clock = { on: true, running: true, expired: null, paused: false, main: 300, byo: 30, byoN: 3,
                  add: 0, side: 'b', phase: 'byo', since: performance.now(), b: { t: 0, n: 3 }, w: { t: 300, n: 3 } };
  let ticks = 0;
  while (!state.clock.expired && ticks < 6) { state.clock.since = performance.now() - 31000; clockTick(); ticks++; }
  ok('P2-14 设 3 次读秒就在第 3 个周期末判负（修前：给 4 次）', ticks === 3, 'ticks=' + ticks);
  state.clock.on = false; state.clock.expired = null; state.clock.running = false;

  /* ---------- P2-16 百分比清洗不再卡死主线程 ---------- */
  const t16 = performance.now(); cleanCoachText('7'.repeat(3200)); const dt16 = performance.now() - t16;
  ok('P2-16 3200 位数字串的清洗耗时（修前实测 4306ms）', dt16 < 250, dt16.toFixed(0) + 'ms');

  /* ---------- P2-17 认输判据 / 形势雾 / 空局超时 ---------- */
  await fresh();
  const pts = [];
  for (let i = 0; i < 32; i++) pts.push([1 + (i % 9) * 2, 1 + Math.floor(i / 9) * 2]);
  for (const p of pts) { put(p[0], p[1]); }
  await sleep(200);
  state.myColor = 'b';                                   // 我执黑 → AI 执白
  state.lastEval = { blackWin: 0.99, lead: 100 };        // 「最近算过的局面」是白惨败
  state.history[state.moves.length] = 0.5;               // 末端真实局面五五开
  state.leads[state.moves.length] = 0;
  ok('P2-17a 认输看末端那一手，不看「最近算过的局面」（修前：这里会误判 AI 认输）',
    aiWantsResign() === false, 'moves=' + state.moves.length);
  state.showTerritory = true; state.terrStyle = 'fog';
  state.ownership = new Array(N * N).fill(0.5);
  state.ownAt = state.viewAt;
  const a1 = stoneAlphaAt(0, 0, 1);
  state.ownAt = state.viewAt - 1 >= 0 ? state.viewAt - 1 : 0;   // 换成「别的手」的形势
  const a2 = stoneAlphaAt(0, 0, 1);
  ok('P2-17b 形势雾只染当前这一手（修前：回看时拿别的手的形势染棋子）',
    a1 !== 1 && a2 === 1, '当前手=' + a1 + ' 别的手=' + a2);
  state.showTerritory = false;

  /* ---------- P2-4 / P3-11 终局后允许继续 + 结果条口径 ---------- */
  await fresh();
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(q); put(c.x, c.y); }
  await sleep(140);
  doResign('b', 'user');
  ok('P2-4 前置：认输后结果条在', !!state.result);
  const c7 = G('K10'); const cont = put(c7.x, c7.y); await sleep(180);
  ok('P2-4 ★ 终局后仍可继续落子，且结果条随局面收起（修前：结果条一直挂着旧胜负）',
    cont === true && state.moves.length === 6 && state.result === null,
    '落子=' + cont + ' 手数=' + state.moves.length + ' 结果条=' + (state.result ? 'still' : 'cleared'));
  await fresh();
  state.result = null;
  doResign('b', 'timeout', { allowEmpty: true });
  ok('P3-11 空局超时也出结果（修前：计时静默报废，永远不弹结果）', !!state.result, state.result ? state.result.by : 'null');

  /* ---------- 收尾：回到干净的新开局 ---------- */
  state.result = null; state.showTerritory = false;
  await fresh();
  ok('收尾：回到新开局干净状态', state.moves.length === 0 && !state.result);
  return L.join('\n');
})();