/* 手数分支 · 段②（SGF 树读写 + 评估跟分支走）的回归断言 —— 2026-10-13 DSH 写的。
 * 用法：先双击 dev\_start_cdp.bat 起带调试端口的实例，再
 *       node dev/_cdp_run2.mjs ./_inject_branch_v2.js
 *
 * 覆盖：
 *   ① 无分支时 SGF 输出与旧格式**逐字节一致**（兼容回归，不能因为加分支功能把老棋谱写丑）
 *   ② 有分支时写出标准变着写法 `(;W[qp]...)(;W[jj])`
 *   ③ 读回来：parseSGF 交出整棵 tree，sgfTreeToMoves 装出的树分叉点有 2 个子
 *   ④ 往返一致：写出→读入→主线手顺与坐标一字不差
 *   ⑤ applyRecord 打开带变着的棋谱 → 能直接 ↑/↓ 切分支
 *   ⑥ 试下（草稿）不进树、不进棋谱；退出试下后不留幽灵旁支
 *   ⑦ 评估缓存（history/leads/histVisits）跟分支走：切走再切回，数值原样回来
 *   ⑧ 从 SGF 读进来的手补出 captured/capAt（打劫判据要用，原来是 undefined → 判劫放行）
 *   ⑬ 全盘讲解的「必须站在主变上」闸门（任务 1）
 *   ⑭ 12a 式手号（任务 2）
 *   ⑮ 2026-10-13 深夜审查修复：主线内容指纹 mainlineSig（坑位 42 方案 A）、
 *      试下中不换分支（坑位 38）、旁支不挂主线目损（坑位 39）—— 共 6 条
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  /* ⚠️ 坐标换算**必须**走程序自己的 GTP_COLS 反查 —— 围棋 GTP 坐标**跳过 I**
     （A B C D E F G H J K L M N O P Q R S T），直接 `charCodeAt - 65` 会把
     K 算成 10（其实是 9）、Q 算成 16（其实是 15），于是探针自己把 K10 当成 L10，
     断言全错而程序全对。这个坑踩过一次：第一轮 ②1/②2/④ 三条 FAIL 全是它。 */
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  const sgfOf = (x, y) => SGF_COLS[x] + SGF_COLS[y];
  const nBranchesIn = t => (t.match(/\(/g) || []).length;      // 文本里括号个数（根的那个也算）

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  for (const p of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(p); tryPlay(c.x, c.y); }
  await sleep(150);
  ok('前置：正式 5 手', state.moves.length === 5, state.moves.length);

  /* ---------- ① 无分支：输出必须与旧格式一致 ----------
     ⚠️ 期望串里的坐标同样是**按程序口径**（SGF_COLS，含 i 的 20 字母表）：
        Q16 → x=15('p') y=3('d') → "pd"（不是 "qd"）；Q4 → x=15 y=15 → "pp"（不是 "qp"）。 */
  const sgf1 = buildSGF();
  ok('①1 无分支时只有一个括号（= 根）', nBranchesIn(sgf1) === 1, nBranchesIn(sgf1));
  ok('①2 手顺逐字节与旧写法一致',
    sgf1.indexOf(';B[dp];W[pd];B[dd];W[pp];B[cn]') > 0, sgf1.slice(-60));
  ok('①3 以 ) 收尾', sgf1.endsWith(')'));
  ok('①4 没有变着的空括号', sgf1.indexOf('()') < 0);

  /* ---------- ② 建分支 → 写出标准变着 ---------- */
  gotoView(3); await sleep(60);
  const p = G('K10');                                  // x=9,y=9 → SGF "jj"
  tryPlay(p.x, p.y);
  await sleep(120);
  ok('②0 前置：新分支已长出（4 手）', state.moves.length === 4, state.moves.length);
  const sgf2 = buildSGF();
  /* 旧线：dp pd dd [pp cn]  新线：dp pd dd [jj]  —— _cs 顺序 = 先建的在前（旧线 = 主变） */
  const kJj = sgfOf(p.x, p.y);                       // K10 → "jj"（用程序的口径算，别手写）
  ok('②1 变着写成 (旧线)(新线)，旧线在前', sgf2.indexOf('(;W[pp];B[cn])(;W[' + kJj + '])') > 0,
     sgf2.slice(sgf2.indexOf('(;'), sgf2.indexOf('(;') + 40));
  ok('②2 分叉点之前的手仍在括号外（不重复写）',
     sgf2.indexOf(';B[dp];W[pd];B[dd](;W[pp];B[cn])(;W[' + kJj + '])') > 0,
     sgf2.slice(-48));

  /* ---------- ③ 读回来：整棵树 ---------- */
  const rt = parseSGF(sgf2);
  ok('③1 parseSGF 交出 tree', !!rt.tree);
  ok('③2 主线仍是 5 手（旧口径不变）', rt.moves.length === 5, rt.moves.length);
  const root2 = { _p: null, _cs: [], _virtual: true, x: -1, y: -1, color: null };
  const main2 = [];
  sgfTreeToMoves(rt.tree, root2, 0, main2, rt.size, { n: 0 });
  ok('③3 装出的主线 5 手', main2.length === 5, main2.length);
  ok('③4 第 3 手节点下挂了 2 个子（= 两条分支）', main2[2]._cs.length === 2, main2[2]._cs.length);
  ok('③5 主变是旧线（第 4 手 = Q4）',
    main2[2]._cs[0].x === G('Q4').x && main2[2]._cs[0].y === G('Q4').y);
  ok('③6 旁支是 K10',
    main2[2]._cs[1].x === p.x && main2[2]._cs[1].y === p.y,
    main2[2]._cs[1].x + ',' + main2[2]._cs[1].y);

  /* ---------- ⑫ 旁支的解说词写回原文件（段② 收掉的尾巴） ----------
     证明「按节点定位」对**旁支**同样成立。原来旁支一律被拒绝写回 ——
     因为文本级落刀只认主线口径（mainLine 的 moveIdx），写下去会盖到主线那一手上。
     现在靠节点上的 _sgfIdx 定位，主线旁支一视同仁。 */
  const branchNode = main2[2]._cs[1];               // 旁支 K10
  ok('⑫1 旁支节点也拿到了原文里的手序号', branchNode._sgfIdx === 5, branchNode._sgfIdx);
  const pat1 = patchSGFCommentAtNode(sgf2, branchNode, '旁支的话');
  ok('⑫2 旁支写回能落刀', !!pat1.ok, JSON.stringify(pat1).slice(0, 60));
  if (pat1.ok) {
    ok('⑫3 解说词落在旁支那个节点上（W[' + kJj + '] 后面）',
       pat1.text.indexOf('(;W[' + kJj + ']C[旁支的话])') > 0, pat1.text.slice(-42));
    ok('⑫4 全文只出现一次，没盖到主线那一手',
       (pat1.text.match(/C\[旁支的话\]/g) || []).length === 1);
    const back2 = parseSGF(pat1.text);
    ok('⑫5 写回后主线手顺一字不变', back2.moves.length === 5, back2.moves.length);
  }

  /* ---------- ④ 往返一致（坐标一字不差） ---------- */
  const back = main2.map(m => GTP_COLS[m.x] + (19 - m.y)).join(',');
  ok('④ 往返后主线坐标一致', back === 'D4,Q16,D16,Q4,C6', back);
  ok('④2 往返后再导出与原文完全相同', buildSGF() === sgf2, buildSGF().length + '/' + sgf2.length);

  /* ---------- ⑤ applyRecord 打开带变着的棋谱 → 能切分支 ---------- */
  applyRecord(rt, '段②自测.sgf'); await sleep(200);
  ok('⑤1 打开后有 5 手主线', state.moves.length === 5, state.moves.length);
  ok('⑤2 手数列表出现 ⑂ 标记', document.querySelectorAll('#movelist .br').length >= 1,
     document.querySelectorAll('#movelist .br').length);
  gotoView(3); await sleep(60);
  const sw = cycleBranch(1); await sleep(150);
  ok('⑤3 能切到旁支', sw === true);
  ok('⑤4 切过去是 K10、长度 4',
    state.moves.length === 4 && state.moves[3].x === p.x && state.moves[3].y === p.y,
    state.moves.length + ' / ' + (state.moves[3] ? GTP_COLS[state.moves[3].x] + (19 - state.moves[3].y) : '-'));
  gotoView(3); await sleep(60);
  cycleBranch(1); await sleep(150);
  ok('⑤5 能切回旧线（5 手）', state.moves.length === 5 && state.moves[3].x === G('Q4').x, state.moves.length);

  /* ---------- ⑧ captured/capAt 补算（打劫判据依赖它） ---------- */
  ok('⑧1 读进来的手都有 captured 字段',
    state.moves.every(m => m.captured !== undefined),
    state.moves.map(m => m.captured).join(','));
  ok('⑧2 无提子的手 captured = 0', state.moves.every(m => m.captured === 0));

  /* ---------- ⑦ 评估缓存跟分支走 ---------- */
  state.history[5] = 0.42; state.leads[5] = 1.5; state.histVisits[5] = 999;
  gotoView(3); await sleep(60);
  cycleBranch(1); await sleep(150);                    // 切到旁支（只有 4 手）
  ok('⑦1 切走后第 5 手的评估不再是旧线的值', state.history[5] !== 0.42, state.history[5]);
  gotoView(3); await sleep(60);
  cycleBranch(1); await sleep(150);                    // 切回旧线
  ok('⑦2 切回来第 5 手的胜率原样回来', state.history[5] === 0.42, state.history[5]);
  ok('⑦3 目差原样回来', state.leads[5] === 1.5, state.leads[5]);
  ok('⑦4 精度原样回来', state.histVisits[5] === 999, state.histVisits[5]);

  /* ---------- ⑥ 草稿不进树、不进棋谱 ---------- */
  const branchParent = state.moves[state.moves.length - 1];   // 末端（第 5 手 C6）
  const before = state.moves.length;
  enterDraft(); await sleep(120);
  const dp = G('R10'); tryPlay(dp.x, dp.y); await sleep(80);
  const dp2 = G('R11'); tryPlay(dp2.x, dp2.y); await sleep(80);
  ok('⑥1 草稿中确实多了 2 手', state.moves.length === before + 2, state.moves.length);
  const sgfD = buildSGF();
  ok('⑥2 草稿手没写进棋谱', sgfD.indexOf(SGF_COLS[dp.x] + SGF_COLS[dp.y]) < 0
     && sgfD.indexOf(SGF_COLS[dp2.x] + SGF_COLS[dp2.y]) < 0,
     SGF_COLS[dp.x] + SGF_COLS[dp.y]);
  ok('⑥3 草稿期间导出的棋谱仍是正式 5 手（不含草稿）',
     parseSGF(sgfD).moves.length === 5, parseSGF(sgfD).moves.length);
  exitDraft(); await sleep(150);
  ok('⑥4 退出试下后回到 5 手', state.moves.length === 5, state.moves.length);
  const ghost = ensureBranch();
  ok('⑥5 树里没有留下草稿幽灵（末端仍 0 个子）',
     branchParent._cs.length === 0, branchParent._cs.length);
  ok('⑥6 退出后手数列表没有多余 ⑂（仍然只有 1 处）',
     document.querySelectorAll('#movelist .br').length === 1,
     document.querySelectorAll('#movelist .br').length);

  /* ---------- ⑩ 提升主变（PgUp 式 · 设计方案段② 第 4 条 / 决策 8） ---------- */
  /* 重新铺一盘干净的：主线 5 手，再从第 3 手岔出 K10 当旁支 */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  gotoView(3); await sleep(60);
  const pk = G('K10'); tryPlay(pk.x, pk.y); await sleep(150);
  ok('⑩1 前置：旁支已长出（4 手，末手 K10）',
    state.moves.length === 4 && state.moves[3].x === pk.x && state.moves[3].y === pk.y,
    state.moves.length + ' 手');
  const sgfBefore = buildSGF();
  ok('⑩2 提升前：旧线是主变（写在前面）',
    sgfBefore.indexOf('(;W[pp];B[cn])(;W[' + sgfOf(pk.x, pk.y) + '])') > 0);
  /* 埋一个可辨认的评估值在第 4 手上（此刻第 4 手 = 旁支 K10）。
     提升主变会把「旁支第 4 手」变成「主线第 4 手」，手号的意义整个换一遍 ——
     这个值必须**跟着节点走**，原样出现在新的第 4 手上，否则就是串了。 */
  state.history[4] = 0.11; state.leads[4] = 2.5; state.histVisits[4] = 321;

  const pr = promoteToMainline(4); await sleep(200);
  ok('⑩3 提升主变返回 true', pr === true);
  ok('⑩4 提升后仍是 4 手、第 4 手仍是 K10',
    state.moves.length === 4 && state.moves[3].x === pk.x, state.moves.length + ' 手');
  const sgfAfter = buildSGF();
  ok('⑩5 提升后：K10 那条成了主变（写在前面）',
    sgfAfter.indexOf('(;W[' + sgfOf(pk.x, pk.y) + '])(;W[pp];B[cn])') > 0,
    sgfAfter.slice(-48));
  ok('⑩6 括号数不变（原主变整枝还在树上，没被删）',
    nBranchesIn(sgfAfter) === nBranchesIn(sgfBefore),
    nBranchesIn(sgfAfter) + '/' + nBranchesIn(sgfBefore));
  ok('⑩7 第 4 手的评估跟着节点走（胜率）', state.history[4] === 0.11, state.history[4]);
  ok('⑩8 第 4 手的目差跟着节点走', state.leads[4] === 2.5, state.leads[4]);
  ok('⑩9 第 4 手的精度跟着节点走', state.histVisits[4] === 321, state.histVisits[4]);
  ok('⑩10 已经在主变上时再提一次 → 如实拒绝',
    promoteToMainline(4) === false);

  /* 切回原主线：整枝必须完好，且第 5 手不能串成旁支的值 */
  gotoView(3); await sleep(60);
  const sw2 = cycleBranch(1); await sleep(200);
  ok('⑩11 提升后仍能切回原主线', sw2 === true && state.moves.length === 5, state.moves.length + ' 手');
  ok('⑩12 切回后第 4 手是 Q4（原主变）',
    state.moves.length === 5 && state.moves[3].x === G('Q4').x && state.moves[3].y === G('Q4').y);
  ok('⑩13 第 3 手下的两条支顺序已换（新主变在前）',
    state.moves[2]._cs[0].x === pk.x && state.moves[2]._cs[1].x === G('Q4').x);

  /* ---------- ⑪ 删除分支（两段式确认 + 回收站 · 设计方案决策 7/8） ---------- */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  gotoView(3); await sleep(60);
  const dk = G('K10'); tryPlay(dk.x, dk.y); await sleep(150);
  ok('⑪1 前置：旁支已长出（4 手，末手 K10）',
    state.moves.length === 4 && state.moves[3].x === dk.x, state.moves.length + ' 手');
  const sv = buildSGF();

  /* 给「主线第 4 手（Q4 节点）」埋一个只有它有的值。
     用途：删掉旁支后路径会切回主线，第 4 手的值必须来自 Q4 节点 ——
     若缓存没跟着节点走，这里读到的会是旁支那个 0.11（= 串了）。 */
  const ndD16 = state.moves[2];
  const ndQ4 = ndD16._cs[0];
  ndQ4._an = { h: 0.77, l: 7.7, v: 777 };
  state.history[4] = 0.11;                       // 旁支末手（K10）的值

  const d1 = deleteBranchAt(4); await sleep(120);
  ok('⑪2 第一次按 Delete 只登记、不真删',
    d1 === false && state.moves.length === 4, state.moves.length + ' 手');
  ok('⑪3 登记后树上仍有两枝', ndD16._cs.length === 2, ndD16._cs.length);

  const d2 = deleteBranchAt(4); await sleep(200);
  ok('⑪4 第二次按 Delete 才真删', d2 === true);
  ok('⑪5 删的正是当前走的那条 → 路径退回主线（5 手）', state.moves.length === 5, state.moves.length + ' 手');
  ok('⑪6 被删的枝从树上消失（D16 下只剩 1 个子）', ndD16._cs.length === 1, ndD16._cs.length);
  ok('⑪7 导出里不再有 K10、也没多出变着括号',
    buildSGF().indexOf(sgfOf(dk.x, dk.y)) < 0 && nBranchesIn(buildSGF()) === 1,
    nBranchesIn(buildSGF()));
  ok('⑪8 切回主线后第 4 手的评估来自 Q4 节点、没串成旁支的值',
    state.history[4] === 0.77, state.history[4]);
  ok('⑪9 目差/精度同样没串',
    state.leads[4] === 7.7 && state.histVisits[4] === 777,
    state.leads[4] + '/' + state.histVisits[4]);

  const u = undoDeleteBranch(); await sleep(200);
  ok('⑪10 撤销成功', u === true);
  ok('⑪11 整枝按**原下标**放回（K10 仍在 Q4 之后，没插到主变前面）',
    ndD16._cs.length === 2 && ndD16._cs[1].x === dk.x,
    ndD16._cs.length + ' 个子');
  ok('⑪12 撤销后导出与删之前逐字节一致', buildSGF() === sv, buildSGF().length + '/' + sv.length);
  ok('⑪13 撤销后把用户送回旁支那一点（4 手）', state.moves.length === 4, state.moves.length + ' 手');
  ok('⑪14 撤销后旁支的评估回来了', state.history[4] === 0.11, state.history[4]);

  /* 回收站空的时候要如实说，不能假装撤销成功 */
  branchTrash = null; pendingDel = null;
  ok('⑪15 没有可撤销的东西时如实返回 false', undoDeleteBranch() === false);

  /* ---------- ⑨ 老棋谱（无变着）回归 ---------- */
  const old = parseSGF('(;GM[1]FF[4]SZ[19];B[pd];W[dp];B[pq])');
  applyRecord(old, '老格式.sgf'); await sleep(200);
  ok('⑨1 老格式照常打开（3 手）', state.moves.length === 3, state.moves.length);
  /* ⑨2 落点必须**避开棋谱已有的子** —— pd/dp/pq 已占，原来选 D4 正好撞上 dp，
     于是 tryPlay 的第一道 `b[idx] !== 0` 直接挡回，看着像"老棋谱打开后不能落子"。
     这不是程序 bug，是探针选点撞车（第一轮就栽在这）。 */
  const o = G('R10'); const played = tryPlay(o.x, o.y); await sleep(100);
  ok('⑨2 老格式打开后能继续落子', played === true && state.moves.length === 4, state.moves.length);

  /* ---------- ⑬ 全盘讲解的「必须站在主变上」闸门（任务 1） ---------- */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  gotoView(3); await sleep(60);
  const ck = G('K10'); tryPlay(ck.x, ck.y); await sleep(150);
  ok('⑬1 前置：当前走在旁支上（4 手、末手 K10）',
     state.moves.length === 4 && state.moves[3].x === ck.x, state.moves.length + ' 手');
  ok('⑬2 走在旁支时 currentPathIsMainline() 为假', currentPathIsMainline() === false);
  gotoView(3); await sleep(60);
  cycleBranch(1); await sleep(200);
  ok('⑬3 切回主线后为真（5 手）',
     currentPathIsMainline() === true && state.moves.length === 5, state.moves.length + ' 手');
  /* ⑬4 抓「加了函数却忘了接进入口」这个错：查函数体里有没有那句、
     以及它是不是排在引擎检查之前（顺序错了等于没接）。 */
  const bsrc = runBatchCoach.toString();
  ok('⑬4 闸门已接进 runBatchCoach，且在引擎检查之前',
     bsrc.indexOf('currentPathIsMainline') > 0
     && bsrc.indexOf('currentPathIsMainline') < bsrc.indexOf("needEngine('coach'"),
     bsrc.indexOf('currentPathIsMainline') + ' / ' + bsrc.indexOf("needEngine('coach'"));
  ok('⑬5 草稿期间也判假（闸门把试下算"不在主变"）',
     (() => { const d = state.draft; state.draft = { from: 5 }; const v = currentPathIsMainline(); state.draft = d; return v === false; })());

  /* ---------- ⑭ 12a 式手号（任务 2） ---------- */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  ok('⑭1 无分支时每手都是纯数字（没有后缀）',
     state.moves.map(m => moveLabelOf(m)).join(',') === '1,2,3,4,5',
     state.moves.map(m => moveLabelOf(m)).join(','));
  gotoView(3); await sleep(60);
  const mk = G('K10'); tryPlay(mk.x, mk.y); await sleep(150);
  /* ★ 2026-10-14：**后缀去掉了**（首相要求「别的软件怎么做就怎么做」）。
     业界靠**纵向位置**区分各条变着，节点/列表上只写真实手数 ——
     所以旁支第 4 手显示的仍是 `4`（与主线那手同号），这是有意为之。
     判据改成：**是纯数字、且与"离根几步"一致**（不再要求字母后缀）。 */
  ok('⑭2 旁支那一手显示真实手数 4（不带后缀）',
    moveLabelOf(state.moves[3]) === '4', moveLabelOf(state.moves[3]));
  const mk2 = G('L10'); tryPlay(mk2.x, mk2.y); await sleep(150);
  ok('⑭3 旁支延长一手 → 5（仍是纯手数）',
    moveLabelOf(state.moves[4]) === '5', moveLabelOf(state.moves[4]));
  /* 列表里真的显示出来了吗（不能只在函数里对） */
  const nos = [...document.querySelectorAll('#movelist .no')].map(e => e.textContent);
  ok('⑭4 列表上写着 1..5 的纯手数（当前路径的手号，无后缀）',
    nos.join(',') === '1,2,3,4,5', nos.join(','));

  /* ---------- ⑮ 2026-10-13 深夜 Qoder 审查修复（坑位 38 / 39 / 42） ----------
     这一组是真界面侧的补账：纯 node 那套（dev/_verify_fixes_1013.js）已经锁住逻辑，
     这里验的是「接进了真列表 / 真按钮」而不只是函数写得对。 */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  const play5 = ['D4', 'Q16', 'D16', 'Q4', 'C6'];
  for (const q of play5) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  const sigMain = mainlineSig();

  /* 在第 3 手后岔出一条旁支，再切回主线（这样树上同时有两条线，且主线是 5 手） */
  gotoView(3); await sleep(60);
  const k10 = G('K10'); tryPlay(k10.x, k10.y); await sleep(150);
  gotoView(3); await sleep(60); cycleBranch(1); await sleep(200);
  ok('⑮1 当前走在 5 手主线上（前置）', state.moves.length === 5 && !state.draft,
     state.moves.length + ' 手');

  /* ⑮2 主线指纹：走到旁支上不该变（否则每次切分支都会把好好的复盘判成无效） */
  const sigOnBranch = (() => { gotoView(3); cycleBranch(1); return mainlineSig(); })();
  await sleep(200);
  ok('⑮2 切到旁支后 mainlineSig 不变（口径=主变链，不是当前路径）',
     sigOnBranch === sigMain, sigMain + ' vs ' + sigOnBranch);

  /* ⑮3 主线内容变了（手数没变）→ 指纹必须变：这正是「覆盖」后拦错挂的那一道 */
  settings.mode = 'free'; applyNewGame(); await sleep(220);
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C7']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  ok('⑮3 最后一手换个点（仍是 5 手）→ 指纹变了', mainlineSig() !== sigMain,
     sigMain + ' → ' + mainlineSig());

  /* ⑮4 试下（草稿）期间按 ↑/↓ 必须被内核挡住（坑位 38） */
  settings.mode = 'free'; applyNewGame(); await sleep(220);
  for (const q of play5) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  gotoView(3); await sleep(60);
  const k10b = G('K10'); tryPlay(k10b.x, k10b.y); await sleep(150);   // 岔出旁支
  gotoView(3); await sleep(60); cycleBranch(1); await sleep(200);     // 切回主线
  enterDraft(); await sleep(150);
  const nBefore = state.moves.length;
  gotoView(3); await sleep(80);
  const swBlocked = cycleBranch(1);
  await sleep(150);
  ok('⑮4 试下中 cycleBranch 被挡、草稿没被截走',
     swBlocked === false && state.moves.length === nBefore && !!state.draft,
     '返回 ' + swBlocked + '·moves ' + state.moves.length + '/' + nBefore + '·draft=' + !!state.draft);
  exitDraft(); await sleep(200);

  /* ⑮5 旁支上不显示主线的复盘目损（坑位 39：宁缺勿假） */
  settings.mode = 'free'; applyNewGame(); await sleep(220);
  for (const q of play5) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(150);
  gotoView(3); await sleep(60);
  const k10c = G('K10'); tryPlay(k10c.x, k10c.y); await sleep(150);
  gotoView(3); await sleep(60); cycleBranch(1); await sleep(200);
  state.review = { losses: [0, 0, 0, 9.9, 0], stats: {}, name: '桩' };
  syncUI(); await sleep(150);
  const dlOnMain = [...document.querySelectorAll('#movelist li')].map(li => {
    const d = li.querySelector('.dl'); return d ? d.textContent : '';
  }).join('|');
  gotoView(3); await sleep(60); cycleBranch(1); await sleep(250);      // 切到旁支
  const dlOnBranch = [...document.querySelectorAll('#movelist li')].map(li => {
    const d = li.querySelector('.dl'); return d ? d.textContent : '';
  }).join('|');
  ok('⑮5a 主线上第 4 手显示复盘目损 −9.9（数据本身可用）', /9\.9/.test(dlOnMain), dlOnMain);
  ok('⑮5b 切到旁支后整列都不出现 9.9（不挂错数字）', !/9\.9/.test(dlOnBranch), dlOnBranch);

  return L.join('\n');
})();
