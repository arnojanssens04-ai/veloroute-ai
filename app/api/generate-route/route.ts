import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_ATHLETE_PROFILE } from '@/lib/athleteProfile';
import { bearingDegrees, haversineMeters } from '@/lib/geo';
import { estimateRideDistanceKm } from '@/lib/speedModel';
import type { CyclingProfile, GeneratedRoute, RoutePoint, WindInfo } from '@/lib/types';

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions';
const MAX_ATTEMPTS = 8;
const WIND_WEIGHT = 2;
const DIRECTION_WEIGHT = 3;
const DIRECTION_FRACTION = 0.3;
const UTURN_TURN_THRESHOLD_DEG = 150;
const UTURN_MIN_SEGMENT_M = 5;
const UTURN_TOLERANCE_M = 150;
const DISTANCE_TOLERANCE_RATIO = 0.12;
const DISTANCE_TOLERANCE_MIN_KM = 2;
const REFINEMENT_ASCENT_RATIO = 0.6;
const REFINEMENT_MIN_CHANGE_RATIO = 0.05;

interface RequestBody {
  lat: number;
  lng: number;
  targetDistanceKm: number;
  maxElevationM: number;
  durationHours: number;
  flatSpeedKmh: number;
  profile: CyclingProfile;
  avoidRoughSurfaces?: boolean;
  optimizeForWind?: boolean;
  aimLat?: number;
  aimLng?: number;
}

type RouteCandidate = Omit<
  GeneratedRoute,
  'wind' | 'windScore' | 'directionScore' | 'uturnPenaltyM' | 'refinedForTerrain' | 'refinedForDistance'
>;

interface SearchResult {
  best: RouteCandidate | null;
  isClean: boolean;
  windScore: number;
  directionScore: number;
  uturnPenaltyM: number;
  lastError: string;
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

// Score une boucle par rapport à une direction souhaitée (le cap depuis le
// départ vers un point cliqué sur la carte) : +1 quand le tout début du
// parcours part plein cap vers ce point, -1 quand il part à l'opposé. On ne
// regarde que la première fraction du trajet (par défaut 30%) — la "sortie"
// — puisque c'est de là que vient "de quel côté je pars" ; le reste de la
// boucle revient de toute façon vers le départ. Même logique que le vent :
// ORS ne permet pas d'imposer un cap de départ, donc on choisit la moins
// mauvaise option parmi des boucles déjà générées pour d'autres critères.
function computeDirectionScore(points: RoutePoint[], desiredBearingDeg: number): number {
  const totalKm = points[points.length - 1]?.distanceKm ?? 0;
  if (totalKm <= 0) return 0;
  const cutoffKm = totalKm * DIRECTION_FRACTION;

  let weighted = 0;
  let dist = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.distanceKm >= cutoffKm) break;
    const segmentKm = curr.distanceKm - prev.distanceKm;
    if (segmentKm <= 0) continue;
    const bearing = bearingDegrees(prev.lat, prev.lng, curr.lat, curr.lng);
    const alignment = Math.cos(((bearing - desiredBearingDeg) * Math.PI) / 180);
    weighted += alignment * segmentKm;
    dist += segmentKm;
  }

  return dist > 0 ? weighted / dist : 0;
}

// Détecte les allers-retours (ORS génère parfois une impasse pour ajuster
// la distance : le tracé remonte une petite route puis fait quasi demi-tour
// dedans). Un retournement de cap > 150° entre deux segments non-négligeables
// (≥5m, pour ignorer le bruit GPS) compte comme un aller-retour ; la
// pénalité retenue est la longueur du plus court des deux segments
// concernés, en mètres — comparable directement au dépassement de D+.
function computeUTurnPenaltyMeters(points: RoutePoint[]): number {
  let penaltyM = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const segIn = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    const segOut = haversineMeters(curr.lat, curr.lng, next.lat, next.lng);
    if (segIn < UTURN_MIN_SEGMENT_M || segOut < UTURN_MIN_SEGMENT_M) continue;
    const bearingIn = bearingDegrees(prev.lat, prev.lng, curr.lat, curr.lng);
    const bearingOut = bearingDegrees(curr.lat, curr.lng, next.lat, next.lng);
    let turn = Math.abs(bearingOut - bearingIn);
    if (turn > 180) turn = 360 - turn;
    if (turn > UTURN_TURN_THRESHOLD_DEG) {
      penaltyM += Math.min(segIn, segOut);
    }
  }
  return penaltyM;
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
  // tester en direct : voir le repli dans searchCandidates() si ORS le rejette.
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

// Génère jusqu'à MAX_ATTEMPTS boucles pour une distance cible donnée et
// classe les résultats à paliers plutôt qu'avec un score unique : le D+, les
// aller-retours et l'écart de distance sont des défauts de qualité mesurés
// en mètres (échelle commune), tandis que vent/direction sont de simples
// préférences (échelle -1..1). Les additionner dans un seul score mélangeait
// des grandeurs incomparables et le D+ finissait par écraser complètement
// la préférence de direction. On filtre d'abord sur la qualité (D+ +
// demi-tours + distance), et on ne départage par vent/direction qu'entre
// candidats déjà propres. L'écart de distance compte ici car l'algorithme
// round_trip d'ORS est approximatif : il peut renvoyer une boucle
// sensiblement plus longue ou plus courte que la longueur demandée.
async function searchCandidates(
  apiKey: string,
  profile: CyclingProfile,
  lat: number,
  lng: number,
  requestDistanceKm: number,
  maxElevationM: number,
  wantsStrictSurface: boolean,
  wind: WindInfo | null,
  desiredBearing: number | null,
  // Distance à laquelle juger la "propreté" d'un candidat. Distincte de
  // requestDistanceKm (ce qu'on envoie réellement à ORS) : la correction de
  // biais demande volontairement une longueur différente de ce qu'on vise
  // vraiment, pour compenser l'imprécision de round_trip — comparer un
  // résultat à la longueur envoyée plutôt qu'à l'objectif réel aurait
  // classé "sale" un résultat qui tombe pourtant pile sur la cible.
  evaluationTargetKm: number = requestDistanceKm
): Promise<SearchResult> {
  const elevationToleranceM = Math.max(30, maxElevationM * 0.15);
  const distanceToleranceM =
    Math.max(DISTANCE_TOLERANCE_MIN_KM, evaluationTargetKm * DISTANCE_TOLERANCE_RATIO) * 1000;

  let bestClean: RouteCandidate | null = null;
  let bestCleanPreference = -Infinity;
  let bestCleanWindScore = 0;
  let bestCleanDirectionScore = 0;
  let bestCleanUTurnM = 0;

  let bestDirty: RouteCandidate | null = null;
  let bestDirtyDefect = Infinity;
  let bestDirtyUTurnM = 0;

  let lastError = '';
  let strictSurfaceRejected = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const seed = Math.floor(Math.random() * 1_000_000);
    const useStrictSurface = wantsStrictSurface && !strictSurfaceRejected;
    let candidate: RouteCandidate;
    try {
      candidate = await fetchRoundTrip(apiKey, profile, lat, lng, requestDistanceKm, seed, attempt, useStrictSurface);
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

    const elevationOverM = Math.max(0, candidate.ascentM - maxElevationM);
    const uturnM = computeUTurnPenaltyMeters(candidate.points);
    const distanceErrorM = Math.abs(candidate.distanceKm - evaluationTargetKm) * 1000;
    const isClean = elevationOverM <= elevationToleranceM && uturnM <= UTURN_TOLERANCE_M && distanceErrorM <= distanceToleranceM;

    if (isClean) {
      const windScore = wind ? computeWindScore(candidate.points, wind.directionFromDeg) : 0;
      const directionScore = desiredBearing !== null ? computeDirectionScore(candidate.points, desiredBearing) : 0;
      const preference = windScore * WIND_WEIGHT + directionScore * DIRECTION_WEIGHT;
      if (preference > bestCleanPreference) {
        bestClean = candidate;
        bestCleanPreference = preference;
        bestCleanWindScore = windScore;
        bestCleanDirectionScore = directionScore;
        bestCleanUTurnM = uturnM;
      }
      // Sans préférence vent/direction à départager, le premier candidat
      // propre suffit. Sinon il faut en comparer plusieurs.
      if (!wind && desiredBearing === null) break;
    } else {
      const defect = elevationOverM + uturnM + distanceErrorM;
      if (defect < bestDirtyDefect) {
        bestDirty = candidate;
        bestDirtyDefect = defect;
        bestDirtyUTurnM = uturnM;
      }
    }
  }

  if (bestClean) {
    return {
      best: bestClean,
      isClean: true,
      windScore: bestCleanWindScore,
      directionScore: bestCleanDirectionScore,
      uturnPenaltyM: bestCleanUTurnM,
      lastError,
    };
  }

  return {
    best: bestDirty,
    isClean: false,
    windScore: 0,
    directionScore: 0,
    uturnPenaltyM: bestDirtyUTurnM,
    lastError,
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
  const { lat, lng, targetDistanceKm, maxElevationM, profile, durationHours, flatSpeedKmh } = body;
  const wantsStrictSurface = body.avoidRoughSurfaces === true;
  const wantsWindOptimization = body.optimizeForWind === true;
  const hasDirection = Number.isFinite(body.aimLat) && Number.isFinite(body.aimLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(targetDistanceKm) || targetDistanceKm <= 0) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }

  const wind = wantsWindOptimization ? await fetchWind(lat, lng) : null;
  const desiredBearing = hasDirection ? bearingDegrees(lat, lng, body.aimLat as number, body.aimLng as number) : null;

  let result = await searchCandidates(
    apiKey,
    profile,
    lat,
    lng,
    targetDistanceKm,
    maxElevationM,
    wantsStrictSurface,
    wind,
    desiredBearing
  );
  let refinedForTerrain = false;
  let refinedForDistance = false;

  if (result.best) {
    // Volontairement pas conditionné à result.isClean : un dépassement de
    // distance (nouveau critère de "propreté") est justement l'un des cas
    // que cette correction doit rattraper, pas un cas à ignorer parce que
    // la 1ère tentative est déjà classée "sale" à cause de lui.
    //
    // "D+ maximum" est un plafond, pas un D+ garanti : l'estimation initiale
    // de distance suppose pourtant, faute de mieux, qu'on va grimper tout ce
    // plafond (voir lib/speedModel.ts). Si le terrain réel autour du départ
    // s'avère bien moins pentu, on a inutilement raccourci la distance pour
    // rien — on recalcule alors une distance plus généreuse à partir du D+
    // réellement trouvé.
    let desiredDistanceKm = targetDistanceKm;
    if (Number.isFinite(durationHours) && Number.isFinite(flatSpeedKmh) && result.best.ascentM < maxElevationM * REFINEMENT_ASCENT_RATIO) {
      desiredDistanceKm = estimateRideDistanceKm(
        { flatSpeedKmh, secondsPerMeterClimbed: DEFAULT_ATHLETE_PROFILE.secondsPerMeterClimbed },
        durationHours,
        result.best.ascentM
      );
      if (Math.abs(desiredDistanceKm - targetDistanceKm) > targetDistanceKm * REFINEMENT_MIN_CHANGE_RATIO) {
        refinedForTerrain = true;
      }
    }

    // L'algorithme round_trip d'ORS est approximatif : la boucle obtenue
    // peut être sensiblement plus longue ou plus courte que la longueur
    // demandée. On mesure cet écart sur la première tentative et on corrige
    // la longueur demandée en conséquence pour la seconde, en visant
    // toujours desiredDistanceKm (qui intègre déjà la correction terrain
    // ci-dessus s'il y en a une).
    const bias = result.best.distanceKm > 0.1 ? result.best.distanceKm / targetDistanceKm : 1;
    const correctedRequestKm = desiredDistanceKm / bias;
    if (bias !== 1 && Math.abs(correctedRequestKm - desiredDistanceKm) > desiredDistanceKm * REFINEMENT_MIN_CHANGE_RATIO) {
      refinedForDistance = true;
    }

    if (refinedForTerrain || refinedForDistance) {
      const refined = await searchCandidates(
        apiKey,
        profile,
        lat,
        lng,
        correctedRequestKm,
        maxElevationM,
        wantsStrictSurface,
        wind,
        desiredBearing,
        desiredDistanceKm
      );
      const currentError = Math.abs(result.best.distanceKm - desiredDistanceKm);
      const refinedError = refined.best ? Math.abs(refined.best.distanceKm - desiredDistanceKm) : Infinity;
      if (refined.isClean && refined.best && refinedError < currentError) {
        result = refined;
      } else {
        refinedForTerrain = false;
        refinedForDistance = false;
      }
    }
  }

  if (!result.best) {
    return NextResponse.json(
      {
        error: `Impossible de générer un itinéraire ici. Essaie un autre point de départ ou une autre distance.${
          result.lastError ? ` (${result.lastError})` : ''
        }`,
      },
      { status: 502 }
    );
  }

  const response: GeneratedRoute = {
    ...result.best,
    wind,
    windScore: result.windScore,
    directionScore: desiredBearing !== null ? result.directionScore : null,
    uturnPenaltyM: Math.round(result.uturnPenaltyM),
    refinedForTerrain,
    refinedForDistance,
  };
  return NextResponse.json(response);
}
