(() => {
  'use strict';
  const C = window.LearningCore, Importer = window.WordImporter;
  const KEY = 'reading30.progress.v1';
  const ASSET_V = '20261102';
  const AUDIO_V = '20261030-emma';
  const LISTEN_AUDIO_V = window.LISTENING?.meta?.audio || 'gb3';
  const pad2 = n => String(n).padStart(2, '0');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));

  // ---- Books ------------------------------------------------------------------
  const TRACK = {
    reading: {key: 'reading', name: '阅读', title: '阅读词汇', en: 'READING', icon: 'book',
      lists: window.VOCAB.lists.map(l => ({key: String(l.id), num: l.id, name: `List ${pad2(l.id)}`, title: '', kind: 'reading', words: l.words}))},
    // Listening = the 9988 book: answer words (A units, dictation) and
    // replacement pairs (B units, matching).
    listening: {key: 'listening', name: '听力', title: '听力词汇', en: 'LISTENING', icon: 'headphones',
      lists: (window.LISTENING?.lists || []).map(l => ({key: l.key || 'L' + l.id, num: l.num ?? l.id, name: l.name || `List ${pad2(l.id)}`, title: l.title || '', kind: l.kind || 'answers', words: l.words}))},
  };
  const byId = new Map(), listByKey = new Map();
  for (const [track, t] of Object.entries(TRACK)) {
    t.words = [];
    for (const l of t.lists) {
      l.track = track; l.groups = Math.ceil(l.words.length / 10); listByKey.set(l.key, l);
      for (const w of l.words) { w.track = track; w.listKey = l.key; byId.set(w.id, w); t.words.push(w); }
    }
    t.index = new Map(t.words.filter(w => !w.pair).map(w => [w.word.toLowerCase(), w]));
  }
  const isPair = w => !!w?.pair;
  const pairList = l => l?.kind === 'pairs';

  // ---- 9988 大循环表 ----------------------------------------------------------------
  // Transcribed from the book: each day lists answer-word units (A) and the
  // book's replacement units (B1-B51), including the B1-B28 supplement.
  const range = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
  const LATE_A = [[23, 24], [25, 26], [27, 28], [29], [30], [31], [32], [33], [34]];
  const FIRST_A = range(0, 10).map(i => [2 * i + 1, 2 * i + 2]);
  const SPRINT = [[[1, 2], range(1, 6)], [range(3, 6), range(7, 11)], [range(7, 10), range(12, 16)], [range(11, 14), range(17, 21)], [range(15, 18), range(22, 26)],
    [range(19, 22), range(27, 31)], [range(23, 25), range(32, 36)], [range(26, 28), range(37, 41)], [range(29, 31), range(42, 46)], [range(32, 34), range(47, 51)]];
  const RAW_PLANS = {
    60: [...[[1], [2], [3, 4], [5, 6], [7, 8, 9]].map((a, i) => ({round: 1, a, b: [2 * i + 1, 2 * i + 2]})), ...range(10, 25).map((u, i) => ({round: 1, a: [u], b: [11 + 2 * i, 12 + 2 * i]})),
      ...range(26, 34).map((u, i) => ({round: 1, a: [u], b: [43 + i]})), ...FIRST_A.map((a, i) => ({round: 2, a, b: range(3 * i + 1, 3 * i + 3)})),
      ...LATE_A.map((a, i) => ({round: 2, a, b: [34 + 2 * i, 35 + 2 * i]})), ...SPRINT.map(([a, b]) => ({round: 3, a, b}))],
    30: [...FIRST_A.map((a, i) => ({round: 1, a, b: range(3 * i + 1, 3 * i + 3)})), ...LATE_A.map((a, i) => ({round: 1, a, b: [34 + 2 * i, 35 + 2 * i]})), ...SPRINT.map(([a, b]) => ({round: 2, a, b}))],
    15: [...[[1, 2], range(3, 7), range(8, 12), range(13, 16), range(17, 19), range(20, 22), range(23, 25), range(26, 28), range(29, 31), range(32, 34)].map(a => ({round: 1, a, b: []})),
      ...[range(1, 7), range(8, 14), range(15, 21), range(22, 28), range(29, 34)].map(a => ({round: 2, a, b: []}))],
  };
  const ROUND_NAMES = {60: ['初背', '强化巩固', '难点再巩固 + 考前冲刺'], 30: ['初背', '强化巩固 + 考前冲刺'], 15: ['初背', '强化巩固 + 考前冲刺']};
  const PLANS = Object.fromEntries(Object.entries(RAW_PLANS).map(([n, days]) => {
    const haveA = new Set(TRACK.listening.lists.filter(l => !pairList(l)).map(l => l.key));
    const haveB = new Set(TRACK.listening.lists.filter(pairList).map(l => l.key));
    const out = days.map(d => ({round: d.round, a: d.a.map(u => 'A' + u).filter(k => haveA.has(k)), b: d.b.map(u => 'B' + u).filter(k => haveB.has(k))}));
    return [n, out];
  }));
  const catalog = {ids: new Set(byId.keys()), trackOf: new Map([...byId.values()].map(w => [w.id, w.track])), lists: new Map([...listByKey.values()].map(l => [l.key, {track: l.track, groups: l.groups}]))};

  // ---- State ------------------------------------------------------------------
  let state, saveError = '', loadError = '';
  try { const saved = localStorage.getItem(KEY); state = saved ? C.validate(JSON.parse(saved), catalog) : C.fresh(); }
  catch (e) { state = C.fresh(); loadError = '未能读取原有进度，请先在「设置」导入备份。为保护原数据，本次不会自动覆盖保存。'; }
  const ui = {page: 'home', list: '1', search: '', mistakeFilter: 'weak', revealed: new Set(), draft: '', autoKey: '', serial: 0,
    imp: {target: null, busy: false, status: '', file: '', rows: null, error: '', paste: false, filter: ''}};
  let audio = null, audioToken = 0, toastTimer, lastHtml = '', memo = null;
  const app = document.getElementById('app');
  const track = () => state.settings.track;
  function persist() {
    memo = null;
    if (loadError) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveError = ''; }
    catch (e) { saveError = '当前浏览器无法保存进度（空间已满或处于隐私模式），请在「设置」导出备份。'; }
  }
  function getWord(id) {
    const b = byId.get(id); if (b) return b;
    const c = state.custom[id];
    return c ? {id, word: c.word, meaning: c.meaning, detail: c.meaning, phonetic: c.phonetic, pos: c.pos, note: c.note, track: c.track, custom: true} : null;
  }
  // Everything below is recomputed once per render instead of per call.
  function derived(t) {
    memo ||= {};
    if (memo[t]) return memo[t];
    const now = Date.now(), today = C.day(new Date(now));
    const custom = Object.keys(state.custom).filter(id => state.custom[id].track === t).map(getWord);
    const words = [...TRACK[t].words, ...custom];
    const info = new Map(words.filter(w => state.words[w.id]).map(w => [w.id, C.reviewInfo(state, w.id, today, now)]));
    const due = words.filter(w => info.get(w.id)?.isDue);
    const pendingShort = words.filter(w => (state.words[w.id]?.delayedDueAt || 0) > now).sort((a, b) => state.words[a.id].delayedDueAt - state.words[b.id].delayedDueAt);
    const mistakes = words.filter(w => state.words[w.id]?.wrong > 0);
    const learned = words.filter(w => C.learned(state, w.id)).length;
    const longTerm = words.filter(w => state.words[w.id]?.longTermSuccesses > 0).length;
    // 难点词汇 from earlier days are reviewed first; today's wait for tomorrow.
    const hardPrev = words.filter(w => state.hard[w.id] && state.hard[w.id].d < today), hardToday = words.filter(w => state.hard[w.id]?.d === today);
    return memo[t] = {words, custom, info, due, pendingShort, mistakes, learned, longTerm, hardPrev, hardToday};
  }
  // Today's place in the chosen 大循环表 (null when studying without a plan).
  function planInfo() {
    const p = state.settings.plan, table = PLANS[p.days];
    if (!table || !p.start || !TRACK.listening.lists.length) return null;
    return {table, days: table.length, start: p.start, dayNo: C.daysBetween(p.start, C.day()) + 1, names: ROUND_NAMES[p.days]};
  }
  function unitTask(key, round, date) {
    const l = listByKey.get(key); if (!l) return null;
    const pr = listProgress(l), last = state.lists[key]?.completedAt;
    // Round 1 learns the unit group by group; later rounds re-check it whole.
    const done = round === 1 ? pr.passed === l.groups || pr.done : !!last && last >= date;
    return {key, l, round, done, pr};
  }
  function dayTasks(info, n) {
    const d = info.table[n - 1]; if (!d) return [];
    const date = C.addDays(info.start, n - 1);
    return [...d.a, ...d.b].map(k => unitTask(k, d.round, date)).filter(Boolean);
  }

  // ---- Small helpers --------------------------------------------------------------
  const ICONS = {home:'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z',book:'M12 6.5C10 5 7 4.6 3 5v13.5c4-.4 7 .1 9 1.5m0-13.5c2-1.5 5-1.9 9-1.5v13.5c-4-.4-7 .1-9 1.5m0-13.5V20',headphones:'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z',layers:'m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',review:'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7.5V12l3 2',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z',upload:'M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15',settings:'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4',sound:'M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12',arrow:'M5 12h14m-6-6 6 6-6 6',check:'m5 12.5 4.5 4.5L19 7',x:'M6 6l12 12M18 6 6 18',file:'M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8Zm0 0v5h5M9 13h6M9 17h4',trash:'M4 7h16M10 11v6m4-6v6M9 7V4h6v3M6 7l1 13h10l1-13',flame:'M12 3c.8 3.2 4.5 4.6 4.5 9a4.5 4.5 0 0 1-9 0c0-1.8.8-3.1 1.8-4.1.3 1.6 1.1 2.4 2.2 2.4 0-2.8-.6-4.6.5-7.3Z',calendar:'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5ZM4 10h16M8.5 3v4m7-4v4',inbox:'M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V13Z',pen:'M4 20h4L19 9l-4-4L4 16v4Zm11-15 4 4',eye:'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',slow:'M4 17h11a5 5 0 0 0 0-10H9a5 5 0 0 0-5 5v5Zm4 0v3m8-3v3M20 12h1',sparkle:'M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2m-8 8-2 2',chevron:'m9 6 6 6-6 6',search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.2-4.2'};
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.book}"/></svg>`;
  const btn = (label, action, attrs = '', cls = 'primary') => `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`;
  const chip = (text, cls = '') => `<span class="chip ${cls}">${text}</span>`;
  const listLabel = key => key === 'inbox' ? '生词本' : listByKey.get(key)?.name || '';
  const plannedDay = () => Math.max(1, C.daysBetween(state.startDate, C.day()) + 1);
  function streak() { let d = C.day(), n = 0; if (!state.activity[d]) d = C.addDays(d, -1); while (state.activity[d] > 0 && n < 4000) { n++; d = C.addDays(d, -1); } return n; }
  function greeting() { const h = new Date().getHours(); return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; }
  const todayText = () => new Date().toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'});
  function listProgress(l) { const p = state.lists[l.key]; return {passed: p?.groups?.length || 0, groups: p?.groups || [], done: !!p?.completedAt, best: p?.bestScore ?? null, last: p?.lastScore ?? null}; }
  function nextList(t) { const lists = TRACK[t].lists; return lists.find(l => !state.lists[l.key]?.completedAt) || lists[lists.length - 1] || null; }
  function nextGroup(l) { const done = listProgress(l).groups; return Array.from({length: l.groups}, (_, i) => i).find(i => !done.includes(i)); }
  const completedCount = t => TRACK[t].lists.filter(l => state.lists[l.key]?.completedAt).length;
  const mixedInto = key => Object.keys(state.mix).filter(id => state.mix[id] === key && getWord(id));
  const groupWords = (l, g) => l.words.slice(g * 10, g * 10 + 10);
  function ring(value, total, size = 64) {
    const sw = size >= 120 ? 10 : size >= 60 ? 6 : 4, r = (size - sw) / 2, c = 2 * Math.PI * r, pct = total ? Math.min(1, value / total) : 0, h = size / 2;
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${h}" cy="${h}" r="${r}" stroke-width="${sw}" class="ring-track"/><circle cx="${h}" cy="${h}" r="${r}" stroke-width="${sw}" class="ring-fill" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(2)}" transform="rotate(-90 ${h} ${h})"/></svg>`;
  }
  function dueLabel(id, t) {
    const r = derived(t).info.get(id); if (!r) return '';
    if (r.isShortDue) return '现在 · 延迟回想';
    if (r.isDayDue) return r.overdueDays ? `已逾期 ${r.overdueDays} 天 · 优先复习` : '今天复习';
    if (r.shortMinutesUntil !== null) return `约 ${r.shortMinutesUntil} 分钟后 · 延迟回想`;
    if (!r.due) return '';
    return r.daysUntil === 1 ? '明天复习' : `${r.daysUntil} 天后复习 · ${r.due.slice(5).replace('-', '/')}`;
  }
  const phonetic = w => w.phonetic ? `<span class="phonetic">/${esc(w.phonetic.replace(/^\/|\/$/g, ''))}/</span>` : '';
  const playBtn = (id, label = '读音') => `<button type="button" class="play-chip" data-action="speak" data-id="${esc(id)}" aria-label="播放读音">${icon('sound')}<span>${label}</span></button>`;
  const pageHead = (title, sub, eyebrow, aside = '') => `<header class="page-head"><div><span class="eyebrow">${eyebrow}</span><h1 class="page-title">${title}</h1>${sub ? `<p class="subtitle">${sub}</p>` : ''}</div>${aside}</header>`;
  function notify(message) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4800);
  }
  function modal(title, body, confirmLabel, onConfirm, danger = false) {
    document.querySelector('.modal-backdrop')?.remove();
    const wrap = document.createElement('div'); wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">${esc(title)}</h2><p>${esc(body)}</p><div class="dialog-actions"><button type="button" class="btn secondary" id="modal-cancel">取消</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" id="modal-confirm">${esc(confirmLabel)}</button></div></section>`;
    document.body.append(wrap);
    const previous = document.activeElement, close = () => { wrap.remove(); previous?.focus?.(); };
    wrap.querySelector('#modal-cancel').onclick = close;
    wrap.querySelector('#modal-confirm').onclick = () => { close(); onConfirm(); };
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('#modal-cancel').focus();
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') { const bs = wrap.querySelectorAll('button'); if (e.shiftKey && document.activeElement === bs[0]) { e.preventDefault(); bs[1].focus(); } else if (!e.shiftKey && document.activeElement === bs[1]) { e.preventDefault(); bs[0].focus(); } }
    });
  }

  // ---- Audio ------------------------------------------------------------------------
  function stopAudio() { audioToken++; if (audio) { audio.pause(); audio = null; } if (window.speechSynthesis) speechSynthesis.cancel(); document.documentElement.classList.remove('is-playing'); }
  // Book words have bundled recordings. Imported words try an online voice,
  // then the browser's own English voice.
  // Listening words use the book's accent: British recordings (pair words have
  // one file per side, "<id>-a" / "<id>-b"). Resolves when playback ends.
  async function speak(id, {slow = false, auto = false, side = null} = {}) {
    const w = getWord(id); if (!w) return;
    stopAudio(); const token = audioToken, rate = slow ? 0.75 : state.settings.rate;
    const part = isPair(w) ? (side === 'b' ? 'b' : 'a') : null, uk = w.track === 'listening';
    const questionKey = ui.autoKey;
    const heard = () => {
      const s = state.session;
      if (token === audioToken && ui.autoKey === questionKey && ui.page === 'study' && uk && !part && s?.phase === 'quiz' && s.spellOk === null && s.ids[s.index] === id && ui.qShown === null) ui.qShown = Date.now();
    };
    const spoken = part ? w.pair[part].word.replace(/…|\.\.\./g, ' ') : w.say || w.sourceWord || w.word;
    const sources = [];
    if (byId.has(id)) sources.push(`audio/${encodeURIComponent(id)}${part ? '-' + part : ''}.mp3?v=${uk ? LISTEN_AUDIO_V : AUDIO_V}`);
    if (state.settings.onlineAudio && navigator.onLine !== false && !/\d/.test(spoken)) sources.push(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(spoken)}&type=${uk ? 1 : 2}`);
    for (const src of sources) {
      try {
        const a = new Audio(src); a.playbackRate = rate; audio = a;
        const ended = new Promise(res => {
          const finish = () => { document.documentElement.classList.remove('is-playing'); res(); };
          a.onended = () => { heard(); finish(); };
          a.onpause = a.onerror = finish;
        });
        await a.play();
        if (token === audioToken) document.documentElement.classList.add('is-playing');
        return ended;
      } catch (e) {
        if (token !== audioToken) return;
        // Autoplay before any tap is blocked by browsers; wait for the button.
        if (e?.name === 'NotAllowedError') return;
      }
    }
    if (token !== audioToken || auto) return;
    const voices = window.speechSynthesis?.getVoices() || [];
    const voice = (uk && voices.find(v => v.lang === 'en-GB')) || voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang?.startsWith('en'));
    if (!voice) { notify('读音暂时无法播放：请检查 audio 文件夹是否完整，或换用 Edge / Chrome。'); return; }
    const u = new SpeechSynthesisUtterance(spoken); u.lang = voice.lang; u.voice = voice; u.rate = rate;
    return new Promise(res => { u.onend = () => { heard(); res(); }; u.onerror = () => { notify('朗读未成功，请检查设备声音设置。'); res(); }; speechSynthesis.speak(u); });
  }
  // Both words of a replacement pair, one after the other.
  async function speakPair(id, auto = false) {
    const token = audioToken + 1;
    await speak(id, {side: 'a', auto});
    if (audioToken === token) { await new Promise(r => setTimeout(r, 350)); if (audioToken === token) speak(id, {side: 'b', auto}); }
  }

  // ---- Layout -----------------------------------------------------------------------
  const NAV = [['home', 'home', '今日', '今日学习'], ['lists', 'layers', '词表', '词表'], ['review', 'review', '复习', '到期复习'], ['mistakes', 'star', '错词', '错词本'], ['import', 'upload', '导入', '导入生词'], ['settings', 'settings', '设置', '设置']];
  function activeNav() {
    if (ui.page === 'detail') return 'lists';
    if (ui.page !== 'study') return ui.page;
    const k = state.session?.kind;
    return k === 'review' ? 'review' : k === 'mistakes' ? 'mistakes' : k === 'inbox' ? 'import' : k === 'hard' ? 'home' : 'lists';
  }
  function shell(content) {
    const t = track(), d = derived(t), active = activeNav();
    document.documentElement.dataset.track = t;
    const badge = p => p === 'review' && d.due.length ? `<span class="badge">${d.due.length}</span>` : p === 'import' && state.queue[t].length ? `<span class="badge soft">${state.queue[t].length}</span>` : '';
    const navItem = ([p, ico, short, long]) => `<button type="button" class="nav-item ${active === p ? 'active' : ''}" data-action="nav" data-page="${p}" ${active === p ? 'aria-current="page"' : ''}>${icon(ico)}<span class="nav-long">${long}</span><span class="nav-short">${short}</span>${badge(p)}</button>`;
    const switcher = `<div class="track-switch" role="group" aria-label="切换词汇板块">${Object.values(TRACK).map(T => `<button type="button" class="${t === T.key ? 'on' : ''}" data-action="track" data-track="${T.key}" aria-pressed="${t === T.key}">${icon(T.icon)}<span>${T.name}</span>${derived(T.key).due.length && t !== T.key ? '<i class="dot" title="有到期复习"></i>' : ''}</button>`).join('')}</div>`;
    const T = TRACK[t], total = T.lists.length, done = completedCount(t);
    const foot = total ? `<div class="sidebar-foot"><span class="eyebrow">${T.title}进度</span><strong>${done} <small>/ ${total} 个${t === 'listening' ? '单元' : ' list '}已完成</small></strong><div class="progress"><i style="width:${done / total * 100}%"></i></div><p>${d.learned} 个词已进入复习计划</p></div>` : `<div class="sidebar-foot"><span class="eyebrow">${T.title}</span><p>词表待录入 · 生词本 ${d.custom.length} 词</p></div>`;
    const alerts = loadError || saveError ? `<div class="banner error" role="alert">${esc(loadError || saveError)}</div>` : '';
    const html = `<div class="app">
      <aside class="sidebar"><a class="brand" href="#" data-action="nav" data-page="home"><span class="brand-mark">序</span><span class="brand-text">词序<small>IELTS VOCABULARY</small></span></a>${switcher}<nav class="nav" aria-label="主导航">${NAV.map(navItem).join('')}</nav>${foot}</aside>
      <div class="main-col">
        <header class="mobile-top"><a class="brand" href="#" data-action="nav" data-page="home"><span class="brand-mark">序</span><span class="brand-text">词序</span></a>${switcher}<button type="button" class="icon-btn" data-action="nav" data-page="settings" aria-label="设置">${icon('settings')}</button></header>
        <main class="main" id="main">${alerts}${content}</main>
        <footer class="app-footer">词表来自你的原文件 · 进度只保存在当前浏览器 · <button type="button" class="text-link" data-action="nav" data-page="settings">备份与说明</button></footer>
      </div>
      <nav class="tabbar" aria-label="底部导航">${NAV.slice(0, 5).map(navItem).join('')}</nav>
    </div>`;
    if (html === lastHtml) return;
    lastHtml = html; app.innerHTML = html;
  }

  // ---- Home ---------------------------------------------------------------------------
  function home() {
    if (track() === 'listening' && TRACK.listening.lists.length) return listeningHome();
    const t = track(), T = TRACK[t], d = derived(t), s = state.session, ongoing = s && s.phase !== 'done' && s.track === t;
    const n = streak();
    const head = pageHead(t === 'reading' ? '今天，把阅读词汇想起来。' : '今天，把听力词汇听写出来。', `${greeting()} · ${todayText()} · 学习第 ${plannedDay()} 天`, `${T.title} · ${T.en}`, n ? `<span class="streak">${icon('flame')}连续 ${n} 天</span>` : '');
    const l = nextList(t), queued = state.queue[t].length, mix = state.settings.mix[t];
    const hero = l ? homeHero(l, ongoing ? s : null) : emptyBook(queued);
    const due = d.due.length, nextShort = d.pendingShort[0];
    const shortText = nextShort ? ` · 下一次延迟回想约 ${Math.max(1, Math.ceil((state.words[nextShort.id].delayedDueAt - Date.now()) / 60000))} 分钟后` : '';
    const p = l ? listProgress(l) : null;
    const tasks = `<section class="card tasks"><div class="card-head"><h2>今日清单</h2><span class="muted">先复习，再学新词</span></div><ol class="task-list">
      <li class="${due ? '' : 'done'}"><span class="task-ico">${icon(due ? 'review' : 'check')}</span><div><strong>到期复习</strong><p>${due ? `${due} 个词等你回想` : '暂时没有到期的词'}${shortText}</p></div>${due ? btn('去复习', 'nav', 'data-page="review"', 'small') : ''}</li>
      ${l ? `<li class="${p.done ? 'done' : ''}"><span class="task-ico">${icon(p.done ? 'check' : 'layers')}</span><div><strong>新词 · ${esc(l.name)}</strong><p>已通过 ${p.passed} / ${l.groups} 组${p.done ? ' · 整组检测已完成' : ''}</p></div></li>` : ''}
      <li class="${queued ? '' : 'done'}"><span class="task-ico">${icon('inbox')}</span><div><strong>生词穿插</strong><p>${queued ? `生词本还有 ${queued} 个待学 · ${mix ? `每组穿插 ${mix} 个` : '穿插已关闭'}` : '生词本里暂时没有待学的词'}</p></div>${btn(queued ? '查看' : '导入', 'nav', 'data-page="import"', 'small ghost')}</li>
    </ol>${due > 120 ? `<p class="notice">复习积压 ${due} 词。建议今天先把到期复习清到 50 以内，再开始新的 list，避免越积越多。</p>` : ''}</section>`;
    const stats = `<div class="stats">
      <div class="stat"><span class="stat-label">已学词</span><strong class="stat-value">${d.learned}<small> / ${d.words.length}</small></strong></div>
      <div class="stat"><span class="stat-label">跨日回想成功</span><strong class="stat-value">${d.longTerm}<small> 词</small></strong></div>
      <div class="stat"><span class="stat-label">完成的 list</span><strong class="stat-value">${completedCount(t)}<small> / ${T.lists.length}</small></strong></div>
      <div class="stat"><span class="stat-label">生词本</span><strong class="stat-value">${Object.keys(state.imported[t]).length}<small> 词</small></strong></div>
    </div>`;
    const upcoming = l ? T.lists.slice(Math.max(0, T.lists.indexOf(l)), T.lists.indexOf(l) + 4) : [];
    const lower = `<div class="grid-2">
      <section class="card"><div class="card-head"><h2>学习日历</h2><span class="muted">近 16 周</span></div>${heatmap()}</section>
      <section class="card"><div class="card-head"><h2>接下来</h2>${btn(`全部 ${icon('chevron')}`, 'nav', 'data-page="lists"', 'small ghost')}</div>${upcoming.length ? `<div class="mini-lists">${upcoming.map(miniList).join('')}</div>` : '<p class="muted">词表录入后会显示在这里。</p>'}</section>
    </div>`;
    shell(head + `<div class="home-top">${hero}${tasks}</div>` + stats + lower + otherTrack(t));
  }
  function homeHero(l, s) {
    const p = listProgress(l), g = nextGroup(l), queued = state.queue[l.track].length, mix = state.settings.mix[l.track];
    const action = s ? btn(`继续上次学习 ${icon('arrow')}`, 'resume')
      : g === undefined ? btn(`${p.done ? '重新做整组检测' : '开始整组检测'} ${icon('arrow')}`, 'final', `data-list="${l.key}"`)
      : btn(`${p.passed ? '继续' : '开始'}第 ${g + 1} 组 ${icon('arrow')}`, 'group', `data-list="${l.key}" data-group="${g}"`);
    const allDone = completedCount(l.track) === TRACK[l.track].lists.length;
    return `<section class="hero">
      <div class="hero-main">
        ${chip(allDone ? '全部 list 已完成 · 可以重测巩固' : '今天推荐 · 接着未完成的学', 'on-accent')}
        <h2 class="hero-title">${esc(l.name)}${l.title ? `<small>${esc(l.title)}</small>` : ''}</h2>
        <p class="hero-meta">${l.words.length} 词 · ${l.groups} 组 × 10 词${mix && queued ? ` · 每组穿插 ${mix} 个生词` : ''}</p>
        ${s ? `<p class="hero-resume">${icon('review')}上次停在：${esc(sessionTitle(s))} · ${s.phase === 'learn' ? '记忆' : s.phase === 'quiz' ? '检测' : '巩固'} ${Math.min(s.index + 1, s.ids.length)} / ${s.ids.length}</p>` : ''}
        <div class="actions">${action}${btn('查看词表', 'open-list', `data-list="${l.key}"`, 'on-accent-ghost')}</div>
      </div>
      <div class="hero-ring">${ring(p.done ? l.groups : p.passed, l.groups, 132)}<div class="ring-label"><strong>${p.done ? l.groups : p.passed}</strong><span>/ ${l.groups} 组</span></div></div>
    </section>`;
  }
  // ---- Listening home: the 9988 method -------------------------------------------------
  function unitAction(task, cls = 'secondary small') {
    const l = task.l, g = nextGroup(l), unit = pairList(l) ? '配对' : '听写';
    if (task.round > 1 && task.pr.passed === l.groups) return btn(`整组${unit}`, 'final', `data-list="${l.key}"`, cls);
    return g === undefined ? btn('整组检测', 'final', `data-list="${l.key}"`, cls) : btn(`${task.pr.passed ? '继续' : '开始'}第 ${g + 1} 组`, 'group', `data-list="${l.key}" data-group="${g}"`, cls);
  }
  function listeningHome() {
    const d = derived('listening'), s = state.session, ongoing = s && s.phase !== 'done' && s.track === 'listening', info = planInfo(), n = streak();
    const head = pageHead('今天，把听力词汇听写出来。', `${greeting()} · ${todayText()}${info ? ` · 大循环表第 ${Math.min(info.dayNo, info.days)} / ${info.days} 天` : ''}`, '听力词汇 · 9988 雅思听力真题答案词汇', n ? `<span class="streak">${icon('flame')}连续 ${n} 天</span>` : '');
    const plan = state.settings.plan;
    const hero = !plan.days ? homeHero(nextList('listening'), ongoing ? s : null) : info ? planHero(info, ongoing ? s : null) : planPicker();
    const today = info && info.dayNo <= info.days ? dayTasks(info, Math.max(1, info.dayNo)) : [];
    const hardWhy = list => { const c = {spell: 0, slow: 0, meaning: 0, match: 0}; list.forEach(w => c[state.hard[w.id].r]++); return [c.spell && `拼写错 ${c.spell}`, c.slow && `反应慢 ${c.slow}`, c.meaning && `词义错 ${c.meaning}`, c.match && `配对错 ${c.match}`].filter(Boolean).join(' · '); };
    const due = d.due.length;
    const tasks = `<section class="card tasks"><div class="card-head"><h2>今日清单</h2><span class="muted">按书中方法：先难点，再新单元</span></div><ol class="task-list">
      <li class="${d.hardPrev.length ? '' : 'done'}"><span class="task-ico">${icon(d.hardPrev.length ? 'flame' : 'check')}</span><div><strong>难点词汇复习</strong><p>${d.hardPrev.length ? `之前标记的 ${d.hardPrev.length} 个 · ${hardWhy(d.hardPrev)}` : '没有待复习的难点词汇'}${d.hardToday.length ? ` · 今天新增 ${d.hardToday.length} 个，明天复习` : ''}</p></div>${d.hardPrev.length ? btn('开始', 'hard-start', '', 'small') : ''}</li>
      ${today.map(x => `<li class="${x.done ? 'done' : ''}"><span class="task-ico">${icon(x.done ? 'check' : pairList(x.l) ? 'layers' : 'pen')}</span><div><strong>${esc(x.l.name)} · ${esc(x.l.title)}</strong><p>${x.round === 1 ? `${pairList(x.l) ? '配对' : '听写'}学习 · 已通过 ${x.pr.passed} / ${x.l.groups} 组` : `整组${pairList(x.l) ? '配对' : '听写'}复习${x.done ? ' · 今天已完成' : ''}`}</p></div>${x.done ? '' : unitAction(x)}</li>`).join('')}
      <li class="${due ? '' : 'done'}"><span class="task-ico">${icon(due ? 'review' : 'check')}</span><div><strong>到期复习</strong><p>${due ? `${due} 个到期（间隔复习）` : '暂时没有到期的词'}</p></div>${due ? btn('去复习', 'nav', 'data-page="review"', 'small ghost') : ''}</li>
    </ol></section>`;
    const answers = d.words.filter(w => !isPair(w)), pairs = d.words.filter(isPair);
    const stats = `<div class="stats">
      <div class="stat"><span class="stat-label">答案词已学</span><strong class="stat-value">${answers.filter(w => C.learned(state, w.id)).length}<small> / ${answers.length}</small></strong></div>
      <div class="stat"><span class="stat-label">替换词已学</span><strong class="stat-value">${pairs.filter(w => C.learned(state, w.id)).length}<small> / ${pairs.length} 对</small></strong></div>
      <div class="stat"><span class="stat-label">难点词汇</span><strong class="stat-value">${d.hardPrev.length + d.hardToday.length}<small> 个</small></strong></div>
      <div class="stat"><span class="stat-label">跨日回想成功</span><strong class="stat-value">${d.longTerm}<small> 个</small></strong></div>
    </div>`;
    const lower = `<div class="grid-2">${info ? planStrip(info) : `<section class="card"><div class="card-head"><h2>学习日历</h2><span class="muted">近 16 周</span></div>${heatmap()}</section>`}
      <section class="card"><div class="card-head"><h2>书中方法</h2></div><ul class="method">
        <li><b>答案词</b>：跟读英音、拼写，再听写检验。听到后不能马上动笔、或拼错（含单复数和格式）的，都记为难点词汇。</li>
        <li><b>难点词汇</b>：第二天先复习，再开始新的单元。</li>
        <li><b>替换词</b>：不考拼写，做到能看懂、能听到、能听懂；体会成对的两个词之间的替换关系。</li>
      </ul></section></div>`;
    shell(head + `<div class="home-top">${hero}${tasks}</div>` + stats + lower + otherTrack('listening'));
  }
  function planPicker() {
    return `<section class="hero">
      <div class="hero-main">
        ${chip('9988 雅思听力词汇复习大循环表', 'on-accent')}
        <h2 class="hero-title">选一个复习计划</h2>
        <p class="hero-meta">书中给出三张大循环表：60 天（每天一个答案词单元）、30 天（每天两个）、15 天（考前突击，只背答案词）。每天的单元会自动排好。</p>
        <div class="actions">${btn('30 天', 'plan-start', 'data-days="30"')}${btn('60 天', 'plan-start', 'data-days="60"', 'on-accent-ghost')}${btn('15 天突击', 'plan-start', 'data-days="15"', 'on-accent-ghost')}${btn('不跟计划', 'plan-start', 'data-days="0"', 'on-accent-ghost')}</div>
      </div>
      <div class="hero-ring big-icon">${icon('calendar')}</div>
    </section>`;
  }
  function planHero(info, s) {
    if (info.dayNo > info.days) {
      return `<section class="hero"><div class="hero-main">${chip(`${info.days} 天大循环表`, 'on-accent')}<h2 class="hero-title">这一轮大循环完成了</h2><p class="hero-meta">书中建议在时间允许时多次重复整个大循环表，力争听写正确率接近 100%。</p><div class="actions">${btn(`再来一轮 ${icon('arrow')}`, 'plan-start', `data-days="${state.settings.plan.days}"`)}${btn('去复习难点', 'hard-start', '', 'on-accent-ghost')}</div></div><div class="hero-ring big-icon">${icon('check')}</div></section>`;
    }
    const n = Math.max(1, info.dayNo), tasks = dayTasks(info, n), done = tasks.filter(x => x.done).length, round = info.table[n - 1].round, next = tasks.find(x => !x.done);
    const a = info.table[n - 1].a, b = info.table[n - 1].b;
    const action = s ? btn(`继续上次学习 ${icon('arrow')}`, 'resume') : next ? unitAction(next, 'primary').replace(/第 (\d+) 组/, `${esc(next.key)} · 第 $1 组`) : btn(`今天的单元完成了 · 去复习 ${icon('arrow')}`, 'nav', 'data-page="review"');
    return `<section class="hero">
      <div class="hero-main">
        ${chip(`${info.days} 天大循环 · 第${['一', '二', '三'][round - 1]}轮（${info.names[round - 1]}）`, 'on-accent')}
        <h2 class="hero-title">第 ${n} 天</h2>
        <p class="hero-meta">${a.length ? `答案词 ${a.join(' & ')}` : ''}${a.length && b.length ? ' · ' : ''}${b.length ? `替换词 ${b.join(' & ')}` : ''}${!a.length && !b.length ? '今天没有新单元' : ''}</p>
        ${s ? `<p class="hero-resume">${icon('review')}上次停在：${esc(sessionTitle(s))}</p>` : ''}
        <div class="actions">${action}${btn('查看单元', 'nav', 'data-page="lists"', 'on-accent-ghost')}</div>
      </div>
      <div class="hero-ring">${ring(done, tasks.length || 1, 132)}<div class="ring-label"><strong>${done}</strong><span>/ ${tasks.length} 个单元</span></div></div>
    </section>`;
  }
  function planStrip(info) {
    const pills = info.table.map((day, i) => {
      const k = i + 1, tasks = dayTasks(info, k), done = tasks.length && tasks.every(x => x.done), some = tasks.some(x => x.done);
      const cls = k === info.dayNo ? 'today' : done ? 'done' : k < info.dayNo ? (some ? 'part' : 'miss') : '';
      return `<i class="${cls}" title="第 ${k} 天 · ${[...day.a, ...day.b].join(' ')}">${k}</i>`;
    }).join('');
    const behind = [];
    for (let k = 1; k < Math.min(info.dayNo, info.days + 1); k++) behind.push(...dayTasks(info, k).filter(x => !x.done));
    const uniq = [...new Map(behind.map(x => [x.key, x])).values()].slice(0, 6);
    return `<section class="card"><div class="card-head"><h2>大循环进度</h2><span class="muted">从 ${info.start.slice(5).replace('-', '/')} 开始</span></div><div class="plan-strip">${pills}</div>
      ${uniq.length ? `<p class="plan-behind">之前没完成：${uniq.map(x => `<button type="button" class="chip quiet" data-action="open-list" data-list="${x.key}">${esc(x.key)}</button>`).join('')}</p>` : '<p class="plan-behind muted">跟上计划了，保持节奏。</p>'}</section>`;
  }
  function emptyBook(queued) {
    return `<section class="hero empty-book">
      <div class="hero-main">
        ${chip('听力词表待录入', 'on-accent')}
        <h2 class="hero-title">听力词书还没有录入</h2>
        <p class="hero-meta">录入后会按 list 每天推进：先听读音、看词义、跟写一遍，再做「听音写词 + 选择词义」检测，拼写和意思都对才算记住。</p>
        <p class="hero-meta">现在可以先把听力练习里拼错、没听出来的词整理成 PDF 导入，马上开始听写。</p>
        <div class="actions">${btn(`导入听力生词 ${icon('arrow')}`, 'nav', 'data-page="import"')}${queued ? btn(`听写生词本（${queued} 个待学）`, 'inbox', '', 'on-accent-ghost') : ''}</div>
      </div>
      <div class="hero-ring big-icon">${icon('headphones')}</div>
    </section>`;
  }
  function miniList(l) {
    const p = listProgress(l);
    return `<button type="button" class="mini-list" data-action="open-list" data-list="${l.key}">${ring(p.done ? l.groups : p.passed, l.groups, 38)}<span><strong>${esc(l.name)}</strong><small>${p.done ? '已完成' : `${p.passed} / ${l.groups} 组`}${l.title ? ' · ' + esc(l.title) : ''}</small></span>${icon('chevron')}</button>`;
  }
  function heatmap() {
    const weeks = 16, today = C.day(), dow = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
    const start = C.addDays(today, -(weeks - 1) * 7 - dow), cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = C.addDays(start, i), v = state.activity[d] || 0;
      const level = d > today ? 'future' : v === 0 ? 'l0' : v <= 30 ? 'l1' : v <= 120 ? 'l2' : v <= 300 ? 'l3' : 'l4';
      cells.push(`<i class="${level}" title="${d}${d > today ? '' : ` · ${v ? v + ' 次学习记录' : '未学习'}`}"></i>`);
    }
    const days = Object.keys(state.activity).filter(k => state.activity[k] > 0).length;
    return `<div class="heatmap">${cells.join('')}</div><div class="heat-legend"><span>累计学习 ${days} 天</span><span class="scale">少<i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>多</span></div>`;
  }
  function otherTrack(t) {
    const o = t === 'reading' ? 'listening' : 'reading', O = TRACK[o], d = derived(o), l = nextList(o), s = state.session;
    const parts = [d.due.length ? `${d.due.length} 词到期` : '暂无到期复习'];
    if (l) parts.push(`${l.name} · ${listProgress(l).passed}/${l.groups} 组`); else parts.push(`生词本 ${d.custom.length} 词`);
    if (s && s.phase !== 'done' && s.track === o) parts.push('有未完成的学习');
    return `<section class="other-track"><span class="other-ico">${icon(O.icon)}</span><div><strong>${O.title}</strong><p>${parts.join(' · ')}</p></div>${btn(`切换到${O.name} ${icon('arrow')}`, 'track', `data-track="${o}"`, 'secondary small')}</section>`;
  }

  // ---- Lists ----------------------------------------------------------------------------
  function listsPage() {
    const t = track(), T = TRACK[t];
    if (t === 'listening' && T.lists.length) {
      const answers = T.lists.filter(l => !pairList(l)), pairs = T.lists.filter(pairList), info = planInfo();
      const todayKeys = new Set(info && info.dayNo <= info.days ? dayTasks(info, Math.max(1, info.dayNo)).map(x => x.key) : []);
      shell(pageHead('9988 雅思听力真题答案词汇', `答案词 ${answers.reduce((s, l) => s + l.words.length, 0)} 个，要会拼写；替换词 ${pairs.reduce((s, l) => s + l.words.length, 0)} 对，要能看懂、听懂。每个单元 10 个一组。`, '听力词汇 · UNITS') +
        `<section class="section"><div class="section-head"><div><h2>第 2 章 · 听力答案词</h2><p class="muted">听写拼写 + 选择词义 · 英音男声朗读</p></div></div><div class="list-grid">${answers.map(l => listCard(l, todayKeys)).join('')}${inboxCard(t)}</div></section>
        <section class="section"><div class="section-head"><div><h2>第 3 章 · 听力替换词</h2><p class="muted">看懂成对的替换关系，再做配对练习。已合并主书与配套电子版，完整覆盖 Unit B1–B51（剑 1–19 及网传真题）。</p></div></div><div class="list-grid">${pairs.map(l => listCard(l, todayKeys)).join('')}</div></section>`);
      return;
    }
    const head = pageHead(t === 'reading' ? '30 个 list，一天一个。' : '听力词表', t === 'reading' ? '完整保留原表的分组与顺序。可以自由选择，不会因为漏学一天而跳过。' : '每个 list 分成 10 词一组：先听音记忆，再听写拼写、选择词义。', `${T.title} · LISTS`);
    const cards = T.lists.map(l => listCard(l)).join('');
    shell(head + (T.lists.length ? `<div class="list-grid">${cards}${inboxCard(t)}</div>` : `${emptyBook(state.queue[t].length)}<div class="list-grid single">${inboxCard(t)}</div>`));
  }
  function listCard(l, todayKeys = null) {
    const p = listProgress(l), current = todayKeys ? todayKeys.has(l.key) : nextList(l.track)?.key === l.key, mixN = mixedInto(l.key).length, unit = pairList(l) ? '对' : '词';
    const status = p.done ? chip(p.best !== null ? `已完成 · 最佳 ${p.best}%` : '已完成', 'ok') : current ? chip('今天学这个', 'accent') : p.passed ? chip('学习中') : chip('未开始', 'quiet');
    const preview = l.words.slice(0, 3).map(w => isPair(w) ? `${w.pair.a.word} ${w.pair.rel} ${w.pair.b.word}` : w.word).join(' · ');
    return `<button type="button" class="list-card ${p.done ? 'done' : ''} ${current ? 'current' : ''}" data-action="open-list" data-list="${l.key}">
      <span class="lc-top"><span class="lc-num">${l.track === 'listening' ? esc(l.key) : pad2(l.num)}</span>${ring(p.done ? l.groups : p.passed, l.groups, 40)}</span>
      <span class="lc-name">${esc(l.track === 'listening' ? l.title || l.name : l.name)}</span>${l.title && l.track !== 'listening' ? `<span class="lc-title">${esc(l.title)}</span>` : ''}
      <span class="lc-meta">${l.words.length} ${unit} · ${p.passed}/${l.groups} 组${mixN ? ` · +${mixN} 生词` : ''}</span>
      <span class="lc-preview">${esc(preview)}</span>
      ${status}
    </button>`;
  }
  function inboxCard(t) {
    const total = Object.keys(state.imported[t]).length, queued = state.queue[t].length;
    return `<button type="button" class="list-card inbox-card" data-action="nav" data-page="import">
      <span class="lc-top"><span class="lc-num">${icon('inbox')}</span></span>
      <span class="lc-name">${TRACK[t].name}生词本</span>
      <span class="lc-meta">${total ? `${total} 词 · ${queued} 个待穿插` : '导入做题时不认识的词'}</span>
      <span class="lc-preview">${total ? '穿插进每天的 list，也可以单独学习' : '支持 PDF 与文字粘贴'}</span>
      ${chip(total ? '管理生词' : '去导入', 'quiet')}
    </button>`;
  }
  function detail() {
    const l = listByKey.get(ui.list);
    if (!l) { ui.page = 'lists'; return listsPage(); }
    const p = listProgress(l), g = nextGroup(l), mixIds = mixedInto(l.key), ready = p.passed === l.groups, T = TRACK[l.track], pairs = pairList(l), unit = pairs ? '对' : '词';
    const check = pairs ? '整组配对' : l.track === 'listening' ? '整组听写' : '整组检测';
    const primary = g === undefined ? btn(`${p.done ? '重新' : '开始'}${check} ${icon('arrow')}`, 'final', `data-list="${l.key}"`) : btn(`开始第 ${g + 1} 组 ${icon('arrow')}`, 'group', `data-list="${l.key}" data-group="${g}"`);
    const tiles = Array.from({length: l.groups}, (_, i) => {
      const ws = groupWords(l, i), ok = p.groups.includes(i);
      return `<button type="button" class="group-tile ${ok ? 'done' : ''} ${i === g ? 'next' : ''}" data-action="group" data-list="${l.key}" data-group="${i}"><span class="gt-tag">${ok ? icon('check') + '已通过' : '第 ' + (i + 1) + ' 组'}</span><strong>${i * 10 + 1}–${i * 10 + ws.length}</strong><small>${esc(isPair(ws[0]) ? ws[0].pair.a.word : ws[0]?.word || '')} …</small></button>`;
    }).join('');
    const finalCard = `<section class="card final-card"><div><h2>${check}</h2><p class="muted">通过全部 ${l.groups} 个小组后，${pairs ? '把这' : '随机检测这'} ${l.words.length} ${unit}${pairs ? '全部做一遍配对' : ''}${mixIds.length ? `，以及穿插进来的 ${mixIds.length} 个生词` : ''}。大循环表第二轮起的“复习单元”就是做这一步。首次正确率与纠错结果分开记录。</p>${p.last !== null ? `<p class="score-line">${icon('check')}上次首次正确率 <strong>${p.last}%</strong> · 最佳 ${p.best}%${p.done ? ' · 错的已全部纠正' : ''}</p>` : ''}</div>${btn(p.done ? '重新检测' : '开始检测', 'final', `data-list="${l.key}" ${ready ? '' : 'disabled'}`, 'secondary')}</section>`;
    const mixed = mixIds.length ? `<section class="section"><div class="section-head"><h2>穿插进这个 list 的生词</h2><span class="muted">${mixIds.length} 词 · 会一起出现在整组检测里</span></div><div class="word-list">${mixIds.map(id => wordRow(getWord(id))).join('')}</div></section>` : '';
    const head = pageHead(`${esc(l.name)}${l.title ? ` <small>${esc(l.title)}</small>` : ''}`, `${l.words.length} ${unit} · 已通过 ${p.passed} / ${l.groups} 组${p.done ? ` · ${check}已完成` : ''}`, `${T.title} / ${esc(l.name)}`);
    const how = pairs ? '先看懂成对的替换，再做配对' : l.track === 'listening' ? '先跟读拼写，再听写检验' : '先记忆，再测试';
    shell(`${head}<div class="toolbar">${primary}${btn('返回词表', 'nav', 'data-page="lists"', 'ghost')}</div>
      <section class="section"><div class="section-head"><h2>${how}</h2><span class="muted">每组 10 ${unit}，可分几次完成${!pairs && state.settings.mix[l.track] && state.queue[l.track].length ? ` · 每组额外穿插 ${state.settings.mix[l.track]} 个生词` : ''}</span></div><div class="group-grid">${tiles}</div></section>
      ${finalCard}${mixed}
      <details class="vocab-preview"><summary>${icon('eye')}浏览本单元的 ${l.words.length} ${unit}与中文</summary><div class="word-list">${l.words.map(w => wordRow(w)).join('')}</div></details>`);
  }
  function pairRow(w, hide) {
    const {a, b, rel} = w.pair, due = state.words[w.id]?.due ? dueLabel(w.id, w.track) : '';
    return `<div class="word-row pair-row"><div class="wr-main"><span class="pr-side"><strong class="wr-word">${esc(a.word)}</strong>${hide ? '' : `<span class="wr-meaning">${esc(a.pos)} ${esc(a.meaning)}</span>`}</span><span class="pr-rel ${rel === '反' ? 'anti' : ''}">${rel}</span><span class="pr-side"><strong class="wr-word">${esc(b.word)}</strong>${hide ? '' : `<span class="wr-meaning">${esc(b.pos)} ${esc(b.meaning)}</span>`}</span>${due ? `<span class="wr-tags"><small class="due">${esc(due)}</small></span>` : ''}</div><button type="button" class="icon-btn" data-action="speak" data-id="${esc(w.id)}" data-side="a" aria-label="播放 ${esc(a.word)} 读音">${icon('sound')}</button></div>`;
  }
  function wordRow(w, {hide = false, tags = ''} = {}) {
    if (!w) return '';
    if (isPair(w)) return pairRow(w, hide);
    const due = state.words[w.id]?.due || state.words[w.id]?.delayedDueAt ? dueLabel(w.id, w.track) : '';
    return `<div class="word-row"><div class="wr-main"><strong class="wr-word">${esc(w.word)}</strong>${w.phonetic && !hide ? `<span class="wr-phon">/${esc(w.phonetic.replace(/^\/|\/$/g, ''))}/</span>` : ''}${hide ? '' : `<span class="wr-meaning">${esc(w.meaning)}</span>`}${!hide && w.note ? `<small class="wr-note">${esc(w.note)}</small>` : ''}${tags || due ? `<span class="wr-tags">${tags}${due ? `<small class="due">${esc(due)}</small>` : ''}</span>` : ''}</div><button type="button" class="icon-btn" data-action="speak" data-id="${esc(w.id)}" aria-label="播放 ${esc(w.word)} 读音">${icon('sound')}</button></div>`;
  }

  // ---- Study ----------------------------------------------------------------------------
  function sessionTitle(s) {
    const T = TRACK[s.track];
    if (s.kind === 'group') return `${listLabel(s.listId)} · 第 ${s.group + 1} 组`;
    if (s.kind === 'final') return `${listLabel(s.listId)} · 整组检测`;
    if (s.kind === 'review') return `${T.name} · 到期复习`;
    if (s.kind === 'mistakes') return `${T.name} · 错词巩固`;
    if (s.kind === 'hard') return `${T.name} · 难点词汇复习`;
    return `${T.name}生词 · 单独学习`;
  }
  function optionPool(s) {
    const ok = w => !isPair(w) && w.meaning, l = s.listId ? listByKey.get(s.listId) : null, own = derived(s.track).words.filter(ok);
    const pool = [...(l ? l.words.filter(ok) : []), ...own];
    if (own.length < 12) pool.push(...TRACK.reading.words);
    return pool;
  }
  // Listening reviews split into dictation words and replacement pairs.
  function startButtons(action, words, label) {
    if (track() !== 'listening') return btn(`${label}（最多 20 词）${icon('arrow')}`, action, words.length ? '' : 'disabled');
    const n = words.filter(w => !isPair(w)).length, m = words.filter(isPair).length;
    return btn(`听写${label}（${n} 词）${icon('arrow')}`, action, `data-kind="words" ${n ? '' : 'disabled'}`) + btn(`配对${label}（${m} 对）`, action, `data-kind="pairs" ${m ? '' : 'disabled'}`, 'secondary');
  }
  function wordTags(s, w) {
    const tags = [];
    if (s.mixIds?.includes(w.id) || w.custom) tags.push(chip(`${icon('inbox')}生词本`, 'warm'));
    if (s.kind === 'group' && s.round === 0 && !s.primaryIds.includes(w.id)) tags.push(chip('旧词回顾', 'quiet'));
    if (s.kind === 'hard' && state.hard[w.id]) tags.push(chip({spell: '上次拼错', slow: '上次反应慢', meaning: '上次词义错', match: '上次配对错'}[state.hard[w.id].r], 'warm'));
    // The book marks sounds that are swallowed (吞) or linked (连) in speech.
    for (const t of w.tags || []) tags.push(`<span class="chip quiet" title="${t === '吞音' ? '书中标注：这里有吞音（失爆），跟读时注意' : '书中标注：这里有连读，跟读时注意'}">${t}</span>`);
    return tags.length ? `<div class="card-tags">${tags.join('')}</div>` : '';
  }
  // Accepted spellings: the book's form plus any listed alternatives.
  function spellingOk(typed, w) {
    for (const t of [w.word, ...(w.alts || [])]) { const c = C.checkSpelling(typed, t, state.settings.acceptVariants); if (c.ok) return {...c, target: t}; }
    return {ok: false};
  }
  // ---- Replacement pairs: learn cards and matching boards -----------------------------
  function pairLearnCard(s, w) {
    const {a, b, rel} = w.pair, last = s.index + 1 === s.ids.length;
    const side = (x, k, label) => `<div class="pair-side"><span class="pair-label">${label}</span><h2 class="pair-word">${esc(x.word)}</h2>${x.pos ? `<span class="pair-pos">${esc(x.pos)}</span>` : ''}<p class="pair-meaning">${esc(x.meaning)}</p><button type="button" class="play-chip" data-action="speak" data-id="${esc(w.id)}" data-side="${k}">${icon('sound')}<span>读音</span></button></div>`;
    return `<article class="pair-card">${wordTags(s, w)}<div class="pair-head">${rel === '反' ? chip('反义暗示 · 原文用相反的说法', 'warm') : chip('同义 / 近义替换')}</div>
      <div class="pair-sides">${side(a, 'a', '卷面')}<div class="pair-sym ${rel === '反' ? 'anti' : ''}">${rel}</div>${side(b, 'b', '原文')}</div>
      <p class="hint">看懂两个词的意思，体会它们之间的替换关系；听一遍读音，做到能听到、能听懂。</p>
      <div class="card-actions">${btn('再听一遍', 'speak-pair', `data-id="${esc(w.id)}"`, 'secondary')}${btn(last ? `开始配对练习 ${icon('arrow')}` : `下一对 ${icon('arrow')}`, 'learn-next')}</div></article>`;
  }
  // Up to five pairs per board, never two that share a word (they could not be
  // told apart). Short boards borrow unscored pairs so matching stays a choice.
  function ensureBoard(s) {
    if (s.board) {
      const all = [...s.board.ids, ...s.board.fill], pairs = all.map(id => getWord(id)?.pair);
      const unique = k => new Set(pairs.map(p => p?.[k].word.toLowerCase())).size === all.length;
      if (pairs.every(Boolean) && unique('a') && unique('b') && meaningSides(all)) return s.board;
      s.board = null; // Old saved boards may contain duplicate filler choices.
    }
    const rest = s.ids.slice(s.index), ids = [], usedA = new Set(), usedB = new Set();
    for (const id of rest) {
      const p = getWord(id).pair, ka = p.a.word.toLowerCase(), kb = p.b.word.toLowerCase();
      if (usedA.has(ka) || usedB.has(kb) || !meaningSides([...ids, id])) continue;
      ids.push(id); usedA.add(ka); usedB.add(kb);
      if (ids.length === 5) break;
    }
    s.ids = [...s.ids.slice(0, s.index), ...ids, ...rest.filter(id => !ids.includes(id))];
    const l = s.listId ? listByKey.get(s.listId) : null;
    const pool = C.shuffle((l ? l.words : derived(s.track).words).filter(w => isPair(w) && !ids.includes(w.id) && !usedA.has(w.pair.a.word.toLowerCase()) && !usedB.has(w.pair.b.word.toLowerCase())));
    const fill = [];
    for (const w of pool) {
      if (ids.length + fill.length >= 4) break;
      const ka = w.pair.a.word.toLowerCase(), kb = w.pair.b.word.toLowerCase();
      if (usedA.has(ka) || usedB.has(kb) || !meaningSides([...ids, ...fill, w.id])) continue;
      fill.push(w.id); usedA.add(ka); usedB.add(kb);
    }
    const all = [...ids, ...fill];
    s.board = {ids, fill, step: 'pair', left: C.shuffle(all), right: C.shuffle(all), matched: [], miss: {}, side: meaningSides(all), pick: null};
    persist();
    return s.board;
  }
  // For the meaning step pick, per pair, the word whose meaning is not already
  // on the board, so no two meanings read the same.
  function meaningSides(ids) {
    const side = {}, used = [], words = new Set();
    // Backtrack across at most five pairs. If neither side is unambiguous,
    // leave that pair for another board instead of showing identical answers.
    function assign(i) {
      if (i === ids.length) return true;
      const id = ids[i], p = getWord(id).pair;
      for (const k of C.shuffle(['a', 'b'])) {
        const word = p[k].word.toLowerCase();
        if (!p[k].meaning || words.has(word) || used.some(m => m === p[k].meaning || C.overlap(m, p[k].meaning))) continue;
        side[id] = k; used.push(p[k].meaning); words.add(word);
        if (assign(i + 1)) return true;
        used.pop(); words.delete(word); delete side[id];
      }
      return false;
    }
    return assign(0) ? side : null;
  }
  function boardView(s) {
    const b = ensureBoard(s), all = [...b.ids, ...b.fill], pair = id => getWord(id).pair;
    const cell = (col, id) => {
      const p = pair(id), matched = b.matched.includes(id), picked = b.pick?.col === col && b.pick.id === id, bad = ui.flash && ui.flash[col] === id;
      const x = b.step === 'pair' ? (col === 'L' ? p.a : p.b) : p[b.side[id]];
      const body = b.step === 'meaning' && col === 'R' ? `<span class="mi-meaning">${esc(x.meaning)}</span>` : `<strong>${esc(x.word)}</strong>${x.pos ? `<small>${esc(x.pos)}</small>` : ''}`;
      return `<button type="button" class="match-item ${matched ? 'ok' : ''} ${picked ? 'picked' : ''} ${bad ? 'bad' : ''}" data-action="board" data-col="${col}" data-id="${esc(id)}" ${matched ? 'disabled' : ''}>${body}${matched ? icon('check') : ''}</button>`;
    };
    const first = b.step === 'pair';
    return `<article class="board-card"><div class="board-head"><span class="eyebrow">${first ? '第 1 步 · 替换配对' : '第 2 步 · 词义配对'}</span><h2>${first ? '把卷面词和原文里的替换连起来' : '把每个词和它的中文意思连起来'}</h2><p class="muted">先点左边，再点右边${first ? '（点到的词会读出来）' : ''}。连错一次，这一对会进入巩固轮。</p></div>
      <div class="board-grid"><div class="board-col"><span class="board-label">${first ? '卷面' : '单词'}</span>${b.left.map(id => cell('L', id)).join('')}</div><div class="board-col"><span class="board-label">${first ? '原文' : '中文意思'}</span>${b.right.map(id => cell('R', id)).join('')}</div></div>
      <p class="board-progress">${icon('check')}${b.matched.length} / ${all.length} 已连好${b.fill.length ? ` · 含 ${b.fill.length} 对陪练（不计分）` : ''}</p></article>`;
  }
  function boardPick(col, id) {
    const s = state.session, b = s?.board;
    if (!b || s.phase !== 'quiz' || b.matched.includes(id)) return;
    if (!b.pick || b.pick.col === col) {
      b.pick = {col, id};
      if (b.step === 'pair') speak(id, {side: col === 'L' ? 'a' : 'b'});
      persist(); render(); return;
    }
    const first = b.pick; b.pick = null;
    if (first.id === id) b.matched.push(id);
    else {
      const leftId = first.col === 'L' ? first.id : id;
      if (b.ids.includes(leftId)) b.miss[leftId] = (b.miss[leftId] || 0) + 1;
      ui.flash = {[first.col]: first.id, [col]: id};
      setTimeout(() => { ui.flash = null; render(); }, 650);
    }
    const all = [...b.ids, ...b.fill];
    if (b.matched.length === all.length) {
      if (b.step === 'pair') Object.assign(b, {step: 'meaning', matched: [], left: C.shuffle(all), right: C.shuffle(all), side: meaningSides(all)});
      else if (C.submitBoard(state, b.ids.map(x => ({id: x, right: !b.miss[x]})))) all.forEach(x => C.see(state, x));
    }
    persist(); render();
  }
  function pairStudy(s) {
    const quiz = s.phase === 'quiz', w = getWord(s.ids[s.index]);
    const b = quiz ? ensureBoard(s) : null, all = b ? b.ids.length + b.fill.length : 1;
    const done = quiz ? s.index + (b.step === 'meaning' ? b.ids.length / 2 : 0) + b.matched.length / all * b.ids.length / 2 : s.index;
    const caption = s.round ? `第 ${s.round} 轮巩固 · ${s.ids.length} 对待加强` : quiz ? '每次 5 对：先连替换，再连词义。' : '看懂成对的两个替换词，听一遍读音。';
    shell(`<div class="study-head"><div><span class="eyebrow">${quiz ? '02 · 配对练习' : '01 · 看懂替换'}</span><h1 class="page-title">${esc(sessionTitle(s))}</h1><p class="subtitle">${caption}</p></div>${btn('稍后继续', 'pause', '', 'ghost small')}</div>
      <div class="session-bar"><div class="progress"><i style="width:${Math.min(100, done / s.ids.length * 100)}%"></i></div><span>${quiz ? `${Math.min(s.ids.length, s.index + b.ids.length)} / ${s.ids.length}` : `${s.index + 1} / ${s.ids.length}`}</span></div>
      <div class="study-layout"><section class="study-main">${quiz ? boardView(s) : pairLearnCard(s, w)}</section>
      <aside class="study-side"><span class="chip">替换词 · 能看懂、能听懂</span><h3>${quiz ? '连对才算掌握' : '体会替换关系'}</h3><p>${quiz ? '替换和词义两步都没有连错的一对，才算这次答对；连错的会在本轮结束后重新学习、重新配对。' : '书中提醒：替换词不考拼写。左边是题目卷面上的说法，右边是录音原文里换成的说法；「反」表示原文用反义的说法来暗示。'}</p>
      <dl class="side-stats"><div><dt>本轮</dt><dd>${s.allIds.length} 对</dd></div></dl></aside></div>`);
  }
  function study() {
    const s = state.session;
    if (!s) { ui.page = 'home'; return home(); }
    if (s.phase === 'done' || s.phase === 'repair') return result();
    const w = getWord(s.ids[s.index]);
    if (!w) { state.session = null; persist(); ui.page = 'home'; return home(); }
    if (s.mode === 'pairs') return pairStudy(s);
    const quiz = s.phase === 'quiz', listening = s.track === 'listening';
    if (quiz && !s.options) { s.options = C.choices(w, optionPool(s)); persist(); }
    const mixedOld = Math.max(0, s.allIds.length - s.primaryIds.length), imported = s.mixIds?.length || 0;
    const caption = s.round ? `第 ${s.round} 轮巩固 · ${s.ids.length} 个待加强的词` : quiz && mixedOld ? `本组 + 穿插 ${mixedOld} 个旧词，顺序已打乱` : s.kind === 'inbox' ? `从生词本取出 ${s.allIds.length} 个词，${quiz ? '检测' : '先记忆再检测'}。` : imported ? `本组 ${s.primaryIds.length - imported} 词 + 穿插 ${imported} 个生词` : listening ? (quiz ? '听读音，写出拼写，再选择意思。' : '听读音、看意思，照着拼一遍。') : (quiz ? '先在心里说出中文，再核对。' : '先听读音，再展开中文。');
    const phase = quiz ? (listening ? '02 · 听音写词' : '02 · 主动回想') : '01 · 记忆';
    const card = listening ? (quiz ? dictationCard(s, w) : listenLearnCard(s, w)) : (quiz ? recallCard(s, w) : readLearnCard(s, w));
    const pct = (s.index + (quiz && s.selected !== null ? 1 : 0)) / s.ids.length * 100;
    shell(`<div class="study-head"><div><span class="eyebrow">${phase}</span><h1 class="page-title">${esc(sessionTitle(s))}</h1><p class="subtitle">${caption}</p></div>${btn('稍后继续', 'pause', '', 'ghost small')}</div>
      <div class="session-bar"><div class="progress"><i style="width:${pct}%"></i></div><span>${s.index + 1} / ${s.ids.length}</span></div>
      <div class="study-layout"><section class="study-main">${card}</section>${studySide(s, listening, quiz, mixedOld, imported)}</div>`);
  }
  function studySide(s, listening, quiz, mixedOld, imported) {
    const tip = listening ? (quiz ? ['先写，再选意思', '听完直接拼写，不确定也先写下来。拼写和词义都正确才算记住，拼错的词会进入巩固轮。'] : ['读音、拼写、意思一起记', '每个词照着拼一遍，手写记忆比只看更牢。可以在设置里关闭跟写。'])
      : (quiz ? ['先自己想，再核对', '选项暂时隐藏。先在心里说出中文；只是凭印象猜的，请勾选「不太确定」。'] : ['读音、词形、意思一起记', '听一遍读音，展开中文，把词和意思联系起来。']);
    const keys = listening ? (quiz ? ['Enter 提交 / 继续', 'Shift+Enter 重播', '1–4 选择意思'] : ['Enter 下一个', 'Shift+Enter 重播', '空格 播放（输入框外）']) : (quiz ? ['空格 听读音', 'Enter 核对 / 继续', '1–4 选择答案'] : ['空格 听读音', 'Enter 展开 / 继续']);
    return `<aside class="study-side"><span class="chip">${listening ? '听写 + 词义' : '主动回想 + 延迟复测'}</span><h3>${tip[0]}</h3><p>${tip[1]}</p>
      <dl class="side-stats"><div><dt>本轮</dt><dd>${s.allIds.length} 词</dd></div>${mixedOld ? `<div><dt>旧词回顾</dt><dd>${mixedOld}</dd></div>` : ''}${imported ? `<div><dt>生词穿插</dt><dd>${imported}</dd></div>` : ''}</dl>
      <p class="help">即时练习通过后，约 20 分钟再回想一次，隔天继续复习。跨日到期且独立回想正确，才计入「跨日回想成功」。</p>
      <div class="kbd-help">${keys.map(k => { const [key, ...rest] = k.split(' '); return `<span><kbd>${key}</kbd>${rest.join(' ')}</span>`; }).join('')}</div></aside>`;
  }
  const noteLine = w => w.note ? `<p class="word-note">${esc(w.note)}</p>` : '';
  function readLearnCard(s, w) {
    const last = s.index + 1 === s.ids.length;
    return `<article class="word-card">${wordTags(s, w)}<h2 class="word">${esc(w.word)}</h2><div class="phon-row">${phonetic(w)}${playBtn(w.id, '美式读音')}</div>
      ${s.revealed ? `<div class="meaning">${esc(w.meaning)}</div>${w.detail && w.detail !== w.meaning ? `<p class="word-detail">${esc(w.detail)}</p>` : ''}${noteLine(w)}
        <div class="card-actions">${btn('再听一遍', 'speak', `data-id="${esc(w.id)}"`, 'secondary')}${btn(last ? `开始回想练习 ${icon('arrow')}` : `记住了，下一个 ${icon('arrow')}`, 'learn-next')}</div>`
      : `<p class="hint">先在心里想一想：你见过这个词吗？</p><div class="card-actions">${btn('展开中文意思', 'reveal')}</div>`}</article>`;
  }
  function recallCard(s, w) {
    const answered = s.selected !== null;
    const top = `<article class="word-card compact">${wordTags(s, w)}<span class="card-label">先想中文，再看选项</span><h2 class="word">${esc(w.word)}</h2><div class="phon-row">${phonetic(w)}${playBtn(w.id, '美式读音')}</div>${answered ? noteLine(w) : ''}</article>`;
    if (!s.recalled && !answered) return top + `<section class="gate"><span class="chip">先回想 · 选项暂时隐藏</span><h3>在心里说出它的中文意思。</h3><p>给自己几秒钟，不需要打字或拼写。</p><div class="card-actions">${btn('我想起来了，核对选项', 'recall')}${btn('想不起来，看答案', 'unknown', '', 'secondary')}</div></section>`;
    return top + choicesBlock(s, w);
  }
  function choicesBlock(s, w, title = '') {
    const answered = s.selected !== null, correct = answered && s.selected === w.id && !s.guessed;
    const opts = `<div class="choices">${s.options.map((o, i) => `<button type="button" class="choice ${answered ? (o.id === w.id ? 'correct' : o.id === s.selected ? 'wrong' : 'dim') : ''}" data-action="answer" data-id="${esc(o.id)}" ${answered ? 'disabled' : ''}><span class="answer-letter">${i + 1}</span><span class="choice-text">${esc(o.text)}</span>${answered && o.id === w.id ? icon('check') : ''}</button>`).join('')}</div>`;
    if (!answered) return `<section class="choices-wrap">${title ? `<h3 class="choices-title">${title}</h3>` : ''}${opts}<label class="guess-check"><input type="checkbox" id="guessed" ${s.guessed ? 'checked' : ''}> 我是看选项才认出来的 / 不太确定</label></section>`;
    const listening = s.track === 'listening', last = s.index + 1 === s.ids.length;
    const right = correct && (!listening || s.spellOk);
    let head, body;
    if (listening) {
      head = right ? '拼写和词义都正确。' : !s.spellOk && correct ? '词义对了，拼写还要再练。' : s.spellOk && !correct ? `拼写对了，意思是：${esc(w.meaning)}` : `${esc(w.word)} = ${esc(w.meaning)}`;
      body = right ? '已记录。约 20 分钟后和明天会再检查一次。' : '这个词会在本轮结束后重新记忆、重新听写。';
    } else {
      head = correct ? '核对正确。' : s.selected === w.id ? `正确意思：${esc(w.meaning)}` : `再记一下：${esc(w.word)} = ${esc(w.meaning)}`;
      body = correct ? '这次练习已记录，延迟复测会继续检查是否记住。' : s.guessed ? '本次没有独立回想出来，按需要复习记录，不会增加熟练度。' : '这个词会在本轮结束后重新出现。';
    }
    return `<section class="choices-wrap">${opts}<div class="feedback ${right ? 'success' : 'error'}" role="status"><strong>${head}</strong><p>${body}</p>${w.detail && w.detail !== w.meaning ? `<p>${esc(w.detail)}</p>` : ''}</div><div class="card-actions">${btn(last ? '查看本轮结果' : `下一题 ${icon('arrow')}`, 'quiz-next')}</div></section>`;
  }
  function listenLearnCard(s, w) {
    const last = s.index + 1 === s.ids.length, copy = state.settings.copyTyping;
    const field = copy ? `<label class="spell-field ${s.copied ? 'ok' : ''}"><span>照着拼一遍</span><input id="copy-input" class="spell-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" value="${esc(ui.draft)}" placeholder="${esc(w.word)}" aria-label="照着输入 ${esc(w.word)}">${icon('check')}</label>` : '';
    const meaning = w.meaning ? `<div class="meaning">${w.pos ? `<span class="pos-chip">${esc(w.pos)}</span>` : ''}${esc(w.meaning)}</div>` : `<p class="hint">数字 / 代码类答案：听清每一位，只考拼写。</p>`;
    return `<article class="word-card">${wordTags(s, w)}<h2 class="word">${esc(w.word)}</h2><div class="phon-row">${phonetic(w)}${playBtn(w.id, '读音')}<button type="button" class="play-chip" data-action="speak-slow" data-id="${esc(w.id)}">${icon('slow')}<span>慢速</span></button></div>
      ${meaning}${w.detail && w.detail !== w.meaning ? `<p class="word-detail">${esc(w.detail)}</p>` : ''}${noteLine(w)}${field}
      <div class="card-actions">${btn(last ? `开始听写检测 ${icon('arrow')}` : `下一个 ${icon('arrow')}`, 'learn-next', copy && !s.copied ? 'disabled id="learn-next"' : 'id="learn-next"')}${copy && !s.copied ? btn('跳过跟写', 'skip-copy', '', 'ghost') : ''}</div></article>`;
  }
  function dictationCard(s, w) {
    const id = esc(w.id);
    if (s.spellOk === null) {
      return `<article class="word-card dictation">${wordTags(s, w)}<span class="card-label">听音写词</span>
        <button type="button" class="play-big" data-action="speak" data-id="${id}" aria-label="播放读音">${icon('sound')}</button>
        <button type="button" class="text-link slow-link" data-action="speak-slow" data-id="${id}">${icon('slow')}慢速再听</button>
        <form class="spell-form" data-form="spell" autocomplete="off"><input id="spell-input" class="spell-input big" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" value="${esc(ui.draft)}" placeholder="写下听到的单词" aria-label="写下听到的单词"><button type="submit" class="btn primary">提交</button></form>
        <div class="card-actions">${btn('不会写，看答案', 'give-up', '', 'ghost')}</div>
        <p class="hint">${w.meaning ? '' : '只考拼写 · '}Enter 提交 · Shift+Enter 重播 · 不区分大小写${state.settings.acceptVariants ? ' · 英式 / 美式拼写均可' : ''}${state.settings.slowMs ? ` · 听到后 ${state.settings.slowMs / 1000} 秒内没开始写记为难点` : ''}</p></article>`;
    }
    const gaveUp = s.spellOk === false && !s.typed, last = s.index + 1 === s.ids.length;
    const check = s.typed ? spellingOk(s.typed, w) : {ok: false};
    const slowNote = s.slow ? `<small>反应偏慢：听到后超过 ${state.settings.slowMs / 1000} 秒才开始写，已记为难点词汇，明天先复习。</small>` : '';
    const verdict = s.spellOk ? `<p class="verdict ${s.slow ? 'warn' : 'ok'}">${icon('check')}拼写正确${check.note ? `<small>${esc(check.note)}</small>` : ''}${slowNote}</p>` : `<p class="verdict bad">${icon('x')}${gaveUp ? '这次没写出来' : '拼写有误'}<small>已记为难点词汇，明天先复习。</small></p>${gaveUp ? '' : diffView(s.typed, w.word)}`;
    const top = `<article class="word-card dictation done">${wordTags(s, w)}<span class="card-label">听音写词</span><h2 class="word">${esc(w.word)}</h2><div class="phon-row">${phonetic(w)}${playBtn(w.id, '再听')}</div>${verdict}${s.selected !== null ? noteLine(w) : ''}</article>`;
    const next = `<div class="card-actions">${btn(last ? '查看本轮结果' : `下一题 ${icon('arrow')}`, 'quiz-next')}</div>`;
    if (!w.meaning) return top + `<div class="feedback ${s.spellOk ? 'success' : 'error'}" role="status"><strong>${s.spellOk ? '写对了。' : `正确答案：${esc(w.word)}`}</strong><p>${s.spellOk ? '数字和代码要听清每一位。' : '本轮结束后会重新听写。'}</p></div>${next}`;
    if (gaveUp) return top + `<div class="feedback error" role="status"><strong>${esc(w.word)} = ${esc(w.meaning)}</strong><p>这个词会在本轮结束后重新记忆、重新听写。</p></div>${next}`;
    return top + choicesBlock(s, w, '这个词的意思是？');
  }
  function diffView(typed, target) {
    const ops = C.spellingDiff(typed, target);
    const mine = ops.map(o => o.op === 'eq' ? esc(o.typed) : o.op === 'sub' ? `<b class="bad">${esc(o.typed)}</b>` : o.op === 'del' ? `<s class="bad">${esc(o.typed)}</s>` : '<b class="gap">_</b>').join('');
    const right = ops.filter(o => o.op !== 'del').map(o => o.op === 'eq' ? esc(o.expected) : `<b class="fix">${esc(o.expected)}</b>`).join('');
    return `<div class="diff"><div><small>你的拼写</small><code>${mine}</code></div><div><small>正确拼写</small><code>${right}</code></div></div>`;
  }
  function result() {
    const s = state.session, repair = s.phase === 'repair', score = s.firstScore ?? 0, unit = s.mode === 'pairs' ? '对' : '个词';
    const title = repair ? '再巩固一次' : '这一步，完成了';
    const body = repair ? `<h2>还有 ${s.wrongIds.length} ${unit}需要加强</h2><p class="muted">答错不是白学，它告诉你下一遍应该看哪里。先重新记一遍，再测一轮。</p><div class="actions center">${btn(`重新${s.mode === 'pairs' ? '看懂' : '记忆'}这 ${s.wrongIds.length} ${s.mode === 'pairs' ? '对' : '词'}`, 'retry')}${btn('稍后继续', 'pause', '', 'ghost')}</div>`
      : `<h2>${s.kind === 'final' ? '这个 list 的当日练习完成了。' : s.kind === 'review' ? '这一批复习完成了。' : '本轮练习通过了。'}</h2><p class="muted">${s.round ? `经过 ${s.round} 轮巩固，所有词都已答对。` : '所有词都在本轮独立答对。'}接下来还会做延迟与跨日复测。</p>
        <p class="help">跨日复习日期：${esc([...new Set(s.allIds.map(id => state.words[id]?.due).filter(Boolean))].sort().map(d => d.slice(5).replace('-', '/')).join('、') || '—')}</p>
        <div class="actions center">${btn(s.kind === 'group' ? `继续这个 list ${icon('arrow')}` : s.kind === 'inbox' ? '回到生词本' : '回到今日学习', 'finish-session')}${btn('去到期复习', 'finish-review', '', 'secondary')}</div>`;
    shell(`${pageHead(esc(sessionTitle(s)), repair ? '这一轮已经结束。先把不熟的词重新记一遍。' : '本次词汇已全部答对，包含答错后重新记忆和测试的词。', title)}
      <section class="result-card"><div class="result-ring">${ring(score, 100, 168)}<div class="ring-label"><strong>${score}<small>%</small></strong><span>首次正确率</span></div></div><div class="result-body"><span class="chip">${s.round === 0 ? '首次测试' : '纠错后的结果'} · ${s.allIds.length} ${unit}</span>${body}</div></section>
      ${repair ? `<section class="section"><div class="section-head"><h2>本轮待加强</h2></div><div class="word-list">${s.wrongIds.map(id => wordRow(getWord(id), {tags: s.track === 'listening' && state.words[id]?.spellWrong ? chip(`拼写错 ${state.words[id].spellWrong} 次`, 'warm') : ''})).join('')}</div></section>` : ''}`);
  }

  // ---- Review & mistakes ------------------------------------------------------------------
  function reviewPage() {
    const t = track(), T = TRACK[t], d = derived(t), list = C.reviewQueue(state, d.due);
    const filtered = filterWords(list);
    shell(`${pageHead('让学过的词，留到明天。', `今天有 ${list.length} 个${T.name}词到期。每次最多 20 个${t === 'listening' ? '，用听写方式复习' : '，先回想再核对'}；列表暂不显示中文，避免提前看到答案。`, `${T.title} · SPACED REVIEW`)}
      ${forecast(t)}
      <div class="toolbar">${startButtons('review-start', list, '复习')}<label class="search">${icon('search')}<span class="sr-only">搜索英文</span><input id="search" type="search" placeholder="搜索英文" value="${esc(ui.search)}" autocomplete="off"></label></div>
      <div id="collection-rows" class="word-list">${collectionRows(filtered, list.length, 'review')}</div>`);
  }
  function forecast(t) {
    const d = derived(t), today = C.day(), counts = Array.from({length: 7}, (_, i) => {
      const day = C.addDays(today, i);
      return d.words.filter(w => { const r = state.words[w.id]; if (!r) return false; const shortDay = r.delayedDueAt ? C.day(new Date(r.delayedDueAt)) : null; return i === 0 ? (r.due && r.due <= day) || (shortDay && shortDay <= day) : r.due === day || shortDay === day; }).length;
    });
    const max = Math.max(1, ...counts);
    return `<section class="card forecast"><div class="card-head"><h2>接下来 7 天</h2><span class="muted">含 20 分钟短延迟与跨日复习</span></div><div class="bars">${counts.map((n, i) => `<div class="bar ${i === 0 ? 'today' : ''}"><span class="bar-n">${n}</span><span class="bar-track"><i style="height:${Math.max(n ? 6 : 0, n / max * 100)}%"></i></span><span class="bar-d">${i === 0 ? '今天' : i === 1 ? '明天' : C.addDays(today, i).slice(5).replace('-', '/')}</span></div>`).join('')}</div></section>`;
  }
  function filterWords(list) { const q = ui.search.trim().toLowerCase(); return q ? list.filter(w => w.word.toLowerCase().includes(q) || (ui.page === 'mistakes' && ui.revealed.has(w.id) && w.meaning.includes(q))) : list; }
  function collectionRows(filtered, total, kind) {
    if (filtered.length) return filtered.map(w => kind === 'review' ? wordRow(w, {hide: true}) : mistakeRow(w)).join('');
    const t = track();
    return `<div class="empty">${icon(kind === 'review' ? 'review' : 'star')}<h2>${total ? '没有找到这个词' : kind === 'review' ? '今天暂时没有到期的词' : '还没有错词记录'}</h2><p>${total ? '换一个关键词试试。' : kind === 'review' ? '延迟复测还没到时间时，可以先学下一小组，稍后回来。' : '答错的词会自动收进这里。'}</p>${total ? '' : btn('开始学习', 'nav', 'data-page="home"', 'secondary')}</div>`;
  }
  function mistakeRow(w) {
    const r = state.words[w.id] || {}, info = derived(w.track).info.get(w.id), open = ui.revealed.has(w.id), stable = (info?.repetitions || 0) >= 2;
    const tags = [chip(`错 ${r.wrong} 次`, 'warm'), w.track === 'listening' && r.spellWrong ? chip(`拼写错 ${r.spellWrong} 次`, 'warm') : '', stable ? chip('已稳定', 'ok') : chip('待加强', 'quiet'), w.custom ? chip('生词本', 'quiet') : ''].join('');
    const due = dueLabel(w.id, w.track);
    if (isPair(w)) return pairRow(w, !open).replace('<div class="word-row pair-row">', `<div class="word-row pair-row ${open ? 'open' : ''}">`).replace('</div><button', `${open ? '' : `<button type="button" class="reveal-btn" data-action="reveal-row" data-id="${esc(w.id)}">${icon('eye')}显示中文</button>`}<span class="wr-tags">${tags}</span></div><button`);
    return `<div class="word-row ${open ? 'open' : ''}"><div class="wr-main"><strong class="wr-word">${esc(w.word)}</strong>${open ? `<span class="wr-meaning">${esc(w.meaning)}</span>` : `<button type="button" class="reveal-btn" data-action="reveal-row" data-id="${esc(w.id)}">${icon('eye')}显示中文</button>`}<span class="wr-tags">${tags}${due ? `<small class="due">${esc(due)}</small>` : ''}</span></div><button type="button" class="icon-btn" data-action="speak" data-id="${esc(w.id)}" aria-label="播放 ${esc(w.word)} 读音">${icon('sound')}</button></div>`;
  }
  function mistakesPage() {
    const t = track(), T = TRACK[t], d = derived(t), all = C.reviewQueue(state, d.mistakes);
    const weak = all.filter(w => (d.info.get(w.id)?.repetitions || 0) < 2), shown = ui.mistakeFilter === 'weak' ? weak : all;
    const filtered = filterWords(shown);
    shell(`${pageHead('错过的词，再认识一遍。', `共 ${all.length} 个曾答错的${T.name}词，其中 ${weak.length} 个还没有稳定。中文默认隐藏，点「显示中文」才会计入一次复习。`, `${T.title} · WORD NOTEBOOK`)}
      <div class="toolbar"><div class="segmented" role="group" aria-label="筛选"><button type="button" class="${ui.mistakeFilter === 'weak' ? 'on' : ''}" data-action="mistake-filter" data-filter="weak">待加强 ${weak.length}</button><button type="button" class="${ui.mistakeFilter === 'all' ? 'on' : ''}" data-action="mistake-filter" data-filter="all">全部 ${all.length}</button></div>
      ${startButtons('mistakes-start', all, '巩固')}${shown.length ? btn('显示全部中文', 'reveal-all', '', 'ghost small') : ''}<label class="search">${icon('search')}<span class="sr-only">搜索英文</span><input id="search" type="search" placeholder="搜索英文" value="${esc(ui.search)}" autocomplete="off"></label></div>
      <div id="collection-rows" class="word-list">${collectionRows(filtered, shown.length, 'mistakes')}</div>`);
  }

  // ---- Import -------------------------------------------------------------------------------
  const impTarget = () => ui.imp.target || track();
  function classify(row, t) {
    // Word processors capitalise the first word of each line ("Abandon");
    // follow the dictionary's casing so proper nouns such as "London" stay.
    const book = TRACK[t].index.get(row.word.toLowerCase()), cid = C.customId(t, row.word);
    if (book) row.word = book.word;
    else if (/[A-Z]/.test(row.word)) { const d = Importer.lookup(row.word); if (d) row.word = d.via === 'exact' ? d.head : row.word.toLowerCase(); }
    row.bookId = book?.id || null; row.bookLabel = book ? listLabel(book.listKey) : '';
    if (book) row.status = state.imported[t][book.id] ? 'dup' : 'book';
    else if (!cid) row.status = 'noise';
    else if (state.imported[t][cid]) row.status = 'dup';
    else {
      const d = Importer.lookup(row.word);
      if (!row.meaning && d?.meaning) { row.meaning = d.meaning; row.auto = true; }
      if (!row.phonetic && d?.phonetic) row.phonetic = d.phonetic;
      if (d && d.via !== 'exact' && !row.note) row.note = `原形 ${d.head}`;
      row.status = row.noise ? 'noise' : row.meaning ? 'new' : 'missing';
    }
    row.checked = row.status === 'new' || row.status === 'book';
    return row;
  }
  function buildRows(text) {
    const t = impTarget();
    const rows = Importer.parseText(text).map(e => classify({word: e.word, meaning: e.meaning, pos: e.pos, note: e.note || '', phonetic: '', noise: e.noise, auto: false}, t));
    if (!rows.length) throw new Error('没有识别到英文单词。请确认内容是「英文 + 中文」或每行一个英文单词。');
    ui.imp.rows = rows;
  }
  function setImpStatus(text) { ui.imp.status = text; const el = document.getElementById('imp-status'); if (el) el.textContent = text; }
  async function handleImportFile(file) {
    const imp = ui.imp;
    if (!file || imp.busy) return;
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf', isText = /\.(txt|csv|md|tsv)$/i.test(file.name) || file.type.startsWith('text/');
    imp.error = '';
    if (!isPdf && !isText) { imp.error = '请选择 PDF 或 .txt 文件。Word 文档可以先另存为 PDF。'; render(); return; }
    if (file.size > 40 * 1024 * 1024) { imp.error = '文件超过 40 MB，请拆分后再导入。'; render(); return; }
    imp.busy = true; imp.file = file.name; imp.status = '正在准备离线词典…'; render();
    try {
      await Importer.loadDictionary(ASSET_V);
      let text;
      if (isPdf) {
        setImpStatus('正在打开 PDF…');
        const res = await Importer.readPdf(new Uint8Array(await file.arrayBuffer()), (p, n) => setImpStatus(`正在扫描第 ${p} / ${n} 页…`));
        if (res.chars < 4) throw new Error('这个 PDF 里没有可识别的文字，可能是拍照或扫描的图片。请用 WPS / Word 打开原文档另存为 PDF，或把文字直接粘贴进来。');
        text = res.lines.join('\n');
      } else text = await file.text();
      buildRows(text);
    } catch (err) {
      imp.error = err?.name === 'PasswordException' ? '这个 PDF 设置了密码，请先取消密码再导入。' : err?.message || '无法读取这个文件。';
    }
    imp.busy = false; render();
  }
  async function parsePasted() {
    const text = document.getElementById('imp-text')?.value || '';
    if (!text.trim()) { notify('请先粘贴单词。'); return; }
    ui.imp.busy = true; ui.imp.error = ''; ui.imp.file = '粘贴的文字'; ui.imp.status = '正在准备离线词典…'; render();
    try { await Importer.loadDictionary(ASSET_V); buildRows(text); ui.imp.paste = false; }
    catch (err) { ui.imp.error = err?.message || '无法识别这些文字。'; }
    ui.imp.busy = false; render();
  }
  function commitImport() {
    const t = impTarget(), rows = ui.imp.rows || [];
    const items = rows.filter(r => r.checked && (r.bookId || r.meaning.trim())).map(r => ({word: r.word, meaning: r.meaning, phonetic: r.phonetic, pos: r.pos, note: r.note, bookId: r.bookId}));
    if (!items.length) { notify('请先勾选要导入的词（缺少释义的词需要补充中文）。'); return; }
    const res = C.addImports(state, t, items, ui.imp.file);
    persist(); ui.imp.rows = null;
    const parts = [`已导入 ${res.added.length} 个词`];
    if (res.queued) parts.push(`${res.queued} 个将穿插进每天的 list`);
    if (res.relapsed) parts.push(`${res.relapsed} 个学过的词已安排今天复习`);
    notify(parts.join('，') + '。');
    render();
  }
  const STATUS = {new: ['新词 · 待穿插', 'accent'], book: ['已在词表', 'ok'], dup: ['已导入过', 'quiet'], missing: ['缺少释义', 'warm'], noise: ['疑似标题', 'quiet']};
  function importPage() {
    const imp = ui.imp, t = impTarget(), T = TRACK[t];
    const targets = `<div class="target-pick" role="group" aria-label="导入到">${Object.values(TRACK).map(X => `<button type="button" class="target ${t === X.key ? 'on' : ''}" data-action="imp-target" data-target="${X.key}" aria-pressed="${t === X.key}">${icon(X.icon)}<span><strong>${X.name}生词</strong><small>${X.key === 'reading' ? '回想中文意思 + 选择核对' : '听音写拼写 + 选择词义'}</small></span></button>`).join('')}</div>`;
    let body;
    if (imp.busy) body = `<section class="card dropzone busy"><span class="spinner" aria-hidden="true"></span><strong id="imp-status">${esc(imp.status)}</strong><span class="muted">${esc(imp.file)}</span></section>`;
    else if (imp.rows) body = previewTable(t);
    else body = `<label class="card dropzone" for="imp-file">${icon('upload')}<strong>拖入 PDF，或点击选择文件</strong><span>支持 WPS / Word 导出的文字版 PDF，以及 .txt 文本。格式随意：「abandon 放弃」「1. abandon v. 放弃」、表格，或每行一个英文词都可以。</span><input type="file" id="imp-file" accept=".pdf,.txt,.csv,application/pdf,text/plain" hidden></label>
      ${imp.error ? `<div class="banner error" role="alert">${esc(imp.error)}</div>` : ''}
      <div class="paste-box">${imp.paste ? `<textarea id="imp-text" rows="8" placeholder="每行一个词，例如：&#10;abandon 放弃&#10;mitigate v. 减轻；缓和&#10;scrutiny"></textarea><div class="actions">${btn('识别这些文字', 'imp-parse-paste')}${btn('收起', 'imp-paste-toggle', '', 'ghost')}</div>` : btn(`${icon('pen')}没有 PDF？直接粘贴文字`, 'imp-paste-toggle', '', 'ghost')}</div>`;
    shell(`${pageHead('把做题时不认识的词，导进来。', `整理成 PDF 后导入，扫描完成会自动放进${T.name}生词本，并按设置穿插进每天的 list 里背${state.settings.mix[t] ? `（目前每组 ${state.settings.mix[t]} 个）` : '（目前已关闭穿插，可在设置中开启）'}。`, 'IMPORT · 导入生词')}
      ${targets}${body}${notebook(t)}`);
  }
  function previewTable(t) {
    const rows = ui.imp.rows, count = k => rows.filter(r => r.status === k).length, selected = rows.filter(r => r.checked).length;
    const list = rows.map((r, i) => {
      const [label, cls] = STATUS[r.status], book = r.bookId ? byId.get(r.bookId) : null;
      const multi = r.word.trim().split(/\s+/).length;
      return `<div class="imp-row ${r.checked ? '' : 'off'}">
        <label class="imp-check"><input type="checkbox" data-imp-check="${i}" ${r.checked ? 'checked' : ''} ${r.status === 'dup' || (r.status === 'missing' && !r.meaning.trim()) ? 'disabled' : ''} aria-label="导入 ${esc(r.word)}"></label>
        <div class="imp-word"><input type="text" data-imp-word="${i}" value="${esc(r.word)}" aria-label="单词" spellcheck="false">${r.phonetic ? `<small>/${esc(r.phonetic)}/</small>` : ''}${multi > 1 && !r.bookId ? `<button type="button" class="text-link" data-action="imp-split" data-row="${i}">拆成 ${multi} 个词</button>` : ''}</div>
        <div class="imp-meaning">${book ? `<span class="book-meaning">${esc(book.meaning)}</span><small>已在 ${esc(r.bookLabel)}，${C.learned(state, book.id) ? '学过：今天重新复习' : '未学：提前穿插学习'}</small>` : `<input type="text" data-imp-meaning="${i}" value="${esc(r.meaning)}" placeholder="补充中文释义" aria-label="${esc(r.word)} 的中文释义">${r.auto ? '<small>释义来自离线词典，可修改</small>' : ''}${r.note ? `<small>${esc(r.note)}</small>` : ''}`}</div>
        <span class="imp-status">${chip(label, cls)}</span>
      </div>`;
    }).join('');
    return `<section class="card preview">
      <div class="card-head"><div><h2>${icon('file')}${esc(ui.imp.file)}</h2><p class="muted">识别到 ${rows.length} 个词：新词 ${count('new')} · 已在词表 ${count('book')} · 缺少释义 ${count('missing')} · 已导入过 ${count('dup')}${count('noise') ? ` · 疑似标题 ${count('noise')}` : ''}</p></div><div class="actions">${btn('全选', 'imp-check-all', '', 'ghost small')}${btn('全不选', 'imp-uncheck-all', '', 'ghost small')}</div></div>
      <div class="imp-table">${list}</div>
      <div class="preview-foot"><p class="muted">勾选的新词进入生词本，学习时穿插进每天的 list；已在词表且学过的词会立刻安排复习。</p><div class="actions">${btn('重新选择文件', 'imp-clear', '', 'ghost')}${btn(`导入 ${selected} 个词 ${icon('arrow')}`, 'imp-commit', selected ? '' : 'disabled')}</div></div>
    </section>`;
  }
  function importStatus(id, t) {
    if (state.queue[t].includes(id)) return chip('待穿插', 'accent');
    const where = state.mix[id];
    if (where === 'inbox') return chip('已单独学习', 'ok');
    if (where) return chip(`已穿插 · ${esc(listLabel(where))}`, 'ok');
    return chip('已安排复习', 'warm');
  }
  function notebook(t) {
    const entries = Object.entries(state.imported[t]).sort((a, b) => b[1].at - a[1].at), queued = state.queue[t].length;
    if (!entries.length) return `<section class="section"><div class="section-head"><h2>${TRACK[t].name}生词本</h2></div><div class="empty">${icon('inbox')}<h2>生词本还是空的</h2><p>导入后，生词会在这里显示学习状态：待穿插、已穿插进哪个 list、复习安排。</p></div></section>`;
    const q = ui.imp.filter.trim().toLowerCase();
    const rows = entries.filter(([id]) => !q || getWord(id)?.word.toLowerCase().includes(q)).map(([id, meta]) => {
      const w = getWord(id); if (!w) return '';
      return `<div class="word-row"><div class="wr-main"><strong class="wr-word">${esc(w.word)}</strong><span class="wr-meaning">${esc(w.meaning)}</span><span class="wr-tags">${importStatus(id, t)}${!w.custom ? chip(esc(listLabel(w.listKey)), 'quiet') : ''}<small class="due">${new Date(meta.at).toLocaleDateString('zh-CN')}${meta.src ? ' · ' + esc(meta.src) : ''}</small></span></div><button type="button" class="icon-btn" data-action="speak" data-id="${esc(id)}" aria-label="播放读音">${icon('sound')}</button><button type="button" class="icon-btn danger" data-action="imp-remove" data-id="${esc(id)}" aria-label="从生词本移除 ${esc(w.word)}">${icon('trash')}</button></div>`;
    }).join('');
    return `<section class="section"><div class="section-head"><div><h2>${TRACK[t].name}生词本 · ${entries.length} 词</h2><p class="muted">${queued ? `${queued} 个待穿插。也可以不等每天的 list，直接单独学一组。` : '全部生词都已开始学习。'}</p></div><div class="actions">${queued ? btn(`单独学习 ${Math.min(10, queued)} 个 ${icon('arrow')}`, 'inbox', '', 'secondary') : ''}</div></div>
      <div class="toolbar"><label class="search">${icon('search')}<span class="sr-only">搜索生词</span><input id="nb-search" type="search" placeholder="搜索生词" value="${esc(ui.imp.filter)}" autocomplete="off"></label></div>
      <div class="word-list" id="nb-rows">${rows || '<div class="empty"><p>没有找到这个词。</p></div>'}</div></section>`;
  }

  // ---- Settings ---------------------------------------------------------------------------
  function settings() {
    const st = state.settings;
    const sel = (id, options, value, label) => `<select id="${id}" aria-label="${label}">${options.map(([v, text]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select>`;
    const toggle = (id, on, label) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} aria-label="${label}"><span class="slider"></span></label>`;
    const mixOptions = C.MIX_COUNTS.map(n => [n, n ? `每组 ${n} 个（每个 list 约 ${n * 10} 个）` : '不穿插']);
    const row = (title, desc, control) => `<div class="settings-row"><div><h3>${title}</h3><p>${desc}</p></div>${control}</div>`;
    shell(`${pageHead('按你的节奏来。', '学习数据只保存在当前浏览器。换设备前请导出备份。', 'PREFERENCES · 设置')}
      <section class="card settings-card"><h2>学习计划</h2>
        ${row('学习开始日期', '用于显示「学习第几天」，不会锁定或跳过任何 list。', `<input id="start-date" type="date" value="${esc(state.startDate)}" aria-label="学习开始日期">`)}
        ${row('阅读：每组穿插生词', '导入的阅读生词按顺序穿插进每个 10 词小组，并计入该 list 的整组检测。', sel('mix-reading', mixOptions, st.mix.reading, '阅读每组穿插生词数'))}
        ${row('听力：每组穿插生词', '导入的听力生词同样穿插进听力 list 的小组里听写。', sel('mix-listening', mixOptions, st.mix.listening, '听力每组穿插生词数'))}
      </section>
      <section class="card settings-card"><h2>读音</h2>
        ${row('读音速度', '内置 Emma 自然美式读音（神经语音合成）。', sel('rate', [[0.75, '慢速 · 0.75×'], [1, '正常 · 1×'], [1.15, '稍快 · 1.15×']], st.rate, '读音速度'))}
        ${row('阅读：自动播放', '每个词出现时自动读一遍。', toggle('autoplay-reading', st.autoplay.reading, '阅读自动播放'))}
        ${row('听力：自动播放', '听写时建议开启：出题即播放，可用 Shift+Enter 重播。', toggle('autoplay-listening', st.autoplay.listening, '听力自动播放'))}
        ${row('导入词使用在线读音', '导入的生词没有内置录音：联网时使用有道词典美式读音，离线时改用浏览器朗读。', toggle('online-audio', st.onlineAudio, '导入词使用在线读音'))}
      </section>
      <section class="card settings-card"><h2>听力 · 9988 方法</h2>
        ${row('词汇复习大循环表', '书中的三张表：60 天、30 天（每天两个答案词单元）、15 天考前突击（只背答案词）。替换词 B1–B51 已齐全，按书中单元编号排进每天。', sel('plan-days', [[30, '30 天大循环'], [60, '60 天大循环'], [15, '15 天突击（只背答案词）'], [0, '不跟计划，自由学习']], st.plan.days, '大循环表'))}
        ${st.plan.days ? row('大循环开始日期', '今天是第几天由这个日期决定。改到更早的日期可以补上进度。', `<input id="plan-start" type="date" value="${esc(st.plan.start || C.day())}" aria-label="大循环开始日期">`) : ''}
        ${row('反应慢算难点词汇', '书中要求：听到答案词后不能马上动笔，说明还没掌握。从出题开始计时，超过设定时间才开始写，就记为难点词汇。', sel('slow-ms', [[3000, '3 秒'], [5000, '5 秒'], [8000, '8 秒'], [0, '不计反应时间']], st.slowMs, '反应慢阈值'))}
        ${row('记忆时跟写一遍', '听力记忆阶段要求照着拼一遍才能进入下一个词（书中：用手指或笔反复拼写）。', toggle('copy-typing', st.copyTyping, '记忆时跟写'))}
        ${row('英式 / 美式拼写都算对', '雅思听力两种拼写都接受，例如 colour / color、centre / center、organise / organize。本书采用英式拼写。', toggle('accept-variants', st.acceptVariants, '英美拼写都算对'))}
      </section>
      <section class="card settings-card"><h2>外观</h2>
        ${row('主题', '跟随系统，或固定浅色 / 深色。', sel('theme', [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']], st.theme, '主题'))}
      </section>
      <section class="card settings-card"><h2>备份</h2>
        ${row('进度备份', '包含阅读、听力进度和生词本。更换设备或清理浏览器前，请先导出。', `<div class="actions">${btn('导出进度', 'export', '', 'secondary')}${btn('导入进度', 'import-progress', '', 'secondary')}<input type="file" id="import-file" accept="application/json,.json" hidden></div>`)}
        ${row('重新开始', '清除本浏览器的学习记录和生词本。建议先导出备份。', btn('清空学习记录', 'reset', '', 'danger'))}
      </section>
      <details class="about card"><summary>词表与学习方式说明</summary>
        <p>阅读部分完整保留原表 30 个 list、3,000 个词的分组与顺序。每 10 词先记忆、再测试，10 组都通过后开放整组检测。中文释义以 <a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noopener">ECDICT 开源英汉词典</a>为基础并整理补充，是常见义，阅读文章里的具体含义仍需结合上下文。</p>
        <p>听力部分考两件事：听读音写出拼写，再选择中文意思。两项都对才算记住；拼错会单独记录「拼写错」次数，方便在错词本里专门练。</p>
        <p>导入的生词会先进入生词本，按「每组穿插」设置混进每天 list 的小组里学，学过后跟着那个 list 一起做整组检测和间隔复习。导入时如果某个词已经在词表里并且学过，会被当作一次遗忘，立即安排复习。</p>
        <p>复习使用基于 <a href="https://super-memory.com/english/ol/sm2.htm" target="_blank" rel="noopener">SM-2</a> 的自适应间隔：新词首次答对后 1 天复习，跨日到期再答对后间隔 6 天，之后按难度延长（例如 15 天、38 天）。答错立即重新记忆并重测。另有约 20 分钟后的短延迟检查；跨日到期且距最近看过释义至少 8 小时的成功回想，才计入「跨日回想成功」。这些是软件的练习默认值，不是每个人固定的遗忘节点。</p>
        <p>内置读音为 Emma 自然美式神经语音合成，并非真人录音；音标沿用词库，可能与美式读音存在英美差异。</p>
      </details>`);
  }

  // ---- Render & actions ---------------------------------------------------------------------
  const PAGES = {home, lists: listsPage, detail, study, review: reviewPage, mistakes: mistakesPage, import: importPage, settings};
  function applyTheme() { const t = state.settings.theme; if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; }
  function render() {
    memo = null;
    (PAGES[ui.page] || home)();
    afterRender();
  }
  function afterRender() {
    if (ui.page !== 'study') return;
    const s = state.session; if (!s || !['learn', 'quiz'].includes(s.phase)) return;
    const input = document.getElementById('spell-input') || document.getElementById('copy-input');
    if (input && document.activeElement !== input) { input.focus({preventScroll: true}); const n = input.value.length; input.setSelectionRange(n, n); }
    const key = `${ui.serial}:${s.phase}:${s.round}:${s.index}`;
    if (key === ui.autoKey) return;
    ui.autoKey = key;
    // Loading and reading a long phone number must not count as hesitation.
    // Dictation timing starts after the first successful playback ends.
    ui.qShown = s.track === 'listening' && s.phase === 'quiz' ? null : Date.now(); ui.firstKey = null;
    if (s.mode === 'pairs') { if (s.phase === 'learn' && state.settings.autoplay.listening) speakPair(s.ids[s.index], true); return; }
    if (state.settings.autoplay[s.track] && s.selected === null && (s.phase === 'learn' || s.track === 'reading' || s.spellOk === null)) speak(s.ids[s.index], {auto: true});
  }
  function go(page, extra = {}) {
    recordVisible(); stopAudio();
    ui.page = page; ui.search = ''; ui.revealed = new Set();
    Object.assign(ui, extra);
    persist(); render(); window.scrollTo(0, 0);
  }
  // Seeing a meaning restarts the short-delay check (core.see). Only count
  // what was actually on screen.
  function recordVisible() {
    const s = state.session;
    if (ui.page === 'study' && s) {
      const cur = s.ids[s.index];
      if (s.phase === 'learn' && (s.revealed || s.track === 'listening')) C.see(state, cur);
      if (s.phase === 'quiz' && s.selected !== null) C.see(state, cur);
      if (s.phase === 'repair') s.wrongIds.forEach(id => C.see(state, id));
    }
    if (ui.page === 'mistakes') ui.revealed.forEach(id => { if (getWord(id)) C.see(state, id); });
    if (ui.page === 'detail' && document.querySelector('.vocab-preview[open]')) listByKey.get(ui.list)?.words.forEach(w => { if (C.learned(state, w.id)) C.see(state, w.id); });
  }
  function launch(session) {
    const start = () => { stopAudio(); state.session = session; ui.draft = ''; ui.serial++; ui.autoKey = ''; if (state.settings.track !== session.track) state.settings.track = session.track; persist(); ui.page = 'study'; render(); window.scrollTo(0, 0); };
    const s = state.session;
    if (s && s.phase !== 'done') modal('开始新的学习？', `「${sessionTitle(s)}」还没有完成。已做过的词汇记录会保留，但这一轮将重新开始。`, '开始新的学习', start);
    else start();
  }
  // Imported words are spread through the group rather than appended at the end.
  function interleave(ids, extra) {
    if (!extra.length) return ids;
    const out = [...ids], step = (ids.length + 1) / (extra.length + 1);
    extra.forEach((id, i) => out.splice(Math.round(step * (i + 1)) + i, 0, id));
    return out;
  }
  // Sessions hold one kind of item: dictation words, or replacement pairs.
  const withMode = (session, ids) => { if (ids.length && isPair(getWord(ids[0]))) session.mode = 'pairs'; return session; };
  function startGroup(key, g) {
    const l = listByKey.get(key); if (!l) return;
    const ids = groupWords(l, g).map(w => w.id);
    const mixIds = pairList(l) ? [] : C.pendingMix(state, l.track, state.settings.mix[l.track]).filter(id => !ids.includes(id) && getWord(id));
    launch(withMode(C.makeSession('group', l.track, l.key, g, interleave(ids, mixIds), 'learn', mixIds), ids));
  }
  function startFinal(key) {
    const l = listByKey.get(key); if (!l || listProgress(l).passed < l.groups) return;
    const ids = [...l.words.map(w => w.id), ...mixedInto(l.key)];
    launch(withMode(C.makeSession('final', l.track, l.key, 0, ids, 'quiz'), ids));
  }
  function startInbox() {
    const t = track(), ids = C.pendingMix(state, t, 10).filter(id => getWord(id));
    if (!ids.length) { notify('生词本里没有待学的词。'); return; }
    launch(C.makeSession('inbox', t, null, 0, ids, 'learn', ids));
  }
  // 难点词汇 from earlier days: follow-read again, then re-test (the book's step 6).
  function startHard(mode) {
    const d = derived(track()), words = d.hardPrev.filter(w => mode === 'pairs' ? isPair(w) : mode === 'words' ? !isPair(w) : true);
    const dict = words.filter(w => !isPair(w)), pairs = words.filter(isPair), pick = (dict.length ? dict : pairs).slice(0, 30).map(w => w.id);
    if (!pick.length) { notify('没有待复习的难点词汇。'); return; }
    launch(withMode(C.makeSession('hard', track(), null, 0, pick, 'learn'), pick));
  }
  function startReview(kind, words, phase) {
    const pairs = words.filter(isPair), dict = words.filter(w => !isPair(w));
    const chosen = kind === 'pairs' ? pairs : kind === 'words' ? dict : dict.length ? dict : pairs;
    const ids = chosen.slice(0, 20).map(w => w.id);
    if (ids.length) launch(withMode(C.makeSession(phase === 'quiz' ? 'review' : 'mistakes', track(), null, 0, ids, phase), ids));
  }
  function learnNext() {
    const s = state.session; if (!s || s.phase !== 'learn') return;
    stopAudio(); C.see(state, s.ids[s.index]); ui.draft = '';
    if (s.index + 1 < s.ids.length) { s.index++; s.revealed = false; s.copied = false; }
    else {
      // Mix in up to three earlier items of the same kind for the group quiz.
      const same = derived(s.track).words.filter(w => isPair(w) === (s.mode === 'pairs') && (s.mode === 'pairs' || w.meaning)).map(w => w.id);
      C.beginQuiz(s, s.kind === 'group' && s.round === 0 ? C.pickOld(state, same, s.allIds, 3) : []);
    }
    persist(); render();
  }
  function submitSpelling() {
    const s = state.session, input = document.getElementById('spell-input');
    if (!s || !input || s.spellOk !== null) return;
    const typed = input.value.trim();
    if (!typed) { input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake'); return; }
    const w = getWord(s.ids[s.index]), check = spellingOk(typed, w);
    // 9988 method: not starting to write promptly after hearing it = 难点词汇.
    const limit = state.settings.slowMs, slow = !!limit && ui.qShown != null && ((ui.firstKey ?? Date.now()) - ui.qShown) > limit;
    C.spell(state, typed, check.ok, {slow, final: !w.meaning}); ui.draft = '';
    persist(); render();
  }
  function updateCopy(input) {
    const s = state.session; if (!s) return;
    const w = getWord(s.ids[s.index]), ok = C.normSpelling(input.value) === C.normSpelling(w.word);
    ui.draft = input.value;
    if (ok !== s.copied) { s.copied = ok; input.closest('.spell-field')?.classList.toggle('ok', ok); const next = document.getElementById('learn-next'); if (next) next.disabled = !ok; }
  }

  app.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    e.preventDefault();
    const a = el.dataset.action, id = el.dataset.id, s = state.session;
    if (['study', 'detail', 'mistakes'].includes(ui.page) && !['speak', 'speak-slow'].includes(a)) recordVisible();
    switch (a) {
      case 'speak': speak(id, {side: el.dataset.side || null}); return;
      case 'speak-slow': speak(id, {slow: true}); return;
      case 'nav': go(el.dataset.page); return;
      case 'track': {
        const k = el.dataset.track; if (!TRACK[k] || k === track()) return;
        state.settings.track = k; if (!ui.imp.rows) ui.imp.target = null;
        go(['study', 'detail'].includes(ui.page) ? 'home' : ui.page); return;
      }
      case 'open-list': go('detail', {list: el.dataset.list}); return;
      case 'group': startGroup(el.dataset.list, Number(el.dataset.group)); return;
      case 'final': startFinal(el.dataset.list); return;
      case 'inbox': startInbox(); return;
      case 'review-start': startReview(el.dataset.kind, C.reviewQueue(state, derived(track()).due), 'quiz'); return;
      case 'mistakes-start': {
        const d = derived(track()), all = C.reviewQueue(state, d.mistakes);
        const weak = all.filter(w => (d.info.get(w.id)?.repetitions || 0) < 2);
        startReview(el.dataset.kind, [...weak, ...all.filter(w => !weak.includes(w))], 'learn');
        return;
      }
      case 'resume': if (s) { state.settings.track = s.track; ui.serial++; go('study'); } return;
      case 'pause': go('home'); return;
      case 'reveal': if (s?.phase === 'learn') { s.revealed = true; C.see(state, s.ids[s.index]); persist(); render(); } return;
      case 'learn-next': if (s?.phase === 'learn' && (s.mode === 'pairs' || (s.track === 'listening' ? (s.copied || !state.settings.copyTyping) : s.revealed))) learnNext(); return;
      case 'speak-pair': speakPair(id); return;
      case 'board': boardPick(el.dataset.col, id); return;
      case 'plan-start': {
        const days = Number(el.dataset.days);
        if (!C.PLAN_DAYS.includes(days)) return;
        state.settings.plan = {days, start: days ? C.day() : null}; persist(); render();
        notify(days ? `已开始 ${days} 天大循环表，今天是第 1 天。` : '已改为自由学习，不跟大循环表。'); return;
      }
      case 'hard-start': startHard(el.dataset.mode); return;
      case 'skip-copy': if (s?.phase === 'learn') learnNext(); return;
      case 'recall': if (s?.phase === 'quiz' && s.selected === null) { s.recalled = true; persist(); render(); } return;
      case 'answer': if ((s?.recalled || s?.track === 'listening') && C.submit(state, id, s.guessed === true)) { C.see(state, s.ids[s.index]); persist(); render(); } return;
      case 'unknown': case 'give-up': if (C.giveUp(state)) { C.see(state, s.ids[s.index]); ui.draft = ''; persist(); render(); } return;
      case 'quiz-next': if (C.nextQuestion(state)) { stopAudio(); ui.draft = ''; if (state.session.phase === 'repair') state.session.wrongIds.forEach(x => C.see(state, x)); persist(); render(); window.scrollTo(0, 0); } return;
      case 'retry': if (s?.phase === 'repair') { C.retry(s); persist(); render(); window.scrollTo(0, 0); } return;
      case 'finish-session': case 'finish-review': {
        if (s?.phase !== 'done') return;
        const page = a === 'finish-review' ? 'review' : s.kind === 'group' ? 'detail' : s.kind === 'inbox' ? 'import' : 'home';
        const list = s.listId || ui.list;
        state.session = null; go(page, {list}); return;
      }
      case 'reveal-row': ui.revealed.add(id); C.see(state, id); persist(); render(); return;
      case 'reveal-all': document.querySelectorAll('[data-action="reveal-row"]').forEach(b => { ui.revealed.add(b.dataset.id); C.see(state, b.dataset.id); }); persist(); render(); return;
      case 'mistake-filter': ui.mistakeFilter = el.dataset.filter; render(); return;
      case 'imp-target': {
        ui.imp.target = el.dataset.target;
        if (ui.imp.rows) ui.imp.rows.forEach(r => { delete r.bookId; if (r.auto) { r.meaning = ''; r.auto = false; } classify(r, ui.imp.target); });
        render(); return;
      }
      case 'imp-paste-toggle': ui.imp.paste = !ui.imp.paste; render(); if (ui.imp.paste) document.getElementById('imp-text')?.focus(); return;
      case 'imp-parse-paste': parsePasted(); return;
      case 'imp-clear': ui.imp.rows = null; ui.imp.error = ''; render(); return;
      case 'imp-check-all': case 'imp-uncheck-all': ui.imp.rows?.forEach(r => { if (r.status !== 'dup' && (r.bookId || r.meaning.trim())) r.checked = a === 'imp-check-all'; }); render(); return;
      case 'imp-split': {
        const i = Number(el.dataset.row), r = ui.imp.rows?.[i]; if (!r) return;
        const parts = r.word.split(/\s+/).filter(Boolean).map(word => classify({word, meaning: '', pos: '', note: '', phonetic: '', noise: false, auto: false}, impTarget()));
        ui.imp.rows.splice(i, 1, ...parts); render(); return;
      }
      case 'imp-commit': commitImport(); return;
      case 'imp-remove': {
        const t = impTarget(), w = getWord(id); if (!w) return;
        modal(`从生词本移除「${w.word}」？`, w.custom ? '会同时删除这个生词的学习记录。' : '它仍保留在原词表里，只是不再算作导入的生词。', '移除', () => {
          if (C.removeImport(state, t, id)) { persist(); render(); notify('已移除。'); }
          else notify('这个词在当前未完成的学习里，请先完成或重新开始那一轮。');
        }, true);
        return;
      }
      case 'export': {
        const blob = new Blob([JSON.stringify({app: 'reading30', version: C.VERSION, exportedAt: new Date().toISOString(), state}, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = '词序学习进度-' + C.day() + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify('备份文件已导出。'); return;
      }
      case 'import-progress': document.getElementById('import-file').click(); return;
      case 'reset': modal('清空学习记录？', '会清除当前浏览器的阅读、听力进度和生词本。已经导出的备份不受影响。', '确认清空', () => { stopAudio(); loadError = ''; const keep = state.settings; state = C.fresh(); state.settings = keep; persist(); go('home'); notify('已开始新的学习计划。'); }, true); return;
    }
  });
  app.addEventListener('submit', e => { if (e.target.dataset.form === 'spell') { e.preventDefault(); submitSpelling(); } });
  app.addEventListener('change', async e => {
    const el = e.target, st = state.settings;
    if (el.id === 'guessed' && state.session?.phase === 'quiz' && state.session.selected === null) { state.session.guessed = el.checked; persist(); return; }
    if (el.id === 'start-date') { if (C.validDay(el.value)) { state.startDate = el.value; persist(); render(); } return; }
    if (el.id === 'plan-days') { const days = Number(el.value); if (C.PLAN_DAYS.includes(days)) { st.plan = {days, start: days ? st.plan.start || C.day() : null}; persist(); render(); } return; }
    if (el.id === 'plan-start') { if (C.validDay(el.value) && el.value <= C.day()) { st.plan.start = el.value; persist(); render(); } return; }
    if (el.id === 'slow-ms') { const ms = Number(el.value); if (C.SLOW_MS.includes(ms)) { st.slowMs = ms; persist(); } return; }
    if (el.id === 'rate') { const r = Number(el.value); if (C.RATES.includes(r)) { st.rate = r; persist(); notify('读音速度已更新。'); } return; }
    if (el.id === 'theme') { st.theme = el.value; applyTheme(); persist(); return; }
    if (el.id === 'mix-reading' || el.id === 'mix-listening') { const n = Number(el.value); if (C.MIX_COUNTS.includes(n)) { st.mix[el.id.slice(4)] = n; persist(); notify(n ? `每组会穿插 ${n} 个生词。` : '已关闭生词穿插。'); } return; }
    const toggles = {'autoplay-reading': v => st.autoplay.reading = v, 'autoplay-listening': v => st.autoplay.listening = v, 'online-audio': v => st.onlineAudio = v, 'copy-typing': v => st.copyTyping = v, 'accept-variants': v => st.acceptVariants = v};
    if (toggles[el.id]) { toggles[el.id](el.checked); persist(); return; }
    if (el.id === 'imp-file') { const file = el.files[0]; el.value = ''; handleImportFile(file); return; }
    if (el.dataset.impCheck !== undefined) { const r = ui.imp.rows?.[Number(el.dataset.impCheck)]; if (r) { r.checked = el.checked; el.closest('.imp-row')?.classList.toggle('off', !el.checked); const n = ui.imp.rows.filter(x => x.checked).length; const b = app.querySelector('[data-action="imp-commit"]'); if (b) { b.disabled = !n; b.innerHTML = `导入 ${n} 个词 ${icon('arrow')}`; } } return; }
    if (el.dataset.impWord !== undefined) { const r = ui.imp.rows?.[Number(el.dataset.impWord)]; if (r && el.value.trim()) { r.word = el.value.trim(); if (r.auto) { r.meaning = ''; r.auto = false; } r.note = ''; r.phonetic = ''; r.noise = false; classify(r, impTarget()); render(); } return; }
    if (el.dataset.impMeaning !== undefined) { const r = ui.imp.rows?.[Number(el.dataset.impMeaning)]; if (r) { r.meaning = el.value.trim(); r.auto = false; if (r.status === 'missing' && r.meaning) { r.status = 'new'; r.checked = true; } else if (r.status === 'new' && !r.meaning) { r.status = 'missing'; r.checked = false; } render(); } return; }
    if (el.id === 'import-file') {
      const file = el.files[0]; el.value = ''; if (!file) return;
      if (file.size > 20 * 1024 * 1024) { notify('备份文件过大，请选择词序导出的 JSON 文件。'); return; }
      try {
        const data = JSON.parse(await file.text());
        if (data.app !== 'reading30') throw new Error('请选择词序导出的进度文件。');
        const restored = C.validate(data.state, catalog);
        modal('导入这份学习进度？', '导入会替换当前浏览器的进度和生词本。建议先导出当前进度作为备份。', '确认导入', () => { stopAudio(); loadError = ''; state = restored; applyTheme(); persist(); go('home'); notify('进度已恢复。'); });
      } catch (err) { notify(err.message || '无法读取这份备份。'); }
    }
  });
  app.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'search') {
      ui.search = el.value;
      const t = track(), d = derived(t);
      if (ui.page === 'review') { const list = C.reviewQueue(state, d.due); document.getElementById('collection-rows').innerHTML = collectionRows(filterWords(list), list.length, 'review'); }
      else { const all = C.reviewQueue(state, d.mistakes), shown = ui.mistakeFilter === 'weak' ? all.filter(w => (d.info.get(w.id)?.repetitions || 0) < 2) : all; document.getElementById('collection-rows').innerHTML = collectionRows(filterWords(shown), shown.length, 'mistakes'); }
      return;
    }
    if (el.id === 'nb-search') { ui.imp.filter = el.value; const html = notebook(impTarget()); const tmp = document.createElement('div'); tmp.innerHTML = html; const rows = tmp.querySelector('#nb-rows'); if (rows) document.getElementById('nb-rows').replaceWith(rows); return; }
    if (el.id === 'spell-input') { ui.draft = el.value; if (ui.firstKey == null && el.value) ui.firstKey = Date.now(); return; }
    if (el.id === 'copy-input') { updateCopy(el); return; }
  });
  app.addEventListener('toggle', e => { if (e.target.matches?.('.vocab-preview') && e.target.open) { listByKey.get(ui.list)?.words.forEach(w => { if (C.learned(state, w.id)) C.see(state, w.id); }); persist(); } }, true);
  // Drag a PDF anywhere onto the import page. Elsewhere, a dropped file must
  // not make the browser navigate away from the app.
  ['dragenter', 'dragover'].forEach(type => document.addEventListener(type, e => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); if (ui.page === 'import' && !ui.imp.busy) document.querySelector('.dropzone')?.classList.add('drag'); }));
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.querySelector('.dropzone')?.classList.remove('drag'); });
  document.addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); document.querySelector('.dropzone')?.classList.remove('drag');
    if (ui.page === 'import' && !ui.imp.busy) handleImportFile(e.dataTransfer.files[0]); else notify('请在「导入生词」页面拖入 PDF。');
  });

  document.addEventListener('keydown', e => {
    if (document.querySelector('.modal-backdrop') || ui.page !== 'study') return;
    const s = state.session; if (!s || !['learn', 'quiz'].includes(s.phase)) return;
    const active = document.activeElement, cur = s.ids[s.index];
    if (active?.id === 'spell-input' || active?.id === 'copy-input') {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (e.shiftKey) { speak(cur); return; }
      if (active.id === 'spell-input') submitSpelling();
      else if (s.copied) learnNext();
      else { active.classList.remove('shake'); void active.offsetWidth; active.classList.add('shake'); }
      return;
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(active?.tagName) && active.type !== 'checkbox') return;
    if (e.code === 'Space' && active?.tagName !== 'BUTTON') { e.preventDefault(); speak(cur); return; }
    if (e.key === 'Enter' && active?.tagName !== 'BUTTON') {
      e.preventDefault();
      if (e.shiftKey) { speak(cur); return; }
      const action = s.phase === 'learn' ? (s.track === 'reading' && !s.revealed ? 'reveal' : 'learn-next') : s.selected !== null ? 'quiz-next' : s.track === 'reading' && !s.recalled ? 'recall' : null;
      if (action) app.querySelector(`[data-action="${action}"]`)?.click();
      return;
    }
    const optionsOpen = s.phase === 'quiz' && s.selected === null && (s.track === 'reading' ? s.recalled : s.spellOk !== null);
    if (/^[1-4]$/.test(e.key) && optionsOpen) app.querySelectorAll('[data-action="answer"]')[Number(e.key) - 1]?.click();
  });
  window.addEventListener('pagehide', () => { recordVisible(); persist(); stopAudio(); });
  setInterval(() => { if (!document.hidden && ['home', 'review'].includes(ui.page) && !['search', 'nb-search'].includes(document.activeElement?.id) && !document.querySelector('.modal-backdrop')) render(); }, 30000);
  window.addEventListener('storage', e => {
    if (e.key !== KEY || !e.newValue) return;
    try { state = C.validate(JSON.parse(e.newValue), catalog); stopAudio(); applyTheme(); render(); notify('已同步同一浏览器另一个窗口的进度。'); } catch (err) { /* keep current state */ }
  });
  applyTheme();
  persist();
  render();
})();
