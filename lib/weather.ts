// Live weather via Open-Meteo (free, keyless) + BigDataCloud reverse geocoding.
// Pure/server-usable: given coordinates it returns a `Weather` object shaped for
// the dashboard hero card. Temperatures are Fahrenheit to match the thermostat UI.
import type { Weather, WeatherForecast } from '@/lib/types';
import { HOLIDAY_COUNTRIES } from '@/lib/holidays';

// WMO weather interpretation codes → human label + FontAwesome (fa-solid) icon.
// https://open-meteo.com/en/docs#weathervariables
function describe(code: number): { cond: string; icon: string } {
  if (code === 0) return { cond: 'Clear', icon: 'fa-sun' };
  if (code === 1 || code === 2) return { cond: 'Partly Cloudy', icon: 'fa-cloud-sun' };
  if (code === 3) return { cond: 'Cloudy', icon: 'fa-cloud' };
  if (code === 45 || code === 48) return { cond: 'Fog', icon: 'fa-smog' };
  if (code >= 51 && code <= 57) return { cond: 'Drizzle', icon: 'fa-cloud-rain' };
  if (code >= 61 && code <= 67) return { cond: 'Rain', icon: 'fa-cloud-showers-heavy' };
  if (code >= 71 && code <= 77) return { cond: 'Snow', icon: 'fa-snowflake' };
  if (code >= 80 && code <= 82) return { cond: 'Showers', icon: 'fa-cloud-showers-heavy' };
  if (code === 85 || code === 86) return { cond: 'Snow Showers', icon: 'fa-snowflake' };
  if (code >= 95) return { cond: 'Thunderstorm', icon: 'fa-cloud-bolt' };
  return { cond: 'Cloudy', icon: 'fa-cloud' };
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const r = (n: number) => Math.round(n);

// Resolve a city/locality name from coordinates. Best-effort: returns '' on failure.
async function reverseCity(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return '';
    const d = (await res.json()) as { city?: string; locality?: string; principalSubdivision?: string };
    return d.city || d.locality || d.principalSubdivision || '';
  } catch {
    return '';
  }
}

// Fetch current conditions + a 3-day outlook for the given coordinates.
export async function fetchLiveWeather(lat: number, lon: number): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=4`;

  const [res, city] = await Promise.all([
    fetch(url, { signal: AbortSignal.timeout(8000) }),
    reverseCity(lat, lon),
  ]);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);

  const data = (await res.json()) as {
    current: { temperature_2m: number; weather_code: number };
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
  };

  const cur = describe(data.current.weather_code);
  const daily = data.daily;

  // Next three days (skip today at index 0).
  const forecast: WeatherForecast[] = [];
  for (let i = 1; i < daily.time.length && forecast.length < 3; i++) {
    const day = DOW[new Date(daily.time[i] + 'T00:00:00').getDay()];
    forecast.push({ day, icon: describe(daily.weather_code[i]).icon, hi: r(daily.temperature_2m_max[i]) });
  }

  return {
    temp: r(data.current.temperature_2m),
    cond: cur.cond,
    icon: cur.icon,
    city,
    hi: r(daily.temperature_2m_max[0]),
    lo: r(daily.temperature_2m_min[0]),
    forecast,
  };
}

// Fallback: turn a stored family-location country code into coordinates via
// Open-Meteo's geocoding API, so weather still works when the browser denies
// geolocation. Returns null if it can't be resolved.
export async function geocodeCountry(code: string): Promise<{ lat: number; lon: number } | null> {
  const name = HOLIDAY_COUNTRIES.find((c) => c.code === code)?.name || code;
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { results?: { latitude: number; longitude: number }[] };
    const hit = d.results?.[0];
    return hit ? { lat: hit.latitude, lon: hit.longitude } : null;
  } catch {
    return null;
  }
}
