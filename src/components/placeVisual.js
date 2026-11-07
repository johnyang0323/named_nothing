/**
 * The default picture for a place (before or without a real photo):
 * white, with one aurora circle in the middle holding a question mark —
 * the same mark as the app icon. A real photo replaces it when one loads.
 */
import { escapeHtml, raw } from '../utils/dom.js';
import { photosEnabled } from '../services/photos.js';

/** Attribute that lets hydratePhotos() upgrade this slot with a real photo. */
export function photoSlot(place, { gallery = false } = {}) {
  if (!photosEnabled(place)) return '';
  return raw(` data-photo-for="${escapeHtml(place.id)}"${gallery ? ' data-photo-gallery' : ''}`);
}

const W = 400;
const H = 260;
let seq = 0;

/** A question mark in a 100×100 box, centred on (50, 50). */
export const QUESTION_MARK =
  '<path d="M41 41.5C41 35.5 45.5 32 50.5 32C56 32 60 35.8 60 40.8C60 45 57.3 47.2 54.2 49C51.7 50.5 50.5 52 50.5 55.5V57.5" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="50.5" cy="67" r="4.2" fill="#FFFFFF"/>';

function mark(className = '') {
  const id = `aurora-${(seq += 1)}`;
  const size = 96; // circle diameter in the 400×260 picture
  const scale = size / 60; // the mark's circle is 60 units wide
  const x = W / 2 - 50 * scale;
  const y = H / 2 - 50 * scale;
  return raw(`<svg class="visual ${escapeHtml(className)}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="background:#FFFFFF" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3B82F6"/><stop offset="0.35" stop-color="#60A5FA"/><stop offset="0.7" stop-color="#A78BFA"/><stop offset="1" stop-color="#FBCFE8"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#FFFFFF"/>
    <g transform="translate(${x} ${y}) scale(${scale})">
      <circle cx="50" cy="50" r="30" fill="url(#${id})"/>
      ${QUESTION_MARK}
    </g>
  </svg>`);
}

/** For things that aren't places (e.g. today's small suggestion). */
export function horizonVisual() {
  return mark();
}

export function placeVisual(place, { className = '' } = {}) {
  if (!place) return raw('');
  if (place.image) {
    return raw(
      `<img class="visual ${escapeHtml(className)}" src="${escapeHtml(place.image)}" alt="" loading="lazy" onerror="this.remove()">`,
    );
  }
  return mark(className);
}
