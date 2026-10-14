/* 重新探测：先确认"我在哪个页面"，再看元素到底在不在。
 * 上一次探测的疑点：body 有 80 个子元素（像正常页面），但连 #movelist 都说没有 ——
 * 那更可能是**连错了 target**，而不是 HTML 坏了。 */
(function () {
  const L = [];
  L.push('location = ' + location.href);
  L.push('title    = ' + document.title);
  L.push('readyState = ' + document.readyState);
  L.push('scripts  = ' + [...document.querySelectorAll('script')].map(s => s.getAttribute('src') || '(inline)').join(' , '));
  L.push('--- 元素查找（逐种方式对比）---');
  L.push('  getElementById(movelist)      = ' + document.getElementById('movelist'));
  L.push('  querySelector(#movelist)      = ' + document.querySelector('#movelist'));
  L.push('  querySelector(.movelist)      = ' + document.querySelector('.movelist'));
  L.push('  querySelectorAll(.movelist)   = ' + document.querySelectorAll('.movelist').length);
  L.push('  querySelector(.branch-tree)   = ' + document.querySelector('.branch-tree'));
  L.push('  querySelector(.left)          = ' + document.querySelector('.left'));
  L.push('  querySelector(#topbar)        = ' + document.querySelector('#topbar'));
  L.push('--- body 顶层子元素一览（前 20 个）---');
  L.push('  ' + [...document.body.children].slice(0, 20)
    .map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : (e.className ? '.' + String(e.className).split(' ')[0] : '')))
    .join('  '));
  L.push('--- 有没有 error 痕迹 ---');
  L.push('  window.onerror 装了吗: ' + (typeof window.__errs === 'object'));
  L.push('  __errs = ' + JSON.stringify(window.__errs || null));
  return L.join('\n');
})();
