(() => {
  const out = { fail: null, seq: [], steps: 0 };
  const colorBad = () => {
    const bad = [];
    (function walk(n, d) {
      for (const c of (n._cs || [])) {
        const i = d + 1;
        if (c.color !== sideToMove(i - 1)) bad.push(i + ':' + c.color + '≠' + sideToMove(i - 1));
        walk(c, i);
      }
    })(branchRoot, 0);
    return bad;
  };
  const check = op => {
    const exp = sideToMove(state.moves.length);
    if (state.toMove !== exp) return { kind: 'toMove不一致', op, toMove: state.toMove, exp, moves: state.moves.length };
    const bad = colorBad();
    if (bad.length) return { kind: '树里颜色不交替', op, bad };
    const last = state.moves.length ? state.moves[state.moves.length - 1] : null;
    if (last && last.color === state.toMove) return { kind: '下一手会同色', op, moves: state.moves.length, lastColor: last.color, toMove: state.toMove };
    return null;
  };
  const allNodes = () => { const a = []; (function w(n, d) { for (const c of (n._cs || [])) { a.push(c); w(c, d + 1); } })(branchRoot, 0); return a; };
  const ops = [
    () => 'play=' + tryPlay(2 + Math.floor(Math.random() * 15), 2 + Math.floor(Math.random() * 15)),
    () => { gotoView(Math.floor(Math.random() * (state.moves.length + 1))); return 'gotoView'; },
    () => { try { cycleBranch(Math.random() < 0.5 ? -1 : 1); } catch (e) { return 'cycle-err'; } return 'cycleBranch'; },
    () => { try { promoteToMainline(state.viewAt); } catch (e) { return 'promote-err'; } return 'promoteToMainline'; },
    () => { try { deleteBranchAt(state.viewAt, { force: true }); } catch (e) { return 'del-err'; } return 'deleteBranchAt'; },
    () => { try { undoDeleteBranch(); } catch (e) { return 'undoDel-err'; } return 'undoDeleteBranch'; },
    () => { $('btn-undo').click(); return 'undo'; },
    () => { $('btn-pass').click(); return 'pass'; },
    () => { const a = allNodes(); if (!a.length) return 'gotoNode(skip)'; const n = a[Math.floor(Math.random() * a.length)]; try { gotoNode(n); } catch (e) { return 'gotoNode-err'; } return 'gotoNode'; },
    () => { if (state.draft) { exitDraft(); return 'exitDraft'; } enterDraft(); return 'enterDraft'; },
    () => { gotoView(state.moves.length); return 'gotoLast'; },
  ];
  try {
    if (state.draft) exitDraft();
    applyNewGame();
    settings.mode = 'free';
    for (let i = 0; i < 4; i++) tryPlay(3 + i, 3 + i);
    for (let i = 0; i < 400 && !out.fail; i++) {
      const k = Math.floor(Math.random() * ops.length);
      let r;
      try { r = ops[k](); } catch (e) { r = 'threw:' + String(e).slice(0, 60); }
      out.seq.push(k + ':' + r);
      if (out.seq.length > 12) out.seq.shift();
      out.steps = i + 1;
      const f = check(k + ':' + r);
      if (f) { f.最近12步 = out.seq.slice(); out.fail = f; }
    }
  } catch (e) { out.err = String(e && e.stack || e).slice(0, 300); }
  return JSON.stringify(out, null, 1);
})()