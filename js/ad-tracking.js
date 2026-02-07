/**
 * Ad Tracking Script for PenneyLaw Landing Pages
 *
 * Captures URL parameters from paid ad campaigns (UTM params, gclid, fbclid)
 * and injects them into forms for tracking in email notifications and GTM events.
 *
 * Features:
 * - Captures UTM parameters and ad platform click IDs
 * - Stores tracking data in sessionStorage
 * - Auto-injects hidden fields into all Netlify forms
 * - Tracks phone clicks as GTM events
 * - Tracks form submissions as GTM events
 *
 * @version 1.0.0
 */

(function() {
    'use strict';

    // Configuration
    var STORAGE_KEY = 'ad_tracking_data';
    var TRACKING_PARAMS = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'gclid',      // Google Ads Click ID
        'fbclid'      // Facebook Ads Click ID
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

        // Add additional context
        if (Object.keys(trackingData).length > 0) {
            trackingData.landing_page = window.location.pathname;
            trackingData.referrer = document.referrer || 'direct';
            trackingData.timestamp = new Date().toISOString();
        }

        return trackingData;
    }

    /**
     * Store tracking data in sessionStorage
     * @param {Object} data - Tracking data to store
     */
    function storeTrackingData(data) {
        if (!data || Object.keys(data).length === 0) {
            return;
        }

        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            console.log('[Ad Tracking] Stored tracking data:', data);
        } catch (e) {
            console.warn('[Ad Tracking] Could not store tracking data in sessionStorage:', e);
        }
    }

    /**
     * Retrieve tracking data from sessionStorage
     * @returns {Object} Stored tracking data or empty object
     */
    function getTrackingData() {
        try {
            var stored = sessionStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch (e) {
            console.warn('[Ad Tracking] Could not retrieve tracking data:', e);
            return {};
        }
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

        // Check if fields already exist (avoid duplicates)
        var existingFields = form.querySelectorAll('input[data-ad-tracking]');
        if (existingFields.length > 0) {
            console.log('[Ad Tracking] Hidden fields already exist in form:', form.name || form.id);
            return;
        }

        // Inject hidden fields for each tracking parameter
        Object.keys(trackingData).forEach(function(key) {
            var input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = trackingData[key];
            input.setAttribute('data-ad-tracking', 'true'); // Mark for duplicate detection
            form.appendChild(input);
        });

        console.log('[Ad Tracking] Injected tracking fields into form:', form.name || form.id);
    }

    /**
     * Initialize tracking for all forms on the page
     */
    function initializeForms() {
        var trackingData = getTrackingData();
        if (Object.keys(trackingData).length === 0) {
            console.log('[Ad Tracking] No tracking data available');
            return;
        }

        // Find all Netlify forms
        var forms = document.querySelectorAll('form[data-netlify="true"]');
        console.log('[Ad Tracking] Found ' + forms.length + ' Netlify forms');

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
        console.log('[Ad Tracking] Phone click tracked:', eventData);
    }

    /**
     * Initialize phone click tracking
     */
    function initializePhoneTracking() {
        var phoneLinks = document.querySelectorAll('a[href^="tel:"]');
        console.log('[Ad Tracking] Found ' + phoneLinks.length + ' phone links');

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
        var formName = form.name || '';

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
     * Track form submission event to GTM dataLayer
     * @param {Event} event - The submit event
     */
    function trackFormSubmit(event) {
        var form = event.target;
        var formName = form.name || form.id || 'unnamed-form';
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
        console.log('[Ad Tracking] Form submission tracked:', eventData);
    }

    /**
     * Initialize form submission tracking
     */
    function initializeFormTracking() {
        var forms = document.querySelectorAll('form[data-netlify="true"]');

        forms.forEach(function(form) {
            form.addEventListener('submit', trackFormSubmit);
        });
    }

    /**
     * Initialize all tracking functionality
     */
    function init() {
        console.log('[Ad Tracking] Initializing...');

        // Step 1: Capture URL parameters
        var capturedData = captureTrackingParams();

        // Step 2: Store data if we captured anything new
        if (Object.keys(capturedData).length > 0) {
            storeTrackingData(capturedData);
        }

        // Step 3: Get stored tracking data (might be from previous page)
        var trackingData = getTrackingData();

        if (Object.keys(trackingData).length === 0) {
            console.log('[Ad Tracking] No tracking parameters found in URL or storage');
            return;
        }

        console.log('[Ad Tracking] Active tracking data:', trackingData);

        // Step 4: Initialize forms with hidden fields
        initializeForms();

        // Step 5: Initialize phone click tracking
        initializePhoneTracking();

        // Step 6: Initialize form submission tracking
        initializeFormTracking();

        console.log('[Ad Tracking] Initialization complete');
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
                        var forms = node.querySelectorAll ? node.querySelectorAll('form[data-netlify="true"]') : [];
                        if (forms.length > 0 || (node.tagName === 'FORM' && node.hasAttribute('data-netlify'))) {
                            console.log('[Ad Tracking] New forms detected, re-initializing...');
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
