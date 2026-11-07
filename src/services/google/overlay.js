/** An HTML marker on a Google map (like Kakao's CustomOverlay), centered on its point. */
export function htmlOverlay(google, map, position, el, zIndex = 1) {
  class HtmlOverlay extends google.maps.OverlayView {
    onAdd() {
      el.style.position = 'absolute';
      el.style.zIndex = String(zIndex);
      this.getPanes().overlayMouseTarget.appendChild(el);
    }
    draw() {
      const point = this.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(position.lat, position.lng));
      if (!point) return;
      el.style.left = `${point.x}px`;
      el.style.top = `${point.y}px`;
      el.style.transform = 'translate(-50%, -50%)';
    }
    onRemove() {
      el.remove();
    }
    setPosition(next) {
      position = next;
      this.draw();
    }
  }
  const overlay = new HtmlOverlay();
  overlay.setMap(map);
  return overlay;
}
