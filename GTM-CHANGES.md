# GTM-PC9XN9DP — audit record and remaining work

Audit of container **v20** (2026-07-30) plus the fixes applied. **Live version is now 22**,
published 2026-07-30, containing all four container fixes.

Re-run the audit any time with `npm run audit:gtm` — it parses the *public* compiled container,
needs no credentials, and exits non-zero on unaccepted high-severity findings. It currently
**passes** (re-run 2026-10-07 against **v25**; its resource parser now skips braces inside
strings, which Custom HTML tags had started to break).

## Tooling

| Script | Auth | Purpose |
|---|---|---|
| `scripts/gtm-audit.mjs` | none | Audits the live published container. Safe to run anywhere. |
| `scripts/gtm-apply.mjs` | keyless impersonation | Applies fixes into a new workspace and creates a version. **Never publishes** — no publish code path exists in the file. |

`gtm-apply.mjs` auth is keyless service-account impersonation:

```bash
gcloud auth login
export GTM_IMPERSONATE_SA=penneylaw@brilliant-dock-493920-q2.iam.gserviceaccount.com
node scripts/gtm-apply.mjs --plan            # read-only
node scripts/gtm-apply.mjs --apply=f1,f2     # -> new workspace -> new version, unpublished
```

Plain gcloud ADC does **not** work: Google restricts gcloud's shared OAuth client to a scope
allowlist excluding `tagmanager.*` ("This app is blocked"). Service-account *keys* are also
blocked by the `iam.disableServiceAccountKeyCreation` org policy. Impersonation satisfies both,
because the tagmanager scopes are requested on the *impersonated* token via the IAM Credentials
API and no key is ever created. Requires `roles/iam.serviceAccountTokenCreator` on the service
account (project Owner is deliberately **not** sufficient), `iamcredentials.googleapis.com`
enabled, and the service account added under GTM → Admin → Container → User Management with
**Edit**.

## Applied in v22

| Fix | What changed |
|---|---|
| **f1** | Deleted `Consent - Default (denied)` — a second `consent default` command with `wait_for_update: "0"` that denied `functionality_storage` and `security_storage`, contradicting the head snippet in `js/component-loader.js`. A fossil from the Mar 4 → Apr 22 window when the site had no consent mode of its own. |
| **f2** | Conversion Linker: `enableUrlPassthrough: true`, and linker domains pruned **140 → 3**. This preserves gclid when `ad_storage` is denied (the default state) — gclid is what the Zapier/CallRail offline import matches on, so this was the highest-value fix. |
| **f3** | `Enhanced conversion tag` repointed from an **AUTO**-mode variable (which scraped the DOM and could send the firm's own `(888) 888-0566` as the lead's phone) to the CODE-mode `UPD - Lead Form User Data`, which reads the `leadsUserData` dataLayer variable. Its trigger moved off `gtm.formSubmit` (every submit *attempt*, including invalid) onto `form_conversion`. Both AUTO variables deleted. |
| **f4** | Created Custom Event trigger `form_conversion`; repointed `PPC Landing Page Submission` onto it, off `Page URL contains "thank-you"` (which re-fired on refresh, back-nav and direct hits). |

**The PRIMARY tel: click conversion (`pEKdCNrT-cobELiOuLBB`) was never touched**, so Maximize
Conversion Value bidding was not disturbed.

### Correction worth recording

Enhanced Conversions is **not** a checkbox on the `awct` conversion tag. That tag stores no EC
parameters at all, and writing them there is silently accepted and ignored. EC lives on the
separate Ads User-Provided Data (`awud`) tag via its `userDataVariable`. An earlier draft of
this document said otherwise; `gtm-apply.mjs` caught it by verifying its own writes against the
compiled container rather than trusting an HTTP 200.

Also: **do not hash `leadsUserData` in site code.** GTM's Ads tag hashes client-side; hashing
first would double-hash and break matching. `thank-you.html` pushes it raw on purpose.

## The two recurring Google action items

Both were diagnosed empirically against production and fixed in site code (not the container).

**"Additional domains detected for configuration"** — `penneylaw.netlify.app` returned HTTP 200
and served `bundle.min.js`, i.e. the **live production container**, with no hostname gate
anywhere. Every deploy preview fired the real container, so Google kept detecting the tag on
those hostnames and prompting; accepting repeatedly is how 137 ephemeral `--hash.netlify.app`
hostnames accumulated in the linker config. Worse: QA traffic counted as real sessions, test
form submissions booked real conversions, and internal phone-link clicks fed the PRIMARY
conversion driving Smart Bidding.

*Fix:* the GTM snippet is now gated to `penneylaw.com` / `www.penneylaw.com` in both
`js/component-loader.js` and `lp-source/template.html`. Verified: on a non-production hostname
the page now contacts only Google Fonts. Tag QA is unaffected — GTM Preview runs against
production, which is allowed. Side benefit: GTM no longer fires on `localhost`.

**"Your website's security settings are blocking measurement"** — captured live: exactly one
host, `https://analytics.google.com`, violating `connect-src`. It is a *different domain* from
`www.google-analytics.com` and is not matched by `*.google-analytics.com` or `www.google.com`.
GA4 posts there when Google Ads linking / Google signals is enabled.

*Fix:* added `https://analytics.google.com` and `https://*.analytics.google.com` to
`connect-src` and `img-src` in `netlify.toml`. All other third-party hosts already passed
(`ad.doubleclick.net`, `stats.g.doubleclick.net`, `googleads.g.doubleclick.net`, four Clarity
hosts, two CallRail hosts).

## Remaining

0. **GA4 is not receiving a valid tag (found 2026-10-07, container v25).** The Google Tag
   `tag4` uses `G-TWVJZPG4DG`, and `https://www.googletagmanager.com/gtag/js?id=G-TWVJZPG4DG`
   returns **404** (the Ads tag `AW-17549887288` returns 200). Google answers 404 for a tag ID
   with no live data stream, so GA4 is most likely recording nothing. GA4 also has no event
   tags (`npm run audit:gtm`: `ga4-no-events`), so even a working tag would only send page
   views. To fix, in this order:
   1. GA4 → Admin → Data streams → Web: copy the stream's Measurement ID. If there is no web
      stream for penneylaw.com, create one (or decide GA4 isn't wanted and delete `tag4`).
   2. GTM → `tag4` (Google Tag): replace `G-TWVJZPG4DG` with that ID (or store it in a
      Constant variable — the audit flags the hard-coded literal).
   3. Optional: a GA4 Event tag for `form_conversion` (the trigger f4 created) so leads show up
      in GA4; phone clicks can reuse the PRIMARY tel: trigger.
   4. Preview, then publish. Verify: `curl -s -o /dev/null -w '%{http_code}'
      'https://www.googletagmanager.com/gtag/js?id=<new id>'` → 200.

1. **Accept Enhanced Conversions for Leads terms** in Google Ads → Goals → Conversions →
   Settings. No API can do this, and f3 is inert without it.
2. **Paid-social pixels (f5/f6).** Need a TikTok Pixel ID and Meta Pixel ID, then:
   ```bash
   TIKTOK_PIXEL_ID=... META_PIXEL_ID=... node scripts/gtm-apply.mjs --apply=f5,f6
   ```
   Both fire a **generic** event on `form_conversion` with no page path, practice area, or
   value — deliberate, given Meta Pixel litigation around health-adjacent data on
   personal-injury sites.
3. **OpenAI / ChatGPT ads pixel (f7).** Create a Pixel ID in ChatGPT Ads Manager → Conversions,
   then:
   ```bash
   OPENAI_PIXEL_ID=... node scripts/gtm-apply.mjs --apply=f7
   ```
   Unlike f5/f6 the base tag fires on **All Pages** — the click id (`oppref`) lands on the entry
   URL and the SDK cookies it there. Events: `lead_created` on `form_conversion`, custom
   `phone_click` on the PRIMARY tel: trigger (reused, not modified). No values; user data
   is added by f8.
   Consent is **opt-out** (owner's call): on unless `penney_consent` is denied or GPC is set;
   `js/consent.js` re-syncs it on a mid-page choice. **Automatic Advanced Matching is always on**:
   OpenAI enables it server-side (`bzrcdn.openai.com/pixel-config/v1/<pixel>.json`) and there is
   no switch in Ads Manager or the SDK. Checked 2026-10-06 against SDK 0.1.41: it reads email /
   phone / name from form inputs via document-level listeners, not page text, so the footer's
   `info@penneylaw.com` is not picked up. It does read the mass tort intake forms too; the owner
   chose to keep the pixel there because ChatGPT ads drive those campaigns.
   CSP hosts (`bzrcdn.openai.com`, `bzr.openai.com`) are already in `netlify.toml` — deploy the
   site before publishing the container version.
3a. **OpenAI user data + Conversions API (f8).** Clears Ads Manager's "missing user data" and
   "no recent server-to-server events" warnings. Deploy the site first, then:
   ```bash
   node scripts/gtm-apply.mjs --apply=f8    # pixel id is read from the live Init tag
   ```
   The Lead tag re-inits the pixel with SHA-256 email/phone/name from `leadsUserData` and sends
   `event_id` = `conversion_event_id`. `netlify/functions/submission-created.js` sends the same
   lead server-side with the same id, so OpenAI counts it once. Set `OPENAI_PIXEL_ID` and
   `OPENAI_CAPI_KEY` (Ads Manager → Conversions) in Netlify env; without both it sends nothing.
   Our code never sends explicit data or server events for: mass tort intake forms
   (`data-no-enhanced-conversions`), opted-out visitors (`penney_consent` denied / GPC), Google
   Ads lead-form posts. (Automatic Advanced Matching still reads the intake forms — see 3.)
   Disclosed in privacy-policy.html.
4. **Instagram conversion optimization requires leaving boosted posts** — in-app boosts can't
   optimize toward a pixel conversion.
5. **Watch Google Ads for 48h.** The thank-you conversion (Secondary) should drop to an honest
   number; the tel: click conversion (Primary) should not move.

## Consciously accepted — not changing

- **CallRail and Clarity fire before consent.** Raised, including that Clarity records form
  interactions; the decision is to gate neither. CallRail sits upstream of the gclid capture the
  Zapier revenue pipeline depends on.
- **Bidding optimizes tel: clicks, not connected calls.** Deliberate — clicks give Smart Bidding
  the volume and recency it needs. Revisit if per-campaign call volume supports ~30+/month.
- **`phone_click` and `form_submit` remain dead events** (pushed by the site, no triggers). Phone
  conversions work via GTM's native link-click listener, independent of `ad-tracking.js`.
- **No differentiated lead values**; real values enter via the Zapier import.
- **17 orphan variables and hardcoded measurement IDs** — cosmetic.

## Rollback

- Unpublished workspace: GTM → Workspace → Actions → Delete.
- Published version: Versions → pick previous → **Publish**. GTM retains v20 indefinitely.
