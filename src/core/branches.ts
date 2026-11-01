// Branch cards: decisions that read the family ledger. Every decision the family takes leaves a mark (the table
// below), later cards say why they come out as they do ("Because your grandfather sent the Pinkertons…"), and
// some cards exist only because of what was done before — or play out differently for it.

import { bump, type Decision, type DecisionOption, newestGroup, pushHeadline } from "./business";
import { allWorks, cal, type GameState, log } from "./game";
import { anyMark, because, hasMark, mark, type MarkSpec, standing } from "./ledger";
import { unionFor } from "./labour";
import { ownersOf } from "./owners";
import { earnFavour, polOf } from "./politics";
import { priceLevel } from "./time";
import { head } from "./family";

type M = Omit<MarkSpec, "id"> & { id?: string };
const L = (weight: number, text: string, extra: Partial<M> = {}): M => ({ side: "labour", kind: weight >= 0 ? "trust" : "grievance", weight: Math.abs(weight), text, ...extra });
const P = (weight: number, text: string, extra: Partial<M> = {}): M => ({ side: "public", kind: weight >= 0 ? "trust" : "grievance", weight: Math.abs(weight), text, ...extra });
const POL = (weight: number, text: string, extra: Partial<M> = {}): M => ({ side: "politics", kind: "favour", weight, text, ...extra });
const PRE = (id: string, side: M["side"], text: string): M => ({ id, side, kind: "precedent", weight: 20, text });

/** decision id → option label → the mark it leaves (an option may leave two) */
export const DECISION_MARKS: Record<string, Record<string, M | M[]>> = {
  fugitive1850: { "Shelter fugitives": [PRE("fugitives", "public", "hid fugitives from the slave catchers"), P(10, "hid fugitives from the slave catchers")] },
  cholera1854: { "Fund a pest house and clean water": [L(6, "built the men a pest house in the cholera year"), P(4, "fought the cholera")], "Do nothing": L(-4, "let the cholera take the river wards") },
  party1856: { "Back the Republicans": PRE("republican", "politics", "backed the Republicans from the start"), "Back the Democrats": PRE("democrat", "politics", "backed the Democrats") },
  panic1857: { "Bank the furnaces": L(-5, "banked the furnaces in the panic of 1857"), "Run at a loss": L(6, "kept the men working through the panic of 1857") },
  vulcans1858: { "Recognise the puddlers": [PRE("vulcans", "labour", "recognised the puddlers' union"), L(10, "recognised the Sons of Vulcan")], "Blacklist the lodge men": L(-10, "blacklisted the Vulcan lodge men") },
  cannon1860: { "Join the meeting": P(4, "stood with the citizens against the cannon") },
  war1861: { "Bid for army contracts": POL(6, "made guns and plate for the Union") },
  arsenal1862: { "Hire safety men": L(5, "hired safety men after the arsenal blew up"), "Give to the victims' fund": P(5, "gave to the arsenal victims") },
  panic1873: { "Cut wages": L(-8, "cut wages in the panic of 1873"), "Hold wages": L(8, "held wages through the panic of 1873") },
  amalgamated1876: { "Sign the scale": L(8, "signed the Amalgamated scale"), Refuse: L(-6, "refused the Amalgamated scale") },
  railstrike1877: { "Call for the troops": [L(-15, "called for the troops in 1877"), PRE("troops1877", "labour", "called the troops against the railroad strikers")], "Feed the strikers' families": [L(12, "fed the strikers' families in 1877"), PRE("fed1877", "labour", "fed the strikers' families in 1877")] },
  ring1880: { "Pay the ring": [PRE("ring", "politics", "paid the Magee–Flinn ring"), POL(12, "paid the Magee–Flinn ring", { who: "Christopher Magee" })], "Stay clean": P(4, "would not pay the ring") },
  johnstown1889: { "Send relief": P(6, "sent relief to Johnstown"), "Send nothing": P(-4, "sent nothing to Johnstown") },
  library1889: { "Build a library": P(8, "built the men a library") },
  homestead1892: {
    "Renew the contract": [PRE("homestead_renewed", "labour", "renewed with the Amalgamated in the Homestead summer"), L(20, "renewed with the union while Frick fought it")],
    "Lock out, bring the Pinkertons": [PRE("homestead_pinkertons", "labour", "sent the Pinkertons in the Homestead summer"), L(-30, "sent the Pinkertons in 1892", { martyrs: 4 })],
    "Lock out and wait them out": [PRE("homestead_lockout", "labour", "locked the union out in 1892"), L(-18, "locked the union out in 1892")],
  },
  symphony1895: { "Subscribe as a guarantor": P(4, "guaranteed the Symphony") },
  jl1897: { "Follow J&L: go non-union": L(-10, "followed J&L and broke with the union"), "Stay with the Amalgamated": L(10, "stayed with the Amalgamated when J&L would not") },
  ussteel1901: { "Join Judge Gary's dinners": { side: "owners", kind: "favour", weight: 15, text: "dined with Judge Gary and kept his prices" }, "Stay independent": PRE("independent1901", "owners", "stayed out of Morgan's trust") },
  survey1908: { "Keep the twelve-hour day, say nothing": [L(-8, "kept the twelve-hour day"), P(-6, "hid the accident books from the Survey")], "Go to the ten-hour day": [L(12, "gave the men the ten-hour day"), P(8, "opened the books to the Survey")] },
  graft1910: { "Hire the best lawyers": P(-8, "hid behind lawyers in the graft trials"), "Confess and pay restitution": P(6, "confessed in the graft scandal") },
  motherjones1919: { "Ban the meetings": L(-10, "banned Mother Jones's meetings"), "Let her speak": L(8, "let Mother Jones speak") },
  strike1919: {
    "Recognise the union, eight-hour day": [PRE("recognised1919", "labour", "broke ranks with Big Steel and signed in 1919"), L(25, "signed with the steelworkers in 1919")],
    "Hold firm with the state police": [PRE("crushed1919", "labour", "broke the Great Steel Strike with the state police"), L(-22, "broke the Great Steel Strike")],
    "Concede the eight-hour day only": L(8, "gave the eight-hour day in 1919"),
  },
  cathedral1926: { "Donate the steel": P(5, "gave the steel for the Cathedral of Learning") },
  relief1931: { "Give relief": [P(10, "fed the jobless in 1931"), L(6, "fed the jobless in 1931")], "Leave it to the charities": P(-5, "left the jobless to the charities in 1931") },
  cox1932: { "Donate to the march": P(4, "gave to Father Cox's marchers") },
  organizing1933: { "Set up a company union": L(-6, "set up a company union"), "Let them organise": L(10, "let the CIO organise"), "Fire the card-signers": [L(-15, "fired the men who signed union cards"), PRE("firedCards", "labour", "fired the men who signed union cards")] },
  swoc1937: { "Sign with SWOC": [PRE("swocSigned", "labour", "signed with SWOC without a strike"), L(18, "signed with SWOC")], "Resist like Little Steel": [PRE("littleSteel", "labour", "resisted SWOC like Little Steel"), L(-18, "resisted SWOC")] },
  conference1943: { "Join the Conference": [PRE("conference", "politics", "joined the Allegheny Conference"), POL(15, "joined the Allegheny Conference", { who: "David L. Lawrence" })], "Stay out": PRE("noConference", "politics", "stayed out of the Allegheny Conference") },
  westinghouse1955: { "Take the orders": L(-6, "took the struck Westinghouse orders") },
  strike1959: { "Settle early": L(10, "settled early in 1959"), "Hold out with the industry": L(-6, "held out 116 days in 1959") },
  decree1972: { "Fight it in court": P(-10, "fought the clean-air decree in court") },
  ena1973: { "Join the agreement": L(6, "signed the no-strike deal") },
  braddock1974: { "Pay for the roof": P(8, "saved the Braddock library"), "Let it close": P(-4, "let the Braddock library close") },
  gulf1975: { "Come clean": P(6, "came clean about the payments") },
  layoffs1981: { "Carry them": L(12, "carried the men through 1981") },
  foodbank1982: { "Fund the food banks": [P(8, "funded the food banks"), L(6, "funded the food banks")], "Leave it to the churches": L(-4, "left the jobless to the churches") },
  roth1984: { "Press charges": [L(-10, "had the protesting pastors jailed"), P(-6, "had the protesting pastors jailed")], "Meet them": L(6, "met the unemployed committee") },
};

/** leave the marks a decision's chosen option carries */
export function decisionMarks(g: GameState, id: string, label: string) {
  const t = DECISION_MARKS[id]?.[label];
  if (!t) return;
  for (const [k, m] of (Array.isArray(t) ? t : [t]).entries()) mark(g, { id: m.id ?? `${id}_${k}`, ...m } as MarkSpec);
}

/** the earlier choices each card mentions ("because…"), and how they change it */
const BECAUSE: Record<string, { ids: string[]; adjust?: (g: GameState, d: Decision) => void }> = {
  strike1919: { ids: ["homestead_pinkertons", "homestead_lockout", "homestead_renewed", "troops1877", "fed1877"],
    adjust: (g, d) => {
      const u = unionFor(g, "steel") ?? unionFor(g, "metalworks");
      if (hasMark(g, "homestead_pinkertons") && u) { u.militancy = Math.min(100, u.militancy + 20); d.text += " Mother Jones speaks at your gate: the men will not arbitrate."; }
      if (hasMark(g, "homestead_renewed")) { d.text += " Your own men stay in for now; the other owners ask you to broker a settlement."; d.historical = 2; }
    } },
  swoc1937: { ids: ["crushed1919", "crushed", "homestead_pinkertons", "recognised1919", "firedCards"],
    adjust: (g, d) => { if (anyMark(g, "crushed1919", "crushed", "homestead_pinkertons")) { const u = unionFor(g, "steel"); if (u) u.militancy = Math.min(100, u.militancy + 25); d.text += " SWOC came to your works first: the sons remember."; } } },
  motherjones1919: { ids: ["homestead_pinkertons", "martyrs1892"] },
  graft1910: { ids: ["ring", "bribed"] },
  conference1943: { ids: ["ring", "republican", "democrat"] },
  strike1959: { ids: ["swocSigned", "littleSteel", "recognised1919"] },
  closures1979: { ids: ["swocSigned", "crushed", "layoffs1981_0"] },
  roth1984: { ids: ["crushed", "relief1931_0", "foodbank1982_0"] },
  layoffs1981: { ids: ["swocSigned", "crushed"] },
  amalgamated1876: { ids: ["vulcans1858_0", "vulcans1858_1"] },
  jl1897: { ids: ["homestead_renewed", "homestead_pinkertons"] },
  ussteel1901: { ids: ["jl1897_0", "homestead_pinkertons"] },
};

/** add the "because" line and the ledger's adjustments to a card as it's raised */
export function readLedger(g: GameState, d: Decision) {
  const b = BECAUSE[d.id];
  if (!b) return;
  const line = because(g, ...b.ids);
  if (line) d.text += ` ${line}`;
  b.adjust?.(g, d);
}

// ---------------------------------------------------------------- cards that exist because of the ledger

const year = (g: GameState) => cal(g).year;
const era = (g: GameState) => priceLevel(year(g));
const opt = (label: string, detail: string, apply: (g: GameState) => string): DecisionOption => ({ label, detail, apply: (g) => apply(g) });

export const BRANCH_CARDS: Record<string, (g: GameState) => Decision | null> = {
  "The Great Migration Begins": (g) => {
    if (!g.company) return null;
    const sheltered = !!hasMark(g, "fugitives");
    return {
      id: "migration1916", historical: 1, title: "Men from the South",
      text: `Black families are coming north from Alabama and Virginia for the war work. ${sheltered ? `The churches of the Hill send their men to your works first. ${because(g, "fugitives")}` : "Labour agents meet the trains; the other owners hire them to break strikes."}`,
      options: [
        opt("Hire them at the going wage", `Three hundred families settle near the works; labour supply up.${sheltered ? " The churches and the Courier remember it." : ""}`, (g) => {
          g.company!.biz.recruits.push([4, sheltered ? 500 : 300]);
          mark(g, { id: "hiredMigration", side: "public", kind: "trust", weight: sheltered ? 10 : 5, text: "hired the newcomers from the South at a fair wage" });
          return "The newcomers go to work beside your men.";
        }),
        opt("Hire them to break the next strike", "Cheaper men and a lever against the union. The men won't forgive it; the Courier will remember.", (g) => {
          g.company!.biz.recruits.push([4, 300]); bump(g, "labour", -6);
          mark(g, { id: "migrationScabs", side: "labour", kind: "grievance", weight: 10, text: "set the newcomers from the South against the union" });
          return "The agents promise the new men the jobs of any man who strikes.";
        }),
        opt("Don't hire", "Nothing changes.", () => "Your hiring office stays as it was."),
      ],
    };
  },
  "Double V": (g) => {
    if (!g.company || year(g) < 1941) return null;
    const friend = anyMark(g, "fugitives", "hiredMigration");
    return {
      id: "doublev1941", historical: 1, title: "Victory at home and abroad",
      text: `The Pittsburgh Courier's Double V campaign asks the war plants to open their skilled jobs to Black workers. ${friend ? `The Courier names your works as one that might. ${because(g, "hiredMigration", "fugitives")}` : ""}`,
      options: [
        opt("Open the skilled lines", "Reputation +6; the Courier backs you. Some white men walk off for a week (output −10% for a season).", (g) => {
          bump(g, "reputation", 6);
          g.mods.push({ kind: "output", mult: 0.9, until: g.turn + 1, source: "A hate strike", industry: allWorks(g.company!).map((w) => w.industry) });
          mark(g, { id: "doubleV", side: "public", kind: "trust", weight: 12, text: "opened the skilled jobs to Black workers in the war" });
          return "The first Black crane men and rollers go up the ladder.";
        }),
        opt("Keep the lines as they are", friend ? "The Courier, which once counted you a friend, says so." : "Nothing changes.", (g) => {
          if (friend) mark(g, { id: "doubleVno", side: "public", kind: "grievance", weight: 6, text: "kept the skilled jobs white in the war" });
          return "The hiring office keeps its lists.";
        }),
      ],
    };
  },
  "Bull Moose Carries Pennsylvania": (g) => !g.company ? null : ({
    id: "bullmoose1912", historical: 1, title: "Roosevelt's Bull Moose",
    text: `Theodore Roosevelt's Progressives carry Pennsylvania against the Old Guard. They promise the eight-hour day, workmen's compensation and an end to child labour. ${because(g, "republican", "ring")}`,
    options: [
      opt("Back the Progressives", "Money and your name for reform: the reform laws come sooner, the union trusts you more; the Old Guard and the other owners don't forget.", (g) => {
        const p = polOf(g); p.balance.state = Math.min(100, p.balance.state + 15);
        mark(g, { id: "bullmoose", side: "labour", kind: "trust", weight: 8, text: "backed Roosevelt's Bull Moose" });
        for (const r of g.rivals) r.stance = Math.max(-100, (r.stance ?? 0) - 8);
        return "Your money goes to the Bull Moose.";
      }),
      opt("Stay with the Old Guard", "Penrose and the regulars remember their friends: influence +8.", (g) => { bump(g, "influence", 8); earnFavour(g, "state"); mark(g, { id: "oldguard", side: "politics", kind: "favour", weight: 8, text: "stood with Penrose's Old Guard in 1912" }); return "You stand with the regulars."; }),
    ],
  }),
  "Mellon at the Treasury": (g) => !g.company || !(head(g)?.traits.includes("married") || (g.rivals.find((r) => r.id === "mellon")?.stance ?? 0) >= 25) ? null : ({
    id: "mellon1921", historical: 0, title: "A friend at the Treasury",
    text: "Andrew Mellon is Secretary of the Treasury. The family's friendship with the Mellons might be worth a tax ruling.",
    options: [
      opt("Ask for a ruling", "A refund of back taxes; a one-in-four chance it surfaces in a Senate inquiry.", (g) => {
        const refund = Math.round(80000 * era(g));
        g.company!.cash += refund;
        if (g.turn % 4 === 1) { bump(g, "reputation", -10); mark(g, { id: "mellonRuling", side: "public", kind: "grievance", weight: 8, text: "took a tax favour from Secretary Mellon" }); return "The refund comes — and the Senate hears of it."; }
        return `The Bureau finds you overpaid by $${refund.toLocaleString("en-US")}.`;
      }),
      opt("Don't ask", "Nothing changes.", () => "You leave the Secretary to his work."),
    ],
  }),
  "Lawrence on Trial": (g) => !g.company || !anyMark(g, "ring", "bribed") ? null : ({
    id: "lawrence1940", historical: 1, title: "The graft trial",
    text: `David Lawrence, the Democratic boss, is on trial for the city's kickbacks. The prosecutors have lists of who paid whom, and your family's name is on the old ones. ${because(g, "ring", "bribed")}`,
    options: [
      opt("Testify", "Clear the family's name: reputation +8; every favour you were owed is gone, and the machine won't forget.", (g) => { bump(g, "reputation", 8); polOf(g).favours = []; mark(g, { id: "testified", side: "politics", kind: "grudge", weight: 15, text: "testified against the machine in 1940" }); return "You testify. Lawrence is acquitted; he remembers."; }),
      opt("Stay silent", "The machine is grateful: a favour in the city. A one-in-three chance the papers print the list anyway.", (g) => {
        earnFavour(g, "city");
        if (g.turn % 3 === 0) { bump(g, "reputation", -12); return "The list is printed. Your silence looks like guilt."; }
        return "Nothing comes out.";
      }),
    ],
  }),
  "Steel Workers Organizing Committee": (g) => {
    if (!g.company || !allWorks(g.company).some((w) => w.industry === "steel" || w.industry === "metalworks")) return null;
    const crushed = anyMark(g, "crushed1919", "crushed", "homestead_pinkertons");
    if (!crushed) return null;
    return {
      id: "swocfirst1936", historical: 1, title: "SWOC comes to your works first",
      text: `Philip Murray's organisers open their first office beside your gate. ${because(g, "crushed1919", "crushed", "homestead_pinkertons")} The sons of the men who were broken are signing cards.`,
      options: [
        opt("Meet Murray's organisers", "Labour +10; the union's militancy falls. The other owners call you a traitor.", (g) => {
          const u = unionFor(g, "steel") ?? unionFor(g, "metalworks"); if (u) { u.militancy -= 20; u.membership = Math.min(1, u.membership + 0.2); }
          bump(g, "labour", 10); mark(g, { id: "metMurray", side: "labour", kind: "trust", weight: 12, text: "met SWOC's organisers in 1936" });
          for (const r of g.rivals) r.stance = Math.max(-100, (r.stance ?? 0) - 6);
          return "You shake Murray's hand.";
        }),
        opt("Fire the card-signers", "The old way. The union's militancy rises; the Labor Board may come for you.", (g) => {
          const u = unionFor(g, "steel") ?? unionFor(g, "metalworks"); if (u) u.militancy = Math.min(100, u.militancy + 20);
          g.company!.biz.flags.firedOrganisers = true;
          mark(g, { id: "firedCards", side: "labour", kind: "precedent", weight: 20, text: "fired the men who signed SWOC cards" });
          return "The foremen take the names and the men are let go.";
        }),
      ],
    };
  },
  "Urban Redevelopment Authority": (g) => {
    if (!g.company) return null;
    const joined = hasMark(g, "conference"), refused = hasMark(g, "noConference");
    if (!joined && !refused) return null;
    return joined ? {
      id: "ura1946", historical: 0, title: "Partners in the Renaissance",
      text: `Lawrence and the Mellons offer the Conference's members first call on the cleared riverfront. ${because(g, "conference")}`,
      options: [
        opt("Take the land deal", "Cash from the Point's land; reputation +4.", (g) => { g.company!.cash += Math.round(150000 * era(g)); bump(g, "reputation", 4); return "Your company takes a share of the Gateway Center deal."; }),
        opt("Leave it to others", "Nothing changes.", () => "You stay out of the land deals."),
      ],
    } : {
      id: "ura1946", historical: 0, title: "The Authority wants your riverfront",
      text: `The new Redevelopment Authority, run by the Conference you refused to join, takes riverfront land by eminent domain. ${because(g, "noConference")}`,
      options: [
        opt("Sell at their price", "Half what it's worth; the river frontage is gone (river freight dearer).", (g) => { g.company!.cash += Math.round(40000 * era(g)); g.mods.push({ kind: "freightCost", mult: 1.1, until: g.turn + 400, source: "Your riverfront taken" }); return "The Authority takes the land."; }),
        opt("Fight it in court", "Three years in the courts: $60,000 and influence −10. You keep the land.", (g) => { g.company!.cash -= Math.round(60000 * era(g)); bump(g, "influence", -10); return "The courts find for you, after three years."; }),
      ],
    };
  },
  "Steel Pension Strike": (g) => {
    const c = g.company;
    if (!c || year(g) !== 1949) return null;
    const trusted = standing(g, "labour") > 20;
    return {
      id: "pension1949", historical: 0, title: "Pensions",
      text: `The union wants company-paid pensions and insurance, as the Ford and Bethlehem men have won. ${trusted ? "Your men, who trust the family, will take a modest plan." : "Your men want the full plan."} ${because(g, "swocSigned", "littleSteel", "recognised1919")}`,
      options: [
        opt(trusted ? "Agree a modest plan" : "Agree the full plan", "Pensions for every man who retires, for as long as he lives: a cost that grows.", (g) => {
          g.company!.biz.flags.pensionDeal = trusted ? "modest" : "full"; bump(g, "labour", 10);
          mark(g, { id: "pensions", side: "labour", kind: "trust", weight: 10, text: "agreed pensions in 1949" });
          return "The pension plan is signed.";
        }),
        opt("Hold out", "A strike of a season; pensions come anyway.", (g) => {
          for (const w of allWorks(g.company!)) w.strikeTurns = Math.max(w.strikeTurns, 1);
          mark(g, { id: "pensionsFight", side: "labour", kind: "grievance", weight: 8, text: "fought the pension strike of 1949" });
          return "The men walk out for pensions.";
        }),
      ],
    };
  },
  "Donora Smog": (g) => {
    const c = g.company;
    if (!c || c.biz.policy.waste !== "dump" && !hasMark(g, "decree1972_0")) return null;
    return {
      id: "donora1948", historical: 1, title: "After Donora",
      text: "Twenty dead in the Donora smog. The papers ask what comes out of every stack in the valley, yours included.",
      options: [
        opt("Abate now", "Waste abatement: input costs +4%; reputation +8.", (g) => { g.company!.biz.policy.waste = "abate"; bump(g, "reputation", 8); mark(g, { id: "abated1948", side: "public", kind: "trust", weight: 8, text: "cleaned up the stacks after Donora" }); return "Scrubbers and settling ponds go in."; }),
        opt("Deny it", "Nothing changes — but the river and the air keep the record.", (g) => { mark(g, { id: "denied1948", side: "public", kind: "grievance", weight: 6, text: "denied the smoke after Donora" }); return "Your spokesman blames the weather."; }),
      ],
    };
  },
  "\"Pittsburg: A City Ashamed\"": (g) => !g.company || !anyMark(g, "ring", "bribed") ? null : ({
    id: "steffens1903", historical: 1, title: "Steffens names names",
    text: `Lincoln Steffens's article on the Pittsburgh ring names the businesses that paid. Yours is among them. ${because(g, "ring", "bribed")}`,
    options: [
      opt("Back the reformers", "Reputation +6; the ring's favours are gone and the machine remembers.", (g) => { bump(g, "reputation", 6); polOf(g).favours = []; mark(g, { id: "turnedOnRing", side: "politics", kind: "grudge", weight: 10, text: "turned on the ring after Steffens" }); return "You join the Civic Club's reformers."; }),
      opt("Weather it", "Reputation −8; the ring is grateful.", (g) => { bump(g, "reputation", -8); earnFavour(g, "city"); return "The ring's men thank you quietly."; }),
    ],
  }),
  "Mounted Police at East Pittsburgh": (g) => {
    const c = g.company;
    if (!c || !allWorks(c).some((w) => w.industry === "power" || w.industry === "metalworks")) return null;
    return {
      id: "eastpgh1946", historical: 1, title: "The Westinghouse picket lines",
      text: `Mounted police are riding down the UE pickets at East Pittsburgh. Your own electrical men are watching. ${because(g, "policeIn", "troops", "pinkertons")}`,
      options: [
        opt("Settle with your men first", "Wages up a step; labour +12. Westinghouse is furious.", (g) => {
          const p = g.company!.biz.policy; if (p.wages !== "high") p.wages = p.wages === "low" ? "market" : "high";
          bump(g, "labour", 12); mark(g, { id: "settled1946", side: "labour", kind: "trust", weight: 10, text: "settled before the 1946 strikes" });
          const w = g.rivals.find((r) => r.id === "westinghouse"); if (w) w.stance = Math.max(-100, (w.stance ?? 0) - 20);
          return "Your men sign before Westinghouse's do.";
        }),
        opt("Stand with Westinghouse", "The owners stand together: the association's strikebreakers if your men go out.", (g) => {
          const w = g.rivals.find((r) => r.id === "westinghouse"); if (w) w.stance = Math.min(100, (w.stance ?? 0) + 15);
          ownersOf(g).member = true;
          return "You stand with the owners.";
        }),
      ],
    };
  },
  "Immigration Restricted": (g) => !g.company || year(g) !== 1921 ? null : ({
    id: "quota1921", historical: 1, title: "The doors close",
    text: "Congress caps immigration from southern and eastern Europe. The ships that brought your men will bring few more.",
    options: [
      opt("Send agents to the South", "Recruits from the South for the works (400 families).", (g) => { g.company!.biz.recruits.push([4, 400]); return "Your agents board the trains to Birmingham."; }),
      opt("Mechanise instead", "Fewer men needed: the next process you build costs 10% less.", (g) => { g.company!.biz.flags.mechanise = true; return "Your engineers draw up plans for machines."; }),
      opt("Do nothing", "Nothing changes.", () => "You wait to see who comes."),
    ],
  }),
};

/** a broken union comes back angrier: when the next organising wave reaches a works whose union was broken a generation ago */
export function returningUnion(g: GameState) {
  for (const u of Object.values(g.unions ?? {})) {
    if (!u?.broken || u.recognised || year(g) - u.broken !== 25) continue;
    u.militancy = Math.min(100, u.militancy + 20); u.membership = Math.min(1, u.membership + 0.15);
    const line = because(g, "crushed");
    pushHeadline(g, "The Union Returns", `A new generation of organisers is signing up your men. ${line}`, "Labor");
    log(g, `The union returns to your works, 25 years after it was broken.`);
    void newestGroup;
  }
}
