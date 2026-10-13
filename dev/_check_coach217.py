# -*- coding: utf-8 -*-
"""逐手体检整盘讲解（<棋谱名>.coach.json）。

为什么写这个：首相要"整盘跑一遍，看每手的讲解词，讲得如何"。
217 手肉眼看不完，所以先用程序把**可机检的毛病**全部挑出来，
剩下真正需要人读的（讲得对不对、有没有道理）再抽样看。

机检的毛病（每条都是这次修 bug 时实测抓到过的真实缺陷）：
  ① 开头不是「这一手 X（…）下出来，<结论>」→ 结论文案丢了 / 格式变了
  ② 正文里出现胜率数字        → 要求里明写了不给数字，它复述就是没听话
  ③ 正文里有「如果 X 下在别处」→ 就是首相报的那个原病（拿别的点当主体）
  ④ 正文里有「我来分析 / 应对选择」→ 尾巴没砍干净（替对方支招）
  ⑤ 下错了（亏 ≥0.5%）却没有第二段对照句 → bestPointNote 没生效
  ⑥ 正文过短（<60 字）        → 基本没讲出东西
  ⑦ 正文重复「第 N 手」

用法：python dev/_check_coach217.py [coach.json 路径]
"""
import io
import json
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PATH = sys.argv[1] if len(sys.argv) > 1 else \
    r"D:\Git by Rapace\Go\RapaceGo-src\records\20261012-214057-217手.sgf.coach.json"

with open(PATH, encoding='utf-8') as f:
    d = json.load(f)
lst, n = d.get('list') or [], d.get('n') or 0

CONCL = re.compile(r'^这一手 [A-T]\d{1,2}（(黑|白)棋第 \d+ 手）下出来，这手')
NUM = re.compile(r'\d+(\.\d+)?%')
# 第二段（AI 推荐点的数字对照）是**程序写的**，里面的百分比是故意的 —— 查数字前先切掉它
TAIL2 = re.compile(r'\n*至于 AI 当时更倾向 .*$', re.S)
# 括号里的动作/神态描写（「（对着棋盘沉思）」这类像剧本的插入语）
ACT = re.compile(r'[（(][^（()）]{0,16}(棋盘|沉思|观察|模拟|点头|摇头|微笑|皱眉|敲打|看着|叹气)[^（()）]{0,16}[)）]')
HYPO = re.compile(r'如果[^\n]{0,10}(下在|选择)\s*[A-HJ-T](?:1[0-9]|[1-9])')
TAIL = re.compile(r'我来分析|应对选择|可能的应对|几种应对|应对方案|应对方式|我有几个|接下来我|现在轮到')
DUP = re.compile(r'第\s*\d+\s*手')
# 抓「开头」那半句，用来统计是不是每手一个样（首相：别公式化、要像人）
LEAD = re.compile(r'^这一手 [A-T]\d{1,2}（[^）]*）下出来，(.{2,12}?)[，,。]')

bad = {k: [] for k in ['格式', '胜率数字', '动作描写', '跑题句', '支招尾巴', '缺对照', '太短', '重复']}
讲过 = 0
lens = []
leads = []
for at in range(1, len(lst)):
    it = lst[at]
    if not it or not it.get('body'):
        continue
    讲过 += 1
    b = it['body']
    lens.append(len(b))
    tag = '第%d手 %s' % (at, it.get('head', ''))
    core = TAIL2.sub('', b)            # 模型写的那部分（不含程序拼的第二段）

    if not CONCL.match(b):
        bad['格式'].append(tag + ' :: ' + b[:70])
    mn = NUM.search(core)
    if mn:
        bad['胜率数字'].append(tag + ' :: ' + mn.group())
    ma = ACT.search(b)
    if ma:
        bad['动作描写'].append(tag + ' :: ' + ma.group())
    mh = HYPO.search(b)
    if mh and 'D16' not in b[:mh.end()]:
        bad['跑题句'].append(tag + ' :: ' + b[max(0, mh.start() - 12):mh.end() + 18])
    mt = TAIL.search(b)
    if mt:
        bad['支招尾巴'].append(tag + ' :: ' + b[max(0, mt.start() - 12):mt.start() + 18])
    if len(b) < 60:
        bad['太短'].append(tag + ' :: ' + b)
    if len(DUP.findall(b)) > 2:
        bad['重复'].append(tag + ' :: 出现 %d 次「第N手」' % len(DUP.findall(b)))
    ml = LEAD.match(b)
    if ml:
        leads.append(ml.group(1))

    # 下错了却没有第二段对照
    v = it.get('verdict') or ''
    mv = re.search(r'亏了 (\d+\.\d+)%', v)
    loss = float(mv.group(1)) if mv else 0.0
    if loss >= 0.5 and '至于 AI 当时更倾向' not in b:
        bad['缺对照'].append(tag + ' :: ' + v)

print('=' * 72)
print('棋谱：%s' % PATH.split('\\')[-1])
print('共 %d 手，讲过 %d 手（%s）' % (n, 讲过, '全覆盖' if 讲过 >= n else '★ 缺 %d 手' % (n - 讲过)))
if lens:
    lens.sort()
    print('正文长度：最短 %d · 中位 %d · 最长 %d 字'
          % (lens[0], lens[len(lens) // 2], lens[-1]))
if leads:
    uniq = sorted(set(leads))
    print('开头用词：%d 手用了 %d 种说法' % (len(leads), len(uniq)))
    print('   ' + ' / '.join(uniq[:18]) + (' …' if len(uniq) > 18 else ''))
print('=' * 72)
总 = 0
for k, v in bad.items():
    总 += len(v)
    print('\n【%s】%d 处' % (k, len(v)))
    for line in v[:12]:
        print('   ' + line.replace('\n', ' ⏎ ')[:150])
    if len(v) > 12:
        print('   … 还有 %d 处' % (len(v) - 12))
print('\n' + '=' * 72)
print('机检问题合计：%d 处' % 总)
