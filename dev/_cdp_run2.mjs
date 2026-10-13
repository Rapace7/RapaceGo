/* 稳健版注入 runner（2026-10-13 重写）。
 *
 * 用法： node dev/_cdp_run2.mjs ./_inject_xxx.js [端口]
 *
 * 与旧的 _cdp_run.mjs 的差别（旧版在本机 Electron 44 / Chrome 152 上实测失灵）：
 *   ① 不再直连 page 的 webSocketDebuggerUrl —— 实测那条通道 ws 能打开、
 *      浏览器层命令（Browser.getVersion）正常回，但**页面层命令全部沉默**
 *      （Runtime.evaluate / Debugger.enable / Page.captureScreenshot 均超时）。
 *      改成：连 browser 端点 → Target.attachToTarget{flatten:true} → 带 sessionId 求值。
 *   ② 等端口 + 等 page target + 求值重试，每步失败都打印**能定位的原因**，
 *      不再让人对着一个 timeout 猜。
 *   ③ 先探一次 1+1 确认渲染进程活着，再注入正式脚本 —— 避免把「渲染没起来」
 *      误判成「脚本写错了」。
 */
import fs from 'node:fs';

const target = process.argv[2] || './_inject_draft_v1.js';
const PORT = process.argv[3] || 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const die = (msg, code) => { console.log('FAIL: ' + msg); process.exit(code || 1); };

/* ---------- ① 等调试端口 ---------- */
let ver = null;
for (let i = 0; i < 40; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { }
  await sleep(500);
}
if (!ver) die(`端口 ${PORT} 没开 —— 应用没带 --remote-debugging-port 启动，或已经退出。请双击 dev\\_start_cdp.bat 重来。`, 2);

/* ---------- ② 等 page target ---------- */
let page = null;
for (let i = 0; i < 40; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    if (page) break;
  } catch (e) { }
  await sleep(500);
}
if (!page) die('有调试端口但找不到 page target（窗口可能还没建出来）。', 3);

/* ---------- ③ 连 browser 端点，attach 出会话 ---------- */
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
const send = (method, params, sessionId, tmo) => new Promise(res => {
  const i = ++seq;
  const t = setTimeout(() => res({ timeout: true }), tmo || 20000);
  pending.set(i, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
});

const att = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const sid = att.result && att.result.sessionId;
if (!sid) die('attachToTarget 失败：' + JSON.stringify(att).slice(0, 200), 4);

/* ---------- ④ 先确认渲染进程活着 ---------- */
async function ev(expr, tmo) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: (tmo || 60000) - 500 }, sid, tmo);
  if (r.timeout) return { timeout: true };
  if (r.result && r.result.exceptionDetails) {
    return { err: String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').split('\n').slice(0, 6).join('\n') };
  }
  return { value: r.result && r.result.result && r.result.result.value };
}

for (let i = 0; i < 10; i++) {
  const ping = await ev('1+1', 6000);
  if (ping.value === 2) break;
  if (i === 9) die('渲染进程不应答（1+1 都超时）。窗口是空白的吗？'
    + ' 若空白：应用没跑起来，重新双击 dev\\_start_cdp.bat；若已显示界面：可能仍是受限环境启动导致渲染冻结。', 5);
  await sleep(1000);
}

/* ---------- ⑤ 注入正式脚本 ---------- */
const path2 = new URL(target, import.meta.url);
if (!fs.existsSync(path2)) die('找不到注入脚本：' + target, 6);
const code = fs.readFileSync(path2, 'utf8');
const out = await ev(code, 300000);
if (out.timeout) console.log('注入脚本超时（300 秒）');
else if (out.err) console.log('注入脚本报错:\n' + out.err);
else console.log(out.value);
ws.close();
process.exit(0);
