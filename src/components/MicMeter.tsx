/** The mic's level, from the click engine's Level events: empty at -60 dBFS, full at 0 dBFS. */
export function MicMeter({ peak }: { peak: number }) {
  const fill = Math.round(meterFill(peak) * 100)
  return (
    <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
      <div className="h-full bg-zinc-400" style={{ width: `${fill}%` }} />
    </div>
  )
}

/** The meter's fill, 0 to 1, for a peak sample from 0 to 1. */
export const meterFill = (peak: number): number => (peak <= 0 ? 0 : Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak)) / -METER_FLOOR_DB)))

const METER_FLOOR_DB = -60
