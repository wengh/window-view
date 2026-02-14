/**
 * SunPath.ts — Computes sun positions and generates sun-path polylines
 * for rendering on a sky dome in the Cesium viewer.
 *
 * All solar position calculations use the suncalc library for precise
 * astronomical accuracy that matches Cesium's internal sun model.
 */

import SunCalc from 'suncalc'

// ---- Constants ----

// ---- Helpers ----

/**
 * Day-of-year (1-based) for a given Date (UTC).
 */
function dayOfYear(d: Date): number {
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1
}

/**
 * Convert suncalc's azimuth convention to ours.
 *
 * suncalc: 0 = South, positive = West (clockwise from South)
 * ours:    0 = North, positive = East (clockwise from North)
 *
 * Conversion: ourAz = suncalcAz + π
 */
function convertAzimuth(suncalcAz: number): number {
  let az = suncalcAz + Math.PI
  if (az < 0) az += 2 * Math.PI
  if (az >= 2 * Math.PI) az -= 2 * Math.PI
  return az
}

/**
 * Get a SunPathPoint from suncalc for a given date and location.
 */
function getSunPoint(date: Date, latDeg: number, lonDeg: number): SunPathPoint {
  const pos = SunCalc.getPosition(date, latDeg, lonDeg)
  return {
    altitude: pos.altitude,
    azimuth: convertAzimuth(pos.azimuth),
  }
}

// ---- Line generation ----

export interface SunPathPoint {
  /** Altitude in radians (0 = horizon, π/2 = zenith) */
  altitude: number
  /** Azimuth in radians, clockwise from North */
  azimuth: number
}

export interface DSTHourLabel {
  /** Sun position for this hour on the DST date */
  point: SunPathPoint
  /** The shifted clock-hour label (e.g. "7:00") */
  label: string
}

export interface SunPathLine {
  points: SunPathPoint[]
  /** Display label (fallback) */
  label: string
  /** Label positioned above the arc midpoint */
  labelAbove?: string
  /** Label positioned below the arc midpoint */
  labelBelow?: string
  /** Per-hour shifted clock labels for DST lines */
  dstHourLabels?: DSTHourLabel[]
  /** Whether DST hour labels go above or below the arc */
  dstHourLabelsPosition?: 'above' | 'below'
  /** Explicit position for the top (above) label — used for hour cross-lines */
  topLabelPoint?: SunPathPoint
  /** Explicit position for the bottom (below) label — used for hour cross-lines */
  bottomLabelPoint?: SunPathPoint
  /** Extra label positions along the arc (e.g., at 9:00 and 15:00) */
  extraLabelPoints?: Array<{ point: SunPathPoint; labelAbove?: string; labelBelow?: string }>
  /** Explicit position for the center date label above (computed at solar noon) */
  midLabelPoint?: SunPathPoint
  /** Explicit position for the center date label below — for arcs with two dates */
  midLabelPointBelow?: SunPathPoint
  /** Full unsplit hour line points with DST tags (for arrow placement across entire year) */
  allHourPoints?: Array<{ pt: SunPathPoint; dst: boolean }>
  /** Category for styling */
  type: 'month' | 'solstice' | 'hour' | 'hour-dst' | 'dst'
}

export interface DSTTransition {
  /** Day of year */
  doy: number
  /** Month (1-based) */
  month: number
  /** Day of month */
  day: number
  /** True if clocks spring forward, false if they fall back */
  springForward: boolean
  /** Offset change in hours (e.g., +1 or -1) */
  offsetChangeHours: number
}

/**
 * Get UTC offset in hours for a timezone at a given date.
 */
function getUTCOffsetHours(timezone: string, date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone })
  return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 3600000
}

/**
 * Detect DST transitions for a given IANA timezone and year.
 * Scans each day of the year for UTC offset changes.
 */
export function findDSTTransitions(timezone: string, year: number): DSTTransition[] {
  const transitions: DSTTransition[] = []

  let prevOffset = getUTCOffsetHours(timezone, new Date(Date.UTC(year, 0, 1, 12)))

  for (let month = 0; month < 12; month++) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, month, day, 12))
      const offset = getUTCOffsetHours(timezone, date)

      if (Math.abs(offset - prevOffset) > 0.01) {
        const change = offset - prevOffset
        const start = new Date(Date.UTC(year, 0, 1))
        const doy = Math.floor((date.getTime() - start.getTime()) / 86400000) + 1

        transitions.push({
          doy,
          month: month + 1,
          day,
          springForward: change > 0,
          offsetChangeHours: change,
        })
      }
      prevOffset = offset
    }
  }

  return transitions
}

/**
 * Convert a day-of-year to [month, day] (1-based).
 */
function doyToMonthDay(doy: number, year: number): [number, number] {
  const date = new Date(Date.UTC(year, 0, doy))
  return [date.getUTCMonth() + 1, date.getUTCDate()]
}

/**
 * Generate all sun-path lines for a given latitude and longitude (degrees).
 *
 * All positions computed via suncalc for precise accuracy.
 *
 * Returns:
 * - 2 solstice arcs (June 21 & Dec 21)
 * - 5 intermediate arcs evenly spaced between solstices, each labeled with
 *   the 2 dates in the year that share that solar declination
 * - Hourly cross-lines for each integer standard-time hour
 * - DST transition day arcs (if applicable)
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
  // Timezone offset info
  let stdOffset = 0 // Standard time UTC offset in hours
  let dstAdj = 0 // Additional DST offset in hours (e.g. 1)

  if (timezone) {
    const winterOff = getUTCOffsetHours(timezone, new Date(Date.UTC(year, 0, 15, 12)))
    const summerOff = getUTCOffsetHours(timezone, new Date(Date.UTC(year, 6, 15, 12)))
    stdOffset = Math.min(winterOff, summerOff)
    dstAdj = Math.max(winterOff, summerOff) - stdOffset
  }

  const ctx: SunPathContext = {
    latDeg,
    lonDeg,
    year,
    stdOffset,
    dstAdj,
    isNorthern: latDeg >= 0,
  }

  return [
    ...generateSolsticeArcs(ctx),
    ...generateIntermediateArcs(ctx),
    ...generateHourLines(ctx, dstTransitions),
    ...generateDSTTransitionLines(ctx, dstTransitions),
  ]
}

// ---- Internal Context & Helpers for Refactoring ----

interface SunPathContext {
  latDeg: number
  lonDeg: number
  year: number
  stdOffset: number
  dstAdj: number
  isNorthern: boolean
}

/**
 * Generate an arc for a specific date by sweeping from local standard midnight.
 */
function arcForDate(ctx: SunPathContext, month0: number, day: number): SunPathPoint[] {
  const points: SunPathPoint[] = []
  const baseDate = new Date(Date.UTC(ctx.year, month0, day))
  const startMinUTC = Math.round(-ctx.stdOffset * 60)
  for (let min = 0; min < 1440; min += 5) {
    const date = new Date(baseDate.getTime() + (startMinUTC + min) * 60000)
    const pt = getSunPoint(date, ctx.latDeg, ctx.lonDeg)
    if (pt.altitude > 0) {
      points.push(pt)
    }
  }
  return points
}

/**
 * Create a UTC Date for a given standard clock hour on a specific date.
 */
function dateAtStdHour(ctx: SunPathContext, month0: number, day: number, clockHour: number): Date {
  const utcTotalMinutes = Math.round(clockHour * 60 - ctx.stdOffset * 60)
  const d = new Date(Date.UTC(ctx.year, month0, day))
  d.setUTCMinutes(d.getUTCMinutes() + utcTotalMinutes)
  return d
}

/**
 * Compute extra date label positions at ~9:00 and ~15:00 standard time.
 */
function extraLabelsForDate(
  ctx: SunPathContext,
  month0: number,
  day: number,
  labAbove?: string,
  labBelow?: string
): Array<{ point: SunPathPoint; labelAbove?: string; labelBelow?: string }> {
  const extras: Array<{ point: SunPathPoint; labelAbove?: string; labelBelow?: string }> = []
  for (const clockHour of [9, 15]) {
    const date = dateAtStdHour(ctx, month0, day, clockHour)
    const pt = getSunPoint(date, ctx.latDeg, ctx.lonDeg)
    if (pt.altitude > 0) {
      extras.push({ point: pt, labelAbove: labAbove, labelBelow: labBelow })
    }
  }
  return extras
}

/**
 * Compute midpoint label at solar noon (12:00 standard time).
 */
function midLabelForDate(
  ctx: SunPathContext,
  month0: number,
  day: number
): SunPathPoint | undefined {
  const date = dateAtStdHour(ctx, month0, day, 12)
  const pt = getSunPoint(date, ctx.latDeg, ctx.lonDeg)
  return pt.altitude > 0 ? pt : undefined
}

// ---- Sub-generators ----

function generateSolsticeArcs(ctx: SunPathContext): SunPathLine[] {
  const lines: SunPathLine[] = []
  const summerSolstice = { month0: 5, day: 21 }
  const winterSolstice = { month0: 11, day: 21 }

  // Summer Solstice
  {
    const pts = arcForDate(ctx, summerSolstice.month0, summerSolstice.day)
    if (pts.length > 1) {
      const labAbove = ctx.isNorthern ? undefined : '6/21'
      const labBelow = ctx.isNorthern ? '6/21' : undefined
      lines.push({
        points: pts,
        label: '6/21',
        labelAbove: labAbove,
        labelBelow: labBelow,
        extraLabelPoints: extraLabelsForDate(
          ctx,
          summerSolstice.month0,
          summerSolstice.day,
          labAbove,
          labBelow
        ),
        midLabelPoint: midLabelForDate(ctx, summerSolstice.month0, summerSolstice.day),
        type: 'solstice',
      })
    }
  }

  // Winter Solstice
  {
    const pts = arcForDate(ctx, winterSolstice.month0, winterSolstice.day)
    if (pts.length > 1) {
      const labAbove = ctx.isNorthern ? '12/21' : undefined
      const labBelow = ctx.isNorthern ? undefined : '12/21'
      lines.push({
        points: pts,
        label: '12/21',
        labelAbove: labAbove,
        labelBelow: labBelow,
        extraLabelPoints: extraLabelsForDate(
          ctx,
          winterSolstice.month0,
          winterSolstice.day,
          labAbove,
          labBelow
        ),
        midLabelPoint: midLabelForDate(ctx, winterSolstice.month0, winterSolstice.day),
        type: 'solstice',
      })
    }
  }

  return lines
}

function generateIntermediateArcs(ctx: SunPathContext): SunPathLine[] {
  const lines: SunPathLine[] = []
  const summerSolsticeDoy = dayOfYear(new Date(Date.UTC(ctx.year, 5, 21)))
  const winterSolsticeDoy = dayOfYear(new Date(Date.UTC(ctx.year, 11, 21)))
  const halfYearDays = (summerSolsticeDoy - winterSolsticeDoy + 365) % 365

  for (let k = 1; k <= 5; k++) {
    const daysFromWinter = Math.round((halfYearDays * k) / 6)
    const ascendingDoy = ((winterSolsticeDoy + daysFromWinter - 1) % 365) + 1
    const descendingDoy = ((winterSolsticeDoy + (365 - daysFromWinter) - 1) % 365) + 1

    const [m1, d1] = doyToMonthDay(ascendingDoy, ctx.year)
    const [m2, d2] = doyToMonthDay(descendingDoy, ctx.year)

    const ascLabel = `${m1}/${d1}`
    const descLabel = `${m2}/${d2}`

    const labAbove = ctx.isNorthern ? descLabel : ascLabel
    const labBelow = ctx.isNorthern ? ascLabel : descLabel

    const pts = arcForDate(ctx, m1 - 1, d1)
    if (pts.length > 1) {
      // Extra labels: descending date positions carry labAbove, ascending carry labBelow
      const descExtras = extraLabelsForDate(ctx, m2 - 1, d2, labAbove, undefined)
      const ascExtras = extraLabelsForDate(ctx, m1 - 1, d1, undefined, labBelow)

      lines.push({
        points: pts,
        label: ascLabel,
        labelAbove: labAbove,
        labelBelow: labBelow,
        extraLabelPoints: [...descExtras, ...ascExtras],
        midLabelPoint: midLabelForDate(ctx, m2 - 1, d2),
        midLabelPointBelow: midLabelForDate(ctx, m1 - 1, d1),
        type: 'month',
      })
    }
  }
  return lines
}

function generateHourLines(ctx: SunPathContext, dstTransitions?: DSTTransition[]): SunPathLine[] {
  const lines: SunPathLine[] = []
  const daysInYear =
    (ctx.year % 4 === 0 && ctx.year % 100 !== 0) || ctx.year % 400 === 0 ? 366 : 365

  // Determine which DOYs are in DST
  const isDSTDay = new Array<boolean>(daysInYear + 1).fill(false)
  if (dstTransitions && dstTransitions.length >= 2) {
    const springDoy = dstTransitions.find((t) => t.springForward)?.doy
    const fallDoy = dstTransitions.find((t) => !t.springForward)?.doy
    if (springDoy !== undefined && fallDoy !== undefined) {
      if (springDoy < fallDoy) {
        // Northern-style
        for (let d = springDoy; d < fallDoy; d++) isDSTDay[d] = true
      } else {
        // Southern-style
        for (let d = springDoy; d <= daysInYear; d++) isDSTDay[d] = true
        for (let d = 1; d < fallDoy; d++) isDSTDay[d] = true
      }
    }
  }

  const summerSolstice = { month0: 5, day: 21 }
  const winterSolstice = { month0: 11, day: 21 }

  for (let clockHour = 0; clockHour <= 24; clockHour++) {
    const taggedPts: Array<{ pt: SunPathPoint; dst: boolean }> = []

    for (let doy = 1; doy <= daysInYear; doy++) {
      const [m, d] = doyToMonthDay(doy, ctx.year)
      const date = dateAtStdHour(ctx, m - 1, d, clockHour)
      const pt = getSunPoint(date, ctx.latDeg, ctx.lonDeg)
      if (pt.altitude > 0) {
        taggedPts.push({ pt, dst: isDSTDay[doy] })
      }
    }

    if (taggedPts.length < 2) continue

    const segments: Array<{ points: SunPathPoint[]; isDst: boolean }> = []
    let currentSeg: { points: SunPathPoint[]; isDst: boolean } | null = null

    for (const tp of taggedPts) {
      if (!currentSeg || currentSeg.isDst !== tp.dst) {
        if (currentSeg && currentSeg.points.length > 0) {
          currentSeg.points.push(tp.pt)
          segments.push(currentSeg)
        }
        currentSeg = { points: [tp.pt], isDst: tp.dst }
      } else {
        currentSeg.points.push(tp.pt)
      }
    }
    if (currentSeg && currentSeg.points.length > 0) {
      segments.push(currentSeg)
    }

    const stdLabel = `${clockHour}:00`
    const dstClockHour = clockHour + Math.round(ctx.dstAdj)
    const dstLabel = `${dstClockHour}:00`

    const junDate = dateAtStdHour(ctx, summerSolstice.month0, summerSolstice.day, clockHour)
    const junPos = getSunPoint(junDate, ctx.latDeg, ctx.lonDeg)
    const decDate = dateAtStdHour(ctx, winterSolstice.month0, winterSolstice.day, clockHour)
    const decPos = getSunPoint(decDate, ctx.latDeg, ctx.lonDeg)

    const topPoint = junPos.altitude > decPos.altitude ? junPos : decPos
    const bottomPoint = junPos.altitude > decPos.altitude ? decPos : junPos
    const allPoints = taggedPts.map((tp) => ({ pt: tp.pt, dst: tp.dst }))

    let arrowsEmitted = false
    let labelEmitted = false

    for (const seg of segments) {
      if (seg.points.length < 2) continue
      if (seg.isDst) {
        lines.push({
          points: seg.points,
          label: dstLabel,
          ...(!arrowsEmitted ? { allHourPoints: allPoints } : {}),
          type: 'hour-dst',
        })
      } else {
        lines.push({
          points: seg.points,
          label: stdLabel,
          ...(labelEmitted
            ? {}
            : {
                labelAbove: ctx.dstAdj > 0 ? dstLabel : stdLabel,
                labelBelow: stdLabel,
                topLabelPoint: topPoint.altitude > 0 ? topPoint : undefined,
                bottomLabelPoint: bottomPoint.altitude > 0 ? bottomPoint : undefined,
              }),
          ...(!arrowsEmitted ? { allHourPoints: allPoints } : {}),
          type: 'hour',
        })
        labelEmitted = true
      }
      arrowsEmitted = true
    }
  }
  return lines
}

function generateDSTTransitionLines(
  ctx: SunPathContext,
  dstTransitions?: DSTTransition[]
): SunPathLine[] {
  const lines: SunPathLine[] = []
  if (dstTransitions && dstTransitions.length > 0) {
    for (const dst of dstTransitions) {
      const [dstMonth, dstDay] = doyToMonthDay(dst.doy, ctx.year)
      const pts = arcForDate(ctx, dstMonth - 1, dstDay)
      if (pts.length > 1) {
        const dateLabel = `${dst.month}/${dst.day}`
        const dstHourLabels: DSTHourLabel[] = []

        for (let clockHour = 0; clockHour <= 24; clockHour++) {
          const date = dateAtStdHour(ctx, dstMonth - 1, dstDay, clockHour)
          const pos = getSunPoint(date, ctx.latDeg, ctx.lonDeg)
          if (pos.altitude > 0) {
            const afterClockHour = dst.springForward
              ? clockHour + Math.round(ctx.dstAdj)
              : clockHour
            if (afterClockHour >= 0 && afterClockHour <= 24) {
              dstHourLabels.push({
                point: pos,
                label: `${afterClockHour}:00`,
              })
            }
          }
        }

        if (dst.springForward) {
          lines.push({
            points: pts,
            label: dateLabel,
            labelBelow: dateLabel,
            extraLabelPoints: extraLabelsForDate(ctx, dstMonth - 1, dstDay, undefined, dateLabel),
            dstHourLabels,
            dstHourLabelsPosition: 'above',
            midLabelPoint: midLabelForDate(ctx, dstMonth - 1, dstDay),
            type: 'dst',
          })
        } else {
          lines.push({
            points: pts,
            label: dateLabel,
            labelAbove: dateLabel,
            extraLabelPoints: extraLabelsForDate(ctx, dstMonth - 1, dstDay, dateLabel, undefined),
            dstHourLabels,
            dstHourLabelsPosition: 'below',
            midLabelPoint: midLabelForDate(ctx, dstMonth - 1, dstDay),
            type: 'dst',
          })
        }
      }
    }
  }
  return lines
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
export function sunPathPointToENU(pt: SunPathPoint, radius: number): [number, number, number] {
  const cosAlt = Math.cos(pt.altitude)
  const sinAlt = Math.sin(pt.altitude)
  // Azimuth: 0=North, π/2=East, π=South, 3π/2=West
  const sinAz = Math.sin(pt.azimuth)
  const cosAz = Math.cos(pt.azimuth)

  // East  = sinAz * cosAlt
  // North = cosAz * cosAlt
  // Up    = sinAlt
  return [radius * sinAz * cosAlt, radius * cosAz * cosAlt, radius * sinAlt]
}

/**
 * Compute the current sun position for a given location and time
 * using the suncalc library for precise astronomical accuracy.
 * This matches Cesium's internal sun position closely.
 */
export function computeCurrentSunPosition(
  latDeg: number,
  lonDeg: number,
  date: Date = new Date()
): SunPathPoint {
  return getSunPoint(date, latDeg, lonDeg)
}
