import type { PantryLocation, PantryOpHours } from "@/types/pantry";

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export const WEEKDAY_ABBREV: Record<string, string> = {
  sunday: "Sun",
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
};

export function matchWeekday(h: PantryOpHours, day: string, dayIndex: number): boolean {
  const w = String(h.weekday ?? "").toLowerCase().trim();
  if (w === day) return true;
  if (day.startsWith(w.slice(0, 3)) || w.startsWith(day.slice(0, 3))) return true;
  const num = parseInt(w, 10);
  if (!Number.isNaN(num) && num >= 0 && num <= 6) return num === dayIndex;
  return false;
}

export function getHoursForDay(pantry: PantryLocation, dayIndex: number): PantryOpHours[] {
  const hours = pantry.pantry_op_hours;
  if (!hours?.length) return [];
  const day = WEEKDAYS[dayIndex];
  const matches = hours.filter((hour) => matchWeekday(hour, day, dayIndex));
  return matches.sort((a, b) => timeToMinutes(a.open_time) - timeToMinutes(b.open_time));
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatTimeForDisplay(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const hour = h ?? 0;
  const min = m ?? 0;
  const mm = min.toString().padStart(2, "0");
  if (hour === 0) return `12:${mm} AM`;
  if (hour < 12) return `${hour}:${mm} AM`;
  if (hour === 12) return `12:${mm} PM`;
  return `${hour - 12}:${mm} PM`;
}

export const SEASON_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isInSeason(pantry: PantryLocation): boolean {
  if (pantry.year_round !== false) return true;
  const { operating_date_start, operating_date_end, recurring_annual } = pantry;
  if (!operating_date_start && !operating_date_end) return true;

  if (recurring_annual) {
    const todayMD = todayYMD().slice(5);
    const startMD = operating_date_start?.slice(5) ?? null;
    const endMD = operating_date_end?.slice(5) ?? null;
    if (startMD && endMD) {
      return startMD <= endMD
        ? todayMD >= startMD && todayMD <= endMD
        : todayMD >= startMD || todayMD <= endMD;
    }
    if (startMD) return todayMD >= startMD;
    if (endMD) return todayMD <= endMD;
    return true;
  }

  const today = todayYMD();
  if (operating_date_start && today < operating_date_start) return false;
  if (operating_date_end && today > operating_date_end) return false;
  return true;
}

export function formatSeasonStart(pantry: PantryLocation): string | null {
  const { operating_date_start } = pantry;
  if (!operating_date_start) return null;
  const parts = operating_date_start.split("-");
  const m = parseInt(parts[1] ?? "1", 10);
  const d = parseInt(parts[2] ?? "1", 10);
  const yearSuffix = pantry.recurring_annual ? "" : `, ${parts[0]}`;
  return `Opens ${SEASON_MONTHS[m - 1]} ${d}${yearSuffix}`;
}

export function getOpenStatus(
  pantry: PantryLocation,
): { isOpen: boolean; closingTime: string | null; nextOpens: string | null } {
  if (!isInSeason(pantry)) {
    return { isOpen: false, closingTime: null, nextOpens: formatSeasonStart(pantry) };
  }

  const now = new Date();
  const todayIndex = now.getDay();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todaySessions = getHoursForDay(pantry, todayIndex);

  for (const session of todaySessions) {
    const openMins = timeToMinutes(session.open_time);
    const closeMins = timeToMinutes(session.close_time);
    if (nowMins >= openMins && nowMins < closeMins) {
      return { isOpen: true, closingTime: formatTimeForDisplay(session.close_time), nextOpens: null };
    }
  }

  for (const session of todaySessions) {
    const openMins = timeToMinutes(session.open_time);
    if (nowMins < openMins) {
      return {
        isOpen: false,
        closingTime: null,
        nextOpens: `Opens ${formatTimeForDisplay(session.open_time)}`,
      };
    }
  }

  for (let i = 1; i <= 7; i++) {
    const dayIndex = (todayIndex + i) % 7;
    const daySessions = getHoursForDay(pantry, dayIndex);
    if (daySessions.length) {
      const first = daySessions[0];
      const dayAbbrev =
        WEEKDAY_ABBREV[WEEKDAYS[dayIndex]] ?? WEEKDAYS[dayIndex].slice(0, 3);
      return {
        isOpen: false,
        closingTime: null,
        nextOpens: `Opens ${formatTimeForDisplay(first.open_time)} ${dayAbbrev}`,
      };
    }
  }

  const hours = pantry.pantry_op_hours;
  if (hours?.length) {
    const first = hours[0];
    const dayLabel = first.weekday ? ` ${String(first.weekday).slice(0, 3)}` : "";
    return {
      isOpen: false,
      closingTime: null,
      nextOpens: `Opens ${formatTimeForDisplay(first.open_time)}${dayLabel}`,
    };
  }

  return { isOpen: false, closingTime: null, nextOpens: null };
}

export function isOpenNow(pantry: PantryLocation): boolean {
  if (!isInSeason(pantry)) return false;
  return getOpenStatus(pantry).isOpen;
}

export function opensLaterToday(pantry: PantryLocation): boolean {
  if (!isInSeason(pantry)) return false;
  const todaySessions = getHoursForDay(pantry, new Date().getDay());
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  return todaySessions.some((s) => timeToMinutes(s.open_time) > nowMins);
}

export function matchesSearch(pantry: PantryLocation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const searchable = [pantry.name, pantry.street, pantry.city, pantry.state, pantry.zip].join(" ");
  return searchable.toLowerCase().includes(q);
}

export function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
