// Stand-in for the Google Maps JavaScript API (dynamic library loading).
(function () {
  const src = (document.currentScript && document.currentScript.src) || '';
  const params = new URLSearchParams(src.split('?')[1] || '');
  window.__googleSdk = (window.__googleSdk || []).concat(src);
  function LatLng(lat, lng) {
    if (lat && typeof lat === 'object') { lng = lat.lng; lat = lat.lat; }
    this.lat = () => lat; this.lng = () => lng;
  }
  class OverlayView {
    setMap(m) { this.map = m; if (m) { this.onAdd(); this.draw(); } else if (this.onRemove) this.onRemove(); }
    getPanes() { return { overlayMouseTarget: this.map.__el }; }
    getProjection() { return { fromLatLngToDivPixel: () => ({ x: 50, y: 50 }) }; }
  }
  function Map(el, opts) {
    this.__el = el; el.dataset.fakeGoogle = '1'; window.__gmaps = (window.__gmaps || 0) + 1;
    const listeners = {};
    this.addListener = (n, f) => { listeners[n] = f; };
    this.setCenter = (c) => { window.__gCenter = c; };
    this.fitBounds = () => {};
    window.__gMapClick = (lat, lng) => listeners.click && listeners.click({ latLng: new LatLng(lat, lng) });
    window.__gCenter = opts && opts.center;
  }
  function LatLngBounds() { this.extend = () => {}; }
  const photo = (id) => ({
    getURI: ({ maxWidth }) => `https://lh3.googleusercontent.com/fake-${id}=w${maxWidth}`,
    authorAttributions: [{ displayName: 'Taro', uri: 'https://maps.google.com/contrib/1' }],
  });
  const KINDS = { cafe: [['cafe'], '카페'], museum: [['museum'], '박물관'], park: [['park'], '공원'] };
  const near = (center, kind, n) => Array.from({ length: n }, (_, i) => {
    const id = `${kind}${i}-${center.lat.toFixed(2)}`;
    return {
      id, displayName: `Shibuya ${KINDS[kind][1]} ${i}`, types: KINDS[kind][0],
      location: new LatLng(center.lat + 0.001 * (i + 1), center.lng), formattedAddress: '일본 도쿄도 시부야구',
      googleMapsURI: `https://maps.google.com/?cid=${id}`, primaryTypeDisplayName: { text: KINDS[kind][1] }, photos: [photo(id)],
    };
  });
  class Place {
    constructor({ id }) { this.id = id; }
    async fetchFields() { this.photos = [photo(this.id)]; window.__fetchFields = (window.__fetchFields || 0) + 1; }
    static async searchByText({ textQuery }) {
      window.__textSearch = (window.__textSearch || []).concat(textQuery);
      if (/시부야|shibuya/i.test(textQuery)) return { places: [{ displayName: 'Shibuya', location: new LatLng(35.6595, 139.7005) }] };
      if (/망원|연남/.test(textQuery)) return { places: [{ displayName: 'Mangwon', location: new LatLng(37.556, 126.906) }] };
      return { places: [] };
    }
    static async searchNearby({ includedTypes, locationRestriction }) {
      window.__nearby = (window.__nearby || 0) + 1;
      const c = locationRestriction.center;
      const kind = includedTypes.includes('cafe') ? 'cafe' : includedTypes.includes('museum') ? 'museum' : 'park';
      return { places: near(c, kind, 3) };
    }
  }
  function Geocoder() { this.geocode = async () => ({ results: [{ address_components: [{ long_name: '시부야구', types: ['locality'] }] }] }); }
  const libs = {
    maps: { Map, OverlayView, LatLngBounds, LatLng },
    places: { Place, SearchNearbyRankPreference: { POPULARITY: 'POPULARITY' } },
    geocoding: { Geocoder },
  };
  window.google = { maps: { Map, OverlayView, LatLngBounds, LatLng, importLibrary: (name) => Promise.resolve(libs[name]) } };
  const cb = params.get('callback');
  if (cb && window[cb]) window[cb]();
})();
