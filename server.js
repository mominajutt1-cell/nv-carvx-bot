const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET = process.env.NV_CARVX_SECRET || '';

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'nv-carvx-render-bot' });
});

function cleanChassis(input) {
  return String(input || '').trim().toUpperCase().replace(/\s+/g, '');
}

function validChassis(chassis) {
  return /^[A-Z0-9]{2,12}-?[0-9]{4,10}$/.test(chassis);
}

app.get('/lookup', async (req, res) => {
  try {
    if (SECRET && req.query.key !== SECRET) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const chassis = cleanChassis(req.query.chassis || req.query.chassis_number);
    if (!validChassis(chassis)) {
      return res.status(400).json({ ok: false, error: 'Invalid chassis number' });
    }

    const url = `https://carvx.jp/search/new?chassis_number=${encodeURIComponent(chassis)}`;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(7000);

    // Try to wait for navigation/result content if CAR VX redirects after searching.
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch (e) {}

    const finalUrl = page.url();
    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');

    // Basic extraction from visible text. CAR VX layout can change, so keep flexible.
    const fields = {};
    const wanted = ['Make','Model','Grade','Year','Body','Body Type','Engine','Transmission','Fuel','Drive','Color','Doors','Seats'];
    const lines = bodyText.split('\n').map(s => s.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const key = lines[i].replace(':','').trim();
      if (wanted.some(w => key.toLowerCase() === w.toLowerCase())) {
        const value = lines[i + 1] || '';
        if (value && value.length < 100) fields[key] = value;
      }
      const m = lines[i].match(/^([A-Za-z ]{3,30})\s*[:：]\s*(.+)$/);
      if (m && wanted.some(w => m[1].trim().toLowerCase() === w.toLowerCase())) {
        fields[m[1].trim()] = m[2].trim();
      }
    }

    await browser.close();

    return res.json({
      ok: true,
      source: 'carvx-playwright',
      chassis,
      result_url: finalUrl,
      title,
      fields,
      raw_preview: bodyText.slice(0, 1200)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`NV CAR VX bot running on port ${PORT}`);
});
