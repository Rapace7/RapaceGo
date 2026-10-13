/* 把「全盘讲解」的询问窗**真的弹出来**，并挂住不返回 —— 好让外部截图看到实际长相。
 * 用法：node dev/_cdp_run2.mjs ./_inject_showask.js 9333     （它不会自己退出，20 秒后结束）
 *
 * WHICH=1 → 弹【窗一：整盘胜率要不要重算】
 * WHICH=2 → 弹【窗二：从哪里开始讲】
 */
(async function () {
  const WHICH = 2;                       // ← 改这里换窗
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  for (let i = 0; i < 214; i++) {        // 造一份「217 手」的假棋谱（只为弹窗里的数字好看）
    const x = i % 19, y = Math.floor(i / 19);
    if (!tryPlay(x, y)) { /* 撞子就跳过 */ }
  }
  await sleep(200);
  const n = state.moves.length;

  state.recName = '20261012-214057-217手.sgf';
  state.review = { file: state.recName, history: new Array(n + 1).fill(0.5), leads: new Array(n + 1).fill(0) };
  state.coach.explain = {};
  let done = 0;
  for (let at = 1; at <= n && done < 10; at++) { state.coach.explain[at] = { cv: COACH_VER, head: 'h', body: 'b' }; done++; }

  const a = batchAskInfo(n);
  askBatchPlan({
    title: WHICH === 1 ? '全盘讲解 · 整盘胜率要不要重算？' : '全盘讲解 · 从哪里开始讲？',
    body: WHICH === 1 ? a.revBody : a.coachBody,
    buttons: WHICH === 1 ? a.revButtons : a.coachButtons,
  });
  await sleep(20000);                    // 挂着，等外面截图
  return 'showask done (which=' + WHICH + ', n=' + n + ')';
})();
