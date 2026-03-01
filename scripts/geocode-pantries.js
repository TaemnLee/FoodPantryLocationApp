// One-time script to geocode pantry addresses and write coordinates into pantries.json.
// Run with: npm run geocode-pantries
// Requires EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to be set in your environment.

const fs = require("fs");
const path = require("path");

const PANTRIES_PATH = path.join(__dirname, "../data/pantries.json");

async function geocode(address, apiKey) {
  const query = encodeURIComponent(address);
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${apiKey}`
  );
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
    return null;
  }
  return data.results[0].geometry.location; // { lat, lng }
}

async function main() {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("Error: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set.");
    process.exit(1);
  }

  const pantries = JSON.parse(fs.readFileSync(PANTRIES_PATH, "utf8"));
  const results = [];

  for (const pantry of pantries) {
    const address = `${pantry.street}, ${pantry.city}, ${pantry.state} ${pantry.zip}`;
    process.stdout.write(`Geocoding: ${pantry.name} ... `);
    const loc = await geocode(address, apiKey);
    if (loc) {
      results.push({ ...pantry, latitude: loc.lat, longitude: loc.lng });
      console.log(`${loc.lat}, ${loc.lng}`);
    } else {
      results.push(pantry);
      console.warn("FAILED");
    }
  }

  fs.writeFileSync(PANTRIES_PATH, JSON.stringify(results, null, 2) + "\n");
  console.log("\nDone — pantries.json updated with coordinates.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
