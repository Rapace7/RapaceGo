/* 只截当前页面，**不改任何状态** —— 给「把某个弹窗弹出来再拍下来」用。
 * 用法：node dev/_shot_now.mjs [输出路径]
 * 与 _cdp_shot.mjs 的区别：那个会先打开一份棋谱、跳手数（为了拍 README 展示图），
 * 会把页面状态搞乱；这个纯粹拍眼前这一帧。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(ROOT, 'dev/_shot_now.png');
const PORT = process.env.SHOT_PORT || 9333;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
if (!page) { console.log('★ 找不到 page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise(r => {
  const i = ++seq;
  pend.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params }));
});

const r = await send('Page.captureScreenshot', { format: 'png' });
if (!r.result || !r.result.data) { console.log('★ 截图失败：' + JSON.stringify(r).slice(0, 200)); process.exit(1); }
fs.writeFileSync(OUT, Buffer.from(r.result.data, 'base64'));
console.log('已保存 ' + OUT);
ws.close();
process.exit(0);
