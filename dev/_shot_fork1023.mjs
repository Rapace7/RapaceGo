/* 2026-10-23：首相报的那个场景「看一眼」的截图脚本。
   造一份带变着的 20 手谱 → 回看第 14 手 → 按记录落第 15 手 → 截图。
   期望：棋盘停在第 15 手、底栏 15 / 20、树上面板还在。
   用法：node dev/_shot_fork1023.mjs [输出路径] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;
const OUT = process.argv[2] || path.join(ROOT, 'dev/_trash/_shot_fork1023.png');

let page = null;
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    if (page) break;
  } catch (e) { }
  await new Promise(r => setTimeout(r, 500));
}
if (!page) { console.log('连不上调试端口'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr, tmo) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 60000 });
  if (r.result && r.result.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result && r.result.result && r.result.result.value;
};

const st = await js(`(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /* 先关掉可能残留的遮罩（前一轮测试若有 openRecord 确认窗没关，会压在画面正中） */
  document.querySelectorAll('.modal-mask.open').forEach(m => m.classList.remove('open'));
  const SGF = '(;FF[4]SZ[19]'
    + '(;B[pd];W[dp];B[pq];W[dd];B[qo];W[do];B[pn];W[dn];B[jj];W[qj]'
    + ';B[pj];W[qk];B[ok];W[ql]'
    + '(;B[pl];W[rk];B[ol];W[qm];B[om];W[rn])'
    + '(;B[kk];W[ll])))';
  applyRecord(parseSGF(SGF), 'fork1023.sgf'); await sleep(350);
  const m15 = { x: state.moves[14].x, y: state.moves[14].y };
  gotoView(14); await sleep(120);
  tryPlay(m15.x, m15.y); await sleep(250);
  return { viewAt: state.viewAt, moves: state.moves.length, counter: document.getElementById('counter').textContent,
           max: document.getElementById('slider').max, status: document.getElementById('status').textContent };
})()`);
console.log('场景: ' + JSON.stringify(st));
await new Promise(r => setTimeout(r, 500));

let clip = null;
try {
  const m = await send('Page.getLayoutMetrics', {});
  const css = m.result && (m.result.cssLayoutViewport || m.result.layoutViewport);
  if (css && css.clientWidth) clip = { x: 0, y: 0, width: Math.round(css.clientWidth), height: Math.round(css.clientHeight), scale: 1 };
} catch (e) { }
const shot = await send('Page.captureScreenshot', clip ? { format: 'png', clip, captureBeyondViewport: false } : { format: 'png' });
const b64 = shot.result && shot.result.data;
if (!b64) { console.log('截图失败'); ws.close(); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log('已存 ' + OUT);
ws.close();
process.exit(0);
