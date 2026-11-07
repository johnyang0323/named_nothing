/**
 * Google Maps JavaScript API key, read from VITE_GOOGLE_MAPS_KEY.
 * Like the Kakao JavaScript key it ships to the browser, so it MUST be
 * restricted in Google Cloud (Application restrictions → Websites: the
 * site's address; API restrictions → Maps JavaScript API, Places API (New),
 * Geocoding API). Used for places outside Korea.
 */
export const GOOGLE_MAPS_KEY = (import.meta.env?.VITE_GOOGLE_MAPS_KEY || '').trim();

export const isGoogleConfigured = () => GOOGLE_MAPS_KEY.length > 0;
