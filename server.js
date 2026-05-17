
const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'nv-chassis-bot-v4-carvx-image' });
});

function cleanField(v) {
  if (!v) return '*No info*';
  return String(v).replace(/\s+/g, ' ').trim() || '*No info*';
}

function getField(rawText, label, nextLabels) {
  const regex = new RegExp(
    label + ':\\s*(.*?)\\s*(?=' + nextLabels.join('|') + '|\\n|$)',
    'i'
  );
  const match = rawText.match(regex);
  return match ? cleanField(match[1]) : '*No info*';
}

async function extractVehicleImage(page) {
  try {
    const imgs = await page.$$eval('img', (nodes) => nodes.map((img) => {
      const r = img.getBoundingClientRect();
      return {
        src: img.currentSrc || img.src || img.getAttribute('src') || '',
        alt: img.alt || '',
        title: img.title || '',
        className: img.className || '',
        id: img.id || '',
        width: img.naturalWidth || r.width || 0,
        height: img.naturalHeight || r.height || 0,
        rectWidth: r.width || 0,
        rectHeight: r.height || 0,
        top: r.top || 0,
        left: r.left || 0
      };
    }));

    const badWords = [
      'logo','icon','sprite','star','sample','report','banner','payment','visa',
      'master','paypal','cidm','loader','loading','facebook','twitter','linkedin'
    ];

    const candidates = imgs
      .filter(i => i.src && /^https?:\/\//i.test(i.src))
      .filter(i => {
        const hay = (i.src + ' ' + i.alt + ' ' + i.title + ' ' + i.className + ' ' + i.id).toLowerCase();
        if (badWords.some(w => hay.includes(w))) return false;
        if ((i.width < 120 || i.height < 80) && (i.rectWidth < 120 || i.rectHeight < 80)) return false;
        return true;
      })
      .map(i => ({
        ...i,
        score:
          (i.width || i.rectWidth) +
          (i.height || i.rectHeight) +
          ((i.left < 400 && i.top < 800) ? 400 : 0)
      }))
      .sort((a,b) => b.score - a.score);

    return candidates.length ? candidates[0].src : null;
  } catch (e) {
    return null;
  }
}

app.get('/lookup', async (req, res) => {
  let browser;
  try {
    const chassis = (req.query.chassis || '').trim().toUpperCase();

    if (!/^[A-Z0-9]{2,12}-?[A-Z0-9]{4,12}$/.test(chassis)) {
      return res.json({ ok: false, error: 'Invalid chassis number' });
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage({
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
    });

    const searchUrl = 'https://carvx.jp/search/new?chassis_number=' + encodeURIComponent(chassis);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Wait for redirect/result text
    try {
      await page.waitForFunction(() => {
        const t = document.body ? document.body.innerText : '';
        return /VEHICLE DETAILS|YOUR CAR RECORDS FOUND|NO RECORD/i.test(t);
      }, { timeout: 30000 });
    } catch (e) {
      await page.waitForTimeout(5000);
    }

    const rawText = await page.evaluate(() => document.body.innerText || '');
    const finalUrl = page.url();

    const fields = {
      Make: getField(rawText, 'Make', ['Body:']),
      Body: getField(rawText, 'Body', ['Model:']),
      Model: getField(rawText, 'Model', ['Engine:']),
      Engine: getField(rawText, 'Engine', ['Grade:']),
      Grade: getField(rawText, 'Grade', ['Drive:']),
      Drive: getField(rawText, 'Drive', ['Year:']),
      Year: getField(rawText, 'Year', ['Transmission:']),
      Transmission: getField(rawText, 'Transmission', ['Fuel:']),
      Fuel: getField(rawText, 'Fuel', ['JPY', 'LOGIN', 'CONTACT', '$'])
    };

    const carvx_image_url = await extractVehicleImage(page);

    await browser.close();

    return res.json({
      ok: true,
      source: 'vehicle-lookup-playwright',
      chassis,
      result_url: finalUrl,
      fields,
      carvx_image_url,
      image_url: carvx_image_url,
      message: 'Result found',
      raw_preview: rawText.substring(0, 2500)
    });
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch(e) {}
    }
    return res.json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log('NV chassis bot running on port ' + PORT));
