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
        body.appendChild(document.createTextNode(
            'We use cookies to analyze site traffic and improve your experience. ' +
            'You can accept all cookies, reject non-essential cookies, or read our '
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

        var rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.className = 'btn btn-outline-white consent-banner__btn';
        rejectBtn.textContent = 'Reject All';
        rejectBtn.addEventListener('click', handleReject);

        var acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'btn btn-primary consent-banner__btn';
        acceptBtn.textContent = 'Accept All';
        acceptBtn.addEventListener('click', handleAccept);

        actions.appendChild(rejectBtn);
        actions.appendChild(acceptBtn);

        inner.appendChild(text);
        inner.appendChild(actions);
        root.appendChild(inner);

        return { root: root, initialFocus: acceptBtn };
    }

    function showBanner() {
        if (banner) return;
        previouslyFocused = document.activeElement;
        var built = buildBanner();
        banner = built.root;
        document.body.appendChild(banner);
        window.requestAnimationFrame(function () {
            banner.classList.add('consent-banner--visible');
            built.initialFocus.focus();
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

    document.addEventListener('keydown', handleKeydown);

    // Delegated click handler — footer is loaded async by component-loader,
    // so we can't bind directly to the links at init time.
    document.addEventListener('click', function (e) {
        var target = e.target;
        while (target && target !== document) {
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
