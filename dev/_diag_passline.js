/* 诊断「按空格加了几手停一手之后，全盘讲解说这是分支」。
 * 用法：node dev/_cdp_run2.mjs ./_diag_passline.js 9333
 *
 * 首相的场景：打开棋谱 → 忘了空格=停一手，按了好几次 → 点全盘讲解 → 提示「这一条是分支」。
 *
 * 这里把每一步的**主变判定**和**树形**都打出来，看是第几步、因为什么变 false。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const say = s => L.push(s);

  /* 主链：从根沿每层 _cs[0] 走到底 */
  const mainChain = () => {
    const main = [];
    let cur = branchRoot;
    while (cur && cur._cs && cur._cs.length) { cur = cur._cs[0]; main.push(cur); }
    return main;
  };
  /* 一条链的文字形式（黑/白 + 坐标/停一手） */
  const chainTxt = (arr) => arr.map((n, i) =>
    (n.color === 'b' ? 'B' : n.color === 'w' ? 'W' : '?')
    + (n.pass || n.x < 0 ? 'pa' : (n.x + ',' + n.y))).join(' ');

  const snap = (tag) => {
    ensureBranch();
    const main = mainChain();
    const mv = state.moves;
    const sameLen = main.length === mv.length;
    let firstDiff = -1;
    for (let i = 0; i < Math.min(main.length, mv.length); i++) {
      if (main[i] !== mv[i]) { firstDiff = i; break; }
    }
    say('【' + tag + '】');
    say('  moves 长度 = ' + mv.length + '   主链长度 = ' + main.length
      + '   长度相同 = ' + sameLen + '   首个不同节点下标 = ' + firstDiff);
    say('  currentPathIsMainline() = ' + currentPathIsMainline());
    if (firstDiff >= 0 || !sameLen) {
      say('  moves: ' + chainTxt(mv));
      say('  主链 : ' + chainTxt(main));
    }
    return { main, mv, sameLen, firstDiff };
  };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';

  /* ---------- 用**真实棋谱**复现（首相是在打开棋谱的状态下按空格的） ---------- */
  const REC = '冲天之战-1985.sgf';
  let opened = '打不开';
  try { opened = await openRecord(REC); } catch (e) { opened = 'ERR ' + e; }
  await sleep(600);
  say('打开棋谱: ' + REC + '  → ' + opened + '   手数=' + state.moves.length
    + '   recName=' + state.recName + '   fromRecord=' + state.fromRecord);
  snap('R0 刚打开棋谱');

  for (let i = 1; i <= 4; i++) {
    const btn = document.getElementById('btn-pass');
    if (!btn) { say('★ 找不到 btn-pass'); break; }
    btn.click();
    await sleep(260);
    snap('R' + i + ' 按第 ' + i + ' 次空格之后');
  }

  /* 换一份也对一遍（首相那份 217 手的） */
  try {
    await openRecord('20261012-214057-217手.sgf');
    await sleep(600);
    say('');
    say('打开棋谱: 20261012-214057-217手.sgf   手数=' + state.moves.length);
    snap('S0 刚打开 217 手那份');
    document.getElementById('btn-pass').click();
    await sleep(260);
    snap('S1 按 1 次空格之后');
  } catch (e) { say('第二份打开失败: ' + e); }

  return L.join('\n');
})();
