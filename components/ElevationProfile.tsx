import type { RoutePoint } from '@/lib/types';

interface ElevationProfileProps {
  points: RoutePoint[];
}

export default function ElevationProfile({ points }: ElevationProfileProps) {
  if (points.length === 0) return null;

  const width = 600;
  const height = 120;
  const elevations = points.map((p) => p.ele);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const eleRange = Math.max(maxEle - minEle, 1);
  const maxDistance = points[points.length - 1].distanceKm || 1;

  const path = points
    .map((p, i) => {
      const x = (p.distanceKm / maxDistance) * width;
      const y = height - ((p.ele - minEle) / eleRange) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28" preserveAspectRatio="none">
        <path d={areaPath} fill="rgba(37, 99, 235, 0.15)" />
        <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} />
      </svg>
      <div className="flex justify-between text-xs text-slate-500 mt-1">
        <span>{minEle.toFixed(0)} m</span>
        <span>{maxEle.toFixed(0)} m</span>
      </div>
    </div>
  );
}
