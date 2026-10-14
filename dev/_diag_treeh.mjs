/* 量树面板的「可视高度 vs 行数需要的高度」—— 2026-10-14。
 * 目的：判断"分支多的时候下面几行看不见"是不是真的（拿数值说话）。
 * 用法：node dev/_diag_treeh.mjs [端口] */
const PORT = process.argv[2] || 9555;
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl && !x.url.startsWith('edge://'));
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
const send = (method, params, sessionId) => new Promise(res => {
  const i = ++seq; const t = setTimeout(() => res({ timeout: true }), 20000);
  pending.set(i, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
});
const att = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const sid = att.result && att.result.sessionId;
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 20000 }, sid);
  if (r.timeout) return 'TIMEOUT';
  if (r.result && r.result.exceptionDetails) return 'ERR ' + String(r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result && r.result.result && r.result.result.value;
};
console.log(await ev(`(() => {
  const box = document.getElementById('branch-tree');
  if (!box) return '没有 #branch-tree（当前不是树视图？）';
  const cs = getComputedStyle(box);
  const rowH = STP + 12;
  return [
    '可视高 clientHeight = ' + box.clientHeight,
    '内容高 scrollHeight  = ' + box.scrollHeight,
    '珠子直径 STP         = ' + STP,
    '行高(珠+间距) 约     = ' + rowH,
    '当前行数 treeLanes   = ' + treeLanes,
    '要放满所有行需要高   = ' + (treeLanes * rowH),
    '可视行数（能完整看到）= ' + Math.floor(box.clientHeight / rowH),
    '竖直能滚 scrollHeight-clientHeight = ' + (box.scrollHeight - box.clientHeight),
    'CSS height/max-height= ' + cs.height + ' / ' + cs.maxHeight,
    'overflow-y           = ' + cs.overflowY,
    '卡片高 .card         = ' + Math.round(box.closest('.card').getBoundingClientRect().height),
  ].join('\\n');
})()`));
ws.close();
process.exit(0);
