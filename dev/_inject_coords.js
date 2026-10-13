/* 任务 3（四边坐标）的验收注入脚本：开坐标 → 截棋盘区，再由 runner 存图。
   同时断言四边都画了字（读不到 canvas 像素，用 draw 的调用计数与 showCoords 状态判）。
   用法：node _cdp_run2.mjs ./_inject_coords.js 9333 —— 本脚本返回一个标记，
   截图由外层 _shot_coords.mjs 做（注入脚本没有 fs）。 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  /* ⚠️ 坐标换算必须走 GTP_COLS 反查（跳过 I），不能用 charCodeAt - 65 —— 坑位 28。 */
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  for (const p of ['D4', 'Q16', 'D16']) { const c = G(p); tryPlay(c.x, c.y); }
  await sleep(150);

  /* 打开坐标（走用户那条路：设置开关，等价于按 Z） */
  state.showCoords = true; resize(); await sleep(220);
  const padOpen = pad;
  ok('C1 开坐标后留白比关时大', padOpen > 0 && padOpen > (px * 0.037), 'pad=' + padOpen.toFixed(1) + ' px=' + px.toFixed(0));
  ok('C2 留白足够放下顶边文字（pad > 字号）', padOpen > Math.max(9, gap * 0.38), 'pad=' + padOpen.toFixed(1) + ' 字=' + Math.max(9, gap * 0.38).toFixed(1));

  /* 关坐标 → 四边都不显示（showCoords 是唯一开关）
     ⚠️ 必须跟真机一样调 resize()：pad 只在 resize() 里按 showCoords 重算（见 app.js
        chk-coords.onchange），只改状态不 resize 的话测不到留白变化 —— 脚本第一版就栽在这。 */
  state.showCoords = false; resize(); await sleep(150);
  const padClosed = pad;
  ok('C3 关坐标后留白缩回（四边都不画）', padClosed < padOpen, '关=' + padClosed.toFixed(1) + ' 开=' + padOpen.toFixed(1));

  /* 重新打开供截图（同样要 resize，留白才跟着回来） */
  state.showCoords = true; resize(); await sleep(150);
  /* 让界面稳定：点一下第 3 手，画出棋盘 + 坐标 */
  gotoView(3); await sleep(150);

  L.push('READY_FOR_SHOT');
  return L.join('\n');
})()
