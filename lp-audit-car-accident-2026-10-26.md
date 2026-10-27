# Car accident landing page: mobile conversion audit

**Date:** 2026-10-26
**Page:** https://penneylaw.com/lp/car-accident (built from `lp-source/template.html` +
`lp-source/configs/car-accident.json`; the template is shared by all 13 landing pages)
**Why:** highest-cost Google Ads campaign, low mobile conversion rate.
**Method:** code review of the template; a live phone check at 390×844 on a first visit; a
review of 15 competitor car-accident pages; published conversion research; and California
lawyer-advertising rules.

Facts confirmed by the firm and used below:
- Calls are answered live 24/7, including in Spanish.
- Texts to (888) 888-0566 are answered 24/7.
- Form leads get a callback within 5 minutes.
- If there is no recovery, the client owes no fee and no costs.
- Google rating: 4.9 from 436 reviews (October 2026).

## Findings, ranked by likely impact

1. **Calls are measured as taps, not calls.** The primary call conversion in Google Ads is a
   GTM click on any `tel:` link (GTM-CHANGES.md). Smart Bidding therefore optimises for people
   who tap, including accidental taps and hang-ups. CallRail records real calls, but they aren't
   the primary conversion. *Google Ads/CallRail setting; see "Actions outside the code".*
2. **No call button in thumb reach, and no text option.** The sticky call strip was a 44px
   text bar at the top of the screen. GJEL and Maison put Call and Text in a bottom bar. Texts
   were answered 24/7, but the landing page never offered them.
3. **The firm's fastest-in-market response wasn't on the page.** The landing page made no
   response-time promise, and the thank-you page said "within 24 hours", which contradicts
   "Available 24/7". Sweet James promises "within 5 minutes"; Wilshire, "within minutes".
4. **No review count in the first phone screen.** Only a "4.8 Star Rating" image in a carousel
   lower down. Competitors show 4.9 from 1,000–2,500 reviews near the top. Surveys show
   consumers want at least 4 stars and about 20+ reviews (BrightLocal 2026).
5. **California advertising compliance gaps** (B&P §6157.2; Rule 7.1). Since 1 January 2026
   (SB 37), consumers can sue for $5,000–$100,000 per non-compliant ad.
   - "No Fee Unless We Win" / "You Win" (inconsistent; 7 places) never said whether the client
     pays costs (Rule 7.1 Comment [3]; §6157.2(a)(4)).
   - The results strip showed dollar amounts with no disclaimer next to it, and listed the same
     $3.4M twice (§6158.1, §6158.3).
   - Testimonials had no disclaimer (Rule 7.1 Comment [4]).
   - BBB (paid accreditation) and National Trial Lawyers (membership dues) badges conflict with
     SB 37's rule that awards may not be membership- or fee-based (§6157.2(a)(6)).
6. **Spanish was invisible on phones.** "Se Habla Español" was only in the desktop header.
7. **Form friction and a bug.** All four fields are required, and the description needed 10+
   characters ("rear-ended" failed). After submitting, the button stayed disabled on "Sending…"
   if the visitor went back from the thank-you page.
8. **Small items:**
   - Frank's portrait competed with the hero image for load priority.
   - The team photo wasn't lazy-loaded.
   - Self-rated 5-star `Review` schema was still generated.
   - A stale "TODO before publish" comment shipped in the HTML.

Already in good shape: a dedicated page with no navigation (only one of 15 competitors does
this), a headline matching the ad, the form above the fold, inlined critical CSS, deferred
scripts, FAQ and city coverage.

## What changed (all 13 landing pages, plus the thank-you page)

| Area | Change |
|---|---|
| Action bar | Top strip replaced by a bottom bar on phones: **Call Now** (live answer 24/7) and **Text Us** (replies 24/7). It sits above the cookie banner while that shows. |
| First screen | "★ 4.9 · 436 Google reviews (Oct 2026)" under the subheadline; "We call you back within 5 minutes, 24/7." and "Se habla español: personal de admisión bilingüe, 24/7." under the form title |
| Fee wording | "No Fees or Costs Unless We Win" everywhere: page, configs, FAQ and schema. The FAQ adds "If there is no recovery, you owe us nothing: no fee and no costs." |
| Results | Duplicate $3.4M removed; the site's standard results disclaimer added under the grid |
| Badges | BBB, National Trial Lawyers and the 4.8 image removed; Best of the Bar, Avvo and Super Lawyers shown as a static row |
| Testimonials | Disclaimer added: "Client reviews reflect individual experiences. Results depend on the facts of each case." |
| Form | Same four fields; any description is accepted; button reads "Get My Free Case Review"; the button resets after Back |
| Thank-you page | "Within 24 hours" replaced with the 5-minute callback for injury inquiries (the page is shared with the attorney-referral form); "No Fees or Costs Unless We Win" |
| Brand colors | All CTAs (submit, Call bar, hero call, CTA bands, menu) were gold; now Hot Pink with white text, per BRAND-GUIDELINES.md. Headline accent, subheadline, icons, links, badge and section label moved off gold to Pastel Azure, Dark Azure or white. Gold stays only on stats and phone numbers ($1 billion, star rating, results, footer phone), as the guidelines allow |
| Clean-up | Portrait priority hint and self-rated Review schema removed; team photo lazy-loaded; stale TODO deleted |
| Build fix | `scripts/build-lp-critical-css.js` dropped an `@media` block's closing brace when it removed unused keyframes nested inside it, which would have broken desktop styles (cookie banner no longer fixed). It now matches braces and fails the build on unbalanced CSS. |

Lighthouse mobile on a local build, two runs each:

| | Before | After |
|---|---|---|
| Score | 0.95 | 0.96 |
| LCP | 2.9 s | 2.6 s |
| CLS | 0.004 | 0.006 |

**Needs counsel's sign-off:** the Spanish line (Rule 7.1 Comment [5] requires naming the title
of the Spanish speaker, in Spanish), the fee wording, and both disclaimers.

## Actions outside the code

1. **Google Ads:** make CallRail calls of 60–90 s or more the **primary** call conversion,
   and demote the GTM `tel:` tap conversion to **secondary**.
2. **Enhanced Conversions for Leads:** accept the terms in Google Ads (still pending per
   GTM-CHANGES.md).
3. **Signed cases:** import them as offline conversions when available (CallRail, or the
   CaseBank integration).
4. **Text attribution:** CallRail swaps `tel:` numbers, not `sms:` links, so texts arrive but
   aren't credited to the ad. A CallRail text-enabled tracking number on the Text button would
   fix that.
5. **Case facts:** send a one-line fact summary for each result shown. Ideally also add 2–3
   car-accident results, since none of the current ones are car cases.
6. **Measure before vs after:** deploy date to be recorded. Compare 2–4 weeks either side on
   mobile using CallRail qualified calls + Netlify form leads per click. That definition doesn't
   change if the primary conversion in Ads does.

## Follow-ups beyond the landing pages

- The site header (`components/header.html`, on about 80 pages) still says "No Fee Unless We
  Win". It needs the same costs wording.
- The "4.8 Star Rating" image appears on about 120 pages, and BBB / National Trial Lawyers
  badges appear across the main site. Bring them in line with the 4.9/436 figure and SB 37.
- The site-wide "Text Us" button is an interim `sms:` link (`components/text-chat.html`). It
  works, since texts are answered 24/7, but it's unattributed (see action 4).

## Competitor pages reviewed

| Page | Notable |
|---|---|
| https://sweetjames.com/lp/car-accident/ | The only dedicated landing page found; callback "within 5 minutes"; floating short form with email optional; 2,000+ reviews at 4.9 |
| https://www.arashlaw.com/car-accident-lawyer/ | Hero form is name and phone only, plus a multi-step "Do I Have A Case?" pop-up; chat; 8 languages; "case costs may apply" disclosure |
| https://www.wilshirelawfirm.com/car-accident-lawyer/ | "We'll contact you within minutes"; 2,522 reviews at 4.9; English/Spanish toggle |
| https://www.gjel.com/sacramento | Sticky bottom bar with a Text button; case-value calculator; only name and phone required |
| https://www.forthepeople.com/office-locations/california/stockton/car-acccident-attorney/ | "See if you qualify" checklist (Morgan & Morgan) |
| https://calltheaccidentguys.com/stockton | "Get started in about 1 minute"; call/chat/email pop-up |
| https://www.jacobyandmeyers.com/ | "Done in 3 minutes!"; asks call or text preference |
| https://www.justice4you.com/ | Dedicated text line (Arnold Law Firm) |
| https://crockettlawgroup.com/sacramento/car-accident-lawyer | CALL / TEXT / CHAT buttons |
| https://maisonlaw.com/modesto/car-accidents/ | Sticky hotline bar |

Also reviewed: Sweet James (Sacramento page and general landing page), Sokolove, Moseley
Collins, AutoAccident.com and JNY Law.

Several competitors make claims that look non-compliant in California: unsourced "best", "#1"
and "highest rated"; "99%" and "98%" success rates; "zero fees" without mentioning costs; and
out-of-state results on California city pages. None of those were copied.

## Evidence

- **Benchmarks:**
  - Legal landing pages: median conversion rate 6.3%, and 88% of traffic is mobile (Unbounce
    Conversion Benchmark Report 2024).
  - Accidents & PI Google Ads: 5.45% conversion rate, $159 cost per lead (LocaliQ 2024).
- **Calls:** 69% of Weitz & Luxenberg prospects chose to call. Tracking and routing those calls
  cut cost per retainer by 28% (Invoca case study).
- **Speed-to-lead:**
  - Leads contacted within an hour were about 7x more likely to qualify (Oldroyd et al., HBR
    2011).
  - Only 25% of PI firms reply in under 5 minutes (Hennessey Digital 2025).
  - 48% of firms didn't answer or call back (Clio 2024).
- **Page speed:** 0.1 s faster raised lead-gen funnel progression by 21.6% (Deloitte/Google,
  Milliseconds Make Millions).
- **Forms:** each extra field costs a little, and big text boxes cost the most (HubSpot, about
  40k landing pages). Legal-specific form tests weren't found.
- **Rules:** California Rules of Professional Conduct 7.1–7.5; B&P Code §§6157–6159.2 as
  amended by SB 37 (Stats. 2025, ch. 645, effective 1/1/2026). Statute text came from
  public.law; confirm it against leginfo and with ethics counsel.
