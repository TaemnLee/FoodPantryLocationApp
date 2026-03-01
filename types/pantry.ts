export type PantryLocationSeed = {
  id: string;
  name: string;
  street: string;
  city: string;
  state: "OH";
  zip: string;
  county: "Licking";
};

export type PantryLocation = PantryLocationSeed & {
  latitude: number;
  longitude: number;
};
