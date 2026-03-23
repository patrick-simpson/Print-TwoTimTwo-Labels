# KVBC Checkin Clubber - Project Documentation

## Overview
The **KVBC Checkin Clubber** is a simulation and utility tool designed to enhance the Awana check-in process at Kern Valley Bible Church (KVBC). Its primary purpose is to provide a **Bookmarklet** that can be used on the official Awana check-in website to print custom 4" x 2" labels for children as they are checked in.

The application serves two roles:
1. **Bookmarklet Generator:** It provides a drag-and-drop button that contains minified JavaScript.
2. **Environment Simulator:** It recreates the DOM structure of the actual check-in page, allowing users to test the bookmarklet's functionality without needing access to the live production database.

---

## How It Works
### The Bookmarklet
The bookmarklet is a piece of JavaScript stored as a URL (`javascript:...`). When clicked on the Awana check-in page, it performs the following steps:
1. **Data Extraction:**
   - It looks for the element with ID `#lastCheckin` to find the name of the most recently checked-in child.
   - It then searches the entire page for a "clubber" box that matches that name.
   - From that box, it extracts the **Club Name** by looking at the `alt` attribute of the club's logo image (e.g., "Sparks", "T&T").
2. **Label Generation:**
   - It creates a hidden `iframe` in the browser.
   - It injects a styled HTML template into this iframe.
   - The template is specifically sized for a **4" x 2" label**.
3. **Printing:**
   - It triggers the browser's print dialog for that iframe and then removes the iframe from the DOM.

### The Simulator
The React application (`App.tsx`) mimics the production site's layout:
- **Grid of Clubbers:** Displays children with color-coded backgrounds (pink for girls, blue for boys).
- **Check-in Logic:** Clicking a child simulates a network request and then updates the `#lastCheckin` DOM element, which is what the bookmarklet targets.
- **DOM Fidelity:** The IDs and class names used in the simulator (`#lastCheckin`, `.club img`, etc.) are identical to those found on the real Awana site to ensure the bookmarklet works in both environments.

---

## Design Decisions

### 1. Label Dimensions
- **Size:** 4 inches wide by 2 inches high.
- **Reasoning:** This is a standard size for thermal label printers (like Dymo or Brother) often used in church check-in stations. The CSS uses `@page { size: 4in 2in; margin: 0; }` to ensure the printer handles the scaling correctly.

### 2. Bookmarklet Architecture
- **No External Dependencies:** The bookmarklet is self-contained. It doesn't load external scripts (like jQuery) to avoid Cross-Origin Resource Sharing (CORS) issues or security blocks on the production site.
- **Alt-Text Extraction:** The club name is extracted from the `alt` attribute of images. This was chosen because the text labels for clubs are often hidden or replaced by icons in the production UI, but the `alt` text remains accessible.

### 3. Simulation Accuracy
- **Mock Data:** The `data.ts` file contains a representative sample of clubbers across different clubs (Puggles, Cubbies, Sparks, T&T) to test various name lengths and club types.
- **Color Coding:** The UI uses specific hex codes (`#FDCCCE` for girls, `#D6DCFF` for boys) to match the visual cues staff are used to seeing.

---

## Starting From Scratch: Key Considerations
If this project were to be rebuilt or ported, keep these technical requirements in mind:

1. **DOM Selectors are Critical:** The bookmarklet relies on `#lastCheckin div` and `.clubber`. If the production site changes its HTML structure, these selectors must be updated in `components/BookmarkletInfo.tsx`.
2. **JavaScript Minification:** The bookmarklet code must be minified and URL-encoded. Specifically, single-line comments (`//`) must be avoided as they will comment out the rest of the bookmarklet when it's compressed into a single line. Use block comments (`/* ... */`) instead.
3. **Iframe Printing:** Using a hidden iframe is the most reliable way to print a specific snippet of HTML without redirecting the user away from the check-in page or printing the entire browser window.
4. **Tailwind Theme:** The simulator uses a custom Tailwind configuration to handle the specific spacing and colors required to mimic the original site.
