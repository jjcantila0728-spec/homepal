// /api/weather — live current conditions for the dashboard hero card.
//   GET ?lat=&lon=        → weather for explicit coordinates (browser geolocation).
//   GET ?country=PH       → fallback when geolocation is denied; geocodes the
//                           family location to representative coordinates.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { fetchLiveWeather, geocodeCountry } from '@/lib/weather';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const latParam = searchParams.get('lat');
  const lonParam = searchParams.get('lon');
  const country = searchParams.get('country');

  let lat = latParam != null ? Number(latParam) : NaN;
  let lon = lonParam != null ? Number(lonParam) : NaN;

  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && country) {
    const geo = await geocodeCountry(country);
    if (geo) {
      lat = geo.lat;
      lon = geo.lon;
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: 'Valid lat/lon or country required' }, { status: 400 });
  }

  try {
    const weather = await fetchLiveWeather(lat, lon);
    return NextResponse.json(weather, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Weather unavailable' }, { status: 502 });
  }
}
