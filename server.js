const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.NV_API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));

function normalizeChassis(input) {
  return String(input || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isValidChassis(chassis) {
  return /^[A-Z0-9]{2,12}-?[0-9]{4,9}$/.test(chassis);
}

function textClean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

async function extractData(page) {
  return await page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const result = {};

    // Extract table key/value rows if present
    document.querySelectorAll('tr').forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('th,td')).map(el => clean(el.innerText));
      if (cells.length >= 2 && cells[0] && cells[1]) {
        result[cells[0].replace(/:$/, '')] = cells.slice(1).join(' ');
      }
    });

    // Extract dl dt/dd pairs if present
    document.querySelectorAll('dt').forEach((dt) => {
      const dd = dt.nextElementSibling;
      if (dd) result[clean(dt.innerText).replace(/:$/, '')] = clean(dd.innerText);
    });

    // common labeled blocks
    const bodyText = clean(document.body.innerText);
    return { result, bodyText, title: document.title };
  });
}

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'NV CAR VX Railway Bot', usage: 'POST /lookup { chassis }' });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/lookup', async (req, res) => {
  try {
    if (API_KEY) {
      const key = req.headers['x-api-key'] || req.body.api_key;
      if (key !== API_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const chassis = normalizeChassis(req.body.chassis || req.query.chassis);
    if (!isValidChassis(chassis)) {
      return res.status(400).json({ ok: false, error: 'Invalid chassis format', chassis });
    }

    const url = `https://carvx.jp/search/new?chassis_number=${encodeURIComponent(chassis)}`;
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Wait for page text to change after JS lookup, but don't fail if it doesn't.
    await page.waitForTimeout(8000);

    const currentUrl = page.url();
    const extracted = await extractData(page);
    await browser.close();

    const lower = extracted.bodyText.toLowerCase();
    const stillSearching = lower.includes('searching in our database') || lower.includes('please wait');

    res.json({
      ok: true,
      source: 'railway-playwright',
      chassis,
      url,
      currentUrl,
      stillSearching,
      title: extracted.title,
      data: extracted.result,
      textPreview: extracted.bodyText.slice(0, 2500)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`NV CAR VX bot running on port ${PORT}`));
