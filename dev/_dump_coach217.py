# -*- coding: utf-8 -*-
"""分批打印整盘讲解的**全文**，供逐手过目（首相要求：不能抽查、不用省 token）。

   用法：python dev/_dump_coach217.py [起手] [止手]
   例：  python dev/_dump_coach217.py 1 40

   输出把三部分分开，便于一眼看出**模型自己写的那段**有没有讲出东西：
     · 领句   —— 「AI 当时想下的是 X；实际下的是 Y。下面讲实际这一手：」（程序写的）
     · 正文   —— 结论句 + 模型写的理由（这段是质量的关键）
     · 对照   —— 「至于 AI 当时更倾向的 X：…差了 N 个点」（程序写的数字）
"""
import io
import json
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

P = r"D:\Git by Rapace\Go\RapaceGo-src\records\20261012-214057-217手.sgf.coach.json"
a = int(sys.argv[1]) if len(sys.argv) > 1 else 1
b = int(sys.argv[2]) if len(sys.argv) > 2 else 40

with open(P, encoding='utf-8') as f:
    d = json.load(f)
L = d['list']

NOTE = re.compile(r'至于 AI 当时更倾向 .*$', re.S)
empty = 0
for at in range(a, min(b, len(L) - 1) + 1):
    it = L[at] if at < len(L) else None
    if not it or not it.get('body'):
        print('%3d ── 没有讲解 ──' % at)
        empty += 1
        continue
    body = it['body']
    m = NOTE.search(body)
    core = NOTE.sub('', body).strip()
    note = m.group().strip() if m else ''
    print('-' * 72)
    print('%3d │ %s │ %s' % (at, it.get('head', ''), it.get('verdict', '')))
    print('    领句: %s' % it.get('lead', ''))
    print('    正文: %s' % core.replace('\n', ' ⏎ '))
    if note:
        print('    对照: %s' % note.replace('\n', ' '))
if empty:
    print('\n（本段有 %d 手没有讲解）' % empty)
