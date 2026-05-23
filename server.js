const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'nv-chassis-bot-v7-wait-fix'
  });
});

function clean(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function getField(text, label, nextLabels) {
  const regex = new RegExp(
    label + ':\\s*(.*?)\\s*(?=' + nextLabels.join('|') + '|\\n|$)',
    'i'
  );
  const match = text.match(regex);
  return match ? clean(match[1]) : '*No info*';
}

app.get('/lookup', async (req, res) => {
  let browser;

  try {
    const chassis = clean(req.query.chassis || '').toUpperCase();

    if (!/^[A-Z0-9-]{5,25}$/.test(chassis)) {
      return res.json({
        ok: false,
        error: 'Invalid chassis number'
      });
    }

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      locale: 'en-US'
    });

    const page = await context.newPage();

    const searchUrl =
      'https://carvx.jp/search/new?chassis_number=' +
      encodeURIComponent(chassis);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return (
        !t.includes('Searching in our database') ||
        location.href.includes('/search/car') ||
        location.href.includes('/search/error-occurred')
      );
    }, { timeout: 60000 }).catch(() => {});

    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const rawText = await page.evaluate(() => document.body.innerText || '');

    if (
      finalUrl.includes('/search/error-occurred') ||
      rawText.toUpperCase().includes('SEARCH ERROR OCCURRED') ||
      rawText.toUpperCase().includes('AN ERROR OCCURRED WHILE SEARCHING')
    ) {
      await browser.close();
      return res.json({
        ok: false,
        source: 'vehicle-lookup-playwright',
        chassis,
        result_url: finalUrl,
        error: 'Vehicle data is temporarily unavailable. Please try again later.',
        raw_preview: rawText.substring(0, 1500)
      });
    }

    if (!rawText.toUpperCase().includes('VEHICLE DETAILS')) {
      await browser.close();
      return res.json({
        ok: false,
        source: 'vehicle-lookup-playwright',
        chassis,
        result_url: finalUrl,
        error: 'No vehicle details found.',
        raw_preview: rawText.substring(0, 1500)
      });
    }

    const fields = {
      Make: getField(rawText, 'Make', ['Body:']),
      Body: getField(rawText, 'Body', ['Model:']),
      Model: getField(rawText, 'Model', ['Engine:']),
      Engine: getField(rawText, 'Engine', ['Grade:']),
      Grade: getField(rawText, 'Grade', ['Drive:']),
      Drive: getField(rawText, 'Drive', ['Year:']),
      Year: getField(rawText, 'Year', ['Transmission:']),
      Transmission: getField(rawText, 'Transmission', ['Fuel:']),
      Fuel: getField(rawText, 'Fuel', ['JPY', 'LOGIN', 'CONTACT'])
    };

    let carvx_image_url = null;

    const imgs = await page.$$eval('img', imgs =>
      imgs
        .map(img => img.src)
        .filter(src => src && src.startsWith('http'))
        .filter(src => !src.toLowerCase().includes('logo'))
        .filter(src => !src.toLowerCase().includes('icon'))
        .filter(src => !src.toLowerCase().includes('sample'))
    );

    if (imgs.length) {
      carvx_image_url = imgs[0];
    }

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
      raw_preview: rawText.substring(0, 3000)
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return res.json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('NV chassis bot v7 running on port ' + PORT);
});
