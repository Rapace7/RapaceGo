/* 分支树「放大窗」+「折叠不再抢视野」的回归（2026-10-14 首相要求/实测）。
 * 用法：node dev/_cdp_run2.mjs ./_inject_treezoom.js 9333
 *
 * 两件事：
 *   ① 首相要求：「分支框做一个展开按钮，能展开一个大窗口方便找分支」——
 *      实现是**把 #branch-tree 元素整个搬进弹窗、关掉再搬回原位**（不是再渲染一份）。
 *      所以这里重点验：搬进去了、大窗里仍然画得出珠子、Esc 能收、收完**回到原位**、
 *      而且**大窗开着时键盘仍然可用**（↑↓/C/PgUp 不能被"有弹窗就挡住"那条规则误杀）。
 *   ② 首相实测：「展开收起分支的时候视野会自动跳到最后去」——
 *      验折叠前后 scrollTop / scrollLeft **不许被甩走**（只允许被动夹回合法范围）。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const G = s => ({ x: s.charCodeAt(0) - 65 - (s.charCodeAt(0) > 73 ? 1 : 0), y: 19 - parseInt(s.slice(1), 10) });

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);

  /* 造一棵"够长够宽"的树：主变 12 手 + 三条侧支（这样横向一定会出现滚动） */
  const main = ['Q16', 'C16', 'D14', 'E17', 'D16', 'D17', 'E16', 'F16', 'F17', 'G17', 'H17', 'J17'];
  for (const s of main) { const p = G(s); tryPlay(p.x, p.y); await sleep(60); }
  for (const [at, s] of [[4, 'K10'], [4, 'M11'], [7, 'N12']]) {
    gotoView(at); await sleep(50);
    const p = G(s); tryPlay(p.x, p.y); await sleep(80);
  }
  const viewBtn = v => [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === v);
  viewBtn('tree').click(); await sleep(280);

  const box = document.getElementById('branch-tree');
  const homeParent = box.parentNode;
  ok('Z0 前置：在树视图、且树画出来了', !box.hidden && treeCells.length > 12, '珠子 ' + treeCells.length);
  ok('Z1 标题栏有「放大」按钮', !!document.getElementById('btn-treezoom'));

  /* ---------- ① 放大：元素搬家 ---------- */
  document.getElementById('btn-treezoom').click();
  await sleep(320);
  const slot = document.getElementById('treezoom-slot');
  ok('Z2 ★ 点「放大」→ 树元素被搬进弹窗（还是同一个元素，不是复制）',
    box.parentNode === slot, box.parentNode === slot ? 'in slot' : 'parent=' + (box.parentNode && box.parentNode.className));
  ok('Z3 弹窗打开了', document.getElementById('treezoom').classList.contains('open'));
  ok('Z4 ★ 大窗里照样画出珠子（尺寸变了会重算虚拟化窗口）',
    document.querySelectorAll('#treezoom-slot .cap').length > 0,
    document.querySelectorAll('#treezoom-slot .cap').length + ' 颗');
  ok('Z5 大窗比原来宽得多', box.clientWidth > 700, '宽度 ' + box.clientWidth);

  /* ---------- ② 放大窗开着时，键盘仍要能用 ---------- */
  const beforeFold = treeCells.length;
  const fork = treeCells.find(c => (c.node._cs || []).length > 1);
  ok('Z6 前置：树里找得到一个分叉点', !!fork, fork ? ('第 ' + fork.depth + ' 手') : '无');
  if (fork) {
    /* 直接调 toggleTreeCollapse 不够 —— 要验"键盘确实能进来"。所以走真按键。 */
    gotoNode(fork.node); await sleep(200);
    const n0 = treeCells.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));
    await sleep(280);
    ok('Z7 ★ 大窗开着时按 C 能折叠（键盘没被"有弹窗就挡住"那条规则误杀）',
      treeCells.length !== n0, n0 + ' → ' + treeCells.length + ' 格');
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));
    await sleep(280);
    ok('Z8 再按一次 C 能展开回来', treeCells.length === n0, treeCells.length + ' 格');
  }

  /* ---------- ③ ★ 折叠不许抢视野（首相报的「跳到最后」） ---------- */
  /* 先把视野挪到"不是当前手"的地方，再折叠 —— 旧代码会把它拉回当前手/甩到边上。 */
  box.scrollLeft = 0;
  box.scrollTop = 0;
  await sleep(120);
  const sl0 = box.scrollLeft, st0 = box.scrollTop;
  if (fork) toggleTreeCollapse(fork.node);
  await sleep(300);
  ok('Z9 ★ 折叠之后视野没被甩走（scrollTop / scrollLeft 保持在原处）',
    Math.abs(box.scrollTop - st0) <= 2 && Math.abs(box.scrollLeft - sl0) <= 2,
    'scrollTop ' + st0 + '→' + box.scrollTop + '  scrollLeft ' + sl0 + '→' + box.scrollLeft);
  if (fork) toggleTreeCollapse(fork.node);
  await sleep(300);
  ok('Z10 展开之后视野同样没被甩走',
    Math.abs(box.scrollTop - st0) <= 2 && Math.abs(box.scrollLeft - sl0) <= 2,
    'scrollTop ' + st0 + '→' + box.scrollTop);

  /* ---------- ④ Esc 收起 + 元素回原位 ---------- */
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  await sleep(320);
  ok('Z11 ★ 按 Esc 收起放大窗', !document.getElementById('treezoom').classList.contains('open'));
  ok('Z12 ★ 收起后树元素**回到原来的位置**（不是跑到卡片末尾）',
    box.parentNode === homeParent && box.parentNode.contains(document.getElementById('movelist')),
    'parent=' + (box.parentNode && box.parentNode.className));
  ok('Z13 收起来之后窄栏里照样能画（尺寸变回去也重算了）',
    document.querySelectorAll('#branch-tree .cap').length > 0,
    document.querySelectorAll('#branch-tree .cap').length + ' 颗');

  /* ---------- ⑤ 切回「列表」时放大窗自动收（免得灰遮罩压着列表） ---------- */
  document.getElementById('btn-treezoom').click(); await sleep(260);
  ok('Z14 前置：又放大了一次', document.getElementById('treezoom').classList.contains('open'));
  viewBtn('list').click(); await sleep(300);
  ok('Z15 ★ 切回「列表」→ 放大窗自动收起（否则列表会被灰遮罩压住）',
    !document.getElementById('treezoom').classList.contains('open'));
  ok('Z16 「放大」按钮在列表视图下隐藏', document.getElementById('btn-treezoom').hidden === true);

  applyNewGame(); await sleep(150);
  return L.join('\n');
})();
