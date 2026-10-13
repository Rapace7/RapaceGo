/* 像素级验证「手串的线真的可见」：读每个 .ln 的 getBoundingClientRect 实际宽高，
 * 并抽查线中点是否被珠子盖住（应被盖 = 线穿到珠心）。只读不写。
 * 用法：node dev/_cdp_run2.mjs ./_inject_pixline.js 9333 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(300);
  for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6', 'E6']) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(120);
  gotoView(3); await sleep(60);
  const a = G('K10'); tryPlay(a.x, a.y); await sleep(80);
  const b = G('L10'); tryPlay(b.x, b.y); await sleep(80);
  movesView = 'tree'; $('movelist').hidden = true; $('branch-tree').hidden = false;
  renderMoveTree(); await sleep(250);
  const box = $('branch-tree'); box.scrollLeft = 0; await sleep(150);

  const lines = [...box.querySelectorAll('.ln')];
  const hz = lines.filter(el => !el.classList.contains('ln-br'));
  const hzSizes = hz.map(el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  ok('P1 水平线存在且**渲染高度 ≥ 2px**（0 = 隐形，上一版实拍就是这个）',
     hz.length >= 4 && hzSizes.every(s => s.h >= 2 && s.w >= 2),
     hz.length + ' 条: ' + JSON.stringify(hzSizes.slice(0, 6)));
  const v = lines.filter(el => el.classList.contains('ln-br'));
  const vSizes = v.map(el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  /* 侧支落线 = 竖段(2×高) + 接进珠心的横段(宽×2) 两条，都要求**渲染可见**（>0）；
     竖段单独要求 h≥10。上一版把两类都按竖段标准判，横段 h=2 被误判 FAIL —— 断言的锅。 */
  const segs = vSizes.filter(s => s.w > 0 && s.h > 0);
  const hasDrop = vSizes.some(s => s.w <= 3 && s.h >= 10);
  ok('P2 侧支落线段全部可见，且含竖直下落段',
     segs.length === v.length && v.length >= 2 && hasDrop,
     v.length + ' 条: ' + JSON.stringify(vSizes.slice(0, 6)));

  /* 线穿珠心：拿第一颗主线珠，检查它的中心点是否落进某条 .ln 的矩形内 */
  const caps = [...box.querySelectorAll('.cap')];
  const c2 = caps.find(c => c.dataset.d === '2');
  if (c2) {
    const cr = c2.getBoundingClientRect(), cxp = cr.left + cr.width / 2, cyp = cr.top + cr.height / 2;
    const hit = lines.some(el => { const r = el.getBoundingClientRect(); return cxp >= r.left - 1 && cxp <= r.right + 1 && cyp >= r.top - 1 && cyp <= r.bottom + 1; });
    ok('P3 第 2 颗珠的**中心点**被某条线穿过（穿心画法）', hit, 'center=' + Math.round(cxp) + ',' + Math.round(cyp));
  } else ok('P3 前置：第 2 颗珠在窗口内', false);
  /* 侧支首珠中心同样被线穿过 */
  const branchFirst = caps.find(c => /\d+a/.test(c.textContent));
  if (branchFirst) {
    const cr = branchFirst.getBoundingClientRect(), cxp = cr.left + cr.width / 2, cyp = cr.top + cr.height / 2;
    const hit = lines.some(el => { const r = el.getBoundingClientRect(); return cxp >= r.left - 1 && cxp <= r.right + 1 && cyp >= r.top - 1 && cyp <= r.bottom + 1; });
    ok('P4 侧支首珠（4a）中心也被落线穿过', hit);
  } else ok('P4 前置：4a 珠在窗口内', false);
  applyNewGame(); await sleep(120);
  return L.join('\n');
})()
