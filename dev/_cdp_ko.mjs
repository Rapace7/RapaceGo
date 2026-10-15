/* 劫判定回归（2026-10-15 修「倒扑被当成劫」）
 *
 * 用法：先起带调试端口的实例（dev\\_start_cdp.bat），再 `node dev/_cdp_ko.mjs [端口]`
 *      端口优先级：命令行参数 > 环境变量 CDP_PORT > 9333
 *
 * 判据来源：**Sabaki 的 @sabaki/go-board**（GoBoard.js 第 82-93 行 makeMove 的 hasKo）。
 *   四条同时成立才算「这一手制造了劫」：
 *     提子数 == 1 · 落下的这子是孤子 · 它落子后只有 1 口气 · 那口气正是刚提掉的那一点
 *   同一条判据在 tryPlay（落子时）与 koFromBoard（悔棋/打开棋谱/切分支后重算）各用一次。
 *
 * 覆盖：
 *   R1 真实棋谱（首相存的 records\\20261015-115454-85手.sgf，GN[劫与倒扑BUG]，85 手）
 *      —— 黑 85 提子后与己方相连（不是孤子）→ 不该设禁着点 → 白 86 点回必须放行并提 7 子
 *   R2 Sabaki 官方测试棋形（GoBoard.test.js「should detect kos」）—— 真劫必须仍然禁止
 *   R3 倒扑构造形（黑环 + 白墙）—— 白扑 → 黑提（不设禁着点）→ 白点回提整块
 *   R4 koFromBoard 的 `at` 参数生效（盘面与手一一对应，回看态不再错算禁着点）
 *
 * ⚠️ 只验 R1 是不够的：把劫判据整个删掉也能让 R1 变绿，所以 R2 必须一起看。
 */
const PORT = Number(process.argv[2] || process.env.CDP_PORT || 9333);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl && !/^(edge|devtools|chrome):/.test(x.url));
      if (p) return p;
    } catch (e) { }
    await sleep(500);
  }
  throw new Error('连不上调试端口 ' + PORT);
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seqN = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seqN; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + String(r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}

const SEQ = ["pd","pp","dc","fd","ce","do","cq","nj","nq","ee","ch","ei","eg","fg","fc","ef","df","dh","eh","dg","fh","fi","gh","gg","di","cg","bg","dj","cf","ff","dg","hh","gi","gj","hi","ej","hg","ih","ig","ii","hj","gk","ij","ji","ki","jj","jk","kj","lj","kk","op","lk","li","mk","jh","jg","kh","if","ge","hf","gd","gc","ed","fe","hc","lg","mh","lh","kg","kf","lf","mg","ng","mf","me","le","ni","nh","oh","ne","md","nf","oe","mi","mj"];

const expr = `(() => {
  const out = { errors: [] };
  window.__koFlash = [];
  if (!window.__koFlashHooked) {
    const orig = flash;
    flash = function (m) { window.__koFlash.push(String(m)); return orig(m); };
    window.__koFlashHooked = true;
  }
  const fresh = () => {
    if (state.draft) exitDraft();
    settings.mode = 'free'; state.noGame = false; branchRoot = null;
    state.moves.length = 0; state.koPoint = null; state.draft = null; state.viewAt = 0;
    state.history.length = 0; state.leads.length = 0; state.histVisits.length = 0;
    state.result = null; state.lastEval = null; state.setup = []; window.__koFlash.length = 0;
  };
  const apply = (s, toMove) => {
    fresh(); let color = 'b';
    for (const t of s) { state.moves.push({ x: SGF_COLS.indexOf(t[0]), y: SGF_COLS.indexOf(t[1]), color, _p:null, _cs:[] }); color = color==='b'?'w':'b'; }
    rebuildCapAt(); state.viewAt = state.moves.length; state.toMove = toMove;
    state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves, state.moves.length);
  };
  const koStr = () => state.koPoint ? (state.koPoint.x + ',' + state.koPoint.y) : null;
  const blacks = () => { const b = boardAt(state.moves.length); let n = 0; for (let i=0;i<b.length;i++) if (b[i]===1) n++; return n; };
  const lastMove = () => state.moves.length ? state.moves[state.moves.length-1] : null;

  /* ---- R1 真实棋谱 ---- */
  apply(${JSON.stringify(SEQ)}, 'w');
  out.R1_koAfterMove85 = koStr();
  const bB = blacks();
  window.__koFlash.length = 0;
  let r1 = null; try { r1 = tryPlay(12,8); } catch(e) { out.errors.push('R1:'+(e&&e.stack||e)); }
  const m1 = lastMove();
  out.R1 = { ret: r1, flash: window.__koFlash.slice(), captured: m1?m1.captured:null, blackBefore: bB, blackAfter: blacks() };

  /* ---- R2 Sabaki 官方真劫棋形 ---- */
  fresh();
  state.setup = [[2,0],[2,2],[3,1]].map(p=>({x:p[0],y:p[1],color:'w'}))
    .concat([[0,1],[1,0],[1,2],[2,1]].map(p=>({x:p[0],y:p[1],color:'b'})));
  state.toMove = 'w';
  const w1 = tryPlay(1,1);
  out.R2_koAfterWhiteCapture = koStr();
  window.__koFlash.length = 0;
  let b2 = null; try { b2 = tryPlay(2,1); } catch(e) { out.errors.push('R2:'+(e&&e.stack||e)); }
  out.R2 = { whiteCapture: w1, blackRecapture: b2, flash: window.__koFlash.slice() };
  /* R4：koFromBoard 的 at 参数（此时 moves.length = 1） */
  const koAt1 = koFromBoard(boardAt(1), state.moves, 1);
  const koAt0 = koFromBoard(boardAt(1), state.moves, 0);
  out.R4_koFromBoardAt = { at1: koAt1 ? (koAt1.x+','+koAt1.y) : null, at0: koAt0 ? (koAt0.x+','+koAt0.y) : null };

  /* ---- R3 倒扑构造形 ---- */
  fresh();
  state.setup = [[2,0],[2,1],[2,2],[2,3],[1,4],[0,4]].map(p=>({x:p[0],y:p[1],color:'w'}))
    .concat([[0,0],[1,0],[1,1],[1,2],[1,3],[0,3]].map(p=>({x:p[0],y:p[1],color:'b'})));
  state.toMove = 'w';
  tryPlay(0,1);
  const koPounce = koStr();
  const capRet = tryPlay(0,2);
  const koCapture = koStr();
  window.__koFlash.length = 0;
  let back = null; try { back = tryPlay(0,1); } catch(e) { out.errors.push('R3:'+(e&&e.stack||e)); }
  const m3 = lastMove();
  out.R3 = { koAfterPounce: koPounce, captureRet: capRet, koAfterCapture: koCapture, recaptureRet: back, flash: window.__koFlash.slice(), captured: m3?m3.captured:null };
  return JSON.stringify(out);
})()`;

const raw = await js(expr);
ws.close();
if (typeof raw !== 'string' || raw.startsWith('ERR')) { console.log('✗ 求值失败: ' + raw); process.exit(1); }
const r = JSON.parse(raw);
const checks = [
  ['R1 黑 85 提子后【不】设禁着点（它不是孤子）', r.R1_koAfterMove85 === null],
  ['R1 真实棋谱第 86 手白点回放行', r.R1.ret === true],
  ['R1 提走 7 颗黑子（40 → 33）', r.R1.captured === 7 && r.R1.blackBefore === 40 && r.R1.blackAfter === 33],
  ['R1 不再弹「打劫」提示', r.R1.flash.length === 0],
  ['R2 Sabaki 真劫棋形：白提子后禁着点 = (2,1)', r.R2_koAfterWhiteCapture === '2,1'],
  ['R2 黑立即回提被禁止', r.R2.blackRecapture === false && r.R2.whiteCapture === true],
  ['R2 提示语是「打劫」', String(r.R2.flash[0] || '').includes('打劫')],
  ['R3 倒扑：黑提子那手【不】设禁着点', r.R3.koAfterCapture === null && r.R3.captureRet === true],
  ['R3 白点回放行并提 7 子', r.R3.recaptureRet === true && r.R3.captured === 7],
  ['R4 koFromBoard 的 at 参数生效（at=1 得 (2,1)、at=0 得 null）', r.R4_koFromBoardAt.at1 === '2,1' && r.R4_koFromBoardAt.at0 === null],
  ['无运行时异常', r.errors.length === 0]
];
let bad = 0;
for (const [name, ok] of checks) { console.log((ok ? '  ✓ ' : '  ✗ ') + name); if (!ok) bad++; }
console.log(JSON.stringify(r, null, 1));
console.log(bad === 0 ? '\n打劫回归：全绿 ' + checks.length + '/' + checks.length : '\n打劫回归：失败 ' + bad + ' 项');
process.exit(bad === 0 ? 0 : 1);
