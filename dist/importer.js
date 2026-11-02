(function (root) {
  'use strict';
  // Turns a learner's word list (PDF or pasted text) into {word, meaning} rows.
  // Typical inputs: "1. abandon /ə'bændən/ v. 放弃；抛弃", "abandon 放弃",
  // two-column tables, or one English word per line without Chinese.
  const CJK = /[㐀-鿿]/;
  const POS = /^(?:n|v|vt|vi|adj|adv|a|ad|prep|conj|pron|num|int|interj|art|aux|abbr|pl|phr)\.$/i;
  const HEADER = /^(?:list|unit|test|passage|section|part|chapter|page|lesson|day|week|cambridge|ielts|reading|listening|vocabulary|vocab|words?|total|name|date|score|no|new|module|task|book)$/i;
  const IPA = /[ˈˌːəɪʊʌæɒɔɜθðʃʒŋɑɛәɚɝ':]/;

  function cleanLine(raw) {
    return String(raw).normalize('NFKC')
      .replace(/[​-‍﻿]/g, '').replace(/[  - 　]/g, ' ')
      .replace(/[’‘`´]/g, "'").replace(/[‐‑‒–—―]/g, '-')
      // Phonetic transcriptions: /ə'bændən/ or [ə'bændən].
      .replace(/\s*[\/\[]([^\/\[\]㐀-鿿]{1,40})[\/\]]\s*/g, (m, inner) => IPA.test(inner) ? ' ' : m)
      // List markers: "12.", "12)", "12、", "(12)", bullets.
      .replace(/^\s*(?:\(?\d{1,4}[.)、:]?|[•·▪●■◆◇○*>-])\s+/, '')
      .replace(/^\s*\d{1,4}[.)、](?=[A-Za-z])/, '')
      .trim();
  }
  function cleanMeaning(s) {
    return s.replace(/^[\s,，;；:：.。、|/=-]+|[\s,，;；:：、|/=-]+$/g, '')
      .replace(/\s*[;；]\s*/g, '；').replace(/\s*[,，]\s*/g, '，').replace(/\s+/g, ' ').trim();
  }
  function cleanWord(s) { return s.replace(/^[-'.]+|[-'.]+$/g, '').replace(/\s+/g, ' ').trim(); }

  // Latin fragments that belong inside a Chinese meaning ("给sb.某物").
  const MEANING_TOKEN = /^(?:sb|sth|sb\.|sth\.|etc\.?|e\.g\.?|i\.e\.?|one's|oneself|someone|something)$/i;

  // Split one cleaned line into entries. Latin runs become words (with any
  // trailing part-of-speech tags peeled off); CJK runs become their meaning.
  function splitLine(line) {
    const entries = [], runs = line.match(/[A-Za-z][A-Za-z'\-.]*(?: [A-Za-z][A-Za-z'\-.]*)*|[^A-Za-z]+/g) || [];
    let cur = null, leading = '', synonym = false;
    for (const run of runs) {
      if (/^[A-Za-z]/.test(run)) {
        // "abandon = give up": the right-hand side is a note, not a new word.
        if (synonym && cur) { cur.note = [cur.note, run.trim()].filter(Boolean).join(', '); synonym = false; continue; }
        if (cur && cur.meaning && run.split(' ').every(t => MEANING_TOKEN.test(t))) { cur.meaning += run; continue; }
        const parts = run.split(' '), pos = [];
        while (parts.length && POS.test(parts[parts.length - 1]) && (parts.length > 1 || cur)) pos.unshift(parts.pop());
        if (!parts.length) { if (cur) { cur.pos = [cur.pos, ...pos].filter(Boolean).join(' '); if (cur.meaning) cur.meaning += '；'; } continue; }
        // Long Latin runs are example sentences, not vocabulary.
        if (parts.length > 5) { cur = null; continue; }
        cur = {word: cleanWord(parts.join(' ')), meaning: '', pos: pos.join(' '), note: ''};
        if (cur.word.length > 1 || /^[aI]$/.test(cur.word)) entries.push(cur); else cur = null;
      } else {
        synonym = /[=≈]/.test(run) && !CJK.test(run);
        if (CJK.test(run)) { if (cur) cur.meaning += run; else leading += run; }
      }
    }
    // "放弃 abandon": a Chinese-first line with a single word.
    if (leading && entries.length === 1 && !entries[0].meaning) entries[0].meaning = leading;
    for (const e of entries) e.meaning = cleanMeaning(e.meaning);
    return {entries, cjkOnly: !entries.length && CJK.test(line)};
  }

  function parseText(text) {
    const out = [];
    let last = null;
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = cleanLine(rawLine);
      if (!line || /^(?:第\s*\d+\s*[页頁]|page\s*\d+(?:\s*of\s*\d+)?|\d+\s*\/\s*\d+|-?\s*\d+\s*-?)$/i.test(line)) continue;
      const {entries, cjkOnly} = splitLine(line);
      // A Chinese-only line continues the previous word's meaning.
      if (cjkOnly) { if (last && last.meaning.length < 60) last.meaning = cleanMeaning(last.meaning + (last.meaning ? '；' : '') + line); continue; }
      const titleLike = entries.length <= 3 && (/\d/.test(rawLine) || /第.+[页章篇课天]/.test(rawLine));
      for (const e of entries) {
        e.noise = titleLike && e.word.split(' ').every(t => HEADER.test(t) || /^\d+$/.test(t));
        e.line = line.slice(0, 160);
        out.push(e);
      }
      if (entries.length) last = entries[entries.length - 1];
    }
    // One row per word; keep the first meaning that was supplied.
    const seen = new Map();
    for (const e of out) {
      const key = e.word.toLowerCase();
      const prev = seen.get(key);
      if (!prev) { seen.set(key, e); continue; }
      if (!prev.meaning && e.meaning) prev.meaning = e.meaning;
      if (e.note && !prev.note) prev.note = e.note;
      prev.noise = prev.noise && e.noise;
    }
    return [...seen.values()];
  }

  // ---- Dictionary ---------------------------------------------------------------
  let dictionary = null;
  function useDictionary(raw) {
    const words = new Map(), forms = new Map();
    for (const line of raw.words.split('\n')) { const [w, p, m] = line.split('\t'); words.set(w.toLowerCase(), {head: w, phonetic: p || '', meaning: m || ''}); }
    for (const line of raw.forms.split('\n')) { const [f, l] = line.split('\t'); forms.set(f, l); }
    dictionary = {words, forms};
    return dictionary;
  }
  function variants(w) {
    const out = [w.replace(/-/g, ''), w.replace(/-/g, ' '), w.replace(/is(e|ed|es|ing|ation)$/, 'iz$1')];
    if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
    if (w.endsWith('es')) out.push(w.slice(0, -2));
    if (w.endsWith('s')) out.push(w.slice(0, -1));
    if (w.endsWith('ied')) out.push(w.slice(0, -3) + 'y');
    if (w.endsWith('ed')) { out.push(w.slice(0, -1), w.slice(0, -2)); if (w.length > 4 && w.at(-3) === w.at(-4)) out.push(w.slice(0, -3)); }
    if (w.endsWith('ing')) { out.push(w.slice(0, -3), w.slice(0, -3) + 'e'); if (w.length > 5 && w.at(-4) === w.at(-5)) out.push(w.slice(0, -4)); }
    if (w.endsWith('ily')) out.push(w.slice(0, -3) + 'y');
    if (w.endsWith('ly')) out.push(w.slice(0, -2));
    return out;
  }
  // -> {head, meaning, phonetic, via: 'exact'|'form'|'rule'} or null
  function lookup(word) {
    if (!dictionary) return null;
    const key = word.toLowerCase().trim(), {words, forms} = dictionary;
    if (words.has(key)) return {...words.get(key), via: 'exact'};
    const lemma = forms.get(key);
    if (lemma && words.has(lemma)) return {...words.get(lemma), via: 'form'};
    for (const v of variants(key)) if (v !== key && words.has(v)) return {...words.get(v), via: 'rule'};
    return null;
  }

  // ---- Loading --------------------------------------------------------------------
  const loaded = new Map();
  function loadScript(src) {
    if (!loaded.has(src)) loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); s.remove(); reject(new Error('无法加载 ' + src.split('?')[0] + '，请确认解压完整。')); };
      document.head.append(s);
    }));
    return loaded.get(src);
  }
  async function loadDictionary(version = '') {
    if (dictionary) return dictionary;
    await loadScript('dict.js' + (version ? '?v=' + version : ''));
    return useDictionary(root.CIXU_DICT);
  }
  async function loadPdf() {
    const base = 'vendor/pdfjs/';
    // Opened from disk (file://) a Worker cannot load; running the worker
    // script on the main thread is slower but works everywhere.
    if (location.protocol === 'file:') await loadScript(base + 'pdf.worker.min.js');
    await loadScript(base + 'pdf.min.js');
    const lib = root.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
    return lib;
  }

  // Rebuild reading-order lines from positioned text items. Large horizontal
  // gaps become tabs so table columns stay separate.
  function itemsToLines(items) {
    const rows = [];
    const parts = items.filter(it => it.str && it.str.trim()).map(it => ({str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10}))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    for (const p of parts) {
      const row = rows.find(r => Math.abs(r.y - p.y) < Math.max(2, Math.min(r.h, p.h) * 0.5));
      if (row) row.items.push(p); else rows.push({y: p.y, h: p.h, items: [p]});
    }
    return rows.sort((a, b) => b.y - a.y).map(r => {
      const its = r.items.sort((a, b) => a.x - b.x);
      let line = '';
      its.forEach((it, i) => {
        if (i) {
          const prev = its[i - 1], gap = it.x - (prev.x + prev.w);
          line += gap > r.h * 1.6 ? '\t' : gap > r.h * 0.18 && !/\s$/.test(line) && !/^\s/.test(it.str) ? ' ' : '';
        }
        line += it.str;
      });
      return line;
    });
  }
  async function readPdf(data, onProgress = () => {}) {
    const lib = await loadPdf();
    // Only text is needed: skip font loading (useSystemFonts avoids fetching
    // standard-font data that text extraction never uses).
    const doc = await lib.getDocument({data, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true, isEvalSupported: false, disableFontFace: true, useSystemFonts: true}).promise;
    const lines = [], pages = doc.numPages;
    let chars = 0;
    for (let p = 1; p <= pages; p++) {
      onProgress(p, pages);
      const page = await doc.getPage(p);
      const text = await page.getTextContent();
      const pageLines = itemsToLines(text.items);
      chars += pageLines.join('').replace(/\s/g, '').length;
      lines.push(...pageLines);
      page.cleanup();
    }
    await doc.destroy();
    return {lines, pages, chars};
  }

  const api = {cleanLine, splitLine, parseText, useDictionary, lookup, loadDictionary, loadPdf, readPdf, itemsToLines, loadScript};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WordImporter = api;
})(typeof window !== 'undefined' ? window : globalThis);
