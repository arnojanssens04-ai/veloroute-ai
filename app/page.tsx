'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import ControlsPanel from '@/components/ControlsPanel';
import ElevationProfile from '@/components/ElevationProfile';
import { ATHLETE_PROFILE_SOURCE, DEFAULT_ATHLETE_PROFILE } from '@/lib/athleteProfile';
import { downloadGpx } from '@/lib/gpx';
import { estimateRideDistanceKm } from '@/lib/speedModel';
import type { CyclingProfile, GeneratedRoute } from '@/lib/types';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });

const FALLBACK_START = { lat: 48.8566, lng: 2.3522 };

export default function Home() {
  const [start, setStart] = useState<{ lat: number; lng: number } | null>(null);
  const [durationMin, setDurationMin] = useState(90);
  const [maxElevationM, setMaxElevationM] = useState(400);
  const [speedKmh, setSpeedKmh] = useState(DEFAULT_ATHLETE_PROFILE.flatSpeedKmh);
  const [profile, setProfile] = useState<CyclingProfile>('cycling-road');
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
          profile,
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
        <p className="text-sm text-slate-500 mb-4">
          Vitesse de base calibrée sur tes {ATHLETE_PROFILE_SOURCE.rideCount} dernières sorties Strava (~
          {ATHLETE_PROFILE_SOURCE.recentWeightedAvgSpeedKmh} km/h de moyenne).
        </p>
        <ControlsPanel
          durationMin={durationMin}
          onDurationChange={setDurationMin}
          maxElevationM={maxElevationM}
          onMaxElevationChange={setMaxElevationM}
          speedKmh={speedKmh}
          onSpeedChange={setSpeedKmh}
          profile={profile}
          onProfileChange={setProfile}
          estimatedDistanceKm={estimatedDistanceKm}
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
                <div className="text-slate-500">Distance réelle</div>
                <div className="font-semibold">{route.distanceKm.toFixed(1)} km</div>
              </div>
              <div className="bg-slate-50 rounded p-2">
                <div className="text-slate-500">D+ réel</div>
                <div className="font-semibold">{route.ascentM} m</div>
              </div>
            </div>
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
          <RouteMap start={start} onStartChange={(lat, lng) => setStart({ lat, lng })} route={route?.points ?? null} />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400">Localisation en cours…</div>
        )}
      </div>
    </main>
  );
}
