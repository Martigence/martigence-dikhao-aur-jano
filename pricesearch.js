// Live online price search for a home-repair part.
// Prices and links are READ from public search-result pages of Indian shopping sites – never generated.
// Gemini is only used afterwards to decide which listings are the same part (relevance filter).
// Results are cached in memory for 10 minutes so a demo does not hit the sites again and again.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

const decode = s => String(s || '')
  .replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();
const num = s => { const m = String(s || '').replace(/<!--.*?-->/g, '').match(/₹\s*([0-9][0-9,]*(?:\.\d+)?)/); return m ? Math.round(+m[1].replace(/,/g, '')) : null; };

const SOURCES = [
  {
    store: 'Amazon.in', host: 'www.amazon.in',
    url: q => `https://www.amazon.in/s?k=${encodeURIComponent(q).replace(/%20/g, '+')}`,
    parse(html) {
      const out = [];
      for (const blk of html.split('data-component-type="s-search-result"').slice(1, 30)) {
        const asin = (blk.match(/data-asin="([A-Z0-9]{10})"/) || [])[1];
        const title = decode((blk.match(/<h2[^>]*aria-label="([^"]+)"/) || blk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
        const pw = (blk.match(/class="a-price-whole">([0-9,]+)/) || [])[1];
        if (asin && title && pw) out.push({ title: title.replace(/^Sponsored Ad\s*-\s*/i, ''), price: +pw.replace(/,/g, ''), url: `https://www.amazon.in/dp/${asin}` });
      }
      return out;
    },
  },
  {
    store: 'Flipkart', host: 'www.flipkart.com',
    url: q => `https://www.flipkart.com/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}`,
    parse(html) {
      // Each product card sits in <div data-id="PID">; title is the link title or the image alt.
      const out = [], seen = new Set();
      for (const blk of html.split(/<div data-id="[A-Z0-9]{8,}"/).slice(1, 40)) {
        const href = (blk.match(/href="(\/[^"]*\/p\/itm[^"?]*)/) || [])[1];
        if (!href || seen.has(href)) continue;
        const title = decode((blk.match(/<a[^>]*title="([^"]{8,400})"/) || blk.match(/<img[^>]*alt="([^"]{8,400})"/) || [])[1]);
        const price = num(blk.slice(0, 6000));
        if (title && price) { seen.add(href); out.push({ title, price, url: `https://www.flipkart.com${href}` }); }
      }
      return out;
    },
  },
  {
    store: 'IndiaMART', host: 'export.indiamart.com', wholesale: true,
        url: q => `https://export.indiamart.com/search.php?ss=${encodeURIComponent(q).replace(/%20/g, '+')}`,
    parse(html) {
      const out = [], seen = new Set();
      const re = /href="(\/products\/\?id=(\d+))[^"]*"/g;
      let m;
      while ((m = re.exec(html)) && out.length < 30) {
        if (seen.has(m[2])) continue;
        const win = html.slice(m.index, m.index + 3000);
        const end = win.indexOf('</a>');
        const card = end > 0 ? win.slice(0, end) : win;
        const title = decode((card.match(/line-clamp-2[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
        const price = num(card);
        if (title && price) { seen.add(m[2]); out.push({ title, price, url: `https://export.indiamart.com/products/?id=${m[2]}`, note: 'wholesale seller price' }); }
      }
      return out;
    },
  },
  {
    store: 'Industrybuying', host: 'www.industrybuying.com',
    url: q => `https://www.industrybuying.com/search/?q=${encodeURIComponent(q).replace(/%20/g, '+')}`,
    parse(html) {
      const out = [];
      const re = /href="(\/[^"]+)"[^>]*>\s*<span[^>]*id="search_results_title_([^"]+)"[^>]*>([\s\S]*?)<\/span>/g;
      let m;
      while ((m = re.exec(html)) && out.length < 30) {
        const id = m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pm = html.slice(m.index, m.index + 6000).match(new RegExp(`id="search_results_price_${id}"[^>]*>([\\s\\S]*?)<\\/strong>`));
        const price = pm && num(pm[1]);
        if (price) out.push({ title: decode(m[3]), price, url: `https://www.industrybuying.com${m[1]}` });
      }
      return out;
    },
  },
];

async function fetchText(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-IN,en;q=0.9' } });
    const text = r.ok ? await r.text() : '';
    return { status: r.status, text };
  } catch (e) { return { status: 0, text: '', error: e.name === 'AbortError' ? 'timeout' : 'network' }; }
  finally { clearTimeout(t); }
}

// Quick liveness check: drop only links that are clearly dead (404/410) or unreachable.
async function alive(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3500);
  try {
    const r = await fetch(url, { method: 'GET', signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, 'Range': 'bytes=0-2048' } });
    try { ctl.abort(); } catch (_) {}
    return r.status !== 404 && r.status !== 410;
  } catch (e) { return e.name === 'AbortError'; } // slow but reachable sites are kept
  finally { clearTimeout(t); }
}

const validUrl = (u, host) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname === host; } catch (_) { return false; } };

// Fallback relevance filter if Gemini is not available: every important query word must be in the title.
function wordsMatch(title, query) {
  const t = title.toLowerCase();
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2 && !['for', 'the', 'and', 'of', 'with', 'set'].includes(w));
  return words.length > 0 && words.every(w => t.includes(w));
}

/**
 * search(query, { judge, band }) → { query, results: top 3, sources, found }
 * judge(query, candidates) → Promise<array of kept indexes> (Gemini relevance filter); optional.
 */
async function search(query, { judge, band } = {}) {
  const q = String(query || '').replace(/[^\p{L}\p{N} .\-/+]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!q) return { query: q, found: false, results: [], sources: [] };
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return { ...hit.data, cached: true };

  const pages = await Promise.all(SOURCES.map(async s => {
    const url = s.url(q);
    let r = await fetchText(url);
    if (r.status === 503 || r.status === 429) { await new Promise(z => setTimeout(z, 600)); r = await fetchText(url, 6000); } // one polite retry
    let items = [];
    try { items = r.text ? s.parse(r.text) : []; } catch (_) {}
    items = items.filter(i => Number.isFinite(i.price) && i.price > 0 && i.price < 200000 && validUrl(i.url, s.host)).map(i => ({ ...i, store: s.store, retail: !s.wholesale }));
    return { source: { store: s.store, url, status: r.status, listings: items.length }, items };
  }));
  const sources = pages.map(p => p.source);
  // Take a few per store so one site cannot crowd out the rest.
  let cands = pages.flatMap(p => p.items.slice(0, 8));
  // Sanity: drop listings far outside the reference band (accessories, bulk packs, wrong item).
  if (band) cands = cands.filter(c => c.price >= band.low * 0.5 && c.price <= band.high * 5);

  // Multi-packs would make a single part look cheap or costly – drop them in code as well.
  cands = cands.filter(c => !/\b(pack|set|combo|pcs|pieces)\s*(of\s*)?-?\s*([2-9]|\d{2,})\b|\b([2-9]|\d{2,})\s*(pcs|pieces|pack)\b/i.test(c.title + ' ' + c.url.replace(/[-_/]/g, ' ')));
  let kept = null, judged_by = 'words';
  if (judge && cands.length) {
    try { const idx = await judge(q, cands); if (Array.isArray(idx)) { kept = idx.filter(i => cands[i]).map(i => cands[i]); judged_by = 'gemini'; } } catch (_) {}
  }
  if (!kept) kept = cands.filter(c => wordsMatch(c.title, q));

  // Retail shops (Amazon, Flipkart, Industrybuying) first – what a home customer can actually buy one piece at.
  // IndiaMART seller prices are often wholesale / without GST, so they only fill empty slots and are labelled.
  kept.sort((a, b) => (b.retail - a.retail) || (a.price - b.price));
  const results = [];
  const seenUrl = new Set();
  for (const c of kept) {
    if (results.length >= 3) break;
    if (seenUrl.has(c.url)) continue; seenUrl.add(c.url);
    if (await alive(c.url)) results.push({ store: c.store, title: c.title.slice(0, 140), price: c.price, url: c.url, ...(c.note ? { note: c.note } : {}), retail: c.retail });
  }
  results.sort((a, b) => a.price - b.price);
  const data = { query: q, found: results.length > 0, results, sources, judged_by, checked_at: new Date().toISOString() };
  cache.set(key, { t: Date.now(), data });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return data;
}

module.exports = { search, SOURCES };
