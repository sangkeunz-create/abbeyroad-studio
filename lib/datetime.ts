import { BOOKING_RULES } from "@/lib/rules";

export function toKstDayRange(dateStr: string) {
  // dateStr: 'YYYY-MM-DD' (KST 날짜)
  // KST = UTC+9 (DST 없음)
  const [y, m, d] = dateStr.split("-").map(Number);

  // KST 00:00을 UTC로 변환하려면 -9시간 보정
  const startKstAsUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const endKstAsUtc = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));

  const startUtc = new Date(startKstAsUtc.getTime() - 9 * 60 * 60 * 1000);
  const endUtc = new Date(endKstAsUtc.getTime() - 9 * 60 * 60 * 1000);

  return { startUtc, endUtc };
}

export function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60 * 1000);
}

export function toIso(d: Date) {
  return d.toISOString();
}

export function makeSlotsForBusinessHours(dateStr: string) {
  // KST 기준 dateStr의 openHour~closeHour 슬롯 시작 리스트(UTC Date)
  const { startUtc, endUtc } = toKstDayRange(dateStr);

  const openStart = addMinutes(startUtc, BOOKING_RULES.openHour * 60);
  const closeEnd = addMinutes(startUtc, BOOKING_RULES.closeHour * 60);

  // closeEnd는 하루 끝(endUtc)보다 클 수 없게 clamp (closeHour=24면 endUtc와 같음)
  const dayEnd = endUtc;
  const businessEnd = closeEnd > dayEnd ? dayEnd : closeEnd;

  const slots: Date[] = [];
  let cur = openStart;
  while (cur < businessEnd) {
    slots.push(cur);
    cur = addMinutes(cur, BOOKING_RULES.slotMinutes);
  }
  return { slots, businessStartUtc: openStart, businessEndUtc: businessEnd };
}
