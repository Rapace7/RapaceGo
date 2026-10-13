/* 棋盘上「计算中… N」的显示判据 —— 2026-10-13 DSH 写的。
 * 用法：node dev/_cdp_run2.mjs ./_inject_computing.js 9333
 *
 * 起因（首相原话）：「引擎没启动之前，棋盘上显示计算中，这不合理，不要显示这个东西，没意义」。
 * 实测确认：软件刚打开、引擎灯还亮着「未就绪」，棋盘上方就已经挂着那行字 ——
 * 用户会以为它在算，其实根本没开算，等到天荒地老也不出点，只能被当成"坏了"。
 *
 * 判据已抽成纯函数 `shouldShowComputing()`（抽出来就是为了这一段能测：
 * 原来那串条件掺着引擎状态，探针里造不出来，只能靠人眼截图看）。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));

  /* 摆一手，保证 moves 非空（判据里要用到 moves.length） */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  tryPlay(3, 15); await sleep(120);
  ok('C0 前置：盘上有 1 手', state.moves.length === 1, state.moves.length);

  const save = { er: engineReady, mode: settings.mode, hints: state.showHints, noGame: state.noGame };
  settings.mode = 'free';
  state.showHints = true;
  state.noGame = false;
  state.candAt = -1;                       // 「这一手的点还没算出来」
  const n = state.moves.length;
  state.viewAt = n;

  engineReady = false;
  ok('C1 ★ 引擎没就绪 → 一个字都不画（首相报的那条）', shouldShowComputing() === false);

  engineReady = true;
  ok('C2 引擎就绪 + 点还没算出来 → 画「计算中」', shouldShowComputing() === true);

  state.candAt = state.viewAt;
  ok('C3 点已经算出来了 → 不画', shouldShowComputing() === false);

  state.candAt = -1;
  state.showHints = false;
  ok('C4 关掉推荐点（T 键）→ 不画', shouldShowComputing() === false);

  state.showHints = true;
  state.viewAt = 0;
  ok('C5 正在回看历史手 → 不画', shouldShowComputing() === false);

  state.viewAt = n;
  state.noGame = true;
  ok('C6 还没开局 → 不画', shouldShowComputing() === false);

  /* 还原现场（这条脚本跑在真实例里，别把状态留给下一个脚本） */
  state.noGame = save.noGame;
  state.showHints = save.hints;
  engineReady = save.er;
  settings.mode = save.mode;
  applyNewGame(); await sleep(120);
  return L.join('\n');
})();
