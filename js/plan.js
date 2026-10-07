'use strict';

// ルールベースの「今日のプログラム」・栄養目標・アドバイス
// （app.js のヘルパーを呼び出し時に参照する）

const TRAIN_PARTS = ['chest', 'back', 'shoulders', 'legs', 'arms', 'abs'];
const BIG_PARTS = ['chest', 'back', 'legs', 'shoulders'];
const RECOVERY_DAYS = 2; // 前回から2日後以降（中1日以上）を回復済みとみなす
const ACTIVITY = [[1.2, 'ほぼ運動しない'], [1.375, '軽い運動（週1〜3回）'], [1.55, '中程度の運動（週3〜5回）'], [1.725, '激しい運動（週6〜7回）']];
const GOALS = [['lose', '減量'], ['maintain', '維持'], ['gain', '増量']];

const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const r1 = n => Math.round(n * 10) / 10;

/* ---------- 体重・栄養 ---------- */
function weightOn(date) {
  let best = null;
  for (const b of D().body) if (b.date <= date && (!best || b.date > best.date)) best = b;
  return best;
}
// 7日前と比べた体重の変化（kg）
function weightTrend(date) {
  const cur = weightOn(date), prev = weightOn(dateStr(addDays(parseDate(date), -7)));
  return cur && prev && cur.date !== prev.date ? r1(cur.weight - prev.weight) : null;
}

// Mifflin-St Jeor式で基礎代謝 → 活動係数 → 目標に応じて増減
function targetsFor(date = dateStr()) {
  const pr = D().profile, rec = weightOn(date);
  if (!pr.age || !pr.height || !rec) return null;
  const wt = rec.weight;
  const bmr = 10 * wt + 6.25 * pr.height - 5 * pr.age + (pr.sex === 'female' ? -161 : 5);
  const tdee = bmr * pr.activity;
  const kcal = Math.round(tdee * ({ lose: 0.85, maintain: 1, gain: 1.1 }[pr.goal] || 1) / 10) * 10;
  const p = Math.round(wt * (pr.goal === 'maintain' ? 1.6 : 2.0));
  const f = Math.round(kcal * 0.25 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, p, f, c };
}

function mealTotals(date) {
  const t = { kcal: 0, p: 0, f: 0, c: 0, count: 0 };
  for (const m of D().meals) {
    if (m.date !== date) continue;
    t.kcal += m.kcal; t.p += m.p; t.f += m.f; t.c += m.c; t.count++;
  }
  return t;
}

/* ---------- 今日のプログラム ---------- */
function partStatus(today) {
  const since7 = dateStr(addDays(parseDate(today), -6));
  const st = Object.fromEntries(TRAIN_PARTS.map(p => [p, { last: null, sets7: 0 }]));
  for (const w of D().workouts) {
    if (w.date > today) continue;
    for (const e of w.exercises) {
      const s = st[getEx(e.exId).part], n = e.sets.filter(x => x.done).length;
      if (!s || !n) continue;
      if (!s.last || w.date > s.last) s.last = w.date;
      if (w.date >= since7) s.sets7 += n;
    }
  }
  for (const p of TRAIN_PARTS) {
    const s = st[p];
    s.days = s.last ? daysBetween(s.last, today) : null;
    s.ready = s.days == null || s.days >= RECOVERY_DAYS;
  }
  return st;
}

function streakBefore(today) {
  const set = new Set(D().workouts.map(w => w.date));
  let n = 0;
  for (let d = addDays(parseDate(today), -1); set.has(dateStr(d)); d = addDays(d, -1)) n++;
  return n;
}

// よく行う種目を優先し、足りなければ標準種目で補う
function pickExercises(part, n) {
  const cnt = countByEx();
  const used = Object.keys(cnt).filter(id => { const ex = getEx(id); return ex.part === part && !ex.hidden; }).sort((a, b) => cnt[b] - cnt[a]);
  const defaults = DEFAULT_EXERCISES.filter(e => e.part === part).map(e => e.id);
  return [...new Set([...used, ...defaults])].slice(0, n);
}

// 前回の記録から今日のセットを提案（漸進性過負荷）
function suggestExercise(exId) {
  const ex = getEx(exId), prev = prevSets(exId);
  if (!prev.length) return { exId, sets: initialSets(exId, null, false), note: '初めての種目：軽めの重量でフォームを確認' };
  const sets = prev.map(s => cleanSet(s, false));
  if (!isWR(ex)) return { exId, sets, note: '前回より少しだけ多く（回数・時間・距離）を目標' };
  if (prev.some(s => s.w > 0) && prev.every(s => (s.r || 0) >= 10)) {
    const inc = ex.eq === 'ダンベル' ? 1 : 2.5;
    sets.forEach(s => { if (s.w > 0) { s.w = r1(s.w + inc); s.r = 8; } });
    return { exId, sets, note: `前回は全セット10回以上 → +${inc}kgに挑戦` };
  }
  return { exId, sets, note: '前回と同じ重量で各セット+1回を目標' };
}

function todayPlan(today = dateStr()) {
  const d = D();
  if (d.workouts.some(w => w.date === today)) return { type: 'done' };
  const st = partStatus(today), streak = streakBefore(today);
  if (streak >= 3) return { type: 'rest', st, reason: `${streak}日連続でトレーニングしています。今日は休養日にして回復させましょう。` };
  const ready = TRAIN_PARTS.filter(p => st[p].ready);
  if (!ready.length) return { type: 'rest', st, reason: '全部位が回復中です。軽い有酸素やストレッチがおすすめです。' };
  const score = p => st[p].days == null ? 99 : st[p].days;

  // 対象部位がすべて回復済みのルーティンがあれば、最も間隔が空いたものを優先
  let best = null;
  for (const r of d.routines) {
    const parts = [...new Set(r.exercises.map(e => getEx(e.exId).part))].filter(p => st[p]);
    if (!parts.length || !parts.every(p => st[p].ready)) continue;
    const s = Math.min(...parts.map(score));
    if (!best || s > best.s) best = { r, parts, s };
  }
  if (best) {
    const exercises = best.r.exercises.map(e => {
      const sug = suggestExercise(e.exId);
      return prevSets(e.exId).length ? sug : { ...sug, sets: e.sets.map(x => cleanSet(x, false)) };
    });
    return { type: 'routine', name: best.r.name, parts: best.parts, exercises, st };
  }

  // 自動作成: 最も間隔が空いた大きい部位 + もう1部位
  const order = [...ready].sort((a, b) => score(b) - score(a) || BIG_PARTS.includes(b) - BIG_PARTS.includes(a));
  const main = order.find(p => BIG_PARTS.includes(p)) || order[0];
  const sub = order.find(p => p !== main);
  const parts = sub ? [main, sub] : [main];
  const exercises = [...pickExercises(main, 3), ...(sub ? pickExercises(sub, 2) : [])].map(suggestExercise);
  return { type: 'auto', name: parts.map(p => partOf(p).name).join('・') + 'の日', parts, exercises, st };
}

/* ---------- アドバイス ---------- */
function dailyAdvice(date) {
  const out = [], pr = D().profile, t = targetsFor(date), m = mealTotals(date), isToday = date === dateStr();
  const trained = D().workouts.some(w => w.date === date);

  if (!pr.age || !pr.height) out.push('設定でプロフィール（年齢・身長）を入力すると、目標カロリーとPFCを計算できます。');
  else if (!t) out.push('体重を記録すると、目標カロリーとPFCを計算できます。');

  if (!m.count) {
    out.push(isToday ? '食事を記録すると、カロリーと栄養バランスをチェックできます。' : 'この日の食事記録はありません。');
  } else if (t) {
    const pGap = t.p - m.p;
    if (pGap > t.p * 0.1) out.push(`タンパク質があと約${Math.round(pGap)}g${isToday ? '不足しています' : '不足していました'}。鶏むね肉100g（約23g）やプロテイン1杯（約22g）で補えます。`);
    else out.push('タンパク質は目標をほぼ達成しています 👍');
    const diff = m.kcal - t.kcal;
    if (Math.abs(diff) <= t.kcal * 0.1) out.push('摂取カロリーは目標の±10%以内です。');
    else if (diff > 0) out.push(`摂取カロリーが目標を約${fmtNum(Math.round(diff))}kcal超えています。${pr.goal === 'lose' ? '揚げ物など脂質の多い食品を控えめにしましょう。' : ''}`);
    else if (isToday) out.push(`目標まであと約${fmtNum(Math.round(-diff))}kcal食べられます。`);
    else out.push(`摂取カロリーが目標より約${fmtNum(Math.round(-diff))}kcal少なめでした。${pr.goal === 'gain' ? '増量中は不足しないよう注意しましょう。' : ''}`);
  }

  if (trained) out.push('トレーニング後はタンパク質と炭水化物をしっかり摂り、睡眠で回復させましょう。');
  else if (isToday) {
    const plan = todayPlan(date);
    if (plan.type === 'rest') out.push(plan.reason);
    else if (plan.type !== 'done') out.push(`今日のおすすめは「${plan.name}」です。`);
  }

  const tr = weightTrend(date);
  if (tr != null) {
    if (pr.goal === 'lose' && tr > 0.2) out.push('直近1週間で体重が増加傾向です。食事量を見直してみましょう。');
    else if (pr.goal === 'lose' && tr < -1) out.push('減量ペースが速め（週1kg超）です。筋肉を落とさないよう、食事量を少し増やしましょう。');
    else if (pr.goal === 'gain' && tr < 0) out.push('増量中ですが体重が減っています。食事量を増やしましょう。');
  }
  if (isToday && !D().body.some(b => b.date === date)) out.push('朝の体重を記録しておくと、変化を追いやすくなります。');
  return out;
}
