/**
 * Ad Tracking Script — loads site-wide via js/bundle.min.js, and standalone on lp/ pages.
 *
 * Captures URL parameters from paid campaigns (UTM params and the Google/Meta/TikTok/
 * Microsoft click IDs) and injects them into forms so lead notifications carry their source.
 *
 * Features:
 * - Captures UTM parameters and ad platform click IDs
 * - Persists first-touch AND last-touch attribution in localStorage (90-day TTL and retention)
 * - Auto-injects hidden fields into all Netlify forms
 * - Tracks phone clicks and form submissions as GTM dataLayer events
 * - Stashes Enhanced Conversions data and a one-shot conversion token for thank-you.html
 *
 * NOTE: CallRail is the attribution system of record for calls and forms (it loads via GTM
 * on every page with its own session cookie). The fields here are a human-readable source
 * trail in the lead email and a backup — not the primary attribution path.
 *
 * @version 2.0.0
 */

(function() {
    'use strict';

    // Configuration
    var ATTR_KEY = 'penney_attr';                    // localStorage: first + last touch
    var EC_STORAGE_KEY = 'enhanced_conversion_data';  // sessionStorage: per-submission
    var CONVERSION_TOKEN_KEY = 'pending_conversion';  // sessionStorage: one-shot, read by thank-you.html

    // Attribution TTL, doing double duty: it caps how long first-touch is held onto, AND it
    // is the retention window — a record untouched for this long is deleted on next read, so
    // the 90 days disclosed in privacy-policy.html is real and not just a reset interval.
    // 90 days matches Google's _gcl_aw cookie; shorter would undercount personal-injury
    // consideration cycles, which routinely run weeks.
    var ATTR_TTL_MS = 90 * 24 * 60 * 60 * 1000;

    var TRACKING_PARAMS = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'gclid',      // Google Ads Click ID
        'gbraid',     // Google Ads Broad Match (iOS/cross-domain)
        'wbraid',     // Google Ads Web-to-App
        'fbclid',     // Meta Click ID — covers both Facebook and Instagram
        'ttclid',     // TikTok Click ID
        'msclkid'     // Microsoft Ads Click ID
    ];

    /**
     * Parse URL parameters and extract tracking data
     * @returns {Object} Object containing tracking parameters
     */
    function captureTrackingParams() {
        var trackingData = {};
        var urlParams = new URLSearchParams(window.location.search);

        // Capture all tracking parameters from URL
        TRACKING_PARAMS.forEach(function(param) {
            var value = urlParams.get(param);
            if (value) {
                trackingData[param] = value;
            }
        });

        // Add additional context. Every key here must also be declared as a hidden input in
        // the forms (and in netlify-form-template.html) or Netlify drops it from
        // notifications — which is why there's no `timestamp`: Netlify already stamps each
        // submission, and first_touch_ts covers the attribution timing that isn't redundant.
        if (Object.keys(trackingData).length > 0) {
            trackingData.landing_page = window.location.pathname;
            trackingData.referrer = document.referrer || 'direct';
        }

        return trackingData;
    }

    /**
     * Read the stored attribution record, or an empty shell if absent/corrupt.
     * @returns {{first: Object|null, first_ts: number, last: Object|null, last_ts: number}}
     */
    function readAttr() {
        var empty = { first: null, first_ts: 0, last: null, last_ts: 0 };
        try {
            var raw = localStorage.getItem(ATTR_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed === 'object') {
                // Enforce the disclosed retention window: a record untouched for the full TTL
                // is deleted rather than kept indefinitely.
                if (parsed.last_ts && (Date.now() - parsed.last_ts) > ATTR_TTL_MS) {
                    localStorage.removeItem(ATTR_KEY);
                    return empty;
                }
                return parsed;
            }
        } catch (e) {
            console.warn('[Ad Tracking] Could not read attribution record:', e);
        }
        return empty;
    }

    /**
     * Record a freshly captured param set. Last-touch is always overwritten; first-touch is
     * written only when absent or past its TTL, so the original source of a long
     * consideration cycle survives later visits and closed tabs.
     * @param {Object} data - Newly captured tracking params
     */
    function storeTrackingData(data) {
        if (!data || Object.keys(data).length === 0) {
            return;
        }

        var rec = readAttr();
        var now = Date.now();

        if (!rec.first || !rec.first_ts || (now - rec.first_ts) > ATTR_TTL_MS) {
            rec.first = data;
            rec.first_ts = now;
        }
        rec.last = data;
        rec.last_ts = now;

        try {
            localStorage.setItem(ATTR_KEY, JSON.stringify(rec));
        } catch (e) {
            console.warn('[Ad Tracking] Could not store attribution record:', e);
        }
    }

    /**
     * Tracking data for hidden form fields and dataLayer events.
     *
     * Returns LAST-touch params — what the ad platforms expect for click IDs — plus a few
     * first-touch fields, so a lead notification shows where the visitor originally came
     * from and not only the click that closed them.
     * @returns {Object} Tracking data, or empty object if nothing has been captured
     */
    function getTrackingData() {
        var rec = readAttr();
        if (!rec.last) {
            return {};
        }

        var out = {};
        Object.keys(rec.last).forEach(function (key) {
            out[key] = rec.last[key];
        });

        if (rec.first) {
            if (rec.first.utm_source) out.first_utm_source = rec.first.utm_source;
            if (rec.first.utm_medium) out.first_utm_medium = rec.first.utm_medium;
            if (rec.first.landing_page) out.first_landing_page = rec.first.landing_page;
            if (rec.first_ts) out.first_touch_ts = new Date(rec.first_ts).toISOString();
        }

        return out;
    }

    /**
     * Inject hidden fields into a form with tracking data
     * @param {HTMLFormElement} form - The form element to inject fields into
     * @param {Object} trackingData - The tracking data to inject
     */
    function injectHiddenFields(form, trackingData) {
        if (!form || !trackingData || Object.keys(trackingData).length === 0) {
            return;
        }

        // Populate tracking fields (update existing or create new).
        // Note: Netlify Forms builds its field list from the STATIC HTML at deploy time, so
        // fields created here only reach the notification if they're also declared in the
        // page markup. That's why the forms declare them explicitly.
        Object.keys(trackingData).forEach(function(key) {
            var existingInput = form.querySelector('input[name="' + key + '"]');

            if (existingInput) {
                existingInput.value = trackingData[key];
            } else {
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = trackingData[key];
                input.setAttribute('data-ad-tracking', 'true');
                form.appendChild(input);
            }
        });
    }

    /**
     * Initialize tracking for all forms on the page
     */
    function initializeForms() {
        var trackingData = getTrackingData();
        if (Object.keys(trackingData).length === 0) {
            return;
        }

        // Find all forms (Netlify strips data-netlify attr at build time, so use name+method)
        var forms = document.querySelectorAll('form[name][method="POST"]');

        forms.forEach(function(form) {
            injectHiddenFields(form, trackingData);
        });
    }

    /**
     * Get click location identifier from phone link
     * @param {HTMLElement} element - The clicked phone link
     * @returns {string} Location identifier
     */
    function getPhoneClickLocation(element) {
        // Try to determine location from closest section or ID
        var hero = element.closest('.hero, .hero-section');
        var header = element.closest('header, .header');
        var footer = element.closest('footer, .footer');
        var cta = element.closest('.cta, .cta-section');
        var mobile = element.closest('.mobile-nav, .mobile-menu');

        if (hero) return 'hero';
        if (header) return 'header';
        if (mobile) return 'mobile-nav';
        if (cta) return 'bottom-cta';
        if (footer) return 'footer';

        // Fallback to element ID or class
        if (element.id) return element.id;
        if (element.className) return element.className.split(' ')[0];

        return 'unknown';
    }

    /**
     * Track phone click event to GTM dataLayer
     * @param {Event} event - The click event
     */
    function trackPhoneClick(event) {
        var element = event.currentTarget;
        var phoneNumber = element.href.replace('tel:', '').replace(/\D/g, '');
        var clickLocation = getPhoneClickLocation(element);
        var trackingData = getTrackingData();

        // Ensure dataLayer exists
        window.dataLayer = window.dataLayer || [];

        // Push event to dataLayer
        var eventData = {
            event: 'phone_click',
            phone_number: phoneNumber,
            click_location: clickLocation,
            page_path: window.location.pathname
        };

        // Merge tracking data
        Object.keys(trackingData).forEach(function(key) {
            eventData[key] = trackingData[key];
        });

        window.dataLayer.push(eventData);
    }

    /**
     * Initialize phone click tracking
     */
    function initializePhoneTracking() {
        var phoneLinks = document.querySelectorAll('a[href^="tel:"]');

        phoneLinks.forEach(function(link) {
            link.addEventListener('click', trackPhoneClick);
        });
    }

    /**
     * Get form type identifier
     * @param {HTMLFormElement} form - The form element
     * @returns {string} Form type identifier
     */
    function getFormType(form) {
        var formId = form.id || '';
        // getAttribute, not form.name: every lead form has an <input name="name">, and a
        // form's named-control lookup shadows the property, so form.name is that INPUT
        // ELEMENT. formName.includes() then throws and this whole submit handler dies.
        var formName = form.getAttribute('name') || '';

        // Check for mobile
        if (formId.includes('mobile') || formName.includes('mobile')) {
            return 'mobile-hero';
        }

        // Check for hero
        if (formId.includes('hero') || formName.includes('hero') || form.closest('.hero')) {
            return 'hero';
        }

        // Check for bottom
        if (formId.includes('bottom') || formName.includes('bottom') || form.closest('.cta, .cta-section')) {
            return 'bottom';
        }

        // Check for modal
        if (formId.includes('modal') || formName.includes('modal') || form.closest('.modal')) {
            return 'modal';
        }

        return 'unknown';
    }

    /**
     * Extract and normalize user-provided data from a lead form for Google Ads
     * Enhanced Conversions. Returns null if neither email nor phone is present.
     * Raw values are stashed; GTM's Google Ads tag hashes (SHA-256) before send.
     * @param {HTMLFormElement} form - The submitted form
     * @returns {Object|null} leadsUserData object or null
     */
    function extractLeadsUserData(form) {
        // Opt-out for forms whose submitters must never have contact data staged for ad
        // platforms. The mass tort intake forms carry this: a submission there reports a
        // child's psychiatric diagnosis or sexual abuse, and this stash is written regardless
        // of Consent Mode state. Opt-in per form so nothing else changes behaviour.
        if (form.hasAttribute('data-no-enhanced-conversions')) {
            return null;
        }

        var emailInput = form.querySelector('input[name="email"]');
        var phoneInput = form.querySelector('input[name="phone"]');
        var nameInput = form.querySelector('input[name="name"]');

        var email = emailInput ? emailInput.value.trim().toLowerCase() : '';
        var rawPhone = phoneInput ? phoneInput.value : '';
        var digits = rawPhone.replace(/\D/g, '');
        var phone = '';
        if (digits.length === 10) {
            phone = '+1' + digits;
        } else if (digits.length === 11 && digits.charAt(0) === '1') {
            phone = '+' + digits;
        } else if (digits.length > 0) {
            phone = '+' + digits;
        }

        if (!email && !phone) {
            return null;
        }

        var data = {};
        if (email) data.email = email;
        if (phone) data.phone_number = phone;

        if (nameInput && nameInput.value.trim()) {
            var nameParts = nameInput.value.trim().split(/\s+/);
            var firstName = nameParts.shift();
            var lastName = nameParts.join(' ');
            data.address = { first_name: firstName };
            if (lastName) data.address.last_name = lastName;
        }

        return data;
    }

    /**
     * Track form submission event to GTM dataLayer
     * @param {Event} event - The submit event
     */
    function trackFormSubmit(event) {
        var form = event.target;
        var formName = form.getAttribute('name') || form.id || 'unnamed-form';  // see getFormType
        var formType = getFormType(form);
        var trackingData = getTrackingData();

        // Ensure dataLayer exists
        window.dataLayer = window.dataLayer || [];

        // Push event to dataLayer
        var eventData = {
            event: 'form_submit',
            form_name: formName,
            form_type: formType,
            page_path: window.location.pathname
        };

        // Merge tracking data
        Object.keys(trackingData).forEach(function(key) {
            eventData[key] = trackingData[key];
        });

        window.dataLayer.push(eventData);

        // Everything below represents a lead, so skip it when the browser can already tell the
        // form is incomplete. js/form-validation.js calls preventDefault() on invalid forms,
        // but that does NOT stop this listener — it's a separate handler on the same element —
        // so without this guard a failed attempt would arm the conversion token.
        // Forms carry `novalidate` (custom error UI), which suppresses the native bubbles but
        // leaves checkValidity() working.
        if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
            return;
        }

        // Stash user-provided data for Enhanced Conversions on thank-you.html
        var leadsUserData = extractLeadsUserData(form);
        if (leadsUserData) {
            try {
                sessionStorage.setItem(EC_STORAGE_KEY, JSON.stringify(leadsUserData));
            } catch (e) {
                console.warn('[Ad Tracking] Could not store enhanced conversion data:', e);
            }
        }

        // One-shot token proving a real submission happened. thank-you.html fires
        // `form_conversion` only when this is present, then clears it — so refreshes,
        // back-navigation and direct hits on the thank-you page don't re-count a lead.
        try {
            sessionStorage.setItem(CONVERSION_TOKEN_KEY, '1');
        } catch (e) {
            console.warn('[Ad Tracking] Could not set conversion token:', e);
        }

        setTimeout(flushCallRailCapture, 0);
    }

    /**
     * Send CallRail's form capture before the native POST navigates away.
     *
     * CallRail's external_forms.js (loaded via GTM) does not preventDefault or use
     * keepalive: on submit it writes the parsed form to localStorage `calltrk_form_data`
     * and schedules a plain XHR behind a 1s debounce. Our forms POST natively, so the
     * page unloads first and that XHR never fires. CallRail then relies on re-sending
     * from localStorage when the NEXT page loads swap.js — which loses the lead whenever
     * the visitor leaves the thank-you page early or the script is blocked there.
     * Verified headlessly 2026-08-28: 0/5 captures fired on the form page itself.
     *
     * Runs on a 0ms timer so CallRail's own synchronous submit listener has written the
     * final payload; a form POST's navigation doesn't start until handlers finish, and
     * `keepalive` lets the request outlive the unload. Nothing here parses form data —
     * we forward CallRail's own stash to CallRail's own endpoint (same company/access key
     * as the GTM tag). The stash is cleared synchronously once the request is issued:
     * the response arrives after unload, so a .then() never runs, and leaving the stash
     * made CallRail's thank-you retry double-submit every lead (verified live, two
     * `success:true` responses). A keepalive request is delivered by the browser even
     * after unload, so the only loss case is a network failure — which would have failed
     * the Netlify POST too.
     */
    var CALLRAIL_CAPTURE_URL = 'https://app.callrail.com/companies/957398046/becf11a93c25bc6ff502/12/form_capture.json';
    function flushCallRailCapture() {
        var raw;
        try { raw = localStorage.getItem('calltrk_form_data'); } catch (e) { return; }
        if (!raw || typeof fetch !== 'function') return;
        try {
            fetch(CALLRAIL_CAPTURE_URL, {
                method: 'POST',
                body: raw,
                keepalive: true,
                headers: { 'Content-Type': 'text/plain', 'Accept': 'application/json' }
            }).catch(function() { /* nothing to do post-unload */ });
            localStorage.removeItem('calltrk_form_data');
        } catch (e) { /* fetch threw synchronously — leave the stash for CallRail's retry */ }
    }

    /**
     * Initialize form submission tracking
     */
    function initializeFormTracking() {
        var forms = document.querySelectorAll('form[name][method="POST"]');

        forms.forEach(function(form) {
            form.addEventListener('submit', trackFormSubmit);
        });
    }

    /**
     * Initialize all tracking functionality
     */
    function init() {

        // Step 1: Capture URL parameters
        var capturedData = captureTrackingParams();

        // Step 2: Store data if we captured anything new
        if (Object.keys(capturedData).length > 0) {
            storeTrackingData(capturedData);
        }

        // Always track form submissions (form_submit event + enhanced
        // conversion data stash) regardless of traffic source — organic
        // leads also need to feed Enhanced Conversions for Leads.
        initializeFormTracking();

        // Step 3: Get stored tracking data (might be from previous page)
        var trackingData = getTrackingData();

        if (Object.keys(trackingData).length === 0) {
            return;
        }


        // Step 4: Initialize forms with hidden fields (UTM/gclid injection)
        initializeForms();

        // Step 5: Initialize phone click tracking
        initializePhoneTracking();

    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOM already loaded
        init();
    }

    // Re-initialize forms if new content is dynamically loaded
    // (e.g., modals opened via component-loader)
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) { // Element node
                        // Check if added node contains forms
                        var forms = node.querySelectorAll ? node.querySelectorAll('form[name][method="POST"]') : [];
                        if (forms.length > 0 || (node.tagName === 'FORM' && node.getAttribute('method') === 'POST' && node.hasAttribute('name'))) {
                            setTimeout(function() {
                                initializeForms();
                                initializeFormTracking();
                            }, 100);
                        }
                    }
                });
            }
        });
    });

    // Observe body for dynamically added forms
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
