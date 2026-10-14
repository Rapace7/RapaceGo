/* 探测 app.js 到底执行到哪一步了。
 * 症状：页面里 `settings` 都没定义 = 模块级脚本没跑完（不是某个函数的问题）。 */
(function () {
  const L = [];
  const N = n => { try { return eval('typeof ' + n); } catch (e) { return 'ERR ' + e.message; } };
  L.push('=== 模块级变量是否已定义 ===');
  for (const n of ['settings', 'state', 'treeLayout', 'COACH_VER', 'branchRoot', 'stoneX',
    'renderMoveTree', 'setTreeZoom', 'TREE_PAD_X', 'initBranchTree', 'moveLabelOf']) {
    L.push('  ' + n + ' : ' + N(n));
  }
  L.push('=== DOM 在不在 ===');
  for (const id of ['branch-tree', 'movelist', 'treezoom', 'treezoom-slot', 'btn-treezoom', 'seg-moves']) {
    L.push('  #' + id + ' : ' + (document.getElementById(id) ? '有' : '★没有'));
  }
  L.push('=== body 里有没有东西 ===');
  L.push('  body.children = ' + document.body.children.length);
  L.push('  首个 = ' + (document.body.firstElementChild ? document.body.firstElementChild.className || document.body.firstElementChild.tagName : '(空)'));
  return L.join('\n');
})();
