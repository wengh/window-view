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

  const wingLen = DOME_RADIUS * Math.tan(0.5 * Math.PI / 180); // 0.5 degrees wing
  const halfAngle = Math.PI / 6; // 30° half-angle

  for (let a = 0; a < numArrows; a++) {
    const idx = Math.floor(taggedPoints.length * (a + 0.5) / numArrows);
    const { pt, dst } = taggedPoints[idx];
    const color = dst ? dstColor : stdColor;

    // Current and next point for direction
    const tipENU = sunPathPointToENU(pt, DOME_RADIUS);
    const nextENU = sunPathPointToENU(taggedPoints[(idx + 1) % taggedPoints.length].pt, DOME_RADIUS);

    // Direction vector (prev to tip direction ideally, using next-tip here as approximation for tangent)
    const dx = nextENU[0] - tipENU[0];
    const dy = nextENU[1] - tipENU[1];
    const dz = nextENU[2] - tipENU[2];
    const dirLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dirLen < 1e-6) continue;

    // Unit direction
    const ux = dx / dirLen, uy = dy / dirLen, uz = dz / dirLen;

    // Radial vector (normal to sphere surface)
    const rLen = Math.sqrt(tipENU[0] ** 2 + tipENU[1] ** 2 + tipENU[2] ** 2);
    const rx = tipENU[0] / rLen, ry = tipENU[1] / rLen, rz = tipENU[2] / rLen;

    // Perpendicular vector (tangent to surface, perp to direction) = Cross(dir, radial)
    let px = uy * rz - uz * ry;
    let py = uz * rx - ux * rz;
    let pz = ux * ry - uy * rx;
    const pLen = Math.sqrt(px * px + py * py + pz * pz);
    if (pLen < 1e-6) continue;
    px /= pLen; py /= pLen; pz /= pLen;

    // Reverse direction for arrow wings
    const bx = -ux, by = -uy, bz = -uz;

    // Rotate reverse vector by +/- halfAngle in the plane defined by (revDir, perp)
    const cosH = Math.cos(halfAngle);
    const sinH = Math.sin(halfAngle);

    // Left wing
    const lwx = bx * cosH + px * sinH;
    const lwy = by * cosH + py * sinH;
    const lwz = bz * cosH + pz * sinH;

    // Right wing
    const rwx = bx * cosH - px * sinH;
    const rwy = by * cosH - py * sinH;
    const rwz = bz * cosH - pz * sinH;

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

    const tipECEF = enuToECEF(...tipENU, center);
    const leftECEF = enuToECEF(...leftWingENU, center);
    const rightECEF = enuToECEF(...rightWingENU, center);

    const createWing = (p1: Cesium.Cartesian3, p2: Cesium.Cartesian3) => new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: [p1, p2],
        width: 2,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        arcType: Cesium.ArcType.NONE,
      }),
    });

    collection.add(new Cesium.Primitive({
      geometryInstances: [createWing(leftECEF, tipECEF), createWing(rightECEF, tipECEF)],
      appearance: new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('Color', { color }),
      }),
    }));
  }
}

/**
 * Add a text label to the collection.
 */
function addLabel(
  collection: Cesium.LabelCollection,
  position: Cesium.Cartesian3,
  text: string,
  options: {
    color: Cesium.Color;
    font?: string;
    verticalOrigin?: Cesium.VerticalOrigin;
    pixelOffset?: Cesium.Cartesian2;
  }
) {
  collection.add({
    position,
    text,
    font: options.font || 'bold 18px monospace',
    fillColor: options.color,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 4,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: options.pixelOffset || new Cesium.Cartesian2(0, 0),
    verticalOrigin: options.verticalOrigin || Cesium.VerticalOrigin.CENTER,
    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
    show: true,
  });
}

/**
 * Render all labels for a single sun path line.
 */
function renderLineLabels(
  line: SunPathLine,
  positions: Cesium.Cartesian3[],
  center: Cesium.Cartesian3,
  labels: Cesium.LabelCollection
) {
  // Determine basic label styles
  let labelColor = Cesium.Color.GOLD;
  let fontSize = 'bold 18px monospace';

  if (line.type === 'solstice') {
    labelColor = Cesium.Color.ORANGE;
    fontSize = 'bold 22px monospace';
  } else if (line.type === 'dst') {
    labelColor = Cesium.Color.LIGHTPINK;
  } else if (line.type === 'hour') {
    labelColor = Cesium.Color.WHITE.withAlpha(0.85);
    fontSize = 'bold 16px monospace';
  }

  // Helper to convert SunPathPoint to ECEF
  const toGlobal = (pt: SunPathPoint) => enuToECEF(...sunPathPointToENU(pt, DOME_RADIUS), center);

  // Common label adding helper
  const drawLineLabel = (
    pos: Cesium.Cartesian3,
    text: string,
    verticalPos: 'above' | 'below'
  ) => {
    addLabel(labels, pos, text, {
      color: labelColor,
      font: fontSize,
      verticalOrigin: verticalPos === 'above' ? Cesium.VerticalOrigin.BOTTOM : Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(0, verticalPos === 'above' ? -6 : 6),
    });
  };

  // 1. Hour Lines
  if (line.type === 'hour') {
    if (line.topLabelPoint) {
      drawLineLabel(toGlobal(line.topLabelPoint), line.labelAbove || line.label, 'above');
    }
    if (line.bottomLabelPoint) {
      drawLineLabel(toGlobal(line.bottomLabelPoint), line.labelBelow || line.label, 'below');
    }
  }

  // 2. Month / Solstice / DST Lines
  if (['month', 'solstice', 'dst'].includes(line.type)) {
    // Main label (mid)
    const midPos = line.midLabelPoint ? toGlobal(line.midLabelPoint) : positions[Math.floor(positions.length / 2)];
    if (line.labelAbove) drawLineLabel(midPos, line.labelAbove, 'above');

    // Bottom mid label (if distinct from top)
    const midPosBelow = line.midLabelPointBelow ? toGlobal(line.midLabelPointBelow) : midPos;
    if (line.labelBelow) drawLineLabel(midPosBelow, line.labelBelow, 'below');

    // Extra labels (9am, 3pm, etc)
    if (line.extraLabelPoints) {
      for (const ep of line.extraLabelPoints) {
        const p = toGlobal(ep.point);
        if (ep.labelAbove) drawLineLabel(p, ep.labelAbove, 'above');
        if (ep.labelBelow) drawLineLabel(p, ep.labelBelow, 'below');
      }
    }
  }

  // 3. DST Offset Hour Labels
  if (line.dstHourLabels && line.dstHourLabels.length > 0) {
    const isAbove = line.dstHourLabelsPosition === 'above';
    for (const hl of line.dstHourLabels) {
       addLabel(labels, toGlobal(hl.point), hl.label, {
         color: Cesium.Color.LIGHTPINK.withAlpha(0.9),
         font: 'bold 15px monospace',
         verticalOrigin: isAbove ? Cesium.VerticalOrigin.BOTTOM : Cesium.VerticalOrigin.TOP,
         pixelOffset: new Cesium.Cartesian2(0, isAbove ? -6 : 6),
       });
    }
  }
}

// ---- Imperative hook ----

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
      try { viewer.scene.primitives.remove(collectionRef.current); } catch { /* ignore */ }
      collectionRef.current = null;
    }
    if (labelsRef.current && viewer) {
      try { viewer.scene.primitives.remove(labelsRef.current); } catch { /* ignore */ }
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
    const labelCollection = new Cesium.LabelCollection({ scene: viewer.scene });

    // Render Lines & Static Labels
    for (const line of lines) {
      const positions = lineToPositions(line, center);
      if (positions.length < 2) continue;

      const style = styleForLine(line);
      collection.add(new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions,
            width: style.width,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
            arcType: Cesium.ArcType.NONE,
          }),
        }),
        appearance: new Cesium.PolylineMaterialAppearance({
          material: Cesium.Material.fromType('Color', { color: style.color }),
        }),
      }));

      // Add arrowheads on hour lines to show annual direction
      // Uses the full unsplit point set (allHourPoints) for even spacing across the year
      if (line.allHourPoints && line.allHourPoints.length >= 4) {
        addArrowheads(
          line.allHourPoints, center, collection,
          Cesium.Color.WHITE.withAlpha(0.6),
          Cesium.Color.LIGHTPINK.withAlpha(0.7)
        );
      }

      // Render Labels
      renderLineLabels(line, positions, center, labelCollection);
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

        // "NOW" label
        addLabel(labelCollection, sunCart, 'NOW', {
          color: Cesium.Color.YELLOW,
          font: 'bold 14px monospace',
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 32),
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
