import { Cartesian3, Math as CesiumMath, PerspectiveFrustum, Viewer } from 'cesium';

// Manages First Person Camera control logic
export class FPController {
  private viewer: Viewer;
  private moveSpeed = 2.0; // meters per second
  private lookSpeed = 0.002; // radians per pixel

  private keys = {
    w: false,
    a: false,
    s: false,
    d: false,
  };

  private enabled = false;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    this.setupListeners();
  }

  private setupListeners() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
        this.keys.w = false;
        this.keys.a = false;
        this.keys.s = false;
        this.keys.d = false;
    }
  }

  public update(dt: number) {
      if (!this.enabled) return;

      const camera = this.viewer.camera;
      const moveDistance = this.moveSpeed * dt;

      const forward = camera.direction.clone();
      const right = camera.right.clone();

      // 1. Find Globe Up at current position
      const position = camera.positionWC;
      const globeUp = Cartesian3.normalize(position, new Cartesian3());

      // 2. Project Forward and Right onto the plane defined by GlobeUp
      const forwardDotUp = Cartesian3.dot(forward, globeUp);
      let forwardFlat = Cartesian3.subtract(
          forward,
          Cartesian3.multiplyByScalar(globeUp, forwardDotUp, new Cartesian3()),
          new Cartesian3()
      );
      forwardFlat = Cartesian3.normalize(forwardFlat, forwardFlat);

      const rightDotUp = Cartesian3.dot(right, globeUp);
      let rightFlat = Cartesian3.subtract(
          right,
          Cartesian3.multiplyByScalar(globeUp, rightDotUp, new Cartesian3()),
          new Cartesian3()
      );
      rightFlat = Cartesian3.normalize(rightFlat, rightFlat);

      // Apply movement
      if (this.keys.w) {
          camera.move(forwardFlat, moveDistance);
      }
      if (this.keys.s) {
          camera.move(forwardFlat, -moveDistance);
      }
      if (this.keys.d) {
          camera.move(rightFlat, moveDistance);
      }
      if (this.keys.a) {
          camera.move(rightFlat, -moveDistance);
      }
  }

  // Handle Look via mouse movement - FPS style in-place rotation
  public handleMouseMove(movementX: number, movementY: number) {
      if (!this.enabled) return;
      const camera = this.viewer.camera;

      // Intuitive: drag right = look right
      camera.lookRight(movementX * this.lookSpeed);

      // Intuitive: drag up = look up (INVERTED from lookUp's default)
      camera.lookUp(-movementY * this.lookSpeed);

      // Lock roll and clamp pitch to prevent black sky (going upside down)
      const maxPitch = CesiumMath.toRadians(89);
      const minPitch = CesiumMath.toRadians(-89);
      let pitch = camera.pitch;
      if (pitch > maxPitch) pitch = maxPitch;
      if (pitch < minPitch) pitch = minPitch;

      camera.setView({
          orientation: {
              heading: camera.heading,
              pitch: pitch,
              roll: 0
          }
      });
  }

  public handleWheel(delta: number) {
      if (!this.enabled) return;
      const camera = this.viewer.camera;

      const frustum = camera.frustum as PerspectiveFrustum;
      if (frustum.fov !== undefined) {
          const currentFov = frustum.fov;
          const sensitivity = 0.001;
          let newFov = currentFov + delta * sensitivity;
          newFov = Math.max(CesiumMath.toRadians(10), Math.min(CesiumMath.toRadians(120), newFov));
          frustum.fov = newFov;
      }
  }

  public destroy() {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      switch (e.key.toLowerCase()) {
        case 'w': this.keys.w = true; break;
        case 'a': this.keys.a = true; break;
        case 's': this.keys.s = true; break;
        case 'd': this.keys.d = true; break;
      }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w': this.keys.w = false; break;
        case 'a': this.keys.a = false; break;
        case 's': this.keys.s = false; break;
        case 'd': this.keys.d = false; break;
      }
  };
}
