/* 段③ 水平分叉树面板的回归断言 —— 2026-10-13 千问写的；同日下午改「珍珠手串」画法后同步更新。
 * 用法：双击 dev\_start_cdp.bat 起实例，再 node dev/_cdp_run2.mjs ./_inject_tree_v1.js 9333
 *
 * 原则：**尽量走真实 DOM 事件**（点滑杆、点珠子、右键、悬停、拖动），不是只调函数 ——
 * 段③ 的活就是界面，只测函数等于没测。
 * 画法（首相定的，参照 KaTrain 珍珠手串）：圆形棋子 + 手数反色印珠心 + 主变串金色外圈
 *   + 侧支从父珠引肘形分线 + 坐标/胜率增减进悬停浮层 + 右键按住拖动画布（原地右击才弹菜单）。
 * ⚠️ 判「画了什么」用布局数据 treeCells（全量），判「长什么样」才用窗口内 DOM ——
 *   树是虚拟化的，只画滚动窗口内的列（用 DOM 计数当全量必假失败，第一版栽过）。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };  // 坑28：走 GTP_COLS，别 charCodeAt
  const capAt = (d, r) => document.querySelector(`#branch-tree .cap[data-d="${d}"][data-r="${r}"]`);
  const cellOf = n => treeCells.find(c => c.node === n);

  /* ---------- 摆一个「主线 5 手 + 旁支 2 手」的局面 ---------- */
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(120);
  gotoView(3); await sleep(60);                    // 回第 3 手
  const bk = G('K10'); tryPlay(bk.x, bk.y); await sleep(100);   // 旁支第 4 手
  const bk2 = G('L10'); tryPlay(bk2.x, bk2.y); await sleep(100); // 旁支第 5 手
  ok('T0 前置：当前在旁支（5 手，末手 L10）',
     state.moves.length === 5 && state.moves[4].x === bk2.x, state.moves.length);
  ensureBranch();
  ok('T0b 分叉点有 2 条子（旧线 + 旁支）', state.moves[2]._cs.length === 2, state.moves[2]._cs.length);
  /* ★ bk/bk2 是坐标 {x,y}，cellOf 找的是**节点对象** —— 上一版脚本直接拿坐标去查，
     第 79 行 undefined.depth 崩掉。节点从当前路径上取（旁支 2 手就是 moves[3]/[4]）。 */
  const bkNode = state.moves[3], bk2Node = state.moves[4];

  /* ---------- 1) 滑杆切到树 ---------- */
  const treeBtn = [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree');
  const listBtn = [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'list');
  ok('①1 滑杆有两个按钮（列表 / 树）', !!treeBtn && !!listBtn);
  treeBtn.click(); await sleep(200);
  ok('①2 切到树：面板可见、列表隐藏', $('branch-tree').hidden === false && $('movelist').hidden === true);
  ok('①3 树里画出了珠子', document.querySelectorAll('#branch-tree .cap').length >= 5,
     document.querySelectorAll('#branch-tree .cap').length);
  const uniq = new Set(treeCells.map(c => c.node));
  ok('①4 布局节点数 = 7（5 主线 + 2 旁支，前 3 手共用）', uniq.size === 7, uniq.size);
  ok('①5 主线在第一行（row 0），旁支另起一行（row ≥ 1）',
     treeCells.some(c => c.row === 0) && treeCells.some(c => c.row >= 1),
     '行号: ' + [...new Set(treeCells.map(c => c.row))].join(','));

  /* ---------- 2) 手数印在珠心 ----------
     ★ 2026-10-14：**字母后缀去掉了**（首相要求「别的软件怎么做就怎么做」）——
     业界（Sabaki / Lizzie / KaTrain）靠**纵向位置**区分各条变着，节点上只写真实手数。
     于是旁支的手数会与主线**重复**（都是 4、5），这是**有意为之**。
     判据相应改成：① 数字都在；② **一个后缀字母都没有**。 */
  const allLabels = treeCells.map(c => moveLabelOf(c.node));
  ok('②1 旁支只标真实手数、**不带字母后缀**（靠纵向位置区分各条变着 —— 业界惯例）',
    allLabels.includes('4') && allLabels.includes('5') && !allLabels.some(x => /[a-z]$/i.test(x)),
    allLabels.join(','));
  ok('②2 主线手号是纯数字（1..5 都在）', ['1', '2', '3', '4', '5'].every(x => allLabels.includes(x)));
  /* 7 手全在窗口内（窄树也放得下），DOM 抽查珠子确实把字印出来了 */
  const domLabels = [...document.querySelectorAll('#branch-tree .cap b')].map(b => b.textContent);
  ok('②3 珠心真的印着手数（是数字，不是空）',
    domLabels.length > 0 && domLabels.every(x => /^\d+$/.test(x)), domLabels.join(','));
  /* 颜色反色：黑子白字 / 白子黑字由 CSS 类保证 —— 查类在不在 */
  const kCell = cellOf(bkNode);   // K10 是白子（tryPlay 到Move 4 = 白）
  ok('②4 珠子按黑白带子色类', !!kCell && capAt(kCell.depth, kCell.row).classList.contains('sw'),
     kCell && capAt(kCell.depth, kCell.row).className);

  /* ---------- 3) 主变金圈（首相定的语义：实战线那串带金色外圈） ---------- */
  const mains = [...document.querySelectorAll('#branch-tree .cap.main')];
  ok('③A1 有金圈珠（当前主变 = 旧线 5 手那一串）', mains.length === 5, mains.length);
  const b2c = cellOf(bk2Node);
  ok('③A2 当前走的旁支珠子**没有**金圈（还没提为主变）',
     !!b2c && !capAt(b2c.depth, b2c.row).classList.contains('main'));
  ok('③A3 侧支的连线画出了肘形分线（.ln-br 存在）',
     document.querySelectorAll('#branch-tree .ln-br').length >= 2,
     document.querySelectorAll('#branch-tree .ln-br').length);

  /* ---------- 4) 当前手青环（与金圈互斥，靠 CSS 顺序覆盖） ---------- */
  const curs = [...document.querySelectorAll('#branch-tree .cap.cur')];
  ok('④A1 只有一颗珠是当前手（cur 恰 1 个）', curs.length === 1, curs.length);
  const curCell = cellOf(state.moves[state.viewAt - 1]);
  ok('④A2 cur 就是当前在看的那一手（L10）',
     !!curCell && capAt(curCell.depth, curCell.row) === curs[0]);

  /* ---------- 5) 点旁支珠 → 跳到那条支（点哪看哪） ---------- */
  gotoView(3); await sleep(50); cycleBranch(1); await sleep(200);   // 切回旧线（主变）
  ok('⑤A 前置：切回旧线（5 手）', state.moves.length === 5, state.moves.length);
  const k5 = cellOf(bkNode);
  capAt(k5.depth, k5.row).click(); await sleep(260);
  ok('⑤B 点旁支珠 → 跳到那条支并走到末端（5 手，末手 L10）',
     state.moves.length === 5 && state.moves[4].x === bk2.x,
     state.moves.length + ' 手');
  const kNow = cellOf(state.moves[state.viewAt - 1]);
  ok('⑤C 点的那一手（K10）亮起青环（点哪看哪：viewAt 停在被点的珠）',
     !!kNow && capAt(kNow.depth, kNow.row).classList.contains('cur'), 'viewAt=' + state.viewAt);

  /* ---------- 6) C 键折叠分叉点的侧支 ---------- */
  const forkParent = state.moves[2];
  gotoView(3); await sleep(80);
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', bubbles: true }));
  await sleep(200);
  const inCells = n => treeCells.some(c => c.node === n);
  ok('⑥1 按 C 后侧支从布局里消失（只剩主线 5 手）',
     treeCells.length === 5 && !inCells(bkNode) && !inCells(bk2Node), treeCells.length + ' 格');
  ok('⑥2 分叉点进了折叠集', treeCollapsed.has(forkParent));
  ok('⑥3 折叠的珠带 +n 角标', !!capAt(cellOf(forkParent).depth, 0) && /\+1/.test(capAt(cellOf(forkParent).depth, 0).textContent));
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', bubbles: true }));
  await sleep(200);
  ok('⑥4 再按 C 展开回来', inCells(bkNode) && inCells(bk2Node) && !treeCollapsed.has(forkParent));

  /* ---------- 7) 原地右击弹菜单 / 右键拖动=平移（首相定的两条路） ---------- */
  /* 先做「平移」：内容窄于窗口时先塞够列（临时把窗口滚不动也行 —— 这里用 24 手长谱测） */
  for (const q of ['E6','F6','G6','H6','J6','K6','L6','M6','N6','O6','P6','R6','S6','T6','T5','T4','T3','T2','T1','S1','R1','Q1','P1','N1']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(200);
  const box = $('branch-tree');
  box.scrollLeft = 300; await sleep(120);
  const slBefore = box.scrollLeft;
  box.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 500, clientY: 300, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));   // 往左拖 100px
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: 400, clientY: 300 }));
  /* ⚠️ 真实浏览器里 contextmenu 是**右键抬起后**才触发的（上一版在 mousedown 后就派发，
     顺序不对 —— 程序里"拖过就不弹菜单"的判断依赖这个顺序）。 */
  box.dispatchEvent(new MouseEvent('contextmenu', { clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
  await sleep(120);
  ok('⑦1 右键拖动平移画布（往左拖 → scrollLeft 增大）',
     box.scrollLeft === slBefore + 100, slBefore + ' → ' + box.scrollLeft);
  ok('⑦2 拖动后菜单没弹（拖 ≠ 右击）', document.querySelector('.tree-menu') === null);
  ok('⑦3 拖动结束后 pan 状态已复位', box.classList.contains('panning') === false);
  /* 原地右击（按下没移动）→ 才弹菜单 */
  box.scrollLeft = 0; await sleep(120);
  const bkCell2 = cellOf(bkNode);   // K10 这颗现在被滚出窗口了？24手窗口够宽就还在 —— 先滚回 0，K10 在第 4 列，一定可见
  if (!capAt(bkCell2.depth, bkCell2.row)) { ok('⑦4 前置：K10 珠在窗口内', false); }
  else {
    capAt(bkCell2.depth, bkCell2.row).dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 300, clientY: 300, bubbles: true }));
    capAt(bkCell2.depth, bkCell2.row).dispatchEvent(new MouseEvent('contextmenu', { clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 300, clientY: 300 }));
    await sleep(80);
    const menu = document.querySelector('.tree-menu');
    ok('⑦4 原地右击（没移动）才弹菜单', !!menu);
    const mBtns = menu ? [...menu.querySelectorAll('button')].map(b => b.textContent) : [];
    ok('⑦5 菜单里有「设为主变」', mBtns.some(t => t.includes('主变')), mBtns.join(' | '));
    ok('⑦6 菜单里有「删除分支（共 N 手）」', mBtns.some(t => /删除分支（共 \d+ 手）/.test(t)), mBtns.join(' | '));
    const promBtn = menu && [...menu.querySelectorAll('button')].find(b => /设为主变/.test(b.textContent));
    if (promBtn) { promBtn.click(); await sleep(200); }
    ensureBranch();
    ok('⑦7 提升后 K10 那条成了主变（_cs[0]）', forkParent._cs[0].x === bk.x);
    ok('⑦8 提升后金圈跟着换到新主变串上',
       (() => { const c = cellOf(bkNode); return c && capAt(c.depth, c.row).classList.contains('main'); })());
    ok('⑦9 菜单点完自动关闭', document.querySelector('.tree-menu') === null);
  }
  /* 拖动后第一次左击不该被吞（treeDragMoved 残留坑） */
  window.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 500, clientY: 300, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 420, clientY: 300 }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: 420, clientY: 300 }));
  await sleep(80);
  const c1 = cellOf(state.moves[1]);
  if (c1 && capAt(c1.depth, c1.row)) {
    capAt(c1.depth, c1.row).click(); await sleep(200);
    ok('⑦10 右键拖动画布后的第一次左键点击没被吞（能跳转）', state.viewAt === 2, state.viewAt);
  }

  /* ---------- 8) 悬停浮层（首相定的：坐标 / 胜率增减进浮层） ---------- */
  const target = settings.visits || 500;
  state.history = []; state.histVisits = [];
  for (let i = 0; i <= state.moves.length; i++) { state.history[i] = 0.5 + i * 0.01; state.histVisits[i] = target + 10; }
  renderMoveTree(); await sleep(120);
  const hov = cellOf(state.moves[state.viewAt - 1]);
  if (!hov) ok('⑧ 前置：当前手在窗口内', false);
  else {
    const hCap = capAt(hov.depth, hov.row);
    hCap.dispatchEvent(new MouseEvent('mouseover', { clientX: 300, clientY: 200, bubbles: true }));
    await sleep(60);
    const tip = document.querySelector('.bt-tip');
    const txt = tip ? tip.textContent : '';
    ok('⑧1 悬停弹浮层', !!tip && !tip.hidden);
    ok('⑧2 浮层有手数与坐标', /\d+ 手 · . [A-T]\d+|停一手/.test(txt) || /手 ·/.test(txt), txt.slice(0, 46));
    ok('⑧3 浮层有胜率增减（亏/赚 x%）', /亏 |赚 /.test(txt), txt.slice(0, 70));
    hCap.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    box.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await sleep(60);
    ok('⑧4 移开鼠标浮层收起', !tip || tip.hidden === true);
  }

  /* ---------- 9) 树面板数字开关 ---------- */
  const tn = $('chk-treenum');
  ok('⑨1 「树面板数字」开关存在且默认勾上', !!tn && tn.checked === true);
  tn.checked = false; tn.onchange({ target: tn }); await sleep(150);
  const noNum = [...document.querySelectorAll('#branch-tree .cap')];
  ok('⑨2 关掉后珠心不印手数', noNum.length > 0 && noNum.every(c => !c.querySelector('b')),
     noNum.slice(0, 3).map(c => c.textContent).join('/'));
  ok('⑨3 关掉后珠子本体还在（sb/sw 子色类没丢）', noNum.every(c => c.classList.contains('sb') || c.classList.contains('sw')));
  tn.checked = true; tn.onchange({ target: tn }); await sleep(120);

  /* ---------- 10) 草稿手不进树（回归段② 那条） ---------- */
  gotoView(3); await sleep(60);
  enterDraft(); await sleep(80);
  const d = G('D10'); tryPlay(d.x, d.y); await sleep(120);
  ok('⑩ 草稿手不出现在树上', !treeCells.some(c => c.node.x === d.x && c.node.y === d.y));
  exitDraft(); await sleep(120);

  /* ---------- 10b) 悬停浮层：贴视口边缘时不许跑出屏幕 ----------
     ★ 2026-10-13 DSH 补（段③ 尾巴之二「浮层靠右缘的翻转没实测」）。
     背景：原来只有「贴右/下缘就翻到另一边」，鼠标贴**左缘/上缘**时翻转算出的坐标是负数
     → 浮层整个跑到屏幕外，用户看到的就是「悬停了却没提示」。
     这里直接喂极端鼠标坐标（真实鼠标到不了的位置也能测到夹取逻辑），比"用鼠标挪到角落"稳。 */
  const anyCap = document.querySelector('#branch-tree .cap');
  ok('⑩b1 树上有珠子可悬停（前置）', !!anyCap);
  if (anyCap) {
    showTreeTip(anyCap, { clientX: -1000, clientY: -1000 });
    const l1 = parseFloat(treeTip.style.left), t1 = parseFloat(treeTip.style.top);
    ok('⑩b2 鼠标在视口外左上 → 浮层被夹进视口（不是负坐标）', l1 >= 6 && t1 >= 6, l1 + ',' + t1);
    showTreeTip(anyCap, { clientX: 99999, clientY: 99999 });
    const l2 = parseFloat(treeTip.style.left), t2 = parseFloat(treeTip.style.top);
    ok('⑩b3 鼠标在视口外右下 → 浮层整块仍在视口内',
       l2 + treeTip.offsetWidth <= window.innerWidth - 6 + 1
       && t2 + treeTip.offsetHeight <= window.innerHeight - 6 + 1,
       Math.round(l2 + treeTip.offsetWidth) + '/' + Math.round(t2 + treeTip.offsetHeight)
       + ' vs ' + (window.innerWidth - 6) + '/' + (window.innerHeight - 6));
    hideTreeTip();
    ok('⑩b4 测完收起，不留悬空浮层', treeTip.hidden === true);
  }

  /* ---------- 11) 切回列表，两容器互斥 ---------- */
  listBtn.click(); await sleep(150);
  ok('⑪ 切回列表：列表可见、树隐藏', $('movelist').hidden === false && $('branch-tree').hidden === true);

  applyNewGame(); await sleep(150);
  return L.join('\n');
})()
