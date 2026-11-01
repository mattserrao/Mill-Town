// Event effects and decisions, 1952 – 1985. Keyed by Event Name in docs/EVENTS.csv (see src/core/effects.ts for
// the effect types and conditions, docs/EVENTS-ACTIONS.md for what each event should do).
//
// Headline only (no entry here, on purpose): WQED on the Air, Port Authority Created, Regional Parks Planned,
// Lawrence for Governor, Fort Pitt Bridge Opens (map data), Khrushchev Visits Mesta, Fort Pitt Tunnel Opens,
// Point Park College, La Roche and Pitt-Greensburg, Port Authority Takes the Wheel (streetcars end in 1955),
// Pitt Chancellor Ousted, Pitt Becomes State-Related, The Courier Closes, Carnegie Mellon University,
// Mister Rogers' Neighborhood, Boyce Park Dedicated, Air Brake Sold, PPG Industries (rename is rival data),
// Hartwood Acres Offered, Burn Unit at West Penn, Speaker Irvis, South Busway Opens, The Andrew Project,
// East Busway Opens, Chevron Buys Gulf, LTV Steel Formed (rename is rival data), Light Rail Rolls, cmu.edu,
// Subway Opens Downtown.

import { bump, type DecisionOption, pushHeadline } from "../business";
import { applyEffects, type Effect } from "../effects";
import { allWorks, type GameState } from "../game";
import type { LandmarkDef } from "../landmarks";
import { commission } from "../market";
import { acquire, acquisitionQuote, saleQuote } from "../rivalai";
import type { Rng } from "../rng";
import * as era1 from "./era1";
import * as era2 from "./era2";
import * as era3 from "./era3";
import { decision, option, when, year } from "./helpers";
import type { DecisionFn } from "./index";
import { priceLevel } from "../time";

/** wage and price level of a year (as in business.ts) */
const E = priceLevel;
const PERM = 400;
const MILL_TOWNS = ["Homestead", "Braddock", "Duquesne", "McKeesport", "Clairton"];

// The Braddock Carnegie Library (1889) belongs to an earlier era file; find it there, or define a stand-in.
const earlier: LandmarkDef[] = [...era1.LANDMARKS, ...era2.LANDMARKS, ...era3.LANDMARKS];
const braddockFound = earlier.find((l) => /braddock/i.test(l.name) && l.kind === "library");
const BRADDOCK_LIBRARY = braddockFound?.id ?? "braddock_library";

export const EFFECTS: Record<string, Effect[]> = {
  // ---- the 1950s
  "Truman Seizes the Mills": [{ mods: [["strike", 6, 2]], scope: { industry: "steel" } }, { meters: { morale: -2 } }],
  "Greater Pittsburgh Airport Opens": [{ landmark: "gp_airport" }, { meters: { morale: 2 } }],
  "The 50,000-Ton Press": [{ rival: "mesta", expand: 0.2 }, { mods: [["price", 0.97, 12]], scope: { industry: "metalworks" } }],
  "Conemaugh Dam Completed": [{ mods: [["floodRisk", 0.85, PERM]], scope: { gateway: "allegheny" } }],
  // highways aren't modelled: a wider commuting shed instead
  "Parkway and Squirrel Hill Tunnel": [{ mods: [["labour", 1.03, PERM]] }],
  "Salk Vaccine Works": [{ meters: { morale: 4 } }],
  "Long Westinghouse Strike": [
    { rival: "westinghouse", strike: 2 },
    { mods: [["price", 1.06, 2]], scope: { industry: "metalworks" } },
    { mods: [["input", 1.05, 2]], scope: { industry: "power" } }, // generators and parts come late
  ],
  "Lower Hill Cleared": [
    { clearance: { place: "Lower Hill", radiusM: 350, to: ["Homewood", "East Liberty", "Upper Hill"] } },
    { place: "Hill District", unrest: 0.1, seasons: 8 },
    { meters: { morale: -3 } },
  ],
  "Summer Steel Strike": [{ mods: [["strike", 6, 1]], scope: { industry: "steel" } }],
  "Shippingport Atomic Power": [{ landmark: "shippingport" }, { rival: "dlight", expand: 0.1 }],
  "ALCOSAN Cleans the Rivers": [{ mods: [["riverLoad", 0.4, PERM]] }, { landmark: "alcosan" }, { meters: { morale: 2 } }],
  "116-Day Strike": [{ mods: [["strike", 10, 2], ["price", 0.9, 12]], scope: { industry: "steel" } }, { meters: { morale: -3 } }],

  // ---- the 1960s
  "Mazeroski's Home Run": [{ team: "pirates", act: "title" }],
  "County Labor Council": [{ mods: [["strike", 1.1, PERM]] }],
  "Civic Arena Opens": [{ landmark: "civic_arena" }, { meters: { morale: 4 } }],
  "Dorothy Six Lit": [{ rival: "ussduq", expand: 0.3 }, { mods: [["price", 0.97, 8]], scope: { industry: "steel" } }],
  "Westinghouse Record Sales": [
    { rival: "westinghouse", expand: 0.2 },
    { mods: [["price", 0.95, 8]], scope: { industry: "metalworks" } },
    { mods: [["input", 0.95, 8]], scope: { industry: "power" } },
  ],
  "Kinzua Dam Completed": [{ mods: [["floodRisk", 0.7, PERM]], scope: { gateway: "allegheny" } }],
  "Community College Founded": [{ landmark: "ccac" }, { mods: [["labour", 1.02, PERM]] }, { rule: "retrain", set: { blocked: null } }, { meters: { morale: 2 } }],
  "Mesta Unionized": [{ rival: "mesta", damage: [0.95, 8] }],
  "The Hill Burns": [
    { blast: { place: "Hill District", radiusM: 120, ruinSeasons: 40 } },
    { blast: { place: "Homewood", radiusM: 100, ruinSeasons: 40 } },
    { place: "Hill District", unrest: 0.2, seasons: 4 },
    { place: "Homewood", unrest: 0.2, seasons: 4 },
    { meters: { morale: -8 } },
  ],
  "LTV Buys Jones & Laughlin": [{ rival: "jl", damage: [0.9, 40] }], // Dallas takes the cash and spends little
  "Bidwell Training Center": [{ landmark: "bidwell" }, { rule: "retrain", set: { cost: 0.8 } }, { place: "North Side", unrest: -0.04, seasons: 20 }],
  "Black Monday Shutdowns": [{ place: "Hill District", unrest: 0.08, seasons: 2 }],
  "\"Nobody's Boy\" Elected": [
    { politics: "reform" },
    { rule: "lobby", set: { yield: 0.7 } },
    { rule: "bribe", set: { yield: 0.7, risk: 0.35 } },
  ],

  // ---- the 1970s
  "Three Rivers Stadium": [
    { landmark: "three_rivers" },
    { landmark: "forbes_field", state: "ruin" },
    { team: "pirates", act: "move", ground: "Three Rivers Stadium" },
    { team: "steelers", act: "move", ground: "Three Rivers Stadium" },
  ],
  "Pirates Win Again": [{ team: "pirates", act: "title" }],
  "Heinz Hall Opens": [{ landmark: "heinz_hall" }, { meters: { morale: 2 } }],
  "Hurricane Agnes": [{ flood: 0.6 }, { meters: { morale: -4 } }],
  "Slag Dumping Ends": [{ mods: [["input", 1.03, PERM]], scope: { industry: "steel" } }, { place: "Nine Mile Run", health: 0.03, seasons: 60 }],
  "Clairton Consent Decree": [{ mods: [["pollution", 0.9, PERM]] }],
  "The Immaculate Reception": [{ meters: { morale: 5, labour: 2 } }],
  "State Sues U.S. Steel": [
    { cash: -Math.round(60000 * E(1973)), if: "flag:decreeStalled", why: "The state and county sue over the coke works' violations" },
    { meters: { reputation: -5 }, if: "flag:decreeStalled" },
    { cash: -Math.round(25000 * E(1973)), if: "!flag:decreeStalled tech:byproduct_coke policy:waste=dump", why: "Fined for the coke works' smoke" },
    { place: "Clairton", unrest: 0.05, seasons: 4 },
  ],
  "The No-Strike Deal": [{ mods: [["strike", 0.3, 40], ["wage", 1.08, 40]], scope: { industry: "steel" } }],
  "Oil Crisis": [
    { mods: [["price", 0.9, 8]], scope: { industry: "steel" } },
    { mods: [["input", 1.15, 8]] },
    { mods: [["price", 1.1, 8]], scope: { industry: "power" } },
    { meters: { morale: -2 } },
  ],
  "Point State Park Fountain": [{ landmark: "point_fountain" }, { meters: { morale: 2 } }],
  "Braddock Library Closes": [{ landmark: BRADDOCK_LIBRARY, state: "closed" }, { place: "Braddock", unrest: 0.05, seasons: 8 }, { meters: { morale: -2 } }],
  "\"A National Disgrace\"": [{ mods: [["pollution", 0.8, PERM]] }, { meters: { reputation: -3 }, if: "tech:byproduct_coke policy:waste=dump" }],
  "Super Bowl Champions": [{ team: "steelers", act: "title" }],
  "Gulf Payments Scandal": [{ rule: "bribe", set: { risk: 0.4 } }],
  "Clairton Air Crisis": [{ place: "Clairton", health: -0.1, unrest: 0.05, seasons: 1 }, { meters: { morale: -3 } }],
  "Westinghouse Uranium Crisis": [
    { rival: "westinghouse", damage: [0.7, 12] },
    { mods: [["price", 1.05, 8]], scope: { industry: "metalworks" } },
    { mods: [["input", 1.1, 8]], scope: { industry: "power" }, if: "tech:nuclear" },
  ],
  "Volkswagen Picks New Stanton": [{ landmark: "vw_new_stanton" }, { mods: [["migrants", 0.85, 8], ["labour", 0.97, 8]] }],
  "Beaver Valley Nuclear Plant": [{ landmark: "beaver_valley" }, { rival: "dlight", expand: 0.2 }, { mods: [["price", 0.92, PERM]], scope: { industry: "power" } }],
  "Caliguiri Steps In": [
    { politics: "renaissance" },
    { rule: "lobby", set: { yield: 1 } },
    { rule: "bribe", set: { yield: 1, risk: 0.3 } },
  ],
  "J&L Cuts Back in the City": [{ rival: "jl", damage: [0.75, 8] }, { place: "South Side", unrest: 0.08, seasons: 4 }, { meters: { morale: -3 } }],
  "Renaissance II": [{ landmark: "renaissance2" }, { meters: { morale: 2 } }],
  "Carrie Furnaces Go Cold": [
    { place: "Rankin", unrest: 0.1, seasons: 4 },
    { migrate: { group: 5, people: -400, places: ["Rankin"] } },
    { meters: { morale: -3 } },
  ],
  "J&L Takes Youngstown Sheet & Tube": [{ rival: "jl", damage: [0.9, 12] }],
  "City of Champions": [{ team: "pirates", act: "title" }, { team: "steelers", act: "title" }, { meters: { morale: 3 } }],
  "Closures Announced": [
    // the volume collapse itself is the world market (src/core/world.ts)
    { place: "Mon Valley", unrest: 0.08, seasons: 8 },
    { meters: { morale: -5 } },
  ],

  // ---- the 1980s
  "City Shrinks to 424,000": [{ meters: { morale: -2 } }],
  "The Bottom Falls Out": [
    // the 1982 trough (48% utilisation) is in the world market; here the jobless and the mood
    { mods: [["price", 0.95, 8]], scope: { industry: ["glass", "power"] } },
    { meters: { morale: -6 } },
  ],
  "National Tube Curtailed": [
    { place: "McKeesport", unrest: 0.1, seasons: 4 },
    { migrate: { group: 6, people: -600, places: ["McKeesport"] } },
    { meters: { morale: -3 } },
  ],
  "Neville Island Yard Closes": [{ place: "Neville Island", unrest: 0.08, seasons: 4 }, { meters: { morale: -2 } }],
  "Westinghouse Buys Robots": [{ rival: "westinghouse", expand: 0.1 }, { note: "Industrial robots: every industry can now commission automation (fewer men per ton)." }],
  "Mon Valley Unemployment Peaks": [
    { migrate: { group: 5, people: -1500, places: MILL_TOWNS } },
    { migrate: { group: 6, people: -1000, places: MILL_TOWNS } },
    { place: "Mon Valley", unrest: 0.1, seasons: 4 },
    { meters: { morale: -6 } },
  ],
  "Mesta Goes Bankrupt": [{ place: "West Homestead", unrest: 0.08, seasons: 4 }, { meters: { morale: -2 } }],
  "American Bridge Leaves Ambridge": [{ mods: [["price", 0.95, PERM]], scope: { industry: "metalworks" } }, { meters: { morale: -2 } }],
  "Braddock Library Saved": [{ landmark: BRADDOCK_LIBRARY, state: "open" }, { place: "Braddock", unrest: -0.03, seasons: 8 }, { meters: { morale: 2 } }],
  "Duquesne Works Closes": [
    { place: "Duquesne", unrest: 0.12, seasons: 4 },
    { migrate: { group: 5, people: -500, places: ["Duquesne"] } },
    { meters: { morale: -5 } },
  ],
  "Workers Buy Weirton": [{ meters: { morale: 2 } }, { rule: "sell_workers", set: { blocked: null } }],
  "Skunk Oil at Christmas": [{ place: "Mon Valley", unrest: 0.08, seasons: 2 }, { meters: { reputation: -8 }, if: "flag:laidOff" }],
  "Pastor Roth Jailed": [{ place: "Clairton", unrest: 0.1, seasons: 2 }],
  "Benzene in the Mon": [
    { mods: [["riverLoad", 3, 1]] },
    { place: "Mon Valley", health: -0.03, seasons: 1 },
    { meters: { reputation: -4 }, if: "tech:byproduct_coke" },
    { flag: "benzene" }, // the slick below Clairton (drawn for a few seasons)
  ],
  "Gulf Leaves Town": [{ place: "Downtown", unrest: 0.05, seasons: 4 }, { meters: { morale: -4 } }],
  "Clergy Protest at Shadyside": [{ place: "Shadyside", unrest: 0.05, seasons: 2 }, { meters: { reputation: -8 }, if: "flag:laidOff" }],
  "Wheeling-Pitt Bankrupt": [{ mods: [["price", 0.95, 4]], scope: { industry: "steel" } }],
  "The Mills Go Quiet": [{ meters: { morale: -4 } }],
  "Barricade at Nativity Lutheran": [{ place: "Mon Valley", unrest: 0.05, seasons: 2 }],
  "Service at the Steel Tower": [{ place: "Downtown", unrest: 0.05, seasons: 2 }],
  "Clairton Goes Broke": [
    { place: "Clairton", unrest: 0.15, health: -0.03, seasons: 4 },
    { migrate: { group: 5, people: -500, places: ["Clairton"] } },
    { meters: { morale: -3 } },
  ],
  "Steel Valley Authority": [{ place: "Mon Valley", unrest: -0.03, seasons: 4 }, { meters: { morale: 2 } }, { rule: "sell_authority", set: { blocked: null } }],
  "Election Day Flood": [{ flood: 0.6 }, { meters: { morale: -3 } }],
};

// ---------------------------------------------------------------- decisions

/** an option whose consequences need code (policy, layoffs, buying a works), plus optional effects */
function custom(label: string, detail: string, fn: (g: GameState, rng: Rng) => string, effects: Effect[] = []): DecisionOption {
  return { label, detail, apply: (g, rng) => { if (effects.length) applyEffects(g, `decision: ${label}`, effects); return fn(g, rng); } };
}

const BIG = "men>=250";

/** lay off a quarter of the men for two years (as the Labour action does), and remember it */
function layOff(g: GameState): string {
  const c = g.company!, n = Math.round(allWorks(c).reduce((s, w) => s + w.employees, 0) * 0.25);
  c.biz.layoffUntil = g.turn + 8; g.jobless += n;
  bump(g, "labour", -15); bump(g, "reputation", -5); g.morale = Math.max(0, g.morale - 6);
  c.biz.flags.laidOff = true;
  return `${n.toLocaleString()} men are laid off.`;
}

/** commission the oxygen furnace at the first steel works without one (the decision doesn't use up an action) */
function startBof(g: GameState): string {
  const c = g.company!, w = allWorks(c).find((x) => x.industry === "steel" && !x.techs.includes("bof") && !x.research);
  if (!w) return "Your engineers are busy with other work; the oxygen plant waits.";
  const r = commission(g, w, "bof", true);
  if (!r.ok) return `The oxygen plant can't be started: ${r.text}.`;
  return r.text;
}

const bribedSince = (g: GameState, y: number) => (g.company?.biz.record ?? []).some((r) => {
  const m = /(\d{4}): Bribe an official/.exec(r);
  return !!m && Number(m[1]) >= y;
});

export const DECISIONS: Record<string, DecisionFn> = {
  "Long Westinghouse Strike": (g) => !when(g, `industry:metalworks ${BIG}`) ? null : decision("westinghouse1955",
    "Westinghouse's customers come knocking",
    "The electrical workers have shut East Pittsburgh, and it may be months. Its customers want motors, turbines and switchgear from somebody. The union calls any shop that fills those orders a scab shop.",
    [
      option("Take the orders", "Metalworks prices +10% for a year; labour −5; the union is sore (strikes ×1.5 for two seasons).",
        [{ mods: [["price", 1.1, 4]], scope: { industry: "metalworks" } }, { mods: [["strike", 1.5, 2]], scope: { industry: "metalworks" } }, { meters: { labour: -5 } }],
        "Your shops run extra shifts on Westinghouse's orders."),
      option("Turn them away", "Labour +4, reputation +2. The strike's windfall goes to others.",
        [{ meters: { labour: 4, reputation: 2 } }], "You tell the buyers to wait for Westinghouse."),
    ], 0),

  "Dorothy Six Lit": (g) => !when(g, "industry:steel tech:open_hearth !tech:bof") ? null : decision("dorothy1963",
    "Dorothy Six and the oxygen furnace",
    "U.S. Steel has lit the biggest blast furnace in the valley, but its steel is still made in open hearths. In Europe and Japan the new basic oxygen furnace does the same work in a fraction of the time.",
    [
      option("Keep the open hearths", "Nothing now. The hearths are paid for; the cost comes later.", [], "The open hearths stay; the new process can wait."),
      custom("Build oxygen furnaces now", "Start the basic oxygen furnace at once at full cost (no action used).", (g) => startBof(g)),
    ], 0),

  "Mesta Unionized": (g) => !when(g, `industry:metalworks ${BIG} !union:recognise`) ? null : decision("mesta1967",
    "Mesta's men vote union; yours are next",
    "The Mesta works at West Homestead, the valley's great holdout, has voted in the Steelworkers. Organisers are at your gates the next morning.",
    [
      custom("Recognise the union", "Union recognised: labour +15, wages at the union scale; the other holdouts grumble (influence −3).",
        (g) => { g.company!.biz.policy.union = "recognise"; bump(g, "labour", 15); bump(g, "influence", -3); return "You sign with the Steelworkers."; }),
      custom("Fight the election", "Union fought: strikes ×2 for a year, labour −10.",
        (g) => { g.company!.biz.policy.union = "fight"; bump(g, "labour", -10); return "Your lawyers contest every ballot."; },
        [{ mods: [["strike", 2, 4]] }]),
    ], 0),

  "LTV Buys Jones & Laughlin": (g) => !when(g, BIG) ? null : decision("ltv1968",
    "A conglomerate makes an offer",
    "Ling-Temco-Vought has bought J&L with borrowed money. Its bankers have a list of other old Pittsburgh firms with cash in the till, and yours is on it.",
    [
      option("Stay independent", "Nothing changes.", [], "You thank Dallas and decline."),
      custom("Sell a controlling stake", "Cash now (half a buyer's price for your works); from now on the new owners take their cut (prices −8%) and labour −5.",
        (g) => {
          const c = g.company!, cash = Math.round(saleQuote(g, c) * 0.5);
          c.cash += cash; bump(g, "labour", -5); g.flags.conglomerate = true;
          return `The conglomerate pays $${cash.toLocaleString()} for control.`;
        },
        [{ mods: [["price", 0.92, PERM]] }]),
    ], 0),

  "Black Monday Shutdowns": (g) => !when(g, BIG) ? null : decision("blackmonday1969",
    "The Black Construction Coalition at your gate",
    "Nate Smith's coalition has shut the public building sites, demanding that the all-white craft unions take Black apprentices. They ask the big employers to open their own skilled trades.",
    [
      custom("Open the skilled trades", "300 Black tradesmen and apprentices hired; the old hands resent it (labour −5); reputation +6.",
        (g) => { g.company!.biz.recruits.push([4, 300]); g.flags.openTrades = true; return "Your machinists' and electricians' shops take Black apprentices."; },
        [{ meters: { labour: -5, reputation: 6 } }]),
      option("Keep them closed", "Reputation −4; pickets at your gate (strikes ×1.3 for two seasons).",
        [{ meters: { reputation: -4 } }, { mods: [["strike", 1.3, 2]] }], "The trades stay as they were."),
    ], 1),

  "Clairton Consent Decree": (g) => !when(g, "tech:byproduct_coke") ? null : decision("decree1972",
    "The county's clean-air decree",
    "Allegheny County wants your coke ovens cleaned up within ten years, as U.S. Steel has just agreed at Clairton. Your lawyers note that signing a decree is one thing and meeting it another.",
    [
      custom("Sign and comply", `Waste abatement at once (cash −$${Math.round(150000 * E(year(g))).toLocaleString()}); reputation +8.`,
        (g) => { g.company!.cash -= Math.round(150000 * E(year(g))); g.company!.biz.policy.waste = "abate"; return "Hoods and scrubbers go onto the coke batteries."; },
        [{ meters: { reputation: 8 } }]),
      option("Sign and stall", "Nothing now (reputation −2). The state may come asking.", [{ meters: { reputation: -2 } }, { flag: "decreeStalled" }],
        "You sign, and the engineers study the problem."),
      option("Fight it in court", `Legal fees (cash −$${Math.round(40000 * E(year(g))).toLocaleString()}); reputation −8, influence −5.`,
        [{ meters: { reputation: -8, influence: -5 } }, { flag: "decreeStalled" }], "Your lawyers take the county to court.", Math.round(40000 * E(year(g)))),
    ], 1),

  "The No-Strike Deal": (g) => !when(g, `industry:steel ${BIG}`) ? null : decision("ena1973",
    "The Experimental Negotiating Agreement",
    "Ten steelmakers and the Steelworkers offer a trade: no national strikes, in exchange for 3% a year, cost-of-living pay and arbitration. Do you sign on with the industry?",
    [
      option("Join the agreement", "Strikes ×0.3 and wages +8% for ten years; labour +5.", [{ meters: { labour: 5 } }], "You sign with the industry."),
      option("Bargain alone", "Keep your own wage scale; strikes ×1.5 for two years, labour −5.",
        [{ clear: "The No-Strike Deal" }, { mods: [["strike", 1.5, 8]], scope: { industry: "steel" } }, { meters: { labour: -5 } }], "You stay out of the deal and bargain with your own local."),
    ], 0),

  "Braddock Library Closes": (g) => !when(g) ? null : decision("braddock1974",
    "Braddock's library needs a roof",
    "Carnegie's first library is closing: the town can't afford to fix the roof. A gift from a company in the valley would keep its doors open.",
    [
      option("Let it close", "Nothing.", [], "The library's doors are chained."),
      option("Pay for the roof", `Cash −$${Math.round(30000 * E(year(g))).toLocaleString()}: the library stays open; reputation +6, morale +3.`,
        [{ landmark: BRADDOCK_LIBRARY, state: "open" }, { meters: { reputation: 6, morale: 3 } }, { flag: "braddockFunded" }],
        "Your gift reroofs the Braddock library.", Math.round(30000 * E(year(g)))),
    ], 0),

  "Gulf Payments Scandal": (g) => !(when(g) && bribedSince(g, 1965)) ? null : decision("gulf1975",
    "The investigators ask about your payments",
    "Gulf's chairman has fallen over illegal political contributions, and the investigators are asking every company in town for its books. Yours show payments to officials.",
    [
      custom("Stonewall", "Deny everything: 40% chance it comes out anyway (a large fine, reputation −15, influence −20).",
        (g, rng) => {
          if (!rng.chance(0.4)) return "The investigators move on.";
          const fine = Math.round(60000 * E(year(g)));
          g.company!.cash -= fine; bump(g, "reputation", -15); bump(g, "influence", -20);
          pushHeadline(g, `${g.company!.name} Paid Officials`, `The investigators find payments from ${g.company!.name}'s accounts to public officials. A $${fine.toLocaleString()} settlement follows.`);
          return "The payments come out.";
        }),
      option("Come clean", `Cash −$${Math.round(20000 * E(year(g))).toLocaleString()}; reputation −8, influence −10. It's over.`,
        [{ meters: { reputation: -8, influence: -10 } }], "You open the books and pay the penalty.", Math.round(20000 * E(year(g)))),
    ], 0),

  "Clairton Air Crisis": (g) => !when(g, "tech:byproduct_coke") ? null : decision("clairton1975",
    "An air emergency over the coke works",
    "A temperature inversion holds the smoke in the valley; the county declares an emergency and the hospitals fill. The health department asks you to bank your coke ovens.",
    [
      option("Run on", `Fine (cash −$${Math.round(100000 * E(year(g))).toLocaleString()}); reputation −12, more if you stalled on the decree.`,
        [{ meters: { reputation: -12 } }, { meters: { reputation: -5 }, if: "flag:decreeStalled" }], "The batteries keep pushing coke.", Math.round(100000 * E(year(g)))),
      option("Bank the ovens for a season", "Steel output halved this season; reputation +6.",
        [{ mods: [["output", 0.5, 1]], scope: { industry: "steel" } }, { meters: { reputation: 6 } }], "The ovens are banked until the air clears."),
    ], 0),

  "Closures Announced": (g) => !when(g, `industry:steel ${BIG} tech:open_hearth !tech:bof`) ? null : decision("closures1979",
    "Your open hearths can't compete",
    "U.S. Steel is closing plants across the country. Your open hearths make steel slower and dearer than the oxygen furnaces of Japan and Germany, and the orders are going there.",
    [
      custom("Close the oldest hearths", "Lay off a quarter of the men for two years: labour −15, morale −6, reputation −5.", (g) => layOff(g)),
      custom("Modernise", "Start the basic oxygen furnace at full cost, if your works can take it.", (g) => startBof(g)),
      option("Run them all", "Keep every man on; labour +5. The losses follow the price.", [{ meters: { labour: 5 } }], "Every hearth stays lit."),
    ], 0),

  "The Bottom Falls Out": (g) => !when(g, BIG) ? null : decision("layoffs1981",
    "No orders",
    "The recession has emptied the order books. The superintendents want to cut a quarter of the men; the union local wants them kept on.",
    [
      custom("Lay them off", "A quarter of the men laid off for two years: labour −15, morale −6, reputation −5.", (g) => layOff(g)),
      option("Carry them", "Pay idle men (wages +10% for two years); labour +10, morale +4, reputation +5.",
        [{ mods: [["wage", 1.1, 8]] }, { meters: { labour: 10, morale: 4, reputation: 5 } }], "You keep every man on the payroll."),
    ], 0),

  "Neville Island Yard Closes": (g) => !when(g, "industry:metalworks") ? null : decision("neville1982",
    "Dravo's yard closes",
    "Dravo is closing its Neville Island shipyard. Its barge and towboat customers will need a new builder, if anyone wants the business in this market.",
    [
      option("Stay out", "Metalworks prices −5% for two years as the market shrinks.", [{ mods: [["price", 0.95, 8]], scope: { industry: "metalworks" } }], "You let the yard's customers go elsewhere."),
      option("Bid for its contracts", `Cash −$${Math.round(80000 * E(year(g))).toLocaleString()}: metalworks prices +10% for two years.`,
        [{ mods: [["price", 1.1, 8]], scope: { industry: "metalworks" } }], "Your salesmen call on Dravo's customers.", Math.round(80000 * E(year(g)))),
    ], 0),

  "Mon Valley Unemployment Peaks": (g) => !when(g) ? null : decision("foodbank1982",
    "Food banks in the union halls",
    "One worker in five in the Mon Valley is out of work. The union locals have opened food banks and are asking the companies for help.",
    [
      option("Leave it to the churches", "Reputation −3.", [{ meters: { reputation: -3 } }], "You send your regrets."),
      option("Fund the food banks", `Cash −$${Math.round(40000 * E(year(g))).toLocaleString()}: morale +5, reputation +6, labour +4.`,
        [{ meters: { morale: 5, reputation: 6, labour: 4 } }, { flag: "relief" }], "Your trucks deliver to the union halls.", Math.round(40000 * E(year(g)))),
    ], 0),

  "Duquesne Works Closes": (g) => {
    const r = g.rivals.find((x) => x.id === "ussduq" && !x.owned);
    if (!when(g) || !r) return null;
    const q = acquisitionQuote(g, r);
    if ("refused" in q) return null;
    const price = Math.round(q.price * 0.5);
    if (g.company!.cash < price) return null;
    return decision("dorothy1984", "Save Dorothy Six?",
      "U.S. Steel is shutting the Duquesne Works. A coalition of the union, the churches and the towns wants a buyer to keep Dorothy Six in blast, and asks whether you will be it.",
      [
        option("Let it go cold", "Nothing.", [], "Dorothy Six is banked for the last time."),
        custom("Buy the Duquesne Works", `Cash −$${price.toLocaleString()}: the works becomes yours; labour +15, morale +6, reputation +8. It may never make money.`,
          (g) => {
            g.company!.cash -= price;
            r.closed = false;
            const w = acquire(g, r);
            bump(g, "labour", 15); bump(g, "reputation", 8); g.morale = Math.min(100, g.morale + 6);
            pushHeadline(g, `${g.company!.name} Saves Dorothy Six`, `The Duquesne Works changes hands instead of closing. The men wait to see if ${w.name} can pay its way.`);
            return `${w.name} is yours.`;
          }),
      ], 0);
  },

  "Pastor Roth Jailed": (g) => !when(g, `industry:steel ${BIG}`) ? null : decision("roth1984",
    "The protesters at your offices",
    "The Denominational Ministry Strategy and jobless steelworkers have been picketing company offices and churches. Your lawyers want an injunction and charges.",
    [
      option("Press charges", "Clairton unrest up; reputation −5, influence +5.",
        [{ place: "Clairton", unrest: 0.1, seasons: 2 }, { meters: { reputation: -5, influence: 5 } }], "The courts issue an injunction."),
      option("Meet them", "Reputation +5, labour +5, influence −3.", [{ meters: { reputation: 5, labour: 5, influence: -3 } }], "You sit down with the pastors and the jobless men."),
    ], 0),
};

// ---------------------------------------------------------------- landmarks and places

export const LANDMARKS: LandmarkDef[] = [
  { id: "gp_airport", name: "Greater Pittsburgh Airport", kind: "airport", place: "Greater Pittsburgh Airport" },
  { id: "shippingport", name: "Shippingport Atomic Power Station", kind: "plant", place: "Shippingport" },
  { id: "alcosan", name: "ALCOSAN Treatment Plant", kind: "plant", place: "Woods Run" },
  { id: "civic_arena", name: "Civic Arena", kind: "arena", place: "Lower Hill" },
  { id: "ccac", name: "Community College of Allegheny County", kind: "college", place: "North Side" },
  { id: "bidwell", name: "Bidwell Training Center", kind: "school", place: "Manchester" },
  { id: "three_rivers", name: "Three Rivers Stadium", kind: "stadium", place: "North Shore" },
  { id: "heinz_hall", name: "Heinz Hall", kind: "theatre", place: "Heinz Hall site" },
  { id: "point_fountain", name: "Point State Park Fountain", kind: "fountain", place: "The Point" },
  { id: "vw_new_stanton", name: "Volkswagen Westmoreland Assembly", kind: "factory", place: "New Stanton" },
  { id: "beaver_valley", name: "Beaver Valley Nuclear Station", kind: "plant", place: "Shippingport" },
  { id: "renaissance2", name: "Renaissance II office towers", kind: "office", place: "Downtown" },
  ...(braddockFound ? [] : [{ id: BRADDOCK_LIBRARY, name: "Carnegie Library of Braddock", kind: "library" as const, place: "Braddock" }]),
];

/** extra named places these events need: [name, lat, lon, radius in metres] (see src/core/places.ts) */
export const PLACES: [string, number, number, number][] = [
  ["Woods Run", 40.4745, -80.0390, 300],
  ["North Shore", 40.4465, -80.0150, 250],
  ["Manchester", 40.4555, -80.0270, 300],
  ["Heinz Hall site", 40.4425, -80.0005, 100],
  ["Nine Mile Run", 40.4290, -79.9110, 500],
];

