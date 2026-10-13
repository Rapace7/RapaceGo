/* 给 LoGos 的提示词 —— 结构审查回归（2026-10-14 首相要求「再审查一遍」）。
 * 用法：node dev/_cdp_run2.mjs ./_inject_prompt1014.js 9333
 *
 * 这一轮审出四处，全部钉成断言：
 *   ① 系统提示的**记号说明**必须与正文一致 —— 正文给的是 1/-1/0 矩阵，
 *      而系统提示原来只说 X/O，一个字没提矩阵（它在最前面、先入为主）。
 *   ② **身份不能自相矛盾** —— 系统提示原来自称「专业的围棋棋手」，
 *      与规矩里的「你是旁观的讲棋人，不是对局双方里的任何一方」直接打架。
 *   ③ **不能把要禁的词当例子列给模型** —— 原来逐一点名「（沉思片刻）」「（突然提高声调）」
 *      「（总结性地）」，7B 指令遵循弱、模仿强，越禁越写。
 *   ④ **排版三条规矩**：要求在前、事实紧贴预填句、预填句在最后。
 */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  applyNewGame(); await sleep(220);
  for (const [x, y] of [[3, 15], [15, 3], [3, 3], [15, 15], [2, 13], [16, 9]]) tryPlay(x, y);
  await sleep(180);
  const n = state.moves.length;
  ok('P0 前置：6 手', n === 6, n);

  const at = 3;
  const m = state.moves[at - 1];
  const HEAD = '这一手 ' + toGTP(m.x, m.y) + '（' + (m.color === 'b' ? '黑' : '白') + '棋第 ' + at + ' 手）下出来，这手是正着。';
  const p = coachPromptActual(state.moves.slice(0, at), boardAt(at), m.color, at, m.x, m.y, HEAD, '（语气指示）');

  /* ---------- ① 记号说明必须与正文一致 ---------- */
  ok('P1 ★ 系统提示交代了「矩阵里 1 是黑棋、-1 是白棋、0 是空位」',
    p.indexOf('-1 是白棋') >= 0 && p.indexOf('0 是空位') >= 0, p.slice(0, 150));
  ok('P2 系统提示也交代了记录里的 X/O（两种记号都说明）',
    p.indexOf('X 是黑棋') >= 0 && p.indexOf('O 是白棋') >= 0);

  /* ---------- ② 身份不能自相矛盾 ---------- */
  ok('P3 ★ 系统提示不再自称「专业的围棋棋手」（那是对局者口吻，与"旁观讲棋人"打架）',
    p.indexOf('专业的围棋棋手') < 0, p.slice(0, 80));
  ok('P4 ★ 系统提示写明了「讲棋人…给棋友讲棋」', p.indexOf('讲棋人') >= 0, p.slice(0, 80));

  /* ---------- ③ 不许把要禁的词当例子喂给它 ---------- */
  ok('P5 ★ prompt 里不再出现被点名的舞台说明例子（沉思片刻 / 提高声调 / 总结性地）',
    p.indexOf('沉思片刻') < 0 && p.indexOf('提高声调') < 0 && p.indexOf('总结性地') < 0);
  ok('P6 但抽象要求还在（不要写神态、动作、语气、舞台说明这类表演性描写）',
    p.indexOf('表演性描写') >= 0);

  /* ---------- ④ 排版三条规矩 ---------- */
  /* ⚠️ 定位必须带星号 —— 「核对过的事实」这个词在**规矩里**也被引用了一次
     （「只依据下面「核对过的事实」讲」），不带星号会命中那一处，判据就错位了。 */
  const iFacts = p.indexOf('**核对过的事实**');
  const iHead = p.indexOf(HEAD);
  ok('P7 ★ 事实段到预填句之间**不夹别的要求**（只有事实本身 + 语气指示）',
    iFacts >= 0 && iHead > iFacts
    && p.slice(iFacts, iHead).indexOf('**规矩**') < 0
    && p.slice(iFacts, iHead).indexOf('要讲清三件事') < 0,
    'facts@' + iFacts + ' head@' + iHead + ' 间距=' + (iHead - iFacts));
  ok('P8 ★ 预填句在整段 prompt 的最末尾（模型接着它往下写）',
    iHead >= 0 && (p.length - (iHead + HEAD.length)) < 30,
    '预填句之后还有 ' + (p.length - iHead - HEAD.length) + ' 字');
  ok('P9 要求（要讲清三件事 + 规矩）全排在事实段之前',
    p.indexOf('要讲清三件事') >= 0 && p.indexOf('要讲清三件事') < iFacts
    && p.indexOf('**规矩**') < iFacts);

  /* ---------- ⑤ 事实由程序算好，不靠模型读盘 ---------- */
  ok('P10 事实段含程序算好的「四个角子数」', p.indexOf('四个角') >= 0);
  ok('P11 事实段含程序算好的「挨着谁 / 是不是空」', p.indexOf('四周') >= 0 || p.indexOf('挨着') >= 0 || p.indexOf('没有棋子') >= 0,
    p.slice(iFacts, iFacts + 130));

  /* ---------- ⑥ 版本号 ---------- */
  ok('P12 ★ COACH_VER 升到 10（改了 prompt 必须升，否则老缓存被当成"已讲过"锁死）',
    COACH_VER === 10, String(COACH_VER));

  /* ---------- ⑦ 另一条路径（推荐落点讲解）也吃同一份系统提示 ---------- */
  const p2 = coachPrompt(state.moves.slice(0, 2), boardAt(2), 'w', 'C3');
  ok('P13 推荐落点讲解那条路径也用同一份系统提示（记号/身份一并受益）',
    p2.indexOf('-1 是白棋') >= 0 && p2.indexOf('讲棋人') >= 0, p2.slice(0, 70));
  ok('P14 那条路径仍以**条件句预填**结尾（不能用断言句，否则它把候选当既成事实）',
    /如果[黑白]棋下在\u200b?/.test(p2.replace(/\u200b/g, '')) && p2.trim().endsWith('，'),
    p2.slice(-40));

  applyNewGame(); await sleep(150);
  return L.join('\n');
})();
