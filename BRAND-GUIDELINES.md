# Frank Penney Injury Law - Brand Guidelines

Quick reference for developers. Full details in Brand Bible 2026.

---

## Brand Colors

| Color | Hex | CSS Variable | Usage | Ratio |
|-------|-----|--------------|-------|-------|
| Dark Azure | `#033563` | `--dark-azure` | Headlines, nav, links, primary | 40% |
| Charcoal | `#2C2C2C` | `--charcoal` | Body text, footer | 30% |
| Pastel Azure | `#A2DCF5` | `--pastel-azure` | Backgrounds, card icons | 20% |
| Gold | `#FFD700` | `--gold` | Stats, achievements, phone numbers | 20% |
| Hot Pink | `#E00D93` | `--hot-pink` | CTAs, taglines ONLY | 10% |

---

## Typography

### Font Families

```css
/* Headlines, buttons, navigation */
font-family: var(--font-primary);  /* Montserrat */

/* Body text, paragraphs */
font-family: var(--font-secondary);  /* Arial, Helvetica */
```

### Heading Weights

| Element | Font | Weight | Size |
|---------|------|--------|------|
| H1 | Montserrat | Bold (700) | 36-56px |
| H2 | Montserrat | Semi-Bold (600) | 32-40px |
| H3 | Montserrat | Semi-Bold (600) | 24-28px |
| H4 | Montserrat | Semi-Bold (600) | 20px |
| Tagline | Montserrat | Extra-Bold (800) | 28-48px |
| Body | Arial | Regular (400) | 16px |

---

## Key Brand Elements

### "BANK ON FRANK!" Tagline

**Always use:**
- Hot Pink color (`--hot-pink`)
- Uppercase text
- Extra-Bold weight (800)
- Montserrat font

```css
.brand-tagline {
    font-family: var(--font-primary);
    font-weight: 800;
    color: var(--hot-pink);
    text-transform: uppercase;
}
```

### Stats & Numbers

**Always use Gold for:**
- "$1 Billion+"
- "30 Years"
- Phone numbers in CTAs
- Achievement numbers

```css
.brand-stat {
    font-family: var(--font-primary);
    font-weight: 700;
    color: var(--gold);
}
```

---

## Button Hierarchy

```html
<!-- Primary CTA (Hot Pink) -->
<a href="#" class="btn btn-primary">Get Free Consultation</a>

<!-- Secondary CTA (Dark Azure) -->
<a href="#" class="btn btn-secondary">Learn More</a>

<!-- Outline (Dark Azure border) -->
<a href="#" class="btn btn-outline">View Details</a>

<!-- On Dark Backgrounds -->
<a href="#" class="btn btn-outline-white">Contact Us</a>
```

---

## Quick Checklist

When creating new pages, verify:

- [ ] Headlines use Dark Azure (`--dark-azure`)
- [ ] Body text uses Charcoal (`--charcoal`)
- [ ] Primary CTAs are Hot Pink
- [ ] Stats/numbers are Gold
- [ ] Headings use Montserrat font
- [ ] Body uses Arial font
- [ ] "BANK ON FRANK!" is Hot Pink, uppercase, Extra-Bold
- [ ] Hot Pink usage is limited (10% max)

---

## Brand Utility Classes

```css
.brand-tagline      /* Hot Pink, uppercase, 800 weight */
.brand-stat         /* Gold stat numbers */
.brand-stat-label   /* Gray uppercase labels */
.brand-section-subtitle  /* Hot Pink section labels */
.brand-phone        /* Gold phone number styling */
.brand-disclaimer   /* Legal text styling */
```

---

## Files Reference

- `css/style.css` - Main stylesheet with all brand variables
- `style-guide.html` - Visual reference page (internal use)
- Brand Bible PDF - Full brand guidelines document

---

## Contact

For brand questions, refer to the Brand Bible 2026 document.
