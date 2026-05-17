const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'nv-carvx-render-bot'
  });
});

app.get('/lookup', async (req, res) => {
  try {
    let chassis = (req.query.chassis || '').trim().toUpperCase();

    if (!chassis) {
      return res.json({
        ok: false,
        error: 'Invalid chassis number'
      });
    }

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox']
    });

    const page = await browser.newPage();

    const searchUrl =
      'https://carvx.jp/search/new?chassis_number=' +
      encodeURIComponent(chassis);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    await page.waitForTimeout(7000);

    const finalUrl = page.url();

    const rawText = await page.evaluate(() => {
      return document.body.innerText;
    });

    function getField(label, nextLabels) {
      const regex = new RegExp(
        label + ':\\s*(.*?)\\s*(?=' + nextLabels.join('|') + '|$)',
        'i'
      );

      const match = rawText.match(regex);

      return match ? match[1].trim() : '*No info*';
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
      Fuel: getField('Fuel', ['$'])
    };

    await browser.close();

    res.json({
      ok: true,
      source: 'carvx-playwright',
      chassis,
      result_url: finalUrl,
      fields,
      raw_preview: rawText.substring(0, 3000)
    });

  } catch (err) {

    res.json({
      ok: false,
      error: err.message
    });

  }
});

app.listen(PORT, () => {
  console.log('NV CAR VX bot running on port ' + PORT);
});
