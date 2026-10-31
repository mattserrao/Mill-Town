// Event effects and decisions, 1893 – 1917. Keyed by Event Name in docs/EVENTS.csv (see src/core/effects.ts for
// the effect types and conditions, docs/EVENTS-ACTIONS.md for what each event should do).
//
// Headline only (nothing to do, or already done by other data): Boss Magee Offers a Zoo, Riverview Park Given,
// Mellon Joins the University Board, Pittsburgh Symphony Founded, Union Railroad Opens (map rail data), Mesta
// Machine Company / Duquesne Light Formed (rival entry years), Carnegie Buys the Carrie Furnaces (rival renames),
// First Women Graduates, Mellon Line Buys Kenny's Grove, Dippy Found in Wyoming, Carnegie Steel Clears $21 Million,
// Spindletop Gusher, Carnegie's Lawyer Goes to Washington, Pittsburgh Railways Formed, Carnegie Hero Fund, Dippy Goes
// to London, Aluminum Company of America, Dippy Comes Home, Allegheny City Annexed (districts.ts), University Buys
// Oakland Land, University of Pittsburgh Named, Wabash Railroad Fails, The Hump Cut, Votes for Women Defeated, Air
// Brake Buys Union Switch.

import type { DecisionOption } from "../business";
import type { Effect } from "../effects";
import { cal, type GameState } from "../game";
import type { LandmarkDef } from "../landmarks";
import { sellWorks } from "../rivalai";
import { decision, option, when } from "./helpers";
import type { DecisionFn } from "./index";

const STEEL = { industry: "steel" as const };
const MILLS = { industry: ["steel", "metalworks"] as ("steel" | "metalworks")[] };
const COAL = { good: "coal" as const };
const FOREVER = 400;

export const EFFECTS: Record<string, Effect[]> = {
  // ---- 1893–1899
  "Anti-Pinkerton Act": [{ rule: "pinkertons", set: { cost: 1.5 } }],
  "Westinghouse Lights the World's Fair": [{ rival: "westinghouse", expand: 0.2 }],
  "Panic of 1893": [
    { mods: [["price", 0.72, 12], ["wage", 0.85, 12], ["migrants", 0.6, 8]] },
    { meters: { morale: -6 } },
    { place: "Homestead", unrest: 0.08, seasons: 4 }, { place: "Braddock", unrest: 0.08, seasons: 4 }, { place: "McKeesport", unrest: 0.08, seasons: 4 },
    { note: "Soup kitchens open in the mill towns." },
  ],
  "Highland Park Opens": [{ meters: { morale: 2 } }, { note: "Highland Park opens to the public above the reservoirs." }],
  "Braddock Library Doubled": [{ landmark: "braddock_club" }, { meters: { morale: 2 } }],
  "Phipps Conservatory Opens": [{ landmark: "phipps" }, { meters: { morale: 2 } }],
  "Coal Miners' Strike": [{ mods: [["output", 0.85, 2]] }, { mods: [["input", 1.12, 2]], scope: COAL }],
  "Croatian Fraternal Union": [{ landmark: "croatian_hall" }, { migrate: { group: 9, people: 120, places: ["Troy Hill"] } }],
  "Niagara Power Plant": [{ rival: "westinghouse", expand: 0.1 }],
  "Carnegie Institute Opens": [{ landmark: "carnegie_institute" }, { meters: { morale: 3 } }],
  "Westinghouse–GE Patent Truce": [{ flag: "patentTruce" }],
  "Union Revival Crushed": [{ mods: [["strike", 0.85, 16]], scope: STEEL }],
  "Washington Takes the Mon": [{ mods: [["freightCost", 0.87, FOREVER]], scope: { gateway: "upper_mon" } }, { note: "Tolls end on the Monongahela locks." }],
  "Lawrenceville Library Opens": [{ landmark: "lawrenceville_library" }, { meters: { morale: 1 } }],
  "Highland Park Zoo Dedicated": [{ landmark: "highland_zoo" }, { meters: { morale: 2 } }],
  "Homestead Library Opens Above the Mill": [{ landmark: "homestead_library" }, { meters: { morale: 1 } }],
  "West End Library Opens": [{ landmark: "west_end_library" }, { meters: { morale: 1 } }],
  // Quay's deadlocked legislature: lobbying Harrisburg buys half as much until the Quay men are back (1901)
  "Boss Quay Acquitted": [{ rule: "lobby", set: { yield: 0.5 } }],
  "Homestead Lodge Snuffed Out": [{ rival: "frick", damage: [0.5, 1] }, { place: "Homestead", unrest: 0.1, seasons: 2 }],
  "Kennywood Opens": [{ landmark: "kennywood" }, { meters: { morale: 3 } }],
  "National Tube Trust": [{ rival: "ntube", expand: 0.2 }],
  "Pittsburgh Coal Company": [{ mods: [["input", 1.06, 40]], scope: COAL }],

  // ---- 1900–1909
  "No Union Steel Left": [{ mods: [["wage", 0.95, 40]], scope: STEEL }],
  "PPG Rules Plate Glass": [{ rival: "ppg", expand: 0.2 }, { mods: [["price", 0.95, 12]], scope: { industry: "glass" } }],
  "American Bridge Company": [{ mods: [["price", 0.97, 8]], scope: { industry: "metalworks" } }, { rival: "abridge", expand: 0.1 }],
  "Carnegie Technical Schools Founded": [{ landmark: "carnegie_tech" }, { meters: { morale: 1 } }],
  "U.S. Steel Formed": [{ rival: "carnegie", style: "steady" }, { mods: [["price", 0.97, 4]], scope: STEEL }],
  // the governor's recorder replaces the mayor: your friends at City Hall are gone, but Harrisburg works again
  "Magee Dies; the Ripper Act": [{ rule: "lobby", set: { yield: 1 } }, { rule: "locks", set: { cost: 1.25 } }, { meters: { influence: -5 } }],
  "Union Rejects Half a Loaf": [{ mods: [["strike", 4, 1]], scope: MILLS }],
  "1901 Steel Strike Collapses": [{ mods: [["wage", 0.95, 40], ["strike", 0.7, 32]], scope: MILLS }],
  "Phipps Botany Hall": [{ landmark: "phipps_botany" }],
  "\"Pittsburg: A City Ashamed\"": [{ rule: "bribe", set: { risk: 0.3 } }],
  "The First World Series": [{ meters: { morale: 2 } }],
  "U.S. Steel Comes to Clairton": [
    { rival: "clairton", expand: 0.05 },
    { migrate: { group: 5, people: 200, places: ["Clairton"] } }, { migrate: { group: 10, people: 150, places: ["Clairton"] } },
  ],
  "Harwick Mine Disaster": [{ mods: [["input", 1.08, 1]], scope: COAL }, { meters: { morale: -4 } }],
  "Wabash Terminal Opens": [{ landmark: "wabash_terminal" }, { mods: [["freightCost", 0.95, 16]], scope: { gateway: "rail" } }],
  "J&L Builds at Aliquippa": [{ rival: "jl", expand: 0.2 }, { landmark: "jl_aliquippa" }, { mods: [["price", 0.97, 20]], scope: STEEL }],
  "Ambridge Incorporated": [{ rival: "abridge", expand: 0.15 }, { mods: [["price", 0.97, 20]], scope: { industry: "metalworks" } }],
  "Reform Mayor Guthrie": [{ politics: "reform" }, { rule: "bribe", set: { blocked: "Reform mayor Guthrie: no one at City Hall will take it" } }],
  "Westinghouse Research Department": [{ rule: "lab", set: { blocked: null } }],
  "Gulf Oil Corporation": [{ rival: "mellon", expand: 0.1 }, { flag: "gulf" }],
  // (era3.ts also carries this 1907 flood from the old table; setting the flood twice is harmless)
  "St. Patrick's Day Flood": [{ flood: 0.35 }, { meters: { morale: -4 } }, { place: "Downtown", health: -0.1, seasons: 2 }],
  "Carrie Furnaces 6 and 7": [{ rival: "carrie", expand: 0.1 }],
  // the puddlers' own union: fewer walkouts at iron works (no Bessemer yet)
  "Puddlers Secede": [{ mods: [["strike", 0.85, 20]], scope: STEEL, if: "!tech:bessemer" }],
  "Panic of 1907": [{ mods: [["price", 0.8, 6], ["migrants", 0.7, 4]] }, { meters: { morale: -4 } }],
  "Westinghouse Loses His Empire": [{ rival: "westinghouse", damage: [0.9, 8] }],
  "Darr Mine Disaster": [{ mods: [["input", 1.08, 1]], scope: COAL }, { meters: { morale: -4 } }],
  "Marianna Mine Explosion": [{ mods: [["input", 1.06, 1]], scope: COAL }, { meters: { morale: -3 } }],
  "Clean Water at Last": [{ meters: { morale: 3 } }],
  "Pressed Steel Car Strike": [{ mods: [["strike", 2, 2]], scope: MILLS }, { place: "McKees Rocks", unrest: 0.15, seasons: 2 }],
  "Forbes Field Opens": [{ landmark: "forbes_field" }, { team: "pirates", act: "move", ground: "Forbes Field" }],
  "U.S. Steel Goes Open Shop": [{ mods: [["strike", 1.5, 6]], scope: MILLS }],
  "Pirates Win the World Series": [{ team: "pirates", act: "title" }],
  "Pitt Moves to Oakland": [{ landmark: "pitt" }, { meters: { morale: 1 } }],

  // ---- 1910–1917
  "Westmoreland Coal Strike": [{ mods: [["output", 0.9, 5]] }, { mods: [["input", 1.05, 5]], scope: COAL }],
  "Shooting at Yukon": [{ mods: [["strike", 1.5, 1]] }, { meters: { morale: -2 } }],
  // the graft trials: bribes can be had again after Guthrie, but the prosecutors are watching (decision below)
  "Councilmanic Graft Scandal": [{ politics: "reform" }, { rule: "bribe", set: { blocked: null, risk: 0.35 } }],
  "Pittsburgh Courier Founded": [{ migrate: { group: 4, people: 150, places: ["Hill District"] } }],
  "George Westinghouse Ousted": [{ rival: "westinghouse", style: "steady" }],
  "Tin-Plate Strike Broken": [{ mods: [["wage", 0.97, 8], ["strike", 0.8, 8]], scope: MILLS }],
  // ward bosses lose their councils: a bribe buys less, an honest lobby a little more
  "Small Council Charter": [{ politics: "reform" }, { rule: "bribe", set: { yield: 0.6 } }, { rule: "lobby", set: { yield: 1.1 } }, { rule: "locks", set: { cost: 1 } }],
  "West Penn Moves to Bloomfield": [{ landmark: "west_penn" }],
  "Homestead Grays": [{ team: "grays", act: "found" }, { place: "Homestead", unrest: -0.05, seasons: 8 }, { meters: { morale: 2 } }],
  // Tech graduates staff a laboratory more cheaply
  "Carnegie Tech Grants Degrees": [{ rule: "lab", set: { cost: 0.8 } }],
  // the Progressives' reform mood: bribes are riskier; the antitrust suit against U.S. Steel ends the Gary dinners
  "Bull Moose Carries Pennsylvania": [{ rule: "bribe", set: { risk: 0.45 } }, { rule: "undercut", set: { blocked: null } }],
  "Mellon Institute Founded": [{ rule: "contract_research", set: { blocked: null } }],
  "War in Europe": [{ mods: [["price", 1.3, 16], ["migrants", 0.3, 16]] }],
  "Donora Zinc Works Opens": [{ landmark: "donora_zinc" }, { place: "Donora", health: -0.03, seasons: 132 }],
  "High-Voltage Ring": [{ rival: "dlight", expand: 0.15 }],
  "The Great Migration Begins": [
    { migrate: { group: 4, people: 300, places: ["Beltzhoover"] } },
    { migrate: { group: 4, people: 400, places: ["Hill District", "Homestead"] } },
  ],
  "Streetcar Strike": [{ mods: [["output", 0.97, 1]] }],
  "Battle of Braddock": [
    { mods: [["strike", 3, 1]], scope: MILLS }, { rival: "westinghouse", strike: 1 },
    { place: "Braddock", unrest: 0.1, seasons: 2 }, { meters: { morale: -4 } },
  ],
  "Clairton Coke Works": [
    { landmark: "clairton_coke" }, { mods: [["input", 0.96, 40]], scope: { industry: "steel", good: "coal" } },
    { place: "Clairton", health: -0.04, seasons: 160 },
  ],
  "Schenley High School": [{ landmark: "schenley_high" }, { meters: { morale: 1 } }],
  "America Enters the War": [{ mods: [["price", 1.25, 7], ["output", 1.1, 7], ["labour", 0.92, 7]] }],
  // patrons, lenders and the city's rules (engine systems added in v0.11.2)
  "Mellon Joins the University Board": [{ rule: "endow", set: { blocked: null } }],
  "Pittsburgh Railways Formed": [{ mods: [["labour", 1.03, FOREVER]] }],
};

// ---------------------------------------------------------------- decisions

/** an option that also changes something effects can't (policies, press, selling a works) */
const plus = (o: DecisionOption, f: (g: GameState) => string | void): DecisionOption => ({
  ...o, apply: (g, rng) => { const extra = f(g); const t = o.apply(g, rng); return extra ? `${t} ${extra}` : t; },
});

/** the company paid bribes since 1900 (from its record) */
const bribedSince = (g: GameState, y: number) =>
  Number(g.company!.biz.flags.bribed ?? 0) >= y || g.company!.biz.record.some((r) => r.includes("Bribe an official") && Number(/(\d{4})/.exec(r)?.[1] ?? 0) >= y);

/** wage and price level (as business.ts) */
const era = (g: GameState) => 1 + (cal(g).year - 1850) * 0.012;

export const DECISIONS: Record<string, DecisionFn> = {
  "Pittsburgh Symphony Founded": (g) => !when(g, "men>=100") ? null : decision("symphony1895", "A subscription for the orchestra",
    "The new Pittsburgh Orchestra will play in Carnegie's Music Hall. Its guarantors' list is the city's who's who; the Mellons' bankers sit on the board.",
    [
      option("Subscribe as a guarantor", "Reputation +4, influence +3; the Mellon bank lends to you at a better rate from now on.",
        [{ meters: { reputation: 4, influence: 3 } }, { flag: "symphony" }], "Your name goes on the programme beside the Mellons'.", Math.round(4000 * era(g))),
      option("Send your regrets", "No cost.", [], "The orchestra will manage without you."),
    ], 0),
  "J&L Refuses the Union": (g) => !when(g, "industry:steel,metalworks men>=250 !union:fight") ? null : decision(
    "jl1897", "J&L will not sign the scale",
    "Jones & Laughlin has refused to sign with the Amalgamated, and the other owners mean to follow. Your lodge's scale comes up for renewal.",
    [
      plus(option("Follow J&L: go non-union", "Union fought, wages down a step. Labour −15; the owners count you one of them (influence +5).",
        [{ meters: { labour: -15, influence: 5 } }, { flag: "nonUnion1897" }], "You refuse to sign the scale."),
        (g) => { const p = g.company!.biz.policy; p.union = "fight"; if (p.wages !== "low") p.wages = p.wages === "high" ? "market" : "low"; }),
      plus(option("Stay with the Amalgamated", "Sign the scale: union recognised. Labour +10; the owners think you soft (influence −8).",
        [{ meters: { labour: 10, influence: -8 } }, { flag: "stayedUnion1897" }], "You sign the Amalgamated scale for another year."),
        (g) => { g.company!.biz.policy.union = "recognise"; }),
    ], 0),

  "U.S. Steel Formed": (g) => {
    if (!when(g, "industry:steel,metalworks men>=250")) return null;
    const second = g.company!.others[0];
    const opts: DecisionOption[] = [
      option("Stay independent", "Like J&L: you keep your own counsel. Morgan's new trust cuts prices on you for a year (steel and metal prices −6%).",
        [{ mods: [["price", 0.94, 4]], scope: MILLS }, { flag: "usSteel", value: "independent" }], "You stay out of Morgan's combination."),
      option("Join Judge Gary's dinners", "A gentlemen's price pact: prices +4% for ten years, but no undercutting the trust; reformers notice (influence −5).",
        [{ mods: [["price", 1.04, 40]], scope: MILLS }, { meters: { influence: -5 } }, { flag: "usSteel", value: "pact" },
          { rule: "undercut", set: { blocked: "You are pledged to Judge Gary's prices" } }], "You dine with Judge Gary and hold the line on prices."),
    ];
    if (second) {
      opts.push(plus(option(`Sell ${second.name} to Morgan`, "Morgan pays half again what the works is worth. You keep your first works and your independence.",
        [{ flag: "usSteel", value: "sold" }], "Morgan's men buy the works."),
        (g) => {
          const w = g.company!.others[0];
          if (!w) return;
          sellWorks(g, w, "market", 1.5);
          return `${w.name} goes to U.S. Steel.`;
        }));
    }
    return decision("ussteel1901", "Morgan's billion-dollar trust",
      "J. P. Morgan has bought Carnegie out and formed the United States Steel Corporation. His men call on you: join the trust's price arrangements, sell them a works, or go your own way.",
      opts, 0);
  },

  "The Pittsburgh Survey": (g) => !when(g, "policy:hours=twelve men>=250") ? null : decision(
    "survey1908", "The Survey's investigators at your gate",
    "Paul Kellogg's investigators are documenting the twelve-hour day, the seven-day week and the deaths in the mills. They ask to see your works and your accident books.",
    [
      option("Keep the twelve-hour day, say nothing", "Like the steel men: no change. Reputation −5.",
        [{ meters: { reputation: -5 } }], "You turn the investigators away."),
      plus(option("Go to the ten-hour day", "Three shifts of eight or two of ten: wages per ton up. Labour +10, reputation +5.",
        [{ meters: { labour: 10, reputation: 5 } }, { flag: "tenHour1908" }], "Your works goes to the ten-hour day."),
        (g) => { g.company!.biz.policy.hours = "ten"; }),
      plus(option("Buy the newspapers' goodwill", "The papers bury the Survey for two years (bad news hurts half as much). Influence −5.",
        [{ meters: { influence: -5 } }], "The editors find the Survey tiresome.", Math.round(6000 * era(g))),
        (g) => { g.company!.biz.pressUntil = g.turn + 8; }),
    ], 0),

  "Councilmanic Graft Scandal": (g) => !(when(g) && bribedSince(g, 1900)) ? null : decision(
    "graft1910", "The prosecutors have your name",
    "The district attorney is indicting councilmen by the dozen, and one of them has your company's payments in his bank book.",
    [
      { label: "Hire the best lawyers", detail: "Even odds: walk free, or a fine (and reputation −15, influence −15).",
        apply: (g, rng) => {
          if (!rng.chance(0.5)) return "Your lawyers keep your name out of the trials.";
          const fine = Math.round(10000 * era(g));
          g.company!.cash -= fine;
          const m = g.company!.biz.meters;
          m.reputation = Math.max(-100, m.reputation - 15); m.influence = Math.max(0, m.influence - 15);
          g.headlines.push({ year: cal(g).year, season: cal(g).season, name: "Graft Exposed", description: `${g.company!.name} is named in the councilmanic graft trials and pays $${fine.toLocaleString()}.`, category: "Politics" });
          return `The jury hears of your payments; $${fine.toLocaleString()} in fines.`;
        } },
      option("Confess and pay restitution", "Certain: a smaller fine; reputation −6, influence −10.",
        [{ meters: { reputation: -6, influence: -10 } }, { flag: "confessed1910" }], "You confess and pay restitution.", Math.round(5000 * era(g))),
    ], 0),
};

// ---------------------------------------------------------------- landmarks and places

export const LANDMARKS: LandmarkDef[] = [
  { id: "braddock_club", name: "Carnegie Library of Braddock: music hall, pool and gym", kind: "hall", place: "Braddock" },
  { id: "phipps", name: "Phipps Conservatory", kind: "conservatory", place: "Phipps Conservatory" },
  { id: "phipps_botany", name: "Phipps Botany Hall", kind: "hall", place: "Phipps Conservatory" },
  { id: "croatian_hall", name: "Croatian Fraternal Union hall", kind: "hall", place: "Troy Hill" },
  { id: "carnegie_institute", name: "Carnegie Institute", kind: "museum", place: "Carnegie Institute" },
  { id: "lawrenceville_library", name: "Lawrenceville Branch Library", kind: "library", place: "Lawrenceville Library" },
  { id: "highland_zoo", name: "Highland Park Zoo", kind: "zoo", place: "Highland Park Zoo" },
  { id: "homestead_library", name: "Carnegie Library of Homestead", kind: "library", place: "Homestead Library" },
  { id: "west_end_library", name: "West End Branch Library", kind: "library", place: "West End Library" },
  { id: "kennywood", name: "Kennywood", kind: "amusement", place: "Kennywood" },
  { id: "carnegie_tech", name: "Carnegie Technical Schools", kind: "college", place: "Carnegie Tech" },
  { id: "wabash_terminal", name: "Wabash Pittsburgh Terminal", kind: "terminal", place: "Wabash Terminal" },
  { id: "jl_aliquippa", name: "Aliquippa Works (J&L)", kind: "factory", place: "Aliquippa" },
  { id: "forbes_field", name: "Forbes Field", kind: "ballpark", place: "Forbes Field" },
  { id: "pitt", name: "University of Pittsburgh (Oakland)", kind: "college", place: "Pitt Campus" },
  { id: "west_penn", name: "West Penn Hospital", kind: "hospital", place: "West Penn Hospital", hospital: true },
  { id: "donora_zinc", name: "Donora Zinc Works", kind: "plant", place: "Donora" },
  { id: "clairton_coke", name: "Clairton Coke Works", kind: "plant", place: "Clairton" },
  { id: "schenley_high", name: "Schenley High School", kind: "school", place: "Schenley High School" },
];

/** extra named places these events need: [name, lat, lon, radius in metres] (see src/core/places.ts) */
export const PLACES: [string, number, number, number][] = [
  ["Phipps Conservatory", 40.4390, -79.9470, 120],
  ["Carnegie Institute", 40.4436, -79.9496, 150],
  ["Carnegie Tech", 40.4433, -79.9436, 200],
  ["Lawrenceville Library", 40.4655, -79.9605, 80],
  ["Homestead Library", 40.3995, -79.9015, 100],
  ["West End Library", 40.4415, -80.0335, 100],
  ["Wabash Terminal", 40.4380, -80.0050, 80],
  ["Forbes Field", 40.4446, -79.9566, 120],
  ["Pitt Campus", 40.4458, -79.9535, 150],
  ["West Penn Hospital", 40.4616, -79.9460, 80],
  ["Schenley High School", 40.4516, -79.9555, 80],
];
