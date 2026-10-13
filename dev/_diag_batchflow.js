/* 诊断：全盘讲解「选完第一个窗之后什么都不发生」。
 * 用法：node dev/_cdp_run2.mjs ./_diag_batchflow.js 9333
 *
 * 做法：把 needEngine 打桩成"永远就绪"（否则前面几道闸门直接 return，根本走不到弹窗），
 *       再摆出「有胜率 + 有讲解」的状态，然后一步步走：
 *         ① 调 runBatchCoach（不 await）→ 窗一出来了吗？
 *         ② 点「跳过重算」→ **窗二出来了吗**（首相报的正是这里不动）
 *         ③ 点「接着讲」→ 看进到哪一步（进度条文案 / 是否抛错）
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const say = s => L.push(s);
  const mask = () => document.getElementById('batchask');
  const isOpen = () => !!mask() && mask().classList.contains('open');
  const btns = () => [...mask().querySelectorAll('#ba-actions button')];
  const barTxt = () => { const e = document.querySelector('#batchbar, .batchbar, #coach-bar'); return e ? e.textContent.trim() : '(找不到进度条元素)'; };

  say('=== 现场 ===');
  say('needEngine 是不是函数声明: ' + (typeof needEngine));
  say('batchAsking 初值: ' + (typeof batchAsking !== 'undefined' ? batchAsking : '(取不到)'));

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  for (const [x, y] of [[3, 15], [15, 3], [3, 3], [15, 15], [2, 13], [16, 9]]) tryPlay(x, y);
  await sleep(150);
  const n = state.moves.length;
  say('手数 n = ' + n);

  /* 打桩：引擎一律当作就绪 —— 否则走不到弹窗那一步 */
  const origNeed = needEngine;
  needEngine = () => false;

  /* 摆状态：有胜率 + 有 3 手讲解 + 站在主变上 */
  state.fromRecord = true;
  state.recName = '自测-假棋谱.sgf';
  state.draft = null;
  state.review = { file: state.recName, history: new Array(n + 1).fill(0.5), leads: new Array(n + 1).fill(0) };
  state.history = new Array(n + 1).fill(0.5);
  state.leads = new Array(n + 1).fill(0);
  state.coach.explain = {};
  for (let i = 1; i <= 3; i++) state.coach.explain[i] = { cv: COACH_VER, head: 'h', body: 'b'.repeat(80) };

  say('currentPathIsMainline() = ' + currentPathIsMainline());
  const info = batchAskInfo(n);
  say('batchAskInfo: askReview=' + info.askReview + ' askCoach=' + info.askCoach
    + ' doneAt=' + info.doneAt.length);

  /* ---------- ① 开跑 → 窗一该出来 ---------- */
  let err = null;
  let p = runBatchCoach().catch(e => { err = String(e); });
  await sleep(300);
  say('① 窗一开着吗: ' + isOpen() + (isOpen() ? '  标题=' + mask().querySelector('#ba-title').textContent : ''));
  if (isOpen()) say('   按钮: ' + btns().map(b => b.textContent).join(' | '));

  /* ---------- ② 点「跳过重算」→ 窗二该出来（首相报的就是这里不动） ---------- */
  if (isOpen()) {
    btns()[0].click();
    await sleep(400);
    say('② 点了「跳过重算」之后 —— 窗二开着吗: ' + (isOpen() ? '✅ 开了' : '❌ 没开'));
    if (isOpen()) {
      say('   标题=' + mask().querySelector('#ba-title').textContent);
      say('   按钮: ' + btns().map(b => b.textContent).join(' | '));
    }
    say('   batchAsking 现在 = ' + batchAsking);
    say('   state.coach.batch 现在 = ' + JSON.stringify(state.coach.batch));
  }

  /* ---------- ③ 点「接着讲」→ 看进到哪 ---------- */
  if (isOpen()) {
    btns()[0].click();
    await sleep(600);
    say('③ 点了「接着讲」之后：');
    say('   窗还开着吗: ' + isOpen());
    say('   state.coach.batch = ' + JSON.stringify(state.coach.batch));
    say('   进度条文案 = ' + barTxt());
  }

  batchStop = true;
  await sleep(400);
  say('runBatchCoach 抛错: ' + (err || '无'));

  needEngine = origNeed;
  state.coach.batch = null;
  setBatchBar(false, 0, 0, '');
  return L.join('\n');
})();
