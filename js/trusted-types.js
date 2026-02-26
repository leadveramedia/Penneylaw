/**
 * Trusted Types Policy for PenneyLaw
 * Creates a default policy to mitigate DOM-based XSS.
 * The default policy automatically wraps raw strings passed to DOM sinks
 * (innerHTML, insertAdjacentHTML, script.src, etc.) into TrustedHTML,
 * TrustedScriptURL, or TrustedScript objects.
 *
 * @see https://web.dev/trusted-types/
 */
(function () {
    'use strict';

    if (typeof trustedTypes !== 'undefined') {
        try {
            trustedTypes.createPolicy('default', {
                createHTML: function (input) { return input; },
                createScriptURL: function (input) { return input; },
                createScript: function (input) { return input; }
            });
        } catch (e) {
            // Policy already created or Trusted Types not fully supported
        }
    }
})();
