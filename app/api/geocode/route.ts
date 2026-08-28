import { NextRequest, NextResponse } from 'next/server';
import type { GeocodeResult } from '@/lib/types';

export async function GET(req: NextRequest) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ORS_API_KEY manquante. Ajoute ta clé OpenRouteService dans .env.local (voir README).' },
      { status: 500 }
    );
  }

  const query = req.nextUrl.searchParams.get('q')?.trim();
  if (!query) {
    return NextResponse.json({ results: [] satisfies GeocodeResult[] });
  }

  const url = new URL('https://api.openrouteservice.org/geocode/search');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('text', query);
  url.searchParams.set('size', '5');

  const res = await fetch(url.toString());
  if (!res.ok) {
    return NextResponse.json({ error: `Geocodage ORS ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  const features: Array<{ geometry: { coordinates: [number, number] }; properties: { label: string } }> =
    data?.features ?? [];

  const results: GeocodeResult[] = features.map((f) => ({
    label: f.properties.label,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

  return NextResponse.json({ results });
}
