(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  const pick = (d, r) => document.querySelector('#branch-tree .cap[data-d="' + d + '"][data-r="' + r + '"]');
  settings.mode="free"; settings.size=19; settings.handicap=0; settings.rules="chinese";
  applyNewGame(); await sleep(220);
  for (const q of ["D4","Q16","D16","Q4","C6"]) { const c=G(q); tryPlay(c.x,c.y); }
  await sleep(100); gotoView(3); await sleep(50);
  const bk=G("K10"); tryPlay(bk.x,bk.y); await sleep(80);
  const bk2=G("L10"); tryPlay(bk2.x,bk2.y); await sleep(80);
  const tb=[...document.querySelectorAll("#seg-moves button")].find(b=>b.dataset.v==="tree"); tb.click(); await sleep(200);
  gotoView(3); await sleep(50); cycleBranch(1); await sleep(200);   // 切到旧线(主变=Q4那条)
  const kCell=treeCells.find(c=>c.node.x===bk.x&&c.node.y===bk.y);
  pick(kCell.depth,kCell.row).click(); await sleep(300);
  const cur=treeCells.find(c=>c.node===state.moves[state.viewAt-1]);
  const curDom=pick(cur.depth,cur.row);
  return "viewAt="+state.viewAt+" | curNode是"+(state.moves[state.viewAt-1].x===bk.x?"K10(旁支首)":state.moves[state.viewAt-1].x===bk2.x?"L10(旁支末)":"别的")
    +" | 该格高亮cur="+(curDom&&curDom.classList.contains("cur")?"是":"否")
    +" | moves.length="+state.moves.length;
})()
