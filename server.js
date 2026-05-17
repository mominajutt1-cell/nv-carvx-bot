const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

function cleanValue(v) {
  if (!v) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function getShortBodyCode(body) {
  const b = cleanValue(body).toUpperCase();
  // DBA-ML21S -> ML21S, 6AA-ZVW55 -> ZVW55
  const m = b.match(/[A-Z]{1,4}\d{1,3}[A-Z]?/g);
  if (!m || !m.length) return b.replace(/[^A-Z0-9]/g, '');
  return m[m.length - 1];
}

function isBadImageUrl(url) {
  const u = String(url || '').toLowerCase();
  const bad = [
    'shopee', 'amazon', 'rakuten', 'mercari', 'aliexpress', 'alibaba', 'temu',
    'ebay', 'yahoo', 'paypayfleamarket', 'facebook', 'instagram', 'pinterest',
    'logo', 'icon', 'sprite', 'avatar', 'blank', 'placeholder', 'favicon',
    '.svg', 'base64'
  ];
  return bad.some(x => u.includes(x));
}

function sourceLooksCarRelated(text, make, model, bodyCode) {
  const t = String(text || '').toLowerCase();
  const mk = String(make || '').toLowerCase();
  const md = String(model || '').toLowerCase();
  const bc = String(bodyCode || '').toLowerCase();
  const carWords = ['car', 'vehicle', 'auto', 'automobile', 'used', 'jdm', 'nissan', 'toyota', 'honda', 'suzuki', 'mazda', 'subaru', 'mitsubishi', 'daihatsu'];

  let score = 0;
  if (mk && t.includes(mk)) score += 2;
  if (md && t.includes(md)) score += 3;
  if (bc && t.includes(bc)) score += 4;
  if (carWords.some(w => t.includes(w))) score += 1;

  // Require make+model OR bodyCode+model OR high confidence bodyCode
  return score >= 5;
}

async function findVehicleImage(fields) {
  try {
    const make = cleanValue(fields.Make);
    const model = cleanValue(fields.Model);
    const year = cleanValue(fields.Year).slice(0, 4);
    const bodyCode = getShortBodyCode(fields.Body);

    if (!make || !model) return null;

    const query = `${year} ${make} ${model} ${bodyCode} exterior car`;
    const bingUrl = 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) + '&form=HDRSC2&first=1';

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    });

    await page.goto(bingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

    const candidates = await page.evaluate(() => {
      const arr = [];
      document.querySelectorAll('a.iusc').forEach(a => {
        try {
          const m = JSON.parse(a.getAttribute('m') || '{}');
          arr.push({
            image_url: m.murl || '',
            source_page: m.purl || '',
            title: m.t || '',
            display_url: m.purl || ''
          });
        } catch (e) {}
      });
      return arr.slice(0, 20);
    });

    await browser.close();

    for (const c of candidates) {
      const allText = `${c.image_url} ${c.source_page} ${c.title} ${c.display_url}`;
      if (!c.image_url || !/^https?:\/\//i.test(c.image_url)) continue;
      if (isBadImageUrl(allText)) continue;
      if (!sourceLooksCarRelated(allText, make, model, bodyCode)) continue;

      return {
        image_url: c.image_url,
        image_query: query,
        image_source_page: c.source_page || '',
        image_title: c.title || '',
        image_body_code: bodyCode
      };
    }

    return {
      image_url: null,
      image_query: query,
      image_source_page: null,
      image_title: null,
      image_body_code: bodyCode,
      image_message: 'No trusted matching image found'
    };
  } catch (e) {
    return {
      image_url: null,
      image_error: e.message
    };
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'nv-carvx-render-bot-v3-safe-image' });
});

app.get('/lookup', async (req, res) => {
  let browser;
  try {
    let chassis = (req.query.chassis || '').trim().toUpperCase();
    chassis = chassis.replace(/\s+/g, '');

    if (!/^[A-Z0-9]{2,12}-?[A-Z0-9]{3,12}$/.test(chassis)) {
      return res.json({ ok: false, error: 'Invalid chassis number' });
    }

    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    });

    const searchUrl = 'https://carvx.jp/search/new?chassis_number=' + encodeURIComponent(chassis);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(8000);

    const finalUrl = page.url();
    const rawText = await page.evaluate(() => document.body.innerText || '');

    function getField(label, nextLabels) {
      const regex = new RegExp(label + ':\\s*(.*?)\\s*(?=' + nextLabels.join('|') + '|$)', 'i');
      const match = rawText.match(regex);
      return match ? cleanValue(match[1]) : '';
    }

    const fields = {
      Make: getField('Make', ['Body:']),
      Body: getField('Body', ['Model:']),
      Model: getField('Model', ['Engine:']),
      Engine: getField('Engine', ['Grade:']),
      Grade: getField('Grade', ['Drive:']),
      Drive: getField('Drive', ['Year:']),
      Year: getField('Year', ['Transmission:']),
      Transmission: getField('Transmission', ['Fuel:']),
      Fuel: getField('Fuel', ['JPY', 'LOGIN', '$'])
    };

    await browser.close();
    browser = null;

    const image = await findVehicleImage(fields);

    res.json({
      ok: true,
      source: 'carvx-playwright',
      chassis,
      result_url: finalUrl,
      fields,
      image_url: image && image.image_url ? image.image_url : null,
      image_query: image ? image.image_query : null,
      image_source_page: image ? image.image_source_page : null,
      image_title: image ? image.image_title : null,
      image_message: image ? image.image_message : null,
      raw_preview: rawText.substring(0, 3000),
      message: 'Result found'
    });
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    res.json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('NV CAR VX bot v3 safe image running on port ' + PORT);
});
