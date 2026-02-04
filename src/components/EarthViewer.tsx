import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Viewer, Entity, ScreenSpaceEventHandler, ScreenSpaceEvent } from 'resium';
import { Cartesian3, Color, Viewer as CesiumViewer, Math as CesiumMath, createGooglePhotorealistic3DTileset, ScreenSpaceEventType, PerspectiveFrustum, Matrix3, Cartesian2 } from 'cesium';
import * as Cesium from 'cesium';
import { calculateSurfaceNormal, type WindowSelection } from '../logic/WindowSelector';
import { FPController } from '../logic/FPController';

interface EarthViewerProps {
  googleMapsApiKey: string;
  onWindowSelected: (selection: WindowSelection) => void;
  onCameraChange?: (cam: { x:number, y:number, z:number, h:number, p:number, r:number }) => void;
  selectionMode: boolean;
  viewWindow: WindowSelection | null;
  isInsideView: boolean;
  initialCamera?: { x:number, y:number, z:number, h:number, p:number, r:number } | null;
}

export const EarthViewer = React.memo<EarthViewerProps>(({
  googleMapsApiKey,
  onWindowSelected,
  onCameraChange,
  selectionMode,
  viewWindow,
  isInsideView,
  initialCamera
}) => {
  const [viewer, setViewer] = useState<CesiumViewer | null>(null);
  const [tileset, setTileset] = useState<any>(null);
  const fpControllerRef = useRef<FPController | null>(null);
  const draggingRef = useRef(false);
  const lastCameraUpdateRef = useRef(0);
  const initialRestoredRef = useRef(false);

  const viewerCallback = useCallback((ref: any) => {
      if (ref && ref.cesiumElement) {
          setViewer(ref.cesiumElement);
      }
  }, []);

  useEffect(() => {
    const loadTiles = async () => {
      try {
        const ts = await createGooglePhotorealistic3DTileset({ key: googleMapsApiKey });
        setTileset(ts);
      } catch (error) {
        console.error("Failed to load 3D tiles", error);
      }
    };
    if (googleMapsApiKey) {
      loadTiles();
    }
  }, [googleMapsApiKey]);

  useEffect(() => {
    if (viewer && tileset) {
        viewer.scene.primitives.add(tileset);

        // CRITICAL: Prevent skybox from disappearing
        viewer.scene.globe.showGroundAtmosphere = false; // Disable ground atmosphere which can hide sky
        viewer.scene.globe.enableLighting = false; // Disable lighting that might cause dark sky

        if (viewer.camera.positionCartographic.height > 10000000 && !initialCamera) {
             viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(-74.0060, 40.7128, 500),
                orientation: {
                    heading: CesiumMath.toRadians(0),
                    pitch: CesiumMath.toRadians(-45),
                    roll: 0
                }
            });
        }
    }
    return () => {
        if (viewer && tileset) {
             viewer.scene.primitives.remove(tileset);
        }
    }
  }, [tileset, viewer, initialCamera]);

  const handleLeftClick = (movement: any) => {
    if (!selectionMode || !viewer || isInsideView) return;

    const position = movement.position;
    const pickedPosition = viewer.scene.pickPosition(position);

    if (pickedPosition) {
        const existingWidth = viewWindow?.width || 2.0;
        const existingHeight = viewWindow?.height || 3.0;

        const result = calculateSurfaceNormal(viewer, position, pickedPosition);
        if (result) {
            onWindowSelected({
                center: pickedPosition,
                normal: result.normal,
                rotation: result.rotation,
                width: existingWidth,
                height: existingHeight
            });
        }
    }
  };

  // Init Controller and Global Camera Tracking
  useEffect(() => {
    if (!viewer) return;

    fpControllerRef.current = new FPController(viewer);

    const onTick = () => {
        fpControllerRef.current?.update(0.016);

        // Broadcast camera state ALWAYS (throttled)
        if (onCameraChange) {
            const now = Date.now();
            if (now - lastCameraUpdateRef.current > 500) { // Update every 500ms
                const cam = viewer.camera;
                const pos = cam.position;
                const h = cam.heading;
                const p = cam.pitch;
                const r = cam.roll;

                onCameraChange({
                    x: pos.x, y: pos.y, z: pos.z,
                    h, p, r
                });
                lastCameraUpdateRef.current = now;
            }
        }
    };

    viewer.clock.onTick.addEventListener(onTick);
    return () => {
        viewer.clock.onTick.removeEventListener(onTick);
        fpControllerRef.current?.destroy();
    };
  }, [viewer, onCameraChange]);

  // Camera Mode Switch
  useEffect(() => {
      if (!viewer || !fpControllerRef.current) return;

      const controller = fpControllerRef.current;

      // DISABLE COLLISION DETECTION to prevent roof snapping
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;

      console.log(`Mode Update: ${isInsideView ? 'Inside' : 'Outside'}`);

      if (isInsideView && viewWindow) {
          controller.setEnabled(true);

          // Granularly disable default inputs to prevent fighting
          const ssc = viewer.scene.screenSpaceCameraController;
          ssc.enableInputs = false;
          ssc.enableRotate = false;
          ssc.enableTranslate = false;
          ssc.enableZoom = false;
          ssc.enableTilt = false;
          ssc.enableLook = false;

          // Prevent skybox from disappearing & Provide Blue Sky:
          // Disable dynamic atmosphere/globe to avoid artifacts.
          // Hide Starry SkyBox and set background to Blue to simulate day sky.
          if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
          viewer.scene.globe.show = false;
          if (viewer.scene.skyBox) viewer.scene.skyBox.show = false; // Hide stars
          viewer.scene.backgroundColor = Color.fromCssColorString('#87CEEB'); // Sky Blue

          // Disable fog
          viewer.scene.fog.enabled = false;

          // Adjust near plane to clip through nearby building geometry
          const frustum = viewer.camera.frustum as PerspectiveFrustum;
          if (frustum.near !== undefined) {
              frustum.near = 0.1; // Aggressive clipping for inside view
          }

          let destination: Cartesian3;
          let orientation: any;


          if (initialCamera && !initialRestoredRef.current) {
              console.log("Restoring Initial Camera (Inside)", initialCamera);
              // Instant restore
              viewer.camera.setView({
                  destination: new Cartesian3(initialCamera.x, initialCamera.y, initialCamera.z),
                  orientation: {
                      heading: initialCamera.h,
                      pitch: initialCamera.p,
                      roll: initialCamera.r
                  }
              });
              initialRestoredRef.current = true;
          } else {
              console.log("Entering Window View (Standard)");
              const { center, normal, height } = viewWindow;
              const offset = 2.5;
              const eyeOffset = 1.4 - (height / 2);
              const upVector = new Cartesian3(0,0,1);

              destination = Cartesian3.add(
                  Cartesian3.subtract(
                     center,
                     Cartesian3.multiplyByScalar(normal, offset, new Cartesian3()),
                     new Cartesian3()
                  ),
                  Cartesian3.multiplyByScalar(upVector, eyeOffset, new Cartesian3()),
                  new Cartesian3()
              );
              orientation = { direction: normal, up: upVector };

              // Animation for entering view
              viewer.camera.flyTo({
                 destination: destination,
                 orientation: orientation,
                 duration: 1.5,
                 complete: () => {
                     // Reset roll to 0 after flyTo completes
                     viewer.camera.setView({
                         orientation: {
                             heading: viewer.camera.heading,
                             pitch: viewer.camera.pitch,
                             roll: 0
                         }
                     });
                 }
              });
          }
      } else if (!isInsideView) {
            // ... (rest of outside logic) ...
            controller.setEnabled(false);

            // Restore functionality
            viewer.scene.globe.show = true;
            if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
            if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;
            viewer.scene.backgroundColor = Color.BLACK; // Restore space black
            viewer.scene.fog.enabled = true;

            const ssc = viewer.scene.screenSpaceCameraController;
            ssc.enableInputs = true;
            ssc.enableRotate = true;
            ssc.enableTranslate = true;
            ssc.enableZoom = true;
            ssc.enableTilt = true;
            ssc.enableLook = true;

            const frustum = viewer.camera.frustum as PerspectiveFrustum;
            if (frustum.fov) frustum.fov = CesiumMath.toRadians(60);
      }
  }, [isInsideView, viewWindow, viewer, initialCamera]);

  // Restore Camera logic for OUTSIDE mode
  useEffect(() => {
      if (viewer && initialCamera && !isInsideView && !initialRestoredRef.current) {
          console.log("Restoring Initial Camera (Outside)...");
          viewer.camera.setView({
              destination: new Cartesian3(initialCamera.x, initialCamera.y, initialCamera.z),
              orientation: {
                  heading: initialCamera.h,
                  pitch: initialCamera.p,
                  roll: initialCamera.r
              }
          });
          initialRestoredRef.current = true;
      }
  }, [viewer, initialCamera, isInsideView]);

  // Mouse Look using Cesium's ScreenSpaceEventHandler
  useEffect(() => {
    if (!viewer) return;

    const handler = new (Cesium as any).ScreenSpaceEventHandler(viewer.scene.canvas);

    // LEFT_DOWN - start drag
    handler.setInputAction(() => {
        if (isInsideView) {
            draggingRef.current = true;
            console.log("Cesium Mouse Down (Inside)");
        }
    }, (Cesium as any).ScreenSpaceEventType.LEFT_DOWN);

    // LEFT_UP - end drag
    handler.setInputAction(() => {
        draggingRef.current = false;
    }, (Cesium as any).ScreenSpaceEventType.LEFT_UP);

    // MOUSE_MOVE - look around
    handler.setInputAction((movement: any) => {
        if (isInsideView && draggingRef.current && fpControllerRef.current) {
            const dx = movement.endPosition.x - movement.startPosition.x;
            const dy = movement.endPosition.y - movement.startPosition.y;
            fpControllerRef.current.handleMouseMove(dx, dy);
        }
    }, (Cesium as any).ScreenSpaceEventType.MOUSE_MOVE);

    // WHEEL - FOV zoom
    handler.setInputAction((delta: number) => {
        if (isInsideView && fpControllerRef.current) {
            fpControllerRef.current.handleWheel(delta);
        }
    }, (Cesium as any).ScreenSpaceEventType.WHEEL);

    return () => {
        handler.destroy();
    };
  }, [isInsideView, viewer]);

  // Selection position - directly on the wall (no offset)
  const selectionPos = useMemo(() => viewWindow?.center, [viewWindow]);

  const windowBox = useMemo(() => {
       if (!viewWindow) return null;
       return {
           dimensions: new Cartesian3(viewWindow.width, viewWindow.height, 0.1),
           material: Color.CYAN.withAlpha(0.4),
           outline: true,
           outlineColor: Color.WHITE
       };
  }, [viewWindow]);

  // Window frame for inside view - bright visible outline
  const windowFrame = useMemo(() => {
      if (!viewWindow) return null;
      return {
            dimensions: new Cartesian3(viewWindow.width, viewWindow.height, 0.03),
            material: Color.TRANSPARENT,
            outline: true,
            outlineColor: Color.YELLOW,
            outlineWidth: 10.0
      };
  }, [viewWindow]);

  const roomEntities = useMemo(() => {
    if (!viewWindow) return [];

    const depth = 10.0;
    const floorDrop = 0.2; // Floor is 20cm below window bottom
    const { width, height, center, rotation } = viewWindow;

    // Calculate local axes from rotation
    const rotationMatrix = Matrix3.fromQuaternion(rotation);
    const right = Matrix3.getColumn(rotationMatrix, 0, new Cartesian3());
    const up = Matrix3.getColumn(rotationMatrix, 1, new Cartesian3());
    const normalZ = Matrix3.getColumn(rotationMatrix, 2, new Cartesian3()); // Should match 'normal' roughly

    // Room geometry logic:
    // Window Center is (0,0,0) locally.
    // Window Top is +H/2. Window Bottom is -H/2.
    // Floor Level is -H/2 - 0.2.
    // Ceiling Level is +H/2 (assuming ceiling matches window top).
    // Total Wall Height = H + 0.2.

    // Floor Center:
    // Vertical position: Floor Level (-H/2 - 0.2)
    // Depth position: -Depth/2
    const floorPos = Cartesian3.add(
        center,
        Cartesian3.add(
            Cartesian3.multiplyByScalar(up, -height/2 - floorDrop, new Cartesian3()),
            Cartesian3.multiplyByScalar(normalZ, -depth/2, new Cartesian3()),
            new Cartesian3()
        ),
        new Cartesian3()
    );

    // Ceiling Center:
    // Vertical position: Ceiling Level (+H/2)
    const ceilingPos = Cartesian3.add(
        center,
        Cartesian3.add(
            Cartesian3.multiplyByScalar(up, height/2, new Cartesian3()),
            Cartesian3.multiplyByScalar(normalZ, -depth/2, new Cartesian3()),
            new Cartesian3()
        ),
        new Cartesian3()
    );

    // Side Walls:
    // Height = height + floorDrop.
    // Vertical Center = (Top + Bottom)/2 = (H/2 + (-H/2 - 0.2)) / 2 = -0.1.
    const sideWallHeight = height + floorDrop;
    const sideWallVOffset = -floorDrop / 2;

    const leftWallPos = Cartesian3.add(
        center,
        Cartesian3.add(
            Cartesian3.add(
                Cartesian3.multiplyByScalar(up, sideWallVOffset, new Cartesian3()),
                Cartesian3.multiplyByScalar(right, -width/2, new Cartesian3()),
                new Cartesian3()
            ),
            Cartesian3.multiplyByScalar(normalZ, -depth/2, new Cartesian3()),
            new Cartesian3()
        ),
        new Cartesian3()
    );

    const rightWallPos = Cartesian3.add(
        center,
        Cartesian3.add(
            Cartesian3.add(
                Cartesian3.multiplyByScalar(up, sideWallVOffset, new Cartesian3()),
                Cartesian3.multiplyByScalar(right, width/2, new Cartesian3()),
                new Cartesian3()
            ),
            Cartesian3.multiplyByScalar(normalZ, -depth/2, new Cartesian3()),
            new Cartesian3()
        ),
        new Cartesian3()
    );

    // Knee Wall (Front, under window):
    // Covers the 0.2m gap under window.
    // Height: 0.2m.
    // Vertical Center: -H/2 - 0.1.
    // Position: At Z=0 (window plane), or slightly behind? Let's say Z=0 roughly.
    const kneeWallPos = Cartesian3.add(
        center,
        Cartesian3.multiplyByScalar(up, -height/2 - floorDrop/2, new Cartesian3()),
        new Cartesian3()
    );

    const checkerboard = new Cesium.CheckerboardMaterialProperty({
        evenColor: Color.LIGHTGRAY,
        oddColor: Color.DARKGRAY,
        repeat: new Cartesian2(width * 2, depth * 2) // Approximate 0.5m tiles
    });

    return [
        // Floor
        {
            position: floorPos,
            orientation: rotation,
            box: {
                dimensions: new Cartesian3(width, 0.1, depth),
                material: checkerboard
            }
        },
        // Ceiling
        {
            position: ceilingPos,
            orientation: rotation,
            box: {
                dimensions: new Cartesian3(width, 0.1, depth),
                material: Color.LIGHTGRAY
            }
        },
        // Left Wall
        {
            position: leftWallPos,
            orientation: rotation,
            box: {
                dimensions: new Cartesian3(0.1, sideWallHeight, depth),
                material: Color.WHITESMOKE
            }
        },
        // Right Wall
        {
            position: rightWallPos,
            orientation: rotation,
            box: {
                dimensions: new Cartesian3(0.1, sideWallHeight, depth),
                material: Color.WHITESMOKE
            }
        },
        // Knee Wall (small strip below window)
        {
            position: kneeWallPos,
            orientation: rotation,
            box: {
                dimensions: new Cartesian3(width, floorDrop, 0.1),
                material: Color.WHITESMOKE
            }
        }
    ];

  }, [viewWindow]);

  return (
    <Viewer
      full
      ref={viewerCallback}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      timeline={false}
      animation={false}
      baseLayerPicker={false}
      requestRenderMode={false}
      maximumRenderTimeChange={Infinity}
    >
      <ScreenSpaceEventHandler>
          <ScreenSpaceEvent action={handleLeftClick} type={ScreenSpaceEventType.LEFT_CLICK} />
      </ScreenSpaceEventHandler>

      {/* Selection mode: cyan box on surface */}
      {viewWindow && !isInsideView && selectionPos && windowBox && (
          <Entity
            position={selectionPos}
            orientation={viewWindow.rotation}
            box={windowBox}
          />
      )}

      {/* Inside view: Window frame outline only */}
      {viewWindow && isInsideView && windowFrame && (
            <Entity
                position={viewWindow.center}
                orientation={viewWindow.rotation}
                box={windowFrame}
            />
      )}

      {/* Room Geometry (Floor, Ceiling, Walls) */}
      {viewWindow && isInsideView && roomEntities.map((entity, i) => (
          <Entity key={i} {...entity} />
      ))}
    </Viewer>
  );
});

EarthViewer.displayName = 'EarthViewer';
