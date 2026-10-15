/* 对弈学习器 · 棋盘 + 完整对局设置（引擎尚未接入） */

let N = 19;
/*★ **两套坐标字母表，各自独立，绝对不能合并** —— 这是本文件最容易搞错的地方：

   ① `GTP_COLS`（跳 I，A B C D E F G H J K …）：界面显示的坐标、发给引擎的 GTP 坐标。
      围棋传统上跳过 I（I 和 J 形近、也怕和数字 1 混），业界一致。

   ② `SGF_COLS`（**含 i**，a b c d e f g h i j …）：棋谱文件（SGF 格式）的坐标。
      SGF 规范里 a=1 … h=8, **i=9**, j=10 … s=19，**不跳 i**。

   ★ 为什么能确定 SGF 用 i：拿本机 21433 份真实职业棋谱统计过 —— 坐标字母 i 出现
     164101 次（例：`;W[id]` 就是第 9 列），而且第 16 列是 `p` 不是 `q`
     （若跳 i，19 列会排到 q）。两种写法在这些棋谱里都能验出来。
   ★ 曾经踩过的坑：我一度认为"两套表不一致 = bug"，把 SGF 导出也改用 GTP_COLS，
     结果导出的棋谱从第 9 列起全部错位（`[GTP字母+数字]` 这种写法根本不是 SGF）。
     **判断"哪一套对"要看它服务的外部规范，不能只看两套表是否一致。** */
const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';
const SGF_COLS = 'abcdefghijklmnopqrs';
const idx = (x, y) => y * N + x;

const settings = {
  color: 'b',        // 我执：b / w / r(随机)
  size: 19,
  mode: 'play',      // play = 人机对弈（只能下自己那方）；free = 摆棋（两边随便下）
  rules: 'chinese',  // 默认中国规则
  level: 'rank_3d',  // 对手棋力 = KataGo 人类棋风模型的真实段位档位（见 RANKS）
  handicap: 0,
  komi: 7.5,
  clock: 'none',     // 计时档位：none / blitz / rapid / slow / pro / world
  visits: 500,       // 分析搜索量：每个局面让引擎思考多少步（越大越准、越慢）。见 VISIT_OPTS
  /* AI 复盘的搜索量 —— ★ 2026-10-04 用户要求「点 AI 复盘后手动设置，默认 500」：
     刻意**不跟随**底栏的「计算深度」——复盘是整盘逐手算，慢得多，
     值不值得调深应当由用户在点的那一刻决定（会弹面板让他选）。 */
  reviewVisits: 500,
  humanLike: false,  // 拟人落子：按「该段位人类会下哪」的概率抽样，而不是取最优（见 pickAIMove）
};

/* 分析搜索量档位（用户要求可调，并指出「500 和 1600 之间缺得有点多」）。
   ★ 怎么定的：实测（19 路，同一局面重复跑）——
       500 visits → 单次分析约 0.4 秒，首选点与前 4 候选**与 1600 完全一致**（布局、中盘都是）
       1600 visits → 约 0.7 秒；只有**复杂中盘**的首选点会在两三个好点间跳（候选集合仍是同一批）
     所以默认 500，在 500~1600 之间补了 800 / 1200 两档。
   ★ 改档位**立即生效**：maxVisits 是每个分析请求自带的参数，
     改完下一次分析就用新值，**不必重开对局、也不必重启程序**。 */
const VISIT_OPTS = [
  [100, '极快'], [200, '很快'], [300, '快'], [500, '标准'],
  [800, '较深'], [1000, '深'], [1500, '更深'], [2000, '很深'], [3000, '最深'],
];

/* 规则集 —— 贴目默认值与座子按各家规则带出；
   kata 是传给 KataGo 的规则名（2026-10-03 实测确认可用）：
     chinese      AREA 数子 · tax=NONE
     japanese     TERRITORY 数目 · tax=SEKI
     korean       TERRITORY 数目 · tax=SEKI
     ancient-area AREA 数子 · tax=ALL（还棋头）← 明清规则  */
const RULES = {
  chinese:  { label: '中国规则', sgf: 'Chinese',  komi: 7.5, kata: 'chinese',
              seats: false, tax: 'NONE' },
  japanese: { label: '日本规则', sgf: 'Japanese', komi: 6.5, kata: 'japanese',
              seats: false, tax: 'SEKI' },
  korean:   { label: '韩国规则', sgf: 'Korean',   komi: 6.5, kata: 'korean',
              seats: false, tax: 'SEKI' },
  ancient:  { label: '明清规则', sgf: 'Chinese',  komi: 0,   kata: 'ancient-area',
              seats: true,  tax: 'ALL' },
};

/* 座子制（明清规则）：四角星位各一子、**对角同色**。
   古谱白先，摆完座子轮白走。

   ★★ 颜色分配（2026-10-07 规则审查改正，原来**黑白放反了**）：
        **黑子在「右上角 + 左下角」，白子在「左上角 + 右下角」。**
        依据：座子制比赛的通行规则原文 ——
          「开局前预置四枚座子……黑座子放置于右上角和左下角的四四位，白座子依此类推」
        （见 https://www.cczzwq.cn/emlog/?post=11 ；另见维基「座子制」条目）
        原来写成「左上/右下 = 黑」，正好反了 —— 古谱摆出来白黑互换，
        等于这套规则的颜色约定是错的。
   ⚠️ 边界：`mid` 是中央索引（19 路为 9）。星位在 (line,line) 与 (n-1-line,n-1-line) 上，
      所以 (x<mid && y<mid) = 左上、(x>mid && y>mid) = 右下 —— 这两个是**白**。 */
function seatStones(n) {
  const mid = (n - 1) / 2;
  const corners = starPoints(n).filter(([x, y]) => x !== mid && y !== mid);
  return corners.map(([x, y]) => ({
    x, y,
    /* 左上(小,小) 与 右下(大,大) 为白；右上(大,小) 与 左下(小,大) 为黑 */
    color: ((x < mid && y < mid) || (x > mid && y > mid)) ? 'w' : 'b',
  }));
}

const state = {
  moves: [],
  viewAt: 0,
  toMove: 'b',
  /* ★ 这份棋是「打开棋谱」来的（＝打谱）—— 选点讲解对它禁用：
     那是别人的棋，不该替人支招。由 applyRecord 置真、applyNewGame 清掉。 */
  fromRecord: false,
  /* ★ 当前打开的棋谱文件名（含 .sgf）—— 全盘讲解要**存回这份棋谱名下**
     （存成 <棋谱名>.coach.json，见 main.js 的 coachPath）。
     新对局时清空：没有棋谱就没地方存。 */
  recName: '',
  /* 棋谱自带的解说词（SGF 的 C[]，只取主分支）：下标 = 第几手（0 = 开局前）。
     只在「打谱」（state.fromRecord）时有内容；新开局的棋谱没有解说词。 */
  sgfComments: [],
  /* 棋谱根节点的说明文字（题集出处、这是第几图、谁整理的），**不属于任何一手**。
     ★ 为什么单独一个字段：原来它和「第 0 手」共用 comments[0] 这个键，
       而根节点后面通常还跟着 `;B[xx]` 那一手（它的键也是 0）→ 后者把前者覆盖掉，
       于是这段说明整段读不出来（实测抽样 300 份真实棋谱：18 份的根节点说明就是这么丢的，
       而在被 tokenizer 劈错的文件里丢得更彻底）。
     ★ 显示位置：右下角「解说词」框在「（开局前）」那一档里显示它 ——
       不另开一块界面（用户定的：软件不做做题功能，也不必多一张卡）。 */
  rootComment: '',
  /* 这份棋谱里「换了一道题」的位置（手数）。SGF 的题集用 `zz` 分隔，
     抽样 3000 份真实棋谱：2.97% 的文件含它。只有一条的显示提示，两条以上才有意义。 */
  quizTips: [],
  /* ★ 两条讲解的「存法」不一样（2026-10-05 用户定的）：
       · 分析讲解 explain[at] —— **跟手数走**：点评第 at 手，切到哪手就看哪手。
         之前只存最后一次，所以「讲完第 2 手点回第 1 手，框里还挂着第 2 手的内容」。
       · 选点讲解 pick —— **不跟手数走**：它是「此刻该走哪」的一张快照，
         点完就想留着看，切手数不该把它弄没（用户原话：就显示刚才讲解的就行）。
         所以只存一份，并记下它对应第几手 —— 显示时标出来，免得和眼前的局面混淆。
       · busy.x —— 正在生成的那一手（-1 = 空闲），避免刷新时把打字机的内容抹掉。 */
  coach: { explain: {}, pick: null, busy: { explain: -1, pick: -1 },
           /* 全盘讲解进行中时是 { done, total }（否则 null）——
              用来① 挡住重复点击 ② 决定按钮是否可点。见 runBatchCoach。 */
           batch: null },
  /* ★ 未开局（2026-10-04 用户要求）：软件打开时**不直接进对局**，而是停在
     一个「什么都还没定」的中性状态 ——
       · 棋盘点不动（tryPlay 直接挡掉）
       · 胜率条停在中性（五五开、不发分析请求，所以也不跳）
       · 对局信息四项全显示「未定」
       · 棋盘中央一个大胶囊按钮，引导去新建对局
     退出这个状态的只有两条路：点「新对局 → 开始」（applyNewGame），
     或打开一份棋谱（applyRecord，它会切摆棋模式）。 */
  noGame: true,
  showHints: (() => { try { return localStorage.getItem('rapacego.showHints') === 'true'; } catch { return false; } })(), // 首次默认关，之后沿用用户选择
  showCoords: false, // 棋盘边缘显示 A–T / 1–19（默认关）
  soundOn: true,     // 落子音效（默认开）
  clock: { on: false },   // 对局计时（applyNewGame 里按 settings.clock 填充）
  candidates: [],
  candAt: -1,        // 上面这批候选点是「第几手」算出来的（≠ viewAt 时说明还没跟上，画淡一点）
  ownership: null,   // 形势数据：长度 N*N，每点 -1~+1（正=黑倾向/负=白倾向/绝对值=归属强度）
  ownAt: -1,         // 这批 ownership 是第几手的
  showTerritory: false,  // 形势显示总开关（默认关；底栏「形势」，快捷键 X）
  terrStyle: 'fog',      // 形势画法：'fog' 雾（+死子变淡） / 'blocks' 方块
  showNums: false,       // 盘上显示手数（底栏「手数」，快捷键 M）
  rootVisits: 0,         // 最近一次分析的搜索量（「计算中… 320」那个数字）
  /* ★ 每一手那个胜率是「用多少搜索量算出来的」（history 的伴随数组，索引对齐）。
     2026-10-06 晚新增，为了治「手数后面的涨跌数字会自己跳」。
     来龙去脉：引擎每 0.25 秒推一次**中间报告**，每份报告都会写一次 history ——
     于是同一手会被写十几遍，而列表读的是**最后一次**的值（= 搜索量最大的那次）。
     实测（_cdp_jump.mjs，连落 6 手）：同一手被写 4~14 次，首次写入只有 150 访问量、
     末次 515；胜率极差最大到 **8.06%**（27.7% → 19.7% → 32.9%）。
     用户看到的正是「下完显示亏，过会儿点回去看又不亏了」。
     有了它就能判断「新结果是不是比已有的更可信」，见 rememberEval。 */
  histVisits: [],
  showPV: false,         // 变化图：鼠标停在推荐点上满 1 秒 → 显示后续变化（底栏「变化图」，快捷键 B）
  pv: null,              // 当前正在显示的变化：{ x, y, list: ['Q16','D4',...] }；null = 不显示
  setup: [],         // 让子 / 座子
  myColor: 'b',
  /* 双方名字 —— 右侧 ID 栏显示、导出棋谱时写进 SGF 的 PB / PW。
     '' = 没设过 → 按模式回落到 PLAYER / KATAGO / PLAYER1 / PLAYER2。
     打开棋谱时用棋谱里的 PB/PW 填进来，用户也可以点着名字直接改。 */
  names: { b: '', w: '' },
  thinking: false,   // AI 思考中 → 不显示落子预览方块
  koPoint: null,     // 打劫禁着点（简单劫）
  /* 逐手评估数据（走势曲线用）—— **两条都存**，因为曲线有两种纵轴（用户要的切换）：
       history[n] = 第 n 手之后的黑方胜率（0..1）
       leads[n]   = 第 n 手之后的黑方领先目数（正 = 黑优）
     ★ 视角固定成**黑方**：引擎给的原始值是「轮到走棋那一方」的，
       照那个画每落一手曲线就要翻一次，没法看；统一成黑方才能连成一条线。 */
  history: [],
  leads: [],
  histVisits: [],        // 每一手胜率的「精度」伴随数组（见 state.histVisits 的注释）
  curveMode: 'win',  // 走势图纵轴：'win' 黑方胜率 / 'lead' 黑方领先目数
  treeNum: true,     // 段③ 树面板：珠心印不印手数（默认开）。坐标与胜率增减在悬停浮层，不受它影响
  draft: null,       // 试下（打草稿）：null = 不在试下；否则见 enterDraft()
  result: null,      // 终局结果 { winner, lead, unit, resign, by, terminal }；null = 尚未结束
  lastEval: null,    // 最近一次分析的 { blackWin, lead } —— AI 判断要不要认输要用
  /* AI 复盘结果（整盘逐手重算后填）：
     { losses: [每手目损], stats: {...}, name: 棋谱文件名, at: 手数 }
     null = 当前局面没有复盘数据（手数列表/走势图就不画目损） */
  review: null,
};

let hover = null;    // 鼠标悬停的交叉点 {x, y}
let pvTimer = null;  // 「悬停满 1 秒才显示变化图」的定时器

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let px = 600, pad = 22, gap = 31;

/* ---------------- 星位与让子 ---------------- */

function starPoints(n) {
  if (n === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
  if (n === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
  return [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]];
}

/* 让子位置（2–9 子）。星位按棋盘路数算：
   19 / 13 路星位在第 4 线（索引 3 / n-4），9 路在第 3 线（索引 2 / n-3）—— 原来写死 e-3，
   在 9 路盘上会摆到错误的位置。 */
function handicapStones(n, count) {
  const line = n >= 13 ? 3 : 2;          // 距边的路数（索引）
  const a = line;                        // 近边
  const b = n - 1 - line;                // 远边
  const m = Math.floor(n / 2);           // 边星 / 天元
  const P = {
    ne: [b, a], nw: [a, a],          // 右上、左上
    sw: [a, b], se: [b, b],          // 左下、右下
    mid: [m, m],                     // 天元
    w: [a, m], e: [b, m],            // 左边星、右边星
    n: [m, a], s: [m, b],            // 上边星、下边星
  };
  const map = {
    2: ['ne', 'sw'],
    /* ★ 让 3 子的第三子放**右上（se）**，不是左上（nw）—— 2026-10-07 规则审查改正。
       通行摆法（也见 KataGo 的 `place_free_handicap 3` 输出 `Q16 D4 Q4`）是：
         二子：右下(ne) + 左下(sw)          ← 对角
         三子：再加**右下方的对角那颗的右上角**？不 —— 是加**右下角(se, 即 Q4)**。
       也就是三子占据「左下、右下、右上」三个角，**左上留空**。
       原来写成 'nw'（左上），于是三子局变成了"左上+左下+右下" —— 与通行摆法差一个角。
       （2/4~9 子都是对的，只有 3 子这一档错；实测对照见 dev/_hc_check.mjs。） */
    3: ['ne', 'sw', 'se'],
    4: ['ne', 'sw', 'nw', 'se'],
    5: ['ne', 'sw', 'nw', 'se', 'mid'],
    6: ['ne', 'sw', 'nw', 'se', 'w', 'e'],              // 四角 + 左右边星
    7: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'mid'],
    8: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'n', 's'],    // 四角 + 四边星
    9: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'n', 's', 'mid'],
  };
  return (map[count] || []).map(k => ({ x: P[k][0], y: P[k][1], color: 'b' }));
}

/* ---------------- 绘制 ---------------- */

/* 候选点配色：颜色代表次序（一选最显眼）
   注意：原来的「绿 + 黄」在木色棋盘上几乎分不出来（实测截图里连开发者自己都会认反），
   所以第三个改成偏橙的琥珀色 —— 四色的 R/G/B 分布拉得很开，一眼能分。 */
const HINT_COLORS = [
  { line: '33,113,214',  text: '#0f4f96', name: '蓝' },   // 第一选
  { line: '28,158,102',  text: '#12694a', name: '绿' },   // 第二选
  { line: '225,150,15',  text: '#8a5a00', name: '琥珀' }, // 第三选
  { line: '216,72,60',   text: '#8c2a20', name: '红' },   // 第四选
];

function resize() {
  const wrap = canvas.parentElement;
  const size = Math.max(300, Math.min(wrap.clientWidth, wrap.clientHeight) - 6);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  px = size;
  /* 留白要放得下坐标：开坐标时边距给大一些，否则字母/数字会压到棋盘外。
     ★ 0.056 → 0.062（2026-10-13 任务 3）：四边都画字后，上下左右占用相同，但小窗口时
       字号被 Math.max(9,…) 抬到 9px，两边留 0.056 时顶边文字会贴画布边 —— 实测截图后定的值。 */
  pad = size * (state.showCoords ? 0.062 : 0.037);
  gap = (size - pad * 2) / (N - 1);
  draw();
  renderCurve();     // 曲线 canvas 宽度跟着窗口变
}

const pxOf = (x, y) => [pad + x * gap, pad + y * gap];

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStone(cx, cy, color, radius) {
  const r = radius || gap * 0.455;
  ctx.save();
  ctx.shadowColor = 'rgba(80,60,20,.28)';
  ctx.shadowBlur = gap * 0.14;
  ctx.shadowOffsetY = gap * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 7);
  const sg = ctx.createRadialGradient(cx - r * .35, cy - r * .35, r * .1, cx, cy, r);
  if (color === 'b') { sg.addColorStop(0, '#5a5a58'); sg.addColorStop(1, '#1b1b1a'); }
  else { sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#e2e0da'); }
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.restore();
  if (color === 'w') {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
    ctx.strokeStyle = 'rgba(140,135,125,.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function draw() {
  const b = boardAt(state.viewAt);
  ctx.clearRect(0, 0, px, px);

  // 棋盘底
  const g = ctx.createLinearGradient(0, 0, px, px);
  /* 2026-10-04：底色由浅米黄 #f2dfba/#e9d3a8 调深为「中深」档（用户拍板）。
     起因见下方形势雾注释：**底色越亮，白雾能推的蓝通道幅度越小**
     （实测白雾色差 浅底 64 → 中深 105）。棋盘线/星位已连带加深，见下。 */
  g.addColorStop(0, '#dfc48f');
  g.addColorStop(1, '#d4b47c');
  ctx.fillStyle = g;
  roundRect(0, 0, px, px, 6);
  ctx.fill();

  // 网格
  /* 网格线随底色加深：旧的 #b08d5b 在中深底上色差只有 76（浅底时是 130），会糊掉；
     #8a6a3a 在同样底色上是 137，比原来还清楚一点。 */
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = Math.max(0.8, px / 900);
  for (let i = 0; i < N; i++) {
    const p = pad + i * gap;
    ctx.beginPath(); ctx.moveTo(pad, p); ctx.lineTo(px - pad, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, pad); ctx.lineTo(p, px - pad); ctx.stroke();
  }

  // 星位
  ctx.fillStyle = '#8a6a3a';          // 星位，与网格线同色
  for (const [sx, sy] of starPoints(N)) {
    const [cx, cy] = pxOf(sx, sy);
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, gap * 0.075), 0, 7); ctx.fill();
  }

  /* 棋盘坐标（可开关）：底边 A–T、���边 1–N 从下往上数。
     ★ 用 GTP_COLS 而不是另写一份字母表 —— 之前这里、toGTP、SGF 导出各有一份，
       三份表一旦改了一处忘了另一处，坐标就会错位（真发生过，见第 4 行注释）。 */
  if (state.showCoords) {
    const cols = GTP_COLS;
    ctx.fillStyle = 'rgba(122,94,58,.74)';
    ctx.font = `${Math.max(9, gap * 0.38).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /* ★ 四边都画（2026-10-13 任务 3，首相原话「只有两条边不方便，要做成四边都有」）：
       上下 = 列字母，左右 = 行数字（从下往上数，围棋惯例）。 */
    for (let i = 0; i < N; i++) {
      ctx.fillText(cols[i], pad + i * gap, pad - gap * 0.56);            // 顶边字母
      ctx.fillText(cols[i], pad + i * gap, px - pad + gap * 0.56);       // 底边字母
      ctx.fillText(String(N - i), pad - gap * 0.56, pad + i * gap);      // 左边数字
      ctx.fillText(String(N - i), px - pad + gap * 0.56, pad + i * gap); // 右边数字
    }
  }

  /* 形势雾（画在棋盘线之上、棋子之下） */
  drawTerritory();

  /* 候选点：虚线圆 + 半透明，颜色代表次序（蓝=一选，绿/琥珀/红依次）
     数字带一位小数，按半径算字号并用 measureText 兜底，保证不越出虚线圆
     ⚠️ 人机对弈时只在「轮到我方」才画 —— 否则你一落子、AI 还没走，
        屏幕上会冒出「对手该怎么下」的点，对你没用、看着还像出错。摆棋模式则一直显示。 */
  /* ★ 只画「跟当前局面匹配」的那一批（candAt === viewAt）。
     过期的候选点（上一个局面算的）**一律不画** —— 它们的位置在当前局面上已经没有意义，
     画出来只会让人困惑。之前这里做的是「淡着显示旧的」当过渡，被用户否掉了：
     「KaTrain 就没有这个，所有选点都是一下就算好的」（2026-10-04）。
     代价是换局面后有一段约 1~2 秒的空白 —— 用下面那句「计算中…」补上反馈。 */
  const hintsFresh = state.candAt === state.viewAt;
  const hintsVisible = state.showHints && hintsFresh
    && (settings.mode !== 'play' || isMyTurn());
  if (hintsVisible && state.candidates.length) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    state.candidates.forEach((c, i) => {
      const [cx, cy] = pxOf(c.x, c.y);
      if (b[idx(c.x, c.y)] !== 0) return;

      const col = HINT_COLORS[Math.min(i, HINT_COLORS.length - 1)];
      const r = gap * 0.44;

      ctx.beginPath();                                   // 极淡底色，帮数字压住木纹
      ctx.arc(cx, cy, r, 0, 7);
      ctx.fillStyle = `rgba(${col.line},0.13)`;
      ctx.fill();

      ctx.setLineDash([gap * 0.11, gap * 0.075]);        // 虚线圆
      ctx.lineWidth = Math.max(1.2, gap * 0.055);
      ctx.strokeStyle = `rgba(${col.line},0.9)`;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      ctx.setLineDash([]);                               // 用完立刻复位，否则会影响别的描边

      /* 数字必须完整落在虚线圆内：上限取「直径的 72%」（左右各留 14% 余量），
         起始字号也压到半径的 0.74 —— 之前 0.82 / 上限 86% 时，四位数字会顶到虚线上。 */
      let fs = Math.max(8, r * 0.74);
      ctx.font = `bold ${fs.toFixed(1)}px "Microsoft YaHei", sans-serif`;
      while (ctx.measureText(c.label).width > r * 1.44 && fs > 7) {
        fs -= 0.5;
        ctx.font = `bold ${fs.toFixed(1)}px "Microsoft YaHei", sans-serif`;
      }
      ctx.fillStyle = col.text;
      ctx.fillText(c.label, cx, cy + fs * 0.03);
    });
    ctx.globalAlpha = 1;          // 立刻复位，别影响后面画的元素
  }

  /* 「计算中… 320」—— 局面换了、新候选点还没补满时的反馈。
     带上搜索量：一眼看出「在算、而且数字在涨」（KaTrain 的选点圈里也是这个意思）。
     没有它，那段时间容易被当成「推荐点坏了」（这是之前用户报过的现象）。
     放在棋盘最上沿，不挡棋子。仅在「在看最新局面」时显示（回看历史时不必提示）。
     判据全在 `shouldShowComputing()` 里（抽出去是为了能单测，见那个函数的注释）。 */
  if (shouldShowComputing()) {
    ctx.fillStyle = 'rgba(38, 30, 18, .42)';
    ctx.font = `${Math.max(10, gap * 0.40).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(state.rootVisits > 0 ? ('计算中… ' + state.rootVisits) : '计算中…',
      px / 2, Math.max(2, pad - gap * 0.9));
  }

  /* 变化图（悬停推荐点满 1 秒后显示）—— 判定条件统一放在 pvVisible() 里 */
  if (pvVisible()) drawPV();

  /* 棋子 —— 一律按 boardAt() 的结果画（含让子），不能按手顺画：
     手顺里被提掉的子仍在 moves 中，照手顺画会把死子留在盘上。
     让子/座子也已并入 boardAt（它先摆 setup 再重放手顺），不重复绘制。 */
  /* 手数（可选）：先算出每个交叉点上的子是第几手落的。
     只数到 viewAt（回看时手数跟着回看位置走）；同一位置后下的会覆盖前面的值。 */
  const nums = state.showNums ? (() => {
    const m = new Map();
    for (let k = 0; k < state.viewAt; k++) {
      const mv = state.moves[k];
      if (!mv || mv.pass) continue;
      m.set(idx(mv.x, mv.y), k + 1);
    }
    return m;
  })() : null;

  for (let i = 0; i < N * N; i++) {
    if (b[i] === 0) continue;
    const sx = i % N, sy = (i / N) | 0;
    const [cx, cy] = pxOf(sx, sy);
    ctx.globalAlpha = stoneAlphaAt(sx, sy, b[i]);   // 死子变淡（形势雾）
    drawStone(cx, cy, b[i] === 1 ? 'b' : 'w');
    ctx.globalAlpha = 1;

    /* 盘上手数：**只写小数字，不画圆底**（原来画了个大圆，太抢眼）。
       颜色用**棋盘线的深棕** —— 用户要求「双方一个颜色」，黑白子共用一个色看着统一。
       注：不用棋盘底色的浅棕，那个在白子上几乎看不清（实测色差只有 80；深棕是 140/240）。 */
    if (nums) {
      const n = nums.get(i);
      if (n) {
        const s = String(n);
        const k = s.length >= 3 ? 0.27 : s.length === 2 ? 0.33 : 0.38;
        ctx.fillStyle = '#8a6a3a';
        ctx.font = `${Math.max(7.5, gap * k).toFixed(1)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s, cx, cy + gap * 0.015);
      }
    }
  }

  /* 最后一手标记 —— 野狐风格：棋子**右下角**的直角三角形
     · 直角顶点朝圆心（但**不侵入中心的手数数字** —— 数字高度约 ±0.12gap，所以顶点取 0.13gap）
     · 两个锐角正好落在棋子的**圆周**上（一个在右、一个在下）
     · 斜边朝右下，整个三角形都在棋子内部的右下方
     为什么不画在正中心：那会和手数数字重叠（用户原话「挡住手数了」）。
     几何：直角顶点 A(cx+a, cy+a)，两个锐角 B(cx+e, cy+a) / C(cx+a, cy+e)，
           e = √(R²−a²) 保证 B、C 恰好贴在圆边。 */
  if (state.viewAt > 0) {
    const m = state.moves[state.viewAt - 1];
    const bi = m ? idx(m.x, m.y) : -1;
    if (m && !m.pass && bi >= 0 && b[bi] !== 0) {
      const [cx, cy] = pxOf(m.x, m.y);
      const R = gap * 0.455;                             // 棋子半径（与 drawStone 一致）
      const a = gap * 0.13;                              // 直角顶点到圆心的横/纵距离
      const e = Math.sqrt(Math.max(0, R * R - a * a));   // 锐角在圆周上的另一坐标
      ctx.beginPath();
      ctx.moveTo(cx + a, cy + a);                        // 直角顶点（朝圆心）
      ctx.lineTo(cx + e, cy + a);                        // 锐角①：向右，落在圆边
      ctx.lineTo(cx + a, cy + e);                        // 锐角②：向下，落在圆边
      ctx.closePath();
      ctx.fillStyle = b[bi] === 1 ? '#e8574a' : '#c0392b';
      ctx.fill();
    }
  }

  // 落子预览小方块：悬停空点、AI 没在思考时显示
  if (hover && !state.thinking && b[idx(hover.x, hover.y)] === 0) {
    const [hx, hy] = pxOf(hover.x, hover.y);
    const side = gap * 0.46, half = side / 2, rr = gap * 0.08;
    const isBlack = state.toMove === 'b';
    /* ★ 2026-10-15：**回看中也画**，但压到 45% 透明度、并且一律描边 ——
       点下去是从这里**开新分支**（不是接着往下走），跟正常落子区分开。
       原来这里是"回看中整个不画"，首相看到的就是"预览方块没了"，见 mousemove 里的注释。 */
    const 回看中 = state.viewAt !== state.moves.length;
    ctx.globalAlpha = (isBlack ? 0.58 : 0.80) * (回看中 ? 0.45 : 1);
    ctx.fillStyle = isBlack ? '#1b1b1a' : '#ffffff';
    roundRect(hx - half, hy - half, side, side, rr);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!isBlack || 回看中) {
      ctx.strokeStyle = 'rgba(120,115,105,.6)';
      ctx.lineWidth = 1;
      roundRect(hx - half, hy - half, side, side, rr);
      ctx.stroke();
    }
  }
}

/* ---------------- 规则 ---------------- */

function neighbors(x, y) {
  const out = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < N - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < N - 1) out.push([x, y + 1]);
  return out;
}

function group(b, x, y) {
  const color = b[idx(x, y)];
  const seen = new Set();
  const stack = [[x, y]];
  const stones = [];
  const libs = new Set();
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const k = idx(cx, cy);
    if (seen.has(k)) continue;
    seen.add(k);
    stones.push(k);
    for (const [nx, ny] of neighbors(cx, cy)) {
      const nk = idx(nx, ny);
      if (b[nk] === color) { if (!seen.has(nk)) stack.push([nx, ny]); }
      else if (b[nk] === 0) libs.add(nk);
    }
  }
  return { stones, libs };
}

function boardAt(n) {
  const b = new Int8Array(N * N);
  for (const s of state.setup) b[idx(s.x, s.y)] = s.color === 'b' ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const m = state.moves[i];
    if (m.pass) continue;
    const c = m.color === 'b' ? 1 : 2;
    b[idx(m.x, m.y)] = c;
    for (const [nx, ny] of neighbors(m.x, m.y)) {
      if (b[idx(nx, ny)] === 3 - c) {
        const gp = group(b, nx, ny);
        if (gp.libs.size === 0) gp.stones.forEach(k => { b[k] = 0; });
      }
    }
  }
  return b;
}

/* ---------------- 手数分支（真分支树，2026-10-13 首相指定） ----------------
 *
 * 数据模型（**就地复用 move 对象**，不新建一套平行的数据结构）：
 *   `state.moves` 里的每个 move 对象加三个下划线字段：
 *     `_p`  父节点引用（根节点的父 = 虚拟根 branchRoot）
 *     `_cs` 子节点数组，**`_cs[0]` = 主线**（提升主变 = 把某个 child 挪到 [0]，重排即完成）
 *     `_ex` 这个节点的逐手讲解寄存处（它不在当前路径上时，讲解寄在这里）
 *   虚拟根 `branchRoot` 让「第 0 手就分叉」（空盘换第一手）也有挂靠点。
 *
 * 为什么这么省：`state.moves` 的语义收窄为「根 → 当前节点的路径」，
 * 于是 `boardAt(n)` / `viewAt` / `state.moves[i]` 那 136+ 处调用点**一行都不用改**。
 * 下划线开头的字段不会进 SGF、不会被深拷贝（全项目只有 clock 做 JSON 深拷贝，已核）。
 *
 * 分支怎么产生（决策 9）：在非末端位置落子，且与已有旁支不同着 → 自动开新分支；
 * 与已有旁支同着 → 跳到那个节点，不建重复。
 *
 * ★ 本段（第一步）**已知的限制**，下一步再做：
 *   ① 评估缓存（history / leads / histVisits）切换分支时**不保留** → 切过去要重算。
 *      讲解（explain）**保留**（寄存在节点 _ex 上）。差别的理由：讲解是花钱让 LLM 生成的、
 *      重讲要几分钟；评估是引擎随手算的，重算几秒。等缓存换成按节点 id 存（方案文档段②第 2 条）再统一。
 *   ② SGF 仍只读写**当前这条路径**（导出 = 你现在看到的这条线）。完整变着读写是下一步。
 *   ③ 手数列表仍按「当前路径」编号（12a 式后缀显示是下一步）。
 */

let branchRoot = null;      // 虚拟根（空盘也有一棵树的定点）

/* 懒建树：把 state.moves 串成节点链。**幂等**，已串过的节点直接跳过。
   （打开棋谱 / 新对局重建 moves 之后要把 branchRoot 置 null，见 applyNewGame / applyRecord） */
function ensureBranch() {
  if (!branchRoot) branchRoot = { _p: null, _cs: [], _virtual: true, x: -1, y: -1, color: null };
  const last = state.moves[state.moves.length - 1];
  /* 快速路径：末端节点已串过 ⇒ 整条路都串过（循环是顺序串的）。
     试下期间不走快速路径 —— 那时末端是草稿手，它的 `_cs` 是空的保险字段，
     不代表正式段已串好（虽然实际总是串好了，但不值得赌这一条）。 */
  if (!last || (last._cs && !state.draft)) return branchRoot;
  let prev = branchRoot;
  /* ★★ 段②（2026-10-13）：**试下（草稿）的手不进树** —— 串到草稿起点就停。
     为什么：草稿是"随手摆摆"，退出试下时 exitDraft 只把 `state.moves` 整体换回快照，
     而 `_cs` 里挂着的草稿手不会自己消失 → 分叉点会多出一条"幽灵旁支"，
     ↑/↓ 能切到一条已经不存在的线，还会连带把手数列表的 ⑂ 标记一起骗了。 */
  const upto = state.draft ? state.draft.from : state.moves.length;
  for (let i = 0; i < upto; i++) {
    const m = state.moves[i];
    if (!m._p) { m._p = prev; if (!m._cs) m._cs = []; if (prev._cs.indexOf(m) < 0) prev._cs.push(m); }
    prev = m;
  }
  return branchRoot;
}

/* 从节点回溯到根 → 路径数组（**不含**虚拟根） */
function pathFromRoot(node) {
  const p = [];
  let n = node;
  while (n && !n._virtual) { p.unshift(n); n = n._p; }
  return p;
}

/* 从根经过 node 的路径，**再沿 _cs[0] 一路走到底** —— 切分支时用：
   切过去要直接看到这条支走到哪里，而不是停在分叉出来的那一手上。
   ⚠️ 不能只用 pathFromRoot（它到 node 就停，target 后面还有子的话会把路径拼短/拼错，
      实测踩到：切到旧分支后 moves 变成 11 手 —— 前 5 手被重复算了一次）。 */
function pathThrough(node) {
  const p = pathFromRoot(node);
  let cur = node;
  while (cur && cur._cs && cur._cs.length) { cur = cur._cs[0]; p.push(cur); }
  return p;
}

/* ---------------- 主线内容指纹（坑位 42 的根治，2026-10-13 首相拍板方案 A） ----------------
   要做的事：`.review.json`（复盘）与 `.coach.json`（逐手讲解）都是**按手号**存的附属文件，
   而「覆盖」按钮能把一份棋谱换成另一盘、这两个文件却原地不动。
   只核对长度 → 拦得住"手数变了"，拦不住"手数没变、只换了某一手的内容"（那种会静静挂错数字）。
   所以附属文件里存一个**主线手顺指纹**：读取时比一下，对不上就当没有并如实说一声。
   口径：
     · 只算**主变链**（沿每层 `_cs[0]` 走到底）—— 旁支本来就不参与按手号存的缓存；
     · 停一手记 `pa`，落子记 `Bpd` 这种 SGF 双字母（与棋谱文本同源，不受界面坐标系影响）；
     · djb2 一遍哈希 + 原文长度一起存（`xxxx-1234`），碰撞概率对"这一盘棋"的量级足够。
   ⚠️ 别把指纹做成"对当前路径哈希"：用户在旁支上时当前路径变了，指纹会变 —— 那就等于
      每次切分支都把好好的复盘数据判成无效。所以这里**坚持从 branchRoot 走 `_cs[0]`**。 */
function mainlineSig() {
  ensureBranch();
  let s = 'n' + N, cur = branchRoot;
  while (cur && cur._cs && cur._cs.length) {
    cur = cur._cs[0];
    s += cur.pass ? ';pa' : ';' + (cur.color === 'b' ? 'B' : 'W') + SGF_COLS[cur.x] + SGF_COLS[cur.y];
  }
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;   // djb2（xor 变体）
  return (h >>> 0).toString(36) + '-' + s.length;
}

/* 第 at 手（1 起）在树里的父节点 —— at=0 时就是虚拟根。
   ★ 2026-10-13：**兜底补 `_cs`** —— 调用方（switchBranch / cycleBranch / branchInfoOf）
   都直接读 `parent._cs`，只要有一个节点没这个字段就是整块白屏（renderMoveList 天天调它）。
   实测踩到：试下（草稿）手是"不挂树"的裸节点，它当上父节点时 `_cs` 是 undefined，
   `branchInfoOf` 一读 `sib.length` 就 TypeError（dev/_inject_branch_v2.js 的 ⑥ 段）。 */
function branchParentAt(at) {
  ensureBranch();
  const p = at > 0 ? (state.moves[at - 1] || branchRoot) : branchRoot;
  if (p && !p._cs) p._cs = [];
  return p;
}

/* 离开当前路径前：把 k 手之后的讲解**寄到各自节点上**（否则切分支时讲解会串/丢）。
   ★ 2026-10-13 段②：**棋谱自带的解说词（`state.sgfComments`）一起寄** —— 它也是按手号存的，
     切分支 / 提升主变 / 删分支之后手号的意义全变，不寄就会把别的棋的解说词显示出来。
     两者同构，所以放在同一个函数里处理（多一个字段 `_sc` 而已）。 */
function stashExplainAfter(k) {
  const ex = state.coach && state.coach.explain;
  const sc = state.sgfComments;
  for (let at = k + 1; at <= state.moves.length; at++) {
    const node = state.moves[at - 1];
    if (!node) continue;
    if (ex && ex[at]) { node._ex = ex[at]; delete ex[at]; }
    if (sc && sc[at]) { node._sc = sc[at]; delete sc[at]; }
  }
}

/* 走上一条新路径后：把这些节点寄着的讲解 / 棋谱解说词**放回**按手号的口袋里 */
function restoreExplainForPath() {
  const ex = state.coach && state.coach.explain;
  const sc = state.sgfComments;
  for (let at = 1; at <= state.moves.length; at++) {
    const node = state.moves[at - 1];
    if (!node) continue;
    if (ex && node._ex && !ex[at]) ex[at] = node._ex;
    if (sc && node._sc && !sc[at]) sc[at] = node._sc;
  }
}

/* ---------------- 评估缓存「跟分支走」（段②，2026-10-13） ----------------
 *
 * 与讲解（_ex）**完全同构**的做法：离开当前路径时，把那些手的评估结果寄到
 * 各自的节点上（`_an`）；走上新路径时再放回按手号的数组里。
 *
 * 为什么用这套，而不是把 history/leads 整体换成 Map<节点, 值>：
 *   history / leads / histVisits 的读点有几十处（走势图、手数列表、涨跌列、
 *   evalSettled、复盘报告…），换容器等于全改一遍、每处还要处理"没有值"的分支；
 *   而寄/还原只动**切分支这一个动作**，其余代码一行不改（与段① 同一套思路）。
 *
 * 索引语义（照抄 truncateAnalysisTo 的注释）：`history[at]` = 「走完第 at 手之后」的
 * 局面，所以它属于 `state.moves[at - 1]`（第 at 手那个节点）。
 * `history[0]` 是空盘、分叉点那个局面两条分支共用 → **不寄**。 */
function stashAnalysisAfter(k) {
  const nodes = state.moves;
  for (let i = k + 1; i < state.history.length; i++) {
    const node = nodes[i - 1];
    if (!node) break;
    node._an = {
      h: state.history[i],
      l: state.leads ? state.leads[i] : undefined,
      v: state.histVisits ? state.histVisits[i] : undefined,
    };
  }
}

function restoreAnalysisForPath() {
  /* ⚠️ 上界是 `<= state.moves.length`（不是 `<`）—— 索引语义：`history[at]` = 「走完第 at 手之后」，
     它属于第 at 手那个节点 `moves[at-1]`。写成 `<` 就**永远漏掉最后一手**（at = moves.length
     时 `moves[at-1]` 正是末端那手）—— 与 restoreExplainForPath 的上界保持一致。
     实测踩到：dev/_inject_branch_v2.js 的 ⑦2/⑦3/⑦4（切回旧线后第 5 手的胜率/目差/精度回不来）。 */
  for (let i = 1; i <= state.moves.length; i++) {
    const node = state.moves[i - 1];
    if (!node || !node._an) continue;
    while (state.history.length <= i) state.history.push(undefined);
    state.history[i] = node._an.h;
    if (state.leads) {
      while (state.leads.length <= i) state.leads.push(undefined);
      state.leads[i] = node._an.l;
    }
    if (state.histVisits) {
      while (state.histVisits.length <= i) state.histVisits.push(undefined);
      state.histVisits[i] = node._an.v;
    }
  }
}

/* ---------------- 主变判定（任务 1，2026-10-13 傍晚） ---------------- */
/* 当前走的是不是主变那条链（从根沿每层 _cs[0] 走到底）。
   ⚠️ 要比**节点身份**（main[i] !== state.moves[i]），不能比坐标 ——
      同一个坐标完全可能在两条支上都出现，比坐标会误判。
   存在的意义：全盘讲解按手号写缓存并落盘，若此刻走在旁支上，
   同一段手号指的是**另一盘棋**，跑一次就会把主线那份（几小时才跑出来的）讲解覆盖掉。 */
function currentPathIsMainline() {
  ensureBranch();
  if (state.draft) return false;
  const main = [];
  let cur = branchRoot;
  while (cur && cur._cs && cur._cs.length) { cur = cur._cs[0]; main.push(cur); }
  if (main.length !== state.moves.length) return false;
  for (let i = 0; i < main.length; i++) if (main[i] !== state.moves[i]) return false;
  return true;
}

/* ---- 当前路径与主变**从第几手岔开**（1 基手号；不岔开返回 0）----
 * ★ 2026-10-14 加（首相实拍反馈）：「我已经选中主干，但上面显示（这一条是分支）」——
 *   光说"这是分支"没用，用户根本定位不到岔口在哪一手。
 *   实测复现不出"按空格本身会导致判成分支"（新对局、两份真实棋谱各按 4 次空格，判定全程正常），
 *   真正会岔开的是「悔棋之后又落子」这类操作：那确实从某一点长出一条新支。
 *   所以这条的价值是**告诉用户岔在第几手**，让他知道往哪儿看、怎么切回去。
 * 判据按**节点身份**比（与 currentPathIsMainline 同口径），不比坐标。 */
function mainlineDivergenceAt() {
  ensureBranch();
  const main = [];
  let cur = branchRoot;
  while (cur && cur._cs && cur._cs.length) { cur = cur._cs[0]; main.push(cur); }
  const n = Math.min(main.length, state.moves.length);
  for (let i = 0; i < n; i++) if (main[i] !== state.moves[i]) return i + 1;
  return main.length === state.moves.length ? 0 : n + 1;
}

/* 某个节点在不在主变链上（从根沿每层 _cs[0] 一路到底）。
   ⚠️ 「我是父节点的头一个孩子」只是**局部**判据 —— 侧支深处的珠子（比如 11a）
   对它父亲同样是 _cs[0]，但它所在那条支并不是主变。必须沿祖先链逐级查到根。
   首相 2026-10-13 实拍发现右键菜单把 11a 误报成「已是主变」，根因就在这。 */
function onMainline(node) {
  let cur = node;
  while (cur && cur._p) {
    if (!cur._p._cs || cur._p._cs[0] !== cur) return false;
    cur = cur._p;
  }
  return !!node;
}

/* ---------------- 手数（★ 2026-10-14：去掉了 a/b 后缀） ----------------
 * 一个节点的显示名 = **离根几步**。纯函数（只吃 node），能在探针里直接单测、不受界面状态影响。
 *
 * ★★ 2026-10-14 首相实测：「大量 a 和 b 的命名这不对吧」—— 对。那套是我自己设计的
 *   「12a 式手号」（设计方案决策 6）：分岔后同一支上的手共用同一个字母后缀。
 *   但**业界不这么标**：Sabaki / Lizzie / KaTrain 的树都靠**位置**区分各条变着
 *   （同一深度的不同支，在纵向上分开放），节点上只写真实手数。
 *   而且多层分叉时后缀会炸出一串 a/b/c…，越看越乱 —— 首相看到的正是这个。
 *   所以按首相要求「别的软件怎么做就怎么做」：**只显示手数、靠位置区分**。
 *   「这里分岔了」的提示由珠子上的 ▾ / +n 角标负责，那比后缀清楚得多。
 *
 * ⚠️ 手数列表（renderMoveList）也调它，但那边只列**当前路径**上的手，
 *    `depth` 恒等于 `i + 1` —— 所以去掉后缀对列表没有任何影响（旁支的重复手数不会出现在列表里）。 */
function moveLabelOf(node) {
  if (!node) return '';
  let depth = 0;
  for (let cur = node; cur && cur._p; cur = cur._p) depth++;
  return String(depth);
}

/* ---------------- 提升主变（段②，2026-10-13） ----------------
 *
 * 把「第 at 手所在的那一条支」整体提为主变。主变 = 从根沿每层 `_cs[0]` 走到底那条链，
 * 所以**这纯粹是重排 children 的顺序**，一个字的数据都不用改。
 *
 * 三步，顺序不能换：
 *   ① 把当前路径上**所有**手的讲解与评估寄到各自节点上（`_ex` / `_an`）；
 *   ② 沿祖先链把自己插进每层父节点的 `_cs[0]`；
 *   ③ 按新主变重建 `state.moves`，再把缓存放回来。
 *
 * ⚠️ 为什么必须寄/还原（这是本函数唯一的难点）：
 *   `state.history` / `leads` / `histVisits` / `coach.explain` 全是**按手号**存的，
 *   而提升主变会让「原来的旁支第 4 手」变成「主线第 4 手」、原主线第 4 手退成旁支
 *   ——手号的意义整个换了一遍。寄到节点上之后缓存天然跟着节点走，
 *   放回来就各归各位，不需要任何特判。这正是段② 那套寄/还原的复用价值。
 * ⚠️ `history[0]`（空盘 / 分叉点那个局面）**不寄**：两条分支共用同一个局面，
 *   寄走反而会把它从当前路径上抹掉（stash 从 k+1 起就是这个道理）。
 * ✅ `state.sgfComments`（棋谱自带的解说词，同样按手号存）**一起寄/还原** ——
 *   段② 补账时把它并进了 `stashExplainAfter` / `restoreExplainForPath`（寄在节点的 `_sc` 上），
 *   而「解说词按节点写回原文件」也已经由 `patchSGFCommentAtNode`（靠 `_sgfIdx`）做了。
 *   ※ 这里原先写的是「提升主变**不会**动 sgfComments，要等段② 余下一起来改」——
 *     2026-10-13 审查时那句已经过期（坑位 42：注释比代码旧，会把下一个接手往"还有缺口"上带）。
 */
function promoteToMainline(at) {
  if (state.draft) { flash('试下中不能改主变，先退出试下'); return false; }
  if (!(at > 0) || at > state.moves.length) { flash('先跳到要提升的那一手'); return false; }
  ensureBranch();
  const node = state.moves[at - 1];
  const p = node && node._p;
  if (!p) { flash('这一手没法提升'); return false; }
  if (p._cs[0] === node) { flash('第 ' + at + ' 手已经在主变上了'); return false; }

  stashExplainAfter(0);
  stashAnalysisAfter(0);

  /* 沿祖先链一路插到各层最前 —— 只把「自己」提前，兄弟之间的相对次序不动。
     走到虚拟根时 `_p` 为 null，循环自然结束（虚拟根的 `_cs` 也要一起重排，
     否则「第 1 手就分叉」那种情形提不动）。 */
  let cur = node;
  while (cur && cur._p) {
    const par = cur._p;
    const i = par._cs.indexOf(cur);
    if (i > 0) { par._cs.splice(i, 1); par._cs.unshift(cur); }
    cur = par;
  }

  const full = pathThrough(node);
  state.moves.length = 0;
  for (const m of full) state.moves.push(m);
  state.viewAt = at;                          // 看的还是同一手（同一点，只是主变换了）
  state.toMove = sideToMove(at);
  state.koPoint = koFromBoard(boardAt(at), state.moves, at);
  state.pv = null;
  truncateAnalysisTo(0);                      // 按手号的缓存整个作废（已寄走）
  restoreExplainForPath();
  restoreAnalysisForPath();
  syncUI();
  flash('已把第 ' + at + ' 手这一支提为主变（原主变整枝还在树上，↑/↓ 能切回去）');
  return true;
}

/* ---------------- 删除分支（段②，2026-10-13） ----------------
 *
 * ★ 与「悔棋」是**两件事**，别混（设计方案决策 7）：
 *     悔棋      = 只删**当前节点**，**永不顺带删除其它旁支**（想删整枝走这里）；
 *     删除分支  = 连子树整枝删掉。
 *
 * 两道保险（删的是用户辛苦摆出来的棋，不能一键就没）：
 *   ① **入口处弹窗确认**（2026-10-15 首相要求改的）：右键菜单点「删除分支」→ 弹窗写清
 *      「第几手起、共几手、能不能撤销」→【取消】/【删除】。真删时走 `{ force: true }`。
 *      内核里**仍保留"两段式"作为兜底**：Delete 快捷键本轮已按首相要求删掉，
 *      所以现在没有键盘入口走它；将来谁再挂一个新入口、忘记加 force，也不会"一键就删"。
 *      登记带 8 秒时效，超时或被别的操作打断就作废，免得"刚才那下"变成"现在这下"。
 *   ② **回收站**：真删之前把「父节点 + 原下标 + 节点本身」扣进 `branchTrash`，
 *      `Ctrl+Shift+Z` 原样放回（连下标位置都还原，不影响兄弟次序）。
 */
let pendingDel = null;      // { node, at, t } 等待第二次确认的删除
let branchTrash = null;     // { parent, index, node, at } 最近一次真删掉的整枝

/* 这一枝一共多少手（含它自己与所有后代） */
function subtreeSize(node) {
  let n = 0;
  const walk = x => { n++; for (const c of (x._cs || [])) walk(c); };
  walk(node);
  return n;
}

function deleteBranchAt(at, opts) {
  if (state.draft) { flash('试下中不能删分支，先退出试下'); return false; }
  if (!(at > 0) || at > state.moves.length) { flash('先跳到要删的那一手'); return false; }
  ensureBranch();
  const node = state.moves[at - 1];
  const parent = node && node._p;
  if (!parent) { flash('这一手没法删'); return false; }
  if (parent._cs.indexOf(node) < 0) { flash('这一手不在树上（是草稿手吗？）'); return false; }

  /* 第一段：登记 + 报清楚要删多少。
     ★ 2026-10-15：`opts.force` 跳过这一段 —— 右键菜单已经改走「弹窗确认」，
       弹窗里把"删哪一手、共几手、能不能撤销"写清楚了，这里就不必再来一次两段式
       （两段式只在"键盘连按"那个交互下才需要，而 Delete 快捷键本轮已按首相要求删掉）。 */
  if (!(opts && opts.force) && (!pendingDel || pendingDel.node !== node || Date.now() - pendingDel.t > 8000)) {
    const n = subtreeSize(node);
    pendingDel = { node, at, t: Date.now() };
    flash('再按一次 Delete：删掉第 ' + at + ' 手起的整条支（共 ' + n + ' 手）· 删完可按 Ctrl+Shift+Z 撤销');
    return false;
  }
  pendingDel = null;

  /* 第二段：真删 */
  const idx = parent._cs.indexOf(node);
  branchTrash = { parent, index: idx, node, at };
  parent._cs.splice(idx, 1);

  /* 缓存先全寄走（下面手号的意义要换一遍），重建路径后再放回来 */
  stashExplainAfter(0);
  stashAnalysisAfter(0);
  /* 被删的枝若正是当前走的那条 → 回到分叉点，再沿**新的**主变（`_cs[0]`）一路走到底。
     parent 可能就是虚拟根（删第 1 手那种情形），pathThrough 对它同样成立。 */
  const full = pathThrough(parent);
  state.moves.length = 0;
  for (const m of full) state.moves.push(m);
  state.viewAt = Math.min(at - 1, state.moves.length);
  state.toMove = sideToMove(state.viewAt);
  state.koPoint = koFromBoard(boardAt(state.viewAt), state.moves, state.viewAt);
  state.pv = null;
  truncateAnalysisTo(0);
  restoreExplainForPath();
  restoreAnalysisForPath();
  syncUI();
  flash('已删除第 ' + at + ' 手起的整条支 · 按 Ctrl+Shift+Z 撤销');
  return true;
}

function undoDeleteBranch() {
  if (!branchTrash) { flash('没有可撤销的删除'); return false; }
  const t = branchTrash;
  branchTrash = null;
  /* ★★ 第二道保险（坑位 37）：回收站里存的是**节点引用**，而换局/换棋谱会重建树。
     上面两处已把 branchTrash 清空，这里再自查一次「这枝还在当前这棵树上吗」——
     判据是沿祖先链走到顶，看是不是**当前**的 branchRoot。对不上就作废：
     否则会把旧局的线拼进 `state.moves`，覆盖用户眼下这盘（实测能复现，见 dev 桩测）。 */
  ensureBranch();
  let top = t.parent; while (top && top._p) top = top._p;
  if (top !== branchRoot) {
    pendingDel = null;
    flash('那枝属于刚才那份棋谱/上一局 —— 换局之后不能跨局撤销，已作废');
    return false;
  }
  if (!t.parent._cs) t.parent._cs = [];
  /* 插回**原来的下标位置**（不是 push 到末尾）—— 兄弟之间的次序是主变语义的一部分
     （`_cs[0]` 才是主变），插错位置等于顺手改了主变。
     ⚠️ 局部变量**别叫 `idx`** —— 它是本文件的棋盘取号函数 `idx(x, y)`，同名会在这里遮蔽它，
        将来谁在这个函数里加一句盘面计算就会拿到一个数字而不是函数。 */
  const insIdx = Math.min(t.index, t.parent._cs.length);
  t.parent._cs.splice(insIdx, 0, t.node);

  stashExplainAfter(0);
  stashAnalysisAfter(0);
  const full = pathThrough(t.node);
  state.moves.length = 0;
  for (const m of full) state.moves.push(m);
  state.viewAt = Math.min(t.at, state.moves.length);   // 把用户送回他删之前看的那一手
  state.toMove = sideToMove(state.viewAt);
  state.koPoint = koFromBoard(boardAt(state.viewAt), state.moves, state.viewAt);
  state.pv = null;
  truncateAnalysisTo(0);
  restoreExplainForPath();
  restoreAnalysisForPath();
  syncUI();
  flash('已撤销删除 · 第 ' + t.at + ' 手起的整枝放回来了');
  return true;
}

/* ---------------- SGF 树 ⇄ 我们的 move 树（段②，2026-10-13） ----------------
 *
 * SGF 的变着写法：`(;B[pd];W[dd](;B[qq];W[pp])(;B[pp]))`
 *   —— 一个括号 = 一棵树，树里顺序写节点；`;A;B;C` 与 `(;A(;B(;C)))` 语义等价，
 *      都是"A 的子是 B、B 的子是 C"。所以**统一成"每个节点有一串子节点，
 *      第 0 个是主变"**：顺序节点 = 前一个节点的唯一子。
 * 这个统一是本次能一次写对的关键（见 parseSGF 里的 sgftree）。
 *
 * 下面这个函数是**纯的**（只吃 tn + size，不碰 state），所以能在探针里直接单测。 */

/* 从一个 SGF token 节点里取出手（0 手 = 根属性节点 / 只有 C 的节点；
   越界坐标 = 题集的 `zz` 分隔标记，当没有手） */
function sgfMovesOfTok(tok, size) {
  const out = [];
  for (const p of tok.props) {
    if (p.id !== 'B' && p.id !== 'W') continue;
    const color = p.id === 'B' ? 'b' : 'w';
    const v = p.vals.length ? p.vals[0] : '';
    if (!v) { out.push({ color, pass: true }); continue; }   // [] = 停一手
    if (v.length !== 2) continue;
    const x = v.charCodeAt(0) - 97, y = v.charCodeAt(1) - 97;
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x < 0 || y < 0 || x >= size || y >= size) continue;  // 越界（题集分隔标记）
    out.push({ color, x, y });
  }
  return out;
}

/* 把 SGF 树装成我们的 move 树。
   · parent = 挂靠节点（根时传 branchRoot）；at = parent 是第几手
   · mainOut 非 null 时，**沿每个分叉点的第 0 条**（主变）一路记进这个数组 —— 它就是要塞回
     `state.moves` 的那条主线；遇旁支时传 null，于是旁支不会污染主线。
   · 返回本子树（沿主变）的末端节点，方便调用方接续。 */
function sgfTreeToMoves(tn, parent, at, mainOut, size, ctr) {
  let cur = parent;
  if (!tn) return cur;
  for (const mv of sgfMovesOfTok(tn.tok, size)) {
    const node = { x: mv.x, y: mv.y, color: mv.color, _p: cur, _cs: [] };
    if (mv.pass) { node.pass = true; delete node.x; delete node.y; }
    /* ★ 段②（2026-10-13）：给节点发一个「它在原文里是第几手」的序号。
       用途：旁支上写回解说词时，靠这个序号去新 parse 出的树里找回同一个 token
       （`C[..]` 在原文里的字符区间）。序号由下面 sgfIndexAllTokens **同序遍历**产生，
       两者顺序必须一致 —— 改这里的顺序就要同步改那边。 */
    if (ctr) node._sgfIdx = ctr.n++;
    if (!cur._cs) cur._cs = [];
    cur._cs.push(node);
    if (mainOut) mainOut.push(node);
    cur = node;
  }
  if (tn.kids && tn.kids.length) {
    sgfTreeToMoves(tn.kids[0], cur, at, mainOut, size, ctr);      // 第 0 条 = 主变，继续主线
    for (let i = 1; i < tn.kids.length; i++) {
      sgfTreeToMoves(tn.kids[i], cur, at, null, size, ctr);       // 其余 = 旁支，不进主线
    }
  }
  return cur;
}

/* 把 SGF 树按**与 sgfTreeToMoves 完全相同的顺序**摊平成一串「每一手 → 它所在的 token」。
 *
 * 为什么必须同序：写回解说词时手上只有「内存里的那个 move 节点」，
 * 而落刀要的是「原文里 `C[..]` 的字符区间」—— 这必须重新 parse 一次文件才能拿到。
 * 两次 parse 之间唯一稳定的东西就是**遍历顺序**：只要两边按同一顺序编号，
 * `node._sgfIdx` 就能换回同一个 token。
 * 顺序：一个 tok 里的手（按属性顺序）→ kids[0] 子树 → kids[1] 子树 → …
 * （与 sgfTreeToMoves 逐字对应。） */
function sgfIndexAllTokens(tn, size, out) {
  out = out || [];
  if (!tn) return out;
  for (const mv of sgfMovesOfTok(tn.tok, size)) out.push({ tok: tn.tok, mv });
  if (tn.kids) for (const k of tn.kids) sgfIndexAllTokens(k, size, out);
  return out;
}

/* 切到「第 at 手之后」的第 j 条分支（j 是 _cs 下标）。
   at 用当前 viewAt：即在分叉点处换一条走下去。 */
function switchBranch(at, j) {
  /* ★★ 坑位 38（2026-10-13 审查补）：试下（草稿）期间**不换分支**。
     原来 `gotoNode`（点珠子）、`promoteToMainline`（PgUp）、`deleteBranchAt`（Delete）
     三个入口都挡了草稿，唯独这条**内核**没挡 —— 于是「回看到某个岔口 + 按 ↑/↓」能切过去：
     `state.moves.length = at` 把草稿手整批截掉（快照里还在），换成另一条线，
     而 `state.draft` 仍挂着 → 列表的「草」标记按 `i+1 > draft.from` 判，位置全错位，
     这期间再落子就是「挂在分支线上的草稿手」，退出试下又被整体还原
     —— 用户看到的就是「分支切了又自己没了 / 草标乱飘」。
     挡在内核这一层（而不是只在 ↑/↓ 那里挡）是为了所有调用路径都过这道闸。 */
  if (state.draft) { flash('试下（草稿）期间不换分支 —— 先点「退出试下」（草稿的手不进分支树）'); return false; }
  const parent = branchParentAt(at);
  const sib = parent._cs;
  if (sib.length < 2) { flash('这一点还没有分支'); return false; }
  const target = sib[((j % sib.length) + sib.length) % sib.length];
  if (!target) return false;
  stashExplainAfter(at);
  stashAnalysisAfter(at);                       // ★ 段②：评估也寄到各自节点上（切回来秒出，不用重算）
  state.moves.length = at;                      // 截到分叉点（旧分支整枝仍在树里）
  const full = pathThrough(target);
  for (let i = at; i < full.length; i++) state.moves.push(full[i]);
  state.viewAt = state.moves.length;            // 切过去直接看这条分支走到哪
  state.toMove = sideToMove(state.viewAt);
  state.koPoint = koFromBoard(boardAt(state.viewAt), state.moves, state.viewAt);
  state.pv = null;
  truncateAnalysisTo(at);                       // 旧路径的评估已寄走 → 这里可以放心截
  restoreExplainForPath();
  restoreAnalysisForPath();                     // ★ 段②：把这条分支自己的评估放回来
  rebuildCapAt();                               // ★ 段②：旁支可能是刚从棋谱读进来的，captured/capAt 得补
  syncUI();
  flash('已切到第 ' + (sib.indexOf(target) + 1) + ' 条分支（这一点共 ' + sib.length + ' 条）');
  return true;
}

/* 在当前看到的位置上换分支（↑ / ↓ 用）。dir = +1 / -1 */
function cycleBranch(dir) {
  ensureBranch();
  const at = state.viewAt;
  const parent = branchParentAt(at);
  const sib = parent._cs;
  if (sib.length < 2) {
    flash(at > 0 ? '第 ' + at + ' 手之后没有分支' : '开局没有分支');
    return false;
  }
  const cur = at < state.moves.length ? state.moves[at] : null;
  const i = cur ? sib.indexOf(cur) : -1;
  const j = i < 0 ? (dir > 0 ? 0 : sib.length - 1) : (i + dir + sib.length) % sib.length;
  return switchBranch(at, j);
}

/* 这一手后面分出了几条支（列表上标注用）；返回 { n, idx } */
function branchInfoOf(at) {
  ensureBranch();
  const parent = branchParentAt(at);
  const sib = parent._cs;
  const cur = at < state.moves.length ? state.moves[at] : null;
  return { n: sib.length, idx: cur ? sib.indexOf(cur) : -1 };
}

/* ---------------- 段③ 水平分叉树面板（2026-10-13 千问，设计方案段③） ----------------
 *
 * 首相 2026-10-13 定的画法（参照 KaTrain 的「珍珠手串」，取代第一版胶囊按钮）：
 *   · 节点 = **圆形棋子**：黑子中心印白字、白子中心印黑字，字是 12a 式手数（moveLabelOf）；
 *   · **主变那一串的珠子带金色外圈**（行号 0 = 沿每层 _cs[0] 走下来的链）—— 一眼认出主线；
 *   · 主干一条横线串珠；侧支从分叉那颗珠子引一条**肘形线**下来，在自己的行上继续串珠；
 *   · 坐标 / 胜率增减**不印在珠子上**，改成**鼠标悬停浮层**显示 —— 直观与数据两全；
 *   · 右键**按住拖动 = 平移画布**（往哪拖、画布往哪走，镜头概念上不动）；**原地右击**才弹菜单。
 * 布局：列 = 手数（离根深度），行 = 航道。珠子定尺寸（STP）＋列距固定（TREE_W）→ 不会重叠
 *   （第一版胶囊"按内容估列宽"的复杂度换串珠后整个省掉）。主线恒在第一行；每条侧支占一条新行
 *   （行号全局递增 —— 简单、永不重叠；行多了可折叠收，C 键或珠角 ▾）。
 * 虚拟化：200+ 手不建全量 DOM —— 只画滚动窗口内的列（±1 列余量），滚动 / 平移时重画。
 * 数据口径：一切从 branchRoot 走树（只认 _cs），**不碰 state.moves**（它只是当前路径）。
 * 草稿手不在树里（段② 已保证：ensureBranch 串到 draft.from 就停），面板自然不显示。
 */
let movesView = 'list';               // 'list' | 'tree' —— 标题旁滑杆切换（首相定的：让人一眼知道在看哪个）
/* ★★★★ 2026-10-14 深夜：折叠语义**反转**（首相：「全展开实在是太乱了，
   应该是**默认全部收起、按需展开**」）。
   旧 `treeCollapsed` 记"折起来的" → 默认空 = **全展开**，打谱谱一打开就是一屏珠子。
   新 `treeExpanded` 记"**展开的**" → 默认空 = **全部收起**，只画主变 + 角标，
   点珠子右上角的角标才把那一条支铺开。
   ⚠️ `treeForceOpen` 由 treeLayout **每次重算**：当前显示那一手所在路径上"必须展开"的
      父节点 —— 否则跳进某条支的第 5 手时，那颗珠子根本不在树上（看着像"点了没反应"）。
   对外统一走 treeIsOpen()，别再直接读这两个集合。 */
let treeExpanded = new Set();
let treeForceOpen = new Set();
const treeIsOpen = n => treeExpanded.has(n) || treeForceOpen.has(n);
/* ★★ 2026-10-14 深夜：**展开的先后顺序**（首相：「先展开的应该被后展开的挤下去，
   让最近展开的那个保持在最靠主干的地方」）→ 行分配按这个序**倒着**来（后展开的先挑行）。
   ⚠️ 序号只在"用户真的点了角标 / 点了全部展开"时才发；自动展开（treeForceOpen）不发，
      于是它们保持 0、按手数顺序排 —— 那正是"没动过手时"该有的样子。 */
let treeExpandSeq = new Map();
let treeExpandCounter = 0;
const expandSeqOf = n => treeExpandSeq.get(n) || 0;
/* 跨行的**斜线**（每条支只有第一条链节是斜的，其余是同行水平短线），
   ★ 按"它跨过的每一行"分桶（row → [edge…]）：找行判碰时**只查这一行的桶**。
   第一版是全量扫几百条线 → 真实棋谱"全部展开"实测 **16.4 秒**（2026-10-14 深夜踩到），
   分桶之后同样的数据降到几十毫秒级。 */
let treeEdges = new Map();   /* 保留这个名字只为兼容；v6 起布局内部改用 edgeList（存节点对，坐标现算） */
let treeCells = [];                   // 布局结果：{node, depth, row}
let treeLanes = 1, treeMaxDepth = 0;
let treeRaf = 0;
/* 棋子定尺寸（珠子小，列宽固定也**不会重叠** —— 和上一版胶囊"按内容估宽"不同）。
   STP = 直径，TREE_W = 列距（含珠子间距，手串的"珠距"），TREE_H = 行距。 */
const STP = 24, TREE_W = 40;
/* ★★ 2026-10-14 晚：行距 40 → 52（首相报的「这些手基本全重叠起来了看都看不明白」）。
   珠子 24px + 主变/当前手的圈约占 4px，40 的行距只剩 ~12px 空隙 ——
   打谱谱分支多、行排得密时，上下两行的珠子看着就糊成一片。
   52 留出 ~24px 空隙，一眼能分清行。列距（TREE_W=34）不动：
   横向是"顺着看手数"，挤一点不影响判读；纵向才是"分辨不同的支"。 */
const TREE_H = 52;
/* ★ 2026-10-14 加：树面板左右留白。
   原来左上是「零距离贴边」的 —— 第一颗珠子（第 1 手）紧贴左边界，
   连它上面的折叠角标（▾ / +n）都被切掉一半，看着像坏了（首相实测报的）。
   横竖各留一点：左边 PAD_X 给"入线"和角标留位，顶部 PAD_Y 给角标留位。 */
const TREE_PAD_X = 14, TREE_PAD_Y = 10;

/* 这一手「离根几步」= 路径长度（虚拟根不算手） */
function nodeDepth(node) {
  let d = 0, cur = node;
  while (cur && cur._p) { d++; cur = cur._p; }
  return d;
}

/* 这一手在当前路径上的下标（不在路径上返回 -1）。 */
function pathIndexOf(node) {
  for (let i = 0; i < state.moves.length; i++) if (state.moves[i] === node) return i;
  return -1;
}

/* 取某一手的「局面胜率」：路径上的读 history[]，路径外的读寄存在节点上的 _an。
   口径与手数列表一致：没算准的不给数字（返回 undefined，胶囊就不画涨跌）。 */
function nodeWinAt(node, depth) {
  if (!node) return undefined;
  if (depth === 0) return state.history[0];
  const i = pathIndexOf(node);
  if (i >= 0) {
    const h = state.history[i + 1];
    return (typeof h === 'number' && evalSettled(i + 1)) ? h : undefined;
  }
  const an = node._an;
  if (an && typeof an.h === 'number') {
    const target = settings.visits || ANALYZE_VISITS;
    if ((an.v || 0) >= target * 0.9) return an.h;
  }
  return undefined;
}

/* 胶囊上的涨跌小标（与列表同款算法：和父节点比，翻成「下棋方」视角） */
function nodeDeltaTxt(node, depth) {
  const h = nodeWinAt(node, depth);
  const prev = nodeWinAt(node._p, depth - 1);
  if (typeof h !== 'number' || typeof prev !== 'number') return null;
  const d = (h - prev) * 100 * (node.color === 'b' ? 1 : -1);
  if (Math.abs(d) < 0.05) return null;
  return d;
}

/* 布局一遍树（含折叠）。每次状态变化后由 renderMoveTree 调。
 *
 * ★★★★★ 行分配总则（2026-10-14 深夜：三次重写 + 一轮性能治理）
 *
 * 【首相要求一】「先展开的应该被后展开的挤下去，让**最近展开的那个保持在最靠主干的地方**」
 *   → 放置顺序**按展开时间倒序**：最后展开的那条支**先挑行**，拿到最靠上的空行；
 *     先展开的随后挑，被挤到下面去。（每次 treeLayout 都从零重算，重排天然发生。）
 *
 * 【首相要求二】「明显不会碰到的两条，居然没处在同一行……**这太浪费行数了**」
 *   → 找行时**从父行的下一行开始**往上找，"**几何上真正放得下**"的行就共用 ——
 *     列区间不重叠、线也不擦到对方珠子的两条支，会**自然共用同一行**。
 *
 * 【首相要求三】「尽量**不要出现交叉或者越过某一块**，而是**自适应上下让位**」
 *   → 父行下面 K 行之内都放不下时，**不是**去树的最底下另起一行（那样线会横跨几百行、
 *     穿过中间一整片），而是**在父行正下方插一个空行，把它下面的全部推开** ——
 *     这就是"上下让位"。于是**每条支的连线永远只跨一行**，不可能越过别人的块。
 *
 * 【判据只有三条，每一条都能被断言直接验】
 *   ① 格子不重叠；② 这一支的入线不碰任何已放置的珠子；③ 已放置的斜线不碰这一支的珠子。
 *   ⚠️ 前三次翻车（死循环 / 第 514 行 / 行号 14）的根因都是**判据本身错**，不是"不该找行"。
 *     纪律：**任何往这段里加的判据，都必须能用一条断言验出来**，否则不加。
 *
 * 【性能：实测数据与两轮治理（真实棋谱 181 手 / 457 条支 / 4720 颗珠子）】
 *   第一版（逐行试到行尾 + 全量扫斜线）：**16.4 秒** —— 不能接受。
 *   第二版（斜线按行分桶 + 链深列表只算一次）：14.5 秒 —— 只治了皮毛，瓶颈其实在"试行"。
 *   第三版（**父行下面只看 K 行，放不下就插入一行让位**）：见下方 `findRow`。
 *   ⇒ 教训：**先量再改**；一次只改一个变量，否则不知道是哪一处起了作用。
 *
 * 产出：treeCells / treePosOf / treeEdges / treeLanes / treeMaxDepth / treeTotalW。 */
function treeLayout() {
  ensureBranch();
  treeCells = []; treeEdges = new Map(); treeLanes = 1; treeMaxDepth = 0;
  treePosOf = new Map();

  /* ---------- ① 当前显示那一手 → 哪些节点的侧支必须展开 ----------
     ★ 首相要"默认收起"，但**当前手所在的路径不能不画** ——
       否则他点某条支的第 5 手，那颗珠子根本不在树上，看着像"点了没反应"。
     ⚠️ 只标"侧支的**父节点**"，不是把整条祖先链都展开（否则又变回"太乱了"）。 */
  treeForceOpen = new Set();
  {
    let n = state.viewAt > 0 ? state.moves[state.viewAt - 1] : null;
    while (n && n._p) {
      const pcs = n._p._cs || [];
      if (pcs.length > 1 && pcs[0] !== n) treeForceOpen.add(n._p);   // n 是侧支 → 父必须展开
      n = n._p;
    }
  }

  /* 行索引（判"格子占没占"、查"这一行有哪些珠子"）——别每次全量扫 treeCells */
  const rowOcc = new Map();                       // row → Set<depth>
  const rowCell = new Map();                      // row → [cell…]
  const occOf = r => { let s = rowOcc.get(r); if (!s) { s = new Set(); rowOcc.set(r, s); } return s; };
  const cellOf = r => { let a = rowCell.get(r); if (!a) { a = []; rowCell.set(r, a); } return a; };

  /* 跨行的**斜线**：只存**节点对**，坐标每次都从 treePosOf 现算。
     现在行号一旦定下就不再变动（`insertRowAt` 已废），本来可以存死坐标；
     但现算也就几次乘法，而且**不会因为将来再改动行号而悄悄失效** —— 留着更安全。 */
  const edgeList = [];
  const edgeOf = () => edgeList;

  const put = (node, depth, row) => {
    const c = { node, depth, row };
    treeCells.push(c);
    cellOf(row).push(c);
    occOf(row).add(depth);
    treePosOf.set(node, { d: depth, r: row, n: node });   // n = 自引用，斜线要按它现算坐标
    if (row + 1 > treeLanes) treeLanes = row + 1;
    if (depth > treeMaxDepth) treeMaxDepth = depth;
  };

  /* 珠心坐标（画线与判碰同一套口径 —— 2026-10-13 踩过"两处各算一套、对不齐"） */
  const cx = d => stoneX(d) + STP / 2;
  const cy = r => stoneCy(r);
  /* ★ 判碰半径比断言里的 `STP/2 - 1` 再严 0.5px：宁可多占一行，也不让 A1 出现"擦边" */
  const R_HIT = STP / 2 - 0.5;
  const NEAR = 1;                                  // 端点排除容差（同一颗珠子不能算自己挡路）
  const segHit = (px, py, x1, y1, x2, y2) => {
    if (Math.hypot(px - x1, py - y1) < NEAR || Math.hypot(px - x2, py - y2) < NEAR) return false;
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) < R_HIT;
  };

  /* 一条支（br.ds = 它主链每一节的深度）摆在第 row 行，放得下吗？
     ★ 三条判据，每一条都能被断言直接验：
       ① 这一行的这些格子必须都空着；
       ② 这一支的**入线**（父珠心 → 支首珠心）不碰任何已放置的珠子；
       ③ 已放置的**斜线**不碰这一支的珠子。
     ⚠️ 判据再保守，最坏结果也只是"多占一行"，**不可能卡死**（`findRow` 一路找到行尾就停）。 */
  const branchFits = (br, pPos, row) => {
    const ds = br.ds;
    /* ① 格子不重叠 */
    const used = occOf(row);
    for (let i = 0; i < ds.length; i++) if (used.has(ds[i])) return false;
    /* ② 入线不碰珠子 —— 只扫这条线**经过的那几行**（两端行号之间） */
    const x1 = cx(pPos.d), y1 = cy(pPos.r), x2 = cx(br.depth0), y2 = cy(row);
    const r0 = Math.min(pPos.r, row), r1 = Math.max(pPos.r, row);
    for (let r = r0; r <= r1; r++) {
      const rowCells = cellOf(r);
      for (let i = 0; i < rowCells.length; i++) {
        const x = rowCells[i];
        if (segHit(cx(x.depth), cy(x.row), x1, y1, x2, y2)) return false;
      }
    }
    /* ③ 已有的斜线不碰这一支的珠子。
          ⚠️ 先用 y 范围粗筛（斜线不在这一行的高度上就直接跳过），再做精确距离 —— 性能关键 */
    const y = cy(row);
    for (let i = 0; i < edgeList.length; i++) {
      const e = edgeList[i];
      const pp = treePosOf.get(e.p), cc = treePosOf.get(e.c);
      if (!pp || !cc) continue;
      const ey1 = cy(pp.r), ey2 = cy(cc.r);
      if (y < (ey1 < ey2 ? ey1 : ey2) - R_HIT || y > (ey1 > ey2 ? ey1 : ey2) + R_HIT) continue;
      const ex1 = cx(pp.d), ex2 = cx(cc.d);
      for (let k = 0; k < ds.length; k++) if (segHit(cx(ds[k]), y, ex1, ey1, ex2, ey2)) return false;
    }
    return true;
  };

  /* 找行：**从 startRow 开始**一路找到行尾，取第一个"几何上放得下"的行
     （`branchFits` 那三条判据：格子不重叠 / 入线不碰珠子 / 已有的斜线不碰这一支的珠子）；
     一路都没有空位，就用在**末尾新开一行**（`treeLanes`）。

     ★★★★ 2026-10-14 深夜定稿：**"硬塞行尾"这条兜底废弃** —— 查清了，它就是首相报的
       "线贴在珠子上"的真凶。诊断实测（真实棋谱，一轮布局放 14 条支）：
         · 兜底触发 **3 次**，每一次都发生在**"只试了 1 行"**之后 ——
           因为 `nextFree` 把起始行推到了行尾，循环里根本没有第二行可试；
         · 这 3 次的入线到最近珠心距离 = **11.1 / 6.7 / 5.6px**（判碰半径 11.5、珠半径 12），
           后两个与首相报的过近明细**逐位吻合**。
       ⇒ 兜底不再"明知穿珠还放"，改成**降级**：先挑完全合规的行；都找不到，才退而挑
         **格子不冲突里最靠上的一行**（起始行优先 → 跨行数最小 → 擦得最轻）。
       ⚠️ 降级仍是"带着轻微擦边放行"，不是彻底治好 —— 彻底治好要靠列距，见下面的铁律。

     ★ 几何铁律（决定"一个父最多能同时展开几条支"，**改列距/行距前必看**）：
         同一父第 k 条支的入线，到"紧邻上一个兄弟"珠心的距离 = `A·H / √(A² + k²H²)`
         （A = TREE_W 列距，H = TREE_H 行距）。当前 A=34、H=52：
           k=1 → 28.5px ✓    k=2 → 16.2px ✓    **k=3 → 11.07px ✗**（判碰线 11.5）
           k=5 → 6.74px ✗（实测 6.7）         k=6 → 5.64px ✗（实测 5.6）
         ⇒ **当前只有 k ≤ 2 安全**。要撑到 k=3 需 A ≥ 35.4，k=4 需 A ≥ 47.2，k=5 需 A ≥ 59。
         ⚠️ 加大**行距 H 救不了**（距离上界是 A/k，H 越大反而越贴近这个上界）——
            所以要治，只能动列距 A。

     ★★ 2026-10-15 定稿：**"插入让位"整条路废弃了**，这是实测几次打出来的结论 ——
       插入 = 把 `row >= r` 的全部下移一行。于是"**父在 r 上方、子在 r 下方**"的那些斜线
       **父端不动、子端下移** → 线被拉长 → 拉到后来**穿过中间行上的珠子**：
         · 带插入（无保护）：真实棋谱全展开 **10209 处**线与珠子过近；
         · 加了"只在不会拉长任何线时才插"的保护：降到 140 处 —— 但**按需展开 8 条支时仍有 2 处**、
           展开到 28 条时 91 处（插入把兄弟支的行号推得不连续，见下）；
         · 彻底不插（本版）：由"兄弟行号连续"接管，零接触才真正成立。
       "后展开的挤上去"**不需要**插入来实现 —— 靠**排序方向**就够了（倒序：后展开的先放，
       直接占住最靠上的空行），完全不用动任何已经放好的东西。
     ⚠️ 也不再设"搜索行数上限"：那 5.2 秒只发生在「全部展开」那一刻，
        而那个按钮已按首相要求删除 —— 为一个不存在的场景加限制，反而把支逼向更坏的选择
        （实测加上限后过近从 140 处涨到 5353 处）。 */
  const rowFreeOnly = (br, row) => {                 // 只要格子不冲突（降级用）
    const used = occOf(row);
    for (let i = 0; i < br.ds.length; i++) if (used.has(br.ds[i])) return false;
    return true;
  };
  const findRow = (br, pPos, startRow) => {
    const from = Math.max(pPos.r + 1, startRow);
    for (let r = from; r <= treeLanes; r++) if (branchFits(br, pPos, r)) return r;
    for (let r = from; r <= treeLanes; r++) if (rowFreeOnly(br, r)) return r;   // 降级：最靠上的空行
    return treeLanes;
  };

  /* 把一条支的主链整条铺在 row 上。
     ★ 只有**第一条链节**是斜的（父在别的行）→ 登记进 edgeList；
       其余都是同一行的水平短线，不可能碰到别的行的珠子，**不必登记**。 */
  const placeChain = (br, pPos, row) => {
    let n = br.head;
    for (let k = 0; k < br.ds.length; k++) {
      const d = br.ds[k];
      put(n, d, row);
      if (k === 0) edgeList.push({ p: pPos.n, c: n });
      n = (n._cs && n._cs[0]) || null;
      if (!n) break;
    }
  };

  /* ---------- ② 主变：占第 0 行，沿 _cs[0] 一路往右 ----------
     ⚠️ 虚拟根（branchRoot）**不入格、不占列** —— 它只是"所有支的共同起点"。
        曾被写成"put 之后再 pop/delete"，那样列 0 会被它白占一格、第 1 手的连线也少一段。 */
  {
    let n = branchRoot, d = 0;
    for (;;) {
      const cs = n._cs || [];
      if (!cs.length) break;
      n = cs[0]; d += 1;
      put(n, d, 0);
    }
  }

  /* ---------- ③ 收集所有"要画的支"（链深度列表只算一次），按展开时间倒序逐个放 ---------- */
  const all = [];
  const chainDepths = (head, depth0) => {
    const ds = [];
    let n = head, d = depth0;
    for (;;) { ds.push(d); if (!n._cs || !n._cs.length) break; n = n._cs[0]; d += 1; }
    return ds;
  };
  (function collect(node, depth) {
    const cs = node._cs || [];
    if (!cs.length) return;
    if (treeIsOpen(node)) {
      for (let i = 1; i < cs.length; i++) {
        all.push({ head: cs[i], parent: node, depth0: depth + 1, ds: chainDepths(cs[i], depth + 1) });
      }
    }
    for (const c of cs) collect(c, depth + 1);
  })(branchRoot, 0);

  /* ★★★★ 排序方向：**倒序**（后展开的先放）—— 这一条我改错过一次，记下来别再翻：
     · **倒序（后展开的先放）**：最后展开的那条先占最靠上的空行 → 它永远在最上面；
       先展开的后放，只能捡下面的空位 ⇒ 正是首相要的"先展开的被后展开的挤下去"。
     · 正序（先展开的先放）**只有配合"插入让位"才成立**；一旦去掉插入（为了保零接触），
       正序就变成"先来先占、后来的往下排"，**正好反了** —— 实测 T12 直接挂。
     ⚠️ 同一序号（都是自动展开的）保持收集顺序 = 手数顺序：靠前的分叉先放、拿靠上的行。
     ⚠️ 父必须先于子放置（子支要从"父行 + 1"起算），所以**分轮**放：
        这一轮父还没落地的先跳过，下一轮再来。最多 20 轮；**一轮没进展就收工**，绝不死循环。 */
  all.sort((a, b) => expandSeqOf(b.parent) - expandSeqOf(a.parent));

  /* ★★★★ 同一父的侧支：行号必须**连续**（一个挨一个往下排，中间不留空行）。
     为什么这条是硬的：同一个父下面的几条支，**第 1 颗珠子在同一列上**（都是父的下一手）。
     只要某个兄弟的行号落在另外两个兄弟**中间**，外面那条的入线就会从它旁边擦过去 ——
     实测明细：
        线 第4手(行0)→第5手(行5) 跨 5 行，碰到同在第 5 手、行 4 的那颗，距离只有 **6.7px**（珠半径 12）
        线 第4手(行0)→第5手(行6) 跨 6 行，碰到同在第 5 手、行 5 的那颗，距离只有 **5.6px**
     行号连续之后，每条入线只跨 1 行，**必然不碰**。
     ⚠️ `nextFree` 要**跨轮保留**（同一父的支可能分在不同的轮里落地）。 */
  const nextFree = new Map();                        // 父 → 下一个兄弟该用的最小行号
  let rest = all;
  for (let pass = 0; pass < 20 && rest.length; pass++) {
    const next = [];
    for (const b of rest) {
      const pPos = treePosOf.get(b.parent);
      if (!pPos) { next.push(b); continue; }        // 父还没被画出来 → 等下一轮
      const nf = nextFree.get(b.parent);
      const r = findRow(b, pPos, nf === undefined ? pPos.r + 1 : nf);
      nextFree.set(b.parent, r + 1);                 // 下一个兄弟至少从 r+1 起
      placeChain(b, pPos, r);
    }
    if (next.length === rest.length) break;          // 没有进展 → 收工
    rest = next;
  }

  /* ★ 左右各留一点边（首相 2026-10-14：左上那颗珠子原来零距离贴边，
     连它上面的折叠角标都被切掉）。 */
  treeTotalW = TREE_PAD_X * 2 + 6 + Math.max(1, treeMaxDepth) * TREE_W;
}

let treePosOf = new Map();
let treeTotalW = 0;

/* 珠子行中线（连线要按它接进珠心；列方向各处直接写 TREE_PAD_X + 6 + (d-1)*TREE_W，口径一致）
   ★ 2026-10-14：顶部加 TREE_PAD_Y —— 第一行的珠子原来紧贴上边，折叠角标被切掉一半。 */
const stoneCy = r => TREE_PAD_Y + 4 + r * TREE_H + STP / 2;
/* ★ 2026-10-14：珠子所在列的左上角 x（唯一口径，画线与画珠子都用它，免得对不齐） */
const stoneX = d => TREE_PAD_X + 6 + (d - 1) * TREE_W;

/* 画可见窗口内的珠子与连线。珠子定尺寸 + 列距固定 → 窗口按 scrollLeft / TREE_W 直接算列号。 */
function treePaint() {
  const box = $('branch-tree');
  if (!box || box.hidden) return;
  const inner = box.firstElementChild;
  if (!inner) return;
  /* 虚拟化只画看得见的列。★ 列坐标一律走 stoneX()（含左边距），避免两处算法对不齐。 */
  const d0 = Math.max(1, Math.floor((box.scrollLeft - TREE_PAD_X) / TREE_W));
  const d1 = Math.min(treeMaxDepth,
    Math.ceil((box.scrollLeft + box.clientWidth - TREE_PAD_X) / TREE_W) + 1);
  const curNode = state.viewAt > 0 ? state.moves[state.viewAt - 1] : null;

  /* 主变链 = 从根沿每层 _cs[0] 一路到底。链上的珠子带**金色外圈**（首相 2026-10-13 定的）——
     「哪一串是我的主线」一眼可辨，侧支的珠子没有金圈。
     ⚠️ 比的是节点身份，不能比坐标：同一坐标可能在两条支上都出现（坑位 26 同源教训）。 */
  const mainSet = new Set();
  for (let cur = branchRoot._cs && branchRoot._cs[0]; cur; cur = cur._cs && cur._cs[0]) mainSet.add(cur);

  /* ★★★ 2026-10-15 首相要求（原话）：「选中某条分支中某一手时，一直到这手，其灰色线都要
     高亮为绿色线……其自身往上追溯到主干的第一手，其自身还有叔叔伯伯，那边的就不亮；
     其下面往后的手也不亮，只高亮到此手。还有，高亮绿线，**不是**高亮沿途的棋子外圈，
     只有选中手才高亮外圈，沿途只亮绿线（就是珍珠串的线）即可。」
     ▸ 做法：把「当前显示的那一手 → 一路沿 `_p` 上溯到主干第一手」这条**直系链**上的节点
       收进 hotSet；画线时按"**边的下端（子节点）**在不在 hotSet 里"决定加不加 `ln-hot`。
     ▸ 三个"不亮"天然成立，不需要另写判据：
        · 叔叔伯伯那条支的节点根本不在链上 → 不亮；
        · 选中手**下面**的手也不在链上 → 不亮；
        · 沿途只给**线**加类，珠子一个都不动 —— 外圈只有 `.cap.cur` 那一颗，正是选中的那手。
     ⚠️ 起点取 `state.moves[state.viewAt - 1]`（**当前正在看的那一手**），不是末手 ——
        回看时高亮要跟着"正在看的那一手"走。 */
  const hotSet = new Set();
  {
    let n = state.viewAt > 0 ? state.moves[state.viewAt - 1] : null;
    while (n && !n._virtual) { hotSet.add(n); n = n._p; }
  }

  let html = '';
  /* ① 连线先画（珠子后画、压在它上面 —— 线从**珠心穿到珠心**，两端被珠子盖住，
     看上去就是手串的绳把珠子一颗颗穿起来，首相 2026-10-13 看图二定的口径）。
     · 同航道（父与本节点同一行）= 一段水平线；
     · 侧支起头 = 从父珠心**垂直下落**到本行中线，再水平接进本珠心。
     ★ 2026-10-14：布局改成"侧支独占一行"之后，下落线段的两侧永远是**空行**，
       所以这两笔**不可能再压到别的珠子上** —— 旧做法那套避让（pickRow）连同交叉一起删掉了。 */
  const cx = d => stoneX(d) + STP / 2;                 // 某列珠子的中心 x
  for (const c of treeCells) {
    if (c.depth < d0 || c.depth > d1) continue;
    const m = c.node, p = m._p;
    if (!p || p._virtual) continue;                    // 第一手不画入线（串的头）
    const pp = treePosOf.get(p);
    if (!pp) continue;
    const x0 = cx(pp.d), x1 = cx(c.depth), cy = stoneCy(c.row);
    if (pp.r === c.row) {
      /* 同一条航道：父珠心 → 本珠心。主变那段带金色调，呼应金圈。 */
      html += `<div class="ln ${mainSet.has(m) ? 'ln-main' : ''}${hotSet.has(m) ? ' ln-hot' : ''}" style="left:${x0}px;top:${cy - 1}px;width:${x1 - x0}px"></div>`;
    } else {
      /* ★★★ 2026-10-14 晚（首相硬要求：「**没有关系的手一定不要碰到**，一旦碰到就搞不清楚哪是哪」）：
       * 侧支这条线**改成斜线**（父珠心 → 子珠心，一笔连过去）。
       *
       * 【为什么不能再用"先垂直下落、再水平接入"】在"每支独占一行"的布局里，
       *   同一列会被**多条支**经过（不同支在同一深度各有一个节点）。所以垂直下落线
       *   **必然**从那些珠子上穿过去 —— 这不是判据能修的：实测把行号从 2 一直避到 14，
       *   照样躲不开（列上那些珠子是别的支的，躲到哪一行都在那条列上）。
       *   斜线则走的是**两颗珠子之间的斜向空白**，不沿任何整列走 —— 这才是"碰不到"的解法。
       * ⚠️ 用 transform 旋转一条 div 来画（不引 SVG，改动最小）；
       *   `transform-origin:0 0` 让它绕自己的左端转，长度按两点距离算。 */
      const py = stoneCy(pp.r);
      const dx = x1 - x0, dy = cy - py;
      const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      html += `<div class="ln ln-br${hotSet.has(m) ? ' ln-hot' : ''}" style="left:${x0}px;top:${py - 1}px;width:${len}px;`
        + `transform:rotate(${ang.toFixed(2)}deg);transform-origin:0 0"></div>`;
    }
  }
  /* ② 珠子：手数印在珠心、用**相反色**（黑子白字 / 白子黑字，首相定的画法）。
     坐标 / 胜率增减不挤在珠子上 —— 悬停浮层给（treePaint 只画 d0..d1 的列 = 虚拟化）。 */
  for (const c of treeCells) {
    if (c.depth < d0 || c.depth > d1) continue;
    const m = c.node;
    const cs = m._cs || [];
    /* ★ 2026-10-14 深夜：默认收起 → 角标**默认就是「+n」**（有 n 条侧支，点开），
       展开之后才变「▾」。所以 `folded` 现在是**常态**，不再是异常态。 */
    const open = treeIsOpen(m);
    const folded = cs.length > 1 && !open;
    const fold = cs.length > 1
      ? `<i class="tf" data-fold="1" title="${folded ? '展开侧支（' + (cs.length - 1) + ' 条）' : '收起侧支（' + (cs.length - 1) + ' 条）'}">${folded ? '+' + (cs.length - 1) : '▾'}</i>`
      : '';
    html += `<div class="cap s${m.color} ${m === curNode ? 'cur' : ''} ${mainSet.has(m) ? 'main' : ''} ${folded ? 'folded' : ''}"`
      + ` data-d="${c.depth}" data-r="${c.row}" style="left:${stoneX(c.depth)}px;top:${TREE_PAD_Y + 4 + c.row * TREE_H}px">`
      + (state.treeNum ? `<b>${moveLabelOf(m)}</b>` : '') + fold + '</div>';
  }
  inner.innerHTML = html;
}

/* 渲染入口：syncUI 每次刷手数列表时顺带刷树（树没打开就直接跳过，零开销）。
 *
 * ★★ 2026-10-14 首相报的「展开收起分支的时候视野会自动跳到最后去」—— 两个成因都在这里：
 *   ① **折叠后树变矮/变窄** → 浏览器把 `scrollTop` / `scrollLeft` **自动夹到新的最大值**
 *      → 视野"啪"地贴到底/贴到右（首相看到的"跳到最后"就是这个）；
 *   ② 下面那段还会主动"把当前手滚进视野" —— 用户明明在看别处（刚翻到某个分支），
 *      一折叠就被**拉回当前手**，感觉像被抢了方向盘。
 *   修法：**"要不要自动滚动"只在"当前手真的换了（或面板尺寸变了）"时才做**；
 *   其余重绘（折叠/展开、行数变化）一律**保住原来的滚动位置**，只把它夹回合法范围。
 *   ⚠️ 为什么 sig 里要带 `clientWidth`：开关放大窗时容器尺寸大变，
 *      那种情况**恰恰应该**重新把当前手居中（宽度不同，"看得见哪一段"完全不同）。 */
let treeScrollSig = '';
function renderMoveTree() {
  const box = $('branch-tree');
  if (!box) return;
  if (movesView !== 'tree') return;
  const keepL = box.scrollLeft, keepT = box.scrollTop;    // ★ 先记下视野
  treeLayout();
  const inner = box.firstElementChild;
  inner.style.width = treeTotalW + 'px';
  /* ★ 2026-10-14：上下都留白（原来只留了底部 8px，顶部 0 —— 第一行的折叠角标被切掉）。 */
  inner.style.height = (TREE_PAD_Y * 2 + treeLanes * TREE_H) + 'px';
  treePaint();
  /* 当前手在不在树上（折叠可能正好把它折掉 → cell 为 undefined，那就更不该乱滚） */
  const curNode = state.viewAt > 0 ? state.moves[state.viewAt - 1] : null;
  const cell = curNode && treeCells.find(c => c.node === curNode);
  /* ★★ 2026-10-14 深夜修（首相：「有时候点个收起或者展开会直接**视野跳到最后**」）：
     sig 原来**带 `cell.row`**（当前手所在的行号）—— 而"展开/收起"必然改变行号
     （行分配是整体重算的，新算法还会"插入一行让位"，行号动得更厉害），
     于是每点一次角标：sig 变 → `shouldFollow` 为真 → **主动把当前手滚进视野**。
     用户明明在看别处，视野"啪"地跳到当前手那一片 —— 他描述的就是这个。
     **行号变了不代表用户想换视野**，它只是布局重算的副作用。
     所以 sig 里只留三个"真的该重新定位"的信号：
       · `clientWidth` —— 开关放大窗（宽度大变，"看得见哪一段"完全不同）
       · `recName`     —— 换棋谱
       · `viewAt`      —— 当前手真的换了
     ⚠️ 护栏断言：`_inject_tree1014.js` 的 S1。 */
  const sig = box.clientWidth + '|' + (state.recName || '') + '|' + state.viewAt;
  const shouldFollow = (sig !== treeScrollSig) && box.clientWidth > 0;
  treeScrollSig = sig;

  if (cell && shouldFollow) {
    /* 当前手换了（或面板尺寸变了）→ 主动把它滚进视野 */
    const x = stoneX(cell.depth);
    if (x < box.scrollLeft + STP || x > box.scrollLeft + box.clientWidth - STP - 2) {
      box.scrollLeft = Math.max(0, x - box.clientWidth / 2);
    }
    const y = TREE_PAD_Y + 4 + cell.row * TREE_H;
    if (y < box.scrollTop || y + TREE_H > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, y - box.clientHeight / 2 + TREE_H / 2);
    }
  } else {
    /* 其余情况（折叠/展开、重画）：**只夹回合法范围，绝不主动挪** */
    const maxL = Math.max(0, treeTotalW - box.clientWidth);
    const maxT = Math.max(0, (TREE_PAD_Y * 2 + treeLanes * TREE_H) - box.clientHeight);
    box.scrollLeft = Math.min(keepL, maxL);
    box.scrollTop = Math.min(keepT, maxT);
  }
}

/* ---- 分支树放大窗口（2026-10-14 首相要求「展开一个大窗口方便找分支」）----
 *
 * 起因：树面板挤在左栏（370 多 px），打谱谱变着多时要一点一点横向挪着找，很难受。
 *
 * ★★ 做法：**把 `#branch-tree` 这个元素整个搬进弹窗**，关掉再搬回原位。
 *   为什么不"在大窗里再渲染一份"：`#branch-tree` 上挂着一大堆交互 ——
 *     点珠子跳转、右键菜单（提升主变 / 删除分支）、按住右键拖动平移、悬停浮层，
 *   而且 id 是写死的、`treeCells` / 虚拟化窗口 / 自动滚动全都按它算。
 *   **搬家之后这些一行都不用改**，也不会出现"小窗和大窗两份状态不同步"这种最难查的 bug。
 *
 * ⚠️ 搬回来必须插到**原来的位置**（记住 nextSibling），否则它会跑到卡片末尾去。
 * ⚠️ 搬完必须重绘：容器尺寸变了，虚拟化只画"看得见的那几列"——
 *    不重算就还是按旧宽度画，大窗右边一片空白。 */
let treeZoomOn = false;
let treeZoomHome = null;                     // { parent, next } —— 原位置，搬回来用

function setTreeZoom(on) {
  const box = $('branch-tree');
  const mask = $('treezoom');
  const slot = $('treezoom-slot');
  if (!box || !mask || !slot) return;
  if (on === treeZoomOn) return;             // 幂等：重复点不会把元素搬丢
  if (on) {
    if (movesView !== 'tree') { flash('先切到「树」视图，再点放大'); return; }
    treeZoomHome = { parent: box.parentNode, next: box.nextSibling };
    slot.appendChild(box);                   // ★ 搬家（同一个元素，事件与状态全都跟着走）
    mask.classList.add('open');
    treeZoomOn = true;
  } else {
    const home = treeZoomHome;
    /* 原位插回去。next 可能已经被移走/移除（换过棋谱之类），所以两头都验一下。 */
    if (home && home.parent && home.parent.isConnected) {
      const next = (home.next && home.next.isConnected) ? home.next : null;
      home.parent.insertBefore(box, next);
    }
    mask.classList.remove('open');
    treeZoomOn = false;
    treeZoomHome = null;
  }
  /* 尺寸变了 → 虚拟化窗口要重算，否则只画原来那么几列 */
  requestAnimationFrame(() => { renderMoveTree(); });
}

/* 点胶囊 → 跳到那一手。不在当前路径上时，自下而上逐段 switchBranch 把路铺过去
   （switchBranch 要求「分叉点在当前路径上」，所以从最近的祖先开始切）。 */
function gotoNode(node) {
  if (state.draft) { flash('试下中不能切分支 —— 先点「退出试下」'); return; }
  ensureBranch();
  const depth = nodeDepth(node);
  if (pathIndexOf(node) >= 0) { gotoView(depth); return; }
  const steps = [];
  let cur = node;
  while (cur && !cur._virtual && pathIndexOf(cur) < 0) {
    const p = cur._p;
    steps.unshift({ at: nodeDepth(p), j: p._cs.indexOf(cur) });
    cur = p;
  }
  /* ★★ 2026-10-14 深夜修一个既有 bug（写新断言的测试脚本时踩出来的）：
     原来这一行是 `for (const s of steps) if (!switchBranch(s.at, s.j)) return;` ——
     而 `steps` 里会包含**只有一条分支的点**（那种点 `switchBranch` 会拒绝并 flash
     「这一点还没有分支」，见内核里 `if (sib.length < 2) return false`）。
     后果很难查：**路径已经切了一半、`gotoView(depth)` 却没执行**，状态停在中间，
     接着落子就挂到了错误的父节点上（实测：主线莫名其妙多出一手，支线凭空消失）。
     现在：单分支的点**直接跳过** —— 父节点定下来之后，`pathThrough` 会沿 `_cs[0]`
     把整条路铺到底，本来就不需要在那种点上切。 */
  for (const s of steps) {
    const par = branchParentAt(s.at);
    const sib = (par && par._cs) || [];
    if (sib.length < 2) continue;                  // 单分支点切不了，也不需要切
    if (!switchBranch(s.at, s.j)) return;
  }
  gotoView(depth);
}

/* C 键 / ▾ 角标：折叠「当前这一手」的侧支（主变那条永远画，折的是 _cs[1..]） */
function toggleTreeExpand(node) {
  if (!node || !(node._cs && node._cs.length > 1)) { flash('这一手之后没有侧支，没得展开'); return; }
  /* ★ 默认收起：第一次点 = 展开（进集合），再点 = 收起（出集合）。
     ⚠️ 当前手正走在这条支上的节点**收不起来**（treeLayout 的 forceOpen 会把它顶回来）——
        与其点了没反应，不如直说。 */
  if (treeExpanded.has(node)) {
    if (treeForceOpen.has(node)) { flash('当前手走在这条支上，先跳到别处再收起'); return; }
    treeExpanded.delete(node);
    treeExpandSeq.delete(node);
  } else {
    treeExpanded.add(node);
    treeExpandSeq.set(node, ++treeExpandCounter);   // ★ 记下"什么时候展开的" → 后展开的先挑行
  }
  renderMoveTree();
}

/* ★ 2026-10-14 深夜：放大窗里的「全部展开 / 全部收起」。
   默认收起之后，"想一次看全、找分支"就得给个开关 —— 只动**展开集合**，
   当前手那条路径由 treeLayout 每次重算（forceOpen），这里不用管。 */
function treeExpandAll(on) {
  treeExpanded.clear();
  treeExpandSeq.clear();
  if (on) {
    /* ⚠️ 序号按**手数顺序**发（靠前的分叉序号小）→ 行分配倒着来 → 靠前的分叉排在下面。
       这是"一次全展开"时唯一说得通的顺序：没有"最近展开"这回事，
       所以让"最后发的那个序号"落在最后 —— 也就是最靠主干。 */
    (function walk(n) {
      const cs = n._cs || [];
      if (cs.length > 1) { treeExpanded.add(n); treeExpandSeq.set(n, ++treeExpandCounter); }
      for (const c of cs) walk(c);
    })(branchRoot);
  }
  renderMoveTree();
}

/* 树面板的右键菜单：提升主变 / 删除分支（两段式）/ 撤销删除 —— 全调内核，不重写 */
let treeMenu = null, treeMenuNode = null;
function showTreeMenu(ev2, node) {
  ev2.preventDefault();
  closeTreeMenu();
  const depth = nodeDepth(node);
  /* ★ 主变判定必须走 onMainline（沿祖先链查到根）。旧写法 `node._p._cs[0] === node`
     只是局部判据 —— 侧支深处的珠子（首相实拍里的 11a）对它父亲同样是头一个孩子，
     却被误报成「已是主变」。2026-10-13 首相指出的 bug 1，根因就在这。 */
  const onMain = onMainline(node);
  const menu = document.createElement('div');
  menu.className = 'tree-menu';
  const item = (txt, fn, title) => {
    const b = document.createElement('button');
    b.textContent = txt; if (title) b.title = title;
    b.onclick = () => { fn(); };
    menu.appendChild(b); return b;
  };
  /* 内核（promoteToMainline / deleteBranchAt）都按**当前路径下标**取手，
     右键点的珠子多半不在当前路径上 —— 所以先 gotoNode 把路铺过去，再调内核。 */
  item(onMain ? '已是主变（第 ' + depth + ' 手）' : '设为主变（第 ' + depth + ' 手）', () => {
    if (!onMain) { gotoNode(node); promoteToMainline(depth); }
    closeTreeMenu();
  }, '把这一手所在的那条支提为主变（快捷键 PgUp）');
  /* ★ 2026-10-15（首相要求）：删除改成**弹窗确认**。
     原来这里是"两段式"——点一次只把按钮文案变成「再点一次确认删除」、上方 flash 一句；
     首相实测后明确要求："不弹是否确认删除的弹窗只在上方提醒一句，这不好，搞成确认弹窗和按钮"。
     于是：点这一项 → 关菜单 → 弹窗（写清第几手、共几手、能不能撤销）→ 【取消】/【删除】。
     ⚠️ 真删时走 `deleteBranchAt(depth, { force: true })`，跳过内核那段两段式登记。 */
  const delN = subtreeSize(node);
  item('删除分支（共 ' + delN + ' 手）', () => {
    closeTreeMenu();
    askDeleteBranch(node, depth, delN);
  }, '删掉这一手起的整枝（会先弹窗确认；删完可用 Ctrl+Shift+Z 撤销）');
  if (branchTrash) {
    item('撤销刚才删除的分支', () => { undoDeleteBranch(); closeTreeMenu(); },
      '放回最近删掉的整枝（连原来的位置，快捷键 Ctrl+Shift+Z）');
  }
  document.body.appendChild(menu);
  treeMenu = menu;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(ev2.clientX, window.innerWidth - mw - 6) + 'px';
  menu.style.top = Math.min(ev2.clientY, window.innerHeight - mh - 6) + 'px';
}
function closeTreeMenu() { if (treeMenu) { treeMenu.remove(); treeMenu = null; } }

/* 删除分支的确认窗（2026-10-15 首相要求：要看得见的问句 + 按钮，不能只 flash 一句）。
   · 为什么不用 `confirm()`：Electron 里它是**阻塞原生框**，整个渲染进程会卡住（见 askBatchPlan 的注释）；
   · 为什么不用 #batchask 那个通用窗：它被「全盘讲解」占着，那边有"正在用就不再重建"的保护，
     借来用会互相打架 —— 删除是棋局操作，跟讲解流程不该共用同一个 DOM；
   · ⚠️ 顺序：**先 gotoNode(node) 再删** —— 内核 deleteBranchAt 按"当前路径下标"取手。 */
function askDeleteBranch(node, depth, n) {
  const mask = $('delbranch');
  if (!mask) {                                   // 兜底：万一弹窗元素没在（改了 HTML）就直接删
    gotoNode(node);
    return deleteBranchAt(depth, { force: true });
  }
  if (mask.classList.contains('open')) return;   // 连点两次不重入
  const close = () => mask.classList.remove('open');
  $('db-body').innerHTML =
    '<p>确定删掉<b>第 ' + depth + ' 手</b>起的整条分支吗？</p>'
    + '<p>这一枝一共 <b>' + n + '</b> 手（含它后面的全部变化）。</p>'
    + '<p class="dim">删完可以按 <b>Ctrl+Shift+Z</b>、或再次右键点「撤销刚才删除的分支」放回来 —— '
    + '连它原来的位置一起还原，不影响别的支。</p>';
  $('db-ok').onclick = () => {
    close();
    gotoNode(node);
    deleteBranchAt(depth, { force: true });
  };
  $('db-cancel').onclick = close;
  mask.onclick = e => { if (e.target === mask) close(); };   // 点遮罩空白处 = 取消（与其它弹窗一致）
  mask.classList.add('open');
  if ($('db-cancel').focus) $('db-cancel').focus();
}
document.addEventListener('click', closeTreeMenu);

/* 面板接线：滚动重画 + 点珠跳转 + ▾ 折叠 + ★悬停浮层 + ★右键平移画布 */
let treeTip = null;
function cellOfCap(cap) {
  const d = +cap.dataset.d, r = +cap.dataset.r;
  return treeCells.find(c => c.depth === d && c.row === r);
}
function hideTreeTip() { if (treeTip) treeTip.hidden = true; }
/* 悬停浮层（首相定的分工：珠子只放手数，细节全进浮层 —— 直观与数据两全） */
function showTreeTip(cap, ev2) {
  const cell = cellOfCap(cap);
  if (!cell) { hideTreeTip(); return; }
  const m = cell.node, depth = cell.depth;
  if (!treeTip) {
    treeTip = document.createElement('div');
    treeTip.className = 'bt-tip';
    treeTip.hidden = true;
    document.body.appendChild(treeTip);
  }
  const pt = m.pass ? '停一手' : GTP_COLS[m.x] + (N - m.y);
  const side = m.color === 'b' ? '黑' : '白';
  const bi = depth > 0 && m._p && m._p._cs.length > 1
    ? (' · 这一点共 ' + m._p._cs.length + ' 种走法，这是第 ' + (m._p._cs.indexOf(m) + 1) + ' 种') : '';
  const dl = nodeDeltaTxt(m, depth);
  const win = nodeWinAt(m, depth);
  /* ★ 目损：复盘数据**只覆盖跑复盘时那一条线（主线）**，而且是按手号存的。
     判据必须是「在不在主变链上」，不能是「在不在当前路径上」—— 切到旁支后
     `pathIndexOf(m) >= 0` 照样成立，取到的却是主线那一手的目损（坑位 39，与手数列表同源）。
     旁支宁缺勿假：不显示目损，只显示跟着分支走的胜率增减（那条走 `_an` 寄/还原，是对的）。 */
  const i = pathIndexOf(m);
  const loss = (state.review && i >= 0 && onMainline(m) && !state.draft) ? state.review.losses[i] : null;
  let html = `<b>${moveLabelOf(m)} 手 · ${side} ${pt}</b>${bi}`;
  html += dl === null
    ? '<span class="dim">胜率还没算到这一手</span>'
    : `<span class="${dl < 0 ? 'bad' : 'good'}">这一手${dl < 0 ? '亏 ' : '赚 '}${Math.abs(dl).toFixed(1)}% 胜率</span>`;
  if (typeof loss === 'number' && loss >= 0.05) html += `<span class="dim">复盘目损 ${loss.toFixed(1)} 目</span>`;
  if (typeof win === 'number') html += `<span class="dim">此后黑胜率 ${(win * 100).toFixed(1)}%</span>`;
  if (m._ex || (state.coach.explain && state.coach.explain[depth])) html += '<span class="dim">✓ 已讲解</span>';
  treeTip.innerHTML = html;
  treeTip.hidden = false;
  moveTreeTip(ev2);
}
function moveTreeTip(ev2) {
  if (!treeTip || treeTip.hidden) return;
  const tw = treeTip.offsetWidth, th = treeTip.offsetHeight;
  let x = ev2.clientX + 14, y = ev2.clientY + 12;
  if (x + tw > window.innerWidth - 6) x = ev2.clientX - tw - 10;
  if (y + th > window.innerHeight - 6) y = ev2.clientY - th - 10;
  /* ★ 翻转之后还要**夹回视口**（2026-10-13 DSH 补，段③ 尾巴之一）。
     原先只做了"贴右/下缘就翻到另一边"—— 可鼠标贴着**左缘/上缘**时，
     翻转算出来的 x/y 会是负数 → 浮层整个跑出屏幕，看着就是"悬停了但没提示"。
     翻转与夹取是两件事，都要有：翻转决定往哪边放，夹取保证放得进来。 */
  x = Math.max(6, Math.min(x, window.innerWidth - tw - 6));
  y = Math.max(6, Math.min(y, window.innerHeight - th - 6));
  treeTip.style.left = x + 'px';
  treeTip.style.top = y + 'px';
}
function initBranchTree() {
  const box = $('branch-tree');
  if (!box) return;

  /* ★ 2026-10-14 放大窗的三个入口（首相要求「展开一个大窗口方便找分支」）：
       · 标题栏那个「⤢ 放大」按钮（再点一次收起）
       · 大窗右上角的「收起」
       · Esc 键（见键盘处理那段）
     点遮罩空白处也收 —— 与项目里其它弹窗一致的习惯。 */
  if ($('btn-treezoom')) $('btn-treezoom').onclick = () => setTreeZoom(!treeZoomOn);
  if ($('btn-treezoom-close')) $('btn-treezoom-close').onclick = () => setTreeZoom(false);
  /* ★ 2026-10-15 首相：**删掉「全部展开」**（"那个没有用"），只留「全部收起」（"那个有用"）。
     全部展开在这个规模下本来也没意义 —— 真实棋谱 457 条支、两千多行，铺开也看不了。
     ⚠️ `treeExpandAll(false)` 保留（全部收起要用）；`treeExpandAll(true)` 现在没有调用方，
        函数留着（回退方便），但界面上不再暴露。 */
  if ($('btn-tree-none')) $('btn-tree-none').onclick = () => treeExpandAll(false);
  if ($('treezoom')) {
    $('treezoom').addEventListener('click', e => { if (e.target === $('treezoom')) setTreeZoom(false); });
  }

  box.innerHTML = '<div class="bt-inner"></div>';
  box.addEventListener('scroll', () => {
    if (treeRaf) return;
    treeRaf = requestAnimationFrame(() => { treeRaf = 0; treePaint(); });
  });
  /* 左键点珠子 → 跳到那一手；点珠角 ▾/+n → 折叠/展开侧支 */
  box.addEventListener('click', e => {
    if (treeDragMoved) return;               // 刚用右键拖完画布 —— 落点不是"点击"
    const cap = e.target.closest('.cap');
    if (!cap) return;
    const cell = cellOfCap(cap);
    if (!cell) return;
    if (e.target.closest('.tf')) { toggleTreeExpand(cell.node); return; }
    gotoNode(cell.node);
  });
  /* ★ 右键 = 平移画布（首相 2026-10-13：按住右键往哪拖，画布就往哪移动，镜头不动）。
     和「原地右击弹菜单」的区分：按下后位移 > 4px 判定为拖动；原地松开才弹菜单。 */
  let pan = null;
  box.addEventListener('mousedown', e => {
    if (e.button !== 2) { treeDragMoved = false; return; }   /* 左键按下也重置标志：
       否则「右键拖完画布」的 treeDragMoved=true 会一直挂着（右键不产生 click，
       没人消费它），下一次左键点珠子被当作拖动吞掉 —— 实测过的坑。 */
    pan = { x: e.clientX, y: e.clientY, sl: box.scrollLeft, st: box.scrollTop };
    treeDragMoved = false;
    box.classList.add('panning');
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!treeDragMoved && Math.abs(dx) + Math.abs(dy) > 4) treeDragMoved = true;
    if (treeDragMoved) {
      /* 内容跟着鼠标走：往右拖 → scrollLeft 减小（画布右移） */
      box.scrollLeft = pan.sl - dx;
      box.scrollTop = pan.st - dy;
      hideTreeTip();
    }
  });
  window.addEventListener('mouseup', () => {
    box.classList.remove('panning');
    pan = null;
  });
  box.addEventListener('contextmenu', e => {
    e.preventDefault();                        // 浏览器原生菜单一律不弹（这块是画布）
    if (treeDragMoved) { treeDragMoved = false; return; }   // 拖过 → 是平移，不弹菜单；标记就地消费掉
    const cap = e.target.closest('.cap');
    if (!cap) return;                          // 空白处原地右击 → 什么都不弹
    const cell = cellOfCap(cap);
    if (cell) showTreeMenu(e, cell.node);
  });
  /* 悬停浮层（拖动画布期间不弹 —— 鼠标在珠子上划过会一路触发 mouseover） */
  box.addEventListener('mouseover', e => { if (treeDragMoved) return; const cap = e.target.closest('.cap'); if (cap) showTreeTip(cap, e); });
  box.addEventListener('mousemove', e => { const cap = e.target.closest('.cap'); if (cap && !treeDragMoved && treeTip && !treeTip.hidden) moveTreeTip(e); });
  box.addEventListener('mouseleave', hideTreeTip);
}
let treeDragMoved = false;

/* ---------------- 落子 ---------------- */

function tryPlay(x, y, byAI) {
  /* ★ 还没开局：棋盘点了不该有反应（用户要求：启动后先停在「未开局」，
     得先新建对局或打开棋谱）。AI 不会在这个状态下落子，所以只提示人手点的情况。 */
  if (state.noGame) {
    if (!byAI) flash('还没开局 —— 点棋盘中间的「新建对局」开始');
    return false;
  }
  /* ★★ 手数分支（2026-10-13 首相指定）：把「回看中不能落子」这条闸门改成**从这一点开新分支**。
     为什么能这么省：与进试下同源 —— 先把主线**截到回看点**，落子于是走下面那套
     「末端落子」，一行都不用改；而旧分支那一整枝仍然挂在节点的 `_cs` 里（树不丢），
     ↑/↓ 随时切回来。用户原话：「回看时要能试下，试下不进分支，退出后正常落子才开新分支」。
     ⚠️ 试下（草稿）期间不适用：草稿本来就「不进分支树」（决策 10），维持原样挡回去。 */
  let forked = -1;
  if (state.viewAt !== state.moves.length) {
    if (state.draft) { flash('回看中不能落子，先跳到最新'); return false; }
    forked = state.viewAt;
    ensureBranch();
    stashExplainAfter(forked);                     // 先把尾巴的讲解寄到各自节点上（防串）
    stashAnalysisAfter(forked);                    // ★ 段②：评估同样寄走（尾巴那一枝还在树里，切回去要能用）
    state.moves.length = forked;
    state.toMove = sideToMove(forked);
    state.koPoint = koFromBoard(boardAt(forked), state.moves, forked);
    state.pv = null;
    truncateAnalysisTo(forked);                    // 评估缓存按手号存，跨分支会串 → 分叉点之后作废
  }

  /* 人机对弈模式下，只能下自己那一方（AI 自己落子时用 byAI 跳过这个检查）
     试下（打草稿）时不受限制 —— 试下就是要两边都摆一摆 */
  if (!byAI && !state.draft && settings.mode === 'play' && !isMyTurn()) {
    flash('现在轮到' + (sideToMove(state.viewAt) === 'b' ? '黑棋' : '白棋') + '，对手还没下');
    return false;
  }

  const b = boardAt(state.moves.length);
  if (b[idx(x, y)] !== 0) return false;

  /* ★★★ 打劫禁着点（2026-10-15 修「倒扑被当成劫」后的最终形态）
     —— 判据**照主流开源软件 Sabaki 的 @sabaki/go-board（GoBoard.js 第 82-93 行）来**：
       提子数 == 1  且  落下的这子是**孤子**（四邻没有己方子）
        且  它落子后**只有 1 口气**  且  这口气正是刚被提掉的那一点
     四条同时成立才算「这一手制造了劫」。几何含义很直白：
       我这子孤零零一口气，对方下那一口气就能把我提回原样 —— 这才是劫。

     ⚠️ 上一版的四行只用了「这一点 == 上一手的提子点」一条，于是：
       白 84 扑（W[mi]）→ 黑 85 提掉这一子（提 1 子，禁着点被设到 (12,8)）
        → 白 86 点回 (12,8)、本该提走 7 颗黑子（黑 40 → 33），却被判「打劫，不能下」。
     缺的正是「孤子」那条：黑 85 提子后**连着己方大块**，对方点回提走的是整块，局面不重复。

     ★ 为什么用 Sabaki 判据而不是原来那条 KaTrain 式（`落点==上一手提子点 && 本手提1子`）：
       两者在本场景下可证等价，但 Sabaki 判据**只读当前盘面**，
       不碰 `prev.captured` / `prev.capAt` 这两个"要靠 rebuildCapAt 补算"的历史字段 ——
       打开棋谱接着摆、悔棋、切分支时都不会失效（那些正是历史上打劫判据反复翻车的地方）。
       所以下面那条 KaTrain 判据已删，判据只有一个来源，见函数末尾与 koFromBoard()。

     回归：dev/_cdp_ko.mjs（真实棋谱 + 真劫对照 + 构造倒扑 + Sabaki 原始测试棋形）。 */
  if (state.koPoint && state.koPoint.x === x && state.koPoint.y === y) {
    flash('打劫：不能立刻提回，得先在他处走一手');
    return false;
  }

  const c = state.toMove === 'b' ? 1 : 2;
  b[idx(x, y)] = c;

  let captured = 0, capAt = null;
  for (const [nx, ny] of neighbors(x, y)) {
    if (b[idx(nx, ny)] === 3 - c) {
      const gp = group(b, nx, ny);
      if (gp.libs.size === 0) {
        captured += gp.stones.length;
        if (!capAt) capAt = { x: nx, y: ny };      // 只记**第一块**（与 rebuildCapAt 同口径）
        gp.stones.forEach(k => { b[k] = 0; });
      }
    }
  }
  // 提子后自己仍无气 → 自杀，非法（中国规则/日韩规则都禁自杀）
  const myGroup = group(b, x, y);
  if (myGroup.libs.size === 0) return false;

  /* ★ 这一手有没有**制造劫**（Sabaki 判据，四条缺一不可）—— 制造了才把禁着点设到那一点。
     ① 本手只提 1 子            ② 落下的这子是孤子（四邻没有己方子）
     ③ 它落子后只有 1 口气       ④ 那口气正是刚提掉的那一点（= 对方回提就能还原局面）
     缺哪一条都不是劫，典型就是倒扑：提完连着己方大块（②不成立）→ 对方点回提走整块，局面不重复。 */
  const onlyLib = (myGroup.libs.size === 1) ? [...myGroup.libs][0] : -1;
  const 这一手制造了劫 = captured === 1 && !!capAt
    && onlyLib >= 0 && onlyLib === idx(capAt.x, capAt.y)
    && neighbors(x, y).every(([nx, ny]) => b[idx(nx, ny)] !== c);
  state.koPoint = 这一手制造了劫 ? { x: capAt.x, y: capAt.y } : null;

  /* ★ 落子 = 建节点并挂进树（决策 9：与父亲下已有的**同着** → 跳过去，不建重复）
     ★★ 段②（2026-10-13）：**试下（草稿）的手不挂树** —— 只 push 一个裸节点。
     与 ensureBranch 里那道「串到草稿起点就停」是同一件事的两半，缺一条就漏。
     挂在 `if (state.draft)` 之外的那一支，是**正式落子**（含从回看点岔出的新分支）。 */
  if (state.draft) {
    /* ★ 草稿手也要带 `_p`/`_cs`（值为空/假）—— 它**不是**树的一部分
       （父的 `_cs` 里没有它，从根走不到），但手数列表会拿它当"父节点"去问有没有旁支，
       少这两个字段就是 TypeError 白屏（见 branchParentAt 的注释）。 */
    state.moves.push({ x, y, color: state.toMove, captured, capAt: capAt || undefined, _p: null, _cs: [] });
  } else {
    ensureBranch();
    const ndParent = state.moves.length ? state.moves[state.moves.length - 1] : branchRoot;
    let ndNew = null;
    for (const c of ndParent._cs) { if (!c.pass && c.x === x && c.y === y) { ndNew = c; break; } }
    if (!ndNew) {
      ndNew = { x, y, color: state.toMove, captured, capAt: capAt || undefined, _p: ndParent, _cs: [] };
      ndParent._cs.push(ndNew);
    }
    state.moves.push(ndNew);
  }
  clearCoachAt(state.moves.length);      // 这个手号上的旧讲解作废（悔棋换了别的棋，见函数注释）
  clockSwitch();                         // 结算本手用时，换对方
  state.toMove = state.toMove === 'b' ? 'w' : 'b';
  state.pv = null;                       // 变化图只对当前局面有效，落了子就收掉
  state.viewAt = state.moves.length;
  syncUI();
  /* ★ 落子音效**放在重绘之后**起播（可在「显示」菜单里关掉）。
     为什么不能提前：syncUI 里要把整张盘重画一遍（形势雾是 N×N 逐点画，很吃主线程），
     而短音效只有 0.08~0.09 秒 —— 起播紧接着被主线程占住，开头会被啃掉，
     听感上就是「这一下怎么这么轻」。setTimeout 0 让它排在本帧绘制之后，
     人耳分辨不出这点延迟（见 playStoneSound 的注释②）。 */
  setTimeout(playStoneSound, 0);
  return true;
}

/* ---------- 从手顺反推禁着点（悔棋 / 打开棋谱之后要重算） ----------
   为什么需要它：打劫的禁着点是**由上一手决定的**，而悔棋会换掉上一手 ——
   所以悔棋之后必须重算，不能清成 null（清了就等于放行，用户 2026-10-07 报过）。
   反过来，悔棋**退掉一个"在别处走"的手**之后，劫其实又成立了，禁着点该回来。

   ★★ 判据与 tryPlay **完全一致**（2026-10-15 起统一成 Sabaki 那条"形状判据"）：
        最后一手提 1 子、落下的这子**是孤子**、它**只有 1 口气**、且那口气正是提掉的那一点。
      ⚠️ 不能用「上一手的提子点 == 落点」这种只比坐标的写法 —— 倒扑会被误判成劫，
         首相 2026-10-15 报的第 86 手就是这么被拦的（详见 tryPlay 里的长注释）。

   ⚠️⚠️ `at` = **盘面对应的手数**（省略 = 手顺长度）：`b` 必须是 boardAt(at)、
      `last` 必须是 moves[at - 1]。原来这个函数只读 moves 的**末尾**，而调用点
      （提升主变 / 删分支 / 撤销删除）传进来的盘面是 boardAt(viewAt) ——
      回看状态下两者整错开，算出来的是**另一个局面的禁着点**，
      于是要么错拦一个点、要么该拦的没拦。现在把 at 显式传进来，盘面与手一一对应。 */
function koFromBoard(b, moves, at) {
  const n = (at === undefined) ? moves.length : at;
  const last = moves[n - 1];
  if (!last || last.pass || last.captured !== 1 || !last.capAt) return null;
  const c = last.color === 'b' ? 1 : 2;
  if (b[idx(last.x, last.y)] !== c) return null;              // 保险：这一手已不在盘上（被提了）
  const libs = group(b, last.x, last.y).libs;
  if (libs.size !== 1) return null;                          // 我提子后不止一口气 → 不是劫
  if ([...libs][0] !== idx(last.capAt.x, last.capAt.y)) return null;   // 那口气不是被提点 → 不是劫
  if (neighbors(last.x, last.y).some(([nx, ny]) => b[idx(nx, ny)] === c)) return null;  // 不是孤子 → 不是劫
  return { x: last.capAt.x, y: last.capAt.y };
}

/* ★ 悔棋之后补上每手的 `capAt`（"这一手提掉了哪一点"）—— 打劫判据要用它。
   为什么需要补：`capAt` 是落子时算出来的，而 `boardAt()` 重放出来的旧棋谱
   （以及悔棋前存下来的手顺）里没有这个字段。没有它，`tryPlay` 里
   "是不是在上一手被提点回提"就永远为假 → 打劫形同失效
   （实测踩到：悔棋后能无视禁着点直接提劫，用户 2026-10-07 报过）。

   算法（最直白，不做任何推理）：
     对每一手，比"这一手走之前"和"走之后"的盘面 —— 在它**四邻**里，
     **之前是敌子、之后变空**的那一格，就是它提掉的那一点。
   ⚠️ 只在需要时调（悔棋后 / 打开棋谱后）。 */
function rebuildCapAt() {
  /* ※ 索引语义要记牢：`boardAt(n)` = **走完第 n 手之后**的盘面
     （`boardAt(0)` = 开局、还没走；`boardAt(1)` = 第 1 手走完）。
     所以对第 i 手（0-based 下标）：走之前 = `boardAt(i)`、走之后 = `boardAt(i + 1)`。
     ⚠️ 我第一版写成了 `boardAt(i)` / `boardAt(i-1)`，整个错开一手 ——
        于是 `capAt` 一个个都算不出来（实测：悔棋后打劫判据形同失效）。 */
  const before0 = () => {                      // 第 0 手"走之前"= setup 的盘面（等价 boardAt(0)）
    const b = new Int8Array(N * N);
    for (const s of state.setup) b[idx(s.x, s.y)] = s.color === 'b' ? 1 : 2;
    return b;
  };
  for (let i = 0; i < state.moves.length; i++) {
    const m = state.moves[i];
    m.capAt = undefined;
    if (m.pass) { m.captured = 0; continue; }                    // 停一手不提子
    const prevBoard = (i === 0) ? before0() : boardAt(i);        // 这一手之前
    const after = boardAt(i + 1);                               // 这一手之后
    const me = m.color === 'b' ? 1 : 2;
    /* ★★ 段②（2026-10-13）：`captured` 也要在这里补算，不能只算 capAt。
       为什么：**从 SGF 读进来的手没有 captured 字段**（棋谱里不写提子数，靠重放推），
       而打劫判据要的是「上一手提了几子 + 提在哪」（见 tryPlay 的 KaTrain 两条）。
       原来这里只判 `if (!m.captured) continue;` —— 于是打开棋谱后接着往下摆时，
       上一手若是棋谱里的，`captured` 是 undefined，判劫**直接放行**（用户报过的"打不劫"）。
       现在重算：数与落子时的口径一致（把相邻的、这一手之后变空的对方块整块算进来）。 */
    /* ★ 坑位 41（2026-10-13 审查补）：**同一个块只数一次**。
       落子点的两个**不同邻位可以属于同一个连通块** —— 块从两侧包过来贴着这一手即可
       （例：L 形三子白块 {(0,1),(0,0),(1,0)}，黑下在内角 (1,1) 把它们整块提掉）。
       原来逐邻位 `cnt += group(prevBoard, nx, ny).stones.length`，而 prevBoard 是不变的，
       于是同一块在两个邻位上各被数一遍 → `captured` 算成 6（真实 3）。
       实测：`dev/_verify_fixes_1013.js` 断言 #9（两种口径并排跑，3 子的弯形块：旧算 6、新算 3）。
       眼下没有实害（三个消费点都判 `=== 1`，多子块算出来必然 >1，判劫结论不变），
       但 `captured` 这个字段名就不再等于「提子数」了 —— 将来谁拿它显示或结算就是坑。
       另外这也才让注释里那句「与 tryPlay 同口径」成为事实：tryPlay 在**可变盘**上提子，
       提完就清零，天然不会重数；这边盘是不变的 prevBoard，得自己去重。 */
    let cnt = 0, at1 = null;
    const counted = new Set();                     // 已经数过的子（按盘的格号）
    for (const [nx, ny] of neighbors(m.x, m.y)) {
      const k = idx(nx, ny);
      if (prevBoard[k] === 3 - me && after[k] === 0 && !counted.has(k)) {
        const gp = group(prevBoard, nx, ny).stones;
        cnt += gp.length;                          // 一块可能是多子
        gp.forEach(s => counted.add(s));            // 整块记下，绕回来的那个邻位就不再重数
        if (!at1) at1 = { x: nx, y: ny };           // 只记**第一块**（与 tryPlay 同口径）
      }
    }
    m.captured = cnt;
    /* ★ 口径必须与 tryPlay 完全一致：**提子就设 capAt**（记第一块），不是「只提 1 子才设」。
       原来这里是 `(cnt === 1 && at1)` —— 与落子时那个口径不一样，等于同一个字段两套语义。
       功能上确实看不出差别（三处消费点都带 `captured === 1` 前置，见 koFromBoard / tryPlay），
       但「一个字段两套口径」就是下次踩坑的引信：比如以后想用它记"提子位置"给用户看，
       从棋谱读进来的手会一片空白。实测证据：dev/_inject_real_rec.js 的 R14
       （217 手真实对局里 9 手提了 2 子以上 → 老口径下 capAt 全空）。 */
    m.capAt = at1 || undefined;
  }
}

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const x = Math.round((mx - pad) / gap);
  const y = Math.round((my - pad) / gap);
  if (x < 0 || x >= N || y < 0 || y >= N) return;
  const [cx, cy] = pxOf(x, y);
  if (Math.hypot(mx - cx, my - cy) > gap * 0.48) return;
  tryPlay(x, y);
});

/* 悬停：吸附到最近的交叉点（只记坐标，是否空点在 draw 里判） */
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let next = null;

  /* ★ 2026-10-15（首相报的「点树面板里一个珠子后，棋盘上的落子预览小方块就没了」）：
     根因就是原来这一行里的 `state.viewAt === state.moves.length` ——
     点树上的珠子 = 跳到那一手 = **进入回看**，预览于是被挡掉（看着像坏了）。
     而本软件本来就允许从回看点落子（落子会从这里开新分支，旧枝仍在树里，↑/↓ 能切回），
     既然能下就该看得见 —— 回看中的方块画成**半透明**（见 draw 里那段），一眼能区分。
     ⚠️ `state.thinking`（AI 思考中）与 `state.noGame`（未开局）仍然挡掉：那两种情况下确实不该有预览。 */
  if (!state.noGame && !state.thinking) {
    const x = Math.round((mx - pad) / gap);
    const y = Math.round((my - pad) / gap);
    if (x >= 0 && x < N && y >= 0 && y < N) {
      const [cx, cy] = pxOf(x, y);
      if (Math.hypot(mx - cx, my - cy) <= gap * 0.48) next = { x, y };
    }
  }

  const same = (hover === null && next === null) ||
               (hover && next && hover.x === next.x && hover.y === next.y);
  if (same) return;
  hover = next;
  updatePV();          // 悬停在「推荐点」上满 1 秒 → 显示后续变化（开关见底栏「变化图」）
  draw();
});

canvas.addEventListener('mouseleave', () => {
  clearTimeout(pvTimer); pvTimer = null;
  if (hover || state.pv) { hover = null; state.pv = null; draw(); }
});

/* ---------------- 界面 ---------------- */

const $ = id => document.getElementById(id);

function syncUI() {
  const total = state.moves.length;
  $('slider').max = total;
  $('slider').value = state.viewAt;
  $('counter').textContent = `${state.viewAt} / ${total}`;

  const R = RULES[settings.rules] || RULES.chinese;
  const sizeTxt = N === 19 ? '' : `${N} 路 · `;
  const hcTxt = R.seats ? '座子 · ' : (state.setup.length ? `让 ${state.setup.length} 子 · ` : '');
  const koTxt = `贴目 ${settings.komi}`;

  /* 两个引擎各自的就绪状态 —— 分析引擎挂了胜率不出来，对弈引擎挂了 AI 不落子，
     必须分开提示，否则用户只会看到「AI 不动」而不知道卡在哪。
     ★ 2026-10-05 起引擎**默认不加载**：「没加载」是正常状态，不再说成「启动中」——
       只在真出错、或正在加载时说一句；平时状态由顶栏那两盏灯负责。 */
  const engTxt = engineNote ? '引擎异常'
    : engineReloading ? '引擎重启中…'
      : ((engStates.analyze === 'loading' || (settings.mode === 'play' && engStates.play === 'loading'))
        ? '引擎加载中…' : '');
  const head = state.noGame
    ? '未开局 · 点棋盘中央的「新建对局」开始'
    : total === 0
      ? `${sizeTxt}${hcTxt}${koTxt}`
      : `${sizeTxt}${hcTxt}${state.viewAt === total ? '进行中' : '回看中'} · 第 ${state.viewAt} 手 · 轮${sideToMove(state.viewAt) === 'b' ? '黑' : '白'}走` + quizTxt();
  /* 试下（草稿）期间状态栏必须一直提醒 —— 否则过一会儿就忘了自己在草稿里，
     回头还以为「明明下过怎么会没了」。 */
  const draftTxt = state.draft ? '试下中（草稿 · 不影响正式对局）' : '';
  /* 拟人落子开着时要常驻提示 —— 否则过一会儿就忘了 AI 正在「按人类概率挑手」，
     会觉得它怎么突然变弱、或下了怪手。 */
  const humanTxt = settings.humanLike ? '拟人落子' : '';
  $('status').textContent = [head, engTxt, draftTxt, humanTxt].filter(Boolean).join(' · ');

  /* 讲解框跟着**当前手数**刷新（切手数 / 讲解完成 / 开新局都会走到这里）。
     它自己会挡掉重复调用（同一手不重画），所以放 syncUI 里开销很小。 */
  renderCoachPanels();

  /* ★ 引擎还没就绪（或还没算出第一个局面）→ 胜率条两头不显示「黑 —」「白 —」，
     改一句「AI 准备中」（用户要求）：否则刚启动那几秒看着像"算完了、但两边都是横杠"。
     `lastEval` 有值 = 至少算过一次，就不再回退到这句话。
     ⚠️ 反过来（就绪了 / 又有数据了）也要**照着 lastEval 把数字画回来** ——
        否则「AI 准备中」会一直残留：改这几个文本的只有 applyAnalysis，
        而局面没变时分析是**不会重跑**的（shownAt 已经等于 viewAt）。 */
  if (state.noGame) {
    /* ★ 未开局：胜率条停在中性（五五开、两头都是 0.0 目）。
       之所以「不动」，是因为这个状态下**根本不发分析请求**（见 scheduleAnalysis）——
       不是把数字钉住、等它来覆盖。 */
    $('bar-black').style.width = '50%';
    $('eval-wr').textContent = '黑 50.0%';
    $('eval-wr-w').textContent = '白 50.0%';
    $('eval-lead').textContent = '0.0 目';
    $('eval-lead-w').textContent = '0.0 目';
  } else if (!engineReady || !state.lastEval) {
    /* ★ 用户要求：胜率条上**不再显示「正在加载」**（引擎状态挪到顶栏灯上了）。
       这里换成中性的一句，顺便告诉用户该干什么。 */
    const st = engStates.analyze;
    $('eval-wr').textContent = engineNote ? '引擎异常' : (st === 'loading' ? '加载中…' : '未分析');
    $('eval-wr-w').textContent = '';
    $('eval-lead').textContent = engineNote ? ''
      : (st === 'loading' ? '模型正在读入显存…'
        : (st === 'paused' ? '已暂停（顶栏可恢复）' : '点顶栏的 KataGo 加载'));
    $('eval-lead-w').textContent = '';
  } else {
    /* ★★ 2026-10-13 深夜 首相报的 bug：**回看历史手时，胜率条显示的不是正在看的那一手。**
       实测现象：正在跑整盘分析（116/218），回看到第 14 手（手数列表里是 −3.5），
       右边却是「黑 0.1% / 白 99.9% / ∓32.2 目」—— 那是**终局附近**的数字。
       根因：这里一直用全局的 `state.lastEval`（**最近一次算过的局面**），
       它**不随 viewAt 走** —— 用户翻到哪一手它都不变，于是永远显示"最后算的那个局面"。
       正解：**优先用按手号存的 `history[viewAt]` / `leads[viewAt]`** ——
       那才是「走完第 viewAt 手之后」的胜率，跟着回看走；两者都是**黑方视角**，
       与 `lastEval` 同口径（见 blackWinFrom / blackLeadFrom 的注释），可以直接替换。
       只有它没值时（刚落子、还没算出来）才退回 `lastEval` —— 那时它是唯一的数。 */
    const hw = state.history[state.viewAt];
    const hl = state.leads[state.viewAt];
    const hasHist = typeof hw === 'number';
    const bw = hasHist ? hw : state.lastEval.blackWin;
    const ld = (hasHist && typeof hl === 'number') ? hl : state.lastEval.lead;
    const sg = v => (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(1);
    $('bar-black').style.width = (bw * 100).toFixed(1) + '%';
    $('eval-wr').textContent = '黑 ' + (bw * 100).toFixed(1) + '%';
    $('eval-wr-w').textContent = '白 ' + ((1 - bw) * 100).toFixed(1) + '%';
    $('eval-lead').textContent = sg(ld) + ' 目';
    $('eval-lead-w').textContent = sg(-ld) + ' 目';
  }

  /* 试下按钮：常态不填色，处于试下状态才填色。
     ★ 2026-10-13 用户要求：进入试下后**按钮文字本身**要变成「退出试下」
     —— 原来只有 title（悬停提示）会变，按钮上始终写着「试下」，
     看不出当前处于什么状态。 */
  $('btn-draft').classList.toggle('on', !!state.draft);
  $('btn-draft').textContent = state.draft ? '退出试下' : '试下';
  $('btn-draft').title = state.draft
    ? '退出试下，回到进入试下之前的局面'
    : '试下：在此处存档，两边随便接着下（不影响正式对局）';
  /* 顶栏徽标：试下一眼可见（用户要求「进入试下状态要显示」） */
  $('draft-badge').hidden = !state.draft;

  $('btn-undo').disabled = total === 0;
  $('btn-save').disabled = total === 0;
  $('btn-score').disabled = total === 0;
  $('btn-resign').disabled = total === 0 || !!state.result;
  /* 未开局时「停一手 / 试下」也要置灰 —— 没有对局，这两个动作没有意义
     （disable 之后连快捷键调 .click() 也点不动，不用另加判断）。 */
  $('btn-pass').disabled = state.noGame;
  $('btn-draft').disabled = state.noGame;
  $('sel-terr').disabled = !state.showTerritory;   // 形势关掉时，偏好下拉跟着置灰
  /* 未开局：棋盘中央那个大胶囊按钮（引导新建对局）；
     引擎起不来时，按钮下面再给一条「去设置」的指路 —— 打包给别人时，
     对方第一眼看到的就是这条路（用户要求：不要自动弹窗，给个入口就行）。 */
  $('board-gate').hidden = !state.noGame;
  $('gate-tip').hidden = !(state.noGame && !!engineNote);
  /* ★ 引擎起不来的**具体原因**（2026-10-07 新增）。engineNote 里现在可能是
     main.js 从引擎 stderr 捞出来的原话转写（比如「权重文件太新：它需要更高版本的
     KataGo 引擎…」）—— 那句话比「引擎没起来」有用得多，得让它露出来。 */
  const why = $('gate-why');
  if (why) { why.hidden = !(state.noGame && !!engineNote); why.textContent = engineNote || ''; }

  /* ★ 各开关的勾选状态**统一从 state 画回来**（单一来源）。
     以前只同步了 chk-human，其余全靠 index.html 上的 `checked` 属性 ——
     那样一旦 HTML 和 state 初值不一致，就会出现「开关显示是开的、其实没生效」
     （2026-10-04 改启动默认值时差点踩到）。 */
  $('chk-show').checked = state.showHints;
  $('chk-coords').checked = state.showCoords;
  $('chk-nums').checked = state.showNums;
  $('chk-pv').checked = state.showPV;
  $('chk-sound').checked = state.soundOn;
  $('chk-terr').checked = state.showTerritory;
  $('chk-human').checked = settings.humanLike;     // 拟人落子（在 settings 里，不在 state）

  /* 对局信息 —— 只留 4 项（规则 / 计时 / 让子 / 贴目）。
     ★ 删项的**同时必须删掉这里的赋值**：`$('info-mode').textContent` 这种写法
     在元素不存在时会抛 TypeError，**把整个 syncUI 打断**（界面就再也不更新了）。
     省下的高度自动让给下面的手数栏（它 `flex:1`）。 */
  const short = t => String(t).replace(/（[^）]*）|\([^)]*\)/g, '').trim();

  /* 未开局：四项全写「未定」—— 规则、计时、让子、贴目这会儿都还没定下来 */
  if (state.noGame) {
    for (const id of ['info-rules', 'info-clock', 'info-hc', 'info-komi']) $(id).textContent = '未定';
  } else {
    $('info-rules').textContent = short(R.label);
    $('info-clock').textContent = (CLOCK_PRESETS[settings.clock] || CLOCK_PRESETS.none).label;
    $('info-komi').textContent = String(settings.komi);
    $('info-hc').textContent = R.seats
      ? '座子 4 子'
      : (state.setup.length ? '让 ' + state.setup.length + ' 子' : '不让');
  }

  /* 数子结果随局面变化：悔棋 / 续下之后若不再终局，就收起结果条。
     认输是终局，不动它 —— 认了就是认了。 */
  /* ★ 用「是在第几手时数的」判断，**不要**用 isTerminal()：
     手动数子时局面本来就不是终局，原写法（!isTerminal() 就清）会把结果**当场清掉** ——
     用户看到的就是「点了数子按钮什么都没发生」（2026-10-04 实测报过）。
     改成「局面变过才收起」：
       · 终局数子 → 悔棋 / 续下 → at ≠ viewAt → 收起 ✓
       · 手动数子 → 局面没动 → 留着 ✓；一旦落子 → at ≠ viewAt → 收起 ✓
     认输是终局，不动它 —— 认了就是认了。 */
  if (state.result && !state.result.resign && state.result.at !== state.viewAt) state.result = null;
  renderVerdict();

  draw();

  /* AI 该下就先让 AI 下（两个查询会互相打断，所以二选一）；否则刷新显示分析 */
  renderCurve();
  renderMoveList();
  renderMoveTree();      // 段③：树面板跟着列表一起刷（movesView 不是 tree 时函数内部直接返回）
  renderCommentBox();    // 右下角「解说词」框跟着当前手数走（棋谱自带的那种）
  renderClocks();        // 名字（PLAYER / KATAGO / PLAYER1 / PLAYER2）随模式变

  /* ★ 人机对弈：AI 该下就让它下；**同时也发一次分析** ——
     分析走 strong 引擎、AI 落子走 human 引擎，是两个独立进程，互不干扰。
     为什么必须同时发：用户落子后轮到 AI，若只跑 AI 不分析，用户刚下那一手的局面
     就永远没被评估过 → 手数列表里那一手没有「涨跌」（用户报过的现象）。
     ⚠️ 以前这里是 `if / else` 二选一，理由写着「两个查询会互相打断」——
        那是**单引擎时代**的限制，2026-10-03 拆成双引擎后已经不成立了。 */
  if (needAIMove()) scheduleAIMove();
  scheduleAnalysis();

  /* 双方都停一手 → 自动判终局（约 4~5 秒出结果）
     试下中不判：草稿里的 pass 不算终局 */
  if (!state.draft && isTerminal() && !state.result) scheduleScore();
}

let flashTimer = null;
function flash(msg) {
  const el = $('status');
  el.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(syncUI, 1800);
}

function gotoView(n) {
  state.viewAt = Math.max(0, Math.min(state.moves.length, n));
  clockTouch();          // 跳转后本手重新计时，免得把翻谱的时间算进去
  syncUI();
}

$('btn-first').onclick = () => gotoView(0);
$('btn-prev').onclick = () => gotoView(state.viewAt - 1);
$('btn-next').onclick = () => gotoView(state.viewAt + 1);
$('btn-last').onclick = () => gotoView(state.moves.length);
$('slider').oninput = e => gotoView(+e.target.value);

/* ---------------- 试下（打草稿） ----------------
   点「试下」= 在**当前看到的这一手**存档暂停，两边随便接着下（像打草稿）；
   再点一下 = 取消试下，**完整**回到点之前的状态。
   ★ 2026-10-13：回看时也能进（用户：「回看无法试下，这不合理」）。
     草稿点 = viewAt，主线被截到此处、from 之后的正式手顺整份收进快照 ——
     于是试下期间 viewAt 天然在末端，「回看中不能落子/悔棋/停一手」那些闸门
     一行都不用改。试下仍然**不是分支**：草稿不进分支树、不进棋谱
     （buildSGF/saveToRecords 的 `upto = draft.from` 语义照旧成立），
     退出后在草稿点正常落子，将来才由分支功能开新分支。

   实现：进入时给整个局面拍一张快照，试下期间就在真实数据上随便下
   （相当于临时切成摆棋），退出时用快照整体盖回来。
   —— 用整体覆盖而不是逐项回滚：逐项回滚最容易漏字段（history / 打劫点 / 计时…），
      漏一个就会留下「回不去」的残迹。
   试下期间：AI 不自动落子、计时暂停、胜率曲线与导出的棋谱都不受影响；
   讲解缓存（尾巴）摘走、解说词框收起、退出时推进棋局代次作废在飞请求 ——
   详见 enterDraft / exitDraft 里的三处 ★ 注释。 */

function enterDraft() {
  if (state.draft) return;
  /* ★★ 回看时也能试下（2026-10-13 用户要求：「现在是回看无法试下，这不合理，
     回看时要能试下」—— 原来这里硬挡 viewAt !== moves.length）。
     实现：草稿点 = 当前看到的这一手（viewAt），不是主线末端。 */
  const from = state.viewAt;

  state.draft = {
    from,
    snap: {
      moves: state.moves.slice(),
      viewAt: state.viewAt,
      toMove: state.toMove,
      koPoint: state.koPoint,
      candidates: state.candidates.slice(),
      candAt: state.candAt,
      history: state.history.slice(),
      /* ★ DSH 补（2026-10-13）：leads 必须一起存 —— enterDraft 会调
         truncateAnalysisTo(from)，那个函数**会截 state.leads**（目差曲线数据）。
         原来快照只存了 history/histVisits，leads 被截了就永远回不来：
         退出试下后走势图切「目差模式」后半段空白，直到重跑一次复盘。
         实测证据：dev/_inject_draft_review.js 的 R4（进试下 11 项 → 退出后仍是 6 项）。 */
      leads: state.leads.slice(),
      histVisits: state.histVisits.slice(),
      result: state.result,
      lastEval: state.lastEval,
      clock: JSON.parse(JSON.stringify(state.clock)),   // 全是数字/布尔，可深拷贝
    },
    /* ★ 把「from 之后」的逐手讲解**摘走**收进草稿里（2026-10-13）。
       为什么必须摘：讲解缓存按手号存（coach.explain[k]），而落子的同一处会
       `clearCoachAt(k)` 作废旧讲解 —— 草稿下的「第 51 手」若不清，会把
       **正式第 51 手**（此刻收在快照里）的讲解当成旧值删掉，退出后讲解丢了。
       摘走之后：草稿手清的是空位，正式讲解在 draft.coachTail 里躲着，
       exitDraft 原样放回（先清掉草稿手留下的，再回填）。 */
    coachTail: {},
  };
  const ex = state.coach && state.coach.explain;
  if (ex) {
    for (const k of Object.keys(ex)) {
      if (+k > from) { state.draft.coachTail[k] = ex[k]; delete ex[k]; }
    }
  }
  /* ★ 草稿线 = 把主线**截到 from**，而不是「在 from 之后继续 append」。
     为什么截：棋盘上「回看中不能落子 / 不能悔棋 / 不能停一手」的闸门全是
     `viewAt !== moves.length` 这一句 —— 截断后试下期间 viewAt 天然在末端，
     落子路径（tryPlay / 停一手 / 悔棋 / 引擎调度）一行都不用改。
     from 之后的正式尾巴已经整份存进快照（上面 slice 在前、截断在后），
     退出时 exitDraft 用快照整体盖回，一手不少。
     尾巴的连带状态照悔棋那套收（1174 行起的清单）：
       · toMove 按 from 重算；
       · koPoint 用 koFromBoard 重算，不能清 null —— 悔棋 2026-10-07 的教训，
         截到的局面若正好是「刚提完劫」，禁着点必须重新成立；
       · truncateAnalysisTo 截 history / leads / histVisits / 队列 ——
         漏了会画出幽灵手数、分析还可能死锁（悔棋 2026-10-06 的教训）。 */
  state.moves.length = from;
  state.toMove = sideToMove(from);
  state.koPoint = koFromBoard(boardAt(from), state.moves, from);
  state.pv = null;                       // 变化图基于旧局面，作废
  truncateAnalysisTo(from);
  state.clock.paused = true;      // 「存档暂停」—— 试下期间不走表
  syncUI();
  const tail = state.draft.snap.moves.length - from;
  flash(tail > 0
    ? `已进入试下 · 从第 ${from} 手岔出，第 ${from + 1}~${from + tail} 手先收进快照`
    : '已进入试下 · 两边都能下，不影响正式对局');
}

function exitDraft() {
  if (!state.draft) return;
  const d = state.draft;
  const s = d.snap;
  state.moves = s.moves;
  state.viewAt = s.viewAt;
  state.toMove = s.toMove;
  state.koPoint = s.koPoint;
  state.candidates = s.candidates;
  state.candAt = s.candAt;
  state.history = s.history;
  state.leads = s.leads || [];           // ★ DSH 补：目差曲线数据也要还原（与 enterDraft 的 leads 快照配对）
  state.histVisits = s.histVisits || [];
  /* ★ 讲解缓存复位（和 enterDraft 的「摘尾巴」配对）：
     先把草稿留下的（手号 > from，都属于草稿手）清掉，再把正式手的原讲解放回。
     顺序不能反 —— 反了会先删掉刚放回去的。 */
  const ex = state.coach && state.coach.explain;
  if (ex) {
    for (const k of Object.keys(ex)) { if (+k > d.from) delete ex[k]; }
    Object.assign(ex, d.coachTail || {});
  }
  /* ★★ 推进「棋局代次」—— 草稿期间发出去、还没回来的请求（分析 / 讲解）
     回来时整体作废（runAnalysisOnce 的 gen 校验；分析讲解的写回没有代次校验，
     靠这里作废的是：它请求的初手快照 = 草稿线，结果属于草稿手，
     而退出后那些手号已经被还原回来的正式手顺占着 —— 不回写才是对的）。
     回看进试下之后这条尤其要紧：草稿是从主线中间岔的，
     手数与还原后的尾巴**重叠**，不拦就会串。 */
  gameGen++;
  resetAnalysisState();                  // history 被整体换回来了 → 欠账与上屏标记一起作废重来
  Object.assign(state.clock, s.clock);   // 保持同一个 clock 对象（renderClocks 一直指着它）
  state.result = s.result;
  state.lastEval = s.lastEval;
  state.draft = null;
  syncUI();
  flash('已退出试下 · 回到原局面');
}

function toggleDraft() { state.draft ? exitDraft() : enterDraft(); }

/* ---------------- 终局判定 / 数子 ---------------- */

/* 单位：中日韩「数目」→ 目；中国 / 明清「数子」→ 子。
   实测确认（9 路、双方都停一手）：
     中国（贴 7.5）scoreLead = -7.3   理论 -7.5
     日本（贴 6.5）scoreLead = -6.4   理论 -6.5
     明清（不贴目）scoreLead = +0.5   理论 0
   → KataGo 已经按各自规则算好了，**还棋头是它内置的**，我们直接用差值即可。
   精度：2000 visits 时误差约 ±0.2 子（200 visits 差到 0.4，所以终局查询用 2000）。 */
const SCORE_UNIT = { chinese: '子', ancient: '子', japanese: '目', korean: '目' };

/* 最后两手都是 pass = 双方都停手 = 终局 */
function isTerminal() {
  const n = state.moves.length;
  if (n < 2) return false;
  return !!(state.moves[n - 1].pass && state.moves[n - 2].pass);
}

let scoreBusy = false;
let scoreTimer = null;

function scheduleScore(delay) {
  clearTimeout(scoreTimer);
  scoreTimer = setTimeout(() => runScore(true), delay === undefined ? 700 : delay);
}

async function runScore(silent) {
  /* ★ 正在数子时又点了一次 → **排队等前一次跑完**，而不是静默忽略。
     （被忽略的表现是「点了没反应」，用户会以为按钮坏了。实测踩过一次。） */
  let waited = 0;
  while (scoreBusy && waited < 60000) { await new Promise(r => setTimeout(r, 200)); waited += 200; }
  if (!engineReady) {
    if (!silent) needEngine('analyze', '数子');   // 没加载 → 提示 + 把「加载」菜单弹出来
    return;
  }
  if (!state.moves.length) { if (!silent) flash('还没落子，没什么可数的'); return; }

  scoreBusy = true;
  const gen = gameGen;                       // ★ 这次数子属于哪一局
  /* ★★ 把「数的是第几手」**在这一刻定下来**（2026-10-06 审查发现）。
     请求用的是 `state.viewAt`、而结果里的 `at` 原来读的是 **await 之后**的 viewAt ——
     如果用户在等引擎的那一两秒里翻看了别的局面（滑块 / 点手数列表），
     结果就会被记到**错误的那一手**上；而且因为 `at === viewAt`，
     「局面变过就收起结果条」那条清理也不会触发，于是错的结果一直挂着。
     典型触发：点数子 → 等的时候顺手拖滑块 → 结果条上的结论其实属于另一手。 */
  const at0 = state.viewAt;
  const btn = $('btn-score');
  const oldTxt = btn.textContent;
  btn.disabled = true;
  if (!silent) btn.textContent = '数子中…';

  try {
    /* ★ 关键：必须让引擎看到「连续两个 pass」，它才会走**终局结算**而不是形势评估。
       实测踩过：空盘 + 两个 pass 引擎给 -0.9，而理论终局值是 -7.5 ——
       因为它看到还有 81 个空点可下，认为这局还没结束。 */
    window.api.cancel();                       // 终局查询优先，掐掉正在跑的分析
    const ms = state.moves.slice(0, at0)      // ★ 用定下来的 at0，不用当前的 viewAt
      .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]);
    /* ★ 必须让引擎看到「**连续两个** pass」，它才会走终局结算。只补一手是不够的 ——
       那样最后两手是「一手棋 + 一个 pass」：既不算终局，**又等于那一方白白放弃一手**，
       结果会严重偏向对方（实测：8 手均势局面数出「白胜 21.2 子」）。
       正确做法：轮谁走、谁先 pass，然后对方也 pass —— 补两手。 */
    const turn = sideToMove(state.viewAt);
    if (!ms.length || ms[ms.length - 1][1] !== 'pass') {
      ms.push([turn === 'b' ? 'B' : 'W', 'pass']);
      ms.push([turn === 'b' ? 'W' : 'B', 'pass']);
    } else {
      // 最后一手已经是 pass（真终局局面）→ 只差对方这一手
      ms.push([turn === 'b' ? 'B' : 'W', 'pass']);
    }

    const res = await window.api.analyze({
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: ms,
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: 2000,
    });

    /* ★ 换了局（新对局 / 打开棋谱）→ 这次数子作废：
       否则刚开的新盘上会冒出上一局的胜负结果（用户重开一局时能实际看到）。 */
    if (gen !== gameGen) return;

    if (!res || res.error || !res.root) {
      if (!silent) flash('数子失败：' + ((res && res.error) || '引擎无响应'));
      return;
    }

    /* 视角：scoreLead 是「轮到走棋那一方」的（engine.cfg 里 SIDETOMOVE），换算成黑方 */
    const cp = String(res.root.currentPlayer || '').toUpperCase();
    const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : 'b';
    const raw = res.root.scoreLead;
    const blackLead = side === 'b' ? raw : -raw;

    state.result = {
      winner: blackLead > 0 ? 'b' : 'w',
      lead: Math.abs(blackLead),
      unit: SCORE_UNIT[settings.rules] || '子',
      resign: false,
      by: 'score',
      terminal: isTerminal(),
      /* ★ 记下「是在第几手时数的」：手动数子（局面非终局）时局面没变，结果应当留着；
         一旦落子/悔棋导致 viewAt 变化就自动收起（见 syncUI 里那句清理）。
         ⚠️ 用**发起时**定下来的 at0，不用当前的 viewAt —— 等引擎的那一两秒里
         用户可能拖了滑块，那样结果会被记到错误的手上（2026-10-06 审查发现）。 */
      at: at0,
    };
    syncUI();
  } finally {
    scoreBusy = false;
    /* ★ 数子期间被压住的分析，这里补一次（否则要等下次落子才更新）；
       而且数子前调过 window.api.cancel()，当前局面的分析被掐掉过 → 用 force 重算。 */
    scheduleAnalysis(0, true);
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}

/* 认输：loser = 认输方，by = 'user' | 'ai' */
function doResign(loser, by) {
  if (state.result || !state.moves.length) return;
  state.result = {
    winner: loser === 'b' ? 'w' : 'b',
    lead: null,
    unit: SCORE_UNIT[settings.rules] || '子',
    resign: true,
    by: by || 'user',
    terminal: true,
  };
}

/* AI 认输：落后太多就投子（围棋惯例），免得用户单方面屠龙、局面僵在那里 */
function aiWantsResign() {
  const e = state.lastEval;
  if (!e) return false;
  const aiSide = state.myColor === 'b' ? 'w' : 'b';
  const aiWin = aiSide === 'b' ? e.blackWin : 1 - e.blackWin;
  const aiLead = aiSide === 'b' ? e.lead : -e.lead;
  return state.moves.length >= 30 && aiWin < 0.03 && aiLead < -20;
}

function renderVerdict() {
  const box = $('verdict');
  const r = state.result;
  if (!r) { box.hidden = true; return; }
  /* ★ 用户手动按过叉 → 尊重它，别再自己冒出来（2026-10-06 审查发现）。
     新的一次数子 / 认输会整个替换 state.result，那时没有 dismissed 标记，照常显示。 */
  if (r.dismissed) { box.hidden = true; return; }

  const sideTxt = r.winner === 'b' ? '黑方' : '白方';
  let main, sub = [];
  if (r.resign) {
    /* ★ 超时要单独一条文案（2026-10-04 加超时判负时发现的）：
       超时也走 doResign（resign: true），如果只按「谁认输」渲染，
       结果条会写成「KATAGO 认输」—— 双人对弈时更是完全说不通。 */
    if (r.by === 'timeout') {
      main = sideTxt + '胜';
      sub.push((r.winner === 'b' ? '白方' : '黑方') + '超时判负');
    } else {
      main = r.by === 'user' ? '你认输' : 'KATAGO 认输';
      sub.push('本局结束');
    }
  } else {
    main = sideTxt + '胜';
    sub.push(r.lead.toFixed(1) + ' ' + r.unit);
    if (!r.terminal) sub.push('当前局面 · 非终局');
  }
  $('verdict-text').innerHTML = '<b>' + main + '</b>'
    + (sub.length ? ' <span class="vsub">' + sub.join(' · ') + '</span>' : '');
  box.hidden = false;
}

$('btn-score').onclick = () => { state.result = null; renderVerdict(); runScore(false); };
$('btn-resign').onclick = () => {
  if (state.result || !state.moves.length) return;
  doResign(state.myColor, 'user');
  flash('已认输 · ' + (state.myColor === 'b' ? '白' : '黑') + '方胜');
  syncUI();
};
$('verdict-close').onclick = () => {
  /* ★ 记下「用户手动关掉了」（2026-10-06 审查发现）：原来只把 box.hidden 设成 true，
     而下一次 syncUI → renderVerdict 又会 `box.hidden = false` 把它显示回来 ——
     表现为「点了叉，过一会儿结果条自己又冒出来」。
     记在 state.result 上（新的一次数子/认输会整个替换掉它，所以下次有结果照样会显示）。 */
  if (state.result) state.result.dismissed = true;
  $('verdict').hidden = true;
};

$('btn-draft').onclick = toggleDraft;

$('btn-undo').onclick = () => {
  /* ★ 正在回看历史手时不许悔棋（2026-10-06 审查发现）。
     落子 / 停一手 / 试下都有这条约定（「回看中不能落子，先跳到最新」），**只有悔棋漏了** ——
     于是「看着第 50 手点悔棋」撤掉的是**最后一手**、画面还跳到 99 手，
     用户会以为软件撤错了手（他心里的"这一手"就是眼前看着的那一手）。 */
  if (state.viewAt !== state.moves.length) { flash('回看中不能悔棋，先跳到最新'); return; }
  if (!state.moves.length) return;
  /* 试下时不能退过存档点 —— 那等于把草稿起点也吃掉，退出试下后就亏了 */
  const floor = state.draft ? state.draft.from : 0;
  if (state.moves.length <= floor) {
    if (state.draft) flash('已经退到试下的起点了');
    return;
  }
  state.moves.pop();
  /* 人机对弈模式：撤到「又轮到自己」为止 —— 否则 AI 会立刻把这一手补回来，看着像没撤。
     试下时不做这个联动：草稿里你想退几手就退几手。 */
  if (!state.draft) {
    while (settings.mode === 'play' && state.moves.length &&
           sideToMove(state.moves.length) !== state.myColor) {
      state.moves.pop();
    }
  }
  state.toMove = sideToMove(state.moves.length);
  /* ★★ 禁着点必须**重新算出来**，不能清成 null（2026-10-07 用户报的真 bug）。
     原来这里写的是 `state.koPoint = null;`，注释说「局面变了，打劫禁着点随之失效」——
     那句话只对了一半：**退掉了提劫那一手**时它确实该失效，但**退到"刚提完劫"那个局面**时
     它必须重新成立。清成 null 的后果就是用户报的：
       白提劫 → 我禁着 → 我在别处走一手 → 白在别处走 → 我悔棋回到"白提完劫"
       → 这时我居然能**直接提回去**（违反禁着点）。
     复现证据见 dev\_cdp_ko_user.mjs（用用户自己那份 GN[打劫BUG] 棋谱走的整条链）。
     ★ 同一处还有个反向错：悔棋**退掉一个"在别处走"的手**之后，劫其实又成立了
       （禁着点该回来），而原来是一律清 null —— 两个方向都错。 */
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves, state.moves.length);
  /* ★ 顺手补上每手的 `capAt`（"这一手提掉了哪一点"）——
     打劫判据要靠它判断"这一手是不是在上一手被提的那点回提"。
     悔棋之后手顺被截断，重算一遍最省心（只在悔棋时做，开销可忽略）。 */
  rebuildCapAt();
  state.pv = null;               // 变化图基于当前候选点，局面变了就失效
  state.viewAt = state.moves.length;
  /* ★ 局面变短了 → 必须截断分析队列与走势数据（truncateAnalysisTo 的注释里有实测数据）。
     漏了这一步会导致「悔棋后分析彻底停住」，用户 2026-10-06 报过。 */
  truncateAnalysisTo(state.moves.length);
  syncUI();
  /* syncUI 里会 scheduleAnalysis()，它按新的 viewAt 重新入队 —— 但**当前局面这一项
     若 history 里已经有值就不会入队**（scheduleAnalysis 的去重条件），
     而悔棋后的局面恰恰是「算过但画面要重画」的。所以这里显式强制重算当前局面。 */
  scheduleAnalysis(0, true);
};

$('btn-pass').onclick = () => {
  if (state.viewAt !== state.moves.length) { flash('回看中不能落子，先跳到最新'); return; }
  state.moves.push({ pass: true, color: state.toMove });
  clearCoachAt(state.moves.length);      // 该手号上的旧讲解作废
  state.toMove = state.toMove === 'b' ? 'w' : 'b';
  state.koPoint = null;          // 脱先一手，劫自然消解
  state.viewAt = state.moves.length;
  syncUI();
};

/* 这个开关只管「棋盘上画不画推荐点」——右侧胜率是客观数据，始终显示。
   ★ 全软件只有**这一个**开关（「显示」菜单里，快捷键 T）。
     2026-10-07：外部 PR 曾在「推荐落点讲解」卡片里也加过一个同名开关，用户要求删掉 ——
     **两处重复只会让人搞不清该信哪个**，而且两个控件必须时刻同步、很容易漏。
     顺手加了 localStorage 记住选择（原来是启动默认关，每次都得重开）。 */
function setHintsVisible(visible) {
  state.showHints = !!visible;
  $('chk-show').checked = state.showHints;
  try { localStorage.setItem('rapacego.showHints', String(state.showHints)); } catch { /* 记不住也能用 */ }
  draw();
}
$('chk-show').onchange = e => setHintsVisible(e.target.checked);

$('chk-coords').onchange = e => {
  state.showCoords = e.target.checked;
  resize();          // 边距要跟着变（留白要放得下坐标）
};

$('chk-sound').onchange = e => {
  state.soundOn = e.target.checked;
  if (state.soundOn) playStoneSound();   // 打开时给个反馈，方便试听
};

/* 形势显示：总开关 + 画法偏好（雾 / 方块）。位置在底栏「音效」旁边。 */
$('chk-terr').onchange = e => {
  state.showTerritory = e.target.checked;
  if (!state.showTerritory) { state.ownership = null; state.ownAt = -1; }   // 关掉就清，别留残影
  syncUI();
  /* ★ 这个开关决定要不要向引擎要 ownership 数据（includeOwnership）→ 当前局面必须
     强制重算一遍，否则打开开关后要等到下一手才有雾（syncUI 那次不会重算已上屏的局面）。 */
  scheduleAnalysis(0, true);
};
$('sel-terr').onchange = e => { state.terrStyle = e.target.value; draw(); };

/* 拟人落子 —— 官方配方「How to get stronger human-style play」。
   不开：从候选里取首选（强，但不像人；而且如官方所说「搜索量给多了会比标称段位强」）。
   开了：按人类概率抽样，明显要崩的手会被压下去（见 pickAIMove / pickByHumanPolicy）。 */
$('chk-human').onchange = e => {
  settings.humanLike = e.target.checked;
  flash(settings.humanLike ? '拟人落子：开 · 按该段位人类的概率挑手' : '拟人落子：关 · 取最优手');
  syncUI();
};

/* 盘上显示手数（快捷键 M）—— 复盘时看「这是第几手」 */
$('chk-nums').onchange = e => { state.showNums = e.target.checked; draw(); };

/* 变化图（快捷键 B）：鼠标停在推荐点上约 1 秒 → 显示这一手之后的预计变化 */
$('chk-pv').onchange = e => {
  state.showPV = e.target.checked;
  if (!state.showPV) { clearTimeout(pvTimer); pvTimer = null; state.pv = null; }
  draw();
};

/* ★ 段③ 树面板（2026-10-13）：数字开关 + 列表/树滑杆 + 面板初始化 */
$('chk-treenum').onchange = e => { state.treeNum = e.target.checked; renderMoveTree(); };
initBranchTree();
/* 滑杆切视图：列表 ⇄ 树。两个容器互斥显隐（hidden 由 CSS 的 [hidden] 兜住）。 */
initSeg('seg-moves', v => {
  movesView = (v === 'tree') ? 'tree' : 'list';
  /* ★ 2026-10-14：切回「列表」时，若放大窗正开着 → **先收起来**。
     否则树元素还在大窗里、列表却要显示，等于把一个 hidden 的树留在弹窗里，
     遮罩也撤不掉（用户会看到"列表出来了，但屏幕上压着一层灰"）。 */
  if (movesView !== 'tree' && treeZoomOn) setTreeZoom(false);
  $('movelist').hidden = movesView === 'tree';
  $('branch-tree').hidden = movesView !== 'tree';
  /* 「⤢ 放大」只在树视图下有意义 */
  if ($('btn-treezoom')) $('btn-treezoom').hidden = movesView !== 'tree';
  if (movesView === 'tree') renderMoveTree();   // 刚切过来补画一次（syncUI 那条只在刷时走）
});

/* ---------------- 底栏「显示」下拉（2026-10-04 用户选的方案 A） ----------------
   原来 6 个开关 + 形势画法下拉平铺在底栏，1240 宽的窗口下把底栏挤成三行
   （第三行只剩「认输 / 导出棋谱」，右边一大片空）。收进这个菜单后底栏回到一行。
   ★ 只是搬了个位置：里面 chk-xxx / sel-terr 的 id 全没变 —— 所以上面那些 onchange
     绑定、快捷键 T/Z/M/B/Y/X、以及 syncUI 的「开关状态统一从 state 画」统统不用改。 */
const DISP_MENU = $('disp-menu');
const closeDispMenu = () => { DISP_MENU.hidden = true; };

$('btn-disp').onclick = e => {
  e.stopPropagation();          // 别让下面那个「点外面关闭」在同一趟点击里立刻把它关掉
  DISP_MENU.hidden = !DISP_MENU.hidden;
};
/* 点菜单外面 / 按 Esc → 收起。
   （在菜单里点开关**不**收 —— 想连着开好几个是最常见的用法。） */
document.addEventListener('click', e => {
  if (!DISP_MENU.hidden && !$('disp').contains(e.target)) closeDispMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !DISP_MENU.hidden) closeDispMenu();
});

function buildSGF() {
  const R = RULES[settings.rules] || RULES.chinese;
  /* ★ 双方名字写进 PB / PW —— 别的棋谱软件（以及本软件自己再打开时）就能看到
     谁执黑谁执白，不用再靠 PLAYER / KATAGO 猜。
     SGF 属性值里不能出现 ] 和 \，先剔掉；太长也截一下。 */
  const sgfn = v => String(v || '').replace(/[\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  let s = `(;GM[1]FF[4]SZ[${N}]CA[UTF-8]AP[RapaceGo:0.3]KM[${settings.komi}]RU[${R.sgf}]`
    + `PB[${sgfn(clockName('b'))}]PW[${sgfn(clockName('w'))}]`;
  if (R.seats) s += 'GC[明清规则：座子制 · 还棋头]';
  if (R.seats || settings.handicap) {
    const bs = state.setup.filter(p => p.color === 'b').map(p => `[${SGF_COLS[p.x]}${SGF_COLS[p.y]}]`).join('');
    const ws = state.setup.filter(p => p.color === 'w').map(p => `[${SGF_COLS[p.x]}${SGF_COLS[p.y]}]`).join('');
    if (!R.seats) s += `HA[${settings.handicap}]`;   // 座子不是让子，不写 HA
    if (bs) s += `AB${bs}`;
    if (ws) s += `AW${ws}`;
  }
  /* 试下（草稿）里的手**不写进棋谱** —— 那是草稿，不是这一局。
     ★ 段②起这道闸门前移到**建树**处（tryPlay / ensureBranch 都不让草稿手进树），
       所以下面写树时不必再截；这里不再需要 upto。 */
  /* 终局结果写进 RE[] —— 棋谱软件（围棋APP、CGoban 等）能直接读到胜负 */
  const r = state.result;
  if (r) {
    s += 'RE[' + (r.winner === 'b' ? 'B+' : 'W+')
      + (r.resign ? 'Resign' : r.lead.toFixed(1)) + ']';
    s += 'C[' + (r.resign
      ? (r.by === 'user' ? '认输' : 'AI 认输')
      : (r.winner === 'b' ? '黑方胜' : '白方胜') + r.lead.toFixed(1) + r.unit) + ']';
  }
  /* ★★ 段②（2026-10-13）：写**整棵分支树**（变着用 `(…)`，见 sgfBranchText）。
     草稿（试下）的手不进树（tryPlay / ensureBranch 两处守着），所以这里不用再截 upto。
     向后兼容：没有分支时输出与以前**逐字节一致**（每层只有一个子 → 纯顺序 `;B[..];W[..]`）。 */
  ensureBranch();
  s += sgfBranchText(branchRoot);
  return s + ')';
}

/* 一手棋的 SGF 写法（`[]` = 停一手） */
function sgfOneMove(m) {
  return ';' + (m.color === 'b' ? 'B' : 'W') + (m.pass ? '[]' : `[${SGF_COLS[m.x]}${SGF_COLS[m.y]}]`);
}

/* 把 branchRoot 之下的子树写成 SGF 文本。
   · 只有一个子 → 直接顺序写（不套括号）：`;B[pd];W[dd]`
   · 两个以上 → 每个子各套一棵树：`(;B[qq];W[pp])(;B[pp])`  （第 0 个 = 主变）
   这正是 SGF 表示变着的标准写法，别的软件（MultiGo / CGoban / Sabaki）都认。 */
function sgfBranchText(parent) {
  const cs = (parent && parent._cs) || [];
  if (!cs.length) return '';
  if (cs.length === 1) return sgfOneMove(cs[0]) + sgfBranchText(cs[0]);
  let out = '';
  for (const c of cs) out += '(' + sgfOneMove(c) + sgfBranchText(c) + ')';
  return out;
}

/* ---------------- 棋谱库（打开 / 存进来 / 备注 / 删除） ----------------
   位置：软件目录下的 records/（见 main.js 的 RECORDS_DIR）。
   为什么不放用户的「我的棋谱」：那是他自己的目录，不该由软件往里写。
   删除一律走系统回收站（主进程里的 shell.trashItem），误删能捞回来。 */

/* 解析 SGF。
   · 坐标：标准 SGF 是两个字母（如 pd），第一个是列、第二个是行，**行从最上面开始数** ——
     正好和我们的内部坐标 (x=列, y=行, y=0 在最上) 一一对应，不用做任何转换。
   · 变体：**整棵变着树都会读出来**（`tree` 字段，2026-10-13 段②起），
     同时 `moves` 仍是「主分支（每个分叉点的第一条）」那条线 —— 旧口径没变，老调用方照用。
   · 认得出：SZ / KM / RU / AB / AW / ;B[xx] / ;W[xx] / 空 [] = 停一手。 */
function parseSGF(text) {
  const s = String(text || '');

  /* ---------- 1) 切成 token：括号 / 节点 ----------
     ★ 一个节点里可以有多组「标识 + 若干值」，例如 `;AB[pd]AW[dd]C[注释]`
       —— 所以不能只挑 `;[BW][..]`，得把每组标识+值都正经读出来。
     ★ 属性值里的 `\]` 是 SGF 的转义，要当普通字符，否则值里带方括号就把 token 切歪。
     ★ 2026-10-06：改成**按节点分组**（`{ props, at, end }`）并记下每个节点在**原文里的位置** ——
       props 分组是为了正确取出「这一手的 C[] 解说词」（同一节点里 C 写在 B 前还是后都不影响）；
       at/end 是为了以后「在软件里改解说词 → 只替换原棋谱里那一个 C[]」时能精确落刀。 */
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(' || c === ')') { toks.push(c); i++; continue; }
    if (c !== ';') { i++; continue; }
    const at = i;                                      // 节点起点（';' 的位置）
    i++;
    const props = [];
    for (;;) {
      /* ★★ 2026-10-06 修正（用户报「棋谱说明（根节点那段）读不出来」）。
         原写法是：
               while (i < s.length && /\s/.test(s[i])) i++;   // 跳过标识前的空白
               let id = '';
               while (/[A-Za-z]/.test(s[i])) { id += s[i]; i++; }
               if (!id) break;                                // ← 这里就错了
         `/\s/` 把**换行**也算进去，而 SGF 的属性值允许跨行 ——
         真实棋谱大量这么写（题集的摆子几十个点分两三行、解说词本身也是多行）：
               AB[qh]…[im]<CRLF>[kn]…[ch]AW[qf]…C[手筋辞典…<CRLF>…第55图 黑先]
         于是「跳过空白后正好遇到 `[`（下一个值）」被误判成「这个节点读完了」，
         节点被从中间劈开：
           ① 这个属性剩下的值归到了下一个节点 → AB/AW 摆子点数变少（初始局面就是错的）；
           ② 同一节点后面的属性整组丢失 —— 最常见的就是 `C`（棋谱说明）
              和 `AW` 一起丢，这就是「根节点那段说明读不出来」的真因。
         实测抽样 300 份真实棋谱：**71 份（23.7%）被劈错**，其中一份的节点数
         从正确的 8 个虚增到 57 个。
         修法：只有「跳过空白后既不是标识、也不是值的开头」才认为节点结束。 */
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;        // 标识前的空白（含换行）
      let id = '';
      while (j < s.length && /[A-Za-z]/.test(s[j])) { id += s[j]; j++; }
      if (!id) {
        if (j < s.length && s[j] === '[') i = j;          // 值接着写 → 本属性还没完
        else break;                                      // 这个节点读完了
      } else {
        i = j;
      }
      const vals = [], valAt = [];
      /* ★ 另一个同类修正：**值之间**也可能夹着换行
         （`AW[fc][fb]<CRLF>[fa][ed]…` 这种写法很常见）。
         原循环条件 `while (s[i] === '[')` 遇到换行就退出，于是这个属性
         只读到换行前的那几个值，剩下的全被劈走 —— 摆子少、解说词只剩第一行。
         现在每读完一个值先跳过空白，再看有没有下一个值。 */
      for (;;) {
        let k = i;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (k >= s.length || s[k] !== '[') break;
        i = k;
        i++;
        valAt.push(i);                                   // 值正文起点（'[' 之后）
        let v = '';
        while (i < s.length) {
          if (s[i] === '\\') { v += s[i] + (s[i + 1] === undefined ? '' : s[i + 1]); i += 2; continue; }
          if (s[i] === ']') break;
          v += s[i]; i++;
        }
        vals.push(v);
        i++;                                             // 越过 ']'
      }
      props.push({ id: id.toUpperCase(), vals, valAt });
    }
    toks.push({ props, at, end: i });
  }

  /* ---------- 2) 走主分支 ----------
     ★★ 2026-10-06 修正（用户报「导入棋谱只加载了前 N 手」）。
     SGF 里 `(;A;B(;C)(;D))` 这种结构，**主分支 = 每个分支点的第一个子节点**（A,B,C），
     不是「遇到第一个 ( 就收工」—— 旧写法正是后者，于是真实棋谱只要在中盘挂一个
     变化图，后面全部丢掉。
     实测本机 21433 份职业棋谱（抽样 1500 份）：
       正确主线 106760 手 vs 旧写法 103282 手 → **16.9% 的文件被截断**；
       最惨的一份原 305 手只剩 3 手；AlphaGo 对李世石那局原 280 手只剩 15 手。
     （旧写法当初是为了解决「注释里的括号被当成分支」而写的 —— 那个问题现在由
       第 1 步的 tokenizer 自然解决了：括号在属性值里根本不会被当成 token。） */
  const nodes = [];                                      // 主分支上的属性节点（按出现顺序）
  /* ★★ 2026-10-13（段②）：把「走主分支、其余兄弟整块跳过」换成**正经建树** ——
     以前变着一读就丢（`skipTree`），所以「分支存不进棋谱、也读不回来」。
     SGF 的语法可以统一成一句话：
       **一棵树 = 一串节点；每个节点的子节点又是一个树列表，其中第 0 个是主变。**
         · `;A;B;C`     ＜＝＞ A 的子是 B、B 的子是 C（顺序节点 = 前一个的唯一子）
         · `(;C;E)(;D)` ＜＝＞ 上一个节点有 C、D 两个子，其中 C 自己还有个子 E
     统一之后：主线 = 「从根一路走 kids[0]」，与旧口径**完全等价**（所以下面第 3 步
     一行不用改）；而变着整棵留在树上，交给 sgfTreeToMoves 装成我们的 move 树。 */
  const parseTree = k => {                               // k 指向 '('，返回 { node, next }
    if (toks[k] !== '(') return null;
    k++;
    let first = null, cur = null;
    while (k < toks.length) {
      const t = toks[k];
      if (t === ')') { k++; break; }
      if (t === '(') {
        const sub = parseTree(k);
        if (!sub) { k++; continue; }                     // 空树 `()`：跳过，别把整棵解析带崩
        k = sub.next;
        if (cur) cur.kids.push(sub.node);                // 子变着挂在**上一层最后一个节点**上
        continue;
      }
      const nd = { tok: t, kids: [] };
      if (!first) first = nd; else cur.kids.push(nd);    // 顺序节点 = 前一个的唯一子
      cur = nd;
      k++;
    }
    return first ? { node: first, next: k } : null;
  };
  const head = toks.indexOf('(');
  const rootTn = head >= 0 ? parseTree(head) : null;      // 只解析第一棵树（一个文件可能串着好几局）
  /* 主路径 = 一路走 kids[0]。这就是旧 walk 的结果 —— 顺带修好了「变着图后面的手全丢」。 */
  for (let tn = rootTn && rootTn.node; tn; tn = (tn.kids.length ? tn.kids[0] : null)) nodes.push(tn.tok);

  /* ---------- 3) 取出棋谱自带的东西 ----------
     C[] = 这个节点上的**解说词**（很多棋谱有，实测抽查 600 份里 353 份带 —— 见开发记录）。
     归属：带 B/W 的节点 → 属于**这一手**；根节点 → 属于「开局前」（下标 0）。
     ★ 必须按**节点**扫（同一节点里 C 写在 B 前或后都不能错位），所以第 1 步分了组。 */
  const firstProp = id => {
    for (const nd of nodes) {
      for (const p of nd.props) if (p.id === id && p.vals.length) return p.vals[0];
    }
    return null;
  };
  const allPts = id => {
    const out = [];
    for (const nd of nodes) {
      for (const p of nd.props) {
        if (p.id !== id) continue;
        for (const v of p.vals) {
          if (v.length === 2) out.push({ x: v.charCodeAt(0) - 97, y: v.charCodeAt(1) - 97 });
        }
      }
    }
    return out;
  };
  /* SGF 值里的转义：`\]` → `]`、`\\` → `\`（换行是原文里的换行，保留） */
  const unsgf = v => String(v).replace(/\\([\s\S])/g, '$1');

  /* ★ 盘面大小必须**在遍历之前**读出来 —— 下面判越界坐标要用它
     （最典型的是 `zz` 这种题集分隔标记，不判就会算出下标 500 越出 361 格的盘面）。
     SZ 出现在根节点，而 nodes 就是从根节点开始按主分支收集的，所以扫得到。 */
  /* nodes 是 { props, at, end }，SZ 在 props 内；复用属性读取器，
     避免把节点当成属性后永远回退到 19 路。 */
  const declaredSize = parseInt(firstProp('SZ'), 10);
  const boardSize = declaredSize >= 2 && declaredSize <= 52 ? declaredSize : 19;

  const moves = [], comments = [], mainLine = [], seps = [];
  /* 根节点（棋谱开头那个节点）的说明文字 —— 单独存，不占「第 0 手」那个键。
     实测抽样 300 份真实棋谱：116 份的根节点带 C（38%），
     其中一部分以前**整段读不出来**（被后面第 0 手的 C、或被 tokenizer 劈错吃掉）。 */
  let rootComment = '';
  for (const nd of nodes) {
    /* 先看这个节点是不是一手棋（一次扫全部 props，所以 C 的位置无关） */
    let movesHere = [];
    for (const p of nd.props) {
      if (p.id !== 'B' && p.id !== 'W') continue;
      const color = p.id === 'B' ? 'b' : 'w';
      const v = p.vals.length ? p.vals[0] : '';
      if (!v) { movesHere.push({ color, pass: true }); continue; }   // [] = 停一手
      if (v.length !== 2) continue;
      /* ★ 这里用 charCode-97 而不是查表 —— SGF 是 a=1…h=8,**i=9**,j=10…s=19，
         与界面/GTP 那套「跳过 I」的字母表**不同**（见文件顶部 SGF_COLS 的注释）。 */
      const x = v.charCodeAt(0) - 97, y = v.charCodeAt(1) - 97;
      /* ★ 越界坐标不能当真实一手棋（2026-10-06 审查发现，真实棋谱里 2.97% 出现）。
         最常见的是 `;W[zz]` / `;B[zz]` —— 它不是坏数据，而是**死活题集里两张题
         之间的分隔标记**（前一节点的解说词正好写着「以上为第 N 图正解」）。
         原来的错：算成 x=25,y=25 → 下标 500，而盘面只有 361 格，
         TypedArray **静默忽略越界写、不报错** → 那手棋凭空消失，
         但它仍算进手数 → 后面全部手顺错位、黑白颠倒。
         现在：不生成 move（这一手在盘上不存在），并记成 sep 让上层知道
         「这里换了一道题」—— 具体要不要分段显示，见 renderCommentBox 的用法。 */
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || y < 0 || x >= boardSize || y >= boardSize) {
        seps.push(moves.length + (movesHere.length - 1));
        continue;
      }
      movesHere.push({ color, x, y });
    }
    moves.push(...movesHere);
    /* 再收这个节点上的解说词，并记下它在**原文里的位置**（编辑时要用它精确落刀）
       ★ 根节点说明的归属：**主分支上第一个没有落子的节点**（它不属于任何一手）。
         为什么这么定（实测 300 份真实棋谱校出来的，三种形态都得覆盖）：
           a) 死活题集：第一个节点就是根节点，摆子 AB/AW 和说明 C 都在这上面
              （`(;AB[…]AW[…]C[手筋辞典…第55图 黑先]…`）；
           b) 古谱（当湖十局那类）：第一个节点只有 FF/PB/RE 这些元数据，
              摆子写在第二个节点上 —— 但说明也在第一个节点上；
           c) 目录页 / 只有元数据的棋谱：第一个节点没有摆子，
              只有一句 C（实测 `00_mulu.sgf` 是《兼山堂弈谱》目录、`Shusai-092.sgf`
              是「Moves after 128 not recorded」）—— 这两种原来**整段读不出来**。
         所以判据只能是「第一个没有落子的节点」，不能加「必须带摆子」这个条件。 */
    const isRoot = movesHere.length === 0 && !rootComment;
    let cSpan = null;
    for (const p of nd.props) {
      if (p.id !== 'C' || !p.vals.length) continue;
      if (p.valAt && p.valAt.length) cSpan = [p.valAt[0], p.valAt[0] + p.vals[0].length];
      /* ★★ 2026-10-06 深夜补（用户报「一点开编辑，所有文段自动划分并加空行」）。
         真凶：有些棋谱（实测用户那份「绝艺解说」的职业棋谱）换行写的是
         **`\r\r\n`（CR CR LF）**，全文 690 处；而 `<div pre-wrap>` 把它渲染成
         「一个换行」，`<textarea>` 按 HTML 规范只保留 LF → `\r\r\n` 变成 `\n\n`
         → **显示是紧凑的、编辑框里每句之间多一个空行**。
         也就是说：这段文字在文件里本来就"多了一个 CR"，只是在只读显示时看不出来。
         修法：解析时就用 nlForSGF 归一化（把 `\r\r\n` / 裸 CR / 裸 LF 全归成 CRLF）。
         这样显示与编辑拿到的是**同一个值**，而且写回磁盘的也是同一个口径（幂等）。 */
      /* 紧一点：把连续空行收成一个（见 tightenSGFText 的注释） */
      const txt = tightenSGFText(nlForSGF(unsgf(p.vals[0])));
      if (!txt.trim()) continue;
      if (isRoot) rootComment = txt;
      else comments[movesHere.length ? moves.length : 0] = txt;
    }
    mainLine.push({
      at: nd.at, end: nd.end,
      /* isRoot：这一条代表「根节点那段说明」。保存根节点说明时用它找落刀位置。 */
      isRoot: isRoot,
      moveIdx: movesHere.length ? moves.length : 0,
      cSpan,
    });
  }
  /* 盘面大小：上面已按 nodes 里的 SZ 算过 boardSize，这里直接用同一个值，
     **不重新解析** —— 两份口径（一个不限范围、一个限 2~52）万一哪天不一致，
     就会出现「按 19 路拦越界、却按 52 路开棋盘」这种错位。 */
  const size = boardSize;
  const kmRaw = firstProp('KM');
  const komi = kmRaw === null ? null : parseFloat(kmRaw);
  const ab = allPts('AB'), aw = allPts('AW');
  const ru = String(firstProp('RU') || '').toLowerCase();
  let rules = 'chinese';
  if (ru.indexOf('japan') >= 0) rules = 'japanese';
  else if (ru.indexOf('korea') >= 0) rules = 'korean';
  else if (ru.indexOf('chinese') >= 0 && komi === 0 && ab.length === 2 && aw.length === 2) {
    rules = 'ancient';       // 明清：导出时 RU 也写 Chinese，靠「座子各 2 + 不贴目」认出来
  }
  /* 双方名字（别的软件导出的棋谱大多有；没有就是 null） */
  const pb = firstProp('PB'), pw = firstProp('PW');
  return {
    ok: moves.length > 0 || ab.length > 0, size, komi, rules, ab, aw, moves, pb, pw,
    comments, rootComment, mainLine,
    /* ★ 段②（2026-10-13）：整棵变着树（SGF 树节点，`{ tok, kids }`）。
       applyRecord 用它装成我们的 move 树（_p/_cs），于是打开棋谱就能 ↑/↓ 切分支。
       没有变着的棋谱这里就是一条 0 分叉的链 —— 行为与以前一样。 */
    tree: rootTn ? rootTn.node : null,
    /* 「换了一道题」的位置（题集里 `zz` 分隔标记所在的手数）。
       我们**不做分支树、也不做多题分段显示**（用户定的：只显示主干），
       但保留这个信息 —— 将来若要做「第 3 题」这类提示，不用再改解析器。 */
    seps
  };
}

/* ---------- 换行符归一（2026-10-06）----------
   ★ 用户报的现象：「显示没空行 → 点编辑有空行 → 保存后有空行」。
   根因：真实棋谱里换行**大多写的是 CRLF**（实测抽样 2000 份，根节点解说词里
   251 份含 CRLF）。而 HTML 的 <textarea> 有一条规范行为：
   **通过 .value 读回来时，CRLF 会被规范化成 LF**。于是：
     显示（div + pre-wrap）   拿到原文的 CRLF
     编辑（textarea.value） 拿到规范化后的 LF
   写回时把 ta.value 原样塞回 SGF —— 那处 CRLF 就被换成了 LF。
   同一个文件里 LF 与别处的 CRLF 混排，换个查看器打开，空行就冒出来了。

   修：写回前统一成 CRLF（Windows 上 SGF 的通行写法，也是原文件的口径）。
   ★ 顺序要紧：必须**先合并 CRLF 再统一转回 CRLF** ——
     少这一步会变成 CRCRLF，那才是真的多出一个空行。 */
function nlForSGF(t) {
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  return String(t == null ? '' : t)
    .split(CR + LF).join(LF)      // CRLF → LF
    .split(CR).join(LF)          // 落单的 CR → LF
    .split(LF).join(CR + LF);    // LF → CRLF
}

/* ---------- 把连续空行收成一个（2026-10-06 深夜，用户第二次报同一个现象）----------
   ★ 用户的原话：「一点开编辑，所有文段自动划分并加空行」。
   第一轮我只修了 `\r\r\n`（CR CR LF）——那确实是一种"假空行"。但用户又发来截图，
   指着第 38 手说还有。查下去才明白：**他嫌的不是假空行，是空行本身**。
   实测他这份「绝艺解说」职业棋谱（499 条 C[]）：25 条带换行，
      · 21 条是 `\r\r\n`（第一轮修的）
      · 4 条是正常的 `\r\n\r\n`（段落空行）
   两种在他的界面上都是「每句之间空一行」。而棋谱解说大多是**一句一行**的弹幕体，
   空行只是导出工具排版留下的，读起来反而散。
   所以这里再收一道：**连续两个及以上的换行压成一个**。
   ★ 三处一致：显示（div）、编辑（textarea）、写回磁盘都用这个口径 ——
     用户第一次报的正是"显示和编辑不一样"，不能再留这种缝。
   ★ 非破坏性：只影响**界面与写回**的呈现；原文件在被用户主动保存前一字不动。 */
function tightenSGFText(t) {
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  const CRLF = CR + LF;
  const parts = String(t == null ? '' : t).split(CRLF);
  /* ★ 第一版这里写错了两次，都记下来（判据/实现各错一次）：
     ① 条件写成 `blank(p) && out.length && 上一个 === ''` ——
        `'a'` 之后第一个空串会被 push，第二个空串来比较时比的是 `'a'`，
        于是一个也压不掉（实测输出与输入一模一样）。
     ② 我又想"保留一个空行当段落分隔"，但用户要的是**紧凑**：
        他这份棋谱的解说是一句一行的弹幕体（「等于芈昱廷和李钦诚的位置互换」
        这种），空行只是导出工具排版留下的 —— 留着就是"每句之间空一行"。
     所以现在：**空行一律去掉**（含只在空白字符的行、含首尾）。 */
  const kept = parts.filter(p => p.replace(/\s/g, '') !== '');
  return kept.join(CRLF);
}

/* ---- 把某一手（或根节点）的解说词写回 SGF 文本（2026-10-06） ----
   做法：**只在原文里替换/插入那一个节点上的 C[]**，其余字符一个都不动。
   为什么必须这么做（而不是用 buildSGF 重新生成一份）：
   我们的导出只写主分支、不认识变体/别的属性 —— 拿它覆盖用户下载来的棋谱，
   会把变体、引擎信息、别的注释**全部抹掉**。所以这里把文件当"文本"处理，
   靠 parseSGF 交出来的节点位置精确落刀。
   at：手数；at === -1 表示**根节点那段说明**（它不属于任何一手）。
   返回 { ok, text } 或 { error }。 */
/* 落刀本体：把新解说词写进 `span` 指定的那个节点（span = { cSpan, end }）。
   抽出来是因为有两个入口（主线的 `patchSGFComment` 与任意节点的 `patchSGFCommentAtNode`），
   而「C[..] 在原文里的字符区间怎么动」这套算法只有一份，不能抄两遍。 */
function applyCommentPatch(text, span, newText) {
  /* ★ 写回前把换行统一成 CRLF（见上面 nlForSGF 的注释） */
  const esc = nlForSGF(newText).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
  if (span.cSpan) {
    if (!newText) {
      /* 清空 → 把整个 C[..] 删掉（'C[' 在值的左两格：标识 1 字符 + '['） */
      const s = span.cSpan[0] - 2, e = span.cSpan[1] + 1;
      return { ok: true, text: text.slice(0, s) + text.slice(e) };
    }
    return { ok: true, text: text.slice(0, span.cSpan[0]) + esc + text.slice(span.cSpan[1]) };
  }
  if (!newText) return { ok: true, text };          // 本来没有、又要清空 → 什么都不用做
  /* 没有 C[] → 插在这个节点最后一个属性的后面 */
  return { ok: true, text: text.slice(0, span.end) + 'C[' + esc + ']' + text.slice(span.end) };
}

function patchSGFComment(text, at, newText) {
  const p = parseSGF(text);
  const ent = at === -1
    ? (p.mainLine || []).find(x => x.isRoot)
    : (p.mainLine || []).find(x => !x.isRoot && x.moveIdx === at);
  if (!ent) {
    return { error: at === -1 ? '这份棋谱的根节点上没有说明文字' : '这份棋谱里找不到第 ' + at + ' 手' };
  }
  return applyCommentPatch(text, ent, newText);
}

/* ---- 按**节点**把解说词写回原文件（段②，2026-10-13）----
 *
 * 为什么必须补这个入口：原来的 `patchSGFComment` 靠 `mainLine`（**主线扁平口径**）
 * 里 `moveIdx === at` 那条定位 —— 旁支的手在原文里是**另一个节点**，
 * 拿主线第 4 手的落点去写旁支第 4 手的解说词，等于**改错用户的文件**（不可逆）。
 * 之前的权宜之计是「旁支一律拒绝写回」（`onMainline` 守卫），那条守卫现已撤掉。
 *
 * 定位办法：节点上带 `_sgfIdx`（打开棋谱时由 `sgfTreeToMoves` 发的序号），
 * 重新 parse 文件后按**同序**摊平（`sgfIndexAllTokens`）就能换回同一个 token。
 * ⚠️ 序号对上了还要**校验坐标**：文件若在外部被改过（手数变了），序号会整体错位 ——
 *    那时宁可拒绝，也不能把解说词写到别人头上。 */
function patchSGFCommentAtNode(text, node, newText) {
  if (!node) return { error: '这一手不在盘上' };
  if (node._sgfIdx === undefined) {
    return { error: '这一手是打开棋谱之后新下的 —— 原文件里没有它，写回去没有落点' };
  }
  const p = parseSGF(text);
  const list = sgfIndexAllTokens(p.tree, p.size);
  const ent = list[node._sgfIdx];
  const same = ent && (!!ent.mv.pass === !!node.pass)
    && (node.pass || (ent.mv.x === node.x && ent.mv.y === node.y));
  if (!same) {
    return { error: '定位不到这一手在原文里的位置（文件可能被外部改过），先不写' };
  }
  const tok = ent.tok;
  let cSpan = null;
  for (const pr of tok.props) {
    if (pr.id !== 'C' || !pr.vals.length) continue;
    if (pr.valAt && pr.valAt.length) cSpan = [pr.valAt[0], pr.valAt[0] + pr.vals[0].length];
  }
  return applyCommentPatch(text, { cSpan, end: tok.end }, newText);
}

/* 把解析出来的棋谱装进当前局面。
   srcName = 棋谱库里的文件名（有它才能把讲解存回这份棋谱旁边） */
function applyRecord(rec, srcName) {
  if (!rec || !rec.ok) { flash('这份棋谱读不出手顺（格式可能不常见）'); return; }
  /* ★ 换棋谱时先退出解说词编辑态（2026-10-06）。
     不退的话：① 框里还留着上一份棋谱的半截文字，render 又不敢重画
     （「正在编辑就返回」那道守卫），于是那段文字会跟着走进新棋谱 ——
     用户以为在改新棋谱，实际在改旧的。 */
  exitCommentEdit();
  state.recName = String(srcName || '');
  settings.size = [9, 13, 19].indexOf(rec.size) >= 0 ? rec.size : 19;
  settings.rules = RULES[rec.rules] ? rec.rules : 'chinese';
  settings.komi = (rec.komi !== null && !isNaN(rec.komi)) ? rec.komi : RULES[settings.rules].komi;
  settings.handicap = 0;                 // 让子 / 座子由 setup 表达
  settings.mode = 'free';                // 打开棋谱按「摆棋」看：两边都能接着摆
  state.noGame = false;                  // ★ 打开棋谱就是「有内容了」：解除未开局状态
  state.fromRecord = true;               // ★ 打谱：选点讲解对它禁用（别人的棋，不替人支招）
  clearCoachPanels();                    // 换了棋谱 → 两个框清空（「全盘讲解」按钮这时才露出来）
  N = settings.size;
  state.setup = [
    ...rec.ab.map(p => ({ x: p.x, y: p.y, color: 'b' })),
    ...rec.aw.map(p => ({ x: p.x, y: p.y, color: 'w' })),
  ];
  /* ★★ 段②（2026-10-13）：棋盘从**变着树**装 —— 主线 = 每个分叉点第 0 条
     （与 `rec.moves` 同一条线），其余分支挂在 `_cs` 上，于是打开棋谱就能 ↑/↓ 切。
     读不出树（老格式 / 畸形）时退回旧的扁平口径，行为与以前一致。 */
  branchRoot = { _p: null, _cs: [], _virtual: true, x: -1, y: -1, color: null };
  treeExpanded.clear(); treeForceOpen.clear(); treeExpandSeq.clear();   // 换棋谱 = 全新一棵树，展开集存的是旧节点引用，必须清
  branchTrash = null; pendingDel = null; // ★ 坑位 37 同源：换棋谱也要作废「上一棵树的」回收站与待删登记
  state.moves = [];
  if (rec.tree) sgfTreeToMoves(rec.tree, branchRoot, 0, state.moves, rec.size, { n: 0 });
  if (!state.moves.length) {
    state.moves = rec.moves.slice();
    branchRoot = null;                   // 没有树 → 交给 ensureBranch 按老路子重建
  }
  /* ★ 棋谱自带的解说词（SGF 的 C[]，主分支逐手）—— 右下角那个「解说词」框就是显示它。
     没有就是空数组（多数自己导出的棋谱没有）。 */
  state.sgfComments = Array.isArray(rec.comments) ? rec.comments.slice() : [];
  /* 棋谱**根节点**的说明文字（题集出处、第几图、谁整理的）——
     单独存，不跟「第 0 手」抢键。它在解说词框的「（开局前）」那一档显示。 */
  state.rootComment = String(rec.rootComment || '');
  /* 一份题集里串了多道题时的分界位置（`zz` 分隔标记所在的手数）——
     只用来显示「第 N 题 / 共 M 题」，**不做切换**。 */
  state.quizTips = Array.isArray(rec.seps) ? rec.seps.slice() : [];
  /* 棋谱里带的双方名字 → 右侧 ID 栏（没有就留空，回落到默认叫法） */
  const cleanName = v => String(v || '').replace(/[\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  state.names = { b: cleanName(rec.pb), w: cleanName(rec.pw) };
  state.toMove = sideToMove(state.moves.length);
  /* ★ 打开棋谱时**不拦打劫**（KaTrain 第 135 行同理：重放棋谱用 `ignore_ko=True`，
     因为那些手的合法性无法追溯、而且往往本来就是"打完劫之后"的局面）。
     但**禁着点要算出来** —— 用户接着往下摆时得受劫规则约束。
     先补 `capAt`（棋谱手顺里没有这个字段），再反推禁着点。 */
  state.koPoint = null;
  rebuildCapAt();
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves, state.moves.length);
  state.viewAt = state.moves.length;
  state.candidates = []; state.candAt = -1;
  state.ownership = null; state.ownAt = -1;
  state.history = [];
  state.leads = [];
  state.histVisits = [];
  resetAnalysisState();         // 换了棋谱：旧的分析欠账 / 「已上屏」标记全部作废
  state.result = null;
  state.draft = null;
  state.lastEval = null;
  state.review = null;          // 换了棋谱 → 上一次的复盘数据作废
  state.pv = null;              // 变化图也收掉（候选点马上就变了）
  setSeg('seg-mode', 'free');
  clockReset();
  resize();
  syncUI();
  flash('已打开棋谱 · ' + state.moves.length + ' 手 · ' + RULES[settings.rules].label);
  /* ★ 这份棋谱以前做过「全盘讲解」的话，把讲解读回来（用户要求：
     结果跟棋谱一起保存，下次打开还要能看到）。异步读、不挡打开。 */
  if (state.recName) loadCoachForRecord(state.recName);
  /* ★★ 2026-10-13 用户要求：**每手胜率也一起带出来**。
     数据一直在 `<棋谱名>.review.json` 里（history/leads/losses），
     只是以前打开棋谱时不读它 —— 要另点「复盘报告」才有。
     现在打开就能看到手数列表的涨跌列和走势图。异步读、不挡打开。 */
  if (state.recName) loadReviewForRecord(state.recName);
}

/* 存进棋谱库 */
async function saveToRecords() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const realMoves = state.draft ? state.draft.from : state.moves.length;   // 草稿不进棋谱
  const name = `${stamp}-${realMoves}手.sgf`;
  const r = await window.api.records.save(name, buildSGF());
  if (!r || r.error) { flash('保存失败：' + ((r && r.error) || '未知')); return null; }
  /* ★ 2026-10-12：保存成功后记住这份棋谱的文件名 —— 之后用户再点名字改名时，
     bindClockName 才知道该写回哪个文件（不然只能等到下次保存）。 */
  if (r.name) state.recName = r.name;
  flash('已存进棋谱库 · ' + r.name + '（顶栏「棋谱库」里能看到）');
  return r;
}

$('btn-save').onclick = () => { saveToRecords(); };   // 原先下载到系统，现在改存进棋谱库

/* ---------- 棋谱库弹窗 ---------- */
const REC_MASK = $('records');

const fmtRecTime = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* 棋谱库的搜索词 —— 纯前端过滤（列表本来就在内存里，不必再读盘）。
   打开面板时**不清空**：连着看好几份棋谱时，搜索词留着更方便。 */
let recFilter = '';

async function refreshRecords() {
  const ul = $('reclist');
  const all = (await window.api.records.list()) || [];
  /* ★ 搜索/筛选（2026-10-04 用户要求）：备注名 + 文件名 一起模糊匹配 */
  const kw = recFilter.toLowerCase();
  const list = kw ? all.filter(it => ((it.note || '') + ' ' + it.name).toLowerCase().includes(kw)) : all;
  const cnt = $('rec-count');
  if (cnt) {
    cnt.textContent = all.length
      ? (kw ? '筛出 ' + list.length + ' / 共 ' + all.length + ' 份' : '共 ' + all.length + ' 份')
      : '';
  }
  ul.textContent = '';
  if (!all.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '棋谱库还是空的 —— 下完棋点底栏「导出棋谱」就会存进来';
    ul.appendChild(li);
    return;
  }
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '没有匹配「' + recFilter + '」的棋谱';
    ul.appendChild(li);
    return;
  }
  for (const it of list) {
    const li = document.createElement('li');
    /* 两行显示（用户要求「显示备注名和文件名」）：
       上行 = 备注名（存在 SGF 的 GN 字段里）；下行 = **真实文件名**（灰色小字）。
       没写过备注时就只显示文件名一行，免得两行是同一串东西。 */
    const info = document.createElement('div');
    info.className = 'rec-info';
    const hasNote = !!(it.note && it.note.trim());
    const nm = document.createElement('span');
    nm.className = 'rec-name';
    nm.textContent = hasNote ? it.note : it.name.replace(/\.sgf$/i, '');
    nm.title = hasNote ? (it.note + '\n文件：' + it.name) : it.name;
    info.appendChild(nm);
    if (hasNote) {
      const fn = document.createElement('span');
      fn.className = 'rec-file';
      fn.textContent = it.name;
      info.appendChild(fn);
    }
    const meta = document.createElement('span');
    meta.className = 'rec-meta';
    /* ★★ 2026-10-13 修用户报的问题：「棋谱库里显示带讲解，打开却是空的」。
       根因：标记只看 `.coach.json` **在不在**，不看讲解的**格式版本** ——
       改过讲法之后旧讲解会作废（COACH_VER 对不上就不显示）。
       现在分三种标法，用户一眼能看出该做什么：
         · 版本一致        → 「带讲解」
         · 有文件、版本旧  → 「讲解要重讲」（不是坏了，是讲法升级了）
         · 没有文件        → 不标 */
    const coachTag = !it.hasCoach ? ''
      : (it.coachVer === COACH_VER ? ' · 带讲解' : ' · 讲解要重讲');
    meta.textContent = Math.max(1, Math.round(it.size / 1024)) + ' KB · ' + fmtRecTime(it.mtime)
      + (it.hasReview ? ' · 已复盘' : '')
      + coachTag;
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = fn;
      return b;
    };
    li.append(info, meta,
      mk('打开', '载入这份棋谱', () => openRecord(it.name)),
      /* AI 复盘：整盘逐手重算 → 出报告 + 在手数列表/走势图上标失误。
         叫「AI 复盘」而不是「复盘」，免得和棋谱软件里那个「一步一步翻」的meaning 混。
         ★ 2026-10-04 用户要求：点完之后**先手动选搜索量**（默认 500），所以这里
           只负责开选档面板，真正开跑在 openReviewSetup 里。 */
      (() => {
        const b = mk('AI 复盘', '整盘逐手重算，出一份报告（点开会先让你选搜索量）', () => openReviewSetup(it));
        b.classList.add('primary');
        return b;
      })(),
      /* 复盘报告：打开**上一次复盘存下来的报告**（records/<棋谱名>.review.json）。
         ★ 用户要求：没有报告时置灰点不了；新报告生成时会覆盖旧的 —— 所以这里永远是「最新那一份」。 */
      (() => {
        const b = mk('复盘报告',
          it.hasReview ? '打开已存的复盘报告（最新的那一份 · 会载入这份棋谱）'
            : '这份棋谱还没复盘过 —— 先点「AI 复盘」',
          () => openSavedReview(it.name, it.note));
        if (!it.hasReview) b.disabled = true;
        return b;
      })(),
      /* 备注：写在 SGF 的 GN 字段里，**不改文件名**。
         （Electron 里 window.prompt() 用不了 → 就地展开一个输入框） */
      mk('备注', '写一个备注名（存进棋谱的 GN 字段，文件名不动）', () => {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = it.note || '';
        inp.placeholder = '给这份棋谱写个备注…';
        const ok = document.createElement('button');
        ok.textContent = '确定';
        const no = document.createElement('button');
        no.textContent = '取消';
        const commit = async () => {
          const r = await window.api.records.setNote(it.name, inp.value);
          if (r && r.error) flash('备注失败：' + r.error);
          else flash(r && r.note ? '备注：' + r.note : '已清空备注');
          refreshRecords();
        };
        ok.onclick = commit;
        no.onclick = () => refreshRecords();
        inp.onkeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') refreshRecords();
        };
        li.textContent = '';
        li.append(inp, ok, no);
        inp.focus(); inp.select();
      }),
      /* ★ 2026-10-12 用户要求：加「覆盖」—— 把当前这盘棋直接写进这份棋谱。
         用户原话：「改完的棋谱不方便保存，保存了会是一个新的，原来那个还在，
         需要手动删，麻烦」。所以放在「删除」前面，一键替换。
         ★ 走 records.save：它自己会先留一份 .bak 备份、并按**原编码**写回
           （GBK 棋谱不会被改成 UTF-8），所以覆盖是能捞回来的。 */
      mk('覆盖', '把当前这盘棋写进这份棋谱，替换它原来的内容（覆盖前会自动留一份 .bak 备份，可以捞回来）', function () {
        if (state.moves.length < 2) {
          flash('当前还没有棋局内容 —— 覆盖会把这份棋谱清空，先下几手再来');
          return;
        }
        /* ★ 首相 2026-10-12 特别确认过「覆盖」的含义 —— 这里用的就是
           **当前棋盘上的这一盘棋**（buildSGF() 出来的那份：当前手顺、当前贴目与规则、
           当前摆上的子），不是从别处拷一份过来覆盖。 */
        window.api.records.save(it.name, buildSGF()).then(r => {
          if (!r || r.error) { flash('覆盖失败：' + ((r && r.error) || '未知')); return; }
          /* ★ 坑位 42：覆盖的就是眼下打开的这份 → 内存里按手号存的复盘/讲解属于**覆盖前**的内容，
             现在棋盘已经是另一盘了，继续显示就是错挂 —— 收起来，并说清怎么再拿回来。
             （磁盘上那两个文件不动：下次打开时由主线指纹 `sg`/`sig` 自动判定不采信。） */
          if (it.name === state.recName) {
            state.review = null;
            state.coach.explain = {};
            coachRenderedAt = -999;
            renderCoachPanels(true);
            renderMoveList();
            renderCurve();
          }
          flash('已用**当前这盘棋**覆盖 · ' + it.name + '（原来的内容留了 .bak 备份；'
            + '这份棋谱旁边的**逐手讲解和复盘数据**是按手号存的，已经对不上新内容了 —— '
            + '要用请重跑「AI 复盘」和「全盘讲解」）');
          refreshRecords();
        });
      }),
      /* 删除：不用 confirm（Electron 里不可靠）→ 就地变「确认删除？」按钮，3 秒后自动还原 */
      mk('删除', '移到系统回收站（可以恢复）', function () {
        if (this.dataset.armed !== '1') {
          this.dataset.armed = '1';
          this.textContent = '确认删除？';
          this.classList.add('danger');
          setTimeout(() => {
            if (this.dataset.armed === '1') {
              this.dataset.armed = '';
              this.textContent = '删除';
              this.classList.remove('danger');
            }
          }, 3000);
          return;
        }
        this.dataset.armed = '';
        window.api.records.remove(it.name).then(r => {
          flash(r && r.error ? '删除失败：' + r.error : '已移到回收站');
          refreshRecords();
        });
      }),
    );
    ul.appendChild(li);
  }
}

async function openRecord(name) {
  const r = await window.api.records.read(name);
  if (!r || r.error) { flash('读取失败：' + ((r && r.error) || '未知')); return; }
  REC_MASK.classList.remove('open');
  applyRecord(parseSGF(r.text), name);
}

$('btn-records').onclick = async () => {
  REC_MASK.classList.add('open');
  const d = await window.api.records.dir();
  $('rec-dir').textContent = d || '';
  refreshRecords();
};
$('rec-close').onclick = () => REC_MASK.classList.remove('open');
$('rec-open-dir').onclick = () => window.api.records.openDir();
/* 「更改文件夹…」：和「设置」里那一项是**同一个配置项**，只是入口不同（用户要求两个地方都能改）。
   改完会把已有棋谱**复制**一份过去（老的留着不删），并如实报复制了几份、跳过几份。 */
$('rec-change-dir').onclick = async () => {
  const r = await window.api.settings.choose('recordsDir');
  if (!r || r.canceled) return;
  if (!r.ok) { flash('这个文件夹用不了 —— 可能没写权限，换一个试试'); return; }
  const res = await window.api.records.setDir(r.path);
  if (!res || res.error) { flash(res && res.error || '换不了'); return; }
  $('rec-dir').textContent = res.dir || '';
  await refreshRecords();
  const m = res.moved || { copied: 0, skipped: 0, failed: 0 };
  let tip = '棋谱库已改到：' + (res.dir || '');
  if (m.copied) tip += '；已把 ' + m.copied + ' 份棋谱复制过去';
  if (m.skipped) tip += '；' + m.skipped + ' 份同名文件已存在，没覆盖';
  if (m.failed) tip += '；有 ' + m.failed + ' 份没搬成';
  if (m.copied) tip += '。**老位置的没删**，确认新地方对了你自己删掉就行。';
  flash(tip);
};
$('rec-save-now').onclick = async () => {
  if (!state.moves.length) { flash('还没落子，没什么可存的'); return; }
  await saveToRecords();
  refreshRecords();
};

/* 搜索框：边打边筛（列表不大，直接重渲染最简单可靠） */
$('rec-search').oninput = () => {
  recFilter = $('rec-search').value.trim();
  refreshRecords();
};

/* 导入棋谱（2026-10-04 用户要求）：弹系统文件框（可多选），主进程负责复制进棋谱库。
   校验、重名、非法文件都在主进程做 —— 前端只管把结果显示出来。 */
$('rec-import').onclick = async () => {
  const btn = $('rec-import');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '导入中…';
  let r;
  try { r = await window.api.records.importSgf(); }
  catch (e) { r = { error: String(e) }; }
  btn.disabled = false; btn.textContent = old;

  if (!r || r.canceled) return;                     // 用户把选择框关掉了：什么都不做
  if (r.error) { flash('导入失败：' + r.error); return; }
  const okN = (r.imported || []).length;
  const bad = r.failed || [];
  if (okN && !bad.length) flash('已导入 ' + okN + ' 份棋谱');
  else if (okN) flash('导入 ' + okN + ' 份，跳过 ' + bad.length + ' 份：' + bad.join('；'));
  else flash('没能导入：' + (bad.join('；') || '没选到可用的 SGF 文件'));
  refreshRecords();
};
REC_MASK.addEventListener('click', e => { if (e.target === REC_MASK) REC_MASK.classList.remove('open'); });

/* HTML 转义：棋谱备注名是用户输入，塞进 innerHTML 前必须转义 */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ---------------- AI 复盘（整盘逐手重算） ----------------
   流程：顶栏「AI 复盘」→ 选棋谱 → 引擎**一次请求**算完每一手 → 出报告，
   并把每手的「目损」标到右下角手数列表和胜率走势图上。

   ★ 为什么不逐手发请求：KataGo 的 analysis 支持 analyzeTurns 数组，
     一次请求就能把整盘每一手都算完（实测 ≈ 0.6 秒/手），逐手发会慢一个数量级。 */

/* 复盘每手的搜索量。
   历程：写死 200（快但糙）→ 跟随底栏「计算深度」→ ★ 2026-10-04 用户拍板
   「点 AI 复盘后手动设置，默认 500」：每次点「AI 复盘」先弹面板让他当场选档
   （见 openReviewSetup），选完写进 settings.reviewVisits。
   好处：不会因为底栏调到 3000 就把一次复盘意外拖成十几分钟，也不会因为底栏是 100
   就把目损算得太糙 —— 复盘该算多深，由点的那一刻决定。 */
function reviewVisits() { return settings.reviewVisits || 500; }

/* 复盘耗时估算（给选档面板看的参考）。实测约 0.4 秒/手（500 visits），按比例换算。 */
function reviewEta(nMoves, visits) {
  const sec = Math.max(1, Math.round(nMoves * 0.4 * (visits / 500)));
  return sec < 60 ? '约 ' + sec + ' 秒' : '约 ' + (sec / 60).toFixed(1) + ' 分钟';
}

/* 失误分级 —— 档位照抄 KaTrain 的 12 / 6 / 3 / 1.5 / 0.5 目 */
const LOSS_LEVELS = [
  { th: 12,  cls: 'lv5', label: '严重失误' },
  { th: 6,   cls: 'lv4', label: '大失误' },
  { th: 3,   cls: 'lv3', label: '失误' },
  { th: 1.5, cls: 'lv2', label: '小失误' },
  { th: 0.5, cls: 'lv1', label: '轻微' },
];
const lossLevel = v => LOSS_LEVELS.find(l => v >= l.th) || null;

/* 段位估算 —— ⚠️ **启发式**：按「整盘平均目损」粗略换算。
   没有官方标准，也没有「标准人类棋手」可对照（KataGo 官方对档位的措辞是「模仿」而非「等同」）。
   真正的校准方式是：挑一档跟 AI 下几盘看胜负。UI 上必须把这句话写给用户。 */
const RANK_BY_LOSS = [
  [1.0, '约 3 段以上'], [1.6, '约 1~2 段'], [2.4, '约 1~3 级'],
  [3.5, '约 4~8 级'], [5.0, '约 9~13 级'], [7.0, '约 14~18 级'],
  [Infinity, '约 18 级以下'],
];
const estRank = avg => (avg === null ? '—' : (RANK_BY_LOSS.find(r => avg < r[0]) || RANK_BY_LOSS[RANK_BY_LOSS.length - 1])[1]);

let reviewBusy = false;
/* 复盘的「进门取号」：每次点「开始复盘」同步 +1。
   用来挡住「判定与上锁之间那几毫秒内连点两次」的双开 —— 见 runReview 里的说明。 */
let reviewSeq = 0;

/* KataGo 的 scoreLead 是「**当前走棋方**视角」（跟 ownership / winrate 同一套视角规则），
   所以要比较两回合必须统一换算。这里统一成「黑方领先多少目」。 */
function blackLeadOf(root) {
  if (!root || typeof root.scoreLead !== 'number') return null;
  return String(root.currentPlayer || '').toUpperCase() === 'W' ? -root.scoreLead : root.scoreLead;
}

/* 逐手目损：拿相邻两个回合的「黑方领先」相减。
   turns[t] = 第 t 手**落下之前**的局面（t = 0..N —— 多算的那个 N 是「最后一手之后」，
   专门用来补出最后一手的损失，否则最后一手永远算不出来）。
   黑下的手 → 黑领先的减少量；白下的手 → 白领先的减少量（等价于黑领先的增加量）。

   ★ 为什么不用「AI 首选的分 − 实际手的分」：引擎会把明显差的手**剪枝掉**
     （实测 40% 的回合找不到实际手，而那恰恰是最该被点评的失误）。
     根节点评估则是**每一手都有**，覆盖率 100%，且实测与前者结果吻合
     （同一盘最大失误：这条路算 4.59 目 / 前者算 5.05 目）。 */
function computeLosses(turns) {
  const out = [];
  for (let t = 0; t + 1 < turns.length; t++) {
    const a = blackLeadOf(turns[t] && turns[t].root);
    const b = blackLeadOf(turns[t + 1] && turns[t + 1].root);
    if (a === null || b === null) { out.push(null); continue; }
    const isBlack = String(((turns[t] || {}).root || {}).currentPlayer || '').toUpperCase() !== 'W';
    out.push(Math.max(0, isBlack ? (a - b) : (b - a)));
  }
  return out;
}

/* 分段：按手数比例切（布局 / 中盘 / 终盘）。用比例而不是固定手数 —— 9 路棋谱只有几十手，
   固定写「1-50 手是布局」就全归到布局里了。 */
function segOf(i, n) {
  if (n <= 0) return 0;
  const r = i / n;
  return r < 0.3 ? 0 : (r < 0.75 ? 1 : 2);
}
const SEG_NAMES = ['布局', '中盘', '终盘'];

/* 复盘结果结构（**v2**，2026-10-04）：
   ★ 为什么改：v1 把**黑白双方**的目损混在一起算平均、混在一起数失误。
     实测一份 115 手的棋谱：混算得到「平均目损 0.35 目 · 3 手失误（最大 8.6 目）」，
     拆开却是 —— 黑方 0.23 目、**0 手失误**；白方 0.47 目、3 手失误（最大 8.6 目）。
     也就是说那些失误**全是白方下出来的**，却被算成了"这盘棋的水平"，
     还被拿去换算「估算水平」。复盘是为了看**自己**下得怎么样 ——
     混算等于替对手背一半锅、或把自己的问题稀释一半。
   v2 结构：{ v:2, losses:[每手目损], sides:{b:{…},w:{…}}, blunders:{b:[],w:[]} }
     sides[x] = { nMov, avg, est, n3, n6, n12, aiFirst, aiKnown, worst, segs }
     segs = [布局/中盘/终盘] 各 { name, n, avg, worst }
   （v1 报告**没有 sides 字段** → 打开时提示重新复盘，见 showReviewReport。） */
function buildReview(nMoves, turns) {
  const losses = computeLosses(turns);

  /* 这一手是谁下的：以「落下之前轮谁走」为准（turns[t].root.currentPlayer，权威），
     拿不到才退回棋谱里的手顺颜色。 */
  const sideOf = t => {
    const cp = String(((turns[t] || {}).root || {}).currentPlayer || '').toUpperCase();
    if (cp === 'B') return 'b';
    if (cp === 'W') return 'w';
    const m = state.moves[t];
    return (m && m.color === 'w') ? 'w' : 'b';
  };

  /* 与 AI 首选重合：turns[t].moves[0] 是引擎给该回合的第一推荐，
     turns[t].actualMove 是实际下的那手（主进程从请求的 moves 里取）。黑白分开记。 */
  const hit = { b: 0, w: 0 }, known = { b: 0, w: 0 };
  /* ★ 认「AI 首选」要用 `order === 0`，**别假定 moveInfos[0] 就是首选**
     （2026-10-06 审查发现）：引擎的 moveInfos 是按**访问次数**排的，不保证第一项是 order 0；
     而主进程只透传前 8 条。本文件别处（pickAIMove）早就是
     `find(m => m.order === 0) || infos[0]` 的写法，这里当时没跟上 ——
     判错会让报告里「与 AI 首选一致 N/M」和失误清单的「AI 想下 X」指错点。 */
  const firstMove = info => {
    const ms = (info && info.moves) || [];
    const f = ms.find(m => m.order === 0);
    return f ? f.move : (ms[0] ? ms[0].move : null);
  };
  for (let t = 0; t < nMoves; t++) {
    const info = turns[t];
    if (!info || !info.actualMove || !info.moves || !info.moves.length) continue;
    const sd = sideOf(t);
    known[sd]++;
    if (firstMove(info) === info.actualMove) hit[sd]++;
  }

  /* 每方一组指标（平均目损 / 失误档位 / 分段 / 与 AI 重合） */
  const sides = {};
  for (const sd of ['b', 'w']) {
    const vals = [];
    for (let t = 0; t < nMoves; t++) {
      if (sideOf(t) === sd && typeof losses[t] === 'number') vals.push(losses[t]);
    }
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    const cnt = th => vals.filter(v => v >= th).length;

    /* 分段：按手数比例切（布局 / 中盘 / 终盘）—— 9 路棋谱只有几十手，
       固定写「1-50 手是布局」会全归到布局里，所以用比例。 */
    const segs = [0, 1, 2].map(k => {
      const sub = [];
      for (let t = 0; t < nMoves; t++) {
        if (sideOf(t) !== sd || segOf(t, nMoves) !== k) continue;
        if (typeof losses[t] === 'number') sub.push(losses[t]);
      }
      return {
        name: SEG_NAMES[k], n: sub.length,
        avg: sub.length ? sub.reduce((s, v) => s + v, 0) / sub.length : null,
        worst: sub.length ? Math.max(...sub) : null,
      };
    });

    sides[sd] = {
      nMov: vals.length, avg, est: estRank(avg),
      n3: cnt(3), n6: cnt(6), n12: cnt(12),
      aiFirst: hit[sd], aiKnown: known[sd],
      worst: vals.length ? Math.max(...vals) : null,
      segs,
    };
  }

  /* 失误清单：黑白分开，各自按目损从大到小，最多 8 条（只留 ≥3 目的「失误」档） */
  const blunders = { b: [], w: [] };
  for (let t = 0; t < nMoves; t++) {
    const v = losses[t];
    if (typeof v !== 'number' || v < 3) continue;
    const best = firstMove(turns[t]);   // 同上：用 order===0 认首选，别假定 moves[0]
    blunders[sideOf(t)].push({ t, loss: v, best });
  }
  blunders.b.sort((x, y) => y.loss - x.loss);
  blunders.w.sort((x, y) => y.loss - x.loss);

  /* ★★ 2026-10-14 首相要求（方案 C）：**把每手的候选点也存进 review.json**。
     为什么非要存它：逐手讲解需要「AI 当时想下哪」（`best.move` 与它的胜率），
     而这个信息**不在 history / leads 里** —— 只有整盘分析的 `turns[t].moves` 才有。
     不存它的后果（首相实测）：选了「跳过重算」之后每一手都取不到候选点、
     直接走「这一手之前的局面没算出候选点」分支 —— **一次 LoGos 都不调**，
     进度条空转几百毫秒就结束，看着就是"什么都没发生"。
     存法：每手前 3 个候选，每个只留 `[坐标, 胜率]`（胜率是**轮到谁走**那一方的口径，
     与 `bestPointNote` 用的同一个数），保留 4 位小数。
     体积：217 手 × 3 × 约 18 字节 ≈ 12 KB —— 换"跳过重算也能讲"很值。 */
  const cands = [];
  for (let t = 0; t < nMoves; t++) {
    const ms = (turns[t] && turns[t].moves) || [];
    const top = ms.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).slice(0, 3);
    cands.push(top.map(m => [m.move, Math.round((typeof m.winrate === 'number' ? m.winrate : 0) * 10000) / 10000]));
  }

  return {
    v: 3,
    losses, sides,
    blunders: { b: blunders.b.slice(0, 8), w: blunders.w.slice(0, 8) },
    nBlunder: blunders.b.length + blunders.w.length,
    cands,
  };
}

/* ---------------- 复盘界面 ---------------- */

const RV_MASK = $('review');

/* 最近一次的进度（重开进度窗要用 —— 见 showReviewAgain） */
let lastReviewProgress = { done: 0, total: 0 };

/* 复盘还在跑时又被点（AI 复盘 / 复盘报告 / 重新复盘 / 点遮罩）——
   把进度窗**重新打开**，而不是只弹一句提示：看不到进度会让人以为卡死了。 */
function showReviewAgain() {
  /* ★ 全盘讲解跑的也是这条「整盘逐手」通路 —— 别把复盘那个进度窗弹出来（审查发现）。 */
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 它跑了整盘分析，等它完再复盘'); return; }
  RV_MASK.classList.add('open');
  showReviewProgress(lastReviewProgress.done, lastReviewProgress.total);
  flash('AI 正在复盘，算完会自动出报告');
}

function showReviewProgress(done, total) {
  lastReviewProgress = { done: done || 0, total: total || 0 };
  RV_MASK.classList.add('open');
  $('review-body').innerHTML =
    '<div class="rv-wait">AI 正在逐手重算…</div>'
    + '<div class="rv-bar"><i style="width:' + (total ? Math.round(done / total * 100) : 0) + '%"></i></div>'
    + '<div class="rv-wait-sub">' + done + ' / ' + total + ' 手 · 每手 ' + reviewVisits() + ' 次搜索</div>'
    + '<div class="rv-wait-tip">实测约 0.3~0.6 秒/手（一盘 200 手约 1~2 分钟）。期间请不要落子 —— 整盘算完才会出报告。</div>';
}

function showReviewReport() {
  const R = state.review;
  if (!R) return;
  RV_MASK.classList.add('open');
  const f = v => (v === null || v === undefined || isNaN(v)) ? '—' : v.toFixed(1);
  const n = state.moves.length;
  /* 这份报告是**按多少步搜索**算出来的 —— 从报告自己身上读（而不是读当前设置的档位），
     这样看旧的报告时显示的也永远是它当时的真实档位。 */
  const rv = R.visits || reviewVisits();
  const segRange = k => {          // 该段覆盖的手数区间（给用户看的）
    const a = Math.floor(n * [0, 0.3, 0.75][k]) + 1;
    const b = Math.floor(n * [0.3, 0.75, 1][k]);
    return a + '–' + b + ' 手';
  };

  let h = '';
  h += '<h2>AI 复盘 <span class="rv-name">' + esc(R.name || '') + '</span></h2>';
  h += '<div class="rv-sub">共 ' + n + ' 手 · 每手 ' + rv + ' 次搜索 · <b>黑白分开统计</b></div>';

  /* ★ 旧版报告（v1 把黑白混算，口径已经变了）—— 不显示那份数据，直接请用户重算。
     拿错口径的数字下判断比没有数字更糟。 */
  if (!R.sides || !R.sides.b || !R.sides.w) {
    h += '<div class="rv-warn">这份报告是<b>旧版算法</b>生成的（黑白双方混在一起算），'
      + '数据口径已经变了，所以这里<b>不再显示</b>。点下面的「重新复盘」按新算法重算一份就行'
      + '（每手 ' + rv + ' 步，一盘约 1 分钟）。</div>';
    h += '<div class="mfoot"><button id="review-again" class="primary">重新复盘</button>'
      + '<div class="spacer"></div><button id="review-close">关闭</button></div>';
    $('review-body').innerHTML = h;
    bindReviewReport(R, false);
    return;
  }

  const kv = (lb, val) => '<div class="rv-kv"><span>' + lb + '</span><b>' + val + '</b></div>';
  const sideName = sd => (sd === 'b' ? '黑方' : '白方');

  /* ---------- 两张画像并排（黑方 / 白方） ---------- */
  h += '<div class="rv-sides">';
  for (const sd of ['b', 'w']) {
    const s = R.sides[sd] || {};
    h += '<div class="rv-side">'
      + '<div class="rv-side-h"><i class="dot ' + sd + '"></i>' + sideName(sd)
      + '<span class="rv-dim">' + (s.nMov || 0) + ' 手</span></div>'
      + kv('平均目损', f(s.avg) + '<span class="rv-un">目</span>')
      + kv('估算水平', '<span class="rv-est">' + esc(s.est || '—') + '</span>')
      + kv('最大单手', f(s.worst) + '<span class="rv-un">目</span>')
      + kv('与 AI 首选一致', s.aiFirst + '<span class="rv-un">/ ' + s.aiKnown + '</span>')
      + kv('失误（≥3 目）', s.n3 + '<span class="rv-un">手</span>')
      + '<div class="rv-kv-sub">其中 ≥6 目 ' + s.n6 + '，≥12 目 ' + s.n12 + '</div>'
      + '</div>';
  }
  h += '</div>';

  /* ---------- 分段表（黑/白各两列） ---------- */
  h += '<table class="rv-seg"><tr><th></th>'
    + '<th>黑方均损</th><th>黑方最大</th><th>白方均损</th><th>白方最大</th></tr>';
  for (let k = 0; k < 3; k++) {
    const b = R.sides.b.segs[k], w = R.sides.w.segs[k];
    h += '<tr><td>' + esc(b.name) + ' <span class="rv-dim">' + segRange(k) + '</span></td>'
      + '<td>' + f(b.avg) + '</td><td>' + f(b.worst) + '</td>'
      + '<td>' + f(w.avg) + '</td><td>' + f(w.worst) + '</td></tr>';
  }
  h += '</table>';

  /* ---------- 失误清单（黑白分开列） ---------- */
  h += '<div class="rv-h">最大失误 <span class="rv-dim">（点一下跳到那一手）</span></div>';
  for (const sd of ['b', 'w']) {
    const list = (R.blunders && R.blunders[sd]) || [];
    h += '<div class="rv-bl-h"><i class="dot ' + sd + '"></i>' + sideName(sd) + '</div>';
    if (!list.length) {
      h += '<div class="rv-bl-empty">没有 ≥3 目的失误 —— 这一方下得挺稳。</div>';
      continue;
    }
    h += '<ul class="rv-bl">';
    for (const b of list) {
      const m = state.moves[b.t];
      if (!m) continue;
      const pt = m.pass ? '停一手' : GTP_COLS[m.x] + (N - m.y);
      const lv = lossLevel(b.loss);
      h += '<li data-n="' + (b.t + 1) + '"><span class="rv-no">第 ' + (b.t + 1) + ' 手</span>'
        + '<span class="rv-pt">' + pt + '</span>'
        + '<span class="rv-loss rv-' + (lv ? lv.cls : '') + '">亏 ' + b.loss.toFixed(1) + ' 目</span>'
        + '<span class="rv-best">AI 想下 ' + (b.best || '—') + '</span></li>';
    }
    h += '</ul>';
  }

  h += '<div class="rv-note">「估算水平」是按<b>该方自己的平均目损</b>粗略换算的启发式，仅供参考 —— '
    + 'KataGo 的段位档是「模仿某段位棋手」，官方并没有给出与真实段位的换算表。'
    + '想知道准的，挑一档跟 AI 下几盘看胜负更实在。目损本身是数值估计，'
    + rv + ' 次搜索时有零点几目的噪声。</div>';

  /* 这次的结果已经写进 records/<棋谱名>.review.json —— 下次不用重算，点「复盘报告」直接看 */
  h += '<div class="rv-sub" style="margin:10px 0 0;color:var(--text-dim)">这份报告已经存下来了：'
    + '关掉后想再看，到棋谱库点这份棋谱的「复盘报告」就行（新复盘会覆盖这一份）。</div>';

  h += '<div class="mfoot"><button id="review-again" title="换个搜索量重新算一遍（会覆盖已存的报告）">重新复盘</button>'
    + '<div class="spacer"></div><button id="review-close">关闭</button></div>';
  $('review-body').innerHTML = h;
  bindReviewReport(R, true);
}

/* 报告底部的按钮绑定（新版/旧版共用）。v2 = 新版才有「点失误跳过去」。 */
function bindReviewReport(R, v2) {
  $('review-close').onclick = () => RV_MASK.classList.remove('open');
  const again = $('review-again');
  if (again) again.onclick = () => {
    /* 重新复盘 = 回到选档面板（用户要求搜索量在点的时候定） */
    openReviewSetup({ name: R.file || (R.name + '.sgf'), note: R.name, hasReview: true });
  };
  if (!v2) return;
  $('review-body').querySelectorAll('.rv-bl li[data-n]').forEach(li => {
    li.onclick = () => { gotoView(+li.dataset.n); };   // 跳过去看那一手（弹窗留着，方便对照）
  });
}

/* ---------------- 「AI 复盘」的搜索量选择面板 ----------------
   ★ 2026-10-04 用户：「AI复盘搜索量我建议在点AI复盘后进行手动设置，默认500，可以调其他档」。
   复用复盘弹窗（#review）：先渲染选档面板，点「开始复盘」才真正开跑。 */
function openReviewSetup(it) {
  /* 已经在跑了就别再开选档面板（同一个弹窗，会盖掉进度）—— 直接把进度窗亮出来 */
  if (reviewBusy) { showReviewAgain(); return; }
  const name = (it && it.name) || '';
  const note = (it && it.note) || '';
  const hasReview = !!(it && it.hasReview);
  /* 读一下棋谱，只为在手数上给出「整盘大概多久」的估算 */
  window.api.records.read(name).then(rd => {
    const p = (rd && !rd.error) ? parseSGF(rd.text) : null;
    renderReviewSetup(name, note, (p && p.ok && p.moves) ? p.moves.length : 0, hasReview);
  }).catch(() => renderReviewSetup(name, note, 0, hasReview));
}

function renderReviewSetup(name, note, nMoves, hasReview) {
  RV_MASK.classList.add('open');
  const cur = reviewVisits();
  const labelOf = v => (VISIT_OPTS.find(o => o[0] === v) || ['', ''])[1];

  let seg = '<div class="seg rv-picks" id="rv-picks">';
  for (const [v, lb] of VISIT_OPTS) {
    seg += '<button data-v="' + v + '"' + (v === cur ? ' class="on"' : '')
      + ' title="' + esc(lb) + ' · ' + v + ' 次搜索">' + v + '</button>';
  }
  seg += '</div>';

  let h = '';
  h += '<h2>AI 复盘 <span class="rv-name">' + esc(note || name.replace(/\.sgf$/i, '')) + '</span></h2>';
  h += '<div class="rv-sub">整盘逐手重算' + (nMoves ? '（共 ' + nMoves + ' 手）' : '')
    + ' —— 每手算多少步由你定：越大越准，也越慢。</div>';
  h += seg;
  h += '<p class="rv-pick-note" id="rv-pick-note"></p>';
  if (hasReview) {
    h += '<div class="rv-sub" style="margin:0 0 12px;color:var(--text-dim)">'
      + '这份棋谱已经有一份报告了；重新复盘会用新结果<b>覆盖</b>它。'
      + '只想再看看上次的结果 → 点「看已存报告」。</div>';
  }
  h += '<div class="mfoot">'
    + (hasReview ? '<button id="rv-view">看已存报告</button>' : '')
    + '<div class="spacer"></div>'
    + '<button id="rv-cancel">取消</button>'
    + '<button id="rv-go" class="primary">开始复盘</button>'
    + '</div>';
  $('review-body').innerHTML = h;

  const noteEl = $('rv-pick-note');
  const refresh = v => {
    const eta = reviewEta(nMoves || 200, v);
    noteEl.textContent = '每手 ' + v + ' 步' + (labelOf(v) ? '（' + labelOf(v) + '）' : '')
      + ' · ' + (nMoves ? '这盘 ' + nMoves + ' 手，整盘 ' + eta : '一盘 200 手大约 ' + eta);
  };

  let pick = cur;
  $('rv-picks').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      $('rv-picks').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      pick = parseInt(b.dataset.v, 10);
      refresh(pick);
    };
  });
  refresh(pick);

  $('rv-cancel').onclick = () => RV_MASK.classList.remove('open');
  const vw = $('rv-view');
  if (vw) vw.onclick = () => openSavedReview(name, note);
  $('rv-go').onclick = () => {
    settings.reviewVisits = pick;      // 记住这次的选择，下次默认就是它
    runReview(name);
  };
}

/* 打开**已存的复盘报告**（棋谱库每行的「复盘报告」按钮 / 选档面板里的「看已存报告」）。
   ★ 永远只有最新一份：新复盘会覆盖旧的（main.js 的 records:saveReview 直接写同一个文件）。 */
async function openSavedReview(name, note) {
  if (reviewBusy) { showReviewAgain(); return; }
  const cached = await window.api.records.readReview(name);
  if (!cached || !cached.text) { flash('这份棋谱还没有复盘报告 —— 先点「AI 复盘」算一份'); return; }
  let rv = null;
  try { rv = JSON.parse(cached.text); } catch (e) { rv = null; }
  if (!rv || !Array.isArray(rv.losses)) { flash('报告文件读不出来，请重新复盘'); return; }

  const rd = await window.api.records.read(name);
  if (!rd || rd.error) { flash('读取棋谱失败：' + ((rd && rd.error) || '未知')); return; }
  const p = parseSGF(rd.text);
  if (!p || !p.ok) { flash('棋谱解析失败，看不了报告'); return; }

  REC_MASK.classList.remove('open');
  applyRecord(p, name);                 // 载入棋谱（会清掉旧复盘），报告里「跳到那一手」才能用
  /* ★ 坑位 42 根治：报告与棋谱内容对不上（多半是中途用「覆盖」换过内容）就别打开它 ——
     报告里每一行都按手号指着「第几手」，挂错了比没有更糟。没有 sig 的是老报告（2026-10-13 之前
     存的），无从核对，照旧放行（长度那一道还在 loadReviewForRecord 里兜着）。 */
  if (rv.sig && rv.sig !== mainlineSig()) {
    flash('这份复盘报告和现在的棋谱内容对不上（棋谱被改过？）—— 没有打开，重跑一次「AI 复盘」就有了');
    return;
  }
  state.review = rv;
  if (!state.review.name) state.review.name = note || name.replace(/\.sgf$/i, '');
  state.review.file = name;
  if (Array.isArray(rv.history)) state.history = rv.history;
  if (Array.isArray(rv.leads)) state.leads = rv.leads;      // 旧报告没有这一项 → 目差模式会提示重算
  /* ★ 复盘的每一手都是同一档搜索量一起算的 → 精度标记统一按报告里记的那一档填。
     旧报告没记这一项的话退回「已够准」，免得它被随手一次粗算改写掉。 */
  if (Array.isArray(rv.history)) state.histVisits = rv.history.map(() => rv.visits || reviewVisits());
  renderMoveList();
  renderCurve();
  showReviewReport();
}

/* 真正跑复盘（选档面板点「开始复盘」后进来）。
   ★ 不再自动用缓存：报告由「复盘报告」按钮负责看；点「AI 复盘」就是要重算一份新的。 */
async function runReview(name) {
  if (reviewBusy) { showReviewAgain(); return; }
  if (!engineReady) { needEngine('analyze', '复盘'); return; }
  /* ★ 进门取号（2026-10-06 审查发现 + 定的修法）。
     原来判定与上锁之间隔着一个 await（读棋谱文件），那几毫秒里再点一次
     「开始复盘」会**真的开第二遍**（两份整盘请求、还会互相覆盖同一份报告文件）。
     修法不是「提前上锁」—— reviewBusy 是给后台分析当闸门用的，早置会让分析多停一段，
     而且提前上锁意味着每条提前 return 都要补复位，**漏一处就锁死**（比偶发双开严重得多）。
     改成同步取号 + 在一次 await 之后校验：连点时**先来的那个主动退出**，
     最坏情况也只是退回原来的行为，不会锁死、不会多做一份。 */
  const myRun = ++reviewSeq;
  const rd = await window.api.records.read(name);
  if (myRun !== reviewSeq) return;               // 期间又点了一次 → 这次作废，交给后来者
  if (!rd || rd.error) { flash('读取失败：' + ((rd && rd.error) || '未知')); return; }
  const p = parseSGF(rd.text);
  if (!p || !p.ok || !p.moves.length) { flash('这份棋谱里没有手顺，复盘不了'); return; }

  REC_MASK.classList.remove('open');
  applyRecord(p, name);                 // 载入棋谱（顺便切摆棋模式、清掉上一次复盘）
  const n = state.moves.length;
  const gen = gameGen;                  // ★ 这次复盘属于哪一局（applyRecord 刚把它 +1 过）

  reviewBusy = true;
  showReviewProgress(0, n + 1);
  const req = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    moves: state.moves.map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
    maxVisits: reviewVisits(),
    /* 0..n：多算一个「最后一手之后」的回合 —— 最后一手的目损只能从它算出来 */
    analyzeTurns: Array.from({ length: n + 1 }, (_, i) => i),
  };
  let res;
  try { res = await window.api.review(req); }
  catch (e) { res = { error: String(e) }; }
  reviewBusy = false;
  /* 复盘期间分析是被压住的（runAnalysis 见了 reviewBusy 直接 return）→ 复盘一结束就补一次，
     让棋盘的胜率条 / 推荐点重新长出来（force：复盘把 history 整盘重写了，当前局面得重算）。 */
  scheduleAnalysis(0, true);

  /* ★ 复盘期间用户换了局（点了新对局 / 又打开了另一份棋谱）→ 这次复盘整体作废：
     否则会把**上一份棋谱的目损**画到当前这盘上，报告还会存到别的棋谱名下。 */
  if (gen !== gameGen) { RV_MASK.classList.remove('open'); return; }

  if (!res || res.error) { RV_MASK.classList.remove('open'); flash('复盘失败：' + ((res && res.error) || '未知')); return; }
  const turns = res.turns || [];
  if (turns.length < 2) { RV_MASK.classList.remove('open'); flash('复盘没拿到足够数据'); return; }

  state.review = buildReview(n, turns);
  /* ★ 坑位 42 根治（方案 A）：复盘结果绑定**主线内容指纹**一起存盘。
     以后「覆盖」把这份棋谱换成另一盘，这个指纹就对不上了 → 读取时直接不采信。 */
  state.review.sig = mainlineSig();
  state.review.name = name.replace(/\.sgf$/i, '');
  /* 顺手把胜率走势也填满：复盘每个回合都带 winrate（同样是「当前走棋方视角」，
     要换算成黑方胜率）。这样打开一份旧棋谱复盘后，走势图也是完整的一整盘。 */
  /* 走势数据：胜率和目差**各填一份**（都换算成黑方视角）—— 曲线两种纵轴要用 */
  const isWhiteTurn = x => String((x && x.root || {}).currentPlayer || '').toUpperCase() === 'W';
  state.history = turns.map(x => {
    const wr = x.root && x.root.winrate;
    if (typeof wr !== 'number') return undefined;
    return isWhiteTurn(x) ? 1 - wr : wr;
  });
  state.leads = turns.map(x => {
    const sl = x.root && x.root.scoreLead;
    if (typeof sl !== 'number') return undefined;
    return isWhiteTurn(x) ? -sl : sl;
  });
  /* ★ 整盘复盘的每一手都是**同一档搜索量**一起算出来的 → 精度标记统一填上。
     填了它，rememberEval 之后就不会用零散的中间报告去改写这些格
     （否则复盘完再随手看一下某手，那一手的涨跌就会被一次粗算覆盖掉）。 */
  state.histVisits = turns.map(() => reviewVisits());
  renderMoveList();      // 手数列表要标目损
  renderCurve();         // 走势图要标失误点
  if (res.incomplete) flash('复盘提前结束（超时），数据可能不全');
  /* ★ 把结果存下来（含胜率走势 + 这次用的搜索量）——
     records/<棋谱名>.review.json，**同一个文件直接覆盖** → 永远只有最新一份（用户要求）。
     以后点「复盘报告」就能直接看，不用重算。 */
  state.review.file = name;
  state.review.visits = reviewVisits();     // 报告里要显示「这是按多少步算出来的」
  state.review.history = state.history.slice();
  state.review.leads = state.leads.slice();
  try { await window.api.records.saveReview(name, JSON.stringify(state.review)); }
  catch (e) { /* 存不下也不影响本次查看 */ }
  refreshRecords();      // 让棋谱库里的「已复盘」标记和「复盘报告」按钮立刻变亮
  showReviewReport();
}

/* 点遮罩空白处关掉复盘弹窗 —— ★ 但**复盘进行中不许关**：
   否则用户以为是「取消了」，其实后台还在算（弹窗没了、界面又能点了 ——
   用户报的「灰色背景还能点击」就是点在这儿：一点就把进度窗关掉了）。 */
if (RV_MASK) RV_MASK.addEventListener('click', e => {
  if (e.target !== RV_MASK) return;
  if (reviewBusy) { showReviewAgain(); return; }
  RV_MASK.classList.remove('open');
});
/* ★ 加 !state.coach.batch：全盘讲解也会走这条「整盘逐手」的通路（它借了复盘接口），
   但它有自己的进度条 —— 别把「复盘」那个弹窗弹出来。 */
window.api.onReviewProgress(d => { if (reviewBusy && d && !state.coach.batch) showReviewProgress(d.done, d.total); });

/* ⚠️ 顶栏不再单独放「AI 复盘」按钮（2026-10-04 用户拍板）：
   复盘入口就是棋谱库每行的「AI 复盘」按钮 —— 两个入口反而多余。
   ★ 教训：删按钮时**必须同时删掉对应的 `$('id').onclick = ...`**，
     否则 `null.onclick = ...` 会抛 TypeError，**把它后面所有顶层代码全部中断**
     （键盘、初始化、启动逻辑都在后面）。 */


/* ---------------- 新对局面板 ---------------- */

function initSeg(id, apply) {
  const box = $(id);
  box.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      box.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      apply(btn.dataset.v);
    };
  });
}

function setSeg(id, val) {
  const box = $(id);
  box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(val)));
}

initSeg('seg-color', v => { settings.color = v; });
initSeg('seg-size', v => { settings.size = +v; });
/* ★ 让子棋按标准**不贴目**（让子本身就是补偿，再贴就是双重补偿）。
   实测（2026-10-04）：让 3 子时多贴 7.5 目 = 白方白拿 7 目多 —— 引擎**不会**替我们
   处理这件事，得我们自己把贴目带去 0。取消让子则回到该规则的默认贴目。 */
initSeg('seg-handicap', v => {
  settings.handicap = +v;
  settings.komi = settings.handicap ? 0 : (RULES[settings.rules] || RULES.chinese).komi;
  setSeg('seg-komi', settings.komi);
});
initSeg('seg-komi', v => { settings.komi = +v; });

/* 对局类型（AI 对弈 / 摆棋·双人）—— 2026-10-04 用户要求「新对局面板分两块」：
   「我执」这个词只在**有 AI 的时候**才成立，摆棋/双人没有「我方」，
   所以那两行直接收起来（原来摆棋时还让人挑「我执」，纯属自找歧义）。
   ★ 这里直接改 settings.mode（跟面板里其它项一样是即时生效的设置），
     并把顶栏那个模式开关一起点亮，免得两处显示不一致。
   ★ 这里**不弹**「AI 执哪一方」的确认框（那个只在从顶栏切换时才弹）——
     面板里同屏就摆着「我执」那一行，比弹窗说得更清楚。 */
initSeg('seg-ntype', v => {
  settings.mode = v;
  setSeg('seg-mode', v);
  syncNewGameRows();
});

/* 按对局类型显隐面板里的行。注意 CSS 里有一条 `.mrow[hidden]{display:none}` ——
   .mrow 是 flex，不显式写就会被 display:flex 压过去（本项目踩过好几次）。 */
function syncNewGameRows() {
  const play = settings.mode === 'play';
  $('row-color').hidden = !play;      // 我执
  $('row-level').hidden = !play;      // 对手棋力
  $('level-note').hidden = !play;     // 档位说明（跟着对手棋力走）
  const hint = $('m-hint');
  if (hint) {
    hint.textContent = play
      ? '提示：学棋用「人类棋风」对手 + 让子，最容易看出「正常该往哪下」。'
      : '提示：两边都由你下，方便接着研究变化。让 N 子＝黑方开局先摆 N 个黑子，摆完由白方先走（让子局按标准不贴目）。';
  }
}

/* 模式切换：人机对弈 / 摆棋。切过去若正好轮到 AI，syncUI 会自动让它落子 */
initSeg('seg-mode', v => {
  if (state.draft) exitDraft();     // 切模式前先退出试下，免得「草稿」和「摆棋」语义打架
  /* ★ 摆棋 → AI 对弈：**先问一句 AI 执哪一方**（用户要求，见 openTakeover）。
     此刻 settings.mode 还是 'free' —— 用户点「取消」就等于什么都没发生；
     但 initSeg 已经把顶栏按钮点亮了，所以要先把它还原。 */
  if (v === 'play' && settings.mode === 'free') {
    setSeg('seg-mode', settings.mode);
    openTakeover();
    return;
  }
  settings.mode = v;
  syncUI();
});

/* ---------------- 摆棋 → AI 对弈：先确认「AI 执哪一方」（2026-10-04 用户要求） ----------------
   为什么必须问：摆棋模式下**两边都是用户在摆**，「我方」在切换那一刻没有定义 ——
   不问就只能沿用上次开新局时设的 myColor（界面上看不见），而且一切过去
   如果正好轮到那一方，AI 会立刻自己落一手，人完全没准备。 */
const TK_MASK = $('takeover');
let tkAI = 'w';          // 弹窗里选的「AI 执哪一方」

/* 弹窗里那行动态说明 —— 关键是把「点确定之后会发生什么」讲清楚：
   会不会 AI 立刻走一手 / 还是轮到你走。 */
function syncTakeoverNote() {
  const side = sideToMove(state.viewAt);
  const aiCol = tkAI === 'b' ? '黑' : '白';
  const myCol = tkAI === 'b' ? '白' : '黑';
  $('tk-note').textContent = '摆棋时两边都是你在摆，切换后由 AI 接手一方。'
    + (side === tkAI
      ? 'AI 执' + aiCol + '，正好轮到它 —— 点确定它会立刻走一手；你执' + myCol + '。'
      : 'AI 执' + aiCol + '，你执' + myCol + ' —— 点确定后轮到你走。');
}

function openTakeover() {
  const side = sideToMove(state.viewAt);
  $('tk-turn').textContent = '当前轮到 ' + (side === 'b' ? '黑' : '白') + ' 落子';
  /* 默认：AI 执「你现在的对方」—— 也就是沿用原设置不动，最少意外
     （想换成「让 AI 接着下当前这一手」，点另一边即可）。 */
  tkAI = state.myColor === 'b' ? 'w' : 'b';
  setSeg('seg-tk-color', tkAI);
  syncTakeoverNote();
  TK_MASK.classList.add('open');
}

function cancelTakeover() {
  TK_MASK.classList.remove('open');
  setSeg('seg-mode', settings.mode);    // 顶栏开关还原到「摆棋」（它已经被点亮了）
}

$('tk-cancel').onclick = cancelTakeover;
TK_MASK.addEventListener('click', e => { if (e.target === TK_MASK) cancelTakeover(); });
initSeg('seg-tk-color', v => {
  tkAI = v;
  if (TK_MASK.classList.contains('open')) syncTakeoverNote();
});

$('tk-ok').onclick = () => {
  TK_MASK.classList.remove('open');
  settings.mode = 'play';
  /* ★ 顶栏那个开关也要点亮到「人机对弈」——
     不然设置切过去了、按钮还停在「摆棋」上，两处显示打架
     （用户 2026-10-04 报的就是这个：从摆棋切过来后「人机对弈」没亮）。 */
  setSeg('seg-mode', 'play');
  /* 「AI 执 X」→ 我执另一方。settings.color 一并定下来（原来是「随机」也变成确定的），
     否则下次开新局又会随掉。 */
  const mine = tkAI === 'b' ? 'w' : 'b';
  settings.color = mine;
  state.myColor = mine;
  syncUI();       // 若正好轮到 AI，这里就会让它接手落子
};

/* 走势图纵轴切换：黑方胜率（%）/ 黑方领先目数。两者视角都是**黑方**，只是量纲不同。 */
initSeg('seg-curve', v => {
  state.curveMode = (v === 'lead') ? 'lead' : 'win';
  renderCurve();
});

/* 规则联动：切换规则时带出该规则的默认贴目；明清规则（座子制）下不能再让子 */
function syncRulesUI(rules, withKomi) {
  const R = RULES[rules] || RULES.chinese;
  if (withKomi) settings.komi = settings.handicap ? 0 : R.komi;   // ★ 有让子就不贴目
  setSeg('seg-komi', settings.komi);
  const dis = !!R.seats;
  const box = $('seg-handicap');
  box.querySelectorAll('button').forEach(b => { b.disabled = dis; });
  box.classList.toggle('off', dis);
  if (dis) { settings.handicap = 0; setSeg('seg-handicap', 0); }
}

$('m-rules').onchange = () => syncRulesUI($('m-rules').value, true);

/* ---------- 对手棋力下拉（真实段位） ----------
   顶栏 sel-level 与面板 m-level 都从 RANKS 生成，避免两处手写不同步。 */
function fillLevelSelects() {
  for (const id of ['sel-level', 'm-level']) {
    const sel = $(id);
    if (!sel) continue;
    sel.textContent = '';
    for (const g of RANK_GROUPS) {
      const og = document.createElement('optgroup');
      og.label = g;
      for (const r of RANKS) {
        if (r.group !== g) continue;
        const o = document.createElement('option');
        o.value = r.v;
        o.textContent = r.label;
        og.appendChild(o);
      }
      if (og.children.length) sel.appendChild(og);
    }
    sel.value = settings.level;
  }
}

/* 选中档位 → 显示「这个档位大概什么水平」
   （用户原话：我想先知道对方的水平，然后再开始跟他下） */
function refreshLevelNote() {
  const r = RANK_MAP.get(settings.level) || RANK_MAP.get('rank_3d');
  const note = $('level-note');
  if (note && r) note.textContent = r.label + ' · ' + r.note;
  const sel = $('sel-level');
  if (sel && r) sel.title = r.label + '：' + r.note;
}

function setLevel(v) {
  settings.level = RANK_MAP.has(v) ? v : 'rank_3d';
  $('sel-level').value = settings.level;
  $('m-level').value = settings.level;
  refreshLevelNote();
}

/* 顶栏改难度要立刻生效（原来只同步了下拉，settings 没跟着变） */
$('sel-level').onchange = () => { setLevel($('sel-level').value); syncUI(); };
$('m-level').onchange = () => { setLevel($('m-level').value); syncUI(); };

/* ---------- 分析搜索量（「计算深度」）----------
   生成下拉 + 说明当前档位的「快慢 / 精度」取舍。
   耗时数字是**实测**出来的（见 VISIT_OPTS 注释），不是估的。 */
/* 分析搜索量（「计算深度」）—— **两处下拉共用一个设置**：
   底栏（随时调，用户 2026-10-04 要求「要在下面设一个出来」）+ 「新对局」面板。 */
function fillVisitSelect() {
  const panel = $('m-visits');       // 面板：带档位名，看得懂
  if (panel) {
    panel.textContent = '';
    for (const [v, name] of VISIT_OPTS) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = name + ' · ' + v + ' 次';
      panel.appendChild(o);
    }
  }
  const bar = $('sel-visits');       // 底栏：只写「N 步」，省地方
  if (bar) {
    bar.textContent = '';
    for (const [v] of VISIT_OPTS) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = v + ' 步';
      bar.appendChild(o);
    }
  }
  setVisits(settings.visits);
}

/* 设定搜索量：写进 settings，并让两个下拉保持一致 */
function setVisits(v) {
  const n = parseInt(v, 10);
  settings.visits = VISIT_OPTS.some(o => o[0] === n) ? n : 500;
  for (const id of ['m-visits', 'sel-visits']) {
    const el = $(id);
    if (el) el.value = String(settings.visits);
  }
  refreshVisitsNote();
}

/* 改档位 → 立即生效。★ 热切换：maxVisits 是**每个分析请求自带的参数**，
   runAnalysisOnce 每次现读 settings.visits，所以改完下一次分析就用新值，
   不用重开对局、不用重启程序。这里顺手重算一次，免得用户要等下一手才看到效果。 */
function applyVisits(v) {
  setVisits(v);
  flash('计算深度：每手 ' + settings.visits + ' 步 · 已生效');
  scheduleAnalysis(0, true);      // ★ force：档位变了，当前局面要用新搜索量重算一遍
}

function refreshVisitsNote() {
  const note = $('visits-note');
  if (!note) return;
  const v = settings.visits;
  /* 耗时按实测点（500→0.4s、1600→0.7s、3000→约 1.2s）内插 */
  const sec = v <= 150 ? '约 0.1 秒' : v <= 250 ? '约 0.2 秒' : v <= 400 ? '约 0.3 秒'
    : v <= 600 ? '约 0.4 秒' : v <= 900 ? '约 0.5 秒' : v <= 1200 ? '约 0.6 秒'
      : v <= 1700 ? '约 0.75 秒' : v <= 2500 ? '约 1.0 秒' : '约 1.3 秒';
  note.textContent = '每手思考 ' + v + ' 步 · ' + sec + '出推荐点。' + (
    v <= 300 ? '最快；复杂局面的选点会飘。' :
      v <= 800 ? '速度与精度平衡，日常看棋够用。' :
        '更稳；推荐点出现更慢。'
  );
}

$('m-visits').onchange = e => applyVisits(e.target.value);
$('sel-visits').onchange = e => applyVisits(e.target.value);

function openNewGame() {
  $('m-rules').value = settings.rules;
  setLevel(settings.level);
  setSeg('seg-color', settings.color);
  setSeg('seg-size', settings.size);
  setSeg('seg-handicap', settings.handicap);
  setSeg('seg-komi', settings.komi);
  setSeg('seg-ntype', settings.mode);   // 对局类型跟着当前的模式走
  $('m-clock').value = settings.clock;
  fillVisitSelect();                     // 搜索量下拉（值同步 + 说明文字）
  syncRulesUI(settings.rules, false);   // 只做禁用联动，不覆盖用户选过的贴目
  syncNewGameRows();                     // 按类型显隐「我执」「对手棋力」
  $('newgame').classList.add('open');
}

$('btn-new').onclick = openNewGame;
$('btn-gate-new').onclick = openNewGame;   // ★ 未开局时棋盘中央那个大按钮（同一入口）
/* 引擎没起来时，中央那条提示里的「去设置」（openSettings 是函数声明，会提升） */
$('gate-setup').onclick = () => openSettings();
$('m-cancel').onclick = () => $('newgame').classList.remove('open');
$('newgame').onclick = e => { if (e.target === $('newgame')) $('newgame').classList.remove('open'); };

$('m-start').onclick = () => {
  settings.rules = $('m-rules').value;
  setLevel($('m-level').value);
  settings.clock = $('m-clock').value;
  /* 类型以面板上亮着的那一个为准（点它时已经改过 settings.mode，这里再对齐一次） */
  const nt = $('seg-ntype').querySelector('.on');
  if (nt) settings.mode = nt.dataset.v;
  applyNewGame();
  $('newgame').classList.remove('open');
};

/* idle = true → 只把界面摆成「未开局」的中性样子（**软件启动时**用，见文件末尾的启动段）。
   点「新对局 → 开始」时不传这个参数，等于真的开一局。 */
function applyNewGame(idle) {
  N = settings.size;
  state.fromRecord = false;     // 新开的局不是打谱
  state.sgfComments = [];       // 新开局没有「棋谱自带的解说词」
  state.rootComment = '';       // 也没有「棋谱说明」（那是某份棋谱根节点上的文字）
  state.quizTips = [];           // 也不是题集，没有「第几题」
  state.recName = '';           // ★ 也不是某份棋谱了 —— 讲解没有存放处（全盘讲解按钮会收起）
  clearCoachPanels();           // 讲解只在对局期间保留（用户要求：开新局就清）
  const R = RULES[settings.rules] || RULES.chinese;

  if (R.seats) {
    state.setup = seatStones(N);      // 明清规则：四角座子（黑白各二）
    state.toMove = 'w';               // 古谱白先
  } else if (settings.handicap) {
    state.setup = handicapStones(N, settings.handicap);
    state.toMove = 'w';
  } else {
    state.setup = [];
    state.toMove = 'b';
  }

  state.moves = [];
  branchRoot = null;                     // ★ 新对局：分支树作废重建
  treeExpanded.clear(); treeForceOpen.clear(); treeExpandSeq.clear();   // 同上：换局必须清（防泄漏 + 防误展）
  /* ★★ 坑位 37（2026-10-13 审查补）：回收站与「待确认删除」也是**节点引用**，
     和 treeExpanded 同一个性质 —— 漏清就是：删过分支（没撤销）→ 新开一局 →
     按 Ctrl+Shift+Z（或树面板右键「撤销刚才删除的分支」）→ undoDeleteBranch 把
     **旧局的整枝**沿旧祖先链拼成路径灌进 `state.moves`，新局棋盘直接变成旧局那条线。
     实测：`dev/_verify_fixes_1013.js` 断言 #1 复现（换局后按撤销 → 棋盘 0 手变 5 手）。 */
  branchTrash = null; pendingDel = null;
  state.candidates = [];
  state.candAt = -1;
  state.ownership = null;
  state.ownAt = -1;
  state.history = [];               // 走势数据随之清空（胜率 + 目差两条）
  state.leads = [];
  state.histVisits = [];            // ★ 精度标记一起清（它跟 history 是一对，见 state 注释）
  resetAnalysisState();             // 换局：旧的分析欠账 / 「已上屏」标记全部作废
  state.viewAt = 0;
  state.thinking = false;
  state.koPoint = null;
  state.draft = null;              // 新对局：退出试下状态
  state.result = null;             // 新对局：清掉终局结果
  state.lastEval = null;
  state.review = null;             // 新对局：清掉上一次的复盘数据（目损标记）
  state.pv = null;                 // 新对局：收掉变化图
  state.names = { b: '', w: '' };  // 新对局：名字回到默认（人机 PLAYER/KATAGO、摆棋 PLAYER1/2）
  state.noGame = !!idle;           // ★ 启动时停在「未开局」；「新对局 → 开始」时解除
  hover = null;

  if (settings.color === 'r') state.myColor = Math.random() < 0.5 ? 'b' : 'w';
  else state.myColor = settings.color;

  setSeg('seg-mode', settings.mode);
  clockReset();          // 计时按新设置重置（不限时则隐藏计时面板）
  resize();
  syncUI();
}

/* ---------------- 引擎分析 ---------------- */

/*单次分析的目标搜索量。
   ★ 2026-10-04 从 1600 降到 500 —— 这是「推荐点要实时出现」的关键。
     问题不在我们的显示逻辑，而在**引擎一次只能算一个请求**：
     旧局面的分析要跑满 1600 visits（约 2~3 秒）才轮到新局面，
     所以落子后推荐点要等 3 秒多才更新（实测 3275ms / 3156ms 两次）。
     中途报告机制本来是好的（引擎每 0.25 秒推一次），但被这个时长拖住了。
     实测对比（三个局面各跑 3 次，见 _diag_visits.js）：
       500 visits：0.4 秒，布局/中盘的首选点与前 4 候选**和 1600 完全一致**；
                  只有复杂中盘的首选点会在两三个好点之间跳（前 4 候选集合仍相同）
       1600 visits：0.7 秒，胜率波动更小（0.2% vs 0.7%）
     → 慢一倍换来的精度提升很小，而响应速度是**能直接感觉到的**，所以选 500。
   ★ 2026-10-04 后续：用户要求「做成可调」，所以这个常量只当**默认值**用，
     实际取值在 settings.visits（「新对局」面板 → 计算深度，见 VISIT_OPTS）。 */
const ANALYZE_VISITS = 500;
/* 搜索量低于此值时先不显示候选点。
   ★ 2026-10-04 从 150 降到 20 —— 用户对照 KaTrain 指出：
     「计算中不是棋盘上啥都不显示，而是会显示推荐选点，选点圈里还显示搜索次数，
       就算搜的不多，也先在棋盘上显示出来」。
     我们本来也是边搜边刷的（引擎每 0.25 秒推一次中途报告 → applyAnalysis），
     但 150 这道门槛把开头 1~2 秒整个挡住了 → 棋盘空白。
     降到 20 后，落子约 0.1 秒就有第一批点可画，观感变成「实时出现、数字往上走」。
     只保留一个极低门槛，是为了滤掉 visits=0/1 那种纯噪声（点的排序会乱跳）。 */
const HINT_MIN_VISITS = 20;

/* 渲染端等一次分析请求回来最多等多久（毫秒）——见 runAnalysisOnce 里的 Promise.race。
   取值理由：
     · 正常一次分析 0.4~1.5 秒（500 visits，实测中位 472ms）；
     · 引擎切到一个全新局面重建搜索树最慢约 1~3 秒；
     · 就算「计算深度」调到最大档（用户能选到的上限）也远在 25 秒内。
   25 秒是「不可能有这么慢的正常请求」的界线 —— 超过它就不是慢，是那条路断了。
   ⚠️ 别调太小：调成 5 秒会在深档位下把正常请求误判成超时，反而让分析一直在重排。 */
const ANALYZE_TIMEOUT_MS = 25000;

/* ★ 分析链路的轻量埋点（2026-10-07 新增）。
   为什么要它：用户报「AI 落子后马上悔棋，选点/形势有时卡住不显示」，
   但标准时序在测试环境里跑十轮都不卡 —— 说明是**竞态**，光看界面复现不了。
   有这组计数就能在卡住的那一刻回答"它到底卡在哪一步"：
     start    = 进入一轮分析循环
     okCount  = 这一轮里成功算完几次局面
     failEarly= runAnalysis 开头的提前 return（分别是 scoreBusy / reviewBusy / 引擎没就绪 / busy）
     failOnce = runAnalysisOnce 返回 false（出错 / 被取消 / 超时）
     breakAt  = 循环为什么退出（guard 用尽 / 换局 / 数子 / 复盘 / 引擎掉了 / 算失败）
     skipHuge = 队列里那些「at 已经大于手数」被跳过的次数
   只读写几个数字，不改任何行为（Ctrl+Shift+D 会把它打出来）。 */
const anaDiag = {
  start: 0, okCount: 0, failEarly: { score: 0, review: 0, notReady: 0, busy: 0 },
  failOnce: 0, breakAt: {}, skipHuge: 0, lastFailWhy: '', lastAt: 0,
  note(why) { this.breakAt[why] = (this.breakAt[why] || 0) + 1; this.lastFailWhy = why; this.lastAt = Date.now(); },
};

/* ★ 分析链路曾经有过一个"把关键决定写进文件"的日志（v0.1.17 加的），
   用来定位「推荐点偶尔不出来」那个偶发问题 —— **问题解决后就撤掉了**（v0.1.18）。
   撤掉的理由（用户提的）：它太占地方 —— 实测玩 20 秒就写 63.8 KB，约 11 MB/小时，
   而且是**同步写盘**（每次 appendFileSync 都阻塞主进程）。
   本软件要尽量轻，不做"像手机 APP 那样一直产生垃圾文件"的事。

   ⚠️ 以后万一再需要它：别恢复成"常开写文件"，改成
     · 只在用户按 Ctrl+Shift+D 时**把它打到状态栏**（那已经是现成的自检），或者
     · 加个显式开关，默认关。
   下面是保留的空函数（调用点先留着，方便将来一行切换；不发 IPC、不写盘，零成本）。 */
function alog(msg) { /* 已撤：见上面的说明 */ }

/* 连续超时计数（成功一次就归零）。超时后要主动重排一次，但不能无限重排 ——
   引擎真挂了的时候，无限重排会变成每 25 秒一次的无效空转，日志和界面都在刷。 */
let anaTimeouts = 0;
/* 「anaBusy 是什么时候置上的」——给顶栏那个「刷新」按钮判断"是真卡了还是正在算"。
   置上时间超过 REFRESH_STUCK_MS 就一定不是正常请求（正常一次 0.4~1.5 秒）。 */
let anaBusySince = 0;
const REFRESH_STUCK_MS = 12000;

const toGTP = (x, y) => GTP_COLS[x] + (N - y);

function fromGTP(s) {
  const m = /^([A-Ta-t])(\d{1,2})$/.exec(String(s).trim());
  if (!m) return null;
  const x = GTP_COLS.indexOf(m[1].toUpperCase());
  if (x < 0 || x >= N) return null;
  const y = N - parseInt(m[2], 10);
  if (y < 0 || y >= N) return null;
  return { x, y };
}

/* 第 n 手之后轮谁走（让子局 / 明清座子局都是白先） */
function sideToMove(n) {
  const first = state.setup.length ? 'w' : 'b';
  return (n % 2 === 0) ? first : (first === 'b' ? 'w' : 'b');
}

let engineReady = false;       // 分析引擎（strong 权重）：胜率 / 候选点 / 走势曲线
let engineReadyPlay = false;   // 对弈引擎（human 权重）：AI 落子 + 真实段位档位

/* 棋盘上「计算中… N」该不该画。
   抽成独立函数（而不是留在 draw 里那一长串 if）是为了**能单测** ——
   那串条件掺着引擎就绪状态，探针里造不出来，只能靠人眼截图看。
   ★★ 2026-10-13 首相报：**引擎还没启动时棋盘上也挂着「计算中」，是假象**。
      用户会以为它在算，其实根本没开算（等到天荒地老也不出点），只能被当成"坏了"。
      所以判据必须带 `engineReady`：**引擎没就绪就一个字都不画**。
      （顺带覆盖"引擎正在加载"那段 —— 它不是"算不出来"，是"还没开始"。）
   其余条件原样保留：开了推荐点、这一手的点还没算出来、不是未开局、
   正在看最新一手（回看历史不必提示）、对弈模式下轮到自己走。 */
function shouldShowComputing() {
  return !!(state.showHints
    && engineReady
    && state.candAt !== state.viewAt
    && !state.noGame
    && state.viewAt === state.moves.length
    && (settings.mode !== 'play' || isMyTurn()));
}
let coachReady = false;        // ★ LoGos 讲解模型（2026-10-05 新增）
let engineNote = '';
let coachNote = '';            // ★ 讲解模型自己的错误（它坏了不该算「引擎异常」——不装也能下棋）
/* ★ 三个引擎各自的原始状态：'off' 未加载 / 'loading' / 'ready' / 'paused' / 'error'
   顶栏那两个状态灯直接照它画。
   为什么单独存一份：引擎从「开机自动加载」改成「手动加载」了 ——
   「未加载」是**正常状态**、不是故障，界面必须能区分「没加载」和「挂了」。 */
let engStates = { analyze: 'off', play: 'off', coach: 'off' };
/* 在「设置」里改完路径 → 引擎正在按新配置重启（状态栏常驻提示，就绪后自动清掉）。
   ⚠️ 必须在 syncUI 之前声明：syncUI 会读它，而 syncUI 在启动时就会被调用（TDZ 会炸）。 */
let engineReloading = false;
let anaTimer = null;
/* 屏幕上这批结果（胜率条 / 候选点 / 形势雾）是「第几手之后」的局面算出来的。
   -1 = 还没有。与 state.viewAt 不等 → 说明当前看的这个局面还没分析上屏。 */
let shownAt = -1;

/* 待补算的手数队列（只为补 history —— 胜率走势曲线与手数列表的「涨跌」都靠它）。
   ★★ 为什么必须有这个队列（2026-10-04 用户报「手数列表里胜率涨跌有时候不显示，
      还得我点一下才有；是不是还没来得及分析完就下一手了」——正是如此）：
      旧逻辑是「只算当前局面 + 200ms 防抖」，而**防抖会把还没轮到算的那个局面直接丢掉**：
      人机对弈时用户落子后轮到 AI，AI（human 模型、400 visits）经常在 200ms 内就回了手，
      下一个 syncUI 的 clearTimeout 一来，就把「用户刚下那一手之后的局面」的定时器清掉 ——
      那个局面从此再没有任何一次分析 → history[n] 缺一格 → 第 n 手的涨跌永远算不出来。
      用户「点一下那一手」（gotoView → 重新分析）才把它补上，现象完全对得上。
   改法：入队在**防抖之前**（只要这个局面还没算过就先记下来），当前局面算完再按顺序补上，
   一个都不漏 —— 也就是用户要的「分析引擎独立于当前手数，到了下几手也要把前面的算好」。 */
let anaQueue = [];
let anaForceCur = false;   // 当前局面是否要强制重算（改了计算深度 / 数子之后刷新画面）

/* 补账队列的长度上限（2026-10-06 晚新增）。
   为什么要限：补账和历史曲线用的是**同一个引擎**（选点优先，见 runAnalysis 的循环顺序），
   队列无限长的话，用户连点几十手之后引擎会长时间忙于补旧账 ——
   实测**不会**拖慢选点（选点永远排在前面，且新请求会掐掉正在跑的补账：
   有欠账时选点延迟中位 377ms，无欠账 470ms，见 _cdp_priority.mjs），
   但曲线要很久才补齐、而且引擎没有空闲。
   取 40：正常一局连点几十手也补得完；真到 40 以上说明用户在极快地连点，
   那种节奏下"最近 40 手的涨跌还准"就够了，更早的等下一次落子慢慢补。 */
const ANA_QUEUE_MAX = 40;

function scheduleAnalysis(delay, force) {
  /* ★ 未开局：**一次分析都不发**（用户要求「胜率条五五开不动」）。
     这是「不动」的根子 —— 数字由 syncUI 画成中性，而且没有请求来覆盖它。
     注意要放在入队**之前**：否则会在队列里留一条永远没人处理的欠账。 */
  if (state.noGame) { alog('schedule 未开局 → 不发'); return; }
  const at = state.viewAt;
  const why = [];
  if (force) { anaForceCur = true; why.push('force'); }
  /* 入队（去重）。试下（草稿）里的局面不记 —— 那些手等会儿会被整体丢掉，算了也是白算。 */
  const draftSkip = (state.draft && at > state.draft.from);
  if (draftSkip) why.push('草稿内跳过入队');
  else if (typeof state.history[at] === 'number') why.push('history已有→不入队');
  else if (anaQueue.indexOf(at) >= 0) why.push('队列已有');
  if (!draftSkip
    && typeof state.history[at] !== 'number'
    && anaQueue.indexOf(at) < 0) {
    anaQueue.push(at);
    /* ★ 超长就丢掉最旧的那几条（见 ANA_QUEUE_MAX）。丢的是「最久以前那一手」，
       它多半已经不在用户视线里；当前局面和最近几手永远留着。 */
    if (anaQueue.length > ANA_QUEUE_MAX) anaQueue.splice(0, anaQueue.length - ANA_QUEUE_MAX);
  }
  clearTimeout(anaTimer);
  /* ★ 这里**不要**加「取消正在跑的分析」。试过（2026-10-04）：
     取消确实能让旧请求停下（搜索量不再增长），但**总耗时不降**（1026ms vs 1032ms）——
     因为瓶颈是「引擎切换到一个新局面的第一批结果本身要约 0.8 秒」（要重建搜索树）。
     既然没有收益，就不留这个异步竞态（cancel 晚一步到主进程会误杀刚发出的新请求）。 */
  anaTimer = setTimeout(runAnalysis, delay === undefined ? 200 : delay);
  /* ★ 关键节点记一行：这一笔排了没有、为什么没排、当前各处状态。
     卡住之后回看这一段，就能知道"那一刻到底有没有人动手"。 */
  alog('schedule at=' + at + ' delay=' + (delay === undefined ? 200 : delay)
    + ' 入队=' + (why.some(w => w.indexOf('→') >= 0 || w === '队列已有') ? '否(' + why.join(',') + ')' : '是')
    + ' q=[' + anaQueue.join(',') + '] shownAt=' + shownAt + ' candAt=' + state.candAt
    + ' busy=' + anaBusy + ' force=' + anaForceCur + ' hist[' + at + ']=' + (typeof state.history[at] === 'number' ? '有' : '无'));
  /* ★ 顺手挂一次「卡住自愈」检查：只在「算过但没上屏」时才会真的排定时器 */
  scheduleStallRecovery();
}

/* 换了棋谱 / 开了新局 → 旧的欠账和「已上屏」标记全部作废 */
function resetAnalysisState() {
  anaQueue = [];
  shownAt = -1;
  clearTimeout(anaTimer);
  clearTimeout(anaStallTimer); anaStallTimer = null;
  anaStallWatched = -1; anaStallTries = 0;
  gameGen++;        // ★ 换局 / 换棋谱：作废在飞的那次分析（见 gameGen 的注释）
}

/* ★★ 自愈网：「算过但没上屏」的状态卡住时，自己再算一次（2026-10-07 新增）。
   治的是什么：`shownAt`（算过）与 `candAt`（真上屏了）**不一致**时，
   `runAnalysis` 会以为当前局面已算过而跳过它、`scheduleAnalysis` 又会因
   `history[at]` 有值而去重 —— 两头都不动手，那个局面就永远停在「计算中… N」上。
   （根因已在 `runAnalysisOnce` 修掉：只有 `applyAnalysis` 真上屏才记 shownAt。
     这里再兜一道，万一还有别的路径造成同样不一致，它能自己纠正，
     用户不用靠"再落一手"把它撞好。）

   为什么用**一次性定时器**而不是常驻轮询：只在"看起来卡了"的时候才排一次，
   自限、不空转。 */
let anaStallTimer = null;
let anaStallWatched = -1;       // 正在自愈哪个手数（-1 = 没有）
let anaStallTries = 0;          // 这一手已经自愈过几次
const ANA_STALL_MAX_TRIES = 20; // 上限（防死循环）；每次间隔 6 秒，20 次 ≈ 2 分钟
function scheduleStallRecovery() {
  const cur = state.viewAt;
  if (state.noGame || cur <= 0) return;
  if (state.viewAt !== state.moves.length) return;   // 回看历史时不算卡（那时本来不画选点）
  if (shownAt !== cur || state.candAt === cur) {
    /* 没卡（要么还没算、要么已上屏）→ 清掉这一手的计数，下次卡住能从头再来 */
    if (anaStallWatched === cur) { anaStallWatched = -1; anaStallTries = 0; }
    return;
  }
  if (anaStallWatched !== cur) { anaStallWatched = cur; anaStallTries = 0; }
  /* ★★ 反复尝试，不是"只试一次"（2026-10-07 踩的坑）。
     第一版写的是 `if (anaStallWatched === cur) return;` —— 想避免重复排定时器，
     结果**卡住之后这个值一直等于 cur**，于是之后每次 scheduleAnalysis 都在这里 return，
     自愈定时器**再也不会排**：第一次没救回来就永久卡住。
     用户实测就是这个现象（「过了很久也没修好，没用自己修」）。
     正解：卡住期间**每 6 秒重试一次**，直到好为止（有次数上限防死循环）。 */
  if (anaStallTries >= ANA_STALL_MAX_TRIES) return;
  if (anaStallTimer) return;                     // 已经有一个在等着了
  anaStallWatched = cur;
  anaStallTries++;
  anaStallTimer = setTimeout(() => {
    anaStallTimer = null;
    if (state.viewAt !== cur || state.candAt === cur) { anaStallWatched = -1; anaStallTries = 0; return; }   // 期间自己好了
    alog('★ 自愈第 ' + anaStallTries + ' 次：检测到「算过但没上屏」（shownAt=' + shownAt
      + ' candAt=' + state.candAt + ' viewAt=' + cur + '）→ 强制重算');
    console.warn('[分析] 自愈第 ' + anaStallTries + ' 次：重算第 ' + cur + ' 手');
    anaDiag.note('自愈：算过但没上屏');
    anaForceCur = true;
    scheduleAnalysis(0, true);
    /* ★★ 关键：**自己续排下一次**（2026-10-07 踩的坑）。
       不能指望用户再操作一次来触发 scheduleAnalysis —— 卡住的时候他往往正盯着屏幕等，
       **不会再点任何东西**，那样自愈就只试了一次、失败一次就再也不动。
       （第一版就是这么错的：写成"同一手数只排一次"，结果卡住后永远不再排。） */
    anaStallWatched = -1;          // 让下一次判断重新走一遍
    scheduleStallRecovery();       // 若仍然卡着，6 秒后再来一次
  }, 6000);
}

/* ★★ 悔棋 / 停一手 / 任何「局面变短」的操作之后必须调用（2026-10-06 实测定位）。
 *
 * 症状：悔棋后 KataGo 的分析**彻底停住**（搜索量不涨、胜率条不再更新）。
 * 实测数据（_cdp_undo.mjs）：落 10 手后悔棋 3 次 →
 *     moves=7，但队列 q=[5,6,7,8,9,10]（**8/9/10 已是��存在的局面**），
 *     history 的有效项数涨到 11（**比手数还多**），visits 恒定在 515 不动。
 *
 * 两个根因（缺一不可）：
 *   ① **队列没截断** —— 里面留着比当前手数大的 at。runAnalysisOnce(8) 会去算
 *      `state.moves.slice(0, 8)`，可moves 只有 7 —— 请求发出去算的是第 7 手，
 *      回来却按「第 8 手」写进 history（rememberEval(at) 用的是传入的 at）。
 *      结果：**脏数据灌进 history/leads**，而且这些永远算不完的欠账
 *      把 anaBusy 一直占着（busy 卡在 true）→ 真正的当前局面再也排不上队。
 *   ② **history / leads 没截断** —— 已撤销的那些手的走势数据留在数组里。
 *      走势曲线会画出不存在的「第 8、9、10 手」，点进手数列表也能看到幽灵数据。
 *
 * 只做① 不做 ② 的话，曲线仍然是错的；反过来 ① 会让分析继续卡死。
 */
function truncateAnalysisTo(len) {
  /* 队列里超过新手数的一律丢掉（它们代表的局面已经不存在了）。
     注意是「过滤」不是「清空」—— 当前局面那一项还要留着，它是对的。 */
  anaQueue = anaQueue.filter(at => at <= len);
  /* history / leads 截断到 len+1 个元素（索引 at 表示「第 at 手之后」，
     所以合法索引是 0..len）。多出来的直接砍掉。 */
  if (state.history.length > len + 1) state.history.length = len + 1;
  if (state.leads.length > len + 1) state.leads.length = len + 1;
  /* ★ histVisits（每格的精度）必须跟着一起截 —— 它是 history 的伴随数组，
     错位一格就等于拿别的手的精度去判断这一格要不要改写（2026-10-06 晚新增）。 */
  if (state.histVisits.length > len + 1) state.histVisits.length = len + 1;
  /* candAt / ownAt 也别指着不存在的局面，否则候选点和形势雾会被当成过期的画淡。 */
  if (state.candAt > len) state.candAt = -1;
  if (state.ownAt > len) { state.ownership = null; state.ownAt = -1; }
  /* ★★★ `shownAt` 必须与 `candAt` **同进同退**（2026-10-07 日志定位到的真根因）。
     它们是"同一批结果"的一对记号：
       candAt = 这批候选点是第几手算的（画盘用）
       shownAt = 屏幕上这批结果算的是第几手（要不要重算用，判据 shownAt !== cur）
     ⚠️ 原来这里只写了 `if (shownAt > len) shownAt = -1;` —— 只管了"大于新长度"这一种情况。
        而悔棋**退到某一手**时会出现：candAt（假设 6）> len（2）→ 被清成 -1；
        但 shownAt 恰好**等于** 2（≤ len）→ 原样留着。
        于是"这批选点废了"与"这个局面显示过了"同时成立 —— 死结：
          · runAnalysis 判 `shownAt !== cur` 为假 → 跳过当前局面，不重算
          · scheduleAnalysis 又因 `history[cur]` 有值 → 不入队
        两头都不动手 → **那个局面永远不再分析**，界面就是
        「计算中… N 定住不动、推荐点永远不出来」。
        实测证据：调试实例的《分析链路.log》里出现
          「run 认为已算过但 candAt=-1 ≠ viewAt=2」+ 前后都是 busy=false/force=false/hist[2]=有。
     所以规矩是：**candAt 若失效，shownAt 一起失效**（要废一起废）。 */
  if (state.candAt === -1) shownAt = -1;
  else if (shownAt > len) shownAt = -1;
  /* 曲线 / 手数列表不用在这里刷 —— 调用方紧接着就 syncUI()，那里会重画。
     在这里刷等于每悔棋一次多两次全量重绘。 */
}

/* ★★ 落子 / 停一手后，把「该手号」上留着的旧讲解清掉（2026-10-06 审查发现）。
   为什么必须清：讲解是**按手号**存的（`state.coach.explain[at]`，at = 第几手），
   而悔棋不会动这些数据 —— 于是「悔棋 → 换一手重下」之后，
   新落的第 k 手会去查 `explain[k]`，拿到的是**上一手（旧那手）的讲解**：
     · 框里写着旧手的坐标和理由，盘上却是另一手；
     · 做「全盘讲解」时它被当成「已讲过」跳过（`if (!state.coach.explain[at])`）；
     · `saveCoachFile` 会把这份错内容写进 `<棋谱名>.coach.json` —— **之后永远不再重讲**。
   手号是唯一的失效依据（我们没存局面指纹），所以在**写入的同一处**把它清掉最稳：
   `tryPlay` / 停一手 / AI 停一手 三个落子点都调它。 */
function clearCoachAt(at) {
  const ex = state.coach && state.coach.explain;
  if (ex && at && ex[at]) delete ex[at];
}

/* ★ 单飞（同一时刻只允许一次分析在飞）—— 2026-10-04 实测定位出的 bug：
   原来每次落子都发一个分析请求，而 main.js 里**每个新请求都会 `terminateId` 掐掉前一个**
   （见 main.js 的 analyze()）。落子快过分析时，引擎陷进「启停风暴」：
   实测连续落子（间隔 1 秒）12 手 → ownership 卡在旧局面**一动不动**，
   停止落子后还要等约 **20 秒**才追上（落后 11 手）。用户报的就是「形势变着变着就停下来了」。
   改法：任何时刻最多一个请求在飞；没轮上的局面进 anaQueue，跑完接着补。
   效果：不会雪崩，且一定会收敛到最新局面，欠下的历史也会补齐。 */
let anaBusy = false;      // 是否已有一次分析在跑
let anaPoke = false;      // 跑的过程中又被调度过 → 跑完再看一眼

/* ★ 「棋局代次」：换局 / 换棋谱时 +1。**凡是「发请求 → 等结果 → 写状态」的地方都要用它**，
   回来时对不上就整体丢弃 —— 否则属于上一局的结果会落到这一局上。
   为什么必须有它（2026-10-04 实测踩到）：换局时旧请求还在飞，回来时判断条件可能"恰好"成立 ——
     · 分析：`at === state.viewAt`（旧局第 0 手 vs 新局 viewAt=0）
     · AI 落子：`state.moves.length === expectLen`（两边都是空盘，都是 0）
     · 数子 / 复盘：压根没有局面校验，直接写 state.result / state.review
   现象分别是「未开局状态下走势图还挂着数据」「重开一局后 AI 往空盘上落一手」
   「新局上冒出上一局的胜负」。
   （同一局内换局面的情况由 `at !== state.viewAt` 那条管着，两者互补。） */
let gameGen = 0;
let anaReqGen = -1;       // 当前在飞的那个**分析**请求属于哪一代（onProgress 用）

async function runAnalysis() {
  anaDiag.start++;
  /* ★ 数子期间**不发分析请求**：否则新分析会在 main.js 里 terminateId 掐掉数子查询，
     数子就会拿到半成品或直接失败（用户报过「点完数子按钮好像没发生什么」）。
     数子跑完会主动补一次分析，见 runScore 的 finally。 */
  if (scoreBusy) { anaDiag.failEarly.score++; anaDiag.note('数子中提前return'); alog('run 数子中 → 不发'); return; }
  /* ★ 复盘同理：复盘是一次「整盘逐手」的长请求，被分析掐掉就白跑了（可能要等两分钟）。
     复盘结束后会主动刷一次界面，见 runReview。 */
  if (reviewBusy) { anaDiag.failEarly.review++; anaDiag.note('复盘/讲解中提前return'); alog('run 复盘/讲解中 → 不发'); return; }
  if (!engineReady) { anaDiag.failEarly.notReady++; anaDiag.note('引擎未就绪提前return'); alog('run 引擎未就绪 → 不发'); return; }
  if (anaBusy) { anaPoke = true; anaDiag.failEarly.busy++; alog('run 已有请求在飞 → 只登记 poke'); return; }
  anaBusy = true;
  anaBusySince = Date.now();                     // ★ 给「刷新」按钮判断卡死用
  const gen = gameGen;                            // ★ 这一轮属于哪一代
  alog('run 开始 代=' + gen + ' q=[' + anaQueue.join(',') + '] viewAt=' + state.viewAt
    + ' shownAt=' + shownAt + ' candAt=' + state.candAt + ' force=' + anaForceCur);
  try {
    /* 上限只是防止意外死循环（正常一轮只会跑十几次）。 */
    for (let guard = 0; guard < 500; guard++) {
      if (scoreBusy || reviewBusy || !engineReady) { anaDiag.note('数子/复盘/引擎掉了 中断循环'); alog('run 循环中断：数子/复盘/引擎掉了'); break; }
      if (gen !== gameGen) { anaDiag.note('换局中断循环'); alog('run 循环中断：换局/换棋谱（代 ' + gen + '→' + gameGen + '）'); break; }   // ★ 换局 / 换棋谱了：剩下的欠账全部作废

      /* ① 先算**当前看着的局面** —— 胜率条 / 候选点 / 形势雾要它上屏（最高优先）。 */
      const cur = state.viewAt;
      if (shownAt !== cur || anaForceCur) {
        const ok = await runAnalysisOnce(cur);
        if (ok) { anaDiag.okCount++; anaForceCur = false; }
        else { anaDiag.failOnce++; anaDiag.note('runAnalysisOnce 返回 false'); alog('run 当前局面 at=' + cur + ' 这一趟没成功 → 退出循环'); break; }
        continue;
      }
      /* ★ 走到这里就说明「认为当前局面已算过」—— 这是最可疑的一条路，
         因为如果 candAt 却没跟上，那这个局面就再也不会被重算。
         记一行，卡住时一眼能看出来。 */
      if (state.candAt !== cur) {
        alog('★ run 认为已算过但 candAt=' + state.candAt + ' ≠ viewAt=' + cur
          + '（跳过当前局面，去补欠账；若此处反复出现就是卡住的源头）');
      }

      /* ② 再补欠账：把队列里「还没有 history」的手数从旧到新算出来（只写 history，不动画面）。 */
      const at = anaQueue.shift();
      if (at === undefined) break;               // 没有欠账了
      /* ★★ 越界欠账直接丢（2026-10-06 实测定位到的坑）。
         悔棋后队列里会残留比当前手数大的 at（那些局面已经不存在了）。
         若不拦：runAnalysisOnce(8) 会去算 `moves.slice(0, 8)` —— moves 只有 7 手，
         引擎算的其实是第 7 手，回来却按「第 8 手」写进 history[8]，
         **JS 数组会因此扩容**（实测 7 手的 history 长度涨到 11）。
         这些幽灵数据让 anaBusy 长期占着（busy 卡在 true），
         真正的当前局面再也排不上队 → **用户看到的现象就是「悔棋后分析停住了」**。 */
      if (at > state.moves.length) { anaDiag.skipHuge++; continue; }
      if (typeof state.history[at] === 'number') continue;   // 已经补上了（比如刚作为当前局面算过）
      if (at === cur) continue;                  // 当前局面刚算过
      await runAnalysisOnce(at);
    }
  } finally {
    anaBusy = false;
    /* 跑的过程中又被调度过 → 再来一轮（比如补账期间用户又落了一手） */
    if (anaPoke) { anaPoke = false; scheduleAnalysis(0); }
  }
}

/* 分析第 at 手之后的局面。
   · at === state.viewAt：结果上屏（胜率条 / 候选点 / 形势雾）。
   · at ≠ state.viewAt：只把这一手的胜率写进 history（补历史欠账），**绝不碰画面**
     —— 画面代表「当前局面」，不能被别的局面的结果污染。
   返回 true 表示这次请求有结果（可以继续下一件事）；false = 没就绪 / 出错 / 被取消。 */
async function runAnalysisOnce(at) {
  if (!(window.api && window.api.analyze)) return false;
  if (!engineReady) {
    if (!state.noGame) $('eval-wr').textContent = 'AI 准备中';
    return false;
  }
  if (typeof at !== 'number') at = state.viewAt;
  const gen = gameGen;          // ★ 记下这一请求属于哪一代（换局后就作废）
  anaReqGen = gen;             // onProgress 的中间报告也按它过滤

  const req = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    moves: state.moves.slice(0, at)
      .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
  };

  /* ★ 局面变了**不要清空**候选点 —— 清空会造成 3~4 秒的空窗（用户实测报过：
     AI 落子后推荐点整块消失，像坏了一样）。旧点由 draw() 按 candAt 识别为「过期」并淡化，
     新结果一到就整体替换。 */

  /* 只发一次查询：引擎每 0.25 秒推一次中间报告（onProgress），
     胜率与候选点会随搜索量自然收敛 —— 这才是真正的「先粗后精」，
     且不会出现两段式那种「先显示一批点、再整批换掉」的闪动。

     ★★ 渲染端超时兜底（2026-10-06 晚新增）。
     为什么必须自己再兜一层：主进程那边虽然有 90 秒超时，但**渲染端这一侧
     同样有"回不来"的路**（IPC 通道异常、页面被挂起、主进程那条 promise 因为
     任何原因没 settle）。一旦那一次 await 永不返回，`anaBusy` 就永远占着 ——
     后果不是"这一手没算"，而是**整个分析链路停摆**：
     选点不再刷新、胜率条冻住、棋盘上方那行「计算中… N」定在一个数字上不动，
     点悔棋、回看、落子都不管用，只能重启软件。这正是用户报的现象。
     加这一层之后，最坏情况是「这一手晚 25 秒」，而不是整个软件卡死。 */
  let res;
  try {
    res = await Promise.race([
      window.api.analyze(Object.assign({
        maxVisits: settings.visits || ANALYZE_VISITS,   // ★ 每次请求现读 —— 所以改档位是**热切换**
        includeOwnership: state.showTerritory,   // 形势雾的数据（不增加搜索量）
      }, req)),
      new Promise(r => setTimeout(() => r({ error: '分析请求超时（渲染端 25 秒没有响应）' }), ANALYZE_TIMEOUT_MS)),
    ]);
  } catch (e) {
    res = { error: String((e && e.message) || e) };
  }

  /* ★ 这一趟期间**换过局 / 换过棋谱** → 这次结果整体作废（一个字段都不写）。
     放在所有分支之前：连「记 history」都不做，那些手已经不属于现在这盘棋了。 */
  if (gen !== gameGen) { alog('once at=' + at + ' 作废：期间换过局（代 ' + gen + '→' + gameGen + '）'); return false; }

  /* ★ 被 cancel 掐掉的结果是**搜索中途的半成品**（visits 很少、胜率还没收敛）——
     绝不能上屏，否则胜率条会瞬间跳到一个极端值、过几秒又弹回来
     （用户实测报过这个现象；根因是 runScore 里的 window.api.cancel()）。 */
  if (res && res.cancelled) {
    /* ★★ 自愈（2026-10-07 新增）：如果被掐掉的正是**当前局面**那一趟，
        那么"重算当前局面"这个意图必须留着、而且要**主动重排一次**。
        为什么：`runAnalysis` 拿到 false 就 break，`anaBusy` 随即放开；
        而 anaForceCur 虽然还是 true，但**没有任何东西会再触发一次 schedule** ——
        如果这一刻正好没有落子/回看这类操作，分析就永远停在那儿
        （表现就是用户报的「选点 / 形势突然卡住不显示」，而且不会自己好）。
        典型触发：数子（runScore 里会 cancel）与悔棋/落子挤在一起的时候。 */
    if (at === state.viewAt) {
      anaForceCur = true;
      if (!anaTimer) anaTimer = setTimeout(runAnalysis, 120);
    }
    alog('once at=' + at + ' 被取消（cancelled）→ 重排；viewAt=' + state.viewAt);
    return false;
  }
  if (!res || res.error) {
    const timedOut = !!(res && res.error && res.error.indexOf('超时') >= 0);
    if (timedOut) {
      /* ★ 超时 = 请求回不来了。**必须主动重排一次**，否则 anaForceCur 会一直挂着、
         而 anaBusy 已经放开 —— 没人再触发的话分析就永远停在这儿（就是"卡死"）。
         限流：连续 3 次仍不回来就不再重排，明确报错并让用户看到该怎么办。 */
      anaTimeouts += 1;
      if (anaTimeouts <= 3) {
        console.warn('[分析] 第 ' + anaTimeouts + ' 次请求超时，重排一次');
        setTimeout(() => scheduleAnalysis(0, true), 200);
      } else {
        engineNote = '分析引擎连续无响应 —— 顶栏「KataGo」里卸载后重新加载';
        console.error('[分析] 连续 ' + anaTimeouts + ' 次超时，停止重排');
        flash(engineNote);
      }
    }
    if (at === state.viewAt) {
      $('eval-wr').textContent = timedOut ? '分析超时' : '分析失败';
      $('eval-wr-w').textContent = '';
      /* ★ 有引擎级错误（比如**权重与引擎版本不匹配**）时优先显示它 ——
         那一句是 main.js 从引擎 stderr 里捞出来的原话转写，用户照着就能解决。
         显示在这里（右侧胜率卡）是因为它**任何局面下都看得见**，
         而棋盘中央那条提示只在「未开局」时才有（见 syncUI 里的 gate-tip）。 */
      $('eval-lead').textContent = engineNote || (res && res.error ? res.error : '');
      $('eval-lead-w').textContent = '';
    }
    alog('once at=' + at + ' 失败返回 false：' + ((res && res.error) || '未知')
      + '（引擎就绪=' + engineReady + ' viewAt=' + state.viewAt + '）');
    return false;
  }
  anaTimeouts = 0;                 // 有结果回来了 → 计数归零

  /* 补历史欠账（at ≠ 当前局面）：只记这一手的胜率，画面别动。 */
  if (at !== state.viewAt) {
    if (((res.root && res.root.visits) || 0) >= HINT_MIN_VISITS) {
      /* ★ 带上这次的搜索量（第四个参数）—— 门槛靠它判断「够不够准」，见 rememberEval */
      rememberEval(at, blackWinFrom(res, at), blackLeadFrom(res, at), (res.root && res.root.visits) || 0);
    }
    return true;
  }

  /* 当前局面：上屏（applyAnalysis 里也会顺手记下这一手的胜率）。
     ★★ 2026-10-07 修的**真 bug**：原来这里无条件写 `shownAt = at`，
        可 `applyAnalysis` 内部有提前 return（搜索量不够 / 报文与当前局面不符时直接返回）。
        那样一来：**候选点没画上去，却被标记成"这个局面已经显示过了"** ——
        而 `runAnalysis` 的判据是 `shownAt !== cur`，于是这个局面**永远不再重算**。
        用户看到的就是「棋盘上方那行『计算中… N』定住不动、推荐点永远不出现」。
        （实测证据：用户按 Ctrl+Shift+D 读出来的自检是
          「看第2手·选点: 还没算过·搜索量: 200·请求: 空闲·空跑0」——
          搜索量 200 说明请求发出去过、也回过进度，但 candAt 仍是 -1，
          队列空、没有请求失败 → 只可能是"被当成已显示、于是不再算"。）
        所以现在只认 `applyAnalysis` 真上屏了才记 shownAt。 */
  if (applyAnalysis(res, at)) { shownAt = at; alog('once at=' + at + ' ✓ 上屏成功 candAt=' + state.candAt + ' 候选点=' + state.candidates.length + ' visits=' + ((res.root && res.root.visits) || 0)); }
  else { alog('★ once at=' + at + ' 未上屏（applyAnalysis 返回 false）→ shownAt 不记，下轮会重算；visits=' + ((res.root && res.root.visits) || 0) + ' viewAt=' + state.viewAt); }
  draw();
  return true;
}

/* 引擎给的是「轮到走棋那一方」的胜率 —— 统一换算成黑方视角再上屏 */
/* 记下「第 at 手落下后的黑方胜率」—— 胜率走势曲线与手数列表的「涨跌」都靠它。
   试下（草稿）里的手**不记**：那些手等会儿会被整体丢掉，写进曲线就是脏数据。

   ★ 为什么单独抽出来（2026-10-04）：人机对弈时用户落子后立刻轮到 AI，
     那一手**等不到属于自己的分析**（见 syncUI 里的调度 + runAnalysisOnce 的作废分支），
     所以要能在「结果已作废」的路径上也把这一手的胜率留下来。

   ★★ 搜索量门槛（2026-10-06 晚新增，治「数字自己跳」）：
     这个函数是全盘**唯一**写 history 的地方，而它会被每一次分析结果调用 ——
     包括引擎每 0.25 秒推一次的**中间报告**（那时搜索量才 150 左右，胜率还没收敛）。
     原来是无条件覆盖，于是同一手被写十几遍、数字跟着乱跳。

     实测（_cdp_jump.mjs，连落 6 手后逐步回看）：
       at=1 被写 6 次，访问量 151/298/463/515/515/515，胜率极差 0.62%
       at=4 被写 4 次，访问量 152/312/471/514，          胜率极差 1.63%
       at=5 被写 5 次，访问量 168/340/515/515/515，      胜率极差 1.69%
       at=6 被写 14 次（含悔棋重下），                   胜率极差 **8.06%**
         → 27.7% → 19.7% → 32.9%，正是用户说的「原本算亏的，再点一次就不亏了」。
       列表里的涨跌是 (history[i] − history[i−1])×100，所以极差还会被放大。

     现在的规矩（两道，缺一不可）：
       ① **粗算只许记账、不许覆盖**：搜索量不到目标值（底栏「计算深度」）的 90% 时，
          只在这一格**本来是空的**时候写进去（先给个暂行值）；已经记过的一律不动。
       ② **精算才许改写，且不许倒退**：达到 90% 才允许覆盖已有记录，而且不能比已有记录更低。

     ⚠️ 曾经写成「新值是旧值的 1.25 倍就允许覆盖」—— 实测那是**形同虚设**
        （_cdp_gate.mjs）：中间报告的访问量是 122 → 294 → 489 → 515 逐级涨的，
        每一级都比上一级高 2.4 倍，于是每一级都通过了 1.25 倍那道门，数字照跳不误。
        「逐级放宽」对逐级增长的报告序列没有任何拦截力 —— 必须用**目标值的绝对比例**当门槛。
     ⚠️ 别改成「永不覆盖」：早期算的那几手会永远停在粗算值上，回看也不会变准。 */
function rememberEval(at, blackWin, blackLead, visits) {
  if (!(at >= 0)) return;
  if (state.draft && at > state.draft.from) return;
  /* ★★ 越界拒收（2026-10-06）。这是 history / leads 的**唯一写入口**，
     所以在这里拦一次就够 —— 上面 runAnalysis 里的过滤是第二道防线（少一次无效请求）。
     为什么必须拦：JS 的 `arr[99] = v` 会**把数组扩容到 100**，
     于是「7 手棋」的 history 长度变成 11（实测），
     走势曲线会画出根本不存在的第 8、9、10 手，手数列表里也有幽灵数据。
     场景：悔棋后队列里残留了已撤销手数的欠账，那次请求回来就写越界了。 */
  if (at > state.moves.length) return;

  const v = (typeof visits === 'number' && visits > 0) ? visits : 0;
  const target = settings.visits || ANALYZE_VISITS;        // 底栏「计算深度」
  const SETTLED = target * 0.9;                            // 「够准」的搜索量门槛
  if (typeof state.history[at] === 'number') {             // 这一格已经有值了
    const old = state.histVisits[at] || 0;
    if (v < SETTLED) return;              // ① 粗算不许覆盖
    if (v < old) return;                  // ② 不许倒退（用更少的搜索量改写）
  }
  if (typeof blackWin === 'number') state.history[at] = blackWin;
  if (typeof blackLead === 'number') state.leads[at] = blackLead;
  state.histVisits[at] = v;                                // 记住这一格的「精度」
  renderCurve();
  renderMoveList();          // 列表里的「这一手涨跌」也要跟着刷新
}

/* 这一手的胜率「算准了没有」——手数列表用它决定显示数字还是「…」。
   为什么要问这个（2026-10-06 晚）：引擎每 0.25 秒推一次中间报告，刚落子那 0.3 秒
   只有 130 左右的搜索量，胜率离收敛值差得远（实测同一手 122 → 515 之间差了 3%）。
   如果这时就把数字摆出来，用户会看到它过一会儿自己变一个值 —— 那正是他报的
   「下完显示一个数字，过会儿再看又不是这个数」。
   改成：没算准就显示「…」，算准了才出数字。数字一旦出现就不会再变。 */
function evalSettled(at) {
  const target = settings.visits || ANALYZE_VISITS;
  return (state.histVisits[at] || 0) >= target * 0.9;
}

/* 引擎给的是「轮到走棋那一方」的胜率 —— 统一换算成黑方视角（at 只用于兜底判断该谁走） */
function blackWinFrom(p, at) {
  const cp = String((p.root && p.root.currentPlayer) || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);
  return side === 'b' ? p.root.winrate : 1 - p.root.winrate;
}

/* 同上，换算「黑方领先目数」（正 = 黑优）—— 走势图「目差」纵轴用 */
function blackLeadFrom(p, at) {
  const root = p && p.root;
  if (!root || typeof root.scoreLead !== 'number') return undefined;
  const cp = String(root.currentPlayer || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);
  return side === 'b' ? root.scoreLead : -root.scoreLead;
}

/* p = 分析结果；at = 这是「第几手之后」的局面。
   ★ 只对**当前看着的局面**调用（at === state.viewAt）—— 补历史欠账的结果不许走这里。
   ★★ 返回值（2026-10-07 新增）：**真把东西画上屏了**才返回 true。
     调用方（runAnalysisOnce）用它决定要不要把这一手记成「已显示」（shownAt）——
     以前无条件记，于是"没画上屏也算显示过"，那个局面就再也不重算了。
     ⚠️ 两个"没上屏"的情况都要返回 false：
        ① 报文跟当前局面不符（at ≠ viewAt，比如请求期间用户又落了一子 / AI 应了一手）；
        ② 搜索量还太少（< HINT_MIN_VISITS），候选点先不更新。 */
function applyAnalysis(p, at) {
  if (!p || !p.root) return false;
  if (typeof at !== 'number') at = state.viewAt;
  /* ① 报文与当前局面不符：这不是"当前局面的结果"，一个字段都不该写。
     为什么必须挡：请求在飞的时候用户落子 / AI 应手，回来的报文属于**上一个**局面；
     照它画候选点就会把别的局面的点画到当前棋盘上。 */
  if (at !== state.viewAt) return false;

  /* 视角：以引擎返回的 currentPlayer 为准（权威）。
     引擎（RapaceGo/engine.cfg 里 reportAnalysisWinratesAs = SIDETOMOVE）返回的
     winrate / scoreLead / moveInfos[].winrate 全部是「**轮到走棋那一方**」的视角 ——
     已用极端贴目的对照实验验证过（轮白走时 scoreLead<0 表示白方落后）。
     所以这里只做一次「轮走方 → 黑方」的换算，不能再多转一次。 */
  const cp = String((p.root && p.root.currentPlayer) || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);

  const blackWin = side === 'b' ? p.root.winrate : 1 - p.root.winrate;
  const whiteWin = 1 - blackWin;
  const lead = side === 'b' ? p.root.scoreLead : -p.root.scoreLead;   // 正 = 黑领先

  $('bar-black').style.width = (blackWin * 100).toFixed(1) + '%';      // 条：左段黑、右段白
  $('eval-wr').textContent = '黑 ' + (blackWin * 100).toFixed(1) + '%';
  $('eval-wr-w').textContent = '白 ' + (whiteWin * 100).toFixed(1) + '%';
  /* 目数也两端各给一份：黑方 +9.3 表示黑领先 9.3 目，白方就是 −9.3（落后） */
  const signed = v => (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(1);
  $('eval-lead').textContent = signed(lead) + ' 目';
  $('eval-lead-w').textContent = signed(-lead) + ' 目';

  /* 存一份给「AI 要不要认输」判断用（它需要知道自己落后多少） */
  state.lastEval = { blackWin, lead };

  /* 形势（ownership）—— 放在 HINT_MIN_VISITS 那道门槛**之前**：
     雾是「渐变收敛」的，早一点显示出来观感更好（看不清就淡一点，不该从无到有地跳）

     ⚠️ ★ ownership 是「**相对当前走棋方**」的，不是固定黑方！实测（同一局面换谁走）：
        轮到白 → 白那侧 +0.998 / 黑那侧 −0.998
        轮到黑 → 黑那侧 +0.997 / 白那侧 −0.999
        跟 winrate / scoreLead 同一套视角规则，必须一起换算，否则整盘雾会反色。 */
  if (p.ownership && p.ownership.length === N * N && state.showTerritory) {
    const cpBlack = String((p.root && p.root.currentPlayer) || '').toUpperCase() === 'B';
    state.ownership = cpBlack ? p.ownership : p.ownership.map(v => -v);   // 统一存成「黑方占优为正」
    state.ownAt = at;
  }

  /* 候选点
     - 数字 = **轮到走棋那一方的胜率**（"我下这里，我能有多少胜率"）—— 直接取引擎原值。
       执白的人看到的就是白方胜率；若换算成黑方胜率，他会把自己 0.7% 读成 99%，会误导判断。
     - 排序 = 按「轮走方胜率」降序。引擎的 moveInfos 是按访问次数排的，**不是按胜率**；
       若换成黑方视角再降序，轮白走时就会把白棋最差的手排到第一。
     - 再滤掉搜索量太少的点（胜率方差极大、经常虚高）。
     - 搜索量还小时（< HINT_MIN_VISITS）先不动，保留上一批（此时各点排序会乱跳）。 */
  const totalV = (p.root && p.root.visits) || 0;
  /* 「计算中… 320」要显示它 —— 放在门槛**之前**，这样搜索量还很低时也能看到它在涨 */
  state.rootVisits = totalV;
  /* ② 极低搜索量（<20）时数据纯噪声，候选点先不更新 → **没上屏，返回 false**。
     这一步很要紧：只有它返回 false，调用方才会把这一手记成"还没显示"、
     下一轮重新算（否则这个局面永远停在"计算中…"上）。 */
  if (totalV < HINT_MIN_VISITS) return false;

  /* 记下「第几手时黑方胜率多少」——胜率走势曲线与手数列表都靠它。
     试下（草稿）里下的手**不记**：那些手等会儿会被整体丢掉，写进曲线就是脏数据。
     ★ 第四个参数 = 这次结果的搜索量（totalV），门槛用它判断「够不够准」。 */
  rememberEval(at, blackWin, lead, totalV);

  /* 候选点的过滤门槛 —— ★ 2026-10-04 实测（_cdp_cand.mjs，连续落 8 手，共 39 次采样）：
     引擎**每次都返回 8 个候选**，但原来那道「按总搜索量 1.5%」的比例门槛，
     在「搜索高度集中」的局面（500 步几乎全给了唯一好手）会把 7 个次要点全滤掉、
     只剩 1 个 —— 实测约 40% 的手都这样，正是用户报的「很多时候只显示一个选点」。
     现在：可信的（visits ≥ 总搜索量 1%）优先；不足 3 个时放宽补足，别只给一个。
     visits ≥ 2 是硬下限 —— 一次都没被回访的点基本是神经网络的先验噪声，胜率不可信。 */
  const strongV = Math.max(3, totalV * 0.01);
  const usable = (p.moves || [])
    .map(m => {
      const pt = fromGTP(m.move);
      if (!pt) return null;
      const win = m.winrate;                   // 引擎原值 = 轮走方视角
      /* pv = 这一手之后的预计变化（主进程只透传前 8 手）。悬停「变化图」用它。
         ⚠️ 引擎给的 pv **包含这一手本身**（pv[0] 就是 m.move），所以画的时候要跳过第一个。 */
      return { x: pt.x, y: pt.y, win, visits: m.visits, label: (win * 100).toFixed(1), pv: m.pv || null };
    })
    .filter(c => c && c.visits >= 2);
  let pick = usable.filter(c => c.visits >= strongV);
  if (pick.length < 3) pick = usable;          // 可信点太少 → 放宽（宁可多给几个参考）
  state.candidates = pick.sort((a, b) => b.win - a.win).slice(0, 4);
  state.candAt = at;                           // 记下这批点是第几手的（draw 用它判断过期没）
  return true;                                 // ★ 真上屏了 → 调用方可以记 shownAt
}

/* ---------------- AI 对弈 ---------------- */

/* ★ 对手棋力 = KataGo 人类棋风模型的「真实段位档位」（humanSLProfile）
 *
 * 为什么换掉原来那套：
 *   旧版靠「降 visits + 随机挑点」来降低水平 —— 那些数值是我估的、**从未校准**，
 *   标着「业余 3 段」并不等于真业余 3 段（用户实测就发现"不匹配会输得很惨"）。
 *   现在用权重自带的真实档位：**选什么段位，就真的按那个水平下**。
 *   实测（同一局面，300 visits）：rank_9d 首选 C3 / rank_1d 首选 C3 /
 *   rank_10k 首选 Q3 / rank_20k 首选 Q3 —— 连"对局面强弱的自我认知"都不同。
 *
 * ⚠️ 两个前提（别忘）：
 *   ① 只有 **human 权重**（b18c384nbt-humanv0）认这个档位，strong 权重会报
 *      `Unknown human SL network profile` → 所以对弈必须走独立的 play 引擎。
 *   ② 档位可**逐请求覆盖**（`overrideSettings.humanSLProfile`），不必为每个段位重启引擎。
 *
 * ★ 文案的准确边界（2026-10-04 对着官方文档重写过一次，别再凭印象编）：
 *   · `rank_*` / `preaz_*` 这一批（20 级 ~ 9 段）是**一把连续的业余段位尺子**，
 *     **不是职业段位表** —— 官方原文只有 "Imitate human players of the given rank"，
 *     **没公布对标哪个体系**；最高档 9d 的位置是「业余顶尖 / 接近职业边缘」，
 *     **不是职业九段**。（之前我按常识写了「职业顶尖」之类，那是没依据的，已删。）
 *   · 明确标着职业的只有 `proyear_*`（官方用词："pro and strong insei"）。
 *   · 高段之间几乎分不出来：实测同一局面 rank_7d / 8d / 9d 的首选点相同。
 *   · 「约业余 X 段」是圈内通行换算、**不是官方数据**，各地差异还很大 ——
 *     所以那个「约」字别去掉。
 * visits 不决定档位（档位由网络本身决定），给固定值就行。
 */

/* 下拉分组。2026-10-04 用户要求：现代段位**不要再切块** ——
   原来分「职业/强业余」「业余高段」「业余级位」「入门」四块，
   可这条 20 级~9 段本来就是连续的，切块反而误导（"5 段"被归进"职业"那一块，
   其实它是业余）。现在合成一块，名字直接写明「非职业」。 */
const RANK_GROUPS = [
  '现代段位（非职业）',                          // 0 — rank_* 29 档
  '前AI时代段位（非职业）',                      // 1 — preaz_*
  '职业棋风 · 按年份（1800–2023）',              // 2 — proyear_*
];

/* [档位值, 显示名, 分组下标, 一句话水平说明]
   ★ 说明是「圈内粗略换算 + 典型特征」，**不是官方标定** —— 官方没有换算表。
   「约业余 X 段」指网络平台的段位体系（野狐/弈城那种 1d~9d），
   和「中国业余段位制」（1~5 段靠比赛升、6 段省级冠军、7 段全国冠军、8 段荣誉）
   只是大体对应，各地含金量差别很大。 */
const RANK_ROWS = [
  ['rank_9d', '9 段', 0, '业余顶尖 · 接近职业边缘'],
  ['rank_8d', '8 段', 0, '强业余 · 省级冠军那个层次'],
  ['rank_7d', '7 段', 0, '业余 6 段上下'],
  ['rank_6d', '6 段', 0, '业余 5 段偏强'],
  ['rank_5d', '5 段', 0, '约业余 5 段'],
  ['rank_4d', '4 段', 0, '约业余 4 段'],
  ['rank_3d', '3 段', 0, '约业余 3 段 · 布局定式熟练'],
  ['rank_2d', '2 段', 0, '约业余 2 段 · 会攻杀，偶尔漏算'],
  ['rank_1d', '1 段', 0, '约业余 1 段 · 刚入段'],
  ['rank_1k', '1 级', 0, '冲段水平 · 比业余 1 段略差'],
  ['rank_2k', '2 级', 0, '级位上游 · 定式基本会，官子还糙'],
  ['rank_3k', '3 级', 0, '级位上游 · 中盘能打，容易上头'],
  ['rank_4k', '4 级', 0, '级位中游 · 会算局部死活'],
  ['rank_5k', '5 级', 0, '级位中游 · 全局观还在建立'],
  ['rank_6k', '6 级', 0, '级位中下 · 常下出无理手'],
  ['rank_7k', '7 级', 0, '级位下游 · 死活容易看错'],
  ['rank_8k', '8 级', 0, '级位下游 · 会被简单骗着骗到'],
  ['rank_9k', '9 级', 0, '入门偏上 · 知道该先占角'],
  ['rank_10k', '10 级', 0, '入门 · 知道基本下法，布局随缘'],
  ['rank_11k', '11 级', 0, '初学 · 常常不知道该下哪'],
  ['rank_12k', '12 级', 0, '初学 · 只会连络和逃跑'],
  ['rank_13k', '13 级', 0, '初学 · 吃子看得见，算气常错'],
  ['rank_14k', '14 级', 0, '刚会算气 · 一块棋常被白吃'],
  ['rank_15k', '15 级', 0, '刚会算气 · 不太顾全局'],
  ['rank_16k', '16 级', 0, '新手 · 会下，但常自填眼'],
  ['rank_17k', '17 级', 0, '新手 · 分不清先后手'],
  ['rank_18k', '18 级', 0, '新手 · 刚懂规则'],
  ['rank_19k', '19 级', 0, '新手 · 刚懂规则，下得较慢'],
  ['rank_20k', '20 级', 0, '刚学 · 只会连子和吃子'],
];

/* ★ 三套档位都是 **KataGo 引擎内置**的 humanSLProfile 系列 —— 我们只是接线，
     一行「棋力算法」都没有自己写（下面那些人话说明是照段位含义写的，不是算出来的）：
       ① rank_*    现代开局风格的段位（主表，29 档，默认用这套，**业余段位标尺**）
       ② preaz_*   2016 年 AlphaZero 之前那种开局风格（**同一把尺子**，只是开局旧）
       ③ proyear_* 按年份模仿**职业**棋手 / 强院生（1800~2023，**每年一档**；
                   实测越界（1799 / 2024）引擎只报 error，不会崩）
     ⚠️ 三点官方说明（实测查证，别当它们不存在）：
        · 措辞是「**模仿**（imitate）」而非「等同」，官方也没公布对标哪个段位体系；
        · 只有 proyear_* 明确是职业，rank_/preaz_ 都是业余段位标尺（见上面的注释）；
        · **搜索量给多了会比标称段位强** —— 搜索会解掉该段位解不出的战术。
          想让它真的「像那个段位」，要打开「拟人落子」（按该段位人类的概率抽样）。 */
const RANK_ROWS_ALL = RANK_ROWS.slice();
for (const [v, label, , note] of RANK_ROWS) {
  RANK_ROWS_ALL.push(['preaz_' + v.slice(5), label, 1, note]);
}
for (let y = 2023; y >= 1800; y--) {
  RANK_ROWS_ALL.push(['proyear_' + y, y + ' 年', 2, '模仿 ' + y + ' 年前后的职业棋手 / 强院生']);
}
const RANKS = RANK_ROWS_ALL.map(([v, label, gi, note]) =>
  ({ v, label, group: RANK_GROUPS[gi], note }));
const RANK_MAP = new Map(RANKS.map(r => [r.v, r]));

/* AI 每手搜索量。档位由网络决定，visits 只影响这手算得稳不稳 —— 给个够用的固定值。
   （别再用 visits 当难度旋钮：那样既费时间又不准，低段位照样能算得比标称强。） */
const AI_VISITS = 400;

let aiBusy = false;
let aiRetry = 0;         // AI 这一手没落成时的重试计数（防止局面被打断后停摆）
let aiTimer = null;

function isMyTurn() {
  /* 试下时两边都能下 → 一直算「轮到我」，这样推荐点照常显示（正在探索，正需要它） */
  if (state.draft) return true;
  return sideToMove(state.viewAt) === state.myColor;
}

function needAIMove() {
  return settings.mode === 'play'
    && !state.noGame            // ★ 未开局：AI 也不落子（否则执白时一启动它就自己下起来了）
    && !state.draft              // ★ 试下（草稿）时 AI 不自动落子 —— 是你在摆，不是在下棋
    && !state.result             // ★ 本局已结束（数子出结果 / 认输）→ 不再落子
    && engineReadyPlay           // ★ 是「对弈引擎」就绪，不是分析引擎
    && !aiBusy
    && state.viewAt === state.moves.length
    && !isMyTurn();
}

function scheduleAIMove(delay) {
  clearTimeout(aiTimer);
  aiTimer = setTimeout(maybeAIMove, delay === undefined ? 120 : delay);
}

/* 从结果里挑一手。
   ★ 现在水平由「档位」决定（human 模型带 profile），这里**不用再随机降级** ——
   直接取它的首选，那本来就是该段位最可能下的一手。
   只留一点点变化（前二里偶尔换一个），免得同一局面每次都一模一样。 */
const AI_ALT_CHANCE = 0.15;
function pickAIMove(res) {
  const infos = res.moves || [];
  if (!infos.length) return null;

  /* 引擎首选是 pass（该收束了）→ 直接 pass。官方配方里也是这么处理的。 */
  const first = infos.find(m => m.order === 0) || infos[0];
  if (first && String(first.move).toLowerCase() === 'pass') return 'pass';

  /* ---- 拟人落子：按人类概率抽样 ---- */
  if (settings.humanLike) {
    const picked = pickByHumanPolicy(res, infos);
    if (picked) return picked;
    /* 万一拿不到 policy，退回下面的取首选（总比不落子强） */
  }

  /* ---- 默认：取首选（前二里偶尔换一个，免得同一局面每次都一模一样） ---- */
  const top = infos.slice(0, 2);                 // 引擎已按 order 排，第 0 个就是首选
  const i = (top.length > 1 && Math.random() < AI_ALT_CHANCE) ? 1 : 0;
  const mv = top[i].move;
  if (!mv) return null;
  if (String(mv).toLowerCase() === 'pass') return 'pass';
  return fromGTP(mv);
}

/* 按人类概率挑一手（拟人落子专用）。权重 = humanPrior × exp(utility / 0.5)。
   · humanPrior：优先用 policy 数组里该点的概率 —— 实测它就是**人类先验**
     （同一局面同一档位，方式2 的 policy 与方式1 的 humanPolicy 数值完全一致）；
     拿不到 policy 就退回引擎给的 prior。
   · exp(utility / 0.5)：**保护项**，官方原话是「跟着 humanPrior 走，但某手一旦开始亏
     超过 0.5 utility（约 25% 胜率）就平滑压低它的概率」—— 这就是"不会连着下烂棋"的原因。
     参数缺失时 exp(0)=1，退化成纯按人类概率抽（官方配方 A）。
   实测这条分布下：9 段只有 7 个非零点、20 级有 26 个，段位越高越集中。 */
function pickByHumanPolicy(res, infos) {
  const pol = res.policy;
  const hasPol = Array.isArray(pol) && pol.length === N * N + 1;   // 最后一个元素是 pass 的概率
  const bag = [];
  for (const m of infos) {
    const pt = fromGTP(m.move);                  // pass / 非法坐标会返回 null，自动被滤掉
    if (!pt) continue;
    const hp = hasPol ? Math.max(0, pol[pt.y * N + pt.x]) : Math.max(0, m.prior || 0);
    if (!(hp > 0)) continue;                     // 人类压根不会下的点，不进袋子
    const u = (typeof m.utility === 'number') ? m.utility : 0;
    bag.push({ pt, w: hp * Math.exp(u / 0.5) });
  }
  if (!bag.length) return null;

  let total = 0;
  for (const x of bag) total += x.w;
  if (!(total > 0)) return null;

  let r = Math.random() * total;
  for (const x of bag) { r -= x.w; if (r <= 0) return x.pt; }
  return bag[bag.length - 1].pt;
}

async function maybeAIMove() {
  if (!needAIMove()) return;
  aiBusy = true;
  state.thinking = true;                 // 思考中：不显示落子预览方块
  draw();

  let retry = false;
  try {
    /* AI 认输判断：落后太多就投子。放在发请求之前 —— 没必要为一个已输的局面再算一遍。 */
    if (aiWantsResign()) {
      const aiSide = state.myColor === 'b' ? 'w' : 'b';
      doResign(aiSide, 'ai');
      flash('KATAGO 认输 · ' + (aiSide === 'w' ? '黑' : '白') + '方胜');
      syncUI();
      return;
    }
    const req = {
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: state.moves.slice(0, state.viewAt)
        .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: AI_VISITS,
      profile: settings.level,      // ★ 真实段位（rank_3d 这种）→ 对弈引擎逐请求覆盖
      /* 拟人落子要用 policy（人类先验）来抽样。⚠️ includePolicy 是**外层字段**
         —— 官方文档明确：除了它和 maxVisits，其余参数都必须放 overrideSettings，否则无效。 */
      includePolicy: settings.humanLike,
    };
    const expectLen = state.moves.length;
    const gen = gameGen;                      // ★ 这一手属于哪一局
    /* ★ 走「对弈引擎」（human 权重）—— 分析引擎不参与落子，
       否则两条请求会在同一个进程里互相 terminate。 */
    const res = await window.api.playMove(req);

    /* ★ 换了局（新对局 / 打开棋谱）→ 这手整体作废。
       光看手数不够：两边都是空盘时 `state.moves.length` 都是 0，下面的检查会"恰好通过"，
       于是 AI 把**上一局**算出的那一手落到了新盘上（重开一局时能实际看到）。 */
    if (gen !== gameGen) {
      /* ★★ 但作废之后**必须给新局重排一次**（2026-10-06 审查发现）。
         原来这里直接 return，`retry` 仍是 false，finally 里那句
         `if (retry && needAIMove())` 就不会排 —— 而新局启动时的 syncUI()
         也会因为此刻 `aiBusy` 还是 true 而跳过（needAIMove 要求 !aiBusy）。
         结果：新局若轮到 AI 走，**AI 不动、用户也动不了**（不是他的回合），
         界面看着像卡死，要等下一次任意 UI 刷新（引擎状态变化、提示条到点）才自己好。
         ★ 不计入 aiRetry —— 这不是"失败"，只是局面换了，不该占用重试额度。
         ★ 用 0 延迟：这个定时器会排在本次 finally 之后跑，那时 aiBusy 已经放开了。 */
      scheduleAIMove(0);
      return;
    }
    /* 期间局面被改动了（悔棋 / 回看 / 切模式后手动落子）→ 这手作废 */
    if (state.moves.length !== expectLen || state.viewAt !== state.moves.length) { retry = true; return; }
    if (!res || res.error) {
      /* ★ 也走重试（下面的 finally 里那套 aiRetry 上限 3 次）。
         原来这里直接 return → 引擎偶尔超时/出错一次，AI 就停在那儿不动了，
         要等「引擎状态变化」才有下一个触发点 —— 用户只能自己动一下（审查发现）。 */
      retry = true;
      flash('AI 这一步没算出来（' + ((res && res.error) || '未知') + '），重试中…');
      return;
    }

    const pick = pickAIMove(res);
    if (pick === 'pass') {
      aiRetry = 0;
      state.moves.push({ pass: true, color: sideToMove(state.moves.length) });
      clearCoachAt(state.moves.length);    // 该手号上的旧讲解作废
      state.viewAt = state.moves.length;
      syncUI();
    } else if (pick) {
      aiRetry = 0;
      tryPlay(pick.x, pick.y, true);
    } else {
      retry = true;
      flash('AI 没找到可下的点');
    }
  } finally {
    aiBusy = false;
    state.thinking = false;
    draw();

    /* ★ 关键：这一手没落成（局面中途变了 / 引擎没给点），但仍然轮到 AI —— 必须重新安排，
       否则就停摆了：用户下不了（不是他的回合），AI 也不动。
       （2026-10-03 用户实测：人机对弈 → 摆棋 → 再切回人机对弈，AI 就不下了） */
    if (retry && needAIMove()) {
      if (aiRetry < 3) { aiRetry += 1; scheduleAIMove(500); }
      else { aiRetry = 0; flash('AI 连续几次没能落子，请检查引擎是否正常'); }
    }
  }
}


if (window.api) {
  /* 从状态里取某个引擎的字段。
     ⚠️ 主进程为兼容旧字段，把「分析引擎」的 ok/ready/error 平铺到了顶层 ——
     这里优先读 s.analyze / s.play，读不到才退回顶层。 */
  const readEngineState = (s, key) => {
    if (!s) return { ready: false, error: '' };
    const sub = s[key];
    if (sub) return { ready: !!sub.ready, error: sub.error || '' };
    /* 兼容旧版主进程：顶层平铺的那套字段属于「分析引擎」。只对 analyze 回退 ——
       新引擎（coach）**不能**跟着回退，否则会被误判成就绪。 */
    if (key === 'analyze') return { ready: !!s.ready, error: s.error || '' };
    return { ready: false, error: '' };
  };

  const applyEngineStatus = s => {
    const a = readEngineState(s, 'analyze'), p = readEngineState(s, 'play'),
      c = readEngineState(s, 'coach');
    engineReady = !!a.ready;
    engineReadyPlay = !!p.ready;
    coachReady = !!c.ready;
    /* ★ 只有 KataGo 的故障才算「引擎异常」—— 讲解模型没配/没加载不该影响下棋。 */
    engineNote = a.error || p.error || '';
    coachNote = (s && s.coach && s.coach.error) || '';
    /* 三个引擎的原始状态（画状态灯用）；主进程没给 state 就按 ready/error 推断 */
    const stOf = (sub, r) => (sub && sub.state) || (r.ready ? 'ready' : (r.error ? 'error' : 'off'));
    engStates = {
      analyze: stOf(s && s.analyze, a),
      play:    stOf(s && s.play, p),
      coach:   stOf(s && s.coach, c),
    };
    renderEngines();
    /* 任一引擎刚就绪都刷一次：
       分析引擎就绪 → 立刻算当前局面；对弈引擎就绪 → 轮到 AI 就让它落子。 */
    syncUI();
    checkEngineReloaded();      // 「设置」里改完路径的重启 → 两个都就绪才算重启完成
  };

  /* ---------- 顶栏引擎状态灯（2026-10-05 新增） ----------
     引擎改成手动加载后，用户需要一眼看到「谁在跑 / 谁没跑 / 谁挂了」。
     点一下弹出操作菜单（加载 / 暂停 / 恢复 / 卸载），菜单内容按当前状态现生成。 */
  /* 一盏灯 = 一组进程：
       katago = 分析引擎 + 对弈引擎（**两个**进程，合在一起管 —— 对用户来说就是「KataGo」）
       coach  = LoGos 一个进程
     灯的状态取这一组的「合成状态」，取更"要紧"的那个。 */
  const ENG_KEYS = { katago: ['analyze', 'play'], coach: ['coach'] };
  const ENG_META = {
    katago: { on: 'KataGo', tip: '算胜率、目差、推荐点、形势、复盘，也负责 AI 落子' },
    coach:  { on: 'LoGos（讲解模型）', tip: '用大白话讲棋（分析讲解 / 推荐落点讲解 / 全盘讲解）' },
  };
  const ENG_STATE_TXT = { off: '未加载', loading: '加载中…', ready: '就绪', paused: '已暂停', error: '出错', partial: '部分就绪' };

  function engStateOf(key) {
    const list = (ENG_KEYS[key] || []).map(k => engStates[k] || 'off');
    if (list.includes('error')) return 'error';
    if (list.includes('loading')) return 'loading';
    if (list.every(s => s === 'off')) return 'off';
    /* ★ 暂停必须排在「就绪」前面：否则「分析已暂停 + 对弈没加载」会走到下面的兜底、
       显示成绿灯「就绪」—— 而这时候点「数子」根本不会算（2026-10-05 审查发现）。 */
    if (list.includes('paused')) return 'paused';
    if (list.every(s => s === 'ready')) return 'ready';
    return 'partial';      // 起了几个、还有没起的
  }
  let engMenuKey = null;

  function renderEngines() {
    for (const el of document.querySelectorAll('.engines .eng')) {
      const k = el.dataset.key;
      const st = engStateOf(k);
      el.dataset.state = st;
      const meta = ENG_META[k];
      el.title = meta.on + ' —— ' + ENG_STATE_TXT[st] + '\n' + meta.tip + '\n（点一下看能做什么）';
    }
    /* 菜单开着时状态变了（比如「加载中」变成「就绪」）→ 菜单内容跟着刷新 */
    if (engMenuKey) {
      const el = document.querySelector('.engines .eng[data-key="' + engMenuKey + '"]');
      if (el) openEngineMenu(engMenuKey, el, true);
    }
  }

  function closeEngineMenu() {
    $('engmenu').hidden = true;
    engMenuKey = null;
  }

  function openEngineMenu(key, anchorEl, keepOpen) {
    if (!keepOpen && engMenuKey === key) { closeEngineMenu(); return; }
    const meta = ENG_META[key];
    /* ★ 菜单项按**每个子引擎**的实际情况出，而不是看聚合出来的那一个状态：
       KataGo 是「分析 + 对弈」两个进程，可能出现「分析起来了、对弈没起」。
       原来的写法在这种组合下既不给「加载」也不给「暂停/卸载」，
       用户想把缺的那个补起来却没有入口（2026-10-05 审查发现）。 */
    const subs = (ENG_KEYS[key] || []).map(k => engStates[k] || 'off');
    const anyOff = subs.some(s => s === 'off' || s === 'error');
    const anyReady = subs.some(s => s === 'ready');
    const anyPaused = subs.some(s => s === 'paused');
    const anyLoading = subs.some(s => s === 'loading');

    const rows = [];
    if (anyLoading) rows.push({ act: null, label: '正在加载…请稍候' });
    if (anyOff) rows.push({ act: 'load', label: '加载（第一次约十几秒）' });
    /* 暂停只对「分析引擎」有意义 —— 它局面一变就自动分析。
       对弈引擎是被动的（只在你落子后才动），LoGos 更被动，都没有「暂停」这回事。 */
    if (anyReady && key === 'katago') rows.push({ act: 'pause', label: '暂停分析（不自动算棋）' });
    if (anyPaused) rows.push({ act: 'resume', label: '恢复分析' });
    if (anyReady || anyPaused) rows.push({ act: 'unload', label: '腾出显存（卸载）' });
    if (!rows.length) rows.push({ act: null, label: '（没有可执行的操作）' });

    const st = engStateOf(key);
    const menu = $('engmenu');
    menu.textContent = '';
    const head = document.createElement('div');
    head.className = 'mhead';
    head.textContent = meta.on + ' · ' + ENG_STATE_TXT[st];
    menu.appendChild(head);
    for (const r of rows) {
      const b = document.createElement('button');
      b.textContent = r.label;
      if (!r.act) { b.disabled = true; b.style.color = 'var(--text-dim)'; b.style.cursor = 'default'; }
      else b.onclick = () => { closeEngineMenu(); doEngineAct(key, r.act); };
      menu.appendChild(b);
    }
    menu.hidden = false;
    /* 定位：贴在按钮正下方；右边超出窗口就往回收一点 */
    const r = anchorEl.getBoundingClientRect();
    const w = menu.offsetWidth || 170;
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    engMenuKey = key;
  }

  async function doEngineAct(key, act) {
    const list = ENG_KEYS[key] || [key];
    let err = '';
    for (const k of list) {
      /* 「暂停 / 恢复」只对分析引擎做 —— 对弈引擎是被动的，暂停它没有含义。 */
      if ((act === 'pause' || act === 'resume') && k !== 'analyze') continue;
      const f = window.api.engine && window.api.engine[act];
      if (typeof f !== 'function') { err = '这个操作不可用'; break; }
      const r = await f(k);
      if (r && r.error) err = r.error;
    }
    if (err) { flash(err); return; }
    if (act === 'load') flash(ENG_META[key].on + ' 正在加载，好了会自己变绿');
    if (act === 'unload') flash(ENG_META[key].on + ' 已卸载');
  }

  /* ★ 引擎没加载时，点需要它的功能 → 提示 + 把操作菜单直接弹到眼前
     （2026-10-05 用户拍板的 A 方案：不静默、也不偷偷自己加载）。
     返回 true = 已经处理了，调用方直接 return 就行。 */
  function needEngine(key, what) {
    const ready = key === 'coach' ? coachReady : (key === 'play' ? engineReadyPlay : engineReady);
    if (ready) return false;
    const group = key === 'coach' ? 'coach' : 'katago';
    const nm = ENG_META[group].on;
    const st = engStateOf(group);
    if (st === 'loading') { flash(nm + ' 正在加载，稍等一下……'); return true; }
    flash(nm + ' 还没加载' + (what ? '，' + what + '得先有它' : '') + ' —— 点下面「加载」');
    const el = document.querySelector('.engines .eng[data-key="' + group + '"]');
    if (el) openEngineMenu(group, el, true);       // 把菜单弹出来，省得再去找
    return true;
  }
  window.needEngine = needEngine;

  for (const el of document.querySelectorAll('.engines .eng')) {
    el.onclick = e => { e.stopPropagation(); openEngineMenu(el.dataset.key, el); };
  }
  document.addEventListener('click', e => {
    if ($('engmenu').hidden) return;
    if (e.target.closest('#engmenu') || e.target.closest('.engines')) return;
    closeEngineMenu();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeEngineMenu(); });

  window.api.engineStatus().then(applyEngineStatus);

  /* ---------- 顶栏「刷新」按钮（2026-10-06 晚新增，用户要求） ----------
     用途：出现「推荐点不显示 / 棋盘上方『计算中… N』定住不动」时的**急救键**。
     为什么必须有它（而不是只靠自动恢复）：分析链路上有两条"等引擎回话"的路
     （主进程 90 秒、渲染端 25 秒），但都可能因为别的原因没兜住；
     一旦那一次 await 永不返回，`anaBusy` 就永远占着 → 整个分析链路停摆，
     用户能做的只有重启软件。有了它，用户自己点一下就放开、重排、并顺手救引擎。

     三步，顺序不能反：
       ① **放开前端卡住的闸门**（anaBusy / anaPoke / 超时计数），并把「待重算」意图留着；
       ② **问一遍引擎真实状态**；灯是 error / 显示就绪但引擎其实不可用 → 卸载再加载（真重启）；
       ③ **重排一次分析** —— 引擎若在重启，等它就绪后 onStatus → syncUI 会自己再排。
     ★ 不是"卡了才做"：没卡的时候点它也有用（相当于刷新状态 + 重排一次当前局面），
       所以按钮不做任何"你不需要点"的拦截，点了就有反馈。 */
  const btnRefresh = $('btn-engine-refresh');
  if (btnRefresh) {
    btnRefresh.onclick = async e => {
      e.stopPropagation();
      if (btnRefresh.dataset.busy === '1') return;          // 防连点
      btnRefresh.dataset.busy = '1';
      const wasStuck = anaBusy && anaBusySince && (Date.now() - anaBusySince > REFRESH_STUCK_MS);
      const waited = anaBusySince ? Math.round((Date.now() - anaBusySince) / 1000) : 0;

      /* ① 放开闸门 */
      anaBusy = false;
      anaPoke = false;
      anaTimeouts = 0;
      anaBusySince = 0;
      anaForceCur = true;        // 逼它把当前局面重算一遍（选点/胜率重新上屏）
      /* ★ 欠账也一起清掉（2026-10-06 晚，实测 _cdp_refresh.mjs）。
         原来只清了闸门、留着队列，于是状态栏写着「清了 N 条待补账」而队列其实还在
         —— 文案和事实不符，而且那份队列可能正是"卡住"的残留（里面混着已撤销手数）。
         清掉它，让分析从当前局面干净地重来一遍；欠的历史会由后续落子重新入队。 */
      const pending = anaQueue.length;
      anaQueue = [];

      let note = '已刷新';
      if (wasStuck) note += '（原来卡了 ' + waited + ' 秒）';
      if (pending) note += '（清了 ' + pending + ' 条待补账）';

      try {
        /* ② 引擎状态：先自己查一遍（别信界面上可能已经过期的灯） */
        let s = null;
        try { s = await window.api.engineStatus(); } catch (err) { s = null; }
        applyEngineStatus(s);
        const a = readEngineState(s, 'analyze');

        /* 灯说就绪、但分析请求其实回不来（engineNote 有内容）→ 真重启一次。
           ⚠️ 只在**已经出过错**或**状态灯是 error** 时重启 ——
              不能看见"就绪"就重启（那会把正常使用的引擎白白断掉十几秒）。 */
        const broken = !!(s && s.analyze && (s.analyze.state === 'error' || a.error));
        if (broken) {
          note += ' · 引擎不正常，正在重启';
          flash(note);
          await window.api.engine.unload('katago').catch(() => { });
          /* 等进程真正退干净再拉 —— launch() 开头是 `if (e.proc) return`，
             退不干净就拉不起来（这个坑在 main.js 里踩过）。 */
          await new Promise(r => setTimeout(r, 1500));
          const r = await window.api.engine.load('katago').catch(() => null);
          note += (r && r.error) ? ('（重启失败：' + r.error + '）') : '（十几秒后变绿）';
        }
      } catch (err) {
        note += ' · 刷新时出错：' + ((err && err.message) || err);
      }

      /* ③ 重排分析 + 让 AI 如果该走就走（顺序无所谓，两者各自有闸门） */
      scheduleAnalysis(0, true);
      if (needAIMove()) scheduleAIMove(0);
      draw();
      flash(note);
      setTimeout(() => { btnRefresh.dataset.busy = '0'; }, 400);
    };
  }
  /* 版本号填到「帮助」面板上 —— 用户判断「要不要更新」的唯一依据（包名不带版本号）。 */
  window.api.appVersion().then(v => { const el = $('help-ver'); if (el) el.textContent = 'v' + v; }).catch(() => { });
  window.api.onStatus(applyEngineStatus);
  /* 边算边刷（引擎每 0.25 秒推一次中途报告）。
     ★ 必须过滤掉「不是当前局面」的报告：补历史欠账的请求也会推中途报告（它成了主进程
       眼里的「最近一次查询」），不过滤就会把**别的局面**的候选点/胜率画到当前棋盘上。
       p.turn = 这条报告是「第几手之后」的局面（= 当时请求的 analyzeTurns）。 */
  window.api.onProgress(p => {
    /* ★ 换局 / 换棋谱之后，旧请求的中间报告一律不要（anaReqGen 还停在上一代）——
       否则它们会往刚清空的界面上写数据。 */
    if (anaReqGen !== gameGen) return;
    /* ★★ 只认分析引擎的报告（2026-10-06 审查发现）。
       对弈引擎（AI 思考时）用的也是同一个通道，但它是人类棋风权重 + 你选的段位档，
       数字和分析引擎不一样；而它那次请求的手数恰好等于当前手数，
       下面那条「手数过滤」拦不住它 —— 结果 AI 每走一步胜率条就闪一下、
       还会污染走势曲线和 state.lastEval。主进程现在也会带 `engine` 且只推分析引擎的，
       这里再挡一道（两边都拦，任一侧改动都不会漏）。 */
    if (!p || p.engine !== 'analyze') return;
    if (typeof p.turn === 'number' && p.turn !== state.viewAt) return;
    applyAnalysis(p, state.viewAt);
    draw();
  });
}

/* ---------------- 落子音效 ---------------- */

/* 素材取自九宫争鼎开发包（game/assets/audio/go_stone_*.wav，44.1k/16bit/单声道，0.08–0.20 秒）
   5 个变体随机播（且不与上一手重复），避免听腻。

   ★★ 2026-10-06 重写（用户报「有时候声音特别小、几乎听不见」）。三个原因，一起修：

   ① **同一个元素被连续重播**：原来只有 5 个 Audio 元素全局轮流用，播之前先
      `a.currentTime = 0` —— 而如果那个元素**还在播**，这就等于对正在播放的元素做 seek，
      Chromium 会把声音掐断、或从中间接上，听起来就是「变轻了」甚至没声。
      改法：每种音效预备 3 个副本（共 15 个元素，启动时全部预载），
      播放时优先挑**没在播的那个** —— 不再去动正在播的元素。
   ② **起播撞上重绘**：落子后紧接着要重画整张盘（形势雾是 N×N 逐点画，很吃主线程）。
      在重绘**之前**起播的话，音频管线刚建好就被主线程占住，
      两个只有 0.08/0.09 秒的短音效会被啃掉开头 —— 这也是「有时候」的来源。
      改法：由调用方把起播挪到重绘之后（见 tryPlay 里的 setTimeout）。
   ③ **整体偏轻**：实测 5 个音效的 RMS 是 8.4%~11.3%，旧代码又统一压到 volume 0.5。
      现在按实测 RMS 归一、基准提到 0.85（数值见 SOUND_GAIN）。 */
const SOUND_FILES = ['go_stone_0.wav', 'go_stone_1.wav', 'go_stone_2.wav', 'go_stone_3.wav', 'go_stone_4.wav'];
/* 每个音效的音量：按实测 RMS 归一（基准 0.85 = RMS 11.3% 的那个）。
   实测值 RMS%：0→8.4  1→11.3  2→10.9  3→9.4  4→10.9
   0 和 3 比基准轻，补到 1.0 封顶（真值 1.14 / 1.02，封顶后仍比其余略轻一点，可接受）。 */
const SOUND_GAIN = [1.0, 0.85, 0.88, 1.0, 0.88];
const SOUND_COPIES = 3;                 // 每种 3 个副本 → 连点也不会撞上正在播的
const SOUND_POOL = [];
SOUND_FILES.forEach((f, i) => {
  for (let k = 0; k < SOUND_COPIES; k++) {
    const a = new Audio('../assets/audio/' + f);
    a.volume = SOUND_GAIN[i] === undefined ? 0.85 : SOUND_GAIN[i];
    a.preload = 'auto';
    SOUND_POOL.push({ el: a, file: i });
  }
});
let lastSoundFile = -1;

function playStoneSound() {
  if (!state.soundOn || !SOUND_POOL.length) return;
  /* 优先挑「没在播」的副本；极端连点导致全在播时，才退而用全部（概率极低） */
  const free = SOUND_POOL.filter(x => x.el.paused || x.el.ended);
  let pool = free.length ? free : SOUND_POOL;
  /* 别和上一手用同一个音效（同一个文件听着会腻） */
  const other = pool.filter(x => x.file !== lastSoundFile);
  if (other.length) pool = other;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lastSoundFile = pick.file;
  try { pick.el.currentTime = 0; pick.el.play().catch(() => { }); } catch (e) { /* 出声失败不打断对局 */ }
}

/* ---------------- 对局计时 ---------------- */

/* 档位按**真实赛事**定（2026 现役）：
   围甲 / 三星杯 / 烂柯杯 = 每方 2 小时 + 5×60 秒读秒；
   应氏杯 / LG 杯 / 梦百合杯 = 每方 3 小时（LG 是 5×40 秒读秒）。
   注意围棋用「读秒」（每次 N 秒、共 M 次，用完再超时才判负），
   不是国际象棋那种每手加时 —— 只有超快棋那档用「每手加时」。 */
const CLOCK_PRESETS = {
  none:  { label: '不限时' },
  blitz: { label: '超快棋',   main: 300,   add: 5 },
  rapid: { label: '快棋',     main: 1800,  byo: 30, byoN: 3 },
  slow:  { label: '慢棋',     main: 3600,  byo: 60, byoN: 5 },
  pro:   { label: '职业赛',   main: 7200,  byo: 60, byoN: 5 },
  world: { label: '世界大赛', main: 10800, byo: 60, byoN: 5 },
};

/* 双方名字：人机对弈 → 人 PLAYER / AI KATAGO；摆棋（等于本地双人）→ PLAYER1 / PLAYER2 */
/* 没设过名字时的默认叫法（按模式区分） */
function defaultName(color) {
  if (settings.mode === 'free') return color === 'b' ? 'PLAYER1' : 'PLAYER2';
  return color === state.myColor ? 'PLAYER' : 'KATAGO';
}

/* 右侧显示的名字：用户改过的 / 棋谱带来的 优先，都没有才回落到默认。
   ★ 名字**和计时无关** —— 不计时也要显示、也要能改（原来它俩绑在一起：
     `renderClocks()` 一开头就是 `if (!c.on) return`，不限时那两行名字压根不会被更新）。 */
function clockName(color) {
  return (state.names && state.names[color]) || defaultName(color);
}

/* 把名字画到右侧两栏（读秒标记只在计时时叠加）。
   唯一改 cid-* 文本的地方 —— 正在改名（里面挂了 input）时跳过，别把用户正在打的字覆盖掉。 */
function renderNames() {
  const c = state.clock;
  for (const col of ['b', 'w']) {
    const el = $('cid-' + col);
    if (!el || el.querySelector('input')) continue;
    const name = clockName(col);
    let txt = name;
    if (c && c.on) {
      const d = clockDisplay(col);
      if (d.phase === 'byo') txt = name + ' · 读秒' + Math.max(0, d.n);
    }
    el.textContent = txt;
  }
}

/* 点名字就地改名（回车 / 失焦确认，Esc 取消）—— 像棋谱库的「备注」那样。
   改完立刻生效：右侧显示、导出棋谱写进 PB/PW 都用它。 */
function bindClockName(color) {
  const el = $('cid-' + color);
  if (!el) return;
  el.title = '点一下可以改这个名字（导出棋谱时会写进棋谱的双方名）';
  el.classList.add('editable');
  el.onclick = () => {
    if (el.querySelector('input')) return;
    const old = el.textContent;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 24;
    inp.value = (state.names && state.names[color]) || '';
    inp.placeholder = defaultName(color);
    let closed = false;
    const done = ok => {
      if (closed) return;
      closed = true;
      const v = ok ? inp.value.trim().slice(0, 24) : null;
      if (ok) {
        state.names[color] = v;
        /* ★ 必须把输入框**从 DOM 里摘掉**：renderNames 见到 el 里挂着 input 会跳过
           （免得覆盖用户正在打的字）—— 不摘掉的话名字栏会一直是空白。
           （实测踩过：state.names 明明存进去了，界面上却是空的。） */
        el.textContent = '';
        syncUI();                     // syncUI → renderNames 把新名字画上去
        /* ★★ 2026-10-12 修用户报的 bug：**名字要写回棋谱文件**。
           原来只写了内存里的 state.names —— 打谱时用户点名字改完，
           界面上变了、文件里没变，重开还是 PLAYER1/PLAYER2，改几次都白改。
           （唯一会落盘的那条路 saveToRecords 只在"下完棋点保存"时才走，
             打谱状态下根本不会触发。）
           ⚠️ 只改 PB/PW，不整份重写 —— 那份棋谱带着 GN 备注和 C[] 解说词，
             整份重写会把它们冲掉。 */
        if (state.recName) {
          window.api.records.setPlayers(state.recName, clockName('b'), clockName('w'))
            .then(r => flash(r && r.ok
              /* ★ 2026-10-13：写回现在按**原编码**走（GBK 棋谱仍是 GBK），
                 名字里有 GBK 装不下的字（emoji 之类）会被写成 ? —— 必须如实说，别默默改坏。 */
              ? ('棋手名已写进棋谱' + (r.enc === 'gbk' ? '（保持原编码 GBK）' : '')
                + (r.missing && r.missing.length
                  ? ' · 有 ' + r.missing.length + ' 个字 GBK 装不下，已写成 ?：'
                  + [...new Set(r.missing)].slice(0, 6).join('') : ''))
              : ('写棋谱失败：' + ((r && r.error) || '未知'))))
            .catch(() => {});
        }
      } else {
        el.textContent = old;
      }
    };
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { done(false); }
      e.stopPropagation();            // 别让输入框里的按键触发全局快捷键
    };
    inp.onblur = () => done(true);
    el.textContent = '';
    el.appendChild(inp);
    inp.focus();
    inp.select();
  };
}

function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function clockReset() {
  const P = CLOCK_PRESETS[settings.clock] || CLOCK_PRESETS.none;
  const c = state.clock;
  c.key = settings.clock;
  c.on = !!P.main;
  c.main = P.main || 0;
  c.byo = P.byo || 0;
  c.byoN = P.byoN || 0;
  c.add = P.add || 0;
  c.b = { t: c.main, n: c.byoN };
  c.w = { t: c.main, n: c.byoN };
  c.side = sideToMove(0);                    // 让子 / 座子局是白先
  c.phase = 'main';
  c.since = performance.now();
  c.running = c.on;
  c.expired = null;
  c.paused = false;                          // 新对局一定要解除「试下暂停」
  beepedSec = -1;                            // 读秒报时状态一并复位

  /* ★ 这里**不要**再写 `$('clock-card').hidden = !c.on` ——
     CSS 里 `.clock-card { display: flex }` 的特异性会把 `hidden` 的 display:none 顶掉，
     写了也没用（是个静默失效的写法）。而且**名字栏就住在计时卡里**，
     真的把它藏起来，不限时的时候就看不到双方名字了。
     所以 HTML 上那个 hidden 属性也已经删掉（2026-10-04 代码审查发现）。
     不计时时把时间显示成 --:--（见 renderClocks），别留着上一局的数字。 */
  renderClocks();      // 不计时时它会把时间位换成灰色占位 --:--（见 .ctime.off）
}

/* 落子后结算：扣掉本手用时，换对方 */
function clockSwitch() {
  const c = state.clock;
  if (!c.on || c.expired || c.paused) return;   // 试下（草稿）期间不走表
  const now = performance.now();
  const el = Math.max(0, (now - c.since) / 1000);
  const st = c[c.side];

  if (c.phase === 'main') {
    st.t = Math.max(0, st.t - el);
    if (c.add) st.t += c.add;               // 超快棋：每手加时
  }
  /* 读秒阶段不扣总时间 —— 读秒是「每手独立给 N 秒」 */

  c.side = c.side === 'b' ? 'w' : 'b';
  c.phase = c[c.side].t > 0 ? 'main' : 'byo';
  c.since = now;
  beepedSec = -1;             // 换手 → 读秒报时的「响过哪一秒」要重算，否则下一手不响
  renderClocks();
}

/* 悔棋 / 停一手 / 跳转时调用：重置本手起点，不结算（时间不倒退，规则如此） */
function clockTouch() {
  if (state.clock.on) state.clock.since = performance.now();
}

function clockDisplay(color) {
  const c = state.clock;
  const st = c[color];
  const isTurn = (color === c.side) && c.running && !c.expired
    && state.viewAt === state.moves.length;   // 回看历史手时暂停，不给双方扣时间
  const el = isTurn ? Math.max(0, (performance.now() - c.since) / 1000) : 0;
  if (st.t > 0) return { sec: Math.max(0, st.t - el), phase: 'main', n: st.n };
  if (c.byo > 0) return { sec: Math.max(0, c.byo - el), phase: 'byo', n: st.n };
  return { sec: 0, phase: 'main', n: st.n };
}

function renderClocks() {
  const c = state.clock;
  /* 不限时：时间位留一串**灰占位**（--:--，见 .ctime.off）让名字当主角，
     高度也和计时时一致（切换时不会跳）。名字栏是常显的，跟计时无关。 */
  if (!c.on) {
    for (const col of ['b', 'w']) {
      const t = $('ctime-' + col);
      if (t) { t.textContent = '--:--'; t.classList.add('off'); }
    }
    renderNames();
    return;
  }
  for (const col of ['b', 'w']) {
    const t = $('ctime-' + col);
    if (t) t.classList.remove('off');
  }
  [['b', 'clock-b', 'ctime-b'], ['w', 'clock-w', 'ctime-w']].forEach(([col, box, tm]) => {
    const d = clockDisplay(col);
    const bx = $(box);
    bx.classList.toggle('active', col === c.side && !c.expired);
    bx.classList.toggle('byo', d.phase === 'byo' && d.sec > 0);
    bx.classList.toggle('out', c.expired === col);
    $(tm).textContent = fmtClock(d.sec);
  });
  renderNames();      // 名字 + 读秒标记（每 tick 跟着走）
}

/* ★ 超时判负（2026-10-04 用户要求）——
   原来超时只 flash 一句「超时」就完事，棋局还能接着下，计时等于白设。
   统一走 doResign（by='timeout'），结果条会正常弹出。 */
function expireClock(side, reason) {
  const c = state.clock;
  if (c.expired) return;
  c.expired = side;
  c.running = false;
  doResign(side, 'timeout');
  renderClocks();
  flash((side === 'b' ? '黑方' : '白方') + '超时 · 判负（' + reason + '）');
  syncUI();
}

/* 读秒提示音：用 Web Audio **现场合成**一个短促的「滴」——
   不用音频素材（assets 里只有落子声），也不用联网。
   真实对局里裁判在最后 10 秒会一秒一念，这里照着做。 */
let beepCtx = null;
function playBeep() {
  if (!state.soundOn) return;                 // 跟落子音效共用底栏那个开关
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    beepCtx = beepCtx || new AC();
    if (beepCtx.state === 'suspended') beepCtx.resume();
    const t = beepCtx.currentTime;
    const o = beepCtx.createOscillator();
    const g = beepCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(beepCtx.destination);
    o.start(t); o.stop(t + 0.09);
  } catch (e) { /* 出不了声就不出，绝不能影响对局 */ }
}

/* 读秒最后 10 秒：每秒一声。同一秒只响一次（tick 是 250ms 一次，不判重会连响四声）。 */
let beepedSec = -1;
function maybeBeepSecond() {
  const c = state.clock;
  if (!c.on || !c.running || c.expired) { beepedSec = -1; return; }
  const d = clockDisplay(c.side);
  const sec = Math.ceil(d.sec);
  if (d.phase !== 'byo' || sec <= 0 || sec > 10) { beepedSec = -1; return; }
  if (sec === beepedSec) return;
  beepedSec = sec;
  playBeep();
}

function clockTick() {
  const c = state.clock;
  if (!c.on || !c.running || c.expired || c.paused) return;   // 试下（草稿）期间暂停
  const now = performance.now();
  const el = Math.max(0, (now - c.since) / 1000);
  const st = c[c.side];

  if (c.phase === 'main') {
    if (el >= st.t) {
      /* 主时间走完：有读秒就进读秒，**没读秒的直接判负**。
         （原来只写了「有读秒」那一半 —— 万一有 byo = 0 的档位，时间会停在 00:00
           既不进读秒也不判负，一直卡着。） */
      if (c.byo > 0) { st.t = 0; c.phase = 'byo'; c.since = now; }
      else { expireClock(c.side, '主时间用完，本局不读秒'); return; }
    }
  } else if (c.byo > 0) {
    if (el >= c.byo) {
      st.n -= 1;                                                    // 读秒一次用完，扣一次
      if (st.n < 0) { expireClock(c.side, '读秒次数已用尽'); return; }
      c.since = now;                                                // 还有次数 → 重新读一次
    }
  }
  renderClocks();
  maybeBeepSecond();        // 读秒最后 10 秒每秒一响
}

setInterval(clockTick, 250);

/* ---------------- 形势显示（ownership）----------------
   数据源：分析请求里 includeOwnership:true → 顶层 ownership 数组（长度 N*N，-1~+1）。
   **不增加搜索量**（引擎本来就在算），只多传几百个数。

   ★ 颜色按 KaTrain 实机截图定的（不是照抄配置，是**看着它的画面反推的**）：
     - 它的棋盘底色是暖木色，白雾 = **比底色更亮的暖白**，黑雾 = **深褐**（不是纯黑）
     - **几乎铺满整个盘面**：连接近中立的点也有很淡的色调，深浅表示归属强弱
     ⚠️ 别把「第一版整盘全是黑雾」归因到颜色上 —— **真因是符号搞反了**
        （ownership 是相对当前走棋方的，见上面那段），当时白雾被画成了黑雾。
        另有观感问题：硬边方块 + 中立点不画 → 盘面很碎，已由下面的「小贴图放大」解决。 */
/* ===== 形势显示：参数**照抄 KaTrain 的 Theme 默认值**（katrain/gui/theme.py）
   OWNERSHIP_COLORS = {B:[0,0,0.10,0.75], W:[0.92,0.92,1.0,0.80]}
   OWNERSHIP_GAMMA = 1.33 · BLOCKS_THRESHOLD = 0.3 · MARK_SIZE = 0.42 · STONE_MIN_ALPHA = 0.85

   ★★ 一条我判断错了、后来改回来的（用户质疑后重算，别重犯）：
      我一度认为「我们棋盘浅（当时 #f2dfba→#e9d3a8 米黄；**2026-10-04 已按用户拍板调深为
      #dfc48f→#d4b47c「中深」档，白雾色差 64→105**），KaTrain 的白雾(0.92,0.92,1.0)涂上去=没涂」，
      于是擅自把白雾改成淡天蓝。**这个推断是错的** —— 我只看了亮度，漏了色相：
          棋盘底色 B 通道 0.729，白雾 B 通道 1.00，α=0.8 叠加后 B=0.946 → **差 0.22，偏蓝很明显**。
      结论：**白雾照抄 KaTrain 原值，不做任何"适配"**。底色深浅不影响它可见。 */
const TERR_B = [0.0, 0.0, 0.10, 0.75];
const TERR_W = [0.92, 0.92, 1.0, 0.80];   // 照抄 KaTrain，不偏离
const TERR_GAMMA = 1.33;
const TERR_BLOCK_TH = 0.3;
const TERR_BLOCK_MARK = 0.42;
const TERR_STONE_MIN = 0.85;

/* 离屏贴图：做法完全照抄 KaTrain 的 draw_territory_color ——
   把 N×N 个归属值画成一张 **(N+2)×(N+2) 的小贴图**（外圈 alpha=0，让边缘平滑衰减），
   再一次性拉伸铺满棋盘。放大时由浏览器插值 → 得到**连续的雾**。
   ⚠️ 两个关键点，第一版都做错了：
     ① 必须比棋盘多 1 行/列（否则边缘是硬的）；
     ② alpha 直接取 |ownership|，**中立的点要完全透明** —— 我自己加过 A_MIN 铺底，
        结果整盘糊成一片。 */
let terrCv = null, terrCx = null, terrIm = null;

function drawTerritory() {
  const o = state.ownership;
  if (!state.showTerritory || !o || o.length !== N * N) return;

  const blocksMode = state.terrStyle === 'blocks';
  const W = N + 2;

  if (!terrCv) { terrCv = document.createElement('canvas'); terrCx = terrCv.getContext('2d'); }
  if (terrCv.width !== W) {
    terrCv.width = W; terrCv.height = W;
    terrIm = terrCx.createImageData(W, W);
  }
  const d = terrIm.data;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const gx = x - 1, gy = y - 1;
      const i = (y * W + x) * 4;
      if (gx < 0 || gx >= N || gy < 0 || gy >= N) { d[i + 3] = 0; continue; }   // 外圈透明
      const v = o[gy * N + gx];
      let a = Math.min(1, Math.abs(v));
      if (blocksMode) a = a > TERR_BLOCK_TH ? 1 : 0;
      a = Math.pow(a, 1 / TERR_GAMMA);          // Gamma 曲线（KaTrain 有，我第一版漏了）
      if (a <= 0) { d[i + 3] = 0; continue; }
      const col = v > 0 ? TERR_B : TERR_W;
      d[i] = (col[0] * 255) | 0;
      d[i + 1] = (col[1] * 255) | 0;
      d[i + 2] = (col[2] * 255) | 0;
      d[i + 3] = (a * col[3] * 255) | 0;        // 基础 alpha × 归属强度
    }
  }
  terrCx.putImageData(terrIm, 0, 0);

  ctx.save();
  /* blocks = 硬边方块（nearest）；雾 = 平滑插值（linear）—— 与 KaTrain 的 mag_filter 一致 */
  ctx.imageSmoothingEnabled = !blocksMode;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  /* 贴图第 (x+1) 个像素对应交叉点 x → 起点在棋盘左上一格半的地方 */
  const x0 = pad - gap * 1.5;
  ctx.drawImage(terrCv, x0, x0, gap * (N + 2), gap * (N + 2));
  ctx.restore();
}

/* 画形势。画在棋盘线之上、棋子之下（子压在上层不受影响）。
   ⚠️ 这里曾出现「同一个函数定义了两遍」——后定义的会覆盖先定义的，
      导致改了半天不生效。改这类函数后务必 grep 一遍函数名，确认只有一处。 */

/* 棋子上的形势叠加 —— 公式照抄 KaTrain 的 draw_stone：
     这块地归它（player == owner）→ alpha = MIN + (1-MIN)×|ownership|（归属越强越实）
     不是它的地          → alpha = MIN（固定最低，也就是"死子"）
   TERR_STONE_MIN = 0.85 也照抄 KaTrain（我起初用 0.5，太夸张、会让人误以为已经提掉了）。 */
function stoneAlphaAt(x, y, stone) {
  if (!state.showTerritory || state.terrStyle !== 'fog') return 1;
  const o = state.ownership;
  if (!o || o.length !== N * N) return 1;
  const v = o[y * N + x];
  const owner = v > 0 ? 1 : -1;              // 1 = 黑占优 / -1 = 白占优
  /* ★★ 2026-10-06 审查发现：传进来的 `stone` 是**棋盘数组的值**（1=黑、2=白），
     而 owner 是 **±1** 的约定 —— 必须先把 stone 也换成 ±1 再比。
     原来直接写 `stone === owner`：白棋是 2，永远不等于 -1，
     于是**所有白子在形势雾里都被当成死子、一直画成半透明**（黑棋却正常）。
     一直没人报，是因为它看起来像"雾的样式"。 */
  const mine = stone === 1 ? 1 : (stone === 2 ? -1 : 0);
  if (mine === owner) return TERR_STONE_MIN + (1 - TERR_STONE_MIN) * Math.abs(v);
  return TERR_STONE_MIN;
}

/* 变化图（PV）：鼠标在推荐点上停 1 秒 → 把「这一手之后预计会怎么走」画在盘上。
   画成**半透明棋子 + 序号**，压在真棋子之上（它是假设，不是盘面，所以用透明度区分）。
   数据来自引擎给每个候选点的 pv（主进程只透传前 8 手）。 */
function drawPV() {
  const P = state.pv;
  if (!P || !P.list || !P.list.length) return;
  const b = boardAt(state.viewAt);
  const first = sideToMove(state.viewAt);     // pv 第 1 手的落子方（= 现在该谁走）
  const seen = new Set();
  let n = 0;                                   // 画出来的序号（1 开始）
  P.list.forEach((mv, k) => {
    const pt = fromGTP(mv);
    if (!pt) return;                           // pass 或不认识的坐标
    if (k === 0 && pt.x === P.x && pt.y === P.y) return;   // pv[0] 通常就是这个推荐点本身，它已有标记，别重复画
    const key = pt.x + ',' + pt.y;
    if (seen.has(key)) return;
    seen.add(key);
    /* 盘上已有子的点跳过（PV 里提子后重下的情况）—— 盖在真子上反而看不清 */
    if (b[idx(pt.x, pt.y)] !== 0) return;
    const [cx, cy] = pxOf(pt.x, pt.y);
    /* 落子方按 pv 里的位置 k 定（k=0 是该走的一方），不要用 n —— 跳过第一个不影响手顺 */
    const isB = (k % 2 === 0) ? (first === 'b') : (first !== 'b');
    ctx.globalAlpha = 0.66;
    drawStone(cx, cy, isB ? 'b' : 'w');
    ctx.globalAlpha = 1;
    n++;
    ctx.fillStyle = isB ? '#f2f2f2' : '#1b1b1a';
    ctx.font = `bold ${Math.max(8, gap * 0.34).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), cx, cy + gap * 0.01);
  });
}

/* 变化图「现在该不该画」—— 所有条件集中在这里，draw() 和测试都用它。
   ★ 刻意不要求「那个点还在推荐列表里」：分析每隔几秒出一批新候选，列表会换人，
     若要求它还在列表里，变化图会在你看的时候**闪掉**（实测踩过）。
     局面没变（candAt === viewAt）时，这个变化图依然有效。
   ★ 也刻意**不依赖 mouseleave 事件**：鼠标不在那儿了，条件自然不成立 ——
     只靠事件清理的话，窗口失焦/事件被吞都会留下残影。 */
function pvVisible() {
  const P = state.pv;
  if (!P) return false;
  if (!state.showPV || !state.showHints) return false;
  if (settings.mode === 'play' && !isMyTurn()) return false;      // 和推荐点同一套规则
  if (!hover || hover.x !== P.x || hover.y !== P.y) return false; // 鼠标得还停在那儿
  return state.candAt === state.viewAt;                           // 局面没变（变了就作废）
}

/* 变化图的触发：鼠标停在**推荐点**上满 1 秒才显示。
   为什么要等 1 秒：鼠标扫过棋盘时会一路经过候选点，立刻显示的话屏幕上会一直闪东西。
   （用户 2026-10-04 明确要求「悬停在推荐点上保持 1 秒然后显示后续变化」） */
function updatePV() {
  clearTimeout(pvTimer); pvTimer = null;
  /* 人机对弈时只在轮到我方才显示 —— 和推荐点同一套规则，
     否则你刚落子、AI 还没走，画面上会冒出「对手该怎么下」的变化。 */
  const allowed = state.showPV && (settings.mode !== 'play' || isMyTurn());
  const c = (allowed && hover)
    ? state.candidates.find(k => k.x === hover.x && k.y === hover.y)
    : null;
  if (!c || !c.pv || c.pv.length < 2) {
    if (state.pv) { state.pv = null; draw(); }
    return;
  }
  if (state.pv && state.pv.x === c.x && state.pv.y === c.y) return;   // 已经在显示这个点了
  state.pv = null;                                                    // 换点了：先收掉旧的
  pvTimer = setTimeout(() => {
    state.pv = { x: c.x, y: c.y, list: c.pv };
    draw();
  }, 1000);
}

/* ---------------- 胜率走势 / 手数列表 ---------------- */

/* 走势曲线有两种纵轴（用户 2026-10-04 拍板「两种都给，加切换」）：
     · win  = 黑方胜率（0~100%），50% 那条虚线是「均势」
     · lead = 黑方领先目数（正 = 黑优），0 那条线是「均势」
   ★ 视角固定为**黑方** —— 引擎给的原始值是「轮到走棋那一方」的，
     照它画每落一手曲线就要上下翻一次，没法看；统一成黑方才连得成一条线。
   ★ 两种都**按本局实际范围自适应量程**：否则一盘势均力敌的棋，曲线会全挤在
     均势线附近，看不出"这一手亏了多少"（实测九个点只占屏幕高度的 5%）。
   ★ 量程自适应之后**必须把范围标出来**（右上角那行）—— 否则会被误读成
     "每盘都这么激烈"：一盘一路碾压的棋铺满之后看着也很刺激，
     但右上角会老老实实写着"全程 85% ~ 96%"。 */
function renderCurve() {
  const cv = $('curve');
  const w = cv.clientWidth || 268, h = cv.clientHeight || 76;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const isLead = state.curveMode === 'lead';
  const src = isLead ? state.leads : state.history;
  const pT = 14, pB = 14, pL = 30, pR = 5;     // 上下各留一行：左上角写模式、右上角写量程
  const W = Math.max(1, w - pL - pR), H = Math.max(1, h - pT - pB);

  /* 左上角：这图画的是哪条轴（**视角是黑方**，必须写出来） */
  c.font = '9px "Microsoft YaHei", sans-serif';
  c.fillStyle = 'rgba(0,0,0,.38)';
  c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(isLead ? '黑方领先（目）' : '黑方胜率', 2, 1);

  const sg = v => (v > 0 ? '+' : (v < 0 ? '\u2212' : '')) + Math.abs(v).toFixed(1);

  /* 有数据的手数范围 —— 没数据的地方不占宽度 */
  const idx = Object.keys(src).map(Number)
    .filter(i => typeof src[i] === 'number').sort((a, b) => a - b);

  if (!idx.length) {
    c.fillStyle = 'rgba(0,0,0,.26)';
    c.font = '11px "Microsoft YaHei", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText((isLead && Object.keys(state.history).length)
      ? '没有目差数据 · 重新复盘一次就有了'
      : (state.noGame ? '还没有对局' : '逐手走一遍就会画出来'), w / 2, pT + H / 2);
    return;
  }

  /* 量程 = 本局实际范围 + 12% 余量；跨度太小时撑到最小跨度，
     免得一两个点的正常抖动被放大成"剧烈起伏"（胜率最小 22 个百分点、目差最小 6 目）。 */
  const vals = idx.map(i => src[i]);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  const minSpan = isLead ? 6 : 0.22;
  if (mx - mn < minSpan) { const m0 = (mx + mn) / 2; mn = m0 - minSpan / 2; mx = m0 + minSpan / 2; }
  const pad = (mx - mn) * 0.12;
  let lo = mn - pad, hi = mx + pad;
  if (!isLead) { lo = Math.max(0, lo); hi = Math.min(1, hi); }   // 胜率不越出 0~100%

  const i0 = idx[0], i1 = idx[idx.length - 1];
  const X = i => pL + (i1 <= i0 ? W / 2 : W * ((i - i0) / (i1 - i0)));
  const Y = v => pT + H - H * ((v - lo) / (hi - lo));
  const MID = isLead ? 0 : 0.5;                                   // 「均势」线

  /* 右上角：本局量程（自适应之后必须标出来，否则会被误读） */
  c.fillStyle = 'rgba(0,0,0,.38)';
  c.textAlign = 'right'; c.textBaseline = 'top';
  c.fillText(isLead
    ? (sg(lo) + ' ~ ' + sg(hi) + ' 目')
    : (Math.round(lo * 100) + '% ~ ' + Math.round(hi * 100) + '%'), w - 2, 1);

  /* 均势线（胜率 50% / 目差 0）+ 左侧标注 */
  if (MID >= lo && MID <= hi) {
    const ym = Y(MID);
    c.strokeStyle = 'rgba(0,0,0,.14)';
    c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(pL, ym); c.lineTo(pL + W, ym); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(0,0,0,.32)';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('均势', 2, ym);
  }

  const pts = idx.map(i => [i, src[i]]);

  /* 面积 + 折线 */
  c.beginPath();
  pts.forEach(([i, v], k) => { const x = X(i), y = Y(v); if (k) c.lineTo(x, y); else c.moveTo(x, y); });
  c.strokeStyle = '#2f6f5e';
  c.lineWidth = 1.6;
  c.stroke();
  c.lineTo(X(pts[pts.length - 1][0]), pT + H);
  c.lineTo(X(pts[0][0]), pT + H);
  c.closePath();
  c.fillStyle = 'rgba(47,111,94,.13)';
  c.fill();

  /* 单点也画个圆点，否则看不出有数据 */
  if (pts.length === 1) {
    c.beginPath(); c.arc(X(pts[0][0]), Y(pts[0][1]), 2.4, 0, 7);
    c.fillStyle = '#2f6f5e'; c.fill();
  }

  /* 复盘的失误点：标在曲线上，一眼看出哪几手掉得多（≥1.5 目）。
     两种模式标的**是同一手**，只是纵轴值换成当前模式的那条数据。 */
  if (state.review) {
    for (let t = 0; t < state.review.losses.length; t++) {
      const v = state.review.losses[t];
      if (typeof v !== 'number' || v < 1.5) continue;
      const i = t + 1;                                   // 第 t+1 手
      if (i < i0 || i > i1) continue;
      const hv = src[i];
      if (typeof hv !== 'number') continue;
      c.beginPath();
      c.arc(X(i), Y(hv), v >= 6 ? 3.4 : 2.4, 0, 7);
      c.fillStyle = v >= 12 ? '#8e1b0f' : (v >= 6 ? '#c0392b' : '#e08a2e');
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.85)';
      c.lineWidth = 1;
      c.stroke();
    }
  }

  /* 当前看的那一手 */
  if (state.viewAt >= i0 && state.viewAt <= i1) {
    c.strokeStyle = 'rgba(198,64,44,.5)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(X(state.viewAt), pT); c.lineTo(X(state.viewAt), pT + H); c.stroke();
  }

  /* 底部标**手数**刻度 */
  c.fillStyle = 'rgba(0,0,0,.5)';
  c.font = '9px "Microsoft YaHei", sans-serif';
  c.textBaseline = 'top';
  const ticks = (i0 === i1) ? [i0] : [i0, Math.round((i0 + i1) / 2), i1];
  ticks.forEach((v, k) => {
    c.textAlign = k === 0 ? 'left' : (k === ticks.length - 1 ? 'right' : 'center');
    c.fillText(String(v) + '手', X(v), pT + H + 3);
  });
}

let lastScrolledAt = -1;      // 列表上次自动滚到的手数（免得边算边刷时反复把用户拽回来）

function renderMoveList() {
  const ul = $('movelist');  const total = state.moves.length;
  if (!total) { ul.innerHTML = '<li class="empty">还没有落子</li>'; return; }

  /* ★★ 坑位 39（2026-10-13 审查补）：主变链一次算好。
     复盘的「目损」是**按手号**存在 `state.review.losses` 上的，只覆盖跑复盘时那一条线（主线），
     而它**不在**段② 那三套寄/还原里（`_an` 评估 / `_ex` 讲解 / `_sc` 解说词）——
     切到旁支后 `losses[i]` 取到的仍是主线第 i+1 手的数字，会被挂到旁支这一手上（错数据）。
     段③ 新加的 `loadReviewForRecord` 让「一打开棋谱就有复盘数」，
     于是这条从「跑过复盘才见」放大成「打开就可见」。
     口径照作者自己在树浮层里写的那句：**宁缺勿假** —— 不在主变链上的手不取复盘目损，
     让它回落到「胜率涨跌」列（那一列走 `_an` 寄/还原，跟着分支走，是对的）。
     用 Set 而不是每行调 `onMainline()`：本函数每次 syncUI 都跑，300 手时别做 O(n²)。 */
  ensureBranch();
  const mainSet = new Set();
  for (let cur = branchRoot && branchRoot._cs && branchRoot._cs[0]; cur; cur = cur._cs && cur._cs[0]) mainSet.add(cur);

  let html = '';
  for (let i = 0; i < total; i++) {
    const m = state.moves[i];
    const side = m.color === 'b' ? '黑' : '白';
    const pt = m.pass ? '停一手' : GTP_COLS[m.x] + (N - m.y);

    /* 右侧标记：有复盘数据就显示**目损**（比胜率涨跌直观，且是我们逐手算出来的）；
       没有复盘数据时退回「胜率涨跌 %」。
       ★ 草稿手（回看进试下后新下的那些）两个都不取：`losses[i]` 是**正式棋谱第 i+1 手**
       的目损，而草稿的 i+1 手是另一盘内容，照取就是错挂（2026-10-13）。 */
    let dl = '';
    const isDf = state.draft && (i + 1) > state.draft.from;
    const rvLoss = (state.review && !isDf && mainSet.has(m)) ? state.review.losses[i] : null;
    if (typeof rvLoss === 'number') {
      const lv = lossLevel(rvLoss);
      const t = '这一手亏 ' + rvLoss.toFixed(1) + ' 目' + (lv ? '（' + lv.label + '）' : '');
      dl = rvLoss < 0.05
        ? '<span class="dl rv-ok" title="' + t + '">0</span>'
        : '<span class="dl ' + (lv ? 'rv-' + lv.cls : '') + '" title="' + t + '">−' + rvLoss.toFixed(1) + '</span>';
    } else {
      /* 这一手让「下棋方」的胜率变化了多少（黑方胜率下降 = 白棋走得好）
         ★ 必须等这一手**算准了**才显示数字（evalSettled）。
           否则刚落子那 0.3 秒的粗算值会先摆出来，过一会儿又变成收敛值 ——
           用户看到的就是「数字自己跳」。没算准就先显示「…」。 */
      const h = state.history[i + 1], prev = state.history[i];
      if (typeof h === 'number' && typeof prev === 'number' && evalSettled(i + 1)) {
        const d = (h - prev) * 100 * (m.color === 'b' ? 1 : -1);
        if (Math.abs(d) >= 0.05) {
          dl = `<span class="dl ${d < 0 ? 'bad' : ''}">${d > 0 ? '+' : ''}${d.toFixed(1)}%</span>`;
        }
      } else if (typeof h === 'number' && !evalSettled(i + 1)) {
        /* 还在算 → 给个占位，让用户知道这里会有数字（不是坏了） */
        dl = '<span class="dl calc" title="这一手还在算，算准了才显示涨跌">…</span>';
      }
    }
    /* 试下（草稿）里下的手单独标出来 —— 免得过一会儿忘了自己在草稿里 */
    const isDraft = state.draft && (i + 1) > state.draft.from;
    /* ★ 手数分支（2026-10-13）：这一手有别的走法（旁支）就在行上标出来，↑/↓ 切换。
       判据是「它的父亲下有几个孩子」—— 列表只显示当前路径，所以只能靠这种标记告诉用户
       「这里其实岔开了，另一条线不在列表上」（完整的水平分叉树面板是下一步）。 */
    const bi = branchInfoOf(i);
    const brTag = bi.n > 1
      ? '<span class="br" title="这一点共 ' + bi.n + ' 种走法，现在看的是第 ' + (bi.idx + 1) + ' 种 —— ↑/↓ 换分支">⑂' + (bi.idx + 1) + '/' + bi.n + '</span>'
      : '';
    html += `<li data-n="${i + 1}" class="${state.viewAt === i + 1 ? 'cur' : ''}${isDraft ? ' draft' : ''}">`
      /* ★ 坑位 40（2026-10-13 审查补）：草稿手**不走** `moveLabelOf` —— 那函数按 `_p` 往根数深度，
         而草稿手是段② 定的「不挂树」裸节点（`_p: null`）→ 数出来恒为 0。
         实测：主线 5 手后进试下再下两手，列表显示 `1 2 3 4 5 0 0`（任务 2 之前这里是 `i+1`，
         显示 6、7 是对的 —— 属本次引入的回归，断言 ⑭ 没测草稿场景所以漏了）。
         草稿手本来就不属于任何分支，用绝对手号才是它该有的语义。 */
      + `<span class="no">${isDf ? (i + 1) : moveLabelOf(m)}</span><span class="st">${side}</span>`
      + `<span class="pt">${pt}</span>`
      + (isDraft ? '<span class="dft">草</span>' : '')
      + brTag
      + dl + '</li>';   // 「涨跌」靠 margin-left:auto 顶到最右，所以草稿标记要放它前面
  }
  ul.innerHTML = html;
  ul.querySelectorAll('li[data-n]').forEach(li => {
    li.onclick = () => gotoView(+li.dataset.n);
  });

  /* 当前那一手滚进可视区（只在「看的那手」变化时滚，免得边算边刷新时一直把用户拽回来） */
  const cur = ul.querySelector('li.cur');
  if (cur && lastScrolledAt !== state.viewAt) {
    cur.scrollIntoView({ block: 'nearest' });
    lastScrolledAt = state.viewAt;
  }
}

/* ---------------- 解说词框（棋谱自带的 C[]，2026-10-06 用户要求） ----------------
   参照 MultiGo 的那个框：显示**当前看着的这一手**在棋谱文件里写的解说。
   数据来自 parseSGF 交出来的 comments（**只取主分支** —— 我们不做分支树，用户定的）。
   编辑：直接改棋谱文件里那一个 C[]（见 patchSGFComment），第一次覆盖前会留 .bak。 */

/* 「第几题 / 共几题」的提示文字（2026-10-06）。
   ★ 放在**顶栏状态行**里，不做成浮层 —— 实测棋盘四周只有 3px（上方）/
     34px（左右）的空隙，任何浮层都会盖住棋盘；而顶栏本来就写着「第 N 手」，
     题号跟它是同一类信息，凑在一起最自然，还不占额外地方。

   一份题集会把多道题串在一个 SGF 里，用 `zz` 标记分界（实测抽样 3000 份里 2.97% 的文件有，
   全库 21433 份里 538 份）。我们**只显示位置，不做切换**：
   「跳到第 3 题」是另一个功能（要改手数范围、改引擎请求、改历史），
   做一半只会让人以为能点、点了没反应。 */
function quizPos() {
  const seps = state.quizTips || [];
  if (seps.length < 1) return null;
  const at = state.viewAt;
  let n = 1;
  for (const s of seps) if (at >= s) n++;          /* 分界那一手就归下一题（>= 不是 >） */
  return { n, total: seps.length + 1 };
}
/* 顶栏里用的一段文字；不是题集就返回空串 */
function quizTxt() {
  if (state.noGame) return '';
  const q = quizPos();
  if (!q || q.total < 2) return '';
  return ` · ${q.total === 2 ? '第 ' + q.n + ' 题（共 2 题）' : '第 ' + q.n + ' 题 / 共 ' + q.total + ' 题'}`;
}

function renderCommentBox() {
  const box = $('cbox');
  if (!box) return;
  /* 正在编辑时**不要**覆盖用户的输入 —— syncUI 会频繁调用本函数 */
  if (box.querySelector('textarea')) return;

  /* ★★ 试下（草稿）期间不显示解说词，也不许编辑（2026-10-13 加「回看能试下」时定的口径）。
     为什么：解说词按**手号**存在原棋谱上（state.sgfComments[at]），而回看进试下后
     主线被截到草稿点、from 之后落的全是草稿手 —— 草稿的「第 51 手」和棋谱里的
     「第 51 手」不是同一手，照常显示会把别的手的解说词错挂上来；
     这时候点保存更会把草稿手的文字写进正式棋谱的第 51 手位置。
     所以草稿期间整框换成一句提示，退出试下（快照还原手号重新对齐）自然恢复。 */
  const btn = $('cbox-edit');
  if (state.draft) {
    btn.disabled = true;
    btn.title = '试下（草稿）期间不能改解说词 —— 草稿的手不属于这份棋谱';
    $('cbox-at').textContent = '（棋谱自带）';
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.textContent = '试下（草稿）期间不显示解说词；退出试下后恢复。';
    box.replaceChildren(ph);
    return;
  }

  const at = state.viewAt;
  const list = state.sgfComments || [];
  /* ★ 棋谱说明（根节点那段文字）：在「开局前」这一档显示。
     它不属于任何一手 —— 实测抽样 300 份真实棋谱里 116 份（38%）有这段。
     以前它和「第 0 手」共用 comments[0] 这个键，被后面那一手覆盖掉 → 整段读不出来。 */
  const rootTxt = at === 0 ? String(state.rootComment || '') : '';
  const txt = rootTxt || (list[at] || '');
  const canEdit = !!state.fromRecord && !!state.recName;
  btn.disabled = !canEdit;
  btn.title = canEdit
    ? (rootTxt ? '改这段棋谱说明（存回这份棋谱文件；第一次改会先留一份 .bak 备份）'
               : '改这一手的解说词（存回这份棋谱文件；第一次改会先留一份 .bak 备份）')
    : (rootTxt ? '只有「打开棋谱」时才能改棋谱说明' : '只有「打开棋谱」时才能改解说词');
  $('cbox-at').textContent = state.noGame ? '（棋谱自带）'
    : (at === 0 ? (rootTxt ? '（开局前 · 棋谱说明）' : '（开局前）') : '（第 ' + at + ' 手）');

  if (txt) { box.textContent = txt; return; }
  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = state.noGame
    ? '打开一份棋谱后，这里显示棋谱里自带的解说词。'
    : (canEdit ? '这一手没有解说词 —— 点「编辑」可以补上。' : '这一手没有解说词。');
  box.replaceChildren(ph);
}

/* 点「编辑」→ 就地变成输入框（保存/取消） */
/* 退出解说词编辑态。
   ★ 这个函数是 2026-10-06 补的：原来「取消」按钮直接调 renderCommentBox()，
     而 renderCommentBox 开头有一句「正在编辑（框里有 textarea）就别动它」
     —— 于是取消时 textarea 还在框里，第一行就 return，**永远退不出去**。
     翻手也救不了（syncUI 走的同一个函数）。用户报「点编辑后退不出去」，实测确认：
     连点、翻手都不行；而保存失败那条路会保留输入，本意是让人改完再存，
     结果也因为退不出去而变成卡死。

     所以「退出」必须有自己的一条路：**先把 textarea 拆掉，再让 render 重画**。 */
function exitCommentEdit() {
  const box = $('cbox');
  if (!box) return;
  const ta = box.querySelector('textarea');
  if (ta) box.removeChild(ta);
  const bar = box.querySelector('button');      // 保存/取消那一行
  if (bar && bar.parentElement === box) box.removeChild(bar.parentElement);
}

function editComment() {
  const box = $('cbox');
  const at = state.viewAt;
  if (box.querySelector('textarea')) return;
  if (!state.fromRecord || !state.recName) { flash('只有打开棋谱时才能改解说词'); return; }

  /* ★ 「开局前」这一档：如果这份棋谱有根节点说明，那这里改的就是**棋谱说明**
     （它不属于任何一手，onclick 里会走 patchSGFComment(text, -1, …)）。 */
  const isRoot = at === 0 && !!String(state.rootComment || '').trim();

  const ta = document.createElement('textarea');
  /* ★ 显示给用户的这份也统一成 CRLF 口径，跟磁盘上的文件一致 ——
     以前这里是 `list[at]` 原样（文件里的 CRLF），而保存时 textarea 已经把它
     规范成 LF 了，改一次就把文件里那处 CRLF 变成 LF。 */
  ta.value = nlForSGF(isRoot ? state.rootComment : ((state.sgfComments || [])[at] || ''));
  ta.placeholder = isRoot
    ? '写点这段棋谱的说明…（例如出处、这是第几图、谁整理的；留空 + 保存 = 删掉这段）'
    : '写点这一手的解说…（留空 + 保存 = 删掉这一手的解说词）';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex:none';
  const ok = document.createElement('button');
  ok.textContent = '保存'; ok.className = 'primary'; ok.style.height = '24px';
  const no = document.createElement('button');
  no.textContent = '取消'; no.style.height = '24px';
  bar.append(ok, no);
  box.replaceChildren(ta, bar);
  ta.focus();
  /* ★ Esc = 取消（用户习惯，也多一条出路）。
     注意必须 preventDefault + stopPropagation：全局那个 keydown 监听器里
     有一条「弹窗开着就一律不响应」，但解说词框不是弹窗，事件会穿过去 ——
     不拦住的话按 Esc 还会顺手把别的东西关了。 */
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    exitCommentEdit();
    renderCommentBox();
  });

  no.onclick = () => { exitCommentEdit(); renderCommentBox(); };
  ok.onclick = async () => {
    ok.disabled = true;
    const r = await saveComment(at, ta.value.trim(), isRoot);
    if (r && r.error) {
      /* ★ 保存失败时**不能**把用户输入清掉（他还要改），
         但也不能把他锁死在编辑态里 —— 那正是原来的 bug。
         所以这里给个「放弃修改」的出路：换掉按钮含义、让他能直接走出去。 */
      flash('保存失败：' + r.error + '（改完再点「保存」，或点「放弃修改」离开）');
      no.textContent = '放弃修改';
      ok.disabled = false;
      return;
    }
    exitCommentEdit();
    flash((isRoot ? '棋谱说明' : '解说词') + '已存回棋谱'
      + (isRoot ? '' : '（第 ' + at + ' 手）') + ((r && r.note) ? r.note : ''));
    renderCommentBox();
  };
}

/* 把这一手（或根节点说明）的解说词写回棋谱文件 */
async function saveComment(at, text, isRoot) {
  /* ★★ 段②（2026-10-13）：旁支的解说词现在**能**写回原文件了。
     原来这里是「旁支一律拒绝」——因为落刀靠主线扁平口径，旁支会盖到主线那一手上。
     现在改走 `patchSGFCommentAtNode`（按节点上的 `_sgfIdx` 定位），
     主线与旁支一视同仁，那条守卫随之撤掉。
     根节点说明仍走老入口：它不属于任何一手，没有 `_sgfIdx`。 */
  const rd = await window.api.records.read(state.recName);
  if (!rd || rd.error) return { error: (rd && rd.error) || '读不到这份棋谱' };
  const patched = isRoot
    ? patchSGFComment(rd.text, -1, text)
    : patchSGFCommentAtNode(rd.text, state.moves[at - 1], text);
  if (patched.error) return { error: patched.error };
  const w = await window.api.records.save(state.recName, patched.text);
  if (w && w.error) return { error: w.error };
  if (isRoot) {
    /* 磁盘上写的是 CRLF 口径（见 nlForSGF），内存里这份也保持一致 */
    state.rootComment = text ? nlForSGF(text) : '';
  } else {
    if (!state.sgfComments) state.sgfComments = [];
    /* 存进内存的这份也用 CRLF 口径，跟磁盘上的保持一致 */
    if (text) state.sgfComments[at] = nlForSGF(text); else delete state.sgfComments[at];
  }
  /* ★ 如实回报两件用户该知道的事（2026-10-06）：
       ① 文件原本是 GBK 还是 UTF-8 —— 我们按原编码写回的，不改用户文件的口径；
       ② GBK 里没有的字（比如 emoji）会被写成 '?'，必须告诉用户，否则他
          以为存进去了、换个软件打开发现少字却不知道是谁弄丢的。 */
  let note = '';
  if (w && w.enc === 'gbk') {
    note = '（按原文件的 GBK 编码存回）';
    if (w.missing && w.missing.length) {
      note += ' · ★ 有 ' + w.missing.length + ' 个字符 GBK 装不下，已写成 ?：' +
        [...new Set(w.missing)].slice(0, 6).join('');
    }
  }
  return { ok: true, note };
}

$('cbox-edit').onclick = editComment;



/* 用 e.code 判断，不用 e.key —— 中文输入法下字母键的 key 会变（本项目踩过同源的坑）。
   焦点在输入控件里时一律不拦截，免得选难度时按空格出意外。 */
window.addEventListener('keydown', e => {
  /* ★★ Ctrl+Shift+D：分析链路自检 —— 必须放在下面那道 `if (e.ctrlKey)` **之前**！
     2026-10-07 踩到：原来把它写在下面的 `switch (e.code)` 里（还特意写在裸 `case 'KeyD'`
     试下**前面**），但忘了 Ctrl 组合在更上面就被拦下了：
         if (e.ctrlKey || e.metaKey) { if (KeyZ) 悔棋; return; }   ← 这里就 return 了
     于是那个 case 是**死代码**，用户在卡住时按 Ctrl+Shift+D 一点反应都没有
     （而他正是最需要这个自检的时候）。教训：**判断快捷键能不能到达，要看整条
     早期 return 链，不能只看 switch 内部的顺序。**
     ⚠️ 这个判断要放在「输入框里不拦截」那道检查**之前** ——
        用户很可能正点着「计算深度」之类的控件，那时焦点就在输入控件上。 */
  /* ★★ Ctrl+Shift+Z：撤销「删除分支」（段② 的回收站，2026-10-13）。
     ⚠️ 必须放在下面 `if (e.ctrlKey || e.metaKey)` 那道**之前** —— 那里只认 KeyZ、
     不看 shiftKey，于是 Ctrl+Shift+Z 会被当成**悔棋**悄悄执行掉（与上面的 Ctrl+Shift+D 同一个坑：
     **判断快捷键能不能到达，要看整条早期 return 链**）。 */
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyZ') {
    e.preventDefault();
    undoDeleteBranch();
    return;
  }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
    e.preventDefault();
    const cur = state.viewAt, n = state.moves.length;
    flash('分析自检·局面: ' + n + '手·看第' + cur + '手'
      + '·选点: ' + (state.candAt < 0 ? '还没算过' : ('第' + state.candAt + '手算的, 差' + (cur - state.candAt)))
      + '·搜索量: ' + state.rootVisits
      + '·请求: ' + (anaBusy ? '在跑' : '空闲')
      + (anaQueue.length ? ('·欠账' + anaQueue.length + '手') : '')
      + (anaForceCur ? '·待重算' : '')
      + (state.noGame ? '·未开局' : '')
      + (scoreBusy ? '·数子中' : '')
      + (reviewBusy ? '·复盘/讲解中' : '')
      + '·引擎: ' + (engineReady ? '就绪' : (engStates.analyze === 'loading' ? '加载中' : '未就绪'))
      + (anaTimeouts ? ('·超时' + anaTimeouts + '次') : '')
      + '·链路: 轮' + anaDiag.start + '/成功' + anaDiag.okCount + '/空跑' + anaDiag.failOnce
      + (anaDiag.lastFailWhy ? ('·最近中断=' + anaDiag.lastFailWhy) : ''));
    return;
  }

  const t = e.target;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;

  /* ★ 有弹窗开着（帮助 / 设置 / 复盘 / 棋谱库 / 新对局）→ 全局快捷键一律不响应。
     否则按键会「穿过」弹窗打到背后的棋局上：看着在看帮助，按个空格就把棋停了、
     按 T 推荐点就没了（用户明确说过「弹窗外的背景不该还能点」，键盘同理）。
     注意判断的是 `.open` —— 遮罩本身是常驻 DOM，不加 .open 时是不可见的。
     ★★ 2026-10-14：**分支树放大窗（#treezoom）是唯一的例外** ——
        它里面装的正是那棵树，用户在放大窗里当然要能用 ↑/↓ 换分支、C 折叠侧支、PgUp 提主变。
        所以先放它过去（并接住 Esc 用来收起）。其余弹窗照旧一律挡住。 */
  const zoomMask = $('treezoom');
  if (zoomMask && zoomMask.classList.contains('open')) {
    if (e.code === 'Escape') { e.preventDefault(); setTreeZoom(false); return; }
    /* 放大窗开着 → 剩下的键继续往下走（不 return） */
  } else if (document.querySelector('.modal-mask.open')) {
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ') { e.preventDefault(); $('btn-undo').click(); }
    return;
  }
  /* ★★ 2026-10-15 首相要求「检索一遍所有按键，细碎没用的删掉，显示开关这类刚需不能删」——
     本轮**删掉三个**（都是"用得上但没必要占一个键"的，操作在界面上都有）：
       · `Delete`  删除分支  → 右键树面板的珠子就有一项，而且现在还会弹窗确认；
       · `空格`    停一手    → 停一手本来就不常用，底栏那个按钮点一下的事；
       · `PageUp`  提升主变  → 同一个右键菜单里就有。
     为什么删而不是留：键位是稀缺资源，用得越少越不会被误触；
     而且这三个都属于"改棋谱结构"的操作，走菜单/按钮 + 确认更稳妥（尤其 Delete 之前是两段式，容易误删）。
     留下来的判断标准：**频率高**（前后翻手、换分支、悔棋）或**不影响数据、随手开关**（显示项）。

     开关类快捷键统一带一句提示（这些键容易误触，而「东西突然没了」的第一嫌疑就是它）。
     键位（2026-10-04 用户指定）：T 推荐点 · Z 坐标 · M 手数 · Y 音效 · X 形势 · N 拟人落子 · D 试下。
     ⚠️ 改键位时**记得同步 index.html 里各开关名字后面的括号**，以及 title 提示。 */
  switch (e.code) {
    case 'ArrowLeft':  e.preventDefault(); $('btn-prev').click(); break;
    case 'ArrowRight': e.preventDefault(); $('btn-next').click(); break;
    /* ★ 手数分支（2026-10-13）：↑ / ↓ 在「当前看到这一点」换分支（同一点的不同走法） */
    case 'ArrowUp':    e.preventDefault(); cycleBranch(-1); break;
    case 'ArrowDown':  e.preventDefault(); cycleBranch(1); break;
    /* ★ 段③ 树面板（2026-10-13）：C 展开/收起「当前这一手」的侧支（主变那条不动）。
       施工单的"回上一岔口 b 键"和现有「变化图（B）」撞车 —— 不改别人的键，
       也不自创键位：树面板点任意胶囊即可跳转，↑↓ 已覆盖换分支，b 暂不绑（已登记冲突）。 */
    case 'KeyC':
      if (movesView === 'tree' && state.viewAt > 0) {
        e.preventDefault();
        toggleTreeExpand(state.moves[state.viewAt - 1]);
      }
      break;
    case 'Home':       e.preventDefault(); $('btn-first').click(); break;
    case 'End':        e.preventDefault(); $('btn-last').click(); break;
    case 'KeyT': {
      const c = $('chk-show'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示推荐点' : '已隐藏推荐点（再按 T 恢复）');
      break;
    }
    case 'KeyZ': {
      const c = $('chk-coords'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示棋盘坐标' : '已隐藏棋盘坐标（再按 Z 恢复）');
      break;
    }
    case 'KeyM': {
      const c = $('chk-nums'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示手数' : '已隐藏手数（再按 M 恢复）');
      break;
    }
    case 'KeyB': {
      const c = $('chk-pv'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '变化图：开 · 把鼠标停在推荐点上停一下' : '变化图：关');
      break;
    }
    case 'KeyY': {
      const c = $('chk-sound'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '音效：开' : '音效：关（再按 Y 恢复）');
      break;
    }
    case 'KeyX': {
      const c = $('chk-terr'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示形势（' + (state.terrStyle === 'fog' ? '雾' : '方块') + '）' : '已隐藏形势（再按 X 恢复）');
      break;
    }
    case 'KeyN': {
      const c = $('chk-human'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '拟人落子：开 · 按该段位人类的概率挑手' : '拟人落子：关 · 取最优手');
      break;
    }
    case 'KeyD':       e.preventDefault(); $('btn-draft').click(); break;   // 试下（打草稿）
  }
});

/* ---------------- 设置：KataGo 程序与权重 ----------------
   ★ 路径存在软件目录的 settings.json 里（主进程读写）；改完点「保存并重启引擎」，
     两个引擎会用新路径重新预热（约 10~20 秒），期间状态栏显示「引擎重启中…」。 */

const SET_MASK = $('settings');
/* 设置面板里的五项路径。前三个是 KataGo（**必需**：下棋/分析全靠它），
   后两个是 LoGos 讲解模型（**可选**：不配就没讲解功能，别的照常用）。 */
const SET_KEYS = ['katago', 'analyzeWeight', 'playWeight', 'coachServer', 'coachWeight', 'recordsDir'];
const SET_LABEL = { katago: 'KataGo 程序', analyzeWeight: '分析权重', playWeight: '对弈权重' };
let setCfg = null;                  // 面板里正在编辑的三条路径（还没保存）

function setMsg(text, bad) {
  const el = $('set-msg');
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}

/* 每行右侧的「✓ 已找到 / ★ 找不到」—— 路径一变就刷（不用保存也能看） */
async function refreshSettingsMarks() {
  const r = await window.api.settings.check(setCfg);
  for (const k of SET_KEYS) {
    const el = $('mark-' + k);
    const ok = !!(r && r[k]);
    el.classList.toggle('ok', ok);
    el.classList.toggle('bad', !ok);
    /* 棋谱库是**目录**，文案和「文件」那几项不一样：
       留空 = 用默认（程序目录\records，完全正常，不是「找不到」）。 */
    if (k === 'recordsDir') {
      const custom = !!(setCfg && setCfg.recordsDir && setCfg.recordsDir.trim());
      el.textContent = !custom ? '默认位置' : (ok ? '✓ 可用' : '★ 用不了');
      continue;
    }
    el.textContent = ok ? '✓ 已找到' : '★ 找不到';
  }
}

/* ★ 引擎兼容性自检（2026-10-07 新增）。
   把「引擎自报的后端」和「屏幕这块显卡」并排显示；对不上就把那句建议标红。
   为什么不做成**自动**弹窗：正常用户看到弹窗只会慌。放在设置面板里、给个「检查」按钮，
   需要的人自然会点。而且引擎没配好时也只是"信息"，不是错误。
   ⚠️ 探测会真的跑一次 katago.exe（约 0.1 秒），所以只在用户点「检查」时做，
     不在打开设置时自动跑 —— 免得每次开设置都去启动一个进程。 */
function renderEngineCheck(r) {
  const el = $('eng-check');
  if (!el) return;
  el.classList.remove('ok', 'bad');
  if (!r || !r.backend) { el.textContent = '检查失败：拿不到引擎信息'; el.classList.add('bad'); return; }
  const be = r.backend, gpu = r.gpu || {};
  if (!be.ok) {
    /* 引擎文件不在/跑不起来 —— 这时「找不到文件」才是用户要听的那句话 */
    el.textContent = be.why || '读不到引擎信息';
    el.classList.add('bad');
    return;
  }
  const gpuTxt = gpu.name ? (gpu.name + (gpu.brand ? '（' + gpu.brand.toUpperCase() + '）' : '')) : '认不出显卡';
  const parts = [
    '下棋/分析：' + (be.name || be.raw) + (be.version ? '（v' + be.version + '）' : ''),
    '显卡：' + gpuTxt,
  ];
  /* ★ AI 讲解是**另一套**引擎、另一套显卡构建，所以单独报一行
     （2026-10-08 加：原来只查 KataGo —— A 卡用户按提示换完 KataGo 之后，
       LoGos 还是 N 卡那套、照样用不了，而软件一句话都不说。那是最让人困惑的情况。） */
  const la = r.llama || null;
  if (la) {
    parts.push('AI 讲解：' + (la.ok
      ? (la.device + (la.vramMB ? '（可用 ' + la.vramMB + ' MB）' : ''))
      : '用不了'));
  }

  const bad = [];
  if (r.warn) bad.push(r.warn);
  if (la && !la.ok) {
    bad.push('「AI 讲解」引擎用不了（' + (la.why || '认不出显卡') + '）。不影响下棋与分析；'
      + '想用讲解就去项目 Release 下载【通用版】包 —— 里面的讲解引擎什么显卡都能跑。');
  }
  if (bad.length) {
    el.textContent = parts.join('　·　') + '　——　' + bad.join('　');
    el.classList.add('bad');
  } else {
    el.textContent = parts.join('　·　') + '　——　✓ 都能配上';
    el.classList.add('ok');
  }
}

const btnEngCheck = $('btn-eng-check');
if (btnEngCheck) {
  btnEngCheck.onclick = async () => {
    const el = $('eng-check');
    const old = btnEngCheck.textContent;
    btnEngCheck.disabled = true;
    btnEngCheck.textContent = '检查中…';
    if (el) { el.classList.remove('ok', 'bad'); el.textContent = '正在读引擎后端…'; }
    let r = null;
    try { r = await window.api.engineCheck(); } catch (e) { r = null; }
    renderEngineCheck(r);
    btnEngCheck.disabled = false;
    btnEngCheck.textContent = old;
  };
}

function fillSettingsInputs() {
  for (const k of SET_KEYS) $('set-' + k).value = (setCfg && setCfg[k]) || '';
}

/* 把「最近用过的权重」灌进输入框的 datalist（2026-10-04 用户要求：权重多套并存、
   记住上次用的）。选项来自 settings.json 的 recent —— 每次保存都会把当前路径记进去。
   点输入框就能从下拉里挑回某一套，不用再翻一遍文件对话框。 */
function fillRecentWeights(recent) {
  const r = recent || {};
  for (const k of ['analyzeWeight', 'playWeight', 'coachWeight']) {
    const dl = $('recent-' + k);
    if (!dl) continue;
    dl.textContent = '';
    for (const p of (r[k] || [])) {
      const o = document.createElement('option');
      o.value = p;
      dl.appendChild(o);
    }
  }
}

/* ==================== 关于与更新（2026-10-08 用户要求）====================
   三件事：显示当前版本号 / 点一下查是否最新 / 一个按钮打开浏览器去下载页。

   ★★ 本软件**除了这里，任何地方都不出网**（审计过）：
        · KataGo、llama-server 都是本机子进程，不联网；
        · 软件自己跟 LoGos 说话走的是 127.0.0.1 的本地 HTTP（loops back，不出网卡）；
        · 引擎配置里出现的那些 https:// 全是**注释**（KataGo 自带的文档链接），不是请求。
      只有「检查更新」这一个按钮会发一次请求到 GitHub —— 而且**只在你点它的时候发**，
      不自动、不后台、不上报任何东西。 */
const REPO_PAGE = 'https://github.com/Rapace7/RapaceGo/releases/latest';

function appVerText(txt, cls) {
  const el = $('app-version');
  if (!el) return;
  el.classList.remove('ok', 'bad');
  if (cls) el.classList.add(cls);
  el.textContent = txt;
}

/* 打开设置面板时读一次版本号（本地读，不发请求） */
async function loadAppVersion() {
  try {
    const i = await window.api.app.info();
    appVerText('v' + i.version);
  } catch (e) { appVerText('（读不到版本号）'); }
}

const btnCheckUpdate = $('btn-check-update');
if (btnCheckUpdate) {
  btnCheckUpdate.onclick = async () => {
    const old = btnCheckUpdate.textContent;
    btnCheckUpdate.disabled = true;
    btnCheckUpdate.textContent = '检查中…';
    appVerText('正在问 GitHub…');
    let r = null;
    try { r = await window.api.app.checkUpdate(); } catch (e) { r = null; }
    if (!r || r.ok !== true) {
      /* ★ 检查失败**只说实话** —— 绝不显示"已是最新"。（网络被挡 / GitHub 抽风都可能） */
      appVerText('检查失败：' + ((r && r.error) || '连不上 GitHub'), 'bad');
    } else if (r.uncertain) {
      appVerText('当前 v' + r.current + '，最新 ' + r.latest + '（你的版本号格式特殊，自己看一眼）');
    } else if (r.upToDate) {
      appVerText('已是最新（v' + r.current + '）', 'ok');
    } else {
      appVerText('有新版本 v' + r.latest + '（你在用 v' + r.current + '）—— 点右边「去下载页」', 'bad');
    }
    btnCheckUpdate.disabled = false;
    btnCheckUpdate.textContent = old;
  };
}

const btnOpenDownload = $('btn-open-download');
if (btnOpenDownload) {
  btnOpenDownload.onclick = async () => {
    /* 不依赖"检查"是否成功 —— 这个按钮任何时候都能用（网络被挡时用户照样能手动去下） */
    let r = null;
    try { r = await window.api.app.openDownload(); } catch (e) { r = null; }
    if (!r || r.ok !== true) flash('打不开浏览器：' + ((r && r.error) || '系统拒绝了') + ' —— 可以手动访问 ' + REPO_PAGE);
  };
}

async function openSettings() {
  const info = await window.api.settings.get();
  setCfg = Object.assign({}, (info && info.config) || {});
  fillSettingsInputs();
  fillRecentWeights(info && info.recent);
  setMsg('');
  /* 自检结果**不跨次沿用**：上次那份可能是改路径之前读的，留着会误导。
     清成提示语，要看的自己点「检查」——反正那次探测只花 0.1 秒。 */
  const ec = $('eng-check');
  if (ec) { ec.classList.remove('ok', 'bad'); ec.textContent = '点「检查」看结果'; }
  /* 版本号是本地读的（不发请求）；更新状态**不跨次沿用** —— 和自检一个道理：
     上次查出来"有新版本"，用户可能已经下过新版了，留着会误导。 */
  loadAppVersion();
  SET_MASK.classList.add('open');
  await refreshSettingsMarks();
}

$('btn-settings').onclick = openSettings;
$('set-cancel').onclick = () => SET_MASK.classList.remove('open');
SET_MASK.addEventListener('click', e => { if (e.target === SET_MASK) SET_MASK.classList.remove('open'); });

/* 手打 / 粘贴进来的路径也要能检测：改完失焦就刷一次标记 */
for (const k of SET_KEYS) {
  $('set-' + k).onchange = () => {
    setCfg[k] = $('set-' + k).value.trim();
    refreshSettingsMarks();
  };
}

/* 「选择…」→ 系统文件选择框（主进程弹，我们只拿回路径） */
for (const k of SET_KEYS) {
  $('pick-' + k).onclick = async () => {
    const r = await window.api.settings.choose(k);
    if (!r || r.canceled) return;
    setCfg[k] = r.path;
    $('set-' + k).value = r.path;
    let extra = '';
    /* 选了 katago.exe → 主进程已顺手在同目录找过权重，这里自动填上 */
    if (r.suggest) {
      const hit = [];
      for (const kk of ['analyzeWeight', 'playWeight']) {
        if (r.suggest[kk]) {
          setCfg[kk] = r.suggest[kk];
          $('set-' + kk).value = r.suggest[kk];
          hit.push(SET_LABEL[kk]);
        }
      }
      if (hit.length) extra = '已在同目录找到权重并自动填上：' + hit.join('、') + '。';
    }
    setMsg(extra);
    await refreshSettingsMarks();
  };
}

$('set-default').onclick = async () => {
  const info = await window.api.settings.get();
  setCfg = Object.assign({}, (info && info.defaults) || {});
  fillSettingsInputs();
  setMsg('已填回默认路径（还没保存）。');
  await refreshSettingsMarks();
};

/* 棋谱库那一项旁边的「用默认」（只有改到别处时才有意义） */
$('reset-recordsDir').onclick = () => {
  setCfg.recordsDir = '';
  $('set-recordsDir').value = '';
  setMsg('已改回默认（程序目录\\records），点「保存并重启引擎」才生效。');
  refreshSettingsMarks();
};

$('set-shortcut').onclick = async () => {
  const r = await window.api.makeShortcut();
  if (r && r.ok) setMsg('桌面快捷方式已创建：' + r.path);
  else setMsg('创建快捷方式失败：' + ((r && r.error) || '未知'), true);
};

$('set-save').onclick = async () => {
  for (const k of SET_KEYS) setCfg[k] = $('set-' + k).value.trim();
  const btn = $('set-save');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '保存中…';
  let r;
  try { r = await window.api.settings.save(setCfg); }
  catch (e) { r = { error: String(e) }; }
  btn.disabled = false;
  btn.textContent = old;

  if (!r || r.error) { setMsg((r && r.error) || '保存失败', true); return; }

  setCfg = Object.assign({}, r.config);
  fillSettingsInputs();
  fillRecentWeights(r.config && r.config.recent);   // 保存成功 → 下拉里多了刚用的这一套
  await refreshSettingsMarks();
  SET_MASK.classList.remove('open');
  /* 引擎是**异步**重启的（停 → 拉起 → 预热）；好了没有要看 engine:status 事件 */
  engineReloading = true;
  /* ★ 这次改棋谱库位置的话，如实报一下搬了几份过去（老位置的不删）。 */
  const mv = r.moved;
  if (mv && (mv.copied || mv.failed)) {
    flash('设置已保存 · 引擎正在重启…　棋谱：已复制 ' + mv.copied + ' 份到新位置'
      + (mv.skipped ? '，' + mv.skipped + ' 份同名已存在没覆盖' : '')
      + '（老位置的没删）');
  } else {
    flash('设置已保存 · 引擎正在按新路径重启…');
  }
};

/* 重启完成 → 提示一句。由 applyEngineStatus 调用（那两个引擎的都绪状态在那儿更新）。 */
function checkEngineReloaded() {
  if (!engineReloading) return;
  if (engineReady && engineReadyPlay) {
    engineReloading = false;
    flash('引擎已按新配置重启完成');
  } else if (engineNote) {
    engineReloading = false;      // 起不来就别一直挂着「重启中」，状态栏已显示「引擎异常」
  }
}

/* ---------------- 帮助 ----------------
   面板内容全是静态 HTML（写在 index.html 的 #help 里），这里只管开关。
   想改帮助文字 → 直接改 index.html；**改功能或快捷键时记得顺手同步**，
   别让帮助里写的和软件实际做的不一样。 */
const HELP_MASK = $('help');
$('btn-help').onclick = () => {
  HELP_MASK.classList.add('open');
  /* ★ 每次打开都从头看（2026-10-08）——
     上次翻到一半的位置留着，会让人以为帮助"打开就是最后一节"。
     ★ 滚动归零直接做（瞬时、不依赖任何测量）；各节位置等到**下一帧**
       —— 弹窗出现动画走完、布局稳定了 —— 再量并缓存（见 measureHelpSections 的注释）。 */
  const body = document.querySelector('.help-body');
  if (body) body.scrollTop = 0;
  helpHighlight('help-first');
  requestAnimationFrame(() => { helpOffsets = measureHelpSections(); });
};
$('help-close').onclick = () => HELP_MASK.classList.remove('open');
HELP_MASK.addEventListener('click', e => { if (e.target === HELP_MASK) HELP_MASK.classList.remove('open'); });

/* ---------- 帮助顶部的直达目录（2026-10-08 用户要求）----------
   用户原话：「软件内的帮助要有顶部列出的直达按钮，直接拉到对应位置，方便快速查询」。

   ★ 为什么不用浏览器原生的 `#id` 锚点跳转：
     帮助正文的滚动容器是 **`.help-body`**（它自己 `overflow-y:auto`），不是根文档 ——
     `#id` 锚点在这里不生效。所以位置得自己算：
       目标相对滚动容器的偏移 = 目标.rect.top − 容器.rect.top ＋ 容器已滚过的距离
     再自己赋 `scrollTop`。CSS 里配了 `scroll-margin-top: 44px` 给吸顶目录让位，
     所以这里不用再手动减目录高度。

   ★ 顺带做**当前小节高亮**：目录吸在顶上，翻到哪一节一眼就知道自己在哪、
     还剩哪些没看 —— 这才是"方便快速查询"。（用 rAF 节流，滚动不卡。） */
const HELP_SECTIONS = ['help-first', 'help-parts', 'help-feat', 'help-rules', 'help-keys', 'help-data'];

/* 平滑滚动：自己用 rAF 做，**不用 CSS 的 scroll-behavior:smooth**。
   为什么不能用 CSS 那个（2026-10-08 实测踩到）：
     它会让每一次 `scrollTop` 赋值都变成动画，于是"先归零、再量绝对位置"的算法失效 ——
     赋值后立刻量，量到的还是动画中途的值（实测设了 0、读到 72），跳转位置就全错。
   自己写还有个好处："打开帮助时归零"可以瞬时完成，而"点目录跳转"才用动画。 */
function animateScrollTop(el, to, ms) {
  const from = el.scrollTop;
  const dist = to - from;
  if (!dist) return;
  /* 环境不支持 rAF（或无头调试窗口）→ 直接跳，别留个半路的位置 */
  if (typeof requestAnimationFrame !== 'function') { el.scrollTop = to; return; }
  const t0 = performance.now();
  const dur = ms || 260;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);                 // easeOutCubic：快进慢出
    el.scrollTop = from + dist * e;
    if (p < 1) requestAnimationFrame(step);
    else el.scrollTop = to;                           // 收尾对齐，免得差几像素
  };
  requestAnimationFrame(step);
}

/* 各小节相对"滚动内容顶部"的偏移量。
   ★★ 为什么要缓存（2026-10-08 踩了两次才想通）：
     · 弹窗关闭时是 `display:none` → 里面所有元素的 rect 全是 0；
     · 弹窗刚打开时还在做出现动画 → 量出来会偏（实测"打开后跳第一节"停在 72px 而不是 0）。
     两次都是同一个病：**在布局不稳定的时候量位置**。
     所以改成：**只在弹窗稳定显示后量一次、存起来**（打开时的下一帧量），
     之后所有跳转都用这份缓存 —— 不再依赖任何实时 rect。 */
let helpOffsets = null;

function measureHelpSections() {
  const body = document.querySelector('.help-body');
  if (!body) return null;
  const keep = body.scrollTop;
  body.scrollTop = 0;                                  // 量之前先归零，量完还原
  const br = body.getBoundingClientRect();
  const out = {};
  for (const id of HELP_SECTIONS) {
    const el = document.getElementById(id);
    out[id] = el ? Math.round(el.getBoundingClientRect().top - br.top) : 0;
  }
  body.scrollTop = keep;
  return out;
}

function helpScrollTo(id, smooth) {
  const body = document.querySelector('.help-body');
  if (!body) return;
  if (!helpOffsets) helpOffsets = measureHelpSections();
  if (!helpOffsets) return;
  const top = Math.max(0, (helpOffsets[id] || 0) - 44);   // 44 = 吸顶目录让出的高度
  if (smooth === false) body.scrollTop = top;
  else animateScrollTop(body, top, 260);
  helpHighlight(id);
}

function helpHighlight(id) {
  const nav = $('help-nav');
  if (!nav) return;
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.help === id));
}

/* 滚到哪一节就高亮哪个。
   ★ 判据：**找最后一节「相对内容顶部的偏移 ≤ 当前滚动位置 + 一点余量」**。
     第一版我写成"看谁已经越过容器顶部"（rect 相减），在**顶部**时那一节是"第一次使用"
     和"主要功能"同时满足条件、取到后面那个 —— 所以滚到最上面反而高亮"主要功能"。
     用绝对偏移量比就没这个歧义：滚到 0 时只有第一节满足。 */
(() => {
  const body = document.querySelector('.help-body');
  const nav = $('help-nav');
  if (!body || !nav) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = body.scrollTop + 60;
    let cur = HELP_SECTIONS[0];
    for (const id of HELP_SECTIONS) {
      const el = document.getElementById(id);
      if (!el) continue;
      /* 同样用"先归零再量"会闪，所以这里用 offsetTop 一类的稳定量：
         el 相对 .help-body 内容顶部的距离 = rect.top − body.rect.top + body.scrollTop */
      const off = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      if (off <= y) cur = id;
    }
    helpHighlight(cur);
  };
  body.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  });
})();

/* 点目录里的按钮 → 跳过去（阻止默认，免得地址栏跑出 `#help-xxx` 的尾巴） */
(() => {
  const nav = $('help-nav');
  if (!nav) return;
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      helpScrollTo(a.dataset.help || (a.getAttribute('href') || '').replace('#', ''), true);
    });
  });
})();

/* ---------------- 启动 ---------------- */

window.addEventListener('resize', resize);
bindClockName('b');        // 右侧双方名字：点一下就能改（导出棋谱时写进 PB/PW）
bindClockName('w');
fillLevelSelects();        // ★ 段位下拉要先生成 —— applyNewGame → syncUI 会读它
refreshLevelNote();
fillVisitSelect();         // 搜索量下拉（「计算深度」）
/* ★ 启动时**不直接开局**（用户要求）：把界面摆成「未开局」的中性状态 ——
   棋盘点不动、胜率条五五开且不发分析、对局信息四项全「未定」，
   棋盘中央一个大胶囊按钮引导去新建对局。 */

/* ==================== 讲解（LoGos，2026-10-05 新增） ====================

   两个框、两条功能，共用同一套「问 LoGos」的机制：

   · 分析讲解 —— 点评**当前显示的那一手**
   · 选点讲解 —— 讲「这一手该走哪、为什么」

   ★★ 一条铁律：**点位由 KataGo 定，LoGos 只负责讲道理。**
      实测（同一天的探索记录）：让 LoGos 直接点评已下的一手，它
        ① 对明显差的一手照样编得出「很有战略意义」；
        ② 会跑题（讲起别的区域，不提你问的那手）；
        ③ 甚至把坐标说错（传 A1，它讲成 A13）。
      但反过来——给它一个**本来就合理的点**（KataGo 的候选点就是），
      它讲得又快又好：每点约 4 秒、约 120 字、术语也像样。
      所以：「好坏」永远由 KataGo 的目损说，「为什么」才交给 LoGos。

   两条共同的规矩（用户定）：
     · 单次不超过 200 字，局面简单时几十字
     · 再点一次 = 清掉旧的、重新生成
     · 内容只在对局期间保留；开新局 / 换棋谱就清空
*/

/* ---------- 两个框的常驻标注 ----------
   用户要求写清楚这框是干啥的，**尤其是选点讲解**：
   棋盘上已经有 KataGo 画的推荐点了（虚线圆圈），不说明白会和框里的内容混淆。 */
const COACH_PH_EXPLAIN = [
  '点评当前显示的这一手。',
  '',
  '· 好不好 —— 看 KataGo 的目损（客观数据，不会瞎夸）',
  '· 为什么 —— 听 LoGos 讲',
  '',
  '回看、打谱都能用。点一次讲一次。',
].join('\n');

/* 空状态的说明。
   ★ 措辞要点（2026-10-07 按用户要求改）：**必须点明「点是谁选的」** ——
     原来写成「LoGos 推荐落点讲解」，会被读成"LoGos 自己选的点、和 KataGo 不是一批"，
     那是误解：**点全是 KataGo 算的，LoGos 只负责讲道理**（它连 prompt 里都是被点名讲某一点的）。 */
const COACH_PH_PICK = [
  '点击「生成讲解」：由 LoGos 逐点解释 KataGo 算出的推荐落点。',
  '',
  '选点是 KataGo 的事，LoGos 只讲「为什么这么下」。',
  '棋盘上要不要显示那批点，用「显示」菜单里的「实时推荐落点」（快捷键 T）。',
  '',
  '讲解是**点击那一刻**的快照：之后棋盘会继续随分析更新，两者可能不同，',
  '上方会提示「当前局面已变化」；要讲现在的局面，请重新生成。',
  '',
  '打谱时用不了 —— 那是别人的棋，不替人支招。',
].join('\n');

/* LoGos 的 system prompt（照官方格式写，它认这个）
 *
 * ★★ 2026-10-14 审查（首相要求「再审查一遍给 LoGos 的提示词」）—— 原文有两处自相矛盾：
 *
 * 【毛病一 · 记号说明不全，且与正文对不上】
 *   原文只说 `"X"表示黑棋，"O"表示白棋`，而正文实际给了**两种**记号：
 *     · 对局记录 —— 形如 `1.X-Q16  2.O-D4`（确实是 X/O）；
 *     · 盘面矩阵 —— 形如 `[[0,0,1,-1,…]]`（是 **1 / -1 / 0**）。
 *   系统提示**一个字没提矩阵的 1/-1/0**，而它排在**最前面**（先入为主）；
 *   正文那句「其中1表示黑棋…」在后面，而 7B 对后置说明的注意力很弱。
 *   后果：模型读到 `1` 时没有任何映射依据，容易当成「第 1 手」或「白棋」（毕竟 O 才是白）
 *   → **盘面读错，然后凭棋局感瞎编** —— 这正是历史上反复出现的"编造盘面"的温床。
 *
 * 【毛病二 · 身份自相矛盾，直接抵消了 v9 的立场规矩】
 *   原文说「你是一位专业的围棋棋手」，而下面规矩里（v9 加的）写的是
 *     「你是旁观的讲棋人，不是对局双方里的任何一方：不许说「让我来教教你」…」
 *   7B 指令遵循弱、**更听先出现的那条** → 又滑回对局者口吻。
 *   证据就是首相实测抓到的「让我来教教你怎么下棋」「作为白棋，我完全可以利用这个机会」。
 *
 * 一次改对：**身份与后文一致**，**两种记号都在系统提示里交代清楚**（坐标朝向那两句原样保留）。 */
const COACH_SYS = '你是围棋讲棋人，站在旁边给棋友讲棋（不是对局双方里的任何一方，'
  + '不要用「我」指代任何一方）。'
  + '局面用两种记号给出：对局记录里 X 是黑棋、O 是白棋，形如 1.X-Q16；'
  + '盘面矩阵里 1 是黑棋、-1 是白棋、0 是空位，形如 [[0,0,1,-1]]。'
  + '棋盘的大小为19x19，每个落子的坐标是一个字母加上一个数字的形式。'
  + '字母为A-T(跳过I)，对应于棋盘上从左到右。数字为1-19，对应于棋盘上从下到上。'
  + '只依据提示里明确给出的事实讲，不要自己推测盘上别处有什么。\n';

/* ★ 停词 —— 掐掉「开始逐手推演变化图」的那一句。
   实测：不截断时它一口气吐 623 token 的长篇推演；截断后只剩 55 token / 1.8 秒，
   留下的正好是「结论 + 几条理由」= 用户要的那种讲解。
   ⚠️ 别加太宽的词（「其他」「另一个」「如果选择」都试过）——它们会出现在正常句子里，
      一命中就把讲解拦腰砍断（实测有一次只剩 60 字、末尾还是个破折号）。 */
const COACH_STOP = ['选项', '此外', '可能的变化', '的变化是', '变化推演', '变化如下',
  '其他选择', '另一个选择', '接下来黑棋', '接下来白棋',
  /* ★ 2026-10-12 整盘 217 手跑完补的：这几个词一出现，后面必定是
     「推演变化图 / 教对方往哪下」—— 当场截断比事后清理更省时间，也少生成一堆垃圾。
     实测原句：「如果选择D11粘，预计变化：粘（白棋先补强自己）扳（黑棋必然要扳回）…」 */
  '如果白棋下', '如果黑棋下', '预计变化', '变化图', '值得考虑'];

/* ★ 讲解格式的版本号 —— 改了 prompt 或讲解结构就 +1。
   为什么必须有：讲解是**存进棋谱旁边**的（<棋谱名>.coach.json），下次打开直接读回来；
   而"讲过的跳过"这个特性会把老缓存锁死 —— 版本对不上的当没讲过，重讲一遍，
   否则用户永远看不到修好的版本。
   v1 = 2026-10-05 起的旧格式（盘面给"这一手之前"、AI 推荐点混在正文里）
   v2 = 2026-10-12：盘面改成"含这一手"；AI 推荐点改成程序写的数字对照；
        加好棋坏棋分级（vGrade）与相应语气。
   v3 = 2026-10-12 晚：结论句改口语化词池（v2 那个「这手棋下得不好 —— 」是硬模板，
        首相说 217 手全长一个样、一眼假）；并要求模型别写棋评八股。
   v4 = 2026-10-12 深夜：整盘 217 手跑完亲眼看过之后补的 ——
        清掉动作/神态旁白（81 手有「（对着棋盘沉思片刻）」这种剧本词）、
        清掉模型自己编的胜率句（132 处）、砍掉推演变化图与"教对方下哪"的尾巴。
   v5 = 2026-10-13 凌晨：首相又指出「有些手只有结论没有理由、也不说会怎样」——
        查出来是两层：① `maxTokens: 340` 把生成**截断**了（原始输出结尾是
        「这个变化虽然也能吃掉黑」这种半句）；② 门槛太低，一句「这手有问题啊！」
        也被放行。现在 maxTokens 提到 520、coachUsable 门槛 40→70、
        prompt 里把「必须说到的三点」写死。
   v6 = 2026-10-13：**逐手过目 172 手之后**汇总出 6 类脏话，清理判据大补一轮
        （数字分点罗列 / 我建议 / X棋现在可以下在 / 变化图残渣 / 动作旁白第三拨 /
         我仔细计算），另外把记谱清理从「整个删掉」改成「只去 X-/O- 前缀」
        —— 修用户截图报的「7一带」。
        ★ 教训（自己踩的）：改完清理判据**必须同时升这个版本号**。
          有一次改了判据没升，整盘跑起来 4.5 分钟就"讲完"了 ——
          其实缓存全部判定为已讲过、一手没重讲（日志第一行就是「已讲 217/217」）。 */
// ★ v7 = 2026-10-13：**事实注入** —— 首相实测第 8 手 D3 落在空角，讲解却说
//   「白棋这手**碰**得有点早」「黑棋在**四个角**都有子力，白棋布局明显落后」——全是编的。
//   根因：我们让 7B 自己读那个 19×19 矩阵判断"碰到了谁"，它读不准就凭棋局感瞎编。
//   现在由 touchFacts / cornerFacts **程序算好**「这一手挨着谁、是不是空的」
//   「四个角各有几颗子」塞进 prompt，并要求它**只依据这些事实讲**。
// v8 = 2026-10-13：prompt **整体重写**（首相批评「提示词写好一点，别让 LoGos 瞎扯」）——
//   规矩 + 要讲的三件事放前面、**核对过的事实紧贴预填句**（实测离得近才管用），
//   并把「事实说是空的就不许写碰」写成一条**独立规矩**（只藏在事实里它照样无视）。
// v9 = 2026-10-13 夜（DSH）：**立场与口吻**。看 10 手真实讲解抓到的两种病：
//   ① 第 5/10 手正文里冒出「让我来教教你怎么下棋」—— 对用户是冒犯；
//   ② 第 5/9 手冒出「作为白棋，我完全可以利用这个机会」—— 讲的是黑棋的失误，
//      却突然换成白棋口吻替对方支招，立场整个乱了。
//   两条同源：**模型把自己代入成了对局中的一方**。规矩里写死「你是旁观的讲棋人」，
//   并把它列的那些舞台说明（（开始分析）（突然提高声调）…）逐一点名禁止。
//   ⚠️ 改 prompt 必须升版本号 —— 见上面 6941 行那条教训。
// v10 = 2026-10-14（首相要求「再审查一遍给 LoGos 的提示词」）—— 审出四处，全改：
//   ① **系统提示词的记号说明与正文对不上**：原文只说 X/O，而正文给的是 1/-1/0 矩阵，
//      系统提示一个字没提矩阵 —— 它在最前面、先入为主，模型读到 1 没有映射依据就瞎猜
//      （这是"编造盘面"的温床）。现在两种记号都在系统提示里交代清楚。
//   ② **身份自相矛盾**：系统提示说「你是一位专业的围棋棋手」，而规矩里（v9）写的是
//      「你是旁观的讲棋人，不是对局双方里的任何一方」—— 7B 更听先出现的那条，
//      于是又滑回对局者口吻（「让我来教教你」就是这么来的）。现在系统提示改成"讲棋人"。
//   ③ **把要禁的词当例子列给模型看**：原文逐一点名「（沉思片刻）」「（开始分析）」
//      「（突然提高声调）」「（总结性地）」—— 等于把词喂给它，7B 越禁越写
//      （首相实测报的正是这几个）。现在只留抽象要求，具体清理交给 cleanCoachText。
//   ④ **指令全裹在括号里**：7B 历史上就爱续写括号旁白，去掉括号平铺陈述；
//      否定句也做了合并精简（原来四条长否定句挤压了正向内容）。
const COACH_VER = 10;
function coachVerOK(rec) { return !!rec && rec.cv === COACH_VER; }

let coachSeq = 0;              // 请求序号：被新的取代就丢弃（这就是「覆盖」）

/* ---------- 拼输入 ---------- */

/* 着法序列：1.X-Q16  2.O-R4 ……（和官方训练数据同一个格式） */
function coachMoveList(moves) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    out.push((i + 1) + '.' + (m.color === 'b' ? 'X' : 'O') + '-'
      + (m.pass ? 'pass' : toGTP(m.x, m.y)));
  }
  return out.join('  ');
}

/* 棋盘矩阵 [[...]]：1=黑 -1=白 0=空。
   ⚠️ 第 0 行是**最上面**那一行 —— 这个朝向是拿官方训练数据逐字节核对过的
      （官方的 3.X-D4 落在 matrix[15][3]，正是本函数算出来的位置）。
   注意 RapaceGo 的 y=0 也在最上面（toGTP 写的是 N-y），所以这里是正序，不用翻。 */
function coachMatrix(board) {
  const rows = [];
  for (let y = 0; y < N; y++) {
    const row = new Array(N);
    for (let x = 0; x < N; x++) {
      const v = board[idx(x, y)];
      row[x] = v === 1 ? 1 : (v === 2 ? -1 : 0);
    }
    rows.push('[' + row.join(',') + ']');
  }
  return '[' + rows.join(',') + ']';
}

/* 一条「指定点讲解」的完整输入。
   ★ 末尾那句「预填」是整套里最关键的一招：它训练时的模板就是「先长篇推理、
     再给结论」，直接命令它「讲短点」完全无效（实测给它 150 字的限制，
     它照样吐 623 token）。但**替它写好开头**，它就会顺着往下写 ——
     于是直接从结论开始，不再罗列一堆候选点。

   ★★ 预填必须用**条件句**（「如果白棋下在C3，」），不能用断言句（「白棋下在C3」）——
      实测断言句会让它把**还没落子**的候选点当成既成事实来讲
      （「白棋在C3的应对是非常标准的」），读起来像在讲已经发生的事，是逻辑错误。
      条件句输出的自然就是「如果……那么……」，逻辑对，内容也不减。
      （加"这是建议、还没落子"之类的约束词它**根本不理**——7B 的指令遵循就这么弱。） */
function coachPrompt(moves, board, color, point) {
  return COACH_SYS + '\n'
    + '以下是当前的对局记录：\n\n' + coachMoveList(moves)
    + '\n\n\n当前盘面情况为:' + coachMatrix(board)
    + '\n其中1表示黑棋，-1表示白棋，0表示空位。\n'
    + '<reasoning>\n如果' + (color === 'b' ? '黑棋' : '白棋') + '下在' + point + '，';
}

/* ★ 一手棋的严重程度分级（0 好棋 / 1 小亏 / 2 明显失误 / 3 严重失误）。
   首相要求「胜率巨额波动要讲」—— 讲解的语气和界面标记都按这个级别走。
   阈值 1.5 / 6 / 15：一手亏 6 个点已经明显扎眼，15 个点基本是"这盘就此交代"。 */
function vGrade(loss) {
  if (loss >= 15) return 3;
  if (loss >= 6) return 2;
  if (loss >= 1.5) return 1;
  return 0;
}

/* 把 KataGo 的判定翻译成**一句语气指示**交给 LoGos。
   ★ 只说量级、**不给数字**：实测给了数字它会照抄（用户不想要重复的胜率）。
   ★★ 2026-10-12 首相要求「好棋要夸、烂棋要骂、要锐评」——
     踩过的坑：光在"要求"里写「明显不好，第一句就直说」，它**不稳定** ——
     同一手亏 8.5% 的棋跑两次，一次骂「不太像棋啊」，一次夸「碰得很有想法」。
     所以结论句改由 verdictLead() **直接写进预填**（见那边的注释），
     这里的 tone 只负责"接着那句话把理由讲透"。 */
function verdictTone(v) {
  /* ★ 首相 2026-10-12：「别搞那种套模板……要像人」——
     所以这里点明"像平时跟棋友聊棋那样说"，别写棋评八股。 */
  const voice = '要像平时跟棋友聊棋那样把话说明白，别用套话、别写棋评八股。';
  if (!v) return 'KataGo 对这一手还没算出结论，就事论事地讲。' + voice;
  if (v.grade >= 2) return '接着这句话把理由讲透：为什么这么下不行、问题出在哪。该严厉就严厉，别和稀泥。' + voice;
  if (v.grade === 1) return '接着这句话说清差在哪就行，不用往重里说。' + voice;
  return '接着这句话说清它好在哪里。' + voice;
}

/* 结论句 —— **好用程序写、直接进预填**，不让模型自己判断好坏。
   ★ 为什么由程序写：实测模型对"该骂还是该夸"完全不稳定（见 verdictTone 的注释）；
     而预填是它一定会顺着写的（试过给它 150 字的长度限制它照吐 623 token，
     但替它写好开头它就跟上）。把结论摆在预填里，它就只会去补理由。
   ★ 顺带落地了本文件门口那条铁律：
     「好不好由 KataGo 的目损说了算，为什么这么下听 LoGos 讲」——
     原来只有界面上的 verdict 行在守这条，正文里仍由模型自己发挥；
     现在正文的第一句也归 KataGo。

   ★★ 2026-10-12 首相看了一版之后说：「别搞那种套模板，讲的意思一样即可，
      没必要公式化，要像人」。第一版用的是「这手棋下得不好 —— 」，217 手全长一个样。
      现在改成：**每种判定准备一把口语说法，按手数轮流取** ——
        · 意思一样（结论仍由 KataGo 定，不会把坏棋夸成好棋）
        · 但相邻的手不会用同一个开头，读起来不像填空
        · 破折号也去掉了，那是模板痕迹最重的地方 */
const LEAD_POOL = {
  3: ['这手棋太糟了，', '这手不行，', '这手亏大了，', '这手几乎是败着，'],
  2: ['这手不太行，', '这手有点问题，', '这手下得不好，', '这手亏了，', '这手不够好，'],
  1: ['这手稍欠一点，', '这手差了点意思，', '这手不算最好，'],
  gain: ['这手不错，', '这手下得好，', '这手漂亮，', '这手很有想法，'],
  even: ['这手没问题，', '这手是正着，', '这手很自然，'],
};
function verdictLead(v, at) {
  if (!v) return '';
  const pool = v.grade >= 3 ? LEAD_POOL[3]
    : v.grade === 2 ? LEAD_POOL[2]
      : v.grade === 1 ? LEAD_POOL[1]
        : (v.txt.indexOf('赚了') === 0 ? LEAD_POOL.gain : LEAD_POOL.even);
  /* 按手数轮换 —— 用 at 而不是随机数：同一盘重讲结果一致，出了问题好复现。 */
  return pool[((at || 0) % pool.length + pool.length) % pool.length];
}

/* ★★★ 2026-10-12 重写 —— 「分析讲解 / 全盘讲解」用这个，评价**已经下出来的**那一手。

   为什么非改不可（首相实测报的 bug，已用真棋谱复现）：
     黑棋第 5 手实际下 D16，讲解却说「这一手 D16 下出来，**如果黑棋下在 D4**……」
     —— 整段在讲另一个点（而且那个点盘上压根没有子）。

   病根**不是坐标系**（专门测过：给模型单颗子问"它下在哪"，
   放在 D16 它答 D16、放在 Q16 它答「右上角」、放在 C4 它答「左下角」，全对），
   而是**盘面与任务自相矛盾**：原来传的是 `boardAt(at-1)`（这一手**之前**），
   在那个局面上**正好轮到刚落子的那一方走** —— 模型看到"该我选点了"，
   于是本能地退回它最擅长的"列候选点"，D4 就是它列的候选之一。

   对照实验（同一真实局面各跑 3 次）：
     · 盘面给「这一手之前」→ 讲出的坐标是 D4 C3 D3 D13 C14 F15（**盘上都没有**）
     · 盘面给「含这一手」  → 讲出的坐标是 C16 E17 D14（**盘上真实有的子**），
       且原文变成「黑棋在 D16 碰……对白棋在 C16 的子形成了一定的压力」—— 正是要的效果。

   `head` = 已经拼好的正文开头（含 verdictLead() 给的结论句），也就是界面上
   拼在正文前面那一句 —— **两边必须用同一个字符串**，不然会重复或对不上。 */
/* ★★ 2026-10-13：把「这一手到底挨着什么」**由程序算好**再交给模型。
   起因（首相实测，最严重的一类错误）：第 8 手 D3 落在**空空如也的左下角**，
   讲解却写「白棋这手**碰**得有点早」「黑棋在**四个角**都有子力，白棋的布局明显落后了」——
   全是编的。7B 读那个 19×19 数字矩阵根本读不准，读不准就凭"棋局感"瞎编。

   所以换个分工：**事实由程序给，模型只管顺着事实讲道理**（那正是它擅长的）。
   `touchFacts` 说清这一手挨着谁、或者压根是空的；
   `cornerFacts` 说清四个角各有几颗子（免得它再说"四个角都有子"）。 */
/* 这一手在盘面的什么位置 —— 术语也由程序给，别让模型猜。
   实测：D3（3-4）被模型说成「星位」（那是 4-4），用户一眼就看出不对。 */
function posKind(x, y) {
  const gx = x + 1, gy = N - y;                  // 换算成「从左往右 / 从下往上」的 1..19
  const dL = gx, dR = N + 1 - gx, dB = gy, dT = N + 1 - gy;
  const a = Math.min(dL, dR), b = Math.min(dB, dT);   // 距最近的竖边 / 横边
  const nearL = dL <= dR, nearB = dB <= dT;
  const corner = (a <= 6 && b <= 6)
    ? (nearL ? (nearB ? '左下' : '左上') : (nearB ? '右下' : '右上')) : '';
  if (!corner) {
    const dEdge = Math.min(dL, dR, dB, dT);
    return dEdge <= 4 ? (dEdge + ' 线上（边）') : '中腹一带';
  }
  let kind;
  if (a === 4 && b === 4) kind = '星位（4-4）';
  else if ((a === 3 && b === 4) || (a === 4 && b === 3)) kind = '小目（3-4）';
  else if (a === 3 && b === 3) kind = '三三（3-3）';
  else kind = a + '-' + b + ' 点';
  return corner + '的' + kind;
}

function touchFacts(board, x, y, color) {
  const where = posKind(x, y);
  const near = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const v = board[idx(nx, ny)];
      if (!v) continue;
      near.push({ own: (v === 1) === (color === 'b'), pt: toGTP(nx, ny) });
    }
  }
  if (!near.length) {
    return '这一手落在**空的地方**（' + where + '），四周八格内没有任何棋子 —— '
      + '它既不是"碰"、也没有挨着谁。';
  }
  const own = near.filter(z => z.own).map(z => z.pt);
  const opp = near.filter(z => !z.own).map(z => z.pt);
  const parts = [];
  if (own.length) parts.push('自己的 ' + own.join('、'));
  if (opp.length) parts.push('对方的 ' + opp.join('、'));
  return '这一手（' + where + '）挨着：' + parts.join('，') + '。';
}

/* 四个角（每个角 4×4）里黑白各有几颗子 —— 让模型别再说"四个角都有子" */
function cornerFacts(board) {
  const qs = [['左上', 0, 0], ['右上', N - 4, 0], ['左下', 0, N - 4], ['右下', N - 4, N - 4]];
  return qs.map(function (q) {
    let b = 0, w = 0;
    for (let y = q[2]; y < q[2] + 4; y++) {
      for (let x = q[1]; x < q[1] + 4; x++) {
        const v = board[idx(x, y)];
        if (v === 1) b++; else if (v === 2) w++;
      }
    }
    return q[0] + ' 黑' + b + '白' + w;
  }).join(' · ');
}

/* ★★★ 「分析讲解 / 全盘讲解」的输入（2026-10-13 整体重写）。

   **核心变化：盘面事实全部由程序算好喂进去，不让模型自己去读那个 19×19 矩阵。**
   起因（首相实测，最刺眼的一类错）：第 8 手 D3 落在空空如也的左下角，
   讲解却写「白棋这手**碰**得有点早」「黑棋在**四个角**都有子力，白棋布局明显落后」——
   全是编的。7B 读数字矩阵读不准，读不准就凭"棋局感"瞎编。

   排版上有三条硬规矩，每条都是实测撞出来的：
     ① **要求写在前面、预填句放在最后** —— 反过来的话模型会接着"要求"往下写，
        吐出「…下出来，现在轮到白棋第6手，你是白棋，我让你下棋…」这种要求形态的文字；
     ② **事实紧贴预填句** —— 离得越近越管用。实测把事实放最前、要求放中间时，
        模型照样开口就写"碰"；
     ③ **"空的就不许写碰"要写成一条独立规矩**，不能只塞在事实里 ——
        它确实会无视事实里那句"它不是碰"。

   参数：`at` = 第几手；`x`/`y` = 落点（停一手传 -1）；
   `head` = 拼好的正文开头（含 verdictLead 的结论句，**必须和界面上拼的是同一个字符串**）；
   `tone` = 语气指示（verdictTone 给的）。 */
function coachPromptActual(moves, board, color, at, x, y, head, tone) {
  const me = color === 'b' ? '黑棋' : '白棋';
  const you = color === 'b' ? '白棋' : '黑棋';
  const isPass = x < 0;
  const pt = isPass ? '停一手' : toGTP(x, y);
  const facts = isPass
    ? '这一手是「停一手」，没有在盘上落子。'
    : touchFacts(board, x, y, color);
  const where = isPass ? '' : posKind(x, y);
  return COACH_SYS + '\n'
    + '以下是当前的对局记录：\n\n' + coachMoveList(moves)
    + '\n\n\n当前盘面情况为:' + coachMatrix(board)
    + '\n其中1表示黑棋，-1表示白棋，0表示空位。\n'
    + '<reasoning>\n'
    /* ★★ 2026-10-14 审查（首相要求）改的三处：
       ① **不再用括号把指令裹起来** —— 原文两条要求都写在「（…）」里，而 7B 历史上就爱
          续写括号旁白（v4 清掉过 81 处「（对着棋盘沉思片刻）」）。去掉括号，平铺陈述。
       ② **删掉舞台说明的具体例子**。原文把「（沉思片刻）」「（开始分析）」「（突然提高声调）」
          「（总结性地）」**逐一点名禁止** —— 那等于把要禁的词喂给它；7B 指令遵循弱、模仿强，
          **越禁越写**（首相实测报的正是这几个）。现在只留抽象要求；
          具体清理交给 cleanCoachText（那边有词表，而且**不给模型看**）。
       ③ 否定句合并精简：原来四条长否定句占了大半篇幅，正向的"要讲什么"反被挤压。
       ④「核对过的事实」也从括号里拿出来 —— 它是**紧贴预填句**的那一段，本身就该最显眼。 */
    + '你在给棋友讲 ' + me + '第 ' + at + ' 手（' + pt + '）。\n'
    + '**要讲清三件事**：① 这一手在这个位置起了什么作用（占角？拆边？逼近谁？'
    + '落空角就直说是在占空角）；② ' + you + '接下来最可能怎么应、应完大致是什么局面；'
    + '③ 这一手好在哪、差在哪 —— **必须给出判断和理由**，「它挨着谁」这种描述不算理由。\n'
    + '**规矩**：\n'
    + '· 只依据下面「核对过的事实」讲，不要猜盘上别处有什么、不要编局势；\n'
    + '· 事实说这一手四周没有棋子，就不许用「碰」「靠」「挡」「断」「扳」'
    + '这类必须挨着棋子的词；\n'
    + '· 不要推演后续变化、不要罗列候选点、不要提胜率数字；\n'
    + '· 不要写神态、动作、语气、舞台说明这类表演性描写；\n'
    + '· **你是旁观的讲棋人，不是对局双方里的任何一方**：不要用「我」指代任何一方、'
    + '不要对读者用教导口吻、讲一方失误时不要转头替另一方支招；'
    + '一律用「黑棋」「白棋」客观陈述；\n'
    + '· 用**两三句话**连着说完，像跟棋友聊棋，别写棋评八股。\n'
    + '**核对过的事实**（照这些讲）：' + me + ' ' + pt
    + (where ? '，位置在' + where : '') + '；' + facts
    + '四个角（每个角 4×4 格）里的子数：' + cornerFacts(board) + '。' + tone + '\n'
    + head;
}

/* 第二段：AI 当时更倾向的那个点 —— **由程序写、不问 LoGos**（首相拍板方案 A）。
   为什么不问：实测 LoGos 讲不出「两个点对比」——
     · 条件句问法（现在线上那种）3/3 退化成罗列候选点；
     · 加要求「讲这个点好在哪」3/3 更糟，一口气列了 18 个坐标；
     · 把它当"已经下出来的一手"来评价则不跑题，但会滑向替对方支招。
   而 KataGo 的胜率差是硬数字，比它嘴里的道理准，还不用多等一次生成。

   ★ 口径：`best.winrate` 是**下棋方**的胜率（KataGo 全盘分析时那个），
     `v.loss` 是这一手让下棋方掉的点数 —— 两者同口径，所以
     「实际这手之后的胜率 = best.winrate - loss」成立（最佳手本身几乎不亏）。 */
function bestPointNote(best, v, sideTxt) {
  if (!best || !v || v.loss < 0.5) return '';        // 好棋没什么可对照的
  const ai = best.winrate * 100;
  const mine = ai - v.loss;
  return '至于 AI 当时更倾向的 ' + best.move + '：那手' + sideTxt + '棋胜率 '
    + ai.toFixed(1) + '%，实际这一手掉到 ' + mine.toFixed(1) + '%，差了 '
    + v.loss.toFixed(1) + ' 个点。';
}


/* 清掉它偶尔带出来的标签和结论框 */
function cleanCoachText(s) {
  return dedupeRepeatSentences(String(s || '')
    /* ★ 2026-10-13：`</reasoning>` **之后**的东西一律不要 ——
       实测模型会在推理段结束后又补一句「（补充说明：黑棋S8这…」然后被停词截断，
       那半句读起来像程序漏了字。原来只删标签、不删标签后面的内容。
       ⚠️ 必须先砍、再删标签（顺序反了就找不到这个标记了）。 */
    .replace(/<\/reasoning>[\s\S]*$/i, '')
    .replace(/<\/?reasoning>/gi, '')
    .replace(/<\/?answer>/gi, '')
    .replace(/\\boxed\{[^}]*\}/g, '')
    /* ★ 2026-10-13：「让我仔细看看这个局部的棋形。」这类**过渡句** ——
       本身零信息量，但它后面跟的往往是**真正的理由**。
       所以**不能**让 trimCoachTail 从它那儿往后砍（实测砍完只剩「这手有问题啊。」
       7 个字，然后被判太短、白跑一次重试）。这里只把这句本身抹掉，后面留着。 */
    .replace(/(让(我|我们)|我来)[^。！？\n]{0,10}(看看|瞧瞧|想想|分析|研究|琢磨)[^。！？\n]{0,18}[。！？：:]?/g, '')
    /* ★★ 2026-10-12（整盘 217 手实测）：**动作/神态旁白**。
       81 手出现了「（对着棋盘沉思片刻）」「（轻笑着摇头）」「（指着棋盘左侧）」
       「（模拟对局）」「（快速摆了几个变化）」这类东西 —— 模型把讲解写成剧本了。
       用户要的是讲棋，不是旁白，一律清掉（全篇清，不只开头）。
       判据里只放明确的"表演"词，不动正常的说明性括号（比如「（也就是三三）」）。
       ⚠️ **必须排在下面那条"去掉开头括号"之前** —— 实测踩过：先吃掉开头的「（」，
          成对匹配的正则就再也匹配不上，只剩下一个孤零零的「对着棋盘沉思片刻）」。
       ★ 2026-10-13 补词：又抓到「（突然坐直身体）」「（摸着下巴思考）」
         「（自信地拍扇子）」「（拍手）」「（叹气）」「（补充说明…）」—— 词表加长。 */
    .replace(/[（(][^（()）]{0,20}(棋盘|沉思|沉吟|观察|模拟|点头|摇头|微笑|皱眉|苦笑|耸肩|摊手|叹气|敲打|拍手|拍桌|拍扇|坐直|摸着|盯着|看着|指着|摆了几?个|快速摆|自信地|站起身|补充说明|自言自语|轻笑|用教学语气|拿起扇子|摇动|语气|开始分析|提高声调|提高音量|压低声音|总结性地|清了清嗓子|顿了顿|停顿)[^（()）]{0,20}[)）]/g, '')
    /* ★ 2026-10-13 夜 DSH 补：**没闭合的左括号，连同它后面的内容一起删**。
       实测（第 1 手）：正文结尾写成
         「…形成均衡局面。 ⏎ （在星位对小目的对局中，白棋选择小目是常见的应对，…形成均衡局面。」
       —— 一个左括号开出去就没有收回来，读起来像程序漏了字。
       判据：`（` 或 `(` 之后**直到行尾都没有对应的右括号** → 整段删掉。
       ⚠️ 必须排在成对括号那条**之后**（成对的已经被处理掉了，剩下的才是残缺的）。 */
    .replace(/[（(][^（()）\n]*$/gm, '')
    /* ★ 2026-10-13：**变化图残渣**（连续多行、每行只是个短括号）整段砍掉。
       坐标被上面那两条去掉前缀之后，模型的变化图会剩成这个样子：
         ⏎  （打吃） ⏎  （长出） ⏎  （粘住） ⏎  （扳） …
       一整串光秃秃的括号，读起来莫名其妙（第 33、145 手就是）。
       判据：**连着 2 行以上**都是「行首 + 短括号」才算 —— 正常讲解里偶尔一个括号说明不受影响。 */
    .replace(/(\n[ \t]*[（(][^（()）]{1,14}[）)][ \t]*){2,}/g, '')
    /* ★ 2026-10-12 实测抓到：模型会模仿预填里那个「（」自己再写一个 ——
       正文开头变成「（黑棋第5手D16碰是常见手法…」，和前面拼好的
       「这一手 D16（黑棋第 5 手）下出来，」连起来读就是「…下出来，（黑棋…」，
       很怪。开头的孤立括号/方括号一律磨掉。 */
    .replace(/^[\s（(【\[]+/, '')
    /* ★★ 2026-10-12（整盘实测）：**模型自己编胜率数字**。
       要求里明写了"不要提胜率数字"，它照样写「这个变化下白棋胜率71.4%」。
       这些数**不是 KataGo 算的**，纯属编造，会跟界面上的真数据打架 ——
       所以含百分比的整句一律删掉。
       ⚠️ 安全：程序写的第二段对照句（bestPointNote，里面也有百分比）
         是在 coachTextReady **之后**才拼上去的，不会被这里误伤。 */
    .replace(/[^。！？；\n]*\d+(\.\d+)?\s*%[^。！？；\n]*[。！？；]?/g, '')
    /* ★ 推演变化图的残渣：像「5.X-R17」「78.O-J13」「X-D4」这种记谱 ——
       这是 LoGos 训练数据里的写法（X=黑 O=白，前面数字是第几手，后面是坐标）。
       ★★ 2026-10-13 改（首相报的「7一带」）：**不要整个删掉，只去掉 X-/O- 前缀**。
       原来是把整段抹成空格，实测踩到两个：
         · 「黑棋在 X-L17 一带」→ 「黑棋在  一带」（悬空的"一带"）
         · 「X-L1 7一带」→ 「7一带」（用户截图报的那个，完全看不懂）
       用户当初抱怨的其实只是「一个字母加横杠接坐标」这个**格式**看不懂
       （原话：「一个字母加-接一个坐标的是啥意思？」）—— 坐标本身是该留的。
       现在只把前缀去掉：「X-L17」→「L17」、「17.O-L17」→「L17」。 */
    .replace(/\d+\.\s*[XO]-([A-T]\d{1,2})/g, '$1')
    .replace(/[XO]-([A-T]\d{1,2})/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    /* 结尾只剩半个标点（「——」「，」「、」）说明这句被截断了 —— 磨掉，
       别让人看着像话没说完。 */
    .replace(/[，,、：:；;]+$/, '')
    .replace(/[—–-]+$/, '')
    .trim());
}

/* ---- 流式期间用的「温和清洗」（2026-10-14 首相实测报的「疯狂重置」）----
 *
 * 现象（首相原话）：「疯狂重置输出，先输出几个字然后又清空重新输出这几个字，
 *   然后再清空往复好几次，最后生成这个没有下文突然截断的东西。」
 *
 * 根因：流式每来一小段，都拿**完整清洗**（cleanCoachText）过一遍。而完整清洗里有
 *   好几条是**结构性删减**：
 *     · 未闭合的左括号，连同其后内容一起删（`（黑棋第 13 手` 这种半边话必然命中）
 *     · 连续的「行首 + 短括号」整段砍
 *     · 结尾的半个标点磨掉
 *     · 句子级去重复（判据要求"完整句子"，中途半句会误判）
 *     · 「让我看看」这类过渡句（中途可能只匹配到半截）
 *   **每一条都会让文本变短或改写**。而打字机的判据是「新文本必须是旧文本的延长」
 *   （makeTyper.put），一变短就 `el.textContent = ''` 清空重打 ——
 *   于是每来一小段就重置一次，看起来就是"疯狂重置"。
 *
 * 所以：**流式期间只剔除模型标签，一个字都不动正文**；
 * 上面那些收尾动作全部留给**定稿**（cleanCoachText）去做。
 * ⚠️ `</reasoning>` 那条留着是安全的：这个标记一旦出现就不会再变，最多砍一次。 */
function cleanCoachTextLive(s) {
  return String(s == null ? '' : s)
    .replace(/<\/reasoning>[\s\S]*$/i, '')
    .replace(/<\/?reasoning>/gi, '')
    .replace(/<\/?answer>/gi, '')
    .replace(/\\boxed\{[^}]*\}/g, '');
}


/* ---- 句子级去重复（2026-10-14 凌晨 · 首相实测报的）----
 *
 * 现象（首相原话）：「第一手的讲解出现大量重复句子，一个句子重复一二十遍。
 *   其他手都没出现，重讲第一手就没出现了。」
 *
 * 这是 7B 的**偶发退化**（重复循环），不是我们给的文本 —— 但**不能当"偶然"放过**：
 * 用户看到满屏同一句话，第一反应是"软件坏了"。
 *
 * 判据（刻意从严，宁可漏、不可误伤正常讲解）：
 *   · 按句末标点（。！？）切句；
 *   · 只处理**长度 ≥ 8 字**的句子 —— 短句像「好棋。」本来就可能连着说；
 *   · 只处理**连续重复**的（中间隔着别的句子的不算）—— 真退化就是连着刷；
 *   · 连续第 2 次起就丢掉，只留第一句（真退化是十几二十遍，一刀切掉）。
 *
 * 为什么用循环而不是正则：回溯引用（`(\S+)\1{2,}`）在长文本上会**灾难性回溯**，
 * 而且这里要按句切、还要看长度，用数组走一遍更直白、也好读。 */
function dedupeRepeatSentences(t) {
  const parts = String(t).split(/(?<=[。！？])/);
  if (parts.length < 3) return t;                 // 就一两句，不可能构成"重复十几遍"
  const out = [];
  for (const raw of parts) {
    const cur = raw.trim();
    if (cur.length >= 8 && out.length) {
      const prev = out[out.length - 1].trim();
      if (prev === cur) continue;                 // 与上一句完全相同 → 丢
    }
    out.push(raw);
  }
  return out.join('');
}

/* 它讲到后面总想「列候选 / 推演变化」，被停词截断后会剩半句话 ——
   这里做三件事，只留「结论 + 理由」：
     ① 砍掉「开始分析下一步」的尾巴（实测这些词一出现，后面就是推演）
     ② 砍掉「开始罗列第二/第三个方案」的尾巴 —— 用户要的是**这一个点**的讲解，
        候选清单本来就由 KataGo 给、写在标题上了，不需要它再列一遍
     ③ 最后砍到最后一个完整句子，别让人看着像话没说完（实测尾巴长这样：
        「……非常符合棋理。现在轮到白棋第6手，我需要考虑几个可能的选择：」） */
function trimCoachTail(t) {
  let s = String(t || '');
  /* ★★ 2026-10-12 整盘 217 手跑完之后的第三轮补：
     模型还是换着法子"替对方支招 / 推演变化图"，实测抓到的原句：
       「现在白棋有几个不错的选点值得考虑：」（第 39 手 —— 整段没讲 O10，全在教白棋）
       「现在白棋有几个不错的应对：」「如果选择D11粘，预计变化：粘/扳/扳/粘…」（第 85 手）
       「（模拟对局）如果白棋下在B10扳…」（第 109 手）
     这几句一个都没被老判据拦住。现在把"替对方规划"那一类的说法都收进来，
     再从 0 位置也开始砍（砍空了就交给 coachUsable 判不合格、重试）。 */
  /* ★★ 2026-10-13 第三轮（跑完整盘 + 逐手抽查之后）：
     ① 补上实测漏掉的换皮说法 ——「白棋**现在**有几个主要选择」（原来只认「白棋有几个」，
        中间插个「现在」就漏了）；
     ② **把过渡词从这条判据里挪走**：`让我看看 / 让我仔细 / 让我们 / 我来看看` 这类
        本身没信息量，但它后面跟的往往是**真正的理由** —— 实测从它那儿砍，
        正文只剩「这手有问题啊。」7 个字，然后被判太短去重试（白跑一趟）。
        现在过渡句交给 cleanCoachText 只抹掉句子本身，后面内容留着。 */
  const m1 = s.search(/(我需要|现在轮到|现在(黑棋|白棋)(有|可以|需要|该|应该)|(黑棋|白棋)(现在)?(有|可以)(几个|几种|多个)|有几个(主要|关键)?(选择|应对|选点|下法|办法|要点)|值得考虑|可以考虑|可能的选择|可能的应对|应对选择|几种应对|应对方式|应对方案|预计变化|变化图|变化如下|我来分析|接下来我|下面我|我建议|建议(黑棋|白棋)|(黑棋|白棋)可以下在|(黑棋|白棋)现在可以|(黑棋|白棋)面临(几个|一个)|面临几个|几个关键|关键选择|几个主要选择|我仔细推演|我仔细计算|我推演|推演了|首先看|再看|这一手有(三|两|几)个(重要)?作用)/);
  /* ★ 2026-10-12：原来是 `m1 > 0` —— 匹配在**位置 0**（正文一开头就是
     「现在轮到白棋第6手，你是白棋…」）时**不砍**，实测就漏了这种。
     现在从 0 也砍：砍空了正好让 coachUsable 判不合格、触发重试。 */
  if (m1 >= 0) s = s.slice(0, m1);
  /* ★ 只把**真的是分点**的词当分点（2026-10-06 审查发现）：
     原来 `第二|第三` 是裸词，而围棋讲解里「第二线」「第三路」「第二个角」都是常用说法 ——
     一出现就把后面整段砍掉，句子只剩半截（而且看起来像模型自己写坏了，很难发现是这里砍的）。
     现在给这两个词加条件：后面**不能**接 线/路/手/个/种/局/盘/阶。
     `其次/再次/另外/另一种` 几乎只能是分点，保持原样。 */
  /* ★ 2026-10-13 加**数字分点**（`1. ` `2. ` 那种）。实测模型很爱用它，
     而且一用基本就是在"列对方的应手/变化"（替对方支招），原来只认「其次/再次/另外/第二/第三」，
     于是「1. 白棋下在J18粘住」「2. B10扳」这种整段留下来。
     只认**行首**的数字分点，正文里的「第1手」之类不受影响。 */
  const m2 = s.search(/(其次|再次|另外|另一种|另一个思路|或者考虑|也可以考虑|第二(?!线|路|手|个|种|局|盘|阶)|第三(?!线|路|手|个|种|局|盘|阶)|\n\s*[1-9][.、])/);
  if (m2 > 8) s = s.slice(0, m2);
  s = s.trim();
  const last = Math.max(s.lastIndexOf('。'), s.lastIndexOf('！'), s.lastIndexOf('？'));
  if (last > 0 && last < s.length - 1) s = s.slice(0, last + 1);
  return s.trim();
}

/* 预填是条件句「如果白棋下在C3，」，模型接着写「那么黑棋很可能……」——
   渲染时把预填那半句拼回去，读起来才是一句完整的话。

   ★ 2026-10-08：多了一种开头 `head`（给「分析讲解」用）——
     那种场景下问的是**实际下出来的那一手**，所以要写成「这一手 X（...）下出来，」
     而不是「如果下在 X，」。不传 head 时保持老行为（推荐落点讲解走这条）。 */
function fixCoachHead(t, point, color, head) {
  const pre = head || ('如果' + (color === 'b' ? '黑棋' : '白棋') + '下在' + point + '，');
  return pre + String(t || '');
}

/* 一段最终要上屏的讲解：清洗 → 去尾 → 补开头 */
function coachTextReady(raw, point, color, head) {
  return fixCoachHead(trimCoachTail(cleanCoachText(raw)), point, color, head);
}

/* 这段讲解"能不能用"？——不行就重试一次（两次里挑可用的）。
   ★ 判据：**第一句得说完整**（前 60 字里要有句号/问号/叹号），且不能太短。
   实测它有两个失手方式：① 只吐半句就停（「如果黑棋下在R16，」）
   ② 整段都是变化图推演、一句完整的话都没有
      （批量讲解里见过 61 个字全是「…下在X，Y下在Z，…那么」）。 */
function coachUsable(t) {
  const s = String(t || '');
  /* ★ 2026-10-12：门槛从 40 提到 70 —— 实测有些手只吐出「这手有问题啊！」这种
     一句话就完事的（整盘跑完首相一眼就看出来了：**只有结论、没有理由，也没说会怎样**）。
     那一句确实"有个句号"、40 字也确实够，但它对用户毫无价值 → 现在判不合格、重试。
     注意这是对**含开头那半句的完整文本**判的（开头就有 20 多字），
     所以 70 字 ≈ 模型至少写了 45 字。 */
  return s.length >= 70 && /[。！？]/.test(s.slice(0, 60));
}

/* ---------- 打字机：让讲解「按字出来」 ----------
   用户反馈：直接把流式片段贴上去是「隔好多才出一段」——因为网络会把几个 token
   攒成一块再给。所以这里不贴片段，而是记住**累计文本**，自己按固定速度一个字
   一个字往外放；新出现的字带淡入（由淡转实）。
   速度定得比模型快（80 字/秒 vs 模型约 30），所以永远追得上，不会越等越久。 */
function makeTyper(el) {
  let target = '';
  let shown = 0;          // 已经「放」到第几个字
  let painted = 0;        // 已经画进 DOM 的第几个字
  let raf = 0;
  let lastTs = 0;
  let wantFinish = false;
  const CPS = 80;

  function put(s) {
    s = String(s == null ? '' : s);
    /* 新文本不是旧文本的延长 → 内容被改写了（清洗/替换），重来一遍 */
    if (!s.startsWith(target.slice(0, Math.min(target.length, s.length)))) {
      target = s; shown = 0; painted = 0; el.textContent = '';
    } else {
      target = s;
    }
    /* ⚠️ 必须夹住 shown：清洗会把结尾的半个标点磨掉，target 可能比已经放出去的字**还短**——
       不夹的话 paint() 会越界去读 target[painted]，画出空字。 */
    if (shown > target.length) shown = target.length;
    if (painted > target.length) painted = target.length;
  }

  function paint() {
    const n = Math.floor(shown);
    while (painted < n) {
      const sp = document.createElement('span');   // 每个字一个 span —— 带淡入动画
      sp.className = 'just';
      sp.textContent = target[painted];
      el.appendChild(sp);
      painted += 1;
    }
  }

  function solidify() {                            // 定稿：整段变成普通文本（顺手清掉那一堆 span）
    el.textContent = target;
    painted = target.length;
  }

  function tick(ts) {
    raf = 0;
    const dt = lastTs ? Math.min(150, ts - lastTs) : 16;
    lastTs = ts;
    if (shown < target.length) {
      shown = Math.min(target.length, shown + CPS * dt / 1000);
      paint();
      raf = requestAnimationFrame(tick);
    } else if (wantFinish) {
      solidify();
    }
  }

  function ensure() {
    if (!raf && shown < target.length) { lastTs = 0; raf = requestAnimationFrame(tick); }
  }

  return {
    setTarget(t) { put(t); ensure(); },
    finish(finalText) {
      if (typeof finalText === 'string') put(finalText);
      wantFinish = true;
      if (shown >= target.length) solidify();      // 已经放完了 → 直接定稿
      else ensure();                               // 还差几个字 → 让它放完，放完时自动定稿
    },
  };
}

/* 讲解的流式渲染：主进程每收到一小段就推一次（带 id）——
   这里按 id 找到对应的打字机，把**累计文本**喂给它。
   ★ 2026-10-14：这里必须用 **cleanCoachTextLive**（只剔标签、不动正文），
     不能用完整清洗 —— 完整清洗会让文本变短/改写，打字机就会清空重打，
     用户看到的是"疯狂重置"。详见 cleanCoachTextLive 的头注释。 */
const coachTypers = new Map();
if (window.api && window.api.coach && window.api.coach.onProgress) {
  window.api.coach.onProgress(d => {
    const t = coachTypers.get(d.id);
    if (t) t.setTarget(cleanCoachTextLive(d.full));
  });
}

/* ★ 坐标校验：实测它偶尔会把坐标写歪（传 A1，它写「白棋下在A13位置」）。
   规则：只看**最前面那十几个字**里的第一个坐标 —— 那里若出现坐标，
   就必须是我们给的那个点，否则整段作废。开头没提坐标就通过。
   ⚠️ 不能全文搜：它顺口说一句「和 C3 呼应」是很正常的，全文搜会误伤 ——
      第一版就是那么写的，实测 4 段里误杀了 3 段（只因为正文里提了别的子）。 */
function coordOk(text, point) {
  const head = String(text || '').slice(0, 18).toUpperCase();
  const m = head.match(/[A-HJ-T]\d{1,2}/);
  if (!m) return true;                       // 开头没提坐标 → 通过
  return m[0] === point.toUpperCase();
}

/* 问一次 LoGos。回来的序号对不上就说明已被新请求取代 → 丢弃（「覆盖」就是这么做出来的）。
   传了 typer 就把它登记到 id 上 —— 流式片段会喂给这个打字机（见上面的 onProgress）。 */
async function coachAsk(prompt, maxTokens, typer) {
  const id = ++coachSeq;
  if (typer) coachTypers.set(id, typer);
  try {
    const r = await window.api.coach.explain({
      id: id,
      prompt: prompt,
      maxTokens: maxTokens || 320,
      temperature: 0.3,
      stop: COACH_STOP,
    });
    if (id !== coachSeq) return null;
    return r;
  } finally {
    coachTypers.delete(id);
  }
}

/* ---------- 小工具 ---------- */
function mkEl(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  d.textContent = text == null ? '' : text;
  return d;
}
function resetCoachBtn(which) {
  /* ★ 全盘讲解期间不许点亮 —— 那两个按钮这时是灰的（防止插队抢通道），
     被这里的 finally 点亮就白挡了（2026-10-05 审查发现）。 */
  if (state.coach.batch) return;
  const b = $(which === 'explain' ? 'btn-explain' : 'btn-pick');
  if (!b) return;
  b.disabled = false;
  b.textContent = which === 'explain' ? '讲解这手' : '生成讲解';
}

/* ---------- 按**当前手数**刷新两个框 ----------
   切换手数、讲解完成、开新局 —— 都走这里。
   ★ 为什么必须按手数取内容：用户报过两个 bug ——
     ① 讲完第 2 手点回第 1 手，框里还挂着第 2 手的讲解（和眼前这一手对不上）；
     ② 讲完第 6 手再点回第 2 手，第 2 手的讲解直接没了。
     现在每手各存一份，切到哪手显示哪份，没有就写「这一手还没有讲解」。 */
let coachRenderedAt = -999;
function pickPositionKey(at) {
  return JSON.stringify([N, settings.rules, settings.komi, state.setup, state.moves.slice(0, at)]);
}
function renderPickContext() {
  const rec = state.coach.pickPending || state.coach.pick;
  const el = $('pick-context');
  const stale = !!rec && rec.positionKey !== pickPositionKey(state.viewAt);
  el.hidden = !rec;
  el.classList.toggle('is-stale', stale);
  el.textContent = rec
    ? '第 ' + rec.at + ' 手后 · ' + (rec.side === 'b' ? '黑方' : '白方') + ' · '
      + (state.coach.pickPending ? '正在生成讲解快照' : '讲解快照')
      + (stale ? ' · 当前局面已变化' : '')
    : '';
}
function renderCoachPanels(force) {
  renderPickContext(); // 生成期间也更新上下文，不重绘打字机正文
  const at = state.viewAt;
  if (!force && at === coachRenderedAt
      && state.coach.busy.explain !== at && state.coach.busy.pick !== at) return;
  coachRenderedAt = at;

  /* 正在生成的那一手已经不是当前这一手了 → 掐断（用户切走了，
     别再往已经离开屏幕的元素上画）。
     ⚠️ 只对**分析讲解**做 —— 它跟手数走，切走了就该停；
        选点讲解不跟手数走（就是一份留在那儿的快照），切手数不打断它。 */
  if (state.coach.busy.explain >= 0 && state.coach.busy.explain !== at) {
    coachSeq++; state.coach.busy.explain = -1; resetCoachBtn('explain');
  }

  /* 分析讲解 */
  if (state.coach.busy.explain !== at) {
    const box = $('explain-body');
    if (box) {
      const rec = state.coach.explain[at];
      box.textContent = '';
      if (rec) {
        box.appendChild(mkEl('div', 'pnt', rec.head));
        if (rec.verdict) box.appendChild(mkEl('div', rec.ok ? 'ph vok' : 'ph', rec.verdict));
        if (rec.lead) box.appendChild(mkEl('div', 'ph', rec.lead));
        box.appendChild(mkEl('div', '', rec.body));
      } else {
        box.appendChild(mkEl('div', 'ph', at > 0
          ? '这一手还没有讲解 —— 点上面「讲解这手」。'
          : COACH_PH_EXPLAIN));
      }
    }
  }

  /* 选点讲解 —— **不跟手数走**：始终显示存下来的那一份。
     如果它讲的是别的局面（用户切过手数），上面加一行小字标出对应手数，
     免得和眼前的局面混淆。正在生成时别动 DOM（打字机正往上画）。 */
  if (state.coach.busy.pick < 0) {
    const box = $('pick-body');
    if (box) {
      const rec = state.coach.pick;
      box.textContent = '';
      box.appendChild(mkEl('div', 'src', '点由 KataGo 定 · 讲解由 LoGos 写 · 基于点击那一刻的推荐落点'));
      if (rec && rec.pts && rec.pts.length) {
        rec.pts.forEach(p => {
          box.appendChild(mkEl('div', 'pnt', p.title));
          box.appendChild(mkEl('div', '', p.body));
        });
      } else if (state.fromRecord || !state.moves.length) {
        box.appendChild(mkEl('div', 'ph', COACH_PH_PICK));
      } else {
        box.appendChild(mkEl('div', 'ph', '还没生成讲解 —— 点上面「生成讲解」。'));
      }
    }
  }
}

/* 开新局 / 换棋谱时清空（用户要求：讲解只在对局期间保留）。
   注意它是被 applyNewGame / applyRecord 调的 —— 那两个是函数声明、已提升。 */
function clearCoachPanels() {
  coachSeq++;                                   // 作废还在飞的那条
  state.coach.busy = { explain: -1, pick: -1 };
  state.coach.explain = {};
  state.coach.pick = null;
  state.coach.pickPending = null;
  resetCoachBtn('explain');
  resetCoachBtn('pick');
  /* 「全盘讲解」只在**打开棋谱**时出现（用户要求） */
  if ($('btn-batch')) $('btn-batch').hidden = !state.fromRecord;
  coachRenderedAt = -999;
  renderCoachPanels(true);
}

/* ---------- 选点讲解 ----------
   点位和胜率**全部取自 KataGo 的候选点**（state.candidates，就是棋盘上画的那几个）
   —— 点击时同源；之后棋盘继续实时更新，文字保留点击时的快照。
   LoGos 只负责给每个点补一句「为什么这么下」。 */
async function runPickExplain() {
  if (state.coach.busy.pick >= 0) { flash('正在讲，稍微等一下…'); return; }
  /* ★ 两条讲解共用**一条** LoGos 通道（每次请求会掐掉上一条），
     所以同一时刻只能有一条在跑 —— 否则后点的会静默把先点的打断（审查发现）。 */
  if (state.coach.busy.explain >= 0) { flash('「分析讲解」正在讲 —— 等它讲完再来点推荐点'); return; }
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 等它跑完，或点进度条旁边的「停止」'); return; }
  if (needEngine('coach', '推荐落点讲解')) return;
  if (state.noGame || !state.moves.length) { flash('先落几手，再来问「该走哪」'); return; }
  if (state.fromRecord) { flash('打谱时不讲选点 —— 那是别人的棋，不替人支招'); return; }
  if (!engineReady) { needEngine('analyze', '推荐落点讲解'); return; }
  if (state.candAt !== state.viewAt || !state.candidates.length) {
    flash('KataGo 还在算这个局面 —— 等推荐点出来再点');
    return;
  }

  const at = state.viewAt;                           // ★ 讲的是哪个局面（存下来时要标出来）
  const pts = state.candidates.slice(0, 4);          // 用户要求：不能只给一个
  setHintsVisible(true);                            // 看推荐讲解时同步显示盘上的点
  const board = boardAt(at);
  const moves = state.moves.slice(0, at);
  const side = sideToMove(at);
  const sideTxt = side === 'b' ? '黑' : '白';

  const body = $('pick-body');
  body.textContent = '';
  body.appendChild(mkEl('div', 'src', '点由 KataGo 定 · 讲解由 LoGos 写 · 基于点击那一刻的推荐落点'));
  const btn = $('btn-pick');
  state.coach.busy.pick = at;
  const snapshot = { at, side, positionKey: pickPositionKey(at), gen: gameGen };
  state.coach.pickPending = snapshot;
  renderPickContext();
  btn.disabled = true;
  btn.textContent = '讲解中…';
  const collected = [];                              // 讲完的点（存起来，切手数也还在）
  try {
    for (let i = 0; i < pts.length; i++) {
      const c = pts[i];
      const pt = toGTP(c.x, c.y);

      /* 先把这一点的标题放上去（内容随后填）—— 让人立刻看到「有几个点、都在讲」 */
      const wrap = document.createElement('div');
      const h = document.createElement('span');
      h.className = 'pnt';
      /* 标题里明写「推荐」二字 —— 和棋盘上那几个虚线圆圈是同一批点，
         但不能让人误以为已经落子了（正文里是「如果下在这里…」）。 */
      h.textContent = '推荐 ' + (i + 1) + ' · ' + pt + '（胜率 ' + (c.win * 100).toFixed(1) + '%）';
      const p = document.createElement('div');
      wrap.appendChild(h);
      wrap.appendChild(p);
      body.appendChild(wrap);
      const typer = makeTyper(p);       // 每个点一个打字机（各写各的）

      const prompt = coachPrompt(moves, board, side, pt);
      let r = await coachAsk(prompt, 320, typer);
      if (!r) break;                                   // 被新请求取代了 → 收工
      let txt = coachTextReady(r.text, pt, side);
      /* 坐标对不上（它讲的是别的点）→ 重来一次；再不行就**照原样给** ——
         内容本身一般还是有用的，给个空白反而更糟（实测约四次里出错一次）。 */
      if (!r.error && !coordOk(trimCoachTail(cleanCoachText(r.text)), pt)) {
        const r2 = await coachAsk(prompt, 320, typer);
        if (!r2) break;
        /* ★ 复检必须用**没补前缀**的文本（2026-10-06 审查发现）：
           `coachTextReady` 会在开头补上「如果白棋下在<pt>，」，而 coordOk 抓的是
           前 18 字里第一个「字母+数字」—— 抓到的**永远是我们自己补的那个正确坐标**，
           于是这次复检恒为真（等于没检查）：第二次哪怕讲错了点，也照样被采用。
           第一次的复检用的是 cleanCoachText（没补头）所以是对的 —— 这里跟上它。 */
        const clean2 = trimCoachTail(cleanCoachText(r2.text));
        const t2 = coachTextReady(r2.text, pt, side);
        if (coordOk(clean2, pt)) txt = t2;
      }
      const finalTxt = r.error
        ? ('（讲不出来：' + r.error + '）')
        : (txt || '（这段没讲出东西，再点一次试试）');
      typer.finish(finalTxt);
      collected.push({ title: h.textContent, body: finalTxt });
    }
  } finally {
    /* ★ 只清「自己那一手」的标记：可能用户已经切到别的手、并在那里起了新的一段，
       无条件清会把新那段的标记抹掉（审查发现）。 */
    if (state.coach.busy.pick === at) state.coach.busy.pick = -1;
    if (state.coach.pickPending === snapshot) state.coach.pickPending = null;
    resetCoachBtn('pick');
  }
  /* 几个点都讲完了才存（中途被切走/掐断就不存，免得留下半份）。
     ★ 存成**一份快照**、不按手数存 —— 用户要求：切手数时「显示刚才讲解的就行」。 */
  if (snapshot.gen === gameGen && collected.length === pts.length) state.coach.pick = { ...snapshot, pts: collected };
  renderCoachPanels(true);
}

/* ---------- 分析讲解 ----------
   点评「当前显示的那一手」，拆成两半（见文件头的铁律）：
     · 好不好 → KataGo 的目损 / 胜率涨跌（客观，不会瞎夸）
     · 为什么 → LoGos 讲「这一手**之前**的局面，AI 当时想下哪」 */
function handVerdict(at, m) {
  /* 口径就用「这一手让**下棋方**的胜率变化了多少」——
     和手数列表里那个「涨跌」完全一致，用户看着不会打架。
     （复盘的目损虽然更准，但那是另一套数，混着用反而让人对不上。） */
  const h = state.history[at], prev = state.history[at - 1];
  if (typeof h === 'number' && typeof prev === 'number') {
    const d = (h - prev) * 100 * (m.color === 'b' ? 1 : -1);
    if (Math.abs(d) < 0.05) return { txt: '几乎不亏不赚', loss: 0, grade: 0 };
    if (d > 0) return { txt: '赚了 ' + d.toFixed(1) + '% 胜率', loss: 0, grade: 0 };
    const loss = -d, g = vGrade(loss);
    /* 首相要求「胜率巨额波动要讲」—— 明显失误往上的，标题上直接点明，
       不只给一个数字（光看「亏了 11.4%」对不懂棋的人没有分量）。 */
    const tag = g >= 3 ? '严重失误 —— ' : (g === 2 ? '明显失误 —— ' : '');
    return { txt: tag + '亏了 ' + loss.toFixed(1) + '% 胜率', loss: loss, grade: g };
  }
  return null;
}

async function runAnalysisExplain() {
  if (needEngine('coach', '分析讲解')) return;
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 等它跑完，或点进度条旁边的「停止」'); return; }
  /* 两条讲解共用一条 LoGos 通道 → 同一时刻只允许一条（见 runPickExplain 的注释）。 */
  if (state.coach.busy.pick >= 0) { flash('「推荐落点讲解」正在讲 —— 等它讲完再来'); return; }
  if (state.coach.busy.explain >= 0) { flash('上一段讲解还在生成，稍等…'); return; }
  const at = state.viewAt;
  if (at <= 0) { flash('先用底栏的回看跳到某一手，再来讲'); return; }
  const m = state.moves[at - 1];
  const sideTxt = m.color === 'b' ? '黑' : '白';
  const pt = m.pass ? '停一手' : toGTP(m.x, m.y);

  const body = $('explain-body');
  body.textContent = '';
  const head = document.createElement('div');
  head.className = 'pnt';
  head.textContent = '第 ' + at + ' 手 · ' + sideTxt + ' ' + pt + (state.viewAt === state.moves.length ? '' : '（回看中）');
  const verdict = document.createElement('div');
  verdict.className = 'ph';
  verdict.textContent = '看看这手怎么样…';
  const why = document.createElement('div');
  body.appendChild(head);
  body.appendChild(verdict);
  body.appendChild(why);

  const btn = $('btn-explain');
  btn.disabled = true;
  btn.textContent = '讲解中…';
  state.coach.busy.explain = at;
  const gen = gameGen;      // ★ 这段讲解发起于哪一局/哪条线（退出试下会推进代次，见 exitDraft）
  let saved = null;                        // 完整生成成功才存（中途被打断就不存）
  try {
    /* ① 客观评价 —— 只有 KataGo 说了算 */
    const v = handVerdict(at, m);
    const verdictTxt = v ? v.txt : '（KataGo 还没算到这一手 —— 先让它把这一带算一遍）';
    verdict.textContent = verdictTxt;
    if (v && v.loss <= 0.05) verdict.className = 'vok';

    /* ② 道理 —— 交给 LoGos 讲「这一手之前的局面，AI 想下哪」 */
    if (!engineReady) {
      why.textContent = '（想听「为什么」，得先把 KataGo 加载起来 —— 它要先算一下当时的局面）';
      return;
    }
    const before = state.moves.slice(0, at - 1);
    const res = await window.api.analyze({
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: before.map(mv => [mv.color === 'b' ? 'B' : 'W', mv.pass ? 'pass' : toGTP(mv.x, mv.y)]),
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: Math.max(120, Math.round((settings.visits || ANALYZE_VISITS) / 2)),
    });
    /* ⚠️ 候选点在 res.moves（主进程从引擎的 moveInfos 转出来的），
       **不在** res.root 里 —— res.root 只是 rootInfo（winrate/scoreLead/visits）。 */
    const list = ((res && res.moves) || [])
      .filter(x => x && x.move && (x.visits || 0) >= 2)
      .sort((a, b) => b.winrate - a.winrate);
    const best = list[0];

    if (!best) {
      why.textContent = '（KataGo 没算出候选点，可能是这个局面已经结束了）';
      return;
    }
    const same = (best.move || '').toUpperCase() === pt.toUpperCase();
    const lead = document.createElement('div');
    lead.className = 'ph';
    /* ★ 2026-10-12：这一行**只交代「AI 想下哪 / 你实际下了哪」**，
       胜率挪到正文末尾那句对照（bestPointNote）—— 同一个数字在一只框里
       出现两遍没必要（首相反馈：上面那行已经写了，下面又说一遍）。
       下错了的时候**必须把"你实际下了哪"写出来** —— 原来只写「AI 当时更倾向 D8」，
       用户会以为下面那段讲的是 D8（而它确实讲错过，见 coachPromptActual 的注释）。 */
    const leadTxt = same
      ? ('AI 当时想下的也是这里（' + best.move + '）。下面讲这一手：')
      : ('AI 当时想下的是 ' + best.move + '；实际下的是 ' + pt + '。下面讲实际这一手：');
    lead.textContent = leadTxt;
    body.insertBefore(lead, why);

    const typer = makeTyper(why);
    /* ★★ 讲的是**实际下的那一手（pt）**，不是 AI 推荐的那一手 —— 2026-10-08 修 bug。
       原来这里无论哪种情况都传 `best.move`（AI 想下的点），于是「分析讲解」实际输出的是
       「如果下在 AI 推荐点会怎样」，而用户问的是「我这一手怎么样」。
       用户实测撞到：自己第 83 手亏 0.1%，讲解却整段在讲 AI 想下的 D8 —— 风马牛不相及。
       ★★ 2026-10-12 再修一次（首相实测）：光把"点"改对还不够，**盘面也得跟着改** ——
       原来盘面给的是 `boardAt(at-1)`（这一手之前），在那个局面上正好轮到下棋方走，
       模型于是去列候选点、讲的全是别的点。详见 coachPromptActual 的注释。 */
    const explainHead = '这一手 ' + pt + '（' + sideTxt + '棋第 ' + at + ' 手）下出来，'
      + verdictLead(v, at);
    const ask = () => coachAsk(
      coachPromptActual(state.moves.slice(0, at), boardAt(at), m.color, at,
        m.pass ? -1 : m.x, m.pass ? -1 : m.y, explainHead, verdictTone(v)),
      520, typer);
    let r = await ask();
    if (!r) return;
    /* ★ 被取消时 main.js 会把**已收到的半截文本**带 `aborted: true` 回来
       （unload 引擎、或这条请求被后一条取代时会走到）。这时：不重试、不入库 ——
       半截文本有可能「够长 + 前 60 字有句号」而被当成完整讲解存进
       `.coach.json`，之后永不重讲（2026-10-06 审查发现：aborted 这个标记一直没人看）。 */
    if (r.aborted) { typer.finish('（已取消）'); return; }
    let txt = coachTextReady(r.text, pt, m.color, explainHead);
    /* 太短 / 第一句没说完 → 重来一次；两次里挑能用的（都好就取长的）。 */
    if (!r.error && !coachUsable(txt)) {
      const r2 = await ask();
      if (r2 && !r2.error) {
        const t2 = coachTextReady(r2.text, pt, m.color, explainHead);
        if (coachUsable(t2) || t2.length > txt.length) { txt = t2; r = r2; }
      }
    }
    /* ★ 第二段：AI 当时更倾向的那个点（程序写，见 bestPointNote 的注释）。
       好棋（loss < 0.5）时它是空串 —— 没什么可对照的，硬写只会显得啰嗦。 */
    const note = bestPointNote(best, v, sideTxt);
    const finalTxt = r.error ? ('（讲不出来：' + r.error + '）')
      : (txt ? (txt + (note ? '\n\n' + note : '')) : '（这段没讲出东西，再点一次试试）');
    typer.finish(finalTxt);
    if (!r.error && txt) {
      saved = {
        /* ★ 讲解格式的版本号 —— 改了 prompt / 讲解结构就 +1，
           读缓存时版本对不上的当"没讲过"（不然老棋谱里存着旧讲解，
           用户永远看不到修好的版本）。见 coachVerOK()。 */
        cv: COACH_VER,
        head: head.textContent, verdict: verdictTxt, ok: !!(v && v.loss <= 0.05),
        lead: leadTxt, body: finalTxt,
      };
    }
  } finally {
    /* 同上：只清自己那一手（用户可能已切手数并在那儿起了新的一段）。 */
    if (state.coach.busy.explain === at) state.coach.busy.explain = -1;
    resetCoachBtn('explain');
  }
  /* ★ 存到「第 at 手」名下 —— 切到别手再切回来还能看到（用户报的问题②）。
     分析讲解**按手数存**（它点评的就是第 at 手本身），和选点讲解的存法不一样。
     ★★ 但只有**代次没变**才存（2026-10-13）：草稿从主线中间岔出去，
     草稿手的手号与还原后的正式手**重叠** —— 期间若退出试下（exitDraft 推进代次），
     这段讲的是草稿手，写回 explain[51] 会把讲解挂到正式的第 51 手名下。作废不写。 */
  if (saved && gen === gameGen) { state.coach.explain[at] = saved; renderCoachPanels(true); }
}

/* ==================== 全盘讲解（2026-10-05 用户要求）====================
   打开棋谱后，一次把整盘逐手讲完，结果**存进这份棋谱旁边**
   （<棋谱名>.coach.json，见 main.js 的 coachPath）——
   下次打开这份棋谱直接就能看，不用重跑。

   分两段（进度条上会看出在哪一段）：
     ① KataGo 把整盘逐手算一遍 —— 一次请求拿全（复用「复盘」那条通路），
        得到每手的「AI 当时首选」+ 胜率。
        ★ 为什么非要它：LoGos 讲的是「AI 当时想下哪、为什么」，
          那个点必须由 KataGo 定 —— 让 LoGos 自己选点，实测会把角上一路
          （T19 / A1）说成好棋，那是硬错。
     ② LoGos 逐手讲 —— 每手一次请求，约 2~4 秒。

   ★ 已经讲过的手**跳过**：所以点「停止」之后再来一次，是接着往下讲，不从头。
   ★ 不用打字机：那是给「盯着它一个字一个字写」用的；这里要跑几分钟，
     用户早切到别的手去看别的了。 */
let batchStop = false;

/* 进度条：on=false 收起；否则按 done/total 画，txt 不传就显「3 / 20」 */
function setBatchBar(on, done, total, txt) {
  const bar = $('batch-bar');
  if (!bar) return;
  bar.hidden = !on;
  if (!on) return;
  $('batch-fill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  $('batch-txt').textContent = txt || (done + ' / ' + total);
}

/* 把内存里的逐手讲解落盘（<棋谱名>.coach.json）。
   list 的下标 = 手数（0 位空着），这样读回来能直接按手数对上。 */
function saveCoachFile() {
  if (!state.recName) return Promise.resolve(null);
  const list = [];
  for (let i = 0; i <= state.moves.length; i++) list.push(state.coach.explain[i] || null);
  /* ★ 2026-10-13：`cv` 也写进**顶层** —— 棋谱库列表只读文件头 400 字节判断版本，
     埋在 list 每一项里它读不到（见 main.js 的 coachVerOf）。
     ★ 同时写 `sg` = 主线手顺指纹（坑位 42 的方案 A）：讲解也是按手号存的，
     「覆盖」把棋谱换成另一盘之后，旧讲解挂在新内容上一样是错的 —— 读回来时先比这个。 */
  const json = JSON.stringify({ v: 1, cv: COACH_VER, sg: mainlineSig(), n: state.moves.length, list: list });
  try {
    return Promise.resolve(window.api.records.saveCoach(state.recName, json)).catch(() => null);
  } catch (e) { return Promise.resolve(null); }
}

/* ★★ 2026-10-13 用户要求：「KataGo 算完的每手胜率优劣能否保存，下次打开棋谱还能看到」。
   数据其实**一直在** `<棋谱名>.review.json` 里（`history` 每手胜率 / `leads` 每手目差 /
   `losses` 每手目损 / `visits` 那一档搜索量）—— 问题是**打开棋谱时根本没读它**：
   只有点「复盘报告」按钮（openSavedReview）或重跑「AI 复盘」才会填上。
   于是打开棋谱时手数列表的「涨跌」列和走势图都是空的，用户以为没保存。

   这里只把数据读回来填上，**不弹报告**（报告还是「复盘报告」按钮的事）。 */
async function loadReviewForRecord(name) {
  if (!name) return;
  const gen = gameGen;
  let rv = null;
  try {
    const cached = await window.api.records.readReview(name);
    if (!cached || !cached.text) return;
    rv = JSON.parse(cached.text);
  } catch (e) { return; }
  if (gen !== gameGen) return;          // 读盘期间换了棋谱 → 丢掉
  if (!rv || !Array.isArray(rv.history)) return;
  /* ★★ 坑位 42（2026-10-13 审查补，首相拍板方案 A 后升级为内容指纹）：
     附属文件是**按手号**存的，只核对长度拦得住"覆盖后手数变了"，拦不住"手数没变、
     只换了某一手的内容" —— 现在改成比**主线手顺指纹**（`mainlineSig()`）。
     口径：`history` 长 = 主线手数 + 1（含空盘那一格）。
     · 有 `sig` 且对不上   → 不填 + 如实提示（这是「覆盖」之后的主路径）；
     · 没 `sig`（老报告）  → 退回长度核对 —— 10-13 之前存的复盘无从核对，只能弱一档把关。
     不静默丢弃，也不硬凑到能画。 */
  if (rv.sig) {
    if (rv.sig !== mainlineSig()) {
      flash('这份棋谱旁边的复盘数据属于**覆盖前的内容**（手顺对不上）—— 没有显示，'
        + '重跑一次「AI 复盘」就有了');
      return;
    }
  } else {
    const want = state.moves.length + 1;
    if (rv.history.length !== want) {
      flash('这份棋谱旁边的复盘数据是 ' + (rv.history.length - 1) + ' 手的，和现在的 '
        + state.moves.length + ' 手对不上（棋谱改过？）—— 没有显示，重跑一次「AI 复盘」就有了');
      return;
    }
  }
  state.review = rv;
  if (!state.review.name) state.review.name = name.replace(/\.sgf$/i, '');
  state.review.file = name;
  state.history = rv.history.slice();
  if (Array.isArray(rv.leads)) state.leads = rv.leads.slice();
  /* 复盘的每一手都是同一档搜索量一起算的 → 精度标记按报告里记的那一档填 */
  state.histVisits = rv.history.map(() => rv.visits || reviewVisits());
  renderMoveList();
  renderCurve();
  /* 不 flash：打开棋谱本来就有「已打开棋谱 · N 手」，再弹一条会盖掉它。
     涨跌列一有数字，用户自然看得见。 */
}

/* 打开棋谱时把存下来的讲解读回来（用户要求：结果跟棋谱一起保存，下次打开还在） */
async function loadCoachForRecord(name) {
  if (!name) return;
  const gen = gameGen;
  let r = null;
  try { r = await window.api.records.readCoach(name); } catch (e) { return; }
  if (!r || !r.text || gen !== gameGen) return;      // 读盘期间换了棋谱 → 丢掉
  let data = null;
  try { data = JSON.parse(r.text); } catch (e) { return; }
  /* ★ 坑位 42 方案 A：逐手讲解同样是**按手号**存的 —— 棋谱被「覆盖」成另一盘之后，
     旧讲解挂在同一批手号上就是讲别的棋。先比主线指纹，对不上就当没有并说清楚。
     没有 `sg` 的是 2026-10-13 之前存的，无从核对，照旧放行（`cv` 那道版本闸还在）。 */
  if (data && data.sg && data.sg !== mainlineSig()) {
    flash('这份棋谱的逐手讲解属于**覆盖前的内容**（手顺对不上）—— 已收起，'
      + '重跑一次「全盘讲解」就跟得上现在这一盘');
    return;
  }
  const list = (data && data.list) || [];
  const box = {};
  let stale = 0;                        // 旧版式的（讲错了点的那批）
  for (let at = 1; at < list.length && at <= state.moves.length; at++) {
    const it = list[at];
    if (!it || !it.body) continue;
    if (!coachVerOK(it)) { stale++; continue; }
    box[at] = it;
  }
  const howMany = Object.keys(box).length;
  if (!howMany) {
    /* ★ 老棋谱里存着旧版式的讲解（2026-10-12 之前那批 —— 讲的是 AI 想下的点、
       不是实际这一手）。不能就这么拿给用户看，也别默默扔掉不说一声。 */
    if (stale) flash('这份棋谱的逐手讲解是旧版式的（讲的是别的点），已作废 —— 再点「全盘讲解」按新讲法重讲');
    return;                              // 存过但是空的 / 全是旧的 → 当没有
  }
  state.coach.explain = box;
  coachRenderedAt = -999;
  renderCoachPanels(true);
  flash('这份棋谱带着逐手讲解（' + howMany + ' 手）'
    + (stale ? '（另有 ' + stale + ' 手是旧版式的，已作废，重讲一遍会补上）' : '')
    + ' —— 点手数列表就能看');
}

/* 「正在等用户在询问窗里选」的占位标志。
   ★ 2026-10-14 加：没有它就会出首相实测踩到的那个现象 ——
   连点两次「全盘讲解」进来两次，第二次重建弹窗时把第一次那批按钮清掉，
   两个 Promise 都悬着，用户点哪个按钮都没反应。有了它，第二次直接婉拒。 */
let batchAsking = false;

/* ---- 全盘讲解开跑前的询问窗（2026-10-14 首相要求）----
 *
 * 首相原话（拆成三条规格）：
 *   ① 棋谱如果已经被 KataGo 全盘算过，点「全盘讲解」不该再重算一遍 ——
 *      **弹窗提示已有全盘 AI 胜率记录、说明这东西是干啥的、推荐跳过以省时间**；
 *   ② 如果没有任何现有讲解 → **别问，直接跑**；
 *   ③ 如果已经有讲解 → 弹窗问「从头重跑」还是「从未讲的手继续」；
 *      重跑 = 抹掉所有已有的，从第一手开始。
 *
 * 返回 Promise：`{ skipReview, fromScratch }`，取消则返回 null。
 * 为什么不复用 `confirm()`：Electron 里 confirm 是**阻塞式原生框**，
 * 会把整个渲染进程卡住（连进度条都不动），而且措辞没法控制 —— 首相要的是「说清这东西是干啥的」。 */
function askBatchPlan(info) {
  return new Promise(resolve => {
    const mask = $('batchask');
    if (!mask) { resolve(info.fallback || null); return; }
    /* ★★ 双保险（2026-10-14）：这个弹窗**正在被用着**时，绝不再重建。
       重建的后果就是首相实测踩到的那个 —— 上一批按钮被 `innerHTML=''` 清掉，
       两个 Promise 都悬着，界面上"点哪个按钮都没反应"。
       正常情况由 runBatchCoach 的 `batchAsking` 挡住；这里再兜一道，
       将来谁加了新入口（快捷键、菜单）也不会再犯。 */
    if (mask.classList.contains('open')) { resolve(null); return; }
    $('ba-title').textContent = info.title;
    $('ba-body').innerHTML = info.body;
    const acts = $('ba-actions');
    acts.innerHTML = '';
    const finish = v => { mask.classList.remove('open'); resolve(v); };
    for (const b of info.buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.className = 'primary';
      if (b.tip) el.title = b.tip;
      el.onclick = () => finish(b.value);
      acts.appendChild(el);
    }
    mask.classList.add('open');
  });
}

/* ---- 开跑前「要不要先问一句」以及问什么（2026-10-14 首相要求）----
 *
 * ★★ 2026-10-14 晚订正（首相实测报的）：
 *    第一版把两件事塞进**一个**弹窗，而且弹窗之前没有占位 —— 后果是
 *    ① 顺序不对：首相要的是「**先问要不要重算（胜率），再问要不要续跑（讲解）**」两个窗；
 *    ② 连点两次「全盘讲解」会进来两次，第二次把第一次弹窗的按钮 `innerHTML=''` 清掉，
 *       两个 Promise 都悬着 → **点哪个按钮都没反应**（首相报的正是这个）。
 *    现在拆成两个独立的窗、按顺序弹；重入由 `batchAsking` + 提前 `disable` 按钮挡住。
 *
 * 抽成**纯函数**（只读 state，不碰引擎、不弹窗）的两个理由：
 *   ① 好单测 —— 断言直接调它就能把各种情况全覆盖，不必真去跑整盘分析（那要几分钟）；
 *   ② runBatchCoach 只拿它的结果去弹窗，逻辑不再埋在长函数中间。
 *
 * 返回 null = **一个窗都不用弹**（两样都没有，首相要求直接开跑）；
 * 否则返回 { askReview, revBody, revButtons, askCoach, coachBody, coachButtons }。
 *
 * 三条规格（首相原话）：
 *   ① 已有整盘 AI 胜率记录 → 问「是否跳过重算」，说明它是干啥的，**推荐跳过**；
 *   ② 没有任何现有讲解 → **不问**，直接跑；
 *   ③ 已有讲解 → 问「从头重跑」还是「从未讲的手继续」；重跑 = 抹掉已有的、从第一手开始。 */
function batchAskInfo(n) {
  const doneAt = [];
  for (let at = 1; at <= n; at++) if (coachVerOK(state.coach.explain[at])) doneAt.push(at);
  const hasCoach = doneAt.length > 0;
  const hasRev = !!(state.review && state.review.file === state.recName
    && Array.isArray(state.review.history) && state.review.history.length > 1);
  if (!hasRev && !hasCoach) return null;               // ★ 都没 → 一个窗都不弹

  const estMin = Math.max(1, Math.round(n / 60));      // 粗估：整盘分析约 n/60 分钟

  /* ---------- 窗一：要不要重算整盘胜率（★ 先弹这个） ---------- */
  let askReview = false, revBody = '', revButtons = null;
  if (hasRev) {
    askReview = true;
    /* ★★ 2026-10-14（方案 C）：这份记录里到底有没有「AI 当时想下哪」（候选点）？
       有 → 跳过重算也能正常逐手讲；没有（v3 之前存的）→ **必须如实说**，
       并且把推荐项换成「重新算一遍」—— 否则用户选了"跳过"，结果讲不了，
       又是一次"什么都没有发生"（首相实测踩到的就是这个）。 */
    const hasCands = Array.isArray(state.review.cands) && state.review.cands.length > 1;
    revBody = '<div class="ba-li">这份棋谱旁边已经存着<b>整盘 AI 胜率记录</b>（'
      + (state.review.history.length - 1) + ' 手）。</div>'
      + '<div class="ba-li ba-dim">它是干什么的：KataGo 把整盘每一手都算过一遍之后的胜率，'
      + '用来标「这一手亏了多少」、也用来画右边那条走势图。</div>'
      + (hasCands
        ? '<div class="ba-li ba-dim">它里面<b>也存了「AI 当时想下哪」</b>，所以跳过重算也能正常逐手讲解，'
          + '<b>建议跳过</b>，省下重算的那 ' + estMin + ' 分钟。</div>'
        : '<div class="ba-li">⚠️ 这份记录是<b>旧版</b>存的 —— 里面<b>没有「AI 当时想下哪」</b>。'
          + '<span class="ba-dim">跳过重算的话，走势图和「亏了多少」都能用，但<b>逐手讲解讲不了</b>'
          + '（讲解必须知道 AI 当时想下哪儿）。想讲就选下面那个「重新算一遍」。</span></div>');
    revButtons = hasCands
      ? [
        { label: '跳过重算，用现成的', value: { skipReview: true }, primary: true,
          tip: '直接沿用已有的胜率记录，省下那几分钟' },
        { label: '重新算一遍（约 ' + estMin + ' 分钟）', value: { skipReview: false },
          tip: '只有怀疑这份记录过时了、或换了权重才需要' },
        { label: '取消', value: null },
      ]
      : [
        { label: '重新算一遍（约 ' + estMin + ' 分钟）', value: { skipReview: false }, primary: true,
          tip: '这份旧记录里没有「AI 想下哪」，要讲解就必须重算一遍' },
        { label: '跳过重算（这次讲不了）', value: { skipReview: true },
          tip: '沿用现成的胜率，只画走势图，不做逐手讲解' },
        { label: '取消', value: null },
      ];
  }

  /* ---------- 窗二：要不要续跑讲解（★ 后弹这个） ---------- */
  let askCoach = false, coachBody = '', coachButtons = null;
  if (hasCoach) {
    askCoach = true;
    coachBody = '<div class="ba-li">这份棋谱<b>已经讲过 '
      + doneAt.length + ' / ' + n + ' 手</b>，还剩 <b>' + (n - doneAt.length) + '</b> 手。</div>'
      + '<div class="ba-li ba-dim">「接着讲」会保留已经讲好的那些，只补还没讲的；'
      + '「从头重跑」会把已有讲解<b>全部作废</b>，从第一手重新讲一遍（费时间）。</div>';
    coachButtons = [
      { label: '接着讲没讲过的（还剩 ' + (n - doneAt.length) + ' 手）',
        value: { fromScratch: false }, primary: true,
        tip: '已经讲过的保留，只补还没讲的' },
      { label: '从头重跑（抹掉已讲的 ' + doneAt.length + ' 手）',
        value: { fromScratch: true },
        tip: '把已有讲解全部作废，从第一手重新讲一遍' },
      { label: '取消', value: null },
    ];
  }

  return { hasRev, hasCoach, doneAt, estMin, askReview, revBody, revButtons, askCoach, coachBody, coachButtons };
}

async function runBatchCoach() {
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 想停就点进度条右边的「停止」'); return; }
  /* ★ 反过来也要挡（2026-10-06 审查发现）：单条讲解（分析讲解 / 选点讲解）正在跑时，
     直接点「全盘讲解」会把在跑的那条**静默掐掉** —— 两条共用 coachSeq 通道，
     原来只有「批量挡单条」这一半（批量期间按钮被 disabled），反向漏了。 */
  if (state.coach.busy.explain >= 0 || state.coach.busy.pick >= 0) {
    flash('正在讲别的（分析讲解 / 推荐落点讲解）—— 等它讲完再点全盘讲解');
    return;
  }
  if (!state.fromRecord || !state.recName) { flash('先打开一份棋谱，再来做全盘讲解'); return; }
  /* ★ 试下（草稿）期间不做全盘讲解（2026-10-13 加「回看能试下」时补的闸）。
     全盘讲解是对 state.moves **整条线**算一遍再逐手讲，并把结果落盘到
     `<棋谱名>.coach.json` —— 草稿期间这条线含草稿手、且 from 之后的正式手
     收在快照里没在线上，跑出来的东西对不上这份棋谱，落盘就会污染棋谱。 */
  if (state.draft) { flash('试下（草稿）期间不做全盘讲解 —— 先点「退出试下」'); return; }
  /* ★ 全盘讲解只能站在**主变**上跑（2026-10-13 补，见交接文档任务 1）。
     它按**手号**把整盘结果写进 history/leads/explain 并落盘 <棋谱名>.coach.json，
     而旁支与主线的同一段手号指的是不同的棋 —— 在旁支上跑 = 把主线那份讲解覆盖掉。 */
  if (!currentPathIsMainline()) {
    /* ★ 2026-10-14：把「岔在第几手」报出来 —— 原来只说"这是分支"，
       首相实拍反馈「我已经选中主干，但上面显示这是分支」，根本定位不到岔口。 */
    const at = mainlineDivergenceAt();
    flash(at
      ? ('全盘讲解要站在主变上跑 —— 现在这条从**第 ' + at + ' 手**起就和主变不一样了。'
        + '按 ↑/↓ 切回主变；或者按 PgUp 把现在这一支直接提为主变')
      : '全盘讲解要站在主变上跑（现在这一条是分支）—— 按 PgUp 把这一支提为主变，或按 ↑/↓ 切回主变');
    return;
  }
  if (needEngine('coach', '全盘讲解')) return;
  if (needEngine('analyze', '全盘讲解')) return;
  const n = state.moves.length;
  if (!n) { flash('这份棋谱里没有手顺，讲不了'); return; }

  /* ★★ 2026-10-14 首相要求：**别白算** —— 已经算过的、已经讲过的，先问一句再动手。
     两个窗**按顺序**弹：① 要不要重算整盘胜率 → ② 要不要续跑讲解（首相明确要求这个顺序）。 */
  const ask = batchAskInfo(n);
  let skipReview = false;        // 默认「要算」；按用户在窗一里的选择改
  let fromScratch = false;       // 默认「接着讲」；按用户在窗二里的选择改
  const doneAt = ask ? ask.doneAt : [];
  if (ask) {
    /* ★ 重入保护：从「要弹窗了」这一刻就占住。
       不占的后果（首相实测踩到）：连点两次「全盘讲解」→ 第二次进来又把弹窗重建一遍，
       第一次那批按钮被 `innerHTML=''` 清掉 → **两个 Promise 都悬着，点哪个按钮都没反应**。 */
    if (batchAsking) { flash('上一步还没选完 —— 请在弹窗里点一个按钮'); return; }
    batchAsking = true;
    const wasDisabled = $('btn-batch').disabled;
    $('btn-batch').disabled = true;
    try {
      if (ask.askReview) {
        const r1 = await askBatchPlan({
          title: '全盘讲解 · 整盘胜率要不要重算？',
          body: ask.revBody, buttons: ask.revButtons, fallback: null,
        });
        if (!r1) return;                       // 取消
        skipReview = r1.skipReview;
      }
      if (ask.askCoach) {
        const r2 = await askBatchPlan({
          title: '全盘讲解 · 从哪里开始讲？',
          body: ask.coachBody, buttons: ask.coachButtons, fallback: null,
        });
        if (!r2) return;                       // 取消
        fromScratch = r2.fromScratch;
      }
    } finally {
      batchAsking = false;
      $('btn-batch').disabled = wasDisabled;
    }
  }

  const gen = gameGen;
  state.coach.batch = { done: 0, total: n };
  batchStop = false;
  $('btn-batch').disabled = true;
  $('btn-explain').disabled = true;      // 批量期间不许插队（会和批量抢 coachSeq）
  $('btn-pick').disabled = true;
  setBatchBar(true, 0, n, skipReview
    ? '沿用已有的整盘胜率，直接开始逐手讲解…'
    : '正在让 KataGo 把整盘算一遍…');
  /* 这一步占着引擎：把自动分析压住，否则两边抢同一个进程、谁也算不完。
     （同时靠 state.coach.batch 让「复盘进度」弹窗别冒出来 —— 见文件后面那条订阅。）
     ★ 2026-10-14：走 skipReview 时**根本不发请求**、不占引擎，所以不必置 reviewBusy。 */
  if (!skipReview) reviewBusy = true;
  try {
    /* ---------- ① KataGo：整盘逐手算一遍 ----------
       ★★ 2026-10-14 首相要求：已有胜率记录、且用户在弹窗里选了「跳过重算」→
          **这一步整个不跑**，直接用现有的 history / leads / histVisits（省下几分钟）。
          `turns` 在后面只用来定「讲到第几手」（超时兜底那段要看它的长度），
          所以这里造一个**等长的占位数组**就行 ——
          ⚠️ 不要伪造 winrate：那会被下面当成真数据写进 history。 */
    let turns;
    if (skipReview) {
      /* ★★ 2026-10-14 首相要求（方案 C）：从记录里**读回候选点** —— 这是"跳过重算还能讲"的关键。
         有候选点 → 照常逐手讲；没有（v3 之前的旧记录）→ 空占位 + 如实说明一句。
         ⚠️ 长度一律用 `n + 1`，**不要再拿 `state.history.length` 去推**：
            两者理论同步，但"讲到第几手"不该由它决定 —— 它缺了顶多某几手没有胜率数字，
            却会把整盘缩成只讲两三手（原来那行 `Math.min(state.history.length, n+1)` 就是这毛病）。 */
      const cands = Array.isArray(state.review && state.review.cands) ? state.review.cands : null;
      turns = new Array(n + 1).fill(null);
      if (cands && cands.length > 1) {
        for (let i = 0; i < Math.min(cands.length, n + 1); i++) {
          const arr = cands[i] || [];
          if (arr.length) turns[i] = { moves: arr.map((p, k) => ({ move: p[0], winrate: p[1], order: k })) };
        }
      } else {
        flash('这份胜率记录是旧版存的（里面没有「AI 想下哪」）—— 走势图能用，'
          + '但这次逐手讲解讲不了。想讲就重来一次、在弹窗里选「重新算一遍」');
      }
    } else {
      const req = {
        initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
        moves: state.moves.map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
        rules: (RULES[settings.rules] || RULES.chinese).kata,
        komi: settings.komi,
        size: N,
        maxVisits: reviewVisits(),
        analyzeTurns: Array.from({ length: n + 1 }, (_, i) => i),
      };
      let res = null;
      try { res = await window.api.review(req); } catch (e) { res = { error: String(e) }; }
      reviewBusy = false;
      if (gen !== gameGen) return;         // 期间换了棋谱 → 整体作废（finally 会收拾界面）
      /* ★★ 2026-10-14（首相报的「点了停止没停」）：用户点了「停止」→ main.js 现在会把
         **已经收到的那些回合**带 `cancelled` 一起交回。这时不该报"失败"，
         而应该只拿算到的那部分往下讲（与"超时兜底"同一条路）。
         原来它直接落进下面的失败分支、报「整盘分析失败」，把已经算好的几十秒全丢了。 */
      if (res && res.cancelled) {
        if (!res.turns || res.turns.length < 2) {
          flash('已停下整盘分析 —— 还没算出可用的手数');
          return;
        }
        flash('已停下 —— 这次只讲已经算到的 ' + (res.turns.length - 1) + ' 手（回头再点会接着算）');
      } else if (!res || res.error || !res.turns || res.turns.length < 2) {
        flash('整盘分析失败：' + ((res && res.error) || '引擎没给出结果'));
        return;
      }
      /* ★ 整盘分析**超时**时 main.js 会带 `incomplete: true` 交回「已经算到的那些回合」
         （见 analyze 的超时兜底）。这种情况只能讲算到的部分，而且要如实说明 ——
         原来只看 `turns.length >= 2` 就照跑到底，末尾还报「讲了 N 手」，
         实际有几手因为没数据被跳过（2026-10-06 审查发现）。 */
      if (res.incomplete) {
        flash('KataGo 整盘没算完（超时）—— 这次只讲算到的部分，回头再点一次会接着讲');
      }
      turns = res.turns;
      /* 顺手把胜率走势填满（引擎给的是「轮到谁走」视角，要换算成黑方视角）——
         这样手数列表的「涨跌」和走势图也一起活了，讲解里说的胜率能跟它们对上。 */
      const isWhiteTurn = x => String(((x && x.root) || {}).currentPlayer || '').toUpperCase() === 'W';
      state.history = turns.map(x => {
        const wr = x && x.root && x.root.winrate;
        return (typeof wr === 'number') ? (isWhiteTurn(x) ? 1 - wr : wr) : undefined;
      });
      state.leads = turns.map(x => {
        const sl = x && x.root && x.root.scoreLead;
        return (typeof sl === 'number') ? (isWhiteTurn(x) ? -sl : sl) : undefined;
      });
      /* ★ 同上：整盘讲解也是同一档搜索量一次算完的，精度标记统一填上 */
      state.histVisits = turns.map(() => reviewVisits());
      renderMoveList();
      renderCurve();

      /* ★★ 2026-10-14（首相实测：「我已经重算一遍了，为什么还显示这份是旧版的？」）：
         这里原来**只把结果填进内存、不落盘**。后果是 —— 用户在弹窗里选了「重新算一遍」，
         真跑了几分钟，而 `<棋谱名>.review.json` **纹丝不动**（还是旧那份、没有 cands），
         回头再点「全盘讲解」照样报"旧版记录"。那次重算等于白跑。
         所以算完**顺手按复盘的同一套口径存一份**（字段与 runReview 里保持一致）。 */
      state.review = buildReview(n, turns);
      state.review.sig = mainlineSig();          // 坑位 42：绑定主线指纹，免得挂到别的棋上
      state.review.name = String(state.recName || '').replace(/\.sgf$/i, '');
      state.review.file = state.recName;
      state.review.visits = reviewVisits();
      state.review.history = state.history.slice();
      state.review.leads = state.leads.slice();
      try { await window.api.records.saveReview(state.recName, JSON.stringify(state.review)); }
      catch (e) { /* 存不下也不影响这一次讲解 */ }
      refreshRecords();                          // 棋谱库里的「已复盘」标记要立刻变亮
    }

    /* ---------- ② LoGos：逐手讲 ---------- */
    /* ★ 2026-10-14 首相要求：用户在弹窗里选了「从头重跑」→ **抹掉已有的讲解**，从第一手开始讲。
       为什么放在这里、而不是弹窗一回来就抹：弹窗之后还有几道闸门（整盘分析失败、中途换棋谱），
       那些情况都不该先把用户的讲解删掉。**走到这一步 = 真的要开讲了**，这时才抹。
       （落盘发生在讲完之后的保存里，所以此刻只动内存 —— 中途停止不会破坏磁盘上那份。） */
    if (fromScratch && doneAt.length) {
      for (const at of doneAt) delete state.coach.explain[at];
      coachRenderedAt = -999;
      flash('已抹掉原来讲过的 ' + doneAt.length + ' 手，从头开始重讲');
    }
    const todo = [];
    /* ★ 上限取 min(手数, 已算到的回合数) —— 超时的情况只讲有数据的那些手，
       免得后面每一手都走到「没算出候选点」、空转一遍还被算进完成数（见上面的 incomplete 判断）。 */
    for (let at = 1; at <= Math.min(n, turns.length); at++) if (!coachVerOK(state.coach.explain[at])) todo.push(at);
    if (!todo.length) { flash('这份棋谱已经全部讲过（' + n + ' 手）'); return; }

    let k = 0;
    for (let i = 0; i < todo.length; i++) {
      if (batchStop || gen !== gameGen) break;
      const at = todo[i];
      const m = state.moves[at - 1];
      const pt = m.pass ? '停一手' : toGTP(m.x, m.y);
      const sideTxt = m.color === 'b' ? '黑' : '白';
      const headTxt = '第 ' + at + ' 手 · ' + sideTxt + ' ' + pt;

      const info = turns[at - 1] || {};
      const list = (info.moves || []).filter(x => x && x.move)
        .sort((a, b) => b.winrate - a.winrate);
      const best = list[0];
      const v = handVerdict(at, m);
      const verdictTxt = v ? v.txt : '（KataGo 没算出这一手的数据）';
      let leadTxt = '', body = '';
      if (!best) {
        leadTxt = '（这一手之前的局面没算出候选点）';
      } else {
        /* ★ 2026-10-12 与「分析讲解」同步改：lead 只留「AI 想下哪 / 实际下哪」，
           胜率挪到正文末尾那句对照（bestPointNote）。 */
        const same = String(best.move).toUpperCase() === pt.toUpperCase();
        leadTxt = same
          ? ('AI 当时想下的也是这里（' + best.move + '）。下面讲这一手：')
          : ('AI 当时想下的是 ' + best.move + '；实际下的是 ' + pt + '。下面讲实际这一手：');
        /* ★ 盘面给**含这一手**的（boardAt(at)）、着法序列也给到第 at 手 ——
           这是本次修的核心，理由见 coachPromptActual 的注释。 */
        const explainHead = '这一手 ' + pt + '（' + sideTxt + '棋第 ' + at + ' 手）下出来，'
          + verdictLead(v, at);
        const ask = () => coachAsk(
          coachPromptActual(state.moves.slice(0, at), boardAt(at), m.color, at,
            m.pass ? -1 : m.x, m.pass ? -1 : m.y, explainHead, verdictTone(v)),
          520);
        let r = await ask();
        if (!r) break;                          // 被别的请求取代 → 收工
        /* ★ 用户点了「停止」（或换棋谱）→ main.js 把半截文本带 `aborted: true` 回来。
           这时**这一手不要**：既不该重试（停了还在讲、还要再等几秒），
           也不该入库 —— 半截文本可能「够长 + 有句号」而被当完整讲解存进 .coach.json，
           之后永不重讲。收工前把 batchStop 置上，下面那句提示也会说「已停」。
           （2026-10-06 审查发现：aborted 这个标记一直没人看。） */
        if (r.aborted) { batchStop = true; break; }
        let txt = coachTextReady(r.text, pt, m.color, explainHead);
        /* 太短 / 第一句没说完 → 重来一次；两次里挑能用的（都好就取长的）。 */
        if (!r.error && !coachUsable(txt)) {
          const r2 = await ask();
          if (r2 && !r2.error) {
            const t2 = coachTextReady(r2.text, pt, m.color, explainHead);
            if (coachUsable(t2) || t2.length > txt.length) { txt = t2; r = r2; }
          }
        }
        const note = bestPointNote(best, v, sideTxt);
        body = r.error ? ('（讲不出来：' + r.error + '）')
          : (txt ? txt + (note ? '\n\n' + note : '') : '');
      }
      if (body) {
        state.coach.explain[at] = {
          cv: COACH_VER,
          head: headTxt, verdict: verdictTxt, ok: !!(v && v.loss <= 0.05),
          lead: leadTxt, body: body,
        };
      }
      k++;
      setBatchBar(true, k, todo.length, '讲第 ' + at + ' 手 · ' + k + '/' + todo.length);
      /* 讲的正好是眼下这一手 → 顺手把它显示出来（不然用户得等整盘跑完才看得到） */
      if (at === state.viewAt) { coachRenderedAt = -999; renderCoachPanels(true); }
      if (k % 8 === 0) saveCoachFile();     // 每 8 手落一次盘：中途关软件不至于全丢
    }
    /* ★ 只有还停在原来那份棋谱上才写盘 —— 否则会把「刚才切过去的那份棋谱」的
       讲解覆盖成空（那些讲解属于**原来那份**，键存在 state.coach.explain 里）。 */
    if (gen !== gameGen) {
      flash('换棋谱了 —— 全盘讲解已停（这次讲完的 ' + k + ' 手没存）');
    } else {
      await saveCoachFile();
      flash(batchStop
        ? ('已停下 —— 讲完了 ' + k + ' 手，下次再点「全盘讲解」接着往下讲')
        : ('全盘讲解完成：这次讲了 ' + k + ' 手（整盘共 ' + n + ' 手）'));
    }
  } finally {
    reviewBusy = false;
    state.coach.batch = null;
    $('btn-batch').disabled = false;
    $('btn-explain').disabled = false;
    $('btn-pick').disabled = false;
    setBatchBar(false);
    coachRenderedAt = -999;
    renderCoachPanels(true);
  }
}

/* KataGo 在算整盘时，把进度画到我们自己的进度条上（阶段①）。
   ★ 上面那条全局订阅会调 showReviewProgress（弹复盘窗）—— 批量分析不该弹它，
     所以那边加了 `!state.coach.batch` 的条件。 */
window.api.onReviewProgress(d => {
  if (state.coach.batch && d) {
    setBatchBar(true, d.done, d.total, 'KataGo 算整盘 ' + d.done + '/' + d.total);
  }
});

/* ---------- 绑定 ---------- */
$('btn-explain').onclick = () => runAnalysisExplain();
$('btn-pick').onclick = () => runPickExplain();
/* 全盘讲解：只在**打开棋谱**时出现（clearCoachPanels 管显隐） */
$('btn-batch').onclick = () => runBatchCoach();
$('batch-stop').onclick = () => {
  batchStop = true;
  window.api.coach.cancel();          // 掐掉正在写的那一手
  /* ★★ 2026-10-14（首相报的「点了停止没停整个算全盘的进程」「过一会儿突然就停了」）：
     原来这里**只掐讲解通道**，而 KataGo 那一步（整盘分析，几分钟）照跑不误 ——
     因为它是一个独立的、不可中断的请求：阶段① 送出去之后就一直在等，
     期间点的"停止"只写了个标志，而那个标志**只在阶段②（逐手讲）的循环里被检查**。
     现在同步掐掉引擎那一步：main.js 会把**已经收到的那些回合**带 `cancelled` 交回，
     前端据此只讲算到的部分（见 runBatchCoach 里对 res.cancelled 的处理）。 */
  try { window.api.engine.cancel(); } catch (e) { /* 拿不到也不影响停讲解 */ }
  setBatchBar(true, 0, 1, '正在停…');
};
/* ★ 启动初始化放在**最后**（讲解模块的 const 都已求值）：
   applyNewGame 内部会调 clearCoachPanels()，它要用 COACH_PH_* 那两个常量 ——
   放在它们前面会踩 const 的暂时性死区（TDZ）。 */
applyNewGame(true);
