# System-Level Documentation — Licking County Food Pantry Network App

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Environment Setup](#2-environment-setup)
3. [Architecture](#3-architecture)
4. [Database Schema](#4-database-schema)
5. [Key Files Map](#5-key-files-map)
6. [Admin Access](#6-admin-access)
7. [Pantry Visibility Logic](#7-pantry-visibility-logic)
8. [Realtime Data](#8-realtime-data)
9. [Scripts](#9-scripts)
10. [Deployment](#10-deployment)

---

## 1. Project Overview

A mobile app for the Licking County Food Pantry Network that helps community members find nearby food pantries. Users can see pantry locations on an interactive map, view hours and available inventory, and read announcements. Administrators can manage pantry data, operating hours, inventory, and announcements from within the app.

**Tech stack:**

| Layer | Technology |
|---|---|
| Framework | Expo 54 / React Native 0.81.5 |
| Routing | Expo Router 6 (file-based) |
| Backend & Auth | Supabase (Postgres + Row-Level Security + Realtime) |
| Maps | React Native Maps 1.20.1 (Google Maps on Android, Apple Maps on iOS) |
| Language | TypeScript 5.9 |
| Tests | Jest 29 via jest-expo |

---

## 2. Environment Setup

### Required environment variables

Create a `.env` file at the project root with the following three keys:

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-jwt>
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<your-google-maps-key>
```

All variables are prefixed with `EXPO_PUBLIC_` so Expo inlines them into the bundle at build time. Do not use a server-side prefix or they will be undefined at runtime.

**How to obtain each key:**

- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Log in to [supabase.com](https://supabase.com), open your project, go to **Project Settings → API**. Copy the Project URL and the `anon` public key.
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — Open the [Google Cloud Console](https://console.cloud.google.com), create or select a project, enable the **Maps SDK for Android**, **Maps SDK for iOS**, and **Geocoding API**, then create an API key under **APIs & Services → Credentials**.

### Install and run

```bash
npm install
npx expo start
```

Scan the QR code with the Expo Go app (iOS/Android) or press `i` / `a` to open a simulator. For Google Maps to render correctly on Android you must use a development build (`npx expo run:android`) rather than Expo Go, because Expo Go does not bundle native Google Maps dependencies.

---

## 3. Architecture

### Routing

The app uses **Expo Router**, which maps the file system under `app/` directly to navigation routes — no manual route registration required.

```
app/
├── _layout.tsx          ← Root layout: Stack navigator (tabs + admin modal)
├── (tabs)/
│   ├── _layout.tsx      ← Tab bar: Home, Announcements, Map
│   ├── index.tsx        ← Home screen
│   ├── announcements.tsx
│   └── map.tsx
└── admin/
    └── index.tsx        ← Admin panel (presented as a modal)
```

The root Stack has two entries: the main `(tabs)` group and the `admin/index` modal. Navigating to `/admin` pushes the admin panel over the tab bar without destroying it.

### Backend

**Supabase** provides the entire backend:

- **Postgres** — structured storage for all pantry data
- **Auth** — email/password authentication for admin users
- **Row-Level Security (RLS)** — public read, authenticated write
- **Realtime** — WebSocket channels that push Postgres change events to subscribed clients

The Supabase client is initialized once in `lib/supabase.ts` and imported wherever data access is needed. Sessions are persisted to AsyncStorage so users remain signed in across app restarts.

### State management

There is no global state library. Each screen manages its own data with `useState` / `useEffect` hooks and refetches from Supabase when Realtime events arrive. Data flows downward via props to child components.

---

## 4. Database Schema

### `pantry_location`

The primary table. One row per food pantry.

| Column | Type | Description |
|---|---|---|
| `pantry_id` | uuid (PK) | Unique pantry identifier |
| `name` | text | Display name of the pantry |
| `street` | text | Street address |
| `city` | text | City |
| `state` | text | Two-letter state code |
| `zip` | text | ZIP code |
| `county` | text | County name |
| `latitude` | float8 | GPS latitude (populated via geocoding script) |
| `longitude` | float8 | GPS longitude (populated via geocoding script) |
| `service_type` | text | Optional description of service model |
| `temporary_closure` | boolean | If true, pantry is temporarily closed |
| `year_round` | boolean | If true, pantry operates all year |
| `recurring_annual` | boolean | If true, seasonal window repeats every year |
| `operating_date_start` | date | Season open date (YYYY-MM-DD) |
| `operating_date_end` | date | Season close date (YYYY-MM-DD) |

### `pantry_op_hours`

Operating hours. One row per weekday session per pantry (a pantry open Monday AM and Monday PM has two Monday rows).

| Column | Type | Description |
|---|---|---|
| `pantry_id` | uuid (FK → pantry_location) | Parent pantry |
| `name` | text | Pantry name (denormalized for display) |
| `weekday` | text | Day of week as a lowercase string: `"monday"`, `"tuesday"`, … `"sunday"` |
| `open_time` | text | Opening time in 24-hour `HH:mm` format |
| `close_time` | text | Closing time in 24-hour `HH:mm` format |

### `pantry_inventory`

Food categories stocked at each pantry. One row per pantry. Updated by admins.

| Column | Type | Description |
|---|---|---|
| `pantry_id` | uuid (FK → pantry_location) | Parent pantry |
| `name` | text | Pantry name (denormalized) |
| `last_updated` | timestamptz | When an admin last saved inventory |
| `canned_food` | boolean | Canned goods available |
| `dry_grains` | boolean | Rice, pasta, flour, etc. |
| `cereal` | boolean | Breakfast cereal |
| `dairy` | boolean | Milk, cheese, yogurt |
| `eggs` | boolean | Eggs |
| `fresh_produce` | boolean | Fruits and vegetables |
| `fresh_protein` | boolean | Meat, fish, etc. |
| `frozen_food` | boolean | Frozen items |
| `bread` | boolean | Bread and baked goods |
| `beverages` | boolean | Drinks |
| `baby_items` | boolean | Formula, diapers, etc. |
| `snacks` | boolean | Snack foods |

### `announcements`

System-wide or pantry-specific announcements displayed to all users.

| Column | Type | Description |
|---|---|---|
| `id` | uuid (PK) | Unique identifier |
| `title` | text | Short headline |
| `body` | text | Full announcement text |
| `category` | text | One of: `urgent`, `event`, `hours_change`, `general` |
| `pantry_id` | uuid \| null | If set, links to a specific pantry; null means network-wide |
| `created_at` | timestamptz | Creation timestamp |
| `expires_at` | timestamptz \| null | If set, announcement is hidden after this time |
| `scheduled_for` | timestamptz \| null | If set, announcement is not shown until this time |
| `published` | boolean | Draft (`false`) vs. live (`true`) |

### `pantry_main`

Operational metadata that may diverge from `pantry_location` over time. Queried alongside `pantry_location` on the map screen and merged client-side.

| Column | Type | Description |
|---|---|---|
| `pantry_id` | uuid (PK / FK → pantry_location) | Parent pantry |
| `name` | text | Pantry name |
| `temporary_closure` | boolean | Mirrors / overrides the flag on `pantry_location` |
| `year_round` | boolean | Season mode flag |
| `recurring_annual` | boolean | Repeating season flag |
| `operating_date_start` | date | Season start date |
| `operating_date_end` | date | Season end date |
| `service_type` | text | Service model description |

---

## 5. Key Files Map

```
lib/
├── supabase.ts              ← Supabase client singleton
├── pantry-map-logic.ts      ← Pure functions: open status, season check, distance, search
└── pantry-map-logic.test.ts ← Jest tests for the above

app/
├── _layout.tsx              ← Root Stack navigator
├── (tabs)/
│   ├── _layout.tsx          ← Bottom tab bar config
│   ├── index.tsx            ← Home: pantry count, admin sign-in button
│   ├── map.tsx              ← Map: markers, filters, detail sheets, search
│   └── announcements.tsx    ← Announcements feed with category filter
└── admin/
    └── index.tsx            ← Admin panel: pantry CRUD, announcements, inventory

types/
└── pantry.ts                ← TypeScript interfaces for all DB tables

scripts/
└── geocode-pantries.js      ← One-time address → coordinates utility

components/
├── PinMarker.tsx            ← Custom map pin rendered as an image snapshot
└── ui/                      ← Themed wrappers (Text, View, Icon)

constants/
└── theme.ts                 ← Color palette for light and dark mode
```

---

## 6. Admin Access

### Signing in

From the **Home** tab, tap the sign-in button to open the authentication modal. Enter an admin email and password. Authentication is handled by Supabase Auth (email/password). On success, a session is stored in AsyncStorage and the admin panel becomes accessible from the Home tab.

Admin accounts are created directly in the Supabase dashboard under **Authentication → Users**. There is no self-registration flow in the app.

### What admins can manage

All admin functionality lives in `app/admin/index.tsx`, organized into three tabs:

**Pantries tab**
- Add, edit, or delete pantry records
- Set the street address (the app calls the Google Maps Geocoding API to resolve latitude/longitude automatically)
- Configure operating hours per weekday (multiple time windows per day are supported)
- Set the pantry's operating season (year-round, recurring annual window, or one-time date range)
- Toggle temporary closure on or off

**Announcements tab**
- Create, edit, or delete announcements
- Choose a category: `urgent`, `hours_change`, `event`, or `general`
- Assign to a specific pantry or leave as network-wide
- Publish immediately, save as draft, or schedule for a future date and time
- Set an optional expiration date after which the announcement disappears automatically

**Inventory tab**
- Select any pantry and toggle its 12 food category flags
- Saving updates the `last_updated` timestamp displayed to users

---

## 7. Pantry Visibility Logic

The core logic lives in `lib/pantry-map-logic.ts`. Three flags on each pantry record work together to determine whether a pantry is currently in season and how its map pin is colored.

### The three flags

| Flag | Type | Meaning |
|---|---|---|
| `year_round` | boolean | Pantry operates every day of the year with no seasonal closure |
| `recurring_annual` | boolean | Pantry has a seasonal window that repeats on the same calendar dates every year (e.g., June 1 – August 31 every summer) |
| `temporary_closure` | boolean | Pantry is temporarily closed regardless of season or hours |

`operating_date_start` and `operating_date_end` are only meaningful when `year_round` is false.

### Season evaluation (`isInSeason`)

```
year_round === true
  → Always in season

year_round === false, recurring_annual === true
  → In season if today's MM-DD falls between start's MM-DD and end's MM-DD
    (the year component of the stored dates is ignored)

year_round === false, recurring_annual === false
  → In season if today's full YYYY-MM-DD falls between
    operating_date_start and operating_date_end
```

### How this affects the map

| State | Pin color |
|---|---|
| Open right now | Green (`#16a34a`) |
| Opens later today | Blue (`#2563eb`) |
| Closed today, but in season | Gray (`#6b7280`) |
| Out of season | Amber (`#D97706`) |
| Temporarily closed | Red |

When a user applies time-based filters ("open now", "opens later today"), out-of-season pantries are excluded from results entirely. Out-of-season pantries are still visible on the map by default so users know they exist, but their amber color signals they are not currently operating.

### `temporary_closure`

A pantry marked `temporary_closure = true` is shown with a distinct red pin. Temporary closure takes precedence over the season and hours logic — the pantry will not appear open regardless of what the hours say.

---

## 8. Realtime Data

The app subscribes to Supabase Realtime channels so the UI updates automatically when an admin makes changes — no manual refresh required.

### Map screen (`app/(tabs)/map.tsx`)

One channel named `"pantry-realtime"` listens to all five relevant tables:

| Table | Trigger | Action |
|---|---|---|
| `pantry_location` | Any change | Refetch all pantry data |
| `pantry_op_hours` | Any change | Refetch all pantry data |
| `pantry_main` | Any change | Refetch all pantry data |
| `announcements` | Any change | Refetch announcements |
| `pantry_inventory` | Any change | Refetch inventories |

### Announcements screen (`app/(tabs)/announcements.tsx`)

A separate channel named `"announcements-tab"` watches the `announcements` table and refetches the announcement list on any change.

### Channel lifecycle

Both channels subscribe when the component mounts and unsubscribe (`supabase.removeChannel`) when it unmounts. This prevents memory leaks and unnecessary WebSocket traffic when screens are not in view.

The event filter is `event: "*"`, which captures INSERT, UPDATE, and DELETE. The client does a full refetch rather than applying the diff from the event payload, which keeps the local state consistent with the server without complex merge logic.

---

## 9. Scripts

### `npm run geocode-pantries`

**File:** `scripts/geocode-pantries.js`

**Purpose:** Resolves street addresses to GPS coordinates (latitude/longitude) using the Google Maps Geocoding API and writes the results back into a local JSON file.

**When to run:** Run this once when bulk-loading new pantry records whose coordinates are not yet known. After coordinates are in the database, the script is not needed again unless you add new pantries without coordinates.

**How it works:**
1. Reads `data/pantries.json` — an array of pantry objects with address fields (`street`, `city`, `state`, `zip`)
2. For each pantry, constructs a full address string and calls the Google Maps Geocoding API
3. Writes the resolved `latitude` and `longitude` back onto the pantry object
4. Overwrites `data/pantries.json` with the updated array
5. Logs success or `FAILED` for each pantry to stdout

**Requirements:** `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` must be present in the environment (loaded from `.env` automatically via Expo's dotenv support, or set in the shell).

```bash
npm run geocode-pantries
```

After running, manually review any `FAILED` entries in the output. Common causes are ambiguous addresses, missing unit numbers, or API quota limits. Fix the address in `pantries.json` and rerun. Once coordinates look correct, load the records into Supabase via the dashboard or a migration script.

---

## 10. Deployment

The app is built and distributed through **Expo Application Services (EAS)**. There is no custom CI build pipeline for production binaries — use EAS Build.

### Prerequisites

```bash
npm install -g eas-cli
eas login
```

Ensure `app.json` has the correct `bundleIdentifier` (iOS) and `package` (Android) values. The Android package is currently `com.lcfpn.pantry`.

### iOS build

```bash
eas build --platform ios --profile production
```

This produces an `.ipa` file. Submit to the App Store with:

```bash
eas submit --platform ios
```

You will need an Apple Developer account and the app registered in App Store Connect.

### Android build

```bash
eas build --platform android --profile production
```

This produces an `.aab` (Android App Bundle). Submit to the Play Store with:

```bash
eas submit --platform android
```

### Environment variables in production builds

EAS does not read your local `.env` file. Add the three required variables to your EAS project secrets:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY --value "..."
```

### OTA updates (optional)

For JavaScript-only changes (no native code changes), you can push an over-the-air update without going through the app store review process:

```bash
eas update --branch production --message "describe the change"
```

This requires the `expo-updates` package to be configured in `app.json`.

### Local development builds

To test with native modules (required for Google Maps on Android):

```bash
npx expo run:android
npx expo run:ios
```

These compile and install a development build directly to a connected device or simulator.
