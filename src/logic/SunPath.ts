/**
 * SunPath.ts — Computes sun positions and generates sun-path polylines
 * for rendering on a sky dome in the Cesium viewer.
 *
 * Uses standard astronomical formulas for solar declination,
 * equation of time, hour angle, altitude, and azimuth.
 */

// ---- Solar position math ----

/** Degrees to radians */
const DEG = Math.PI / 180;

/**
 * Day-of-year (1-based) for a given Date (UTC).
 */
function dayOfYear(d: Date): number {
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}

/**
 * Solar declination in radians for a given day-of-year.
 * (Spencer, 1971 approximation)
 */
function solarDeclination(doy: number): number {
  const B = (2 * Math.PI * (doy - 81)) / 365;
  return 23.4393 * DEG * Math.sin(B);
}

/**
 * Compute sun altitude (elevation) and azimuth for a specific time/location.
 *
 * @param latRad  Observer latitude in radians
 * @param decl    Solar declination in radians
 * @param hourAngle  Hour angle in radians (0 = solar noon, negative = morning)
 * @returns { altitude, azimuth } both in radians.
 *          azimuth is measured clockwise from North (0=N, π/2=E, π=S, 3π/2=W).
 */
function sunPosition(latRad: number, decl: number, hourAngle: number) {
  const sinAlt =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosAz =
    (Math.sin(decl) - Math.sin(latRad) * sinAlt) /
    (Math.cos(latRad) * Math.cos(altitude) + 1e-12);
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  // If hour angle > 0 (afternoon), azimuth is > π (west side)
  if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth;

  return { altitude, azimuth };
}

// ---- Line generation ----

export interface SunPathPoint {
  /** Altitude in radians (0 = horizon, π/2 = zenith) */
  altitude: number;
  /** Azimuth in radians, clockwise from North */
  azimuth: number;
}

export interface DSTHourLabel {
  /** Sun position for this hour on the DST date */
  point: SunPathPoint;
  /** The shifted clock-hour label (e.g. "7:00") */
  label: string;
}

export interface SunPathLine {
  points: SunPathPoint[];
  /** Display label (fallback) */
  label: string;
  /** Label positioned above the arc midpoint */
  labelAbove?: string;
  /** Label positioned below the arc midpoint */
  labelBelow?: string;
  /** Per-hour shifted clock labels for DST lines */
  dstHourLabels?: DSTHourLabel[];
  /** Whether DST hour labels go above or below the arc */
  dstHourLabelsPosition?: 'above' | 'below';
  /** Explicit position for the top (above) label — used for hour cross-lines */
  topLabelPoint?: SunPathPoint;
  /** Explicit position for the bottom (below) label — used for hour cross-lines */
  bottomLabelPoint?: SunPathPoint;
  /** Extra label positions along the arc (e.g., at 9:00 and 17:00) */
  extraLabelPoints?: Array<{ point: SunPathPoint; labelAbove?: string; labelBelow?: string }>;
  /** Category for styling */
  type: 'month' | 'solstice' | 'hour' | 'dst';
}

export interface DSTTransition {
  /** Day of year */
  doy: number;
  /** Month (1-based) */
  month: number;
  /** Day of month */
  day: number;
  /** True if clocks spring forward, false if they fall back */
  springForward: boolean;
  /** Offset change in hours (e.g., +1 or -1) */
  offsetChangeHours: number;
}

/**
 * Get UTC offset in hours for a timezone at a given date.
 */
function getUTCOffsetHours(timezone: string, date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone });
  return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 3600000;
}

/**
 * Detect DST transitions for a given IANA timezone and year.
 * Scans each day of the year for UTC offset changes.
 */
export function findDSTTransitions(timezone: string, year: number): DSTTransition[] {
  const transitions: DSTTransition[] = [];

  let prevOffset = getUTCOffsetHours(timezone, new Date(Date.UTC(year, 0, 1, 12)));

  for (let month = 0; month < 12; month++) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, month, day, 12));
      const offset = getUTCOffsetHours(timezone, date);

      if (Math.abs(offset - prevOffset) > 0.01) {
        const change = offset - prevOffset;
        const start = new Date(Date.UTC(year, 0, 1));
        const doy = Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;

        transitions.push({
          doy,
          month: month + 1,
          day,
          springForward: change > 0,
          offsetChangeHours: change,
        });
      }
      prevOffset = offset;
    }
  }

  return transitions;
}

/**
 * Convert a day-of-year to [month, day] (1-based).
 */
function doyToMonthDay(doy: number, year: number): [number, number] {
  const date = new Date(Date.UTC(year, 0, doy));
  return [date.getUTCMonth() + 1, date.getUTCDate()];
}

/**
 * Generate all sun-path lines for a given latitude and longitude (degrees).
 *
 * Returns:
 * - 2 solstice arcs (June 21 & Dec 21)
 * - 5 intermediate arcs evenly spaced between solstices, each labeled with
 *   the 2 dates in the year that share that solar declination
 * - Hourly cross-lines for each integer hour where the sun can be above the horizon
 *
 * @param latDeg  Latitude in degrees (positive = north)
 * @param lonDeg  Longitude in degrees (positive = east)
 * @param year    Year for the calculation (defaults to current year)
 */
export function generateSunPathLines(
  latDeg: number,
  lonDeg: number,
  year: number = new Date().getFullYear(),
  dstTransitions?: DSTTransition[],
  timezone?: string
): SunPathLine[] {
  const latRad = latDeg * DEG;
  const lines: SunPathLine[] = [];

  // Helper: generate an arc for a specific day-of-year
  const arcForDay = (doy: number): SunPathPoint[] => {
    const decl = solarDeclination(doy);
    const points: SunPathPoint[] = [];

    // Sweep from -12h to +12h in 5-minute steps
    for (let m = -720; m <= 720; m += 5) {
      // Solar time offset in hours
      const solarHour = m / 60;
      const hourAngle = solarHour * 15 * DEG; // 15°/hour
      const pos = sunPosition(latRad, decl, hourAngle);
      if (pos.altitude > -0.5 * DEG) {
        // Include points slightly below horizon for smooth clipping
        points.push(pos);
      }
    }
    return points;
  };

  // Compute solar-to-clock-time correction early for use in extra labels
  let clockCorr = 0;
  let dstAdj = 0;

  if (timezone) {
    const winterOff = getUTCOffsetHours(timezone, new Date(Date.UTC(year, 0, 15, 12)));
    const summerOff = getUTCOffsetHours(timezone, new Date(Date.UTC(year, 6, 15, 12)));
    const stdOff = Math.min(winterOff, summerOff);
    dstAdj = Math.max(winterOff, summerOff) - stdOff;
    clockCorr = stdOff - lonDeg / 15;
  }

  // Solstice DOYs (approximate)
  const summerSolsticeDoy = dayOfYear(new Date(Date.UTC(year, 5, 21))); // June 21
  const winterSolsticeDoy = dayOfYear(new Date(Date.UTC(year, 11, 21))); // Dec 21

  // In northern hemisphere Jun 21 = top arc, Dec 21 = bottom arc.
  // In southern hemisphere it's reversed.
  const isNorthern = latDeg >= 0;

  // Helper: compute extra date label positions at ±3 solar hours from noon on a given day's arc
  const extraLabelsForArc = (
    doy: number,
    labAbove?: string,
    labBelow?: string
  ): Array<{ point: SunPathPoint; labelAbove?: string; labelBelow?: string }> => {
    const decl = solarDeclination(doy);
    const extras: Array<{ point: SunPathPoint; labelAbove?: string; labelBelow?: string }> = [];
    // Place labels 3 solar hours before and after noon (symmetric with the midpoint label)
    for (const solarHour of [-3, 3]) {
      const hourAngle = solarHour * 15 * DEG;
      const pos = sunPosition(latRad, decl, hourAngle);
      if (pos.altitude > 0) {
        extras.push({ point: pos, labelAbove: labAbove, labelBelow: labBelow });
      }
    }
    return extras;
  };

  // 1. Solstice arcs
  // Place label on the side that doesn't overlap with hour labels at the extremes.
  {
    const pts = arcForDay(summerSolsticeDoy);
    if (pts.length > 1) {
      const labAbove = isNorthern ? undefined : '6/21';
      const labBelow = isNorthern ? '6/21' : undefined;
      lines.push({
        points: pts,
        label: '6/21',
        labelAbove: labAbove,
        labelBelow: labBelow,
        extraLabelPoints: extraLabelsForArc(summerSolsticeDoy, labAbove, labBelow),
        type: 'solstice',
      });
    }
  }
  {
    const pts = arcForDay(winterSolsticeDoy);
    if (pts.length > 1) {
      const labAbove = isNorthern ? '12/21' : undefined;
      const labBelow = isNorthern ? undefined : '12/21';
      lines.push({
        points: pts,
        label: '12/21',
        labelAbove: labAbove,
        labelBelow: labBelow,
        extraLabelPoints: extraLabelsForArc(winterSolsticeDoy, labAbove, labBelow),
        type: 'solstice',
      });
    }
  }

  // 2. Five intermediate arcs evenly spaced between winter and summer solstice.
  const halfYearDays = ((summerSolsticeDoy - winterSolsticeDoy) + 365) % 365;

  const intermediateDoys: number[] = [];

  for (let k = 1; k <= 5; k++) {
    const daysFromWinter = Math.round(halfYearDays * k / 6);
    const ascendingDoy = ((winterSolsticeDoy + daysFromWinter - 1) % 365) + 1;
    const descendingDoy = ((winterSolsticeDoy + (365 - daysFromWinter) - 1) % 365) + 1;

    intermediateDoys.push(ascendingDoy);

    const [m1, d1] = doyToMonthDay(ascendingDoy, year);
    const [m2, d2] = doyToMonthDay(descendingDoy, year);

    const ascLabel = `${m1}/${d1}`;
    const descLabel = `${m2}/${d2}`;

    const labAbove = isNorthern ? ascLabel : descLabel;
    const labBelow = isNorthern ? descLabel : ascLabel;

    const pts = arcForDay(ascendingDoy);
    if (pts.length > 1) {
      lines.push({
        points: pts,
        label: ascLabel,
        labelAbove: labAbove,
        labelBelow: labBelow,
        extraLabelPoints: extraLabelsForArc(ascendingDoy, labAbove, labBelow),
        type: 'month',
      });
    }
  }

  // 3. Hourly cross-lines
  // For each integer solar hour, connect the sun positions across all arc DOYs.
  const sampleDoys = [winterSolsticeDoy, ...intermediateDoys, summerSolsticeDoy];
  sampleDoys.sort((a, b) => a - b);
  const uniqueDoys = [...new Set(sampleDoys)];

  for (let hour = -12; hour <= 12; hour++) {
    const hourAngle = hour * 15 * DEG;
    const pts: SunPathPoint[] = [];

    for (const doy of uniqueDoys) {
      const decl = solarDeclination(doy);
      const pos = sunPosition(latRad, decl, hourAngle);
      if (pos.altitude > 0) {
        pts.push(pos);
      }
    }

    if (pts.length >= 2) {
      // Convert to timezone clock time
      const stdClockHour = Math.round(12 + hour + clockCorr);
      const dstClockHour = Math.round(12 + hour + clockCorr + dstAdj);
      if (stdClockHour < 0 || stdClockHour > 24) continue;

      const stdLabel = `${stdClockHour}:00`;
      const dstLabel = `${dstClockHour}:00`;

      // Compute label positions at solstice arc intersections (not max/min altitude)
      // This prevents labels from appearing at the zenith near the equator
      const junPos = sunPosition(latRad, solarDeclination(summerSolsticeDoy), hourAngle);
      const decPos = sunPosition(latRad, solarDeclination(winterSolsticeDoy), hourAngle);
      const topPoint = junPos.altitude > decPos.altitude ? junPos : decPos;
      const bottomPoint = junPos.altitude > decPos.altitude ? decPos : junPos;

      lines.push({
        points: pts,
        label: stdLabel,
        // Top = summer solstice end → DST time (if observed)
        labelAbove: dstAdj > 0 ? dstLabel : stdLabel,
        // Bottom = winter solstice end → standard time
        labelBelow: stdLabel,
        topLabelPoint: topPoint.altitude > 0 ? topPoint : undefined,
        bottomLabelPoint: bottomPoint.altitude > 0 ? bottomPoint : undefined,
        type: 'hour',
      });
    }
  }

  // 4. DST transition lines
  if (dstTransitions && dstTransitions.length > 0) {
    for (const dst of dstTransitions) {
      const pts = arcForDay(dst.doy);
      if (pts.length > 1) {
        const dateLabel = `${dst.month}/${dst.day}`;
        const decl = solarDeclination(dst.doy);

        // Compute clock-hour labels at each integer solar hour
        const dstHourLabels: DSTHourLabel[] = [];
        for (let hour = -12; hour <= 12; hour++) {
          const hourAngle = hour * 15 * DEG;
          const pos = sunPosition(latRad, decl, hourAngle);
          if (pos.altitude > 0) {
            // Clock time on the "after" side of the transition
            const afterClockHour = dst.springForward
              ? Math.round(12 + hour + clockCorr + dstAdj)  // after spring-forward = DST
              : Math.round(12 + hour + clockCorr);           // after fall-back = standard
            if (afterClockHour >= 0 && afterClockHour <= 24) {
              dstHourLabels.push({
                point: pos,
                label: `${afterClockHour}:00`,
              });
            }
          }
        }

        if (dst.springForward) {
          // Spring forward: date below (before), shifted hours above (after)
          lines.push({
            points: pts,
            label: dateLabel,
            labelBelow: dateLabel,
            dstHourLabels,
            dstHourLabelsPosition: 'above',
            type: 'dst',
          });
        } else {
          // Fall back: date above (before), shifted hours below (after)
          lines.push({
            points: pts,
            label: dateLabel,
            labelAbove: dateLabel,
            dstHourLabels,
            dstHourLabelsPosition: 'below',
            type: 'dst',
          });
        }
      }
    }
  }

  return lines;
}

/**
 * Convert a SunPathPoint (altitude/azimuth on the sky) to a local
 * East-North-Up (ENU) direction vector (unit length), then scale to
 * a given radius.
 *
 * The returned [x, y, z] is in ENU coordinates:
 *   x = East, y = North, z = Up
 *
 * @param pt      Sun path point (altitude/azimuth)
 * @param radius  Distance from center (dome radius)
 */
export function sunPathPointToENU(
  pt: SunPathPoint,
  radius: number
): [number, number, number] {
  const cosAlt = Math.cos(pt.altitude);
  const sinAlt = Math.sin(pt.altitude);
  // Azimuth: 0=North, π/2=East, π=South, 3π/2=West
  const sinAz = Math.sin(pt.azimuth);
  const cosAz = Math.cos(pt.azimuth);

  // East  = sinAz * cosAlt
  // North = cosAz * cosAlt
  // Up    = sinAlt
  return [
    radius * sinAz * cosAlt,
    radius * cosAz * cosAlt,
    radius * sinAlt,
  ];
}
