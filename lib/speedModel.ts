import type { AthleteSpeedProfile } from './types';

export function estimateSpeedKmh(
  profile: AthleteSpeedProfile,
  maxElevationM: number,
  distanceKm: number
): number {
  if (distanceKm <= 0) return profile.flatSpeedKmh;
  const gainPerKm = maxElevationM / distanceKm;
  const speed = profile.flatSpeedKmh - profile.elevationPenaltyKmhPerMkm * gainPerKm;
  return Math.max(speed, profile.minSpeedKmh);
}

export function estimateRideDistanceKm(
  profile: AthleteSpeedProfile,
  durationHours: number,
  maxElevationM: number
): number {
  let distanceKm = profile.flatSpeedKmh * durationHours;
  for (let i = 0; i < 8; i++) {
    const speed = estimateSpeedKmh(profile, maxElevationM, distanceKm);
    distanceKm = speed * durationHours;
  }
  return Math.max(distanceKm, 1);
}
