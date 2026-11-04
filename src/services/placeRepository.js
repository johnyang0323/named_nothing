/**
 * Single access point for place data.
 *
 * By default it serves the bundled ILLUSTRATIVE sample. When the user picks
 * a neighborhood, the store calls usePlaces() with real places fetched from
 * Kakao (see services/kakao/), and every screen and the recommender read
 * from that list instead — they never know which source is active.
 */
import { places as samplePlaces } from '../data/places.js';

let active = samplePlaces;
let byId = new Map(active.map((place) => [place.id, place]));
let source = 'sample';

export function usePlaces(list) {
  active = list;
  byId = new Map(list.map((place) => [place.id, place]));
  source = 'kakao';
}

export function useSamplePlaces() {
  active = samplePlaces;
  byId = new Map(samplePlaces.map((place) => [place.id, place]));
  source = 'sample';
}

export function getPlaceSource() {
  return source;
}

export function getAllPlaces() {
  return active;
}

export function getPlaceById(id) {
  return byId.get(id) || null;
}

export function placeExists(id) {
  return byId.has(id);
}
