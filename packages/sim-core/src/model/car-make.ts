/**
 * Car manufacturers ("makes") and how to tell a car's make from what the sims report. Pure: no
 * Node modules, safe in any renderer.
 *
 * A make id is the lower-case name with spaces as "-" ("aston-martin", "isotta-fraschini"). The
 * same ids name the user's own logo files (<userData>/logos/<id>.svg|png), so they are stable.
 */

export interface CarMake {
  id: string;
  /** Display name, e.g. "Aston Martin". */
  name: string;
  /** Short text code for a badge when there is no logo, e.g. "AST". */
  code: string;
}

/** Every make the mapping can return, by id. */
export const CAR_MAKES: Readonly<Record<string, CarMake>> = Object.fromEntries(
  (
    [
      ["acura", "Acura", "ACU"],
      ["alfa-romeo", "Alfa Romeo", "ALF"],
      ["alpine", "Alpine", "ALP"],
      ["aston-martin", "Aston Martin", "AST"],
      ["audi", "Audi", "AUD"],
      ["bentley", "Bentley", "BEN"],
      ["bmw", "BMW", "BMW"],
      ["cadillac", "Cadillac", "CAD"],
      ["chevrolet", "Chevrolet", "CHE"],
      ["dallara", "Dallara", "DAL"],
      ["dodge", "Dodge", "DOD"],
      ["duqueine", "Duqueine", "DUQ"],
      ["ferrari", "Ferrari", "FER"],
      ["ford", "Ford", "FOR"],
      ["genesis", "Genesis", "GEN"],
      ["ginetta", "Ginetta", "GIN"],
      ["glickenhaus", "Glickenhaus", "SCG"],
      ["holden", "Holden", "HOL"],
      ["honda", "Honda", "HON"],
      ["hyundai", "Hyundai", "HYU"],
      ["isotta-fraschini", "Isotta Fraschini", "ISO"],
      ["jaguar", "Jaguar", "JAG"],
      ["kia", "Kia", "KIA"],
      ["ktm", "KTM", "KTM"],
      ["lamborghini", "Lamborghini", "LAM"],
      ["lexus", "Lexus", "LEX"],
      ["ligier", "Ligier", "LIG"],
      ["lotus", "Lotus", "LOT"],
      ["maserati", "Maserati", "MAS"],
      ["mazda", "Mazda", "MAZ"],
      ["mclaren", "McLaren", "MCL"],
      ["mercedes", "Mercedes", "MER"],
      ["mini", "Mini", "MIN"],
      ["nissan", "Nissan", "NIS"],
      ["oreca", "Oreca", "ORE"],
      ["peugeot", "Peugeot", "PEU"],
      ["porsche", "Porsche", "POR"],
      ["radical", "Radical", "RAD"],
      ["renault", "Renault", "REN"],
      ["riley", "Riley", "RIL"],
      ["subaru", "Subaru", "SUB"],
      ["toyota", "Toyota", "TOY"],
      ["vanwall", "Vanwall", "VAN"],
      ["volkswagen", "Volkswagen", "VW"],
      ["volvo", "Volvo", "VOL"],
    ] as const
  ).map(([id, name, code]) => [id, { id, name, code }]),
);

/**
 * Keywords in a car's identity, checked in this order (first match wins), against the lower-cased
 * text with everything but letters and digits removed ("Mercedes-AMG GT3" -> "mercedesamggt3").
 * Model names cover car paths that do not carry the make (iRacing "chevyvettez06rgt3",
 * "c8rvettegte", "amvantagegt4", "hpdarx01c").
 */
const KEYWORDS: readonly (readonly [string, string])[] = [
  ["astonmartin", "aston-martin"],
  ["amvantage", "aston-martin"],
  ["alfaromeo", "alfa-romeo"],
  ["isottafraschini", "isotta-fraschini"],
  ["isotta", "isotta-fraschini"],
  ["glickenhaus", "glickenhaus"],
  ["scg007", "glickenhaus"],
  ["lamborghini", "lamborghini"],
  ["huracan", "lamborghini"],
  ["porsche", "porsche"],
  ["ferrari", "ferrari"],
  ["mercedes", "mercedes"],
  ["amggt", "mercedes"],
  ["bmw", "bmw"],
  ["audi", "audi"],
  ["corvette", "chevrolet"],
  ["vette", "chevrolet"],
  ["chevrolet", "chevrolet"],
  ["chevy", "chevrolet"],
  ["camaro", "chevrolet"],
  ["mustang", "ford"],
  ["ford", "ford"],
  ["mclaren", "mclaren"],
  ["acura", "acura"],
  ["nsx", "acura"],
  ["cadillac", "cadillac"],
  ["toyota", "toyota"],
  ["gr86", "toyota"],
  ["supra", "toyota"],
  ["camry", "toyota"],
  ["lexus", "lexus"],
  ["honda", "honda"],
  ["hpdarx", "honda"],
  ["civictyper", "honda"],
  ["hyundai", "hyundai"],
  ["elantra", "hyundai"],
  ["genesis", "genesis"],
  ["peugeot", "peugeot"],
  ["alpine", "alpine"],
  ["oreca", "oreca"],
  ["ligier", "ligier"],
  ["duqueine", "duqueine"],
  ["ginetta", "ginetta"],
  ["dallara", "dallara"],
  ["superformula", "dallara"],
  ["indycar", "dallara"],
  ["radical", "radical"],
  ["riley", "riley"],
  ["vanwall", "vanwall"],
  ["lotus", "lotus"],
  ["mazda", "mazda"],
  ["mx5", "mazda"],
  ["nissan", "nissan"],
  ["renault", "renault"],
  ["ktm", "ktm"],
  ["xbow", "ktm"],
  ["volkswagen", "volkswagen"],
  ["subaru", "subaru"],
  ["maserati", "maserati"],
  ["jaguar", "jaguar"],
  ["bentley", "bentley"],
  ["holden", "holden"],
  ["commodore", "holden"],
  ["dodge", "dodge"],
  ["viper", "dodge"],
  ["volvo", "volvo"],
  ["kia", "kia"],
];

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function byKeyword(text: string): string | null {
  const s = squash(text);
  if (s === "") return null;
  for (const [keyword, make] of KEYWORDS) if (s.includes(keyword)) return make;
  return null;
}

/**
 * iRacing: the make from DriverInfo CarPath (e.g. "ferrari296gt3", "chevyvettez06rgt3"), else
 * from CarScreenName ("Porsche 911 GT3 R (992)"). Null when neither names a known make.
 */
export function iracingCarMake(carPath: string | null, screenName: string | null): string | null {
  // A path starting "vw" is a Volkswagen ("vwbeetlegrc"); elsewhere "vw" is too short to trust.
  if (carPath !== null && /^vw/i.test(carPath.trim())) return "volkswagen";
  return (
    (carPath === null ? null : byKeyword(carPath)) ??
    (screenName === null ? null : byKeyword(screenName))
  );
}

/**
 * LMU entries whose name carries the team but not the make, by class. Keys are squashed team
 * names (see `squash`); the class is the normalised LMU class ("hyper", "lmgt3", "gte", "lmp3").
 */
const LMU_TEAMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  hyper: {
    afcorse: "ferrari",
    proton: "porsche",
    penske: "porsche",
    jota: "cadillac",
    ironlynx: "lamborghini",
    wrt: "bmw",
    thor: "aston-martin",
    heartofracing: "aston-martin",
  },
  lmgt3: {
    afcorse: "ferrari",
    kessel: "ferrari",
    spiritofrace: "ferrari",
    grracing: "ferrari",
    manthey: "porsche",
    ironlynx: "lamborghini",
    irondames: "lamborghini",
    unitedautosports: "mclaren",
    inception: "mclaren",
    garage59: "mclaren",
    akkodis: "lexus",
    tfsport: "chevrolet",
    heartofracing: "aston-martin",
    dstation: "aston-martin",
    wrt: "bmw",
    proton: "ford",
  },
};

/** LMU class names as the sim gives them ("Hyper", "LMGT3", "GT3", "GTE", "LMP2", "LMP3"). */
function lmuClassKey(className: string | null): string {
  const c = squash(className ?? "");
  if (c.startsWith("hyper")) return "hyper";
  if (c.includes("gt3")) return "lmgt3";
  if (c.includes("gte")) return "gte";
  if (c.includes("lmp2") || c === "p2") return "lmp2";
  if (c.includes("lmp3") || c === "p3") return "lmp3";
  return c;
}

/**
 * LMU: the make from the entry's vehicle name ("Toyota Racing 2026 #7:LM", "AF Corse 2026
 * #83:LM") and class. Every LMP2 car in LMU is an Oreca 07; otherwise a make in the name wins,
 * then a known team of that class. Null when unknown.
 */
export function lmuCarMake(vehicleName: string | null, className: string | null): string | null {
  const cls = lmuClassKey(className);
  if (cls === "lmp2") return "oreca";
  const name = vehicleName ?? "";
  const named = byKeyword(name.replace(/#.*$/, ""));
  if (named !== null) return named;
  const teams = LMU_TEAMS[cls];
  if (teams === undefined) return null;
  const s = squash(name.replace(/\d{4}.*$/, ""));
  for (const [team, make] of Object.entries(teams)) if (s.includes(team)) return make;
  return null;
}
