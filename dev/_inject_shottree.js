/* 打开一份真实打谱谱（变着多），切到树面板，挂住等外面截图。
 * 用法：node dev/_cdp_run2.mjs ./_inject_shottree.js 9333
 * 这是**看效果用**的，不是断言。 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const REC = '152724_柯洁_B+R_芈昱廷_2025.11.05_第27届中国围甲联赛第9轮 深圳龙华VS江苏洋河_张香槟＆夏夏＆绝艺解说_.sgf';
  const out = [];
  try { await openRecord(REC); } catch (e) { out.push('打开失败: ' + e); }
  await sleep(900);
  const viewBtn = v => [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === v);
  if (viewBtn('tree')) viewBtn('tree').click();
  await sleep(700);
  const box = document.getElementById('branch-tree');
  if (box) box.scrollLeft = 0;
  await sleep(300);
  out.push('手数=' + state.moves.length + '  珠子=' + treeCells.length + '  行数=' + treeLanes
    + '  最大深度=' + treeMaxDepth);
  /* ★ 2026-10-14：再点一下「放大」，把大窗口的样子也拍下来 */
  const zb = document.getElementById('btn-treezoom');
  if (zb) { zb.click(); await sleep(600); }
  if (box) box.scrollLeft = 0;
  await sleep(300);
  out.push('放大窗宽=' + (box ? box.clientWidth : -1) + '  在大窗里=' + !!(box && box.closest('#treezoom')));
  await sleep(30000);
  return out.join('\n');
})();
