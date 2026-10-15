(() => {
  const out = { steps: [] };
  window.__f = [];
  const origFlash = flash;
  flash = m => { window.__f.push(String(m)); return origFlash(m); };
  const G = s => { const m = /^([A-HJ-T])(\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  const colorBad = () => {
    const bad = [];
    (function walk(n, depth) {
      for (const c of (n._cs || [])) {
        const i = depth + 1, want = sideToMove(i - 1);
        if (c.color !== want) bad.push(i + ':' + want + '->' + c.color + (c.pass ? '(pass)' : '(' + c.x + ',' + c.y + ')'));
        walk(c, i);
      }
    })(branchRoot, 0);
    return bad;
  };
  const snap = tag => {
    const last = state.moves.length ? state.moves[state.moves.length - 1] : null;
    const expectTo = sideToMove(state.moves.length);
    out.steps.push({
      tag, moves: state.moves.length, viewAt: state.viewAt,
      toMove: state.toMove, expectTo, toMoveOK: state.toMove === expectTo,
      lastColor: last ? last.color : null,
      sameAsNext: last ? (last.color === state.toMove) : null,   // true = 下一手会和上一手同色！
      treeBad: colorBad(), flash: window.__f.slice(-2)
    });
    window.__f.length = 0;
  };
  const doPlay = (q, label) => { const c = G(q); const r = tryPlay(c.x, c.y); window.__f.push('tryPlay(' + q + ')=' + r); return r; };
  try {
    if (state.draft) exitDraft();
    applyNewGame();
    settings.mode = 'free';
    for (const q of ['D4', 'Q16', 'D16', 'Q4', 'C6']) doPlay(q);
    snap('0 主线 5 手');
    /* 树里点珠子回看 → 落子开旁支 */
    gotoNode(state.moves[2]);
    snap('1 点了树上第 3 手的珠子（gotoNode）');
    doPlay('K10');
    snap('2 在第 3 手后落子（应开旁支）');
    doPlay('L10');
    snap('3 旁支再走一手');
    /* 提升主变 */
    promoteToMainline(state.viewAt);
    snap('4 提升主变');
    /* 悔棋 */
    $('btn-undo').click();
    snap('5 悔棋一次');
    $('btn-undo').click();
    snap('6 再悔棋一次');
    /* 删除分支：先切到另一条支 */
    gotoView(state.moves.length);
    snap('7 跳到最新');
    doPlay('Q10');
    snap('8 再落一手');
  } catch (e) { out.err = String(e && e.stack || e).slice(0, 300); }
  flash = origFlash;
  return JSON.stringify(out, null, 1);
})()