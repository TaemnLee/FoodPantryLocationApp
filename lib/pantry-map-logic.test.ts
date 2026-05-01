import type { PantryLocation, PantryOpHours } from "@/types/pantry";

import {
  distanceMiles,
  formatSeasonStart,
  formatTimeForDisplay,
  getHoursForDay,
  getOpenStatus,
  isInSeason,
  isOpenNow,
  matchWeekday,
  matchesSearch,
  opensLaterToday,
  timeToMinutes,
} from "@/lib/pantry-map-logic";

function pantry(overrides: Partial<PantryLocation> = {}): PantryLocation {
  return {
    pantry_id: "p1",
    name: "Hope Pantry",
    street: "100 Main St",
    city: "Newark",
    state: "OH",
    zip: "43055",
    county: "Licking",
    latitude: 40.058,
    longitude: -82.401,
    ...overrides,
  };
}

describe("distanceMiles", () => {
  it("returns ~0 for identical coordinates", () => {
    expect(distanceMiles(40, -82, 40, -82)).toBeCloseTo(0, 5);
  });

  it("returns a small distance for nearby points (~1 mi order of magnitude)", () => {
    const d = distanceMiles(40.05, -82.4, 40.06, -82.4);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(1.5);
  });
});

describe("timeToMinutes & formatTimeForDisplay", () => {
  it("parses HH:mm to minutes since midnight", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("00:05")).toBe(5);
  });

  it("formats 24h strings for display", () => {
    expect(formatTimeForDisplay("09:05")).toBe("9:05 AM");
    expect(formatTimeForDisplay("12:00")).toBe("12:00 PM");
    expect(formatTimeForDisplay("0:30")).toBe("12:30 AM");
    expect(formatTimeForDisplay("17:00")).toBe("5:00 PM");
  });
});

describe("matchesSearch", () => {
  const p = pantry();

  it("matches when query empty", () => {
    expect(matchesSearch(p, "   ")).toBe(true);
  });

  it("matches name case-insensitively", () => {
    expect(matchesSearch(p, "hope")).toBe(true);
    expect(matchesSearch(p, "PANTRY")).toBe(true);
  });

  it("matches street substring", () => {
    expect(matchesSearch(p, "main")).toBe(true);
  });

  it("returns false when no field contains query", () => {
    expect(matchesSearch(p, "zzz")).toBe(false);
  });
});

describe("matchWeekday & getHoursForDay", () => {
  const hours: PantryOpHours[] = [
    { pantry_id: "p1", name: "H", weekday: "monday", open_time: "10:00", close_time: "14:00" },
    { pantry_id: "p1", name: "H", weekday: "1", open_time: "09:00", close_time: "11:00" },
  ];
  const p = pantry({ pantry_op_hours: hours });

  it("treats weekday 1 as Monday", () => {
    expect(matchWeekday(hours[1], "monday", 1)).toBe(true);
  });

  it("returns Monday sessions sorted by open_time", () => {
    const monday = getHoursForDay(p, 1);
    expect(monday).toHaveLength(2);
    expect(monday[0].open_time).toBe("09:00");
    expect(monday[1].open_time).toBe("10:00");
  });
});

describe("isInSeason", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns true when year_round is not false", () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(isInSeason(pantry({ year_round: true }))).toBe(true);
    expect(isInSeason(pantry({ year_round: undefined }))).toBe(true);
  });

  it("recurring annual: in range when today MM-DD is between start and end", () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const p = pantry({
      year_round: false,
      recurring_annual: true,
      operating_date_start: "2020-04-01",
      operating_date_end: "2020-10-31",
    });
    expect(isInSeason(p)).toBe(true);
  });

  it("recurring annual: out of range when today is before season", () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    const p = pantry({
      year_round: false,
      recurring_annual: true,
      operating_date_start: "2020-04-01",
      operating_date_end: "2020-10-31",
    });
    expect(isInSeason(p)).toBe(false);
  });

  it("one-time window: before start is out of season", () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date("2025-05-01T12:00:00Z"));
    const p = pantry({
      year_round: false,
      recurring_annual: false,
      operating_date_start: "2025-06-01",
      operating_date_end: "2025-08-31",
    });
    expect(isInSeason(p)).toBe(false);
  });
});

describe("formatSeasonStart", () => {
  it("includes year when not recurring", () => {
    const s = formatSeasonStart(
      pantry({
        recurring_annual: false,
        operating_date_start: "2025-06-10",
      }),
    );
    expect(s).toBe("Opens Jun 10, 2025");
  });

  it("omits year when recurring", () => {
    const s = formatSeasonStart(
      pantry({
        recurring_annual: true,
        operating_date_start: "2025-06-10",
      }),
    );
    expect(s).toBe("Opens Jun 10");
  });
});

describe("getOpenStatus & isOpenNow & opensLaterToday", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("reports open during an active session", () => {
    jest.useFakeTimers({ advanceTimers: true });
    // Monday Jun 9, 2025 14:00 local — getDay() is Monday (1)
    jest.setSystemTime(new Date("2025-06-09T14:00:00"));
    const p = pantry({
      pantry_op_hours: [
        {
          pantry_id: "p1",
          name: "H",
          weekday: "monday",
          open_time: "09:00",
          close_time: "17:00",
        },
      ],
    });
    const st = getOpenStatus(p);
    expect(st.isOpen).toBe(true);
    expect(st.closingTime).toBe("5:00 PM");
    expect(isOpenNow(p)).toBe(true);
  });

  it("reports nextOpens later today before first open", () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date("2025-06-09T08:00:00"));
    const p = pantry({
      pantry_op_hours: [
        {
          pantry_id: "p1",
          name: "H",
          weekday: "monday",
          open_time: "09:00",
          close_time: "17:00",
        },
      ],
    });
    const st = getOpenStatus(p);
    expect(st.isOpen).toBe(false);
    expect(st.nextOpens).toBe("Opens 9:00 AM");
    expect(opensLaterToday(p)).toBe(true);
  });
});
