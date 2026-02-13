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

    var STORYBLOK_TOKEN = 'yDLol9DLwFeUUgsyYx3rcQtt'; // Public access token (read-only)
    var STORYBLOK_API = 'https://api.storyblok.com/v2/cdn';
    var STORYBLOK_VERSION = 'published';
    var POSTS_PER_PAGE = 9;
    var RELATED_POSTS_COUNT = 3;
    var CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Author mapping (reuses existing attorney images)
    var AUTHOR_MAP = {
        'Frank Penney': { image: 'images/attorneys/frank-penney.webp', title: 'Founding Attorney' },
        'Jacob Stoeltzing': { image: 'images/attorneys/jacob-stoeltzing.webp', title: 'Attorney' },
        'Joshua Boyce': { image: 'images/attorneys/joshua-boyce.webp', title: 'Attorney' },
        'Mark McCauley': { image: 'images/attorneys/mark-mccauley.webp', title: 'Attorney' },
        'Guest Author': { image: 'images/logos/frank-penney-logo.webp', title: '' }
    };

    // Category list (matches Storyblok multi-option field)
    var CATEGORIES = [
        'Car Accidents', 'Truck Accidents', 'Personal Injury',
        'Insurance Claims', 'Legal Tips', 'Community', 'Firm News'
    ];

    // ==========================================
    // STATE
    // ==========================================

    var currentPage = 1;
    var currentCategory = 'all';
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
            sort_by: 'content.publish_date:desc',
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

    function fetchStory(fullSlug) {
        var url = STORYBLOK_API + '/stories/' + fullSlug + '?token=' + STORYBLOK_TOKEN + '&version=' + STORYBLOK_VERSION;

        var cacheKey = 'sb_story_' + fullSlug;
        var cached = getCachedResponse(cacheKey);
        if (cached) {
            return Promise.resolve(cached);
        }

        return fetch(url)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Story not found: ' + response.status);
                }
                return response.json();
            })
            .then(function (data) {
                setCachedResponse(cacheKey, data.story);
                return data.story;
            });
    }

    // ==========================================
    // RICH TEXT RENDERER
    // ==========================================

    function renderRichText(richTextObject) {
        if (!richTextObject || !richTextObject.content) return '';
        return richTextObject.content.map(renderNode).join('');
    }

    function renderNode(node) {
        if (!node) return '';

        switch (node.type) {
            case 'paragraph':
                var pContent = renderChildren(node);
                if (!pContent) return '';
                return '<p>' + pContent + '</p>';
            case 'heading':
                var level = node.attrs && node.attrs.level || 2;
                return '<h' + level + '>' + renderChildren(node) + '</h' + level + '>';
            case 'bullet_list':
                return '<ul>' + renderChildren(node) + '</ul>';
            case 'ordered_list':
                return '<ol>' + renderChildren(node) + '</ol>';
            case 'list_item':
                return '<li>' + renderChildren(node) + '</li>';
            case 'blockquote':
                return '<blockquote>' + renderChildren(node) + '</blockquote>';
            case 'code_block':
                return '<pre><code>' + renderChildren(node) + '</code></pre>';
            case 'horizontal_rule':
                return '<hr>';
            case 'image':
                var src = node.attrs && node.attrs.src || '';
                var alt = node.attrs && node.attrs.alt || '';
                return '<figure class="blog-content-image"><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '" loading="lazy"><figcaption>' + escapeHtml(alt) + '</figcaption></figure>';
            case 'text':
                var text = escapeHtml(node.text || '');
                if (node.marks) {
                    node.marks.forEach(function (mark) {
                        switch (mark.type) {
                            case 'bold':
                                text = '<strong>' + text + '</strong>';
                                break;
                            case 'italic':
                                text = '<em>' + text + '</em>';
                                break;
                            case 'underline':
                                text = '<u>' + text + '</u>';
                                break;
                            case 'strike':
                                text = '<s>' + text + '</s>';
                                break;
                            case 'link':
                                var href = mark.attrs && mark.attrs.href || '#';
                                var target = mark.attrs && mark.attrs.target || '_self';
                                var rel = target === '_blank' ? ' rel="noopener noreferrer"' : '';
                                text = '<a href="' + escapeHtml(href) + '" target="' + target + '"' + rel + '>' + text + '</a>';
                                break;
                            case 'code':
                                text = '<code>' + text + '</code>';
                                break;
                        }
                    });
                }
                return text;
            case 'hard_break':
                return '<br>';
            default:
                return renderChildren(node);
        }
    }

    function renderChildren(node) {
        if (!node.content) return '';
        return node.content.map(renderNode).join('');
    }

    // ==========================================
    // BLOG CARD RENDERING
    // ==========================================

    function renderBlogCard(story) {
        var content = story.content;
        var readTime = calculateReadTime(content.body);
        var categories = (content.categories || []).filter(function (c) { return c && c.trim(); });
        var imageUrl = content.featured_image && content.featured_image.filename
            ? content.featured_image.filename + '/m/600x400'
            : 'images/favicon/Frank-Penny-Favicon-Logo-600x315-1.png';
        var imageAlt = content.featured_image_alt || content.title || '';

        var categoryHtml = categories.map(function (cat) {
            return '<span class="blog-card-category">' + escapeHtml(cat) + '</span>';
        }).join('');

        return '<a href="/blog/' + escapeHtml(story.slug) + '" class="card blog-card" aria-label="Read: ' + escapeHtml(content.title) + '">' +
            '<div class="card-image">' +
                '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(imageAlt) + '" width="600" height="400" loading="lazy">' +
            '</div>' +
            '<div class="blog-card-body">' +
                '<div class="blog-card-meta">' +
                    '<time datetime="' + (content.publish_date || '') + '">' + formatDate(content.publish_date) + '</time>' +
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

    function renderCategoryFilters() {
        var container = document.querySelector('.blog-category-filters');
        if (!container) return;

        var html = '<button class="blog-filter-btn active" data-category="all">All</button>';
        CATEGORIES.forEach(function (cat) {
            html += '<button class="blog-filter-btn" data-category="' + escapeHtml(cat) + '">' + escapeHtml(cat) + '</button>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.blog-filter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                container.querySelectorAll('.blog-filter-btn').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentCategory = this.getAttribute('data-category');
                currentPage = 1;
                loadBlogPosts();
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
        if (tagParam) {
            currentTag = tagParam;
            showActiveTag(tagParam);
        }
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

        if (currentCategory && currentCategory !== 'all') {
            params['filter_query[categories][in]'] = currentCategory;
        }

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
                renderPostsGrid(result.stories);
                renderPagination(result.total, result.perPage, currentPage);
            })
            .catch(function (err) {
                console.error('Failed to load blog posts:', err);
                if (loading) loading.style.display = 'none';
                if (error) error.removeAttribute('hidden');
            });
    }

    function initBlogListing() {
        renderCategoryFilters();
        initSearch();
        initTagFilter();

        // Check URL for category parameter
        var urlParams = new URLSearchParams(window.location.search);
        var catParam = urlParams.get('category');
        if (catParam) {
            currentCategory = catParam;
            var buttons = document.querySelectorAll('.blog-filter-btn');
            buttons.forEach(function (btn) {
                btn.classList.remove('active');
                if (btn.getAttribute('data-category') === catParam) {
                    btn.classList.add('active');
                }
            });
        }

        loadBlogPosts();
    }

    // ==========================================
    // BLOG POST PAGE
    // ==========================================

    function renderBlogPost(story) {
        var content = story.content;
        var readTime = calculateReadTime(content.body);
        var author = content.author || 'Frank Penney';
        var authorInfo = AUTHOR_MAP[author] || AUTHOR_MAP['Frank Penney'];
        var categories = (content.categories || []).filter(function (c) { return c && c.trim(); });
        var tags = content.tags || story.tag_list || [];
        var imageUrl = content.featured_image && content.featured_image.filename
            ? content.featured_image.filename + '/m/1200x630'
            : '';
        var imageAlt = content.featured_image_alt || content.title || '';

        // Update page title and canonical
        document.title = (content.meta_title || content.title) + ' | Frank Penney Injury Law';
        var canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.href = 'https://www.penneylaw.com/blog/' + story.slug;

        // Update breadcrumb
        var breadcrumbTitle = document.getElementById('breadcrumb-post-title');
        if (breadcrumbTitle) breadcrumbTitle.textContent = content.title;

        // Category pills
        var categoryHtml = categories.map(function (cat) {
            return '<a href="/blog.html?category=' + encodeURIComponent(cat) + '" class="blog-post-category">' + escapeHtml(cat) + '</a>';
        }).join('');

        // Tag pills
        var tagHtml = tags.map(function (tag) {
            return '<a href="/blog.html?tag=' + encodeURIComponent(tag) + '" class="blog-post-tag">' + escapeHtml(tag) + '</a>';
        }).join('');

        // Social sharing URLs
        var postUrl = 'https://www.penneylaw.com/blog/' + story.slug;
        var postTitle = encodeURIComponent(content.title);
        var shareHtml = '<div class="blog-share">' +
            '<span class="blog-share-label">Share this article:</span>' +
            '<div class="blog-share-buttons">' +
                '<a href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(postUrl) + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn blog-share-facebook" aria-label="Share on Facebook">Facebook</a>' +
                '<a href="https://twitter.com/intent/tweet?url=' + encodeURIComponent(postUrl) + '&text=' + postTitle + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn blog-share-twitter" aria-label="Share on X (Twitter)">X</a>' +
                '<a href="https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(postUrl) + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn blog-share-linkedin" aria-label="Share on LinkedIn">LinkedIn</a>' +
                '<a href="mailto:?subject=' + postTitle + '&body=' + encodeURIComponent(postUrl) + '" class="blog-share-btn blog-share-email" aria-label="Share via email">Email</a>' +
            '</div>' +
        '</div>';

        // Render rich text body
        var bodyHtml = renderRichText(content.body);

        // Build post layout
        var postContainer = document.getElementById('blog-post-content');
        var loadingEl = document.getElementById('blog-post-loading');
        if (loadingEl) loadingEl.style.display = 'none';

        var html = '<div class="container blog-post-layout">' +
            '<div class="blog-post-main">' +
                '<header class="blog-post-header">' +
                    (categoryHtml ? '<div class="blog-post-categories">' + categoryHtml + '</div>' : '') +
                    '<h1 class="blog-post-title">' + escapeHtml(content.title) + '</h1>' +
                    '<div class="blog-post-meta">' +
                        '<div class="blog-post-author">' +
                            '<img src="' + escapeHtml(authorInfo.image) + '" alt="' + escapeHtml(author) + '" class="blog-author-avatar" width="44" height="44" loading="lazy">' +
                            '<div class="blog-author-info">' +
                                '<span class="blog-author-name">' + escapeHtml(author) + '</span>' +
                                (authorInfo.title ? '<span class="blog-author-title">' + escapeHtml(authorInfo.title) + '</span>' : '') +
                            '</div>' +
                        '</div>' +
                        '<div class="blog-post-meta-details">' +
                            '<time datetime="' + (content.publish_date || '') + '">' + formatDate(content.publish_date) + '</time>' +
                            '<span class="blog-post-read-time">' + readTime + ' min read</span>' +
                        '</div>' +
                    '</div>' +
                '</header>' +
                (imageUrl ? '<figure class="blog-post-featured-image"><img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(imageAlt) + '" width="1200" height="630"></figure>' : '') +
                '<div class="blog-post-body">' + bodyHtml + '</div>' +
                (tagHtml ? '<div class="blog-post-tags"><span class="blog-tags-label">Tags:</span>' + tagHtml + '</div>' : '') +
                shareHtml +
            '</div>' +
            '<aside class="blog-post-sidebar" aria-label="Article sidebar">' +
                '<div class="blog-sidebar-cta">' +
                    '<h3>Injured in an Accident?</h3>' +
                    '<p>Get a free consultation from our experienced attorneys.</p>' +
                    '<a href="/contact.html" class="btn btn-primary btn-full">Bank on Frank</a>' +
                    '<a href="tel:8888880566" class="btn btn-outline btn-full">Call (888) 888-0566</a>' +
                '</div>' +
            '</aside>' +
        '</div>';

        postContainer.innerHTML = html;

        // Inject BlogPosting JSON-LD
        var jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            'headline': content.title,
            'description': content.excerpt || '',
            'image': imageUrl || 'https://www.penneylaw.com/images/favicon/Frank-Penny-Favicon-Logo-600x315-1.png',
            'author': { '@type': 'Person', 'name': author },
            'publisher': {
                '@type': 'Organization',
                'name': 'Frank Penney Injury Law',
                'logo': { '@type': 'ImageObject', 'url': 'https://www.penneylaw.com/images/logos/frank-penney-logo.webp' }
            },
            'datePublished': content.publish_date || '',
            'mainEntityOfPage': { '@type': 'WebPage', '@id': postUrl }
        };
        var script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(jsonLd);
        document.head.appendChild(script);
    }

    function loadRelatedPosts(story) {
        var content = story.content;
        var categories = (content.categories || []).filter(function (c) { return c && c.trim(); });
        if (categories.length === 0) return;

        var params = {
            per_page: RELATED_POSTS_COUNT + 1,
            'filter_query[categories][in]': categories[0],
            excluding_slugs: story.full_slug
        };

        fetchStories(params)
            .then(function (result) {
                var related = result.stories.filter(function (s) {
                    return s.uuid !== story.uuid;
                }).slice(0, RELATED_POSTS_COUNT);

                if (related.length === 0) return;

                var section = document.getElementById('blog-related-posts');
                var grid = document.getElementById('blog-related-grid');
                if (!section || !grid) return;

                section.removeAttribute('hidden');
                grid.innerHTML = related.map(renderBlogCard).join('');
            })
            .catch(function (err) {
                console.warn('Failed to load related posts:', err);
            });
    }

    function initBlogPost() {
        var path = window.location.pathname;
        var slug = path.replace(/^\//, '').replace(/\/$/, '');

        if (!slug || slug === 'blog' || slug === 'blog-post' || slug === 'blog-post.html') {
            window.location.href = '/blog.html';
            return;
        }

        fetchStory(slug)
            .then(function (story) {
                renderBlogPost(story);
                loadRelatedPosts(story);
            })
            .catch(function (err) {
                console.error('Failed to load blog post:', err);
                var loading = document.getElementById('blog-post-loading');
                var error = document.getElementById('blog-post-error');
                if (loading) loading.style.display = 'none';
                if (error) error.removeAttribute('hidden');
            });
    }

    // ==========================================
    // PAGE DETECTION & INIT
    // ==========================================

    function init() {
        var path = window.location.pathname;

        if (path.indexOf('/blog.html') !== -1 || path === '/blog' || path === '/blog/') {
            initBlogListing();
        } else if (path.indexOf('/blog/') !== -1 || path.indexOf('/blog-post.html') !== -1) {
            initBlogPost();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
