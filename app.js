/* =====================================================================
   MOUNTAIN — основная логика
   ===================================================================== */

// ---------- Константы ----------
const SIZE_DEFS = {
  week:      { label: 'Недельная',   camps: 3,  totalHeight: 180 },
  month:     { label: 'Месячная',    camps: 6,  totalHeight: 750 },
  half_year: { label: 'Полугодовая', camps: 12, totalHeight: 4500 },
};
const SIZE_ORDER = ['week', 'month', 'half_year'];

const DIFFICULTY_XP = { easy: 10, medium: 25, hard: 50, epic: 100 };
const DIFF_LABELS   = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', epic: 'Эпик' };
const REFERENCE_PACE = 25; // м/день при "1 среднее задание в день"

const RANKS = [
  { name: 'Новичок', min: 0 },
  { name: 'Турист', min: 500 },
  { name: 'Скалолаз', min: 1500 },
  { name: 'Высотник', min: 4000 },
  { name: 'Альпинист', min: 9000 },
  { name: 'Покоритель вершин', min: 20000 },
  { name: 'Легенда гор', min: 45000 },
];

const COFFEE_COST = 150;
const COFFEE_WEEKLY_LIMIT = 2;

const SEVEN_SUMMITS = [
  { key: 'kosciuszko',  name: 'Косцюшко',     continent: 'Австралия/Океания', height: 2230, tokens: 100 },
  { key: 'vinson',      name: 'Винсон',        continent: 'Антарктида',        height: 4890, tokens: 150 },
  { key: 'elbrus',      name: 'Эльбрус',       continent: 'Европа',            height: 5640, tokens: 200 },
  { key: 'kilimanjaro', name: 'Килиманджаро',  continent: 'Африка',            height: 5900, tokens: 250 },
  { key: 'denali',      name: 'Денали',        continent: 'Сев. Америка',      height: 6190, tokens: 300 },
  { key: 'aconcagua',   name: 'Аконкагуа',     continent: 'Юж. Америка',       height: 6960, tokens: 400 },
  { key: 'everest',     name: 'Эверест',       continent: 'Азия',              height: 8850, tokens: 1000 },
];

const ICONS = ['📖','🔤','💻','📚','🏃','🧘','🎸','🎨','✍️','🧠','💪','🗣️','🔬','🎯','⏱️','🌱','🍎','💧','🛌','📐','🧩','🎧','🖌️','🧪','🗂️','📈','🧗','🚴','🏊','🥗'];

// ---------- Состояние ----------
function defaultState() {
  return {
    version: 1,
    tokens: 0,
    coffeeInventory: 0,
    streak: { current: 0, longest: 0, lastActiveDate: null },
    ranges: [],
    quests: [],
    dailyLog: {},
    purchases: {},
    lastRolloverDate: null,
    onboardingSeen: false,
  };
}
let state = defaultState();
let db = null;
let useFirestore = false;
let firebaseUser = null;
let unsubscribeSnapshot = null;

// ---------- Хелперы дат ----------
function todayStr(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function shiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  return todayStr(d);
}
function daysBetweenDates(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00');
  const b = new Date(toStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function isoWeekKey(d = new Date()) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function ensureDay(dateStr) {
  if (!state.dailyLog[dateStr]) state.dailyLog[dateStr] = { perRange: {}, quests: {} };
  return state.dailyLog[dateStr];
}
function getRange(id) { return state.ranges.find(r => r.id === id); }

// ---------- Персистентность ----------
function localLoad() {
  try { const raw = localStorage.getItem('mountain_state'); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function localSave(s) {
  try { localStorage.setItem('mountain_state', JSON.stringify(s)); } catch (e) {}
}
function persist() {
  localSave(state);
  if (useFirestore && firebaseUser && db) {
    db.collection('users').doc(firebaseUser.uid).set(state).catch(console.error);
  }
}

// ---------- Вершины ----------
function makePeak(size, difficulty) {
  const def = SIZE_DEFS[size];
  const totalHeight = Math.round(def.totalHeight * difficulty);
  const camps = [];
  for (let i = 1; i <= def.camps; i++) camps.push(Math.round((totalHeight * i) / def.camps));
  return { size, totalHeight, camps, checkpointHeight: 0, currentHeight: 0, createdAt: todayStr() };
}

function createRange({ title, icon, difficulty, size, type, deadline }) {
  const peak = makePeak(size, difficulty);
  if (type === 'expedition' && deadline) peak.deadline = deadline;
  const range = {
    id: uid(), title, icon, difficulty, type: type || 'regular',
    careerHeight: 0,
    achievements: {},
    history: [],
    currentPeak: peak,
  };
  state.ranges.push(range);
  persist(); renderAll();
  showToast(`Хребет «${title}» создан`);
}

function summitPeak(range) {
  const finished = range.currentPeak.totalHeight;
  const size = range.currentPeak.size;
  if (!range.history) range.history = [];
  range.history.push({ size, outcome: 'summited', finishedAtHeight: finished, date: todayStr() });
  showToast(`🏁 Вершина покорена · ${finished} м`);
  if (range.type === 'expedition') {
    range.currentPeak.completed = true;
    return;
  }
  const idx = SIZE_ORDER.indexOf(size);
  const nextSize = SIZE_ORDER[Math.min(idx + 1, SIZE_ORDER.length - 1)];
  range.currentPeak = makePeak(nextSize, range.difficulty);
}

function checkAchievements(range) {
  range.achievements = range.achievements || {};
  const unlocked = [];
  SEVEN_SUMMITS.forEach(peak => {
    if (!range.achievements[peak.key] && (range.careerHeight || 0) >= peak.height) {
      range.achievements[peak.key] = true;
      state.tokens += peak.tokens;
      unlocked.push(peak);
    }
  });
  return unlocked;
}

function addHeight(rangeId, delta) {
  const range = getRange(rangeId);
  if (!range) return { campReached: false, summited: false, rangeId, unlocked: [] };
  const peak = range.currentPeak;
  const day = ensureDay(todayStr());
  day.perRange[rangeId] = (day.perRange[rangeId] || 0) + delta;

  if (peak.completed) {
    let unlocked = [];
    if (delta > 0) {
      range.careerHeight = (range.careerHeight || 0) + delta;
      unlocked = checkAchievements(range);
    }
    return { campReached: false, summited: false, rangeId, unlocked };
  }

  const beforeCheckpoint = peak.checkpointHeight;
  peak.currentHeight = Math.max(peak.checkpointHeight, peak.currentHeight + delta);

  let summited = false;
  let unlocked = [];
  if (delta > 0) {
    range.careerHeight = (range.careerHeight || 0) + delta; // растёт только вперёд, не откатывается
    peak.camps.forEach(threshold => {
      if (peak.currentHeight >= threshold && threshold > peak.checkpointHeight) {
        peak.checkpointHeight = threshold;
      }
    });
    unlocked = checkAchievements(range);
    if (peak.currentHeight >= peak.totalHeight) { summitPeak(range); summited = true; }
  }

  return { campReached: !summited && peak.checkpointHeight > beforeCheckpoint, summited, rangeId, unlocked };
}

function leavePeak(rangeId) {
  const range = getRange(rangeId);
  if (!range) return;
  if (!range.history) range.history = [];
  range.history.push({ size: range.currentPeak.size, outcome: 'abandoned', finishedAtHeight: range.currentPeak.checkpointHeight, date: todayStr() });
  if (range.type === 'expedition') range.type = 'regular';
  range.currentPeak = makePeak(range.currentPeak.size, range.difficulty);
  persist(); renderAll(); closePeakOverlay();
  showToast('Вершина оставлена — начинаем новую');
}

// ---------- Погода ----------
function computeWeather(range) {
  const peak = range.currentPeak;
  if (range.type === 'expedition' && peak.deadline && !peak.completed) {
    const remainingHeight = Math.max(0, peak.totalHeight - peak.currentHeight);
    const daysRemaining = Math.max(1, daysBetweenDates(todayStr(), peak.deadline));
    const requiredPace = remainingHeight / daysRemaining;
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const ds = shiftDate(todayStr(), -i);
      const day = state.dailyLog[ds];
      if (day) sum += (day.perRange[range.id] || 0);
    }
    const avgActual = sum / 7;
    const ratio = remainingHeight <= 0 ? 2 : (requiredPace > 0 ? avgActual / requiredPace : 1);
    if (ratio >= 1.15) return { emoji: '☀️', label: 'ясно' };
    if (ratio >= 0.85) return { emoji: '⛅', label: 'переменно' };
    if (ratio >= 0.5) return { emoji: '☁️', label: 'облачно' };
    return { emoji: '⛈️', label: 'шторм' };
  }
  const ref = REFERENCE_PACE * range.difficulty;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const ds = shiftDate(todayStr(), -i);
    const day = state.dailyLog[ds];
    if (day) sum += (day.perRange[range.id] || 0);
  }
  const avg = sum / 7;
  const ratio = ref > 0 ? avg / ref : 1;
  if (ratio >= 1.15) return { emoji: '☀️', label: 'ясно' };
  if (ratio >= 0.85) return { emoji: '⛅', label: 'переменно' };
  if (ratio >= 0.5) return { emoji: '☁️', label: 'облачно' };
  return { emoji: '⛈️', label: 'шторм' };
}

// ---------- Стрик и суточный откат ----------
function registerActivityToday() {
  const today = todayStr();
  if (state.streak.lastActiveDate === today) return;
  const yesterday = shiftDate(today, -1);
  if (state.streak.lastActiveDate === yesterday || state.streak.lastActiveDate === null) {
    state.streak.current += 1;
  } else {
    state.streak.current = 1;
  }
  state.streak.lastActiveDate = today;
  state.streak.longest = Math.max(state.streak.longest, state.streak.current);
}

function processDayClose(dateStr) {
  const day = state.dailyLog[dateStr] || { perRange: {}, quests: {} };
  const globalActivity = Object.values(day.perRange).some(v => v > 0);
  const idleRanges = state.ranges.filter(r =>
    (day.perRange[r.id] || 0) <= 0 && r.currentPeak.currentHeight > r.currentPeak.checkpointHeight
  );
  const needsProtection = !globalActivity || idleRanges.length > 0;

  let protectedByCoffee = false;
  if (needsProtection && state.coffeeInventory > 0) {
    state.coffeeInventory -= 1;
    protectedByCoffee = true;
  }

  if (!globalActivity && !protectedByCoffee) {
    state.streak.current = 0;
  }
  if (!protectedByCoffee) {
    idleRanges.forEach(r => { r.currentPeak.currentHeight = r.currentPeak.checkpointHeight; });
  }
}

function runDailyRollover() {
  const today = todayStr();
  let cursor = state.lastRolloverDate || today;
  if (cursor === today) { state.lastRolloverDate = today; checkExpeditionDeadlines(); return; }
  while (cursor < today) {
    processDayClose(cursor);
    cursor = shiftDate(cursor, 1);
  }
  state.lastRolloverDate = today;
  checkExpeditionDeadlines();
}

function checkExpeditionDeadlines() {
  const today = todayStr();
  state.ranges.forEach(r => {
    const peak = r.currentPeak;
    if (r.type === 'expedition' && peak.deadline && !peak.completed && today > peak.deadline) {
      peak.deadline = null;
      r.type = 'regular';
    }
  });
}

// ---------- Магазин ----------
function buyCoffee() {
  if (state.ranges.length === 0) return showToast('Сначала создай хребет');
  if (state.tokens < COFFEE_COST) return showToast('Не хватает токенов');
  const wk = isoWeekKey();
  const used = state.purchases[wk] || 0;
  if (used >= COFFEE_WEEKLY_LIMIT) return showToast('Лимит на эту неделю исчерпан');
  const atCamp = state.ranges.some(r => r.currentPeak.currentHeight === r.currentPeak.checkpointHeight);
  if (!atCamp) return showToast('Нужно стоять в лагере хотя бы в одном хребте');

  state.tokens -= COFFEE_COST;
  state.purchases[wk] = used + 1;
  state.coffeeInventory += 1;
  persist(); renderAll();
  showToast('Кофе куплен ☕');
}

// ---------- Ранг ----------
function computeRank() {
  const total = state.ranges.reduce((s, r) => s + (r.careerHeight || 0), 0);
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (total >= RANKS[i].min) idx = i;
  return { total, current: RANKS[idx], next: RANKS[idx + 1] || null };
}

// ---------- Задания: отметка выполнения ----------
function toggleCheckQuest(q) {
  const day = ensureDay(todayStr());
  if (day.quests[q.id]) {
    showToast('Уже выполнено сегодня');
    return;
  }
  const xp = DIFFICULTY_XP[q.difficulty];
  day.quests[q.id] = true;
  if (q.repeat === 'once') q.archived = true;
  const signal = addHeight(q.rangeId, xp);
  state.tokens += xp;
  registerActivityToday();
  persist(); renderAll();
  animateCheckbox(q.id);
  if (signal) {
    if (signal.campReached || signal.unlocked.length) pulseRangeCard(signal.rangeId);
    if (signal.unlocked.length) {
      const names = signal.unlocked.map(p => p.name).join(', ');
      const tokens = signal.unlocked.reduce((s, p) => s + p.tokens, 0);
      showToast(`🚩 ${names} покорён! +${tokens}`);
    } else if (signal.campReached) {
      showToast('⛺ Новый лагерь!');
    }
  }
}

let counterEditingQuestId = null;
function openCounterOverlay(q) {
  counterEditingQuestId = q.id;
  const day = ensureDay(todayStr());
  const current = day.quests[q.id] || 0;
  document.getElementById('counterOverlayTitle').textContent = q.title;
  document.getElementById('counterOverlayUnitLabel').textContent = `Сколько сделано сегодня (${q.unit || 'ед.'}) · цель ${q.target}`;
  document.getElementById('counterOverlayInput').value = current;
  document.getElementById('counterOverlayInput').min = current;
  document.getElementById('counterOverlay').hidden = false;
}
document.getElementById('btnCancelCounter').addEventListener('click', () => { document.getElementById('counterOverlay').hidden = true; });
document.getElementById('btnSaveCounter').addEventListener('click', () => {
  const q = state.quests.find(x => x.id === counterEditingQuestId);
  if (!q) { document.getElementById('counterOverlay').hidden = true; return; }
  const day = ensureDay(todayStr());
  const current = day.quests[q.id] || 0;
  const val = Math.max(0, parseFloat(document.getElementById('counterOverlayInput').value) || 0);
  if (val < current) { showToast('За сегодня можно только увеличивать значение'); return; }
  document.getElementById('counterOverlay').hidden = true;
  const delta = val - current;
  if (delta === 0) return;
  day.quests[q.id] = val;
  if (q.repeat === 'once' && val >= q.target) q.archived = true;
  const xpDelta = Math.round(delta * q.xpPerUnit);
  const signal = addHeight(q.rangeId, xpDelta);
  state.tokens += xpDelta;
  registerActivityToday();
  persist(); renderAll();
  if (signal) {
    if (signal.campReached || signal.unlocked.length) pulseRangeCard(signal.rangeId);
    if (signal.unlocked.length) {
      const names = signal.unlocked.map(p => p.name).join(', ');
      const tokens = signal.unlocked.reduce((s, p) => s + p.tokens, 0);
      showToast(`🚩 ${names} покорён! +${tokens}`);
    } else if (signal.campReached) {
      showToast('⛺ Новый лагерь!');
    }
  }
});

/* =====================================================================
   РЕНДЕР
   ===================================================================== */
// ---- Плавный счёт чисел ----
const numberCache = {};
function animateNumber(key, el, to, suffix = '') {
  const from = numberCache[key] !== undefined ? numberCache[key] : to;
  numberCache[key] = to;
  if (from === to) { el.textContent = to + suffix; return; }
  const start = performance.now();
  const duration = 500;
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.round(from + (to - from) * eased);
    el.textContent = val + suffix;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderAll() {
  renderHeader();
  renderRanges();
  renderQuests();
  renderShop();
  renderCalendar();
}

function renderHeader() {
  const { total, current, next } = computeRank();
  document.getElementById('rankName').textContent = current.name;
  animateNumber('rankHeight', document.getElementById('rankHeight'), total, ' м');
  const span = next ? (next.min - current.min) : 1;
  const progress = next ? Math.min(1, (total - current.min) / span) : 1;
  document.getElementById('rankFill').style.width = (progress * 100) + '%';

  const today = todayStr();
  const circle = document.getElementById('streakCircle');
  circle.classList.toggle('is-thawed', state.streak.lastActiveDate === today);
  document.getElementById('streakNum').textContent = state.streak.current;
}

function renderRouteSvg(peak) {
  const n = peak.camps.length;
  const pts = [[8, 40]];
  for (let i = 1; i <= n; i++) {
    const x = 8 + (104 / n) * i;
    const y = 40 - (32 / n) * i - (i % 2 === 0 ? 0 : 4);
    pts.push([x, y]);
  }
  const line = pts.map(p => p.join(',')).join(' ');
  let circles = '';
  pts.forEach((p, i) => {
    if (i === 0) return;
    const threshold = peak.camps[i - 1];
    const reached = threshold <= peak.checkpointHeight;
    const isCurrentBand = !reached && (peak.camps[i - 2] || 0) <= peak.checkpointHeight;
    const r = isCurrentBand ? 4.5 : 3.5;
    const fill = reached ? 'var(--accent-xp)' : 'transparent';
    const stroke = (reached || isCurrentBand) ? 'var(--accent-xp)' : 'var(--line)';
    circles += `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" style="fill:${fill};stroke:${stroke};stroke-width:1.5"/>`;
  });
  return `<svg class="range-card__svg" viewBox="0 0 120 48"><polyline points="${line}" style="fill:none;stroke:var(--line);stroke-width:1.5"/>${circles}</svg>`;
}

function renderRanges() {
  const wrap = document.getElementById('rangeScroll');
  wrap.innerHTML = '';
  state.ranges.forEach(r => {
    const peak = r.currentPeak;
    const reachedCamps = peak.camps.filter(c => c <= peak.checkpointHeight).length;
    const weather = computeWeather(r);
    const card = document.createElement('div');
    card.className = 'range-card';
    card.dataset.rangeId = r.id;
    const metaText = (peak.deadline && !peak.completed)
      ? `${peak.currentHeight} / ${peak.totalHeight} м · ${Math.max(0, daysBetweenDates(todayStr(), peak.deadline))} дн. до дедлайна`
      : peak.completed
        ? `✅ Экспедиция завершена · ${peak.totalHeight} м`
        : `${peak.currentHeight} / ${peak.totalHeight} м · лагерь ${reachedCamps} из ${peak.camps.length}`;
    card.innerHTML = `
      <div class="range-card__head">
        <span class="range-card__icon">${r.icon}${r.type === 'expedition' ? ' 🎯' : ''}</span>
        <span class="range-card__title">${escapeHtml(r.title)}</span>
        <span class="range-card__weather">${weather.emoji}</span>
        <button type="button" class="range-card__more" data-more-range="${r.id}">⋯</button>
      </div>
      ${renderRouteSvg(peak)}
      <div class="range-card__meta">${metaText}</div>`;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.range-card__more')) return;
      openPeakOverlay(r.id);
    });
    card.querySelector('.range-card__more').addEventListener('click', (e) => {
      e.stopPropagation();
      openActionSheet('range', r.id, r.title);
    });
    wrap.appendChild(card);
  });
  const addCard = document.createElement('button');
  addCard.type = 'button';
  addCard.className = 'range-add-card';
  addCard.textContent = '+';
  addCard.addEventListener('click', () => openRangeOverlay());
  wrap.appendChild(addCard);
}

function renderQuests() {
  const wrap = document.getElementById('questListWrap');
  const today = todayStr();
  const day = state.dailyLog[today] || { quests: {} };
  const active = state.quests.filter(q => !q.archived);

  if (active.length === 0) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">🗻</div>
      <div class="empty-state__title">Заданий пока нет</div>
      <div class="empty-state__text">Добавь первое — это займёт 10 секунд.</div>
      <button type="button" class="btn-primary" id="emptyAddQuest">+ Добавить задание</button>
    </div>`;
    document.getElementById('emptyAddQuest').addEventListener('click', () => openQuestOverlay());
    return;
  }

  wrap.innerHTML = '<div class="quest-list">' + active.map(q => {
    const range = getRange(q.rangeId);
    const isCheck = q.kind === 'check';
    let doneToday, metaExtra, xpLabel, progressPct = 0;
    if (isCheck) {
      doneToday = !!day.quests[q.id];
      xpLabel = '+' + DIFFICULTY_XP[q.difficulty];
      metaExtra = '';
    } else {
      const val = day.quests[q.id] || 0;
      doneToday = val >= q.target;
      metaExtra = ` · ${val}/${q.target} ${escapeHtml(q.unit || '')}`;
      xpLabel = '+' + Math.round(q.xpPerUnit * q.target);
      progressPct = Math.min(100, Math.round((val / q.target) * 100));
    }
    return `<div class="quest-card ${doneToday ? 'is-done' : ''}" data-id="${q.id}">
      <div class="quest-card__icon">${q.icon}</div>
      <div class="quest-card__body">
        <div class="quest-card__title">${escapeHtml(q.title)}</div>
        <div class="quest-card__meta">${range ? escapeHtml(range.title) : ''}${metaExtra}</div>
      </div>
      ${isCheck
        ? `<div class="checkbox ${doneToday ? 'is-checked' : ''}"><svg viewBox="0 0 24 24" style="fill:none;stroke:white;stroke-width:3"><path d="M4 12l6 6L20 6"/></svg></div>`
        : `<div class="quest-card__progress"><div class="quest-card__progress-fill" style="width:${progressPct}%"></div></div>`}
      <div class="quest-card__xp">${xpLabel}</div>
      <button type="button" class="quest-card__more" data-more-id="${q.id}">⋯</button>
    </div>`;
  }).join('') + '</div>';

  wrap.querySelectorAll('.quest-card').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.quest-card__more')) return;
      const q = active.find(x => x.id === el.dataset.id);
      if (!q) return;
      if (q.kind === 'check') toggleCheckQuest(q);
      else openCounterOverlay(q);
    });
  });
  wrap.querySelectorAll('.quest-card__more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const q = state.quests.find(x => x.id === btn.dataset.moreId);
      if (q) openActionSheet('quest', q.id, q.title);
    });
  });
}

function renderShop() {
  animateNumber('tokenBalance', document.getElementById('tokenBalance'), state.tokens, '');
  const wk = isoWeekKey();
  const used = state.purchases[wk] || 0;
  document.getElementById('coffeeLimitLabel').textContent = `${used} / ${COFFEE_WEEKLY_LIMIT} на этой неделе`;
  const btn = document.getElementById('btnBuyCoffee');
  const atCamp = state.ranges.some(r => r.currentPeak.currentHeight === r.currentPeak.checkpointHeight);
  btn.disabled = used >= COFFEE_WEEKLY_LIMIT || state.tokens < COFFEE_COST || !atCamp || state.ranges.length === 0;
}

function renderCalendar() {
  const now = new Date();
  const label = now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  document.getElementById('calMonthLabel').textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const year = now.getFullYear(), month = now.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayS = todayStr();
  const dailyQuestIds = state.quests.filter(q => q.repeat === 'daily' && !q.archived).map(q => q.id);

  let html = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < startOffset; i++) html += `<div class="cal-cell is-empty"></div>`;

  let perfectCount = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const day = state.dailyLog[ds];
    const hasActivity = day && Object.values(day.perRange || {}).some(v => v > 0);
    const isPerfect = day && dailyQuestIds.length > 0 && dailyQuestIds.every(id => day.quests[id]);
    if (isPerfect) perfectCount++;
    const cls = ['cal-cell'];
    if (hasActivity) cls.push('has-activity');
    if (isPerfect) cls.push('is-perfect');
    if (ds === todayS) cls.push('is-today');
    const style = hasActivity ? `style="background:var(--accent-xp);border-color:var(--accent-xp)"` : '';
    html += `<div class="${cls.join(' ')}" ${style}>${d}</div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
  document.getElementById('statCurrentStreak').textContent = state.streak.current;
  document.getElementById('statLongestStreak').textContent = state.streak.longest;
  document.getElementById('statPerfectDays').textContent = perfectCount;
}

// ---------- Вершина: экран деталей ----------
let currentPeakRangeId = null;
function openPeakOverlay(rangeId) {
  currentPeakRangeId = rangeId;
  const r = getRange(rangeId);
  if (!r) return;
  const retroUnlocked = checkAchievements(r);
  if (retroUnlocked.length) persist();
  document.getElementById('peakRangeTitle').textContent = `${r.icon} ${r.title}`;
  const weather = computeWeather(r);
  document.getElementById('peakWeather').textContent = `${weather.emoji} ${weather.label}`;

  const sheetEl = document.querySelector('#peakOverlay .sheet');
  sheetEl.classList.remove('weather-clear', 'weather-partly', 'weather-cloudy', 'weather-storm');
  const weatherClassMap = { 'ясно': 'weather-clear', 'переменно': 'weather-partly', 'облачно': 'weather-cloudy', 'шторм': 'weather-storm' };
  sheetEl.classList.add(weatherClassMap[weather.label] || 'weather-partly');

  const peak = r.currentPeak;
  let html = '';
  peak.camps.forEach((threshold, i) => {
    const reached = threshold <= peak.checkpointHeight;
    const isCurrent = !reached && (peak.camps[i - 1] || 0) <= peak.checkpointHeight;
    html += `<div class="peak-camp ${reached ? 'is-reached' : ''} ${isCurrent ? 'is-current' : ''}" style="animation-delay:${i * 35}ms">
      <div class="peak-camp__dot"></div>
      <div class="peak-camp__label">Лагерь ${i + 1}</div>
      <div class="peak-camp__height">${threshold} м</div>
    </div>`;
  });
  document.getElementById('peakRoute').innerHTML = html;
  document.getElementById('peakMeta').textContent = peak.completed
    ? `✅ Экспедиция завершена · ${peak.totalHeight} м · карьерная высота ${r.careerHeight} м`
    : `${peak.currentHeight} из ${peak.totalHeight} м · сложность ×${r.difficulty} · карьерная высота ${r.careerHeight} м` +
      (peak.deadline ? ` · дедлайн ${peak.deadline} (${Math.max(0, daysBetweenDates(todayStr(), peak.deadline))} дн.)` : '');
  document.getElementById('btnLeavePeak').hidden = !!peak.completed;
  renderPeakAchievements(r);
  renderPeakHistory(r);
  document.getElementById('peakOverlay').hidden = false;
}
function renderPeakAchievements(range) {
  const wrap = document.getElementById('peakAchievements');
  const items = SEVEN_SUMMITS.map(peak => {
    const unlocked = !!range.achievements[peak.key];
    return `<div class="peak-achv__item ${unlocked ? 'is-unlocked' : ''}" data-key="${peak.key}">
      <span>${unlocked ? '🚩' : '⛰️'}</span><span class="h">${peak.height}</span>
    </div>`;
  }).join('');
  wrap.innerHTML = `<div class="peak-achv__title">Seven Summits · тапни на плитку</div><div class="peak-achv__grid">${items}</div>`;
  wrap.querySelectorAll('.peak-achv__item').forEach(el => {
    el.addEventListener('click', () => {
      const peak = SEVEN_SUMMITS.find(p => p.key === el.dataset.key);
      const unlocked = !!range.achievements[peak.key];
      showToast(unlocked
        ? `🚩 ${peak.name} (${peak.continent}) — покорена · ${peak.height} м`
        : `⛰️ ${peak.name} (${peak.continent}) — нужно ${peak.height} м, сейчас ${Math.round(range.careerHeight)} м`);
    });
  });
}

function closePeakOverlay() { document.getElementById('peakOverlay').hidden = true; }

function renderPeakHistory(range) {
  const wrap = document.getElementById('peakHistory');
  const history = range.history || [];
  if (history.length === 0) {
    wrap.innerHTML = `<div class="peak-history__title">История</div><div class="peak-history__empty">Пока пусто — это первая вершина хребта.</div>`;
    return;
  }
  const summaryBySize = {};
  history.forEach(h => {
    if (!summaryBySize[h.size]) summaryBySize[h.size] = { summited: 0, abandoned: 0 };
    summaryBySize[h.size][h.outcome === 'summited' ? 'summited' : 'abandoned']++;
  });
  const summaryHtml = Object.keys(summaryBySize).map(size => {
    const s = summaryBySize[size];
    return `<span class="peak-history__chip">${SIZE_DEFS[size].label}: ${s.summited} 🏁 · ${s.abandoned} 🚩</span>`;
  }).join('');
  const listHtml = history.slice().reverse().map(h => {
    const icon = h.outcome === 'summited' ? '🏁' : '🚩';
    const label = h.outcome === 'summited' ? `${SIZE_DEFS[h.size].label} покорена` : `${SIZE_DEFS[h.size].label} оставлена`;
    return `<div class="peak-history__item"><span class="peak-history__icon">${icon}</span><span class="peak-history__label">${label}</span><span class="peak-history__meta">${h.finishedAtHeight} м · ${h.date}</span></div>`;
  }).join('');
  wrap.innerHTML = `<div class="peak-history__title">История</div>
    <div class="peak-history__summary">${summaryHtml}</div>
    <div class="peak-history__list">${listHtml}</div>`;
}

/* =====================================================================
   ФОРМЫ И UI-ВЗАИМОДЕЙСТВИЕ
   ===================================================================== */
function buildIconGrid(containerId, onSelect, defaultIcon) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = ICONS.map(ic => `<button type="button" class="icon-opt ${ic === defaultIcon ? 'is-selected' : ''}" data-icon="${ic}">${ic}</button>`).join('');
  grid.querySelectorAll('.icon-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.icon-opt').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      onSelect(btn.dataset.icon);
    });
  });
}
function resetSegmented(containerId, attr, value) {
  document.getElementById(containerId).querySelectorAll('button').forEach(b => {
    b.classList.toggle('is-active', b.dataset[attr] === String(value));
  });
}

// ---- Создание хребта ----
let selectedRangeIcon = ICONS[0], selectedDifficulty = 1, selectedSize = 'week', selectedRangeType = 'regular';
let editingRangeId = null;

function openRangeOverlay(existingRange) {
  editingRangeId = existingRange ? existingRange.id : null;
  document.getElementById('rangeFormTitle').textContent = existingRange ? 'Редактировать хребет' : 'Новый хребет';
  document.getElementById('rangeTitle').value = existingRange ? existingRange.title : '';
  document.getElementById('expeditionDeadline').value = '';
  selectedRangeIcon = existingRange ? existingRange.icon : ICONS[0];
  selectedDifficulty = 1; selectedSize = 'week'; selectedRangeType = 'regular';
  buildIconGrid('rangeIconGrid', ic => selectedRangeIcon = ic, selectedRangeIcon);
  resetSegmented('rangeDifficulty', 'diff', 1);
  resetSegmented('rangeSize', 'size', 'week');
  resetSegmented('rangeType', 'type', 'regular');
  document.getElementById('expeditionDateField').hidden = true;
  document.getElementById('rangeCreateOnlyFields').hidden = !!existingRange;
  document.getElementById('rangeOverlay').hidden = false;
}
document.getElementById('btnAddRange').addEventListener('click', () => openRangeOverlay());
document.getElementById('btnCancelRange').addEventListener('click', () => { document.getElementById('rangeOverlay').hidden = true; editingRangeId = null; });
document.getElementById('rangeType').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  resetSegmented('rangeType', 'type', btn.dataset.type);
  selectedRangeType = btn.dataset.type;
  document.getElementById('expeditionDateField').hidden = selectedRangeType !== 'expedition';
});
document.getElementById('rangeDifficulty').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  resetSegmented('rangeDifficulty', 'diff', btn.dataset.diff);
  selectedDifficulty = parseFloat(btn.dataset.diff);
});
document.getElementById('rangeSize').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  resetSegmented('rangeSize', 'size', btn.dataset.size);
  selectedSize = btn.dataset.size;
});
document.getElementById('rangeForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = document.getElementById('rangeTitle').value.trim();
  if (!title) return;
  if (editingRangeId) {
    const r = getRange(editingRangeId);
    if (r) { r.title = title; r.icon = selectedRangeIcon; persist(); renderAll(); }
    document.getElementById('rangeOverlay').hidden = true;
    editingRangeId = null;
    return;
  }
  let deadline = null;
  if (selectedRangeType === 'expedition') {
    deadline = document.getElementById('expeditionDeadline').value;
    if (!deadline) { showToast('Укажи дату дедлайна'); return; }
    if (deadline <= todayStr()) { showToast('Дедлайн должен быть в будущем'); return; }
  }
  createRange({ title, icon: selectedRangeIcon, difficulty: selectedDifficulty, size: selectedSize, type: selectedRangeType, deadline });
  document.getElementById('rangeOverlay').hidden = true;
});

// ---- Создание задания ----
let selectedQuestIcon = ICONS[0], selectedQuestRangeId = null, selectedQuestType = 'check', selectedQuestDifficulty = 'medium', selectedQuestRepeat = 'daily';

function buildRangePicker() {
  const grid = document.getElementById('questRangePicker');
  grid.innerHTML = state.ranges.map(r => `<button type="button" class="icon-opt icon-opt--range ${r.id === selectedQuestRangeId ? 'is-selected' : ''}" data-range-id="${r.id}"><span>${r.icon}</span><span class="icon-opt__label">${escapeHtml(r.title.slice(0, 8))}</span></button>`).join('');
  grid.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('button').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      selectedQuestRangeId = btn.dataset.rangeId;
    });
  });
}
function buildDiffGrid() {
  const grid = document.getElementById('diffGrid');
  const diffs = ['easy', 'medium', 'hard', 'epic'];
  grid.innerHTML = diffs.map(d => `<div class="diff-opt ${d === selectedQuestDifficulty ? 'is-selected' : ''}" data-diff="${d}">
    <span class="diff-opt__name">${DIFF_LABELS[d]}</span><span class="diff-opt__xp">${DIFFICULTY_XP[d]}</span></div>`).join('');
  grid.querySelectorAll('.diff-opt').forEach(el => {
    el.addEventListener('click', () => {
      grid.querySelectorAll('.diff-opt').forEach(x => x.classList.remove('is-selected'));
      el.classList.add('is-selected');
      selectedQuestDifficulty = el.dataset.diff;
    });
  });
}
let editingQuestId = null;
function openQuestOverlay(existingQuest) {
  if (state.ranges.length === 0) { showToast('Сначала создай хотя бы один хребет'); return; }
  editingQuestId = existingQuest ? existingQuest.id : null;
  document.getElementById('questFormTitle').textContent = existingQuest ? 'Редактировать задание' : 'Новое задание';
  document.getElementById('questTitle').value = existingQuest ? existingQuest.title : '';
  document.getElementById('counterTarget').value = existingQuest && existingQuest.kind === 'counter' ? existingQuest.target : '';
  document.getElementById('counterUnit').value = existingQuest && existingQuest.kind === 'counter' ? existingQuest.unit : '';
  document.getElementById('counterXpPerUnit').value = existingQuest && existingQuest.kind === 'counter' ? existingQuest.xpPerUnit : 2;
  selectedQuestIcon = existingQuest ? existingQuest.icon : ICONS[0];
  selectedQuestRangeId = existingQuest ? existingQuest.rangeId : state.ranges[0].id;
  selectedQuestType = existingQuest ? existingQuest.kind : 'check';
  selectedQuestDifficulty = existingQuest && existingQuest.kind === 'check' ? existingQuest.difficulty : 'medium';
  selectedQuestRepeat = existingQuest ? existingQuest.repeat : 'daily';

  buildIconGrid('iconGrid', ic => selectedQuestIcon = ic, selectedQuestIcon);
  buildRangePicker();
  buildDiffGrid();
  resetSegmented('typeSegmented', 'type', selectedQuestType);
  resetSegmented('repeatSegmented', 'repeat', selectedQuestRepeat);
  document.getElementById('diffField').hidden = selectedQuestType !== 'check';
  document.getElementById('counterField').hidden = selectedQuestType !== 'counter';
  document.getElementById('questOverlay').hidden = false;
}
document.getElementById('btnAddQuest').addEventListener('click', () => openQuestOverlay());
document.getElementById('btnCancelQuest').addEventListener('click', () => { document.getElementById('questOverlay').hidden = true; editingQuestId = null; });
document.getElementById('typeSegmented').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  resetSegmented('typeSegmented', 'type', btn.dataset.type);
  selectedQuestType = btn.dataset.type;
  document.getElementById('diffField').hidden = selectedQuestType !== 'check';
  document.getElementById('counterField').hidden = selectedQuestType !== 'counter';
});
document.getElementById('repeatSegmented').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  resetSegmented('repeatSegmented', 'repeat', btn.dataset.repeat);
  selectedQuestRepeat = btn.dataset.repeat;
});
document.getElementById('questForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = document.getElementById('questTitle').value.trim();
  if (!title || !selectedQuestRangeId) return;
  if (editingQuestId) {
    const q = state.quests.find(x => x.id === editingQuestId);
    if (q) {
      q.title = title; q.icon = selectedQuestIcon; q.rangeId = selectedQuestRangeId;
      q.kind = selectedQuestType; q.repeat = selectedQuestRepeat;
      if (selectedQuestType === 'check') {
        q.difficulty = selectedQuestDifficulty;
        delete q.target; delete q.unit; delete q.xpPerUnit;
      } else {
        q.target = parseFloat(document.getElementById('counterTarget').value) || 10;
        q.unit = document.getElementById('counterUnit').value.trim() || 'ед.';
        q.xpPerUnit = parseFloat(document.getElementById('counterXpPerUnit').value) || 2;
        delete q.difficulty;
      }
    }
    persist(); renderAll();
    document.getElementById('questOverlay').hidden = true;
    editingQuestId = null;
    return;
  }
  const quest = { id: uid(), title, icon: selectedQuestIcon, rangeId: selectedQuestRangeId, kind: selectedQuestType, repeat: selectedQuestRepeat, archived: false };
  if (selectedQuestType === 'check') {
    quest.difficulty = selectedQuestDifficulty;
  } else {
    quest.target = parseFloat(document.getElementById('counterTarget').value) || 10;
    quest.unit = document.getElementById('counterUnit').value.trim() || 'ед.';
    quest.xpPerUnit = parseFloat(document.getElementById('counterXpPerUnit').value) || 2;
  }
  state.quests.push(quest);
  persist(); renderAll();
  document.getElementById('questOverlay').hidden = true;
});

// ---- Быстрые действия (редактировать/удалить) ----
let actionSheetContext = null;
function openActionSheet(type, id, title) {
  actionSheetContext = { type, id };
  document.getElementById('actionSheetTitle').textContent = title;
  document.getElementById('actionSheetOverlay').hidden = false;
}
document.getElementById('actionCancel').addEventListener('click', () => { document.getElementById('actionSheetOverlay').hidden = true; });
document.getElementById('actionEdit').addEventListener('click', () => {
  document.getElementById('actionSheetOverlay').hidden = true;
  if (!actionSheetContext) return;
  if (actionSheetContext.type === 'quest') {
    const q = state.quests.find(x => x.id === actionSheetContext.id);
    if (q) openQuestOverlay(q);
  } else {
    const r = getRange(actionSheetContext.id);
    if (r) openRangeOverlay(r);
  }
});
document.getElementById('actionDelete').addEventListener('click', () => {
  document.getElementById('actionSheetOverlay').hidden = true;
  if (!actionSheetContext) return;
  if (actionSheetContext.type === 'quest') {
    if (!confirm('Удалить это задание?')) return;
    state.quests = state.quests.filter(q => q.id !== actionSheetContext.id);
  } else {
    if (!confirm('Удалить хребет вместе со всеми его заданиями? Это необратимо.')) return;
    state.quests = state.quests.filter(q => q.rangeId !== actionSheetContext.id);
    state.ranges = state.ranges.filter(r => r.id !== actionSheetContext.id);
    if (currentPeakRangeId === actionSheetContext.id) closePeakOverlay();
  }
  persist(); renderAll();
});

// ---- Вершина: закрытие / оставить ----
document.getElementById('btnClosePeak').addEventListener('click', closePeakOverlay);
document.getElementById('btnLeavePeak').addEventListener('click', () => {
  if (!currentPeakRangeId) return;
  if (!confirm('Точно оставить эту вершину? Начнётся новая того же размера с нуля.')) return;
  leavePeak(currentPeakRangeId);
});

// ---- Магазин ----
document.getElementById('btnBuyCoffee').addEventListener('click', buyCoffee);

// ---- Вкладки ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    ['home', 'shop', 'calendar'].forEach(name => {
      document.getElementById('screen-' + name).hidden = (name !== btn.dataset.tab);
    });
  });
});

// ---- Тост ----
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2600);
}

// ---- Анимации отклика ----
function animateCheckbox(questId) {
  const box = document.querySelector(`.quest-card[data-id="${questId}"] .checkbox`);
  if (!box) return;
  box.classList.remove('is-pop');
  void box.offsetWidth; // форс-reflow, чтобы анимация перезапустилась
  box.classList.add('is-pop');
}
function pulseRangeCard(rangeId) {
  const card = document.querySelector(`.range-card[data-range-id="${rangeId}"]`);
  if (!card) return;
  card.classList.remove('is-pulse');
  void card.offsetWidth;
  card.classList.add('is-pulse');
  setTimeout(() => card.classList.remove('is-pulse'), 750);
}

/* =====================================================================
   АВТОРИЗАЦИЯ И ЗАПУСК
   ===================================================================== */
function translateAuthError(err) {
  const map = {
    'auth/email-already-in-use': 'Этот email уже зарегистрирован',
    'auth/invalid-email': 'Некорректный email',
    'auth/weak-password': 'Пароль слишком короткий (минимум 6 символов)',
    'auth/wrong-password': 'Неверный пароль',
    'auth/user-not-found': 'Аккаунт не найден',
    'auth/invalid-credential': 'Неверная почта или пароль',
  };
  return map[err.code] || 'Что-то пошло не так, попробуй ещё раз';
}

function wireAuthForm(auth) {
  let registerMode = false;
  document.getElementById('authToggle').addEventListener('click', () => {
    registerMode = !registerMode;
    document.getElementById('authTitle').textContent = registerMode ? 'Регистрация' : 'Вход';
    document.getElementById('authSubmit').textContent = registerMode ? 'Зарегистрироваться' : 'Войти';
    document.getElementById('authToggle').textContent = registerMode ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
  });
  document.getElementById('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errEl = document.getElementById('authError');
    errEl.style.display = 'none';
    try {
      if (registerMode) await auth.createUserWithEmailAndPassword(email, password);
      else await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      errEl.textContent = translateAuthError(err);
      errEl.style.display = 'block';
    }
  });
}

function revealApp() {
  document.getElementById('app').hidden = false;
  document.getElementById('tabBar').hidden = false;
  maybeShowOnboarding();
}

// ---- Онбординг ----
function initOnboarding() {
  const track = document.getElementById('onboardingTrack');
  const dotsWrap = document.getElementById('onboardingDots');
  const slideCount = track.children.length;
  dotsWrap.innerHTML = Array.from({ length: slideCount }).map((_, i) => `<div class="onboarding__dot ${i === 0 ? 'is-active' : ''}"></div>`).join('');
  track.addEventListener('scroll', () => {
    const idx = Math.round(track.scrollLeft / track.clientWidth);
    dotsWrap.querySelectorAll('.onboarding__dot').forEach((d, i) => d.classList.toggle('is-active', i === idx));
  });
  document.getElementById('btnSkipOnboarding').addEventListener('click', closeOnboarding);
  document.getElementById('btnOnboardingCreate').addEventListener('click', () => {
    closeOnboarding();
    openRangeOverlay();
  });
}
function closeOnboarding() {
  document.getElementById('onboardingOverlay').hidden = true;
  state.onboardingSeen = true;
  persist();
}
function maybeShowOnboarding() {
  if (!state.onboardingSeen && state.ranges.length === 0) {
    document.getElementById('onboardingTrack').scrollLeft = 0;
    document.getElementById('onboardingOverlay').hidden = false;
  }
}
initOnboarding();

function initAuth() {
  if (!window.MOUNTAIN_FIREBASE_CONFIGURED) {
    document.getElementById('authOverlay').hidden = true;
    state = localLoad() || defaultState();
    runDailyRollover();
    persist();
    revealApp();
    renderAll();
    return;
  }
  useFirestore = true;
  db = firebase.firestore();
  const auth = firebase.auth();
  wireAuthForm(auth);

  auth.onAuthStateChanged(user => {
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    if (user) {
      firebaseUser = user;
      document.getElementById('authOverlay').hidden = true;
      let first = true;
      const ref = db.collection('users').doc(user.uid);
      unsubscribeSnapshot = ref.onSnapshot(snap => {
        state = snap.exists ? Object.assign(defaultState(), snap.data()) : defaultState();
        if (first) {
          first = false;
          if (!snap.exists) ref.set(state);
          runDailyRollover();
          persist();
          revealApp();
        }
        renderAll();
      });
    } else {
      firebaseUser = null;
      document.getElementById('authOverlay').hidden = false;
      document.getElementById('app').hidden = true;
      document.getElementById('tabBar').hidden = true;
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

initAuth();
