/* 任务 3（棋盘四边坐标）的截图验收 —— 2026-10-13 千问写的。
 * 用法：node dev/_shot_coords.mjs [端口]      默认 9333
 * 输出：dev/_shot_coords.png（只截棋盘那块画布，四边坐标都在里面）
 *
 * 为什么用 attachToTarget 而不是直连 page 端点：本机 Electron 44（Chrome 152）实测
 * 直连页面级命令全部沉默，必须 browser 端点 → Target.attachToTarget{flatten} → 带 sessionId。
 * 注入脚本没有 fs，所以截图这一步放在这里做。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.argv[2] || 9333;
const OUT = path.join(ROOT, 'dev', '_shot_coords.png');

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
if (!page) { console.log('FAIL: 没有 page target（实例起了吗？）'); process.exit(1); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
const send = (method, params, sessionId) => new Promise(res => {
  const i = ++seq;
  const t = setTimeout(() => res({ timeout: true }), 30000);
  pending.set(i, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
});

const att = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const sid = att.result && att.result.sessionId;
if (!sid) { console.log('FAIL attach: ' + JSON.stringify(att).slice(0, 200)); process.exit(2); }

await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 25000 }, sid);
  if (r.timeout) return { timeout: true };
  if (r.result && r.result.exceptionDetails) {
    return { err: String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').split('\n').slice(0, 5).join(' | ') };
  }
  return { value: r.result && r.result.result && r.result.result.value };
}

/* 开一局摆 3 手 → 打开坐标 → 顺手把留白对比数据带回来 → 定好窗口等画稳 */
const setup = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = s => { const m = /^([A-HJ-T])(\\d+)$/.exec(s); return { x: GTP_COLS.indexOf(m[1]), y: 19 - parseInt(m[2], 10) }; };
  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  for (const p of ['D4', 'Q16', 'D16']) { const c = G(p); tryPlay(c.x, c.y); }
  await sleep(150);
  state.showCoords = true; resize(); await sleep(220);
  const padOpen = pad;
  state.showCoords = false; resize(); await sleep(150);
  const padClosed = pad;
  state.showCoords = true; resize(); await sleep(150);
  gotoView(3); await sleep(260);
  const r = document.getElementById('board').getBoundingClientRect();
  return JSON.stringify({
    padOpen: Math.round(padOpen * 10) / 10,
    padClosed: Math.round(padClosed * 10) / 10,
    fontSize: Math.round(Math.max(9, gap * 0.38) * 10) / 10,
    rect: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) },
    dpr: window.devicePixelRatio || 1
  });
})()`;

const s = await ev(setup);
if (s.err || s.timeout) { console.log('FAIL setup: ' + (s.err || 'timeout')); process.exit(3); }
const info = JSON.parse(s.value);
console.log('留白: 开=' + info.padOpen + ' 关=' + info.padClosed + ' 字号=' + info.fontSize
  + '  → ' + (info.padOpen > info.padClosed ? 'OK 开坐标时留白更大' : 'FAIL 留白没跟上'));
console.log('棋盘矩形: ' + JSON.stringify(info.rect));

const clip = { x: info.rect.x, y: info.rect.y, width: info.rect.width, height: info.rect.height, scale: 1 };
const shot = await send('Page.captureScreenshot', { format: 'png', clip }, sid);
if (!shot.result || !shot.result.data) { console.log('FAIL shot: ' + JSON.stringify(shot).slice(0, 200)); process.exit(4); }
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('已存 ' + OUT);

/* 关坐标再截一张 —— 证明「关掉时四边都不显示」（坑位：别和显示菜单那个开关打架） */
const off = await ev(`(async () => { state.showCoords = false; resize(); await new Promise(r => setTimeout(r, 260));
  const r = document.getElementById('board').getBoundingClientRect();
  return JSON.stringify({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });
})()`);
if (off.value) {
  const r2 = JSON.parse(off.value);
  const shot2 = await send('Page.captureScreenshot', { format: 'png', clip: { ...r2, scale: 1 } }, sid);
  if (shot2.result && shot2.result.data) {
    const OUT2 = path.join(ROOT, 'dev', '_shot_coords_off.png');
    fs.writeFileSync(OUT2, Buffer.from(shot2.result.data, 'base64'));
    console.log('已存 ' + OUT2 + '（关坐标的样子）');
  }
}
/* 收尾：把界面清干净，别把测试局面留给下一个接手人 */
await ev(`(async () => { applyNewGame(); await new Promise(r => setTimeout(r, 200)); return 'clean'; })()`);
ws.close();
process.exit(0);
