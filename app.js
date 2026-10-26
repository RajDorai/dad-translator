'use strict';
/* Appa Translator v2 — English / Tamil / Malay. Static, no server, no built-in keys. */

const LANGS = {
  en: { name: 'English', label: 'English',     speech: ['en-MY', 'en-US'], tts: ['en-GB', 'en-US', 'en'], ocr: 'eng' },
  ta: { name: 'Tamil',   label: 'தமிழ் Tamil', speech: ['ta-IN', 'ta-MY'], tts: ['ta-IN', 'ta-MY', 'ta'], ocr: 'tam+eng' },
  ms: { name: 'Malay',   label: 'Melayu',      speech: ['ms-MY'],          tts: ['ms-MY', 'id-ID', 'ms'], ocr: 'msa+eng' },
};
const LS = { hist: 'dt.history', gloss: 'dt.glossary', pair: 'dt.pair', email: 'dt.email', size: 'dt.size',
             usage: 'dt.usage', modes: 'dt.modes', engine: 'dt.engine', keys: 'dt.engineKeys' };
const $ = (id) => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const status = (msg, ok) => { $('status').textContent = msg || ''; $('status').style.color = ok ? '#0a5a0a' : '#8a0000'; };
const fmt = (n) => n.toLocaleString('en-US');
class QuotaError extends Error {}

/* =====================================================================
 * TRANSLATION ENGINES — pluggable. Each: { name, maxChunk, dailyLimit?, translate(text, from, to, key) }
 * translateEngine() below is the single entry point the app uses.
 * No API keys are shipped. An optional key/proxy URL can be typed in Settings and is kept in
 * this phone's localStorage only. For a shared/public deployment, put keys behind a proxy instead.
 * ===================================================================== */
const LLM_PROMPT = (from, to) =>
  `Translate the user's text from ${LANGS[from].name} to ${LANGS[to].name}. Use simple, natural, polite ${LANGS[to].name} suitable for an elderly reader. ` +
  `Keep every placeholder like [1], [2] exactly as written and in a sensible position. Keep line breaks. Output only the translation.`;

const ENGINES = {
  mymemory: {
    name: 'MyMemory (free, no key)', maxChunk: 450, needsKey: false,
    async translate(text, from, to) {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', text);
      url.searchParams.set('langpair', `${from}|${to}`);
      const email = load(LS.email, '');
      if (email) url.searchParams.set('de', email);
      for (let attempt = 0; attempt < 2; attempt++) {
        addUsage(text.length);
        const r = await fetch(url);
        if (r.status === 429) throw new QuotaError('quota');
        if (!r.ok) throw new Error('Network error ' + r.status);
        const d = await r.json();
        const t = d.responseData && d.responseData.translatedText;
        if (d.quotaFinished || d.responseStatus == 429 || /USED ALL AVAILABLE FREE TRANSLATIONS/i.test(t || '')) throw new QuotaError(t || 'quota');
        if (d.responseStatus == 200 && t && !/^(MYMEMORY WARNING|QUERY LENGTH LIMIT)/i.test(t)) return decodeEntities(t);
      }
      throw new Error('No translation returned');
    },
  },
  // Google Cloud Translation – Basic (v2). Key: a Cloud API key restricted to the Translation API + your site URL.
  google: {
    name: 'Google Cloud Translation (key)', maxChunk: 4500, needsKey: true,
    async translate(text, from, to, key) {
      const r = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: from, target: to, format: 'text' }) });
      if (r.status === 429 || r.status === 403) throw new QuotaError('Google quota/permission error ' + r.status);
      const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || 'Google error');
      return d.data.translations[0].translatedText;
    },
  },
  // Gemini API (Google AI Studio key). gemini-3.1-flash-lite has a free tier and is cheap when paid.
  gemini: {
    name: 'Gemini AI (key)', maxChunk: 4000, needsKey: true, model: 'gemini-3.1-flash-lite',
    async translate(text, from, to, key) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: LLM_PROMPT(from, to) }] },
          contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0.2 } }) });
      if (r.status === 429) throw new QuotaError('Gemini rate limit reached');
      const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || 'Gemini error');
      return d.candidates[0].content.parts.map(p => p.text).join('').trim();
    },
  },
  // xAI Grok API (OpenAI-compatible). If the browser blocks it (CORS), call it through a small proxy and put the proxy URL as "key" = "https://your-proxy/…|KEY".
  xai: {
    name: 'Grok / xAI (key)', maxChunk: 4000, needsKey: true, model: 'grok-4.3',
    async translate(text, from, to, key) {
      let base = 'https://api.x.ai/v1'; if (key.includes('|')) [base, key] = key.split('|');
      const r = await fetch(base + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: this.model, temperature: 0.2,
          messages: [{ role: 'system', content: LLM_PROMPT(from, to) }, { role: 'user', content: text }] }) });
      if (r.status === 429) throw new QuotaError('xAI rate limit reached');
      const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || d.error || 'xAI error');
      return d.choices[0].message.content.trim();
    },
  },
};
function currentEngine() { const id = load(LS.engine, 'mymemory'); return ENGINES[id] ? id : 'mymemory'; }
async function translateEngine(text, from, to) {
  const id = currentEngine(), eng = ENGINES[id];
  const key = load(LS.keys, {})[id] || '';
  if (eng.needsKey && !key) throw new Error(`${eng.name} needs a key in Settings`);
  return eng.translate(text, from, to, key);
}
function decodeEntities(s) { const e = document.createElement('textarea'); e.innerHTML = s; return e.value; }

/* ---------------- Daily usage counter (MyMemory) ---------------- */
const today = () => new Date().toLocaleDateString('en-CA');
function usage() { const u = load(LS.usage, {}); return u.date === today() ? u : { date: today(), chars: 0, full: false }; }
function dailyLimit() { return load(LS.email, '') ? 50000 : 5000; }
function addUsage(n) { const u = usage(); u.chars += n; save(LS.usage, u); renderQuota(); }
function markQuotaFull() { const u = usage(); u.full = true; save(LS.usage, u); renderQuota(); }
function renderQuota() {
  const u = usage(), lim = dailyLimit(), mm = currentEngine() === 'mymemory';
  $('quota').hidden = !mm;
  const pct = Math.min(100, (u.chars / lim) * 100);
  $('qFill').style.width = (u.full ? 100 : pct) + '%';
  $('quota').classList.toggle('warn', pct >= 75 && !u.full);
  $('quota').classList.toggle('full', u.full || pct >= 100);
  $('qText').textContent = u.full ? `Today's free limit is used up (${fmt(u.chars)} / ${fmt(lim)} characters)`
    : `Today: ${fmt(u.chars)} / ${fmt(lim)} free characters used`;
  $('qEmailBox').hidden = !!load(LS.email, '');
}
function showQuotaBanner(detail) {
  markQuotaFull();
  const b = $('banner'); b.hidden = false;
  const hasEmail = !!load(LS.email, '');
  b.innerHTML = '';
  b.append(`⛔ Today's free translation limit is finished. / இன்றைய இலவச வரம்பு முடிந்தது. / Had percuma hari ini telah habis. ` +
    (hasEmail ? 'Please try again tomorrow (the limit resets every 24 hours).' : 'Add your email above to get 50,000 characters a day, or try again tomorrow.'));
  if (detail && detail !== 'quota') { const s = document.createElement('div'); s.style.fontWeight = 'normal'; s.style.fontSize = '.85rem'; s.textContent = detail; b.append(s); }
  if (!hasEmail) { const btn = document.createElement('button'); btn.textContent = '➕ Add email now'; btn.onclick = () => { $('qEmail').focus(); scrollTo({ top: 0, behavior: 'smooth' }); }; b.append(btn); }
  b.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function saveEmail(v) {
  v = v.trim(); if (v && !/^\S+@\S+\.\S+$/.test(v)) { status('That email does not look right.'); return; }
  save(LS.email, v); $('email').value = v; $('qEmail').value = v;
  const u = usage(); u.full = false; save(LS.usage, u); $('banner').hidden = true; renderQuota();
  if (v) status('Email saved ✓ — 50,000 characters a day.', true);
}

/* ---------------- Protection: My words + numbers/amounts/dates/references ---------------- */
const MONTHS = 'Jan(?:uary|uari)?|Feb(?:ruary|ruari)?|Mar(?:ch)?|Mac|Apr(?:il)?|May|Mei|June?|Jun|July?|Julai|Aug(?:ust)?|Ogos|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Okt(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Dis(?:ember)?';
const B = '(?<![\\p{L}\\p{N}])', E = '(?![\\p{L}\\p{N}])';
const NUM_RE = new RegExp([
  `${B}\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}${E}`,                    // 26 October 2026
  `${B}(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}${E}`,                    // October 26, 2026
  `${B}(?:RM|MYR|USD|SGD|INR|Rs\\.?|S\\$|US\\$|\\$|₹|€|£)\\s?\\d[\\d,]*(?:\\.\\d+)?${E}`, // RM 1,250.00
  `${B}\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[AaPp]\\.?[Mm]\\.?)?(?![\\p{L}\\p{N}])`,         // 14:35, 2:35 PM
  `(?<![\\p{L}\\p{N}*#])\\+?[\\p{L}\\d*#](?:[\\p{L}\\d*#\\-/.,]*[\\p{L}\\d*#%])?(?<=\\p{N}[^\\s]*|[^\\s]*\\p{N}[^\\s]*)${E}`, // any token containing a digit: 26/10/2026, 1234-5678, TXN-88341, ****5678, 1,250.00, 10%
].join('|'), 'giu');

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const SENT = (i) => '\uE000' + String.fromCharCode(0xE100 + i);
function protect(text) {
  const vals = []; // restored values, index i -> placeholder [i+1]
  const gloss = load(LS.gloss, []).slice().sort((a, b) => b.term.length - a.term.length);
  for (const g of gloss) {
    const re = new RegExp(`${B}${escRe(g.term)}${E}`, 'giu');
    text = text.replace(re, () => { vals.push(g.repl || g.term); return SENT(vals.length - 1); });
  }
  text = text.replace(NUM_RE, (m) => {
    if (!/\p{N}/u.test(m)) return m; // only tokens that really contain a digit
    vals.push(m); return SENT(vals.length - 1);
  });
  text = text.replace(/\uE000(.)/g, (m, c) => `[${c.charCodeAt(0) - 0xE100 + 1}]`);
  return { text, vals };
}
function restore(text, vals) {
  const seen = new Set();
  text = text.replace(/\[\s*(\d+)\s*\]/g, (m, n) => { const v = vals[n - 1]; if (v === undefined) return m; seen.add(n - 1); return v; });
  const missing = vals.filter((v, i) => !seen.has(i));
  return { text, missing };
}

/* ---------------- Chunking & translate ---------------- */
function chunkText(text, max) {
  const out = [];
  for (const para of text.split(/\n/)) {
    if (!para.trim()) { out.push({ text: para, skip: true }); out.push({ text: '\n', skip: true }); continue; }
    const sentences = para.match(/[^.!?。]+[.!?。]*\s*/g) || [para];
    let cur = '';
    for (let s of sentences) {
      while (s.length > max) {
        const sp = s.lastIndexOf(' ', max), cut = sp > 50 ? sp : max;
        if (cur) { out.push({ text: cur }); cur = ''; }
        out.push({ text: s.slice(0, cut) }); s = s.slice(cut);
      }
      if ((cur + s).length > max) { out.push({ text: cur }); cur = ''; }
      cur += s;
    }
    if (cur) out.push({ text: cur });
    out.push({ text: '\n', skip: true });
  }
  out.pop();
  return out;
}

/* translate(text) -> { text, missing[] } ; missing = protected items that did not come back */
async function translate(text, from, to) {
  if (from === to) return { text, missing: [] };
  const { text: prot, vals } = protect(text);
  const max = ENGINES[currentEngine()].maxChunk;
  const parts = [];
  for (const c of chunkText(prot, max)) {
    if (c.skip) { parts.push(c.text); continue; }
    if (!/[\p{L}]/u.test(c.text.replace(/\[\d+\]/g, ''))) { parts.push(c.text.trim() + ' '); continue; } // only numbers/codes: nothing to translate
    let t;
    try { t = await translateEngine(c.text, from, to); }
    catch (e) {
      if (e instanceof QuotaError || from === 'en' || to === 'en') throw e;
      t = await translateEngine(await translateEngine(c.text, from, 'en'), 'en', to); // Tamil<->Malay pivot via English
    }
    parts.push(t.trim() + ' ');
  }
  return restore(parts.join('').replace(/ \n/g, '\n').trim(), vals);
}
function splitParagraphs(text) {
  let paras = text.replace(/\r/g, '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return paras;
}

/* ---------------- Mode (Paragraph / Quick) ---------------- */
const pairKey = () => `${$('from').value}-${$('to').value}`;
function getMode() { const m = load(LS.modes, {}); return m[pairKey()] || (pairKey() === 'en-ta' ? 'para' : 'quick'); }
function setMode(m, remember) {
  if (remember) { const all = load(LS.modes, {}); all[pairKey()] = m; save(LS.modes, all); }
  const para = m === 'para';
  $('tabPara').setAttribute('aria-selected', para); $('tabQuick').setAttribute('aria-selected', !para);
  document.body.classList.toggle('mode-quick', !para);
  $('src').rows = para ? 10 : 4;
  $('src').placeholder = para ? 'Paste the full English letter / message here. Leave an empty line between paragraphs.\nஇங்கே ஒட்டவும் · Tampal di sini'
                              : 'Type here… / இங்கே எழுதுங்கள் / Taip di sini';
  $('outBox').hidden = true; $('paraBox').hidden = true; updateSrcInfo();
}
$('tabPara').onclick = () => setMode('para', true);
$('tabQuick').onclick = () => setMode('quick', true);
function updateSrcInfo() {
  const t = $('src').value.trim();
  if (!t) { $('srcInfo').textContent = ''; return; }
  const n = getMode() === 'para' ? splitParagraphs(t).length : 0;
  $('srcInfo').textContent = `${fmt(t.length)} characters` + (n ? ` · ${n} paragraph${n > 1 ? 's' : ''}` : '');
}
$('src').addEventListener('input', updateSrcInfo);

/* ---------------- Language pickers ---------------- */
function fillLangs() {
  for (const sel of [$('from'), $('to')]) for (const [k, v] of Object.entries(LANGS)) sel.add(new Option(v.label, k));
  const p = load(LS.pair, { from: 'en', to: 'ta' });
  $('from').value = p.from; $('to').value = p.to;
}
function pairChanged() { save(LS.pair, { from: $('from').value, to: $('to').value }); setMode(getMode()); updateCopyAllLabel(); }
$('from').onchange = () => { if ($('from').value === $('to').value) $('to').value = Object.keys(LANGS).find(k => k !== $('from').value); pairChanged(); };
$('to').onchange = () => { if ($('from').value === $('to').value) $('from').value = Object.keys(LANGS).find(k => k !== $('to').value); pairChanged(); };
$('swap').onclick = () => {
  const f = $('from').value; $('from').value = $('to').value; $('to').value = f;
  const wasQuick = !$('outBox').hidden && $('out').textContent, wasPara = !$('paraBox').hidden && lastParas.length;
  const newText = wasQuick ? $('out').textContent : wasPara ? lastParas.map(p => p.out).join('\n\n') : null;
  pairChanged();
  if (newText) { $('src').value = newText; updateSrcInfo(); }
};
$('clear').onclick = () => { $('src').value = ''; $('outBox').hidden = true; $('paraBox').hidden = true; status(''); updateSrcInfo(); $('src').focus(); };
$('paste').onclick = async () => {
  try { const t = await navigator.clipboard.readText(); if (!t) throw 0; $('src').value = t; updateSrcInfo(); status('Pasted ✓', true); }
  catch { $('src').focus(); status('Long-press in the box and choose Paste.'); }
};

/* ---------------- Translate button ---------------- */
let busy = false, lastParas = [];
$('go').onclick = async () => {
  if (busy) return;
  const text = $('src').value.trim();
  if (!text) { status('Please paste, type, speak or take a photo first.'); return; }
  const from = $('from').value, to = $('to').value;
  if (currentEngine() === 'mymemory') {
    const u = usage(), left = dailyLimit() - u.chars;
    if (u.full) { showQuotaBanner(); return; }
    if (text.length > left && !confirm(`This text is ${fmt(text.length)} characters but only about ${fmt(Math.max(0, left))} free characters are left today. Some paragraphs may not translate. Continue?`)) return;
  }
  busy = true; $('go').disabled = true; $('banner').hidden = true; status('');
  try {
    if (getMode() === 'para') await runParagraphs(text, from, to);
    else await runQuick(text, from, to);
  } finally { busy = false; $('go').disabled = false; $('progBox').hidden = true; }
};

async function runQuick(text, from, to) {
  $('outBox').hidden = true; status('Translating… / மொழிபெயர்க்கிறது… / Menterjemah…', true);
  try {
    const r = await translate(text, from, to);
    showResult(r.text, to);
    if (r.missing.length) status('⚠ Please check these were kept: ' + r.missing.join(', '));
    else status('');
    addHistory({ from, to, src: text, out: r.text, at: Date.now() });
  } catch (e) { handleError(e); }
}
function showResult(text, lang) {
  $('paraBox').hidden = true;
  $('out').textContent = text; $('out').lang = lang; $('outBox').hidden = false;
  $('outBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function handleError(e) {
  if (e instanceof QuotaError) { showQuotaBanner(e.message); status(''); }
  else status('Sorry: ' + e.message + ' (check internet)');
}

async function runParagraphs(text, from, to) {
  const paras = splitParagraphs(text);
  lastParas = paras.map(src => ({ src, out: '', state: 'pending', missing: [] }));
  $('outBox').hidden = true; $('paraBox').hidden = false; renderParas(to);
  $('progBox').hidden = false; $('prog').max = paras.length; $('prog').value = 0;
  let stopped = null;
  for (let i = 0; i < paras.length; i++) {
    $('progText').textContent = `Translating paragraph ${i + 1} of ${paras.length}… / பத்தி ${i + 1} / ${paras.length}`;
    if (stopped) { lastParas[i].state = 'failed'; lastParas[i].out = 'Not translated (limit reached).'; continue; }
    try {
      const r = await translate(paras[i], from, to);
      Object.assign(lastParas[i], { out: r.text, state: 'done', missing: r.missing });
    } catch (e) {
      if (e instanceof QuotaError) { stopped = e; lastParas[i].out = 'Not translated (limit reached).'; }
      else lastParas[i].out = 'Could not translate: ' + e.message;
      lastParas[i].state = 'failed';
    }
    $('prog').value = i + 1; renderParas(to);
  }
  const done = lastParas.filter(p => p.state === 'done').length;
  if (stopped) handleError(stopped);
  else status(done === paras.length ? `Done ✓ ${done} paragraph${done > 1 ? 's' : ''}` : `${done} of ${paras.length} translated. Check your internet and try again.`, done === paras.length);
  if (done) addHistory({ from, to, src: text, out: lastParas.map(p => p.out).join('\n\n'), paras: lastParas.map(p => ({ src: p.src, out: p.out, missing: p.missing })), at: Date.now() });
  if (done) $('paras').firstElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderParas(to) {
  const ol = $('paras'); ol.innerHTML = '';
  lastParas.forEach((p, i) => {
    const li = document.createElement('li'); li.className = 'para ' + (p.state || 'done');
    const en = document.createElement('div'); en.className = 'en'; en.textContent = `${i + 1}. ${p.src}`;
    const ta = document.createElement('div'); ta.className = 'ta'; ta.lang = to;
    ta.textContent = p.state === 'pending' ? 'Waiting… / காத்திருக்கிறது…' : p.out;
    li.append(en, ta);
    if (p.missing && p.missing.length) { const w = document.createElement('div'); w.className = 'warn'; w.textContent = '⚠ Check these numbers/words: ' + p.missing.join(', '); li.append(w); }
    if (p.state !== 'pending') {
      const acts = document.createElement('div'); acts.className = 'acts';
      const c = document.createElement('button'); c.textContent = '📋 Copy';
      c.onclick = () => copyText(p.out, c);
      const s = document.createElement('button'); s.textContent = '🔊 Play';
      s.onclick = () => speak(p.out, to);
      acts.append(c, s); li.append(acts);
    }
    ol.append(li);
  });
  updateCopyAllLabel();
}
function updateCopyAllLabel() {
  const n = LANGS[$('to').value].name;
  $('copyAllLbl').innerHTML = `Copy all ${n}<small>அனைத்தையும் நகலெடு · Salin semua</small>`;
}
const allOut = () => lastParas.filter(p => p.state === 'done').map(p => p.out).join('\n\n');
$('copyAll').onclick = () => copyText(allOut(), $('copyAll'));
$('shareAll').onclick = () => shareText(allOut());

/* ---------------- Speech input ---------------- */
$('speak').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { status('Voice typing is not supported in this browser. Use Chrome on Android, or the microphone key on the phone keyboard.'); $('src').focus(); return; }
  const tags = LANGS[$('from').value].speech;
  const run = (i) => {
    const rec = new SR(); rec.lang = tags[i]; rec.interimResults = true; rec.continuous = false;
    const before = $('src').value ? $('src').value.trimEnd() + ' ' : '';
    rec.onresult = (e) => { $('src').value = before + Array.from(e.results).map(r => r[0].transcript).join(''); updateSrcInfo(); };
    rec.onerror = (e) => {
      if (e.error === 'language-not-supported' && i + 1 < tags.length) return run(i + 1);
      status(e.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice error: ' + e.error + '. Try typing instead.');
    };
    rec.onend = () => { if ($('status').textContent.startsWith('🎤')) status(''); };
    status('🎤 Listening… speak now / பேசுங்கள் / Sila cakap', true);
    try { rec.start(); } catch (err) { status('Voice error: ' + err.message); }
  };
  run(0);
};

/* ---------------- Photo OCR ---------------- */
$('photo').onclick = () => $('file').click();
$('file').onchange = async () => {
  const f = $('file').files[0]; if (!f) return;
  status('Reading photo… this can take 10–30 seconds the first time.', true);
  try {
    if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    const { data } = await Tesseract.recognize(f, LANGS[$('from').value].ocr, {
      logger: (m) => { if (m.status === 'recognizing text') status(`Reading photo… ${Math.round(m.progress * 100)}%`, true); },
    });
    const txt = data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!txt) { status('No text found. Try a closer, brighter photo.'); return; }
    $('src').value = txt; updateSrcInfo(); status('Check the text above, fix mistakes, then press Translate.', true);
  } catch (e) { status('Could not read photo: ' + e.message); }
  finally { $('file').value = ''; }
};
function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('could not load OCR (internet?)')); document.head.appendChild(s); }); }

/* ---------------- Output actions ---------------- */
function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  for (const tag of LANGS[lang].tts) {
    const v = voices.find(v => v.lang.replace('_', '-').toLowerCase() === tag.toLowerCase()) ||
              voices.find(v => v.lang.toLowerCase().startsWith(tag.split('-')[0].toLowerCase() + (tag.includes('-') ? '-' : '')));
    if (v) return v;
  }
  return null;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
function speak(text, lang) {
  if (!('speechSynthesis' in window)) { status('Reading aloud is not supported in this browser.'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text), v = pickVoice(lang);
  u.lang = v ? v.lang : LANGS[lang].tts[0]; if (v) u.voice = v; u.rate = 0.85;
  if (!v) status(`No ${LANGS[lang].name} voice found on this phone. Install it in phone Settings → Text-to-speech.`);
  speechSynthesis.speak(u);
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); status('Copied ✓ / நகலெடுக்கப்பட்டது / Disalin', true); if (btn) { const o = btn.innerHTML; btn.innerHTML = '✓ Copied'; setTimeout(() => btn.innerHTML = o, 1500); } }
  catch { prompt('Copy this text:', text); }
}
async function shareText(text) {
  if (!text) return;
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
$('play').onclick = () => speak($('out').textContent, $('out').lang);
$('copy').onclick = () => copyText($('out').textContent);
$('share').onclick = () => shareText($('out').textContent);

/* ---------------- History ---------------- */
function addHistory(item) {
  const h = load(LS.hist, []).filter(x => !(x.src === item.src && x.from === item.from && x.to === item.to));
  h.unshift(item); save(LS.hist, h.slice(0, 50)); renderHistory();
}
function renderHistory() {
  const ul = $('history'); ul.innerHTML = '';
  const h = load(LS.hist, []);
  if (!h.length) { ul.innerHTML = '<li>No translations yet.</li>'; return; }
  h.forEach((x, i) => {
    const li = document.createElement('li');
    const t = document.createElement('div'); t.className = 't';
    const b = document.createElement('b'); b.textContent = `${x.from.toUpperCase()}→${x.to.toUpperCase()}${x.paras ? ` (${x.paras.length} ¶)` : ''}: ${x.src.slice(0, 80)}`;
    const s = document.createElement('span'); s.textContent = x.out.slice(0, 120);
    t.append(b, s);
    t.onclick = () => {
      $('from').value = x.from; $('to').value = x.to; save(LS.pair, { from: x.from, to: x.to });
      setMode(x.paras ? 'para' : 'quick'); $('src').value = x.src; updateSrcInfo();
      if (x.paras) { lastParas = x.paras.map(p => ({ ...p, state: 'done' })); $('paraBox').hidden = false; renderParas(x.to); $('paraBox').scrollIntoView({ behavior: 'smooth' }); }
      else showResult(x.out, x.to);
    };
    const del = document.createElement('button'); del.textContent = '🗑'; del.setAttribute('aria-label', 'Delete');
    del.onclick = () => { const a = load(LS.hist, []); a.splice(i, 1); save(LS.hist, a); renderHistory(); };
    li.append(t, del); ul.append(li);
  });
}
$('clearHist').onclick = () => { if (confirm('Clear all history?')) { save(LS.hist, []); renderHistory(); } };

/* ---------------- Glossary ---------------- */
function renderGlossary() {
  const ul = $('glossary'); ul.innerHTML = '';
  const g = load(LS.gloss, []);
  if (!g.length) { ul.innerHTML = '<li>No words yet.</li>'; return; }
  g.forEach((x, i) => {
    const li = document.createElement('li');
    const t = document.createElement('div'); t.className = 't';
    t.textContent = x.repl ? `${x.term} → ${x.repl}` : `${x.term} (keep as-is)`;
    const del = document.createElement('button'); del.textContent = '🗑'; del.setAttribute('aria-label', 'Delete');
    del.onclick = () => { const a = load(LS.gloss, []); a.splice(i, 1); save(LS.gloss, a); renderGlossary(); };
    li.append(t, del); ul.append(li);
  });
}
$('gForm').onsubmit = (e) => {
  e.preventDefault();
  const term = $('gTerm').value.trim(), repl = $('gRepl').value.trim();
  if (!term) return;
  const g = load(LS.gloss, []).filter(x => x.term.toLowerCase() !== term.toLowerCase());
  g.push({ term, repl }); save(LS.gloss, g);
  $('gTerm').value = ''; $('gRepl').value = ''; renderGlossary();
};

/* ---------------- Settings ---------------- */
$('email').value = $('qEmail').value = load(LS.email, '');
$('email').onchange = () => saveEmail($('email').value);
$('qSave').onclick = () => saveEmail($('qEmail').value);
$('size').value = load(LS.size, '1');
const applySize = () => document.documentElement.style.setProperty('--scale', $('size').value);
$('size').onchange = () => { save(LS.size, $('size').value); applySize(); };
for (const [id, e] of Object.entries(ENGINES)) $('engine').add(new Option(e.name, id));
function syncEngineUI() {
  const id = currentEngine(); $('engine').value = id; $('keyField').hidden = !ENGINES[id].needsKey;
  $('engineKey').value = load(LS.keys, {})[id] || ''; renderQuota();
}
$('engine').onchange = () => { save(LS.engine, $('engine').value); syncEngineUI(); };
$('engineKey').onchange = () => { const k = load(LS.keys, {}); k[currentEngine()] = $('engineKey').value.trim(); save(LS.keys, k); };

fillLangs(); applySize(); syncEngineUI(); setMode(getMode()); updateCopyAllLabel(); renderHistory(); renderGlossary();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
