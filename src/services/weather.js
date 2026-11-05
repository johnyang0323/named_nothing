/**
 * Current weather from Open-Meteo (free, no key, CC BY 4.0). Only the
 * area's rounded centre is sent. Cached for an hour per area; any failure
 * just means "no weather context".
 */
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

/** WMO weather codes → what matters for choosing a place. */
export function classifyWeather(code, temp) {
  let kind = 'clear';
  if ([45, 48].includes(code)) kind = 'fog';
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) kind = 'rain';
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) kind = 'snow';
  else if (code >= 2) kind = 'cloudy';
  const labels = { clear: '맑음', cloudy: '흐림', fog: '안개', rain: '비', snow: '눈' };
  const icons = { clear: '☀', cloudy: '☁', fog: '〰', rain: '☂', snow: '❄' };
  return { kind, temp: Math.round(temp), label: labels[kind], icon: icons[kind] };
}

export async function getWeather(center) {
  if (!center) return null;
  const key = `${center.lat.toFixed(2)},${center.lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.weather;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat.toFixed(3)}&longitude=${center.lng.toFixed(3)}&current=temperature_2m,weather_code,precipitation&timezone=auto`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const body = await res.json();
    const current = body?.current;
    if (!current || !Number.isFinite(current.weather_code) || !Number.isFinite(current.temperature_2m)) return null;
    const weather = classifyWeather(current.precipitation > 0.2 && current.weather_code < 51 ? 61 : current.weather_code, current.temperature_2m);
    cache.set(key, { at: Date.now(), weather });
    return weather;
  } catch {
    return null;
  }
}
