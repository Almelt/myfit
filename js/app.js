'use strict';

/* ================= ユーティリティ ================= */
const $ = (s, el = document) => el.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const weekStart = d => addDays(d, -((d.getDay() + 6) % 7)); // 月曜始まり
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const fmtDate = s => { const d = parseDate(s); return `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`; };
const md = s => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString('ja-JP');
function fmtDur(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
const toKatakana = s => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
const D = () => Store.data;

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ================= 種目・記録の計算 ================= */
const partOf = id => PARTS.find(p => p.id === id) || { id: 'other', name: 'その他', color: '#868e96' };
const allExercises = () => DEFAULT_EXERCISES.concat(D().customExercises);
const getEx = id => allExercises().find(e => e.id === id) || { id, name: '(不明な種目)', part: 'other', eq: '', type: 'wr' };

const FIELDS = { wr: [['w', 'kg'], ['r', '回']], r: [['r', '回']], t: [['t', '秒']], c: [['t', '分'], ['d', 'km']] };
const fieldsOf = ex => FIELDS[ex.type] || FIELDS.wr;
const isWR = ex => !FIELDS[ex.type] || ex.type === 'wr';
const e1rm = s => (s.w > 0 && s.r > 0) ? (s.r === 1 ? s.w : s.w * (1 + s.r / 30)) : 0; // Epley式
const setText = (ex, s) => fieldsOf(ex).map(([k, u]) => `${s[k] ?? '-'}${u}`).join(' × ');

function metric(ex, sets) {
  const done = sets.filter(s => s.done);
  const key = { r: 'r', t: 't', c: 'd' }[ex.type];
  return key ? Math.max(0, ...done.map(s => s[key] || 0)) : Math.max(0, ...done.map(e1rm));
}
const metricLabel = ex => ({ r: '最大回数', t: '最長時間(秒)', c: '最長距離(km)' }[ex.type] || '推定1RM(kg)');
const volumeOf = w => w.exercises.reduce((v, e) => v + e.sets.reduce((a, s) => a + (s.done && s.w > 0 && s.r > 0 ? s.w * s.r : 0), 0), 0);
const doneSets = w => w.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);

const cmpW = (a, b) => b.date.localeCompare(a.date) || b.start - a.start;
const workoutsSorted = () => [...D().workouts].sort(cmpW);

function historyOf(exId) {
  const out = [];
  for (const w of workoutsSorted()) {
    for (const e of w.exercises) if (e.exId === exId && e.sets.some(s => s.done)) out.push({ w, e });
  }
  return out;
}
function prevSets(exId, excludeId) {
  const h = historyOf(exId).find(x => x.w.id !== excludeId);
  return h ? h.e.sets.filter(s => s.done) : [];
}
function countByEx() {
  const cnt = {};
  for (const w of D().workouts) for (const e of w.exercises) if (e.sets.some(s => s.done)) cnt[e.exId] = (cnt[e.exId] || 0) + 1;
  return cnt;
}
function cleanSet(s, done) {
  const o = { done };
  for (const k of ['w', 'r', 't', 'd']) if (s && s[k] != null) o[k] = s[k];
  return o;
}
function initialSets(exId, excludeId, done) {
  const prev = prevSets(exId, excludeId);
  if (prev.length) return prev.map(s => cleanSet(s, done));
  const n = getEx(exId).type === 'c' ? 1 : 3;
  return Array.from({ length: n }, () => ({ done }));
}
// このワークアウトで自己ベストを更新した種目
function prsIn(w) {
  const out = new Set();
  for (const e of w.exercises) {
    const ex = getEx(e.exId), cur = metric(ex, e.sets);
    if (!cur) continue;
    const before = historyOf(e.exId).filter(x => x.w.id !== w.id && cmpW(x.w, w) > 0);
    if (before.length && cur > Math.max(...before.map(x => metric(ex, x.e.sets)))) out.add(e.exId);
  }
  return out;
}
function filterEx(part, q) {
  q = toKatakana((q || '').trim().toLowerCase());
  return allExercises().filter(e => !e.hidden && (part === 'all' || e.part === part) &&
    (!q || toKatakana(e.name.toLowerCase()).includes(q) || (e.eq || '').includes(q)));
}

/* ================= 画面状態と戻る操作 ================= */
const ui = {
  tab: 'home', screen: null, editId: null, detailId: null, stack: [],
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel: dateStr(),
  libPart: 'all', libQ: '', statsEx: null, rest: null, picker: null,
  mealDate: dateStr(), reportDate: dateStr(), mealForm: null, foodQ: '',
};
let navDepth = 0;

const sheetOpen = () => !$('#sheet').hidden;
function navBack() {
  if (navDepth > 0) history.back();
  else if (sheetOpen()) hideSheet();
  else if (ui.screen) leaveScreen();
}
window.addEventListener('popstate', () => {
  navDepth = Math.max(0, navDepth - 1);
  if (sheetOpen()) hideSheet();
  else if (ui.screen) leaveScreen();
});
function goTo(state) {
  ui.stack.push({ screen: ui.screen, editId: ui.editId, detailId: ui.detailId, scroll: window.scrollY });
  Object.assign(ui, { screen: null, editId: null, detailId: null }, state);
  history.pushState({ n: ++navDepth }, '');
  render();
  window.scrollTo(0, 0);
}
function replaceScreen(state) {
  Object.assign(ui, { screen: null, editId: null, detailId: null }, state);
  render();
  window.scrollTo(0, 0);
}
function leaveScreen() {
  if (ui.screen === 'workout' && ui.editId) finalizeEdit(ui.editId);
  const prev = ui.stack.pop() || { screen: null };
  Object.assign(ui, { screen: prev.screen, editId: prev.editId || null, detailId: prev.detailId || null });
  render();
  window.scrollTo(0, prev.scroll || 0);
}

/* ================= ボトムシート ================= */
function openSheet(html) {
  if (!sheetOpen()) history.pushState({ n: ++navDepth }, '');
  $('#sheet-body').innerHTML = html;
  $('#sheet-body').classList.remove('picker');
  $('#sheet').hidden = false;
  $('#sheet-body').scrollTop = 0;
  document.body.classList.add('no-scroll');
}
function hideSheet() {
  $('#sheet').hidden = true;
  $('#sheet-body').innerHTML = '';
  document.body.classList.remove('no-scroll');
  ui.picker = null;
}

/* ================= 描画 ================= */
function render() {
  if (ui.screen === 'workout' && !curW()) Object.assign(ui, { screen: null, editId: null });
  if (ui.screen === 'detail' && !D().workouts.some(w => w.id === ui.detailId)) ui.screen = null;

  const v = ui.screen === 'workout' ? viewWorkout()
    : ui.screen === 'detail' ? viewDetail()
    : ui.screen === 'report' ? viewReport()
    : ui.screen === 'settings' ? viewSettings()
    : { home: viewHome, calendar: viewCalendar, meals: viewMeals, stats: viewStats, library: viewLibrary }[ui.tab]();

  document.body.classList.toggle('in-screen', !!ui.screen);
  $('#back').hidden = !ui.screen;
  $('#title').textContent = v.title;
  $('#top-actions').innerHTML = v.actions || '';
  $('#view').innerHTML = v.html;
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  renderActiveBar();
  renderRest();
  if (v.after) v.after();
}

function renderActiveBar() {
  const a = D().active, el = $('#active-bar');
  el.hidden = !a || !!ui.screen;
  if (!el.hidden) {
    el.innerHTML = `<span class="pulse"></span><strong class="ellipsis">${esc(a.title)}</strong>
      <span class="js-elapsed">${fmtDur(Date.now() - a.start)}</span><span class="chev">›</span>`;
  }
}

const chipsHtml = (action, active) => [{ id: 'all', name: 'すべて' }, ...PARTS].map(p =>
  `<button class="chip ${p.id === active ? 'active' : ''}" data-action="${action}" data-part="${p.id}">${p.name}</button>`).join('');

function workoutCard(w) {
  const parts = [...new Set(w.exercises.map(e => getEx(e.exId).part))];
  const dur = w.end && w.end - w.start >= 60000 ? ` · ${fmtDur(w.end - w.start)}` : '';
  return `<button class="card w-card" data-action="open-detail" data-id="${w.id}">
    <div class="row-between"><strong class="ellipsis">${esc(w.title)}</strong><span class="muted small nowrap">${fmtDate(w.date)}</span></div>
    <div class="muted small">${w.exercises.length}種目 · ${doneSets(w)}セット · ${fmtNum(volumeOf(w))}kg${dur}</div>
    <div class="tags">${parts.map(p => `<span class="tag" style="--c:${partOf(p).color}">${partOf(p).name}</span>`).join('')}</div>
  </button>`;
}

/* ---------- ホーム ---------- */
function viewHome() {
  const d = D(), a = d.active, today = dateStr(), wk = weekStart(new Date());
  const trained = new Set(d.workouts.map(w => w.date));
  let strip = '', cnt = 0;
  for (let i = 0; i < 7; i++) {
    const x = addDays(wk, i), ds = dateStr(x), on = trained.has(ds);
    if (on) cnt++;
    strip += `<div class="wd ${on ? 'on' : ''} ${ds === today ? 'today' : ''}"><div class="small muted">${WEEK[x.getDay()]}</div><div class="c">${x.getDate()}</div></div>`;
  }
  let html = `<section class="card"><div class="row-between"><strong>今週のトレーニング</strong><span class="accent-text">${cnt}日</span></div>
    <div class="week">${strip}</div></section>`;

  const wt = d.body.find(b => b.date === today), m = mealTotals(today), t = targetsFor(today);
  html += `<section class="card"><div class="row-between"><strong>今日</strong>
      <button class="btn small ghost" data-action="open-report" data-date="${today}">レポート ›</button></div>
    <div class="today-grid">
      <button class="mini" data-action="weight-open" data-date="${today}"><div class="l">体重</div>
        <div class="v">${wt ? `${fmtNum(wt.weight)}<small>kg</small>` : '<span class="accent-text">＋記録</span>'}</div></button>
      <button class="mini" data-action="open-meals"><div class="l">摂取カロリー</div>
        <div class="v">${fmtNum(m.kcal)}<small>${t ? `/${fmtNum(t.kcal)}` : ''}kcal</small></div></button>
      <button class="mini" data-action="open-meals"><div class="l">タンパク質</div>
        <div class="v">${fmtNum(m.p)}<small>${t ? `/${t.p}` : ''}g</small></div></button>
    </div></section>`;

  html += a
    ? `<button class="card active-card" data-action="open-active">
        <div class="small muted">進行中のワークアウト</div><strong>${esc(a.title)}</strong>
        <div class="big js-elapsed">${fmtDur(Date.now() - a.start)}</div><span class="btn primary">再開する</span></button>`
    : (plan => planCardHtml(plan) + `<button class="btn block ${plan.exercises ? 'ghost' : 'primary big-btn'}" data-action="start-empty">＋ 自由にワークアウトを開始</button>`)(todayPlan());

  html += `<h2 class="sec">ルーティン<button class="btn small ghost" data-action="routine-new">＋ 新規</button></h2>`;
  html += d.routines.length
    ? d.routines.map(r => `<div class="card routine">
        <div class="r-main"><strong class="ellipsis">${esc(r.name)}</strong>
        <div class="small muted ellipsis">${r.exercises.map(e => esc(getEx(e.exId).name)).join('・') || '種目なし'}</div></div>
        <button class="icon-btn" data-action="routine-menu" data-id="${r.id}" aria-label="メニュー">⋯</button>
        <button class="btn small primary" data-action="routine-start" data-id="${r.id}">開始</button></div>`).join('')
    : `<div class="card muted small">よく行うメニューをルーティンとして保存すると、ワンタップで開始できます。</div>`;

  const recent = workoutsSorted().slice(0, 5);
  html += `<h2 class="sec">最近のワークアウト</h2>` + (recent.length ? recent.map(workoutCard).join('')
    : `<div class="empty">まだ記録がありません。<br>最初のワークアウトを始めましょう！</div>`);
  return {
    title: 'MyFit', html,
    actions: `<button class="icon-btn" data-action="open-settings" aria-label="設定">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg></button>`,
  };
}

/* ---------- 今日のおすすめ ---------- */
const tagHtml = p => `<span class="tag" style="--c:${partOf(p).color}">${partOf(p).name}</span>`;

function recoveryHtml(st) {
  return `<div class="recov">${TRAIN_PARTS.map(p => {
    const s = st[p], label = s.days == null ? '未実施' : s.days === 0 ? '今日' : `${s.days}日前`;
    return `<div class="rv ${s.ready ? 'ok' : ''}"><b style="background:${partOf(p).color}"></b>${partOf(p).name}<span>${label}</span></div>`;
  }).join('')}</div><div class="muted small">部位ごとの最終トレーニング（中${RECOVERY_DAYS - 1}日以上空いた部位が対象）</div>`;
}

function planCardHtml(plan = todayPlan()) {
  if (plan.type === 'done') {
    return `<section class="card plan"><strong>今日のトレーニングは完了 💪</strong>
      <div class="muted small">しっかり食べて、しっかり休みましょう。</div></section>`;
  }
  if (plan.type === 'rest') {
    return `<section class="card plan"><div class="small muted">今日のおすすめ</div><strong>休養日</strong>
      <div class="small">${esc(plan.reason)}</div>${recoveryHtml(plan.st)}</section>`;
  }
  const list = plan.exercises.map(x => {
    const ex = getEx(x.exId), top = x.sets[0];
    return `<li><div class="row-between"><span>${esc(ex.name)}</span>
      <span class="muted small nowrap">${x.sets.length}セット${top && isWR(ex) && top.w ? ` · ${fmtNum(top.w)}kg` : ''}</span></div>
      <div class="note">${esc(x.note)}</div></li>`;
  }).join('');
  return `<section class="card plan"><div class="small muted">今日のおすすめ${plan.type === 'routine' ? '（ルーティン）' : ''}</div>
    <div class="row-between"><strong>${esc(plan.name)}</strong><div class="tags">${plan.parts.map(tagHtml).join('')}</div></div>
    <ul class="plan-list">${list}</ul>${recoveryHtml(plan.st)}
    <button class="btn block primary" data-action="plan-start">このメニューで開始</button></section>`;
}

/* ---------- 体重 ---------- */
function openWeight(date) {
  const rec = D().body.find(b => b.date === date);
  openSheet(`<div class="sheet-head"><h2>体重を記録</h2><button class="icon-btn" data-action="back" aria-label="閉じる">✕</button></div>
    <label class="field">日付<input type="date" id="wt-date" value="${date}" max="${dateStr()}"></label>
    <div class="form-grid">
      <label class="field">体重 (kg)<input type="number" inputmode="decimal" step="0.1" min="0" id="wt-w" value="${rec?.weight ?? weightOn(date)?.weight ?? ''}"></label>
      <label class="field">体脂肪率 (%・任意)<input type="number" inputmode="decimal" step="0.1" min="0" id="wt-f" value="${rec?.fat ?? ''}"></label>
    </div>
    <div class="sheet-foot">${rec ? '<button class="btn danger" data-action="wt-delete">削除</button>' : ''}
      <button class="btn primary" data-action="wt-save">保存</button></div>`);
  $('#wt-w').focus();
}

/* ---------- 食事 ---------- */
const MEALS = [['breakfast', '朝食'], ['lunch', '昼食'], ['snack', '間食'], ['dinner', '夕食']];
const defaultMeal = () => { const h = new Date().getHours(); return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : 'dinner'; };

function dateNav(action, date) {
  const today = dateStr();
  return `<div class="date-nav">
    <button class="icon-btn big-icon" data-action="${action}" data-d="-1" aria-label="前の日">‹</button>
    <strong>${fmtDate(date)}${date === today ? '<span class="accent-text small"> 今日</span>' : ''}</strong>
    <button class="icon-btn big-icon" data-action="${action}" data-d="1" ${date >= today ? 'disabled' : ''} aria-label="次の日">›</button></div>`;
}

function nutritionSummary(m, t) {
  const bar = (label, v, target, color) => `<div class="nbar"><span>${label}</span>
    <div class="track"><div style="width:${target ? Math.min(100, v / target * 100) : 0}%;background:${color}"></div></div>
    <span class="num">${fmtNum(v)}${target ? `/${target}` : ''}g</span></div>`;
  return `<div class="kcal-big"><span class="v">${fmtNum(m.kcal)}</span><span class="muted"> ${t ? `/ ${fmtNum(t.kcal)} ` : ''}kcal</span>
      ${t ? `<span class="muted small right">${m.kcal <= t.kcal ? `残り ${fmtNum(t.kcal - m.kcal)}` : `${fmtNum(m.kcal - t.kcal)} オーバー`}</span>` : ''}</div>
    ${t ? `<div class="track big"><div style="width:${Math.min(100, m.kcal / t.kcal * 100)}%;background:${m.kcal > t.kcal * 1.1 ? 'var(--danger)' : 'var(--accent)'}"></div></div>` : ''}
    ${bar('タンパク質', m.p, t?.p, '#ff6b6b')}${bar('脂質', m.f, t?.f, '#ffd43b')}${bar('炭水化物', m.c, t?.c, '#4dabf7')}
    ${t ? '' : `<div class="muted small">設定でプロフィールを入力し体重を記録すると、目標が表示されます。</div>`}`;
}

function viewMeals() {
  const date = ui.mealDate, items = D().meals.filter(x => x.date === date);
  let html = dateNav('meal-day', date) + `<section class="card">${nutritionSummary(mealTotals(date), targetsFor(date))}</section>`;
  for (const [id, name] of MEALS) {
    const list = items.filter(x => x.meal === id);
    html += `<section class="card meal"><div class="row-between"><strong>${name}</strong>
      <span class="muted small">${fmtNum(list.reduce((a, x) => a + x.kcal, 0))} kcal</span></div>
      ${list.map(x => `<button class="food-row" data-action="meal-edit" data-id="${x.id}">
        <span class="ellipsis">${esc(x.name)}${x.qty !== 1 ? ` ×${x.qty}` : ''}</span>
        <span class="muted small nowrap">P${fmtNum(x.p)} F${fmtNum(x.f)} C${fmtNum(x.c)}</span><strong class="nowrap">${fmtNum(x.kcal)}</strong></button>`).join('')}
      <button class="btn small ghost add" data-action="meal-add" data-meal="${id}" data-date="${date}">＋ 追加</button></section>`;
  }
  html += `<button class="btn block ghost" data-action="open-report" data-date="${date}">この日のレポートを見る</button>`;
  return { title: '食事', html };
}

function openMealForm(init) {
  ui.mealForm = init;
  ui.foodQ = '';
  showMealForm();
}
function showMealForm() {
  const f = ui.mealForm;
  openSheet(`<div class="sheet-head"><h2>${f.id ? '食事を編集' : '食事を追加'}</h2><button class="icon-btn" data-action="back" aria-label="閉じる">✕</button></div>
    <div class="chips" id="mf-meals">${mealChips(f.meal)}</div>
    <label class="field">食品名<input data-mf="name" value="${esc(f.name)}" maxlength="40" placeholder="例：鶏むね肉のグリル"></label>
    <div class="muted small">栄養（1人前あたり）</div>
    <div class="form-grid four">${[['kcal', 'kcal'], ['p', 'P (g)'], ['f', 'F (g)'], ['c', 'C (g)']].map(([k, l]) =>
      `<label class="field">${l}<input type="number" inputmode="decimal" step="any" min="0" data-mf="${k}" value="${f[k] ?? ''}"></label>`).join('')}</div>
    <div class="qty-row"><span class="muted small">数量</span>${[0.5, 1, 1.5, 2].map(q =>
      `<button class="chip ${f.qty === q ? 'active' : ''}" data-action="mf-qty" data-q="${q}">×${q}</button>`).join('')}
      <input type="number" inputmode="decimal" step="0.1" min="0" data-mf="qty" value="${f.qty}" class="qty-in" aria-label="数量"></div>
    <div class="mf-total" id="mf-total">${mfTotalText()}</div>
    <div class="sheet-foot">${f.id ? '<button class="btn danger" data-action="mf-delete">削除</button>' : ''}
      <button class="btn primary" data-action="mf-save">保存</button></div>
    <h3 class="sub mt">よく食べるもの・食品リスト</h3>
    <input id="food-q" class="search" type="search" placeholder="食品を検索（ひらがなでもOK）" value="${esc(ui.foodQ)}" autocomplete="off">
    <div id="food-list"></div>`);
  refreshFoodList();
}
const mealChips = active => MEALS.map(([id, name]) =>
  `<button class="chip ${id === active ? 'active' : ''}" data-action="mf-meal" data-meal="${id}">${name}</button>`).join('');
function mfTotalText() {
  const f = ui.mealForm, q = f.qty > 0 ? f.qty : 1;
  return `合計 <strong>${fmtNum((f.kcal || 0) * q)} kcal</strong> · P${fmtNum((f.p || 0) * q)} F${fmtNum((f.f || 0) * q)} C${fmtNum((f.c || 0) * q)}`;
}
// 最近食べたもの（新しい順・重複なし）＋標準の食品リスト
function foodCandidates(q) {
  const seen = new Set(), out = [];
  for (let i = D().meals.length - 1; i >= 0; i--) {
    const x = D().meals[i], n = x.qty || 1;
    if (seen.has(x.name)) continue;
    seen.add(x.name);
    const yomi = FOODS.find(fd => fd.name === x.name)?.yomi || '';
    out.push({ name: x.name, yomi, kcal: r1(x.kcal / n), p: r1(x.p / n), f: r1(x.f / n), c: r1(x.c / n), recent: true });
  }
  for (const x of FOODS) if (!seen.has(x.name)) out.push(x);
  q = toKatakana((q || '').trim().toLowerCase());
  return (q ? out.filter(x => toKatakana(`${x.name} ${x.yomi || ''}`.toLowerCase()).includes(q)) : out).slice(0, 40);
}
function refreshFoodList() {
  $('#food-list').innerHTML = foodCandidates(ui.foodQ).map((x, i) => `<button class="food-row" data-action="mf-pick" data-i="${i}">
      ${x.recent ? '<span class="tag" style="--c:var(--accent)">最近</span>' : ''}<span class="ellipsis">${esc(x.name)}</span>
      <span class="muted small nowrap">P${fmtNum(x.p)} F${fmtNum(x.f)} C${fmtNum(x.c)}</span><strong class="nowrap">${fmtNum(x.kcal)}</strong></button>`).join('')
    || `<div class="empty">見つかりません。上のフォームに直接入力してください</div>`;
}

/* ---------- 日次レポート ---------- */
function viewReport() {
  const date = ui.reportDate, isToday = date === dateStr(), pr = D().profile;
  const ws = D().workouts.filter(w => w.date === date).sort(cmpW);
  const wt = D().body.find(b => b.date === date), tr = weightTrend(date);

  let html = dateNav('report-day', date);
  html += `<section class="card"><h3 class="sub">🏋️ トレーニング</h3>` + (ws.length ? ws.map(w => {
    const prs = prsIn(w), dur = w.end && w.end - w.start >= 60000 ? ` · ${fmtDur(w.end - w.start)}` : '';
    return `<button class="rep-w" data-action="open-detail" data-id="${w.id}"><strong>${esc(w.title)}</strong>
      <div class="muted small">${w.exercises.length}種目 · ${doneSets(w)}セット · ${fmtNum(volumeOf(w))}kg${dur}</div>
      <div class="tags">${[...new Set(w.exercises.map(e => getEx(e.exId).part))].map(tagHtml).join('')}</div>
      ${prs.size ? `<div class="small pr-text">🏆 自己ベスト：${[...prs].map(id => esc(getEx(id).name)).join('、')}</div>` : ''}</button>`;
  }).join('') : '<div class="muted">休養日</div>') + '</section>';

  html += `<section class="card"><div class="row-between"><h3 class="sub">⚖️ 体重</h3>
      <button class="btn small ghost" data-action="weight-open" data-date="${date}">${wt ? '編集' : '＋ 記録'}</button></div>` +
    (wt ? `<div class="kcal-big"><span class="v">${fmtNum(wt.weight)}</span><span class="muted"> kg</span>
        ${wt.fat ? `<span class="muted small"> · 体脂肪率 ${fmtNum(wt.fat)}%</span>` : ''}</div>
        <div class="muted small">${tr != null ? `7日前比 ${tr > 0 ? '+' : ''}${fmtNum(tr)}kg` : '7日前の記録なし'}${pr.targetWeight ? ` · 目標体重まで ${fmtNum(Math.abs(wt.weight - pr.targetWeight))}kg` : ''}</div>`
      : '<div class="muted">記録なし</div>') + '</section>';

  html += `<section class="card"><div class="row-between"><h3 class="sub">🍚 食事</h3>
      <button class="btn small ghost" data-action="meal-add" data-meal="${defaultMeal()}" data-date="${date}">＋ 追加</button></div>
    ${nutritionSummary(mealTotals(date), targetsFor(date))}</section>`;

  html += `<section class="card advice"><h3 class="sub">💡 アドバイス</h3><ul>${dailyAdvice(date).map(a => `<li>${esc(a)}</li>`).join('')}</ul></section>`;
  if (isToday && !D().active) html += planCardHtml();
  html += `<button class="btn block" data-action="report-share">レポートを共有・コピー</button>`;
  return { title: '日次レポート', html };
}

function reportText(date) {
  const ws = D().workouts.filter(w => w.date === date), wt = D().body.find(b => b.date === date);
  const tr = weightTrend(date), m = mealTotals(date), t = targetsFor(date);
  const lines = [`【MyFit ${fmtDate(date)}】`];
  lines.push('■トレーニング');
  if (ws.length) {
    for (const w of ws) {
      lines.push(`${w.title}：${doneSets(w)}セット / ${fmtNum(volumeOf(w))}kg`);
      for (const e of w.exercises) {
        const ex = getEx(e.exId);
        lines.push(`・${ex.name} ${e.sets.filter(s => s.done).map(s => setText(ex, s)).join(', ')}`);
      }
    }
  } else lines.push('休養日');
  lines.push('■体重', wt ? `${fmtNum(wt.weight)}kg${wt.fat ? `（体脂肪率${fmtNum(wt.fat)}%）` : ''}${tr != null ? ` 7日前比${tr > 0 ? '+' : ''}${fmtNum(tr)}kg` : ''}` : '記録なし');
  lines.push('■食事', m.count
    ? `${fmtNum(m.kcal)}${t ? `/${t.kcal}` : ''}kcal P${fmtNum(m.p)}${t ? `/${t.p}` : ''}g F${fmtNum(m.f)}${t ? `/${t.f}` : ''}g C${fmtNum(m.c)}${t ? `/${t.c}` : ''}g`
    : '記録なし');
  lines.push('■アドバイス', ...dailyAdvice(date).map(a => `・${a}`));
  return lines.join('\n');
}

async function shareReport() {
  const text = reportText(ui.reportDate);
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  try { await navigator.clipboard.writeText(text); toast('レポートをコピーしました'); } catch { toast('コピーできませんでした'); }
}

/* ---------- ワークアウト記録 ---------- */
function curW() { return ui.editId ? D().workouts.find(w => w.id === ui.editId) : D().active; }

function viewWorkout() {
  const w = curW(), editing = !!ui.editId;
  let html = `<div class="w-head">
    <input class="w-title" data-wfield="title" value="${esc(w.title)}" maxlength="40" aria-label="タイトル">
    ${editing
      ? `<input type="date" class="w-date" data-wfield="date" value="${w.date}" max="${dateStr()}">
         <div class="muted small">チェックの付いたセットだけが保存されます</div>`
      : `<div class="w-meta"><span class="js-elapsed">${fmtDur(Date.now() - w.start)}</span> · <span id="w-vol">${fmtNum(volumeOf(w))}</span> kg</div>`}
  </div>`;
  w.exercises.forEach((e, i) => { html += exCard(w, e, i); });
  if (!w.exercises.length) html += `<div class="empty">「種目を追加」からトレーニングを始めましょう</div>`;
  html += `<button class="btn block ghost" data-action="w-add-ex">＋ 種目を追加</button>
    <textarea class="w-memo" data-wfield="memo" rows="2" placeholder="メモ（体調・気づきなど）">${esc(w.memo || '')}</textarea>`;
  html += editing
    ? `<button class="btn block primary" data-action="back">保存して戻る</button>`
    : `<button class="btn block primary" data-action="w-finish">ワークアウト完了</button>
       <button class="btn block danger" data-action="w-discard">ワークアウトを破棄</button>`;
  return { title: editing ? '記録を編集' : 'ワークアウト', html };
}

function exCard(w, e, i) {
  const ex = getEx(e.exId), p = partOf(ex.part), f = fieldsOf(ex), n = f.length;
  const prev = prevSets(e.exId, w.id);
  const rows = e.sets.map((s, j) => `
    <div class="set-row ${s.done ? 'done' : ''}" style="--n:${n}" data-i="${i}" data-j="${j}">
      <span class="set-no">${j + 1}</span>
      <span class="set-prev">${prev[j] ? esc(setText(ex, prev[j])) : '-'}</span>
      ${f.map(([k]) => `<input type="number" inputmode="decimal" step="any" min="0" data-k="${k}" value="${s[k] ?? ''}">`).join('')}
      <button class="chk" data-action="set-toggle" aria-label="セット完了">✓</button>
    </div>`).join('');
  return `<section class="card ex-card">
    <div class="ex-head">
      <span class="dot" style="background:${p.color}"></span>
      <button class="ex-name" data-action="ex-info" data-id="${ex.id}">${esc(ex.name)}</button>
      <button class="icon-btn" data-action="ex-move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button class="icon-btn" data-action="ex-move" data-i="${i}" data-d="1" ${i === w.exercises.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button class="icon-btn" data-action="ex-remove" data-i="${i}" aria-label="削除">✕</button>
    </div>
    <div class="set-row set-hdr" style="--n:${n}"><span>セット</span><span>前回</span>${f.map(([, u]) => `<span>${u}</span>`).join('')}<span>完了</span></div>
    ${rows}
    <div class="ex-foot">
      <button class="btn small ghost" data-action="set-remove" data-i="${i}" ${e.sets.length ? '' : 'disabled'}>− セット削除</button>
      <button class="btn small ghost" data-action="set-add" data-i="${i}">＋ セット追加</button>
    </div>
  </section>`;
}

function updateVol() {
  const el = $('#w-vol'), w = curW();
  if (el && w) el.textContent = fmtNum(volumeOf(w));
}

function defaultTitle() {
  const h = new Date().getHours();
  return h < 11 ? '朝のワークアウト' : h < 17 ? '昼のワークアウト' : '夜のワークアウト';
}

function startWorkout(tpl) {
  if (D().active) {
    if (!confirm('進行中のワークアウトがあります。破棄して新しく始めますか？')) { goTo({ screen: 'workout' }); return; }
  }
  const w = { id: uid(), date: dateStr(), start: Date.now(), end: null, title: tpl?.name || defaultTitle(), memo: '', exercises: [] };
  if (tpl) {
    w.exercises = tpl.exercises.map(e => {
      const prev = prevSets(e.exId);
      // ルーティン側に値が無いセットは前回の記録で埋める
      return { exId: e.exId, sets: e.sets.map((s, j) => cleanSet(s.w != null || s.r != null || s.t != null || s.d != null ? s : prev[j], false)) };
    });
  }
  D().active = w;
  Store.save();
  ui.rest = null;
  // 詳細画面から始めた場合は置き換える（完了後に「戻る」でホームへ戻れるように）
  if (ui.screen === 'detail') replaceScreen({ screen: 'workout' });
  else goTo({ screen: 'workout' });
  requestWakeLock();
}

function finishWorkout() {
  const w = D().active;
  const total = w.exercises.reduce((n, e) => n + e.sets.length, 0), done = doneSets(w);
  if (!done) {
    if (confirm('完了したセットがありません。このワークアウトを破棄しますか？')) discardWorkout(true);
    return;
  }
  const undone = total - done;
  if (!confirm(undone ? `未完了の${undone}セットは記録されません。ワークアウトを完了しますか？` : 'ワークアウトを完了しますか？')) return;
  w.exercises = w.exercises.map(e => ({ ...e, sets: e.sets.filter(s => s.done) })).filter(e => e.sets.length);
  w.end = Date.now();
  D().workouts.push(w);
  D().active = null;
  Store.save();
  ui.rest = null;
  releaseWakeLock();
  replaceScreen({ screen: 'detail', detailId: w.id });
  toast('お疲れさまでした！💪');
}

function discardWorkout(skipConfirm) {
  if (!skipConfirm && !confirm('このワークアウトを破棄しますか？記録は保存されません。')) return;
  D().active = null;
  Store.save();
  ui.rest = null;
  releaseWakeLock();
  navBack();
}

function finalizeEdit(id) {
  const d = D(), w = d.workouts.find(x => x.id === id);
  if (!w) return;
  w.exercises = w.exercises.map(e => ({ ...e, sets: e.sets.filter(s => s.done) })).filter(e => e.sets.length);
  if (!w.exercises.length) {
    d.workouts = d.workouts.filter(x => x !== w);
    toast('セットが無いため記録を削除しました');
  }
  Store.save();
}

/* ---------- ワークアウト詳細 ---------- */
function viewDetail() {
  const w = D().workouts.find(x => x.id === ui.detailId);
  const prs = prsIn(w);
  const dur = w.end && w.end - w.start >= 60000 ? fmtDur(w.end - w.start) : '-';
  let html = `<section class="card">
    <div class="muted small">${fmtDate(w.date)}</div><h2 class="d-title">${esc(w.title)}</h2>
    <div class="kpis three">
      <div class="kpi"><div class="v">${dur}</div><div class="l">時間</div></div>
      <div class="kpi"><div class="v">${fmtNum(volumeOf(w))}</div><div class="l">ボリューム(kg)</div></div>
      <div class="kpi"><div class="v">${doneSets(w)}</div><div class="l">セット</div></div>
    </div></section>`;
  if (prs.size) html += `<section class="card pr-card">🏆 自己ベスト更新：${[...prs].map(id => esc(getEx(id).name)).join('、')}</section>`;
  for (const e of w.exercises) {
    const ex = getEx(e.exId);
    html += `<section class="card">
      <div class="ex-head"><span class="dot" style="background:${partOf(ex.part).color}"></span>
      <button class="ex-name" data-action="ex-info" data-id="${ex.id}">${esc(ex.name)}${prs.has(ex.id) ? ' 🏆' : ''}</button></div>
      ${e.sets.filter(s => s.done).map((s, j) => `<div class="set-line"><span class="set-no">${j + 1}</span><span>${esc(setText(ex, s))}</span>
        ${isWR(ex) && e1rm(s) ? `<span class="muted small">1RM ${fmtNum(e1rm(s))}</span>` : ''}</div>`).join('')}
    </section>`;
  }
  if (w.memo) html += `<section class="card"><div class="muted small">メモ</div><div class="pre">${esc(w.memo)}</div></section>`;
  html += `<div class="btn-grid">
    <button class="btn" data-action="d-edit" data-id="${w.id}">編集</button>
    <button class="btn" data-action="d-repeat" data-id="${w.id}">この内容で開始</button>
    <button class="btn" data-action="d-routine" data-id="${w.id}">ルーティンに保存</button>
    <button class="btn danger" data-action="d-delete" data-id="${w.id}">削除</button></div>`;
  return { title: 'ワークアウト詳細', html };
}

/* ---------- カレンダー ---------- */
function viewCalendar() {
  const m = ui.calMonth, y = m.getFullYear(), mo = m.getMonth();
  const days = new Date(y, mo + 1, 0).getDate(), today = dateStr();
  const prefix = `${y}-${pad(mo + 1)}-`;
  const byDate = {};
  for (const w of D().workouts) (byDate[w.date] ||= []).push(w);
  const monthWs = D().workouts.filter(w => w.date.startsWith(prefix));

  let cells = WEEK.map((d, i) => `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('');
  for (let i = 0; i < new Date(y, mo, 1).getDay(); i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const ds = prefix + pad(d), list = byDate[ds] || [];
    const parts = [...new Set(list.flatMap(w => w.exercises.map(e => getEx(e.exId).part)))].slice(0, 4);
    cells += `<button class="cal-day ${ds === today ? 'today' : ''} ${ds === ui.calSel ? 'sel' : ''} ${list.length ? 'has' : ''}" data-action="cal-sel" data-date="${ds}">
      <span>${d}</span><i>${parts.map(p => `<b style="background:${partOf(p).color}"></b>`).join('')}</i></button>`;
  }

  const sel = (byDate[ui.calSel] || []).sort(cmpW);
  let html = `<section class="card">
    <div class="cal-nav">
      <button class="icon-btn" data-action="cal-move" data-d="-1" aria-label="前の月">‹</button>
      <button class="cal-month" data-action="cal-today">${y}年${mo + 1}月</button>
      <button class="icon-btn" data-action="cal-move" data-d="1" aria-label="次の月">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="legend">${PARTS.map(p => `<span><b style="background:${p.color}"></b>${p.name}</span>`).join('')}</div>
  </section>
  <div class="kpis two">
    <div class="kpi card"><div class="v">${new Set(monthWs.map(w => w.date)).size}日</div><div class="l">今月のトレーニング日数</div></div>
    <div class="kpi card"><div class="v">${fmtNum(monthWs.reduce((a, w) => a + volumeOf(w), 0))}</div><div class="l">今月のボリューム(kg)</div></div>
  </div>
  <h2 class="sec">${fmtDate(ui.calSel)}</h2>`;
  html += sel.length ? sel.map(workoutCard).join('') : `<div class="empty">この日の記録はありません</div>`;
  if (ui.calSel <= today) {
    html += `<button class="btn block ghost" data-action="cal-add">＋ この日のワークアウトを追加</button>
      <button class="btn block ghost" data-action="open-report" data-date="${ui.calSel}">この日のレポートを見る</button>`;
  }
  return { title: 'カレンダー', html };
}

/* ---------- 統計 ---------- */
function viewStats() {
  const ws = D().workouts;
  const body = [...D().body].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  const bodyHtml = body.length ? `<section class="card"><div class="row-between"><h3 class="sub">体重の推移 (kg)</h3>
      <button class="btn small ghost" data-action="weight-open" data-date="${dateStr()}">＋ 記録</button></div>
      <canvas class="chart" id="c-body"></canvas></section>` : '';
  const drawBody = () => drawLine($('#c-body'), body.map(b => md(b.date)), body.map(b => b.weight));
  if (!ws.length) {
    return { title: '統計', html: bodyHtml + `<div class="empty">ワークアウトを記録すると、ここに統計が表示されます。</div>`, after: drawBody };
  }

  const now = new Date(), wk0 = weekStart(now);
  const wkS = dateStr(wk0), moS = dateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const thisWeek = ws.filter(w => w.date >= wkS), thisMonth = ws.filter(w => w.date >= moS);

  // 直近12週のボリューム
  const wLabels = [], wVals = [];
  for (let i = 11; i >= 0; i--) {
    const s = addDays(wk0, -7 * i), a = dateStr(s), b = dateStr(addDays(s, 7));
    wLabels.push(md(a));
    wVals.push(ws.filter(w => w.date >= a && w.date < b).reduce((v, w) => v + volumeOf(w), 0));
  }

  // 直近30日の部位別セット数
  const since = dateStr(addDays(now, -29)), pc = {};
  for (const w of ws) if (w.date >= since) for (const e of w.exercises) {
    const p = getEx(e.exId).part;
    pc[p] = (pc[p] || 0) + e.sets.filter(s => s.done).length;
  }
  const pMax = Math.max(1, ...Object.values(pc));
  const partRows = Object.entries(pc).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
    const p = partOf(id);
    return `<div class="pbar"><span>${p.name}</span><div class="track"><div style="width:${n / pMax * 100}%;background:${p.color}"></div></div><span class="num">${n}</span></div>`;
  }).join('') || `<div class="muted small">直近30日の記録はありません</div>`;

  // 種目ごとの推移
  const cnt = countByEx();
  const ids = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  if (!ui.statsEx || !cnt[ui.statsEx]) ui.statsEx = ids[0];
  const ex = getEx(ui.statsEx);
  const chron = historyOf(ui.statsEx).slice(0, 30).reverse();

  const prRows = ids.slice(0, 10).map(id => {
    const x = getEx(id), best = Math.max(...historyOf(id).map(h => metric(x, h.e.sets)));
    return `<button class="pr-row" data-action="ex-info" data-id="${id}"><span class="dot" style="background:${partOf(x.part).color}"></span>
      <span class="ellipsis">${esc(x.name)}</span><span class="muted small nowrap">${metricLabel(x).replace(/\(.*\)/, '')}</span><strong class="nowrap">${fmtNum(best)}</strong></button>`;
  }).join('');

  const html = `<div class="kpis two">
      <div class="kpi card"><div class="v">${thisWeek.length}回</div><div class="l">今週のワークアウト</div></div>
      <div class="kpi card"><div class="v">${thisMonth.length}回</div><div class="l">今月のワークアウト</div></div>
      <div class="kpi card"><div class="v">${fmtNum(thisWeek.reduce((a, w) => a + volumeOf(w), 0))}</div><div class="l">今週のボリューム(kg)</div></div>
      <div class="kpi card"><div class="v">${ws.length}回</div><div class="l">累計ワークアウト</div></div>
    </div>
    ${bodyHtml}
    <section class="card"><h3 class="sub">週ごとのボリューム(kg)</h3><canvas class="chart" id="c-week"></canvas></section>
    <section class="card"><h3 class="sub">部位別セット数（直近30日）</h3>${partRows}</section>
    <section class="card"><h3 class="sub">種目ごとの推移</h3>
      <select id="stats-ex">${ids.map(id => `<option value="${id}" ${id === ui.statsEx ? 'selected' : ''}>${esc(getEx(id).name)}（${cnt[id]}回）</option>`).join('')}</select>
      <div class="muted small chart-label">${metricLabel(ex)}</div><canvas class="chart" id="c-ex"></canvas></section>
    <section class="card"><h3 class="sub">自己ベスト</h3>${prRows}</section>`;

  return {
    title: '統計', html,
    after() {
      drawBody();
      drawBars($('#c-week'), wLabels, wVals);
      drawLine($('#c-ex'), chron.map(h => md(h.w.date)), chron.map(h => metric(ex, h.e.sets)));
    },
  };
}

/* ---------- 種目一覧 ---------- */
function viewLibrary() {
  return {
    title: '種目',
    actions: `<button class="icon-btn accent-text big-icon" data-action="ex-new" aria-label="種目を追加">＋</button>`,
    html: `<input id="lib-q" class="search" type="search" placeholder="種目を検索（ひらがなでもOK）" value="${esc(ui.libQ)}" autocomplete="off">
      <div class="chips">${chipsHtml('lib-part', ui.libPart)}</div>
      <div id="lib-list" class="ex-list">${libListHtml()}</div>`,
  };
}
function libListHtml() {
  const cnt = countByEx();
  return filterEx(ui.libPart, ui.libQ).map(ex => `<button class="ex-item" data-action="ex-info" data-id="${ex.id}">
      <span class="dot" style="background:${partOf(ex.part).color}"></span><span>${esc(ex.name)}</span>
      <span class="meta">${esc(ex.eq)}${cnt[ex.id] ? ` · ${cnt[ex.id]}回` : ''}</span></button>`).join('')
    || `<div class="empty">該当する種目がありません</div>`;
}

function openExInfo(id) {
  const ex = getEx(id), p = partOf(ex.part), h = historyOf(id);
  let html = `<div class="sheet-head"><div><h2>${esc(ex.name)}</h2>
    <span class="tag" style="--c:${p.color}">${p.name}</span> <span class="muted small">${esc(ex.eq)}</span></div>
    <button class="icon-btn" data-action="back" aria-label="閉じる">✕</button></div>`;
  if (!h.length) {
    html += `<div class="empty">まだ記録がありません</div>`;
  } else {
    const best = Math.max(...h.map(x => metric(ex, x.e.sets)));
    const maxW = Math.max(0, ...h.flatMap(x => x.e.sets.filter(s => s.done).map(s => s.w || 0)));
    html += `<div class="kpis two">
      <div class="kpi"><div class="v">${fmtNum(best)}</div><div class="l">${metricLabel(ex)}</div></div>
      ${isWR(ex) ? `<div class="kpi"><div class="v">${fmtNum(maxW)}</div><div class="l">最大重量(kg)</div></div>` : ''}
      <div class="kpi"><div class="v">${h.length}回</div><div class="l">実施回数</div></div>
      <div class="kpi"><div class="v">${md(h[0].w.date)}</div><div class="l">最終実施</div></div></div>
      <h3 class="sub">${metricLabel(ex)}の推移</h3><canvas class="chart" id="c-exinfo"></canvas>
      <h3 class="sub">履歴</h3>` +
      h.slice(0, 15).map(x => `<div class="hist"><div class="muted small">${fmtDate(x.w.date)}</div>
        <div>${x.e.sets.filter(s => s.done).map(s => esc(setText(ex, s))).join('<br>')}</div></div>`).join('');
  }
  if (ex.custom) html += `<button class="btn block danger" data-action="ex-delete" data-id="${ex.id}">この種目を削除</button>`;
  openSheet(html);
  if (h.length) {
    const chron = h.slice(0, 20).reverse();
    drawLine($('#c-exinfo'), chron.map(x => md(x.w.date)), chron.map(x => metric(ex, x.e.sets)));
  }
}

/* ---------- 種目選択シート ---------- */
function openPicker(onDone) {
  ui.picker = { sel: [], part: 'all', q: '', onDone };
  showPicker();
}
function showPicker() {
  const p = ui.picker;
  openSheet(`<div class="sheet-head"><h2>種目を選択</h2><button class="icon-btn" data-action="back" aria-label="閉じる">✕</button></div>
    <input id="picker-q" class="search" type="search" placeholder="種目を検索（ひらがなでもOK）" value="${esc(p.q)}" autocomplete="off">
    <div class="chips" id="picker-chips">${chipsHtml('picker-part', p.part)}</div>
    <div id="picker-list" class="ex-list scroll"></div>
    <div class="sheet-foot"><button class="btn ghost" data-action="ex-new">＋ 新しい種目</button>
    <button class="btn primary" id="picker-ok" data-action="picker-ok">追加</button></div>`);
  $('#sheet-body').classList.add('picker');
  refreshPicker();
}
function refreshPicker() {
  const p = ui.picker;
  $('#picker-list').innerHTML = filterEx(p.part, p.q).map(ex => {
    const k = p.sel.indexOf(ex.id);
    return `<button class="ex-item ${k >= 0 ? 'sel' : ''}" data-action="picker-toggle" data-id="${ex.id}">
      <span class="dot" style="background:${partOf(ex.part).color}"></span><span>${esc(ex.name)}</span>
      <span class="meta">${esc(ex.eq)}</span>${k >= 0 ? `<span class="ord">${k + 1}</span>` : ''}</button>`;
  }).join('') || `<div class="empty">該当する種目がありません</div>`;
  const ok = $('#picker-ok');
  ok.disabled = !p.sel.length;
  ok.textContent = p.sel.length ? `${p.sel.length}種目を追加` : '追加';
}

function openNewExercise() {
  const cur = ui.picker ? ui.picker.part : ui.libPart;
  const part = cur !== 'all' ? cur : 'chest';
  openSheet(`<div class="sheet-head"><h2>新しい種目</h2></div>
    <label class="field">名前<input id="nx-name" maxlength="40" placeholder="例：スミスマシンスクワット"></label>
    <label class="field">部位<select id="nx-part">${PARTS.map(p => `<option value="${p.id}" ${p.id === part ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>
    <label class="field">器具<select id="nx-eq">${EQUIPMENT.map(e => `<option>${e}</option>`).join('')}</select></label>
    <label class="field">記録の方法<select id="nx-type">
      <option value="wr">重量 × 回数</option><option value="r">回数のみ</option>
      <option value="t">時間（秒）</option><option value="c">有酸素（分・km）</option></select></label>
    <div class="sheet-foot"><button class="btn ghost" data-action="nx-cancel">キャンセル</button><button class="btn primary" data-action="nx-save">作成</button></div>`);
  $('#nx-name').focus();
}

/* ---------- 設定 ---------- */
function targetBoxHtml() {
  const t = targetsFor();
  if (!t) return `<div class="muted small">年齢・身長を入力し、体重を記録すると目標が計算されます。</div>`;
  return `<div class="target-box">
    <div>基礎代謝 <strong>${fmtNum(t.bmr)}</strong> kcal · 消費の目安 <strong>${fmtNum(t.tdee)}</strong> kcal</div>
    <div>1日の目標 <strong class="accent-text">${fmtNum(t.kcal)} kcal</strong></div>
    <div>タンパク質 <strong>${t.p}g</strong> · 脂質 <strong>${t.f}g</strong> · 炭水化物 <strong>${t.c}g</strong></div></div>`;
}

function viewSettings() {
  const d = D(), pr = d.profile, opts = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];
  const sel = (key, list) => `<select data-prof="${key}">${list.map(([v, l]) => `<option value="${v}" ${String(v) === String(pr[key]) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const num = (key, step) => `<input type="number" inputmode="decimal" step="${step}" min="0" data-prof="${key}" value="${pr[key] ?? ''}">`;
  return {
    title: '設定',
    html: `<section class="card"><h3 class="sub">プロフィール</h3>
        <div class="form-grid">
          <label class="field">性別${sel('sex', [['male', '男性'], ['female', '女性']])}</label>
          <label class="field">年齢${num('age', 1)}</label>
          <label class="field">身長 (cm)${num('height', 0.1)}</label>
          <label class="field">目標体重 (kg)${num('targetWeight', 0.1)}</label>
        </div>
        <label class="field">活動レベル${sel('activity', ACTIVITY)}</label>
        <label class="field">目標${sel('goal', GOALS)}</label>
        <div id="target-box">${targetBoxHtml()}</div></section>
      <section class="card"><h3 class="sub">休憩タイマー</h3>
        <p class="muted small">セットを完了すると自動でスタートします。</p>
        <select id="set-rest">${opts.map(s => `<option value="${s}" ${s === d.settings.rest ? 'selected' : ''}>${s ? fmtDur(s * 1000) : 'オフ'}</option>`).join('')}</select></section>
      <section class="card"><h3 class="sub">データ</h3>
        <p class="muted small">記録はこの端末のブラウザ内に保存されています。機種変更やブラウザのデータ削除に備えて、定期的にバックアップしてください。</p>
        <button class="btn block" data-action="export">バックアップを書き出す</button>
        <button class="btn block" data-action="import">バックアップから復元</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
        <button class="btn block danger" data-action="reset">全データを削除</button></section>
      <section class="card"><h3 class="sub">このアプリについて</h3>
        <p class="muted small">MyFit v0.2<br>ワークアウト ${d.workouts.length}件 · ルーティン ${d.routines.length}件 · カスタム種目 ${d.customExercises.filter(e => !e.hidden).length}件</p></section>`,
  };
}

function exportData() {
  const blob = new Blob([JSON.stringify(D(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `myfit-backup-${dateStr().replaceAll('-', '')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('バックアップを書き出しました');
}

async function importData(input) {
  const f = input.files[0];
  input.value = '';
  if (!f) return;
  let obj;
  try { obj = JSON.parse(await f.text()); } catch { toast('ファイルを読み込めませんでした'); return; }
  if (!obj || !Array.isArray(obj.workouts)) { toast('MyFitのバックアップファイルではありません'); return; }
  if (!confirm(`ワークアウト${obj.workouts.length}件を復元します。現在のデータは上書きされます。よろしいですか？`)) return;
  Store.replace(obj);
  ui.rest = null;
  render();
  toast('復元しました');
}

/* ================= チャート（canvas） ================= */
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const shortNum = v => v >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : v >= 1000 ? +(v / 1000).toFixed(1) + 'k' : String(+v.toFixed(1));

function chartFrame(c, labels, min, max) {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = 38, R = 8, T = 10, B = 22, pw = w - L - R, ph = h - T - B, n = labels.length;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = cssVar('--muted');
  ctx.strokeStyle = cssVar('--grid');
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = Math.round(T + ph - ph * i / 4) + 0.5;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
    ctx.fillText(shortNum(min + (max - min) * i / 4), L - 6, y);
  }
  const step = Math.ceil(n / Math.max(1, Math.floor(pw / 42)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  labels.forEach((lb, i) => { if ((n - 1 - i) % step === 0) ctx.fillText(lb, L + pw * (i + 0.5) / n, T + ph + 6); });
  return { ctx, L, T, pw, ph, n };
}

function drawBars(c, labels, vals) {
  if (!c || !vals.length) return;
  const max = niceMax(Math.max(...vals));
  const { ctx, L, T, pw, ph, n } = chartFrame(c, labels, 0, max);
  const slot = pw / n, bw = Math.min(22, slot * 0.6);
  ctx.fillStyle = cssVar('--accent');
  vals.forEach((v, i) => {
    if (v <= 0) return;
    const bh = Math.max(2, ph * v / max), x = L + slot * i + (slot - bw) / 2, y = T + ph - bh, r = Math.min(4, bw / 2, bh);
    ctx.beginPath();
    ctx.moveTo(x, y + bh); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + bw - r, y); ctx.arcTo(x + bw, y, x + bw, y + r, r); ctx.lineTo(x + bw, y + bh);
    ctx.closePath(); ctx.fill();
  });
}

function drawLine(c, labels, vals) {
  if (!c || !vals.length) return;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || hi * 0.2 || 1;
  const min = Math.max(0, Math.floor(lo - span * 0.3)), max = Math.ceil(hi + span * 0.3);
  const { ctx, L, T, pw, ph, n } = chartFrame(c, labels, min, max);
  const pts = vals.map((v, i) => [L + pw * (i + 0.5) / n, T + ph - ph * (v - min) / (max - min)]);
  const accent = cssVar('--accent');
  // 面
  ctx.beginPath();
  ctx.moveTo(pts[0][0], T + ph);
  pts.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(pts[pts.length - 1][0], T + ph);
  ctx.closePath();
  ctx.globalAlpha = 0.14; ctx.fillStyle = accent; ctx.fill(); ctx.globalAlpha = 1;
  // 線
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  // 点
  ctx.fillStyle = accent; ctx.strokeStyle = cssVar('--surface'); ctx.lineWidth = 2;
  pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
}

/* ================= 休憩タイマー・画面スリープ防止 ================= */
let audioCtx;
function unlockAudio() {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* 音が出せない環境 */ }
}
function beep() {
  try {
    if (!audioCtx) return;
    for (const off of [0, 0.25]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + off;
      o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t); o.stop(t + 0.22);
    }
  } catch { /* noop */ }
}

function startRest(sec) {
  if (!sec) return;
  unlockAudio();
  ui.rest = { end: Date.now() + sec * 1000, total: sec * 1000 };
  $('#restbar').dataset.built = '';
  renderRest();
}
function renderRest() {
  const el = $('#restbar');
  el.hidden = !ui.rest || ui.screen !== 'workout';
  if (el.hidden) return;
  if (!el.dataset.built) {
    el.innerHTML = `<div class="rest-prog"></div><span class="muted small">休憩</span><strong id="rest-left"></strong>
      <button class="btn small ghost" data-action="rest-add" data-s="-15">−15秒</button>
      <button class="btn small ghost" data-action="rest-add" data-s="15">＋15秒</button>
      <button class="btn small primary" data-action="rest-skip">スキップ</button>`;
    el.dataset.built = '1';
  }
  const left = Math.max(0, ui.rest.end - Date.now());
  $('#rest-left').textContent = fmtDur(left + 999);
  $('.rest-prog', el).style.width = `${Math.min(100, left / ui.rest.total * 100)}%`;
}
function tick() {
  const a = D().active;
  if (a) {
    const t = fmtDur(Date.now() - a.start);
    document.querySelectorAll('.js-elapsed').forEach(e => { e.textContent = t; });
  }
  if (ui.rest) {
    if (ui.rest.end <= Date.now()) {
      ui.rest = null;
      renderRest();
      try { navigator.vibrate?.([300, 150, 300]); } catch { /* noop */ }
      beep();
      toast('休憩終了！次のセットへ 🔥');
    } else {
      renderRest();
    }
  }
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && D().active && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* 非対応 */ }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* noop */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { requestWakeLock(); tick(); }
});

/* ================= 操作 ================= */
function rowSet(el) {
  const row = el.closest('.set-row');
  return { row, s: curW().exercises[+row.dataset.i].sets[+row.dataset.j] };
}
const findRoutine = id => D().routines.find(r => r.id === id);
const findWorkout = id => D().workouts.find(w => w.id === id);

const actions = {
  'tab'(el) { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  'back'() { navBack(); },
  'sheet-backdrop'(el, e) { if (e.target === el) navBack(); },

  // ホーム・ルーティン
  'start-empty'() { startWorkout(null); },
  'open-active'() { goTo({ screen: 'workout' }); requestWakeLock(); },
  'open-detail'(el) { goTo({ screen: 'detail', detailId: el.dataset.id }); },
  'routine-start'(el) { const r = findRoutine(el.dataset.id); if (r) startWorkout(r); },
  'routine-new'() {
    const name = prompt('ルーティン名', '');
    if (!name?.trim()) return;
    openPicker(ids => {
      D().routines.push({ id: uid(), name: name.trim(), exercises: ids.map(id => ({ exId: id, sets: initialSets(id, null, false) })) });
      Store.save();
      render();
      toast('ルーティンを作成しました');
    });
  },
  'routine-menu'(el) {
    const r = findRoutine(el.dataset.id);
    openSheet(`<div class="sheet-head"><h2>${esc(r.name)}</h2><button class="icon-btn" data-action="back" aria-label="閉じる">✕</button></div>
      <button class="btn block" data-action="routine-rename" data-id="${r.id}">名前を変更</button>
      <button class="btn block danger" data-action="routine-del" data-id="${r.id}">削除</button>`);
  },
  'routine-rename'(el) {
    const r = findRoutine(el.dataset.id);
    navBack();
    const name = prompt('ルーティン名', r.name);
    if (!name?.trim()) return;
    r.name = name.trim();
    Store.save();
    render();
  },
  'routine-del'(el) {
    const r = findRoutine(el.dataset.id);
    navBack();
    if (!confirm(`ルーティン「${r.name}」を削除しますか？`)) return;
    D().routines = D().routines.filter(x => x !== r);
    Store.save();
    render();
  },

  // ワークアウト記録
  'w-add-ex'() {
    const w = curW(), editing = !!ui.editId;
    openPicker(ids => {
      for (const id of ids) w.exercises.push({ exId: id, sets: initialSets(id, w.id, editing) });
      Store.save();
      render();
    });
  },
  'w-finish'() { finishWorkout(); },
  'w-discard'() { discardWorkout(false); },
  'ex-move'(el) {
    const ex = curW().exercises, i = +el.dataset.i, j = i + +el.dataset.d;
    [ex[i], ex[j]] = [ex[j], ex[i]];
    Store.save();
    render();
  },
  'ex-remove'(el) {
    const w = curW(), e = w.exercises[+el.dataset.i];
    if (e.sets.some(s => s.done) && !confirm(`「${getEx(e.exId).name}」を削除しますか？`)) return;
    w.exercises.splice(+el.dataset.i, 1);
    Store.save();
    render();
  },
  'set-add'(el) {
    const sets = curW().exercises[+el.dataset.i].sets, last = sets[sets.length - 1];
    sets.push(cleanSet(last, !!ui.editId));
    Store.save();
    render();
  },
  'set-remove'(el) {
    curW().exercises[+el.dataset.i].sets.pop();
    Store.save();
    render();
  },
  'set-toggle'(el) {
    const { row, s } = rowSet(el);
    s.done = !s.done;
    Store.save();
    row.classList.toggle('done', s.done);
    updateVol();
    if (s.done && !ui.editId) startRest(D().settings.rest);
  },
  'rest-add'(el) {
    if (!ui.rest) return;
    ui.rest.end += +el.dataset.s * 1000;
    ui.rest.total = Math.max(ui.rest.total, ui.rest.end - Date.now());
    tick();
  },
  'rest-skip'() { ui.rest = null; renderRest(); },

  // 詳細
  'd-edit'(el) { goTo({ screen: 'workout', editId: el.dataset.id }); },
  'd-repeat'(el) { const w = findWorkout(el.dataset.id); startWorkout({ name: w.title, exercises: w.exercises }); },
  'd-routine'(el) {
    const w = findWorkout(el.dataset.id);
    const name = prompt('ルーティン名', w.title);
    if (!name?.trim()) return;
    D().routines.push({ id: uid(), name: name.trim(), exercises: w.exercises.map(e => ({ exId: e.exId, sets: e.sets.map(s => cleanSet(s, false)) })) });
    Store.save();
    toast('ルーティンに保存しました');
  },
  'd-delete'(el) {
    if (!confirm('このワークアウトを削除しますか？元に戻せません。')) return;
    D().workouts = D().workouts.filter(w => w.id !== el.dataset.id);
    Store.save();
    navBack();
  },

  // カレンダー
  'cal-sel'(el) { ui.calSel = el.dataset.date; render(); },
  'cal-move'(el) { const m = ui.calMonth; ui.calMonth = new Date(m.getFullYear(), m.getMonth() + +el.dataset.d, 1); render(); },
  'cal-today'() { const n = new Date(); ui.calMonth = new Date(n.getFullYear(), n.getMonth(), 1); ui.calSel = dateStr(n); render(); },
  'cal-add'() {
    const t = parseDate(ui.calSel).getTime() + 12 * 3600e3;
    const w = { id: uid(), date: ui.calSel, start: t, end: t, title: 'ワークアウト', memo: '', exercises: [] };
    D().workouts.push(w);
    Store.save();
    goTo({ screen: 'workout', editId: w.id });
  },

  // 種目
  'lib-part'(el) { ui.libPart = el.dataset.part; render(); },
  'ex-info'(el) { openExInfo(el.dataset.id); },
  'ex-new'() { openNewExercise(); },
  'ex-delete'(el) {
    const ex = D().customExercises.find(e => e.id === el.dataset.id);
    if (!ex || !confirm(`「${ex.name}」を削除しますか？（過去の記録は残ります）`)) return;
    ex.hidden = true;
    Store.save();
    navBack();
    render();
  },
  'nx-cancel'() { if (ui.picker) showPicker(); else navBack(); },
  'nx-save'() {
    const name = $('#nx-name').value.trim();
    if (!name) { toast('名前を入力してください'); return; }
    const ex = { id: 'c_' + uid(), name, part: $('#nx-part').value, eq: $('#nx-eq').value, type: $('#nx-type').value, custom: true };
    D().customExercises.push(ex);
    Store.save();
    toast('種目を作成しました');
    if (ui.picker) {
      ui.picker.sel.push(ex.id);
      ui.picker.part = ex.part;
      ui.picker.q = '';
      showPicker();
    } else {
      navBack();
      render();
    }
  },
  'picker-part'(el) {
    ui.picker.part = el.dataset.part;
    $('#picker-chips').innerHTML = chipsHtml('picker-part', ui.picker.part);
    refreshPicker();
  },
  'picker-toggle'(el) {
    const sel = ui.picker.sel, k = sel.indexOf(el.dataset.id);
    if (k >= 0) sel.splice(k, 1); else sel.push(el.dataset.id);
    refreshPicker();
  },
  'picker-ok'() {
    const { sel, onDone } = ui.picker;
    navBack();
    onDone(sel.slice());
  },

  // 今日のおすすめ・レポート
  'plan-start'() {
    const plan = todayPlan();
    if (plan.exercises) startWorkout({ name: plan.name, exercises: plan.exercises });
  },
  'open-report'(el) { ui.reportDate = el.dataset.date; goTo({ screen: 'report' }); },
  'report-day'(el) { ui.reportDate = dateStr(addDays(parseDate(ui.reportDate), +el.dataset.d)); render(); },
  'report-share'() { shareReport(); },
  'open-settings'() { goTo({ screen: 'settings' }); },

  // 体重
  'weight-open'(el) { openWeight(el.dataset.date); },
  'wt-save'() {
    const date = $('#wt-date').value, w = parseFloat($('#wt-w').value), f = parseFloat($('#wt-f').value);
    if (!date || !(w > 0)) { toast('体重を入力してください'); return; }
    const rec = { date, weight: w };
    if (f > 0) rec.fat = f;
    D().body = D().body.filter(b => b.date !== date).concat(rec);
    Store.save();
    navBack();
    render();
    toast('体重を記録しました');
  },
  'wt-delete'() {
    const date = $('#wt-date').value;
    D().body = D().body.filter(b => b.date !== date);
    Store.save();
    navBack();
    render();
  },

  // 食事
  'open-meals'() { ui.mealDate = dateStr(); ui.tab = 'meals'; render(); window.scrollTo(0, 0); },
  'meal-day'(el) { ui.mealDate = dateStr(addDays(parseDate(ui.mealDate), +el.dataset.d)); render(); },
  'meal-add'(el) {
    openMealForm({ date: el.dataset.date || ui.mealDate, meal: el.dataset.meal || defaultMeal(), name: '', qty: 1, kcal: null, p: null, f: null, c: null });
  },
  'meal-edit'(el) {
    const x = D().meals.find(m => m.id === el.dataset.id), n = x.qty || 1;
    openMealForm({ ...x, qty: n, kcal: r1(x.kcal / n), p: r1(x.p / n), f: r1(x.f / n), c: r1(x.c / n) });
  },
  'mf-meal'(el) { ui.mealForm.meal = el.dataset.meal; $('#mf-meals').innerHTML = mealChips(ui.mealForm.meal); },
  'mf-qty'(el) {
    ui.mealForm.qty = +el.dataset.q;
    document.querySelectorAll('[data-action="mf-qty"]').forEach(b => b.classList.toggle('active', +b.dataset.q === ui.mealForm.qty));
    $('[data-mf="qty"]').value = ui.mealForm.qty;
    $('#mf-total').innerHTML = mfTotalText();
  },
  'mf-pick'(el) {
    const x = foodCandidates(ui.foodQ)[+el.dataset.i];
    Object.assign(ui.mealForm, { name: x.name, kcal: x.kcal, p: x.p, f: x.f, c: x.c, qty: 1 });
    showMealForm();
  },
  'mf-save'() {
    const mf = ui.mealForm, name = (mf.name || '').trim(), q = mf.qty > 0 ? mf.qty : 1;
    if (!name) { toast('食品名を入力してください'); return; }
    if (mf.kcal == null) { toast('カロリーを入力してください'); return; }
    const item = { id: mf.id || uid(), date: mf.date, meal: mf.meal, name, qty: q,
      kcal: r1(mf.kcal * q), p: r1((mf.p || 0) * q), f: r1((mf.f || 0) * q), c: r1((mf.c || 0) * q) };
    const arr = D().meals, k = arr.findIndex(x => x.id === item.id);
    if (k >= 0) arr[k] = item; else arr.push(item);
    Store.save();
    navBack();
    render();
    toast('食事を記録しました');
  },
  'mf-delete'() {
    D().meals = D().meals.filter(x => x.id !== ui.mealForm.id);
    Store.save();
    navBack();
    render();
  },

  // 設定
  'export'() { exportData(); },
  'import'() { $('#import-file').click(); },
  'reset'() {
    if (!confirm('すべての記録・ルーティン・カスタム種目を削除します。元に戻せません。よろしいですか？')) return;
    Store.reset();
    ui.rest = null;
    releaseWakeLock();
    render();
    toast('データを削除しました');
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.k) {
    const { s } = rowSet(t), v = parseFloat(t.value);
    s[t.dataset.k] = isNaN(v) ? null : v;
    Store.save();
    updateVol();
  } else if (t.dataset.wfield) {
    if (t.dataset.wfield === 'date' && !t.value) return;
    curW()[t.dataset.wfield] = t.value;
    Store.save();
  } else if (t.id === 'lib-q') {
    ui.libQ = t.value;
    $('#lib-list').innerHTML = libListHtml();
  } else if (t.id === 'picker-q') {
    ui.picker.q = t.value;
    refreshPicker();
  } else if (t.dataset.mf) {
    const k = t.dataset.mf, v = parseFloat(t.value);
    ui.mealForm[k] = k === 'name' ? t.value : isNaN(v) ? null : v;
    if (k === 'qty') document.querySelectorAll('[data-action="mf-qty"]').forEach(b => b.classList.toggle('active', +b.dataset.q === v));
    $('#mf-total').innerHTML = mfTotalText();
  } else if (t.id === 'food-q') {
    ui.foodQ = t.value;
    refreshFoodList();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'stats-ex') { ui.statsEx = t.value; render(); }
  else if (t.id === 'set-rest') { D().settings.rest = +t.value; Store.save(); toast('保存しました'); }
  else if (t.id === 'import-file') importData(t);
  else if (t.dataset.prof) {
    const k = t.dataset.prof, v = parseFloat(t.value);
    D().profile[k] = k === 'sex' || k === 'goal' ? t.value : isNaN(v) ? null : v;
    Store.save();
    $('#target-box').innerHTML = targetBoxHtml();
  }
});

// 数値入力にフォーカスしたら全選択（上書き入力しやすく）
document.addEventListener('focusin', e => {
  if (e.target.dataset?.k) setTimeout(() => { try { e.target.select(); } catch { /* noop */ } }, 0);
});

/* ================= 起動 ================= */
Store.load();
render();
setInterval(tick, 500);
requestWakeLock();
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW登録失敗', err));
}
