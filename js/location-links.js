/**
 * Location Links - Dynamically links "Types of Cases" cards to city service subpages
 * Fetches available articles from Storyblok and only adds links for existing content.
 */
(function () {
    'use strict';

    var STORYBLOK_TOKEN = 'yDLol9DLwFeUUgsyYx3rcQtt';
    var STORYBLOK_API = 'https://api.storyblok.com/v2/cdn/stories';

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

    var section = document.querySelector('[data-city-services]');
    if (!section) return;

    var city = section.getAttribute('data-city-services');
    if (!city) return;

    fetch(STORYBLOK_API + '?token=' + STORYBLOK_TOKEN + '&version=published&starts_with=' + city + '/&per_page=100&is_startpage=false')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.stories || !data.stories.length) return;

            var slugs = {};
            data.stories.forEach(function (s) {
                slugs[s.slug] = true;
            });

            var cards = section.querySelectorAll('.card');
            cards.forEach(function (card) {
                var h3 = card.querySelector('h3');
                if (!h3) return;
                var text = h3.textContent.trim();
                var slug = SERVICE_SLUGS[text];
                if (slug && slugs[slug]) {
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
                }
            });
        })
        .catch(function () {
            // Silently fail — cards remain as plain text
        });
})();
