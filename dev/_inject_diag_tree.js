/* 诊断：造树那几步到底造出了什么（一次性，用完即弃）。
 * 用法：node dev/_cdp_run2.mjs ./_inject_diag_tree.js 9555 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => ({ x: s.charCodeAt(0) - 65 - (s.charCodeAt(0) > 73 ? 1 : 0), y: 19 - parseInt(s.slice(1), 10) });
  const put = async s => { const p = G(s); tryPlay(p.x, p.y); await sleep(80); };
  const mainNode = n => { let c = branchRoot; for (let i = 0; i < n; i++) c = c._cs[0]; return c; };
  const out = [];
  const dump = tag => {
    const lines = [];
    (function walk(n, d) {
      const cs = n._cs || [];
      if (cs.length > 1) lines.push('  分叉@第' + d + '手 → ' + cs.length + ' 个孩子');
      for (const c of cs) walk(c, d + 1);
    })(branchRoot, 0);
    let len = 0; { let n = branchRoot; while (n._cs && n._cs.length) { n = n._cs[0]; len += 1; } }
    out.push(tag + ' | 主链 ' + len + ' 手 | viewAt=' + state.viewAt + ' | moves=' + state.moves.length
      + ' | pathIndex(第5手)=' + pathIndexOf(mainNode(5)) + ' pathIndex(第8手)=' + pathIndexOf(mainNode(8)));
    out.push(...lines);
  };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(240);
  const MAIN = ['Q16', 'C16', 'D14', 'E17', 'D16', 'D17', 'E16', 'C17', 'F16', 'R5', 'Q3', 'R3'];
  for (const s of MAIN) await put(s);
  dump('① 主线造完');

  gotoView(4); await sleep(80); await put('K10'); await put('L10');
  dump('② 支 A 造完');

  out.push('  mainNode(5) 是第5手吗？ depth=' + nodeDepth(mainNode(5)) + ' 颜色=' + mainNode(5).color);
  const r = gotoNode(mainNode(5));
  await sleep(160);
  dump('③ gotoNode(mainNode(5)) 之后（返回值 ' + r + '）');

  const sw = (typeof switchBranch === 'function') ? switchBranch(4, 0) : 'no-func';
  await sleep(160);
  dump('④ switchBranch(4,0) 之后（返回 ' + sw + '）');

  applyNewGame(); await sleep(150);
  return out.join('\n');
})();
