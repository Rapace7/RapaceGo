/* 真实棋谱上的验收（合成树测不出来，必须用它那盘 181 手的谱）。
 *   ① 最后展开的那条最靠主干
 *   ② 展开/收起保持当前视野
 *   ③ **按需展开**（真实用法）后必须零接触 —— 首相已要求删掉「全部展开」，
 *      所以"全展开"不再是使用场景；全展开只作参考值打印，不判 PASS/FAIL。
 * 用法：node dev/_cdp_run2.mjs ./_inject_orderreal.js 9555
 *
 * ⚠️ 不能用"找到角标再点"：`treePaint` 是**虚拟化的**，只渲染看得见的列，
 *    第 28 手的珠子在 5792px 宽里根本没被画出来，querySelector 必然找不到。
 *    这里走**同一个内部路径**：加进 treeExpanded + 发展开序号 + renderMoveTree()。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const REC = '152724_柯洁_B+R_芈昱廷_2025.11.05_第27届中国围甲联赛第9轮 深圳龙华VS江苏洋河_张香槟＆夏夏＆绝艺解说_.sgf';
  const box = document.getElementById('branch-tree');

  try { await openRecord(REC); } catch (e) { return 'ERR 打开棋谱: ' + e; }
  await sleep(1300);
  [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree').click();
  await sleep(420);

  const mainNodeAt = d => { let n = branchRoot; for (let i = 0; i < d; i++) n = n._cs[0]; return n; };
  const expandNode = async d => {
    const node = mainNodeAt(d);
    if (!node || !(node._cs && node._cs.length > 1)) return false;
    if (!treeExpanded.has(node)) { treeExpanded.add(node); treeExpandSeq.set(node, ++treeExpandCounter); }
    renderMoveTree(); await sleep(90);
    return true;
  };
  const collapseNode = async d => {
    const node = mainNodeAt(d);
    if (!node) return false;
    treeExpanded.delete(node); treeExpandSeq.delete(node);
    renderMoveTree(); await sleep(160);
    return true;
  };
  const rowOfFirstSide = d => {
    const node = mainNodeAt(d);
    const cs = node._cs || [];
    for (let i = 1; i < cs.length; i++) {
      const c = treeCells.find(x => x.node === cs[i]);
      if (c) return c.row;
    }
    return -1;
  };
  /* 零接触自查：任一连线到任何别的珠心的距离 > 珠半径 */
  const R = STP / 2 - 1;
  const d2s = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  const countTouch = () => {
    let bad = 0;
    for (const c of treeCells) {
      const pp = treePosOf.get(c.node._p);
      if (!pp) continue;
      const x1 = stoneX(pp.d) + STP / 2, y1 = stoneCy(pp.r);
      const x2 = stoneX(c.depth) + STP / 2, y2 = stoneCy(c.row);
      for (const o of treeCells) {
        const ox = stoneX(o.depth) + STP / 2, oy = stoneCy(o.row);
        if (Math.hypot(ox - x1, oy - y1) < 1 || Math.hypot(ox - x2, oy - y2) < 1) continue;
        if (d2s(ox, oy, x1, y1, x2, y2) < R) bad++;
      }
    }
    return bad;
  };
  /* 过近明细：打印前若干条"哪条线跨了几行、碰到谁、差多少像素" ——
     用它就能判断到底是"兜底走末尾"还是"插入让位"造成的。 */
  const touchDetail = n => {
    const out = [];
    for (const c of treeCells) {
      const pp = treePosOf.get(c.node._p);
      if (!pp) continue;
      const x1 = stoneX(pp.d) + STP / 2, y1 = stoneCy(pp.r);
      const x2 = stoneX(c.depth) + STP / 2, y2 = stoneCy(c.row);
      for (const o of treeCells) {
        const ox = stoneX(o.depth) + STP / 2, oy = stoneCy(o.row);
        if (Math.hypot(ox - x1, oy - y1) < 1 || Math.hypot(ox - x2, oy - y2) < 1) continue;
        const d = d2s(ox, oy, x1, y1, x2, y2);
        if (d < R) {
          out.push('线 第' + pp.d + '手(行' + pp.r + ')→第' + c.depth + '手(行' + c.row + ')'
            + ' 跨' + Math.abs(c.row - pp.r) + '行  碰到 第' + o.depth + '手(行' + o.row + ')  距 ' + d.toFixed(1) + 'px');
          if (out.length >= n) return out;
        }
      }
    }
    return out;
  };

  /* ★ 结构化明细（2026-10-14 深夜）：把"过近"按**入线跨了几行**分开 ——
     跨行数 ≤ 3 是**几何上可解**的区间（列距 40 / 行距 52 时能保证 ≥ 11.5px），必须为 0；
     跨行数 > 3 是**几何无解**的（同一父第 k 条支的入线到紧邻上一个兄弟的距离
     = A·H/√(A²+k²H²)，k=4 起必 < 11px；要救 k=4 得把列距加到 47+、k=6 加到 72+，
     树宽翻倍，不划算）。无解的那些不判 PASS/FAIL，如实标 KNOWN。 */
  const touchList = () => {
    const out = [];
    for (const c of treeCells) {
      const pp = treePosOf.get(c.node._p);
      if (!pp) continue;
      const x1 = stoneX(pp.d) + STP / 2, y1 = stoneCy(pp.r);
      const x2 = stoneX(c.depth) + STP / 2, y2 = stoneCy(c.row);
      for (const o of treeCells) {
        const ox = stoneX(o.depth) + STP / 2, oy = stoneCy(o.row);
        if (Math.hypot(ox - x1, oy - y1) < 1 || Math.hypot(ox - x2, oy - y2) < 1) continue;
        const d = d2s(ox, oy, x1, y1, x2, y2);
        if (d < R) out.push({
          span: Math.abs(c.row - pp.r), dist: d,
          txt: '线 第' + pp.d + '手(行' + pp.r + ')→第' + c.depth + '手(行' + c.row + ')'
            + ' 跨' + Math.abs(c.row - pp.r) + '行  碰到 第' + o.depth + '手(行' + o.row + ')  距 ' + d.toFixed(1) + 'px',
        });
      }
    }
    return out;
  };
  const report = (tag, list) => {
    const soft = list.filter(x => x.span <= 3), hard = list.filter(x => x.span > 3);
    ok(tag + '：**可解区间**（入线跨行 ≤ 3）零接触', soft.length === 0,
      soft.length + ' 处｜' + treeCells.length + ' 颗 / ' + treeLanes + ' 行');
    for (const s of soft.slice(0, 4)) L.push('    · ' + s.txt);
    if (hard.length) {
      L.push('    · [KNOWN·几何无解] ' + hard.length + ' 处，最近 ' + Math.min(...hard.map(x => x.dist)).toFixed(1)
        + 'px，最深跨 ' + Math.max(...hard.map(x => x.span)) + ' 行'
        + ' —— 珠子画在线之上，视觉为"线从珠背后穿过"（3 倍截图验收：dev/_shot_worst_a.png / _c.png）');
    }
  };


  const mb = [];
  { let n = branchRoot, d = 0;
    for (;;) {
      const cs = n._cs || [];
      if (!cs.length) break;
      if (cs.length > 1 && d >= 1) mb.push(d);
      n = cs[0]; d += 1;
    } }
  L.push('这盘棋主变上有侧支的手数共 ' + mb.length + ' 处');

  /* ---------- ① 逐个展开，最后一个必须最靠上 ---------- */
  const picks = [mb[Math.floor(mb.length * 0.15)], mb[Math.floor(mb.length * 0.5)], mb[Math.floor(mb.length * 0.85)]];
  const rows = [];
  for (const d of picks) {
    const done = await expandNode(d);
    const r = done ? rowOfFirstSide(d) : -2;
    rows.push({ d, r });
    L.push('  展开第 ' + d + ' 手的分支 → 它的第一颗珠子在**行 ' + r + '**（当前总行数 ' + treeLanes + '）');
  }
  ok('R1 ★★★ 最后展开的那条最靠主干（越小越靠上）',
    rows[2].r >= 1 && rows[2].r <= Math.min(rows[0].r, rows[1].r),
    '第 ' + rows[0].d + ' 手→行' + rows[0].r + '；第 ' + rows[1].d + ' 手→行' + rows[1].r
    + '；**最后展开**的第 ' + rows[2].d + ' 手→行' + rows[2].r);

  /* ---------- ② 视野：滚到中间，再展开 / 收起 ---------- */
  box.scrollTop = Math.floor((box.scrollHeight - box.clientHeight) * 0.5);
  box.scrollLeft = 0; await sleep(180);
  const maxT = box.scrollHeight - box.clientHeight;
  const before = box.scrollTop;
  const other = mb.find(d => !picks.includes(d)) || mb[0];
  await expandNode(other);
  const afterOpen = box.scrollTop;
  await collapseNode(other);
  const afterClose = box.scrollTop;
  ok('R2 ★★★ 展开 / 收起时视野保持在原处（首相：「有时候展开和收起会自动跳到最后一手」）',
    maxT <= 0 || (Math.abs(afterOpen - before) <= 8 && Math.abs(afterClose - before) <= 8),
    '可滚 ' + Math.round(maxT) + 'px｜滚到 ' + Math.round(before) + ' → 展开后 ' + Math.round(afterOpen)
    + ' → 收起后 ' + Math.round(afterClose));

  /* ---------- ③ 连开多条 ---------- */
  box.scrollTop = Math.floor((box.scrollHeight - box.clientHeight) * 0.3);
  await sleep(150);
  const b3 = box.scrollTop;
  const more = mb.filter(d => !picks.includes(d) && d !== other).slice(0, 4);
  for (const d of more) { await expandNode(d); }
  const a3 = box.scrollTop;
  ok('R3 ★ 连开四条支之后视野也稳（不是只有第一条不跳）',
    maxT <= 0 || Math.abs(a3 - b3) <= 8, '连开 ' + more.length + ' 条：' + Math.round(b3) + ' → ' + Math.round(a3));

  /* ---------- ④ ★★★ 按需展开（真实用法）后必须零接触 ----------
     ⚠️ 口径变了：首相已要求**删掉「全部展开」**（"那个没有用"），所以"一次铺开 457 条支"
        不再是使用场景。真正要保证的是**平时一条条展开**之后线与珠子不碰。 */
  report('R4 ★★★ 按需展开 8 条支（真实用法）', touchList());

  const extra = mb.filter(d => !picks.includes(d) && d !== other).slice(4, 24);
  for (const d of extra) await expandNode(d);
  report('R5 ★★★ 一路展开到 28 条支', touchList());

  /* ---------- 参考值（不再是使用场景，只打印） ---------- */
  const t0 = performance.now(); treeExpandAll(true); const dt = performance.now() - t0;
  L.push('（参考，功能已删）全部展开 ' + mb.length + ' 处：' + treeCells.length + ' 颗 / '
    + treeLanes + ' 行 / ' + dt.toFixed(0) + ' ms / 过近 ' + countTouch() + ' 处');

  treeExpandAll(false); await sleep(200);
  box.scrollTop = 0; box.scrollLeft = 0;
  return L.join('\n');
})();
