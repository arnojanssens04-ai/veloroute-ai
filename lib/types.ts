export type CyclingProfile = 'cycling-road' | 'cycling-regular' | 'cycling-mountain';

export interface AthleteSpeedProfile {
  flatSpeedKmh: number;
  elevationPenaltyKmhPerMkm: number;
  minSpeedKmh: number;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  ele: number;
  distanceKm: number;
}

export interface GeneratedRoute {
  points: RoutePoint[];
  distanceKm: number;
  ascentM: number;
  descentM: number;
  attempts: number;
  strictSurfaceApplied: boolean;
}

export interface GenerateRouteRequest {
  lat: number;
  lng: number;
  targetDistanceKm: number;
  maxElevationM: number;
  profile: CyclingProfile;
  avoidRoughSurfaces: boolean;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}
