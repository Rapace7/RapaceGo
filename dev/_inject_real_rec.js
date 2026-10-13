/* 真实棋谱回归 —— 由 dev/_mk_real_regress.mjs 生成，别手改。源：20261012-214057-217手.sgf */
(async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = [];
  const ok = (n, c, g) => L.push((c ? 'PASS ' : 'FAIL ') + n + (g === undefined ? '' : '  [' + g + ']'));
  const RAW = "(;GN[符创保VS赵文博]GM[1]FF[4]SZ[19]CA[UTF-8]AP[RapaceGo:0.3]KM[7.5]RU[Chinese]PB[测试甲]PW[PLAYER2];B[pd];W[cd];B[df];W[ec];B[dd];W[dc];B[ed];W[dq];B[pp];W[qq];B[jq];W[nc];B[jc];W[pj];B[oi];W[qc];B[pc];W[qd];B[qe];W[re];B[nd];W[pe];B[og];W[pf];B[oe];W[qf];B[fc];W[fb];B[nb];W[oc];B[ob];W[pb];B[mc];W[od];B[ne];W[pd];B[pi];W[oj];B[nj];W[nk];B[ok];W[ni];B[mj];W[mk];B[mi];W[ol];B[pk];W[qk];B[qj];W[hq];B[hp];W[gp];B[ho];W[go];B[in];W[hn];B[io];W[fn];B[jp];W[po];B[pn];W[qn];B[oo];W[qo];B[pm];W[pl];B[ql];W[rk];B[rl];W[qm];B[sk];W[pj];B[rj];W[dl];B[nl];W[dg];B[eg];W[eh];B[ee];W[ce];B[hg];W[dj];B[ej];W[ek];B[fj];W[fk];B[gk];W[gl];B[hl];W[gj];B[hk];W[fi];B[dh];W[cg];B[cf];W[di];B[ch];W[bh];B[bg];W[ei];B[cg];W[cb];B[bi];W[iq];B[ir];W[gq];B[hm];W[gn];B[ah];W[ml];B[nm];W[jo];B[ko];W[jn];B[jm];W[kn];B[ln];W[km];B[kl];W[lm];B[lk];W[mm];B[mn];W[nn];B[ll];W[op];B[om];W[no];B[ol];W[ic];B[gd];W[gc];B[fd];W[hd];B[he];W[jd];B[kd];W[kc];B[id];W[ie];B[ld];W[jb];B[np];W[on];B[pq];W[oq];B[qp];W[rp];B[pr];W[qr];B[or];W[nr];B[nq];W[oo];B[ns];W[mr];B[mo];W[ps];B[lr];W[ms];B[lq];W[os];B[rm];W[pr];B[im];W[hf];B[gf];W[if];B[jf];W[jg];B[ke];W[kf];B[je];W[hh];B[ig];W[id];B[gh];W[hi];B[gi];W[hj];B[fg];W[of];B[nf];W[pg];B[ph];W[qi];B[qh];W[rg];B[mb];W[lb];B[ij];W[lc];B[md];W[ih];B[gg];W[be];B[jh];W[kg];B[kh];W[ji];B[lg];W[jr];B[kr];W[ks];B[js];W[ls];B[mq];W[or];B[lf];W[hs];B[hr];W[gr];B[jr];W[rn];B[sn];W[so];B[sm])";
  const NAME = "20261012-214057-217手.sgf";
  /* 原文手顺（SGF 口径抽取）：`;B[xx]` / `;W[xx]` / 停一手 `;B[]` */
  const seqRaw = RAW.match(/;[BW]\[[a-z]{0,2}\]/g) || [];
  /* 一条链上分叉点的个数（沿 _cs[0] 走到底） */
  const forks = () => { let n = 0, c = branchRoot; while (c && c._cs && c._cs.length) { if (c._cs.length > 1) n++; c = c._cs[0]; } return n; };
  const chainLen = () => { let n = 0, c = branchRoot; while (c && c._cs && c._cs.length) { c = c._cs[0]; n++; } return n; };

  settings.mode = 'free'; settings.size = 19; settings.handicap = 0; settings.rules = 'chinese';
  const rec = parseSGF(RAW);
  ok('R1 parseSGF 认得出这份棋谱', rec.ok === true);
  ok('R2 解析出的手数 = 原文手顺条数', rec.moves.length === seqRaw.length, rec.moves.length + ' / ' + seqRaw.length);
  ok('R3 交出了 tree', !!rec.tree);

  applyRecord(rec, NAME); await sleep(250);
  ok('R4 打开后手数一致', state.moves.length === seqRaw.length, state.moves.length + ' / ' + seqRaw.length);
  ok('R5 branchRoot 已建', !!branchRoot);
  ok('R6 主变链条数 = 手数（无旁支时树上只有一条链）', chainLen() === state.moves.length, chainLen() + ' / ' + state.moves.length);
  /* R7 验证「写回解说词的定位依据」到位了：每一手都拿到了它在**原文里的手序号**
     （节点上的 _sgfIdx，由 sgfTreeToMoves 发、由 sgfIndexAllTokens 同序还原）。
     无变着的棋谱上，这个序号就该等于手号（0 起）。
     先证明这条断言抓得住：把 applyRecord 里那个 {n:0} 去掉，R7 必挂。 */
  ok('R7 每一手都拿到了原文里的手序号',
    state.moves.every((m, i) => m._sgfIdx === i),
    state.moves.filter((m, i) => m._sgfIdx !== i).length + ' 手对不上');
  ok('R8 原谱没有变着 → 分叉点 0 个', forks() === 0, forks());

  const out = buildSGF();
  const seqOut = out.match(/;[BW]\[[a-z]{0,2}\]/g) || [];
  /* R9 最关键的一条：217 手的坐标**逐手**与原文一致（错一手就挂） */
  let firstBad = -1;
  for (let i = 0; i < Math.max(seqOut.length, seqRaw.length); i++) {
    if (seqOut[i] !== seqRaw[i]) { firstBad = i; break; }
  }
  ok('R9 导出手顺与原文逐手一致', seqOut.length === seqRaw.length && firstBad < 0,
    firstBad < 0 ? seqOut.length + ' 手全同' : ('第 ' + (firstBad + 1) + ' 手起不同：' + seqOut[firstBad] + ' vs ' + seqRaw[firstBad]));
  ok('R10 导出仍只有一个括号（没平白多出变着）', (out.match(/\(/g) || []).length === 1, (out.match(/\(/g) || []).length);
  ok('R11 导出有 SZ/PB/PW 等根属性', out.indexOf('SZ[19]') > 0 && out.indexOf('PB[') > 0);

  /* R12/R13 captured/capAt 补算：这份真实对局有提子，必须算得出来 */
  ok('R12 每一手都有 captured 字段', state.moves.every(m => m.captured !== undefined));
  const nCap = state.moves.filter(m => m.captured > 0).length;
  ok('R13 真实对局里算出了提子的手（>0）', nCap > 0, nCap + ' 手有提子');
  ok('R14 capAt 与 captured 同进同退',
    state.moves.every(m => (m.captured > 0) === !!m.capAt), 
    state.moves.filter(m => (m.captured > 0) !== !!m.capAt).length + ' 手不一致');

  /* R15 切分支不该崩（这份谱没分支 → 应老实提示「没有分支」） */
  const sw = cycleBranch(1);
  ok('R15 无分支时切分支不崩、如实返回 false', sw === false);

  /* ---------- R16-R19：按节点写回解说词（段② 收掉的尾巴，真正的落刀验证） ----------
     这一段**完全不碰磁盘**：把棋谱原文当字符串改，再解析回来看解说词有没有落在对的手上。
     （用户文件是只读用的样本，任何测试都不许写它。） */
  const T = '第10手的解说';
  const p1 = patchSGFCommentAtNode(RAW, state.moves[9], T);
  ok('R16 按节点写回：能落刀', !!p1.ok, JSON.stringify(p1).slice(0, 60));
  if (p1.ok) {
    const re = parseSGF(p1.text);
    ok('R17 重新解析后，解说词正好落在第 10 手上', re.comments[10] === T, re.comments[10]);
    ok('R18 写回没破坏手顺（仍是 217 手）', re.moves.length === 217, re.moves.length);
    const p2 = patchSGFCommentAtNode(p1.text, state.moves[9], '');
    const re2 = parseSGF(p2.text);
    ok('R19 清空解说词：内容没了、手顺仍在', !re2.comments[10] && re2.moves.length === 217,
       re2.comments[10] + '/' + re2.moves.length);
    /* R20 写回**别的**一手，不该动到这一手 —— 「按节点定位」最要紧的一条 */
    const p3 = patchSGFCommentAtNode(p1.text, state.moves[20], '第21手的话');
    const re3 = parseSGF(p3.text);
    ok('R20 写第 21 手不会碰掉第 10 手的话',
       re3.comments[10] === T && re3.comments[21] === '第21手的话',
       re3.comments[10] + ' / ' + re3.comments[21]);
  }

  return L.join('\n');
})();
