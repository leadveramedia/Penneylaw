/**
 * Component Loader for PenneyLaw Static Site
 * Loads header, footer, and contact modal components via fetch API
 * Page configuration loaded from config/page-config.json
 */

(function() {
    'use strict';

    // Load Google Tag Manager
    (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','GTM-PC9XN9DP');

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
        return fetch('/config/page-config.json')
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
        // Handle blog post rewrites: /blog/slug -> blog-post config
        if (path.match(/^\/blog\/[^/]+/)) {
            return 'blog-post';
        }
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
     * Inject JSON-LD structured data for practice-area and location pages.
     * Uses config from page-config.json and the page's meta description.
     * Skips injection if a JSON-LD script already exists in the head.
     */
    function injectJsonLd() {
        var config = getPageConfig();

        // Don't inject if page already has JSON-LD
        if (document.querySelector('head script[type="application/ld+json"]')) return;

        var jsonLd;

        if (config.type === 'practice-area' && config.serviceType) {
            var metaDesc = document.querySelector('meta[name="description"]');
            var canonical = document.querySelector('link[rel="canonical"]');

            jsonLd = {
                '@context': 'https://schema.org',
                '@type': 'LegalService',
                'name': 'Frank Penney Injury Law',
                'description': metaDesc ? metaDesc.content : '',
                'url': canonical ? canonical.href : window.location.href,
                'telephone': '+1-888-888-0566',
                'priceRange': 'Free Consultation',
                'address': {
                    '@type': 'PostalAddress',
                    'streetAddress': '1508 Eureka Rd',
                    'addressLocality': 'Roseville',
                    'addressRegion': 'CA',
                    'postalCode': '95661',
                    'addressCountry': 'US'
                },
                'areaServed': {
                    '@type': 'State',
                    'name': 'California'
                },
                'serviceType': config.serviceType
            };
        } else if (config.type === 'location' && config.streetAddress) {
            jsonLd = {
                '@context': 'https://schema.org',
                '@type': 'LegalService',
                'name': 'Frank Penney Injury Law - ' + config.title,
                'description': config.locationDescription || '',
                'url': 'https://www.penneylaw.com/' + getCurrentPageSlug() + '.html',
                'telephone': '+1-888-888-0566',
                'priceRange': 'Free Consultation',
                'address': {
                    '@type': 'PostalAddress',
                    'streetAddress': config.streetAddress,
                    'addressLocality': config.title,
                    'addressRegion': 'CA',
                    'postalCode': config.postalCode,
                    'addressCountry': 'US'
                },
                'openingHoursSpecification': {
                    '@type': 'OpeningHoursSpecification',
                    'dayOfWeek': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
                    'opens': '00:00',
                    'closes': '23:59'
                },
                'parentOrganization': {
                    '@type': 'LegalService',
                    'name': 'Frank Penney Injury Law',
                    'url': 'https://www.penneylaw.com/'
                }
            };
        } else {
            return;
        }

        var script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(jsonLd);
        document.head.appendChild(script);
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

        if (!overlay) return;

        // Initialize auto-hide behavior
        initFloatingCTAAutoHide();

        var modalTriggerElement = null;

        // Open modal
        var openModal = function() {
            modalTriggerElement = document.activeElement;
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('modal-open');
            var firstInput = modal.querySelector('input:not([type="hidden"])');
            if (firstInput) firstInput.focus();
        };

        // Floating button trigger
        if (trigger) {
            trigger.addEventListener('click', openModal);
        }

        // Event delegation for any .open-contact-modal element
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.open-contact-modal');
            if (btn) {
                e.preventDefault();
                openModal();
            }
        });

        // Close modal function
        var closeModal = function() {
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
            if (modalTriggerElement && modalTriggerElement.focus) {
                modalTriggerElement.focus();
            }
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
            var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({
                top: 0,
                behavior: prefersReducedMotion ? 'auto' : 'smooth'
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
                loadComponent('/components/header.html', '#header-placeholder', 'replace'),
                loadComponent('/components/footer.html', '#footer-placeholder', 'replace'),
                loadComponent('/components/contact-modal.html', 'body', 'append')
            ];

            // Only load CTA component if placeholder exists on the page
            var ctaPlaceholder = document.getElementById('cta-placeholder');
            if (ctaPlaceholder) {
                componentPromises.push(
                    loadComponent('/components/cta-section.html', '#cta-placeholder', 'replace')
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
                injectJsonLd();

                // Re-initialize JavaScript functionality
                reinitializeMainJS();
                reinitializeFormValidation();
                initModal();
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
