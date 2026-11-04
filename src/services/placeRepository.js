/**
 * Single access point for place data.
 *
 * Today it reads the bundled illustrative sample. Later this module is the
 * seam for a real provider (e.g. Kakao Local API, Supabase) — keep the
 * returned objects in the same shape as src/data/places.js and the rest of
 * the app will not need to change.
 */
import { places } from '../data/places.js';

const byId = new Map(places.map((place) => [place.id, place]));

export function getAllPlaces() {
  return places;
}

export function getPlaceById(id) {
  return byId.get(id) || null;
}

export function placeExists(id) {
  return byId.has(id);
}
