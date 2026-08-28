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

const aimIcon = L.divIcon({
  html: '🧭',
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

interface RouteMapProps {
  start: { lat: number; lng: number };
  aimPoint: { lat: number; lng: number } | null;
  awaitingAimClick: boolean;
  onMapClick: (lat: number, lng: number) => void;
  route: RoutePoint[] | null;
}

function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function RouteMap({ start, aimPoint, awaitingAimClick, onMapClick, route }: RouteMapProps) {
  const positions = route?.map((p) => [p.lat, p.lng] as [number, number]) ?? [];

  return (
    <MapContainer
      center={[start.lat, start.lng]}
      zoom={13}
      style={{ height: '100%', width: '100%', cursor: awaitingAimClick ? 'crosshair' : undefined }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onMapClick={onMapClick} />
      <Marker position={[start.lat, start.lng]} />
      {aimPoint && (
        <>
          <Marker position={[aimPoint.lat, aimPoint.lng]} icon={aimIcon} />
          <Polyline
            positions={[
              [start.lat, start.lng],
              [aimPoint.lat, aimPoint.lng],
            ]}
            color="#9333ea"
            weight={2}
            dashArray="6 8"
          />
        </>
      )}
      {positions.length > 0 && <Polyline positions={positions} color="#2563eb" weight={4} />}
    </MapContainer>
  );
}
