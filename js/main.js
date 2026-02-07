/**
 * Frank Penney Injury Law - Main JavaScript
 * Static Site Version
 */

(function () {
    'use strict';

    /**
     * DOM Ready - conditional initialization
     * Skip if components are being loaded (component-loader.js will handle it)
     */
    document.addEventListener('DOMContentLoaded', function () {
        if (!document.body.classList.contains('components-loading')) {
            initMobileMenu();
            initStickyHeader();
            initScrollReveal();
            initSmoothScroll();
            initAttorneyDropdown();
            initLocationDropdown();
            initPracticeAreaDropdown();
            initMobileDropdown();
        }
    });

    // Expose functions globally for component-loader.js
    window.initMobileMenu = initMobileMenu;
    window.initStickyHeader = initStickyHeader;
    window.initScrollReveal = initScrollReveal;
    window.initSmoothScroll = initSmoothScroll;
    window.initAttorneyDropdown = initAttorneyDropdown;
    window.initLocationDropdown = initLocationDropdown;
    window.initPracticeAreaDropdown = initPracticeAreaDropdown;
    window.initMobileDropdown = initMobileDropdown;
    window.initLanguageSelector = initLanguageSelector;

    /**
     * Mobile Menu Toggle
     */
    function initMobileMenu() {
        const toggle = document.getElementById('mobile-menu-toggle');
        const mobileNav = document.getElementById('mobile-nav');
        const navMenu = document.querySelector('.nav-menu');

        if (!toggle) return;

        toggle.addEventListener('click', function () {
            const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', !isExpanded);

            // Toggle mobile nav
            if (mobileNav) {
                mobileNav.classList.toggle('active');
                mobileNav.setAttribute('aria-hidden', isExpanded);
                if (isExpanded) {
                    toggle.focus();
                }
            }

            // Toggle regular nav menu on tablet
            if (navMenu) {
                navMenu.classList.toggle('active');
            }

            // Toggle body scroll
            document.body.classList.toggle('menu-open');

            // Animate hamburger icon
            toggle.classList.toggle('active');
        });

        // Close menu on link click (except dropdown triggers)
        const mobileLinks = document.querySelectorAll('.mobile-menu a, .nav-menu a');
        mobileLinks.forEach(function (link) {
            link.addEventListener('click', function () {
                // Don't close menu if clicking a dropdown trigger
                if (this.classList.contains('mobile-dropdown-trigger')) {
                    return;
                }
                if (mobileNav) {
                    mobileNav.classList.remove('active');
                }
                if (navMenu) {
                    navMenu.classList.remove('active');
                }
                toggle.classList.remove('active');
                toggle.setAttribute('aria-expanded', 'false');
                document.body.classList.remove('menu-open');
            });
        });

        // Close menu on escape key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && mobileNav && mobileNav.classList.contains('active')) {
                mobileNav.classList.remove('active');
                if (navMenu) {
                    navMenu.classList.remove('active');
                }
                toggle.classList.remove('active');
                toggle.setAttribute('aria-expanded', 'false');
                document.body.classList.remove('menu-open');
                toggle.focus();
            }
        });
    }

    /**
     * Sticky Header
     */
    function initStickyHeader() {
        const header = document.getElementById('site-header');
        if (!header) return;

        let lastScroll = 0;
        const scrollThreshold = 100;

        window.addEventListener('scroll', function () {
            const currentScroll = window.pageYOffset;

            // Add scrolled class when past threshold
            if (currentScroll > scrollThreshold) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }

            lastScroll = currentScroll;
        });
    }

    /**
     * Scroll Reveal Animation
     */
    function initScrollReveal() {
        const revealElements = document.querySelectorAll('[data-reveal]');

        if (!revealElements.length) return;

        const revealOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const revealCallback = function (entries, observer) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target);
                }
            });
        };

        // Check if IntersectionObserver is supported
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver(revealCallback, revealOptions);

            revealElements.forEach(function (el) {
                observer.observe(el);
            });
        } else {
            // Fallback for older browsers - just show all elements
            revealElements.forEach(function (el) {
                el.classList.add('revealed');
            });
        }
    }

    /**
     * Smooth Scroll for Anchor Links
     */
    function initSmoothScroll() {
        const anchors = document.querySelectorAll('a[href^="#"]:not([href="#"])');
        const header = document.getElementById('site-header');

        // Use default height initially to avoid forced reflow during page load
        // Actual height is measured lazily on first interaction
        let headerHeight = 120;
        let headerHeightMeasured = false;
        let resizeTimeout;

        function measureHeaderHeight() {
            if (header) {
                headerHeight = header.offsetHeight;
                headerHeightMeasured = true;
            }
        }

        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(measureHeaderHeight, 150);
        });

        anchors.forEach(function (anchor) {
            anchor.addEventListener('click', function (e) {
                const targetId = this.getAttribute('href');
                const targetElement = document.querySelector(targetId);

                if (targetElement) {
                    e.preventDefault();

                    // Measure header height on first click if not yet measured
                    if (!headerHeightMeasured) {
                        measureHeaderHeight();
                    }

                    const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - headerHeight - 20;

                    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    window.scrollTo({
                        top: targetPosition,
                        behavior: prefersReducedMotion ? 'auto' : 'smooth'
                    });
                }
            });
        });
    }

    /**
     * Attorney Dropdown Hover
     */
    function initAttorneyDropdown() {
        const dropdownItems = document.querySelectorAll('.dropdown-item[data-attorney]');
        const previewImages = document.querySelectorAll('.attorney-preview');

        if (!dropdownItems.length) return;

        // Set default active image (Frank Penney)
        const defaultImage = document.querySelector('.attorney-preview[data-attorney="frank-penney"]');
        if (defaultImage) {
            defaultImage.classList.add('active');
        }

        dropdownItems.forEach(function (item) {
            item.addEventListener('mouseenter', function () {
                const attorney = this.getAttribute('data-attorney');

                // Hide all images
                previewImages.forEach(function (img) {
                    img.classList.remove('active');
                });

                // Show the hovered attorney's image
                const targetImage = document.querySelector('.attorney-preview[data-attorney="' + attorney + '"]');
                if (targetImage) {
                    targetImage.classList.add('active');
                }
            });
        });

        // Reset to default when leaving dropdown
        const dropdown = document.querySelector('.attorney-dropdown');
        if (dropdown) {
            dropdown.addEventListener('mouseleave', function () {
                previewImages.forEach(function (img) {
                    img.classList.remove('active');
                });
                if (defaultImage) {
                    defaultImage.classList.add('active');
                }
            });
        }
    }

    /**
     * Location Dropdown Hover
     */
    function initLocationDropdown() {
        const dropdownItems = document.querySelectorAll('.dropdown-item[data-location]');
        const previewImages = document.querySelectorAll('.location-preview');

        if (!dropdownItems.length) return;

        // Set default active image (Roseville)
        const defaultImage = document.querySelector('.location-preview[data-location="roseville"]');
        if (defaultImage) {
            defaultImage.classList.add('active');
        }

        dropdownItems.forEach(function (item) {
            item.addEventListener('mouseenter', function () {
                const location = this.getAttribute('data-location');

                // Hide all images
                previewImages.forEach(function (img) {
                    img.classList.remove('active');
                });

                // Show the hovered location's image
                const targetImage = document.querySelector('.location-preview[data-location="' + location + '"]');
                if (targetImage) {
                    targetImage.classList.add('active');
                }
            });
        });

        // Reset to default when leaving dropdown
        const dropdown = document.querySelector('.location-dropdown');
        if (dropdown) {
            dropdown.addEventListener('mouseleave', function () {
                previewImages.forEach(function (img) {
                    img.classList.remove('active');
                });
                if (defaultImage) {
                    defaultImage.classList.add('active');
                }
            });
        }
    }

    /**
     * Practice Area Dropdown Hover
     */
    function initPracticeAreaDropdown() {
        const dropdownItems = document.querySelectorAll('.dropdown-item[data-practice]');
        const previewImages = document.querySelectorAll('.practice-preview');

        if (!dropdownItems.length) return;

        // Set default active image (Car Accidents)
        const defaultImage = document.querySelector('.practice-preview[data-practice="car-accidents"]');
        if (defaultImage) {
            defaultImage.classList.add('active');
        }

        dropdownItems.forEach(function (item) {
            item.addEventListener('mouseenter', function () {
                const practice = this.getAttribute('data-practice');

                // Hide all images
                previewImages.forEach(function (img) {
                    img.classList.remove('active');
                });

                // Show the hovered practice area's image
                const targetImage = document.querySelector('.practice-preview[data-practice="' + practice + '"]');
                if (targetImage) {
                    targetImage.classList.add('active');
                }
            });
        });

        // Reset to default when leaving dropdown
        const dropdown = document.querySelector('.practice-area-dropdown');
        if (dropdown) {
            dropdown.addEventListener('mouseleave', function () {
                previewImages.forEach(function (img) {
                    img.classList.remove('active');
                });
                if (defaultImage) {
                    defaultImage.classList.add('active');
                }
            });
        }
    }

    /**
     * Mobile Dropdown Toggle
     */
    function initMobileDropdown() {
        const mobileDropdownTriggers = document.querySelectorAll('.mobile-dropdown-trigger');

        mobileDropdownTriggers.forEach(function (trigger) {
            trigger.addEventListener('click', function (e) {
                e.preventDefault();
                const parent = this.closest('.mobile-dropdown');
                if (parent) {
                    parent.classList.toggle('open');
                    const isOpen = parent.classList.contains('open');
                    this.setAttribute('aria-expanded', isOpen);
                }
            });
        });
    }

    /**
     * ==========================================
     * DEEPL TRANSLATION API INTEGRATION (via Netlify Function)
     * Free tier: 500,000 characters/month
     * API key is securely stored on the server (not exposed to clients)
     * ==========================================
     */

    // Netlify Function endpoint for secure translation
    // The API key is stored as an environment variable on Netlify
    const TRANSLATION_ENDPOINT = '/.netlify/functions/translate';


    const TRANSLATION_CACHE_VERSION = '2.0'; // Increment when selectors change significantly

    let currentLanguage = 'en';
    let originalTexts = new Map(); // Store original English text
    let translationCache = {}; // Cache translations to reduce API calls
    let isTranslating = false;

    // Load cache from localStorage with versioning
    try {
        const cached = localStorage.getItem('translationCache');
        const version = localStorage.getItem('translationCacheVersion');

        if (cached && version === TRANSLATION_CACHE_VERSION) {
            translationCache = JSON.parse(cached);
        } else {
            // Clear old cache if version mismatch
            localStorage.removeItem('translationCache');
            localStorage.setItem('translationCacheVersion', TRANSLATION_CACHE_VERSION);
            translationCache = {};
        }
    } catch (e) {
        translationCache = {};
    }

    // Elements to translate (CSS selectors) - comprehensive coverage
    const TRANSLATABLE_SELECTORS = [
        // ============================================
        // HEADER & NAVIGATION
        // ============================================
        // Top bar messages
        '.top-message',
        '.top-message-secondary',
        '.available-247',

        // Desktop navigation
        '.nav-menu a',                    // Main menu links (Home, Practice Areas, etc.)
        '.dropdown-item',                 // Dropdown menu items

        // Mobile navigation
        '.mobile-menu a',                 // Mobile menu links
        '.mobile-dropdown-trigger',       // Mobile dropdown triggers
        '.mobile-language-label',         // "Language" label

        // Language selector (desktop)
        '.language-option',               // "English", "Español", "Русский"

        // ============================================
        // HERO SECTION
        // ============================================
        '.hero h1',
        '.hero-subtitle',
        '.hero-tagline',
        '.hero-description',
        '.hero-stat-label',               // Stats like "Recovered", "Years Experience"
        '.hero-form-title',
        '.hero-form-subtitle',

        // ============================================
        // HEADINGS & TEXT BLOCKS
        // ============================================
        'h1:not(.logo):not(.site-logo)',  // All h1 except logo
        'h2', 'h3', 'h4', 'h5',           // All other headings
        'p',                               // All paragraphs (with exclusions handled in getTranslatableElements)
        '.lead',                           // Lead paragraphs
        'li',                              // List items (practice area lists, feature lists)
        'strong',                          // Bold text

        // ============================================
        // SECTIONS
        // ============================================
        '.section-subtitle',
        '.section-title',
        '.section-description',
        '.page-title',
        '.page-subtitle',

        // ============================================
        // CARDS & COMPONENTS
        // ============================================
        // Practice area cards
        '.practice-card-title',
        '.practice-card-text',
        '.card-title',
        '.card-text',
        '.card-description',

        // Attorney cards
        '.attorney-card-name',
        '.attorney-card-title',

        // Location cards
        '.location-card-city',
        '.location-card-address',
        '.location-card-link',

        // Why choose us
        '.why-item-title',
        '.why-item-text',

        // ============================================
        // CTA SECTIONS
        // ============================================
        '#cta-tagline',                   // ID-based CTA content (populated by JS)
        '#cta-title',
        '#cta-description',
        '.cta-tagline',                   // Class-based fallback
        '.cta-title',
        '.cta-subtitle',
        '.cta-description',

        // ============================================
        // FORMS
        // ============================================
        '.form-label',
        '.form-disclaimer',
        '.form-error',

        // ============================================
        // BUTTONS
        // ============================================
        '.btn:not(.language-toggle):not(.mobile-menu-toggle)', // All buttons except language/menu toggles
        '.btn-text',

        // ============================================
        // FOOTER
        // ============================================
        '.footer-tagline',                // "BANK ON FRANK!"
        '.footer-description',
        '.footer-title',                  // "Quick Links", "Practice Areas", "Contact Us"
        '.footer-links a',                // All footer link text
        '.footer-copyright',              // Copyright text
        '.footer-legal-links a',          // Privacy Policy, Terms, Disclaimer links

        // ============================================
        // BREADCRUMBS
        // ============================================
        '.breadcrumbs-link',
        '.breadcrumbs-current',

        // ============================================
        // CONTACT INFO
        // ============================================
        '.contact-info-item h3',          // Contact info headings
        '.contact-info-text',             // Contact info descriptions

        // ============================================
        // OTHER COMMON ELEMENTS
        // ============================================
        '.tagline',
        '.description'
    ];

    /**
     * Language Selector - MyMemory API Version
     */
    function initLanguageSelector() {
        const selector = document.querySelector('.language-selector');
        const toggle = document.querySelector('.language-toggle');
        const menu = document.querySelector('.language-menu');
        const options = document.querySelectorAll('.language-option');
        const mobileOptions = document.querySelectorAll('.language-option-mobile');
        const currentLangSpan = document.querySelector('.current-lang');

        if (!selector || !toggle) return;

        // Language display names
        const langNames = {
            'en': 'EN',
            'es': 'ES',
            'ru': 'RU'
        };

        // Load saved language preference and translate if needed
        const savedLang = localStorage.getItem('selectedLanguage') || 'en';
        currentLanguage = savedLang;
        updateLanguageUI(savedLang, langNames, currentLangSpan, mobileOptions);

        if (savedLang !== 'en') {
            // Delay initial translation to allow page to load
            setTimeout(function() {
                translatePage(savedLang);
            }, 500);
        }

        // Toggle dropdown
        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            selector.classList.toggle('active');
            toggle.setAttribute('aria-expanded', selector.classList.contains('active'));
            if (menu) {
                menu.setAttribute('aria-hidden', !selector.classList.contains('active'));
            }
        });

        // Close on outside click
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.language-selector')) {
                selector.classList.remove('active');
                toggle.setAttribute('aria-expanded', 'false');
                if (menu) {
                    menu.setAttribute('aria-hidden', 'true');
                }
            }
        });

        // Desktop language selection
        options.forEach(function (option) {
            option.addEventListener('click', function (e) {
                e.preventDefault();
                const lang = this.getAttribute('data-lang');
                handleLanguageChange(lang, langNames, currentLangSpan, mobileOptions);
                selector.classList.remove('active');
            });
        });

        // Mobile language selection
        mobileOptions.forEach(function (option) {
            option.addEventListener('click', function (e) {
                e.preventDefault();
                const lang = this.getAttribute('data-lang');
                handleLanguageChange(lang, langNames, currentLangSpan, mobileOptions);
            });
        });
    }

    /**
     * Update Language UI
     */
    function updateLanguageUI(langCode, langNames, currentLangSpan, mobileOptions) {
        if (currentLangSpan) {
            currentLangSpan.textContent = langNames[langCode] || langCode.toUpperCase();
        }

        // Update mobile active state
        mobileOptions.forEach(function (opt) {
            opt.classList.remove('active');
            if (opt.getAttribute('data-lang') === langCode) {
                opt.classList.add('active');
            }
        });
    }

    /**
     * Handle Language Change
     */
    async function handleLanguageChange(lang, langNames, currentLangSpan, mobileOptions) {
        if (lang === currentLanguage || isTranslating) return;

        currentLanguage = lang;
        localStorage.setItem('selectedLanguage', lang);
        updateLanguageUI(lang, langNames, currentLangSpan, mobileOptions);

        await translatePage(lang);
    }

    /**
     * Translate text using DeepL API via secure Netlify Function
     * Free tier: 500,000 characters/month
     * API key is kept secret on the server
     */
    async function translateText(text, targetLang) {
        if (!text || text.trim().length === 0) return text;

        // Skip very short strings or numbers only
        const trimmed = text.trim();
        if (trimmed.length < 2 || /^[\d\s\$\+\%\.\,\-\(\)]+$/.test(trimmed)) {
            return text;
        }

        // Check cache first
        const cacheKey = targetLang + ':' + trimmed;
        if (translationCache[cacheKey]) {
            return translationCache[cacheKey];
        }

        try {
            // Call Netlify Function instead of DeepL directly
            const response = await fetch(TRANSLATION_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: trimmed,
                    targetLang: targetLang.toUpperCase()
                })
            });

            if (!response.ok) {
                if (response.status === 403) {
                    console.error('Translation authentication failed');
                } else if (response.status === 429) {
                    console.warn('Translation quota exceeded');
                } else {
                    console.warn('Translation error:', response.status);
                }
                return text;
            }

            const data = await response.json();

            // Extract translated text from response
            const translated = data.translatedText || text;

            // Cache the result
            translationCache[cacheKey] = translated;

            // Save cache to localStorage (limit size)
            try {
                const cacheStr = JSON.stringify(translationCache);
                if (cacheStr.length < 500000) { // Max 500KB cache
                    localStorage.setItem('translationCache', cacheStr);
                }
            } catch (e) {
                // localStorage full, clear old cache
                translationCache = {};
                translationCache[cacheKey] = translated;
            }

            return translated;
        } catch (error) {
            console.warn('Translation failed:', error);
            return text;
        }
    }

    /**
     * Store original text before first translation
     * For elements with styled spans, store innerHTML to preserve structure
     */
    function storeOriginalText(element) {
        if (!originalTexts.has(element)) {
            // Check if element has styled child spans that need preservation
            const hasStyledSpans = element.querySelector('span.highlight, span[class], span[style]');
            if (hasStyledSpans) {
                originalTexts.set(element, { innerHTML: element.innerHTML, isHTML: true });
            } else {
                originalTexts.set(element, { text: element.textContent, isHTML: false });
            }
        }
    }

    /**
     * Get elements to translate
     */
    function getTranslatableElements() {
        const elements = [];
        const seen = new Set();

        TRANSLATABLE_SELECTORS.forEach(function(selector) {
            document.querySelectorAll(selector).forEach(function(el) {
                // Avoid duplicates
                if (seen.has(el)) return;
                seen.add(el);

                // Skip hidden elements
                if (el.offsetParent === null && el.tagName !== 'OPTION') return;

                // Skip elements with no meaningful text
                const text = el.textContent;
                if (!text || text.trim().length < 2) return;

                // Skip form inputs and technical elements
                if (el.matches('input, select, textarea, script, style, noscript')) return;

                // Skip elements inside forms (except labels and disclaimers)
                if (el.closest('form') && !el.matches('.form-label, .form-disclaimer, .form-error')) return;

                // Skip if element has text children that will be translated separately
                // (avoid translating both parent and child)
                const hasTextChildren = Array.from(el.children).some(function(child) {
                    return child.textContent && child.textContent.trim().length > 0 &&
                           !child.tagName.match(/^(SVG|PATH|SPAN|I|EM|STRONG|B)$/i);
                });

                // For broad selectors (p, li, h1-h5, strong), skip if has text children
                if (selector.match(/^(p|li|h[1-5]|strong)$/i) && hasTextChildren) {
                    return;
                }

                // Skip logo text
                if (el.closest('.logo, .site-logo')) return;

                // Skip language selector current lang display (will be updated by language change)
                if (el.matches('.current-lang, .language-option-mobile.active')) return;

                // Add to translation list
                if (!hasTextChildren || el.children.length === 0 || selector.match(/^(\.nav-menu a|\.dropdown-item|\.mobile-menu a|\.footer-links a)$/)) {
                    elements.push(el);
                }
            });
        });

        return elements;
    }

    /**
     * Translate the entire page
     */
    async function translatePage(targetLang) {
        if (targetLang === 'en') {
            // Restore original English text
            originalTexts.forEach(function(originalData, element) {
                if (document.contains(element)) {
                    if (originalData.isHTML) {
                        element.innerHTML = originalData.innerHTML;
                    } else {
                        element.textContent = originalData.text;
                    }
                }
            });
            document.body.classList.remove('translating');
            return;
        }

        const elements = getTranslatableElements();
        if (elements.length === 0) return;

        isTranslating = true;
        document.body.classList.add('translating');

        // Translate elements individually to preserve HTML structure
        let count = 0;
        for (const el of elements) {
            try {
                storeOriginalText(el);
                const originalData = originalTexts.get(el);

                if (originalData.isHTML) {
                    // Element has styled spans - translate while preserving HTML
                    await translateElementWithHTML(el, targetLang);
                } else {
                    // Simple text element - translate normally
                    const translated = await translateText(originalData.text, targetLang);
                    if (document.contains(el)) {
                        el.textContent = translated;
                    }
                }

                // Small delay every 5 translations to be nice to the API
                count++;
                if (count % 5 === 0) {
                    await new Promise(function(resolve) { setTimeout(resolve, 100); });
                }
            } catch (error) {
                console.warn('Failed to translate element:', error);
            }
        }

        isTranslating = false;
        document.body.classList.remove('translating');
    }

    /**
     * Translate element while preserving inner HTML structure (spans, styling)
     */
    async function translateElementWithHTML(element, targetLang) {
        // Get all text nodes and styled spans
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: function(node) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        return node.textContent.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                    }
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN') {
                        return NodeFilter.FILTER_SKIP; // Skip spans, we'll handle their text nodes
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            }
        );

        // Collect all text nodes
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node);
            }
        }

        // Translate each text node
        for (const textNode of textNodes) {
            const originalText = textNode.textContent.trim();
            if (originalText.length > 1) {
                const translated = await translateText(originalText, targetLang);
                textNode.textContent = textNode.textContent.replace(originalText, translated);
            }
        }
    }

    /**
     * Format Phone Number Input
     */
    window.formatPhoneNumber = function (input) {
        // Remove all non-digits
        let value = input.value.replace(/\D/g, '');

        // Format as (XXX) XXX-XXXX
        if (value.length > 0) {
            if (value.length <= 3) {
                value = '(' + value;
            } else if (value.length <= 6) {
                value = '(' + value.substring(0, 3) + ') ' + value.substring(3);
            } else {
                value = '(' + value.substring(0, 3) + ') ' + value.substring(3, 6) + '-' + value.substring(6, 10);
            }
        }

        input.value = value;
    };

})();

/**
 * Add CSS for mobile nav
 */
(function () {
    const style = document.createElement('style');
    style.textContent = `
        .mobile-nav {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(3, 53, 99, 0.98);
            z-index: 999;
            padding: 100px 24px 24px;
            transform: translateX(-100%);
            transition: transform 0.3s ease;
        }

        .mobile-nav.active {
            display: block;
            transform: translateX(0);
        }

        .mobile-menu {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .mobile-menu li {
            margin-bottom: 8px;
        }

        .mobile-menu a {
            display: block;
            padding: 16px 0;
            font-family: 'Montserrat', sans-serif;
            font-size: 1.25rem;
            font-weight: 600;
            color: #fff;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            transition: color 0.3s;
        }

        .mobile-menu a:hover {
            color: #E00D93;
        }

        .mobile-dropdown-trigger {
            display: flex !important;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            font-family: 'Montserrat', sans-serif;
            font-size: 1.25rem;
            font-weight: 600;
            color: #fff;
            background: none;
            border: none;
            width: 100%;
            padding: 16px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            text-align: left;
        }

        .mobile-dropdown-trigger:hover {
            color: #E00D93;
        }

        .mobile-dropdown-trigger .dropdown-arrow {
            transition: transform 0.3s ease;
            margin-left: 8px;
        }

        .mobile-dropdown.open > .mobile-dropdown-trigger .dropdown-arrow {
            transform: rotate(180deg);
        }

        .mobile-dropdown-menu {
            display: none;
            list-style: none;
            padding: 0 0 0 20px;
            margin: 0;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
        }

        .mobile-dropdown.open > .mobile-dropdown-menu {
            display: block;
        }

        .mobile-dropdown-menu li {
            margin-bottom: 0;
        }

        .mobile-dropdown-menu a {
            font-size: 1rem;
            font-weight: 500;
            padding: 12px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .mobile-dropdown-menu a:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .mobile-nav-cta {
            margin-top: 32px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .mobile-menu-toggle.active span:nth-child(1) {
            transform: rotate(45deg) translate(5px, 5px);
        }

        .mobile-menu-toggle.active span:nth-child(2) {
            opacity: 0;
        }

        .mobile-menu-toggle.active span:nth-child(3) {
            transform: rotate(-45deg) translate(7px, -6px);
        }

        body.menu-open {
            overflow: hidden;
        }

        @media (min-width: 1025px) {
            .mobile-nav {
                display: none !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
