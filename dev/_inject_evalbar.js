/* 右侧胜率条：回看历史手时必须显示**那一手**的胜率。
 * 用法：node dev/_cdp_run2.mjs ./_inject_evalbar.js 9333
 *
 * 起因（首相 2026-10-13 深夜实测报的）：
 *   正在跑整盘分析（116/218）时回看到第 14 手（手数列表里是 −3.5），
 *   右边胜率条却是「黑 0.1% / 白 99.9% / ∓32.2 目」—— 那是**终局附近**的数字。
 * 根因：`syncUI` 里画这条用的是全局 `state.lastEval`（最近一次算过的局面），
 *   它**不随 viewAt 走** → 用户翻到哪一手它都不变。
 * 修法：优先用按手号存的 `history[viewAt]` / `leads[viewAt]`（同是黑方视角），
 *   没值时（刚落子还没算）才退回 lastEval。
 *
 * ⚠️ 这条脚本**不依赖引擎就绪**：直接把 history/leads/lastEval 摆成想要的样子再验。
 *    引擎没起时不会发分析请求，状态最稳定。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const wrTxt = () => document.getElementById('eval-wr').textContent;
  const leadTxt = () => document.getElementById('eval-lead').textContent;

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  for (const [x, y] of [[3, 15], [15, 3], [3, 3], [15, 15], [2, 13], [16, 9]]) tryPlay(x, y);
  await sleep(150);
  const n = state.moves.length;
  ok('E0 前置：盘上有 6 手', n === 6, n);

  /* 摆出「每一手都有不同胜率」的历史，并让 lastEval 停在**终局**那个数上
     （正是首相截图里的情形：最近算过的是终局，黑几乎必败）。
     ⚠️ 必须先把 `engineReady` 打开：`syncUI` 里那道判断是
        `!engineReady || !state.lastEval` → 引擎没就绪时**优先**显示「未分析」，
        根本走不到画数字那个分支（第一版就栽在这，五条全红且都是「未分析」）。
        打开它只是让渲染分支可达 —— 引擎进程并没起，发出去的请求不会有结果。 */
  const savedReady = engineReady;
  engineReady = true;
  state.history[3] = 0.35; state.leads[3] = 2.0;
  state.history[6] = 0.001; state.leads[6] = -32.2;
  state.lastEval = { blackWin: 0.001, lead: -32.2 };

  gotoView(3); await sleep(160);
  ok('E1 ★ 回看第 3 手 → 条上是**这一手**的胜率（不是 lastEval 的终局数）',
     wrTxt() === '黑 35.0%', wrTxt());
  ok('E2 目数也跟着回看走', leadTxt() === '+2.0 目', leadTxt());

  gotoView(6); await sleep(160);
  ok('E3 跳到最后一手 → 显示终局那个数', wrTxt() === '黑 0.1%', wrTxt());

  gotoView(3); await sleep(160);
  ok('E4 再回看一次仍然是这一手的（不是"跳过一次就定住"）', wrTxt() === '黑 35.0%', wrTxt());

  /* 反向保护：这一手**没有** history 时，不能显示成 0% 或空白，要退回 lastEval */
  const before = state.history[5];
  delete state.history[5];
  gotoView(5); await sleep(160);
  ok('E5 这一手没有 history 时退回 lastEval（不是 0%、也不是空白）',
     wrTxt() === '黑 0.1%', wrTxt());
  state.history[5] = before;

  engineReady = savedReady;        // 还原，别把这个假状态留给下一个脚本
  applyNewGame(); await sleep(120);
  return L.join('\n');
})();
