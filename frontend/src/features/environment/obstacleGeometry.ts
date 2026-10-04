import type { Obstacle } from "../../api/pointCloud";

export type SceneProjection = 1 | 2;
export type ObstacleBounds = { minimum: [number, number]; maximum: [number, number] };

/** Project the actual bounding box to XY or XZ, without image registration or safety padding. */
export function obstacleBounds(obstacle: Obstacle, vertical: SceneProjection): ObstacleBounds | null {
  const minimum: [number, number] = [obstacle.position[0] - obstacle.size[0] / 2, obstacle.position[vertical] - obstacle.size[vertical] / 2];
  const maximum: [number, number] = [obstacle.position[0] + obstacle.size[0] / 2, obstacle.position[vertical] + obstacle.size[vertical] / 2];
  return [...minimum, ...maximum, maximum[0] - minimum[0], maximum[1] - minimum[1]].every(Number.isFinite) ? { minimum, maximum } : null;
}

/** Camera padding affects the viewport only, never the obstacle geometry. */
export function sceneBounds(obstacles: Obstacle[], vertical: SceneProjection): ObstacleBounds | null {
  if (!obstacles.length) return { minimum: [-10, -10], maximum: [10, 10] };
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const obstacle of obstacles) {
    const bounds = obstacleBounds(obstacle, vertical);
    if (!bounds) return null;
    xmin = Math.min(xmin, bounds.minimum[0]); ymin = Math.min(ymin, bounds.minimum[1]);
    xmax = Math.max(xmax, bounds.maximum[0]); ymax = Math.max(ymax, bounds.maximum[1]);
  }
  const span = Math.max(xmax - xmin, ymax - ymin, 1);
  // Leaflet's pixel transform must remain finite and meaningful at available zoom levels.
  if (!Number.isFinite(span) || Math.max(Math.abs(xmin), Math.abs(ymin), Math.abs(xmax), Math.abs(ymax), span) > 1e9) return null;
  const padding = span * 0.15;
  return { minimum: [xmin - padding, ymin - padding], maximum: [xmax + padding, ymax + padding] };
}
