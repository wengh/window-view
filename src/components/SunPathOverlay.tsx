/**
 * SunPathOverlay.tsx — Renders the annual sun path diagram on the sky
 * as Cesium Polylines, visible from inside the room view.
 *
 * Lines are placed on a large sphere centered on the viewer's position
 * and use ENU (East-North-Up) coordinates transformed to ECEF.
 */

import React from 'react';
import * as Cesium from 'cesium';
import tzlookup from '@photostructure/tz-lookup';
import {
  generateSunPathLines,
  findDSTTransitions,
  sunPathPointToENU,
  computeCurrentSunPosition,
  type SunPathPoint,
  type SunPathLine,
  type DSTTransition,
} from '../logic/SunPath';

/**
 * Radius of the sky dome on which the sun path lines are drawn (meters).
 * Large enough to look infinite but small enough to stay inside the far clip.
 */
const DOME_RADIUS = 30000;

/**
 * Convert an ENU offset (east, north, up) at a given ECEF origin into
 * an absolute ECEF Cartesian3 by using Cesium's ENU-to-Fixed transform.
 */
function enuToECEF(
  east: number,
  north: number,
  up: number,
  origin: Cesium.Cartesian3
): Cesium.Cartesian3 {
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const localPos = new Cesium.Cartesian3(east, north, up);
  return Cesium.Matrix4.multiplyByPoint(transform, localPos, new Cesium.Cartesian3());
}

/**
 * Build a Cesium Polyline positions array from a SunPathLine.
 */
function lineToPositions(
  line: SunPathLine,
  center: Cesium.Cartesian3
): Cesium.Cartesian3[] {
  return line.points.map((pt) => {
    const [e, n, u] = sunPathPointToENU(pt, DOME_RADIUS);
    return enuToECEF(e, n, u, center);
  });
}

/**
 * Get color + width for a given line type.
 */
function styleForLine(line: SunPathLine): { color: Cesium.Color; width: number } {
  switch (line.type) {
    case 'solstice':
      return { color: Cesium.Color.ORANGE.withAlpha(0.95), width: 3 };
    case 'month':
      return { color: Cesium.Color.GOLD.withAlpha(0.7), width: 1.5 };
    case 'hour':
      return { color: Cesium.Color.WHITE.withAlpha(0.45), width: 2 };
    case 'hour-dst':
      return { color: Cesium.Color.LIGHTPINK.withAlpha(0.55), width: 2 };
    case 'dst':
      return { color: Cesium.Color.LIGHTPINK.withAlpha(0.85), width: 1.5 };
  }
}

/**
 * Add chevron arrowheads along an hour line to indicate direction of annual progression.
 * Each arrow is two small polyline segments forming a "V" pointing in the travel direction.
 * Computed in ENU 3D space to avoid azimuth/altitude distortion.
 */
function addArrowheads(
  taggedPoints: Array<{ pt: SunPathPoint; dst: boolean }>,
  center: Cesium.Cartesian3,
  collection: Cesium.PrimitiveCollection,
  stdColor: Cesium.Color,
  dstColor: Cesium.Color,
  numArrows: number = 4
) {
  if (taggedPoints.length < 4) return;

  // Wing length: 0.5 degrees at DOME_RADIUS
  const wingLen = DOME_RADIUS * Math.tan(0.5 * Math.PI / 180);
  const halfAngle = Math.PI / 6; // 30° half-angle for chevron

  for (let a = 0; a < numArrows; a++) {
    const idx = Math.floor(taggedPoints.length * (a + 0.5) / numArrows);

    const color = taggedPoints[idx].dst ? dstColor : stdColor;

    // Get ENU positions for tip and previous point
    const tipENU = sunPathPointToENU(taggedPoints[idx].pt, DOME_RADIUS);
    const nextENU = sunPathPointToENU(taggedPoints[(idx + 1) % taggedPoints.length].pt, DOME_RADIUS);

    // Direction vector in ENU (from prev to tip)
    const dx = nextENU[0] - tipENU[0];
    const dy = nextENU[1] - tipENU[1];
    const dz = nextENU[2] - tipENU[2];
    const dirLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dirLen < 1e-6) continue;

    // Unit direction
    const ux = dx / dirLen;
    const uy = dy / dirLen;
    const uz = dz / dirLen;

    // Radial direction at tip (from origin to tip, normalized)
    const rLen = Math.sqrt(tipENU[0] ** 2 + tipENU[1] ** 2 + tipENU[2] ** 2);
    const rx = tipENU[0] / rLen;
    const ry = tipENU[1] / rLen;
    const rz = tipENU[2] / rLen;

    // Perpendicular to both direction and radial (tangent to dome surface)
    // perp = cross(direction, radial)
    let px = uy * rz - uz * ry;
    let py = uz * rx - ux * rz;
    let pz = ux * ry - uy * rx;
    const pLen = Math.sqrt(px * px + py * py + pz * pz);
    if (pLen < 1e-6) continue;
    px /= pLen; py /= pLen; pz /= pLen;

    // Reverse direction
    const bx = -ux, by = -uy, bz = -uz;

    // Left wing: rotate reverse direction toward +perp by halfAngle
    const cosH = Math.cos(halfAngle);
    const sinH = Math.sin(halfAngle);
    const lwx = bx * cosH + px * sinH;
    const lwy = by * cosH + py * sinH;
    const lwz = bz * cosH + pz * sinH;

    // Right wing: rotate reverse direction toward -perp by halfAngle
    const rwx = bx * cosH - px * sinH;
    const rwy = by * cosH - py * sinH;
    const rwz = bz * cosH - pz * sinH;

    // Wing endpoint positions in ENU
    const leftWingENU: [number, number, number] = [
      tipENU[0] + wingLen * lwx,
      tipENU[1] + wingLen * lwy,
      tipENU[2] + wingLen * lwz,
    ];
    const rightWingENU: [number, number, number] = [
      tipENU[0] + wingLen * rwx,
      tipENU[1] + wingLen * rwy,
      tipENU[2] + wingLen * rwz,
    ];

    // Convert to ECEF
    const tipECEF = enuToECEF(...tipENU, center);
    const leftECEF = enuToECEF(...leftWingENU, center);
    const rightECEF = enuToECEF(...rightWingENU, center);

    // Draw two wing segments forming a chevron ">"
    const arrowPrim = new Cesium.Primitive({
      geometryInstances: [
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: [leftECEF, tipECEF],
            width: 2,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
            arcType: Cesium.ArcType.NONE,
          }),
        }),
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: [rightECEF, tipECEF],
            width: 2,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
            arcType: Cesium.ArcType.NONE,
          }),
        }),
      ],
      appearance: new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('Color', { color }),
      }),
    });
    collection.add(arrowPrim);
  }
}

// ---- Imperative hook for adding sun path primitives to the scene ----

/**
 * Custom hook that creates and manages the sun-path PrimitiveCollection
 * on the Cesium viewer's scene.
 *
 * @param viewer   Cesium Viewer instance (or null)
 * @param center   ECEF position of the observer
 * @param latDeg   Latitude in degrees
 * @param lonDeg   Longitude in degrees
 * @param visible  Whether to show sun-path lines
 */
export function useSunPathPrimitives(
  viewer: Cesium.Viewer | null,
  center: Cesium.Cartesian3 | null,
  latDeg: number,
  lonDeg: number,
  visible: boolean
) {
  const collectionRef = React.useRef<Cesium.PrimitiveCollection | null>(null);
  const labelsRef = React.useRef<Cesium.LabelCollection | null>(null);
  const [now, setNow] = React.useState(new Date());

  React.useEffect(() => {
    // Update "now" every minute to keep sun position current
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    // Cleanup previous
    if (collectionRef.current && viewer) {
      try {
        viewer.scene.primitives.remove(collectionRef.current);
      } catch { /* ignore */ }
      collectionRef.current = null;
    }
    if (labelsRef.current && viewer) {
      try {
        viewer.scene.primitives.remove(labelsRef.current);
      } catch { /* ignore */ }
      labelsRef.current = null;
    }

    if (!viewer || !center || !visible) return;

    // Detect DST transitions and timezone for this location
    let dstTransitions: DSTTransition[] | undefined;
    let tz: string | undefined;
    try {
      tz = tzlookup(latDeg, lonDeg);
      if (tz) {
        dstTransitions = findDSTTransitions(tz, new Date().getFullYear());
      }
    } catch { /* location has no DST or lookup failed */ }

    const lines = generateSunPathLines(latDeg, lonDeg, undefined, dstTransitions, tz);
    const collection = new Cesium.PrimitiveCollection();

    const labelCollection = new Cesium.LabelCollection({
      scene: viewer.scene,
    });

    for (const line of lines) {
      const positions = lineToPositions(line, center);
      if (positions.length < 2) continue;

      const style = styleForLine(line);

      const polyline = new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions,
            width: style.width,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
            arcType: Cesium.ArcType.NONE,
          }),
        }),
        appearance: new Cesium.PolylineMaterialAppearance({
          material: Cesium.Material.fromType('Color', {
            color: style.color,
          }),
        }),
      });

      collection.add(polyline);

      // Add arrowheads on hour lines to show annual direction
      // Uses the full unsplit point set (allHourPoints) for even spacing across the year
      if (line.allHourPoints && line.allHourPoints.length >= 4) {
        addArrowheads(
          line.allHourPoints, center, collection,
          Cesium.Color.WHITE.withAlpha(0.6),
          Cesium.Color.LIGHTPINK.withAlpha(0.7)
        );
      }

      if (line.type === 'month' || line.type === 'solstice' || line.type === 'dst') {
        // Use explicit midLabelPoint (computed at solar noon) if available,
        // otherwise fall back to the array midpoint
        const labelPos = line.midLabelPoint
          ? enuToECEF(...sunPathPointToENU(line.midLabelPoint, DOME_RADIUS), center)
          : positions[Math.floor(positions.length / 2)];
        const labelColor =
          line.type === 'solstice'
            ? Cesium.Color.ORANGE
            : line.type === 'dst'
            ? Cesium.Color.LIGHTPINK
            : Cesium.Color.GOLD;
        const fontSize =
          line.type === 'solstice' ? 'bold 22px monospace'
          : line.type === 'dst' ? 'bold 18px monospace'
          : 'bold 18px monospace';

        // Label above the line
        if (line.labelAbove) {
          labelCollection.add({
            position: labelPos,
            text: line.labelAbove,
            font: fontSize,
            fillColor: labelColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 4,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -6),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            show: true,
          });
        }

        // Label below the line — use separate midLabelPointBelow if available
        // (for intermediate arcs where the below label is a different date)
        if (line.labelBelow) {
          const belowPos = line.midLabelPointBelow
            ? enuToECEF(...sunPathPointToENU(line.midLabelPointBelow, DOME_RADIUS), center)
            : labelPos;
          labelCollection.add({
            position: belowPos,
            text: line.labelBelow,
            font: fontSize,
            fillColor: labelColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 4,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 6),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            show: true,
          });
        }

        // Extra labels at 9:00 and 17:00 positions
        if (line.extraLabelPoints) {
          for (const ep of line.extraLabelPoints) {
            const epPos = enuToECEF(...sunPathPointToENU(ep.point, DOME_RADIUS), center);
            if (ep.labelAbove) {
              labelCollection.add({
                position: epPos,
                text: ep.labelAbove,
                font: fontSize,
                fillColor: labelColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -6),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                show: true,
              });
            }
            if (ep.labelBelow) {
              labelCollection.add({
                position: epPos,
                text: ep.labelBelow,
                font: fontSize,
                fillColor: labelColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, 6),
                verticalOrigin: Cesium.VerticalOrigin.TOP,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                show: true,
              });
            }
          }
        }
      }

      // For hour lines, label at the solstice arc endpoints
      if (line.type === 'hour') {
        // Use explicit solstice-intersection points (skip label if solstice is below horizon)
        const topPos = line.topLabelPoint
          ? enuToECEF(...sunPathPointToENU(line.topLabelPoint, DOME_RADIUS), center)
          : undefined;
        const bottomPos = line.bottomLabelPoint
          ? enuToECEF(...sunPathPointToENU(line.bottomLabelPoint, DOME_RADIUS), center)
          : undefined;

        // Label above the top (summer solstice) end
        if (topPos) {
          labelCollection.add({
            position: topPos,
            text: line.labelAbove || line.label,
            font: 'bold 16px monospace',
            fillColor: Cesium.Color.WHITE.withAlpha(0.85),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -8),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            show: true,
          });
        }

        // Label below the bottom (winter solstice) end
        if (bottomPos) {
          labelCollection.add({
            position: bottomPos,
            text: line.labelBelow || line.label,
            font: 'bold 16px monospace',
            fillColor: Cesium.Color.WHITE.withAlpha(0.85),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 8),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            show: true,
          });
        }
      }

      // DST per-hour shifted clock labels
      if (line.dstHourLabels && line.dstHourLabels.length > 0) {
        const isAbove = line.dstHourLabelsPosition === 'above';
        for (const hl of line.dstHourLabels) {
          const [e, n, u] = sunPathPointToENU(hl.point, DOME_RADIUS);
          const hlPos = enuToECEF(e, n, u, center);
          labelCollection.add({
            position: hlPos,
            text: hl.label,
            font: 'bold 15px monospace',
            fillColor: Cesium.Color.LIGHTPINK.withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, isAbove ? -6 : 6),
            verticalOrigin: isAbove ? Cesium.VerticalOrigin.BOTTOM : Cesium.VerticalOrigin.TOP,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            show: true,
          });
        }
      }
    }

    // Add current sun position indicator
    try {
      const sunPos = computeCurrentSunPosition(latDeg, lonDeg, now);
      // Show if altitude is reasonable (e.g. > -10 degrees) or just always show on the path
      if (sunPos.altitude > -0.2) {
        const [e, n, u] = sunPathPointToENU(sunPos, DOME_RADIUS);
        const sunCart = enuToECEF(e, n, u, center);

        const billboardCollection = new Cesium.BillboardCollection();
        // Physical sun size: 0.53 deg at 500m
        const sunAngularDiameterRad = Cesium.Math.toRadians(0.533);
        const sunPhysicalDiameter = 2 * DOME_RADIUS * Math.tan(sunAngularDiameterRad / 2);
        billboardCollection.add({
          position: sunCart,
          image: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iI0ZGRkYwMCIgc3Ryb2tlPSIjRkZBNTAwIiBzdHJva2Utd2lkdGg9IjQiLz48L3N2Zz4=', // Yellow circle with orange stroke
          width: sunPhysicalDiameter,
          height: sunPhysicalDiameter,
          sizeInMeters: true,
          // Remove disableDepthTestDistance so walls occlude it
        });
        collection.add(billboardCollection);

        labelCollection.add({
          position: sunCart,
          text: 'NOW',
          font: 'bold 14px monospace',
          fillColor: Cesium.Color.YELLOW,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, 32), // Adjusted offset for larger meter-based billboard
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          // Remove disableDepthTestDistance so walls occlude it
          show: true,
        });
      }
    } catch (e) {
      console.error("Error computing sun position", e);
    }

    viewer.scene.primitives.add(collection);
    viewer.scene.primitives.add(labelCollection);

    collectionRef.current = collection;
    labelsRef.current = labelCollection;

    return () => {
      if (collectionRef.current && viewer) {
        try {
          viewer.scene.primitives.remove(collectionRef.current);
        } catch { /* ignore */ }
        collectionRef.current = null;
      }
      if (labelsRef.current && viewer) {
        try {
          viewer.scene.primitives.remove(labelsRef.current);
        } catch { /* ignore */ }
        labelsRef.current = null;
      }
    };
  }, [viewer, center, latDeg, lonDeg, visible, now]);
}
