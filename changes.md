# Kids Club Checkin - Project Documentation

## Overview
The **Kids Club Checkin** is a tool designed to enhance the Kids Club check-in process at Community Church. Its primary purpose is to provide a **Chrome Extension** that can be used on the official Kids Club check-in website to automatically print custom 4" x 2" labels for children as they are checked in.

The application serves two roles:
1. **Chrome Extension:** Automatically prints labels to a selected printer upon check-in.
2. **Environment Simulator:** It recreates the DOM structure of the actual check-in page, allowing users to test the extension's functionality without needing access to the live production database.

---

## How It Works
### The Chrome Extension
The Chrome extension replaces the previous bookmarklet and local print server approach. It operates directly on the Kids Club check-in page:
1. **Printer Selection UI:**
   - Injects a dropdown menu into the top right corner of the page, allowing the user to select their local printer.
   - Saves the selected printer to `chrome.storage.sync`.
2. **Data Extraction (Auto-Print Trigger):**
   - Uses a `MutationObserver` to watch for changes to the `#lastCheckin` element.
   - When a new check-in appears, it extracts the child's name.
   - It then searches the page for the corresponding "clubber" box to extract the **Club Name** from the `alt` attribute of the club's logo image.
3. **Label Generation:**
   - Uses the `jsPDF` library to generate a PDF document formatted exactly for a 4" x 2" label.
   - Enhances styling with a large, bold font for the name and text wrapping for longer club names.
4. **Silent Printing:**
   - Converts the generated PDF to a base64 data URI.
   - Sends the data to the extension's background service worker.
   - The background worker uses the `chrome.printing` API to send the PDF directly to the selected printer without showing a print dialog.

### The Simulator
The React application (`App.tsx`) mimics the production site's layout:
- **Grid of Clubbers:** Displays children with color-coded backgrounds.
- **Check-in Logic:** Clicking a child simulates a network request and updates the `#lastCheckin` DOM element, triggering the Chrome extension.
- **DOM Fidelity:** The IDs and class names used in the simulator (`#lastCheckin`, `.club img`, etc.) are identical to those found on the real Kids Club site.

---

## Design Decisions

### 1. Shift to Chrome Extension
- **Why:** The initial approach used a bookmarklet and a local Node.js print server. This was complex to set up for end-users. A Chrome extension provides a seamless, all-in-one solution that integrates directly into the browser and can access local printers via the `chrome.printing` API.
- **Benefit:** Eliminates the need for a local server, making deployment and usage much easier.

### 2. Label Dimensions & Styling
- **Size:** 4 inches wide by 2 inches high (288x144 points in jsPDF).
- **Styling:** The user requested enhanced styling. The name is printed very large (36pt bold), and the club name is printed below it (24pt). If the club name is too long, `jsPDF`'s `splitTextToSize` is used to wrap the text onto multiple lines, ensuring it fits within the 4-inch width.

### 3. `chrome.printing` API
- **Silent Printing:** This API allows the extension to submit print jobs directly to a specific printer ID, bypassing the standard Chrome print preview dialog. This is crucial for the "auto-print" requirement.

---

## Starting From Scratch: Key Considerations
If this project were to be rebuilt or ported, keep these technical requirements in mind:

1. **DOM Selectors are Critical:** The extension relies on `#lastCheckin div` and `.clubber`. If the production site changes its HTML structure, these selectors must be updated in `chrome-extension/content.js`.
2. **`chrome.printing` Permissions:** The extension requires the `"printing"` permission in `manifest.json`. This API is available on Chrome OS, Windows, macOS, and Linux (since Chrome 104).
3. **jsPDF Integration:** The `jspdf.umd.min.js` library must be included in the `content_scripts` array in `manifest.json` before `content.js` so that it is available in the global window scope.
4. **Message Passing for Printing:** Content scripts cannot directly call `chrome.printing.submitJob`. The PDF data must be passed to the background service worker via `chrome.runtime.sendMessage`.
