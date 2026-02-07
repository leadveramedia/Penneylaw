/**
 * Component Loader for PenneyLaw Static Site
 * Loads header, footer, and contact modal components via fetch API
 * Page configuration loaded from config/page-config.json
 */

(function() {
    'use strict';

    // Page configuration - loaded from JSON or uses embedded fallback
    var PAGE_CONFIG = null;
    var DEFAULT_CONFIG = {
        type: 'general',
        title: 'Page',
        modalHeading: 'Get Your Free Consultation',
        modalSubtitle: 'Tell us about your case and we\'ll contact you within 24 hours.',
        ctaTagline: 'BANK ON FRANK!',
        ctaTitle: 'Ready to Get the Compensation You Deserve?',
        ctaDescription: 'Don\'t wait to get the help you need. Our team is standing by to provide a free, no-obligation consultation about your case.'
    };

    /**
     * Load page configuration from JSON file
     */
    function loadPageConfig() {
        return fetch('config/page-config.json')
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to load page config');
                }
                return response.json();
            })
            .then(function(data) {
                PAGE_CONFIG = data.pages;
                if (data.defaults) {
                    DEFAULT_CONFIG = data.defaults;
                }
                return data;
            })
            .catch(function(error) {
                console.warn('Could not load page-config.json, using defaults:', error.message);
                // Use empty config, will fall back to defaults
                PAGE_CONFIG = {};
                return null;
            });
    }

    /**
     * Get current page slug from URL
     */
    function getCurrentPageSlug() {
        var path = window.location.pathname;
        var filename = path.split('/').pop() || 'index.html';
        return filename.replace('.html', '') || 'index';
    }

    /**
     * Get page configuration
     */
    function getPageConfig() {
        var slug = getCurrentPageSlug();
        return PAGE_CONFIG[slug] || DEFAULT_CONFIG;
    }

    /**
     * Fetch and inject component HTML
     */
    function loadComponent(url, targetSelector, position) {
        position = position || 'replace';

        return fetch(url)
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to load ' + url);
                }
                return response.text();
            })
            .then(function(html) {
                var target = document.querySelector(targetSelector);

                if (!target) {
                    console.error('Target element not found: ' + targetSelector);
                    return null;
                }

                if (position === 'replace') {
                    target.innerHTML = html;
                } else if (position === 'prepend') {
                    target.insertAdjacentHTML('afterbegin', html);
                } else if (position === 'append') {
                    target.insertAdjacentHTML('beforeend', html);
                }

                return html;
            })
            .catch(function(error) {
                console.error('Error loading component: ' + error.message);
                return null;
            });
    }

    /**
     * Set current page indicator in navigation
     */
    function setCurrentPageIndicator() {
        var slug = getCurrentPageSlug();
        var navItems = document.querySelectorAll('[data-page]');

        navItems.forEach(function(item) {
            var pages = item.getAttribute('data-page').split(',');
            if (pages.indexOf(slug) !== -1) {
                item.classList.add('current-menu-item');
            }
        });
    }

    /**
     * Configure modal with page context
     */
    function configureModal() {
        var config = getPageConfig();

        var modalTitle = document.getElementById('modal-title');
        var modalSubtitle = document.getElementById('modal-subtitle');
        var pageContext = document.getElementById('page-context');

        if (modalTitle) modalTitle.textContent = config.modalHeading;
        if (modalSubtitle) modalSubtitle.textContent = config.modalSubtitle;
        if (pageContext) pageContext.value = config.type + ': ' + config.title;
    }

    /**
     * Configure CTA section with page-specific content
     */
    function configureCTA() {
        var config = getPageConfig();

        var ctaTagline = document.getElementById('cta-tagline');
        var ctaTitle = document.getElementById('cta-title');
        var ctaDescription = document.getElementById('cta-description');

        // Set tagline (hide if empty)
        if (ctaTagline) {
            if (config.ctaTagline) {
                ctaTagline.textContent = config.ctaTagline;
                ctaTagline.style.display = 'block';
            } else {
                ctaTagline.style.display = 'none';
            }
        }

        // Set title and description
        if (ctaTitle) ctaTitle.textContent = config.ctaTitle;
        if (ctaDescription) ctaDescription.textContent = config.ctaDescription;
    }

    /**
     * Initialize auto-hide for floating CTA when other CTAs are visible
     */
    function initFloatingCTAAutoHide() {
        var floatingTrigger = document.getElementById('contact-modal-trigger');
        if (!floatingTrigger) return;

        // Elements that should hide the floating CTA when visible
        var ctaSelectors = [
            '.cta-section',           // Full-width CTA sections
            '.hero-form',             // Hero contact forms
            '.hero .btn-primary',     // Hero CTA buttons
            '.cta-buttons',           // CTA button groups
            '#main-content > section:first-of-type .btn-primary' // First section CTA buttons
        ];

        // Collect all CTA elements
        var ctaElements = [];
        ctaSelectors.forEach(function(selector) {
            document.querySelectorAll(selector).forEach(function(el) {
                ctaElements.push(el);
            });
        });

        if (ctaElements.length === 0) return;

        // Track which CTAs are currently visible
        var visibleCTAs = new Set();

        // Update floating button visibility
        function updateFloatingVisibility() {
            if (visibleCTAs.size > 0) {
                floatingTrigger.classList.add('hidden-by-cta');
            } else {
                floatingTrigger.classList.remove('hidden-by-cta');
            }
        }

        // Create IntersectionObserver to watch CTA elements
        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    visibleCTAs.add(entry.target);
                } else {
                    visibleCTAs.delete(entry.target);
                }
            });
            updateFloatingVisibility();
        }, {
            threshold: 0.3,  // Trigger when 30% of element is visible
            rootMargin: '0px'
        });

        // Observe all CTA elements
        ctaElements.forEach(function(el) {
            observer.observe(el);
        });
    }

    /**
     * Initialize modal interactions
     */
    function initModal() {
        var trigger = document.querySelector('.floating-contact-btn');
        var overlay = document.getElementById('contact-modal-overlay');
        var closeBtn = document.querySelector('.modal-close');
        var modal = document.querySelector('.contact-modal');

        if (!trigger || !overlay) return;

        // Initialize auto-hide behavior
        initFloatingCTAAutoHide();

        // Open modal
        trigger.addEventListener('click', function() {
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('modal-open');
            var firstInput = modal.querySelector('input:not([type="hidden"])');
            if (firstInput) firstInput.focus();
        });

        // Close modal function
        var closeModal = function() {
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
        };

        // Close on X button
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }

        // Close on overlay click
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeModal();
        });

        // Close on escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && overlay.classList.contains('active')) {
                closeModal();
            }
        });
    }

    /**
     * Re-initialize main.js functionality after components load
     */
    function reinitializeMainJS() {
        // These functions are exposed by main.js
        if (typeof window.initMobileMenu === 'function') window.initMobileMenu();
        if (typeof window.initStickyHeader === 'function') window.initStickyHeader();
        if (typeof window.initAttorneyDropdown === 'function') window.initAttorneyDropdown();
        if (typeof window.initLocationDropdown === 'function') window.initLocationDropdown();
        if (typeof window.initPracticeAreaDropdown === 'function') window.initPracticeAreaDropdown();
        if (typeof window.initMobileDropdown === 'function') window.initMobileDropdown();
        if (typeof window.initScrollReveal === 'function') window.initScrollReveal();
        if (typeof window.initSmoothScroll === 'function') window.initSmoothScroll();
        if (typeof window.initLanguageSelector === 'function') window.initLanguageSelector();
    }

    /**
     * Re-initialize form validation for modal form
     */
    function reinitializeFormValidation() {
        // Call after modal loads - function exposed by form-validation.js
        if (typeof window.initContactForms === 'function') window.initContactForms();
    }

    /**
     * Initialize Cookie Consent Banner
     */
    function initCookieConsent() {
        var banner = document.getElementById('cookie-consent');
        var acceptBtn = document.getElementById('cookie-accept');
        var declineBtn = document.getElementById('cookie-decline');

        if (!banner || !acceptBtn || !declineBtn) return;

        // Check if user has already made a choice
        var consentStatus = localStorage.getItem('cookie-consent');

        if (!consentStatus) {
            // Show banner after a short delay for better UX
            setTimeout(function() {
                banner.removeAttribute('hidden');
            }, 1000);
        }

        // Handle Accept button
        acceptBtn.addEventListener('click', function() {
            localStorage.setItem('cookie-consent', 'accepted');
            banner.classList.add('cookie-accepted');
            // Enable analytics/tracking if needed
            if (window.dataLayer) {
                window.dataLayer.push({
                    'event': 'cookie_consent',
                    'consent_status': 'accepted'
                });
            }
        });

        // Handle Decline button
        declineBtn.addEventListener('click', function() {
            localStorage.setItem('cookie-consent', 'declined');
            banner.classList.add('cookie-accepted');
            // Signal declined consent
            if (window.dataLayer) {
                window.dataLayer.push({
                    'event': 'cookie_consent',
                    'consent_status': 'declined'
                });
            }
        });
    }

    /**
     * Initialize Back to Top Button
     */
    function initBackToTop() {
        var backToTop = document.getElementById('back-to-top');
        if (!backToTop) return;

        var scrollThreshold = 400;

        // Show/hide button based on scroll position
        function toggleButton() {
            if (window.scrollY > scrollThreshold) {
                backToTop.removeAttribute('hidden');
            } else {
                backToTop.setAttribute('hidden', '');
            }
        }

        // Scroll to top when clicked
        backToTop.addEventListener('click', function() {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });

        // Throttled scroll listener
        var ticking = false;
        window.addEventListener('scroll', function() {
            if (!ticking) {
                window.requestAnimationFrame(function() {
                    toggleButton();
                    ticking = false;
                });
                ticking = true;
            }
        });

        // Initial check
        toggleButton();
    }

    /**
     * Main initialization
     */
    function init() {
        // Show loading state to prevent FOUC
        document.body.classList.add('components-loading');

        // Load page config first, then components
        loadPageConfig().then(function() {
            // Build list of components to load
            var componentPromises = [
                loadComponent('components/header.html', '#header-placeholder', 'replace'),
                loadComponent('components/footer.html', '#footer-placeholder', 'replace'),
                loadComponent('components/contact-modal.html', 'body', 'append')
            ];

            // Only load CTA component if placeholder exists on the page
            var ctaPlaceholder = document.getElementById('cta-placeholder');
            if (ctaPlaceholder) {
                componentPromises.push(
                    loadComponent('components/cta-section.html', '#cta-placeholder', 'replace')
                );
            }

            // Load all components in parallel
            return Promise.all(componentPromises);
        })
        .then(function() {
            // Use requestAnimationFrame to defer initialization until after layout
            // This prevents forced synchronous layout (reflow) by allowing the browser
            // to complete layout before we read any geometric properties
            requestAnimationFrame(function() {
                // Configure components after loading
                setCurrentPageIndicator();
                configureModal();
                configureCTA();

                // Re-initialize JavaScript functionality
                reinitializeMainJS();
                reinitializeFormValidation();
                initModal();
                initCookieConsent();
                initBackToTop();

                // Remove loading state (batched with other DOM operations)
                document.body.classList.remove('components-loading');
                document.body.classList.add('components-loaded');
            });
        })
        .catch(function(error) {
            console.error('Error initializing components:', error);
            // Still remove loading state on error
            document.body.classList.remove('components-loading');
            document.body.classList.add('components-loaded');
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
