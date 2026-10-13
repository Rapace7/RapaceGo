/* 「全盘讲解前先问一句」的回归 —— 2026-10-14 首相要求（当晚按首相实测反馈订正过一遍）。
 * 用法：node dev/_cdp_run2.mjs ./_inject_batchask.js 9333
 *
 * 首相原话（拆成规格）：
 *   ① 棋谱已经被 KataGo 全盘算过 → 不该再重算，弹窗说明「这东西是干啥的」并**推荐跳过**；
 *   ② 没有任何现有讲解 → **不问，直接跑**；
 *   ③ 已有讲解 → 弹窗问「从头重跑」还是「从未讲的手继续」；重跑 = 抹掉已有的、从第一手开始。
 *   ④ ★ 当晚订正：**顺序**必须是「先问要不要重算（胜率）→ 再问要不要续跑（讲解）」；
 *      而且首相实测报过「两个弹窗点啥都没反应」——
 *      根因是弹窗被重建时把上一批按钮清了、两个 Promise 都悬着。
 *      所以下面专门有一条**重现那个场景**的断言（BB7/BB8）。
 *
 * ★ 为什么这条脚本不调 runBatchCoach()：它前面几道闸门就要引擎就绪，真跑起来是
 *   KataGo 整盘分析（几分钟）+ LoGos 逐手讲（更久），脚本会卡在那儿。
 *   判定逻辑已抽成纯函数 batchAskInfo()，弹窗单独测 askBatchPlan() 即可覆盖。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const mask = () => document.getElementById('batchask');
  const isOpen = () => !!mask() && mask().classList.contains('open');
  const btns = () => [...mask().querySelectorAll('#ba-actions button')];

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  /* ★ 环境清场（2026-10-14 加了这条）：上一条脚本可能留了个**开着的**询问窗
     （比如 `_inject_showask.js` 会故意弹出来挂着好截图）。
     它开着的时候，本脚本后面的弹窗会被"双保险"正确地拒掉 —— 那是**环境污染，不是 bug**，
     但会让 B21/B22/B23 假失败（实测踩过一次）。所以先把可能开着的关掉。 */
  const m0 = document.getElementById('batchask');
  if (m0) m0.classList.remove('open');
  for (const [x, y] of [[3, 15], [15, 3], [3, 3], [15, 15], [2, 13], [16, 9]]) tryPlay(x, y);
  await sleep(150);
  const n = state.moves.length;
  ok('B0 前置：6 手', n === 6, n);

  const saveRev = state.review, saveEx = state.coach.explain, saveName = state.recName;
  state.recName = '自测-假棋谱.sgf';

  /* ---------- ① 都没有 → 一个窗都不弹（首相要的「别问，直接跑」） ---------- */
  state.review = null; state.coach.explain = {};
  ok('B1 ★ 既没胜率也没讲解 → 返回 null（不弹窗 = 直接开跑）', batchAskInfo(n) === null);

  /* ---------- ② 只有胜率（**新版记录：带候选点**）→ 推荐「跳过重算」 ---------- */
  state.review = {
    file: state.recName, history: new Array(n + 1).fill(0.5), leads: new Array(n + 1).fill(0),
    cands: new Array(n + 1).fill(null).map(() => [['C17', 0.288], ['D4', 0.25], ['Q16', 0.2]]),
  };
  let a = batchAskInfo(n);
  ok('B2 有胜率 → 要弹窗一（askReview）', !!a && a.askReview === true);
  ok('B3 没讲解 → **不弹**窗二（askCoach）', !!a && a.askCoach === false);
  ok('B4 ★ 窗一推荐项 =「跳过重算，用现成的」（第一个）',
    !!a && a.revButtons[0].label.indexOf('跳过重算') >= 0, a && a.revButtons.map(b => b.label).join(' | '));
  ok('B5 窗一的推荐项语义 = skipReview:true', !!a && a.revButtons[0].value.skipReview === true);
  ok('B6 ★ 窗一正文说清了「这份记录是干啥的」（提到"亏了多少"与"走势图"）',
    !!a && a.revBody.indexOf('亏') >= 0 && a.revBody.indexOf('走势图') >= 0, a && a.revBody.slice(0, 70));
  ok('B7 窗一备选里有「重新算一遍」', !!a && a.revButtons.some(b => b.label.indexOf('重新算') >= 0),
    a && a.revButtons.map(b => b.label).join(' | '));
  ok('B8 窗一有「取消」，value 为 null',
    !!a && a.revButtons[a.revButtons.length - 1].label === '取消' && a.revButtons[a.revButtons.length - 1].value === null);
  ok('B8x ★ 带候选点的记录：正文说明「跳过也能正常逐手讲解」',
    !!a && a.revBody.indexOf('也能正常逐手讲解') >= 0);

  /* ---------- ②b ★★ 旧版记录（**没有候选点**）→ 推荐项必须反过来，并且如实说明 ----------
     首相 2026-10-14 实测踩到的正是这个：他选了「跳过重算」，然后**什么都没发生** ——
     因为旧记录里没有「AI 想下哪」，逐手讲解根本讲不了。所以现在必须：
       · 正文明确写出「讲不了」
       · **把推荐项换成「重新算一遍」**（否则用户又选跳过、又什么都不发生） */
  state.review = {
    file: state.recName, history: new Array(n + 1).fill(0.5), leads: new Array(n + 1).fill(0),
  };
  a = batchAskInfo(n);
  ok('B8a ★ 旧记录（无候选点）：推荐项换成了「重新算一遍」',
    !!a && a.revButtons[0].label.indexOf('重新算') >= 0, a && a.revButtons.map(b => b.label).join(' | '));
  ok('B8b ★ 旧记录：推荐项语义 = skipReview:false（要讲就必须重算）',
    !!a && a.revButtons[0].value.skipReview === false);
  ok('B8c ★ 旧记录：正文明确说了「没有 AI 当时想下哪」与「讲不了」',
    !!a && a.revBody.indexOf('没有') >= 0 && a.revBody.indexOf('讲不了') >= 0, a && a.revBody.slice(0, 90));
  ok('B8d 旧记录：仍留了「跳过重算（这次讲不了）」这条退路',
    !!a && a.revButtons.some(b => b.label.indexOf('跳过重算') >= 0 && b.label.indexOf('讲不了') >= 0),
    a && a.revButtons.map(b => b.label).join(' | '));

  /* ---------- ③ 只有讲解 → **只该弹窗二** ---------- */
  state.review = null;
  state.coach.explain = {};
  for (let i = 1; i <= 3; i++) state.coach.explain[i] = { cv: COACH_VER, head: 'h', body: 'b' };
  a = batchAskInfo(n);
  ok('B9 有讲解 → 要弹窗二（askCoach）', !!a && a.askCoach === true);
  ok('B10 没胜率 → **不弹**窗一（askReview）', !!a && a.askReview === false);
  ok('B11 ★ 窗二推荐项 =「接着讲没讲过的」（第一个）',
    !!a && a.coachButtons[0].label.indexOf('接着讲') >= 0, a && a.coachButtons.map(b => b.label).join(' | '));
  ok('B12 窗二推荐项语义 = fromScratch:false', !!a && a.coachButtons[0].value.fromScratch === false);
  const iS = a ? a.coachButtons.findIndex(b => b.label.indexOf('从头重跑') >= 0) : -1;
  ok('B13 窗二有「从头重跑」项', iS >= 0, a && a.coachButtons.map(b => b.label).join(' | '));
  ok('B14 ★ 窗二「从头重跑」语义 = fromScratch:true', iS >= 0 && a.coachButtons[iS].value.fromScratch === true);
  ok('B15 窗二正文报清了「讲过几手 / 还剩几手」',
    !!a && a.coachBody.indexOf('3 / 6') >= 0 && a.coachBody.indexOf('还剩') >= 0, a && a.coachBody.slice(0, 100));

  /* ---------- ④ 两样都有 → 两个窗都要弹（顺序由 runBatchCoach 保证：先一后二） ---------- */
  state.review = { file: state.recName, history: new Array(n + 1).fill(0.5), leads: new Array(n + 1).fill(0) };
  a = batchAskInfo(n);
  ok('B16 两样都有 → 两个窗都要弹', !!a && a.askReview === true && a.askCoach === true);
  ok('B17 ★ 窗一是「重算」、窗二是「续跑」（首相要的顺序）',
    !!a && a.revBody.indexOf('胜率') >= 0 && a.coachBody.indexOf('讲解') >= 0);

  /* ---------- ⑤ 弹窗本身：能开、按钮能点、值拿得到 ---------- */
  let p = askBatchPlan({
    title: '窗一', body: '<b>x</b>',
    buttons: [{ label: '甲', value: 1, primary: true }, { label: '乙', value: 2 }, { label: '取消', value: null }],
  });
  await sleep(140);
  ok('B18 弹窗真的开了（.open）', isOpen());
  ok('B19 三个按钮都在，第一个是 primary', btns().length === 3 && btns()[0].classList.contains('primary'),
    btns().map(b => b.textContent).join('|'));

  /* ---------- ⑥ ★★ 重现首相报的那个 bug：弹窗开着时再来一次 ---------- */
  const p2 = askBatchPlan({ title: '窗二', body: 'y', buttons: [{ label: '丙', value: 3 }] });
  const v2 = await p2;
  await sleep(80);
  ok('B20 ★ 弹窗开着时再请求弹窗 → 被拒（返回 null），不重建',
    v2 === null, String(v2));
  ok('B21 ★ 原来那批按钮**还在**（没被清掉）—— 这是「点啥都没反应」的病根',
    btns().length === 3 && btns()[0].textContent === '甲', btns().map(b => b.textContent).join('|'));
  ok('B22 标题也没被后一个覆盖', mask().querySelector('#ba-title').textContent === '窗一',
    mask().querySelector('#ba-title').textContent);

  /* ---------- ⑦ 真点一个按钮：能拿到值、弹窗关闭 ---------- */
  btns()[1].click();
  const v = await p;
  await sleep(90);
  ok('B23 点「乙」拿到 2，弹窗同时关闭', v === 2 && !isOpen(), String(v));

  /* ---------- ⑧ 关了之后还能再弹下一个窗（顺序链要能走通） ---------- */
  p = askBatchPlan({ title: '窗二', body: 'y', buttons: [{ label: '丙', value: 3, primary: true }, { label: '取消', value: null }] });
  await sleep(140);
  ok('B24 上一个窗关掉后，下一个窗能正常弹出来', isOpen() && btns().length === 2,
    btns().map(b => b.textContent).join('|'));
  btns()[0].click();
  ok('B25 第二个窗也能拿到值', (await p) === 3);

  /* 还原现场 */
  state.review = saveRev; state.coach.explain = saveEx; state.recName = saveName;
  applyNewGame(); await sleep(150);
  /* ---------- ⑨ ★★ 复盘记录里必须带「候选点」----------
     这是「跳过重算也能讲」的全部前提。首相实测：「我已经重算一遍了，为什么还显示这份是旧版的？」
     —— 根因是 `runBatchCoach` 里那步整盘分析算完**只填内存、不落盘**（已修），
     所以这里把"记录里到底有没有候选点"写成断言，别再让那条路悄悄断。 */
  const fakeTurns = [];
  for (let i = 0; i <= n; i++) {
    fakeTurns.push({
      root: { winrate: 0.5, scoreLead: 0, currentPlayer: i % 2 ? 'W' : 'B' },
      moves: [
        { move: 'C17', winrate: 0.288, scoreLead: 1.2, order: 0 },
        { move: 'D4', winrate: 0.25, scoreLead: 0.5, order: 1 },
        { move: 'Q16', winrate: 0.2, scoreLead: -0.3, order: 2 },
        { move: 'R5', winrate: 0.1, scoreLead: -2, order: 3 },
      ],
      actualMove: 'C17',
    });
  }
  const rep = buildReview(n, fakeTurns);
  ok('B26 ★ 复盘记录里带 cands（没有它，「跳过重算」必然讲不了）',
    Array.isArray(rep.cands), typeof rep.cands);
  /* ⚠️ cands 的长度 = **手数**（每一项是"第 t 手之前"那个局面的候选），
     不是 history 的 `手数+1` —— 末尾那个"最后一手之后"的局面讲解用不到。 */
  ok('B27 ★ cands 每手存前 3 个，格式 [坐标, 胜率]',
    !!rep.cands && rep.cands.length === n && rep.cands[0].length === 3
    && rep.cands[0][0][0] === 'C17' && typeof rep.cands[0][0][1] === 'number',
    rep.cands && (rep.cands.length + ' 项 / 第1项=' + JSON.stringify(rep.cands[0])));
  ok('B28 cands 按 order 排（首选在前）',
    !!rep.cands && rep.cands[0].map(x => x[0]).join(',') === 'C17,D4,Q16',
    rep.cands && rep.cands[0].map(x => x[0]).join(','));
  ok('B29 记录版本号升到 v3（老记录是 v2 —— 靠它区分"有没有候选点"）',
    rep.v === 3, String(rep.v));
  ok('B30 cands 能还原成讲解要的 turns 形状（moves[0] 就是首选，带胜率）', (function () {
    if (!rep.cands || !rep.cands[0]) return false;
    const t = { moves: rep.cands[0].map((p, k) => ({ move: p[0], winrate: p[1], order: k })) };
    return t.moves[0].move === 'C17' && t.moves[0].winrate === 0.288;
  })());

  return L.join('\n');
})();
