# Club Night Tools: family design system (v1.1, 2026-09-28)

This is the shared design system for the three showcase pages:

| Product | Page | `data-accent` | Accent |
| --- | --- | --- | --- |
| Club Label Printer | labels site home (`Print-TwoTimTwo-Labels`, React + Vite) | `labels` | green |
| Check-in Display | `about.html` on `Awana-Check-in-Display` | `checkin` | warm orange |
| Journey Display | `about.html` on `Journey-Display` (static, no build) | `journey` | deep indigo |

- **Canonical CSS:** [`styles/family.css`](../styles/family.css) in this repo. It is self-contained and needs no build step.
- **Copies:** byte-identical at `Awana-Check-in-Display/public/family.css` and `Journey-Display/public/family.css`. Never edit a copy: change the canonical file, copy it over both, and bump the `family.css?v=N` token on both static about pages (the Check-in signage service worker serves CSS cache-first, so a new URL is what gets a changed stylesheet onto a signage device).
- **Live reference:** [`docs/family-reference.html`](family-reference.html). It links `../styles/family.css` and shows every component, in all three accents.

Treat this spec, `family.css` and `family-reference.html` as one unit. When one changes, change the other two with it.

## 0. How it was chosen

The three directions were scored 1 to 10.

| Criterion | Editorial Warmth | Modern Product | Joyful Club Night |
| --- | --- | --- | --- |
| Impresses a pastor or Awana director | **9** | 7 | 7 |
| Warmth and fit for a kids' ministry | 8 | 6 | **9** |
| Modern craft | 8 | **9** | 8 |
| Legibility and hierarchy | **9** | 8 | 8 |
| Mobile quality | **8** | 6 | **8** |
| Dark mode quality | **8** | 7 | 7 |
| Accent system: distinct yet one family | 8 | 7 | **9** |
| Ease in static HTML and React + Tailwind v4 | **9** | 5 | 8 |
| **Total** | **67** | 55 | 64 |

**Winner: Editorial Warmth.** It reads like a well-set church annual report, and leadership is the first reader. The system is hairline-based, with no effects or glows, so it drops into a no-build static page and into Tailwind equally well.

These ideas were grafted from the other two directions:

- **From Joyful:**
  - Family-band cards open with a **solid accent header block**. This is the one place each product wears its colour at full strength, and it made Joyful's family band the clearest of the three.
  - The **pressable primary button**: a solid offset edge (`--accent-deep`) that presses down 2px.
  - A skip link.
  - The "Recreated for illustration" caption line on every mock.
- **From Product:**
  - The optional **mini demo slot** in a capability card (`.fam-card__demo`).
  - The **safeguard list**: a check icon, a bold promise and a plain sentence under it.
  - **Device frames**: a TV with a stand, a phone and a projector wall.
  - Product-specific **screen colours** (`--accent-screen`).
  - The inline "facts" checklist under the hero actions.
- **From both runners-up:** the **chapter index** chip row.
- **Left behind on purpose:**
  - Product's cursor glow, backdrop blur, aurora and sticky nav. They need a current browser, and the sticky nav overlapped content in screenshots.
  - Joyful's wavy dividers and blob stickers. The editorial voice suits leadership better.

## 1. Fonts

Load these in `<head>`, **before** `family.css`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,100,0;1,9..144,300..700,100,1&family=Source+Sans+3:ital,wght@0,400..900;1,400..700&family=IBM+Plex+Mono:wght@400;500&display=swap">
```

| Role | Family | Use |
| --- | --- | --- |
| Display | **Fraunces** (variable: opsz 9–144, wght 300–700) | Headlines, numerals, standfirsts, the footer credit |
| Body | **Source Sans 3** (400–900, italic 400–700) | Everything else, including the label recreation (900 for the name) |
| Mono | **IBM Plex Mono** (400/500) | Only `code` inside "Peek under the hood" |

**URL notes.** This URL was tested against Google on 2026-09-27.

- It pins `SOFT` to 100 and `WONK` to 0 for upright and 1 for italic. This is lighter than the mocks' open-axis request.
- The browser downloads only the latin subset it needs: 6 files, about 228 KB in total (Fraunces is 141 KB of that).
- `--display-axes` and `--display-axes-italic` still set the same values through `font-variation-settings`. That is harmless when the axes are pinned, and it matters if someone later switches to self-hosted open-axis files.

## 2. Tokens

All tokens are defined on `:root`. Dark values are defined twice:

1. under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
2. under `:root[data-theme="dark"]`

`body` always sets `background: var(--paper)`.

### 2.1 Neutrals

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#f8f3ea` | `#1b1611` | Page background |
| `--paper-raised` | `#fffcf6` | `#241e17` | Band, safeguard, chips, link pills |
| `--paper-sunken` | `#f0e7d8` | `#15110d` | Disclaimer bar, footer, hood body, figure stages |
| `--ink` | `#231c15` | `#f2eadd` | Headings, strong text |
| `--ink-2` | `#4f4439` | `#d2c4b1` | Body copy |
| `--ink-3` | `#6b5e50` | `#ab9c89` | Meta, captions, "recreated" line |
| `--rule` | `#e0d4c1` | `#3a3128` | Hairlines |
| `--rule-strong` | `#c4b39b` | `#57493b` | Ghost-button border, dashed route |
| `--shadow` | `40 28 12` | `0 0 0` | RGB triplet: `rgb(var(--shadow) / .3)` |
| `--label-paper` | `#ffffff` | `#f3efe7` | Physical label; dimmed in dark to cut glare |
| `--label-liner` | `#efe9dd` | `#cfc6b6` | The peeled backing sheet |
| `--label-ink` | `#151515` | `#151515` | Labels print black-only |
| `--device` / `--device-edge` | `#2b241d` / `#3d342b` | `#2e2720` / `#54483b` | TV and phone bezels, the TV stand, the phone notch. In dark the bezel is **lighter** than the page, so a device reads as an object rather than a hole in the paper |
| `--device-sheen` | `transparent` | `rgb(255 255 255 / .07)` | 1px top-edge highlight inside TV and phone bezels (dark only) |
| `--screen-rim` | `rgb(0 0 0 / .25)` | `rgb(255 255 255 / .12)` | Hairline round a projected picture, so its edge holds on the dark wall |
| `--screen-bg` / `--screen-ink` / `--screen-dim` | `#17120e` / `#fbf3e8` / `#cdbda9` | same | Powered-on screens look the same in both themes |

### 2.2 Product hues (raw layer)

Components never read these directly. They read the `--accent-*` aliases in §2.3.

| Hue | fill | ink | wash | line | on | deep | glow (fixed) | screen (fixed) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| green, light | `#2d7a4d` | `#22673f` | `#e4eee1` | `#a9c9ae` | `#fff` | `#1b4f31` | `#86d6a0` | `#121a14` |
| green, dark | `#7fcb98` | `#92d6a8` | `#1d2a20` | `#3d6247` | `#0f1a12` | `#3f7a53` | ″ | ″ |
| orange, light | `#a94c16` | `#973f10` | `#f7e5d4` | `#e0b08c` | `#fff` | `#6e300b` | `#f6b27f` | `#1b120c` |
| orange, dark | `#eea068` | `#f3ae7c` | `#2f2016` | `#6f4a30` | `#22140a` | `#9a5f35` | ″ | ″ |
| indigo, light | `#3f3d9c` | `#38368f` | `#e5e4f3` | `#b3b1dc` | `#fff` | `#272566` | `#bdbbf9` | `#15142e` |
| indigo, dark | `#aaa8f0` | `#b8b6f6` | `#21203a` | `#4b4a86` | `#14133a` | `#6563b4` | ″ | ″ |

**Club colours** (`--club-cubbies`, `--club-sparks`, `--club-tnt`, `--club-journey`) have light and dark values. Use them only for club names set as **plain text**, never with art.

### 2.3 Accent aliases (the only colours components read)

| Alias | Meaning |
| --- | --- |
| `--accent` | Solid fill: brand mark, primary button, family-card header, dots, rules |
| `--accent-ink` | Accent-coloured **text** on paper, raised, sunken or wash |
| `--accent-wash` | Tinted panel (spotlight plate, current nav pill, icon discs) |
| `--accent-line` | Hairline on or around a wash |
| `--accent-on` | Text on `--accent` |
| `--accent-deep` | Pressed edge under a filled button |
| `--accent-glow` | Bright accent **inside screen recreations** (fixed in both themes) |
| `--accent-screen` | That product's powered-on screen colour |

`[data-accent="labels|checkin|journey"]` swaps the whole set, on `<html>` (the page's accent) or on any subtree. A family band can therefore show all three accents on one page.

### 2.4 Contrast

Contrast was computed pair by pair from the tokens, then audited on the rendered page by walking every text node (see §7). The page audit returned **0 failures** at 1440 and 390, in both light and dark. The lowest ratio anywhere on the page is **5.00:1**: `--ink-3` on indigo wash, light mode.

| Pair | Light | Dark |
| --- | --- | --- |
| ink / ink-2 / ink-3 on paper | 15.2 / 8.6 / 5.7 | 15.0 / 10.5 / 6.7 |
| ink-3 on sunken | 5.1 | 7.0 |
| accent-ink on paper (green / orange / indigo) | 6.2 / 6.3 / 9.1 | 10.6 / 9.5 / 9.5 |
| accent-ink on its wash | 5.7 / 5.6 / 8.0 | 8.8 / 8.3 / 8.3 |
| ink-3 on each wash | 5.3 / 5.1 / 5.0 | 5.6 / 5.9 / 5.9 |
| accent-on on accent fill | 5.3 / 5.6 / 8.9 | 9.3 / 8.4 / 8.1 |
| screen-ink / screen-dim / glow on any screen colour | ≥16.1 / ≥9.7 / ≥9.8 | same |
| label-ink on label-paper | 18.3 | 15.9 |

**Rules:**

- **Never put accent text in `--accent`.** Use `--accent-ink`.
- The light orange **fill** was darkened from the mock's `#b3521a` to `#a94c16` so that white text on the family-card header clears 5.6:1.
- `--ink-3` was nudged from `#6e6153` to `#6b5e50` so it holds at least 5:1 on every wash.

### 2.5 Type scale

Fluid, 320 to 1440px.

| Token | Range | Use |
| --- | --- | --- |
| `--step--1` | 14–15px | Captions, meta, stat labels, fine print (never smaller for real text) |
| `--step-0` | 17–19px | Body |
| `--step-1` | 20–24px | Card titles, hero lede, band lede |
| `--step-2` | 24–34px | Standfirst, product name, footer credit |
| `--step-3` | 30–48px | Chapter and spotlight titles |
| `--step-4` | 38–68px | Band title, stat numerals |
| `--step-5` | 42–88px | Hero H1 |

Headings are Fraunces at weight 560, line-height 1.08, letter-spacing −0.015em, with `text-wrap: balance`. The chapter numeral is Fraunces italic at weight 300, `clamp(72px, …, 152px)` (80px on phones). Body text is 1.6 line-height, with a `--measure` of 62ch.

**Italic rule.** One italic phrase per headline, and only on the emotional half: "Every child, *greeted by name.*" It takes `--accent-ink` in the hero and inherits ink elsewhere.

### 2.6 Space, radii, elevation, motion

- **Space:** `--space-1…8` = 4, 8, 12, 16, 24, 32, 48, 64px.
  - `--space-section` = `clamp(72px, …, 144px)` between chapters.
  - `--gutter` = `clamp(16px, 4vw, 48px)`. It is exactly 16px at phone width.
  - `--wrap` = 1180px.
- **Radii:** `--radius-s` 6, `--radius-m` 12, `--radius-l` 20, `--radius-pill` 999.
- **Elevation:** hairlines do most of the separating. Shadows are reserved for **objects** (labels, devices, family cards):
  - `--shadow-1`: cards
  - `--shadow-2`: the label liner
  - `--shadow-3`: devices
- **Motion:** the only motion in the system is:
  - the hood chevron rotating (`--dur` 200ms)
  - the button press (`--dur-fast` 120ms, translateY 2px)
  - hover colour fades
  - smooth scroll

  All of it is off under `prefers-reduced-motion`. There are no scroll-triggered animations and no infinite loops, so there is nothing that could fight the Journey Pi or `?lowPower=1`.
- **Focus:** `:focus-visible` gets a 3px outline in `--accent-ink`, offset 3px.
- **Tap targets: 44px.** Every interactive family component is at least 44px tall at phone width: `.fam-btn`, `.fam-links__item`, `.fam-nav__link`, `.fam-chapters a`, `.fam-hood > summary`, `.fam-product__link` and `.fam-footer__list a`. Where 44px would loosen the desktop rhythm, the target grows without the layout growing:
  - The hood summary is a 44px flex row with negative block margins, so it takes exactly the old one-line row (1.6 × `--step-0`) and the card heights do not change.
  - Footer links get 44px rows only below 720px or on a coarse pointer. On a desktop with a mouse the list keeps its tighter pitch, because 44px targets would need a 44px pitch and overlapping targets are worse than small ones.
  - Page-level controls (a sub-nav, a copy button) should meet the same floor: `min-height: 44px; display: inline-flex; align-items: center`.

## 3. Page contract

- `<html lang="en" data-accent="…">`
- `<body class="fam-page">`. Base element rules are scoped under `:where(.fam-page)` with zero specificity, so every component class wins without `!important`.
- The first element in `<body>` is `<a class="fam-skip" href="#main">`.
- `<title>` is a short name.
- `<meta name="description">` **must contain** "Not affiliated with or endorsed by Awana® Clubs International."
- Every class is prefixed `fam-` (BEM-ish: `fam-block__element--modifier`), so the system can live beside `app.css` or an existing site's CSS without collisions.

## 4. Components

These snippets are the exact markup. `family-reference.html` shows each one live. Icons come from an inline `<svg><symbol>` sprite of plain monochrome glyphs (see `family-reference.html`). No third-party icon art, and no Awana marks.

### 4.1 Disclaimer bar + family nav (`.fam-disclaimer`, `.fam-nav`)

The disclaimer is the first use of "Awana" on the page, so it carries the ®.

```html
<header class="fam-header">
  <p class="fam-disclaimer" role="note">
    <strong>Not affiliated with or endorsed by Awana<sup>®</sup> Clubs International.</strong>
    <span class="fam-disclaimer__aside">Independent tools made by a local church for its own club nights.</span>
  </p>
  <nav class="fam-nav" aria-label="Club night tools">
    <div class="fam-wrap fam-nav__inner">
      <a class="fam-brand" href="{this page}">
        <span class="fam-brand__mark"><svg aria-hidden="true"><use href="#i-tag"/></svg></span>
        <span><span class="fam-brand__name">Club Label Printer</span><span class="fam-brand__sub">One of three club-night tools</span></span>
      </a>
      <ul class="fam-nav__list">
        <li><a class="fam-nav__link" data-accent="labels"  href="https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/" aria-current="page"><span class="fam-swatch" aria-hidden="true"></span><span class="fam-nav__long">Club Label Printer</span><span class="fam-nav__short" aria-hidden="true">Labels</span></a></li>
        <li><a class="fam-nav__link" data-accent="checkin" href="https://patrick-simpson.github.io/Awana-Check-in-Display/about.html"><span class="fam-swatch" aria-hidden="true"></span><span class="fam-nav__long">Check-in Display</span><span class="fam-nav__short" aria-hidden="true">Check-in</span></a></li>
        <li><a class="fam-nav__link" data-accent="journey" href="https://patrick-simpson.github.io/Journey-Display/about.html"><span class="fam-swatch" aria-hidden="true"></span><span class="fam-nav__long">Journey Display</span><span class="fam-nav__short" aria-hidden="true">Journey</span></a></li>
      </ul>
    </div>
  </nav>
</header>
```

- Set `aria-current="page"` on the current product's link. It gets the wash pill.
- Nav links are 44px tall at every width. On desktop the row is set by the 45px brand, so this costs nothing.
- Below 720px:
  - The aside hides, but the disclaimer's bold sentence **never** hides.
  - The nav becomes a 3-column grid.
  - The short labels show, and the long labels become visually hidden but stay the accessible name.
- **Link rule.** The Check-in and Journey links, and both about pages' `.fam-brand` hrefs, must point at **`about.html`**. They must never point at the site root: the root of each of those sites is the live signage or the live kiosk (brief rule 11). Never link to `countdown.html`.

### 4.2 Hero (`.fam-hero`)

```html
<section class="fam-hero" aria-labelledby="hero-title">
  <div class="fam-wrap fam-hero__inner">
    <div>
      <p class="fam-kicker">For the check-in table</p>
      <h1 class="fam-hero__title" id="hero-title">Every child, <em>greeted by&nbsp;name.</em></h1>
      <p class="fam-hero__lede">…one or two sentences…</p>
      <div class="fam-actions">
        <a class="fam-btn" href="#install">Install in five minutes</a>
        <a class="fam-btn fam-btn--ghost" href="#simulator">Try the simulator</a>
      </div>
      <ul class="fam-hero__facts">
        <li><svg aria-hidden="true"><use href="#i-check"/></svg>Free for any church</li>
        …
      </ul>
    </div>
    <figure class="fam-frame fam-frame--label">…see 4.10…</figure>
  </div>
</section>
```

- The layout is two columns, and becomes one column below 960px.
- On phones, `.fam-actions .fam-btn` go full-width.
- On the about pages the actions are **link-outs only**: source repos and sibling pages.

### 4.3 Stats strip (`.fam-stats`)

```html
<section class="fam-stats" aria-label="At a glance">
  <div class="fam-wrap">
    <ul class="fam-stats__list">
      <li class="fam-stat"><div class="fam-stat__num">0<span class="fam-stat__unit">clicks</span></div><p class="fam-stat__label">per label. Check a child in and the printer takes it from there.</p></li>
      … exactly four …
    </ul>
  </div>
</section>
```

- Four columns divided by hairlines, becoming 2×2 on phones.
- Keep units at 10 characters or fewer ("passphrase" is the longest that fits a quarter column).
- **Facts only, no invented stats.** Use real counts: 0 clicks, 4×2 inches at 300 dpi, 1 passphrase, 3 tools.

### 4.4 Chapter index + chapter header (`.fam-chapters`, `.fam-chapter`)

```html
<nav aria-label="Chapters">
  <ol class="fam-chapters">
    <li><a href="#ch1"><b>01</b>Runs the whole room</a></li> …
  </ol>
</nav>

<section class="fam-chapter" id="ch1" aria-labelledby="ch1-title">
  <div class="fam-wrap">
    <div class="fam-chapter__head">
      <div>
        <div class="fam-chapter__num" aria-hidden="true">01</div>
        <p class="fam-kicker">Chapter one</p>
        <h2 class="fam-chapter__title" id="ch1-title">Runs the whole room</h2>
      </div>
      <div>
        <p class="fam-standfirst">One italic sentence: the warm "why".</p>
        <p class="fam-chapter__intro">Two or three plain sentences: the "what".</p>
      </div>
    </div>
    <ul class="fam-cards">…4.5…</ul>
    <div class="fam-also">…4.6…</div>
  </div>
</section>
```

The chapter head is a 4/8 column split, and stacks on phones.

The chapter chips are 44px tall. They are a one-row inline grid rather than inline-flex, so the italic numeral and the title keep one baseline while the row centres in the 44px height.

### 4.5 Capability card with "Peek under the hood" (`.fam-cards`, `.fam-card`, `.fam-hood`)

```html
<ul class="fam-cards">            <!-- 3 columns; add fam-cards--2 for 2 -->
  <li class="fam-card">
    <span class="fam-card__icon"><svg aria-hidden="true"><use href="#i-screens"/></svg></span>
    <h3 class="fam-card__title">Lobby slides, published once</h3>
    <p class="fam-card__body">Plain church language, one or two sentences.</p>
    <div class="fam-card__demo" aria-hidden="true">optional mini recreation</div>
    <span class="fam-card__tag">Off by default</span>   <!-- optional; use it for opt-in features -->
    <details class="fam-hood">
      <summary><svg class="fam-hood__chev" aria-hidden="true"><use href="#i-chev"/></svg>Peek under the hood</summary>
      <div class="fam-hood__body">The curious-reader detail. <code>AES-256-GCM</code> is fine here.</div>
    </details>
  </li>
</ul>
```

- **Hairline grid.** Each card draws its own left and bottom rules with `box-shadow`, and the grid clips its outer edges. This works for any card count and any column count, with no `nth-child` rules.
  - The grid bleeds `--pad-x` into the gutter, so the first column's text lines up with the page.
  - The bleed is set to 0 below 720px, so there is no horizontal overflow.
- Column counts: 3 on desktop, 2 below 960px, 1 below 720px. `--cols` is a custom property, so a container can override it.
- **`.fam-card__tag`:** use it for every opt-in feature ("Off by default", "Opt-in"). The brief requires that off-by-default features are never implied to be on.
- **Hoods are closed by default.** One open hood made its whole row taller in the editorial mock.
- **Hoods are meant for cards.** `.fam-hood` has `margin-top: auto`, which pins it to the bottom of a flex-column card (`.fam-card`, `.fam-product__body`). Outside a card it still works, but the auto margin does nothing there; give it its own spacing if the context needs more than its `padding-top`.
- The summary is a 44px tap target that takes no more room than one line of body text (see §2.6), so a row of cards is exactly as tall as it was before the target grew.

### 4.6 "Smaller things worth knowing" (`.fam-also`)

```html
<div class="fam-also">
  <h3 class="fam-also__title">Smaller things worth knowing</h3>
  <ul class="fam-also__list"><li><b>Visiting families</b> in one short form at the door</li> …</ul>
</div>
```

The list runs in two columns, and becomes one column on phones. It is where "every other ability still appears, smaller".

### 4.7 Safeguard callout (`.fam-safeguard`)

This is **required** wherever the checkout board or the phone's "not here yet" list is mentioned.

```html
<aside class="fam-safeguard" aria-labelledby="sg-title">
  <div class="fam-safeguard__head"><svg aria-hidden="true"><use href="#i-shield"/></svg><h3 class="fam-safeguard__title" id="sg-title">How the pick-up board is kept safe</h3></div>
  <ul class="fam-safeguard__list">
    <li><span class="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check"/></svg></span><div><b>Off until a church turns it on</b><span>It takes a deliberate choice.</span></div></li>
    <li>…<b>Stops naming anyone when only a few are left</b>…</li>
    <li>…<b>First names only, always</b>…</li>
    <li>…<b>"Not checked out yet," never "still in the building"</b>…</li>
  </ul>
</aside>
```

- The callout is neutral raised paper with a 4px accent rule on the left.
- The list uses auto-fit columns with a minimum of 22rem: 2×2 on desktop, 1 column on phones.
- Keep the four promises in this order, and word them exactly as true of `decideBoard()`.
  - Below the threshold the board **names no one**.
  - Do not claim it then shows a count unless the code does.

### 4.8 Family band (`.fam-band`, `.fam-route`, `.fam-product`)

```html
<section class="fam-band" aria-labelledby="band-title">
  <div class="fam-wrap">
    <div class="fam-band__head">
      <p class="fam-kicker">A family of three</p>
      <h2 class="fam-band__title" id="band-title">The whole <em>club night</em></h2>
      <p class="fam-band__lede">…</p>
    </div>
    <ol class="fam-route">
      <li class="fam-route__stop" data-accent="labels"><span class="fam-route__pin" aria-hidden="true"></span><div class="fam-route__step">Checked in</div><div class="fam-route__when">on TwoTimTwo.com</div></li>
      … labels · labels · checkin · journey …
    </ol>
    <ul class="fam-products">
      <li class="fam-product" data-accent="labels">
        <div class="fam-product__head">
          <div class="fam-product__meta"><span>At the door</span><span class="fam-product__here">You are here</span></div>
          <h3 class="fam-product__name">Club Label Printer</h3>
        </div>
        <div class="fam-product__body">
          <p>…</p>
          <ul class="fam-product__points"><li>…</li><li>…</li></ul>
          <a class="fam-product__link" href="…"><span>About Check-in Display</span><svg aria-hidden="true"><use href="#i-arrow"/></svg></a>
          <!-- or, on the current product: <p class="fam-product__note">You are reading this one.</p> -->
        </div>
      </li>
      … checkin, journey …
    </ul>
  </div>
</section>
```

- Put the band on **all three pages**, with `.fam-product__here` on the current product.
- **"You are here" never moves the card.** Every `.fam-product__meta` row reserves 1.5rem and the pill is set at `line-height: 1.2`, so the current product's header is exactly as tall as its siblings' and the three names and bodies start on one line.
- **Band as the last section.** When the band is the last child of `<main>` and `.fam-footer` follows `<main>` (the natural layout for the about pages), `family.css` cancels the footer's section margin and overlaps the two hairlines, so the footer joins the band with one rule and no strip of page paper. It needs no `:has()` and no page CSS; delete any page-level workaround. It relies on `<main>` having no bottom padding or border of its own.
- The route becomes a vertical dashed timeline on phones.
- The product cards stack below 960px, with a maximum width of 40rem.

### 4.9 Accent spotlight panel (`.fam-spot`)

```html
<section class="fam-spot" data-accent="checkin" aria-labelledby="spot-checkin">   <!-- add fam-spot--flip to put the figure first -->
  <div class="fam-wrap">
    <div class="fam-spot__plate">
      <div class="fam-spot__copy">
        <p class="fam-kicker">Check-in Display</p>
        <h2 class="fam-spot__title" id="spot-checkin">The lobby says hello back.</h2>
        <p class="fam-standfirst">…</p>
        <p class="fam-spot__text">…</p>
        <ul class="fam-pills"><li class="fam-pill">First names only</li> …</ul>
      </div>
      <figure class="fam-frame fam-frame--tv">…</figure>
    </div>
    <aside class="fam-safeguard">…optional…</aside>
  </div>
</section>
```

Use the spotlight for a sibling product on the labels page, or for a headline feature on an about page.

### 4.10 Screen-mock frames (`.fam-frame`)

These are hand-built recreations only: no screenshots, no lesson frames or slide images, and no logos. Every frame must have a `role="img"` screen with a full `aria-label`, and a caption that ends in the "recreated" line.

```html
<figure class="fam-frame fam-frame--tv">          <!-- --tv | --projector | --phone | --label -->
  <div class="fam-frame__stage">
    <!-- --label only: <div class="fam-frame__liner"> wraps the screen -->
    <div class="fam-frame__screen" role="img" aria-label="Recreation of …">
      …content…
    </div>
  </div>
  <figcaption class="fam-frame__caption"><b>Fig. 2</b> One sentence.<span class="fam-frame__recreated">Recreated for illustration.</span></figcaption>
</figure>
```

| Variant | Frame | Screen |
| --- | --- | --- |
| `--tv` | Bezel, a stand under it, `--shadow-3` | 16:9, `--accent-screen` |
| `--projector` | A sunken "wall" panel, a lens tick, and light falloff in `--accent-glow` | 16:9, 3px corners |
| `--phone` | Bezel, notch; maximum width 280px | 9:16 |
| `--label` | Sunken stage; the liner is rotated −1.4° | 2:1, `--label-paper`, `--label-ink` |

**Dark mode.** Screens keep their powered-on colours, and the TV and phone bezels turn a shade *lighter* than the walnut paper, with a `--device-edge` hairline and a `--device-sheen` top highlight, because a near-black bezel on near-black paper made each screen a floating rectangle. The projected picture gets a light `--screen-rim` so its edge holds against the sunken wall.

**Label paper outside a `--label` frame (`.fam-label-paper`).** When one figure shows several labels (a strip, a before/after), the `--label` variant's single stage does not fit. `.fam-label-paper` is the same 2:1 label paper on its own: `--label-paper` background, `--label-ink` text, 10px corners, and an inline-size container so `.fam-label` inside it scales in `cqi`. Put it in a `.fam-frame__liner` for the peeled-backing look, or add it to a `.fam-frame__screen` (it wins over the screen's 16:9 and screen colour). Lay the labels out with page CSS.

```html
<figure class="fam-frame">
  <div class="my-strip">                     <!-- page CSS: a grid of labels -->
    <div class="fam-frame__liner">           <!-- optional backing sheet -->
      <div class="fam-label-paper" role="img" aria-label="Recreation of a check-in label: …">
        <div class="fam-label">…</div>
      </div>
    </div>
    …
  </div>
  <figcaption class="fam-frame__caption"><b>Fig. 5</b> …<span class="fam-frame__recreated">Recreated for illustration. Names are examples.</span></figcaption>
</figure>
```

**Screen content primitives.** The screen is an inline-size container, so everything is sized in `cqi` and scales with the frame. Small text has a pixel floor so it stays legible at 390px.

- `.fam-scr` (bottom-left block), `.fam-scr--center`, `.fam-scr--list`
- `.fam-scr__glow`: accent radial wash (uses `color-mix`; degrades to no glow)
- `.fam-scr__kicker`, `.fam-scr__big` (Fraunces italic), `.fam-scr__small`
- `.fam-scr__chip` with `<b>` (a corner counter)
- `.fam-scr__btns` > `.fam-scr__btn` / `.fam-scr__btn--ghost`
- `.fam-scr__bar` (a ribbon along the bottom edge)
- `.fam-scr__title`, `.fam-scr__row` > `span` + `small` (phone list rows)

**Label recreation.** The left panel shows a **monogram**, which is the renderer's own fallback when there is no club art, so no club art is used.

```html
<div class="fam-label">
  <div class="fam-label__club"><span class="fam-label__mono">S</span></div>
  <div class="fam-label__main">
    <div class="fam-label__top"><div class="fam-label__name">Micah</div><div class="fam-label__clubname">Sparks</div></div>
    <div class="fam-label__icons">
      <span class="fam-label__icon"><svg aria-hidden="true"><use href="#i-peanut"/></svg>NUT</span>
      <span class="fam-label__icon"><svg aria-hidden="true"><use href="#i-cake"/></svg>7</span>
      <span class="fam-label__icon"><svg aria-hidden="true"><use href="#i-nocam"/></svg></span>
    </div>
  </div>
</div>
```

**Content rules for mocks:**

- First names only, and generic ones: Micah, Ava, Leo, Noah, Grace.
- Club names only as plain text, in club colours.
- No date line unless it is checked against `generateLabel()`. The mocks' "Wed · Sep 30" is unverified.
- Numbers on screens (for example the "24" on the Tonight chip) are illustrative. Never repeat one in body copy as a statistic.

### 4.11 CTA / link row (`.fam-links`)

```html
<ul class="fam-links" aria-label="More from the family">
  <li data-accent="checkin"><a class="fam-links__item" href="…/about.html"><span class="fam-swatch" aria-hidden="true"></span><span class="fam-links__label">About Check-in Display</span><svg aria-hidden="true"><use href="#i-arrow"/></svg></a></li>
  <li><a class="fam-links__item" href="https://github.com/patrick-simpson/…"><svg aria-hidden="true"><use href="#i-code"/></svg><span class="fam-links__label">Source on GitHub</span></a></li>
</ul>
```

- This is the only "call to action" on the about pages (brief rule 2: no ask).
- The source icon is a generic `</>` glyph, not the GitHub logo.

### 4.12 Footer (`.fam-footer`)

```html
<footer class="fam-footer">
  <div class="fam-wrap">
    <div class="fam-footer__grid">
      <p class="fam-footer__credit">Built by and for <em>Kennebec Valley Baptist Church</em>, so every child is welcomed by name.</p>
      <div><h2 class="fam-footer__heading">The family</h2><ul class="fam-footer__list"><li data-accent="labels"><a href="…"><span class="fam-swatch" aria-hidden="true"></span>Club Label Printer</a></li> …</ul></div>
      <div><h2 class="fam-footer__heading">Source</h2><ul class="fam-footer__list"><li><a href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels">Club Label Printer on GitHub</a></li> …</ul></div>
    </div>
    <div class="fam-footer__legal">
      <p><strong>NOT AFFILIATED WITH OR ENDORSED BY AWANA CLUBS INTERNATIONAL.</strong></p>
      <p>Awana® and the names of its clubs and curricula are trademarks of Awana Clubs International, used here only to describe what these tools work alongside. Club Label Printer, Check-in Display and Journey Display are independent projects made by volunteers at Kennebec Valley Baptist Church; they are not sponsored, reviewed or approved by Awana Clubs International. No Awana logos or artwork appear on this page. TwoTimTwo is a separate service, named here only to describe compatibility.</p>
      <p>Screens and labels on this page are hand-drawn recreations. Children’s names are examples.</p>
    </div>
  </div>
</footer>
```

- The only links out are the three family pages and the three source repos.
- Footer links become 44px rows below 720px and on coarse pointers (see §2.6).
- The Journey footer's legal paragraph should add a licensing line: the kiosk plays the church's licensed curriculum on its own screens only. It must not link to or name any video, transcript, handout or slide file.

## 5. Implementing on each page

### 5.1 Journey Display (static, no build step)

- Copy `family.css` to `public/family.css`. Add `public/about.html` with a `<link rel="stylesheet" href="family.css">`.
- Nothing else is needed. The about page is separate from the kiosk's `index.html`, and it must not load `schedule.js` or `style.css`.
- **Deploy stamping.** The `stamp-build.mjs` deploy step stamps `index.html` only, so leave `about.html` alone.

### 5.2 Check-in Display (React + Vite, but the signage CSS graph must never see Tailwind)

- Add `about.html` as a **third, independent HTML entry**: a plain static page that links `family.css`. Place both files in `public/`, or add them as a Vite input with no React.
- It must not import `app.css`, must not use Tailwind (Tailwind is pinned to `src/presentation/`), and must not load the signage bundle or any service-worker registration code. It should still be precached or passed through by `src/sw.js`, like any other HTML: network-first.
- The `serviceWorker()` plugin stamps `<meta name="awana-build">` into its two entries, and `about.html` needs no build stamp.

### 5.3 Club Label Printer (React + Vite SPA + Tailwind v4): React + Tailwind v4 mapping

Import the family CSS as the **components layer**, so Tailwind utilities can still override it:

```css
/* src/index.css */
@import "tailwindcss";
@import "./family.css" layer(components);

/* Expose the family tokens as Tailwind theme values. `inline` makes each
   utility emit var(--accent) itself, so [data-accent] swaps keep working. */
@theme inline {
  --color-paper: var(--paper);
  --color-paper-raised: var(--paper-raised);
  --color-paper-sunken: var(--paper-sunken);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-rule: var(--rule);
  --color-rule-strong: var(--rule-strong);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-accent-wash: var(--accent-wash);
  --color-accent-line: var(--accent-line);
  --color-accent-on: var(--accent-on);
  --color-accent-deep: var(--accent-deep);
  --color-label-paper: var(--label-paper);
  --color-label-ink: var(--label-ink);

  /* never reuse a family token's own name on the Tailwind side: Tailwind
     also writes these to :root, and --x: var(--x) is a cycle */
  --font-serif: var(--font-display);   /* font-serif  */
  --font-sans:  var(--font-body);      /* font-sans (Tailwind's default body) */
  --font-code:  var(--font-mono);      /* font-code   */

  --text-step--1: var(--step--1);
  --text-step-0: var(--step-0);
  --text-step-1: var(--step-1);
  --text-step-2: var(--step-2);
  --text-step-3: var(--step-3);
  --text-step-4: var(--step-4);
  --text-step-5: var(--step-5);

  --radius-chip:  var(--radius-s);     /* rounded-chip  */
  --radius-card:  var(--radius-m);     /* rounded-card  */
  --radius-panel: var(--radius-l);     /* rounded-panel */
  --shadow-card:   var(--shadow-1);    /* shadow-card   */
  --shadow-liner:  var(--shadow-2);
  --shadow-device: var(--shadow-3);
}
/* dark mode is token-driven, so dark: variants are rarely needed; if used,
   bind them to the same switch:
   @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *)); */
```

**Notes on the mapping:**

- The Tailwind-side names (`--font-serif`, `--radius-card`, `--shadow-card` and so on) deliberately differ from the family token names. Tailwind v4 emits theme variables onto `:root`, and a same-name mapping (`--font-mono: var(--font-mono)`) would be a cycle, which invalidates the variable. The `--color-*` and `--text-step-*` names never collide.
- Set `<html data-accent="labels">` in `index.html` and in `capabilities.html`.
- Put `class="fam-page"` on `<body>`, or on the React root's outer element and the body background. Tailwind's preflight is compatible: `family.css` sets everything it needs itself.
- Existing anchors `#install` and `#simulator` must keep their ids on the sections that still hold the Install Guide and the Simulator.
- **Opacity modifiers compile to `oklab()` / `color-mix()`.** Tailwind v4 emits `bg-white/60`, `text-ink/70` and friends as `color-mix(in oklab, …)`, which the browser reports back as `oklab(…)` or `color(srgb …)`. a contrast audit that parses only `rgb()`/`rgba()` misjudges them (false failures near 2:1). Where the audit has to judge a translucent colour, use an explicit arbitrary value such as `bg-[rgba(255,255,255,.6)]`, or a solid family token.

**Use the family classes directly** (as `className`), not re-expressed as utilities: `fam-disclaimer`, `fam-nav*`, `fam-hero*`, `fam-stats*`, `fam-chapters`, `fam-chapter*`, `fam-standfirst`, `fam-cards` / `fam-card*` / `fam-hood*`, `fam-also*`, `fam-safeguard*`, `fam-band` / `fam-route*` / `fam-product*`, `fam-spot*`, `fam-frame*` / `fam-scr*` / `fam-label*`, `fam-links*`, `fam-footer*`, `fam-btn*`, `fam-kicker`, `fam-pill(s)`.

These are the components the three pages share, and a utility re-implementation in the React site would drift from the two static pages. The good pattern is a thin JSX wrapper per component, such as `<CapabilityCard icon title hood>`, that emits exactly the markup in §4.

**Use Tailwind utilities only for:**

- layout glue inside a section (grid, gap, margins between family components)
- the existing Simulator, Install Guide and FAQ internals (restyle them with the token utilities: `bg-paper-raised`, `text-ink-2`, `border-rule`, `text-accent-ink`, `font-serif`, `rounded-card`)
- one-off page details

## 6. Checklist for every page

- [ ] The disclaimer bar is at the top, and the meta description carries the same sentence with "Awana®". ® appears on the first use of "Awana" in body text.
- [ ] The full legal paragraph is in the footer. Kennebec Valley Baptist Church is credited (no town, no person's name).
- [ ] `data-accent` is on `<html>`, `aria-current` is on its nav link, and "You are here" is on its family card.
- [ ] No link points to the Check-in Display root, `countdown.html` or the Journey root. Sibling links point to `about.html`, and source links point to GitHub.
- [ ] Every mock is a CSS recreation with an `aria-label` and "Recreated for illustration." It uses generic first names only, and no logos, club art, lesson frames or slides.
- [ ] Every sensitive feature sits beside a `.fam-safeguard`, and every opt-in feature has a `.fam-card__tag`.
- [ ] Every claim is re-checked against current code. The removed features (sibling check-in, the dashed seasonal border) are not mentioned.
- [ ] There is no horizontal overflow at 390 and 1440, in light or dark. The contrast audit (§7) reports 0 failures.

## 7. Checking a page

The pages were built and reviewed by screenshotting each one at 1440px and 390px wide, in light and dark, and reading the shots, plus a contrast audit that walks every rendered text node and composites its background (AA: 4.5:1, or 3:1 for large text). Do the same after any change: no horizontal overflow at 390, no console errors, every mock legible (no reader-facing mock text under 9px at 390 or 11px at 1440), and the checklist in §6.

## 8. Changes

**v1.1 (2026-09-28)**, from the round-1 page reviews. Pages need no workaround for any of these; remove the ones they added.

- The nav wash pill paints for `aria-current="page"` and `aria-current="true"` alike, so a sub-page of a product (for example the labels site's TwoTimTwo reference) can mark its product as current without claiming to be that page. Link it as `family.css?v=3` on the static pages.
- Tap targets: 44px on nav links, chapter chips, hood summaries, and (phones and touch) footer links; a 44px floor on `.fam-btn` and `.fam-links__item`. Desktop rhythm unchanged: card heights are identical, and the only growth on desktop is the chapter chips (+3px).
- Dark mode: lighter TV and phone bezels (`--device #2e2720`, `--device-edge #54483b`), a `--device-sheen` top highlight, and a `--screen-rim` round projected pictures. Light mode is unchanged.
- "You are here" no longer makes one family card's header taller than its siblings.
- A band that is the last section of `<main>` joins the footer cleanly, with no `:has()`.
- New `.fam-label-paper` (§4.10).
- Spec notes: hoods are for cards (§4.5); Tailwind opacity modifiers and the contrast audit (§5.3).
