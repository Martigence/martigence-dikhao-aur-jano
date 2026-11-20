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
// gemini-2.5-flash is closed to new API keys (404), so newer free Flash models come first. Override with GEMINI_MODEL in .env.
// Measured on this key: 3.8-flash ~6-8 s, 3.5-flash-lite ~0.5-2 s. Worst case ~27 s before the rule-based fallback.
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
// Parts checks need a quick answer in a live demo, so they try the fast model first.
const FAST_MODEL = 'gemini-3.5-flash-lite';
const TIMEOUT_MS = { 'gemini-3.8-flash': 16000 };
const THINKING = { 'gemini-3.8-flash': { thinkingLevel: 'LOW' } };

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
async function callGemini({ parts, schema, system, prefer }) {
  const key = getKey();
  if (!key) throw new Error('NO_KEY');
  const ai = new GoogleGenAI({ apiKey: key });
  let MODELS = DEFAULT_MODELS;
  try { const m = readEnv().GEMINI_MODEL; if (m) MODELS = [m, ...DEFAULT_MODELS.filter(x => x !== m)]; } catch (_) {}
  const first = prefer || lastGoodModel;
  const order = first ? [first, ...MODELS.filter(m => m !== first)] : MODELS;
  let lastErr;
  for (const model of order) {
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
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), TIMEOUT_MS[model] || 11000)),
      ]);
      const data = JSON.parse(res.text);
      if (!prefer) lastGoodModel = model;
      return { data, model };
    } catch (e) {
      lastErr = e;
      console.error(`[gemini] ${model} failed: ${String(e.message || e).slice(0, 160)}`);
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
    parts: [{ text: `Part the customer needs: "${query}"\nListings:\n${list}` }], schema: judgeSchema, prefer: FAST_MODEL,
    system: 'You filter online shopping listings. Return in keep the indexes of listings that are the SAME part a home customer in India needs for normal household AC wiring/plumbing (same type and rating; exclude DC/solar MCBs; e.g. a single pole 16A MCB is not a 2/3/4 pole MCB or a 32A MCB; a tap cartridge is not a whole tap). Exclude multi-packs and sets ("pack of 2", "pack-6", "set of 5", "combo") – keep only single pieces – and exclude accessories and unrelated items. If the query does not say pole/size, keep reasonable household variants. Return [] if none match. Never add new items.',
  });
  return g.data.keep;
}
async function onlinePrices(query, refId) {
  const ref = parts.PARTS[refId];
  return pricesearch.search(query, { judge: judgeListings, band: ref ? { low: ref.b[0], high: ref.b[2] } : null });
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
  const { query = '', ref_id = '', quoted, lang = 'en' } = req.body || {};
  const q = String(query).slice(0, 80);
  if (!q.trim()) return res.status(400).json({ error: lang === 'hi' ? 'पार्ट का नाम चाहिए।' : 'Part name is needed.' });
  try {
    const r = await onlinePrices(q, ref_id);
    res.json({ ...r, online_line: onlineLine(r.results, posInt(quoted, 0)), message: r.found ? null : (lang === 'hi' ? 'ऑनलाइन दाम नहीं मिले – अनुमान दिखा रहे हैं।' : 'No live prices found, showing estimate.') });
  } catch (e) {
    res.json({ query: q, found: false, results: [], sources: [], message: lang === 'hi' ? 'ऑनलाइन दाम नहीं मिले – अनुमान दिखा रहे हैं।' : 'No live prices found, showing estimate.' });
  }
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
    try { g = await callGemini({ parts: [...imgPart, { text: cleanText ? `Customer note: ${cleanText}` : 'Read this bill.' }], schema: billSchema, system: billSystem(lang), prefer: FAST_MODEL }); }
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
  let g = null;
  try {
    const ask = `Part: "${cleanText || '(see photo)'}"${cleanBrand ? `\nBrand: ${cleanBrand}` : ''}${+quoted > 0 ? `\nPro asked: ₹${+quoted}` : ''}${+qty > 0 ? `\nQuantity: ${+qty}` : ''}`;
    g = await callGemini({ parts: [...imgPart, { text: ask }], schema: partSchema, system: partsSystem(lang), prefer: FAST_MODEL });
    model = g.model;
  } catch (e) {
    source = 'fallback';
    note = String(e.message) === 'NO_KEY' ? (hi ? 'AI key नहीं है – Martigence रेफ़रेंस टेबल से अनुमान।' : 'AI key not set – estimate from the Martigence reference table.') : (hi ? 'Gemini व्यस्त है – Martigence रेफ़रेंस टेबल से अनुमान।' : 'Gemini is busy – estimate from the Martigence reference table.');
  }
  const d = g ? g.data : {};
  const textRef = parts.findPart(`${cleanText} ${cleanBrand}`);
  const refId = parts.PARTS[d.ref_id] ? d.ref_id : textRef;
  const b = parts.band(refId, d);
  if (!b) {
    return res.json({ mode, source, model, note, found: false, part_name: d.part_name || cleanText, message: hi ? 'यह पार्ट हमारी सूची में नहीं है। प्रो से डिब्बे पर MRP और बिल माँगें।' : 'This part is not in our list yet. Ask the pro to show the MRP on the box and give a bill.', bargain_lines: parts.templateLines({ en: cleanText || 'part', hi: cleanText || 'पार्ट' }, 0, 0).filter((_, i) => i !== 1), checklist: parts.CHECKLIST[hi ? 'hi' : 'en'] });
  }
  const q = posInt(qty, posInt(d.quantity, 1));
  const quotedN = posInt(quoted, 0) || posInt(d.quoted_in_text, 0) || parts.priceFromText(cleanText);
  const v = parts.verdict(quotedN, b, q);
  const fairOffer = v ? v.fair_offer : parts.r10(b.typical * q * 1.1);
  const ref = parts.PARTS[refId];
  const name = ref ? { en: ref.en, hi: ref.hi } : nameOf(null, d.part_name || cleanText);
  // Gemini lines are used only if they follow the {FAIR} placeholder rule; any other rupee figure → safe templates.
  let lines = Array.isArray(d.bargain_lines) && d.bargain_lines.length >= 3 ? d.bargain_lines.slice(0, 3) : null;
  const bad = l => /₹\s?\d|\d{3,}\s?(rs|rupe|रुप)/i.test(`${l.hi} ${l.hinglish} ${l.en}`);
  if (lines && lines.some(bad)) lines = null;
  if (lines) lines = lines.map(l => Object.fromEntries(['hi', 'hinglish', 'en'].map(k => [k, String(l[k] || '').replace(/₹\s?\{FAIR\}/g, `₹${fairOffer}`).replace(/\{FAIR\}/g, `₹${fairOffer}`).slice(0, 220)])));
  const linesSource = lines ? 'gemini' : 'template';
  if (!lines) lines = parts.templateLines(name, fairOffer, v && v.verdict !== 'fair' ? quotedN : 0);
  const search_query = searchQueryFor(d, refId, cleanText, cleanBrand);
  let online = null;
  if (with_prices && search_query) {
    try { online = await onlinePrices(search_query, refId); } catch (_) { online = { found: false, results: [], sources: [] }; }
    const ol = onlineLine(online.results, v && v.verdict !== 'fair' ? quotedN : 0);
    if (ol) lines = [ol, ...lines];
    if (!online.found) online.message = hi ? 'ऑनलाइन दाम नहीं मिले – अनुमान दिखा रहे हैं।' : 'No live prices found, showing estimate.';
  }
  res.json({
    mode, source, model, note, found: true,
    part_name: d.part_name || (hi ? name.hi : name.en), ref_id: refId || 'none', ref_name: ref ? (hi ? ref.hi : ref.en) : null,
    unit: ref && (hi ? ref.unit_hi : ref.unit_en) || null,
    photo_seen: d.photo_seen || '', brand: cleanBrand,
    common_brands: (d.common_brands && d.common_brands.length ? d.common_brands : (ref ? ref.brands : [])).slice(0, 4),
    band: b, qty: q, quoted: quotedN || null, ...(v || {}), fair_offer: fairOffer, margin_pct: parts.MARGIN * 100,
    tip: d.tip || null, confidence: d.confidence || (ref ? 'medium' : 'low'),
    search_query, online,
    bargain_lines: lines, lines_source: linesSource, checklist: parts.CHECKLIST[hi ? 'hi' : 'en'],
  });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Martigence Dikhao aur Jano running on :${PORT} (key present: ${!!getKey()})`));
}
module.exports = app;
