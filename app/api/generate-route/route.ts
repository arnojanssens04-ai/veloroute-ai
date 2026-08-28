import { NextRequest, NextResponse } from 'next/server';
import type { CyclingProfile, GeneratedRoute, RoutePoint, WindInfo } from '@/lib/types';

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions';
const MAX_ATTEMPTS = 5;
const WIND_WEIGHT = 2;

interface RequestBody {
  lat: number;
  lng: number;
  targetDistanceKm: number;
  maxElevationM: number;
  profile: CyclingProfile;
  avoidRoughSurfaces?: boolean;
  optimizeForWind?: boolean;
}

type RouteCandidate = Omit<GeneratedRoute, 'wind' | 'windScore'>;

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

function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = (Math.atan2(y, x) * 180) / Math.PI;
  return (θ + 360) % 360;
}

async function fetchWind(lat: number, lng: number): Promise<WindInfo | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const speedKmh = data?.current?.wind_speed_10m;
    const directionFromDeg = data?.current?.wind_direction_10m;
    if (typeof speedKmh !== 'number' || typeof directionFromDeg !== 'number') return null;
    return { speedKmh, directionFromDeg };
  } catch {
    return null;
  }
}

// Score une boucle déjà générée par rapport au vent : plus il est élevé,
// plus la première moitié du parcours (en distance) est face au vent et la
// seconde moitié dans le dos. cos(cap - direction du vent) vaut +1 quand on
// roule droit dans le vent (vent de face) et -1 quand on l'a dans le dos.
// ORS ne permet pas d'imposer un cap de départ : on ne peut donc que générer
// plusieurs boucles candidates (comme pour le D+) et choisir la plus
// favorable parmi elles, pas garantir un vent de face parfait.
function computeWindScore(points: RoutePoint[], windDirectionFromDeg: number): number {
  const totalKm = points[points.length - 1]?.distanceKm ?? 0;
  if (totalKm <= 0) return 0;
  const halfKm = totalKm / 2;

  let firstWeighted = 0;
  let firstDist = 0;
  let secondWeighted = 0;
  let secondDist = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segmentKm = curr.distanceKm - prev.distanceKm;
    if (segmentKm <= 0) continue;
    const bearing = bearingDegrees(prev.lat, prev.lng, curr.lat, curr.lng);
    const headwindFactor = Math.cos(((bearing - windDirectionFromDeg) * Math.PI) / 180);

    if (curr.distanceKm <= halfKm) {
      firstWeighted += headwindFactor * segmentKm;
      firstDist += segmentKm;
    } else {
      secondWeighted += headwindFactor * segmentKm;
      secondDist += segmentKm;
    }
  }

  const avgFirst = firstDist > 0 ? firstWeighted / firstDist : 0;
  const avgSecond = secondDist > 0 ? secondWeighted / secondDist : 0;
  return avgFirst - avgSecond;
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
): Promise<RouteCandidate> {
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
  const points_: RoutePoint[] = raw.map((p, i) => {
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
  const wantsWindOptimization = body.optimizeForWind === true;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(targetDistanceKm) || targetDistanceKm <= 0) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }

  const wind = wantsWindOptimization ? await fetchWind(lat, lng) : null;

  let best: RouteCandidate | null = null;
  let bestScore = Infinity;
  let bestWindScore = -Infinity;
  let lastError = '';
  let strictSurfaceRejected = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const seed = Math.floor(Math.random() * 1_000_000);
    const useStrictSurface = wantsStrictSurface && !strictSurfaceRejected;
    let candidate: RouteCandidate;
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
    const elevationScore = over > 0 ? over * 3 : -over;
    const windScore = wind ? computeWindScore(candidate.points, wind.directionFromDeg) : 0;
    const combinedScore = elevationScore - windScore * WIND_WEIGHT;

    if (combinedScore < bestScore) {
      best = candidate;
      bestScore = combinedScore;
      bestWindScore = windScore;
    }

    // Sans optimisation vent, un premier candidat qui respecte le D+ suffit.
    // Avec optimisation vent, il faut comparer plusieurs candidats avant de
    // choisir, donc pas d'arrêt anticipé.
    if (!wind && candidate.ascentM <= maxElevationM) break;
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

  const result: GeneratedRoute = { ...best, wind, windScore: bestWindScore === -Infinity ? 0 : bestWindScore };
  return NextResponse.json(result);
}
