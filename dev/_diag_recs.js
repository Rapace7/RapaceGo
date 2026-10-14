/* 诊断：哪份棋谱能打开、里面有多少变着（找一份"变着多"的来给树面板拍效果图）。 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  let names = [];
  try { names = await window.api.records.list(); } catch (e) { L.push('list 失败: ' + e); }
  if (!Array.isArray(names)) names = (names && names.list) || [];
  L.push('records 里 ' + names.length + ' 项');
  for (const it of names.slice(0, 40)) {
    const nm = typeof it === 'string' ? it : (it.name || it.file || JSON.stringify(it));
    if (!/\.sgf$/i.test(nm)) continue;
    let r = null;
    try { r = await openRecord(nm); } catch (e) { r = 'ERR ' + e; }
    await sleep(400);
    const rows = new Set(treeCells.map(c => c.row)).size;
    L.push('· ' + nm.slice(0, 46) + '  → ' + (r === undefined ? 'ok' : String(r)).slice(0, 30)
      + '  手数=' + state.moves.length + '  珠子=' + treeCells.length + '  行=' + treeLanes);
  }
  return L.join('\n');
})();
