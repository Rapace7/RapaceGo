/* 拼 Release 说明：版本专属那段（文件开头）+ 通用部分（从「关于三大目录的分工」起）。
   为什么用 node 而不是 PowerShell：PS 5.1 的命令行中文参数会被转码成 GBK，
   `IndexOf('三大目录')` 恒返回 -1（实测踩到）。node 读写 UTF-8 干净。
   用法：node _mk_notes.mjs  → 生成 _release_notes.md */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ★ 2026-10-07：脚本搬进 dev\ —— 路径按脚本自身位置算，不写死盘符。 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/* ★ 2026-10-14 深夜：文档收进 docs/（根目录只留两个 README + 程序必需文件）——
   原来根目录堆了 11 个 .md/.txt，而 GitHub 的 README 必然渲染在文件列表**下面**，
   进来的人要往下拉很久才看到介绍。路径跟着改。 */
const SRC = path.join(ROOT, 'docs', '发布说明.md');
const OUT = path.join(ROOT, '_release_notes.md');

const t = fs.readFileSync(SRC, 'utf8');
const marker = '## 关于「三大目录」的分工';
const i = t.indexOf(marker);
if (i < 0) { console.error('★ 找不到通用部分的起点：' + marker); process.exit(1); }

/* ★★ 2026-10-09 修：**只取最新那一版，不要把历史全带上**。
   原来这里写的是 `t.slice(0, i)` —— 把文件开头到 marker 之间的**全部**内容都算进来。
   而 `发布说明.md` 是**所有历史版本的累积**（1000+ 行），
   于是 v0.1.26 的 Release 说明里从 v0.1.26 一路排到 v0.1.12，
   展开后要滚很久 —— 用户直接看出来了（「是不是还有非本次更新的大量内容？」）。
   Release 说明本来就该只讲**这一版**改了什么；历史去 Releases 列表翻。
   做法：按行找**第二个**版本标题行（形如 `v0.1.26：...`），在那里切开。 */
const verAll = t.slice(0, i);
const verLines = verAll.split('\n');
let cutAt = verLines.length;
const isVerHead = s => /^v?\d+\.\d+\.\d+\s*[：:]/.test(s);
for (let k = 1; k < verLines.length; k++) {   // 从 1 开始：第 0 行是本版标题
    if (isVerHead(verLines[k])) { cutAt = k; break; }
}
const ver = verLines.slice(0, cutAt).join('\n').trimEnd();
const gen = t.slice(i);

/* ★★ 2026-10-08 用户要求：**Release 说明必须"下载优先"**。
   原来正文一上来就是几千字的分版本说明，用户要往下拉很久才看到下载文件 ——
   而 GitHub 的 Release 页面里**文件清单（Assets）在页面最下面**，
   说明越长，越难找到下载（用户原话：「需要往下拉很多才能看到 assets 的下载」）。

   现在拼成这个结构：
     ① 首屏：**一行说明 + 一行"去哪下载"的提示**（折叠之后 Assets 通常就在同一屏，
        所以不再需要一个大标题链接去"跳" —— 用户实测反馈那个大蓝块是多余的）
     ② 所有正文折进 <details>，默认收起 —— 想看细节的人自己展开
   这样"从进页面到能点下载"就是：扫一眼 → 直接点下面的 Assets。
   （想跳的话 `#assets` 锚点仍然有效，只是不再占一行标题的位置。） */
const firstLine = (ver.split('\n')[0] || '').replace(/^v?[\d.]+\s*[：:]\s*/, '').trim();

/* ★ 2026-10-09 改：从 v0.1.26 起有**三个**下载包（win + mac 两个架构），
   原来那句"下载 Assets 里那个 RapaceGo.zip"就过时了 —— 用户会找不到那个名字。
   这里按平台列清楚，并顺手说明"都不含引擎"（这是最常被误解的一点）。

   ★★ 2026-10-14 再改：**改成按 dist 里"本次真的打出来的包"列**，不再写死三个平台。
      踩过的坑（v0.1.27）：本机是 Windows，只打了 win 包；而这张表写死三行，
      于是 Release 页面上列着两个 mac 包 —— 用户点进去**根本没有那个文件**。
      判据：与 dist 里**最新那个 zip** 修改时间相差 10 分钟以内的，算同一批构建产物
      （同一次 electron-builder 出来的文件时间几乎一样；旧的 mac 包是几天前的，一下就能分开）。 */
const PLAT = {
  'RapaceGo-win.zip': 'Windows',
  'RapaceGo-mac-arm64.zip': 'macOS（M 系列，Apple 芯片）',
  'RapaceGo-mac-x64.zip': 'macOS（Intel）',
};
let zips = [];
try {
  const distDir = path.join(ROOT, 'dist');
  const all = fs.readdirSync(distDir)
    .filter(f => /^RapaceGo-.*\.zip$/i.test(f))
    .map(f => ({ f, m: fs.statSync(path.join(distDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (all.length) {
    const newest = all[0].m;
    zips = all.filter(x => newest - x.m < 10 * 60 * 1000).map(x => x.f).sort();
  }
} catch (e) { /* dist 不存在（比如没打包就生成说明）→ 空表，下面会兜底 */ }
if (!zips.length) zips = ['RapaceGo-win.zip'];   // 兜底：至少别给出一张空表

const HEAD = [
  '**' + (firstLine || '本次更新说明见下。') + '**',
  '',
  '**下载**（页面最下面的 `Assets`，按平台挑一个；这些包都**不含引擎**）：',
  '',
  '| 平台 | 文件 |',
  '|---|---|',
  ...zips.map(f => '| ' + (PLAT[f] || '—') + ' | `' + f + '` |'),
  '',
  '引擎要自己配（见 README「显卡品牌」那一节）。',
  '',
  /* ★ 2026-10-14 首相要求：把懒人包的**网盘分享**直接摆上来，用户点一下就能下。
     为什么整包只能走网盘：8.5 GB，而 GitHub Release 单个附件上限 2 GB，
     且大头（4.4 GB 的 .gguf 模型、296 MB 的 .bin.gz 权重）本身就是压缩格式，再打 zip 也压不动。 */
  '---',
  '',
  '## 想省事？直接下**懒人包**（自带引擎，解压就能用）',
  '',
  '上面那个 zip **不含引擎**（KataGo 权重 + LoGos 模型要自己配）。',
  '**懒人包**把这些全带齐了，解压后双击 `RapaceGo.exe` 即可，**零配置**：',
  '',
  '> ### 👉 [夸克网盘 · 玄清围弈懒人包](https://pan.quark.cn/s/549e9dcc7d99?pwd=Svze)　（提取码 `Svze`）',
  '>',
  '> 约 **8.5 GB**，含：程序本体 + KataGo（**N 卡加速版和通用版两套**，软件自己按显卡挑）+ LoGos 讲解模型。',
  '> 下载后解压、双击 `RapaceGo.exe` 就能用 —— **不用**再去看「显卡品牌」那一节。',
  '',
  '<details>',
  '<summary><b>展开看这一版改了什么</b></summary>',
  '',
].join('\n');

const FOOT = '\n</details>\n';

fs.writeFileSync(OUT, HEAD + ver + '\n' + gen + FOOT, 'utf8');

console.log('说明段 ' + ver.length + ' 字符（已折进 <details>）');
console.log('通用部分 ' + gen.length + ' 字符（也已折起）');
console.log('合计 ' + (HEAD.length + ver.length + gen.length + FOOT.length) + ' 字符 → ' + OUT);
console.log('--- 首屏（用户第一眼看到的）---');
console.log(HEAD);
