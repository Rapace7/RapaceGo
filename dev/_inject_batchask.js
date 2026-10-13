/* 「全盘讲解前先问一句」的回归 —— 2026-10-14 首相要求。
 * 用法：node dev/_cdp_run2.mjs ./_inject_batchask.js 9333
 *
 * 首相原话（拆成三条规格）：
 *   ① 棋谱已经被 KataGo 全盘算过 → 点「全盘讲解」不该再重算，
 *      弹窗提示「已有全盘 AI 胜率记录」，说明这东西是干啥的，**推荐跳过**；
 *   ② 如果没有任何现有讲解 → **不问，直接跑**；
 *   ③ 如果已经有讲解 → 弹窗问「从头重跑」还是「从未讲的手继续」；
 *      重跑 = 抹掉所有已存在的，从第一手开始。
 *
 * ★ 为什么这条脚本只测 `batchAskInfo()` 与弹窗本身，**不调 runBatchCoach()**：
 *   真跑一次全盘讲解要起 KataGo 整盘分析（几分钟）+ LoGos 逐手讲（更久），
 *   而且那条通路在前面几道闸门里就会开始发请求 —— 脚本会卡在那儿。
 *   判定逻辑已经抽成纯函数，直接把三种情况摆出来测即可。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  for (const [x, y] of [[3, 15], [15, 3], [3, 3], [15, 15], [2, 13], [16, 9]]) tryPlay(x, y);
  await sleep(150);
  const n = state.moves.length;
  ok('BA0 前置：6 手', n === 6, n);

  const saveRev = state.review, saveEx = state.coach.explain, saveName = state.recName;
  state.recName = '自测-假棋谱.sgf';

  /* ---------- ① 都没有 → 不问（返回 null），这正是首相要的「别问，直接跑」 ---------- */
  state.review = null; state.coach.explain = {};
  ok('BA1 ★ 既没胜率也没讲解 → 不问（返回 null = 直接开跑）', batchAskInfo(n) === null);

  /* ---------- ② 只有胜率 → 问「跳过重算」，且**推荐项放第一位** ---------- */
  state.review = { file: state.recName, history: new Array(n + 1).fill(0.5), leads: new Array(n + 1).fill(0) };
  let a = batchAskInfo(n);
  ok('BA2 有胜率、没讲解 → 要问', !!a);
  ok('BA3 ★ 推荐项 =「跳过重算」，在第一个',
    !!a && a.buttons[0].label.indexOf('跳过重算') >= 0, a && a.buttons.map(b => b.label).join(' | '));
  ok('BA4 推荐项的语义 = skipReview:true / fromScratch:false',
    !!a && a.buttons[0].value.skipReview === true && a.buttons[0].value.fromScratch === false);
  ok('BA5 ★ 正文说明了「胜率记录是干啥的」（提到"亏了多少"与"走势图"）',
    !!a && a.body.indexOf('亏') >= 0 && a.body.indexOf('走势图') >= 0, a && a.body.slice(0, 80));
  ok('BA6 备选里有「重新算一遍胜率」', !!a && a.buttons.some(b => b.label.indexOf('重新算') >= 0),
    a && a.buttons.map(b => b.label).join(' | '));
  ok('BA7 有「取消」，value 为 null',
    !!a && a.buttons[a.buttons.length - 1].label === '取消' && a.buttons[a.buttons.length - 1].value === null);

  /* ---------- ③ 只有讲解 → 问「接着讲」还是「从头重跑」 ---------- */
  state.review = null;
  state.coach.explain = {};
  for (let i = 1; i <= 3; i++) state.coach.explain[i] = { cv: COACH_VER, head: 'h', body: 'b' };
  a = batchAskInfo(n);
  ok('BA8 有讲解 → 要问', !!a);
  ok('BA9 ★ 推荐项 =「接着讲没讲过的」，在第一个',
    !!a && a.buttons[0].label.indexOf('接着讲') >= 0, a && a.buttons.map(b => b.label).join(' | '));
  ok('BA10 「接着讲」的语义 = fromScratch:false', !!a && a.buttons[0].value.fromScratch === false);
  const iS = a ? a.buttons.findIndex(b => b.label.indexOf('从头重跑') >= 0) : -1;
  ok('BA11 有「从头重跑」项', iS >= 0, a && a.buttons.map(b => b.label).join(' | '));
  ok('BA12 ★ 「从头重跑」的语义 = fromScratch:true', iS >= 0 && a.buttons[iS].value.fromScratch === true);
  ok('BA13 正文报清了「讲过几手 / 还剩几手」',
    !!a && a.body.indexOf('3 / 6') >= 0 && a.body.indexOf('还剩') >= 0, a && a.body.slice(0, 130));

  /* ---------- ④ 两样都有 → 也得问，推荐仍是「接着讲」 ---------- */
  state.review = { file: state.recName, history: new Array(n + 1).fill(0.5), leads: new Array(n + 1).fill(0) };
  a = batchAskInfo(n);
  ok('BA14 两样都有 → 要问，推荐仍是「接着讲」', !!a && a.buttons[0].label.indexOf('接着讲') >= 0);
  ok('BA15 两样都有时，正文把两者都写清楚了',
    !!a && a.body.indexOf('整盘 AI 胜率') >= 0 && a.body.indexOf('逐手讲解') >= 0);

  /* ---------- ⑤ 弹窗本身能开、按钮能点、能拿到返回值 ---------- */
  const p = askBatchPlan({
    title: 'T', body: '<b>x</b>',
    buttons: [{ label: '甲', value: 1, primary: true }, { label: '乙', value: 2 }, { label: '取消', value: null }],
  });
  await sleep(140);
  const mask = document.getElementById('batchask');
  ok('BA16 弹窗真的开了（.open）', !!mask && mask.classList.contains('open'));
  const bs = [...mask.querySelectorAll('#ba-actions button')];
  ok('BA17 三个按钮都在，第一个是 primary',
    bs.length === 3 && bs[0].classList.contains('primary'), bs.map(b => b.textContent).join('|'));
  bs[1].click();
  const v = await p;
  await sleep(90);
  ok('BA18 点「乙」拿到 2，弹窗同时关闭', v === 2 && !mask.classList.contains('open'), String(v));

  /* 还原现场 */
  state.review = saveRev; state.coach.explain = saveEx; state.recName = saveName;
  applyNewGame(); await sleep(150);
  return L.join('\n');
})();
