/* 诊断树面板两件事：① 为什么没滚动条（读几何与 overflow）② 胶囊有没有重叠（读实际矩形）。
   只读不写。用法：node dev/_cdp_run2.mjs ./_diag_tree.js 9333 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  /* 长主线（手多）+ 中途一条旁支，逼出横向滚动与密集胶囊 */
  const pts = ['D4','Q16','D16','Q4','C6','E3','F3','C4','E7','R14','P3','O6','N11','M16','L17','K17','J17','H17','G17','F17','E17','D17','C17','B17','A17','A16','A15','A14','A13','A12','B12','C12','D12','E12','F12','G12','H12','J12','K12','L12','M12','N12','O12','P12','Q12','R12','S12','T12','T13','T14','T15','T16','T17','S17','R17','Q17','P17','O17','N17','M17'];
  for (const q of pts) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(220);
  gotoView(30); await sleep(60);
  const bk = G('K10'); tryPlay(bk.x, bk.y); await sleep(150);
  const bk2 = G('L10'); tryPlay(bk2.x, bk2.y); await sleep(150);

  [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree').click();
  await sleep(350);

  const box = document.getElementById('branch-tree');
  const inner = box.firstElementChild;
  const cs = getComputedStyle(box);
  const card = box.closest('.card');
  const cardCs = getComputedStyle(card);

  /* 重叠检测：把当前窗口内可见胶囊的实际矩形拿出来，找两两相交的 */
  const caps = [...box.querySelectorAll('.cap')].map(c => {
    const r = c.getBoundingClientRect();
    return { label: (c.querySelector('b') || {}).textContent || '?', l: Math.round(r.left), t: Math.round(r.top),
             w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) };
  });
  const overlaps = [];
  for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
      const a = caps[i], b = caps[j];
      if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) {
        overlaps.push(a.label + '×' + b.label);
      }
    }
  }

  /* 硬验证「能不能往右滚」：直接把 scrollLeft 推到底，看是否真的生效、右边列是否进入视野 */
  box.scrollLeft = 99999; await sleep(150);
  const scrolled = box.scrollLeft;
  const visibleAfterScroll = [...box.querySelectorAll('.cap')].filter(c => {
    const r = c.getBoundingClientRect(), br = box.getBoundingClientRect();
    return r.right > br.left && r.left < br.right;
  }).length;
  const lastLabel = treeCells.length ? moveLabelOf(treeCells[treeCells.length - 1].node) : '?';
  box.scrollLeft = 0; await sleep(80);

  return JSON.stringify({
    规模: { 布局节点: treeCells.length, 最大列: treeMaxDepth, 航道数: treeLanes, 窗口内胶囊: caps.length },
    box: { clientW: box.clientWidth, clientH: box.clientHeight, scrollW: box.scrollWidth, scrollH: box.scrollHeight, offsetH: box.offsetHeight },
    横向能滚吗: box.scrollWidth > box.clientWidth,
    实测滚到底: { 推到底的scrollLeft: scrolled, 滚后可见胶囊数: visibleAfterScroll, 末手标签: lastLabel, 滚后可见数应远小于总数: visibleAfterScroll < caps.length },
    祖先宽度链: (() => {
      const out = []; let el = box;
      while (el && out.length < 7) {
        const s = getComputedStyle(el);
        out.push({ 层: (el.id || el.className || el.tagName).toString().slice(0, 28),
          offsetW: el.offsetWidth, clientW: el.clientWidth,
          css宽: s.width, minW: s.minWidth, flex: s.flex, display: s.display, overflowX: s.overflowX });
        el = el.parentElement;
      }
      return out;
    })(),
    纵向能滚吗: box.scrollHeight > box.clientHeight,
    box样式: { display: cs.display, overflowX: cs.overflowX, overflowY: cs.overflowY, height: cs.height, flex: cs.flex, minHeight: cs.minHeight },
    inner: { offsetW: inner.offsetWidth, offsetH: inner.offsetHeight, cssW: inner.style.width, cssH: inner.style.height, display: getComputedStyle(inner).display, position: getComputedStyle(inner).position },
    卡片: { display: cardCs.display, flex: cardCs.flex, minHeight: cardCs.minHeight, clientH: card.clientHeight, scrollH: card.scrollHeight },
    胶囊最大宽: Math.max(...caps.map(c => c.w)),
    胶囊样例: caps.slice(0, 4),
    重叠对: overlaps.slice(0, 12),
    重叠数: overlaps.length,
  }, null, 1);
})()
