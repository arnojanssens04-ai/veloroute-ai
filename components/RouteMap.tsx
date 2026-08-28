'use client';

import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { RoutePoint } from '@/lib/types';

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface RouteMapProps {
  start: { lat: number; lng: number };
  onStartChange: (lat: number, lng: number) => void;
  route: RoutePoint[] | null;
}

function ClickHandler({ onStartChange }: { onStartChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onStartChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function RouteMap({ start, onStartChange, route }: RouteMapProps) {
  const positions = route?.map((p) => [p.lat, p.lng] as [number, number]) ?? [];

  return (
    <MapContainer center={[start.lat, start.lng]} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onStartChange={onStartChange} />
      <Marker position={[start.lat, start.lng]} />
      {positions.length > 0 && <Polyline positions={positions} color="#2563eb" weight={4} />}
    </MapContainer>
  );
}
