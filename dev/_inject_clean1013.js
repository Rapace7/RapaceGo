/* 讲解文本清洗：2026-10-13 夜 DSH 补的两条规则的回归。
 * 用法：node dev/_cdp_run2.mjs ./_inject_clean1013.js 9333
 *
 * 起因（看真实 10 手讲解抓到的）：
 *   · 第 1 手正文结尾开了一个「（」没闭合（「（在星位对小目的对局中，…形成均衡局面。」）
 *     —— 读起来像程序漏了字。
 *   · 第 9 手冒出「（开始分析）」「（突然提高声调）」「（总结性地）」这类**舞台说明**，
 *     而 cleanCoachText 的词表里恰好没有这三个词（词表里有「沉思/点头/叹气」那一批）。
 *
 * 判据边界（别改错）：
 *   ★ 正常的**说明性括号必须留着** ——「（白棋第 4 手）」「（也就是三三）」这类是正文的一部分。
 *     这两条新规则只该吃掉"舞台说明"和"残缺括号"，不该碰说明性括号。
 */
(async function () {
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));

  /* 第 1 手那种残缺括号（真实原文，只截了后半段） */
  const A = '这一手 Q16（黑棋第 1 手）下出来，这手是正着。\n'
    + '（在星位对小目的对局中，白棋选择小目是常见的应对，意在确保角地同时向边发展。这种开局形成均衡局面。';
  const a = cleanCoachText(A);
  ok('D1 未闭合的左括号连带其后内容一起删掉', a.indexOf('在星位对小目的对局中') < 0, a.slice(-30));

  /* 第 9 手那种舞台说明 */
  ok('D2 「（开始分析）」被清掉',
    cleanCoachText('黑棋这手D16下在星位，意图很明显。（开始分析）它没有和别的棋子配合。').indexOf('开始分析') < 0);
  ok('D3 「（突然提高声调）」被清掉',
    cleanCoachText('白棋这手棋（突然提高声调）下得不够好。').indexOf('提高声调') < 0);
  ok('D4 「（总结性地）」被清掉',
    cleanCoachText('黑棋这手棋（总结性地）下得不够好。').indexOf('总结性地') < 0);

  /* ★ 反向保护：说明性括号不许被误删 */
  const E = '这一手 E17（白棋第 4 手）下出来，这手不错，它在左上占了个空角。';
  const e = cleanCoachText(E);
  ok('D5 ★ 正常的说明性括号不许被误删', e.indexOf('（白棋第 4 手）') > 0, e);
  ok('D6 正常的「（也就是三三）」也不许被删',
    cleanCoachText('这一手占了三三（也就是三三），很常见。').indexOf('也就是三三') > 0);

  /* ---------- 句子级去重复（首相 2026-10-14 报：第一手讲解一句话重复一二十遍） ---------- */
  const one = '这一手在星位落子，是标准的开局起手。';
  const many = one.repeat(20);
  const fixed = cleanCoachText(many);
  ok('D7 ★ 连刷 20 遍的同一句 → 只留一遍',
    fixed.split('标准的开局起手').length - 1 === 1,
    '留了 ' + (fixed.split('标准的开局起手').length - 1) + ' 遍');

  ok('D8 只有两句的文本不受影响（不可能构成"重复十几遍"）',
    cleanCoachText('黑棋这手不错，占了角。白棋该应了。').indexOf('白棋该应了') > 0);

  /* ★ 反向保护三条：短句、隔开的重复、正常讲解 —— 都不许被动 */
  ok('D9 短句连说两遍不动它（「好棋。」这种本来就可能重复）',
    cleanCoachText('好棋。好棋。').indexOf('好棋。好棋。') === 0);
  ok('D10 中间隔着别的句子的重复不算（只认"连着刷"）',
    cleanCoachText('黑棋这手占了角部实地。白棋应当拆边。黑棋这手占了角部实地。')
      .split('黑棋这手占了角部实地').length - 1 === 2);
  const normal = '这一手 E17（白棋第 4 手）下出来，这手不错，它在左上占了个空角，还和黑棋D14这颗子形成呼应。';
  ok('D11 ★ 正常讲解一字不改', cleanCoachText(normal) === normal, cleanCoachText(normal));

  /* ---------- 流式 vs 定稿：两种清洗必须分开（首相 2026-10-14 报的「疯狂重置」） ----------
     判据就是打字机自己的判据：**新文本必须是旧文本的延长**，否则它会清空重打。
     所以：温和清洗必须全程保持这个性质；完整清洗必然破坏它（所以流式不能用它）。 */
  const full = '这一手 K17（黑棋第 13 手）下出来，这手不行，白棋有好几处便宜可占。'
    + '它左边这块棋还没活干净。让我看看中央那几颗子，黑棋应该先补一手。';
  const steps = [];
  for (let i = 2; i <= full.length; i += 3) steps.push(full.slice(0, i));

  let prev = '', bad = 0, badAt = '';
  for (const s of steps) {
    const cur = cleanCoachTextLive(s);
    if (!cur.startsWith(prev)) { bad++; if (!badAt) badAt = JSON.stringify(cur.slice(0, 24)) + ' ← ' + JSON.stringify(prev.slice(0, 24)); }
    prev = cur;
  }
  ok('D12 ★ 流式用的温和清洗：每一步都是上一步的延长（打字机不会重置）',
    bad === 0, bad ? (bad + ' 次中断，首个：' + badAt) : '');

  let prev2 = '', broke = 0;
  for (const s of steps) {
    const cur = cleanCoachText(s);
    if (!cur.startsWith(prev2)) broke++;
    prev2 = cur;
  }
  ok('D13 对照：完整清洗**会**让文本变短/改写（这正是「疯狂重置」的成因，所以流式期间不能用它）',
    broke > 0, broke + ' 次中断');

  return L.join('\n');
})();
