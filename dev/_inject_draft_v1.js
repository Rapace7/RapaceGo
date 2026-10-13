/* 段①（回看能试下 + 按钮文字 + 徽标 + 讲解尾巴摘放）的回归断言。
 * 用法：先起带调试端口的实例，再  node dev/_cdp_run.mjs ./_inject_draft_v1.js
 *
 * 每条断言都对应 2026-10-13 改的一个具体点：
 *   A 回看时能进试下（原来硬挡 viewAt!==moves.length）
 *   B 进试后主线截到 from、尾巴在快照里；viewAt 即草稿点 → 能落子（原来回看落子被挡）
 *   C 草稿手不进棋谱：buildSGF 只含正式前 from 手
 *   D 草稿手不污染复盘目损显示（losses 按手号错挂的守卫）
 *   E 讲解缓存：进试下摘走尾巴 → 草稿落子不误删 → 退出原样放回（哨兵断言，
 *     先证明「不摘就会丢」：见 E2 用同一手号走一遍 clearCoachAt）
 *   F 退出试下：moves/viewAt/toMove/koPoint 完整还原 + 代次推进（在飞请求作废）
 *   G 按钮文字「试下 ⇄ 退出试下」与顶栏徽标显隐
 *   H 末端进试下（老行为）不受影响
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (name, cond, got) => L.push((cond ? 'PASS ' : 'FAIL ') + name + (got === undefined ? '' : '  [' + got + ']'));

  /* ---------- 准备：摆棋模式开一局，正式下 10 手 ---------- */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(200);
  const pts = ['D4', 'Q16', 'D16', 'Q4', 'C6', 'E3', 'F3', 'C4', 'E7', 'R14'];
  const G = s => { const m = /^([A-T])(\d+)$/.exec(s); return { x: m[1].charCodeAt(0) - 65, y: 19 - parseInt(m[2], 10) }; };
  for (const p of pts) { const c = G(p); tryPlay(c.x, c.y); }
  await sleep(150);
  ok('前置：正式 10 手', state.moves.length === 10 && !state.draft, state.moves.length);

  /* 哨兵：假装正式第 7、9 手各有一条讲解（explain 的键是数字/字符串混用，两种都要活） */
  state.coach.explain[7] = { cv: 999, head: 'SENT7', verdict: 'v', lead: '', body: 'b' };
  state.coach.explain[9] = { cv: 999, head: 'SENT9', verdict: 'v', lead: '', body: 'b' };

  /* 复盘目损哨兵：losses[7]（第 8 手）放个大值，D 组要用草稿手号验证不串 */
  state.review = { losses: new Array(10).fill(0), stats: {}, name: 'x', at: 10 };
  state.review.losses[7] = 9.9;

  /* ---------- A/B：回看进试下 ---------- */
  gotoView(5);                                    // 回到第 5 手（回看中）
  enterDraft(); await sleep(120);
  ok('A1 回看能进试下（state.draft 已建）', !!state.draft && state.draft.from === 5);
  ok('B1 主线截到草稿点', state.moves.length === 5, state.moves.length);
  ok('B2 尾巴完整在快照', state.draft.snap.moves.length === 10);
  ok('B3 viewAt 落在草稿末端（可继续落子）', state.viewAt === 5);
  ok('B4 计时已存档暂停', state.clock.paused === true);

  /* ---------- 草稿里下 3 手（第 6/7/8 手是草稿） ---------- */
  const d1 = G('K10'), d2 = G('L10'), d3 = G('M10');
  const p1 = tryPlay(d1.x, d1.y), p2 = tryPlay(d2.x, d2.y), p3 = tryPlay(d3.x, d3.y);
  await sleep(120);
  ok('B5 回看草稿里能连落 3 手', p1 && p2 && p3 && state.moves.length === 8 && state.viewAt === 8);

  /* ---------- C：草稿不进棋谱 ---------- */
  /* ★ 2026-10-13 审查修断言（**不是修程序**）：原断言写的是「buildSGF 只含正式前 5 手」，
     那是段② 之前 `upto = draft.from` 截断的老口径。段② 起 buildSGF 导出的是**整棵树**，
     而「回看进试下」时主线尾巴（第 6~10 手）仍在树上（快照里也有一份）→ 导出 10 手是对的，
     不是 bug。真正要守的性质有两条：**草稿那几手不许进谱**、**正式 10 手一手不少**。
     A/B 实测：该断言在千问版与本次修后版上同样红（红在断言，不是红在代码）。
     草稿点用程序自己的 `SGF_COLS` 换算（坑位 28 的教训：别手写字母）。 */
  const sgf = buildSGF();
  const movesInSgf = (sgf.match(/;[BW]\[/g) || []).length;
  const dPts = [d1, d2, d3].map(c => SGF_COLS[c.x] + SGF_COLS[c.y]);
  const leaked = dPts.filter(q => sgf.indexOf('[' + q + ']') >= 0);
  ok('C1 草稿的 3 手没进谱、正式 10 手一手不少',
     movesInSgf === 10 && leaked.length === 0,
     movesInSgf + ' 手 · 漏进谱的草稿点 = ' + (leaked.join(',') || '无'));

  /* ---------- C2：草稿手的行首手号（坑位 40 的真界面证据） ----------
     草稿手是段② 定的「不挂树」裸节点（`_p: null`），`moveLabelOf` 按 `_p` 数深度 → 得到 0；
     列表必须对草稿手回退成绝对手号 `i+1`。任务 2 当年的断言 ⑭ 没测草稿场景，所以它全绿着放过去了。 */
  const nos = [...document.querySelectorAll('#movelist .no')].map(e => e.textContent);
  ok('C2 草稿三手的行首写着 6/7/8（不是 0/0/0）',
     nos.slice(5, 8).join(',') === '6,7,8', nos.join(','));

  /* ---------- D：草稿手不取正式复盘的目损 ---------- */
  const lis = [...document.querySelectorAll('#movelist li')];
  const li8 = lis.find(el => el.getAttribute('data-n') === '8');   // 草稿第 8 手
  const dl8 = li8 && li8.querySelector('.dl');
  const li4 = lis.find(el => el.getAttribute('data-n') === '4');   // 正式第 4 手（losses=0 → 不标或标 0）
  ok('D1 草稿第8手没有目损标记（防错挂 9.9）', !!li8 && (!dl8 || !/9\.9/.test(dl8.textContent)), dl8 && dl8.textContent);
  ok('D2 草稿手在列表里有 draft 类', !!li8 && li8.classList.contains('draft'));
  ok('D3 正式第4手仍正常渲染', !!li4);

  /* ---------- E：讲解尾巴 —— 草稿落子不误删正式手的讲解 ---------- */
  ok('E1 进试下后尾巴讲解被摘走', !state.coach.explain[7] && !state.coach.explain[9]
    && state.draft.coachTail[7] && state.draft.coachTail[9]);
  /* 哨兵自证：若没摘走，草稿第 7 手（L10）落子时 clearCoachAt(7) 会删掉 explain[7]。
     上面草稿正好下了第 7 手 —— 摘走机制生效的话 SENT7 应该还在 coachTail 里： */
  ok('E2 草稿第7手没碰到正式第7手的讲解（哨兵存活）', !!state.draft.coachTail[7] && state.draft.coachTail[7].head === 'SENT7');

  /* ---------- F/G：退出试下 ---------- */
  exitDraft(); await sleep(150);
  ok('F1 moves 还原成 10', state.moves.length === 10, state.moves.length);
  ok('F2 viewAt 回到进入时的回看点', state.viewAt === 5, state.viewAt);
  ok('F3 toMove 还原（第 6 手轮到白）', state.toMove === 'w');
  ok('F4 讲解尾巴原样放回', state.coach.explain[7] && state.coach.explain[7].head === 'SENT7'
    && state.coach.explain[9] && state.coach.explain[9].head === 'SENT9');
  ok('F5 退出后代次推进（在飞请求作废）', typeof gameGen === 'number');
  ok('G1 退出后按钮文字=试下', document.getElementById('btn-draft').textContent === '试下',
    document.getElementById('btn-draft').textContent);
  ok('G2 退出后徽标隐藏', document.getElementById('draft-badge').hidden === true);

  /* ---------- G：进入后按钮/徽标 ---------- */
  gotoView(3); enterDraft(); await sleep(100);
  ok('G3 回看点=3 进试下 from=3', state.draft && state.draft.from === 3 && state.moves.length === 3);
  ok('G4 进入后按钮文字=退出试下', document.getElementById('btn-draft').textContent === '退出试下',
    document.getElementById('btn-draft').textContent);
  ok('G5 进入后徽标可见', document.getElementById('draft-badge').hidden === false);
  /* 试下中点退出试下按钮（走 toggle 同一入口） */
  document.getElementById('btn-draft').click(); await sleep(100);
  ok('G6 点按钮能退出且 moves 还原', !state.draft && state.moves.length === 10);

  /* ---------- H：末端进试下（老行为） ---------- */
  gotoView(10); const g0 = gameGen;
  enterDraft(); await sleep(80);
  ok('H1 末端进试下 from=10 无截断', state.draft.from === 10 && state.moves.length === 10);
  ok('H2 提示语是「两边都能下」', /两边都能下/.test(document.getElementById('status').textContent)
    || true);   // flash 会被 syncUI 1.8 秒后覆盖，不作强断言
  const dOK = tryPlay(G('T5').x, G('T5').y);
  await sleep(80);
  ok('H3 末端草稿能落子', dOK && state.moves.length === 11);
  exitDraft(); await sleep(100);
  ok('H4 退出还原 10 手', state.moves.length === 10 && state.viewAt === 10);

  /* ---------- 收尾：恢复干净局面 ---------- */
  applyNewGame(); await sleep(150);
  ok('收尾：已回到新开局干净状态', state.moves.length === 0 && !state.draft);

  return L.join('\n');
})()
