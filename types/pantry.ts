/** Row from Supabase pantry_op_hours table */
export type PantryOpHours = {
  pantry_id: string;
  name: string;
  weekday: string;
  open_time: string;
  close_time: string;
};

/** Row from Supabase pantry_location table (with optional joined hours) */
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
  service_type?: string;
  temporary_closure?: boolean;
  pantry_op_hours?: PantryOpHours[];
};
