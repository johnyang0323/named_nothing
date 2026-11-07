window.kakao = { maps: {
  load(cb) { cb(); },
  LatLng: function (lat, lng) { this.lat = lat; this.lng = lng; this.getLat = () => lat; this.getLng = () => lng; },
  event: {
    addListener(target, type, fn) { (window.__mapListeners ||= []).push({ target, type, fn }); },
  },
  LatLngBounds: function () { this.pts = []; this.extend = (p) => this.pts.push(p); },
  Map: function (el, opts) {
    el.dataset.fakeMap = '1'; this.el = el; window.__maps = (window.__maps || 0) + 1;
    this.center = opts && opts.center;
    this.setZoomable = () => {}; this.setBounds = () => {}; this.relayout = () => {}; this.setLevel = () => {};
    this.setCenter = (c) => { this.center = c; window.__lastCenter = [c.lat, c.lng]; };
  },
  CustomOverlay: function (o) {
    this.content = o.content;
    this.setPosition = (p) => { this.position = p; o.content.dataset.pos = p.lat + ',' + p.lng; };
    this.setMap = (m) => { if (m) m.el.appendChild(o.content); else o.content.remove(); };
  },
  services: {
    Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
    SortBy: { ACCURACY: 'accuracy' },
    Geocoder: function () {
      this.coord2RegionCode = (x, y, cb) => { window.__regionCall = [x, y]; cb([{ region_type: 'B', region_3depth_name: '망원동' }, { region_type: 'H', region_3depth_name: '망원1동' }], 'OK'); };
      this.addressSearch = (q, cb) => (q === '없는동네' || /시부야|shibuya/i.test(q) ? cb([], 'ZERO_RESULT') : cb([{ x: '126.906', y: '37.556' }], 'OK'));
    },
    Places: function () {
      const make = (prefix, cat, n) => Array.from({ length: n }, (_, i) => ({
        id: prefix + i, place_name: cat.split('> ').pop() + ' ' + i, category_name: cat,
        x: String(126.906 + 0.002 * i), y: String(37.556 + 0.0015 * i),
        road_address_name: '서울 예시로 ' + i, place_url: 'https://place.map.kakao.com/' + prefix + i, distance: String(150 * i + 100),
      }));
      this.categorySearch = (code, cb, opts) => { window.__searchAt = opts && opts.location; return  cb(make(code, { CE7: '음식점 > 카페', CT1: '문화,예술 > 미술관', AT4: '여행 > 관광,명소' }[code], 4), 'OK'); };
      this.keywordSearch = (q, cb) => (q === '없는동네' ? cb([], 'ZERO_RESULT') : cb(make(q, '여행 > ' + q, 3), 'OK'));
    },
  },
} };

window.__mapClick = (lat, lng) => {
  (window.__mapListeners || []).filter((l) => l.type === 'click').forEach((l) => l.fn({ latLng: new window.kakao.maps.LatLng(lat, lng) }));
};
