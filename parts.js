// Parts ka Sahi Daam – Parts Price Check + Bargain Helper.
// The reference table below is MARTIGENCE'S OWN ESTIMATE of typical small-city (Deoghar-type) shop prices
// for ONE unit of a common home part, in INR. It is NOT official MRP and NOT a price list from any brand or shop.
// Bands are [low, typical, high]. Gemini suggestions are clamped to these bands whenever the part matches.

const MARGIN = 0.15; // a pro may fairly add up to ~15% for travel / sourcing the part

const PARTS = {
  // Plumbing
  tap_cartridge:     { cat: 'plumbing', en: 'Tap cartridge (ceramic disc)', hi: 'नल का कार्ट्रिज', b: [150, 250, 450], brands: ['Jaquar', 'Hindware', 'Parryware', 'local'], kw: ['cartridge', 'catridge', 'spindle', 'कार्ट्रिज'] },
  tap_washer:        { cat: 'plumbing', en: 'Tap washer / rubber', hi: 'नल का वॉशर', b: [5, 15, 40], brands: ['local'], kw: ['washer', 'rubber', 'वॉशर', 'washar'] },
  bib_tap:           { cat: 'plumbing', en: 'Tap / bib cock (basic)', hi: 'नल (साधारण)', b: [150, 300, 600], brands: ['Jaquar', 'Hindware', 'Cera', 'local'], kw: ['bib', 'tap', 'taps', 'nal', 'nall', 'नल', 'टोंटी', 'tonti', 'faucet', 'bib cock', 'pillar cock'] },
  angle_valve:       { cat: 'plumbing', en: 'Angle valve', hi: 'एंगल वाल्व', b: [150, 280, 500], brands: ['Jaquar', 'Hindware', 'local'], kw: ['angle valve', 'angle cock', 'angle', 'एंगल'] },
  connection_pipe:   { cat: 'plumbing', en: 'Connection pipe (flexible hose)', hi: 'कनेक्शन पाइप', b: [70, 140, 280], brands: ['Jaquar', 'Hindware', 'local'], kw: ['connection pipe', 'connection', 'hose', 'kanekshan', 'कनेक्शन'] },
  flush_valve:       { cat: 'plumbing', en: 'Flush valve / cistern fitting set', hi: 'फ्लश वाल्व / टंकी फिटिंग', b: [250, 450, 900], brands: ['Hindware', 'Parryware', 'Cera', 'local'], kw: ['flush', 'cistern', 'फ्लश', 'flash'] },
  health_faucet:     { cat: 'plumbing', en: 'Health faucet (jet spray)', hi: 'हेल्थ फ़ॉसेट (जेट)', b: [250, 450, 900], brands: ['Jaquar', 'Hindware', 'local'], kw: ['health faucet', 'health', 'jet spray', 'jet', 'spray', 'जेट'] },
  shower:            { cat: 'plumbing', en: 'Overhead shower (basic)', hi: 'शावर', b: [150, 350, 800], brands: ['Jaquar', 'Hindware', 'local'], kw: ['shower', 'शावर', 'फव्वारा', 'showar'] },
  float_valve:       { cat: 'plumbing', en: 'Tank float / ball valve', hi: 'टंकी का बॉल वाल्व', b: [120, 220, 400], brands: ['local'], kw: ['float', 'ball valve', 'ball cock', 'बॉल'] },
  basin_waste:       { cat: 'plumbing', en: 'Washbasin waste pipe / coupling', hi: 'बेसिन वेस्ट पाइप', b: [80, 150, 300], brands: ['local'], kw: ['waste pipe', 'waste', 'coupling', 'बेसिन', 'washbasin', 'wash basin', 'basin'] },
  sink_waste:        { cat: 'plumbing', en: 'Kitchen sink waste coupling', hi: 'सिंक वेस्ट कपलिंग', b: [120, 220, 450], brands: ['local'], kw: ['sink waste', 'sink coupling', 'sink', 'सिंक'] },
  teflon_tape:       { cat: 'plumbing', en: 'Teflon (PTFE) tape roll', hi: 'टेफ्लॉन टेप', b: [10, 20, 45], brands: ['local'], kw: ['teflon', 'ptfe', 'टेफ्लॉन', 'thread tape'] },
  // Electrical
  mcb:               { cat: 'electrical', en: 'MCB (6–32A, single pole)', hi: 'MCB (सिंगल पोल)', b: [160, 240, 350], brands: ['Havells', 'Legrand', 'Schneider', 'Anchor'], kw: ['mcb', 'एमसीबी', 'breaker', 'circuit breaker'] },
  rccb:              { cat: 'electrical', en: 'RCCB / ELCB (2 pole, 25–40A)', hi: 'RCCB / ELCB', b: [1100, 1600, 2600], brands: ['Havells', 'Legrand', 'Schneider'], kw: ['rccb', 'elcb', 'आरसीसीबी', 'earth leakage'] },
  switch_modular:    { cat: 'electrical', en: 'Switch (6A modular)', hi: 'स्विच (6A)', b: [25, 45, 90], brands: ['Anchor', 'Havells', 'Legrand', 'GM'], kw: ['switch', 'स्विच', 'swich', 'svich'] },
  socket:            { cat: 'electrical', en: 'Socket (6A / 16A)', hi: 'सॉकेट', b: [50, 90, 180], brands: ['Anchor', 'Havells', 'Legrand', 'GM'], kw: ['socket', 'सॉकेट', 'plug point', 'soket'] },
  plug_top:          { cat: 'electrical', en: 'Plug top (16A)', hi: 'प्लग टॉप', b: [40, 70, 130], brands: ['Anchor', 'Havells', 'local'], kw: ['plug top', 'plug', 'प्लग'] },
  extension_board:   { cat: 'electrical', en: 'Extension board / spike guard (4 socket)', hi: 'एक्सटेंशन बोर्ड / स्पाइक गार्ड', b: [180, 350, 800], brands: ['Anchor', 'Havells', 'GM', 'Belkin', 'local'], kw: ['extension board', 'extension', 'spike guard', 'spike', 'surge protector', 'surge', 'power strip', 'multi plug', 'multiplug', 'extension cord', 'एक्सटेंशन', 'स्पाइक', 'बोर्ड', 'extention', 'exten'] },
  bulb_holder:       { cat: 'electrical', en: 'Bulb holder (B22)', hi: 'बल्ब होल्डर', b: [20, 40, 80], brands: ['Anchor', 'local'], kw: ['holder', 'होल्डर', 'lamp holder', 'batten holder'] },
  led_bulb:          { cat: 'electrical', en: 'LED bulb (9W)', hi: 'LED बल्ब (9W)', b: [60, 90, 150], brands: ['Philips', 'Syska', 'Wipro', 'Havells'], kw: ['bulb', 'बल्ब', 'led', 'balb'] },
  led_batten:        { cat: 'electrical', en: 'LED tube light / batten (20W)', hi: 'LED ट्यूबलाइट', b: [180, 280, 450], brands: ['Philips', 'Syska', 'Wipro', 'Havells'], kw: ['tube light', 'tubelight', 'tube', 'batten', 'ट्यूब', 'ट्यूबलाइट'] },
  wire_metre:        { cat: 'electrical', en: 'House wire 1.5 sq mm (per metre)', hi: 'वायर 1.5 mm (प्रति मीटर)', b: [12, 18, 28], unit_en: 'per metre', unit_hi: 'प्रति मीटर', brands: ['Havells', 'Polycab', 'Finolex', 'Anchor'], kw: ['wire', 'तार', 'वायर', 'taar', 'metre', 'meter', 'cable'] },
  door_bell:         { cat: 'electrical', en: 'Door bell', hi: 'डोर बेल', b: [120, 220, 450], brands: ['Anchor', 'local'], kw: ['door bell', 'doorbell', 'bell', 'घंटी', 'ghanti'] },
  switch_board:      { cat: 'electrical', en: 'Modular switch box + plate (4–6 module)', hi: 'स्विच बोर्ड (बॉक्स + प्लेट)', b: [120, 220, 400], brands: ['Anchor', 'Havells', 'GM', 'local'], kw: ['switch board', 'switchboard', 'modular plate', 'switch box', 'स्विच बोर्ड'] },
  // Fan
  fan_capacitor:     { cat: 'fan', en: 'Ceiling fan capacitor (2.5 µF)', hi: 'पंखे का कैपेसिटर', b: [40, 70, 130], brands: ['Havells', 'Usha', 'Epcos', 'local'], kw: ['fan capacitor', 'capacitor', 'condenser', 'कैपेसिटर', 'कंडेंसर', 'kapasitor', 'capaciter'] },
  fan_regulator:     { cat: 'fan', en: 'Fan regulator (modular)', hi: 'पंखे का रेगुलेटर', b: [150, 250, 450], brands: ['Anchor', 'Havells', 'Legrand'], kw: ['regulator', 'रेगुलेटर', 'dimmer', 'regulater'] },
  fan_bearing:       { cat: 'fan', en: 'Fan bearing (pair)', hi: 'पंखे का बेयरिंग (जोड़ी)', b: [60, 120, 220], brands: ['SKF', 'NBC', 'local'], kw: ['bearing', 'बेयरिंग', 'bearring'] },
  exhaust_fan:       { cat: 'fan', en: 'Exhaust fan (6–9 inch)', hi: 'एग्ज़ॉस्ट फ़ैन', b: [700, 1100, 1800], brands: ['Havells', 'Usha', 'Crompton', 'Bajaj'], kw: ['exhaust', 'एग्जॉस्ट', 'exaust'] },
  // Geyser
  geyser_thermostat: { cat: 'geyser', en: 'Geyser thermostat', hi: 'गीज़र थर्मोस्टैट', b: [150, 280, 500], brands: ['Racold', 'Bajaj', 'AO Smith', 'local'], kw: ['thermostat', 'थर्मोस्टैट', 'thermostet'] },
  geyser_element:    { cat: 'geyser', en: 'Geyser heating element (2 kW)', hi: 'गीज़र हीटिंग एलिमेंट', b: [250, 450, 800], brands: ['Racold', 'Bajaj', 'local'], kw: ['element', 'heating', 'एलिमेंट', 'heater coil'] },
  geyser_valve:      { cat: 'geyser', en: 'Geyser safety valve', hi: 'गीज़र सेफ़्टी वाल्व', b: [100, 180, 350], brands: ['Racold', 'local'], kw: ['safety valve', 'pressure valve', 'सेफ्टी'] },
  // RO
  ro_membrane:       { cat: 'ro', en: 'RO membrane (80 GPD)', hi: 'RO मेम्ब्रेन', b: [600, 950, 1600], brands: ['Vontron', 'CSM', 'Kent', 'Aquaguard'], kw: ['membrane', 'मेम्ब्रेन', 'membren'] },
  ro_sediment:       { cat: 'ro', en: 'RO sediment / spun filter', hi: 'RO सेडिमेंट फ़िल्टर', b: [60, 120, 220], brands: ['local', 'Kent', 'Aquaguard'], kw: ['sediment', 'spun', 'pre filter', 'prefilter', 'ro filter', 'फ़िल्टर', 'फिल्टर'] },
  ro_carbon:         { cat: 'ro', en: 'RO carbon filter', hi: 'RO कार्बन फ़िल्टर', b: [120, 220, 400], brands: ['local', 'Kent', 'Aquaguard'], kw: ['carbon', 'कार्बन'] },
  ro_pump:           { cat: 'ro', en: 'RO booster pump', hi: 'RO बूस्टर पंप', b: [900, 1400, 2200], brands: ['local', 'Kent'], kw: ['booster', 'ro pump', 'ro motor'] },
  ro_smps:           { cat: 'ro', en: 'RO SMPS / adapter (24V)', hi: 'RO SMPS / एडाप्टर', b: [300, 450, 750], brands: ['local'], kw: ['smps', 'adapter', 'adaptor', 'एडाप्टर'] },
  // AC
  ac_capacitor:      { cat: 'ac', en: 'AC compressor capacitor (35–45 µF)', hi: 'AC कंप्रेसर कैपेसिटर', b: [200, 350, 600], brands: ['Epcos', 'local'], kw: ['ac capacitor', 'compressor capacitor', 'ac condenser'] },
  ac_fan_capacitor:  { cat: 'ac', en: 'AC fan capacitor', hi: 'AC फ़ैन कैपेसिटर', b: [80, 150, 280], brands: ['Epcos', 'local'], kw: ['ac fan capacitor', 'outdoor fan capacitor'] },
  ac_gas_r32:        { cat: 'ac', en: 'AC gas refill (R32 / R22, 1–1.5 ton, full)', hi: 'AC गैस (पूरी रिफ़िल)', b: [1500, 2300, 3200], unit_en: 'per full refill', unit_hi: 'पूरी रिफ़िल', brands: ['local'], kw: ['ac gas', 'gas refill', 'gas', 'r32', 'r22', 'गैस', 'refill'] },
  // Inverter / motor
  battery_water:     { cat: 'electrical', en: 'Inverter battery distilled water (5 L)', hi: 'इन्वर्टर बैटरी का पानी (5 लीटर)', b: [50, 90, 160], brands: ['local', 'Exide', 'Luminous'], kw: ['battery water', 'distilled water', 'distilled', 'बैटरी का पानी', 'battery'] },
  motor_capacitor:   { cat: 'plumbing', en: 'Water motor capacitor', hi: 'मोटर का कैपेसिटर', b: [80, 150, 280], brands: ['Epcos', 'local'], kw: ['motor capacitor', 'pump capacitor', 'मोटर कैपेसिटर'] },
};
const PART_IDS = Object.keys(PARTS);

function refText() {
  return PART_IDS.map(k => `${k}: ${PARTS[k].en} – ₹${PARTS[k].b.join('/')}${PARTS[k].unit_en ? ' ' + PARTS[k].unit_en : ''}`).join('\n');
}

// Small edit distance for typo-tolerant matching ("extention", "capaciter").
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Best reference part for free text (English, Hinglish or Hindi). Exact words first, then typo-tolerant words.
function findPart(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ') + ' ';
  const tokens = t.trim().split(/\s+/).filter(Boolean);
  let best = null, score = 0;
  for (const [k, p] of Object.entries(PARTS)) {
    let s = 0;
    for (const w0 of p.kw) {
      const w = w0.toLowerCase();
      const ascii = /^[\x00-\x7F]+$/.test(w);
      const hit = ascii ? new RegExp(`(^|\\s)${esc(w)}(s|es)?(?=\\s|$)`).test(t) : t.includes(w);
      if (hit) { s += w.length + (w.includes(' ') ? 5 : 0); continue; }
      if (ascii && !w.includes(' ') && w.length >= 5 && tokens.some(x => x.length >= 4 && lev(x, w) <= (w.length >= 8 ? 2 : 1))) s += w.length - 1;
    }
    if (s > score) { score = s; best = k; }
  }
  return best;
}

function priceFromText(text) {
  const m = String(text || '').match(/(?:₹|rs\.?|rupees?|रु\.?|रुपये)\s*([0-9][0-9,]*)|([0-9][0-9,]{1,6})\s*(?:₹|rs|rupees?|रुपये|रु)/i);
  if (!m) return 0;
  return +String(m[1] || m[2]).replace(/,/g, '') || 0;
}

const r10 = n => Math.round(n / 10) * 10;
const posInt = (v, d) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : d);

// Clamp a [low, typical, high] suggestion to the reference band when the part matches, else just sanitise it.
function band(refId, g) {
  const ref = PARTS[refId];
  let lo = posInt(g && g.low, 0), ty = posInt(g && g.typical, 0), hi = posInt(g && g.high, 0);
  if (ref) {
    const [rl, rt, rh] = ref.b;
    if (!lo || !ty || !hi) return { low: rl, typical: rt, high: rh, from: 'reference' };
    const c = (v, a, b) => Math.min(Math.max(v, a), b);
    lo = c(lo, rl, rh); hi = c(hi, rl, rh); ty = c(ty, rl, rh);
    if (lo > hi) [lo, hi] = [hi, lo];
    ty = c(ty, lo, hi);
    return { low: lo, typical: ty, high: hi, from: 'gemini+reference' };
  }
  if (!lo && !ty && !hi) return null;
  const arr = [lo || ty || hi, ty || lo || hi, hi || ty || lo].map(v => Math.min(v, 50000)).sort((a, b) => a - b);
  return { low: arr[0], typical: arr[1], high: arr[2], from: 'gemini' };
}

// Verdict is arithmetic. Fair up to typical+15%; slightly high up to high+15%; above that overcharged.
function verdict(quoted, b, qty = 1) {
  if (!quoted || !b) return null;
  const typ = b.typical * qty, fairMax = Math.round(typ * (1 + MARGIN)), highMax = Math.round(b.high * qty * (1 + MARGIN));
  let v = 'fair';
  if (quoted > highMax) v = 'overcharged';
  else if (quoted > fairMax) v = 'slightly_high';
  else if (b.low && quoted < b.low * qty * 0.6) v = 'very_low';
  return { verdict: v, diff: Math.round(quoted - typ), typical_total: typ, fair_max: fairMax, fair_offer: r10(typ * 1.1) };
}

function templateLines(name, fair, quoted) {
  const f = `₹${fair}`;
  return [
    { hi: `भैया, ${name.hi} का डिब्बा दिखा दीजिए, उस पर MRP देख लेते हैं।`,
      hinglish: `Bhaiya, ${name.en} ka dabba dikha dijiye, MRP dekh lete hain.`,
      en: `Could you show me the box of the ${name.en}? Let us check the MRP printed on it.` },
    { hi: `बाज़ार में यह लगभग ${f} का मिलता है। ${f} में लगा दीजिए, पक्का बिल दे दीजिए।`,
      hinglish: `Market mein yeh lagbhag ${f} ka milta hai. ${f} mein laga dijiye, pakka bill de dijiye.`,
      en: `This is about ${f} in the market. Please fit it for ${f} and give me a proper bill.` },
    { hi: quoted ? `₹${quoted} ज़्यादा है। नहीं तो पार्ट मैं खुद ले आता हूँ, आप सिर्फ़ लगाने का चार्ज लीजिए।` : `ठीक है तो पार्ट मैं खुद ले आता हूँ, आप सिर्फ़ लगाने का चार्ज लीजिए।`,
      hinglish: quoted ? `₹${quoted} zyada hai. Nahi toh part main khud le aata hoon, aap sirf lagane ka charge lijiye.` : `Theek hai, part main khud le aata hoon, aap sirf lagane ka charge lijiye.`,
      en: quoted ? `₹${quoted} is too much. Otherwise I will buy the part myself, and you charge only for fitting it.` : `Otherwise I can buy the part myself, and you charge only for fitting it.` },
  ];
}

const CHECKLIST = {
  en: ['Check the MRP printed on the box', 'Ask for the old part back', 'Ask for a bill and the warranty', 'Ask for labour and parts separately'],
  hi: ['डिब्बे पर छपा MRP देखें', 'पुराना पार्ट वापस माँगें', 'बिल और वारंटी माँगें', 'लेबर और पार्ट्स का रेट अलग-अलग पूछें'],
};

// Quick-pick chips shown when a photo could not be read.
const QUICK = ['extension_board', 'switch_modular', 'socket', 'led_bulb', 'mcb', 'bib_tap', 'fan_capacitor', 'angle_valve', 'connection_pipe', 'geyser_element', 'ro_membrane', 'fan_regulator'];

module.exports = { QUICK, PARTS, PART_IDS, MARGIN, refText, findPart, priceFromText, band, verdict, templateLines, CHECKLIST, r10 };
