/* 诊断：树面板为什么没有滚动条 —— 读几何数据，不猜。 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  /* 造一条长主线（60 手）+ 一条旁支，逼出横向滚动需求 */
  const pts = ['D4','Q16','D16','Q4','C6','E3','F3','C4','E7','R14','P3','O6','N11','M16','L17','K17','J17','H17','G17','F17','E17','D17','C17','B17','A17','A16','A15','A14','A13','A12','B12','C12','D12','E12','F12','G12','H12','J12','K12','L12','M12','N12','O12','P12','Q12','R12','S12','T12','T13','T14','T15','T16','T17','S17','R17','Q17','P17','O17','N17','M17'];
  for (const q of pts) { const c = G(q); tryPlay(c.x, c.y); }
  await sleep(200);
  gotoView(30); await sleep(60);
  const bk = G('K10'); tryPlay(bk.x, bk.y); await sleep(150);

  [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree').click();
  await sleep(300);

  const box = document.getElementById('branch-tree');
  const inner = box.firstElementChild;
  const cs = getComputedStyle(box);
  return JSON.stringify({
    节点数: treeCells.length, 最大列: treeMaxDepth, 航道数: treeLanes,
    box: { clientW: box.clientWidth, clientH: box.clientHeight, scrollW: box.scrollWidth, scrollH: box.scrollHeight },
    box样式: { display: cs.display, overflow: cs.overflow, height: cs.height, flex: cs.flex, minHeight: cs.minHeight, position: cs.position },
    inner: { offsetW: inner.offsetWidth, offsetH: inner.offsetHeight, styleW: inner.style.width, styleH: inner.style.height,
             display: getComputedStyle(inner).display, flex: getComputedStyle(inner).flex, position: getComputedStyle(inner).position },
    胶囊数: box.querySelectorAll('.cap').length,
    父级: (() => { const c = box.parentElement, s = getComputedStyle(c);
      return { cls: c.className, display: s.display, flex: s.flex, height: s.height, overflow: s.overflow }; })(),
  }, null, 1);
})()
