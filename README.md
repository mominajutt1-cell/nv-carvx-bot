# NV CAR VX Railway Bot

Railway setup:
1. Upload these files to GitHub repo.
2. Deploy repo on Railway.
3. Add environment variables:
   - NV_API_KEY = your-secret-key
   - ALLOWED_ORIGIN = https://www.nipponvehicles.com
4. Use this endpoint in WordPress plugin:
   https://YOUR-RAILWAY-DOMAIN.up.railway.app/lookup

Test with curl:

curl -X POST https://YOUR-RAILWAY-DOMAIN.up.railway.app/lookup \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key" \
  -d '{"chassis":"E12-329703"}'
