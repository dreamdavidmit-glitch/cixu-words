(function (root) {
  'use strict';
  // State version 2 adds tracks (reading / listening), imported words and the
  // per-list mixing record. Version 1 backups are migrated on load.
  const VERSION = 2;
  // SM-2 source: https://super-memory.com/english/ol/sm2.htm
  // Matching questions use q=4 for correct, q=1 for incorrect. Same-day
  // correction and early extra practice do not count as spaced successes.
  const LEGACY_INTERVALS = [1, 3, 7, 14, 30];
  const SCHEDULER_VERSION = 2;
  // Product defaults for delayed checks, not measured personal forgetting rates.
  const SHORT_DELAY_MS = 20 * 60 * 1000;
  const LONG_TERM_GAP_MS = 8 * 60 * 60 * 1000;
  const TRACKS = ['reading', 'listening'];
  const KINDS = ['group', 'final', 'review', 'mistakes', 'inbox', 'hard'];
  const PHASES = ['learn', 'quiz', 'repair', 'done'];
  const RATES = [0.75, 1, 1.15];
  const MIX_COUNTS = [0, 1, 2, 3, 5];
  // 9988 大循环表: 60 / 30 / 15 days, or 0 = study freely without a plan.
  const PLAN_DAYS = [0, 15, 30, 60];
  const SLOW_MS = [0, 3000, 5000, 8000];
  const HARD_REASONS = ['spell', 'slow', 'meaning', 'match'];
  function day(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function addDays(value, n) { const d = new Date(value + 'T12:00:00'); d.setDate(d.getDate() + n); return day(d); }
  function validDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00')) && day(new Date(s + 'T12:00:00')) === s; }
  function daysBetween(from, to) { return Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000); }
  function defaultSettings() {
    return {rate: 1, track: 'reading', theme: 'auto', mix: {reading: 2, listening: 2}, autoplay: {reading: false, listening: true}, copyTyping: true, acceptVariants: true, onlineAudio: true,
      plan: {days: 30, start: null}, slowMs: 5000};
  }
  function fresh() {
    return {version: VERSION, startDate: day(), words: {}, lists: {}, activity: {}, settings: defaultSettings(), session: null,
      custom: {}, imported: {reading: {}, listening: {}}, queue: {reading: [], listening: []}, mix: {}, hard: {}};
  }
  // 难点词汇 (the 9988 method): words misspelt, or not started promptly after
  // hearing them, are reviewed again on a later day before new units.
  function markHard(state, id, reason, today = day()) {
    if (!HARD_REASONS.includes(reason)) return;
    const h = state.hard[id];
    state.hard[id] = {d: today, r: h && h.d === today ? h.r : reason};
  }
  // A clean answer on a later day clears the mark; same-day repairs do not.
  function clearHard(state, id, today = day()) { if (state.hard[id] && state.hard[id].d < today) delete state.hard[id]; }
  function listState(state, key) { key = String(key); return state.lists[key] || (state.lists[key] = {groups: [], completedAt: null, bestScore: null, lastScore: null}); }
  function validStamp(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }
  function retrievalDefaults(w) {
    for (const key of ['lastSeenAt', 'delayedDueAt', 'checkedAt']) if (!validStamp(w[key])) w[key] = null;
    if (!Number.isSafeInteger(w.longTermSuccesses) || w.longTermSuccesses < 0) w.longTermSuccesses = 0;
    if (!validDay(w.lastLongTermSuccessDate)) w.lastLongTermSuccessDate = null;
    if (!Number.isSafeInteger(w.spellWrong) || w.spellWrong < 0) w.spellWrong = 0;
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
  function learned(state, id) { return (state.words[id]?.attempts || 0) > 0; }
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
  // A word the learner reports as unknown from real reading/listening is a
  // lapse outside the app: restart its spacing without inventing a quiz answer.
  function relapse(state, id, today = day()) {
    const w = wordState(state, id);
    if (w.lastLapseDate !== today) { w.ease = Math.max(1.3, Math.round((w.ease - 0.2) * 100) / 100); w.lapses++; w.lastLapseDate = today; }
    w.repetitions = 0; w.intervalDays = 0; w.stage = 0; w.due = today; w.lastScheduled = null;
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
  // Old words worth mixing into a new group: already quizzed, due first, then
  // the ones whose meaning was seen longest ago.
  function pickOld(state, ids, exclude, n, now = Date.now()) {
    const today = day(new Date(now)), skip = new Set(exclude);
    const due = new Map(ids.filter(id => learned(state, id) && !skip.has(id)).map(id => [id, reviewInfo(state, id, today, now).isDue]));
    return shuffle([...due.keys()]).sort((a, b) => Number(due.get(b)) - Number(due.get(a)) || (state.words[a].lastSeenAt || 0) - (state.words[b].lastSeenAt || 0)).slice(0, n);
  }
  function blankQuestion(s) { s.selected = null; s.options = null; s.recalled = false; s.guessed = false; s.typed = ''; s.spellOk = null; s.slow = false; s.board = null; }
  function makeSession(kind, track, listId, group, ids, phase = 'learn', mixIds = []) {
    const s = {kind, track, listId: listId === null || listId === undefined ? null : String(listId), group, primaryIds: [...ids], allIds: [...ids], ids: phase === 'quiz' ? shuffle(ids) : [...ids], phase, index: 0, revealed: false, copied: false, wrongIds: [], round: 0, firstScore: null, roundCorrect: 0, totalAnswered: 0, mixIds: mixIds.filter(id => ids.includes(id))};
    blankQuestion(s);
    return s;
  }
  function beginQuiz(session, extraIds = []) {
    if (!session.primaryIds) session.primaryIds = [...session.allIds];
    const additions = session.round === 0 ? extraIds.filter(id => !session.ids.includes(id)) : [];
    session.ids = shuffle([...new Set([...session.ids, ...additions])]);
    if (session.round === 0) session.allIds = [...new Set([...session.allIds, ...additions])];
    session.phase = 'quiz'; session.index = 0; session.wrongIds = []; session.roundCorrect = 0; blankQuestion(session);
  }
  function retry(session) { session.ids = [...session.wrongIds]; session.phase = 'learn'; session.index = 0; session.revealed = false; session.copied = false; blankQuestion(session); session.round++; }
  function bumpSpelling(state, id) { const w = wordState(state, id); w.spellWrong++; }
  // Listening questions start with dictation. The caller checks the spelling
  // (checkSpelling) and records it before the meaning question opens. A slow
  // start (the learner could not begin writing promptly) marks a 难点词汇 even
  // when the spelling is right. Items without a meaning (numbers, codes) are
  // scored here at once with `final`.
  function spell(state, typed, ok, {slow = false, final = false} = {}) {
    const s = state.session;
    if (!s || s.track !== 'listening' || s.phase !== 'quiz' || s.spellOk !== null || s.selected !== null) return false;
    const current = s.ids[s.index], today = day();
    s.typed = String(typed ?? '').slice(0, 120); s.spellOk = ok === true; s.slow = slow === true;
    if (!s.spellOk) markHard(state, current, 'spell', today); else if (s.slow) markHard(state, current, 'slow', today);
    if (final) {
      s.selected = current; s.totalAnswered++; s.roundCorrect += s.spellOk ? 1 : 0;
      if (!s.spellOk) { if (!s.wrongIds.includes(current)) s.wrongIds.push(current); bumpSpelling(state, current); }
      else if (!s.slow) clearHard(state, current, today);
      answer(state, current, s.spellOk);
    }
    return true;
  }
  function submit(state, id, guessed = false) {
    const s = state.session;
    if (!s || s.phase !== 'quiz' || s.selected !== null || !s.options?.some(o => o.id === id)) return false;
    if (s.track === 'listening' && s.spellOk === null) return false;
    const current = s.ids[s.index];
    // A listening word counts only when both the spelling and the meaning are right.
    const right = current === id && !guessed && (s.track !== 'listening' || s.spellOk === true);
    s.selected = id; s.guessed = guessed === true; s.totalAnswered++; s.roundCorrect += right ? 1 : 0;
    if (!right && !s.wrongIds.includes(current)) s.wrongIds.push(current);
    if (s.track === 'listening') {
      if (s.spellOk === false) bumpSpelling(state, current);
      if (s.spellOk && (current !== id || guessed)) markHard(state, current, 'meaning');
      if (right && !s.slow) clearHard(state, current);
    }
    answer(state, current, right);
    return true;
  }
  // "I can't recall it": reveal the answer and record a miss.
  function giveUp(state) {
    const s = state.session;
    if (!s || s.phase !== 'quiz' || s.selected !== null) return false;
    const current = s.ids[s.index];
    if (s.track === 'listening' && s.spellOk === null) { s.typed = ''; s.spellOk = false; markHard(state, current, 'spell'); }
    s.selected = current; s.guessed = true; s.recalled = true; s.totalAnswered++;
    if (!s.wrongIds.includes(current)) s.wrongIds.push(current);
    if (s.track === 'listening' && s.spellOk === false) bumpSpelling(state, current);
    answer(state, current, false);
    return true;
  }
  // Replacement pairs are quizzed on a matching board several at a time.
  // results: [{id, right}] for the scored pairs at s.ids[s.index...].
  function submitBoard(state, results) {
    const s = state.session;
    if (!s || s.phase !== 'quiz' || !Array.isArray(results) || !results.length) return false;
    const expected = s.ids.slice(s.index, s.index + results.length);
    if (expected.length !== results.length || new Set(results.map(r => r?.id)).size !== results.length || !results.every(r => r && expected.includes(r.id) && typeof r.right === 'boolean')) return false;
    const today = day();
    for (const {id, right} of results) {
      s.totalAnswered++; s.roundCorrect += right ? 1 : 0;
      if (!right) { if (!s.wrongIds.includes(id)) s.wrongIds.push(id); markHard(state, id, 'match', today); }
      else clearHard(state, id, today);
      answer(state, id, right === true);
    }
    s.index += results.length; s.board = null;
    if (s.index >= s.ids.length) { s.index = s.ids.length - 1; finish(state); }
    return true;
  }
  function nextQuestion(state) {
    const s = state.session;
    if (!s || s.phase !== 'quiz' || s.selected === null) return false;
    if (s.index + 1 < s.ids.length) { s.index++; blankQuestion(s); }
    else finish(state);
    return true;
  }
  function finish(state) {
    const s = state.session;
    if (s.firstScore === null) s.firstScore = Math.round(s.roundCorrect / s.ids.length * 100);
    if (s.wrongIds.length) { s.phase = 'repair'; return; }
    s.phase = 'done';
    if (s.kind === 'group' && s.listId !== null) { const l = listState(state, s.listId); if (!l.groups.includes(s.group)) l.groups.push(s.group); }
    if (s.kind === 'final' && s.listId !== null) { const l = listState(state, s.listId); l.completedAt = day(); l.lastScore = s.firstScore; l.bestScore = Math.max(l.bestScore || 0, s.firstScore); }
    // Imported words introduced in this group now belong to that day's list.
    // Queued book words learned as ordinary group words leave the queue too.
    if (s.kind === 'group' || s.kind === 'inbox') {
      const where = s.kind === 'group' ? s.listId : 'inbox';
      for (const id of s.mixIds || []) if (!state.mix[id]) state.mix[id] = where;
      if (state.queue[s.track]) state.queue[s.track] = state.queue[s.track].filter(id => !s.primaryIds.includes(id));
    }
  }

  // ---- Imported words -------------------------------------------------------
  function customId(track, word) {
    const slug = String(word).toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').slice(0, 60);
    return slug ? (track === 'listening' ? 'ul-' : 'ur-') + slug : null;
  }
  function pendingMix(state, track, count) { return (state.queue[track] || []).filter(id => !state.mix[id]).slice(0, Math.max(0, count)); }
  // items: [{word, meaning, phonetic, pos, note, bookId}] already reviewed by the
  // learner. Book words that were learned before restart their spacing; unlearned
  // ones and new custom words wait in the queue to be mixed into daily groups.
  function addImports(state, track, items, source = '', now = Date.now()) {
    if (!TRACKS.includes(track)) throw new Error('未知的词表');
    const today = day(new Date(now)), result = {added: [], queued: 0, relapsed: 0, duplicates: 0};
    const imported = state.imported[track], queue = state.queue[track];
    for (const item of items) {
      const id = item.bookId || customId(track, item.word);
      if (!id) continue;
      if (imported[id]) { result.duplicates++; continue; }
      if (!item.bookId) {
        const meaning = String(item.meaning || '').trim();
        if (!meaning) continue;
        state.custom[id] = {word: String(item.word).trim().slice(0, 80), meaning: meaning.slice(0, 300), phonetic: String(item.phonetic || '').slice(0, 80), pos: String(item.pos || '').slice(0, 20), note: String(item.note || '').slice(0, 200), track, addedAt: now};
      }
      imported[id] = {at: now, src: String(source).slice(0, 120)};
      result.added.push(id);
      if (learned(state, id)) { relapse(state, id, today); result.relapsed++; }
      else if (!queue.includes(id)) { queue.push(id); result.queued++; }
    }
    return result;
  }
  function removeImport(state, track, id) {
    if (state.session && state.session.phase !== 'done' && state.session.allIds.includes(id)) return false;
    delete state.imported[track][id];
    state.queue[track] = state.queue[track].filter(x => x !== id);
    delete state.mix[id];
    if (state.custom[id]) { delete state.custom[id]; delete state.words[id]; }
    return true;
  }

  // ---- Spelling ---------------------------------------------------------------
  // Accents are ignored ("cafe" = "café"); full-width letters become ASCII.
  function normSpelling(s) {
    return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[‐‑‒–—―]/g, '-').replace(/\s+/g, ' ').trim().replace(/[.。!！?？,，;；:：]+$/, '');
  }
  function looseSpelling(s) { return normSpelling(s).replace(/[\s'-]/g, ''); }
  // IELTS accepts British and American spellings. Pairs are [UK, US].
  const SPELLING_PAIRS = [['programme','program'],['cheque','check'],['tyre','tire'],['kerb','curb'],['grey','gray'],['plough','plow'],['aluminium','aluminum'],['mum','mom'],['pyjamas','pajamas'],['storey','story'],['sceptical','skeptical'],['sceptic','skeptic'],['mould','mold'],['smoulder','smolder'],['practise','practice'],['enquiry','inquiry'],['enquire','inquire'],['ageing','aging'],['judgement','judgment'],['acknowledgement','acknowledgment'],['manoeuvre','maneuver'],['foetus','fetus'],['oestrogen','estrogen'],['paediatric','pediatric'],['anaemia','anemia'],['anaesthetic','anesthetic'],['encyclopaedia','encyclopedia'],['archaeology','archeology'],['haemoglobin','hemoglobin'],['leukaemia','leukemia'],['orthopaedic','orthopedic'],['doughnut','donut'],['draught','draft'],['gaol','jail'],['licence','license'],['defence','defense'],['offence','offense'],['pretence','pretense'],['fulfil','fulfill'],['enrol','enroll'],['enrolment','enrollment'],['instalment','installment'],['skilful','skillful'],['wilful','willful'],['jewellery','jewelry'],['woollen','woolen'],['axe','ax'],['moustache','mustache'],['cosy','cozy'],['artefact','artifact'],['disc','disk'],['sulphur','sulfur'],['whisky','whiskey'],['yoghurt','yogurt'],['speciality','specialty'],['pedlar','peddler'],['catalogue','catalog'],['dialogue','dialog'],['analogue','analog']];
  const DOUBLE_L = ['travel','cancel','model','label','level','fuel','signal','counsel','jewel','marvel','quarrel','total','channel','tunnel','panel','rival','shovel','dial','equal','duel','chisel','funnel','libel','pedal','refuel','revel','swivel','towel','initial','enamel'];
  // Only known variant families: arbitrary suffix replacement accepted typos
  // such as "doctour", "numbre", "promize" and "surprize".
  const OUR_STEMS = ['col','fav','hon','lab','neighb','harb','hum','rum','behavi','od','flav','arm','vap','endeav','savi','splend','rig','vig','clam','glam','parl'];
  const RE_PAIRS = ['centre','metre','litre','theatre','fibre','calibre','sombre','lustre','sabre','spectre','sepulchre','meagre','ochre','mitre'].map(uk => [uk, uk.slice(0, -2) + 'er']);
  const IZE_STEMS = ['organ','real','recogn','special','apolog','critic','emphas','standard','optim','priorit','summar','character','categor','civil','colon','modern','normal','central','decentral','capital','commercial','industrial','global','local','national','international','personal','popular','privat','public','legal','liberal','equal','final','formal','general','ideal','individual','internal','external','maxim','minim','mobil','neutral','polar','regular','reorgan','revital','social','stabil','steril','symbol','synchron','systemat','theor','util','visual','vocal','author','familiar','memor','hospital','harmon','human','immun','computer','custom','digit','energ','fertil','hypnot','item','jeopard','mechan','monopol','pasteur','penal','rational','revolution','scandal','sensit','subsid','vandal'];
  function spellingVariants(word) {
    const w = normSpelling(word), out = new Set([w]);
    const each = fn => { for (const part of [...out]) { const v = part.split(' ').map(fn).join(' '); if (v) out.add(v); } };
    for (const [uk, us] of SPELLING_PAIRS) { each(t => t === uk ? us : t === us ? uk : t); each(t => t === uk + 's' ? us + 's' : t === us + 's' ? uk + 's' : t); }
    each(t => t.replace(new RegExp('^(' + OUR_STEMS.join('|') + ')(our|or)(s|ed|ing|ite|ites|able|less|ful|er|ers)?$'), (_, stem, form, suffix) => stem + (form === 'our' ? 'or' : 'our') + (suffix || '')));
    for (const [uk, us] of RE_PAIRS) each(t => t === uk ? us : t === us ? uk : t === uk + 's' ? us + 's' : t === us + 's' ? uk + 's' : t);
    each(t => t.replace(new RegExp('^(' + IZE_STEMS.join('|') + ')(is|iz)(e|es|ed|ing|ation|ations|er|ers|able)$'), (_, stem, form, suffix) => stem + (form === 'is' ? 'iz' : 'is') + suffix));
    each(t => t.replace(/^(anal|catal|paral|breathal|hydrol|dial|electrol)(ys|yz)(e|es|ed|ing)$/, (_, stem, form, suffix) => stem + (form === 'ys' ? 'yz' : 'ys') + suffix));
    for (const stem of DOUBLE_L) each(t => {
      const m = t.match(new RegExp('^' + stem + '(l?)(ed|ing|er|ers|or|ors|ous)$'));
      return m ? stem + (m[1] ? '' : 'l') + m[2] : t;
    });
    return out;
  }
  function checkSpelling(input, target, acceptVariants = true) {
    const a = normSpelling(input), t = normSpelling(target);
    if (!a) return {ok: false, kind: 'empty'};
    if (a === t) return {ok: true, kind: 'exact'};
    if (looseSpelling(a) === looseSpelling(t)) return {ok: true, kind: 'form', note: '空格或连字符写法不同，词表写法：' + target};
    if (acceptVariants) for (const v of spellingVariants(t)) if (v !== t && looseSpelling(a) === looseSpelling(v)) return {ok: true, kind: 'variant', note: '英式 / 美式拼写均可，词表写法：' + target};
    return {ok: false, kind: 'wrong'};
  }
  // Character alignment for feedback: eq / sub / del (typed extra) / ins (missing).
  // Letters compare case-insensitively but keep their own case for display.
  function spellingDiff(input, target) {
    const tidy = s => String(s ?? '').normalize('NFKC').replace(/[’‘`´]/g, "'").replace(/[‐‑‒–—―]/g, '-').replace(/\s+/g, ' ').trim();
    const A = [...tidy(input)], B = [...tidy(target)], a = A.map(c => c.toLowerCase()), b = B.map(c => c.toLowerCase()), n = a.length, m = b.length;
    const d = Array.from({length: n + 1}, (_, i) => Array.from({length: m + 1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    const ops = [];
    for (let i = n, j = m; i > 0 || j > 0;) {
      if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { ops.push({op: a[i - 1] === b[j - 1] ? 'eq' : 'sub', typed: A[i - 1], expected: B[j - 1]}); i--; j--; }
      else if (j > 0 && d[i][j] === d[i][j - 1] + 1) { ops.push({op: 'ins', typed: '', expected: B[j - 1]}); j--; }
      else { ops.push({op: 'del', typed: A[i - 1], expected: ''}); i--; }
    }
    return ops.reverse();
  }

  // ---- Backups ----------------------------------------------------------------
  // catalog: {ids: Set of book word ids, trackOf: Map id -> track, lists: Map key -> {track, groups}}
  function validCustom(id, c) {
    return /^u[rl]-[a-z0-9_-]{1,60}$/.test(id) && c && typeof c === 'object' && typeof c.word === 'string' && /[A-Za-z]/.test(c.word) && c.word.length <= 80 &&
      typeof c.meaning === 'string' && c.meaning.trim() && c.meaning.length <= 300 && (id[1] === 'l' ? 'listening' : 'reading') === c.track;
  }
  // Matching-board state restored from a save must still describe pairs that
  // are next in the session; otherwise the board is rebuilt from scratch.
  function validBoard(b, upcoming, known) {
    if (!b || typeof b !== 'object' || !['pair', 'meaning'].includes(b.step)) return false;
    const strs = a => Array.isArray(a) && a.every(x => typeof x === 'string');
    if (!strs(b.ids) || !b.ids.length || !strs(b.fill) || !strs(b.left) || !strs(b.right) || !strs(b.matched)) return false;
    const all = [...b.ids, ...b.fill], same = a => a.length === all.length && all.every(x => a.includes(x));
    return b.ids.every((id, i) => upcoming[i] === id) && b.fill.every(known) && same(b.left) && same(b.right) && b.matched.every(x => all.includes(x)) &&
      b.miss && typeof b.miss === 'object' && Object.values(b.miss).every(v => Number.isInteger(v) && v >= 0) && b.side && typeof b.side === 'object' && Object.values(b.side).every(v => v === 'a' || v === 'b');
  }
  function validate(raw, catalog) {
    if (!raw || ![1, VERSION].includes(raw.version) || !validDay(raw.startDate) || !raw.words || !raw.lists || typeof raw.words !== 'object' || Array.isArray(raw.words) || typeof raw.lists !== 'object' || Array.isArray(raw.lists)) throw new Error('不是有效的词序学习备份');
    const result = fresh(); result.startDate = raw.startDate;
    const trackOf = new Map(catalog.trackOf);
    for (const [id, c] of Object.entries(raw.custom && typeof raw.custom === 'object' ? raw.custom : {})) {
      if (!validCustom(id, c) || catalog.ids.has(id)) continue;
      result.custom[id] = {word: c.word.trim(), meaning: c.meaning.trim(), phonetic: typeof c.phonetic === 'string' ? c.phonetic.slice(0, 80) : '', pos: typeof c.pos === 'string' ? c.pos.slice(0, 20) : '', note: typeof c.note === 'string' ? c.note.slice(0, 200) : '', track: c.track, addedAt: validStamp(c.addedAt) ? c.addedAt : 0};
      trackOf.set(id, c.track);
    }
    const known = id => trackOf.has(id);
    for (const [id, w] of Object.entries(raw.words)) {
      if (!known(id)) continue;
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
      n.spellWrong = Number.isSafeInteger(w.spellWrong) && w.spellWrong >= 0 ? Math.min(1000000, w.spellWrong) : 0;
    }
    for (const [key, meta] of catalog.lists) {
      const l = raw.lists[key]; if (!l || typeof l !== 'object') continue;
      const n = listState(result, key); n.groups = [...new Set((Array.isArray(l.groups) ? l.groups : []).filter(x => Number.isInteger(x) && x >= 0 && x < meta.groups))];
      n.completedAt = validDay(l.completedAt) && n.groups.length === meta.groups ? l.completedAt : null;
      for (const k of ['bestScore','lastScore']) n[k] = Number.isFinite(l[k]) && l[k] >= 0 && l[k] <= 100 ? l[k] : null;
    }
    for (const [d, v] of Object.entries(raw.activity || {})) if (validDay(d) && Number.isSafeInteger(v) && v >= 0) result.activity[d] = v;
    const st = raw.settings || {}, set = result.settings;
    if (RATES.includes(st.rate)) set.rate = st.rate;
    if (TRACKS.includes(st.track)) set.track = st.track;
    if (['auto', 'light', 'dark'].includes(st.theme)) set.theme = st.theme;
    for (const t of TRACKS) {
      if (MIX_COUNTS.includes(st.mix?.[t])) set.mix[t] = st.mix[t];
      if (typeof st.autoplay?.[t] === 'boolean') set.autoplay[t] = st.autoplay[t];
    }
    for (const k of ['copyTyping', 'acceptVariants', 'onlineAudio']) if (typeof st[k] === 'boolean') set[k] = st[k];
    if (PLAN_DAYS.includes(st.plan?.days)) set.plan.days = st.plan.days;
    if (validDay(st.plan?.start)) set.plan.start = st.plan.start;
    if (SLOW_MS.includes(st.slowMs)) set.slowMs = st.slowMs;
    for (const [id, h] of Object.entries(raw.hard && typeof raw.hard === 'object' ? raw.hard : {})) if (known(id) && validDay(h?.d) && HARD_REASONS.includes(h.r)) result.hard[id] = {d: h.d, r: h.r};
    for (const t of TRACKS) {
      for (const [id, meta] of Object.entries(raw.imported?.[t] || {})) if (trackOf.get(id) === t && meta && typeof meta === 'object') result.imported[t][id] = {at: validStamp(meta.at) ? meta.at : 0, src: typeof meta.src === 'string' ? meta.src.slice(0, 120) : ''};
      result.queue[t] = [...new Set((Array.isArray(raw.queue?.[t]) ? raw.queue[t] : []).filter(id => result.imported[t][id]))];
    }
    for (const [id, where] of Object.entries(raw.mix || {})) if (known(id) && (where === 'inbox' || catalog.lists.has(where))) result.mix[id] = where;
    // Custom words only exist while imported; drop orphans from damaged backups.
    for (const id of Object.keys(result.custom)) if (!result.imported[result.custom[id].track][id]) { delete result.custom[id]; delete result.words[id]; }
    const s = raw.session;
    if (s && typeof s === 'object') {
      const track = raw.version === 1 ? 'reading' : s.track;
      const listId = s.listId === null || s.listId === undefined ? null : String(s.listId);
      // Version-1 review sessions carried the first word's list id; any list of
      // the track is fine there because the session is rebuilt without one.
      const listOk = listId === null ? ['review', 'mistakes', 'inbox', 'hard'].includes(s.kind) : catalog.lists.get(listId)?.track === track;
      const groupOk = Number.isInteger(s.group) && s.group >= 0 && (listId === null || s.group < (catalog.lists.get(listId)?.groups || 1));
      const idsOk = arr => Array.isArray(arr) && arr.length > 0 && arr.length <= 5000 && arr.every(id => trackOf.get(id) === track);
      if (TRACKS.includes(track) && KINDS.includes(s.kind) && PHASES.includes(s.phase) && listOk && groupOk && idsOk(s.ids) && idsOk(s.allIds) && Number.isInteger(s.index) && s.index >= 0 && s.index < s.ids.length) {
        const n = makeSession(s.kind, track, ['review', 'mistakes', 'inbox', 'hard'].includes(s.kind) ? null : listId, s.group, s.allIds);
        if (s.mode === 'pairs') n.mode = 'pairs';
        n.phase = s.phase; n.ids = s.ids; n.index = s.index; n.revealed = s.revealed === true; n.copied = s.copied === true;
        n.primaryIds = Array.isArray(s.primaryIds) && s.primaryIds.length && s.primaryIds.every(id => s.allIds.includes(id)) ? [...new Set(s.primaryIds)] : [...s.allIds];
        n.mixIds = Array.isArray(s.mixIds) ? [...new Set(s.mixIds.filter(id => s.allIds.includes(id)))] : [];
        n.recalled = s.recalled === true; n.guessed = s.guessed === true;
        n.round = Number.isInteger(s.round) && s.round >= 0 ? s.round : 0;
        n.firstScore = Number.isFinite(s.firstScore) && s.firstScore >= 0 && s.firstScore <= 100 ? s.firstScore : null;
        n.roundCorrect = Number.isInteger(s.roundCorrect) && s.roundCorrect >= 0 && s.roundCorrect <= s.ids.length ? s.roundCorrect : 0;
        n.totalAnswered = Number.isInteger(s.totalAnswered) && s.totalAnswered >= 0 ? s.totalAnswered : 0;
        n.wrongIds = Array.isArray(s.wrongIds) ? [...new Set(s.wrongIds.filter(id => s.ids.includes(id)))] : [];
        if (track === 'listening' && typeof s.spellOk === 'boolean') { n.spellOk = s.spellOk; n.typed = typeof s.typed === 'string' ? s.typed.slice(0, 120) : ''; n.slow = s.slow === true; }
        if (n.mode === 'pairs' && validBoard(s.board, s.ids.slice(s.index), known)) n.board = {...s.board, pick: null};
        if (Array.isArray(s.options) && s.options.length >= 2 && s.options.length <= 4 && s.options.every(o => known(o?.id) && typeof o.text === 'string' && o.text.length < 300) && s.options.some(o => o.id === s.ids[s.index])) { n.options = s.options; n.selected = s.options.some(o => o.id === s.selected) ? s.selected : null; }
        result.session = n;
      }
    }
    return result;
  }
  const api = {VERSION, SCHEDULER_VERSION, SHORT_DELAY_MS, LONG_TERM_GAP_MS, TRACKS, MIX_COUNTS, RATES, PLAN_DAYS, SLOW_MS, day, addDays, validDay, daysBetween, fresh, defaultSettings, listState, wordState, learned, see, answer, relapse, reviewInfo, isDue, reviewQueue, shuffle, overlap, choices, pickOld, makeSession, beginQuiz, retry, spell, submit, giveUp, submitBoard, nextQuestion, finish, markHard, clearHard, customId, pendingMix, addImports, removeImport, normSpelling, spellingVariants, checkSpelling, spellingDiff, validate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LearningCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
