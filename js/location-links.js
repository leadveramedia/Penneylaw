/**
 * Location Links - Links a city hub's "Cases We Handle" cards to that city's
 * published practice subpages, AND appends a link for any published practice
 * page that doesn't already have a matching card.
 *
 * Content for these subpages lives in Storyblok and is published on a rolling
 * basis, so we fetch the live list of published stories: links only ever point
 * at pages that actually exist, and newly published pages are picked up
 * automatically with no edits to the hub HTML.
 */
(function () {
    'use strict';

    var STORYBLOK_TOKEN = 'yDLol9DLwFeUUgsyYx3rcQtt';
    var STORYBLOK_API = 'https://api.storyblok.com/v2/cdn/stories';

    // A card's visible heading -> the practice subpage slug it should link to.
    var SERVICE_SLUGS = {
        'Car Accidents': 'car-accident-lawyer',
        'Truck Accidents': 'truck-accident-lawyer',
        'Motorcycle Accidents': 'motorcycle-accident-lawyer',
        'Pedestrian Accidents': 'pedestrian-accident-lawyer',
        'Bicycle Accidents': 'bicycle-accident-lawyer',
        'Pedestrian and Bicycle Accidents': 'pedestrian-accident-lawyer',
        'Slip and Fall': 'slip-and-fall-lawyer',
        'Slip and Fall / Premises Liability': 'slip-and-fall-lawyer',
        'Dog Bites': 'dog-bite-lawyer',
        'Dog Bite': 'dog-bite-lawyer',
        'Wrongful Death': 'wrongful-death-lawyer',
        'Uber and Lyft Accidents': 'uber-and-lyft-accident-lawyer'
    };

    // Slug -> {label, blurb} used to build a card when a published practice page
    // has no matching card on the hub. Unknown slugs fall back to a label
    // derived from the slug, so even brand-new practice types still get linked.
    var SLUG_INFO = {
        'car-accident-lawyer': { label: 'Car Accidents', blurb: 'Representation for victims of car crashes and collisions.' },
        'truck-accident-lawyer': { label: 'Truck Accidents', blurb: 'Fighting for victims of commercial truck accidents.' },
        'motorcycle-accident-lawyer': { label: 'Motorcycle Accidents', blurb: 'Advocating for injured motorcyclists.' },
        'pedestrian-accident-lawyer': { label: 'Pedestrian Accidents', blurb: 'Help for pedestrians struck by a vehicle.' },
        'bicycle-accident-lawyer': { label: 'Bicycle Accidents', blurb: 'Representation for injured cyclists.' },
        'slip-and-fall-lawyer': { label: 'Slip and Fall', blurb: 'Holding property owners accountable.' },
        'dog-bite-lawyer': { label: 'Dog Bites', blurb: 'Seeking compensation for animal attack victims.' },
        'wrongful-death-lawyer': { label: 'Wrongful Death', blurb: 'Compassionate support for grieving families.' },
        'uber-and-lyft-accident-lawyer': { label: 'Uber and Lyft Accidents', blurb: 'For passengers and drivers hurt in rideshare crashes.' }
    };

    var section = document.querySelector('[data-city-services]');
    if (!section) return;

    var city = section.getAttribute('data-city-services');
    if (!city) return;

    function labelFromSlug(slug) {
        return slug
            .replace(/-lawyer$/, '')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    function styleAsCardLink(el, refCard) {
        el.className = refCard ? refCard.className : 'card';
        el.setAttribute('style', (refCard && refCard.getAttribute('style')) || 'text-align: center; padding: 2rem;');
        el.style.textDecoration = 'none';
        el.style.color = 'inherit';
        el.style.display = 'block';
        el.style.cursor = 'pointer';
    }

    fetch(STORYBLOK_API + '?token=' + STORYBLOK_TOKEN + '&version=published&starts_with=' + city + '/&per_page=100&is_startpage=false')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.stories || !data.stories.length) return;

            var published = {};
            data.stories.forEach(function (s) { published[s.slug] = true; });

            var linked = {};

            // 1) Convert existing matching cards into links.
            var cards = section.querySelectorAll('.card');
            cards.forEach(function (card) {
                var h3 = card.querySelector('h3');
                if (!h3) return;
                var slug = SERVICE_SLUGS[h3.textContent.trim()];
                if (slug && published[slug] && !linked[slug]) {
                    var a = document.createElement('a');
                    a.href = '/' + city + '/' + slug;
                    a.className = card.className;
                    a.setAttribute('style', card.getAttribute('style') || '');
                    a.style.textDecoration = 'none';
                    a.style.color = 'inherit';
                    a.style.display = 'block';
                    a.style.cursor = 'pointer';
                    while (card.firstChild) {
                        a.appendChild(card.firstChild);
                    }
                    card.parentNode.replaceChild(a, card);
                    linked[slug] = true;
                }
            });

            // 2) Append a link for any published practice page with no card yet,
            //    so rolling-published subpages are never left orphaned.
            var refCard = section.querySelector('.card');
            Object.keys(published).forEach(function (slug) {
                if (linked[slug] || !/-lawyer$/.test(slug)) return;
                var info = SLUG_INFO[slug] || { label: labelFromSlug(slug), blurb: '' };
                var a = document.createElement('a');
                a.href = '/' + city + '/' + slug;
                styleAsCardLink(a, refCard);
                var h3 = document.createElement('h3');
                h3.setAttribute('style', 'color: var(--dark-azure);');
                h3.textContent = info.label;
                a.appendChild(h3);
                if (info.blurb) {
                    var p = document.createElement('p');
                    p.className = 'text-gray';
                    p.textContent = info.blurb;
                    a.appendChild(p);
                }
                section.appendChild(a);
                linked[slug] = true;
            });
        })
        .catch(function () {
            // Silently fail — cards remain as plain text.
        });
})();
