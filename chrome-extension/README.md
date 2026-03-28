# KVBC Kids Check-in Extension (Store Submission)

This extension is a companion tool for the **KVBC Kids Check-in System**. 

### Functionality
It acts as a bridge between the TwoTimTwo check-in platform and a local thermal label printer. 

1. **Observe:** It uses a \MutationObserver\ to detect when a child is successfully checked in on the web page.
2. **Extract:** it extracts the name and club logo from the page DOM.
3. **Print:** It sends this data to a local Node.js print server (\http://localhost:3456\) which generates a PDF and sends it to the printer.

### Why Background Scripts?
We use a Manifest V3 background service worker (\ackground.js\) to handle the \etch\ request to the local server. This ensures that the print job is not blocked by the main page's Content Security Policy (CSP) or Mixed Content restrictions.
