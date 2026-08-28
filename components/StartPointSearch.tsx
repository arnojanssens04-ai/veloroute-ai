import { useState } from 'react';
import type { GeocodeResult } from '@/lib/types';

interface StartPointSearchProps {
  start: { lat: number; lng: number } | null;
  onSelect: (lat: number, lng: number) => void;
}

export default function StartPointSearch({ start, onSelect }: StartPointSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setResults([]);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } finally {
      setSearching(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onSelect(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 }
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1">Point de départ</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Adresse, ville…"
          className="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5"
        />
        <button
          onClick={search}
          disabled={searching}
          className="shrink-0 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          {searching ? '…' : 'Chercher'}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="mt-1 border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
          {results.map((r) => (
            <li key={`${r.lat}-${r.lng}`}>
              <button
                onClick={() => {
                  onSelect(r.lat, r.lng);
                  setResults([]);
                  setQuery(r.label);
                }}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between mt-1.5">
        <button
          onClick={useMyLocation}
          disabled={locating}
          className="text-sm text-blue-700 hover:underline disabled:opacity-50"
        >
          {locating ? 'Localisation…' : '📍 Utiliser ma position'}
        </button>
        {start && (
          <span className="text-xs text-slate-600">
            {start.lat.toFixed(4)}, {start.lng.toFixed(4)}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600 mt-1">Tu peux aussi cliquer directement sur la carte pour déplacer le départ.</p>
    </div>
  );
}
