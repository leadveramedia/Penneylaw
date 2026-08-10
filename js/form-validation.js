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
     * Translate a key via window.I18N[<html lang>]; fall back to English.
     */
    function t(key, fallback) {
        var lang = document.documentElement.lang;
        if (lang && lang !== 'en' && window.I18N && window.I18N[lang] && window.I18N[lang][key]) {
            return window.I18N[lang][key];
        }
        return fallback;
    }

    /**
     * Initialize Contact Forms
     */
    function initContactForms() {
        const forms = document.querySelectorAll('.contact-form');

        forms.forEach(function (form) {
            // Real-time validation on blur
            const inputs = form.querySelectorAll('input, select, textarea');
            inputs.forEach(function (input) {
                input.addEventListener('blur', function () {
                    validateField(input);
                });

                // Clear error on input
                input.addEventListener('input', function () {
                    clearFieldError(input);
                });

                // `input` does not fire on <select> in every browser, and checkbox groups need
                // the whole group's error cleared when any box in it changes.
                input.addEventListener('change', function () {
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
                    return;
                }
                // Build subject line for Netlify email notification
                var fullName = (form.querySelector('[name="name"], [name="firm_name"]') || {}).value || '';
                var phone = (form.querySelector('[name="phone"]') || {}).value || '';
                var subjectField = form.querySelector('[name="subject"]');
                if (subjectField) {
                    subjectField.value = 'New Lead: ' + fullName.trim() + ' - ' + phone.trim();
                }
                // Form submits normally to Netlify
            });
        });
    }

    /**
     * Validate entire form
     */
    function validateForm(form) {
        let isValid = true;
        // `select[required]` must be listed explicitly. Forms carry `novalidate` (custom error
        // UI), so anything missing from this selector is not validated at all — native
        // validation will not catch it either.
        const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');

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

        // Checkboxes and radios must be tested on `checked`, never on `value` — an unchecked box
        // still reports value "on", so the generic empty-check below passes it unconditionally.
        // Satisfied when ANY control sharing this name is checked, which covers both a lone
        // attestation box and a "select at least one" group with one rule.
        if (type === 'checkbox' || type === 'radio') {
            if (input.hasAttribute('required') && !isGroupChecked(input)) {
                showFieldError(input, input.getAttribute('data-required-message') || getRequiredMessage(name));
                return false;
            }
            clearFieldError(input);
            return true;
        }

        // Check if empty
        if (input.hasAttribute('required') && !value) {
            isValid = false;
            errorMessage = input.getAttribute('data-required-message') || getRequiredMessage(name);
        }
        // Validate email
        else if (type === 'email' && value && !isValidEmail(value)) {
            isValid = false;
            errorMessage = t('validation.email', 'Please enter a valid email address');
        }
        // Validate phone
        else if (type === 'tel' && value && !isValidPhone(value)) {
            isValid = false;
            errorMessage = t('validation.phone', 'Please enter a valid phone number');
        }
        // Validate minimum length for message
        else if (name === 'message' && value && value.length < 10) {
            isValid = false;
            errorMessage = t('validation.messageMin', 'Please provide more details about your case');
        }

        if (!isValid) {
            showFieldError(input, errorMessage);
        } else {
            clearFieldError(input);
        }

        return isValid;
    }

    /**
     * True when any checkbox/radio sharing this control's name is checked.
     * Scoped to the owning form so two forms on one page can't satisfy each other.
     */
    function isGroupChecked(input) {
        const scope = input.form || document;
        const group = input.name
            ? scope.querySelectorAll('input[name="' + input.name.replace(/"/g, '\\"') + '"]')
            : [input];
        for (let i = 0; i < group.length; i++) {
            if (group[i].checked) return true;
        }
        return false;
    }

    /**
     * Get required field message
     */
    function getRequiredMessage(fieldName) {
        const messages = {
            'name': 'Please enter your full name',
            'firm_name': 'Please enter your firm name',
            'email': 'Please enter your email address',
            'phone': 'Please enter your phone number',
            'message': 'Please tell us how we can help'
        };

        var fallback = messages[fieldName] || 'This field is required';
        var key = messages[fieldName]
            ? 'validation.required.' + fieldName
            : 'validation.required.default';
        return t(key, fallback);
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

        // In a checkbox group only the box carrying `required` gets marked, so checking a
        // different box must clear that one too or it keeps a red border with no error text.
        if (input.type === 'checkbox' || input.type === 'radio') {
            formGroup.querySelectorAll('.error').forEach(function (el) {
                el.classList.remove('error');
                el.setAttribute('aria-invalid', 'false');
            });
        }

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
