import type { RoutePoint } from '@/lib/types';

interface ElevationProfileProps {
  points: RoutePoint[];
}

const WIDTH = 600;
const HEIGHT = 120;
const MARGIN = { top: 8, right: 8, bottom: 18, left: 34 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

function niceStep(range: number, targetTicks: number): number {
  const roughStep = range / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep || 1));
  const normalized = roughStep / magnitude;
  const niceNormalized = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return niceNormalized * magnitude;
}

export default function ElevationProfile({ points }: ElevationProfileProps) {
  if (points.length === 0) return null;

  const elevations = points.map((p) => p.ele);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const eleRange = Math.max(maxEle - minEle, 1);
  const maxDistance = points[points.length - 1].distanceKm || 1;

  const x = (km: number) => (km / maxDistance) * PLOT_WIDTH;
  const y = (ele: number) => PLOT_HEIGHT - ((ele - minEle) / eleRange) * PLOT_HEIGHT;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.distanceKm).toFixed(1)},${y(p.ele).toFixed(1)}`)
    .join(' ');
  const areaPath = `${path} L${PLOT_WIDTH},${PLOT_HEIGHT} L0,${PLOT_HEIGHT} Z`;

  const eleStep = niceStep(eleRange, 3);
  const eleTicks: number[] = [];
  for (let v = Math.ceil(minEle / eleStep) * eleStep; v <= maxEle; v += eleStep) {
    eleTicks.push(v);
  }
  if (eleTicks.length === 0) eleTicks.push(Math.round((minEle + maxEle) / 2));

  const kmStep = niceStep(maxDistance, 5);
  const kmTicks: number[] = [];
  for (let v = 0; v <= maxDistance; v += kmStep) {
    kmTicks.push(v);
  }
  if (kmTicks[kmTicks.length - 1] < maxDistance - kmStep * 0.25) {
    kmTicks.push(Math.round(maxDistance));
  }

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-32" preserveAspectRatio="none">
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {eleTicks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={PLOT_WIDTH} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={-6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#475569">
                {Math.round(tick)}m
              </text>
            </g>
          ))}
          <path d={areaPath} fill="rgba(37, 99, 235, 0.15)" />
          <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} />
          {kmTicks.map((tick) => (
            <text
              key={tick}
              x={x(tick)}
              y={PLOT_HEIGHT + 14}
              textAnchor={tick === 0 ? 'start' : tick >= maxDistance ? 'end' : 'middle'}
              fontSize={9}
              fill="#475569"
            >
              {tick.toFixed(0)}km
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
