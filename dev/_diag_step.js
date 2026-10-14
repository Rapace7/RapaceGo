/* 极简分步诊断：找出 _inject_tree1014 卡在哪一步。
 * ★ 刻意**不用 await / sleep** —— 那正是要排查的东西。每一步立刻返回一个标记。 */
(function () {
  const L = [];
  const step = (tag, fn) => {
    try { const v = fn(); L.push(tag + ' → ' + (v === undefined ? 'ok' : v)); }
    catch (e) { L.push(tag + ' → ★抛错: ' + (e && e.message)); }
  };
  step('D0 基本', () => 'settings=' + typeof settings + ' applyNewGame=' + typeof applyNewGame + ' tryPlay=' + typeof tryPlay);
  step('D1 设设置', () => { settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese'; });
  step('D2 applyNewGame', () => { applyNewGame(); return '手数=' + state.moves.length; });
  step('D3 tryPlay 一手', () => {
    const r = tryPlay(3, 15);                       // Q16（x=3,y=15）
    return '返回=' + r + '  手数=' + state.moves.length;
  });
  step('D4 再一手', () => {
    const r = tryPlay(15, 3);
    return '返回=' + r + '  手数=' + state.moves.length;
  });
  step('D5 切树视图按钮在不在', () => {
    const b = [...document.querySelectorAll('#seg-moves button')].find(x => x.dataset.v === 'tree');
    return b ? '在' : '★不在';
  });
  step('D6 直接调 treeLayout', () => {
    treeLayout();
    return '珠子=' + treeCells.length + ' 行=' + treeLanes + ' 深度=' + treeMaxDepth;
  });
  step('D7 直接调 renderMoveTree', () => { renderMoveTree(); return 'DOM 珠子=' + document.querySelectorAll('#branch-tree .cap').length; });
  step('D8 moveLabelOf 第一手', () => moveLabelOf(state.moves[0]));
  return L.join('\n');
})();
