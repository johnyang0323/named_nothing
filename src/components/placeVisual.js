/**
 * Editorial SVG illustrations, generated locally per place category.
 * No remote images → nothing can break. When real photography exists,
 * set `place.image` to a local/public URL and it will be used instead.
 */
import { hashString } from '../utils/date.js';
import { escapeHtml, raw } from '../utils/dom.js';
import { photosEnabled } from '../services/photos.js';

/** Attribute that lets hydratePhotos() upgrade this slot with a real photo. */
export function photoSlot(place, { gallery = false } = {}) {
  if (!photosEnabled(place)) return '';
  return raw(` data-photo-for="${escapeHtml(place.id)}"${gallery ? ' data-photo-gallery' : ''}`);
}

// black · white · purple only, drawn light-on-dark (greys are white at low opacity)
const C = {
  ivory: '#000000',
  olive: 'rgba(255,255,255,0.78)',
  oliveDeep: '#FFFFFF',
  oliveSoft: 'rgba(255,255,255,0.3)',
  charcoal: '#FFFFFF',
  gray: 'rgba(255,255,255,0.5)',
  sand: 'rgba(255,255,255,0.12)',
  clay: '#8B5CF6',
  claySoft: 'rgba(139,92,246,0.5)',
  purple: '#8B5CF6',
  purpleSoft: 'rgba(139,92,246,0.3)',
  white: '#000000',
};

const BACKGROUNDS = {
  restful: 'rgba(255,255,255,0.06)',
  scenic: 'rgba(139,92,246,0.14)',
  active: 'rgba(255,255,255,0.08)',
  enriching: 'rgba(139,92,246,0.1)',
  creative: 'rgba(139,92,246,0.2)',
  productive: 'rgba(255,255,255,0.05)',
};

const W = 400;
const H = 260;

const drawers = {
  park(r) {
    const x = 90 + r(40);
    return `
      <rect x="0" y="196" width="${W}" height="64" fill="${C.oliveSoft}" opacity=".45"/>
      <rect x="${x - 3}" y="140" width="6" height="60" fill="${C.charcoal}" opacity=".7"/>
      <circle cx="${x}" cy="120" r="${52 + r(10)}" fill="${C.olive}"/>
      <circle cx="${x + 46}" cy="104" r="34" fill="${C.oliveDeep}" opacity=".8"/>
      <rect x="${x + 130}" y="176" width="70" height="6" rx="3" fill="${C.charcoal}" opacity=".75"/>
      <rect x="${x + 136}" y="182" width="4" height="16" fill="${C.charcoal}" opacity=".75"/>
      <rect x="${x + 190}" y="182" width="4" height="16" fill="${C.charcoal}" opacity=".75"/>
      <circle cx="${320 - r(30)}" cy="62" r="20" fill="${C.claySoft}"/>`;
  },
  garden(r) {
    return `
      <path d="M90 210 V120 A110 100 0 0 1 310 120 V210 Z" fill="${C.white}" opacity=".55" stroke="${C.gray}" stroke-width="2"/>
      <path d="M200 30 V210 M90 120 H310 M145 48 V210 M255 48 V210" stroke="${C.gray}" stroke-width="1.5" opacity=".6"/>
      <ellipse cx="${150 + r(20)}" cy="178" rx="40" ry="16" fill="${C.olive}" transform="rotate(-30 160 178)"/>
      <ellipse cx="${236 - r(20)}" cy="170" rx="46" ry="18" fill="${C.oliveDeep}" transform="rotate(28 230 170)"/>
      <ellipse cx="200" cy="150" rx="18" ry="50" fill="${C.oliveSoft}"/>
      <rect x="0" y="210" width="${W}" height="50" fill="${C.sand}" opacity=".6"/>`;
  },
  bookstore(r) {
    const colors = [C.olive, C.clay, C.charcoal, C.sand, C.oliveDeep, C.claySoft, C.gray];
    let x = 70;
    let books = '';
    for (let i = 0; i < 11; i += 1) {
      const w = 16 + r(14);
      const h = 70 + r(50);
      books += `<rect x="${x}" y="${190 - h}" width="${w}" height="${h}" fill="${colors[(i + r(7)) % colors.length]}" rx="2"/>`;
      x += w + 3;
      if (x > 320) break;
    }
    return `${books}
      <rect x="54" y="190" width="292" height="8" fill="${C.charcoal}" opacity=".8"/>
      <rect x="54" y="198" width="292" height="62" fill="${C.sand}" opacity=".5"/>`;
  },
  library(r) {
    return `
      <path d="M150 40 h100 v90 h-100 Z" fill="${C.white}" opacity=".6"/>
      <path d="M150 80 A50 40 0 0 1 250 80" fill="none" stroke="${C.gray}" stroke-width="2"/>
      <path d="M200 40 V130" stroke="${C.gray}" stroke-width="2"/>
      ${[0, 1, 2]
        .map(
          (row) =>
            `<rect x="60" y="${150 + row * 30}" width="280" height="4" fill="${C.charcoal}" opacity=".7"/>` +
            Array.from({ length: 9 }, (_, i) => `<rect x="${66 + i * 30 + r(6)}" y="${130 + row * 30}" width="${12 + r(8)}" height="20" fill="${[C.olive, C.clay, C.sand][(i + row) % 3]}"/>`).join(''),
        )
        .join('')}`;
  },
  gallery(r) {
    const tilt = r(10) - 5;
    return `
      <rect x="0" y="210" width="${W}" height="50" fill="${C.sand}" opacity=".55"/>
      <rect x="64" y="${60 + tilt}" width="120" height="120" fill="${C.white}"/>
      <rect x="78" y="${74 + tilt}" width="92" height="92" fill="${C.olive}"/>
      <circle cx="124" cy="${120 + tilt}" r="22" fill="${C.claySoft}"/>
      <rect x="214" y="78" width="80" height="104" fill="${C.white}"/>
      <rect x="226" y="90" width="56" height="80" fill="${C.charcoal}" opacity=".8"/>
      <rect x="314" y="96" width="44" height="58" fill="${C.white}"/>
      <rect x="322" y="104" width="28" height="42" fill="${C.clay}"/>`;
  },
  museum(r) {
    return `
      <path d="M80 100 L200 46 L320 100 Z" fill="${C.sand}"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${96 + i * 46}" y="108" width="16" height="${84 + r(3)}" fill="${C.white}" opacity=".85"/>`).join('')}
      <rect x="76" y="100" width="248" height="8" fill="${C.gray}"/>
      <rect x="66" y="192" width="268" height="12" fill="${C.gray}"/>
      <rect x="0" y="204" width="${W}" height="56" fill="${C.oliveSoft}" opacity=".35"/>`;
  },
  street(r) {
    const sun = 260 + r(60);
    return `
      <circle cx="${sun}" cy="70" r="26" fill="${C.claySoft}"/>
      <path d="M0 260 L170 130 L230 130 L400 260 Z" fill="${C.sand}" opacity=".7"/>
      <path d="M0 40 L110 100 L110 200 L0 260 Z" fill="${C.olive}"/>
      <path d="M400 60 L290 108 L290 196 L400 260 Z" fill="${C.oliveDeep}" opacity=".85"/>
      <path d="M150 150 L170 130 L230 130 L250 150" fill="none" stroke="${C.gray}" stroke-width="1.5"/>
      <rect x="30" y="120" width="18" height="28" fill="${C.ivory}" opacity=".7"/>
      <rect x="340" y="140" width="16" height="24" fill="${C.ivory}" opacity=".6"/>`;
  },
  architecture(r) {
    const arches = Array.from({ length: 4 }, (_, i) => {
      const x = 98 + i * 54;
      return `<path d="M${x} 170 V120 A16 16 0 0 1 ${x + 32} 120 V170 Z" fill="${C.ivory}" opacity=".85"/>`;
    }).join('');
    return `
      <rect x="80" y="${70 + r(8)}" width="240" height="140" fill="${C.clay}"/>
      <rect x="80" y="${70 + r(8)}" width="240" height="10" fill="${C.charcoal}" opacity=".5"/>
      ${arches}
      <rect x="0" y="210" width="${W}" height="50" fill="${C.sand}" opacity=".6"/>
      <circle cx="${50 + r(20)}" cy="56" r="16" fill="${C.ivory}"/>`;
  },
  cafe(r) {
    return `
      <rect x="70" y="40" width="260" height="150" rx="4" fill="${C.white}" opacity=".7"/>
      <path d="M200 40 V190 M70 115 H330" stroke="${C.gray}" stroke-width="2"/>
      <circle cx="${120 + r(30)}" cy="80" r="18" fill="${C.oliveSoft}"/>
      <rect x="40" y="190" width="320" height="10" fill="${C.charcoal}" opacity=".8"/>
      <path d="M170 150 h44 v26 a14 14 0 0 1 -14 14 h-16 a14 14 0 0 1 -14 -14 Z" fill="${C.ivory}" stroke="${C.charcoal}" stroke-width="2"/>
      <path d="M214 158 a9 9 0 0 1 0 18" fill="none" stroke="${C.charcoal}" stroke-width="2"/>
      <path d="M184 140 q6 -10 0 -18 M198 140 q6 -10 0 -18" stroke="${C.gray}" stroke-width="2" fill="none"/>`;
  },
  market(r) {
    const awnings = Array.from({ length: 4 }, (_, i) => {
      const x = 40 + i * 84;
      const color = [C.olive, C.clay, C.oliveDeep, C.sand][(i + r(4)) % 4];
      return `<path d="M${x} 90 h76 l-8 30 h-60 Z" fill="${color}"/>
        <rect x="${x + 8}" y="120" width="60" height="70" fill="${C.ivory}" opacity=".75"/>
        <circle cx="${x + 24}" cy="180" r="8" fill="${C.clay}"/><circle cx="${x + 44}" cy="182" r="7" fill="${C.olive}"/>`;
    }).join('');
    return `${awnings}<rect x="0" y="190" width="${W}" height="70" fill="${C.sand}" opacity=".5"/>`;
  },
  riverside(r) {
    const waves = Array.from({ length: 5 }, (_, i) => {
      const y = 170 + i * 16;
      return `<path d="M0 ${y} q25 -8 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0" fill="none" stroke="${C.olive}" stroke-width="2" opacity="${0.9 - i * 0.14}"/>`;
    }).join('');
    return `
      <rect x="0" y="160" width="${W}" height="100" fill="${C.oliveSoft}" opacity=".3"/>
      <path d="M40 160 Q200 ${40 + r(20)} 360 160" fill="none" stroke="${C.charcoal}" stroke-width="6" opacity=".75"/>
      <path d="M40 160 V140 M360 160 V140" stroke="${C.charcoal}" stroke-width="6" opacity=".75"/>
      <circle cx="${80 + r(40)}" cy="60" r="20" fill="${C.claySoft}"/>
      ${waves}`;
  },
  workshop(r) {
    return `
      <rect x="40" y="186" width="320" height="10" fill="${C.charcoal}" opacity=".75"/>
      <path d="M100 186 q-26 -40 0 -80 h40 q26 40 0 80 Z" fill="${C.clay}"/>
      <rect x="108" y="96" width="24" height="12" fill="${C.clay}"/>
      <path d="M190 186 q-20 -20 -10 -50 h60 q10 30 -10 50 Z" fill="${C.sand}"/>
      <ellipse cx="300" cy="${176 - r(6)}" rx="40" ry="10" fill="${C.olive}"/>
      <rect x="0" y="196" width="${W}" height="64" fill="${C.sand}" opacity=".4"/>`;
  },
  viewpoint(r) {
    return `
      <circle cx="${250 + r(50)}" cy="${90 + r(20)}" r="34" fill="${C.claySoft}"/>
      <path d="M0 170 Q100 ${110 + r(20)} 200 160 T400 140 V260 H0 Z" fill="${C.oliveSoft}"/>
      <path d="M0 200 Q120 150 240 196 T400 180 V260 H0 Z" fill="${C.olive}"/>
      <path d="M0 230 Q160 200 400 226 V260 H0 Z" fill="${C.oliveDeep}"/>
      ${Array.from({ length: 6 }, (_, i) => `<rect x="${40 + i * 22 + r(6)}" y="${206 - r(10)}" width="10" height="10" fill="${C.ivory}" opacity=".7"/>`).join('')}`;
  },
  recordshop(r) {
    const disc = (cx, cy, rad, label) => `
      <circle cx="${cx}" cy="${cy}" r="${rad}" fill="${C.charcoal}"/>
      <circle cx="${cx}" cy="${cy}" r="${rad * 0.75}" fill="none" stroke="${C.gray}" stroke-width="1" opacity=".6"/>
      <circle cx="${cx}" cy="${cy}" r="${rad * 0.55}" fill="none" stroke="${C.gray}" stroke-width="1" opacity=".6"/>
      <circle cx="${cx}" cy="${cy}" r="${rad * 0.3}" fill="${label}"/>
      <circle cx="${cx}" cy="${cy}" r="3" fill="${C.ivory}"/>`;
    return `
      <rect x="60" y="60" width="130" height="130" fill="${C.olive}"/>
      ${disc(190 + r(20), 125, 64, C.clay)}
      ${disc(300, 150, 44, C.sand)}
      <rect x="0" y="210" width="${W}" height="50" fill="${C.sand}" opacity=".5"/>`;
  },
};

/** Abstract composition for things that aren't places (e.g. today's small suggestion). */
export function horizonVisual(seed = 0) {
  const r = rng(seed);
  return raw(`<svg class="visual" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="${W}" height="${H}" fill="#000000"/>
    <rect width="${W}" height="${H}" fill="${C.purpleSoft}" opacity=".35"/>
    <circle cx="${140 + r(140)}" cy="${110 + r(30)}" r="46" fill="${C.purple}"/>
    <path d="M0 180 Q120 ${150 + r(20)} 240 176 T400 168 V260 H0 Z" fill="${C.oliveSoft}"/>
    <path d="M0 214 Q180 190 400 212 V260 H0 Z" fill="${C.olive}"/>
    <path d="M60 240 L200 196" stroke="${C.ivory}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>
  </svg>`);
}

function rng(seed) {
  let s = seed || 1;
  return (max) => {
    s = (s * 9301 + 49297) % 233280;
    return Math.floor((s / 233280) * max);
  };
}

export function placeVisual(place, { className = '' } = {}) {
  if (!place) return raw('');
  if (place.image) {
    return raw(
      `<img class="visual ${escapeHtml(className)}" src="${escapeHtml(place.image)}" alt="" loading="lazy" onerror="this.remove()">`,
    );
  }
  const draw = drawers[place.category] || drawers.street;
  const r = rng(hashString(place.id));
  const bg = BACKGROUNDS[place.experienceType] || BACKGROUNDS.scenic;
  return raw(`<svg class="visual ${escapeHtml(className)}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="${W}" height="${H}" fill="${bg}"/>${draw(r)}
  </svg>`);
}
