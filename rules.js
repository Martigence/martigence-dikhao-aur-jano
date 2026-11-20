// Transparent rule engine: rate card, urgency guards, quote verdict, MatchScore.
// These starting bands are estimates for Deoghar; they will be replaced by real job prices.
const VISIT_FEE = 69;
const CATEGORIES = ['plumber', 'electrician', 'carpenter', 'ac_technician', 'painter', 'appliance_repair', 'ro_water_purifier', 'other'];

const JOBS = {
  tap_leak:          { cat: 'plumber', en: 'Leaking tap / nal', hi: 'नल टपकना', l: [150, 250], p: [0, 150], kw: ['tap', 'nal', 'faucet', 'tapak', 'टपक', 'नल'] },
  pipe_leak:         { cat: 'plumber', en: 'Pipe leak / burst', hi: 'पाइप लीक', l: [200, 450], p: [50, 300], kw: ['pipe', 'leak', 'paani', 'water', 'burst', 'पाइप', 'पानी', 'flood', 'bhar'] },
  toilet_flush:      { cat: 'plumber', en: 'Toilet / flush problem', hi: 'टॉयलेट / फ्लश', l: [200, 400], p: [100, 600], kw: ['toilet', 'flush', 'commode', 'latrine', 'टॉयलेट', 'फ्लश'] },
  drain_block:       { cat: 'plumber', en: 'Drain / basin block', hi: 'नाली / बेसिन जाम', l: [200, 500], p: [0, 100], kw: ['block', 'jam', 'drain', 'basin', 'nali', 'जाम', 'नाली'] },
  motor_pump:        { cat: 'plumber', en: 'Water motor / pump', hi: 'पानी की मोटर', l: [300, 600], p: [0, 800], kw: ['motor', 'pump', 'tanki', 'tank', 'मोटर', 'टंकी'] },
  switchboard:       { cat: 'electrician', en: 'Switch / switchboard repair', hi: 'स्विच / स्विचबोर्ड', l: [150, 250], p: [30, 200], kw: ['switch', 'board', 'socket', 'plug', 'स्विच', 'spark', 'चिंगारी'] },
  fan_repair:        { cat: 'electrician', en: 'Ceiling fan repair', hi: 'पंखा ठीक करना', l: [150, 300], p: [0, 350], kw: ['fan', 'pankha', 'पंखा', 'capacitor', 'regulator'] },
  wiring_fault:      { cat: 'electrician', en: 'Wiring fault / short circuit', hi: 'वायरिंग / शॉर्ट सर्किट', l: [250, 600], p: [50, 500], kw: ['wire', 'wiring', 'short', 'mcb', 'trip', 'light', 'bijli', 'current', 'बिजली', 'शॉर्ट', 'करंट'] },
  inverter:          { cat: 'electrician', en: 'Inverter / battery', hi: 'इन्वर्टर / बैटरी', l: [200, 400], p: [0, 500], kw: ['inverter', 'battery', 'इन्वर्टर'] },
  door_lock:         { cat: 'carpenter', en: 'Door / lock / hinge', hi: 'दरवाज़ा / ताला / कब्ज़ा', l: [150, 350], p: [50, 400], kw: ['door', 'lock', 'hinge', 'darwaza', 'tala', 'दरवाज', 'ताला', 'kabja'] },
  furniture_repair:  { cat: 'carpenter', en: 'Furniture repair', hi: 'फर्नीचर मरम्मत', l: [250, 600], p: [50, 400], kw: ['bed', 'chair', 'table', 'almirah', 'drawer', 'furniture', 'kursi', 'फर्नीचर', 'पलंग'] },
  ac_service:        { cat: 'ac_technician', en: 'AC service / not cooling', hi: 'AC सर्विस / ठंडा नहीं', l: [400, 700], p: [0, 300], kw: ['ac', 'a.c', 'cooling', 'thanda', 'ठंडा', 'एसी'] },
  ac_gas:            { cat: 'ac_technician', en: 'AC gas refill', hi: 'AC गैस भरना', l: [500, 900], p: [1500, 2500], kw: ['gas refill', 'ac gas'] },
  wall_paint_room:   { cat: 'painter', en: 'Room painting (one room)', hi: 'कमरे की पुताई', l: [2500, 4500], p: [1500, 4000], kw: ['paint', 'putai', 'rang', 'पेंट', 'पुताई', 'seelan', 'damp', 'सीलन'] },
  wall_touchup:      { cat: 'painter', en: 'Small wall touch-up / damp patch', hi: 'दीवार की छोटी मरम्मत', l: [400, 900], p: [200, 600], kw: ['crack', 'patch', 'touch'] },
  appliance_general: { cat: 'appliance_repair', en: 'Washing machine / fridge / geyser repair', hi: 'वॉशिंग मशीन / फ्रिज / गीज़र', l: [300, 600], p: [0, 1200], kw: ['fridge', 'washing', 'machine', 'geyser', 'mixer', 'फ्रिज', 'गीज़र', 'मशीन'] },
  ro_service:        { cat: 'ro_water_purifier', en: 'RO water purifier service', hi: 'RO सर्विस', l: [300, 500], p: [300, 1200], kw: ['ro', 'purifier', 'filter', 'aquaguard'] },
  general_visit:     { cat: 'other', en: 'General inspection visit', hi: 'सामान्य जाँच', l: [150, 300], p: [0, 200], kw: [] },
};

function rateCardText() {
  return Object.entries(JOBS).map(([k, j]) => `${k} (${j.cat}): labour ${j.l[0]}-${j.l[1]}, parts ${j.p[0]}-${j.p[1]}`).join('\n');
}

const URGENT_PATTERNS = [
  { re: /spark|chingari|चिंगारी|smoke|dhua|धुआ|burn(ing)? smell|jal(ne)? ki (gandh|smell)|जलने|shock|current lag|करंट|naked wire|live wire|nangi taar/i, type: 'electric' },
  { re: /gas (leak|smell)|gas ki (gandh|smell|badbu)|गैस (लीक|की गंध|की बदबू)|lpg|cylinder leak/i, type: 'gas' },
  { re: /flood|burst|phat gaya|फट|bhar gaya|भर गया|water everywhere|paani hi paani|पानी ही पानी|tank overflow/i, type: 'water' },
];

const SAFETY = {
  electric: { en: 'Switch OFF the main switch / MCB now. Do not touch the switch or wire, and keep children away.', hi: 'अभी मेन स्विच / MCB बंद करें। स्विच या तार को न छुएँ, बच्चों को दूर रखें।' },
  gas: { en: 'Close the gas regulator, open all doors and windows, and do NOT use any switch, lighter or phone near it. Call the gas agency emergency line.', hi: 'गैस रेगुलेटर बंद करें, सारे दरवाज़े-खिड़कियाँ खोलें, और पास में कोई स्विच, लाइटर या फ़ोन न चलाएँ। गैस एजेंसी इमरजेंसी पर कॉल करें।' },
  water: { en: 'Close the main water valve now and switch off power near the wet area.', hi: 'अभी पानी का मेन वाल्व बंद करें और गीली जगह के पास की बिजली बंद करें।' },
};

function detectUrgent(text) {
  for (const p of URGENT_PATTERNS) if (p.re.test(text || '')) return p.type;
  return null;
}

function bestJob(text) {
  const t = (text || '').toLowerCase();
  let best = 'general_visit', score = 0;
  for (const [k, j] of Object.entries(JOBS)) {
    let s = 0;
    for (const w of j.kw) if (t.includes(w.toLowerCase())) s += w.length > 3 ? 2 : 1;
    if (s > score) { score = s; best = k; }
  }
  return best;
}

function fallbackDiagnose(text, lang) {
  const hi = lang === 'hi';
  const key = bestJob(text);
  const j = JOBS[key];
  const urgentType = detectUrgent(text);
  return {
    problem: hi ? `संभावित समस्या: ${j.hi}। सही कारण प्रो जाँच के बाद बताएगा।` : `Likely: ${j.en}. The pro will confirm the exact cause at the visit.`,
    category: j.cat, job_key: key,
    urgency: urgentType ? 'urgent' : 'medium',
    urgency_reason: urgentType ? (hi ? 'सुरक्षा का खतरा है।' : 'There is a safety risk.') : (hi ? 'जल्दी ठीक करवाएँ ताकि समस्या न बढ़े।' : 'Fix soon so it does not get worse.'),
    safety_tip: urgentType ? SAFETY[urgentType][hi ? 'hi' : 'en'] : (hi ? 'प्रो के आने तक उस चीज़ का इस्तेमाल कम करें।' : 'Use it as little as possible until the pro comes.'),
    labour_min: j.l[0], labour_max: j.l[1], parts_min: j.p[0], parts_max: j.p[1],
    parts_list: [],
    pro_should_check: hi ? ['असली कारण जाँचें', 'कौन से पार्ट्स बदलने हैं, फ़ोटो दिखाएँ', 'काम से पहले WhatsApp पर रेट लॉक करें'] : ['Find the real cause', 'Show photos of any part to be replaced', 'Lock the price on WhatsApp before starting'],
    questions_for_customer: [],
    confidence: 'low', photo_seen: '',
  };
}

// Code-level guards so a model mistake can never downgrade a dangerous case or produce a broken band.
function applyGuards(r, text) {
  const out = { ...r };
  if (!CATEGORIES.includes(out.category)) out.category = 'other';
  if (!JOBS[out.job_key]) out.job_key = bestJob(text);
  const urgentType = detectUrgent(text) || detectUrgent(out.problem) || detectUrgent(out.photo_seen);
  if (urgentType) { out.urgency = 'urgent'; out.guard_triggered = urgentType; }
  const card = JOBS[out.job_key];
  const num = (v, d) => (Number.isFinite(+v) && +v >= 0 ? Math.round(+v) : d);
  out.labour_min = num(out.labour_min, card.l[0]); out.labour_max = num(out.labour_max, card.l[1]);
  out.parts_min = num(out.parts_min, card.p[0]); out.parts_max = num(out.parts_max, card.p[1]);
  if (out.labour_max < out.labour_min) [out.labour_min, out.labour_max] = [out.labour_max, out.labour_min];
  if (out.parts_max < out.parts_min) [out.parts_min, out.parts_max] = [out.parts_max, out.parts_min];
  // Keep AI bands within 2x of the rate card so a hallucinated number cannot mislead.
  out.labour_max = Math.min(out.labour_max, card.l[1] * 2); out.labour_min = Math.min(out.labour_min, out.labour_max);
  out.parts_max = Math.min(out.parts_max, Math.max(card.p[1] * 2, 200)); out.parts_min = Math.min(out.parts_min, out.parts_max);
  out.rate_card = { labour: card.l, parts: card.p, name_en: card.en, name_hi: card.hi };
  return out;
}

function ruleQuoteVerdict(q, b) {
  const top = b.labour_max + b.parts_max, low = b.labour_min + b.parts_min;
  const diff = Math.round(q - top);
  let verdict = 'fair';
  if (q > top * 1.25 || diff > 300) verdict = 'too_high';
  else if (q > top) verdict = 'slightly_high';
  else if (low > 0 && q < low * 0.6) verdict = 'suspiciously_low';
  return { verdict, diff, band_total: [low, top] };
}

function ruleQuoteReason(v, lang) {
  const hi = lang === 'hi';
  const [lo, top] = v.band_total;
  const m = {
    fair: hi ? `₹${lo}–${top} के उचित दायरे में है।` : `It is inside the fair band of ₹${lo}–${top}.`,
    slightly_high: hi ? `उचित दायरे (₹${top}) से ₹${v.diff} ज़्यादा है। अतिरिक्त काम या पार्ट्स का कारण पूछें।` : `It is ₹${v.diff} above the fair band (₹${top}). Ask what extra work or parts need it.`,
    too_high: hi ? `उचित दायरे (₹${top}) से ₹${v.diff} बहुत ज़्यादा है।` : `It is ₹${v.diff} above the fair band (₹${top}) – too high without a clear reason.`,
    suspiciously_low: hi ? 'बहुत कम है – पूछें कि क्या पूरा काम और अच्छे पार्ट्स शामिल हैं।' : 'This is very low – check that full work and good parts are included.',
  };
  return m[v.verdict];
}

function defaultQuestions(lang) {
  return lang === 'hi'
    ? ['लेबर और पार्ट्स का अलग-अलग रेट बताइए।', 'कौन सा पार्ट बदल रहे हैं, फ़ोटो दिखाइए।', 'क्या 7 दिन की गारंटी है?']
    : ['Please tell labour and parts separately.', 'Which part will you change? Please show a photo.', 'Is there a 7-day guarantee on this work?'];
}

function aboveBandRule(lang) {
  return lang === 'hi'
    ? { title: 'Martigence नियम: तय रेट से ज़्यादा?', points: ['प्रो को कारण और फ़ोटो WhatsApp पर भेजने होंगे।', 'आप चाहें तो दूसरे प्रो से मुफ़्त दूसरा कोटेशन लें।', 'या मना करें और सिर्फ़ ₹69 विज़िट फ़ीस दें।', 'बार-बार ज़्यादा चार्ज करने वाले प्रो: चेतावनी → 2 हफ़्ते रोक → हटाया जाएगा।'] }
    : { title: 'Martigence rule: price above the locked band?', points: ['The pro must send a reason and photos on WhatsApp.', 'You can get a free second quote from another pro.', 'Or say no and pay only the ₹69 visit fee.', 'Pros who overcharge: warning → 2-week pause → removal.'] };
}

// SAMPLE pros – example data only, not real people.
const SAMPLE_PROS = [
  { name: 'Sample Pro A', skills: ['plumber', 'ro_water_purifier'], area: 'Castair Town', km: 1.2, rating: 4.7, jobs: 38, fair: 0.97, founding: true },
  { name: 'Sample Pro B', skills: ['electrician', 'appliance_repair'], area: 'Bampas Town', km: 2.5, rating: 4.8, jobs: 52, fair: 0.95, founding: true },
  { name: 'Sample Pro C', skills: ['electrician'], area: 'Jasidih', km: 7.8, rating: 4.9, jobs: 61, fair: 0.99, founding: false },
  { name: 'Sample Pro D', skills: ['carpenter', 'painter'], area: 'Tower Chowk', km: 0.8, rating: 4.4, jobs: 24, fair: 0.9, founding: true },
  { name: 'Sample Pro E', skills: ['plumber'], area: 'Baidyanath Dham area', km: 3.1, rating: 4.5, jobs: 45, fair: 0.82, founding: false },
  { name: 'Sample Pro F', skills: ['ac_technician', 'appliance_repair', 'electrician'], area: 'Rohini Road', km: 4.4, rating: 4.6, jobs: 33, fair: 0.93, founding: true },
  { name: 'Sample Pro G', skills: ['painter'], area: 'Satsang Nagar', km: 5.0, rating: 4.3, jobs: 19, fair: 0.96, founding: true },
  { name: 'Sample Pro H', skills: ['carpenter'], area: 'Bilasi Town', km: 2.0, rating: 4.7, jobs: 29, fair: 0.94, founding: false },
];

// MatchScore = public rulebook, NOT AI. Weights: skill 40, distance 25, rating 20, fair-pricing record 15.
function matchScore(category) {
  const scored = SAMPLE_PROS.map(p => {
    const skill = p.skills[0] === category ? 40 : p.skills.includes(category) ? 30 : 0;
    const distance = Math.max(0, 25 * (1 - p.km / 10));
    const rating = 20 * Math.max(0, (p.rating - 3.5) / 1.5);
    const fair = 15 * p.fair;
    const score = Math.round(skill + distance + rating + fair);
    return { ...p, score, breakdown: { skill: Math.round(skill), distance: Math.round(distance), rating: Math.round(rating), fair_pricing: Math.round(fair) } };
  });
  const matched = scored.filter(p => p.breakdown.skill > 0);
  return (matched.length ? matched : scored).sort((a, b) => b.score - a.score).slice(0, 3);
}

module.exports = { VISIT_FEE, CATEGORIES, JOBS, rateCardText, fallbackDiagnose, applyGuards, ruleQuoteVerdict, ruleQuoteReason, defaultQuestions, aboveBandRule, matchScore, detectUrgent };
