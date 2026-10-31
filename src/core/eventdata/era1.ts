// Event effects and decisions, 1850 – 1892. Keyed by Event Name in docs/EVENTS.csv (see src/core/effects.ts for
// the effect types and conditions, docs/EVENTS-ACTIONS.md for what each event should do).

import { bump, type DecisionOption, type Policy } from "../business";
import { applyEffects, type Effect } from "../effects";
import { fundLibrary, type GameState, LIBRARY_COST, log } from "../game";
import type { LandmarkDef } from "../landmarks";
import { decision, hasIndustry, option, when } from "./helpers";
import type { DecisionFn } from "./index";

/** an option that also changes a standing policy (decisions bypass the action budget and the policy gates) */
function policyOption(label: string, detail: string, set: Partial<Policy> | ((p: Policy) => Partial<Policy>), effects: Effect[], text: string, cost = 0): DecisionOption {
  return {
    label, detail,
    apply: (g: GameState) => {
      const c = g.company;
      if (c) {
        if (cost) c.cash -= cost;
        Object.assign(c.biz.policy, typeof set === "function" ? set(c.biz.policy) : set);
      }
      applyEffects(g, `decision: ${label}`, effects);
      return text;
    },
  };
}

const wageStepDown = (p: Policy): Partial<Policy> => ({ wages: p.wages === "high" ? "market" : "low" });

export const EFFECTS: Record<string, Effect[]> = {
  // ---- 1850s
  "Famine Irish and German Forty-Eighters": [
    { migrate: { group: 2, people: 600, places: ["Lawrenceville", "The Point"] } },
    { migrate: { group: 3, people: 600, places: ["Deutschtown", "Troy Hill"] } },
  ],
  "Fugitive Slave Act Panic": [{ migrate: { group: 4, people: -200, places: ["Hill District", "Downtown"] } }],
  "McKeesport's First Mill": [{ landmark: "mckeesport_mill" }],
  "Pennsylvania Railroad Reaches Pittsburgh": [{ mods: [["freightCap", 1.15, 40]], scope: { gateway: "rail" } }],
  "Western Pennsylvania Hospital Opens": [{ landmark: "westpenn" }, { meters: { morale: 2 } }],
  "Cholera Epidemic": [{ epidemic: 0.04 }, { meters: { morale: -5 } }],
  "Laughlin Buys In": [{ rival: "jl", expand: 0.1 }],
  "Western University Rebuilds": [{ landmark: "westernu_downtown" }],
  "Central High School Opens": [{ landmark: "central_high" }],
  "Panic of 1857": [{ mods: [["price", 0.72, 8]] }, { meters: { morale: -4 } }],
  "Sons of Vulcan Founded": [
    { mods: [["wage", 1.05, 40]], scope: { industry: "steel" } },
    { rule: "union", set: { blocked: null } },
    { rule: "lockout", set: { blocked: null } },
  ],
  "Oil Struck at Titusville": [
    { mods: [["price", 1.05, 20]], scope: { industry: ["glass", "metalworks"] } },
    { landmark: "refineries" },
  ],
  "Lincoln Passes Through": [
    { meters: { labour: 3, morale: 2 } },
    { meters: { influence: 4 }, if: "flag:party=republican" },
  ],
  "Citizens Stop the Cannon": [{ meters: { morale: 3 } }],
  // ---- the Civil War
  "Civil War Begins": [
    { mods: [["price", 1.35, 16], ["labour", 0.88, 16], ["migrants", 0.6, 16]] },
    { mods: [["price", 1.08, 16]], if: "flag:warContract" },
    { meters: { influence: 5 }, if: "flag:party=republican" },
  ],
  "Jones & Laughlin Named": [{ rival: "jl", expand: 0.1 }],
  "Dixmont Asylum; West Penn Goes to War": [{ landmark: "westpenn", state: "closed" }],
  "Allegheny Arsenal Explosion": [
    { blast: { place: "Allegheny Arsenal", radiusM: 150, ruinSeasons: 8 } },
    { meters: { morale: -6 } },
  ],
  "Defences Thrown Up on the Hills": [{ mods: [["output", 0.6, 1]] }],
  "Iron Wages Tied to Iron Prices": [
    { mods: [["wage", 1.04, 60]], scope: { industry: "steel" } },
    { rule: "scale", set: { blocked: null } },
  ],
  "The War Ends": [
    { clear: "Civil War Begins" },
    { clear: "decision: Bid for army contracts" },
    { landmark: "westpenn", state: "open" },
    { meters: { morale: 6 } },
  ],
  "Coal and Iron Police Authorized": [{ rule: "police", set: { blocked: null } }],
  "Observatory Given to the University": [{ landmark: "observatory" }],
  // ---- 1867–1879
  "Vulcan Locals Collapse": [{ mods: [["wage", 0.97, 16], ["strike", 0.85, 8]], scope: { industry: "steel" } }],
  "Hell with the Lid Off": [
    { meters: { reputation: -5 }, if: "policy:waste=dump" },
    { meters: { reputation: -2 }, if: "industry:steel" },
  ],
  "Westinghouse Air Brake Company": [{ landmark: "wab_allegheny" }],
  "Heinz Bottles Horseradish": [{ mods: [["price", 1.05, 8]], scope: { industry: "glass" } }],
  "Pennsylvania Female College Founded": [{ landmark: "female_college" }],
  "Saturday Half-Holiday": [{ rule: "halfHoliday", set: { blocked: null } }],
  "Frick Coke Company": [{ mods: [["input", 0.92, 80]], scope: { industry: "steel", good: "coal" } }],
  "Panic of 1873": [{ mods: [["price", 0.7, 16], ["wage", 0.85, 16]] }, { meters: { morale: -6 } }],
  "First Rail at Edgar Thomson": [{ rival: "carnegie", expand: 0.1 }],
  "Amalgamated Association Founded": [{ mods: [["wage", 1.05, 60], ["strike", 1.2, 60]], scope: { industry: ["steel", "metalworks"] } }],
  "Great Railroad Strike": [
    { mods: [["strike", 4, 2]] },
    { mods: [["freightCap", 0.1, 1]], scope: { gateway: "rail" } },
    { blast: { place: "Strip District", radiusM: 120, ruinSeasons: 4 } },
    { meters: { morale: -6 } },
  ],
  "Pittsburgh Catholic College Founded": [{ landmark: "catholic_college" }],
  "Pittsburgh & Lake Erie Completed": [{ mods: [["input", 0.95, 24]] }],
  // ---- 1880s
  "City's First Electric Company": [{ mods: [["price", 1.08, 16]], scope: { industry: "power" } }],
  "The Magee–Flinn Ring": [{ politics: "machine" }, { rule: "bribe", set: { risk: 0.12 } }],
  "Air Brake Moves to Allegheny": [{ landmark: "wab_allegheny", state: "closed" }, { landmark: "wab_north_side" }],
  "Union Switch & Signal": [{ landmark: "union_switch" }],
  "Frick Meets Carnegie": [{ rival: "carnegie", expand: 0.15 }],
  "Courthouse Fire Moves the University": [
    { landmark: "westernu_downtown", state: "closed" },
    { landmark: "westernu_allegheny" },
    { note: "The courthouse is gutted by fire; Western University moves to Allegheny." },
  ],
  "St. Anthony's Chapel": [{ landmark: "st_anthony" }],
  "The Pittsburgh Proclamation": [{ mods: [["strike", 1.15, 8]] }],
  "February Flood": [{ flood: 0.6 }],
  "Natural Gas Boom": [
    { mods: [["pollution", 0.6, 24]] },
    { mods: [["input", 0.9, 24]], scope: { industry: ["glass", "steel"], good: "coal" } },
  ],
  "Westinghouse Electric Founded": [{ landmark: "westinghouse_garrison" }],
  "Open Hearths at Homestead": [{ rival: "frick", expand: 0.1 }],
  "Jones & Laughlin Makes Steel": [{ rival: "jl", expand: 0.15 }],
  "Allegheny General Hospital": [{ landmark: "allegheny_general" }, { meters: { morale: 2 } }],
  "New City Charter": [{ meters: { influence: 4 }, if: "flag:ring" }, { rule: "bribe", set: { risk: 0.16 } }],
  "Pittsburgh Reduction Company": [{ landmark: "reduction_smallman" }],
  "H.J. Heinz Company": [{ mods: [["price", 1.06, 12]], scope: { industry: "glass" } }],
  "Johnstown Flood": [{ meters: { morale: -5 } }],
  "Braddock Carnegie Library Dedicated": [{ landmark: "braddock_library" }, { meters: { morale: 2 } }],
  "Carnegie Library of Allegheny": [{ landmark: "allegheny_library" }, { meters: { morale: 2 } }],
  // ---- 1890–1892
  "McKinley Tariff": [{ mods: [["price", 1.1, 16]], scope: { industry: ["steel", "glass"] } }],
  "Morewood Massacre": [
    { mods: [["strike", 2, 1]] },
    { mods: [["input", 1.15, 1]], scope: { industry: "steel", good: "coal" } },
    { meters: { morale: -4 } },
  ],
  "Aluminum Moves to New Kensington": [{ landmark: "reduction_smallman", state: "closed" }, { landmark: "alcoa_new_kensington" }],
  "\"57 Varieties\"": [{ mods: [["price", 1.05, 8]], scope: { industry: "glass" } }],
  "Battle of Homestead": [{ mods: [["strike", 3, 4]] }, { meters: { morale: -8 } }],
  "Attempt on Frick": [{ mods: [["strike", 0.8, 2]] }],
  "Homestead Strike Called Off": [{ mods: [["wage", 0.92, 60], ["strike", 0.7, 60]], scope: { industry: ["steel", "metalworks"] } }],
};

export const DECISIONS: Record<string, DecisionFn> = {
  "Fugitive Slave Act Panic": (g) => !when(g) ? null : decision("fugitive1850", "Slave catchers in the city",
    "Under the new Fugitive Slave Act, federal marshals can seize anyone accused of escaping slavery, and anyone who helps them faces fines and jail. Black families are fleeing to Canada; the Underground Railroad asks men of means for wagons, money and a cellar.",
    [
      {
        label: "Shelter fugitives", detail: "Reputation +6 with the abolitionists, influence −5 with the Democrats in office; a one-in-five chance of a $2,000 fine.",
        apply: (g, rng) => {
          bump(g, "reputation", 6); bump(g, "influence", -5); g.flags.sheltered = true;
          if (rng.chance(0.2) && g.company) { g.company.cash -= 2000; log(g, "A marshal finds the hidden room: fined $2,000."); return "Your wagons carry families north; one hiding place is found and you are fined."; }
          return "Your wagons carry families north by night.";
        },
      },
      option("Stay out of it", "Nothing changes.", [], "You keep your head down."),
    ], 1),

  "Cholera Epidemic": (g) => !when(g, "men>=100") ? null : decision("cholera1854", "Cholera in the river wards",
    "Cholera is killing hundreds in the riverfront wards; the dead are carted out at night. Your men drink from the same river. A pest house and a clean-water cistern for the works would cost $3,000.",
    [
      option("Fund a pest house and clean water", "$3,000. Labour +6, reputation +4, morale +2.", [{ meters: { labour: 6, reputation: 4, morale: 2 } }], "Your pest house takes in the sick; the works' cistern is kept clean.", 3000),
      option("Do nothing", "The men notice (labour −3).", [{ meters: { labour: -3 } }], "The works keeps running; the burials go on."),
    ], 1),

  "Republicans Organize at Lafayette Hall": (g) => !when(g) ? null : decision("party1856", "A new party at Lafayette Hall",
    "Free-soilers, Whigs and Know-Nothings meet at Lafayette Hall to found a national Republican party: no slavery in the territories, and a protective tariff for iron. The Democrats run the state and the customs house.",
    [
      option("Back the Republicans", "Influence +3 now and more when they take power (1860–61); tariff lobbying costs a quarter less.", [{ flag: "party", value: "republican" }, { meters: { influence: 3 } }, { rule: "tariff", set: { cost: 0.75 } }], "You put money behind the new party of free soil and the tariff."),
      option("Back the Democrats", "Influence +6 now; the party of the immigrant wards helps your recruiting agents (cost −25%).", [{ flag: "party", value: "democrat" }, { meters: { influence: 6 } }, { rule: "recruit", set: { cost: 0.75 } }], "You stay with the party in power."),
      option("Stay out of politics", "Nothing changes.", [], "You leave politics to the politicians."),
    ], 0),

  "Panic of 1857": (g) => !when(g, "men>=50") ? null : decision("panic1857", "The Panic of 1857",
    "The Ohio Life Insurance and Trust Company has failed; banks suspend payment and iron is selling below cost. Owners up and down the rivers are banking their furnaces.",
    [
      option("Bank the furnaces", "Output halved and the payroll cut a fifth for a year. Labour −10.", [{ mods: [["output", 0.5, 4], ["wage", 0.8, 4]] }, { meters: { labour: -10 } }], "The fires are banked; the men are sent home until spring."),
      option("Run at a loss", "Keep everyone on and sell at panic prices. Labour +5, reputation +2.", [{ meters: { labour: 5, reputation: 2 } }], "You keep the fires lit and the men paid, and lose money every week."),
    ], 0),

  "Sons of Vulcan Founded": (g) => !(hasIndustry(g, "steel") && when(g, "men>=100")) ? null : decision("vulcans1858", "The puddlers organise",
    "Your puddlers have joined the new Sons of Vulcan and ask you to deal with their lodge on the price per ton of boiled iron.",
    [
      policyOption("Recognise the puddlers", "Union recognised: labour +10, wages a little higher, strikes half as likely.", { union: "recognise" }, [{ meters: { labour: 10, influence: -3 } }], "You sit down with the Vulcans' lodge."),
      policyOption("Blacklist the lodge men", "Strikes rarer for two years; labour −10.", { union: "fight" }, [{ meters: { labour: -10, reputation: -2 } }], "The lodge men are let go and their names passed to the other mills."),
      option("Ignore them", "Nothing changes for now.", [], "You neither meet the lodge nor fire its members."),
    ], 1),

  "Citizens Stop the Cannon": (g) => !when(g) ? null : decision("cannon1860", "Cannon for the South",
    "The Secretary of War has ordered heavy guns from the Allegheny Arsenal shipped south, where the forts will soon be seized. A mass meeting at the courthouse resolves to stop them on the wharf.",
    [
      option("Join the meeting", "Reputation +5, influence +4; the War Department remembers its friends (war contracts pay more).", [{ meters: { reputation: 5, influence: 4 } }, { flag: "warContract" }], "You speak at the courthouse; the guns stay in Pittsburgh."),
      option("Stay away", "Nothing changes.", [], "You stay at the works."),
    ], 0),

  "Civil War Begins": (g) => !hasIndustry(g, "steel", "metalworks") ? null : decision("war1861", "Contracts for the Union",
    "Fort Sumter has fallen. The army needs cannon, armour plate, rails and wagon iron, and the quartermasters are buying from anyone who can deliver. Half the young men are enlisting.",
    [
      option("Bid for army contracts", "Run flat out (output +10%) on war orders for four years. Labour −4 from the long shifts.", [{ mods: [["output", 1.1, 16]] }, { meters: { labour: -4, influence: 4 } }, { flag: "warContract" }], "Your works runs day and night on government orders."),
      option("Sell on the open market", "Nothing changes; you take the wartime prices like everyone else.", [], "You leave the contracts to others."),
    ], 0),

  "Allegheny Arsenal Explosion": (g) => !when(g, "men>=100") ? null : decision("arsenal1862", "After the Arsenal",
    "Seventy-eight people, most of them young women filling cartridges, are dead in the explosion at the Arsenal. The papers ask what other works in the city are waiting to blow.",
    [
      policyOption("Hire safety men", "Basic safety from now on (a small cost per man); reputation +3, labour +3.", { safety: "basic" }, [{ meters: { reputation: 3, labour: 3 } }], "You hire a foreman to walk the works for hazards."),
      option("Give to the victims' fund", "$1,000. Reputation +4, morale +1.", [{ meters: { reputation: 4, morale: 1 } }], "You give to the relief of the Arsenal families.", 1000),
      option("Carry on", "Nothing changes.", [], "Accidents happen."),
    ], 2),

  "The War Ends": (g) => !hasIndustry(g, "steel") ? null : decision("peace1865", "After the war",
    "Lee has surrendered and the army orders stop. But the railroads are rebuilding the South and pushing west, and they want rails by the hundred thousand tons.",
    [
      option("Retool for rails", "$20,000. Prices +10% for eight years while the railroads build.", [{ mods: [["price", 1.1, 32]], scope: { industry: "steel" } }], "Your mill is refitted to roll rails.", 20000),
      option("Carry on as before", "Nothing changes.", [], "You go back to bar iron and nails."),
    ], 0),

  "Westinghouse Patents the Air Brake": (g) => !hasIndustry(g, "metalworks") ? null : decision("airbrake1869", "The air brake",
    "A young inventor, George Westinghouse, has patented a brake worked by compressed air, and the Pennsylvania Railroad is trying it. He is looking for shops to build parts under licence.",
    [
      option("License air-brake work", "$10,000. Metalworks prices +8% for ten years.", [{ mods: [["price", 1.08, 40]], scope: { industry: "metalworks" } }], "Your shop builds valves and cylinders for the air brake.", 10000),
      option("Decline", "Nothing changes.", [], "You think it a toy."),
    ], 1),

  "Panic of 1873": (g) => !when(g, "men>=100") ? null : decision("panic1873", "The Panic of 1873",
    "Jay Cooke & Company has failed and the railroads have stopped buying. Prices are falling and every owner on the rivers is cutting wages.",
    [
      policyOption("Cut wages", "Wages down a step. Labour −10; strikes twice as likely for a year.", wageStepDown, [{ mods: [["strike", 2, 4]] }, { meters: { labour: -10 } }], "You post a wage cut at the gate."),
      option("Hold wages", "Labour +10, reputation +3; your payroll costs what it did.", [{ meters: { labour: 10, reputation: 3 } }], "You keep wages where they were."),
    ], 0),

  "Amalgamated Association Founded": (g) => !(hasIndustry(g, "steel", "metalworks") && when(g, "men>=100")) ? null : decision("amalgamated1876", "The Amalgamated's scale",
    "The puddlers, heaters and rollers have merged into the Amalgamated Association of Iron and Steel Workers. Each summer it presents a wage scale; most mills sign it.",
    [
      policyOption("Sign the scale", "Union recognised: labour +10, union wages, strikes rarer.", { union: "recognise" }, [{ meters: { labour: 10, influence: -3 } }], "You sign the Amalgamated scale."),
      policyOption("Refuse", "Union fought: strikes more likely for a year; labour −10.", { union: "fight" }, [{ mods: [["strike", 1.5, 4]] }, { meters: { labour: -10 } }], "You refuse the scale."),
    ], 0),

  "Great Railroad Strike": (g) => !when(g, "men>=100") ? null : decision("railstrike1877", "The railroads burn",
    "The Pennsylvania's trainmen have struck against a wage cut; the Philadelphia militia fired on the crowd at 28th Street, and the roundhouse and hundreds of cars are burning. Nothing moves by rail. Your men are in the crowd.",
    [
      option("Call for the troops", "Influence +3 with the railroad men; labour −8, reputation −3.", [{ meters: { influence: 3, labour: -8, reputation: -3 } }], "You wire Harrisburg for more troops."),
      option("Feed the strikers' families", "$1,500. Labour +8, reputation +3, influence −4.", [{ meters: { labour: 8, reputation: 3, influence: -4 } }], "Your wagons bring bread to the strikers' families.", 1500),
      option("Wait it out", "Nothing changes.", [], "You keep your gates shut and wait."),
    ], 0),

  "The Magee–Flinn Ring": (g) => !when(g) ? null : decision("ring1880", "The Magee–Flinn ring",
    "Christopher Magee runs City Hall and William Flinn's firm gets the paving contracts. Nothing is built, permitted or overlooked without the ring. A contribution is suggested.",
    [
      option("Pay the ring", "$5,000. Influence +10; bribes yield half again as much.", [{ flag: "ring" }, { meters: { influence: 10 } }, { rule: "bribe", set: { yield: 1.5 } }], "Your contribution is gratefully received.", 5000),
      option("Stay clean", "Reputation +3, influence −5.", [{ meters: { reputation: 3, influence: -5 } }], "You send the ring's man away empty-handed."),
    ], 0),

  "Frick Meets Carnegie": (g) => !hasIndustry(g, "steel") ? null : decision("frickcoke1881", "Frick's coke",
    "Henry Clay Frick controls the best coking coal in Connellsville and has just made Carnegie his partner. He offers you a long contract at a fixed price — on his terms.",
    [
      option("Sign Frick's contract", "Coal and coke 12% cheaper for ten years; Frick expects a firm hand with the men (labour −3).", [{ mods: [["input", 0.88, 40]], scope: { industry: "steel", good: "coal" } }, { flag: "frickContract" }, { meters: { labour: -3 } }], "You sign for Frick coke."),
      option("Buy on the open market", "Nothing changes.", [], "You keep buying coke where it is cheapest."),
    ], 1),

  "Johnstown Flood": (g) => !when(g) ? null : decision("johnstown1889", "Johnstown is gone",
    "The South Fork dam — the dam of the Pittsburgh millionaires' fishing club — has broken. More than 2,200 are dead in Johnstown. Relief trains are leaving from Union Station.",
    [
      option("Send relief", "$5,000. Reputation +6, labour +3, morale +2.", [{ meters: { reputation: 6, labour: 3, morale: 2 } }], "Your relief train leaves for the Conemaugh.", 5000),
      option("Send nothing", "Reputation −2.", [{ meters: { reputation: -2 } }], "You leave relief to others."),
    ], 0),

  "Braddock Carnegie Library Dedicated": (g) => !g.company || g.company.library ? null : decision("library1889", "A library for your town?",
    "Carnegie has dedicated the first of his libraries at Braddock, for his workers. Ministers and editors ask whether other owners will follow.",
    [
      {
        label: "Build a library", detail: `$${LIBRARY_COST.toLocaleString()}. Reputation rises for good; the men think better of you.`,
        apply: (g) => { const r = fundLibrary(g); if (!r.ok) return `No library: ${r.reason}.`; bump(g, "labour", 4); return "You endow a free library beside the works."; },
      },
      option("Not now", "Nothing changes.", [], "You leave libraries to Carnegie."),
    ], 1),
};

export const LANDMARKS: LandmarkDef[] = [
  { id: "mckeesport_mill", name: "McKeesport rolling mill", kind: "factory", place: "McKeesport" },
  { id: "westpenn", name: "Western Pennsylvania Hospital", kind: "hospital", place: "Bloomfield", hospital: true },
  { id: "westernu_downtown", name: "Western University (Downtown)", kind: "college", place: "Downtown" },
  { id: "central_high", name: "Central High School", kind: "school", place: "Downtown" },
  { id: "refineries", name: "Allegheny oil refineries", kind: "factory", place: "Lawrenceville" },
  { id: "observatory", name: "Allegheny Observatory", kind: "observatory", place: "Allegheny Observatory" },
  { id: "wab_allegheny", name: "Westinghouse Air Brake (Liberty Avenue)", kind: "factory", place: "Strip District" },
  { id: "female_college", name: "Pennsylvania Female College", kind: "college", place: "Shadyside" },
  { id: "catholic_college", name: "Pittsburgh Catholic College", kind: "college", place: "The Bluff" },
  { id: "wab_north_side", name: "Westinghouse Air Brake (Allegheny City)", kind: "factory", place: "Allegheny City" },
  { id: "union_switch", name: "Union Switch & Signal", kind: "factory", place: "Swissvale" },
  { id: "westernu_allegheny", name: "Western University (Allegheny)", kind: "college", place: "Allegheny Observatory" },
  { id: "st_anthony", name: "St. Anthony's Chapel", kind: "chapel", place: "Troy Hill" },
  { id: "westinghouse_garrison", name: "Westinghouse Electric (Garrison Alley)", kind: "factory", place: "Strip District" },
  { id: "allegheny_general", name: "Allegheny General Hospital", kind: "hospital", place: "North Side", hospital: true },
  { id: "reduction_smallman", name: "Pittsburgh Reduction Co. (Smallman Street)", kind: "factory", place: "Strip District" },
  { id: "alcoa_new_kensington", name: "Pittsburgh Reduction Co. (New Kensington)", kind: "factory", place: "New Kensington" },
  { id: "braddock_library", name: "Carnegie Library of Braddock", kind: "library", place: "Braddock" },
  { id: "allegheny_library", name: "Carnegie Library of Allegheny", kind: "library", place: "Allegheny Commons" },
];

/** extra named places these events need: [name, lat, lon, radius in metres] (see src/core/places.ts) */
export const PLACES: [string, number, number, number][] = [
  ["The Bluff", 40.4365, -79.9905, 300],
  ["Allegheny Commons", 40.4530, -80.0060, 300],
];
