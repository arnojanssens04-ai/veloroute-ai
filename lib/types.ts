export type CyclingProfile = 'cycling-road' | 'cycling-regular' | 'cycling-mountain';

export interface AthleteSpeedProfile {
  flatSpeedKmh: number;
  secondsPerMeterClimbed: number;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  ele: number;
  distanceKm: number;
}

export interface WindInfo {
  speedKmh: number;
  directionFromDeg: number;
}

export interface GeneratedRoute {
  points: RoutePoint[];
  distanceKm: number;
  ascentM: number;
  descentM: number;
  attempts: number;
  strictSurfaceApplied: boolean;
  wind: WindInfo | null;
  windScore: number;
}

export interface GenerateRouteRequest {
  lat: number;
  lng: number;
  targetDistanceKm: number;
  maxElevationM: number;
  profile: CyclingProfile;
  avoidRoughSurfaces: boolean;
  optimizeForWind: boolean;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}
