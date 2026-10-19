/* 回归测试：引擎兼容性自检的「建议方向」与「多显卡挑选」（2026-10-18）
   为什么要它：用户报「Intel 核显的机器，被提示去下 cuda / trt（NVIDIA 专用）」——
   根子是建议取了「当前装的那套」的包，而不是「这张显卡该下的包」。
   本测试直接**从 main.js 里切出真函数**来跑（不是手抄副本），断言：
     ① Intel 核显的建议里不许出现 cuda / trt；
     ② 建议必须落在该品牌可用的构建上；
     ③ gpuInfo() 在真 Electron 环境里能认出主力显卡，且把全部设备列进 list。

   跑法：electron dev/_test_enginecheck.js */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/* ★ 允许用 RG_MAIN 指向别的副本 —— 专门用来给这条测试做「反向验证」：
   把 intel 分支改回 cuda，跑一遍应当变红，证明断言不是摆设。 */
const SRC = process.env.RG_MAIN || path.join(__dirname, '..', 'main.js');
const src = fs.readFileSync(SRC, 'utf8');

/* 从 main.js 里按名字切出一个顶层函数（大括号配平，跳过字符串里的括号风险由原文可控保证） */
function cut(name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('切不到函数：' + name);
  let i = src.indexOf('{', m.index), depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j], p = src[j - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error('函数没闭合：' + name);
}

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log('  PASS ' + what); } else { fail++; console.log('  FAIL ' + what); } };

app.whenReady().then(async () => {
  const downloadsForBrand = new Function(cut('downloadsForBrand') + '; return downloadsForBrand;')();
  const gpuInfo = new Function('app', cut('gpuInfo') + '; return gpuInfo;')(app);

  console.log('== ① 建议方向（这次的 bug 本体）==');
  const intel = downloadsForBrand('intel');
  console.log('  intel → ' + intel);
  ok(!/cuda|trt/i.test(intel), 'Intel 核显的建议里不出现 cuda / trt');
  ok(/opencl/i.test(intel), 'Intel 核显的建议指向 opencl');
  const amd = downloadsForBrand('amd');
  ok(!/cuda|trt/i.test(amd) && /opencl|rocm/i.test(amd), 'AMD 的建议是 opencl / rocm，不含 cuda');
  const nv = downloadsForBrand('nvidia');
  ok(/cuda/i.test(nv), 'NVIDIA 的建议仍是 cuda / trt');
  const unk = downloadsForBrand('');
  ok(/opencl/i.test(unk), '认不出显卡时兜底给 opencl（通用）');

  console.log('== ② 没有标识文件时，问引擎自己（不猜、不硬换）==');
  const pbc = new Function('fs', 'execFileSync', 'KATAGO_LABEL',
    cut('probeBackendSync') + '\n' + cut('probeBrandCached') + '\nreturn probeBrandCached;')(
      require('fs'), require('child_process').execFileSync, 'KataGo');
  const none = pbc('Z:\\nope\\katago.exe');            // 文件不存在 → 不许抛、不许乱猜
  ok(none === '', '文件不存在时返回 ""（说不准就不动）');
  ok(pbc('Z:\\nope\\katago.exe') === '', '第二次调用同样结论（缓存不炸）');

  console.log('== ③ 显卡清单（多显卡不再只看第一块）==');
  const g = await gpuInfo();
  console.log('  主力：' + (g.name || '(空)') + ' / 品牌：' + (g.brand || '(空)') + ' / list=' + JSON.stringify(g.list));
  ok(!!g.brand, '认出了主力显卡的品牌');
  ok(Array.isArray(g.list) && g.list.length >= 1, 'list 至少有一项');
  ok(!g.list.some(x => x.brand === '' && /Basic Render/i.test(x.name || '') && g.list.length > 1),
     '微软软件渲染器不会混进真显卡列表（有真卡时）');

  console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
  app.exit(fail ? 1 : 0);
});
