/**
 * Regression check for js/form-validation.js.
 *
 * Guards the two defects that let required <select> and required checkboxes pass silently:
 * forms carry `novalidate`, so anything this module misses is not validated at all.
 *
 * Run: node scripts/test-form-validation.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'js', 'form-validation.js');

// --- Minimal DOM ----------------------------------------------------------------
// Just enough surface for the module to load and for validateForm() to run. Not a browser.

function makeEl(tag, attrs = {}) {
    const el = {
        tagName: tag.toUpperCase(),
        type: attrs.type || (tag === 'select' ? 'select-one' : 'text'),
        name: attrs.name || '',
        value: attrs.value !== undefined ? attrs.value : '',
        checked: !!attrs.checked,
        _attrs: Object.assign({}, attrs),
        _classes: new Set(),
        children: [],
        parent: null,
        form: null,
        classList: {
            add: (c) => el._classes.add(c),
            remove: (c) => el._classes.delete(c),
            contains: (c) => el._classes.has(c),
        },
        hasAttribute: (a) => Object.prototype.hasOwnProperty.call(el._attrs, a),
        getAttribute: (a) => (Object.prototype.hasOwnProperty.call(el._attrs, a) ? el._attrs[a] : null),
        setAttribute: (a, v) => { el._attrs[a] = v; },
        addEventListener: () => {},
        focus: () => {},
        scrollIntoView: () => {},
        style: {},
        textContent: '',
        append(child) { child.parent = el; el.children.push(child); return child; },
        descendants() {
            return el.children.reduce((acc, c) => acc.concat([c], c.descendants()), []);
        },
        closest(sel) {
            let node = el;
            while (node) {
                if (sel === '.form-group' && node._classes.has('form-group')) return node;
                node = node.parent;
            }
            return null;
        },
        querySelector(sel) { return el.querySelectorAll(sel)[0]; },
        querySelectorAll(sel) {
            return el.descendants().filter((n) => matches(n, sel));
        },
    };
    if (attrs.class) attrs.class.split(/\s+/).forEach((c) => el._classes.add(c));
    return el;
}

function matches(node, sel) {
    // Supports only the selector shapes this module actually uses.
    if (sel === '.error') return node._classes.has('error');
    if (sel === '.form-error') return node._classes.has('form-error');
    if (sel === '.contact-form') return node._classes.has('contact-form');
    const attrName = sel.match(/^input\[name="(.+)"\]$/);
    if (attrName) return node.tagName === 'INPUT' && node.name === attrName[1].replace(/\\"/g, '"');
    return sel.split(',').some((part) => {
        const m = part.trim().match(/^(input|select|textarea)(\[required\])?$/);
        if (!m) return false;
        if (node.tagName !== m[1].toUpperCase()) return false;
        return m[2] ? node.hasAttribute('required') : true;
    });
}

function makeForm() {
    const form = makeEl('form', { class: 'contact-form' });
    form.querySelectorAll = (sel) => form.descendants().filter((n) => matches(n, sel));
    form.querySelector = (sel) => form.querySelectorAll(sel)[0];
    return form;
}

function addField(form, el) {
    const group = makeEl('div', { class: 'form-group' });
    const error = makeEl('span', { class: 'form-error' });
    group.append(el);
    group.append(error);
    form.append(group);
    el.form = form;
    return el;
}

// --- Load the module, capturing its internals ----------------------------------

const source = fs.readFileSync(SRC, 'utf8');
const sandbox = {
    window: {},
    document: { addEventListener: () => {}, documentElement: { lang: 'en' }, body: { classList: { contains: () => true } } },
    console,
};
// Re-export the internals the IIFE keeps private.
vm.runInNewContext(
    source.replace(/\}\)\(\);\s*$/, 'window.__validateForm = validateForm; })();'),
    sandbox
);
const validateForm = sandbox.window.__validateForm;
assert.strictEqual(typeof validateForm, 'function', 'validateForm was not exported for testing');

// --- Cases ---------------------------------------------------------------------

// 1. An empty required <select> must fail. Before the fix it was never even collected.
{
    const form = makeForm();
    addField(form, makeEl('select', { name: 'state', required: '', value: '' }));
    assert.strictEqual(validateForm(form), false, 'empty required <select> should fail');
}

// 2. A filled required <select> passes.
{
    const form = makeForm();
    addField(form, makeEl('select', { name: 'state', required: '', value: 'CA' }));
    assert.strictEqual(validateForm(form), true, 'filled required <select> should pass');
}

// 3. An unchecked required checkbox must fail. Before the fix its value was "on", so it passed.
{
    const form = makeForm();
    addField(form, makeEl('input', { type: 'checkbox', name: 'attest', required: '', value: 'on', checked: false }));
    assert.strictEqual(validateForm(form), false, 'unchecked required checkbox should fail');
}

// 4. A checked required checkbox passes.
{
    const form = makeForm();
    addField(form, makeEl('input', { type: 'checkbox', name: 'attest', required: '', value: 'on', checked: true }));
    assert.strictEqual(validateForm(form), true, 'checked required checkbox should pass');
}

// 5. Checkbox group, none checked: fails. Only the first box carries `required`.
{
    const form = makeForm();
    const group = makeEl('div', { class: 'form-group' });
    const a = makeEl('input', { type: 'checkbox', name: 'conditions[]', required: '', value: 'depression' });
    const b = makeEl('input', { type: 'checkbox', name: 'conditions[]', value: 'anxiety' });
    group.append(a); group.append(b); group.append(makeEl('span', { class: 'form-error' }));
    form.append(group);
    a.form = form; b.form = form;
    assert.strictEqual(validateForm(form), false, 'checkbox group with nothing checked should fail');

    // 6. Checking a NON-required box in the group satisfies it.
    b.checked = true;
    assert.strictEqual(validateForm(form), true, 'checkbox group satisfied by any checked box');
}

// 7. Existing text/email/phone behaviour is unchanged.
{
    const form = makeForm();
    addField(form, makeEl('input', { type: 'text', name: 'name', required: '', value: '' }));
    assert.strictEqual(validateForm(form), false, 'empty required text should still fail');

    const ok = makeForm();
    addField(ok, makeEl('input', { type: 'text', name: 'name', required: '', value: 'Jane Doe' }));
    addField(ok, makeEl('input', { type: 'email', name: 'email', required: '', value: 'jane@example.com' }));
    addField(ok, makeEl('input', { type: 'tel', name: 'phone', required: '', value: '(916) 555-0123' }));
    assert.strictEqual(validateForm(ok), true, 'valid text/email/phone should pass');

    const badEmail = makeForm();
    addField(badEmail, makeEl('input', { type: 'email', name: 'email', required: '', value: 'not-an-email' }));
    assert.strictEqual(validateForm(badEmail), false, 'malformed email should still fail');
}

console.log('form-validation: 7 checks passed');
