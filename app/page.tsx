'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import ControlsPanel from '@/components/ControlsPanel';
import ElevationProfile from '@/components/ElevationProfile';
import StartPointSearch from '@/components/StartPointSearch';
import { ATHLETE_PROFILE_SOURCE, DEFAULT_ATHLETE_PROFILE } from '@/lib/athleteProfile';
import { bearingDegrees, haversineMeters } from '@/lib/geo';
import { downloadGpx } from '@/lib/gpx';
import { averageSpeedKmh, estimateRideDistanceKm } from '@/lib/speedModel';
import type { CyclingProfile, GeneratedRoute } from '@/lib/types';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });

const FALLBACK_START = { lat: 48.8566, lng: 2.3522 };

const COMPASS_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

function compassLabel(deg: number): string {
  return COMPASS_LABELS[Math.round(deg / 45) % 8];
}

function windQualityLabel(windScore: number): string {
  if (windScore > 0.15) return 'orientation favorable (face au vent à l’aller, dans le dos au retour)';
  if (windScore < -0.15) return 'orientation défavorable (dans le dos à l’aller, de face au retour)';
  return 'orientation neutre par rapport au vent';
}

function directionQualityLabel(directionScore: number): string {
  if (directionScore > 0.7) return 'direction bien respectée';
  if (directionScore > 0.3) return 'direction partiellement respectée';
  return 'peu de boucles allaient dans cette direction ici';
}

export default function Home() {
  const [start, setStart] = useState<{ lat: number; lng: number } | null>(null);
  const [durationMin, setDurationMin] = useState(90);
  const [maxElevationM, setMaxElevationM] = useState(400);
  const [speedKmh, setSpeedKmh] = useState(DEFAULT_ATHLETE_PROFILE.flatSpeedKmh);
  const [profile, setProfile] = useState<CyclingProfile>('cycling-regular');
  const [avoidRoughSurfaces, setAvoidRoughSurfaces] = useState(false);
  const [optimizeForWind, setOptimizeForWind] = useState(false);
  const [aimPoint, setAimPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [awaitingAimClick, setAwaitingAimClick] = useState(false);
  const [route, setRoute] = useState<GeneratedRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setStart(FALLBACK_START);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setStart({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setStart(FALLBACK_START),
      { timeout: 5000 }
    );
  }, []);

  const estimatedDistanceKm = useMemo(() => {
    const athleteProfile = { ...DEFAULT_ATHLETE_PROFILE, flatSpeedKmh: speedKmh };
    return estimateRideDistanceKm(athleteProfile, durationMin / 60, maxElevationM);
  }, [speedKmh, durationMin, maxElevationM]);

  const adjustedSpeedKmh = useMemo(() => {
    return averageSpeedKmh(estimatedDistanceKm, durationMin / 60);
  }, [estimatedDistanceKm, durationMin]);

  const aimInfo = useMemo(() => {
    if (!start || !aimPoint) return null;
    const bearing = bearingDegrees(start.lat, start.lng, aimPoint.lat, aimPoint.lng);
    const distanceKm = haversineMeters(start.lat, start.lng, aimPoint.lat, aimPoint.lng) / 1000;
    return { bearing, distanceKm };
  }, [start, aimPoint]);

  function handleMapClick(lat: number, lng: number) {
    if (awaitingAimClick) {
      setAimPoint({ lat, lng });
      setAwaitingAimClick(false);
    } else {
      setStart({ lat, lng });
    }
  }

  async function generate() {
    if (!start) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: start.lat,
          lng: start.lng,
          targetDistanceKm: estimatedDistanceKm,
          maxElevationM,
          durationHours: durationMin / 60,
          flatSpeedKmh: speedKmh,
          profile,
          avoidRoughSurfaces,
          optimizeForWind,
          ...(aimPoint ? { aimLat: aimPoint.lat, aimLng: aimPoint.lng } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erreur inconnue');
      setRoute(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
      setRoute(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!route) return;
    const durationLabel = `${Math.floor(durationMin / 60)}h${String(durationMin % 60).padStart(2, '0')}`;
    downloadGpx(route.points, `VeloRoute-${durationLabel}-${new Date().toISOString().slice(0, 10)}`);
  }

  return (
    <main className="flex flex-col md:flex-row h-screen">
      <div className="md:w-96 w-full p-4 overflow-y-auto border-r border-slate-200 bg-white">
        <h1 className="text-xl font-bold mb-1">VeloRoute AI</h1>
        <p className="text-sm text-slate-600 mb-4">
          Vitesse de base calibrée sur tes {ATHLETE_PROFILE_SOURCE.rideCount} dernières sorties Strava (~
          {ATHLETE_PROFILE_SOURCE.recentWeightedAvgSpeedKmh} km/h de moyenne).
        </p>
        <div className="mb-5">
          <StartPointSearch start={start} onSelect={(lat, lng) => setStart({ lat, lng })} />
        </div>
        <div className="mb-5">
          <label className="block text-sm font-medium mb-1">Direction souhaitée (optionnel)</label>
          {aimPoint && aimInfo ? (
            <div className="flex items-center justify-between gap-2 text-sm bg-purple-50 text-purple-900 rounded-lg px-3 py-2">
              <span>
                🧭 Vers le {compassLabel(aimInfo.bearing)}, à {aimInfo.distanceKm.toFixed(1)} km du départ
              </span>
              <button
                onClick={() => setAimPoint(null)}
                className="shrink-0 text-purple-700 hover:underline"
              >
                Effacer
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAwaitingAimClick(true)}
              className={`w-full border rounded-lg px-3 py-2 text-sm font-medium ${
                awaitingAimClick
                  ? 'border-purple-500 bg-purple-50 text-purple-700'
                  : 'border-slate-300 hover:bg-slate-50'
              }`}
            >
              {awaitingAimClick ? 'Clique sur la carte pour indiquer une direction…' : '🧭 Choisir une direction sur la carte'}
            </button>
          )}
        </div>
        <ControlsPanel
          durationMin={durationMin}
          onDurationChange={setDurationMin}
          maxElevationM={maxElevationM}
          onMaxElevationChange={setMaxElevationM}
          speedKmh={speedKmh}
          onSpeedChange={setSpeedKmh}
          profile={profile}
          onProfileChange={setProfile}
          avoidRoughSurfaces={avoidRoughSurfaces}
          onAvoidRoughSurfacesChange={setAvoidRoughSurfaces}
          optimizeForWind={optimizeForWind}
          onOptimizeForWindChange={setOptimizeForWind}
          estimatedDistanceKm={estimatedDistanceKm}
          adjustedSpeedKmh={adjustedSpeedKmh}
          onGenerate={generate}
          onRegenerate={generate}
          hasRoute={route !== null}
          loading={loading}
          error={error}
        />
        {route && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-slate-50 rounded p-2">
                <div className="text-slate-600">Distance réelle</div>
                <div className="font-semibold">{route.distanceKm.toFixed(1)} km</div>
              </div>
              <div className="bg-slate-50 rounded p-2">
                <div className="text-slate-600">D+ réel</div>
                <div className="font-semibold">{route.ascentM} m</div>
              </div>
            </div>
            {route.refinedForTerrain && (
              <p className="text-sm text-emerald-700">
                ↗️ Terrain moins pentu que le D+ maximum autorisé : distance recalculée à la hausse pour mieux
                remplir ta durée.
              </p>
            )}
            {avoidRoughSurfaces && (
              <p className="text-sm text-slate-600">
                {route.strictSurfaceApplied
                  ? '✓ Filtre revêtement asphalté appliqué.'
                  : "⚠️ Aucune boucle asphaltée trouvée ici : filtre revêtement ignoré pour ce résultat."}
              </p>
            )}
            {optimizeForWind && (
              <p className="text-sm text-slate-600">
                {route.wind
                  ? `💨 Vent : ${route.wind.speedKmh.toFixed(0)} km/h du ${compassLabel(
                      route.wind.directionFromDeg
                    )} — ${windQualityLabel(route.windScore)}.`
                  : "⚠️ Données de vent indisponibles pour ce résultat : orientation non optimisée."}
              </p>
            )}
            {aimPoint && route.directionScore !== null && (
              <p className="text-sm text-slate-600">🧭 {directionQualityLabel(route.directionScore)}.</p>
            )}
            {route.uturnPenaltyM > 150 && (
              <p className="text-sm text-amber-700">
                ⚠️ Ce tracé contient un aller-retour sur une petite portion (~{route.uturnPenaltyM} m) — fréquent
                dans les zones peu maillées. Essaie « Régénérer » pour tenter d&apos;en obtenir un sans.
              </p>
            )}
            <ElevationProfile points={route.points} />
            <button
              onClick={handleExport}
              className="w-full bg-emerald-600 text-white rounded-lg py-2 font-medium hover:bg-emerald-700"
            >
              Télécharger le GPX (Garmin Connect)
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-[300px]">
        {start ? (
          <RouteMap
            start={start}
            aimPoint={aimPoint}
            awaitingAimClick={awaitingAimClick}
            onMapClick={handleMapClick}
            route={route?.points ?? null}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400">Localisation en cours…</div>
        )}
      </div>
    </main>
  );
}
