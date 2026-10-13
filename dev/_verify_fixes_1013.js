const fs = require('fs'), path = require('path'), os = require('os');

const APP_PATH = path.join(__dirname, '../renderer/app.js');
const MAIN_PATH = path.join(__dirname, '../main.js');
const APP = fs.readFileSync(APP_PATH, 'utf8');
const MAIN = fs.readFileSync(MAIN_PATH, 'utf8');

/* ---------- 抠函数（括号配平） ---------- */
function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到函数 ' + name);
  let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) break; }
  }
  return src.slice(i, k + 1);
}
/* ---------- 「删回去」：锚点没命中就抛错，绝不出现"替换没生效 → 两遍都绿 → 假通过" ---------- */
function unpatch(src, pairs, who) {
  let s = src;
  for (const [from, to] of pairs) {
    if (s.indexOf(from) < 0) throw new Error('[' + who + '] 锚点没命中（源码结构与预期不符，先修这条）：'
      + from.slice(0, 70).replace(/\n/g, '\\n'));
    s = s.split(from).join(to);
  }
  return s;
}

/* =====================================================================
   桩环境 + 造树
   ===================================================================== */
const PRELUDE = `
  let branchRoot = null, pendingDel = null, branchTrash = null;
  const N = 19;
  const log = [];
  const state = { moves: [], viewAt: 0, toMove: 'b', koPoint: null, pv: null, draft: null,
    history: [0.5], leads: [0], histVisits: [100], sgfComments: [], coach: { explain: {} },
    setup: [], review: null };
  function flash(m) { log.push(m); }
  function sideToMove() { return 'b'; }
  function boardAt() { return new Int8Array(N * N); }
  function koFromBoard() { return null; }
  function truncateAnalysisTo(k) { state.history.length = k + 1; }
  function rebuildCapAt() {}
  function syncUI() {}
`;
const TREEHELP = `
  const mk = t => ({ x: t, y: t, color: 'b', captured: 0, _cs: [] });
  function buildTree() {
    const root = { _p: null, _cs: [], _virtual: true, x: -1, y: -1, color: null };
    const m = [1, 2, 3, 4, 5].map(mk);
    let prev = root;
    for (const n of m) { n._p = prev; prev._cs.push(n); prev = n; }
    const side1 = mk(91), side2 = mk(92);
    side1._p = m[2]; m[2]._cs.push(side1); side2._p = side1; side1._cs.push(side2);
    return { root, m, side1, side2 };
  }
`;
function run(appSrc, fnNames, body) {
  return new Function(PRELUDE + TREEHELP + fnNames.map(n => grab(appSrc, n)).join('\n') + body)();
}

/* =====================================================================
   断言（每一条都描述「修好之后该有的样子」；跑在「旧写法」上必须变红）
   ===================================================================== */
const A = [];
function assert(id, name, fn, premise) { A.push({ id, name, fn, premise: !!premise }); }

/* —— 坑位 37：换局之后不能跨局「撤销删除分支」 —— */
const NAMES1 = ['ensureBranch', 'pathFromRoot', 'pathThrough', 'branchParentAt', 'subtreeSize',
  'stashExplainAfter', 'restoreExplainForPath', 'stashAnalysisAfter', 'restoreAnalysisForPath',
  'deleteBranchAt', 'undoDeleteBranch'];
const BODY1 = `
  const g = buildTree(); branchRoot = g.root;
  state.moves = [g.m[0], g.m[1], g.m[2], g.side1, g.side2];   // 走在旁支上
  state.viewAt = 5;
  deleteBranchAt(4); deleteBranchAt(4);                        // 两段式：登记 → 真删
  const sizeAfterDelete = state.moves.length;
  /* —— 换局（照 applyNewGame：moves 清空、树作废）—— */
  state.moves = []; branchRoot = null; state.viewAt = 0; state.draft = null;
  log.length = 0;
  undoDeleteBranch();
  return { sizeAfterDelete, movesAfter: state.moves.length, msg: log.join(' / ') };`;
assert(1, '换局后按 Ctrl+Shift+Z：新局棋盘保持 0 手（不把旧局的线灌回来）', src => {
  const r = run(src, NAMES1, BODY1);
  return r.movesAfter === 0 ? true : { why: '撤销后棋盘变成 ' + r.movesAfter + ' 手（应为 0）· 提示：' + r.msg };
});
assert(2, '换局的清理清单里确实有回收站（applyNewGame + applyRecord 各一处）', src => {
  const n = (src.match(/branchTrash = null; pendingDel = null;/g) || []).length;
  return n >= 2 ? true : { why: '只找到 ' + n + ' 处（要 2 处）' };
});

/* —— 坑位 38：试下（草稿）期间不能切分支 —— */
const NAMES2 = ['ensureBranch', 'pathFromRoot', 'pathThrough', 'branchParentAt', 'branchInfoOf',
  'stashExplainAfter', 'restoreExplainForPath', 'stashAnalysisAfter', 'restoreAnalysisForPath',
  'switchBranch', 'cycleBranch'];
const BODY2 = `
  const g = buildTree(); branchRoot = g.root;
  state.moves = g.m.slice();
  const d1 = { x: 201, y: 201, color: 'w', captured: 0, _p: null, _cs: [] };
  state.draft = { from: 5, snap: { moves: g.m.slice() }, coachTail: {} };
  state.moves.push(d1); state.viewAt = 6;
  state.viewAt = 3;                                  // 回看到岔口
  log.length = 0;
  const switched = cycleBranch(1);
  return { switched, still: state.moves.indexOf(d1) >= 0, n: state.moves.length, msg: log.join(' / ') };`;
assert(3, '试下中按 ↑/↓ 被挡（草稿手不会被整批截走）', src => {
  const r = run(src, NAMES2, BODY2);
  return (r.switched === false && r.still) ? true
    : { why: 'cycleBranch 返回 ' + r.switched + '·草稿手还在=' + r.still + '·现在 ' + r.n + ' 手 · ' + r.msg };
});

/* —— 坑位 40：草稿手的 12a 手号不能是 0 —— */
assert(4, '（前提）moveLabelOf 对不挂树的草稿裸节点就是返回 "0"', src => {
  const got = run(src, ['moveLabelOf'], `return moveLabelOf({ x: 1, y: 1, color: 'w', _p: null, _cs: [] });`);
  return got === '0' ? true : { why: '返回 ' + JSON.stringify(got) };
}, true);
assert(5, '手数列表对草稿手走绝对手号 i+1（而不是 moveLabelOf）', src => {
  const body = grab(src, 'renderMoveList');
  return /\$\{isDf \? \(i \+ 1\) : moveLabelOf\(m\)\}/.test(body) ? true : { why: '列表里没有草稿特判' };
});

/* —— 坑位 39：复盘目损只能挂在主变链上 —— */
assert(6, '（前提）onMainline 对旁支深处判假、对主线判真', src => {
  const r = run(src, ['onMainline'], `const g = buildTree();
    return { side2: onMainline(g.side2), side1: onMainline(g.side1), m4: onMainline(g.m[3]), m1: onMainline(g.m[0]) };`);
  return (r.side2 === false && r.side1 === false && r.m4 === true && r.m1 === true)
    ? true : { why: JSON.stringify(r) };
}, true);
assert(7, '列表的目损列加上了主变链门限（mainSet.has(m)）', src => {
  const body = grab(src, 'renderMoveList');
  return (/mainSet\.has\(m\)/.test(body) && /const mainSet = new Set\(\)/.test(body))
    ? true : { why: '目损仍无条件按手号取' };
});
assert(8, '树面板悬停浮层的目损也加了 onMainline 门限', src => {
  return /state\.review && i >= 0 && onMainline\(m\)/.test(grab(src, 'showTreeTip'))
    ? true : { why: '浮层仍按「在当前路径上」取主线目损' };
});

/* —— 坑位 41：弯形块被提时 captured 不能重复计数 —— */
assert(9, '提掉「L 形三子」这一块：captured = 3（一个块只数一次）', src => {
  const code = `
    const N = 9;
    function idx(x, y) { return y * N + x; }
    ${grab(src, 'neighbors')}
    ${grab(src, 'group')}
    ${grab(src, 'rebuildCapAt')}
    /* 白 {(0,1),(0,0),(1,0)} 连成一块（经 (0,0) 拐弯），黑下在内角 (1,1) 整块提掉。
       这一块与落子点 (1,1) **相邻两次** —— 正是要抓的形状。 */
    const setup = [{ x: 0, y: 1, color: 'w' }, { x: 0, y: 0, color: 'w' }, { x: 1, y: 0, color: 'w' },
                   { x: 2, y: 0, color: 'b' }, { x: 0, y: 2, color: 'b' }, { x: 1, y: 2, color: 'b' },
                   { x: 2, y: 1, color: 'b' }, { x: 2, y: 2, color: 'b' }];
    const after = new Int8Array(N * N);
    setup.forEach(s => { after[idx(s.x, s.y)] = s.color === 'b' ? 1 : 2; });
    after[idx(1, 1)] = 1;                                  // 黑下这一点
    [idx(0, 1), idx(0, 0), idx(1, 0)].forEach(k => { after[k] = 0; });   // 整块被提走
    const state = { setup, moves: [{ x: 1, y: 1, color: 'b', captured: undefined, capAt: undefined }] };
    function boardAt(k) { return after; }                  // 走「之后」的盘面
    rebuildCapAt();
    return { captured: state.moves[0].captured, capAt: state.moves[0].capAt };`;
  const r = new Function(code)();
  return r.captured === 3 ? true : { why: '算出 captured = ' + r.captured + '（真实提子 3）· capAt = ' + JSON.stringify(r.capAt) };
});

/* —— 坑位 42：复盘数据与棋谱手数对不上时不得采信 —— */
assert(10, '打开棋谱时核对复盘数据的手数（对不上就不填、并如实提示）', src => {
  const body = grab(src, 'loadReviewForRecord');
  return (/rv\.history\.length !== want/.test(body) && /flash\(/.test(body))
    ? true : { why: '复盘数据照单全收，没有长度核对' };
});

/* =====================================================================
   坑位 43：写棋谱的三条路都要「保原编码 + 留备份」——执行 main.js 里真实的 handler
   ===================================================================== */
function handlerSrc(mainSrc, key) {
  const i = mainSrc.indexOf("ipcMain.handle('" + key + "'");
  if (i < 0) throw new Error('找不到 handler ' + key);
  let d = 0, k = mainSrc.indexOf('{', i);
  for (; k < mainSrc.length; k++) {
    if (mainSrc[k] === '{') d++;
    else if (mainSrc[k] === '}') { d--; if (!d) break; }
  }
  return mainSrc.slice(i, k + 2);
}
const GBK_BODY = '(;GM[1]FF[4]CA[GB2312]SZ[19]GN[让二子谱]PB[座勋]PW[赵文博];B[pd]C[这一手是中国流的起手，黑棋布局讲究速度。];W[dd])';
function buildMainRunner(mainSrc, dir) {
  const code = `
    const fs = require('fs'), path = require('path');
    const RECORDS_DIR = ${JSON.stringify(dir)};
    const handlers = {};
    function safeRecName(n) { return String(n).replace(/[\\\\/:*?"<>|]/g, '_'); }
    const ipcMain = { handle: (k, fn) => { handlers[k] = fn; } };
    let gbkTable = null;
    ${grab(mainSrc, 'looksUtf8')}
    ${grab(mainSrc, 'readTextSmart')}
    ${grab(mainSrc, 'gbkEncode')}
    ${grab(mainSrc, 'writeTextSmart')}
    ${mainSrc.indexOf('function backupRecordOnce') >= 0 ? grab(mainSrc, 'backupRecordOnce')
      : 'function backupRecordOnce(p) { return false; }'}
    ${handlerSrc(mainSrc, 'records:setPlayers')}
    ${handlerSrc(mainSrc, 'records:setNote')}
    return { handlers, encode: gbkEncode, decodeSmart: readTextSmart };`;
  return new Function('require', code)(require);
}
function test7set(src, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgenc-'));
  const R = buildMainRunner(src, dir);
  const bytes = R.encode(GBK_BODY).buf;
  const file = path.join(dir, 'gu.sgf');
  fs.writeFileSync(file, bytes);
  /* 期望：改名后文件仍是 GBK，且**字节**正好等于「把 PB/PW 换掉的 GBK 原文」 */
  const want = R.encode(GBK_BODY.replace('PB[座勋]', 'PB[张三]').replace('PW[赵文博]', 'PW[李四]')).buf;
  const res = R.handlers['records:setPlayers'](null, 'gu.sgf', '张三', '李四');
  const got = fs.readFileSync(file);
  const back = R.decodeSmart(file);
  const out = [];
  const chk = (name, cond, why) => { if (!cond) out.push(name + ' —— ' + why); return { name, ok: !!cond }; };
  chk('7a 改名后文件仍是 GBK（字节级等于「GBK 版改名结果」）', Buffer.compare(got, want) === 0,
    '磁盘 ' + got.length + ' 字节 vs 期望 GBK ' + want.length + ' 字节 · handler 返回 enc=' + (res && res.enc)
    + ' · 文件末尾 ' + JSON.stringify(got.toString('binary').slice(-14)));
  chk('7b 中文解说词活着', back.indexOf('中国流') >= 0, '读回来末尾 = ' + JSON.stringify(back.slice(-18)));
  chk('7c 落刀前留了 .bak（副本能和原件一样长）', fs.existsSync(file + '.bak')
    && Buffer.compare(fs.readFileSync(file + '.bak'), bytes) === 0,
    '.bak 存在 = ' + fs.existsSync(file + '.bak'));
  chk('7d PB/PW 真改到了', /PB\[张三\]/.test(back) && /PW\[李四\]/.test(back),
    (/PB\[[^\]]*\]/.exec(back) || ['?'])[0]);
  /* setNote 同族 */
  const f2 = path.join(dir, 'note.sgf');
  fs.writeFileSync(f2, bytes);
  R.handlers['records:setNote'](null, 'note.sgf', '新备注');
  const b2 = R.decodeSmart(f2);
  chk('7e setNote 也保编码 + 留备份', Buffer.compare(fs.readFileSync(f2),
    R.encode(GBK_BODY.replace('GN[让二子谱]', 'GN[新备注]')).buf) === 0
    && b2.indexOf('中国流') >= 0 && fs.existsSync(f2 + '.bak'),
    '读回来末尾 = ' + JSON.stringify(b2.slice(-16)) + ' · .bak = ' + fs.existsSync(f2 + '.bak'));
  chk('7f 导入用原字节落盘（不再 utf8 转一遍）',
    /writeFileSync\(path\.join\(RECORDS_DIR, name\), buf\)/.test(src), '仍是 writeFileSync(..., text, "utf8")');
  return out;
}
assert(11, '写棋谱的三条路（setPlayers / setNote / 导入）都保原编码 + 留备份', (appSrc, mainSrc) => {
  const bad = test7set(mainSrc, 'now');
  return bad.length === 0 ? true : { why: bad.join(' ; ') };
});

/* =====================================================================
   主线内容指纹（坑位 42 的方案 A）
   —— 行为三条 + 接线四处
   ===================================================================== */
/* 指纹要在「手搭好的树 + 空 ensureBranch」上算，所以不复用 PRELUDE（那边的 ensureBranch 是真的） */
function runSig(src, body) {
  return new Function(`
    const N = 19;
    const SGF_COLS = 'abcdefghijlmnopqrstuvwxyz'.split('');
    let branchRoot = null;
    const state = { moves: [] };
    function ensureBranch() {}          // 桩：不让它按当前路径重排我们手搭的树
    ${TREEHELP}
    ${grab(src, 'mainlineSig')}
    ${body}`).call(null);
}
assert(12, '（前提）mainlineSig 口径正确：不随当前路径变、随主线内容变', src => {
  const r = runSig(src, `
    const g = buildTree(); branchRoot = g.root;
    const base = mainlineSig();                                // 当前走的就是主线
    state.moves = [g.m[0], g.m[1], g.m[2], g.side1, g.side2];  // 切到旁支（指纹不该变）
    const onBranch = mainlineSig();
    state.moves = g.m.slice();
    g.m[3].x = 17; g.m[3].y = 2;                               // 主线第 4 手换一个点，**手数没变**
    const changed = mainlineSig();
    g.m[3].x = 4; g.m[3].y = 4;
    const back = mainlineSig();
    return { base, onBranch, changed, back };`);
  return (r.base === r.onBranch && r.base !== r.changed && r.base === r.back)
    ? true : { why: '主线=' + r.base + ' 旁支上=' + r.onBranch + ' 换一手=' + r.changed + ' 换回=' + r.back };
}, true);
assert(13, '指纹写进了两份附属文件（复盘 sig / 讲解 sg），读取时都比对', src => {
  const miss = [];
  if (!/state\.review\.sig = mainlineSig\(\);/.test(src)) miss.push('复盘没写 sig');
  if (!/\{ v: 1, cv: COACH_VER, sg: mainlineSig\(\)/.test(src)) miss.push('讲解没写 sg');
  if (!/if \(rv\.sig\) \{/.test(grab(src, 'loadReviewForRecord'))) miss.push('打开棋谱时不核对复盘指纹');
  if (!/data\.sg && data\.sg !== mainlineSig\(\)/.test(grab(src, 'loadCoachForRecord'))) miss.push('打开棋谱时不核对讲解指纹');
  if (!/if \(rv\.sig && rv\.sig !== mainlineSig\(\)\) \{/.test(grab(src, 'openSavedReview'))) miss.push('看报告时不核对指纹');
  return miss.length === 0 ? true : { why: miss.join(' / ') };
});
assert(14, '覆盖当前打开的棋谱后，内存里按手号存的复盘/讲解立刻收起', src => {
  const body = grab(src, 'refreshRecords');
  return /if \(it\.name === state\.recName\) \{[\s\S]{0,700}?state\.review = null;[\s\S]{0,200}?state\.coach\.explain = \{\}/.test(body)
    ? true : { why: '覆盖后没清内存里的附属数据（还是会当场错挂）' };
});
/* 「覆盖」之后附属文件陈旧这条：老代码只有长度核对，这里补一组专门删回去的锚点 */
const OLD15 = src => unpatch(src, [
  ['  state.review.sig = mainlineSig();', ''],
  ['{ v: 1, cv: COACH_VER, sg: mainlineSig(), ', '{ v: 1, cv: COACH_VER, '],
  ['  if (rv.sig) {', '  if (false) {'],
  ['  if (data && data.sg && data.sg !== mainlineSig()) {', '  if (false) {'],
  ['  if (rv.sig && rv.sig !== mainlineSig()) {', '  if (false) {'],
  ['          if (it.name === state.recName) {', '          if (false) {'],
], '坑位42 方案A');
const OLDSIGFN = src => {
  const a = src.indexOf('/* ---------------- 主线内容指纹');
  const b = src.indexOf("return (h >>> 0).toString(36) + '-' + s.length;\n}", a);
  if (a < 0 || b < 0) throw new Error('[mainlineSig] 删不出去（源码结构与预期不符）');
  return src.slice(0, a) + src.slice(b + "return (h >>> 0).toString(36) + '-' + s.length;\n}".length + 1);
};

/* =====================================================================
   「旧写法」= 当前源码把这次的修法逐条删回去
   ===================================================================== */
function makeOldApp(src) {
  src = unpatch(src, [[`  ensureBranch();
  let top = t.parent; while (top && top._p) top = top._p;
  if (top !== branchRoot) {
    pendingDel = null;
    flash('那枝属于刚才那份棋谱/上一局 —— 换局之后不能跨局撤销，已作废');
    return false;
  }
`, '']], '坑位37 守卫');
  src = unpatch(src, [[
    `  branchTrash = null; pendingDel = null; // ★ 坑位 37 同源：换棋谱也要作废「上一棵树的」回收站与待删登记\n`, ''], [
    `  branchTrash = null; pendingDel = null;\n  state.candidates = [];`, `  state.candidates = [];`]], '坑位37 清理');
  src = unpatch(src, [[`  if (state.draft) { flash('试下（草稿）期间不换分支 —— 先点「退出试下」（草稿的手不进分支树）'); return false; }
`, '']], '坑位38');
  src = unpatch(src, [['${isDf ? (i + 1) : moveLabelOf(m)}', '${moveLabelOf(state.moves[i])}']], '坑位40');
  src = unpatch(src, [['(state.review && !isDf && mainSet.has(m))', '(state.review && !isDf)']], '坑位39 列表');
  src = unpatch(src, [[`  const loss = (state.review && i >= 0 && onMainline(m) && !state.draft) ? state.review.losses[i] : null;`,
    `  const loss = (state.review && i >= 0 && !state.draft) ? state.review.losses[i] : null;`]], '坑位39 浮层');
  src = unpatch(src, [[`      if (prevBoard[k] === 3 - me && after[k] === 0 && !counted.has(k)) {
        const gp = group(prevBoard, nx, ny).stones;
        cnt += gp.length;                          // 一块可能是多子
        gp.forEach(s => counted.add(s));            // 整块记下，绕回来的那个邻位就不再重数`,
    `      if (prevBoard[k] === 3 - me && after[k] === 0) {
        cnt += group(prevBoard, nx, ny).stones.length;`]], '坑位41');
  src = unpatch(src, [[`    const want = state.moves.length + 1;
    if (rv.history.length !== want) {`, `    if (false) {`]], '坑位42 长度核对');
  src = OLD15(src);                      // 坑位42 方案 A：指纹的写入与四处核对
  src = OLDSIGFN(src);                   // 连 mainlineSig 本身一起去掉
  return src;
}
function makeOldMain(src) {
  src = unpatch(src, [[`    if (!fs.existsSync(full)) return { error: '找不到这份棋谱：' + name };
    backupRecordOnce(full);
    let text = readTextSmart(full);`, `    let text = fs.readFileSync(full, 'utf8');`],
  [`    const wr = writeTextSmart(full, text);
    return { ok: true, enc: wr.enc, missing: wr.missing };`,
    `    fs.writeFileSync(full, text, 'utf8');
    return { ok: true };`],
  [`    backupRecordOnce(full);
    let text = readTextSmart(full);
    const clean =`, `    let text = fs.readFileSync(full, 'utf8');
    const clean =`],
  [`    const wr = writeTextSmart(full, text);
    return { ok: true, note: clean, enc: wr.enc, missing: wr.missing };`,
    `    fs.writeFileSync(full, text, 'utf8');
    return { ok: true, note: clean };`],
  [`        fs.writeFileSync(path.join(RECORDS_DIR, name), buf);   // ★ 原字节落盘（见上面坑位 43）`,
    `        fs.writeFileSync(path.join(RECORDS_DIR, name), text, 'utf8');`]], '坑位43');
  return src;
}

/* =====================================================================
   跑两遍
   ===================================================================== */
let OLD_APP, OLD_MAIN;
try { OLD_APP = makeOldApp(APP); OLD_MAIN = makeOldMain(MAIN); }
catch (e) { console.log('★ 构造「旧写法」失败：' + e.message); process.exit(2); }

function passOne(src, mainSrc) {
  const res = [];
  for (const a of A) {
    const v = a.premise ? 'SKIP' : (() => { try { return a.fn(src, mainSrc); } catch (err) { return { why: '抛错：' + err.message }; } })();
    let okk = v === true, why = '';
    if (typeof v === 'object' && v && v.why) { okk = false; why = v.why; }
    res.push({ id: a.id, name: a.name, ok: okk, why, premise: a.premise });
  }
  return res;
}
const oldRes = passOne(OLD_APP, OLD_MAIN);
const newRes = passOne(APP, MAIN);

function show(title, res) {
  console.log('\n' + title);
  res.forEach(r => console.log('  ' + (r.premise ? '前提' : (r.ok ? 'PASS' : 'FAIL')) + '  #' + r.id + ' '
    + r.name + (!r.ok && r.why ? '\n         └ ' + r.why : '')));
}
show('———— A) 旧写法（把这次的修法删回去）：每条真断言都应当 FAIL ————', oldRes);
show('———— B) 当前源码：必须全绿 ————', newRes);

const newBad = newRes.filter(r => !r.ok && !r.premise);
const oldGreen = oldRes.filter(r => r.ok && !r.premise);
const oldRealRed = oldRes.filter(r => !r.ok && !r.premise);
console.log('\n小结');
console.log('  · 当前源码 FAIL        = ' + newBad.length + ' 条' + (newBad.length ? ' ← 必须修掉' : '（全绿）'));
console.log('  · 旧写法上变红（= 断言真能抓住那个 bug）= ' + oldRealRed.length + ' / '
  + (oldRes.length - oldRes.filter(r => r.premise).length) + ' 条');
if (oldGreen.length) console.log('  · ⚠ 旧写法上仍然 PASS（这些是**假断言**，抓不住 bug，要重写）：\n     - '
  + oldGreen.map(r => '#' + r.id + ' ' + r.name).join('\n     - '));
process.exit(newBad.length ? 1 : 0);
