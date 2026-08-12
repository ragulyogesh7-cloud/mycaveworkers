# Caveworkers deployment gate

Caveworkers must not be exposed publicly until all conditions below are true.

1. Set `CAVEWORKERS_ENV=production`, a public HTTPS `ALLOWED_ORIGINS`, and a managed secret-store injection path. Never bake `.env` into an image.
2. Rotate the Firebase service account, Flask secret, Razorpay secret/webhook secret, OAuth client secret, encryption key, and any connector tokens before the first deployment.
3. Deploy the control plane and specialist services separately. Keep specialist traffic on a private network and authenticate service-to-service calls.
4. Use managed durable storage with tested backups and point-in-time recovery. The bundled SQLite store is for local development and private alpha only; migrate it to managed Postgres before a public multi-instance launch.
5. Use an external rate limiter and task queue for multiple instances. The bundled in-memory limiter is intentionally local-process only.
6. Configure error monitoring, availability checks, alert routing, a support inbox, incident response ownership, and a restore drill.
7. Complete legal review for Terms, Privacy Policy, DPA, retention/deletion/export, model-data handling, and subprocessor disclosure.

## Safe release checks

```powershell
python -m compileall -q .
python .\test_phase1.py
python .\test_phase2.py
python .\test_phase3.py
python .\test_phase4.py
python .\test_production_controls.py
python .\test_route_controls.py
```

The application fails closed in production when public origins, required identity configuration, token encryption, or a configured payment webhook secret are missing. Global Slack, Notion, and SQL credentials are disabled in production; attach employee/workspace-scoped OAuth or MCP connections instead.
