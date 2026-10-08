/**
 * Frank Penney Injury Law - Blog Module
 * Client-side rendering with Storyblok CMS
 *
 * Handles both the blog listing page (blog.html) and
 * individual blog post pages (/blog/post-slug via Netlify rewrite).
 */

(function () {
    'use strict';

    // ==========================================
    // CONFIGURATION
    // ==========================================

    // Public read-only content delivery token (intentionally client-side; visible in browser network tab regardless)
    var STORYBLOK_TOKEN = 'yDLol9DLwFeUUgsyYx3rcQtt';
    var STORYBLOK_API = 'https://api.storyblok.com/v2/cdn';
    // Use 'draft' when Storyblok preview editor is active (passes _storyblok param)
    var STORYBLOK_VERSION = window.location.search.indexOf('_storyblok') !== -1 ? 'draft' : 'published';
    var POSTS_PER_PAGE = 9;
    var CACHE_TTL = 5 * 60 * 1000; // 5 minutes


    // ==========================================
    // STATE
    // ==========================================

    var currentPage = 1;
    var currentTag = '';
    var currentSearch = '';
    var totalPages = 1;
    var searchDebounceTimer = null;

    // ==========================================
    // UTILITIES
    // ==========================================

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function formatDate(dateString) {
        if (!dateString) return '';
        // Normalize Storyblok date format ("2026-02-02 00:00") to ISO for Safari compatibility
        var normalized = dateString.replace(' ', 'T');
        var date = new Date(normalized);
        if (isNaN(date.getTime())) return '';
        var months = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
    }

    function calculateReadTime(richTextObject) {
        if (!richTextObject || !richTextObject.content) return 1;
        var text = extractTextFromRichText(richTextObject);
        var wordCount = text.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
        var minutes = Math.ceil(wordCount / 200);
        return Math.max(1, minutes);
    }

    function extractTextFromRichText(node) {
        if (!node) return '';
        if (node.type === 'text') return node.text || '';
        if (!node.content) return '';
        return node.content.map(extractTextFromRichText).join(' ');
    }

    // ==========================================
    // CACHING (sessionStorage)
    // ==========================================

    function getCachedResponse(key) {
        try {
            var item = sessionStorage.getItem(key);
            if (!item) return null;
            var parsed = JSON.parse(item);
            if (Date.now() - parsed.timestamp > CACHE_TTL) {
                sessionStorage.removeItem(key);
                return null;
            }
            return parsed.data;
        } catch (e) {
            return null;
        }
    }

    function setCachedResponse(key, data) {
        try {
            sessionStorage.setItem(key, JSON.stringify({
                data: data,
                timestamp: Date.now()
            }));
        } catch (e) {
            // sessionStorage full or unavailable
        }
    }

    // ==========================================
    // API CLIENT
    // ==========================================

    function fetchStories(params) {
        var defaults = {
            token: STORYBLOK_TOKEN,
            version: STORYBLOK_VERSION,
            starts_with: 'blog/',
            sort_by: 'content.Date:desc',
            per_page: POSTS_PER_PAGE,
            page: 1,
            is_startpage: false
        };

        var queryParams = {};
        var key;
        for (key in defaults) {
            if (defaults.hasOwnProperty(key)) {
                queryParams[key] = defaults[key];
            }
        }
        for (key in params) {
            if (params.hasOwnProperty(key)) {
                queryParams[key] = params[key];
            }
        }

        var queryString = Object.keys(queryParams)
            .filter(function (k) { return queryParams[k] !== '' && queryParams[k] !== undefined; })
            .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]); })
            .join('&');

        var url = STORYBLOK_API + '/stories?' + queryString;

        var cacheKey = 'sb_' + queryString;
        var cached = getCachedResponse(cacheKey);
        if (cached) {
            return Promise.resolve(cached);
        }

        return fetch(url)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Storyblok API error: ' + response.status);
                }
                var total = parseInt(response.headers.get('Total'), 10) || 0;
                return response.json().then(function (data) {
                    var result = {
                        stories: data.stories,
                        total: total,
                        perPage: queryParams.per_page
                    };
                    setCachedResponse(cacheKey, result);
                    return result;
                });
            });
    }

    // ==========================================
    // RICH TEXT RENDERER
    // ==========================================

    // ==========================================
    // BLOG CARD RENDERING
    // ==========================================

    function renderBlogCard(story) {
        var content = story.content;
        var readTime = calculateReadTime(content.Body_Content);
        var categories = (content.categories || []).filter(function (c) { return c && c.trim(); });
        var imageUrl = content.Featured_Image && content.Featured_Image.filename
            ? content.Featured_Image.filename + '/m/600x400'
            : '/images/favicon/social-preview-2026-1200x630.png';
        var imageAlt = content.featured_image_alt || content.title || '';

        var categoryHtml = categories.map(function (cat) {
            return '<span class="blog-card-category">' + escapeHtml(cat) + '</span>';
        }).join('');

        return '<a href="/blog/' + escapeHtml(story.slug) + '" class="card blog-card" aria-label="' + escapeHtml(content.title) + '">' +
            '<div class="card-image">' +
                '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(imageAlt) + '" width="600" height="400" loading="lazy">' +
            '</div>' +
            '<div class="blog-card-body">' +
                '<div class="blog-card-meta">' +
                    '<time datetime="' + (content.Date || '') + '">' + formatDate(content.Date) + '</time>' +
                    '<span class="blog-card-read-time">' + readTime + ' min read</span>' +
                '</div>' +
                (categoryHtml ? '<div class="blog-card-categories">' + categoryHtml + '</div>' : '') +
                '<h3 class="blog-card-title">' + escapeHtml(content.title) + '</h3>' +
                '<p class="blog-card-excerpt">' + escapeHtml(content.excerpt || '') + '</p>' +
                '<span class="blog-card-read-more">Read Article</span>' +
            '</div>' +
        '</a>';
    }

    // ==========================================
    // BLOG LISTING PAGE
    // ==========================================

    function renderPostsGrid(stories) {
        var grid = document.getElementById('blog-posts-grid');
        var loading = document.getElementById('blog-loading');
        var empty = document.getElementById('blog-empty');

        if (!grid) return;

        if (loading) loading.style.display = 'none';

        if (stories.length === 0) {
            grid.style.display = 'none';
            if (empty) empty.removeAttribute('hidden');
            return;
        }

        if (empty) empty.setAttribute('hidden', '');
        grid.style.display = '';
        grid.innerHTML = stories.map(renderBlogCard).join('');
    }

    function renderPagination(total, perPage, page) {
        var nav = document.getElementById('blog-pagination');
        if (!nav) return;

        totalPages = Math.ceil(total / perPage);
        if (totalPages <= 1) {
            nav.setAttribute('hidden', '');
            return;
        }

        nav.removeAttribute('hidden');
        var inner = nav.querySelector('.blog-pagination-inner');
        if (!inner) return;

        var html = '';

        // Previous button
        html += '<button class="blog-page-btn" data-page="' + (page - 1) + '"' +
            (page <= 1 ? ' disabled aria-disabled="true"' : '') +
            ' aria-label="Previous page">Previous</button>';

        // Page numbers
        var startPage = Math.max(1, page - 2);
        var endPage = Math.min(totalPages, page + 2);

        if (startPage > 1) {
            html += '<button class="blog-page-btn" data-page="1" aria-label="Page 1">1</button>';
            if (startPage > 2) html += '<span class="blog-page-ellipsis">&hellip;</span>';
        }

        for (var i = startPage; i <= endPage; i++) {
            html += '<button class="blog-page-btn' + (i === page ? ' active' : '') + '" data-page="' + i + '"' +
                ' aria-label="Page ' + i + '"' +
                (i === page ? ' aria-current="page"' : '') + '>' + i + '</button>';
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += '<span class="blog-page-ellipsis">&hellip;</span>';
            html += '<button class="blog-page-btn" data-page="' + totalPages + '" aria-label="Page ' + totalPages + '">' + totalPages + '</button>';
        }

        // Next button
        html += '<button class="blog-page-btn" data-page="' + (page + 1) + '"' +
            (page >= totalPages ? ' disabled aria-disabled="true"' : '') +
            ' aria-label="Next page">Next</button>';

        inner.innerHTML = html;

        // Attach event listeners
        inner.querySelectorAll('.blog-page-btn:not([disabled])').forEach(function (btn) {
            btn.addEventListener('click', function () {
                currentPage = parseInt(this.getAttribute('data-page'), 10);
                loadBlogPosts();
                var postsSection = document.querySelector('.blog-posts-section');
                if (postsSection) {
                    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    postsSection.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
                }
            });
        });
    }

    function initSearch() {
        var searchInput = document.getElementById('blog-search-input');
        if (!searchInput) return;

        searchInput.addEventListener('input', function () {
            clearTimeout(searchDebounceTimer);
            var value = this.value.trim();
            searchDebounceTimer = setTimeout(function () {
                currentSearch = value;
                currentPage = 1;
                loadBlogPosts();
            }, 400);
        });
    }

    function initTagFilter() {
        var clearBtn = document.getElementById('blog-clear-tag');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                currentTag = '';
                document.getElementById('blog-active-tag').setAttribute('hidden', '');
                currentPage = 1;
                loadBlogPosts();
            });
        }

        var urlParams = new URLSearchParams(window.location.search);
        var tagParam = urlParams.get('tag');
        // Label is shown by loadBlogPosts only once the tag returns posts: echoing raw
        // ?tag= text let anyone put arbitrary words on our domain (phishing text injection).
        if (tagParam) currentTag = tagParam;
    }

    function showActiveTag(tagName) {
        var container = document.getElementById('blog-active-tag');
        var nameEl = document.getElementById('blog-active-tag-name');
        if (container && nameEl) {
            nameEl.textContent = tagName;
            container.removeAttribute('hidden');
        }
    }

    function loadBlogPosts() {
        var params = {
            page: currentPage,
            per_page: POSTS_PER_PAGE
        };

        if (currentTag) {
            params.with_tag = currentTag;
        }

        if (currentSearch) {
            params.search_term = currentSearch;
        }

        var loading = document.getElementById('blog-loading');
        var grid = document.getElementById('blog-posts-grid');
        var error = document.getElementById('blog-error');
        var empty = document.getElementById('blog-empty');

        if (loading) loading.style.display = '';
        if (grid) grid.style.display = 'none';
        if (error) error.setAttribute('hidden', '');
        if (empty) empty.setAttribute('hidden', '');

        fetchStories(params)
            .then(function (result) {
                if (currentTag && result.stories.length) showActiveTag(currentTag);
                renderPostsGrid(result.stories);
                renderPagination(result.total, result.perPage, currentPage);
            })
            .catch(function (err) {
                console.error('Failed to load blog posts:', err);
                if (loading) loading.style.display = 'none';
                if (error) error.removeAttribute('hidden');
            });
    }

    // No category filter: the Storyblok "Blog page" type has no categories field, so filtering
    // on one returned nothing for every button. Add the field and posts' values before bringing
    // it back.
    function initBlogListing() {
        initSearch();
        initTagFilter();
        // build-archives.js writes page 1 into the HTML; then only the page count is needed.
        var grid = document.getElementById('blog-posts-grid');
        if (grid && grid.hasAttribute('data-prerendered') && !currentTag) {
            fetchStories({ page: 1, per_page: POSTS_PER_PAGE })
                .then(function (result) { renderPagination(result.total, result.perPage, 1); })
                .catch(function () { /* pagination is optional; the cards are already there */ });
            return;
        }
        loadBlogPosts();
    }

    // ==========================================
    // PAGE DETECTION & INIT
    // ==========================================

    function init() {
        var path = window.location.pathname;

        // Post pages are rendered server-side by netlify/edge-functions/blog-meta.js.
        if (path.indexOf('/blog.html') !== -1 || path === '/blog' || path === '/blog/') {
            initBlogListing();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
