/**
 * Application Constants
 * Central location for all magic numbers and configuration values
 */

// Print server version — bump this whenever server.js changes are deployed
export const SERVER_VERSION = '1.6.1';

// Server & Network Configuration
export const SERVER_PORT = 3456;
export const SERVER_URL = `http://localhost:${SERVER_PORT}`;
export const HEALTH_CHECK_ENDPOINT = `${SERVER_URL}/health`;
export const PRINT_ENDPOINT = `${SERVER_URL}/print`;

// Timeouts (in milliseconds)
export const HEALTH_CHECK_TIMEOUT = 3000; // Timeout for server health check
export const PRINT_REQUEST_TIMEOUT = 5000; // Timeout for print request

// UI Configuration
export const DROPDOWN_Z_INDEX = 9999; // Z-index for printer dropdown and UI overlays
export const STATUS_ICON_DISPLAY_TIME = 3000; // How long to show status icons (✅, ❌)

// Print Configuration
export const PRINT_DELAY = 500; // Delay before triggering print (ms) - allows PDF to load
export const PRINT_COOLDOWN = 2000; // Minimum time between prints to prevent duplicates

// Label Configuration
export const LABEL_WIDTH_INCHES = 4;
export const LABEL_HEIGHT_INCHES = 2;
export const LABEL_DPI = 300;

// Default check-in URL
export const DEFAULT_CHECKIN_URL = 'https://kvbchurch.twotimtwo.com/clubber/checkin?#';

// DOM Selectors (if used in React, keep documented here)
// Note: These are used by the bookmarklet, not the React app itself
export const DOM_SELECTORS = {
  LAST_CHECKIN: '#lastCheckin div', // The "Last Checked In" element
  CLUBBER: '.clubber', // Child/clubber container
  CLUBBER_NAME: '.name', // Name element within clubber
  CLUB_IMAGE: '.club img', // Club logo image within clubber
};

// API Endpoints
export const API_ENDPOINTS = {
  HEALTH: '/health',
  PRINTERS: '/printers',
  PRINT: '/print',
};
