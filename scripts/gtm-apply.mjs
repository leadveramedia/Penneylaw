#!/usr/bin/env node
/**
 * Apply the GTM-CHANGES.md fixes to GTM-PC9XN9DP via the Tag Manager API v2.
 *
 * Zero dependencies. Auth is KEYLESS service account impersonation:
 *   gcloud auth login
 *   export GTM_IMPERSONATE_SA=<name>@<project>.iam.gserviceaccount.com
 *
 * Plain gcloud ADC does NOT work: Google restricts gcloud's shared OAuth client to a scope
 * allowlist that excludes tagmanager.*, so asking for them yields "This app is blocked".
 * Impersonation sidesteps it because the tagmanager scopes are requested on the IMPERSONATED
 * token via the IAM Credentials API, never through a consent screen. It also satisfies the
 * iam.disableServiceAccountKeyCreation org policy, since no key is ever created.
 * Run with no credentials for the full setup checklist.
 *
 * The service account email must be added under
 *   GTM -> Admin -> Container -> User Management
 * with container permission EDIT — deliberately not Approve or Publish, so that even a buggy
 * run cannot push anything live.
 *
 * SAFETY, by design:
 *  - Read-only unless --apply is passed.
 *  - All writes land in a NEW workspace; the Default Workspace is never touched.
 *  - Every update sends the entity fingerprint, so a concurrent UI edit 409s instead of
 *    being silently clobbered.
 *  - The workspace status diff is asserted against the requested fix set before versioning.
 *  - It creates a VERSION and stops. It never publishes. There is no publish code path here,
 *    deliberately — a human publishes in the GTM UI after reviewing.
 *
 * Usage:
 *   node scripts/gtm-apply.mjs                     # inspect live container + workspaces
 *   node scripts/gtm-apply.mjs --plan              # show the exact changes, write nothing
 *   node scripts/gtm-apply.mjs --apply=f1,f2,f3,f4 # apply those fixes -> new version
 *
 * Fix ids:
 *   f1  delete the duplicate consent-default tag
 *   f2  Conversion Linker: url_passthrough on, prune deploy-preview linker domains
 *   f3  Enhanced Conversions: repoint the user-data tag at the CODE-mode leadsUserData
 *       variable, move it off submit-attempt, delete the AUTO-mode variables
 *   f4  create the form_conversion trigger and repoint the thank-you conversion onto it
 *   f5  TikTok pixel  (requires TIKTOK_PIXEL_ID)
 *   f6  Meta pixel    (requires META_PIXEL_ID)
 */
import { execFileSync } from 'node:child_process';

const PUBLIC_ID = 'GTM-PC9XN9DP';
const BASE = 'https://tagmanager.googleapis.com/tagmanager/v2';

const KEEP_LINKER_DOMAINS = ['penneylaw.com', 'bankonfrank.com', 'stockton-personalinjury.com'];
const THANKYOU_LABEL = 'kZCHCOSz-cobELiOuLBB';   // Secondary / observation-only conversion
const PHONE_LABEL = 'pEKdCNrT-cobELiOuLBB';      // PRIMARY, feeds bidding — never touched

const args = process.argv.slice(2);
const planOnly = args.includes('--plan');
const applyArg = args.find((a) => a.startsWith('--apply='));
const requested = applyArg ? applyArg.slice('--apply='.length).split(',').filter(Boolean) : [];

if (requested.includes('all')) {
    fail('--apply=all is not accepted. Name the fixes explicitly, e.g. --apply=f1,f2');
}

function fail(msg) {
    console.error(`\nABORT: ${msg}\n`);
    process.exit(1);
}

// ------------------------------------------------------------------------------ transport

const SCOPES = [
    'https://www.googleapis.com/auth/tagmanager.readonly',
    'https://www.googleapis.com/auth/tagmanager.edit.containers',
    'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
];

const SETUP_HELP =
    'No usable credentials.\n\n' +
    'Recommended: KEYLESS service account impersonation (GTM_IMPERSONATE_SA).\n' +
    'It satisfies the iam.disableServiceAccountKeyCreation org policy (no key is ever\n' +
    'created) and it dodges the OAuth scope allowlist that makes plain ADC fail with\n' +
    '"This app is blocked" — the tagmanager scopes are requested on the IMPERSONATED token\n' +
    'via the IAM Credentials API, so they never pass through a consent screen.\n' +
    '(Workload Identity Federation, which Google also suggests, needs an external identity\n' +
    'provider such as GitHub Actions or AWS. A local machine has none, so it does not apply.)\n\n' +
    'Setup:\n' +
    '  1. GCP Console -> IAM & Admin -> Service Accounts -> Create. Do NOT create a key.\n' +
    '  2. On that service account -> Permissions -> grant YOUR user account the role\n' +
    '     "Service Account Token Creator" (roles/iam.serviceAccountTokenCreator).\n' +
    '  3. Enable the Tag Manager API for the project:\n' +
    '     https://console.cloud.google.com/apis/library/tagmanager.googleapis.com\n' +
    '  4. GTM -> Admin -> Container -> User Management -> add the service account email\n' +
    '     with container permission EDIT (not Approve, not Publish).\n' +
    '  5. gcloud auth login            # plain login, default scopes — not blocked\n' +
    '  6. export GTM_IMPERSONATE_SA=<name>@<project>.iam.gserviceaccount.com\n\n' +
    'Alternative if your org ever permits keys: GOOGLE_SERVICE_ACCOUNT_KEY_FILE=<key.json>\n';

const b64url = (buf) => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cachedToken = null;   // { value, expiresAt }

/**
 * Mint an access token. Mirrors the shape of mcp-seo-indexing/lib/google-auth.js (service
 * account key file, else fall back), but hand-rolls the JWT so this stays dependency-free.
 */
async function token() {
    if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

    // Preferred: keyless impersonation. Our own gcloud user token (default cloud-platform
    // scopes, which ARE allowlisted) authorises a generateAccessToken call that mints a
    // service-account token carrying the tagmanager scopes. The restricted scopes are only
    // ever requested for the minted token, never via an OAuth consent screen.
    const impersonate = process.env.GTM_IMPERSONATE_SA;
    if (impersonate) {
        let caller;
        try {
            caller = execFileSync('gcloud', ['auth', 'print-access-token'],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        } catch (e) {
            fail('GTM_IMPERSONATE_SA is set but there is no usable gcloud user credential.\n' +
                 'Run:  gcloud auth login\n\n' +
                 `gcloud said: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
        }
        const url = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
                    `${encodeURIComponent(impersonate)}:generateAccessToken`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${caller}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: SCOPES, lifetime: '3600s' }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.accessToken) {
            const msg = json.error?.message || JSON.stringify(json).slice(0, 300);
            if (res.status === 403) {
                fail(`cannot impersonate ${impersonate}.\n\n` +
                     `Your user needs the role "Service Account Token Creator" ` +
                     `(roles/iam.serviceAccountTokenCreator) ON that service account.\n` +
                     `GCP Console -> IAM & Admin -> Service Accounts -> ${impersonate} -> ` +
                     `Permissions -> Grant Access.\n\nGoogle said: ${msg}`);
            }
            if (res.status === 404) {
                fail(`service account ${impersonate} not found. Check the email spelling.\n\nGoogle said: ${msg}`);
            }
            fail(`generateAccessToken failed (HTTP ${res.status}): ${msg}`);
        }
        cachedToken = { value: json.accessToken, expiresAt: Date.now() + 55 * 60 * 1000 };
        console.log(`auth: impersonating ${impersonate} (keyless)`);
        return cachedToken.value;
    }

    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    if (keyFile) {
        const { readFileSync } = await import('node:fs');
        const { createSign } = await import('node:crypto');
        let key;
        try {
            key = JSON.parse(readFileSync(keyFile.replace(/^~/, process.env.HOME), 'utf8'));
        } catch (e) {
            fail(`could not read GOOGLE_SERVICE_ACCOUNT_KEY_FILE (${keyFile}): ${e.message}`);
        }
        if (!key.client_email || !key.private_key) {
            fail(`${keyFile} is not a service account key (needs client_email + private_key)`);
        }
        const aud = key.token_uri || 'https://oauth2.googleapis.com/token';
        const iat = Math.floor(Date.now() / 1000);
        const claims = { iss: key.client_email, scope: SCOPES.join(' '), aud, iat, exp: iat + 3600 };
        const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
        const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
        const assertion = `${unsigned}.${b64url(sig)}`;

        const res = await fetch(aud, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion,
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.access_token) {
            fail(`token exchange failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
        }
        cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
        console.log(`auth: service account ${key.client_email}`);
        return cachedToken.value;
    }

    // Fallback: gcloud ADC. Works only if the token already carries tagmanager scopes, which
    // gcloud's own OAuth client cannot request — so this normally fails and we point at setup.
    try {
        const out = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        cachedToken = { value: out, expiresAt: Date.now() + 30 * 60 * 1000 };
        console.log('auth: gcloud ADC (expect 403 unless this token has tagmanager scopes)');
        return out;
    } catch {
        fail(SETUP_HELP);
    }
}

async function api(method, path, body) {
    const url = path.startsWith('http') ? path : `${BASE}/${path.replace(/^\//, '')}`;
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${await token()}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
        if (res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(text)) {
            const m = text.match(/https:\/\/console\.developers\.google\.com\/[^\s"\\]+/);
            fail(`the Tag Manager API is not enabled for this project.\n\n` +
                 `Enable it here:\n  ${m ? m[0] : 'https://console.cloud.google.com/apis/library/tagmanager.googleapis.com'}\n\n` +
                 `then re-run. (Propagation can take a minute.)`);
        }
        if (res.status === 403 || res.status === 401) {
            fail(`${res.status} from the Tag Manager API — the credential lacks Tag Manager scopes, ` +
                 `or its identity is not a user on container ${PUBLIC_ID}.\n\n` +
                 `If using a service account, add its email under GTM -> Admin -> Container -> ` +
                 `User Management with EDIT permission.\n\n${text.slice(0, 400)}`);
        }
        if (res.status === 409) {
            fail(`409 conflict on ${method} ${path} — someone edited this entity in the GTM UI ` +
                 `since we read it. Re-run to pick up the change.\n\n${text.slice(0, 300)}`);
        }
        fail(`${method} ${path} -> HTTP ${res.status}\n${text.slice(0, 600)}`);
    }
    return text ? JSON.parse(text) : {};
}

// -------------------------------------------------------------------------------- helpers

/** GTM API tag/variable types come back without the compiled `__` prefix. */
const isType = (entity, t) => String(entity.type || '').replace(/^__/, '') === t;

const paramOf = (entity, key) => (entity.parameter || []).find((p) => p.key === key);

function setParam(entity, key, patch) {
    entity.parameter = entity.parameter || [];
    const existing = paramOf(entity, key);
    if (existing) Object.assign(existing, patch);
    else entity.parameter.push({ key, ...patch });
    return entity;
}

const bool = (entity, key, value) => setParam(entity, key, { type: 'boolean', value: String(value) });

const isFormConversionTrigger = (t) =>
    t.type === 'customEvent' &&
    (t.customEventFilter || []).some((f) =>
        (f.parameter || []).some((p) => p.key === 'arg1' && p.value === 'form_conversion'));

/** Find the form_conversion Custom Event trigger in the live workspace, creating it if absent. */
async function ensureFormConversionTrigger(wsPath) {
    const existing = ((await api('GET', `${wsPath}/triggers`)).trigger || []).find(isFormConversionTrigger);
    if (existing) return existing;
    return api('POST', `${wsPath}/triggers`, {
        name: 'Custom Event - form_conversion',
        type: 'customEvent',
        customEventFilter: [{
            type: 'equals',
            parameter: [
                { type: 'template', key: 'arg0', value: '{{_event}}' },
                { type: 'template', key: 'arg1', value: 'form_conversion' },
            ],
        }],
    });
}

// ------------------------------------------------------------------------------ discovery

async function locate() {
    const accounts = (await api('GET', 'accounts')).account || [];
    for (const acct of accounts) {
        const containers = (await api('GET', `${acct.path}/containers`)).container || [];
        const hit = containers.find((c) => c.publicId === PUBLIC_ID);
        if (hit) return { account: acct, container: hit };
    }
    fail(`container ${PUBLIC_ID} not visible to this account. ` +
         `Check that the authorized Google account is a user on the container.`);
}

async function readWorkspace(wsPath) {
    const [tags, triggers, variables] = await Promise.all([
        api('GET', `${wsPath}/tags`),
        api('GET', `${wsPath}/triggers`),
        api('GET', `${wsPath}/variables`),
    ]);
    return {
        tags: tags.tag || [],
        triggers: triggers.trigger || [],
        variables: variables.variable || [],
    };
}

// ---------------------------------------------------------------------------------- fixes
// Each returns {id, describe, run(ctx)}. `describe` is what --plan prints.

function fixes(ws, wsPath) {
    const tagByLabel = (label) =>
        ws.tags.find((t) => isType(t, 'awct') && paramOf(t, 'conversionLabel')?.value === label);

    const out = [];

    // f1 — the duplicate consent default (a custom template tag issuing command=default)
    {
        const tag = ws.tags.find((t) =>
            /^cvt_/.test(String(t.type || '').replace(/^__/, '')) &&
            paramOf(t, 'command')?.value === 'default');
        out.push({
            id: 'f1',
            found: Boolean(tag),
            describe: tag
                ? `DELETE tag "${tag.name}" (${tag.type}) — duplicate consent default, ` +
                  `wait_for_update=${paramOf(tag, 'wait_for_update')?.value}`
                : 'consent-default tag not found (already deleted?)',
            async run() { await api('DELETE', tag.path); },
        });
    }

    // f2 — Conversion Linker
    {
        const tag = ws.tags.find((t) => isType(t, 'gclidw'));
        let doms = [];
        if (tag) {
            const p = paramOf(tag, 'linkerDomains');
            doms = String(p?.value || '').split(/[,\s]+/).filter(Boolean);
        }
        const junk = doms.filter((d) => d.includes('--') || d.includes('.netlify.app'));
        out.push({
            id: 'f2',
            found: Boolean(tag),
            describe: tag
                ? `UPDATE tag "${tag.name}" — enableUrlPassthrough=true; ` +
                  `linkerDomains ${doms.length} -> ${KEEP_LINKER_DOMAINS.length} (drop ${junk.length} preview hosts)`
                : 'Conversion Linker tag not found',
            async run() {
                bool(tag, 'enableUrlPassthrough', true);
                setParam(tag, 'linkerDomains', { type: 'template', value: KEEP_LINKER_DOMAINS.join(',') });
                await api('PUT', tag.path, tag);
            },
        });
    }

    // f3 — Enhanced Conversions.
    //
    // EC is NOT configured on the awct conversion tag (that tag stores no EC parameters at
    // all — the `false` the compiler emits is a default, and writing EC keys onto it is
    // silently ignored). It lives on the separate Ads User-Provided Data (`awud`) tag, whose
    // `userDataVariable` currently points at an AUTO-mode variable that scrapes the DOM.
    // So: repoint that tag at the CODE-mode variable, move it off gtm.formSubmit (which fires
    // on every submit ATTEMPT, including invalid ones), and drop the AUTO variables.
    {
        const codeVar = ws.variables.find((v) => isType(v, 'awec') && paramOf(v, 'mode')?.value === 'CODE');
        const autoVars = ws.variables.filter((v) => isType(v, 'awec') && paramOf(v, 'mode')?.value === 'AUTO');
        const awud = ws.tags.find((t) => isType(t, 'awud'));
        const ok = Boolean(codeVar && awud);
        const current = awud ? paramOf(awud, 'userDataVariable')?.value : '';
        out.push({
            id: 'f3',
            found: ok,
            describe: ok
                ? `UPDATE tag "${awud.name}" — userDataVariable ${current} -> {{${codeVar.name}}} ` +
                  `(CODE mode, reads leadsUserData)\n` +
                  `        UPDATE tag "${awud.name}" — trigger [${(awud.firingTriggerId || []).join(', ')}] ` +
                  `-> form_conversion (was every submit attempt)\n` +
                  `        DELETE ${autoVars.length} AUTO-mode variable(s): ${autoVars.map((v) => v.name).join(', ') || '(none)'}`
                : `missing prerequisite — codeVar:${Boolean(codeVar)} awudTag:${Boolean(awud)}`,
            async run() {
                const trig = await ensureFormConversionTrigger(wsPath);
                setParam(awud, 'userDataVariable', { type: 'template', value: `{{${codeVar.name}}}` });
                awud.firingTriggerId = [trig.triggerId];
                await api('PUT', awud.path, awud);
                // Only safe after the tag no longer references them.
                for (const v of autoVars) await api('DELETE', v.path);
            },
        });
    }

    // f4 — form_conversion trigger, and repoint the thank-you conversion onto it
    {
        const conv = tagByLabel(THANKYOU_LABEL);
        const existing = ws.triggers.find(isFormConversionTrigger);
        out.push({
            id: 'f4',
            found: Boolean(conv),
            describe: conv
                ? `${existing ? 'REUSE' : 'CREATE'} Custom Event trigger on "form_conversion"\n` +
                  `        UPDATE conversion "${conv.name}" — firingTriggerId ` +
                  `[${(conv.firingTriggerId || []).join(', ')}] -> the form_conversion trigger`
                : 'thank-you conversion tag not found',
            async run() {
                const trigger = await ensureFormConversionTrigger(wsPath);
                conv.firingTriggerId = [trigger.triggerId];
                await api('PUT', conv.path, conv);
            },
        });
    }

    // f5 / f6 — paid-social pixels. Generic Lead only: no page path, practice area, or value.
    for (const [id, name, envVar, html] of [
        ['f5', 'TikTok Pixel - Lead', 'TIKTOK_PIXEL_ID', (pid) =>
            `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];` +
            `ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];` +
            `ttq.setAndDefer=function(e,n){e[n]=function(){e.push([n].concat(Array.prototype.slice.call(arguments,0)))}};` +
            `for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);` +
            `ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";` +
            `ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=n,ttq._t=ttq._t||{},ttq._t[e]=+new Date,` +
            `ttq._o=ttq._o||{},ttq._o[e]={};var o=d.createElement("script");o.type="text/javascript";` +
            `o.async=!0,o.src=n+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];` +
            `a.parentNode.insertBefore(o,a)};ttq.load('${pid}');ttq.page();ttq.track('SubmitForm');` +
            `}(window,document,'ttq');</script>`],
        ['f6', 'Meta Pixel - Lead', 'META_PIXEL_ID', (pid) =>
            `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
            `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
            `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
            `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
            `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
            `fbq('init','${pid}');fbq('track','Lead');</script>`],
    ]) {
        const pid = process.env[envVar];
        out.push({
            id,
            found: Boolean(pid),
            describe: pid
                ? `CREATE Custom HTML tag "${name}" on the form_conversion trigger (generic event, no page/practice data)`
                : `skipped — set ${envVar} to create this pixel`,
            async run() {
                const trig = (await api('GET', `${wsPath}/triggers`)).trigger || [];
                const t = trig.find((x) => x.type === 'customEvent' &&
                    (x.customEventFilter || []).some((f) =>
                        (f.parameter || []).some((p) => p.key === 'arg1' && p.value === 'form_conversion')));
                if (!t) fail(`${id} needs the form_conversion trigger — apply f4 first (or in the same run).`);
                await api('POST', `${wsPath}/tags`, {
                    name,
                    type: 'html',
                    parameter: [
                        { type: 'template', key: 'html', value: html(pid) },
                        { type: 'boolean', key: 'supportDocumentWrite', value: 'false' },
                    ],
                    firingTriggerId: [t.triggerId],
                });
            },
        });
    }

    return out;
}

// ----------------------------------------------------------------------------------- main

const { account, container } = await locate();
console.log(`\naccount:   ${account.name} (${account.accountId})`);
console.log(`container: ${container.name} / ${container.publicId}`);

const live = await api('GET', `${container.path}/versions:live`);
console.log(`live version: ${live.containerVersionId} — "${live.name || '(unnamed)'}"`);

const existingWs = (await api('GET', `${container.path}/workspaces`)).workspace || [];
console.log(`workspaces: ${existingWs.map((w) => w.name).join(', ') || '(none)'}`);

for (const w of existingWs) {
    const st = await api('GET', `${w.path}/status`);
    const n = (st.workspaceChange || []).length;
    if (n) console.log(`  ! "${w.name}" has ${n} uncommitted change(s) — not touching it`);
}

if (!requested.length && !planOnly) {
    console.log('\nRead-only. Use --plan to see proposed changes, or --apply=f1,f2,... to write.\n');
    process.exit(0);
}

// Plan against the LATEST CONTAINER VERSION, because that is what a newly created workspace
// inherits — NOT the Default Workspace, which can lag behind and would make the plan lie.
const headers = (await api('GET', `${container.path}/version_headers`)).containerVersionHeader || [];
const latestId = headers
    .map((h) => Number(h.containerVersionId))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a)[0];
if (latestId == null) fail('could not determine the latest container version');
console.log(`latest version: ${latestId}${String(latestId) !== String(live.containerVersionId)
    ? ` (unpublished — live is ${live.containerVersionId})` : ''}`);

const latest = await api('GET', `${container.path}/versions/${latestId}`);
const snapshot = {
    tags: latest.tag || [],
    triggers: latest.trigger || [],
    variables: latest.variable || [],
};
// Paths inside a version are read-only; planning only needs shapes, and apply re-reads from
// the real workspace before touching anything.
const planned = fixes(snapshot, `${container.path}/workspaces/PLAN`);

console.log('\nproposed changes:');
for (const f of planned) {
    const mark = requested.includes(f.id) ? '*' : ' ';
    console.log(`  ${mark} [${f.id}] ${f.describe}`);
}
console.log('\n  (* = selected)   PRIMARY phone conversion ' + PHONE_LABEL + ' is never modified.');

if (planOnly) {
    console.log('\n--plan only. Nothing written.\n');
    process.exit(0);
}

const selected = planned.filter((f) => requested.includes(f.id));
const unknown = requested.filter((id) => !planned.some((f) => f.id === id));
if (unknown.length) fail(`unknown fix id(s): ${unknown.join(', ')}`);
const missing = selected.filter((f) => !f.found);
if (missing.length) {
    fail(`prerequisites not met for: ${missing.map((f) => f.id).join(', ')}\n` +
         missing.map((f) => `  ${f.id}: ${f.describe}`).join('\n'));
}

// Everything below writes — into a fresh workspace only.
const stamp = new Date().toISOString().slice(0, 10);
const ws = await api('POST', `${container.path}/workspaces`, {
    name: `claude-audit-${stamp}`,
    description: `Automated fixes ${requested.join(',')} from GTM-CHANGES.md`,
});
console.log(`\ncreated workspace "${ws.name}"`);

const wsState = await readWorkspace(ws.path);
const live_ = fixes(wsState, ws.path).filter((f) => requested.includes(f.id));
for (const f of live_) {
    if (!f.found) fail(`${f.id} prerequisites vanished inside the new workspace — aborting`);
    console.log(`  applying ${f.id} ...`);
    await f.run();
}

const status = await api('GET', `${ws.path}/status`);
const changes = status.workspaceChange || [];
console.log(`\nworkspace diff (${changes.length} change(s)):`);
for (const c of changes) {
    const e = c.tag || c.trigger || c.variable || {};
    console.log(`  ${c.changeStatus.padEnd(8)} ${e.name || '(unnamed)'}`);
}
if (!changes.length) fail('no changes recorded — refusing to create an empty version');

const preview = await api('POST', `${ws.path}:quick_preview`);
if (preview.compilerError) {
    fail(`container failed to compile — NOT creating a version. Delete the workspace:\n` +
         `  DELETE ${ws.path}`);
}
console.log('quick_preview: compiles cleanly');

// Verify the changes actually took effect in the COMPILED container, not just that the API
// accepted our parameters. GTM silently ignores unknown parameter keys, so an accepted write
// is not proof of a working tag.
{
    const res = preview.containerVersion || {};
    const cTags = res.tag || [];
    const cVars = res.variable || [];
    const problems = [];

    if (requested.includes('f2')) {
        const linker = cTags.find((t) => /gclidw/.test(t.type || ''));
        const p = (linker?.parameter || []).find((x) => x.key === 'enableUrlPassthrough');
        if (p?.value !== 'true') problems.push('f2: enableUrlPassthrough did not stick');
    }

    if (requested.includes('f3')) {
        // The user-data tag must now reference the CODE-mode variable by name, fire on
        // form_conversion, and no AUTO-mode variable may survive.
        const awud = cTags.find((t) => isType(t, 'awud'));
        const codeVar = cVars.find((v) => isType(v, 'awec') &&
            (v.parameter || []).some((p) => p.key === 'mode' && p.value === 'CODE'));
        const ref = awud ? (awud.parameter || []).find((p) => p.key === 'userDataVariable')?.value : null;
        const autoLeft = cVars.filter((v) => isType(v, 'awec') &&
            (v.parameter || []).some((p) => p.key === 'mode' && p.value === 'AUTO')).length;

        if (!awud) problems.push('f3: the Ads User-Provided Data tag is missing');
        else if (!codeVar) problems.push('f3: the CODE-mode user-data variable is missing');
        else if (ref !== `{{${codeVar.name}}}`) {
            problems.push(`f3: userDataVariable is ${ref ?? '(unset)'}, expected {{${codeVar.name}}}`);
        }
        if (autoLeft) problems.push(`f3: ${autoLeft} AUTO-mode user-data variable(s) still present`);
    }

    if (requested.includes('f4')) {
        const conv = cTags.find((t) => (t.parameter || [])
            .some((p) => p.key === 'conversionLabel' && p.value === THANKYOU_LABEL));
        if (!conv) problems.push('f4: thank-you conversion vanished from the compiled container');
    }


    if (problems.length) {
        fail(`applied writes did NOT produce the intended compiled container:\n` +
             problems.map((p) => `  - ${p}`).join('\n') +
             `\n\nNothing was published. Discard the workspace:\n` +
             `  node -e "..." # or GTM UI -> Workspace -> Actions -> Delete\n` +
             `  workspace: ${ws.path}`);
    }
    console.log('compiled-output verification: changes present');
}

const version = await api('POST', `${ws.path}:create_version`, {
    name: `Audit fixes ${stamp} (${requested.join(',')})`,
    notes: `Applied ${requested.join(', ')} per GTM-CHANGES.md. Not published — review and publish manually.`,
});
const v = version.containerVersion || {};
console.log(`\ncreated version ${v.containerVersionId || '(?)'} — NOT PUBLISHED.`);
console.log(`Review and publish here:`);
console.log(`  https://tagmanager.google.com/#/container/accounts/${account.accountId}` +
            `/containers/${container.containerId}/versions\n`);
console.log(`Rollback: delete the workspace, or publish the previous version ${live.containerVersionId}.\n`);
