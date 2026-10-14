/* 真实打谱谱（分支多）在放大窗里、**默认收起**的样子 —— 2026-10-14 深夜。
 * 首相图一就是"放大窗 + 真实棋谱 + 全展开 → 一屏珠子"，这张是改完之后的同一场景。
 * 用法：node dev/_shot_real_fold.mjs [端口]   输出 dev/_shot_real_fold.png */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.argv[2] || 9555;
const REC = '152724_柯洁_B+R_芈昱廷_2025.11.05_第27届中国围甲联赛第9轮 深圳龙华VS江苏洋河_张香槟＆夏夏＆绝艺解说_.sgf';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl && !/^(edge|devtools|chrome):/.test(x.url));
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

async function ev(expr, tmo) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 60000 }, sid);
  if (r.timeout) return { timeout: true };
  if (r.result && r.result.exceptionDetails) return { err: String(r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 4).join(' | ') };
  return { value: r.result && r.result.result && r.result.result.value };
}

const s = await ev(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try { await openRecord(${JSON.stringify(REC)}); } catch (e) { return 'ERR 打开棋谱: ' + e; }
  await sleep(1200);
  [...document.querySelectorAll('#seg-moves button')].find(b => b.dataset.v === 'tree').click();
  await sleep(400);
  setTreeZoom(true); await sleep(900);
  const box = document.getElementById('branch-tree');
  box.scrollLeft = 0; box.scrollTop = 0; await sleep(300);
  const modal = document.querySelector('#treezoom .modal').getBoundingClientRect();
  /* 顺便数一下：全展开会有多少颗珠子（对照，说明"收起"省了多少） */
  const collapsed = treeCells.length;
  treeExpandAll(true); await sleep(400);
  const expanded = treeCells.length;
  treeExpandAll(false); await sleep(400);
  box.scrollLeft = 0; box.scrollTop = 0; await sleep(300);
  return JSON.stringify({
    rect: { x: Math.floor(modal.x), y: Math.floor(modal.y), width: Math.ceil(modal.width), height: Math.ceil(modal.height) },
    手数: state.moves.length, 收起时珠子: collapsed, 全展开时珠子: expanded, 角标数: document.querySelectorAll('#branch-tree .tf').length,
  });
})()`, 90000);
if (s.err || s.timeout) { console.log('FAIL setup: ' + (s.err || 'timeout')); process.exit(3); }
const info = JSON.parse(s.value);
console.log('真实棋谱 ' + info.手数 + ' 手：默认收起只画 ' + info.收起时珠子 + ' 颗珠子（角标 ' + info.角标数
  + ' 个）；如果全展开要画 ' + info.全展开时珠子 + ' 颗');

let shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...info.rect, scale: 1 } }, sid);
if (!shot.result || !shot.result.data) { console.log('FAIL 截图 ' + JSON.stringify(shot).slice(0, 200)); process.exit(4); }
fs.writeFileSync(path.join(ROOT, 'dev', '_shot_real_fold.png'), Buffer.from(shot.result.data, 'base64'));
console.log('已存 dev/_shot_real_fold.png');
ws.close();
process.exit(0);
