/* 验收 loadReviewForRecord（2026-10-13 凌晨写的「打开棋谱自动带出每手胜率」，一直没实机验过）。
 * 用真实棋谱 records/20261012-214057-217手.sgf（含 .review.json）走一遍完整打开流程。
 * 用法：node dev/_cdp_run.mjs ./_inject_reviewload.js */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));

  const name = '20261012-214057-217手.sgf';
  const rd = await window.api.records.read(name);
  if (!rd || rd.error) return 'FAIL 读棋谱失败: ' + JSON.stringify(rd);
  const p = parseSGF(rd.text);
  if (!p || !p.ok) return 'FAIL 解析失败';

  applyRecord(p, name);
  /* ★ 2026-10-13 审查修断言（不是修程序）：原来这条把检查放在 `await sleep(150)` **之后**，
     想证明「复盘数是异步填的」—— 但 150ms 在本机热缓存下读盘早就回来了，于是它一直红
     （千问版和本次修后版 A/B 跑过，同样红，不是这次改动引入的）。
     要证「同步阶段还没填好」必须在**同一个同步块里**取值，不能被 await 隔开。 */
  const histSync = state.history.filter(x => typeof x === 'number').length;
  ok('L0b 同步阶段 history 还是空的（填是异步的）', histSync === 0, histSync);
  await sleep(150);
  ok('L0 打开后手数正确（217）', state.moves.length === 217, state.moves.length);

  await sleep(900);      // 等 loadReviewForRecord 读盘回来
  const nH = state.history.filter(x => typeof x === 'number').length;
  const nL = state.leads.filter(x => typeof x === 'number').length;
  ok('★L1 history（胜率）被自动填上', nH > 200, nH);
  ok('★L2 leads（目差）被自动填上', nL > 200, nL);
  ok('★L3 histVisits（精度标记）被填', state.histVisits.length > 200, state.histVisits.length);
  ok('L4 state.review 就位（含 losses）', !!state.review && Array.isArray(state.review.losses),
    state.review ? ('losses=' + state.review.losses.length) : 'null');

  const dl = [...document.querySelectorAll('#movelist li .dl')];
  const withNum = dl.filter(e => /\d/.test(e.textContent)).length;
  ok('★L5 手数列表的「涨跌」列有数字', withNum > 100, withNum + '/' + dl.length);

  const sgf2 = buildSGF();
  ok('L6 打开后导出仍只有一份主变、手数不变', (sgf2.match(/;[BW]\[/g) || []).length === 217,
    (sgf2.match(/;[BW]\[/g) || []).length);
  return L.join('\n');
})()
