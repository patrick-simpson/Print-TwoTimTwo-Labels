export interface Clubber {
  id: number;
  name: string;
  club: 'Cubbies' | 'Sparks' | 'T&T' | 'Trek' | 'Puggles';
  gender: 'boy' | 'girl';
  group?: string;
  color?: string;
  photo?: string;
}

export const CLUBS = {
  Cubbies: '/images/clubs/cubbies.png',
  Sparks: '/images/clubs/sparks.png',
  'T&T': '/images/clubs/tt_logo_2015.png',
  Trek: '/images/clubs/trek.png',
  Puggles: '/database/customFile/315',
};