// Martigence – Dikhao aur Jano (Buildathon upgrade)
// Gemini is called ONLY here on the server. The API key never reaches the browser.
const path = require('path');
const fs = require('fs');
const express = require('express');
const dotenv = require('dotenv');
const { GoogleGenAI, Type } = require('@google/genai');
const rules = require('./rules');
const parts = require('./parts');
const pricesearch = require('./pricesearch');

const ENV_PATHS = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
];
const PORT = process.env.PORT || 8080;
// gemini-2.5-flash / 2.5-flash-lite are closed to new API keys (404), so newer free Flash models are used. Override with GEMINI_MODEL in .env.
// Measured on this key (20 Nov): 3.5-flash-lite ~1 s, 3.1-flash-lite ~1.3 s, 3.8-flash ~6-16 s. 3.5-flash often 503 (overloaded).
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
// Parts checks need a quick answer in a live demo, so they use the fast Flash-Lite chain first.
const FAST_MODEL = 'gemini-3.5-flash-lite';
const FAST_CHAIN = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const TIMEOUT_MS = { 'gemini-3.8-flash': 16000 };
const IMAGE_TIMEOUT_MS = { 'gemini-3.8-flash': 25000 };
const THINKING = { 'gemini-3.8-flash': { thinkingLevel: 'LOW' } };
const RETRYABLE = /\b(429|500|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|TIMEOUT|fetch failed|ECONNRESET/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// .env is re-read on EVERY request, so a new key works without a restart.
function readEnv() {
  for (const p of ENV_PATHS) {
    try {
      if (fs.existsSync(p)) return dotenv.parse(fs.readFileSync(p));
    } catch (_) {}
  }
  return {};
}

function getKey() {
  try {
    const env = readEnv();
    if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim()) return env.GEMINI_API_KEY.trim();
  } catch (_) {}
  return (process.env.GEMINI_API_KEY || '').trim() || null;
}

let lastGoodModel = null;
// Tries every model in the chain; a busy model (503/429/timeout) gets one quick retry with backoff first.
// deadlineMs caps the whole call so the customer never waits forever.
async function callGemini({ parts, schema, system, prefer, chain, deadlineMs = 30000 }) {
  const env = readEnv();
  if ((process.env.GEMINI_DISABLE || env.GEMINI_DISABLE) === '1') throw new Error('DISABLED'); // test switch: simulate Gemini down
  const key = getKey();
  if (!key) throw new Error('NO_KEY');
  const ai = new GoogleGenAI({ apiKey: key });
  let MODELS = chain || DEFAULT_MODELS;
  const forced = process.env.GEMINI_MODEL || env.GEMINI_MODEL;
  if (forced) MODELS = [forced, ...MODELS.filter(x => x !== forced)];
  const first = prefer || (chain ? null : lastGoodModel);
  const order = first ? [first, ...MODELS.filter(m => m !== first)] : MODELS;
  const hasImage = parts.some(p => p.inlineData);
  const end = Date.now() + deadlineMs;
  let lastErr;
  for (const model of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = end - Date.now();
      if (left < 1500) throw lastErr || new Error('TIMEOUT');
      const limit = Math.min(left, (hasImage ? IMAGE_TIMEOUT_MS[model] || 15000 : TIMEOUT_MS[model] || 9000));
      try {
        const res = await Promise.race([
          ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction: system,
              responseMimeType: 'application/json',
              responseSchema: schema,
              temperature: 0.2,
              ...(THINKING[model] ? { thinkingConfig: THINKING[model] } : {}),
            },
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), limit)),
        ]);
        const data = JSON.parse(res.text);
        if (!prefer && !chain) lastGoodModel = model;
        return { data, model };
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || e);
        console.error(`[gemini] ${model} try ${attempt + 1} failed: ${msg.slice(0, 160)}`);
        // Retry the same model once only for "busy" errors, and not after a long timeout (move on instead).
        if (attempt === 0 && RETRYABLE.test(msg) && msg !== 'TIMEOUT') { await sleep(600 + Math.random() * 600); continue; }
        break;
      }
    }
  }
  throw lastErr || new Error('GEMINI_FAILED');
}

const CATEGORIES = rules.CATEGORIES;

const diagnoseSchema = {
  type: Type.OBJECT,
  properties: {
    problem: { type: Type.STRING, description: 'Likely problem in 1-2 short simple sentences' },
    category: { type: Type.STRING, enum: CATEGORIES },
    job_key: { type: Type.STRING, enum: Object.keys(rules.JOBS), description: 'Closest standard job from the Martigence rate card' },
    urgency: { type: Type.STRING, enum: ['urgent', 'high', 'medium', 'low'] },
    urgency_reason: { type: Type.STRING },
    safety_tip: { type: Type.STRING },
    labour_min: { type: Type.INTEGER }, labour_max: { type: Type.INTEGER },
    parts_min: { type: Type.INTEGER }, parts_max: { type: Type.INTEGER },
    parts_list: { type: Type.ARRAY, items: { type: Type.STRING } },
    pro_should_check: { type: Type.ARRAY, items: { type: Type.STRING } },
    questions_for_customer: { type: Type.ARRAY, items: { type: Type.STRING } },
    confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
    photo_seen: { type: Type.STRING, description: 'What you see in the photo, or empty if no photo' },
  },
  required: ['problem', 'category', 'job_key', 'urgency', 'urgency_reason', 'safety_tip', 'labour_min', 'labour_max', 'parts_min', 'parts_max', 'pro_should_check', 'confidence'],
  propertyOrdering: ['problem', 'photo_seen', 'category', 'job_key', 'urgency', 'urgency_reason', 'safety_tip', 'labour_min', 'labour_max', 'parts_min', 'parts_max', 'parts_list', 'pro_should_check', 'questions_for_customer', 'confidence'],
};

function diagnoseSystem(lang) {
  return `You are "Dikhao aur Jano", the home-repair assistant of Martigence, a verified home-services platform in Deoghar, Jharkhand (small-town India).
The customer shows a photo and/or describes a home problem in Hindi, Hinglish or English.
Return ONLY the JSON schema. Write all text fields in ${lang === 'hi' ? 'simple Hindi (Devanagari script)' : 'simple English (short sentences)'}.
Rules:
- Pick the right pro category and the closest job_key from the rate card below.
- URGENCY: sparking, burning smell, smoke, exposed live wire, electric shock, gas smell/leak, water flooding/burst pipe, or water near electricity = "urgent". Totally no water/power for the house, or AC not cooling in extreme heat = "high". Steady leak or broken but usable item = "medium". Cosmetic work (painting, loose handle) = "low".
- safety_tip: one practical action (e.g. switch off MCB/main switch, close main water valve, open windows and do not use any switch for gas).
- Prices are Deoghar small-town rates in INR, labour separate from parts. Stay inside or close to the rate card band; widen only if the problem clearly is bigger, and say so in problem.
- pro_should_check: 2-4 short checks the visiting pro must do.
- questions_for_customer: 0-2 short questions that would make the estimate more accurate.
- Never invent brand names or claim certainty. If the photo is unclear, set confidence low.
Rate card (labour INR / parts INR):
${rules.rateCardText()}`;
}

const quoteSchema = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING, enum: ['fair', 'slightly_high', 'too_high', 'suspiciously_low'] },
    reason: { type: Type.STRING },
    questions_to_ask_pro: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['verdict', 'reason', 'questions_to_ask_pro'],
};

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, gemini_key_present: !!getKey(), last_model: lastGoodModel, time: new Date().toISOString() });
});

app.get('/api/jobs', (req, res) => res.json({ categories: CATEGORIES, jobs: rules.JOBS }));

app.post('/api/diagnose', async (req, res) => {
  const { text = '', image, mime, lang = 'en' } = req.body || {};
  const cleanText = String(text).slice(0, 1500);
  if (!cleanText.trim() && !image) return res.status(400).json({ error: 'Please type the problem or add a photo.' });
  let result, source = 'gemini', model = null, note = null;
  try {
    const parts = [];
    if (image) parts.push({ inlineData: { mimeType: mime || 'image/jpeg', data: String(image).replace(/^data:[^,]+,/, '') } });
    parts.push({ text: cleanText.trim() ? `Customer says: "${cleanText}"` : 'Customer sent only this photo. Identify the home problem.' });
    const g = await callGemini({ parts, schema: diagnoseSchema, system: diagnoseSystem(lang) });
    result = g.data; model = g.model;
  } catch (e) {
    source = 'fallback';
    note = String(e.message) === 'NO_KEY' ? 'AI key not set – showing rule-based estimate.' : 'Gemini is busy – showing rule-based estimate.';
    result = rules.fallbackDiagnose(cleanText, lang);
  }
  // Safety + business rules are enforced in code, not left to the model.
  result = rules.applyGuards(result, cleanText);
  res.json({ source, model, note, result, visit_fee: rules.VISIT_FEE });
});

app.post('/api/check-quote', async (req, res) => {
  const { quote, labour_min, labour_max, parts_min, parts_max, problem = '', lang = 'en' } = req.body || {};
  const q = Number(quote);
  if (!q || q <= 0) return res.status(400).json({ error: 'Please enter the amount the pro asked for.' });
  const band = { labour_min: +labour_min || 0, labour_max: +labour_max || 0, parts_min: +parts_min || 0, parts_max: +parts_max || 0 };
  const ruleVerdict = rules.ruleQuoteVerdict(q, band);
  let reason = null, questions = [], source = 'rules', model = null;
  try {
    const g = await callGemini({
      parts: [{ text: `Job: ${String(problem).slice(0, 500)}\nFair band: labour ₹${band.labour_min}-${band.labour_max}, parts ₹${band.parts_min}-${band.parts_max}, total ₹${band.labour_min + band.parts_min}-${band.labour_max + band.parts_max}.\nPro's quote: ₹${q}.\nRule engine verdict: ${ruleVerdict.verdict} (${ruleVerdict.diff >= 0 ? '+' : ''}₹${ruleVerdict.diff} vs top of band).` }],
      schema: quoteSchema,
      system: `You are the Martigence Pro Extra-Charge Checker for Deoghar. Explain to a customer, in ${lang === 'hi' ? 'simple Hindi (Devanagari)' : 'simple English'}, whether the quote is fair. Agree with the rule engine verdict unless clearly wrong. Give a 1-2 sentence reason (mention what extra work or parts might justify a higher price) and 2-3 short polite questions the customer can ask the pro. Labour and parts are separate; commission is on labour only.`,
    });
    reason = g.data.reason; questions = g.data.questions_to_ask_pro || []; source = 'gemini+rules'; model = g.model;
  } catch (_) {
    reason = rules.ruleQuoteReason(ruleVerdict, lang);
    questions = rules.defaultQuestions(lang);
  }
  // Final verdict always comes from the transparent rule engine.
  res.json({ source, model, verdict: ruleVerdict.verdict, diff: ruleVerdict.diff, band_total: ruleVerdict.band_total, reason, questions_to_ask_pro: questions, above_band_rule: ruleVerdict.verdict === 'fair' || ruleVerdict.verdict === 'suspiciously_low' ? null : rules.aboveBandRule(lang) });
});

app.post('/api/match', (req, res) => {
  const { category = 'plumber', area = '' } = req.body || {};
  res.json({ sample_data: true, pros: rules.matchScore(category, area) });
});

const posInt = (v, d) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : d);

// ---------- Parts ka Sahi Daam: Parts Price Check + Bargain Helper ----------
const REF_ENUM = [...parts.PART_IDS, 'none'];
const lineSchema = { type: Type.OBJECT, properties: { hi: { type: Type.STRING }, hinglish: { type: Type.STRING }, en: { type: Type.STRING } }, required: ['hi', 'hinglish', 'en'] };
const partSchema = {
  type: Type.OBJECT,
  properties: {
    part_name: { type: Type.STRING, description: 'Short name of the part' },
    ref_id: { type: Type.STRING, enum: REF_ENUM, description: 'Closest reference part, or none' },
    photo_seen: { type: Type.STRING, description: 'What you see in the photo, or empty' },
    common_brands: { type: Type.ARRAY, items: { type: Type.STRING } },
    low: { type: Type.INTEGER }, typical: { type: Type.INTEGER }, high: { type: Type.INTEGER },
    quantity: { type: Type.INTEGER },
    search_query: { type: Type.STRING, description: 'Short ENGLISH shopping search query for this exact part, 2-5 words, e.g. "MCB 16A single pole"' },
    quoted_in_text: { type: Type.INTEGER, description: 'Price the pro asked, if written in the text/photo, else 0' },
    tip: { type: Type.STRING, description: 'One practical tip to avoid overpaying for this part' },
    bargain_lines: { type: Type.ARRAY, items: lineSchema },
    confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
  },
  required: ['part_name', 'ref_id', 'low', 'typical', 'high', 'quantity', 'search_query', 'quoted_in_text', 'tip', 'bargain_lines', 'confidence'],
  propertyOrdering: ['part_name', 'photo_seen', 'ref_id', 'search_query', 'common_brands', 'low', 'typical', 'high', 'quantity', 'quoted_in_text', 'tip', 'bargain_lines', 'confidence'],
};
// Small, fast photo step: just name the part and give shopping keywords.
const identifySchema = {
  type: Type.OBJECT,
  properties: {
    part_name_en: { type: Type.STRING, description: 'Short English name of the main part/product, e.g. "4 socket extension board"' },
    search_query: { type: Type.STRING, description: 'Short ENGLISH shopping search query, 2-5 words' },
    ref_id: { type: Type.STRING, enum: REF_ENUM },
    photo_seen: { type: Type.STRING, description: 'One short sentence: what is in the photo' },
  },
  required: ['part_name_en', 'search_query', 'ref_id'],
};
const billSchema = {
  type: Type.OBJECT,
  properties: {
    readable: { type: Type.STRING, enum: ['yes', 'partly', 'no'] },
    photo_seen: { type: Type.STRING },
    items: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
      name: { type: Type.STRING }, ref_id: { type: Type.STRING, enum: REF_ENUM },
      kind: { type: Type.STRING, enum: ['part', 'labour', 'other'] },
      qty: { type: Type.INTEGER }, price: { type: Type.INTEGER, description: 'Line total in rupees as written on the bill' },
      low: { type: Type.INTEGER }, typical: { type: Type.INTEGER }, high: { type: Type.INTEGER },
    }, required: ['name', 'ref_id', 'kind', 'qty', 'price', 'low', 'typical', 'high'] } },
    bill_total: { type: Type.INTEGER },
  },
  required: ['readable', 'items', 'bill_total'],
};

function partsSystem(lang) {
  return `You are "Parts ka Sahi Daam", the parts price checker of Martigence, a home-services platform in Deoghar, Jharkhand (small-town India).
The customer names a home repair part (or sends a photo of it), maybe in Hindi/Hinglish, maybe with the brand and the price a pro (mistri) asked.
Return ONLY the JSON schema.
- part_name, tip, photo_seen: ${lang === 'hi' ? 'simple Hindi (Devanagari)' : 'simple English'}.
- ref_id: the closest part from the reference list below, or "none" if it is clearly a different part.
- low/typical/high: typical small-city SHOP price in INR for ONE unit of the part only (no labour). Stay close to the reference band when it matches.
- quantity: how many units the customer mentions (default 1). quoted_in_text: the rupee price the pro asked if written, else 0.
- common_brands: 2-4 brands commonly sold in Indian small-town shops for this part (or empty). Never invent prices for specific brands.
- bargain_lines: exactly 3 short, polite, respectful lines the customer can say or WhatsApp to the pro, each in hi (Devanagari Hindi), hinglish (Roman Hindi) and en (English):
  1) ask to see the part box / MRP, 2) state the fair price and ask for a proper bill, 3) offer to buy the part themselves and pay only fitting charge.
  Wherever you mention the fair price write the exact placeholder {FAIR}. Do NOT write any other rupee amount. Address the pro as "bhaiya". Never be rude or accuse.
Reference list (Martigence estimates, ₹ low/typical/high per unit):
${parts.refText()}`;
}

function billSystem(lang) {
  return `You read a photo of a home-repair bill or estimate (handwritten or printed, Hindi or English) for Martigence in Deoghar, Jharkhand.
Return ONLY the JSON schema. Extract every line item: name (${lang === 'hi' ? 'Hindi' : 'English'}, short), kind (part / labour / other), qty (default 1), price = the line TOTAL in rupees as written.
For each part give ref_id (closest from the list, or "none") and low/typical/high = typical small-city SHOP price in INR for ONE unit (0 for labour lines).
If the photo is not a bill or not readable, set readable "no" and items []. Do not invent lines you cannot see.
Reference list (Martigence estimates, ₹ low/typical/high per unit):
${parts.refText()}`;
}

// ---------- Live online prices (top 3 lowest) ----------
const judgeSchema = { type: Type.OBJECT, properties: { keep: { type: Type.ARRAY, items: { type: Type.INTEGER } } }, required: ['keep'] };
async function judgeListings(query, cands) {
  const list = cands.map((c, i) => `${i}. [${c.store}] ${c.title.slice(0, 260)} – ₹${c.price}`).join('\n');
  const g = await callGemini({
    parts: [{ text: `Part the customer needs: "${query}"\nListings:\n${list}` }], schema: judgeSchema, chain: FAST_CHAIN.slice(0, 2), deadlineMs: 9000,
    system: 'You filter online shopping listings. Return in keep the indexes of listings that are the SAME part a home customer in India needs for normal household AC wiring/plumbing (same type and rating; exclude DC/solar MCBs; e.g. a single pole 16A MCB is not a 2/3/4 pole MCB or a 32A MCB; a tap cartridge is not a whole tap). Exclude multi-packs and sets ("pack of 2", "pack-6", "set of 5", "combo") – keep only single pieces – and exclude accessories and unrelated items. If the query does not say pole/size, keep reasonable household variants. Return [] if none match. Never add new items.',
  });
  return g.data.keep;
}
async function onlinePrices(query, refId, alt) {
  const ref = parts.PARTS[refId];
  const opts = { judge: judgeListings, band: ref ? { low: ref.b[0], high: ref.b[2] } : null };
  const r = await pricesearch.search(query, opts);
  // Nothing matched? Try once more with the customer's own words, then with the reference part name.
  const tried = new Set([String(query).trim().toLowerCase()]);
  for (const q2 of [alt, ref && ref.en.replace(/\(.*?\)/g, '').replace(/\s*\/.*$/, '')]) {
    if (r.found || !q2 || !q2.trim() || tried.has(q2.trim().toLowerCase()) || /[^\x00-\x7F]/.test(q2)) continue;
    tried.add(q2.trim().toLowerCase());
    const r2 = await pricesearch.search(q2, opts);
    if (r2.found) return { ...r2, sources: [...r.sources, ...r2.sources] };
  }
  return r;
}
// When our table has no band for a part, a band is made from the REAL online prices found (lowest / middle / highest).
function onlineBand(results) {
  const ps = (results || []).map(r => r.price).sort((a, b) => a - b);
  if (!ps.length) return null;
  return { low: ps[0], typical: ps[Math.floor((ps.length - 1) / 2)], high: ps[ps.length - 1], from: 'online' };
}
function onlineLine(results, quoted) {
  // Use the lowest RETAIL price (one piece a customer can buy); a wholesale price is only used if nothing else was found.
  const top = (results || []).filter(r => r.retail)[0] || (results || [])[0];
  if (!top) return null;
  if (quoted && top.price >= quoted) return null; // online is not cheaper – no point saying it
  const p = `₹${top.price}`, s = top.retail ? top.store : `${top.store}, wholesale`;
  return {
    hi: `भैया, ऑनलाइन (${s}) यही पार्ट ${p} में मिल रहा है।${quoted ? ` ₹${quoted} थोड़ा ज़्यादा लग रहा है।` : ''}`,
    hinglish: `Bhaiya, online (${s}) yahi part ${p} me mil raha hai.${quoted ? ` ₹${quoted} thoda zyada lag raha hai.` : ''}`,
    en: `Bhaiya, the same part is ${p} online (${s}).${quoted ? ` ₹${quoted} seems a bit high.` : ''}`,
  };
}
function searchQueryFor(d, refId, text, brand) {
  const ref = parts.PARTS[refId];
  let q = String(d && d.search_query || '').trim();
  if (!q || /[^\x00-\x7F]/.test(q)) q = /[^\x00-\x7F]/.test(text) || !text.trim() ? (ref ? ref.en.replace(/\(.*?\)/g, '') : '') : text;
  if (brand && !q.toLowerCase().includes(brand.toLowerCase())) q = `${brand} ${q}`;
  return q.replace(/\s+/g, ' ').trim();
}

app.post('/api/parts-prices', async (req, res) => {
  const { query = '', alt = '', ref_id = '', quoted, qty, need_band = false, part_name = '', lang = 'en' } = req.body || {};
  const hi = lang === 'hi';
  const q = String(query).slice(0, 80);
  if (!q.trim()) return res.status(400).json({ error: hi ? 'पार्ट का नाम चाहिए।' : 'Part name is needed.' });
  const none = hi ? 'ऑनलाइन दाम अभी नहीं मिले। नीचे के लिंक से खुद खोजें।' : 'No live prices found right now. Use the links below to search yourself.';
  let r;
  try { r = await onlinePrices(q, ref_id, String(alt).slice(0, 80)); }
  catch (e) { r = { query: q, found: false, results: [], sources: [], open_links: pricesearch.openLinks(q) }; }
  const out = { ...r, open_links: r.open_links || pricesearch.openLinks(q), online_line: onlineLine(r.results, posInt(quoted, 0)), message: r.found ? null : none };
  // No reference band for this part → judge the pro's price against the real online prices instead.
  if (need_band && r.found) {
    const b = onlineBand(r.results), n = posInt(qty, 1), qn = posInt(quoted, 0);
    const v = parts.verdict(qn, b, n);
    const name = nameOf(ref_id, part_name || q);
    out.online_band = b;
    out.online_verdict = v;
    out.bargain_lines = parts.templateLines(name, v ? v.fair_offer : parts.r10(b.typical * n * 1.1), v && v.verdict !== 'fair' ? qn : 0);
  }
  res.json(out);
});

function nameOf(refId, fallbackName) {
  const p = parts.PARTS[refId];
  if (p) return { en: p.en, hi: p.hi };
  const n = String(fallbackName || 'part').slice(0, 60);
  return { en: n, hi: n };
}

app.post('/api/parts-check', async (req, res) => {
  const { mode = 'part', text = '', brand = '', quoted, qty, image, mime, lang = 'en', with_prices = false } = req.body || {};
  const hi = lang === 'hi';
  const cleanText = String(text).slice(0, 600);
  const cleanBrand = String(brand).slice(0, 60);
  if (!cleanText.trim() && !image) return res.status(400).json({ error: hi ? 'पार्ट का नाम लिखें या फ़ोटो लगाएँ।' : 'Please type the part name or add a photo.' });
  const imgPart = image ? [{ inlineData: { mimeType: mime || 'image/jpeg', data: String(image).replace(/^data:[^,]+,/, '') } }] : [];
  let source = 'gemini', model = null, note = null;

  if (mode === 'bill') {
    if (!image) return res.status(400).json({ error: hi ? 'बिल की फ़ोटो लगाएँ।' : 'Please add a photo of the bill.' });
    let g;
    try { g = await callGemini({ parts: [...imgPart, { text: cleanText ? `Customer note: ${cleanText}` : 'Read this bill.' }], schema: billSchema, system: billSystem(lang), chain: FAST_CHAIN, deadlineMs: 45000 }); }
    catch (e) {
      return res.json({ mode, source: 'fallback', note: hi ? 'AI अभी बिल नहीं पढ़ पाया। हर पार्ट का नाम और रेट "एक पार्ट" में लिखकर जाँचें।' : 'AI could not read the bill right now. Type each part and its price in "One part" mode.', items: [], total_savings: 0, checklist: parts.CHECKLIST[hi ? 'hi' : 'en'] });
    }
    model = g.model;
    const items = (g.data.items || []).slice(0, 25).map(it => {
      const q = posInt(it.qty, 1), price = posInt(it.price, 0);
      const refId = parts.PARTS[it.ref_id] ? it.ref_id : (it.kind === 'part' ? parts.findPart(it.name) : null);
      if (it.kind !== 'part') return { name: String(it.name || '').slice(0, 80), kind: it.kind, qty: q, price, verdict: null };
      const b = parts.band(refId, it);
      const v = parts.verdict(price, b, q);
      const savings = v && (v.verdict === 'overcharged' || v.verdict === 'slightly_high') ? Math.max(0, price - v.fair_max) : 0;
      return { name: String(it.name || '').slice(0, 80), ref_id: refId || 'none', kind: 'part', qty: q, price, band: b, ...(v || {}), savings };
    });
    const total_savings = items.reduce((s, x) => s + (x.savings || 0), 0);
    const worst = items.filter(x => x.savings).sort((a, b) => b.savings - a.savings)[0];
    const bargain_lines = worst ? parts.templateLines(nameOf(worst.ref_id, worst.name), worst.fair_offer, worst.price) : null;
    return res.json({ mode, source, model, readable: g.data.readable, photo_seen: g.data.photo_seen || '', items, bill_total: posInt(g.data.bill_total, items.reduce((s, x) => s + x.price, 0)), total_savings, bargain_lines, margin_pct: parts.MARGIN * 100, checklist: parts.CHECKLIST[hi ? 'hi' : 'en'] });
  }

  // Single part (typed and/or photo)
  const busyNote = e => String(e.message) === 'NO_KEY' ? (hi ? 'AI key नहीं है – Martigence रेफ़रेंस टेबल से अनुमान।' : 'AI key not set – estimate from the Martigence reference table.') : (hi ? 'Gemini अभी व्यस्त है – Martigence रेफ़रेंस टेबल और ऑनलाइन दाम से जवाब।' : 'Gemini is busy right now – answer from the Martigence reference table and live online prices.');
  const textNoPrice = cleanText.replace(/(?:₹|rs\.?|rupees?|रु\.?|रुपये)\s*[0-9][0-9,]*|[0-9][0-9,]*\s*(?:₹|rs\.?|rupees?|रुपये|रु)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  let idf = null;
  // Step 1 (photo only): a small, fast call that just names the part. Longer timeout, every model in the chain.
  if (image) {
    try {
      const r = await callGemini({ parts: [...imgPart, { text: `Name the household repair part or product in this photo.${textNoPrice ? ` Customer says: "${textNoPrice}"` : ''}` }], schema: identifySchema, chain: FAST_CHAIN, deadlineMs: 40000,
        system: `You identify household electrical/plumbing/appliance parts in photos for an Indian price checker. Return ONLY the JSON. ref_id: closest from this list or "none":\n${parts.PART_IDS.join(', ')}` });
      idf = r.data; model = r.model;
    } catch (e) { source = 'fallback'; note = busyNote(e); }
  }
  const nameEn = String(idf && idf.part_name_en || '').slice(0, 80);
  const ask = `Part: "${textNoPrice || nameEn || '(unknown)'}"${nameEn && textNoPrice ? `\nPhoto shows: ${nameEn}` : ''}${cleanBrand ? `\nBrand: ${cleanBrand}` : ''}${+quoted > 0 ? `\nPro asked: ₹${+quoted}` : ''}${+qty > 0 ? `\nQuantity: ${+qty}` : ''}`;
  // Photo with no name and no text → nothing to search. Ask the customer to type it, with quick-pick chips (no dead end).
  if (!textNoPrice && !nameEn) {
    return res.json({ mode, source: 'fallback', model: null, note, found: false, need_name: true,
      message: hi ? 'फ़ोटो से पार्ट पहचान नहीं पाए। पार्ट का नाम लिखें या नीचे से चुनें – हम ऑनलाइन दाम ढूँढ देंगे।' : 'We could not read the part from the photo right now. Type the part name or tap one below – we will find live online prices.',
      quick: parts.QUICK.map(k => ({ id: k, en: parts.PARTS[k].en.replace(/\s*\(.*?\)/g, ''), hi: parts.PARTS[k].hi.replace(/\s*\(.*?\)/g, '') })),
      checklist: parts.CHECKLIST[hi ? 'hi' : 'en'] });
  }
  // Step 2: details (band, tips, bargain lines) as a TEXT-only call – fast. On failure we still continue.
  let g = null;
  try {
    g = await callGemini({ parts: [{ text: ask }], schema: partSchema, system: partsSystem(lang), chain: FAST_CHAIN, deadlineMs: 20000 });
    if (!model) model = g.model;
  } catch (e) {
    if (source !== 'fallback') { source = image && idf ? 'gemini' : 'fallback'; note = image && idf ? null : busyNote(e); }
  }
  const d = g ? g.data : {};
  if (idf && !d.search_query) d.search_query = idf.search_query;
  if (idf && !d.photo_seen) d.photo_seen = idf.photo_seen || '';
  if (idf && !d.part_name) d.part_name = hi ? '' : nameEn;
  const textRef = parts.findPart(`${textNoPrice} ${cleanBrand} ${nameEn}`);
  const refId = parts.PARTS[d.ref_id] ? d.ref_id : (idf && parts.PARTS[idf.ref_id] ? idf.ref_id : textRef);
  const b = parts.band(refId, d);
  const q = posInt(qty, posInt(d.quantity, 1));
  const quotedN = posInt(quoted, 0) || posInt(d.quoted_in_text, 0) || parts.priceFromText(cleanText);
  const v = b ? parts.verdict(quotedN, b, q) : null;
  const fairOffer = b ? (v ? v.fair_offer : parts.r10(b.typical * q * 1.1)) : 0;
  const ref = parts.PARTS[refId];
  const name = ref ? { en: ref.en, hi: ref.hi } : nameOf(null, d.part_name || nameEn || textNoPrice);
  // Gemini lines are used only if they follow the {FAIR} placeholder rule; any other rupee figure → safe templates.
  let lines = b && Array.isArray(d.bargain_lines) && d.bargain_lines.length >= 3 ? d.bargain_lines.slice(0, 3) : null;
  const bad = l => /₹\s?\d|\d{3,}\s?(rs|rupe|रुप)/i.test(`${l.hi} ${l.hinglish} ${l.en}`);
  if (lines && lines.some(bad)) lines = null;
  if (lines) lines = lines.map(l => Object.fromEntries(['hi', 'hinglish', 'en'].map(k => [k, String(l[k] || '').replace(/₹\s?\{FAIR\}/g, `₹${fairOffer}`).replace(/\{FAIR\}/g, `₹${fairOffer}`).slice(0, 220)])));
  const linesSource = lines ? 'gemini' : 'template';
  if (!lines) lines = b ? parts.templateLines(name, fairOffer, v && v.verdict !== 'fair' ? quotedN : 0) : parts.templateLines(name, 0, 0).filter((_, i) => i !== 1);
  const search_query = searchQueryFor(d, refId, textNoPrice, cleanBrand);
  const search_alt = /[^\x00-\x7F]/.test(textNoPrice) ? '' : `${cleanBrand} ${textNoPrice}`.trim().slice(0, 80);
  const out = {
    mode, source, model, note, found: true,
    part_name: d.part_name || (hi ? name.hi : name.en), ref_id: refId || 'none', ref_name: ref ? (hi ? ref.hi : ref.en) : null,
    unit: ref && (hi ? ref.unit_hi : ref.unit_en) || null,
    photo_seen: d.photo_seen || '', brand: cleanBrand,
    common_brands: (d.common_brands && d.common_brands.length ? d.common_brands : (ref ? ref.brands : [])).slice(0, 4),
    band: b, need_band: !b, qty: q, quoted: quotedN || null, ...(v || {}), fair_offer: fairOffer || null, margin_pct: parts.MARGIN * 100,
    tip: d.tip || null, confidence: d.confidence || (ref ? 'medium' : 'low'),
    search_query, search_alt, open_links: pricesearch.openLinks(search_query || textNoPrice || nameEn),
    message: b ? null : (hi ? 'यह पार्ट हमारी सूची में नहीं है – ऑनलाइन दाम से जाँच रहे हैं।' : 'This part is not in our table yet – checking live online prices instead.'),
    bargain_lines: lines, lines_source: linesSource, checklist: parts.CHECKLIST[hi ? 'hi' : 'en'],
  };
  // with_prices: do the online search in the same request (used by scripts/tests; the web page calls /api/parts-prices).
  if (with_prices && search_query) {
    let online;
    try { online = await onlinePrices(search_query, refId, search_alt); } catch (_) { online = { found: false, results: [], sources: [] }; }
    online.open_links = online.open_links || pricesearch.openLinks(search_query);
    const ol = onlineLine(online.results, v && v.verdict !== 'fair' ? quotedN : 0);
    if (ol) out.bargain_lines = [ol, ...out.bargain_lines];
    if (!b && online.found) {
      const ob = onlineBand(online.results), ov = parts.verdict(quotedN, ob, q);
      Object.assign(out, { band: ob, ...(ov || {}), fair_offer: ov ? ov.fair_offer : parts.r10(ob.typical * q * 1.1) });
    }
    if (!online.found) online.message = hi ? 'ऑनलाइन दाम अभी नहीं मिले। नीचे के लिंक से खुद खोजें।' : 'No live prices found right now. Use the links below to search yourself.';
    out.online = online;
  }
  res.json(out);
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Martigence Dikhao aur Jano running on :${PORT} (key present: ${!!getKey()})`));
}
module.exports = app;
