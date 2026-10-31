// Event effects and decisions, 1918 – 1951. Keyed by Event Name in docs/EVENTS.csv (see src/core/effects.ts for
// the effect types and conditions, docs/EVENTS-ACTIONS.md for what each event should do).
//
// Headline only (no entry): Pennsylvania Ratifies the 19th, Frick Leaves a Park (Frick Park is in PARKS from 1927),
// Mellon at the Treasury (no tax model; "Mellon Tax Cuts" carries the price proxy), Robert Morris Founded, Emsworth
// Replaces Davis Island, Liberty Bridge Opens and The Three Sisters (bridges in the map JSON), Metropolitan
// Pittsburgh Rejected, Mount Mercy College, Impeach Mellon!, The Forbes Field Promise, McNair Quits, Housing
// Authority Founded (no public-housing growth rule yet), Fallingwater, Lawrence on Trial, Double V, Mounted Police
// at East Pittsburgh, Urban Redevelopment Authority (no player clearance action yet), Television Arrives, Homer
// Brown Takes the Bench, City Population Peaks (REGION_POP peaks in 1950), The Cvetic Hearings.

import type { Effect, Scope } from "../effects";
import type { LandmarkDef } from "../landmarks";
import type { DecisionFn } from "./index";
import { decision, option, when, year } from "./helpers";
import type { GameState } from "../game";
import { priceLevel } from "../time";

/** wage and price level, as business.ts prices its actions */
const era = (g: GameState) => priceLevel(year(g));
const usd = (n: number) => `$${n.toLocaleString()}`;

const STEEL: Scope = { industry: ["steel", "metalworks"] };
/** the U.S. Steel and independent steel works that the national steel strikes shut */
const steelRivalsStrike = (seasons: number): Effect[] =>
  ["jl", "carnegie", "frick", "ntube", "ussduq", "carrie"].map((rival) => ({ rival, strike: seasons }));

export const EFFECTS: Record<string, Effect[]> = {
  // ---------------------------------------------------------------- 1918–1919: the war ends
  "Wartime Aluminum Boom": [{ mods: [["price", 1.08, 2]], scope: { industry: "metalworks" } }],
  "Influenza": [{ epidemic: 0.03 }, { meters: { morale: -4 } }],
  "Armistice": [
    { clear: "America Enters the War" },
    { mods: [["price", 0.92, 2]] },
    { meters: { morale: 3 } },
  ],
  "Neville Island Shipyard": [
    { rival: "dravo", expand: 0.3 },
    { landmark: "dravo_neville" },
    { mods: [["price", 0.97, 8]], scope: { industry: "metalworks" } },
  ],
  "Fannie Sellins Murdered": [{ mods: [["strike", 1.3, 1]] }, { meters: { morale: -2 } }],
  "Great Steel Strike": [{ mods: [["strike", 8, 2]], scope: STEEL }, ...steelRivalsStrike(1)],
  "Mother Jones Jailed in Homestead": [{ place: "Homestead", unrest: 0.05, seasons: 2 }],
  "Prohibition": [
    { meters: { morale: -4, labour: -2 } },
    { note: "The saloons close. Behind the back-room doors, the speakeasies open." },
    { taverns: "close" },
  ],

  // ---------------------------------------------------------------- the 1920s
  "KDKA Goes on the Air": [{ rule: "advertise", set: { blocked: null } }, { meters: { morale: 1 } }],
  "Immigration Restricted": [{ mods: [["migrants", 0.6, 400]] }],
  "Coal Strike of 1922": [
    { mods: [["output", 0.85, 2]] },
    { mods: [["input", 1.15, 2]], scope: { good: "coal" } },
  ],
  "Eight-Hour Day": [{ mods: [["wage", 1.1, 200]], scope: { industry: "steel" } }, { meters: { morale: 2 } }],
  "Liberty Tubes Open": [
    // the South Hills open to commuters: streetcar suburbs fill up behind Mount Washington
    { migrate: { group: 1, people: 1500, places: ["South Hills"] } },
    { migrate: { group: 3, people: 600, places: ["South Hills"] } },
    { migrate: { group: 2, people: 400, places: ["South Hills"] } },
  ],
  "National Origins Act": [{ mods: [["migrants", 0.7, 400]] }],
  "Coke Centralized at Clairton": [
    // coke = coal for the steel works; U.S. Steel's by-product ovens make it cheaper for good
    { mods: [["input", 0.92, 240]], scope: { industry: "steel", good: "coal" } },
    { rival: "frick", expand: 0.1 },
    { place: "Clairton", health: -0.05, seasons: 40 },
  ],
  "Pitt Stadium Opens": [{ landmark: "pitt_stadium" }, { team: "pitt", act: "move", ground: "Pitt Stadium" }],
  "Mellon Tax Cuts": [{ mods: [["price", 1.05, 12]] }],
  "Cathedral of Learning Begun": [{ landmark: "cathedral_of_learning" }],
  "County Parks Open": [
    { meters: { morale: 2 } },
    { note: "Commissioner Babcock's county parks open: South Park in the southern hills, North Park beyond the city." },
  ],
  "Loew's Penn Theatre": [{ landmark: "loews_penn" }, { meters: { morale: 1 } }],
  "Gasometer Explosion": [
    { blast: { place: "Chateau gas holder", radiusM: 250, ruinSeasons: 8 } },
    { meters: { morale: -4 } },
    { note: "Twenty-eight are dead on the North Side; windows are blown in half a mile away." },
  ],
  "John Barkoski Beaten to Death": [
    { rule: "pinkertons", set: { cost: 1.25 } },
    { rule: "police", set: { cost: 1.25 } },
    { meters: { labour: -3 }, if: "policy:police=true" },
    { mods: [["strike", 1.2, 2]] },
    { meters: { morale: -2 } },
  ],
  "Musmanno's Crusade": [
    { rule: "pinkertons", set: { cost: 1.56 } },
    { rule: "police", set: { cost: 1.56 } },
  ],

  // ---------------------------------------------------------------- the Depression
  "The Crash": [
    { mods: [["price", 0.6, 28], ["output", 0.55, 28], ["migrants", 0.3, 28]] },
    { rule: "relief", set: { blocked: null } },
    { meters: { morale: -8 } },
  ],
  "Ohio River Canalized": [{ mods: [["freightCost", 0.85, 400]], scope: { gateway: "ohio" } }],
  "Pinchot Strips the Private Police": [
    { mods: [["strike", 1.2, 400]] },
    { rule: "police", set: { blocked: "Governor Pinchot issues no Coal and Iron Police commissions (1931)" } },
    { rule: "pinkertons", set: { blocked: "No private police commissions under Pinchot (1931)" } },
  ],
  "Charity Hospital in Hard Times": [{ meters: { morale: 1 } }],
  "County Airport Dedicated": [{ landmark: "county_airport" }, { meters: { morale: 1 } }],
  "Father Cox's Army": [{ meters: { morale: 1 } }],
  "Greenlee Field Opens": [
    { landmark: "greenlee_field" },
    { team: "crawfords", act: "move", ground: "Greenlee Field" },
    { team: "grays", act: "move", ground: "Greenlee Field" },
    { meters: { morale: 2 } },
  ],

  // ---------------------------------------------------------------- the New Deal and the CIO
  "Section 7(a)": [{ mods: [["strike", 1.5, 8]] }],
  "Clairton Strike": [{ mods: [["strike", 2, 1]], scope: STEEL }, { place: "Clairton", unrest: 0.1, seasons: 2 }],
  "Mill Organizing Drives": [{ mods: [["strike", 1.3, 6]], scope: STEEL, if: "!union:recognise" }],
  "Ambridge Massacre": [{ mods: [["strike", 2, 1]], scope: STEEL }, { place: "Ambridge", unrest: 0.15, seasons: 2 }, { meters: { morale: -2 } }],
  "Captive Mines Strike": [
    { mods: [["output", 0.9, 1]] },
    { mods: [["input", 1.1, 1]], scope: { industry: "steel", good: "coal" } },
  ],
  "Democrat McNair Elected Mayor": [
    { politics: "newdeal" },
    // the old Republican ring's men are out of City Hall: a bribe buys less and is likelier to come out
    { rule: "bribe", set: { yield: 0.4, risk: 0.3 } },
  ],
  "Repeal": [{ meters: { morale: 4, labour: 2 } }, { taverns: "open" }],
  "Mesta Builds the Irvin Works": [{ rival: "mesta", expand: 0.2 }, { landmark: "irvin_works" }],
  "Steel Strike Called Off": [{ mods: [["strike", 0.7, 2]], scope: STEEL }],
  "Democrats Take Harrisburg": [
    { politics: "newdeal" },
    // the state police no longer escort strikebreakers through the picket lines
    { rule: "strikebreakers", set: { cost: 1.5 } },
  ],
  "Penn State Comes to McKeesport": [{ landmark: "psu_mckeesport" }],
  "The Wagner Act": [{ mods: [["wage", 1.05, 400]] }],
  "Coal and Iron Police Abolished": [
    { rule: "police", set: { blocked: "The Coal and Iron Police were abolished in 1935" } },
    { rule: "pinkertons", set: { blocked: "Private industrial police are abolished (1935)" } },
  ],
  "CIO Formed": [
    { mods: [["strike", 1.25, 6]], if: "!union:recognise" },
    // a company union looks like what it is once the CIO is organising
    { clear: "decision: Set up a company union" },
    { mods: [["strike", 1.4, 6]], if: "flag:companyUnion" },
  ],
  "Steel Workers Organizing Committee": [{ mods: [["strike", 1.4, 3]], scope: STEEL, if: "!union:recognise" }],
  // the worst flood in the city's history (46 ft against 1907's 36): floodplain works keep a fifth of their output
  "The Great St. Patrick's Day Flood": [
    { flood: 0.2 }, { meters: { morale: -6 } },
    { place: "Downtown", health: -0.15, seasons: 3 }, { place: "The Point", unrest: 0.05, seasons: 2 },
  ],
  "Flood Control Act": [
    // the reservoirs come in over the next decades: the first already cut flood damage (Tygart takes it further)
    { mods: [["floodRisk", 0.75, 400]] },
  ],
  "Big Steel Signs": [{ mods: [["wage", 1.15, 200]], scope: STEEL }],
  "The Aliquippa Case": [
    { rule: "blacklist", set: { blocked: "NLRB v. Jones & Laughlin: firing union men is illegal (1937)" } },
    { rule: "lockout", set: { blocked: "The Wagner Act forbids locking out the union" } },
    { clear: "decision: Set up a company union" },
    { flag: "companyUnion", value: false },
    { cash: -12000, if: "flag:firedOrganisers", why: "The Labor Board orders the fired organisers reinstated with back pay" },
    { meters: { labour: 5 }, if: "flag:firedOrganisers" },
    { mods: [["strike", 1.2, 8]], if: "union:fight" },
  ],
  "Death on the Beaver Falls Picket": [{ mods: [["strike", 1.5, 1]], scope: STEEL }, { meters: { morale: -1 } }],
  "Little New Deal": [
    { mods: [["wage", 1.03, 400]] },
    { rule: "strikebreakers", set: { cost: 2.25 } },
  ],
  "Mellon Institute Building": [{ landmark: "mellon_institute" }],
  "Alcoa Antitrust Suit": [
    // trust-busting season: buying out a rival draws the Justice Department's eye (until the war)
    { rule: "buy", set: { cost: 1.3 } },
    { note: "The Justice Department is watching the big combinations: buying a rival costs more for a few years." },
  ],
  "Tygart Dam Completed": [{ mods: [["floodRisk", 0.85, 400]], scope: { gateway: "upper_mon" } }],
  "Heinz Memorial Chapel": [{ landmark: "heinz_chapel" }],

  // ---------------------------------------------------------------- the Second World War
  "War in Europe Again": [
    { mods: [["price", 1.15, 9]] },
    // the men you kept fed in the bad years remember it when the hiring starts again
    { meters: { labour: 6 }, if: "flag:reliefGiven" },
  ],
  "Buhl Planetarium Opens": [{ landmark: "buhl_planetarium" }, { meters: { morale: 1 } }],
  "Pennsylvania Turnpike Opens": [{ mods: [["freightCost", 0.9, 400]], scope: { gateway: "rail" } }],
  "Roosevelt Dedicates Terrace Village": [{ landmark: "terrace_village" }, { meters: { morale: 1 } }],
  "Smoke Ordinance Passed": [
    { note: "City council passes a smoke-control law. Enforcement waits for the war's end: works that dump their smoke have until 1946." },
  ],
  "Pearl Harbor": [
    { mods: [["price", 1.3, 15], ["output", 1.15, 15]] },
    // the young men enlist: a smaller pool at the gate
    { mods: [["labour", 0.9, 15]] },
    { rule: "buy", set: { cost: 1 } },
  ],
  "United Steelworkers of America": [
    { mods: [["strike", 0.85, 400], ["wage", 1.03, 400]], scope: STEEL, if: "union:recognise" },
  ],
  "Dravo Wins the First \"E\"": [{ rival: "dravo", expand: 0.5 }, { meters: { morale: 1 } }],
  "Mesta's Big Guns": [
    { rival: "mesta", expand: 0.3 },
    { mods: [["price", 0.95, 8]], scope: { industry: "metalworks" } },
  ],
  "Victory": [
    { clear: "Pearl Harbor" },
    { clear: "decision: Bid for war orders" },
    { mods: [["price", 0.9, 2]] },
    { meters: { morale: 6 } },
  ],

  // ---------------------------------------------------------------- the postwar years and Renaissance I
  "Lawrence Elected Mayor": [
    { politics: "renaissance" },
    { rule: "lobby", set: { yield: 1.25 } },
    { rule: "bribe", set: { yield: 0.6, risk: 0.3 } },
  ],
  "Postwar Steel Strike": [{ mods: [["strike", 8, 1]], scope: STEEL }, ...steelRivalsStrike(1)],
  "Westinghouse Strike": [{ mods: [["strike", 3, 2]], scope: { industry: "power" } }, { rival: "westinghouse", strike: 2 }],
  "Smoke Control Enforced": [{ mods: [["pollution", 0.45, 400]] }, { meters: { morale: 2 } }],
  "Duquesne Light Strike": [{ mods: [["output", 0.9, 1]] }, { rival: "dlight", strike: 1 }],
  "The Pittsburgh Package": [{ mods: [["pollution", 0.9, 400]] }],
  "Taft-Hartley": [{ mods: [["strike", 0.85, 400]] }],
  "Elrama Power Plant": [
    { rival: "dlight", expand: 0.2 },
    { landmark: "elrama_station" },
    { mods: [["price", 0.93, 400]], scope: { industry: "power" } },
  ],
  "Donora Smog": [
    { place: "Donora", health: -0.2, seasons: 4 },
    { meters: { reputation: -8 }, if: "policy:waste=dump" },
    { meters: { reputation: -3 }, if: "policy:waste=standard" },
    { meters: { morale: -3 } },
    // four years in which every smoky works is suspect
    { pressure: { meter: "reputation", amount: -10, seasons: 16 }, if: "!policy:waste=abate" },
  ],
  "CIO Expels the UE": [{ mods: [["strike", 0.7, 4]], scope: { industry: "power" } }],
  "Steel Pension Strike": [{ mods: [["strike", 6, 1], ["wage", 1.05, 400]], scope: STEEL }, ...steelRivalsStrike(1)],
  "Turnpike Reaches Ohio": [
    // trucks to the Midwest undercut the railroads and the Ohio barges
    { mods: [["freightCost", 0.92, 400]], scope: { gateway: "ohio" } },
    { mods: [["freightCost", 0.95, 400]], scope: { gateway: "rail" } },
  ],
  "Renaissance I": [
    { clearance: { place: "The Point", radiusM: 300, to: ["North Side", "South Hills"] } },
    { landmark: "gateway_center" },
    { meters: { morale: 2 } },
  ],
  // public housing, redevelopment and a lost ballpark (engine systems added in v0.11.2)
  "Housing Authority Founded": [{ flag: "housingAuthority" }],
  "Urban Redevelopment Authority": [{ flag: "ura" }, { rule: "ura", set: { blocked: null } }],
  "Greenlee Field Torn Down": [{ landmark: "greenlee_field", state: "ruin" }, { meters: { morale: -2 } }],
};

export const DECISIONS: Record<string, DecisionFn> = {
  "Mother Jones Jailed in Homestead": (g) => !when(g, "men>=250 industry:steel,metalworks !union:recognise") ? null : decision(
    "motherjones1919", "Mother Jones comes to speak",
    "The strikers' meetings are banned in Homestead, and Mother Jones has been arrested for speaking anyway. The organisers ask your burgess for a hall in your own town.",
    [
      option("Ban the meetings", "Strike chance ×0.75 for a year. Labour −10, reputation −6.",
        [{ mods: [["strike", 0.75, 4]] }, { meters: { labour: -10, reputation: -6 } }, { flag: "bannedMeetings" }],
        "The burgess bans the meetings; the hall is padlocked."),
      option("Let her speak", "Strike chance ×1.2 for two seasons. Labour +5; the other owners frown (influence −3).",
        [{ mods: [["strike", 1.2, 2]] }, { meters: { labour: 5, influence: -3 } }],
        "She speaks from a wagon to a crowd of thousands."),
    ], 0),

  "Cathedral of Learning Begun": (g) => {
    if (!when(g, "industry:steel,metalworks men>=100")) return null;
    const cost = Math.round(15000 * era(g));
    return decision("cathedral1926", "Steel for the Cathedral of Learning",
      "Chancellor Bowman is raising money for a 42-storey tower of learning in Oakland. Schoolchildren give dimes to 'buy a brick'. He asks you for the steel frame.",
      [
        option("Donate the steel", `${usd(cost)}. Reputation +8, influence +4, morale +2.`,
          [{ meters: { reputation: 8, influence: 4, morale: 2 } }, { flag: "cathedralSteel" }],
          "Your steel goes into the Cathedral's frame.", cost),
        option("Decline", "No cost.", [], "You wish the Chancellor well."),
      ], 0);
  },

  "Charity Hospital in Hard Times": (g) => {
    if (!when(g, "men>=100")) return null;
    const cost = Math.round(6000 * era(g));
    return decision("relief1931", "Relief for your laid-off men",
      "Mercy Hospital is treating the jobless for free. Your laid-off men and their families are going hungry in the company houses.",
      [
        option("Give relief", `${usd(cost)}. Labour +10, reputation +5; the men will remember it when hiring resumes.`,
          [{ meters: { labour: 10, reputation: 5, morale: 1 } }, { flag: "reliefGiven" }],
          "Coal, flour and the rent for the families of your laid-off men.", cost),
        option("Leave it to the charities", "Labour −5.",
          [{ meters: { labour: -5 } }],
          "The company keeps its money; the hospitals and churches do what they can."),
      ], 1);
  },

  "Father Cox's Army": (g) => {
    if (!when(g)) return null;
    const cost = Math.round(3000 * era(g));
    return decision("cox1932", "Father Cox's Army sets out",
      "Father Cox is leading 25,000 jobless Pittsburghers to Washington to demand relief. He asks the city's employers for trucks, gasoline and food for the march.",
      [
        option("Donate to the march", `${usd(cost)}. Reputation +6, labour +3, morale +2.`,
          [{ meters: { reputation: 6, labour: 3, morale: 2 } }],
          "Your trucks join the convoy on the Lincoln Highway.", cost),
        option("Ignore it", "Reputation −2.",
          [{ meters: { reputation: -2 } }],
          "The marchers leave without your help."),
      ], 1);
  },

  "Mill Organizing Drives": (g) => !when(g, "men>=250 industry:steel,metalworks !union:recognise") ? null : decision(
    "organizing1933", "Union cards in your mill",
    "Section 7(a) says the men may organise, and they are signing union cards by the thousand. Other owners are setting up 'employee representation plans' of their own.",
    [
      option("Set up a company union", "An employee representation plan: strike chance ×0.6 for nearly two years, but it may backfire once the CIO comes.",
        [{ mods: [["strike", 0.6, 7]] }, { flag: "companyUnion" }, { meters: { labour: -2 } }],
        "The works council meets in the superintendent's office."),
      option("Let them organise", "Labour +6, strike chance ×1.2 for a year.",
        [{ mods: [["strike", 1.2, 4]] }, { meters: { labour: 6 } }],
        "The union men hold their meetings in the open."),
      option("Fire the card-signers", "Strike chance ×0.6 for two years. Labour −12, reputation −5; the law may catch up with you.",
        [{ mods: [["strike", 0.6, 8]] }, { meters: { labour: -12, reputation: -5 } }, { flag: "firedOrganisers" }],
        "The men who signed are told not to come back."),
    ], 0),

  "Dravo Wins the First \"E\"": (g) => !when(g, "industry:metalworks") ? null : decision(
    "warorders1942", "Bid for war orders",
    "Dravo's Neville Island yard has won the first Army-Navy 'E' and will employ 16,000. The War Production Board wants every machine shop on war work.",
    [
      option("Bid for war orders", "Guaranteed sales: prices ×1.2 and output ×1.1 for the war, but the labour shortage pushes wages ×1.1. Labour −3.",
        [{ mods: [["price", 1.2, 14], ["output", 1.1, 14], ["wage", 1.1, 14]], scope: { industry: "metalworks" } }, { meters: { labour: -3, reputation: 3 } }, { flag: "warOrders" }],
        "Your shops go over to war work, three shifts a day."),
      option("Stay in civilian work", "No change.", [], "You keep your old customers."),
    ], 0),

  "Allegheny Conference Formed": (g) => {
    if (!when(g, "men>=500")) return null;
    const cost = Math.round(10000 * era(g));
    return decision("conference1943", "Join the Allegheny Conference",
      "Richard King Mellon is gathering the city's business leaders to clean up the smoke and rebuild downtown when the war ends. He wants your company in.",
      [
        option("Join the Conference", `${usd(cost)}. Reputation +6, influence +8; you'll be cleaning your own smoke sooner.`,
          [{ meters: { reputation: 6, influence: 8 } }, { flag: "conference" }],
          "You take a seat at the Duquesne Club table.", cost),
        option("Stay out", "Influence −4.",
          [{ meters: { influence: -4 } }],
          "You leave the civic work to the Mellons."),
      ], 0);
  },
};

export const LANDMARKS: LandmarkDef[] = [
  { id: "dravo_neville", name: "Dravo Neville Island Yard", kind: "shipyard", place: "Neville Island" },
  { id: "pitt_stadium", name: "Pitt Stadium", kind: "stadium", place: "Pitt Stadium" },
  { id: "cathedral_of_learning", name: "Cathedral of Learning", kind: "tower", place: "Cathedral of Learning" },
  { id: "loews_penn", name: "Loew's Penn Theatre", kind: "theatre", place: "Loew's Penn" },
  { id: "county_airport", name: "Allegheny County Airport", kind: "airport", place: "Allegheny County Airport" },
  { id: "greenlee_field", name: "Greenlee Field", kind: "ballpark", place: "Greenlee Field" },
  { id: "irvin_works", name: "Irvin Works", kind: "plant", place: "Irvin Works" },
  { id: "psu_mckeesport", name: "Penn State McKeesport", kind: "college", place: "Penn State McKeesport" },
  { id: "mellon_institute", name: "Mellon Institute", kind: "museum", place: "Mellon Institute" },
  { id: "heinz_chapel", name: "Heinz Memorial Chapel", kind: "chapel", place: "Heinz Chapel" },
  { id: "buhl_planetarium", name: "Buhl Planetarium", kind: "planetarium", place: "Buhl Planetarium" },
  { id: "terrace_village", name: "Terrace Village", kind: "housing", place: "Terrace Village" },
  { id: "elrama_station", name: "Elrama Power Station", kind: "plant", place: "Elrama" },
  { id: "gateway_center", name: "Gateway Center", kind: "office", place: "Gateway Center" },
];

/** extra named places these events need: [name, lat, lon, radius in metres] (see src/core/places.ts) */
export const PLACES: [string, number, number, number][] = [
  ["Pitt Stadium", 40.4445, -79.9625, 150],
  ["Cathedral of Learning", 40.4443, -79.9533, 100],
  ["Loew's Penn", 40.4430, -80.0010, 100],
  ["Chateau gas holder", 40.4515, -80.0275, 150],
  ["Allegheny County Airport", 40.3544, -79.9302, 400],
  ["Greenlee Field", 40.4523, -79.9712, 150],
  ["Irvin Works", 40.3340, -79.9000, 300],
  ["Penn State McKeesport", 40.3480, -79.8480, 150],
  ["Mellon Institute", 40.4462, -79.9510, 100],
  ["Heinz Chapel", 40.4446, -79.9512, 80],
  ["Buhl Planetarium", 40.4517, -80.0062, 100],
  ["Terrace Village", 40.4455, -79.9680, 300],
  ["Gateway Center", 40.4410, -80.0060, 150],
];
