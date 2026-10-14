/* 分支树布局的回归（2026-10-14 深夜**第四版** —— 按首相看图后新提的两条重写）。
 * 用法：node dev/_cdp_run2.mjs ./_inject_tree1014.js 9555
 *
 * ★ 这一版针对首相的两条新要求：
 *   ① 「先展开的应该被后展开的挤下去，让**最近展开的那个保持在最靠主干的地方**」
 *      → T12：先展开支 A → 再展开与它冲突的支 B → **B 必须跑到 A 上面去**。
 *   ② 「明显不会碰到的两条，居然没处在同一行……**这太浪费行数了**」
 *      → T13：两条列区间不重叠的支，**必须共用同一行**。
 *   ③ 「自适应上下让位」→ T14：总行数不超过"每支一行"的上限。
 *
 * 一直保留的硬要求：A1 任一连线到任何别的珠心的距离 > 珠半径（**零接触**）。
 *
 * ⚠️ 造树时切分支一律走 `switchBranch(分叉点深度, 第几个孩子)`：
 *    用 `gotoNode` 会踩到"单分支点上切换失败、路径切一半就返回"的老坑（已修，但这里用更直白的写法）。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const G = s => ({ x: s.charCodeAt(0) - 65 - (s.charCodeAt(0) > 73 ? 1 : 0), y: 19 - parseInt(s.slice(1), 10) });
  const put = async s => { const p = G(s); tryPlay(p.x, p.y); await sleep(80); };
  const mainNode = n => { let c = branchRoot; for (let i = 0; i < n; i++) c = c._cs[0]; return c; };
  const cellOf = node => treeCells.find(c => c.node === node);
  const rowOf = node => { const c = cellOf(node); return c ? c.row : -1; };
  const viewBtn = v => [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === v);
  const clickFold = async (d, r) => {
    const tf = document.querySelector('#branch-tree .cap[data-d="' + d + '"][data-r="' + r + '"] .tf');
    if (!tf) return false;
    tf.click(); await sleep(300);
    return true;
  };

  /* ================= 造树 =================
     主线 12 手；
     第 4 手后 → 支 A（K10 / L10，占列 5、6）
     第 5 手后 → 支 B（N11 / O11，占列 6、7）—— **与 A 在列 6 上冲突**（不同父，能分先后展开）
     第 8 手后 → 支 C（T19，占列 9）—— **与 A、B 都不冲突**（用它验"省行"） */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(240);
  const MAIN = ['Q16', 'C16', 'D14', 'E17', 'D16', 'D17', 'E16', 'C17', 'F16', 'R5', 'Q3', 'R3'];
  for (const s of MAIN) await put(s);
  gotoView(4); await sleep(80); await put('K10'); await put('L10');              // 支 A
  switchBranch(4, 0); await sleep(160);                                          // ★ 切回主线
  gotoView(5); await sleep(80); await put('N11'); await put('O11');              // 支 B
  switchBranch(5, 0); await sleep(160);                                          // ★ 切回主线
  gotoView(8); await sleep(80); await put('T19');                                // 支 C

  gotoView(3); await sleep(160);                       // 回主线，干净地验"默认收起"
  viewBtn('tree').click(); await sleep(340);

  const A = mainNode(4)._cs[1];        // 支 A 的起头（K10，列 5）
  const B = mainNode(5)._cs[1];        // 支 B 的起头（N11，列 6）
  const C = mainNode(8)._cs[1];        // 支 C 的起头（T19，列 9）
  const shape = '主链 ' + (function () { let n = branchRoot, k = 0; while (n._cs && n._cs.length) { n = n._cs[0]; k += 1; } return k; })()
    + ' 手 | A=' + !!A + ' B=' + !!B + ' C=' + !!C
    + ' | 第4手孩子 ' + (mainNode(4)._cs || []).length
    + ' 第5手孩子 ' + (mainNode(5)._cs || []).length
    + ' 第8手孩子 ' + (mainNode(8)._cs || []).length;

  /* ---------- T0a 默认全部收起 ---------- */
  ok('T0a ★★★ 默认全部收起：没点任何角标时，树上只有主变那一行',
    treeCells.length === MAIN.length && treeLanes === 1,
    '珠子 ' + treeCells.length + ' 颗 / 行数 ' + treeLanes + ' —— ' + shape);
  ok('T0b 前置：三条侧支都造出来了', !!A && !!B && !!C, shape);
  if (!A || !B || !C) { viewBtn('list').click(); applyNewGame(); return L.join('\n'); }
  ok('T0b2 收起状态下，有侧支的那颗珠子挂着「+n」角标',
    !!document.querySelector('#branch-tree .cap .tf'),
    (document.querySelector('#branch-tree .cap .tf') || {}).textContent || '找不到角标');

  /* ---------- ① 先展开「第 4 手」→ 支 A ---------- */
  const okA = await clickFold(4, 0);
  const rowA1 = rowOf(A);
  ok('T0c 点角标能把那条支铺开（按需展开）', okA && rowA1 >= 1,
    '支 A 行 ' + rowA1 + ' / 珠子 ' + treeCells.length + ' 颗 / 行数 ' + treeLanes);

  /* ---------- ② 再展开「第 8 手」→ 支 C（与 A 不冲突）---------- */
  await clickFold(8, 0);
  const rowC = rowOf(C), rowA2 = rowOf(A);
  ok('T13 ★★★ 列区间不重叠的两条支共用同一行（首相：「这太浪费行数了」）',
    rowC >= 1 && rowC === rowA2,
    '支 A 行 ' + rowA2 + ' / 支 C 行 ' + rowC + ' —— 期望相同');

  /* ---------- ③ 最后展开「第 5 手」→ 支 B（与 A 冲突）---------- */
  const rowA_before = rowOf(A);
  await clickFold(5, 0);
  const rowB = rowOf(B), rowA_after = rowOf(A), rowC_after = rowOf(C);
  ok('T12 ★★★ 最后展开的那条最靠主干（先展开的被挤下去）',
    rowB >= 1 && rowB < rowA_after,
    '最后展开的支 B → 行 ' + rowB + '；先展开的支 A：行 ' + rowA_before + ' → 行 ' + rowA_after
    + '（期望 A 被挤到 B 下面）');
  ok('T13b ★ 挤位之后不冲突的支仍然共行（整体重算，不是局部挪）',
    rowC_after === rowB,
    '支 B 行 ' + rowB + ' / 支 C 行 ' + rowC_after + ' —— 期望相同');

  /* ---------- T14 自适应上下让位 ---------- */
  ok('T14 ★ 自适应让位：行数没有因为"每支独占一行"而膨胀',
    treeLanes <= 4, '三条支 + 主变 → 用了 ' + treeLanes + ' 行（上限 4）');

  /* ---------- T10 子支紧贴父支 ---------- */
  switchBranch(4, 1); await sleep(180);          // 切到支 A
  gotoView(5); await sleep(120);                 // 停在支 A 的第 1 手
  await put('S15');                              // 在它后面再开一条 = 子支
  const sub = (A._cs || [])[1];
  if (sub) {
    await clickFold(5, rowOf(A));                // 展开支 A 第 1 手的侧支
    const rowSub = rowOf(sub), rowAnow = rowOf(A);
    ok('T10 ★★★ 子支紧贴父支（子支行号 = 父支行号 + 1）',
      rowSub === rowAnow + 1,
      '父支 A 行 ' + rowAnow + ' → 子支行 ' + rowSub + '（期望 ' + (rowAnow + 1) + '）');
  } else {
    ok('T10 前置：支 A 第 1 手后面能再开一条子支', false, 'A._cs 只有 ' + (A._cs || []).length + ' 个孩子');
  }

  /* ---------- A1 ★★★ 首相硬要求：无关的手绝不碰到（几何判据）---------- */
  const R = STP / 2 - 1;
  const distPtSeg = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  let touch = 0, touchAt = '';
  for (const c of treeCells) {
    const pp = treePosOf.get(c.node._p);
    if (!pp) continue;
    const x1 = stoneX(pp.d) + STP / 2, y1 = stoneCy(pp.r);
    const x2 = stoneX(c.depth) + STP / 2, y2 = stoneCy(c.row);
    for (const o of treeCells) {
      const ox = stoneX(o.depth) + STP / 2, oy = stoneCy(o.row);
      if (Math.hypot(ox - x1, oy - y1) < 1 || Math.hypot(ox - x2, oy - y2) < 1) continue;
      const d = distPtSeg(ox, oy, x1, y1, x2, y2);
      if (d < R) { touch++; if (!touchAt) touchAt = '第' + o.depth + '手 距线 ' + d.toFixed(1) + 'px'; }
    }
  }
  ok('A1 ★★★ 连线不碰到任何别的珠子（无关的手绝不碰到 —— 首相硬要求）',
    touch === 0, touch ? (touch + ' 处过近：' + touchAt) : '零接触');

  /* ---------- A2 同一格不塞两颗珠子 ---------- */
  let clash = 0, clashAt = '';
  const seen = new Set();
  for (const c of treeCells) {
    const k = c.row + ':' + c.depth;
    if (seen.has(k)) { clash++; if (!clashAt) clashAt = '行' + c.row + ' 列' + c.depth + ' 有两颗'; }
    seen.add(k);
  }
  ok('A2 同一格（行+列）不会塞两颗珠子', clash === 0, clash ? clashAt : '零冲突，共 ' + treeLanes + ' 行');

  /* ---------- T4 手数标签没有字母后缀 ---------- */
  const labels = treeCells.map(c => moveLabelOf(c.node));
  ok('T4 ★ 珠子只印真实手数、**没有字母后缀**',
    labels.every(x => /^\d+$/.test(x)), labels.slice(0, 18).join(','));

  /* ---------- T6 / T7 / T8 边距与角标不被裁 ---------- */
  const box = document.getElementById('branch-tree');
  const inner = box.firstElementChild;
  const firstCap = document.querySelector('#branch-tree .cap');
  ok('T6 ★ 左上第一颗珠子有左边距（不再零距离贴边）',
    parseFloat(firstCap.style.left) >= 14, 'left=' + firstCap.style.left);
  ok('T7 ★ 第一行上方留了空（角标 top:-9px 不会被切掉）',
    parseFloat(firstCap.style.top) >= 10, 'top=' + firstCap.style.top);
  {
    const foldEl = document.querySelector('#branch-tree .cap .tf');
    const fb = foldEl.getBoundingClientRect(), ib = inner.getBoundingClientRect();
    ok('T8 ★ 角标的实际矩形完整落在画布内（左/上都没被裁）',
      fb.left >= ib.left - 0.5 && fb.top >= ib.top - 0.5,
      '角标 left=' + Math.round(fb.left) + ' top=' + Math.round(fb.top)
      + ' / 画布 left=' + Math.round(ib.left) + ' top=' + Math.round(ib.top));
  }

  /* ---------- A3 能滚到最上面 ---------- */
  {
    box.scrollTop = 99999; await sleep(90);
    const deep = box.scrollTop;
    box.scrollTop = 0; await sleep(90);
    ok('A3 ★ 能把树滚回最上面（顶不再被吃掉）',
      box.scrollTop <= 1, '先拉到底 ' + deep + ' → 回顶后 ' + box.scrollTop);
    box.scrollTop = 0;
  }

  /* ---------- S1 ★★★ 展开/收起不许把视野甩走 ----------
     首相原话：「有时候点个收起或者展开会直接**视野跳到最后**」。
     根因：`renderMoveTree` 里那个"要不要自动滚"的信号 sig **带了"当前手所在的行号"**，
     而展开/收起必然改变行号（行分配是整体重算的）→ sig 一变就当成"当前手换了" →
     主动把当前手滚进视野 → 看起来就是"跳到最下面那一片"。
     这条断言就是照它写的：**先把视野放到顶部、当前手放在一条会被挤下去的支上**，再展开另一条支。 */
  {
    applyNewGame(); await sleep(240);
    for (const s of MAIN) await put(s);
    /* 第 4 手后挂 **8 条**支（都占列 5、6，互相冲突 → 占满行 1..8）。
       ⚠️ 为什么是 8 而不是 6：布局内部只看"父行下面 K_NEAR=8 行"，
          只挂 6 条的话行 7 还空着，长支会**安静地坐在行 7**、谁也不挤 —— 那测不出这个 bug。
          挂满 8 行之后长支试遍 1..8 全冲突，才会触发"**插入一行把下面的推开**"，
          当前手的行号才会变 —— 这才是首相看到的"视野跳到最后"的触发条件。 */
    const EIGHT = [['K10', 'L10'], ['M11', 'N11'], ['O11', 'P11'], ['Q11', 'R11'],
      ['S11', 'T11'], ['K12', 'L12'], ['M13', 'N13'], ['O13', 'P13']];
    for (const pair of EIGHT) { gotoView(4); await sleep(60); await put(pair[0]); await put(pair[1]); }
    /* 第 2 手后挂一条长支（列 3..7，必然与上面那 8 条冲突）→ 展开它会把这 8 条整体挤下去 */
    gotoView(2); await sleep(60);
    for (const s of ['C10', 'D10', 'E10', 'F10', 'G10']) await put(s);
    gotoView(3); await sleep(140);
    renderMoveTree(); await sleep(220);

    const okFold4 = await clickFold(4, 0);                 // 展开那 8 条
    const lanesBefore = treeLanes;
    const X6 = mainNode(4)._cs[8];                         // 第 8 条支（会被挤下去的那条）
    if (okFold4 && X6) {
      gotoNode(X6); await sleep(200);                      // 当前手站到它上面（行号会随展开而变）
      box.scrollTop = 0; box.scrollLeft = 0; await sleep(120);
      const maxT = box.scrollHeight - box.clientHeight;
      const before = box.scrollTop;
      await clickFold(2, 0);                               // 展开长支 → 6 条支整体下移一行
      const after = box.scrollTop;
      ok('S1 ★★★ 展开一条支之后视野没被甩走（首相：「点个收起或者展开会直接视野跳到最后」）',
        maxT <= 0 || after <= before + 6,
        '可滚 ' + maxT + 'px｜展开前 scrollTop=' + Math.round(before) + ' → 展开后 ' + Math.round(after)
        + '（被甩走就会跳到 ' + maxT + ' 附近）｜行数 ' + lanesBefore + ' → ' + treeLanes);
    } else {
      ok('S1 前置：能展开出 6 条支、并拿到第 6 条', false,
        'clickFold=' + okFold4 + ' X6=' + !!X6 + ' 行数 ' + lanesBefore);
    }
  }

  /* ---------- H1–H4 ★★★ 选中手的直系路径高亮（首相 2026-10-15 要求）----------
     首相原话：「选中某条分支中某一手时，一直到这手，其灰色线都要高亮为绿色线……
     其自身往上追溯到主干的第一手，其自身还有叔叔伯伯，那边的就不亮；其下面往后的手也不亮，
     只高亮到此手。还有，高亮绿线，**不是**高亮沿途的棋子外圈，只有选中手才高亮外圈。」
     构造：三条支都展开，然后把"当前手"放到支 A 的第 1 手（K10）上。
       路径 = 第1手 → 第2手 → 第3手 → 第4手 → K10 ⇒ **4 条边**必须亮绿。 */
  {
    await clickFold(4, 0); await clickFold(5, 0); await clickFold(8, 0);
    box.scrollLeft = 0; box.scrollTop = 0; await sleep(200);
    gotoView(5); await sleep(220);                     // 站到支 A 的第 1 手
    const hot1 = document.querySelectorAll('#branch-tree .ln-hot').length;
    const all1 = document.querySelectorAll('#branch-tree .ln').length;
    ok('H1 ★★★ 选中手往上到主干的那条直系链亮成绿线',
      hot1 === 4, '亮 ' + hot1 + ' 条（期望 4：1→2→3→4→K10），画面上共 ' + all1 + ' 条');
    ok('H2 ★ 只亮直系那条 —— 叔叔伯伯（别的支）的线不亮',
      hot1 > 0 && hot1 < all1, '亮 ' + hot1 + ' / 共 ' + all1);
    const curCaps = document.querySelectorAll('#branch-tree .cap.cur').length;
    ok('H3 ★ 只有选中那一手亮外圈，沿途珠子一个都不亮',
      curCaps === 1, curCaps + ' 颗珠子带外圈（期望 1）');
    gotoView(6); await sleep(200);                     // 再选它下面一手（L10）
    const hot2 = document.querySelectorAll('#branch-tree .ln-hot').length;
    ok('H4 ★ 高亮只到选中手为止：往下走一手，多亮的就是那一条',
      hot2 === hot1 + 1, '选第 5 手亮 ' + hot1 + ' 条 → 选第 6 手亮 ' + hot2 + ' 条（期望 +1）');
    gotoView(3); await sleep(150);
  }

  viewBtn('list').click(); await sleep(150);
  applyNewGame(); await sleep(120);
  return L.join('\n');
})();
