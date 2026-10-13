/* 定位「7一带」是哪个正则干的。
   现象：第 138 手存下来的正文里有「7一带已经形成了相当厚实的外势」，
   而同一句里模型明明会写「白棋的L17碰」—— 说明「7」前面被吃掉了东西。
   怀疑是 cleanCoachText 里那两条**记谱清理**正则（把 X-L17 / O-L17 这类
   LoGos 训练数据的记谱法抹掉，用户看不懂）。
   这里拿纯函数喂几个候选原句，看哪个被吃成「7一带」。 */
(function () {
  var L = [];
  var cases = [
    'O-L17一带已经形成了相当厚实的外势。',
    'X-L17一带已经形成了相当厚实的外势。',
    'L17一带已经形成了相当厚实的外势。',
    '黑棋在O-L17一带已经形成了相当厚实的外势。',
    '17.O-L17一带已经形成了相当厚实的外势。',
    '黑棋在17.O-L17一带。',
    '黑棋在17.O-L1一带。',
    '黑棋的 X-L1 7一带。',
    '左上角O-L17一带。',
    '左边O-L17一带。',
  ];
  cases.forEach(function (t) {
    L.push(JSON.stringify(t));
    L.push('   → ' + JSON.stringify(cleanCoachText(t)));
  });
  L.push('');
  L.push('--- 单看第一条正则（手数+记谱）---');
  var r1 = /\d+\.\s*[XO]-[A-T]\d{1,2}/g;
  ['17.O-L17', '178.O-L17', '17.O-L1', '7.O-L17'].forEach(function (t) {
    L.push(JSON.stringify(t) + '  匹配=' + JSON.stringify(String(t).match(r1)));
  });
  L.push('');
  L.push('--- 单看第二条（裸记谱）---');
  var r2 = /[XO]-[A-T]\d{1,2}/g;
  ['O-L17一带', 'X-L17一带', '黑棋在O-L17一带'].forEach(function (t) {
    L.push(JSON.stringify(t) + '  匹配=' + JSON.stringify(String(t).match(r2)));
  });
  return L.join(String.fromCharCode(10));
})()
