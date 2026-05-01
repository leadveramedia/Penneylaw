# Webhook Endpoint Spec — Google Ads Lead Form (penneylaw.com)

**Owner:** website dev team
**Stakeholder:** Frank Penney Injury Law / Roger Shao
**Date:** 2026-05-01
**Status:** Spec — pending implementation
**Related:** Google Ads Lead Form Asset (created out of the ads-manager codebase)

## 1. What this is

Frank Penney Injury Law is enabling Google Ads **Lead Form Assets** across all 7 active campaigns. When someone clicks an ad and fills out the lead form (without leaving Google), Google POSTs the submission JSON to a webhook on penneylaw.com **in real time** (typically within 1-2 seconds of the user tapping submit). The webhook is the primary lead-delivery mechanism. CSV download in the Google Ads UI is the fallback.

For PI specifically, lead-response time correlates strongly with conversion — a webhook-delivered lead that hits intake within seconds is materially more valuable than a CSV pulled the next morning. The goal of this endpoint is to **receive the lead, persist it durably, and forward to intake** as fast as possible.

You don't need to know anything about Google Ads to implement this. This document is self-contained.

## 2. Endpoint requirements

### URL
- **Suggested path:** `https://penneylaw.com/api/lead-form-webhook`
- Must be HTTPS (Google rejects HTTP)
- Must be publicly reachable (no IP allowlisting against Google's IPs — they rotate)
- Path is your choice; communicate the final path back so we configure it in Google Ads

### Method + headers
- **Method:** `POST`
- **Content-Type:** `application/json`
- Google does **not** send a custom auth header. Authentication is via a signature **inside the request body** (see §4).

### Response
- **Status:** `200 OK`
- **Time budget:** must respond within **5 seconds** of receiving the request. If you exceed this, Google considers the delivery failed and retries.
- **Body:** any (Google ignores it). Empty body is fine.
- **Any non-2xx status, timeout, or connection error** triggers Google's retry mechanism.

### Retry behavior (Google → you)
If your endpoint returns non-200 or times out:
- Google retries the same lead up to **5 times** over a window of about **24 hours**
- Backoff is exponential (~10s, ~1min, ~10min, ~1hr, ~6hr — Google doesn't publish exact intervals)
- After all retries fail, the lead is preserved in Google Ads UI's CSV download (no leakage)
- Each retry includes the **same `lead_id`** — your endpoint MUST be idempotent (see §6)

## 3. Request payload schema

Google POSTs a JSON body in this shape. Field names are `snake_case`. Some fields are documented but only sometimes present; treat all as nullable except where noted.

### Full example (a real-world lead from a car-accident campaign)

```json
{
  "lead_id": "TwSlzv9KdGhpc1NpZ25hdHVyZUlzMTIz",
  "user_column_data": [
    {
      "column_id": "FULL_NAME",
      "column_name": "Full Name",
      "string_value": "Jane Doe"
    },
    {
      "column_id": "PHONE_NUMBER",
      "column_name": "Phone Number",
      "string_value": "9165551234"
    },
    {
      "column_id": "EMAIL",
      "column_name": "Email",
      "string_value": "jane.doe@example.com"
    },
    {
      "column_id": "1234567890",
      "column_name": "When did the accident happen?",
      "string_value": "Within the last 30 days"
    },
    {
      "column_id": "1234567891",
      "column_name": "What type of accident?",
      "string_value": "Car accident"
    },
    {
      "column_id": "1234567892",
      "column_name": "Were you injured?",
      "string_value": "Yes — currently treating"
    }
  ],
  "api_version": "1.0",
  "form_id": 5512345678,
  "campaign_id": 23226382784,
  "adgroup_id": 158742305472,
  "creative_id": 782349618465,
  "ad_id": 782349618465,
  "google_key": "REDACTED_HMAC_SECRET",
  "lead_id_signature": "BASE64_OF_SHA256_OF_lead_id_AND_google_key",
  "gcl_id": "Cj0KCQjw..."
}
```

### Field reference

| Field | Type | Always present? | Description |
|---|---|---|---|
| `lead_id` | string | Yes | Unique lead ID. Use as your idempotency key. |
| `user_column_data` | array | Yes | Lead's submitted answers (see below). |
| `api_version` | string | Yes | Currently `"1.0"`. Treat any other value as a reason to log + alert. |
| `form_id` | int64 | Yes | The lead form's Google asset ID. |
| `campaign_id` | int64 | Yes | The Google Ads campaign that served the ad. Useful for attribution. |
| `adgroup_id` | int64 | Yes | The ad group within the campaign. |
| `creative_id` | int64 | Sometimes | The RSA's creative ID. May equal `ad_id`. |
| `ad_id` | int64 | Yes | The specific ad shown. |
| `google_key` | string | Yes | The HMAC secret you've been given. Use to verify `lead_id_signature` (see §4). |
| `lead_id_signature` | string | Yes | Base64-encoded SHA-256 hash of `lead_id` + `google_key`. **You verify this on every request.** |
| `gcl_id` | string | Sometimes | Google Click ID — present if the user came from a click-trackable ad. Pass to your CRM if you do offline conversion uploads. |

### `user_column_data[]` field reference

Each entry is a `{column_id, column_name, string_value}` triple:

| Field | Type | Description |
|---|---|---|
| `column_id` | string | Either a known enum (`FULL_NAME`, `PHONE_NUMBER`, `EMAIL`) or a numeric custom-question ID |
| `column_name` | string | The human-readable label (e.g., "Full Name", "When did the accident happen?") |
| `string_value` | string | The user's submitted answer |

**Don't index by position** — Google may reorder fields. Index by `column_id` or by `column_name`.

The form has **6 fixed entries** in `user_column_data`:

1. `FULL_NAME` — required
2. `PHONE_NUMBER` — required (10 digits, US format, no formatting)
3. `EMAIL` — required
4. Custom Q1 — "When did the accident happen?" — single-choice from: `Within the last 30 days` / `30 days to 6 months ago` / `6 months to 2 years ago` / `More than 2 years ago`
5. Custom Q2 — "What type of accident?" — single-choice from: `Car accident` / `Truck accident` / `Motorcycle accident` / `Rideshare (Uber/Lyft/etc.)` / `Pedestrian or bicycle` / `Slip and fall or premises` / `Other`
6. Custom Q3 — "Were you injured?" — single-choice from: `Yes — currently treating` / `Yes — recovered` / `Not sure or minor injury` / `No injury`

The `column_name` for the custom questions matches the question text verbatim.

## 4. Authentication — HMAC verification

Google does **not** send an auth header. Instead, the request body contains:
- `google_key` — the secret you've been given
- `lead_id_signature` — a base64-encoded SHA-256 hash of `lead_id + google_key`

On **every request**, your endpoint must:

1. Parse the body as JSON
2. Compute `expected_signature = base64(SHA256(lead_id + google_key))`
3. Constant-time compare `expected_signature` against the request's `lead_id_signature` field
4. **If they don't match, return 401 and log the attempt** (it's either a misconfigured client or an attack)

The `google_key` your endpoint stores **must match** the secret we configure in the Google Ads asset. We'll provide it via secure channel (1Password / Bitwarden / encrypted email — your choice) after running `lead-form init --execute`. The secret is 32 url-safe base64 chars (no `/`, `+`, or padding) — example: `mZik1iCetX7JW9mes9zjlIwtWWWJ5UerV_5JFxMCNe8`.

**Do not log the `google_key` in plaintext** in your structured logs. Mask it or truncate.

### Why this scheme

The `lead_id_signature` proves Google sent the request (since only Google and you know the `google_key`). It also proves the `lead_id` wasn't tampered with — useful when Google retries the same lead. Without HMAC verification, anyone who finds the URL could forge fake leads.

## 5. Response + retry handling

### What you return to Google

| Status | Meaning to Google | Recommended use |
|---|---|---|
| `200` | Lead received, no retry | Lead is durably persisted on your side (in DB or queue). Don't return 200 before persisting. |
| `4xx` | Don't retry — client error | Return for HMAC failures, malformed JSON, etc. |
| `5xx` | Retry | Use only for transient infrastructure failures (DB down, queue unavailable). Google retries up to 5× over 24h. |
| `timeout (5s+)` | Retry | Avoid by returning 200 fast (see §6). |

### Idempotency

Because Google retries the same `lead_id` on failure, your endpoint **must be idempotent**. Two retries with the same `lead_id` should result in one CRM record, not two.

Recommended approach:
1. On receipt, check if `lead_id` already exists in your DB / queue
2. If yes → return 200 immediately (silently de-duped)
3. If no → write to DB, then return 200

**Never** rely on "we'll dedupe in the CRM" — by then it's too late and the dev team gets paged.

## 6. Implementation guidance

### Persist before responding (durability)

The simplest correct pattern:

```
1. Receive POST
2. Verify HMAC → 401 if invalid
3. Insert lead into a durable store (Postgres / SQS / DynamoDB / etc.)
4. Return 200 immediately
5. Async worker picks up from the durable store and forwards to CRM
```

**Don't** synchronously call your CRM API inside the webhook handler. CRM APIs can be slow (>5s timeout) or temporarily down — both cause Google to mark delivery failed and retry. You then risk duplicate CRM records.

### Recommended stack patterns

| Approach | Durable store | Async worker | Pros |
|---|---|---|---|
| **Database row** (simplest) | Postgres `lead_form_submissions` table with `crm_status` column | Cron job every minute pulls `WHERE crm_status='pending'` | No new infra; easy to debug |
| **Message queue** | AWS SQS / GCP Pub/Sub | Lambda / Cloud Function consumer | Auto-scales; built-in retries |
| **Event log** | Append-only log (Kafka / Redis Stream / `data/lead-form/inbox/<lead_id>.json`) | Long-running worker tails the log | Audit trail by default |

Whichever you pick, the contract is: **lead is durably stored before you return 200**.

### CRM forwarding (out of scope for this doc, but flag it)

The async worker forwards each new lead to whatever the firm uses for intake — Lead Docket, Filevine, Litify, a custom CRM, or just an email to intake. That integration is firm/website-team scope. Include retry + DLQ logic in the worker (3 retries with backoff, then DLQ + alert).

### Avoiding lead loss

If you implement a queue-based architecture (recommended), the failure modes are:
- Webhook handler fails to enqueue → return 5xx → Google retries
- Worker fails to forward to CRM → DLQ + alert → operator manually retries
- Both fail catastrophically → fallback: someone pulls leads from Google Ads UI's CSV download (the spec already enables this — it's automatic)

Translation: **as long as the webhook handler returns 200 only after durable persistence, leads cannot be lost without operator awareness.**

## 7. Logging + monitoring

### Required logging (per request)

For every webhook hit, log:
- Timestamp (ISO 8601, UTC)
- `lead_id`
- `campaign_id`, `adgroup_id`, `ad_id` (for attribution debug)
- HMAC verification result (pass / fail)
- Response status returned
- Persistence outcome (inserted / dedup / error)
- Total handler latency (ms)

**Do not log** the full `user_column_data` array in unstructured logs — it contains PII (name, email, phone). Either:
- Log only `lead_id` and let the durable store hold the PII, OR
- Use a structured-log system that respects PII filtering

**Never** log `google_key` plaintext.

### Recommended monitoring

| Metric | Why | Alert threshold |
|---|---|---|
| Webhook QPS | Detect campaign spend spikes | > 2× rolling average |
| 4xx rate | HMAC failures = misconfig or attack | Any sustained 4xx > 0 |
| 5xx rate | Infrastructure broken | > 1% over 5 min |
| Handler p99 latency | Drift toward Google's 5s timeout | > 2s p99 |
| CRM forward DLQ depth | Worker is failing | > 0 for > 5 min |
| Last successful delivery age | Detect total outage | > 30 min during business hours |

A simple dashboard with these 6 metrics is sufficient for v1.

## 8. Security

### Required

- **HTTPS only.** Reject HTTP redirects.
- **HMAC verify every request** before any business logic runs.
- **Constant-time signature comparison** (e.g., `crypto.timingSafeEqual` in Node, `hmac.compare_digest` in Python). Don't use `==`.
- **Input validation:** treat every string field as untrusted. Sanitize before SQL / shell / template usage.
- **Rate limit by IP** — Google's webhook IPs aren't documented but a sane upper bound is 100 req/min per source IP. Anything higher is suspicious.
- **PII handling per CCPA/CPRA** — leads contain protected info; storage must satisfy your existing privacy program. The privacy policy at `https://penneylaw.com/privacy-policy` already covers this.

### Optional but recommended

- Add a secondary `X-Penney-Source: google-ads-lead-form` header check (set in Google Ads if possible — TBD; this is mostly defense in depth)
- Encrypt PII at rest in the durable store
- Set `traceId` / `requestId` for cross-system correlation
- Key rotation: plan for replacing the `google_key` quarterly. The flow: generate new key → update Google Ads asset → switch endpoint to verify against either old-or-new key for a 24h overlap → drop old key. Coordinate with Roger.

## 9. Testing

### Local dev

Google does not provide a sandbox. To test locally:

1. Use the example payload from §3
2. Compute a valid `lead_id_signature` for your test secret:
   ```
   echo -n "$LEAD_ID$GOOGLE_KEY" | openssl dgst -sha256 -binary | base64
   ```
3. Send to your local endpoint via `curl` and verify HMAC pass + 200

### Staging integration test

When the asset is approved by Google and live (typically 1-3 business days post-submission):

1. Configure the asset's webhook to point at a staging URL
2. Use Google Ads UI's **"Preview"** tool (Ads & assets → Lead form → Preview) to submit a test lead
3. Verify your staging logs show: HMAC pass, 200 returned, lead persisted, CRM forwarded
4. Verify the same lead in CSV download (Ads & assets → Lead form → Download leads)
5. Switch the webhook URL to production

### Failure-mode tests

- Send request with **invalid `lead_id_signature`** → expect 401
- Send request with **malformed JSON** → expect 400
- Send the **same `lead_id` twice** → expect 200 + 200, but only **1** record in DB / **1** CRM call
- Simulate **CRM forward failure** → expect lead in DLQ, alert fires
- Take the durable store **offline** during a request → expect 5xx, expect Google to retry within ~10s

## 10. Code examples

These are reference implementations. Adjust to your stack.

### Node.js / Express

```js
const express = require('express');
const crypto = require('crypto');
const app = express();

// Read raw body for HMAC verification
app.use('/api/lead-form-webhook', express.raw({ type: 'application/json' }));

const GOOGLE_KEY = process.env.GOOGLE_LEAD_FORM_KEY; // from secrets manager

app.post('/api/lead-form-webhook', async (req, res) => {
  const start = Date.now();
  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch (e) {
    console.warn({ event: 'lead_form.malformed_json' });
    return res.status(400).end();
  }

  // 1. Verify HMAC
  const { lead_id, lead_id_signature } = body;
  if (!lead_id || !lead_id_signature) {
    return res.status(400).end();
  }
  const expected = crypto
    .createHash('sha256')
    .update(lead_id + GOOGLE_KEY)
    .digest('base64');
  const providedBuf = Buffer.from(lead_id_signature);
  const expectedBuf = Buffer.from(expected);
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    console.warn({ event: 'lead_form.hmac_fail', lead_id });
    return res.status(401).end();
  }

  // 2. Idempotent insert into durable store
  try {
    const inserted = await db.leadForms.insertIfNew({
      lead_id,
      campaign_id: body.campaign_id,
      ad_id: body.ad_id,
      payload: body,
      received_at: new Date(),
      crm_status: 'pending',
    });
    console.info({
      event: 'lead_form.received',
      lead_id,
      campaign_id: body.campaign_id,
      duplicate: !inserted,
      latency_ms: Date.now() - start,
    });
    return res.status(200).end();
  } catch (err) {
    console.error({ event: 'lead_form.persist_error', lead_id, err: err.message });
    return res.status(500).end();
  }
});

app.listen(3000);
```

### Python / FastAPI

```python
import base64
import hashlib
import hmac
import os
import time
from fastapi import FastAPI, Request, HTTPException, status

app = FastAPI()
GOOGLE_KEY = os.environ["GOOGLE_LEAD_FORM_KEY"]

@app.post("/api/lead-form-webhook")
async def lead_form_webhook(request: Request):
    start = time.time()
    raw = await request.body()
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="malformed_json")

    lead_id = body.get("lead_id")
    sig = body.get("lead_id_signature")
    if not lead_id or not sig:
        raise HTTPException(status_code=400, detail="missing_fields")

    expected = base64.b64encode(
        hashlib.sha256((lead_id + GOOGLE_KEY).encode("utf-8")).digest()
    ).decode("ascii")
    if not hmac.compare_digest(expected, sig):
        # log without leaking secret
        print({"event": "lead_form.hmac_fail", "lead_id": lead_id})
        raise HTTPException(status_code=401, detail="bad_signature")

    inserted = await db.lead_forms.insert_if_new(
        lead_id=lead_id,
        campaign_id=body.get("campaign_id"),
        ad_id=body.get("ad_id"),
        payload=body,
    )
    print({
        "event": "lead_form.received",
        "lead_id": lead_id,
        "duplicate": not inserted,
        "latency_ms": int((time.time() - start) * 1000),
    })
    return {"ok": True}
```

### Go (sketch)

```go
func leadFormHandler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    var payload struct {
        LeadID    string `json:"lead_id"`
        Signature string `json:"lead_id_signature"`
        // ... other fields
    }
    if err := json.Unmarshal(body, &payload); err != nil {
        http.Error(w, "", 400)
        return
    }
    h := sha256.Sum256([]byte(payload.LeadID + googleKey))
    expected := base64.StdEncoding.EncodeToString(h[:])
    if subtle.ConstantTimeCompare([]byte(expected), []byte(payload.Signature)) != 1 {
        http.Error(w, "", 401)
        return
    }
    if err := db.InsertIfNew(payload.LeadID, body); err != nil {
        http.Error(w, "", 500)
        return
    }
    w.WriteHeader(200)
}
```

## 11. Deployment checklist

Before pointing Google Ads at the production endpoint:

- [ ] Endpoint is HTTPS with a valid cert (no self-signed)
- [ ] Endpoint returns 200 within 5s for valid signed requests
- [ ] Endpoint returns 401 for invalid signatures
- [ ] Endpoint returns 400 for malformed JSON
- [ ] Endpoint is idempotent on `lead_id` (verified via local tests in §9)
- [ ] Durable store provisioned (DB / queue) and tested
- [ ] CRM forwarding worker deployed + monitored
- [ ] Logging configured (no `google_key` plaintext, no PII in unstructured logs)
- [ ] Monitoring + alerts wired (6 metrics from §7)
- [ ] DLQ configured + alert on depth > 0
- [ ] Privacy policy page (`/privacy-policy`) confirmed live ✓ (already verified 2026-05-01)
- [ ] `google_key` securely transferred to dev team (via 1Password / encrypted channel)
- [ ] Production URL communicated back to Roger so he can configure it in Google Ads

## 12. Acceptance criteria

The endpoint is "done" when **all** of:

1. End-to-end test from Google Ads UI's "Preview" tool succeeds: lead arrives in the durable store within 2s of submission
2. Failure-mode tests from §9 all pass
3. Monitoring + alerts are firing (verify with a synthetic invalid-HMAC request that should trigger the 4xx alert)
4. CRM team confirms 5 consecutive test leads forwarded successfully
5. p99 handler latency < 2s under realistic load (50 concurrent requests)

## 13. References

- Google Ads Lead Form Asset overview: <https://developers.google.com/google-ads/api/docs/assets/lead-form>
- Webhook delivery setup: <https://support.google.com/google-ads/answer/9418798>
- Lead Form Asset proto reference (v23): `LeadFormAsset`, `LeadFormDeliveryMethod`, `WebhookDelivery`
- HMAC-SHA256 in Python: <https://docs.python.org/3/library/hmac.html#hmac.compare_digest>
- HMAC-SHA256 in Node: <https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b>
- Privacy policy (live, CCPA-compliant): <https://penneylaw.com/privacy-policy>

---

**Questions / blockers** → ping Roger Shao (roger.shao@gmail.com / rshao@mcnicholaslaw.com).
