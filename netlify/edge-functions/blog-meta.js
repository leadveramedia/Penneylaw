/**
 * Netlify Edge Function: Meta Tag Injection
 *
 * Intercepts requests to /blog/*, /accident-news/*, and /{city}/* paths
 * and injects Open Graph and Twitter Card meta tags by fetching the story
 * from Storyblok's CDN API. This enables proper social sharing previews
 * for client-side rendered content.
 *
 * Runs on Deno (Netlify Edge Functions runtime).
 */

// Public read-only content delivery token (intentionally client-side; visible in browser network tab regardless)
const STORYBLOK_TOKEN = 'yDLol9DLwFeUUgsyYx3rcQtt';
const STORYBLOK_API = 'https://api.storyblok.com/v2/cdn';

// City folders managed by Storyblok
const CITY_FOLDERS = ['sacramento', 'roseville', 'stockton', 'modesto', 'oakland', 'redding'];

export default async (request, context) => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Detect content type from path
    let contentType = null;
    let slug = null;

    if (path.match(/^\/blog\/[a-z0-9][\w-]*\/?$/i)) {
        contentType = 'blog';
        slug = 'blog/' + path.replace(/^\/blog\//, '').replace(/\/$/, '');
    } else if (path.match(/^\/accident-news\/[a-z0-9][\w-]*\/?$/i)) {
        contentType = 'accident-news';
        slug = 'accident-news/' + path.replace(/^\/accident-news\//, '').replace(/\/$/, '');
    } else {
        // Check city folders: /sacramento/some-slug
        const cityMatch = path.match(/^\/([a-z]+)\/([a-z0-9][\w-]*)\/?$/i);
        if (cityMatch && CITY_FOLDERS.indexOf(cityMatch[1]) !== -1) {
            contentType = 'city';
            slug = cityMatch[1] + '/' + cityMatch[2];
        }
    }

    if (!contentType || !slug) {
        return context.next();
    }

    try {
        // Fetch story from Storyblok
        const storyResponse = await fetch(
            `${STORYBLOK_API}/stories/${slug}?token=${STORYBLOK_TOKEN}&version=published`
        );

        if (!storyResponse.ok) {
            return context.next();
        }

        const storyData = await storyResponse.json();
        const story = storyData.story;
        const content = story.content;

        // Get the original response (served by rewrite)
        const response = await context.next();
        const html = await response.text();

        // Build meta values based on content type
        let title, description, postUrl;

        if (contentType === 'blog') {
            title = (content.meta_title || content.title) + ' | Frank Penney Injury Law';
            description = content.meta_description || content.excerpt || '';
            postUrl = 'https://www.penneylaw.com/blog/' + story.slug;
        } else if (contentType === 'accident-news') {
            title = content.title + ' | Frank Penney Injury Law';
            description = content.Subheadline || extractTextSnippet(content.Body_Content) || '';
            postUrl = 'https://www.penneylaw.com/accident-news/' + story.slug;
        } else {
            // city post
            title = (content.meta_title || content.title) + ' | Frank Penney Injury Law';
            description = content.meta_description || content.excerpt || '';
            postUrl = 'https://www.penneylaw.com/' + story.full_slug;
        }

        const imageUrl = (content.og_image && content.og_image.filename)
            ? content.og_image.filename + '/m/1200x630'
            : (content.Featured_Image && content.Featured_Image.filename)
                ? content.Featured_Image.filename + '/m/1200x630'
                : 'https://www.penneylaw.com/images/favicon/Frank-Penny-Favicon-Logo-600x315-1.png';

        // Replace meta tags in HTML
        let modifiedHtml = html;
        modifiedHtml = modifiedHtml.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
        modifiedHtml = modifiedHtml.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeAttr(description)}">`);
        modifiedHtml = modifiedHtml.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${postUrl}">`);

        // OG tags
        modifiedHtml = modifiedHtml.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`);
        modifiedHtml = modifiedHtml.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(description)}">`);
        modifiedHtml = modifiedHtml.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${postUrl}">`);
        modifiedHtml = modifiedHtml.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeAttr(imageUrl)}">`);

        // Twitter tags
        modifiedHtml = modifiedHtml.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapeAttr(title)}">`);
        modifiedHtml = modifiedHtml.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escapeAttr(description)}">`);
        modifiedHtml = modifiedHtml.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${escapeAttr(imageUrl)}">`);

        return new Response(modifiedHtml, {
            headers: response.headers
        });

    } catch (error) {
        console.error('Edge function error:', error);
        return context.next();
    }
};

function extractTextSnippet(richText) {
    if (!richText || !richText.content) return '';
    function getText(node) {
        if (!node) return '';
        if (node.type === 'text') return node.text || '';
        if (!node.content) return '';
        return node.content.map(getText).join(' ');
    }
    const text = richText.content.map(getText).join(' ').trim();
    return text.substring(0, 160) + (text.length > 160 ? '...' : '');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const config = {
    path: ["/blog/*", "/accident-news/*", "/sacramento/*", "/roseville/*", "/stockton/*", "/modesto/*", "/oakland/*", "/redding/*"]
};
