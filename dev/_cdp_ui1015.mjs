/* 2026-10-15 第二轮 UI 修补回归：
 *   ① 放大树面板后右键菜单要**真的点得到**（原来被遮罩盖住）—— 用 elementFromPoint 做命中测试；
 *   ② 删除分支要**弹窗确认**（原来只 flash 一句），确认后能删、能撤销；
 *   ③ Delete / 空格 / PageUp 三个快捷键**已删**，按了不该有反应；
 *   ④ 帮助里要有分支树、回看点落子这些新内容，且快捷键表里不能再有「空格 停一手」。
 * 用法：node dev/_cdp_ui1015.mjs [端口]
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
  const wait = ms => new Promise(r => setTimeout(r, ms));
  try {
    const list = await window.api.records.list();
    const names = (list||[]).map(x => (x && x.name) ? x.name : String(x));
    let target = names.find(n => n.indexOf('冲天') >= 0) || names[0];
    await openRecord(target);
    if (state.draft) exitDraft();
    /* 切到树视图并放大 */
    movesView = 'tree';
    $('movelist').hidden = true; $('branch-tree').hidden = false;
    if ($('btn-treezoom')) $('btn-treezoom').hidden = false;
    renderMoveTree();
    setTreeZoom(true);
    await wait(120);
    const caps = [...document.querySelectorAll('#branch-tree .cap')];
    out.caps = caps.length;
    /* 找一颗「有子节点」的珠子（能删的） */
    let target2 = null;
    for (const c of caps) {
      const cell = cellOfCap(c);
      if (cell && cell.node && (cell.node._cs || []).length) { target2 = c; break; }
    }
    out.foundDeletable = !!target2;
    if (!target2) { out.zoom = { note: 'no deletable cap' }; return JSON.stringify(out); }
    const cell2 = cellOfCap(target2);
    const depth = nodeDepth(cell2.node);
    const r2 = target2.getBoundingClientRect();
    out.before = { depth, sub: subtreeSize(cell2.node), moves: state.moves.length, trash: !!branchTrash };

    /* ① 放大态下右键 → 菜单出现且**点得到**（elementFromPoint 命中测试） */
    target2.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r2.left + r2.width / 2), clientY: Math.round(r2.top + r2.height / 2)
    }));
    await wait(60);
    const menu = document.querySelector('.tree-menu');
    out.menuShown = !!menu;
    if (menu) {
      const mr = menu.getBoundingClientRect();
      const cx = Math.round(mr.left + mr.width / 2), cy = Math.round(mr.top + mr.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      out.hit = { inMenu: !!(hit && hit.closest && hit.closest('.tree-menu')), tag: hit ? hit.tagName : null,
                  cls: hit ? String(hit.className).slice(0, 40) : null };
      out.menuZ = getComputedStyle(menu).zIndex;
      out.maskZ = getComputedStyle($('treezoom')).zIndex;
      /* ② 点「删除分支」→ 必须先弹确认窗，且此时还**没删** */
      const btns = [...menu.querySelectorAll('button')];
      out.menuBtns = btns.map(b => b.textContent);
      const delBtn = btns.find(b => b.textContent.indexOf('删除分支') >= 0);
      out.hasDelBtn = !!delBtn;
      if (delBtn) {
        delBtn.click();
        await wait(80);
        const delMask = $('delbranch');
        out.askOpen = !!(delMask && delMask.classList.contains('open'));
        out.askBody = (($('db-body') || {}).textContent || '').slice(0, 120);
        out.stillThereBeforeConfirm = subtreeSize(cell2.node) === out.before.sub && state.moves.length === out.before.moves;
        /* 取消 → 什么都不该发生 */
        if (delMask && $('db-cancel')) $('db-cancel').click();
        await wait(60);
        out.cancelClosed = !!(delMask && !delMask.classList.contains('open'));
        out.afterCancel = { sub: subtreeSize(cell2.node), moves: state.moves.length };
        /* 再来一次，这次确认 */
        target2 = [...document.querySelectorAll('#branch-tree .cap')].find(c => { const q = cellOfCap(c); return q && q.node === cell2.node; });
        if (target2) {
          const rr = target2.getBoundingClientRect();
          target2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
            clientX: Math.round(rr.left + rr.width / 2), clientY: Math.round(rr.top + rr.height / 2) }));
          await wait(60);
          const m2 = document.querySelector('.tree-menu');
          const db2 = m2 && [...m2.querySelectorAll('button')].find(b => b.textContent.indexOf('删除分支') >= 0);
          if (db2) {
            db2.click();
            await wait(80);
            if ($('db-ok')) $('db-ok').click();
            await wait(120);
            out.afterDelete = { trash: !!branchTrash, moves: state.moves.length };
            out.deleted = !!branchTrash;
            /* 撤销 */
            undoDeleteBranch();
            await wait(80);
            out.afterUndo = { trash: !!branchTrash, moves: state.moves.length };
          }
        }
      }
    }
    setTreeZoom(false);

    /* ③ 三个快捷键应当**彻底没反应**。
       ★ 判据用 defaultPrevented 而不是"看状态有没有变" —— 后者会假通过：
         比如当前正处在回看态时，Delete/Space 本来就不会改变任何状态，
         于是"删掉的键"和"还在的键"看起来一模一样（第一版就是这么误判的）。
         处理函数里对认领的键一定会 preventDefault()，所以：
           被删掉的键 → 事件没人 preventDefault → false
           留着的键   → true（这两条是**对照**，用来排除"事件根本没送达"的假阴性） */
    const beforeKeys = { moves: state.moves.length, main: JSON.stringify((branchRoot._cs||[]).map(c => c.x + ',' + c.y)) };
    const fire = (code, key) => {
      const ev = new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    gotoView(state.moves.length);
    out.keys = {
      deletePrevented: fire('Delete', 'Delete'),
      spacePrevented: fire('Space', ' '),
      pageUpPrevented: fire('PageUp', 'PageUp'),
      arrowPrevented: fire('ArrowLeft', 'ArrowLeft'),   // 对照（← 一定认领）
      homePrevented: fire('Home', 'Home'),               // 对照二（Home 也认领）
      movesSame: state.moves.length === beforeKeys.moves,
      mainSame: JSON.stringify((branchRoot._cs||[]).map(c => c.x + ',' + c.y)) === beforeKeys.main
    };

    /* ④ 帮助内容 */
    const helpHTML = document.querySelector('#help .help-body').innerHTML;
    out.help = {
      hasBranchTree: helpHTML.indexOf('分支树') >= 0,
      hasBackLookFork: helpHTML.indexOf('回看点落子') >= 0,
      hasSpaceKey: helpHTML.indexOf('<kbd>空格</kbd>') >= 0,
      hasUndoKey: helpHTML.indexOf('撤销「删除分支」') >= 0 || helpHTML.indexOf('撤销') >= 0,
      hasDelNoKey: helpHTML.indexOf('没有快捷键') >= 0
    };
  } catch (e) { out.errors.push(String(e && e.stack || e).slice(0, 400)); }
  return JSON.stringify(out);
})()`;

const raw = await js(expr);
ws.close();
if (typeof raw !== 'string' || raw.startsWith('ERR')) { console.log('✗ 求值失败: ' + raw); process.exit(1); }
const r = JSON.parse(raw);
const checks = [
  ['① 放大态右键弹出菜单', r.menuShown === true],
  ['① 菜单真在遮罩之上（命中测试落在菜单里）', !!(r.hit && r.hit.inMenu === true)],
  ['① 菜单 z-index 高于遮罩', Number(r.menuZ) > Number(r.maskZ)],
  ['② 点「删除分支」弹出确认窗', r.askOpen === true],
  ['② 确认前**没有**真删', r.stillThereBeforeConfirm === true],
  ['② 取消：什么都不发生', r.cancelClosed === true && r.afterCancel && r.afterCancel.sub === r.before.sub],
  ['② 确认后真删（进回收站）', r.deleted === true],
  ['② 撤销后恢复', r.afterUndo && r.afterUndo.trash === false],
  ['③ Delete 键已解绑（事件不再被认领）', r.keys && r.keys.deletePrevented === false],
  ['③ 空格已解绑', r.keys && r.keys.spacePrevented === false],
  ['③ PageUp 已解绑', r.keys && r.keys.pageUpPrevented === false],
  ['③ 对照：← 仍然认领（证明事件确实送达了）', r.keys && r.keys.arrowPrevented === true],
  ['③ 对照：Home 仍然认领', r.keys && r.keys.homePrevented === true],
  ['③ 按键后棋局没被改动', r.keys && r.keys.movesSame === true && r.keys.mainSame === true],
  ['④ 帮助里有「分支树」', r.help && r.help.hasBranchTree === true],
  ['④ 帮助里有「回看点落子」', r.help && r.help.hasBackLookFork === true],
  ['④ 帮助里没有「空格 停一手」', r.help && r.help.hasSpaceKey === false],
  ['无运行时异常', r.errors.length === 0]
];
let bad = 0;
for (const [n, ok] of checks) { console.log((ok ? '  ✓ ' : '  ✗ ') + n); if (!ok) bad++; }
console.log(JSON.stringify(r, null, 1).slice(0, 2500));
console.log(bad === 0 ? '\nUI 回归：全绿 ' + checks.length + '/' + checks.length : '\nUI 回归：失败 ' + bad + ' 项');
process.exit(bad === 0 ? 0 : 1);
