/* 段③ 树面板的截图验收 —— 2026-10-13 千问。
   造一条 60 手长主线 + 一条旁支 → 切到树 → 滚到中段 → 截左栏那块（含滚动条）。
   用法：node dev/_shot_tree.mjs [端口]   输出 dev/_shot_tree.png
   ⚠️ 走 browser 端点 + Target.attachToTarget(flatten)：直连 page 端点在本机不响应。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.argv[2] || 9333;
const OUT = path.join(ROOT, 'dev', '_shot_tree.png');

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
if (!page) { console.log('FAIL: 没有 page target'); process.exit(1); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
const send = (method, params, sessionId) => new Promise(res => {
  const i = ++seq; const t = setTimeout(() => res({ timeout: true }), 30000);
  pending.set(i, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
});
const att = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const sid = att.result && att.result.sessionId;
if (!sid) { console.log('FAIL attach'); process.exit(2); }
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 25000 }, sid);
  if (r.timeout) return { timeout: true };
  if (r.result && r.result.exceptionDetails) return { err: String(r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 4).join(' | ') };
  return { value: r.result && r.result.result && r.result.result.value };
}

const setup = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => { const m = /^([A-HJ-T])(\\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  settings.mode='free'; settings.size=19; settings.handicap=0; settings.rules='chinese';
  applyNewGame(); await sleep(220);
  const pts=['D4','Q16','D16','Q4','C6','E3','F3','C4','E7','R14','P3','O6','N11','M16','L17','K17','J17','H17','G17','F17','E17','D17','C17','B17','A17','A16','A15','A14','A13','A12','B12','C12','D12','E12','F12','G12','H12','J12','K12','L12','M12','N12','O12','P12','Q12','R12','S12','T12','T13','T14'];
  for (const q of pts) { const c=G(q); tryPlay(c.x,c.y); }
  await sleep(200);
  gotoView(30); await sleep(60);
  const bk=G('K10'); tryPlay(bk.x,bk.y); await sleep(120);
  const bk2=G('L10'); tryPlay(bk2.x,bk2.y); await sleep(120);
  [...document.querySelectorAll('#seg-moves button')].find(b=>b.dataset.v==='tree').click();
  await sleep(300);
  /* 造一点涨跌数据（复盘缓存的形态），让胶囊带上色标 —— 这是最宽的情况，最容易重叠 */
  state.history = []; state.leads = []; state.histVisits = [];
  for (let i = 0; i <= state.moves.length; i++) {
    state.history[i] = 0.5 + Math.sin(i / 3) * 0.25;
    state.leads[i] = Math.sin(i / 3) * 12;
    state.histVisits[i] = (settings.visits || 500) + 10;
  }
  renderMoveTree(); await sleep(200);
  const box = document.getElementById('branch-tree');
  box.scrollLeft = 700;                      // 滚到中段：证明能往右移
  await sleep(250);
  const card = box.closest('.card').getBoundingClientRect();
  return JSON.stringify({
    rect: { x: Math.floor(card.x) - 4, y: Math.floor(card.y) - 4, width: Math.ceil(card.width) + 8, height: Math.ceil(card.height) + 8 },
    scrollLeft: Math.round(box.scrollLeft), clientW: box.clientWidth, scrollW: box.scrollWidth,
    可见胶囊: box.querySelectorAll('.cap').length, 布局格数: treeCells.length,
  });
})()`;

const s = await ev(setup);
if (s.err || s.timeout) { console.log('FAIL setup: ' + (s.err || 'timeout')); process.exit(3); }
const info = JSON.parse(s.value);
console.log('滚动: scrollLeft=' + info.scrollLeft + ' / 可视' + info.clientW + ' 内容' + info.scrollW
  + ' | 可见胶囊 ' + info.可见胶囊 + ' / 布局 ' + info.布局格数);

const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...info.rect, scale: 2 } }, sid);
if (!shot.result || !shot.result.data) { console.log('FAIL shot: ' + JSON.stringify(shot).slice(0, 200)); process.exit(4); }
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('已存 ' + OUT);

await ev(`(async () => { applyNewGame(); await new Promise(r=>setTimeout(r,200)); return 1; })()`);
ws.close();
process.exit(0);
