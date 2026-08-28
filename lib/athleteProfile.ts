import type { AthleteSpeedProfile } from './types';

// Dérivé d'une régression linéaire vitesse (km/h) vs dénivelé/km (m/km) sur les
// 18 sorties vélo extérieures des ~60 dernières activités Strava d'Arnaud
// (344 km cumulés, vitesse moyenne pondérée ~21.4 km/h). Modifiable dans l'UI.
export const DEFAULT_ATHLETE_PROFILE: AthleteSpeedProfile = {
  flatSpeedKmh: 24.5,
  elevationPenaltyKmhPerMkm: 0.5,
  minSpeedKmh: 10,
};

export const ATHLETE_PROFILE_SOURCE = {
  computedAt: '2026-08-28',
  rideCount: 18,
  totalDistanceKm: 344,
  recentWeightedAvgSpeedKmh: 21.4,
};
