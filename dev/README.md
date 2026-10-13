# dev —— 开发与测试脚本（下载软件的人**不需要**这些）

这个目录是给**改代码的人**用的。软件本身只需要仓库根目录的那些文件
（`main.js`、`preload.js`、`renderer/`、`engine.cfg`、`package.json`）。

> 为什么单独放一个目录（2026-10-07）：这 50 多个脚本原来散在仓库根目录，
> GitHub 的仓库页会先列一长串文件、README 渲染在下面 —— 访客得滚半天才看到产品介绍。
> 搬进来之后根目录只剩 16 个文件。
>
> **2026-10-13 清理**：一次性脚本（每个只为查一个 bug 而生、查完就没用了）已归入
> `_trash/oneoff-1013/`（80 个）。**留在本目录的 38 个是反复要用的工具与回归。**
> 搬走的那些**没有删**，真要考古去那个目录翻。

---

## ★ 改完代码必须跑的回归（先跑这一节，再看别的）

### 0. 先起一个带调试端口的实例

```powershell
# ⚠️ 只杀「这个源码目录起的」实例 —— 别用 Stop-Process -Name electron -Force，
#    那会把用户正在用的正式版（免解压版）一起杀掉。
Get-CimInstance Win32_Process -Filter "name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*RapaceGo-src*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-Sleep 5
cd dev
cmd /c _start_cdp.bat                        # 等约 15 秒，端口 9333 才开
```

⚠️ 别直接 `Start-Process electron.exe` —— 实测只起得来 1 个进程、端口不开。
⚠️ **改了 `renderer/*` 必须重启实例**：CDP 注入不热更新，不重启你测的是旧代码。

### 1. 静态检查（秒级，先跑这个）

```bash
node dev/_lint_ids.mjs        # DOM id 对不上
node dev/_lint_ipc.mjs        # IPC 契约
node dev/_lint_hidden.mjs     # [hidden] 被 display 压过
node dev/_lint_net.mjs        # 意外的网络访问
node dev/_smoke.mjs           # 冒烟
node dev/_precheck.mjs        # CDP 脚本模板串会不会求值报错

& "C:\Users\rapac\AppData\Local\Programs\nodejs\node.exe" --check renderer/app.js
```

⚠️ **PowerShell 里调用外部程序一律加 `&`**。`"C:\...\node.exe" --check app.js` 会被当成字符串表达式，
**整条命令 ParserError，后面的命令根本不执行** —— 于是「改的代码看起来没生效」，白排查。

### 2. 端到端回归（驱动真界面，**必须串行**，不能并行）

| 脚本 | 覆盖什么 | 当前期望 |
|---|---|---|
| `_inject_branch_v2.js` | **手数分支**：SGF 变着读写 / 切分支 / 提升主变 / 删除分支 / 旁支写回解说词 / ⑮ 指纹与闸门 | **83 PASS / 0 FAIL**（2026-10-13 深夜加了 ⑮ 六条） |
| `_inject_real_rec.js` | **真实 217 手棋谱**往返 + 按节点写回解说词（**生成物**，见下） | **20 PASS / 0 FAIL** |
| `_inject_tree_v1.js` | 段③ 串珠树面板（滑杆 / 金圈 / 青环 / 点珠跳转 / 右键平移 vs 菜单 / 悬停浮层） | **46 PASS / 0 FAIL**（2026-10-13 夜 DSH 加了 ⑩b1–⑩b4：浮层贴边夹取） |
| `_inject_computing.js` | **「计算中…」的显示判据**（引擎没就绪时不许显示 —— **首相 2026-10-13 报的**） | **7 PASS / 0 FAIL** |
| `_inject_clean1013.js` | **讲解文本清洗**：残缺括号 / 舞台说明 / **句子级去重复**（连刷十几遍的兜底）｜含**5 条反向保护**（正常讲解一字不改）｜**D12/D13 流式对照**（温和清洗全程不中断 vs 完整清洗确实中断 —— 对应首相报的「疯狂重置」） | **13 PASS / 0 FAIL** |
| `_inject_evalbar.js` | **右侧胜率条跟随回看**（回看第 N 手就该显示第 N 手的胜率，不是"最近算过的局面" —— **首相 2026-10-13 深夜报的**） | **6 PASS / 0 FAIL** |
| `_inject_batchask.js` | **全盘讲解前的两个询问窗**（先问整盘胜率要不要重算 / 再问讲解是从头重跑还是接着讲；没数据时不问 —— **首相 2026-10-14 要求**）。含「弹窗开着时不许重建」（对应"点啥都没反应"）、「旧记录没候选点时推荐项反过来并明说讲不了」 | **31 PASS / 0 FAIL** |
| `_inject_showask.js` | **把询问窗真的弹出来并挂住**（好让外面截图看实际长相）。改文件开头的 `WHICH` 换窗 —— **看效果用，不是断言** | — |
| `_shot_now.mjs` | **只截当前帧**，不改页面状态（`_cdp_shot.mjs` 会先打开棋谱、跳手数，拍展示图用的；这个是"拍眼前这一帧"） | — |
| `_inject_draft_v1.js` | 试下（打草稿）体验 | **29 PASS / 1 FAIL**（那 1 条 F3 是**故意不做的行为**，见交接与实况「明确不做」；C1 与 C2 是 2026-10-13 审查时改写的断言，理由写在脚本注释里） |
| `_inject_draft_review.js` | 试下 + 复盘缓存联动 | 6 PASS / 1 FAIL（同 F3：R5 是「明确不做」那条） |
| `_inject_reviewload.js` | 复盘载入（打开棋谱就带出每手胜率） | **8 PASS / 0 FAIL**（L0b 原来是时序脆弱的假断言，已改成同步阶段取值） |
| `_inject_cleantest.js` | 讲解文本清洗 | **只打印清洗前后的样例文本，人眼核对用**（不产 PASS/FAIL）。本轮没动清洗判据 —— 那是 DSH 的活 |
| `_verify_fixes_1013.js` | **2026-10-13 深夜审查 7 个坑**（纯 node，不用起界面） | **11 条全绿，且在"修法删回去"的旧源码上 11/11 变红** |
| `_cdp_regress.mjs` | **综合回归**：悔棋 / 回看 / 涨跌数字 / 刷新按钮 / 界面一致性 | R1–R5 全过（**自己连端口，不用 runner**） |

跑法（除最后一条）：

```bash
node dev/_cdp_run2.mjs ./_inject_branch_v2.js 9333
```

`_cdp_run2.mjs` 的参数是 `<_注入脚本> [端口]`；注入脚本里**没有 fs / require**，
只能读全局函数与 `state`。要带一段文件内容进去，用**生成器内联**（见 `_mk_real_regress.mjs`）。

### 3. 真实棋谱回归怎么生成

`_inject_real_rec.js` 是**生成物**，别手改。要换棋谱/重新生成：

```bash
node dev/_mk_real_regress.mjs "records\20261012-214057-217手.sgf" dev/_inject_real_rec.js
```

⚠️ 生成器内部是一个**模板字符串**，你在里面写注释**不能带反引号**，否则模板提前结束、语法崩
（2026-10-13 踩过一次）。

---

## 文件分类（留在本目录的）

| 前缀 | 是什么 | 例子 |
|---|---|---|
| `_start_cdp.bat` | **起调试实例**（双击即可，端口 9333，独立 `--user-data-dir`） | — |
| `_cdp_run*.mjs` | **注入 runner**：把 `_inject_*.js` 送进渲染进程执行、回传结果 | `_cdp_run2.mjs`（**首选**，走 browser 端点 + attach，最稳） |
| `_cdp_regress.mjs` | 综合回归（**自己连端口**，不走 runner） | — |
| `_cdp_shot.mjs` / `_cdp_shot2.mjs` | 截图（看真机长什么样，别只看断言） | — |
| `_inject_*.js` | **注入脚本**（被 runner 送进页面里跑的断言） | `_inject_branch_v2.js`（分支，当前最大的一套） |
| `_mk_*.mjs` | 生成器（把外部数据内联进注入脚本） | `_mk_real_regress.mjs` |
| `_lint_*.mjs` | **静态检查**（不用跑界面） | `_lint_ids` / `_lint_ipc` / `_lint_hidden` / `_lint_net` |
| `_test_*.cjs` | `node --test` 单元测试 | `_test_sgf_size.cjs`（9/13/19 路 + 400 份构造棋谱） |
| `_smoke.mjs` / `_precheck.mjs` | 冒烟 / 模板串预检 | — |
| `_rtest.py` | **跑 CDP 测试的启动器**：拉起 Electron（带调试口）→ 跑脚本 → 截图 → 关掉 | 参数顺序见下 |
| `_sync_deploy.ps1` | 同步到免解压版（含逐文件哈希校验、自动备份，备份只留 2 份） | — |
| `_build_lazy.ps1` / `_update_lazy.ps1` | 重建懒人包 / 把新版拷进懒人包 | — |
| `_check_encodings.ps1` | 检查 `.bat`/`.ps1` 的 BOM / CRLF / `%~dp0`（踩过好几次） | — |
| `_guard_records.ps1` | 跑测试前锁住 `records/`、跑完还原（防测试污染用户棋谱） | `-Save` / `-Restore` |
| `_paths.ps1` / `_verify_helpfix.ps1` / `_deploy.sh` | 路径工具 / 帮助面板专项 / 发布 | — |
| `_check_coach217.py` / `_dump_coach217.py` | 讲解内容检查（v0.1.27 遗留） | — |

## 怎么跑

所有脚本**都按自己所在位置推导路径**，所以从哪儿运行都行。

```bash
# 静态检查（秒级，改完代码先跑这个）
node dev/_lint_ids.mjs

# 端到端走 _rtest.py（它会自己拉起软件、跑完关掉）
python dev/_rtest.py dev/_cdp_regress.mjs _trash/_shot.png
```

`_rtest.py` 的参数顺序是 `<_测试脚本> <截图名> [第二段脚本] [第二张截图名]` ——
⚠️ **第 2 个位置参数是截图名**，所以测试脚本要的参数得走**环境变量**传。

## 环境要求

- **Node.js**（脚本用 `import`，要 ESM 支持）
- **Python 3**（只给 `_rtest.py` 与两个 `_*coach217.py` 用）
- `node_modules`（`npm install`）—— `_rtest.py` 要用里面的 `electron` 跑界面

## 两条纪律

1. **`.ps1` / `.bat` 必须 UTF-8 带 BOM + CRLF** —— Windows PowerShell 5.1 读无 BOM 的
   UTF-8 会当 GBK，中文注释一变乱码整段语法就崩。`.bat` 还必须是 **CRLF 行尾**
   （LF 会让 `^` 续行与 `if (...)` 块解析错位）。用编辑器改完记得补
   （`_check_encodings.ps1` 会查，要报「全过」）。
2. **测试的判据比被测代码更容易写错**。本项目有多次"测试报 ★，其实是判据错了"的记录：
   拿 GBK 字节比 UTF-8、用不存在的字段当等待条件、把观察者效应当成被测行为、
   **探针自己的坐标换算把 K 算成 L**（GTP 坐标跳过 I，见交接与实况坑位 28）、
   **测试用例选点撞上棋谱里已有的子**（坑位 31）。
   写判据时先确认：**字段真的存在吗？口径对吗？我用的常量是哪一个口径的？**
3. **GUI/CDP 测试串行跑**，别并行。

---

## `_trash/oneoff-1013/` 里是什么（80 个）

2026-10-13 归档的**一次性脚本**：每个都是为查某一个 bug 临时写的，查完就没有再跑的价值
（`_cdp_stuck*`、`_cdp_ko*`、`_cdp_explain*`、`_inject_dbg*` 之类）。
**没删**，考古随时能翻。

⚠️ **其中 5 个是「死脚本」，别去修它们**：

| 脚本 | 为什么死了 |
|---|---|
| `_cdp_comment.mjs` | 依赖 `records\_test_comment.sgf` |
| `_cdp_rootcomment.mjs` | 依赖 `records\_test_rootcomment.sgf` |
| `_cdp_crcrlf.mjs` / `_cdp_crcrlf2.mjs` | 依赖 `records\_test_crcrlf.sgf` |
| `_cdp_editlock.mjs` | 同属解说词编辑那一批 |

那几个 `_test_*.sgf` 测试棋谱**已经不存在了**（历史清理时一起没了），
所以这几个脚本一跑就是 ENOENT。**它们的覆盖面已被 `_inject_real_rec.js` 的
R16–R20 与 `_inject_branch_v2.js` 的 ⑫1–⑫5 接管**（都是「按节点写回解说词」的落刀验证，
而且用的是真棋谱，比原来那套强）。

要恢复它们得先造测试棋谱 —— 判断：**成本大于价值，不做**。
