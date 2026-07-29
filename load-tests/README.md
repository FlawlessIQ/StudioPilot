# Asynchronous path load tests

Run the default read-only health scenario:

```bash
LOAD_BASE_URL=http://127.0.0.1:3000 npm run test:load
```

Supported scenarios are `health`, `sendgridWebhook`, `stripeWebhook`, `ai`,
`document`, `readiness`, `reconciliation`, and `email`.

Use `--iterations`, `--concurrency`, `--timeout-ms`, `--p95-ms`, and
`--error-rate` to set bounded test inputs and objectives. Production mutation
scenarios fail closed unless `ALLOW_PRODUCTION_LOAD_TEST=true` is explicitly
set. Health remains safe for production verification.
