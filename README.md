# NV CAR VX Render Bot

Deploy on Render as Docker Web Service.

Endpoints:
- /health
- /lookup?chassis=E12-329703

Optional env var:
- NV_CARVX_SECRET=your-secret-key
Then use /lookup?chassis=E12-329703&key=your-secret-key
