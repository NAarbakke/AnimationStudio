// The programme film's running order, in film seconds. Shared by the plate (build.mjs), the timeline strip and export.js:
// change a phase's words or length here and everything follows.
export const TITLE = { kicker: "Razorbill programme", name: "Operation SKYFALL", sub: "Fall 2026 – Spring 2027" };

export const BLEND = 1.2; // seconds of dissolve from the assembly plate into the field film

// 0–4.5 title card, then the three phases, then a 4 s end card (phase 3 ends when the field film does, BLEND / 2 early)
export const PHASES = [
  { n: 1, name: "Design of Razorbill", short: "Design", when: "Fall 2026", where: "StartupLab", from: 4.5, to: 21 },
  { n: 2, name: "Assembly of drone", short: "Assembly", when: "Winter 2027", where: "Sagene, Oslo", from: 21, to: 35 },
  { n: 3, name: "Field tests to verify ConOps", short: "Field tests", when: "Spring 2027", where: "NIBIO-affiliated farm", from: 35, to: 74 - BLEND / 2 },
];
// phase 3 is the Razorbill drop film, its title hidden; it opens close on the drone (blend) and dissolves in from the plate,
// the dissolve centred on the phase boundary
export const FIELD = { page: "drone.html?film&notitle&blend", length: 39 };
export const END = { from: 74 - BLEND / 2, to: 78 - BLEND / 2 };
export const LENGTH = END.to;
