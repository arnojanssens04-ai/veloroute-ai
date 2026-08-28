import type { CyclingProfile } from '@/lib/types';

interface ControlsPanelProps {
  durationMin: number;
  onDurationChange: (v: number) => void;
  maxElevationM: number;
  onMaxElevationChange: (v: number) => void;
  speedKmh: number;
  onSpeedChange: (v: number) => void;
  profile: CyclingProfile;
  onProfileChange: (v: CyclingProfile) => void;
  avoidRoughSurfaces: boolean;
  onAvoidRoughSurfacesChange: (v: boolean) => void;
  estimatedDistanceKm: number;
  adjustedSpeedKmh: number;
  onGenerate: () => void;
  onRegenerate: () => void;
  hasRoute: boolean;
  loading: boolean;
  error: string | null;
}

const PROFILE_LABELS: Record<CyclingProfile, string> = {
  'cycling-regular': 'Polyvalent (pistes cyclables privilégiées)',
  'cycling-road': 'Vélo de route (priorité vitesse/directness)',
  'cycling-mountain': 'VTT (chemins et sentiers)',
};

const PROFILE_ORDER: CyclingProfile[] = ['cycling-regular', 'cycling-road', 'cycling-mountain'];

export default function ControlsPanel(props: ControlsPanelProps) {
  const {
    durationMin,
    onDurationChange,
    maxElevationM,
    onMaxElevationChange,
    speedKmh,
    onSpeedChange,
    profile,
    onProfileChange,
    avoidRoughSurfaces,
    onAvoidRoughSurfacesChange,
    estimatedDistanceKm,
    adjustedSpeedKmh,
    onGenerate,
    onRegenerate,
    hasRoute,
    loading,
    error,
  } = props;

  const hours = Math.floor(durationMin / 60);
  const minutes = durationMin % 60;

  return (
    <div className="space-y-5">
      <div>
        <label className="flex justify-between text-sm font-medium mb-1">
          <span>Durée de la sortie</span>
          <span className="text-slate-500">
            {hours}h{String(minutes).padStart(2, '0')}
          </span>
        </label>
        <input
          type="range"
          min={30}
          max={360}
          step={15}
          value={durationMin}
          onChange={(e) => onDurationChange(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div>
        <label className="flex justify-between text-sm font-medium mb-1">
          <span>D+ maximum</span>
          <span className="text-slate-500">{maxElevationM} m</span>
        </label>
        <input
          type="range"
          min={0}
          max={3000}
          step={50}
          value={maxElevationM}
          onChange={(e) => onMaxElevationChange(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Type de vélo</label>
        <select
          value={profile}
          onChange={(e) => onProfileChange(e.target.value as CyclingProfile)}
          className="w-full border border-slate-300 rounded-lg px-2 py-1.5"
        >
          {PROFILE_ORDER.map((key) => (
            <option key={key} value={key}>
              {PROFILE_LABELS[key]}
            </option>
          ))}
        </select>
        <p className="text-sm text-slate-600 mt-1">
          Les grands axes routiers sont toujours évités. « Polyvalent » privilégie en plus les pistes et bandes
          cyclables quand elles existent ; « Vélo de route » optimise l&apos;itinéraire le plus direct sur route
          goudronnée, quitte à partager la chaussée.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={avoidRoughSurfaces}
          onChange={(e) => onAvoidRoughSurfacesChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Éviter pavés et chemins non asphaltés
          <span className="block text-sm text-slate-600">
            Best-effort : si aucune boucle asphaltée n&apos;est trouvée, on repasse automatiquement sans ce filtre.
          </span>
        </span>
      </label>

      <div>
        <label className="block text-sm font-medium mb-1">Vitesse moyenne estimée (km/h)</label>
        <input
          type="number"
          min={5}
          max={50}
          step={0.5}
          value={speedKmh}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="w-full border border-slate-300 rounded-lg px-2 py-1.5"
        />
        <p className="text-sm text-slate-600 mt-1">Pré-remplie depuis ton historique Strava, modifiable.</p>
      </div>

      <div className="bg-blue-50 text-blue-900 text-sm rounded-lg p-3 space-y-1">
        <div>
          Distance ciblée : <strong>{estimatedDistanceKm.toFixed(1)} km</strong>
        </div>
        {adjustedSpeedKmh < speedKmh - 0.05 && (
          <div className="text-blue-800">
            Vitesse ajustée pour le D+ demandé : <strong>{adjustedSpeedKmh.toFixed(1)} km/h</strong> (au lieu de{' '}
            {speedKmh.toFixed(1)} km/h à plat)
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      <button
        onClick={hasRoute ? onRegenerate : onGenerate}
        disabled={loading}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Génération…' : hasRoute ? 'Régénérer une autre boucle' : 'Générer mon parcours'}
      </button>
    </div>
  );
}
