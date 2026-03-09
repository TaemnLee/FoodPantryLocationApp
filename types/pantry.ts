/** Row from Supabase pantry_location table */
export type PantryLocation = {
  pantry_id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  latitude: number;
  longitude: number;
};
