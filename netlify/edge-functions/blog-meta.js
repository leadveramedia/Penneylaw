/**
 * Netlify Edge Function: Blog Post Meta Tag Injection
 *
 * Intercepts requests to /blog/* and injects Open Graph and Twitter Card
 * meta tags by fetching the story from Storyblok's CDN API. This enables
 * proper social sharing previews for client-side rendered blog posts.
 *
 * Runs on Deno (Netlify Edge Functions runtime).
 */

const STORYBLOK_TOKEN = 'yDLol9DLwFeUUgsyYx3rcQtt';
const STORYBLOK_API = 'https://api.storyblok.com/v2/cdn';

export default async (request, context) => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Only process /blog/slug paths (not /blog.html or /blog/)
    if (!path.match(/^\/blog\/[a-z0-9][\w-]*\/?$/i)) {
        return context.next();
    }

    // Extract the full slug (blog/post-slug)
    const slug = 'blog/' + path.replace(/^\/blog\//, '').replace(/\/$/, '');

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

        // Get the original response (blog-post.html served by rewrite)
        const response = await context.next();
        const html = await response.text();

        // Build meta values
        const title = (content.meta_title || content.title) + ' | Frank Penney Injury Law';
        const description = content.meta_description || content.excerpt || '';
        const imageUrl = (content.og_image && content.og_image.filename)
            ? content.og_image.filename + '/m/1200x630'
            : (content.featured_image && content.featured_image.filename)
                ? content.featured_image.filename + '/m/1200x630'
                : 'https://www.penneylaw.com/images/favicon/Frank-Penny-Favicon-Logo-600x315-1.png';
        const postUrl = 'https://www.penneylaw.com/blog/' + story.slug;

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

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const config = {
    path: "/blog/*"
};
