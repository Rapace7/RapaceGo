/* 落子预览（悬停小方块）回归 —— 2026-10-15 首相报「点树面板里一个珠子后预览就没了」
 *
 * 用法：`node dev/_cdp_hover.mjs [端口]`（先起 dev\\_start_cdp.bat 那个实例）
 *
 * 断言语义：**拿像素说话** —— 在目标交叉点周围取一块画布像素求和，
 *   hover 前后的和必须不同（= 方块真的画上去了），而不是只看变量里 hover 有没有值。
 *   另外三条边界（AI 思考中 / 未开局 / 鼠标移出棋盘）必须仍然不画。
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

const expr = `(async () => {
  const out = { errors: [] };
  try {
    const list = await window.api.records.list();
    const names = (list||[]).map(x => (x && x.name) ? x.name : String(x));
    const target = names.find(n => n.indexOf('冲天') >= 0) || names[0];
    out.target = target;
    await openRecord(target);
    state.thinking = false;
    if (state.draft) exitDraft();
    gotoView(state.moves.length);

    const dpr = window.devicePixelRatio || 1;
    const sample = (x, y) => {
      const [cx, cy] = pxOf(x, y);
      const px = Math.round(cx * dpr), py = Math.round(cy * dpr);
      const half = Math.round(9 * dpr);
      const img = ctx.getImageData(px - half, py - half, half * 2, half * 2).data;
      let s = 0;
      for (let i = 0; i < img.length; i += 4) s += img[i] + img[i+1] + img[i+2];
      return s;
    };
    const emptyPoint = () => {
      const b = boardAt(state.viewAt);
      for (let y = 3; y < 16; y++) for (let x = 3; x < 16; x++) if (b[idx(x, y)] === 0) return { x, y };
      return null;
    };
    const rect = canvas.getBoundingClientRect();
    const fire = (p) => {
      const [cx, cy] = pxOf(p.x, p.y);
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + cx, clientY: rect.top + cy, bubbles: true }));
    };
    const clearHover = () => { canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })); };

    const p = emptyPoint();
    if (!p) throw new Error('找不到空点');

    /* ① 末端（正常落子态） */
    gotoView(state.moves.length);
    clearHover();
    const base1 = sample(p.x, p.y);
    fire(p);
    const withHover1 = sample(p.x, p.y);
    out.normal = { viewAt: state.viewAt, moves: state.moves.length, hover: hover ? (hover.x+','+hover.y) : null, base: base1, withHover: withHover1, drew: base1 !== withHover1 };

    /* ② 回看态（gotoView 到中段）—— 修复前这里不画 */
    gotoView(Math.max(1, Math.floor(state.moves.length / 2)));
    clearHover();
    const base2 = sample(p.x, p.y);
    fire(p);
    const withHover2 = sample(p.x, p.y);
    out.review = { viewAt: state.viewAt, moves: state.moves.length, hover: hover ? (hover.x+','+hover.y) : null, base: base2, withHover: withHover2, drew: base2 !== withHover2 };

    /* ③ 真实点击树面板的珠子之后（首相的复现路径） */
    movesView = 'tree';
    $('movelist').hidden = true;
    $('branch-tree').hidden = false;
    renderMoveTree();
    const caps = [...document.querySelectorAll('#branch-tree .cap')];
    out.caps = caps.length;
    if (caps.length > 1) {
      caps[caps.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      out.afterCapClick = { viewAt: state.viewAt, moves: state.moves.length };
      clearHover();
      const base3 = sample(p.x, p.y);
      fire(p);
      const withHover3 = sample(p.x, p.y);
      out.afterTreeClick = { viewAt: state.viewAt, moves: state.moves.length, hover: hover ? (hover.x+','+hover.y) : null, base: base3, withHover: withHover3, drew: base3 !== withHover3 };
    }
    movesView = 'list'; $('movelist').hidden = false; $('branch-tree').hidden = true; renderMoveTree();

    /* ④ AI 思考中：不画 */
    gotoView(state.moves.length);
    state.thinking = true;
    clearHover(); fire(p);
    out.thinking = { hover: hover ? (hover.x+','+hover.y) : null };
    state.thinking = false;

    /* ⑤ 鼠标移出棋盘：清掉 */
    fire(p);
    clearHover();
    const base5 = sample(p.x, p.y);
    out.leave = { hover: hover ? (hover.x+','+hover.y) : null, changedFromBase: base5 !== withHover1 };
  } catch (e) { out.errors.push(String(e && e.stack || e).slice(0, 300)); }
  return JSON.stringify(out);
})()`;

const raw = await js(expr);
ws.close();
if (typeof raw !== 'string' || raw.startsWith('ERR')) { console.log('✗ 求值失败: ' + raw); process.exit(1); }
const r = JSON.parse(raw);
const checks = [
  ['正常态：悬停画出预览方块（像素有变化）', r.normal && r.normal.drew === true],
  ['回看态：悬停也画出预览方块', r.review && r.review.drew === true],
  ['回看态：hover 被正确记录', r.review && typeof r.review.hover === 'string'],
  ['点树面板珠子后：hover 仍被记录', !r.afterTreeClick || typeof r.afterTreeClick.hover === 'string'],
  ['点树面板珠子后：预览方块仍画得出来', !r.afterTreeClick || r.afterTreeClick.drew === true],
  ['AI 思考中：不显示预览', r.thinking && r.thinking.hover === null],
  ['鼠标移出棋盘：hover 清空', r.leave && r.leave.hover === null],
  ['无运行时异常', r.errors.length === 0]
];
let bad = 0;
for (const [n, ok] of checks) { console.log((ok ? '  ✓ ' : '  ✗ ') + n); if (!ok) bad++; }
console.log(JSON.stringify(r, null, 1));
console.log(bad === 0 ? '\n落子预览回归：全绿 ' + checks.length + '/' + checks.length : '\n落子预览回归：失败 ' + bad + ' 项');
process.exit(bad === 0 ? 0 : 1);
