/**
 * Frank Penney Injury Law - Form Validation
 * Static Site Version for Netlify Forms
 */

(function () {
    'use strict';

    /**
     * DOM Ready - conditional initialization
     * Skip if components are being loaded (component-loader.js will handle it)
     */
    document.addEventListener('DOMContentLoaded', function () {
        if (!document.body.classList.contains('components-loading')) {
            initContactForms();
        }
    });

    // Expose function globally for component-loader.js
    window.initContactForms = initContactForms;

    /**
     * Initialize Contact Forms
     */
    function initContactForms() {
        const forms = document.querySelectorAll('.contact-form');

        forms.forEach(function (form) {
            // Real-time validation on blur
            const inputs = form.querySelectorAll('input, textarea');
            inputs.forEach(function (input) {
                input.addEventListener('blur', function () {
                    validateField(input);
                });

                // Clear error on input
                input.addEventListener('input', function () {
                    clearFieldError(input);
                });

                // Format phone number on input
                if (input.type === 'tel') {
                    input.addEventListener('input', function () {
                        formatPhoneNumber(input);
                    });
                }
            });

            // Form submission - let Netlify handle it, but validate first
            form.addEventListener('submit', function (e) {
                if (!validateForm(form)) {
                    e.preventDefault();
                    var firstInvalid = form.querySelector('.error');
                    if (firstInvalid) {
                        firstInvalid.focus();
                        firstInvalid.scrollIntoView({ block: 'center' });
                    }
                }
                // If valid, form submits normally to Netlify
            });
        });
    }

    /**
     * Validate entire form
     */
    function validateForm(form) {
        let isValid = true;
        const inputs = form.querySelectorAll('input[required], textarea[required]');

        inputs.forEach(function (input) {
            if (!validateField(input)) {
                isValid = false;
            }
        });

        return isValid;
    }

    /**
     * Validate individual field
     */
    function validateField(input) {
        const value = input.value.trim();
        const type = input.type;
        const name = input.name;
        let isValid = true;
        let errorMessage = '';

        // Check if empty
        if (input.hasAttribute('required') && !value) {
            isValid = false;
            errorMessage = getRequiredMessage(name);
        }
        // Validate email
        else if (type === 'email' && value && !isValidEmail(value)) {
            isValid = false;
            errorMessage = 'Please enter a valid email address';
        }
        // Validate phone
        else if (type === 'tel' && value && !isValidPhone(value)) {
            isValid = false;
            errorMessage = 'Please enter a valid phone number';
        }
        // Validate minimum length for message
        else if (name === 'message' && value && value.length < 10) {
            isValid = false;
            errorMessage = 'Please provide more details about your case';
        }

        if (!isValid) {
            showFieldError(input, errorMessage);
        } else {
            clearFieldError(input);
        }

        return isValid;
    }

    /**
     * Get required field message
     */
    function getRequiredMessage(fieldName) {
        const messages = {
            'first_name': 'Please enter your first name',
            'last_name': 'Please enter your last name',
            'email': 'Please enter your email address',
            'phone': 'Please enter your phone number',
            'message': 'Please tell us how we can help'
        };

        return messages[fieldName] || 'This field is required';
    }

    /**
     * Show field error
     */
    function showFieldError(input, message) {
        const formGroup = input.closest('.form-group');
        if (!formGroup) return;

        formGroup.classList.add('has-error');
        input.classList.add('error');
        input.setAttribute('aria-invalid', 'true');

        const errorEl = formGroup.querySelector('.form-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    /**
     * Clear field error
     */
    function clearFieldError(input) {
        const formGroup = input.closest('.form-group');
        if (!formGroup) return;

        formGroup.classList.remove('has-error');
        input.classList.remove('error');
        input.setAttribute('aria-invalid', 'false');

        const errorEl = formGroup.querySelector('.form-error');
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    }

    /**
     * Validate email format
     */
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Validate phone format
     */
    function isValidPhone(phone) {
        // Remove all non-digits
        const digits = phone.replace(/\D/g, '');
        // Valid if 10 or 11 digits (with country code)
        return digits.length >= 10 && digits.length <= 11;
    }

    /**
     * Format phone number as user types
     */
    function formatPhoneNumber(input) {
        let value = input.value.replace(/\D/g, '');

        // Limit to 10 digits
        if (value.length > 10) {
            value = value.substring(0, 10);
        }

        // Format as (XXX) XXX-XXXX
        if (value.length > 0) {
            if (value.length <= 3) {
                value = '(' + value;
            } else if (value.length <= 6) {
                value = '(' + value.substring(0, 3) + ') ' + value.substring(3);
            } else {
                value = '(' + value.substring(0, 3) + ') ' + value.substring(3, 6) + '-' + value.substring(6);
            }
        }

        input.value = value;
    }

})();
