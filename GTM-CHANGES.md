# GTM-PC9XN9DP — audit record and remaining work

Audit of container **v20** (2026-07-30) plus the fixes applied. **Live version is now 22**,
published 2026-07-30, containing all four container fixes.

Re-run the audit any time with `npm run audit:gtm` — it parses the *public* compiled container,
needs no credentials, and exits non-zero on unaccepted high-severity findings. It currently
**passes**.

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

1. **Accept Enhanced Conversions for Leads terms** in Google Ads → Goals → Conversions →
   Settings. No API can do this, and f3 is inert without it.
2. **Paid-social pixels (f5/f6).** Need a TikTok Pixel ID and Meta Pixel ID, then:
   ```bash
   TIKTOK_PIXEL_ID=... META_PIXEL_ID=... node scripts/gtm-apply.mjs --apply=f5,f6
   ```
   Both fire a **generic** event on `form_conversion` with no page path, practice area, or
   value — deliberate, given Meta Pixel litigation around health-adjacent data on
   personal-injury sites.
3. **Instagram conversion optimization requires leaving boosted posts** — in-app boosts can't
   optimize toward a pixel conversion.
4. **Watch Google Ads for 48h.** The thank-you conversion (Secondary) should drop to an honest
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
