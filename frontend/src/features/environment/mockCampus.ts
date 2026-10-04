import scene from "../../../../backend/app/data/point_clouds/mock-campus.json";
import type { SceneInput } from "./sceneInput";
import type { Vector3 } from "../../api/pointCloud";

/** One shared mock transform for image, point cloud and demonstration task markers. */
export const mockCampus = scene;
export function imageToMockLocal(x: number, y: number, z = 0): Vector3 {
  return [(x - scene.image_origin_px[0]) * scene.metres_per_pixel,
    (scene.image_origin_px[1] - y) * scene.metres_per_pixel, z];
}
export function mockLocalToImage(x: number, y: number): [number, number] {
  return [x / scene.metres_per_pixel + scene.image_origin_px[0],
    scene.image_origin_px[1] - y / scene.metres_per_pixel];
}
export function isMockCampus(input: SceneInput): boolean {
  return input.dataset === "campus" && input.file === scene.point_cloud_file;
}
