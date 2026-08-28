import type { AthleteSpeedProfile } from './types';

const MIN_RIDING_HOURS = 0.15;
const MIN_DISTANCE_KM = 3;

// Le D+ coûte un temps à peu près fixe (secondsPerMeterClimbed), pas une
// vitesse réduite étalée sur toute la distance : voir lib/athleteProfile.ts.
// Cette formule ne connaît que le D+ total demandé, pas comment il se
// répartit (une bosse raide de 30s vs une côte de 10min à même D+ cumulé) —
// cette information n'existe de toute façon pas encore à ce stade, puisque
// le tracé réel n'est généré qu'après ce calcul.
export function estimateRideDistanceKm(
  profile: AthleteSpeedProfile,
  durationHours: number,
  maxElevationM: number
): number {
  const climbingHours = (maxElevationM * profile.secondsPerMeterClimbed) / 3600;
  const ridingHours = Math.max(durationHours - climbingHours, MIN_RIDING_HOURS);
  return Math.max(profile.flatSpeedKmh * ridingHours, MIN_DISTANCE_KM);
}

export function averageSpeedKmh(distanceKm: number, durationHours: number): number {
  if (durationHours <= 0) return 0;
  return distanceKm / durationHours;
}
