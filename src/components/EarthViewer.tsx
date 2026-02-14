import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Viewer, Entity, ScreenSpaceEventHandler, ScreenSpaceEvent } from 'resium'
import {
  Cartesian3,
  Color,
  Viewer as CesiumViewer,
  Math as CesiumMath,
  ScreenSpaceEventType,
  PerspectiveFrustum,
  Matrix3,
  Cartesian2,
  Plane,
  ClippingPlane,
  ClippingPlaneCollection,
  Cartographic,
} from 'cesium'
import * as Cesium from 'cesium'
import { calculateSurfaceNormal, type WindowSelection } from '../logic/WindowSelector'
import { FPController } from '../logic/FPController'
import { useSunPathPrimitives } from './SunPathOverlay'

const getOrientationFromDirection = (position: Cartesian3, direction: Cartesian3) => {
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(position)
  const rotation = new Cesium.Matrix3()
  Cesium.Matrix4.getMatrix3(transform, rotation)
  const east = new Cartesian3()
  const north = new Cartesian3()
  const up = new Cartesian3()

  Cesium.Matrix3.getColumn(rotation, 0, east)
  Cesium.Matrix3.getColumn(rotation, 1, north)
  Cesium.Matrix3.getColumn(rotation, 2, up)

  const x = Cartesian3.dot(direction, east)
  const y = Cartesian3.dot(direction, north)
  const z = Cartesian3.dot(direction, up)

  const heading = Math.atan2(x, y)
  const pitch = Math.asin(CesiumMath.clamp(z, -1.0, 1.0))

  return { heading, pitch, roll: 0.0 }
}

interface EarthViewerProps {
  onWindowSelected: (selection: WindowSelection) => void
  onCameraChange?: (cam: {
    x: number
    y: number
    z: number
    h: number
    p: number
    r: number
    fov?: number
  }) => void
  selectionMode: boolean
  viewWindow: WindowSelection | null
  isInsideView: boolean
  initialOutsideCamera?: {
    x: number
    y: number
    z: number
    h: number
    p: number
    r: number
    fov?: number
  } | null
  startInsideCamera?: {
    x: number
    y: number
    z: number
    h: number
    p: number
    r: number
    fov?: number
  } | null
  showSunPath?: boolean
  joystickRef?: React.MutableRefObject<{ x: number; y: number }>
}

export const EarthViewer = React.memo<EarthViewerProps>(
  ({
    onWindowSelected,
    onCameraChange,
    selectionMode,
    viewWindow,
    isInsideView,
    initialOutsideCamera,
    startInsideCamera,
    showSunPath = false,
    joystickRef,
  }) => {
    const [viewer, setViewer] = useState<CesiumViewer | null>(null)
    const [tileset, setTileset] = useState<any>(null)
    const fpControllerRef = useRef<FPController | null>(null)
    const draggingRef = useRef(false)
    const lastCameraUpdateRef = useRef(0)
    const lastAppliedOutsideCamRef = useRef<any>(null)
    const lastAppliedInsideCamRef = useRef<any>(null)
    const wasInsideViewRef = useRef(isInsideView)
    const suppressRestoreRef = useRef(false)

    const isCloseTo = (
      target: { x: number; y: number; z: number; h: number; p: number; r: number; fov?: number },
      current: any
    ) => {
      const pos = current.position
      const dist = Cartesian3.distance(new Cartesian3(target.x, target.y, target.z), pos)
      const angDist =
        Math.abs(target.h - current.heading) +
        Math.abs(target.p - current.pitch) +
        Math.abs(target.r - current.roll)

      let fovDist = 0
      if (target.fov !== undefined && current.frustum && current.frustum.fov !== undefined) {
        fovDist = Math.abs(target.fov - current.frustum.fov)
      }

      return dist < 2.0 && angDist < 0.1 && fovDist < 0.01
    }

    const viewerCallback = useCallback((ref: any) => {
      if (ref && ref.cesiumElement) {
        setViewer(ref.cesiumElement)
      }
    }, [])

    useEffect(() => {
      const loadTiles = async () => {
        try {
          const ts = await Cesium.Cesium3DTileset.fromIonAssetId(2275207)
          setTileset(ts)
        } catch (error) {
          console.error('Failed to load 3D tiles', error)
        }
      }
      loadTiles()
    }, [])

    // Manage Clipping Plane for Inside View to prevent building occlusion/culling
    useEffect(() => {
      if (!tileset) return

      if (isInsideView && viewWindow) {
        const { center, width, height, rotation } = viewWindow

        // Calculate basis vectors
        const rotationMatrix = Matrix3.fromQuaternion(rotation)
        const right = Matrix3.getColumn(rotationMatrix, 0, new Cartesian3())
        Cartesian3.normalize(right, right)
        const up = Matrix3.getColumn(rotationMatrix, 1, new Cartesian3())
        Cartesian3.normalize(up, up)
        const forward = Matrix3.getColumn(rotationMatrix, 2, new Cartesian3()) // Window normal
        Cartesian3.normalize(forward, forward)

        const planes: ClippingPlane[] = []

        // Define Box Dimensions for Clipping (The "Hole")
        // We want to clip the volume of the room + 3m ahead.
        // Normals for clipping planes must point INTO the clipped volume (Clipping logic: Positive side is clipped).
        // Since we want to remove the inside of the box, we define the box interior as the positive side of all planes.
        // "Intersection Mode" (unionClippingRegions = false) clips the intersection of positive regions.

        // Box Z range: +3m (Ahead) to -10m (Behind/Room Depth)
        // Box X range: +/- width/2
        // Box Y range: +height/2 to -height/2 - 0.2

        // 1. Front Plane (+3m ahead)
        // Point: center + 3 * forward
        // Normal: -forward (pointing IN towards room center)
        const frontDist = 3.0
        const frontPoint = Cartesian3.add(
          center,
          Cartesian3.multiplyByScalar(forward, frontDist, new Cartesian3()),
          new Cartesian3()
        )
        const frontNormal = Cartesian3.negate(forward, new Cartesian3())
        // Plane.distance is -Normal.Point.
        // ClippingPlane matches this definition relative to origin.
        const frontPlane = Plane.fromPointNormal(frontPoint, frontNormal)
        planes.push(new ClippingPlane(frontNormal, frontPlane.distance))

        // 2. Back Plane (-10m behind)
        // Point: center - 10 * forward
        // Normal: forward (pointing IN towards room center)
        const backDist = 10.0
        const backPoint = Cartesian3.add(
          center,
          Cartesian3.multiplyByScalar(forward, -backDist, new Cartesian3()),
          new Cartesian3()
        )
        const backNormal = forward
        const backPlane = Plane.fromPointNormal(backPoint, backNormal)
        planes.push(new ClippingPlane(backNormal, backPlane.distance))

        // 3. Right Plane (+width/2)
        // Point: center + width/2 * right
        // Normal: -right
        const rightPoint = Cartesian3.add(
          center,
          Cartesian3.multiplyByScalar(right, width / 2, new Cartesian3()),
          new Cartesian3()
        )
        const rightNormal = Cartesian3.negate(right, new Cartesian3())
        const rightPlane = Plane.fromPointNormal(rightPoint, rightNormal)
        planes.push(new ClippingPlane(rightNormal, rightPlane.distance))

        // 4. Left Plane (-width/2)
        // Point: center - width/2 * right
        // Normal: right
        const leftPoint = Cartesian3.add(
          center,
          Cartesian3.multiplyByScalar(right, -width / 2, new Cartesian3()),
          new Cartesian3()
        )
        const leftNormal = right
        const leftPlane = Plane.fromPointNormal(leftPoint, leftNormal)
        planes.push(new ClippingPlane(leftNormal, leftPlane.distance))

        // 5. Top Plane (+height/2)
        // Point: center + height/2 * up
        // Normal: -up
        const topPoint = Cartesian3.add(
          center,
          Cartesian3.multiplyByScalar(up, height / 2, new Cartesian3()),
          new Cartesian3()
        )
        const topNormal = Cartesian3.negate(up, new Cartesian3())
        const topPlane = Plane.fromPointNormal(topPoint, topNormal)
        planes.push(new ClippingPlane(topNormal, topPlane.distance))

        // 6. Bottom Plane (-height/2 - 0.2)
        // Point: center - (height/2 + 0.2) * up
        // Normal: up
        const floorDrop = 0.2
        const bottomPoint = Cartesian3.add(
          center,
          Cartesian3.multiplyByScalar(up, -height / 2 - floorDrop, new Cartesian3()),
          new Cartesian3()
        )
        const bottomNormal = up
        const bottomPlane = Plane.fromPointNormal(bottomPoint, bottomNormal)
        planes.push(new ClippingPlane(bottomNormal, bottomPlane.distance))

        if (tileset.clippingPlanes) {
          tileset.clippingPlanes.removeAll()
          planes.forEach((p) => tileset.clippingPlanes.add(p))
          tileset.clippingPlanes.unionClippingRegions = false
          tileset.clippingPlanes.enabled = true
        } else {
          tileset.clippingPlanes = new ClippingPlaneCollection({
            planes: planes,
            edgeWidth: 0.0,
            unionClippingRegions: false,
            enabled: true,
          })
        }
      } else {
        // Disable clipping safely
        if (tileset.clippingPlanes) {
          tileset.clippingPlanes.enabled = false
        }
      }
    }, [isInsideView, tileset, viewWindow])

    useEffect(() => {
      if (viewer && tileset && !viewer.scene.primitives.contains(tileset)) {
        viewer.scene.primitives.add(tileset)
      }
      return () => {
        if (viewer && tileset) {
          // We must NOT destroy the tileset here if we want to reuse it.
          // However, 'remove' destroys by default.
          // We can check if it is destroyed?
          if (viewer.scene.primitives.contains(tileset)) {
            viewer.scene.primitives.remove(tileset)
            // Wait, remove() destroys it.
            // We should probably rely on the fact that 'tileset' state is stable.
            // If tileset changes, the old one is destroyed. That's fine.
            // But if 'viewer' changes, we remove it.
            // If we remove 'initialOutsideCamera' from deps, this effect only runs when tileset changes.
          }
        }
      }
    }, [tileset, viewer])

    useEffect(() => {
      if (viewer && !initialOutsideCamera && !startInsideCamera) {
        if (viewer.camera.positionCartographic.height > 10000000) {
          viewer.camera.flyTo({
            destination: Cartesian3.fromDegrees(-74.006, 40.7128, 500),
            orientation: {
              heading: CesiumMath.toRadians(0),
              pitch: CesiumMath.toRadians(-45),
              roll: 0,
            },
          })
        }
      }
    }, [viewer, initialOutsideCamera, startInsideCamera])

    const handleLeftClick = (movement: any) => {
      if (!selectionMode || !viewer || isInsideView) return

      const position = movement.position
      const pickedPosition = viewer.scene.pickPosition(position)

      if (pickedPosition) {
        const existingWidth = viewWindow?.width || 2.0
        const existingHeight = viewWindow?.height || 3.0

        const result = calculateSurfaceNormal(viewer, position, pickedPosition)
        if (result) {
          onWindowSelected({
            center: pickedPosition,
            normal: result.normal,
            rotation: result.rotation,
            width: existingWidth,
            height: existingHeight,
          })
        }
      }
    }

    // Init Controller and Global Camera Tracking
    useEffect(() => {
      if (!viewer) return

      fpControllerRef.current = new FPController(viewer)

      const onTick = () => {
        // Update Joystick input
        if (joystickRef?.current && fpControllerRef.current) {
          fpControllerRef.current.setJoystickVector(joystickRef.current.x, joystickRef.current.y)
        }

        fpControllerRef.current?.update(0.016)

        // Broadcast camera state ALWAYS (throttled)
        if (onCameraChange) {
          const now = Date.now()
          if (now - lastCameraUpdateRef.current > 500) {
            // Update every 500ms
            const cam = viewer.camera
            const pos = cam.position
            const h = cam.heading
            const p = cam.pitch
            const r = cam.roll

            onCameraChange({
              x: pos.x,
              y: pos.y,
              z: pos.z,
              h,
              p,
              r,
              fov: (viewer.camera.frustum as PerspectiveFrustum).fov,
            })
            lastCameraUpdateRef.current = now
          }
        }
      }

      viewer.clock.onTick.addEventListener(onTick)
      return () => {
        viewer.clock.onTick.removeEventListener(onTick)
        fpControllerRef.current?.destroy()
      }
    }, [viewer, onCameraChange, joystickRef])

    // Camera Mode Switch
    useEffect(() => {
      if (!viewer || !fpControllerRef.current) return

      const controller = fpControllerRef.current

      // DISABLE COLLISION DETECTION to prevent roof snapping
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false

      console.log(`Mode Update: ${isInsideView ? 'Inside' : 'Outside'}`)

      if (isInsideView && viewWindow) {
        controller.setEnabled(true)
        lastAppliedOutsideCamRef.current = null // Reset outside cam so it restores correctly next time

        // Granularly disable default inputs to prevent fighting
        const ssc = viewer.scene.screenSpaceCameraController
        ssc.enableInputs = false
        ssc.enableRotate = false
        ssc.enableTranslate = false
        ssc.enableZoom = false
        ssc.enableTilt = false
        ssc.enableLook = false

        // Clear bindings to prevent any leakage (like right-click zoom)
        ssc.zoomEventTypes = []
        ssc.tiltEventTypes = []
        ssc.rotateEventTypes = []
        ssc.translateEventTypes = []
        ssc.lookEventTypes = []

        // Prevent skybox from disappearing & Provide Blue Sky:
        // Disable dynamic atmosphere/globe to avoid artifacts.
        viewer.scene.globe.show = false

        // Disable fog
        viewer.scene.fog.enabled = false

        // Adjust near plane to clip through nearby building geometry
        const frustum = viewer.camera.frustum as PerspectiveFrustum
        if (frustum.near !== undefined) {
          frustum.near = 0.1 // Aggressive clipping for inside view
        }

        let destination: Cartesian3
        let orientation: any

        if (!startInsideCamera) {
          console.log('Entering Window View (Standard)')
          const { center, normal, height } = viewWindow
          const offset = 2.5
          const eyeOffset = 1.4 - height / 2
          const upVector = new Cartesian3(0, 0, 1)

          destination = Cartesian3.add(
            Cartesian3.subtract(
              center,
              Cartesian3.multiplyByScalar(normal, offset, new Cartesian3()),
              new Cartesian3()
            ),
            Cartesian3.multiplyByScalar(upVector, eyeOffset, new Cartesian3()),
            new Cartesian3()
          )
          orientation = getOrientationFromDirection(destination, normal)

          // Animation for entering view with default FOV
          const frustum = viewer.camera.frustum as PerspectiveFrustum
          if (frustum.fov) frustum.fov = CesiumMath.toRadians(60)

          viewer.camera.flyTo({
            destination: destination,
            orientation: orientation,
            duration: 1.5,
          })
        }
      } else if (!isInsideView) {
        // ... (rest of outside logic) ...
        controller.setEnabled(false)
        lastAppliedInsideCamRef.current = null // Reset inside cam so it restores correctly next time

        // Restore functionality
        viewer.scene.globe.show = true

        const ssc = viewer.scene.screenSpaceCameraController
        ssc.enableInputs = true
        ssc.enableRotate = true
        ssc.enableTranslate = true
        ssc.enableZoom = true
        ssc.enableTilt = true
        ssc.enableLook = true
        ssc.enableCollisionDetection = true // IMPORTANT: Restore collision to prevent underground crashes

        // Custom Controls: Right Drag to Tilt, Remove Zoom from Right Drag
        ssc.rotateEventTypes = [Cesium.CameraEventType.LEFT_DRAG]
        ssc.translateEventTypes = [
          {
            eventType: Cesium.CameraEventType.LEFT_DRAG,
            modifier: Cesium.KeyboardEventModifier.SHIFT,
          },
        ]
        ssc.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH]
        ssc.tiltEventTypes = [
          Cesium.CameraEventType.MIDDLE_DRAG,
          Cesium.CameraEventType.PINCH,
          Cesium.CameraEventType.RIGHT_DRAG,
          {
            eventType: Cesium.CameraEventType.LEFT_DRAG,
            modifier: Cesium.KeyboardEventModifier.CTRL,
          },
          {
            eventType: Cesium.CameraEventType.RIGHT_DRAG,
            modifier: Cesium.KeyboardEventModifier.CTRL,
          },
        ]

        const frustum = viewer.camera.frustum as PerspectiveFrustum
        if (frustum.fov) {
          frustum.fov = CesiumMath.toRadians(60)
        }
        if (frustum.near !== undefined) frustum.near = 1.0 // Restore default near plane to prevent frustum crashes

        // Face window from ouside if we just exited
        if (wasInsideViewRef.current && viewWindow) {
          console.log('Exiting to 10m view facing window')
          suppressRestoreRef.current = true // Block standard restore

          const { center, normal } = viewWindow
          const targetPos = Cartesian3.add(
            center,
            Cartesian3.multiplyByScalar(normal, 20, new Cartesian3()),
            new Cartesian3()
          )
          const direction = Cartesian3.negate(normal, new Cartesian3())
          const orientation = getOrientationFromDirection(targetPos, direction)

          viewer.camera.flyTo({
            destination: targetPos,
            orientation: orientation,
            duration: 1.5,
          })
        }
      }
      wasInsideViewRef.current = isInsideView
    }, [isInsideView, viewWindow, viewer, initialOutsideCamera, startInsideCamera])

    // Restore Camera logic for OUTSIDE mode
    // Effect to apply Outside Camera from prop
    useEffect(() => {
      if (viewer && initialOutsideCamera && !isInsideView) {
        if (suppressRestoreRef.current) {
          suppressRestoreRef.current = false
          lastAppliedOutsideCamRef.current = initialOutsideCamera
          return
        }

        if (lastAppliedOutsideCamRef.current !== initialOutsideCamera) {
          if (!isCloseTo(initialOutsideCamera, viewer.camera)) {
            console.log('Restoring Initial Camera (Outside) from prop')
            viewer.camera.setView({
              destination: new Cartesian3(
                initialOutsideCamera.x,
                initialOutsideCamera.y,
                initialOutsideCamera.z
              ),
              orientation: {
                heading: initialOutsideCamera.h,
                pitch: initialOutsideCamera.p,
                roll: initialOutsideCamera.r,
              },
            })
          }
          lastAppliedOutsideCamRef.current = initialOutsideCamera
        }
      }
    }, [viewer, initialOutsideCamera, isInsideView])

    // Effect to apply Inside Camera from prop
    useEffect(() => {
      if (viewer && startInsideCamera && isInsideView) {
        if (lastAppliedInsideCamRef.current !== startInsideCamera) {
          if (!isCloseTo(startInsideCamera, viewer.camera)) {
            console.log('Restoring Inside Camera from prop')
            viewer.camera.setView({
              destination: new Cartesian3(
                startInsideCamera.x,
                startInsideCamera.y,
                startInsideCamera.z
              ),
              orientation: {
                heading: startInsideCamera.h,
                pitch: startInsideCamera.p,
                roll: startInsideCamera.r,
              },
            })
            const frustum = viewer.camera.frustum as PerspectiveFrustum
            if (frustum.fov) frustum.fov = startInsideCamera.fov ?? CesiumMath.toRadians(60)
          }
          lastAppliedInsideCamRef.current = startInsideCamera
        }
      }
    }, [viewer, startInsideCamera, isInsideView])

    // Mouse Look using Cesium's ScreenSpaceEventHandler
    useEffect(() => {
      if (!viewer) return

      // Prevent context menu
      const preventDefault = (e: Event) => e.preventDefault()
      viewer.scene.canvas.addEventListener('contextmenu', preventDefault)

      const handler = new (Cesium as any).ScreenSpaceEventHandler(viewer.scene.canvas)

      // LEFT_DOWN - start drag
      handler.setInputAction(
        () => {
          if (isInsideView) {
            draggingRef.current = true
            console.log('Cesium Mouse Down (Inside)')
          }
        },
        (Cesium as any).ScreenSpaceEventType.LEFT_DOWN
      )

      // LEFT_UP - end drag
      handler.setInputAction(
        () => {
          draggingRef.current = false
        },
        (Cesium as any).ScreenSpaceEventType.LEFT_UP
      )

      // MOUSE_MOVE - look around
      handler.setInputAction(
        (movement: any) => {
          if (isInsideView && draggingRef.current && fpControllerRef.current) {
            const dx = movement.endPosition.x - movement.startPosition.x
            const dy = movement.endPosition.y - movement.startPosition.y
            fpControllerRef.current.handleMouseMove(dx, dy)
          }
        },
        (Cesium as any).ScreenSpaceEventType.MOUSE_MOVE
      )

      // WHEEL - FOV zoom
      handler.setInputAction(
        (delta: number) => {
          if (isInsideView && fpControllerRef.current) {
            fpControllerRef.current.handleWheel(delta)
          }
        },
        (Cesium as any).ScreenSpaceEventType.WHEEL
      )

      // PINCH_START / PINCH_MOVE - FOV zoom
      // Note: Cesium's default behavior might conflict if not disabled.
      // We already disabled 'enableZoom' on screenSpaceCameraController, so custom handling is needed.
      handler.setInputAction(
        (movement: any) => {
          if (isInsideView && fpControllerRef.current) {
            // Cesium PINCH_MOVE event provides "distance" as Cartesian2, but the distance value is stored in .y
            // (Cesium quirk: uses Cartesian2 for uniformity, but Pinch distance is 1D)
            const p1 = movement.distance.startPosition.y
            const p2 = movement.distance.endPosition.y
            const diff = p2 - p1 // positive = spreading = zoom in

            // Guard against NaN just in case
            if (!isNaN(diff)) {
              fpControllerRef.current.handlePinch(diff * 5.0) // multiplier for sensitivity
            }
          }
        },
        (Cesium as any).ScreenSpaceEventType.PINCH_MOVE
      )

      // MIDDLE_CLICK - reset FOV to 60°
      handler.setInputAction(
        () => {
          if (isInsideView) {
            const frustum = viewer.camera.frustum as PerspectiveFrustum
            if (frustum.fov !== undefined) {
              frustum.fov = CesiumMath.toRadians(60)
            }
          }
        },
        (Cesium as any).ScreenSpaceEventType.MIDDLE_CLICK
      )

      return () => {
        handler.destroy()
        if (viewer && viewer.scene && viewer.scene.canvas) {
          viewer.scene.canvas.removeEventListener('contextmenu', preventDefault)
        }
      }
    }, [isInsideView, viewer])

    // Selection position - directly on the wall (no offset)
    const selectionPos = useMemo(() => viewWindow?.center, [viewWindow])

    const windowBox = useMemo(() => {
      if (!viewWindow) return null
      return {
        dimensions: new Cartesian3(viewWindow.width, viewWindow.height, 0.1),
        material: Color.CYAN.withAlpha(0.4),
        outline: true,
        outlineColor: Color.WHITE,
      }
    }, [viewWindow])

    // Window frame for inside view - bright visible outline
    const windowFrame = useMemo(() => {
      if (!viewWindow) return null
      return {
        dimensions: new Cartesian3(viewWindow.width, viewWindow.height, 0.03),
        material: Color.TRANSPARENT,
        outline: true,
        outlineColor: Color.YELLOW,
        outlineWidth: 10.0,
      }
    }, [viewWindow])

    const roomEntities = useMemo(() => {
      if (!viewWindow) return []

      const depth = 10.0
      const floorDrop = 0.2 // Floor is 20cm below window bottom
      const { width, height, center, rotation } = viewWindow

      // Calculate local axes from rotation
      const rotationMatrix = Matrix3.fromQuaternion(rotation)
      const right = Matrix3.getColumn(rotationMatrix, 0, new Cartesian3())
      const up = Matrix3.getColumn(rotationMatrix, 1, new Cartesian3())
      const normalZ = Matrix3.getColumn(rotationMatrix, 2, new Cartesian3()) // Should match 'normal' roughly

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
          Cartesian3.multiplyByScalar(up, -height / 2 - floorDrop, new Cartesian3()),
          Cartesian3.multiplyByScalar(normalZ, -depth / 2, new Cartesian3()),
          new Cartesian3()
        ),
        new Cartesian3()
      )

      // Ceiling Center:
      // Vertical position: Ceiling Level (+H/2)
      const ceilingPos = Cartesian3.add(
        center,
        Cartesian3.add(
          Cartesian3.multiplyByScalar(up, height / 2, new Cartesian3()),
          Cartesian3.multiplyByScalar(normalZ, -depth / 2, new Cartesian3()),
          new Cartesian3()
        ),
        new Cartesian3()
      )

      // Side Walls:
      // Height = height + floorDrop.
      // Vertical Center = (Top + Bottom)/2 = (H/2 + (-H/2 - 0.2)) / 2 = -0.1.
      const sideWallHeight = height + floorDrop
      const sideWallVOffset = -floorDrop / 2

      const leftWallPos = Cartesian3.add(
        center,
        Cartesian3.add(
          Cartesian3.add(
            Cartesian3.multiplyByScalar(up, sideWallVOffset, new Cartesian3()),
            Cartesian3.multiplyByScalar(right, -width / 2, new Cartesian3()),
            new Cartesian3()
          ),
          Cartesian3.multiplyByScalar(normalZ, -depth / 2, new Cartesian3()),
          new Cartesian3()
        ),
        new Cartesian3()
      )

      const rightWallPos = Cartesian3.add(
        center,
        Cartesian3.add(
          Cartesian3.add(
            Cartesian3.multiplyByScalar(up, sideWallVOffset, new Cartesian3()),
            Cartesian3.multiplyByScalar(right, width / 2, new Cartesian3()),
            new Cartesian3()
          ),
          Cartesian3.multiplyByScalar(normalZ, -depth / 2, new Cartesian3()),
          new Cartesian3()
        ),
        new Cartesian3()
      )

      // Knee Wall (Front, under window):
      // Covers the 0.2m gap under window.
      // Height: 0.2m.
      // Vertical Center: -H/2 - 0.1.
      // Position: At Z=0 (window plane), or slightly behind? Let's say Z=0 roughly.
      const kneeWallPos = Cartesian3.add(
        center,
        Cartesian3.multiplyByScalar(up, -height / 2 - floorDrop / 2, new Cartesian3()),
        new Cartesian3()
      )

      const checkerboard = new Cesium.CheckerboardMaterialProperty({
        evenColor: Color.LIGHTGRAY,
        oddColor: Color.DARKGRAY,
        repeat: new Cartesian2(width * 2, depth * 2), // Approximate 0.5m tiles
      })

      return [
        // Floor
        {
          position: floorPos,
          orientation: rotation,
          box: {
            dimensions: new Cartesian3(width, 0.1, depth),
            material: checkerboard,
          },
        },
        // Ceiling
        {
          position: ceilingPos,
          orientation: rotation,
          box: {
            dimensions: new Cartesian3(width, 0.1, depth),
            material: Color.LIGHTGRAY,
          },
        },
        // Left Wall
        {
          position: leftWallPos,
          orientation: rotation,
          box: {
            dimensions: new Cartesian3(0.1, sideWallHeight, depth),
            material: Color.WHITESMOKE,
          },
        },
        // Right Wall
        {
          position: rightWallPos,
          orientation: rotation,
          box: {
            dimensions: new Cartesian3(0.1, sideWallHeight, depth),
            material: Color.WHITESMOKE,
          },
        },
        // Knee Wall (small strip below window)
        {
          position: kneeWallPos,
          orientation: rotation,
          box: {
            dimensions: new Cartesian3(width, floorDrop, 0.1),
            material: Color.WHITESMOKE,
          },
        },
      ]
    }, [viewWindow])

    // Sun path overlay — compute lat/lon from window center
    const sunPathGeo = useMemo(() => {
      if (!viewWindow) return null
      const carto = Cartographic.fromCartesian(viewWindow.center)
      return {
        lat: CesiumMath.toDegrees(carto.latitude),
        lon: CesiumMath.toDegrees(carto.longitude),
      }
    }, [viewWindow])

    useSunPathPrimitives(
      viewer,
      viewWindow?.center ?? null,
      sunPathGeo?.lat ?? 0,
      sunPathGeo?.lon ?? 0,
      isInsideView && showSunPath && !!viewWindow
    )

    return (
      <Viewer
        full
        ref={viewerCallback}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        timeline={false}
        animation={false}
        baseLayerPicker={false}
        sceneModePicker={false}
        requestRenderMode={false}
        maximumRenderTimeChange={Infinity}
      >
        <ScreenSpaceEventHandler>
          <ScreenSpaceEvent action={handleLeftClick} type={ScreenSpaceEventType.LEFT_CLICK} />
        </ScreenSpaceEventHandler>

        {/* Selection mode: cyan box on surface */}
        {viewWindow && !isInsideView && selectionPos && windowBox && (
          <Entity position={selectionPos} orientation={viewWindow.rotation} box={windowBox} />
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
        {viewWindow &&
          isInsideView &&
          roomEntities.map((entity, i) => <Entity key={i} {...entity} />)}
      </Viewer>
    )
  }
)

EarthViewer.displayName = 'EarthViewer'
