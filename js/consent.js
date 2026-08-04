/**
 * Cookie Consent Banner + Google Consent Mode v2
 *
 * - Renders a bottom-fixed banner on first visit (no cookie + no GPC).
 * - Persists the choice in a first-party cookie (penney_consent, 13-month expiry).
 * - Pushes gtag('consent', 'update', {...}) so GTM/GA4 respect the choice.
 * - Auto-denies when the browser sends Global Privacy Control (CPRA requirement).
 * - Exposes window.openConsentPrefs() for the footer re-prompt links.
 *
 * Consent defaults (all denied) are injected separately in js/component-loader.js
 * (for root pages) and inline in each lp/*.html (for landing pages), so they fire
 * before GTM's gtm.js is inserted. This file only handles the UPDATE step.
 */

(function () {
    'use strict';

    var COOKIE_NAME = 'penney_consent';
    var COOKIE_DAYS = 395; // 13 months

    var DENIED = {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
    };
    var GRANTED = {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
    };

    var banner = null;
    var previouslyFocused = null;

    function gtag() {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(arguments);
    }

    function readCookie() {
        var match = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_NAME + '=([^;]*)'));
        if (!match) return null;
        try {
            return JSON.parse(decodeURIComponent(match[1]));
        } catch (e) {
            return null;
        }
    }

    function writeCookie(value) {
        var expires = new Date();
        expires.setTime(expires.getTime() + COOKIE_DAYS * 24 * 60 * 60 * 1000);
        document.cookie = COOKIE_NAME + '=' + encodeURIComponent(JSON.stringify(value)) +
            '; expires=' + expires.toUTCString() +
            '; path=/; SameSite=Lax; Secure';
    }

    function applyConsent(state, source) {
        var update = state === 'granted' ? GRANTED : DENIED;
        gtag('consent', 'update', update);
        writeCookie({ state: state, source: source || 'user', ts: Date.now() });
    }

    function closeBanner() {
        if (!banner) return;
        banner.classList.remove('consent-banner--visible');
        window.setTimeout(function () {
            if (banner && banner.parentNode) {
                banner.parentNode.removeChild(banner);
            }
            banner = null;
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
            }
            previouslyFocused = null;
        }, 300);
    }

    function handleAccept() {
        applyConsent('granted', 'user');
        closeBanner();
    }

    function handleReject() {
        applyConsent('denied', 'user');
        closeBanner();
    }

    function handleKeydown(e) {
        if (e.key === 'Escape' && banner) {
            handleReject();
        }
    }

    function buildBanner() {
        var root = document.createElement('section');
        root.className = 'consent-banner';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', 'Cookie consent');

        var inner = document.createElement('div');
        inner.className = 'consent-banner__inner';

        var text = document.createElement('div');
        text.className = 'consent-banner__text';

        var heading = document.createElement('p');
        heading.className = 'consent-banner__heading';
        heading.textContent = 'We value your privacy';
        text.appendChild(heading);

        var body = document.createElement('p');
        body.className = 'consent-banner__body';
        // Kept short deliberately: the banner is bottom-fixed and every extra
        // line of copy is a line of the mobile fold it covers.
        body.appendChild(document.createTextNode(
            'We use cookies to analyze traffic and measure ads. See our '
        ));
        var link = document.createElement('a');
        link.href = '/privacy-policy.html';
        link.className = 'consent-banner__link';
        link.textContent = 'Privacy Policy';
        body.appendChild(link);
        body.appendChild(document.createTextNode('.'));
        text.appendChild(body);

        var actions = document.createElement('div');
        actions.className = 'consent-banner__actions';

        // Identical classes on both buttons — 11 CCR § 7004(a)(2) requires the
        // opt-out to be no harder than the opt-in, so neither may be styled as
        // the preferred choice.
        var rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.className = 'btn btn-outline-white consent-banner__btn';
        rejectBtn.textContent = 'Reject All';
        rejectBtn.addEventListener('click', handleReject);

        var acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'btn btn-outline-white consent-banner__btn';
        acceptBtn.textContent = 'Accept All';
        acceptBtn.addEventListener('click', handleAccept);

        actions.appendChild(rejectBtn);
        actions.appendChild(acceptBtn);

        inner.appendChild(text);
        inner.appendChild(actions);
        root.appendChild(inner);

        // Focus the region rather than a button: focusing Accept made it the
        // privileged choice, which is the same § 7004 symmetry problem.
        root.setAttribute('tabindex', '-1');
        return { root: root, initialFocus: root };
    }

    function showBanner() {
        if (banner) return;
        previouslyFocused = document.activeElement;
        var built = buildBanner();
        banner = built.root;
        document.body.appendChild(banner);
        window.requestAnimationFrame(function () {
            banner.classList.add('consent-banner--visible');
            built.initialFocus.focus({ preventScroll: true });
        });
    }

    function init() {
        if (navigator.globalPrivacyControl === true) {
            applyConsent('denied', 'gpc');
            return;
        }
        var stored = readCookie();
        if (stored && stored.state) {
            gtag('consent', 'update', stored.state === 'granted' ? GRANTED : DENIED);
            return;
        }
        showBanner();
    }

    window.openConsentPrefs = function () {
        // Remove any existing banner before re-showing so state stays fresh.
        if (banner && banner.parentNode) {
            banner.parentNode.removeChild(banner);
            banner = null;
        }
        showBanner();
    };

    /**
     * Direct opt-out for the "Do Not Sell or Share My Personal Information"
     * link. This used to call openConsentPrefs(), which reopened the accept/
     * reject prompt — so a consumer exercising the § 1798.120 opt-out landed on
     * a dialog offering to accept instead. The opt-out now simply happens, and
     * the banner reports it with an undo.
     */
    window.optOutOfSale = function () {
        applyConsent('denied', 'user');

        if (banner && banner.parentNode) {
            banner.parentNode.removeChild(banner);
            banner = null;
        }

        var root = document.createElement('section');
        root.className = 'consent-banner';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        root.setAttribute('tabindex', '-1');

        var inner = document.createElement('div');
        inner.className = 'consent-banner__inner';

        var status = document.createElement('p');
        status.className = 'consent-banner__status';
        status.appendChild(document.createTextNode(
            "You've opted out of the sale and sharing of your personal information."
        ));

        var undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'consent-banner__undo';
        undo.textContent = 'Undo';
        undo.addEventListener('click', function () {
            applyConsent('granted', 'user');
            closeBanner();
        });
        status.appendChild(undo);

        inner.appendChild(status);
        root.appendChild(inner);
        document.body.appendChild(root);
        banner = root;

        window.requestAnimationFrame(function () {
            banner.classList.add('consent-banner--visible');
        });
    };

    document.addEventListener('keydown', handleKeydown);

    // Delegated click handler — footer is loaded async by component-loader,
    // so we can't bind directly to the links at init time.
    document.addEventListener('click', function (e) {
        var target = e.target;
        while (target && target !== document) {
            if (target.hasAttribute && target.hasAttribute('data-consent-optout')) {
                e.preventDefault();
                window.optOutOfSale();
                return;
            }
            if (target.hasAttribute && target.hasAttribute('data-consent-prefs')) {
                e.preventDefault();
                window.openConsentPrefs();
                return;
            }
            target = target.parentNode;
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
