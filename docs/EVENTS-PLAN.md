# Historical events: plan for the Suggested Actions

`EVENTS.csv` has 404 events, each with a Suggested Action (a design note the game doesn't read yet). This plan says
how to make them play. Every event is classified one by one in `EVENTS-ACTIONS.md` (mechanism, concrete spec,
status, effort); this file is the summary: what exists, the few engine capabilities that unlock most of the list,
the order to build them in, and the design calls that need an answer first.

## 1. Where things stand

| Status | Events | What it means |
|---|---|---|
| DONE | 116 | Already does what the note asks: a modifier in `events.ts`, a decision in `business.ts`, map data (rail lines, bridges, inclines, parks), annexations in `districts.ts`, or a headline that needs nothing more |
| PARTIAL | 48 | The effect exists but not the suggested choice, scope or detail (e.g. the panics change prices but offer no "bank the furnaces" decision) |
| NEW | 240 | Nothing yet |

By mechanism (an event can use several): modifiers ~150 (about 60 need a new scope), map spawns ~80, rival moves ~60,
decisions ~45, unlocks ~30, civic/political ~30, infrastructure ~25, migration pulses ~13, floods/epidemics ~10,
and ~75 that should stay headline-only (FLAVOUR: sports, culture, off-map news).

**The main finding:** most NEW events are small data entries once about a dozen shared capabilities exist. Only a few
events need large systems of their own, and several of those can stay headlines.

## 2. Bugs and data fixes found on the way (do first)

1. **Output boosts do nothing.** `game.ts` caps the output modifier at 1 (`Math.min(1, mod(g, "output"))`), so the
   wartime boosts (America Enters the War 1.1, Pearl Harbor 1.15) are silently ignored. Allow > 1 up to capacity.
2. **One decision per season.** `fireEvents` keeps only the first decision when several events fire together
   (Autumn 1919: Great Steel Strike and Mother Jones; Autumn 1933 has five events). Needs a decision queue.
3. **SWOC 1936** is tagged "existing" but has no entry in `EFFECTS`.
4. **Private police dates.** Coal & Iron Police (`strike ×0.85` for 260 seasons) lapses in 1930, a year before
   Pinchot (1931); the Pinkertons action is blocked from 1937, after Pinchot (1931) and abolition (1935). Drive both
   from the events instead of hard-coded years.
5. **Industry-blind modifiers.** Every modifier hits every industry: the Westinghouse strikes (1945, 1955), the McKinley
   tariff and Elrama's power glut all reach a glass or steel player. Fixed by industry-scoped modifiers (§3, E1).
6. **Tech dates vs events:** open hearth 1890 vs Homestead's 1886; by-product coke 1918 vs Clairton 1916; J&L gets
   Bessemer in 1870 though it only made steel from 1886. Move open hearth to 1886 and by-product coke to 1916, and
   give rivals per-rival tech timing (R1).
7. **Timing quirks:** the Allegheny annexation switches for all of 1907 though it fires in Winter; Pearl Harbor's boost
   runs one season past Victory; rival steel all closes in 1983, though J&L's Pittsburgh works closed in 1985 and
   Duquesne in 1984 (replace with dated closures, R1).
8. **Dates to check in `EVENTS-RESEARCH.md`** (from memory, not verified): Turnpike to Ohio (Dec 1951, not 1954),
   East Busway (Feb 1983 → Winter 1982), Weirton buyout (Jan 1984 → Winter 1983), Steel Valley Authority (Jan 1986,
   after the game), Dorothy Six, Carrie Furnaces' last blast (1978 vs 1982), Penn State McKeesport (1934 vs 1947).

## 3. Capabilities to build

Each event table used its own short names; they're merged here. "Unlocks" counts the events that become simple data
entry once the capability exists.

### Effects engine (one effect table, typed variants)

| # | Capability | What it is | Unlocks | Effort |
|---|---|---|---|---|
| E1 | Scoped modifiers | `Mod` gains optional `industry`, `good` (coal, ore, sand…) and `place` scopes; `mod()` is asked per works (and per good inside freight purchase cost) | ~60 (Heinz bottles, oil, tariffs, Frick coke, mine disasters, Elrama, Westinghouse strikes, Oil Crisis) | M |
| E2 | Meter effects | `{ meters: {reputation, labour, influence}, if? }` applied once | ~20 (Lincoln, sports wins, protests, scandals) | S |
| E3 | Conditional and works-filtered effects | Apply only to works with/without a tech, above a pollution level, or while a policy holds (company union, no union) | ~15 (Clairton decree and suits, Slag Dumping, closures, CIO drives) | M |
| E4 | New modifier kinds | `labour` (share of the pool willing to work: wars, enlistment), `freight` (river/rail cost and capacity per gateway or mode: canal sale, river tolls end, Ohio canalized, Turnpike), `riverLoad` (ALCOSAN, benzene spill), `floodGuard` per river (Flood Control Act, Tygart, Conemaugh, Kinzua) | ~20 | M |
| E5 | Clear modifiers | End active modifiers from a named source early (the war ends, a strike settles) | ~5 | S |
| E6 | Place offsets | Timed unrest/health offsets for a named place (Hill Burns, Braddock, Clairton air crisis, protests), plus a small registry of named places beyond the neighbourhoods (Homewood, Lower Hill, West Homestead, Wilkinsburg…) | ~12 | M |

### Decisions

| # | Capability | What it is | Unlocks | Effort |
|---|---|---|---|---|
| D1 | Decision queue | Several decisions per season, shown one after another (or carried to the next season) | needed by 6+ clashes | S |
| D2 | Condition helpers | Who gets the card: any player, industry ∈ X, men ≥ N, has a dock or a tech, near a place | all decision cards | S |
| D3 | Company flags | Lasting choices that later rules read: party (Republican / Democrat), the Magee–Flinn ring, war contracts, Frick contract, company union, relief given, Allegheny Conference member | ~15 | S |
| D4 | ~45 new decision cards | Using the existing card UI and "what the owners did" default. List in §5 | — | S each |

### Rules and politics

| # | Capability | What it is | Unlocks | Effort |
|---|---|---|---|---|
| P1 | Action rule table | `g.rules`: per-action cost multiplier, blocked-from/until, influence yield and exposure odds, set by events. Replaces hard-coded years (Pinkertons, union stances before 1876) | ~20 (police laws, Wagner Act, graft scandals, Ripper Act, reform mayors, Taft-Hartley) | M |
| P2 | Political era | `g.politics`: machine / reform / New Deal / Renaissance, changing lobby and bribe yields and costs | ~10 (Magee–Flinn, Guthrie, McNair, Lawrence, Flaherty, Caliguiri) | S on P1 |
| P3 | New policies and actions | Sliding-scale wages (1864), Saturday half-holiday (1871), company police (1865–1935), radio advertising (KDKA 1920), research lab / contract research (Westinghouse 1906, Mellon Institute 1913), relief for the jobless (1931), layoffs vs keep-on (1979–82) | ~15 | M |

### Rivals

| # | Capability | What it is | Unlocks | Effort |
|---|---|---|---|---|
| R1 | Rival lifecycle data | Per rival: entry, rename by year (J&L → LTV, PPG Industries), building phase (no output until it opens), tech delay/advance, expansion freeze, dated partial and full closures (replacing the blanket 1983 rule) | ~25 | M |
| R2 | Event-driven rival moves | `{ rival, expand?, damage?, style?, closes? }` effects (Carrie furnaces, Aliquippa, Clairton coke, Homestead lodge shut-down, Dravo Neville Island) | ~25 | S on R1 |
| R3 | New rivals and sites | Mesta (West Homestead 1898), National Tube (McKeesport 1872), U.S. Steel Duquesne (Duquesne Works site 1888/1891), Carrie Furnaces (Rankin 1884), Duquesne Light (power, 1903), optionally Westinghouse Air Brake / Union Switch. Needs a few new landmarks | ~25 | S each |
| R4 | Owner groups | Rivals sharing an owner (Carnegie Steel 1892, U.S. Steel 1901): one name, no moves against each other, shared refusal to sell, group-wide strikes and policies | ~10 | L |

### Map

| # | Capability | What it is | Unlocks | Effort |
|---|---|---|---|---|
| M1 | Dated landmarks | Table `{name, lat, lon, size, year, stages, sprite}` that claims tiles as a landmark in its year (clearing homes), with later states (closed, ruin). Hospitals, libraries, colleges, Carnegie Institute, Phipps, ballparks, stadiums, Civic Arena, terminals, airport, Cathedral of Learning (staged) | ~45 | M + S each, plus sprites |
| M2 | Sprites for landmark kinds | Conservatory, museum, campus/tower, ballpark, stadium, arena, hospital, terminal, chapel | — | M each |
| M3 | Hospitals reduce epidemic losses | Health bonus and smaller epidemic loss within a radius (and make epidemics hit crowded riverfront wards, not the whole map) | ~8 | M |
| M4 | Migration pulses | One-off arrival or departure of a community at named neighbourhoods (Famine Irish, Forty-Eighters, Great Migration, coalfield refugees) | ~13 | M |
| M5 | Parks and reserved land | More PARKS rows; land held from growth before a park opens (Frick 1919) | ~6 | S |
| M6 | Blast and ruin | Clear tiles to rubble in a radius, kill and displace, block regrowth for N seasons (Arsenal 1862, Gasometer 1927) | 2 | M |
| M7 | Clearance and displacement | Clear residential tiles in a place and move people by community to named places (Lower Hill 1956, Point 1950, the Hill burns 1968) | ~5 | M |
| M8 | Public housing | A housing-project lot type and a rule that replaces crowded blocks from 1938 (Terrace Village) | 2 | L |

### Optional large systems (decide whether they're worth it)

| # | Capability | Events | Effort | Recommendation |
|---|---|---|---|---|
| X1 | Per-line transit (streetcar, light rail, subway open/close years) | Pittsburgh Railways, Port Authority 1964, light rail 1984, subway 1985 | L | Later; today streetcars end everywhere in 1955 |
| X2 | Dated highways and busways in the travel model | Parkway 1953, Fort Pitt Tunnel 1960, busways 1977/1983, Liberty Tubes 1923 | L | Later; Liberty Tubes alone can be a tunnel link + South Hills suburb data (M) |
| X3 | Sell a works (to workers, a conglomerate, the Authority) | Weirton, LTV, Steel Valley Authority, Dorothy Six | M | Yes, gives the collapse years choices |
| X4 | Layoffs and the jobless | Closures, Bottom Falls Out, Unemployment Peaks, Community College | M | Yes, with X3 |
| X5 | Strike contagion between nearby works | County Labor Council and the big strikes | M | Optional |
| X6 | Outbound freight (canal vs PRR for finished goods) | 1852, 1857 | L | Skip; headline |
| X7 | Municipal and profit taxes | Annexations, Mellon at the Treasury | L | Skip; existing price proxy |
| X8 | Town morale meter | Sports wins, Homestead Grays | M | Skip; small labour/unrest bumps (E2/E6) instead |

## 4. Order of work

| Phase | Builds | Then enters as data | Size |
|---|---|---|---|
| 0. Fixes | §2: output clamp, decision queue (D1), SWOC, police dates, tech dates, rival closures by date | — | S–M |
| 1. Effects engine | E1–E5, D2, D3, one typed effect table replacing `EFFECTS` | ~130 events (modifiers, meters, scoped prices, freight and flood changes) | M |
| 2. Decisions | D4: the ~45 cards in §5 | ~45 events | M (mostly writing) |
| 3. Rivals | R1–R3 (R4 if the U.S. Steel question below is yes) | ~50 events | M (L with R4) |
| 4. Rules and politics | P1–P3 | ~40 events | M |
| 5. Map | M1–M7 (M8 optional) plus sprites | ~70 events | L (art-heavy) |
| 6. Late game | X3, X4, E6 | ~20 events | M |
| — | X1, X2, X5 if wanted; X6–X8 skipped | — | L |

Phases 1–2 make the events matter in play fastest; Phase 5 is what makes them visible on the map.

**Data format.** Keep `EVENTS.csv` as the master list (headline, date, category, design note). Put machine effects in
one typed table keyed by Event Name (`src/core/eventEffects.ts`), extending today's `EFFECTS`:

```ts
"Heinz Bottles Horseradish": [{ mod: ["price", 1.08, 8], industry: "glass" }],
"Frick Coke Company":        [{ mod: ["input", 0.9, 400], good: "coal", industry: "steel" }],
"Carrie Furnaces Built":     [{ rival: "carrie", opens: true }],
"Lincoln Passes Through":    [{ meters: { reputation: 2 }, if: "party:republican" }],
"Flood Control Act":         [{ floodGuard: { mon: 0.85, allegheny: 0.85, ohio: 0.9 }, from: 1938 }],
"Phipps Conservatory Opens": [{ landmark: "phipps" }],
```

A unit test checks that every key matches an event name, so renaming a CSV row can't silently drop its effect (the
risk EVENTS.md warns about).

## 5. Decision cards to write (D4)

The "historical" option (what the owners did) is the default if the player doesn't choose.

- **1850s–1870s:** Fugitive Slave Act (shelter fugitives?), Cholera (pest house and clean water for your ward),
  Republicans 1855 (back the new party or the Democrats), Panic of 1857 (bank the furnaces or run at a loss),
  Sons of Vulcan (recognise or blacklist), Citizens Stop the Cannon, Civil War contracts, Arsenal explosion relief,
  War Ends (convert or cut back), Air brake licence (metalworks), Panic of 1873, Amalgamated 1876 (sign the scale),
  Great Railroad Strike (shelter the militia's targets or call troops)
- **1880s–1890s:** Magee–Flinn ring (pay in or stay clean), Frick Meets Carnegie (coke contract), Johnstown relief,
  Braddock library (match Carnegie?), J&L Refuses the Union, Pittsburgh Survey (open your works to investigators?)
- **1900s–1940s:** U.S. Steel Formed (see the open question), Mother Jones in Homestead, Cathedral of Learning
  subscription, Charity Hospital, Father Cox's Army, Mill Organizing Drives (company union?), Dravo "E" war orders,
  Allegheny Conference (join the smoke clean-up?)
- **1950s–1985:** Long Westinghouse Strike (power), Dorothy Six, Mesta Unionized, LTV buys J&L (sell to the
  conglomerate?), Black Monday shutdowns (hire Black tradesmen), Clairton Consent Decree (sign / sign and stall),
  No-Strike Deal, Braddock Library Closes (fix the roof?), Clairton Air Crisis, Closures Announced (modernise, cut
  back or close), Bottom Falls Out (lay off or keep on), Neville Island, Unemployment Peaks (fund food banks),
  Duquesne Works Closes (buy Dorothy Six?), Pastor Roth
- Existing and kept: Homestead 1892, Great Steel Strike 1919, Big Steel Signs 1937, 116-Day Strike 1959

## 6. Open questions

1. **U.S. Steel 1901.** The note suggests "sell your company to Morgan", but the design says there's no trust
   buy-out. Proposed: a card offering stay independent / join a price pact / sell one of your other works. Keep the rule?
2. **U.S. Steel as one owner (R4, large).** Model Carnegie Steel (1892) and U.S. Steel (1901) as owner groups, or keep
   them as separate rivals with headlines?
3. **Who is at Homestead?** The rival there is "H. C. Frick Coke Company"; historically it was Pittsburgh Bessemer
   Steel, then Carnegie's. Rename it Carnegie's Homestead Works and make Frick an off-map coke supplier that acts
   through coal prices?
4. **How many new rivals?** Mesta, National Tube, U.S. Steel Duquesne, Carrie Furnaces and Duquesne Light are
   needed by ~25 events. Westinghouse also sits in East Liberty as a "power" rival though it really made equipment at
   East Pittsburgh. Add all of them?
5. **Off-map places** (Observatory, Highland Park zoo, Creighton, Sharpsburg, New Kensington, Neville Island,
   Johnstown, Donora, the regional parks, VW New Stanton) can't be built on the map. Keep them as prices, rivals,
   migrants and headlines?
6. **Streetcars.** Today they end everywhere in 1955; the late transit rows assume lines ran on (and the South Hills
   lines never closed). Build per-line transit (X1) or keep 1955 and make those rows headlines?
7. **Coke.** Steel's inputs are ore, coal and limestone. Treat coke events as coal prices for steel works, or add coke
   as a separate good?
