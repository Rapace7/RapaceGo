(() => {
  const out = { errors: [] };
  try {
    window.__koFlash = [];
    if (!window.__koFlashHooked) {
      const orig = flash;
      flash = function (m) { window.__koFlash.push(String(m)); return orig(m); };
      window.__koFlashHooked = true;
    }
    const SEQ = ["pd","pp","dc","fd","ce","do","cq","nj","nq","ee","ch","ei","eg","fg","fc","ef","df","dh","eh","dg","fh","fi","gh","gg","di","cg","bg","dj","cf","ff","dg","hh","gi","gj","hi","ej","hg","ih","ig","ii","hj","gk","ij","ji","ki","jj","jk","kj","lj","kk","op","lk","li","mk","jh","jg","kh","if","ge","hf","gd","gc","ed","fe","hc","lg","mh","lh","kg","kf","lf","mg","ng","mf","me","le","ni","nh","oh","ne","md","nf","oe","mi","mj"];
    if (state.draft) exitDraft();
    settings.mode = 'free';
    state.noGame = false;
    branchRoot = null;
    state.moves.length = 0;
    state.koPoint = null;
    state.draft = null;
    state.history.length = 0; state.leads.length = 0; state.histVisits.length = 0;
    state.result = null; state.lastEval = null;
    state.setup = [];
    let color = 'b';
    for (const s of SEQ) {
      const x = SGF_COLS.indexOf(s[0]), y = SGF_COLS.indexOf(s[1]);
      state.moves.push({ x, y, color, _p: null, _cs: [] });
      color = color === 'b' ? 'w' : 'b';
    }
    rebuildCapAt();
    state.viewAt = state.moves.length;
    state.toMove = 'w';
    state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
    const m85 = state.moves[84];
    out.hand84 = { xy: m85 ? null : null };
    out.hand85 = { color: m85.color, x: m85.x, y: m85.y, captured: m85.captured, capAt: m85.capAt ? (m85.capAt.x+','+m85.capAt.y) : null };
    out.koPoint = state.koPoint ? (state.koPoint.x + ',' + state.koPoint.y) : null;
    const b85 = boardAt(85);
    window.__koFlash.length = 0;
    let ret = null, err = null;
    try { ret = tryPlay(12, 8); } catch (e) { err = String(e && e.stack || e).split('\n').slice(0,3).join(' | '); }
    out.move86 = { 'xy': '12,8', label: 'W(mi) 点回', ret, err, flash: window.__koFlash.slice(), movesNow: state.moves.length };
    const b86 = boardAt(state.moves.length);
    let blackOnBoard85 = 0, blackOnBoard86 = 0;
    for (let i=0;i<361;i++) { if (b85[i]===1) blackOnBoard85++; if (b86[i]===1) blackOnBoard86++; }
    out.black = { before: blackOnBoard85, after: blackOnBoard86 };
  } catch (e) { out.errors.push(String(e && e.stack || e).split('\n').slice(0,5).join(' | ')); }
  return JSON.stringify(out, null, 1);
})()