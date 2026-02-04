import { Viewer as CesiumViewer, Cartesian3, Cartesian2, Matrix3, Quaternion } from 'cesium';

export interface WindowSelection {
  center: Cartesian3;
  normal: Cartesian3;
  width: number;
  height: number;
  rotation: Quaternion;
}

/**
 * Calculates a surface normal at the picked position by sampling nearby points.
 * Since 3D Tiles don't give us easy normals, we estimate it from the depth buffer / geometry.
 */
export const calculateSurfaceNormal = (
  viewer: CesiumViewer,
  screenPosition: Cartesian2,
  pickedPosition: Cartesian3
): { normal: Cartesian3; rotation: Quaternion } | null => {
  const scene = viewer.scene;

  // Sample points around the center with a wider spread to capture surface slope
  // Small offsets on 3D tiles can be noisy or hit the same polygon which might be quantized.
  const offset = 10; // Increased from 2 to 10 pixels

  const width = scene.canvas.clientWidth;
  const height = scene.canvas.clientHeight;

  // Helpers to clamp to screen
  const clampX = (x: number) => Math.max(0, Math.min(x, width));
  const clampY = (y: number) => Math.max(0, Math.min(y, height));

  // 5-point stencil
  const center = screenPosition;
  const left = new Cartesian2(clampX(center.x - offset), center.y);
  const right = new Cartesian2(clampX(center.x + offset), center.y);
  const up = new Cartesian2(center.x, clampY(center.y - offset));
  const down = new Cartesian2(center.x, clampY(center.y + offset));

  // Pick worlds
  const pCenter = pickedPosition;
  const pLeft = scene.pickPosition(left);
  const pRight = scene.pickPosition(right);
  const pUp = scene.pickPosition(up);
  const pDown = scene.pickPosition(down);

  // We need at least 3 points to form a plane.
  // Best case: We use (Right - Left) and (Down - Up).
  // Check validity.
  if (!pCenter || !pLeft || !pRight || !pUp || !pDown) {
      console.warn("One of the sampled points was invalid");
      return null;
  }

  // Calculate tangent vectors
  // Horizontal vector (Left to Right)
  const tangentX = Cartesian3.subtract(pRight, pLeft, new Cartesian3());
  // Vertical vector (Up to Down) - Remember Y is Down in screen, but determining 3D structure
  const tangentY = Cartesian3.subtract(pDown, pUp, new Cartesian3());

  // Cross product
  // TangentX points roughly Right in World.
  // TangentY points roughly Down in World.
  // Right x Down -> Backwards (into screen).
  // So normal points INTO the wall.
  let normal = Cartesian3.cross(tangentX, tangentY, new Cartesian3());
  if (Cartesian3.magnitude(normal) < 1e-6) {
      console.warn("Degenerate normal");
      return null;
  }
  normal = Cartesian3.normalize(normal, normal);

  // Debug Log
  console.log("Calculated Normal (raw):", normal.toString());

  // FORCE HORIZONTAL: Project normal onto horizontal plane.
  // In ECEF, the "up" direction at any point is the normalized position vector.
  // To make a vector horizontal, we remove its component along "up".
  const globeUp = Cartesian3.normalize(pCenter, new Cartesian3());
  const normalDotUp = Cartesian3.dot(normal, globeUp);
  normal = Cartesian3.subtract(
      normal,
      Cartesian3.multiplyByScalar(globeUp, normalDotUp, new Cartesian3()),
      normal
  );
  if (Cartesian3.magnitude(normal) < 1e-6) {
      console.warn("Normal became zero after horizontal projection");
      return null;
  }
  normal = Cartesian3.normalize(normal, normal);

  console.log("Calculated Normal (horizontal):", normal.toString());

  // Correct orientation so it points OUT of the wall (Towards Camera)
  const cameraPosition = scene.camera.position;
  const toCamera = Cartesian3.subtract(cameraPosition, pCenter, new Cartesian3());

  // If dot < 0, it points AWAY from camera. We want it pointing TOWARDS camera (roughly).
  // Wait. A wall normal points OUT.
  // If we are looking at the wall, the normal points AT us.
  // So dot(Normal, ToCamera) should be POSITIVE.
  if (Cartesian3.dot(normal, toCamera) < 0) {
     normal = Cartesian3.negate(normal, normal);
  }

  // Compute rotation quaternion (tangent space)
  // We want a rotation that aligns the "Up" vector (Z or Y) with this normal.
  // In EntityBox, assuming normal is Y? Or X?
  // Let's assume we want to map: Box +Z to Normal?

  // Create a basis.
  // Normal is Z axis.
  // Use "World Up" (Vector away from center of earth) to find Right/X axis.
  const worldUp = Cartesian3.normalize(pCenter, new Cartesian3()); // Approximate Up (away from earth center)

  // If normal is very close to WorldUp, pick another vector.
  // We compute RightAxis = WorldUp x Normal
  let rightAxis = Cartesian3.cross(worldUp, normal, new Cartesian3());
  if (Cartesian3.magnitude(rightAxis) < 0.01) {
      rightAxis = Cartesian3.cross(Cartesian3.UNIT_X, normal, new Cartesian3());
  }
  rightAxis = Cartesian3.normalize(rightAxis, rightAxis);

  // Recompute UpAxis orthogonal to Normal and Right
  const upAxis = Cartesian3.cross(normal, rightAxis, new Cartesian3());

  // Construct Rotation Matrix
  // Columns: Right, Up, Normal -> X, Y, Z
  const rotationMatrix = new Matrix3();
  Matrix3.setColumn(rotationMatrix, 0, rightAxis, rotationMatrix);
  Matrix3.setColumn(rotationMatrix, 1, upAxis, rotationMatrix);
  Matrix3.setColumn(rotationMatrix, 2, normal, rotationMatrix);

  const rotation = Quaternion.fromRotationMatrix(rotationMatrix);

  return { normal, rotation };
};
