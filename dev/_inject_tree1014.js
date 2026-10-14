/* 分支树布局重写的回归（2026-10-14，首相实测「交叉在一起看都看不明白」）。
 * 用法：node dev/_cdp_run2.mjs ./_inject_tree1014.js 9333
 *
 * 布局范式换了：
 *   旧 —— 主变恒占第 0 行，侧支调 pickRow 去"复用"别的行 → 下落线要跨过中间行 → 分支密集必交叉；
 *   新 —— 深度=横轴、分叉=纵轴；**主变继承父行**、**每条侧支独占新行**（全局递增）。
 *
 * 这条脚本的核心断言是「**任何一条下落线段上都没有别的珠子**」——
 * 那是"不交叉"的**充要条件**（线只从父珠心垂到子珠心，中间没珠子就绝不会压到谁）。
 * 另外验：去掉字母后缀、左上角不再零距离贴边（折叠角标要完整落在面板里）。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const G = s => ({ x: s.charCodeAt(0) - 65 - (s.charCodeAt(0) > 73 ? 1 : 0), y: 19 - parseInt(s.slice(1), 10) });

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);

  /* ---------- 造一棵「分支密集」的树：主变 3 手，再挂多层侧支（模拟打谱谱） ---------- */
  for (const s of ['Q16', 'C16', 'D14']) { const p = G(s); tryPlay(p.x, p.y); await sleep(80); }
  gotoView(3); await sleep(60);
  for (const s of ['K10', 'L10']) { const p = G(s); tryPlay(p.x, p.y); await sleep(80); }   // 侧支 A（2 手）
  gotoView(4); await sleep(60);
  for (const s of ['M11', 'N11', 'O11']) { const p = G(s); tryPlay(p.x, p.y); await sleep(80); }  // 侧支 B（3 手，更深）
  gotoView(3); await sleep(60);
  const p2 = G('R5'); tryPlay(p2.x, p2.y); await sleep(80);                                // 侧支 C（1 手）
  gotoView(4); await sleep(60);
  const p3 = G('S6'); tryPlay(p3.x, p3.y); await sleep(120);                               // 侧支 B' 的分叉

  /* 切到「树」视图 —— 走标题旁那个滑杆（与 _inject_tree_v1 同一套做法） */
  const viewBtn = v => [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === v);
  viewBtn('tree').click(); await sleep(260);
  ok('T0 前置：树上珠子数 > 8（分支确实造出来了）', treeCells.length > 8, '珠子 ' + treeCells.length + ' 颗');

  /* ---------- ① ★ 核心：任何一条下落线段上都没有别的珠子 ---------- */
  let conflict = 0, firstBad = '';
  for (const c of treeCells) {
    const pp = treePosOf.get(c.node._p);
    if (!pp || pp.r === c.row) continue;                 // 只查"侧支起头"那种竖线段
    const lo = Math.min(pp.r, c.row), hi = Math.max(pp.r, c.row);
    for (const other of treeCells) {
      if (other === c) continue;
      if (other.depth !== pp.d || other.row <= lo || other.row >= hi) continue;
      conflict++;
      if (!firstBad) firstBad = '第' + other.depth + '手/行' + other.row + ' 挡在第' + pp.d + '手的下落线上';
    }
  }
  ok('T1 ★ 任何一条侧支的下落线段上都没有别的珠子 → **数学上不可能交叉**',
    conflict === 0, conflict ? (conflict + ' 处冲突，首个：' + firstBad) : '零冲突');

  /* ---------- ② 主变继承父行：主变那串应该整条待在第 0 行 ---------- */
  const mainRows = new Set();
  for (let cur = branchRoot._cs && branchRoot._cs[0]; cur; cur = cur._cs && cur._cs[0]) {
    const pos = treePosOf.get(cur);
    if (pos) mainRows.add(pos.r);
  }
  ok('T2 ★ 主变整条都在同一行（继承父行，不再被侧支挤走）',
    mainRows.size === 1 && mainRows.has(0), '主变占了行号 ' + [...mainRows].join(','));

  /* ---------- ③ 每条侧支独占一行（行号两两不同） ---------- */
  const branchHeads = [];
  for (const c of treeCells) {
    const pp = treePosOf.get(c.node._p);
    if (pp && pp.r !== c.row) branchHeads.push({ r: c.row, d: c.depth });
  }
  const rs = branchHeads.map(x => x.r);
  ok('T3 ★ 每条侧支各占一个新行（行号互不相同 —— 这正是"不共用就不交叉"的依据）',
    new Set(rs).size === rs.length, '侧支 ' + rs.length + ' 条，行号 ' + rs.join(','));

  /* ---------- ④ 去掉字母后缀 ---------- */
  const labels = treeCells.map(c => moveLabelOf(c.node));
  ok('T4 ★ 珠子只印真实手数、**没有字母后缀**（靠纵向位置区分变着 —— 业界惯例）',
    labels.every(x => /^\d+$/.test(x)), labels.join(','));
  ok('T5 旁支的手数与主线**会重复**（4/5 各出现两次）—— 这是有意为之，靠位置分辨',
    labels.filter(x => x === '4').length >= 2, '4 出现 ' + labels.filter(x => x === '4').length + ' 次');

  /* ---------- ⑤ 左上角不再零距离贴边：折叠角标要完整落在面板里 ---------- */
  const box = document.getElementById('branch-tree');
  const inner = box.firstElementChild;
  const firstCap = document.querySelector('#branch-tree .cap');
  const capLeft = parseFloat(firstCap.style.left), capTop = parseFloat(firstCap.style.top);
  ok('T6 ★ 左上第一颗珠子有左边距（不再零距离贴边）', capLeft >= 14, 'left=' + capLeft);
  ok('T7 ★ 第一行上方留了空（折叠角标 top:-9px 不会被切掉）', capTop >= 10, 'top=' + capTop);
  /* 角标真的在容器可视区里（真去量 DOM，不看样式声明） */
  const foldEl = document.querySelector('#branch-tree .cap .tf');
  if (foldEl) {
    const fb = foldEl.getBoundingClientRect(), ib = inner.getBoundingClientRect();
    ok('T8 ★ 折叠角标的实际矩形完整落在画布内（左/上都没被裁）',
      fb.left >= ib.left - 0.5 && fb.top >= ib.top - 0.5,
      '角标 left=' + Math.round(fb.left) + ' top=' + Math.round(fb.top)
      + ' / 画布 left=' + Math.round(ib.left) + ' top=' + Math.round(ib.top));
  } else {
    ok('T8 折叠角标（这颗珠子后面有侧支，理应存在）', false, '找不到 .tf');
  }

  /* ---------- ⑥ 行高足够，珠子之间不重叠 ---------- */
  let overlap = 0;
  const byRow = new Map();
  for (const c of treeCells) {
    const k = c.row + ':' + c.depth;
    if (byRow.has(k)) overlap++;
    byRow.set(k, 1);
  }
  ok('T9 同一格（行+列）不会塞两颗珠子', overlap === 0, overlap + ' 处重叠');

  viewBtn('list').click(); await sleep(150);
  applyNewGame(); await sleep(120);
  return L.join('\n');
})();
