const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 10000;

function clean(v) {
  if (!v) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function normalizeBodyCode(body) {
  body = clean(body).toUpperCase();
  // CAR VX often returns DBA-E12 / DAA-ZVW30 etc. Use last code part for image search.
  const parts = body.split('-');
  return clean(parts[parts.length - 1] || body);
}

function getFieldFromText(text, label, nextLabels) {
  const regex = new RegExp(label + ':\\s*(.*?)\\s*(?=' + nextLabels.join('|') + '|$)', 'i');
  const match = text.match(regex);
  return match ? clean(match[1]) : '';
}

async function findVehicleImage(fields) {
  const make = clean(fields.Make);
  const model = clean(fields.Model);
  const year = clean(fields.Year).slice(0, 4);
  const bodyCode = normalizeBodyCode(fields.Body);

  if (!make || !model) return null;

  const query = clean(`${year} ${make} ${model} ${bodyCode} exterior car`);
  const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) + '&form=HDRSC2&first=1';

  try {
    const html = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8'
      }
    });

    const $ = cheerio.load(html.data);
    const candidates = [];

    $('a.iusc').each((i, el) => {
      const m = $(el).attr('m');
      if (!m) return;
      try {
        const data = JSON.parse(m.replace(/&quot;/g, '"'));
        const img = data.murl || data.turl;
        const page = data.purl || '';
        if (img && /^https?:\/\//i.test(img)) {
          candidates.push({ image_url: img, source_page: page });
        }
      } catch (e) {}
    });

    // Fallback to normal image tags if Bing markup changes
    if (!candidates.length) {
      $('img').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && /^https?:\/\//i.test(src) && !src.includes('logo') && !src.includes('svg')) {
          candidates.push({ image_url: src, source_page: url });
        }
      });
    }

    const blocked = ['logo', 'icon', 'favicon', 'sprite', 'blank', 'transparent'];
    const good = candidates.find(c => !blocked.some(b => c.image_url.toLowerCase().includes(b)));

    if (!good) return { query, image_url: null, source_page: url };
    return { query, image_url: good.image_url, source_page: good.source_page || url };
  } catch (e) {
    return { query, image_url: null, error: e.message };
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'nv-carvx-render-bot', version: '2.0.0' });
});

app.get('/lookup', async (req, res) => {
  let browser;
  try {
    const chassis = clean(req.query.chassis || '').toUpperCase();
    if (!/^[A-Z0-9]{2,12}-?[A-Z0-9]{3,12}$/.test(chassis)) {
      return res.json({ ok: false, error: 'Invalid chassis number' });
    }

    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    });

    const searchUrl = 'https://carvx.jp/search/new?chassis_number=' + encodeURIComponent(chassis);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Wait until result text appears or page redirects. CAR VX is JS-driven, so give it time.
    try {
      await page.waitForFunction(() => document.body && /VEHICLE DETAILS|YOUR CAR RECORDS FOUND|NO RECORD|NOT FOUND|JPY/i.test(document.body.innerText), null, { timeout: 25000 });
    } catch (e) {
      await page.waitForTimeout(7000);
    }

    const finalUrl = page.url();
    const rawText = await page.evaluate(() => document.body.innerText || '');

    const fields = {
      Make: getFieldFromText(rawText, 'Make', ['Body:']),
      Body: getFieldFromText(rawText, 'Body', ['Model:']),
      Model: getFieldFromText(rawText, 'Model', ['Engine:']),
      Engine: getFieldFromText(rawText, 'Engine', ['Grade:']),
      Grade: getFieldFromText(rawText, 'Grade', ['Drive:']),
      Drive: getFieldFromText(rawText, 'Drive', ['Year:']),
      Year: getFieldFromText(rawText, 'Year', ['Transmission:']),
      Transmission: getFieldFromText(rawText, 'Transmission', ['Fuel:']),
      Fuel: getFieldFromText(rawText, 'Fuel', ['JPY', 'LOGIN', 'CONTACT', '$'])
    };

    const found = !!(fields.Make || fields.Model || fields.Body);
    const image = found ? await findVehicleImage(fields) : null;

    res.json({
      ok: found,
      source: 'carvx-playwright',
      chassis,
      result_url: finalUrl,
      fields,
      image_url: image && image.image_url ? image.image_url : null,
      image_query: image && image.query ? image.query : null,
      image_source_page: image && image.source_page ? image.source_page : null,
      raw_preview: rawText.substring(0, 3000),
      message: found ? 'Result found' : 'No vehicle details found'
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
});

app.listen(PORT, () => {
  console.log('NV CAR VX bot running on port ' + PORT);
});
