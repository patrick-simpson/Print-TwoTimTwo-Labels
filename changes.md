# Kids Club Checkin - Project Documentation

## Overview
The **Kids Club Checkin** is a tool designed to enhance the Kids Club check-in process at Community Church. Its primary purpose is to automatically print custom 4" x 2" labels for children as they are checked in via the TwoTimTwo.com platform.

The application serves two roles:
1. **Print Server + Bookmarklet:** A local Node.js server (port 3456) paired with a bookmarklet injected into the TwoTimTwo check-in page. The bookmarklet watches for check-in events, generates a PDF label, and sends it to the server for silent printing.
2. **Environment Simulator:** A React app (deployed to GitHub Pages) that recreates the DOM structure of the actual check-in page, allowing users to test the bookmarklet and server without needing access to the live production database.

---

## How It Works

### The Bookmarklet
The bookmarklet is injected into the TwoTimTwo check-in page from the user's browser bookmark bar:
1. **Printer Arming:** Clicking the bookmarklet button arms the auto-print listener.
2. **Data Extraction (Auto-Print Trigger):**
   - Uses a `MutationObserver` to watch for changes to the `#lastCheckin` element.
   - When a new check-in appears, it extracts the child's name and club from the page.
3. **Label Generation & Printing:**
   - Sends the check-in data to the local print server at `http://localhost:3456/print`.
   - The server generates a PDF and sends it directly to the configured Windows printer.

### The Print Server
A Node.js/Express server (started via `install-and-run.ps1` or the Electron app) that:
- Listens on port 3456
- Generates 4" × 2" PDF labels
- Sends them to the Windows printer via `pdf-to-printer`

### The Simulator
The React application (`App.tsx`) mimics the production site's layout:
- **Grid of Clubbers:** Displays children with color-coded backgrounds.
- **Check-in Logic:** Clicking a child simulates a network request and updates the `#lastCheckin` DOM element, triggering the bookmarklet if armed.
- **DOM Fidelity:** The IDs and class names used in the simulator (`#lastCheckin`, `.club img`, etc.) are identical to those found on the real Kids Club site.

---

## Design Decisions

### 1. Bookmarklet + Local Server Approach
- **Why:** Provides silent, automatic printing without requiring users to install a browser extension or manage extension permissions. The PowerShell installer handles all setup automatically.
- **Benefit:** Works in any Chromium-based browser. Users only need to drag a button to their bookmarks bar.

### 2. Label Dimensions & Styling
- **Size:** 4 inches wide by 2 inches high (288×144 points in jsPDF/pdfkit).
- **Styling:** The child's name is printed large and bold; club name is printed below. Long text is wrapped to fit within the 4-inch width.

---

## Starting From Scratch: Key Considerations
If this project were to be rebuilt or ported, keep these technical requirements in mind:

1. **DOM Selectors are Critical:** The bookmarklet relies on `#lastCheckin div` and `.clubber`. If the production site changes its HTML structure, these selectors must be updated in the bookmarklet source (`public/bookmarklet.html`).
2. **Port 3456:** The bookmarklet, simulator, and PowerShell script all assume the print server runs on port 3456. This is defined in `src/constants.ts` (`SERVER_PORT`).
3. **Windows-only Printing:** `pdf-to-printer` (used by both the standalone server and the Electron embedded server) is a Windows-only package.
