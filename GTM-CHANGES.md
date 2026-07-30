# GTM-PC9XN9DP — change list

Findings from an audit of live container **version 20**, and the exact edits to make in the
GTM UI. Re-run `npm run audit:gtm` at any time — it parses the public compiled container
(`https://www.googletagmanager.com/gtm.js?id=GTM-PC9XN9DP`), needs no credentials, and exits
non-zero while unaccepted high-severity findings remain.

**Rollback reference:** GTM's own **Versions** tab retains every published version, including
the pre-change v20 — republishing it is the rollback. (`npm run audit:gtm -- --file <path>` can
also audit a saved copy; `.gtm-snapshots/` is gitignored local scratch, not a deliverable.)

## Before you start

**Deploy the site-code changes first.** They must be committed and live before step 4, because
that step points the conversion at the `form_conversion` event, which the site only emits once
the new `thank-you.html` is deployed.

Work in a **new GTM workspace** (Workspace dropdown → `+`), not the Default Workspace, so
everything can be discarded in one click. Publish Version A (steps 1–3) and Version B
(step 4) **separately** — see "Publish order".

## Account context that shaped these decisions

| | |
|---|---|
| Bidding | All campaigns on **Maximize Conversion Value** |
| Primary conversion (feeds bidding) | **tel: click**, `pEKdCNrT-cobELiOuLBB`, static value, `Count = One` |
| Secondary (observation only) | **thank-you web**, `kZCHCOSz-cobELiOuLBB` |
| Real valued conversions | Manually valued, pushed via **Zapier from CallRail** (offline import, matched on gclid) |

Nothing below touches the tel: click conversion, so **bidding is not disturbed.**

---

## 1. Delete the duplicate consent-default tag — HIGH

**Find it:** Tags → the Custom Template tag firing on **Consent Initialization**
(internally `__cvt_K8GSG`).

**Do:** Delete the tag.

**Why:** It issues a *second* `consent default` command. The site already issues one in
`js/component-loader.js:14-22` before `gtm.js` loads. The GTM copy is strictly worse — it
sets `wait_for_update: "0"` (zeroing the window `js/consent.js` needs to land its update) and
denies `functionality_storage` **and** `security_storage`, both of which the site grants.
Deleting it leaves one source of truth and results in *more* measurement, not less.

It is a fossil: consent was removed from the site on 2026-03-04 and re-added on 2026-04-22,
so for six weeks GTM was the only place a default could live. Nobody removed it afterwards.

## 2. Fix the Conversion Linker — CRITICAL

**Find it:** Tags → **Conversion Linker** (fires on All Pages).

**Do:**
- Tick **Enable URL passthrough**.
- Under *Linker Domains*, delete the **137 Netlify deploy-preview hostnames** (anything
  containing `--` or `.netlify.app`). Keep exactly:
  `penneylaw.com`, `bankonfrank.com`, `stockton-personalinjury.com`.

**Why this is the most important fix:** `ad_storage` is denied by default, so without URL
passthrough the **gclid is lost** — and gclid is what your Zapier/CallRail offline conversion
import matches on. Every consent-denied visitor is currently a lead that can't be attributed
back to the click that produced it.

## 3. Fix Enhanced Conversions — HIGH

Currently wired backwards. The correct variable exists and is connected to nothing, while the
live path scrapes the DOM.

**Do, in order:**

1. **Variables** → confirm the user-provided-data variable in **Code** mode with *Data
   Source* = the `leadsUserData` Data Layer Variable (internally `macro 19`). Leave as is.
2. **Tags** → thank-you conversion (`kZCHCOSz-cobELiOuLBB`) → tick **Include user-provided
   data from your website** → select the Code-mode variable from step 1.
3. **Delete** the **Google Ads User-Provided Data** tag (fires on Form Submission,
   internally `__awud`).
4. **Delete** the two remaining **Automatic**-mode user-provided-data variables.
5. **Google Ads** → Goals → Conversions → Settings → accept the **Enhanced Conversions for
   Leads** terms if not already accepted.

**Why:** the active variable is in **Automatic** mode, which scrapes the page for emails and
phone numbers. `(888) 888-0566` appears in the header, hero, CTA and footer of every page, so
Automatic mode can send **the firm's own number as the lead's phone** — that corrupts matching
rather than merely failing to help. Deleting the `__awud` tag also fixes a second problem: it
fired on every submit *attempt*, including client-side-invalid and abandoned ones.

**Do not add hashing to the site.** GTM's Ads tag hashes client-side. `thank-you.html` pushes
`leadsUserData` raw on purpose; hashing it ourselves would double-hash and break matching.

## 4. Repoint the thank-you conversion to a real submit event — MEDIUM

⚠️ **Requires the site code to be deployed first.** Publish this as its own version.

**Do:**
1. **Triggers** → New → **Custom Event**, Event name exactly `form_conversion`, fires on
   All Custom Events.
2. **Tags** → thank-you conversion (`kZCHCOSz-cobELiOuLBB`) → remove the existing
   *Page URL contains "thank-you"* pageview trigger → add the new `form_conversion` trigger.

**Why:** it currently fires on any pageview whose URL contains `thank-you`, so refreshes,
back-navigation and direct hits all re-count. Meanwhile `form_conversion` had no trigger at
all — the site was pushing an event nothing listened to.

**Expect the reported count to drop.** That's inflation disappearing. This action is
**Secondary/observation-only**, so bidding is unaffected and there is no re-learning risk.
The new `thank-you.html` also gates `form_conversion` behind a one-shot token set on real
submit, so refreshes no longer emit the event at all.

## 5–6. Add the paid-social pixels

Prerequisite: the widened CSP (`analytics.tiktok.com`, `connect.facebook.net`) must be
deployed. **Before that, any pixel fails silently with no error in the GTM UI.**

| | TikTok | Meta |
|---|---|---|
| Tag | TikTok Pixel (community template preferred) | Meta Pixel |
| Pixel ID | `<TIKTOK_PIXEL_ID>` | `<META_PIXEL_ID>` |
| Trigger | `form_conversion` | `form_conversion` |
| Event | generic conversion | `Lead` |
| Parameters | **none** | **none** |

**Send no practice-area, page-path, campaign name, or value.** Meta Pixel on personal-injury
pages has drawn wiretapping and health-privacy litigation, and Meta's business tools terms
prohibit health data — a `Lead` event carrying `/traumatic-brain-injuries` tells Meta
something about the person. Volume alone is enough for the platforms to optimize on.

Also note: **conversion optimization means leaving boosted posts.** In-app Instagram boosts
can't optimize to a pixel conversion; that needs Ads Manager with a conversion objective.

## 7. Prefer built-in templates over Custom HTML

The CSP sets `require-trusted-types-for 'script'` with no `unsafe-eval`. Hand-written Custom
HTML tags are a recurring silent-failure source here. Use the gallery template when one exists.

---

## Publish order

1. **Version A** — steps 1, 2, 3. Safe; ship together.
2. **Version B** — step 4, alone, after the site deploy. Watch 48h.
3. **Version C** — steps 5–6, pixels, after the CSP is live. Re-check for CSP violations
   after each pixel.

## Verify

Run GTM **Preview** against `/`, `/contact`, `/lp/car-accident.html`, `/thank-you`, both
accepting and rejecting the banner:

- Exactly **one** `consent default` in the dataLayer, with `functionality_storage` and
  `security_storage` **granted** and `wait_for_update: 500`.
- `form_conversion` fires **once** on a real submit and **not** on refresh or a direct hit.
- On the thank-you conversion request, `em=` / `pn=` params present — that proves Enhanced
  Conversions hashed client-side. Should fail before step 3, pass after.
- Pixels fire on `form_conversion` carrying **no** page path or practice area.
- **Zero CSP violations** in the browser console.
- Click a `tel:` link on the homepage and confirm `pEKdCNrT-cobELiOuLBB` still fires — this
  runs off GTM's native link-click listener, independent of `ad-tracking.js`.

Then: `npm run audit:gtm` should report only ACCEPTED findings.

After 48h in Google Ads → Goals → Conversions:
- tel: click conversion (Primary) — **unchanged**.
- thank-you conversion (Secondary) — **lower**, and now honest.
- Confirm the Zapier/CallRail offline import still lands, and watch whether gclid match rates
  improve now that URL passthrough is on.

## Rollback

- Unpublished: discard the workspace (Workspace → Actions → Delete).
- Published: Versions → the previous version → **Publish**. GTM retains v20 indefinitely, so
  the pre-change container is always one click away.

## Consciously accepted — not changing

- **CallRail and Clarity fire before consent.** Raised, including that Clarity records form
  interactions; the decision is to leave both ungated. CallRail in particular sits upstream of
  the gclid capture the Zapier revenue pipeline depends on, so gating it would break attribution.
- **Bidding optimizes tel: clicks, not connected calls.** Deliberate — clicks give Smart
  Bidding the volume and recency it needs; human-valued offline imports arrive later and
  sparser. Revisit if per-campaign call volume supports ~30+/month.
- **No differentiated lead values.** Maximize Conversion Value therefore behaves much like
  Maximize Conversions for web conversions; real values enter via the Zapier import.
- **17 orphan variables and hardcoded measurement IDs** — cosmetic, left alone.
- **No `<noscript>` GTM iframe** — correct to omit; these forms need JS anyway, and a noscript
  iframe can't respect consent mode.
