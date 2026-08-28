import { NextRequest, NextResponse } from 'next/server';
import type { CyclingProfile, GeneratedRoute } from '@/lib/types';

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions';
const MAX_ATTEMPTS = 5;

interface RequestBody {
  lat: number;
  lng: number;
  targetDistanceKm: number;
  maxElevationM: number;
  profile: CyclingProfile;
  avoidRoughSurfaces?: boolean;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function fetchRoundTrip(
  apiKey: string,
  profile: CyclingProfile,
  lat: number,
  lng: number,
  distanceKm: number,
  seed: number,
  attempt: number,
  avoidRoughSurfaces: boolean
): Promise<GeneratedRoute> {
  const points = Math.min(10, Math.max(3, Math.round(distanceKm / 8)));

  const options: Record<string, unknown> = {
    round_trip: {
      length: Math.round(distanceKm * 1000),
      points,
      seed,
    },
  };

  // Restreint aux surfaces revêtues (asphalte/béton) — exclut pavés et
  // chemins non asphaltés. Repose sur profile_params.restrictions, un champ
  // documenté pour les profils cycling-*, mais que nous n'avons pas pu
  // tester en direct : voir le repli dans POST() si ORS le rejette.
  if (avoidRoughSurfaces) {
    options.profile_params = {
      restrictions: {
        surface_type: 'asphalt',
      },
    };
  }

  const res = await fetch(`${ORS_BASE_URL}/${profile}/geojson`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      coordinates: [[lng, lat]],
      elevation: true,
      options,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ORS ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }

  const data = await res.json();
  const feature = data?.features?.[0];
  const coords: [number, number, number?][] = feature?.geometry?.coordinates ?? [];

  if (coords.length < 2) {
    throw new Error('Réponse ORS vide');
  }

  const raw = coords.map((c) => ({ lat: c[1], lng: c[0], ele: c[2] ?? 0 }));

  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  const points_: GeneratedRoute['points'] = raw.map((p, i) => {
    if (i > 0) {
      const prev = raw[i - 1];
      distanceM += haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
      const eleDelta = p.ele - prev.ele;
      if (eleDelta > 0) ascentM += eleDelta;
      else descentM += -eleDelta;
    }
    return { lat: p.lat, lng: p.lng, ele: p.ele, distanceKm: distanceM / 1000 };
  });

  return {
    points: points_,
    distanceKm: distanceM / 1000,
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    attempts: attempt,
    strictSurfaceApplied: avoidRoughSurfaces,
  };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ORS_API_KEY manquante. Ajoute ta clé OpenRouteService dans .env.local (voir README).' },
      { status: 500 }
    );
  }

  const body = (await req.json()) as RequestBody;
  const { lat, lng, targetDistanceKm, maxElevationM, profile } = body;
  const wantsStrictSurface = body.avoidRoughSurfaces === true;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(targetDistanceKm) || targetDistanceKm <= 0) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }

  let best: GeneratedRoute | null = null;
  let bestScore = Infinity;
  let lastError = '';
  let strictSurfaceRejected = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const seed = Math.floor(Math.random() * 1_000_000);
    const useStrictSurface = wantsStrictSurface && !strictSurfaceRejected;
    let candidate: GeneratedRoute;
    try {
      candidate = await fetchRoundTrip(apiKey, profile, lat, lng, targetDistanceKm, seed, attempt, useStrictSurface);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // Si ORS rejette le filtre de revêtement (paramètre non supporté sur ce
      // profil, ou aucune boucle possible sous cette contrainte), on
      // abandonne le filtre pour les tentatives suivantes plutôt que
      // d'échouer complètement — mieux vaut une boucle sans garantie de
      // revêtement qu'aucune boucle du tout.
      if (useStrictSurface) strictSurfaceRejected = true;
      continue;
    }

    const over = candidate.ascentM - maxElevationM;
    const score = over > 0 ? over * 3 : -over;

    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }

    if (candidate.ascentM <= maxElevationM) break;
  }

  if (!best) {
    return NextResponse.json(
      {
        error: `Impossible de générer un itinéraire ici. Essaie un autre point de départ ou une autre distance.${
          lastError ? ` (${lastError})` : ''
        }`,
      },
      { status: 502 }
    );
  }

  return NextResponse.json(best);
}
