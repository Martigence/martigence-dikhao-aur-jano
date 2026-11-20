// Martigence – Dikhao aur Jano (Buildathon upgrade)
// Gemini is called ONLY here on the server. The API key never reaches the browser.
const path = require('path');
const fs = require('fs');
const express = require('express');
const dotenv = require('dotenv');
const { GoogleGenAI, Type } = require('@google/genai');
const rules = require('./rules');

const ENV_PATHS = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
];
const PORT = process.env.PORT || 8080;
// gemini-2.5-flash is closed to new API keys (404), so newer free Flash models come first. Override with GEMINI_MODEL in .env.
// Measured on this key: 3.8-flash ~6-8 s, 3.5-flash-lite ~0.5-2 s. Worst case ~27 s before the rule-based fallback.
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
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
async function callGemini({ parts, schema, system }) {
  const key = getKey();
  if (!key) throw new Error('NO_KEY');
  const ai = new GoogleGenAI({ apiKey: key });
  let MODELS = DEFAULT_MODELS;
  try { const m = readEnv().GEMINI_MODEL; if (m) MODELS = [m, ...DEFAULT_MODELS.filter(x => x !== m)]; } catch (_) {}
  const order = lastGoodModel ? [lastGoodModel, ...MODELS.filter(m => m !== lastGoodModel)] : MODELS;
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
      lastGoodModel = model;
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

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Martigence Dikhao aur Jano running on :${PORT} (key present: ${!!getKey()})`));
}
module.exports = app;
