(function (root) {
  'use strict';
  const VERSION = 1;
  // SM-2 source: https://super-memory.com/english/ol/sm2.htm
  // Matching questions use q=4 for correct, q=1 for incorrect. Same-day
  // correction and early extra practice do not count as spaced successes.
  const LEGACY_INTERVALS = [1, 3, 7, 14, 30];
  const SCHEDULER_VERSION = 2;
  // Product defaults for delayed checks, not measured personal forgetting rates.
  const SHORT_DELAY_MS = 20 * 60 * 1000;
  const LONG_TERM_GAP_MS = 8 * 60 * 60 * 1000;
  function day(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function addDays(value, n) { const d = new Date(value + 'T12:00:00'); d.setDate(d.getDate() + n); return day(d); }
  function validDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00')) && day(new Date(s + 'T12:00:00')) === s; }
  function daysBetween(from, to) { return Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000); }
  function fresh() { return {version: VERSION, startDate: day(), words: {}, lists: {}, activity: {}, settings: {rate: 1}, session: null}; }
  function listState(state, id) { return state.lists[id] || (state.lists[id] = {groups: [], completedAt: null, bestScore: null, lastScore: null}); }
  function validStamp(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }
  function retrievalDefaults(w) {
    for (const key of ['lastSeenAt', 'delayedDueAt', 'checkedAt']) if (!validStamp(w[key])) w[key] = null;
    if (!Number.isSafeInteger(w.longTermSuccesses) || w.longTermSuccesses < 0) w.longTermSuccesses = 0;
    if (!validDay(w.lastLongTermSuccessDate)) w.lastLongTermSuccessDate = null;
    return w;
  }
  function migrateSchedule(w) {
    if (w.schedulerVersion === SCHEDULER_VERSION) return retrievalDefaults(w);
    w.repetitions = Math.max(0, Math.min(4, w.stage || 0));
    w.intervalDays = w.repetitions ? (validDay(w.lastScheduled) && validDay(w.due) ? Math.max(1, daysBetween(w.lastScheduled, w.due)) : LEGACY_INTERVALS[w.repetitions - 1]) : 0;
    w.ease = 2.5; w.lastReviewed = validDay(w.lastScheduled) ? w.lastScheduled : null;
    w.lapses = 0; w.lastLapseDate = null; w.schedulerVersion = SCHEDULER_VERSION;
    return retrievalDefaults(w);
  }
  function wordState(state, id) {
    if (!state.words[id]) state.words[id] = {seen: false, attempts: 0, correct: 0, wrong: 0, stage: 0, due: null, lastScheduled: null};
    return migrateSchedule(state.words[id]);
  }
  function touch(state, today = day()) { state.activity[today] = (state.activity[today] || 0) + 1; }
  function see(state, id, now = Date.now()) {
    if (!validStamp(now)) throw new Error('无效的学习时间');
    const w = wordState(state, id);
    w.seen = true; w.lastSeenAt = now;
    // Looking at the meaning again restarts an outstanding short-delay check.
    if (w.delayedDueAt !== null) w.delayedDueAt = Math.max(w.delayedDueAt, now + SHORT_DELAY_MS);
    touch(state, day(new Date(now)));
  }
  function answer(state, id, right, today = day(), now = Date.now()) {
    if (!validDay(today)) throw new Error('无效的复习日期');
    if (!validStamp(now)) throw new Error('无效的答题时间');
    const w = wordState(state, id);
    const previousScheduled = w.lastScheduled;
    const previouslyDue = validDay(w.due) && w.due <= today;
    const timeSinceMeaning = w.lastSeenAt === null ? null : now - w.lastSeenAt;
    const shortCheckReady = w.delayedDueAt !== null && now >= w.delayedDueAt && timeSinceMeaning !== null && timeSinceMeaning >= SHORT_DELAY_MS;
    w.attempts++; w.correct += right ? 1 : 0; w.wrong += right ? 0 : 1;
    if (!right) {
      // Penalize a lapse once per calendar day, not on every retry.
      if (w.lastLapseDate !== today) {
        const quality = 1;
        w.ease = Math.max(1.3, Math.round((w.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)) * 100) / 100);
        w.lapses++; w.lastLapseDate = today;
      }
      w.repetitions = 0; w.intervalDays = 0; w.stage = 0;
      w.due = today; w.lastScheduled = null;
      // Feedback reveals the meaning, so a failed/guessed answer starts a fresh
      // delay rather than allowing an immediate retry to count as retention.
      w.lastSeenAt = now; w.delayedDueAt = now + SHORT_DELAY_MS;
    } else if (w.lastScheduled !== today && (!w.due || w.due <= today)) {
      // A due answer shortly after seeing the meaning is rehearsal, not a
      // spaced success. Restart at one day without penalizing easiness.
      if (w.repetitions > 0 && timeSinceMeaning !== null && timeSinceMeaning < LONG_TERM_GAP_MS) {
        w.intervalDays = 1; w.repetitions = 1;
        w.delayedDueAt = Math.max(now, w.lastSeenAt) + SHORT_DELAY_MS;
      } else {
        // q=4 keeps the current easiness factor unchanged in SM-2.
        w.intervalDays = w.repetitions === 0 ? 1 : w.repetitions === 1 ? 6 : Math.min(36500, Math.ceil(w.intervalDays * w.ease));
        w.repetitions++;
      }
      w.stage = Math.min(4, w.repetitions);
      w.due = addDays(today, w.intervalDays); w.lastScheduled = today;
    }
    if (right) {
      if (shortCheckReady) { w.checkedAt = now; w.delayedDueAt = null; }
      else if (w.checkedAt === null && w.delayedDueAt === null) {
        if (w.lastSeenAt === null) w.lastSeenAt = now;
        w.delayedDueAt = Math.max(now, w.lastSeenAt) + SHORT_DELAY_MS;
      }
      // Only a genuinely delayed, cross-day due review contributes to this
      // count. Immediate exercises and same-day repeats remain practice.
      if (previouslyDue && previousScheduled && previousScheduled < today && timeSinceMeaning !== null && timeSinceMeaning >= LONG_TERM_GAP_MS && w.lastLongTermSuccessDate !== today) {
        w.longTermSuccesses++; w.lastLongTermSuccessDate = today;
      }
    }
    w.lastReviewed = today;
    touch(state, today);
    return reviewInfo(state, id, today, now);
  }
  function reviewInfo(state, id, today = day(), now = Date.now()) {
    const original = state.words[id];
    if (!original) return {due: null, isDue: false, isDayDue: false, isShortDue: false, shortDueAt: null, shortMinutesUntil: null, checkedAt: null, longTermSuccesses: 0, daysUntil: null, overdueDays: 0, intervalDays: 0, repetitions: 0, ease: 2.5, lapses: 0, priority: -1};
    // Keep inspection pure; migration is applied only to this local copy.
    const w = migrateSchedule({...original});
    const daysUntil = validDay(w.due) ? daysBetween(today, w.due) : null;
    const isDayDue = daysUntil !== null && daysUntil <= 0;
    const isShortDue = w.delayedDueAt !== null && now >= w.delayedDueAt;
    const isDue = isDayDue || isShortDue;
    const shortMinutesUntil = w.delayedDueAt === null ? null : Math.max(0, Math.ceil((w.delayedDueAt - now) / 60000));
    const overdueDays = daysUntil === null ? 0 : Math.max(0, -daysUntil);
    const priority = isDue ? 100000 + overdueDays * 100 + (isShortDue ? 50 : 0) + Math.min(49, w.lapses * 3 + (w.wrong || 0)) : daysUntil === null ? -1 : -daysUntil;
    return {due: w.due, isDue, isDayDue, isShortDue, shortDueAt: w.delayedDueAt, shortMinutesUntil, checkedAt: w.checkedAt, longTermSuccesses: w.longTermSuccesses, daysUntil, overdueDays, intervalDays: w.intervalDays, repetitions: w.repetitions, ease: w.ease, lapses: w.lapses, priority};
  }
  function isDue(state, id, now = Date.now()) { return reviewInfo(state, id, day(new Date(now)), now).isDue; }
  function reviewQueue(state, words, today = day(), now = Date.now()) {
    return words.map(word => ({word, info: reviewInfo(state, word.id, today, now)}))
      .sort((a, b) => b.info.priority - a.info.priority || a.word.id.localeCompare(b.word.id, undefined, {numeric: true}))
      .map(item => item.word);
  }
  function shuffle(items, random = Math.random) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
  function tokens(s) { return s.replace(/\([^)]*\)|（[^）]*）/g, '').replace(/\b(?:n|v|vt|vi|adj|adv|prep|conj)\./g, '').split(/[；;，,、\n]/).map(t => t.trim().replace(/的$/,'')).filter(t => t.length >= 2); }
  function overlap(a, b) { return tokens(a).some(x => tokens(b).some(y => x === y || (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))))); }
  function choices(word, pool, random = Math.random) {
    const others = shuffle(pool.filter(w => w.id !== word.id && w.word.toLowerCase() !== word.word.toLowerCase() && w.meaning !== word.meaning && !overlap(w.meaning, word.meaning)), random);
    const picked = [word];
    for (const w of others) { if (picked.every(x => x.meaning !== w.meaning && !overlap(x.meaning,w.meaning))) picked.push(w); if (picked.length === 4) break; }
    return shuffle(picked.map(w => ({id: w.id, text: w.meaning})), random);
  }
  function makeSession(kind, listId, group, ids, phase = 'learn') {
    return {kind, listId, group, primaryIds: [...ids], allIds: [...ids], ids: phase === 'quiz' ? shuffle(ids) : [...ids], phase, index: 0, revealed: false, recalled: false, guessed: false, selected: null, options: null, wrongIds: [], round: 0, firstScore: null, roundCorrect: 0, totalAnswered: 0};
  }
  function beginQuiz(session, extraIds = []) {
    if (!session.primaryIds) session.primaryIds = [...session.allIds];
    const additions = session.round === 0 ? extraIds.filter(id => !session.ids.includes(id)) : [];
    session.ids = shuffle([...new Set([...session.ids, ...additions])]);
    if (session.round === 0) session.allIds = [...new Set([...session.allIds, ...additions])];
    session.phase = 'quiz'; session.index = 0; session.wrongIds = []; session.roundCorrect = 0; session.recalled = false; session.guessed = false; session.selected = null; session.options = null;
  }
  function retry(session) { session.ids = [...session.wrongIds]; session.phase = 'learn'; session.index = 0; session.revealed = false; session.recalled = false; session.guessed = false; session.selected = null; session.options = null; session.round++; }
  function submit(state, id, guessed = false) {
    const s = state.session;
    if (!s || s.phase !== 'quiz' || s.selected !== null || !s.options?.some(o => o.id === id)) return false;
    const current = s.ids[s.index], right = current === id && !guessed;
    s.selected = id; s.guessed = guessed === true; s.totalAnswered++; s.roundCorrect += right ? 1 : 0;
    if (!right && !s.wrongIds.includes(current)) s.wrongIds.push(current);
    answer(state, current, right);
    return true;
  }
  function finish(state) {
    const s = state.session;
    if (s.firstScore === null) s.firstScore = Math.round(s.roundCorrect / s.ids.length * 100);
    if (s.wrongIds.length) { s.phase = 'repair'; return; }
    s.phase = 'done';
    const l = listState(state, s.listId);
    if (s.kind === 'group' && !l.groups.includes(s.group)) l.groups.push(s.group);
    if (s.kind === 'final') { l.completedAt = day(); l.lastScore = s.firstScore; l.bestScore = Math.max(l.bestScore || 0, s.firstScore); }
  }
  function validate(raw, knownIds) {
    if (!raw || raw.version !== VERSION || !validDay(raw.startDate) || !raw.words || !raw.lists || typeof raw.words !== 'object' || Array.isArray(raw.words) || typeof raw.lists !== 'object' || Array.isArray(raw.lists)) throw new Error('不是有效的词序学习备份');
    const result = fresh(); result.startDate = raw.startDate;
    for (const [id, w] of Object.entries(raw.words)) {
      if (!knownIds.has(id)) continue;
      if (!w || typeof w !== 'object') throw new Error('词汇进度损坏');
      const n = wordState(result, id); n.seen = w.seen === true;
      for (const k of ['attempts','correct','wrong','stage']) if (Number.isSafeInteger(w[k]) && w[k] >= 0) n[k] = Math.min(w[k], k === 'stage' ? 4 : 1000000);
      n.due = validDay(w.due) ? w.due : null; n.lastScheduled = validDay(w.lastScheduled) ? w.lastScheduled : null;
      if (w.schedulerVersion === SCHEDULER_VERSION) {
        for (const k of ['repetitions','intervalDays','lapses']) n[k] = Number.isSafeInteger(w[k]) && w[k] >= 0 ? Math.min(w[k], k === 'intervalDays' ? 36500 : 1000000) : 0;
        n.ease = Number.isFinite(w.ease) ? Math.max(1.3, Math.min(3, w.ease)) : 2.5;
        n.lastReviewed = validDay(w.lastReviewed) ? w.lastReviewed : n.lastScheduled;
        n.lastLapseDate = validDay(w.lastLapseDate) ? w.lastLapseDate : null;
        n.stage = Math.min(4, n.repetitions);
      } else {
        n.schedulerVersion = 0;
        migrateSchedule(n);
      }
      for (const key of ['lastSeenAt', 'delayedDueAt', 'checkedAt']) n[key] = validStamp(w[key]) ? w[key] : null;
      n.longTermSuccesses = Number.isSafeInteger(w.longTermSuccesses) && w.longTermSuccesses >= 0 ? Math.min(1000000, w.longTermSuccesses) : 0;
      n.lastLongTermSuccessDate = validDay(w.lastLongTermSuccessDate) ? w.lastLongTermSuccessDate : null;
    }
    for (let i = 1; i <= 30; i++) {
      const l = raw.lists[i]; if (!l) continue;
      const n = listState(result, i); n.groups = [...new Set((Array.isArray(l.groups) ? l.groups : []).filter(x => Number.isInteger(x) && x >= 0 && x < 10))];
      n.completedAt = validDay(l.completedAt) && n.groups.length === 10 ? l.completedAt : null;
      for (const k of ['bestScore','lastScore']) n[k] = Number.isFinite(l[k]) && l[k] >= 0 && l[k] <= 100 ? l[k] : null;
    }
    for (const [d, v] of Object.entries(raw.activity || {})) if (validDay(d) && Number.isSafeInteger(v) && v >= 0) result.activity[d] = v;
    if ([0.75, 1, 1.15].includes(raw.settings?.rate)) result.settings.rate = raw.settings.rate;
    const s = raw.session;
    if (s && ['group','final','review','mistakes'].includes(s.kind) && ['learn','quiz','repair','done'].includes(s.phase) && Number.isInteger(s.listId) && s.listId >= 1 && s.listId <= 30 && Number.isInteger(s.group) && s.group >= 0 && s.group < 10 && Array.isArray(s.ids) && s.ids.length > 0 && s.ids.length <= 3000 && s.ids.every(id => knownIds.has(id)) && Array.isArray(s.allIds) && s.allIds.length > 0 && s.allIds.length <= 3000 && s.allIds.every(id => knownIds.has(id)) && Number.isInteger(s.index) && s.index >= 0 && s.index < s.ids.length) {
      const n = makeSession(s.kind, s.listId, s.group, s.allIds);
      n.phase = s.phase; n.ids = s.ids; n.index = s.index; n.revealed = s.revealed === true;
      n.primaryIds = Array.isArray(s.primaryIds) && s.primaryIds.length && s.primaryIds.every(id => s.allIds.includes(id)) ? [...new Set(s.primaryIds)] : [...s.allIds];
      n.recalled = s.recalled === true; n.guessed = s.guessed === true;
      n.round = Number.isInteger(s.round) && s.round >= 0 ? s.round : 0;
      n.firstScore = Number.isFinite(s.firstScore) && s.firstScore >= 0 && s.firstScore <= 100 ? s.firstScore : null;
      n.roundCorrect = Number.isInteger(s.roundCorrect) && s.roundCorrect >= 0 && s.roundCorrect <= s.ids.length ? s.roundCorrect : 0;
      n.totalAnswered = Number.isInteger(s.totalAnswered) && s.totalAnswered >= 0 ? s.totalAnswered : 0;
      n.wrongIds = Array.isArray(s.wrongIds) ? [...new Set(s.wrongIds.filter(id => s.ids.includes(id)))] : [];
      if (Array.isArray(s.options) && s.options.length >= 2 && s.options.length <= 4 && s.options.every(o => knownIds.has(o.id) && typeof o.text === 'string' && o.text.length < 300) && s.options.some(o => o.id === s.ids[s.index])) { n.options = s.options; n.selected = s.options.some(o => o.id === s.selected) ? s.selected : null; }
      result.session = n;
    }
    return result;
  }
  const api = {VERSION, SCHEDULER_VERSION, SHORT_DELAY_MS, LONG_TERM_GAP_MS, day, addDays, validDay, daysBetween, fresh, listState, wordState, see, answer, reviewInfo, isDue, reviewQueue, shuffle, overlap, choices, makeSession, beginQuiz, retry, submit, finish, validate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LearningCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
