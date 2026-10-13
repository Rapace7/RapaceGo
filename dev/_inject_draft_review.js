/* DSH 审查补充断言（2026-10-13 下午）：专打千问那版段①改动**没测到**的两处缺口。
 * 用法：node dev/_cdp_run.mjs ./_inject_draft_review.js
 *
 * 怀疑点（读代码得出，本脚本负责证真/证伪）：
 *   R4  enterDraft 调了 truncateAnalysisTo(from)，它会截 state.leads；
 *       而 snap 只存了 moves/viewAt/toMove/koPoint/candidates/candAt/history/histVisits/result/lastEval/clock
 *       —— **没有 leads**。→ 退出试下后目差曲线（leads 模式）后半段永久丢。
 *   R5  snap.toMove 记的是「进入时的轮次」（对应进入时的 moves.length），
 *       而退出后 viewAt 回到回看点 → 轮次应按 viewAt 重算，不该照搬快照。
 *   R6  同理 koPoint。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  const pts = ['D4', 'Q16', 'D16', 'Q4', 'C6', 'E3', 'F3', 'C4', 'E7', 'R14'];
  const G = s => { const m = /^([A-T])(\d+)$/.exec(s); return { x: m[1].charCodeAt(0) - 65, y: 19 - parseInt(m[2], 10) }; };
  for (const p of pts) { const c = G(p); tryPlay(c.x, c.y); }
  await sleep(150);

  /* 造三份伴随数组，模拟「刚复盘完」的完整数据（索引 0..10 共 11 项） */
  state.history = new Array(11).fill(0.5);
  state.leads = new Array(11).fill(1.5);
  state.histVisits = new Array(11).fill(5000);
  ok('前置：三份伴随数组各 11 项', state.history.length === 11 && state.leads.length === 11 && state.histVisits.length === 11);

  gotoView(5); await sleep(80);
  const tmAt5 = state.toMove;
  enterDraft(); await sleep(120);
  ok('R1 进试下后 leads 被截到 6 项以内（截断本身是预期行为）', state.leads.length <= 6, state.leads.length);
  ok('R2 ★ 快照 snap 里有没有 leads 这一项？', 'leads' in state.draft.snap,
    Object.keys(state.draft.snap).join(','));
  ok('R3 快照 toMove（进入时=10 手局面）', true, 'snap.toMove=' + state.draft.snap.toMove + ' / 回看点应=' + tmAt5);

  exitDraft(); await sleep(150);
  ok('R4 ★ 退出后 leads 应还原成 11 项', state.leads.length === 11, state.leads.length);
  ok('R5 ★ 退出后 toMove 应对应 viewAt', state.toMove === sideToMove(state.viewAt),
    'got=' + state.toMove + ' want=' + sideToMove(state.viewAt) + ' viewAt=' + state.viewAt + ' moves=' + state.moves.length);
  ok('R6 退出后 koPoint 应对应 viewAt 局面',
    JSON.stringify(state.koPoint) === JSON.stringify(koFromBoard(boardAt(state.viewAt), state.moves)),
    JSON.stringify(state.koPoint) + ' want=' + JSON.stringify(koFromBoard(boardAt(state.viewAt), state.moves)));

  applyNewGame(); await sleep(120);
  return L.join('\n');
})()
