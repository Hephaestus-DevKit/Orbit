import type { OrbitConfig } from "@orbit-build/config";

/** Resolves a configured rate in UTC; unspecified weekdays retain daily pricing. */
export function resolveScheduledModelPrice(
  price: OrbitConfig["pricing"][string],
  now = new Date(),
): OrbitConfig["pricing"][string] {
  const scheduled = price.scheduled;
  if (!scheduled || now.getTime() < Date.parse(scheduled.effectiveAt))
    return price;
  if (
    scheduled.peakDaysUtc &&
    !scheduled.peakDaysUtc.includes(now.getUTCDay())
  ) {
    return scheduled.offPeak;
  }
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isPeak = scheduled.peakHoursUtc.some((window) => {
    const [start, end] = window.split("-");
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    return (
      minuteOfDay >= startHour * 60 + startMinute &&
      minuteOfDay < endHour * 60 + endMinute
    );
  });
  return isPeak ? scheduled.peak : scheduled.offPeak;
}
