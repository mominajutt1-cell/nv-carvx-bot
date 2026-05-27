const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

const CARVX_USER_UID = process.env.CARVX_USER_UID;
const CARVX_API_KEY = process.env.CARVX_API_KEY;

function clean(v) {
  return (v || "").toString().replace(/\s+/g, " ").trim();
}

function signature(params, apiKey) {
  const sorted = Object.keys(params).sort();
  let str = "";
  for (const key of sorted) str += key + params[key];
  str += apiKey;
  return crypto.createHash("sha256").update(str).digest("hex");
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "nv-carvx-official-api-v1" });
});

app.get("/lookup", async (req, res) => {
  try {
    const chassis = clean(req.query.chassis).toUpperCase();

    if (!/^[A-Z0-9-]{5,30}$/.test(chassis)) {
      return res.json({ ok: false, error: "Invalid chassis number" });
    }

    if (!CARVX_USER_UID || !CARVX_API_KEY) {
      return res.json({ ok: false, error: "CAR VX API credentials not configured" });
    }

    const params = { chassis_number: chassis };
    const sig = signature(params, CARVX_API_KEY);

    const body = new URLSearchParams(params);

    const r = await fetch("https://carvx.jp/api/v1/create-search", {
      method: "POST",
      headers: {
        "Carvx-User-Uid": CARVX_USER_UID,
        "Carvx-Signature": sig,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const text = await r.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.json({ ok: false, error: "Invalid API response", status: r.status, raw: text });
    }

    if (!r.ok || json.error) {
      return res.json({ ok: false, error: json.error || "API request failed", status: r.status, raw: json });
    }

    const car = json?.data?.cars?.[0];

    if (!car) {
      return res.json({
        ok: false,
        chassis,
        error: "No vehicle found",
        raw: json
      });
    }

    const imageUrl = car.image
      ? car.image.startsWith("http")
        ? car.image
        : "https://carvx.jp" + car.image
      : null;

    return res.json({
      ok: true,
      source: "carvx-official-api",
      chassis,
      search_id: json.data.uid,
      car_id: car.car_id,
      fields: {
        Make: car.make || "*No info*",
        Body: car.body || "*No info*",
        Model: car.model || "*No info*",
        Engine: car.engine || "*No info*",
        Grade: car.grade || "*No info*",
        Drive: car.drive || "*No info*",
        Year: car.manufacture_date || "*No info*",
        Transmission: car.transmission || "*No info*",
        Fuel: car.fuel || "*No info*"
      },
      image_url: imageUrl,
      message: "Result found",
      raw: json
    });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log("NV CAR VX official API bot running on port " + PORT);
});
