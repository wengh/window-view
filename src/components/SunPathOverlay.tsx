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
  type SunPathLine,
  type DSTTransition,
} from '../logic/SunPath';

/**
 * Radius of the sky dome on which the sun path lines are drawn (meters).
 * Large enough to look infinite but small enough to stay inside the far clip.
 */
const DOME_RADIUS = 500;

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
      return { color: Cesium.Color.WHITE.withAlpha(0.45), width: 1 };
    case 'dst':
      return { color: Cesium.Color.CYAN.withAlpha(0.85), width: 2.5 };
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

      // Add labels for month/solstice/dst lines using labelAbove / labelBelow
      if (line.type === 'month' || line.type === 'solstice' || line.type === 'dst') {
        const midIdx = Math.floor(positions.length / 2);
        const labelPos = positions[midIdx];
        const labelColor =
          line.type === 'solstice'
            ? Cesium.Color.ORANGE
            : line.type === 'dst'
            ? Cesium.Color.CYAN
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
            pixelOffset: new Cesium.Cartesian2(0, -14),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: true,
          });
        }

        // Label below the line
        if (line.labelBelow) {
          labelCollection.add({
            position: labelPos,
            text: line.labelBelow,
            font: fontSize,
            fillColor: labelColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 4,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 14),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
                pixelOffset: new Cesium.Cartesian2(0, -14),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
                pixelOffset: new Cesium.Cartesian2(0, 14),
                verticalOrigin: Cesium.VerticalOrigin.TOP,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
            pixelOffset: new Cesium.Cartesian2(0, -16),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
            pixelOffset: new Cesium.Cartesian2(0, 16),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
            fillColor: Cesium.Color.CYAN.withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, isAbove ? -14 : 14),
            verticalOrigin: isAbove ? Cesium.VerticalOrigin.BOTTOM : Cesium.VerticalOrigin.TOP,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: true,
          });
        }
      }
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
  }, [viewer, center, latDeg, lonDeg, visible]);
}
