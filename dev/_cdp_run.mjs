/* 通用：跑指定的注入脚本。用法： node dev/_cdp_run.mjs <注入脚本路径> */
import fs from 'node:fs';

const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const target = process.argv[2] || './_inject_dbg69.js';

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { }
    await sleep(500);
  }
  throw new Error('连不上调试端口 ' + PORT);
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params) => new Promise(res => {
  const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function js(expr) {
  const r = await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) {
    return 'ERR: ' + String(r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 5).join('\n');
  }
  return r.result?.result?.value;
}

const code = fs.readFileSync(new URL(target, import.meta.url), 'utf8');
console.log(await js(code));
ws.close();
process.exit(0);
