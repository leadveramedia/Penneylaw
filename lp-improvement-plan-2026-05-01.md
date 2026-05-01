# Landing Page Improvement Plan — Frank Penney Injury Law

**Date:** 2026-05-01
**Author:** ads-manager (Claude)
**Audience:** Website team (penneylaw.com) + Roger / Frank Penney
**Status:** Draft — pending review

## 1. Executive summary

Google Ads Quality Score (QS) data shows **18 of 28 active low-QS keywords (64%) are dragged down by the Landing Page sub-component**, which Google rates BELOW AVERAGE. Every single one of those 28 keywords is also rated BELOW AVERAGE on Expected CTR — but Ad Relevance is mostly fine (13 above, 8 average, 7 below). The bottleneck is on the LP side, not the ad-copy side.

The 4 active LPs in scope today share three structural defects:
- **No JSON-LD schema** (LegalService / LocalBusiness / FAQPage / Review) — Google rewards structured data on PI / legal pages
- **No FAQ content** — missed long-tail query coverage and dwell-time signal
- **Generic H1s with no keyword + no geo** — current H1s ("Hurt in a Car Accident?") don't match the queries Google is auctioning the page against

Three additional issues are LP-specific:
- **Severe LP↔keyword mismatch on practice-area LPs** — the truck LP doesn't say "semi truck" or "18 wheeler", the motorcycle LP doesn't say "motorbike" or "bike", the car LP doesn't say "Sacramento" outside the awards section. The campaigns explicitly bid on those terms.
- **Low word count** (650–1,200 vs industry benchmark 2,000–4,000)
- **Inconsistent URL pattern** — `/lp/car-accident` (no extension) vs `/lp/truck-accident.html` and `/lp/motorcycle-accident.html`

Estimated QS impact if Tier 1 ships: 3-day to 14-day lift of 2–4 points per LP-bottlenecked keyword (e.g., `car accident lawyer sacramento` from QS 1 to QS 5–7), which compresses CPA via lower per-click cost and higher ad rank.

---

## 2. The "LP Quality Standard"

This is the checklist **every** LP must satisfy — existing 4 LPs and the 3 new ones (rideshare, commercial-fleet, rental-truck). Use it as a build spec for new LPs and a remediation checklist for existing ones.

### Required HTML & metadata
- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1">` in `<head>`
- [ ] `<title>` containing **primary keyword + Frank Penney + city/region** (e.g., `California Car Accident Lawyer | Frank Penney Injury Law | Free Consultation`) — under 60 chars
- [ ] `<meta name="description">` 140–160 chars, including primary keyword + key value props ($1B+, no fee, free consultation, 24/7)
- [ ] Canonical URL tag (`<link rel="canonical" href="https://penneylaw.com/...">`) to the production URL
- [ ] OpenGraph + Twitter card tags for social sharing
- [ ] `lang="en"` on `<html>`
- [ ] `hreflang` tags if a Spanish version exists (none yet — fine to skip until built)

### Required content structure
- [ ] **H1 contains primary keyword + geo modifier** (e.g., "Sacramento Car Accident Lawyer" not "Hurt in a Car Accident?"). Use the emotional question as a sub-headline (`<h2>` or `<p class="hero-subhead">`).
- [ ] **Above-the-fold elements**: H1, sub-headline, primary CTA button, phone number `(888) 888-0566` as `tel:` link, and one trust signal (e.g., "$1B+ Recovered" or "Avvo 10.0")
- [ ] **All 6 California cities mentioned in body copy at least once**: Roseville, Sacramento, Fairfield, Modesto, Stockton, Chico
- [ ] **8–12 FAQ blocks** (see [Appendix B](#appendix-b-faq-seed-list)) wrapped in `FAQPage` JSON-LD
- [ ] **Real review/testimonial text** (not just badges) — minimum 4 testimonials with name, city, case type. Wrap in `Review` schema.
- [ ] **"Home & Hospital Visits Available"** prominently surfaced (currently only mentioned on homepage and not even there clearly)
- [ ] **Body word count: 1,800–2,500 words** (current LPs are 650–1,200)

### Required JSON-LD schema
Every LP must have **all four** of these schema blocks (templates in [Appendix A](#appendix-a-json-ld-templates)):
- [ ] `LegalService` (firm-level metadata)
- [ ] `LocalBusiness` with all 6 offices as `branchOf` (or use 6 separate `LocalBusiness` blocks; either works)
- [ ] `FAQPage` matching the visible FAQ section
- [ ] `BreadcrumbList` showing site → practice area → (geo subpage if applicable)

Practice-area LPs additionally need:
- [ ] `Service` schema describing the practice area (`Service` with `provider` linking to LegalService)
- [ ] `Review` / `AggregateRating` if testimonials shown

### Required keyword surface area (per practice-area LP)

| LP | Primary kw (must appear in H1, ≥ 5 in body) | Variants (must appear ≥ 1 in body) |
|---|---|---|
| Car / `/lp/car-accident.html` | car accident lawyer | car accident attorney, car crash lawyer, car wreck lawyer, auto accident lawyer, vehicle collision, MVA |
| Truck / `/lp/truck-accident.html` | truck accident lawyer | semi truck accident lawyer, 18 wheeler accident lawyer, tractor-trailer, big rig (already present), commercial trucking |
| Motorcycle / `/lp/motorcycle-accident.html` | motorcycle accident lawyer | motorbike accident lawyer, bike crash lawyer, rider injury attorney, biker, motorbike injury |
| Rideshare (NEW) | rideshare accident lawyer | uber accident lawyer, lyft accident lawyer, rideshare passenger lawyer, gig driver accident |
| Commercial Fleet (NEW) | commercial truck accident lawyer | delivery truck accident lawyer, box truck accident, commercial vehicle lawyer, delivery driver accident |
| Rental Truck (NEW) | rental truck accident lawyer | u-haul accident lawyer, penske truck accident, moving truck accident, rental truck crash |

**Note on trademarks:** brand-name variants (Uber, Lyft, UPS, FedEx, U-Haul, Penske, etc.) MUST NOT appear in the LP's `<title>`, H1, or above-the-fold marketing copy on the new commercial-vehicle LPs. They MAY appear in body content, FAQ Qs, and meta description in **informational / comparative** contexts ("victims hit by Uber drivers", "different from regular trucking accidents"). This mirrors the trademark policy applied to RSA copy.

### Required performance targets
- [ ] **Lighthouse Performance score ≥ 80 (mobile)**
- [ ] **LCP < 2.5s** (Largest Contentful Paint)
- [ ] **CLS < 0.1** (Cumulative Layout Shift)
- [ ] **INP < 200ms** (Interaction to Next Paint)
- [ ] Page weight under 2 MB, ideally under 1 MB
- [ ] All images: WebP/AVIF with `loading="lazy"` (except hero) and responsive `srcset`
- [ ] Total request count under 50

---

## 3. Tier 1 — Fast wins (apply to existing 4 LPs)

These are the highest-impact, lowest-effort changes. Ship Tier 1 before any other work.

### Tier 1.1 — H1 rewrites (5 min per page)

| LP | Current H1 | Recommended H1 | Sub-headline |
|---|---|---|---|
| Homepage `/` | "Northern California's Premier Injury Law Firm" | KEEP (good for brand intent) | — |
| `/lp/car-accident` | "Hurt in a Car Accident?" | **"Sacramento Car Accident Lawyer"** | "Hurt in a Car Accident? Get a Free Case Review — No Fee Unless We Win" |
| `/lp/truck-accident.html` | "Hurt in a Truck Accident?" | **"California Truck Accident Lawyer"** | "Injured by a Semi, 18-Wheeler, or Big Rig? We Hold Trucking Companies Accountable." |
| `/lp/motorcycle-accident.html` | "Hurt in a Motorcycle Crash?" | **"California Motorcycle Accident Lawyer"** | "Injured Riding? Insurance Bias Against Bikers Is Real — We Level the Playing Field." |

### Tier 1.2 — Add JSON-LD schema (30 min per page if templated)

Drop the 4 schema blocks from [Appendix A](#appendix-a-json-ld-templates) into the `<head>` of each LP. The `LegalService` and `LocalBusiness` blocks are identical across all LPs (firm-level data); only `FAQPage`, `Service`, and `BreadcrumbList` vary per LP.

Validate at <https://search.google.com/test/rich-results> after deploy. Should show all 4 schema types detected with zero errors.

### Tier 1.3 — Add 8–12 FAQ blocks per LP (2–3 hr per page)

Use the seed list in [Appendix B](#appendix-b-faq-seed-list). Wrap visible FAQ markup with `FAQPage` JSON-LD that mirrors the questions verbatim. Q&A pairs should be 80–250 words each. Place the FAQ section **above the footer** but **below the trust-signal section** (so users see the FAQs after the conversion-focused content but before they leave).

### Tier 1.4 — Add keyword variants to body (1–2 hr per page)

For each practice-area LP, weave the missing keyword variants from §2's table into 2–3 paragraphs of body copy naturally. Examples:

**Truck LP — add a section like:**
> ### What kinds of truck accidents do we handle?
> Frank Penney Injury Law represents victims of every type of commercial truck crash — semi-truck accidents, 18-wheeler collisions, big-rig wrecks, tractor-trailer pile-ups, and box-truck incidents. Our 30+ years of experience covers federal motor carrier regulations (FMCSA) and California-specific commercial vehicle law…

**Motorcycle LP — add a section like:**
> ### Helping every kind of rider
> Whether you ride a sportbike, cruiser, dirt bike, or a moped, we represent motorbike crash victims across California. Bike crash injuries — road rash, fractures, traumatic brain injuries — are often more severe than car accident injuries, and insurance companies routinely undervalue rider claims…

**Car LP — add a "Cities We Serve" section with all 6 city names** plus 1–2 sentences each (becomes the foundation for the Tier 2 city subpages).

### Tier 1.5 — Verify mobile viewport meta tag (5 min)

Inspect each LP's `<head>` and confirm `<meta name="viewport" content="width=device-width, initial-scale=1">` is present. If absent, add it. This single tag swings the mobile-friendly Google audit from FAIL to PASS.

### Tier 1.6 — Brand RSA-1 final URL fix (ad-side, not LP-side)

Brand AG `Frank Penney Law Firm` RSA-1 (ad_id `782349618465`) currently points to `https://penneylaw.com/lp/car-accident`. **Change to `https://penneylaw.com/`.** Brand-name traffic should land on the homepage, not a car-accident LP. This is a single-line ad mutation, separate from website work.

### Tier 1.7 — Surface "Home & Hospital Visits" on every LP

Add a 3rd or 4th badge/callout to the hero section of every LP: **"Home & Hospital Visits Available"** (icon + text). Currently mentioned in some RSA copy but absent from the LP itself, breaking the message-match between ad and page.

---

## 4. Tier 2 — Geo-specific subpages (highest ROI for QS lift)

Build **6 city subpages per active practice area** = 36 pages today (3 active practice areas × 6 cities) + 18 more as the new commercial-vehicle LPs ship (3 × 6 = 18). All from one template.

### Why this is high-ROI

`car accident lawyer sacramento` is currently QS 1 with all three sub-components BELOW AVERAGE. The reason is structural: the LP literally doesn't say "Sacramento" anywhere except a buried awards reference. Google's algorithm has nothing to match the geo modifier against.

Building `/lp/sacramento-car-accident-lawyer/` with "Sacramento" in the URL, H1, body copy 5+ times, and `LocalBusiness.address.addressLocality = "Sacramento"` schema unlocks QS 5–8 territory in one shot. Same play for the 5 other cities × 3 (or 6) practice areas.

### Page template (single template, parameterize on `city` + `practice_area`)

URL pattern: `/lp/{city-slug}-{practice-area-slug}-lawyer/`
- `/lp/sacramento-car-accident-lawyer/`
- `/lp/roseville-truck-accident-lawyer/`
- `/lp/modesto-motorcycle-accident-lawyer/`
- etc.

Required differences from the practice-area LP:
1. **Title tag**: `{City} {Practice} Lawyer | Frank Penney Injury Law | Free Consultation`
2. **H1**: `{City} {Practice} Lawyer`
3. **Hero subhead**: `Hurt in a {practice-area} accident in {City}? Get a free case review.`
4. **Body copy variations**:
   - Mention `{City}` 8–12 times naturally
   - Reference {City}-specific landmarks / freeways (e.g., "I-5 through Sacramento", "Highway 99 in Modesto", "I-80 through Roseville")
   - Reference the local Frank Penney office address
   - Cite local court venues if relevant ({City} Superior Court for personal injury filings)
5. **Schema overrides**:
   - `LocalBusiness.address.addressLocality = {City}`
   - `LocalBusiness.address.streetAddress = {Office street address}` (each city has a Frank Penney office)
   - `LegalService.areaServed = [{City}, "{County}"]`
   - `BreadcrumbList`: Home → {Practice} → {City}
6. **Internal linking**: every city subpage links to (a) the parent practice-area LP, (b) the other 5 city subpages for the same practice area, (c) the homepage. Helps Google crawl the cluster and pass authority.

### Office addresses (use these for `LocalBusiness.address`)

The 6 office addresses need to be sourced from the website team or pulled off the existing homepage. Confirm before building.

### Ads-side change to enable geo subpages

After the city subpages ship, the relevant geo-suffixed keywords need their `final_urls` overridden to point to the city subpage instead of the parent LP. This is a keyword-level mutation that the existing peel-off CLI doesn't support today; I'll add a new `restructure rewrite-keyword-urls --csv <file>` command when needed. Spec is straightforward and idempotent.

---

## 5. Tier 3 — Content depth + trust signals

Once Tier 1 + Tier 2 are deployed, expand content depth on each parent practice-area LP.

### Add these sections to each practice-area LP

| Section | Word count | Purpose |
|---|---|---|
| "What to do after a {practice-area} accident" | 300–400 | Ranks for `what to do after a car accident` long-tail; positions firm as expert |
| "Common injuries we see" | 200–300 | Topic depth signal; covers TBI, fractures, soft-tissue, etc. **Avoid "brain injury", "spinal injury", "catastrophic injury" verbatim** — Google's HEALTH_IN_PERSONALIZED_ADS policy auto-flags these (see CLAUDE.md). Use "head injuries", "back injuries", "severe injuries" instead. |
| "How insurance companies undervalue {practice-area} claims" | 300–400 | E-E-A-T signal — actual legal expertise on display |
| "Recent settlements & case results" | 250–350 | Trust + credibility. **Real numbers, real outcomes.** Disclaimer required ("past results don't guarantee future outcomes"). |
| "Why choose Frank Penney" | 200–300 | $1B+, 30+ years, Avvo 10.0, no fee, home/hospital visits, 6 offices |
| "Cities We Serve" with internal links | 150–200 | Internal-linking hub for the 6 city subpages |
| FAQ section | 800–1,200 | Already in Tier 1.3 |

Target end-state word count per practice-area LP: **2,000–2,500 words**.

### Real review text (replace badge-only with copy)

Pull 6–10 actual client reviews. Each review needs:
- First name + last initial (e.g., "Maria S.")
- City (e.g., "Sacramento, CA")
- Case type (e.g., "Truck accident, $850K settlement")
- 100–200 words of testimonial text
- Date (e.g., "April 2024")
- Wrapped in `Review` JSON-LD with `author`, `reviewRating`, `datePublished`

Then add an `AggregateRating` schema block summing the reviews:
```json
{
  "@type": "AggregateRating",
  "ratingValue": "4.9",
  "reviewCount": "247"
}
```

---

## 6. Tier 4 — Performance & technical (website-team checklist)

I cannot measure these from the ads-manager environment — flag for the website team.

### Run these tools on each LP and screenshot/report results

- [ ] **PageSpeed Insights** (<https://pagespeed.web.dev>) — both Mobile and Desktop scores per LP. Target ≥ 80 mobile, ≥ 90 desktop.
- [ ] **Lighthouse audit** (Chrome DevTools) — Performance, Accessibility, Best Practices, SEO. Target ≥ 90 across all four.
- [ ] **Google Mobile-Friendly Test** (<https://search.google.com/test/mobile-friendly>) — must PASS on every LP.
- [ ] **Rich Results Test** (<https://search.google.com/test/rich-results>) — must show all schema blocks parsed cleanly.
- [ ] **Schema validator** (<https://validator.schema.org/>) — secondary validation; cross-check with Google's tool.

### Common fixes the audits typically flag

- **LCP issues**: defer non-critical CSS, inline critical CSS, preload hero image, use `<img fetchpriority="high">` on hero
- **CLS issues**: set explicit `width` and `height` on every `<img>` and `<iframe>`; reserve space for ads/embeds
- **INP issues**: defer non-essential JS with `defer` or `async`; break up long tasks; remove unused JS
- **Page weight**: convert all JPG/PNG to WebP/AVIF; resize hero images to 2× max display width; use `srcset` for responsive
- **Render-blocking resources**: inline critical CSS, async-load fonts with `font-display: swap`, defer Google Analytics / pixel scripts
- **Redirect chains**: `/lp/car-accident` (no `.html`) suggests a rewrite — verify there's not a `/lp/car-accident → /lp/car-accident.html → /lp/car-accident/` chain. Each redirect adds ~200ms.

### URL consistency

The current state has `/lp/car-accident` (no extension) but `/lp/truck-accident.html` and `/lp/motorcycle-accident.html` (with `.html`). Pick one pattern and 301 redirect the others. Recommendation: drop `.html` everywhere (cleaner URLs, easier for users to remember). This means:
- `/lp/truck-accident.html` → 301 → `/lp/truck-accident/`
- `/lp/motorcycle-accident.html` → 301 → `/lp/motorcycle-accident/`
- Update Google Ads keyword & RSA `final_urls` after the redirect ships (one-off mutation).

---

## 7. Per-LP work breakdown

### `/` (homepage)
- [ ] **Tier 1.7**: Add "Home & Hospital Visits Available" badge to hero
- [ ] **Schema**: Add `LegalService` + `LocalBusiness` (with all 6 offices as `branchOf` or as 6 separate blocks) + `BreadcrumbList`
- [ ] **Tier 1.5**: Verify mobile viewport tag
- [ ] **Tier 4**: Lighthouse audit + ship fixes

Skip Tier 1.1 (H1 is fine for brand intent), Tier 1.3 (FAQ on homepage is optional), Tier 1.4 (homepage already has practice-area diversity).

### `/lp/car-accident` (rename to `/lp/car-accident/` per Tier 4)
- [ ] **Tier 1.1**: H1 → "Sacramento Car Accident Lawyer" + sub-headline
- [ ] **Tier 1.2**: Add all 4 schema blocks (`LegalService`, `LocalBusiness`, `FAQPage`, `BreadcrumbList`) + `Service` schema
- [ ] **Tier 1.3**: 10 FAQ blocks (see Appendix B § Car Accident)
- [ ] **Tier 1.4**: Add "Cities We Serve" section + weave keyword variants into body
- [ ] **Tier 1.5**: Verify mobile viewport tag
- [ ] **Tier 1.7**: "Home & Hospital Visits" badge in hero
- [ ] **Tier 3**: Add the 6 content sections per §5 (target 2,000+ words)
- [ ] **Tier 3**: Add 6 real testimonials with `Review` schema + `AggregateRating`
- [ ] **Tier 2**: Build 6 geo subpages (`/lp/sacramento-car-accident-lawyer/`, `/lp/roseville-…`, etc.)
- [ ] **Tier 4**: Lighthouse audit + ship fixes

### `/lp/truck-accident.html`
- [ ] **Tier 1.1**: H1 → "California Truck Accident Lawyer" + sub-headline
- [ ] **Tier 1.2**: Schema blocks (as above)
- [ ] **Tier 1.3**: 10 FAQ blocks (see Appendix B § Truck Accident)
- [ ] **Tier 1.4**: Add "semi truck", "18 wheeler", "tractor-trailer", "commercial trucking" body content
- [ ] **Tier 1.5**: Verify viewport
- [ ] **Tier 1.7**: "Home & Hospital Visits" badge
- [ ] **Tier 3**: 6 content sections + 6 testimonials
- [ ] **Tier 2**: 6 geo subpages
- [ ] **Tier 4**: Lighthouse audit

### `/lp/motorcycle-accident.html`
- [ ] **Tier 1.1**: H1 → "California Motorcycle Accident Lawyer" + sub-headline
- [ ] **Tier 1.2**: Schema blocks (as above)
- [ ] **Tier 1.3**: 10 FAQ blocks (see Appendix B § Motorcycle Accident)
- [ ] **Tier 1.4**: Add "motorbike", "bike crash", "rider", "biker" body content (this LP currently has the worst keyword↔body mismatch)
- [ ] **Tier 1.5**: Verify viewport
- [ ] **Tier 1.7**: "Home & Hospital Visits" badge
- [ ] **Tier 3**: Word count is currently the lowest of the 4 (~650). Add at least 1,200 more words across the 6 sections.
- [ ] **Tier 3**: 6 testimonials
- [ ] **Tier 2**: 6 geo subpages
- [ ] **Tier 4**: Lighthouse audit

### NEW LPs (build from spec — do not start until §2 LP Quality Standard is read fully)

- [ ] `/lp/rideshare-accident/` — Rideshare campaign LP. Use Appendix B § Rideshare for FAQs. Don't put Uber / Lyft / DoorDash / Uber Eats brand names in `<title>`, H1, or hero copy — body content + FAQs only, in informational context.
- [ ] `/lp/commercial-vehicle-accident/` — Commercial Fleet campaign LP. Same trademark guardrails for UPS / FedEx / Amazon / DHL. Lead with "Delivery Truck" and "Commercial Vehicle" framing.
- [ ] `/lp/rental-truck-accident/` — Rental Truck campaign LP. Same guardrails for U-Haul / Penske. Lead with "Rental Truck" and "Moving Truck" framing. Special angle: rental drivers are often non-professional — explain how that creates a different liability picture.
- [ ] All 3 new LPs ship with full Tier 1 baked in from day 1 (schema, FAQs, full keyword surface area, 1,800–2,500 word count, all 6 cities mentioned).

---

## 8. Verification & acceptance criteria

A page is "done" when **all** of the following pass:

1. **Rich Results Test** (Google) shows every declared schema block detected with **zero errors**.
2. **Mobile-Friendly Test** (Google) returns **PASS**.
3. **Lighthouse mobile**: Performance ≥ 80, Accessibility ≥ 90, Best Practices ≥ 90, SEO ≥ 95.
4. **Manual content audit**: H1 contains the primary keyword. All 6 California city names appear in body. The primary keyword appears 5+ times. The page is at least 1,800 words.
5. **Visual QA**: Above-the-fold has H1, sub-headline, primary CTA, phone number, and at least one trust signal. No broken images. No console errors.
6. **Re-pull QS** 7–14 days after deploy and confirm sub-component lift on representative keywords.

Track progress in a simple per-LP checklist (could be a spreadsheet or this file's checkboxes).

---

## 9. Timeline & sequencing

Recommended order (each phase blocks the next; within a phase, work in parallel):

| Phase | Work | Duration | Trigger |
|---|---|---|---|
| **0** | Brand RSA-1 final URL fix (ads-side) — 5 min | Immediate | I can do this now via API |
| **1** | Tier 1 on existing 3 practice-area LPs (H1, schema, FAQ, viewport, badge, keyword variants) | 1–2 weeks | Website team starts immediately |
| **2** | Tier 4 audits + performance fixes on the 3 LPs | 1 week | After Phase 1 ships |
| **3** | Tier 3 content expansion on the 3 LPs | 2–3 weeks | After Phase 2 |
| **4** | Tier 2 geo subpages (18 pages = 6 cities × 3 practice areas) | 2 weeks | After Phase 3 (template ready) |
| **5** | Build 3 new LPs (rideshare, commercial-fleet, rental-truck) with full Tier 1+3 baked in | 1–2 weeks | Can run parallel to Phase 4 |
| **6** | Re-pull QS, validate lift, identify remaining outliers | 7–14 days post each phase | After each LP cluster deploys |
| **7** | Tier 2 geo subpages for the 3 new LPs (18 more pages) | 2 weeks | After Phase 5 + Phase 4 template |

Total runway: ~8–12 weeks for full implementation. Tier 1 alone (Phase 0–1) should ship in 1–2 weeks and is responsible for ~70% of the QS impact.

---

## 10. Brand campaign fixes (ads-side, separate from LP work)

These 3 fixes are independent of LP work but related (they're cleaning up the same QS pollution from the ad side). I can execute them via API immediately once authorized:

1. **Re-route Brand AG RSA-1 final URL**: ad_id `782349618465`, current `/lp/car-accident` → change to `/`
2. **Pause the 3 ghost AGs**: `You Can Bank on Frank`, `The Sacramento Injury Law Firm`, `Trust and Reputation`. All have RSAs referring to "18 Wheeler Accident" and "Compass Law Group" (LeadVera contamination from another firm's account). 6 RSAs total to pause; AGs themselves can stay paused (preserved for audit) or be removed.
3. **Move 2 keywords from `Competitor` AG → `Frank Penney Law Firm` AG**: `penney law` EXACT and `penney law firm` EXACT. They're brand variants, not competitor terms. Keyword-level move via remove + add.

Total runtime: ~5 minutes. All three are mutation-logged and rollback-able via mutations.log.

---

# Appendices

## Appendix A — JSON-LD templates

Drop these into the `<head>` of each LP. Replace `{{...}}` placeholders. The `LegalService` and `LocalBusiness` blocks are identical across all LPs. Only `FAQPage`, `Service`, and `BreadcrumbList` vary.

### A.1 — `LegalService` (same on every LP)

```json
{
  "@context": "https://schema.org",
  "@type": "LegalService",
  "name": "Frank Penney Injury Law",
  "image": "https://penneylaw.com/img/frank-penney-logo.png",
  "url": "https://penneylaw.com",
  "telephone": "+1-888-888-0566",
  "priceRange": "Free Consultation",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "{{ROSEVILLE_HQ_ADDRESS}}",
    "addressLocality": "Roseville",
    "addressRegion": "CA",
    "postalCode": "{{ZIP}}",
    "addressCountry": "US"
  },
  "areaServed": [
    {"@type": "State", "name": "California"},
    "Sacramento", "Roseville", "Modesto", "Stockton", "Chico", "Fairfield"
  ],
  "founder": {"@type": "Person", "name": "Frank Penney"},
  "foundingDate": "{{YEAR}}",
  "slogan": "Bank on Frank — No Fee Unless We Win",
  "knowsLanguage": ["en", "es"],
  "openingHours": "Mo-Su 00:00-23:59",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "{{COMPUTED_FROM_REVIEWS}}",
    "reviewCount": "{{COMPUTED_FROM_REVIEWS}}"
  }
}
```

### A.2 — `LocalBusiness` × 6 offices (same on every LP)

Embed an array of 6 `LocalBusiness` blocks, one per office. Roseville is HQ, the other 5 are branches. Example for Sacramento:

```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": "https://penneylaw.com/#sacramento",
  "name": "Frank Penney Injury Law — Sacramento",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "{{SACRAMENTO_ADDRESS}}",
    "addressLocality": "Sacramento",
    "addressRegion": "CA",
    "postalCode": "{{ZIP}}"
  },
  "telephone": "+1-888-888-0566",
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": "{{LAT}}",
    "longitude": "{{LON}}"
  },
  "openingHours": "Mo-Su 00:00-23:59",
  "branchOf": {"@type": "LegalService", "name": "Frank Penney Injury Law"}
}
```

### A.3 — `FAQPage` (varies per LP; matches visible FAQ markup)

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How much does it cost to hire a {{practice_area}} lawyer?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Frank Penney Injury Law works on a contingency basis. You pay nothing up front and no fee unless we win your case. Free consultations are available 24/7 by phone at (888) 888-0566 or in person at any of our 6 California offices."
      }
    }
    // … 7–11 more Q&A pairs from Appendix B
  ]
}
```

### A.4 — `Service` (per practice-area LP)

```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "serviceType": "{{Practice}} Lawyer",
  "provider": {"@type": "LegalService", "name": "Frank Penney Injury Law"},
  "areaServed": {"@type": "State", "name": "California"},
  "description": "{{1-2 sentence description}}",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD",
    "description": "Free case consultation. No fee unless we win."
  }
}
```

### A.5 — `BreadcrumbList` (per LP)

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://penneylaw.com/"},
    {"@type": "ListItem", "position": 2, "name": "{{Practice Area}}", "item": "https://penneylaw.com/lp/{{practice-area-slug}}/"},
    {"@type": "ListItem", "position": 3, "name": "{{City}}", "item": "https://penneylaw.com/lp/{{city-slug}}-{{practice-area-slug}}-lawyer/"}
  ]
}
```
For practice-area LPs (no city), drop position 3.

### A.6 — `Review` (per testimonial)

```json
{
  "@context": "https://schema.org",
  "@type": "Review",
  "itemReviewed": {"@type": "LegalService", "name": "Frank Penney Injury Law"},
  "author": {"@type": "Person", "name": "Maria S."},
  "reviewRating": {"@type": "Rating", "ratingValue": "5", "bestRating": "5"},
  "datePublished": "2024-04-12",
  "reviewBody": "After my truck accident on I-5 near Sacramento, Frank's team handled everything — insurance, medical bills, the whole thing. Got me a settlement way bigger than what the insurance company first offered. Highly recommend."
}
```

---

## Appendix B — FAQ seed list

10 Q&A pairs per practice-area LP. Edit answers to match firm voice but keep the questions verbatim — they were chosen to match common Google search queries (so `FAQPage` schema can light up rich results in SERP).

### B.1 — Car Accident LP (`/lp/car-accident/`)

1. How much does it cost to hire a car accident lawyer?
2. How long do I have to file a car accident lawsuit in California?
3. What should I do immediately after a car accident in Sacramento?
4. How much is my car accident case worth?
5. Should I accept the insurance company's first settlement offer?
6. What if the other driver was uninsured or fled the scene?
7. Can I still get compensation if I was partially at fault?
8. How long does a car accident case typically take to resolve?
9. Do I have to go to court for a car accident claim?
10. Can I afford a car accident lawyer if I'm not working due to my injuries?

### B.2 — Truck Accident LP (`/lp/truck-accident.html`)

1. How is a truck accident case different from a regular car accident case?
2. Who can be held liable in an 18-wheeler accident — the driver, the trucking company, or both?
3. What FMCSA regulations apply to commercial truck drivers in California?
4. How much is a typical semi-truck accident settlement?
5. What evidence is critical in a big-rig accident case?
6. How long do I have to file a truck accident lawsuit in California?
7. What if the truck driver was using their phone or fatigued?
8. Can I sue the trucking company directly?
9. What's the difference between a tractor-trailer and an 18-wheeler accident?
10. How quickly should I hire a truck accident lawyer after a crash?

### B.3 — Motorcycle Accident LP (`/lp/motorcycle-accident.html`)

1. Why do insurance companies undervalue motorcycle accident claims?
2. What if I wasn't wearing a helmet — can I still get compensation?
3. How is California motorcycle lane-splitting law applied to accident claims?
4. What are common injuries from a motorbike or bike crash?
5. How much is a motorcycle accident case worth?
6. Who is at fault in a motorcycle vs. car accident?
7. How long do I have to file a motorcycle accident lawsuit in California?
8. What if I'm a rider hit by a distracted or impaired driver?
9. Can I get my bike repairs covered separately from injury compensation?
10. Why hire a lawyer who specifically handles motorbike crash cases?

### B.4 — Rideshare LP (`/lp/rideshare-accident/`) — NEW

1. Who pays if I'm injured in a rideshare accident — the driver or the rideshare company?
2. Does the $1 million rideshare insurance policy apply to my case?
3. What if I was a passenger in a rideshare vehicle when the crash happened?
4. What if I was hit by a rideshare driver while walking or biking?
5. How does rideshare accident liability differ for delivery (food / package) drivers?
6. What evidence do I need to preserve from a rideshare crash?
7. How long do I have to file a rideshare accident claim in California?
8. Can I sue the rideshare company directly?
9. What's the difference between Period 1, Period 2, and Period 3 rideshare insurance coverage?
10. How much is a typical rideshare accident settlement worth?

### B.5 — Commercial Fleet LP (`/lp/commercial-vehicle-accident/`) — NEW

1. Who is liable in a commercial delivery truck accident — the driver or the company?
2. How is a delivery truck accident case different from a regular truck accident?
3. What if I was hit by a delivery driver in a residential neighborhood?
4. Can I sue a major shipping company directly after a crash?
5. What employer liability rules apply to commercial fleet accidents?
6. How long do I have to file a commercial vehicle accident claim in California?
7. Are box truck and delivery van accidents handled differently?
8. What evidence is critical in a commercial fleet accident case?
9. What if the delivery driver was speeding to meet a delivery deadline?
10. How much is a commercial vehicle accident settlement worth?

### B.6 — Rental Truck LP (`/lp/rental-truck-accident/`) — NEW

1. Who is liable when an inexperienced renter crashes a rental truck?
2. Does the rental truck company's insurance cover my injuries?
3. What if the renter purchased optional liability coverage?
4. Are moving truck accidents handled differently than regular truck accidents?
5. What if a rental truck's brakes or equipment failed?
6. Can I sue the rental truck company directly for negligent maintenance?
7. How long do I have to file a rental truck accident claim in California?
8. What evidence should I preserve after a moving truck crash?
9. What if the rental driver was driving a vehicle they weren't qualified to operate?
10. How much is a rental truck accident settlement typically worth?

---

## Appendix C — References

- Today's diagnostic data: [data/reports/low-qs-snapshot-2026-05-01.json](low-qs-snapshot-2026-05-01.json)
- Google's QS sub-components doc: <https://support.google.com/google-ads/answer/6167118>
- Rich Results Test: <https://search.google.com/test/rich-results>
- PageSpeed Insights: <https://pagespeed.web.dev>
- Schema.org `LegalService`: <https://schema.org/LegalService>
- Schema.org `FAQPage`: <https://schema.org/FAQPage>
- Schema.org `LocalBusiness`: <https://schema.org/LocalBusiness>
- Health policy gotcha (avoid "brain injury", "spinal injury", "catastrophic injury" verbatim): see CLAUDE.md gotchas table
- Trademark guardrails for new commercial-vehicle LPs: brand names in body content + FAQs only, never in `<title>` / H1 / above-the-fold marketing copy
