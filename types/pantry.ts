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

export type AnnouncementCategory = 'urgent' | 'event' | 'hours_change' | 'general';

/** Row from Supabase announcements table */
export type Announcement = {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pantry_id: string | null;
  created_at: string;
  expires_at: string | null;
  scheduled_for: string | null;
  published: boolean;
};
