import type { AthleteSpeedProfile } from './types';

// flatSpeedKmh : moyenne pondérée par la distance sur 18 sorties vélo
// extérieures réelles (344 km cumulés).
//
// secondsPerMeterClimbed : le D+ coûte un temps à peu près fixe, plutôt
// qu'une vitesse réduite sur toute la distance (un dénivelé concentré sur
// une courte section ne ralentit que cette section, le reste de la sortie
// roule à vitesse normale). Dérivé en régressant, sur ces mêmes 18 sorties,
// le "temps excédentaire" (temps réel − distance/flatSpeedKmh) contre le D+
// de la sortie — régression passant par l'origine, ~3.36 s/m. Autrement dit
// 400 m de D+ coûtent environ 22 minutes, quelle que soit la distance sur
// laquelle ce D+ est réparti. Modifiable dans l'UI.
export const DEFAULT_ATHLETE_PROFILE: AthleteSpeedProfile = {
  flatSpeedKmh: 24.5,
  secondsPerMeterClimbed: 3.36,
};

export const ATHLETE_PROFILE_SOURCE = {
  computedAt: '2026-08-28',
  rideCount: 18,
  totalDistanceKm: 344,
  recentWeightedAvgSpeedKmh: 21.4,
};
