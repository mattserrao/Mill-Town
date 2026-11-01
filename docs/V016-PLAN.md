# Mill Town v0.16 — The Struggle (plan, rev. 2, 1 Nov 2026)

**Theme:** a three-way fight between the industrialist (you and the rival owners), labour and politics, played
across **four eras and four generations of one family**. Every side is an actor with its own goals, resources
and memory; it moves each season, answers your moves, and remembers. Decisions compound: what your founder does
in 1877 changes who your grandson faces in 1937, which laws exist, and what the union wants.

Built on the v0.15 review (`REVIEW-v0.15.md`): its economy and meter findings are fixed here because the fight
needs money that can be lost and meters that bite.

**Settled (1 Nov):** the player can go fully pro-labour (co-op / employee ownership); strike violence is shown
on the map; the 1901 merger can swallow you; elections use real names and parties.

---

## Status: built in v0.16.0 (1 Nov 2026)

All eight phases are in, on the branch `v0.16-struggle`:

| Phase | Where | State |
|---|---|---|
| A. Foundations | `ledger.ts`, `game.ts` (taxes, pensions, cleanup), `holdings.ts` | done |
| B. Eras and the family | `time.ts` (four eras), `family.ts`, `ui/struggle.ts` (succession card) | done |
| C. Labour | `labour.ts`, `render/traffic.ts` (guards and troops at the gate), memorials | done |
| D. Politics | `politics.ts` (office-holders 1850–1985, elections, nine movable laws, favours) | done |
| E. Owners | `owners.ts` (stance, answers, intents, association, 1901 offer, takeover bids) | done |
| F. Politics as a career | `career.ts` (council → Senate; bills, police, tariff, contracts, mediation) | done |
| G. Branch cards | `branches.ts`: marks on ~40 existing decisions, "because" lines on 12, 12 new cards | done |
| H. Interface and score | the Struggle view (S), top bar, Watch, laws on policies, `legacy.ts` and the end paper | done |

Review harness (`tests/review.test.ts`, seed 11):

| Industry | Never invests | Invests (peak → 1985, kept) | Tycoon (cash + holdings, 1985) |
|---|---|---|---|
| Steel | receivership 1928 | $13.7M → $5.2M (37%) | $31M + $92M |
| Glass | receivership 1967 | $10.4M → $6.4M (61%) | $45M + $88M (before the last cap) |
| Power | receivership 1965 | $8.9M → $4.0M (45%) | $27M + $86M (before the last cap) |
| Metalworks | receivership 1967 | $12.5M → $7.4M (60%) | $69M + $128M (before the last cap) |

- Labour play diverges: recognising the union (steel, seed 12) gave 1 strike in 135 years and laws a few years
  early (the Wagner Act 1927); crushing it gave 10 strikes, a broken union, the Wagner Act in 1932 and
  Taft-Hartley in 1952. Refusing every demand gives ~20 strikes a game, in every industry.
- Rivals gave 28 answers to an investing steel owner's 18 major moves (several rivals can answer one move).
- Paths: a politics heir (1893) reached governor in 1918; a co-op had no strikes after 1893; a new-industry heir
  moved the company from steel to glass and kept 54% of its peak.
- Season time ~120–150 ms (slowest ~450 ms).
- **Not met:** the tycoon target (≤ 2× an operator). Holdings went from ~$1B (v0.15) to ~$125M, but a portfolio of
  the region's shares bought every year from the 1880s still ends ~20× richer than a works-only owner. Further
  levers if wanted: one share purchase a season in all, a holding cap per company, or market risk (bankruptcies).

---

## 0. Eras and generations (new)

**Today the game has no eras as a mechanic.** The events are grouped into four files by period (1850–92,
1893–1917, 1907–51, 1951–85) and prices, hours and transport change with the year, but nothing happens between
them: one unnamed owner plays 135 years in one industry, chosen once at the start. v0.16 makes eras real.

### The four eras

| Era | Years | Character | Ends with |
|---|---|---|---|
| I. Iron and the founders | 1850–1892 | foundries, canals to rail, the Bessemer race, the Amalgamated rises | Homestead, 1892 |
| II. Steel and the trusts | 1892–1919 | Carnegie, Frick, Westinghouse, the 1901 merger, Progressives, immigration | the Great Steel Strike, 1919 |
| III. Depression, New Deal and war | 1919–1946 | 1929, the Wagner Act, SWOC, Little New Deal, the arsenal of democracy | the 1946 strike wave |
| IV. Renaissance and collapse | 1946–1985 | smoke control, the Renaissance, 1959 strike, imports, EPA, the mills close | the end of the game, 1985 |

### The family

- **New game**: you name your founder (first and family name) and, as now, the company. Age ~30 in 1850.
- Each era is one **head of the family**. At each era's end the head retires or dies and an **heir** takes over.
- **Heirs**: two or three children appear during an era (named, aged, with one or two traits). Their traits are
  shaped by the ledger: raised in the works (respected by the men), schooled at the university you endowed
  (a better researcher), sent abroad (Bessemer/European contacts), spoiled by a fortune (expensive, careless),
  married into Mellon or Frick money (capital, a rival's stance changes). Choosing the heir is a decision.
- **The family name carries the ledger.** The union remembers "the son of the man who sent the Pinkertons";
  a machine politician remembers your father's money. Some marks pass down weaker, martyrs never fade.
- A **family tree** on the end paper, with each head's years, path and verdict.

### The succession: an era's turning point

A full-screen succession card at each era's end (game paused). The heir chooses a path:

| Path | What happens |
|---|---|
| **Stay in the family business** | carry on; the heir's traits apply; one free change of policies without meter shock |
| **Buy into a new industry** | sell some or all works (rivals and the market bid; the buyer gets stronger) or keep them as holdings run by a manager; found or buy a works in another industry at that era's price |
| **Go into politics** | the heir runs for office; the company is kept as holdings in a family trust (manager-run, shown as a rival-like AI with its own stance) or sold for a campaign chest; play switches to the politics loop (below) |
| **Give it to the men** | convert to employee ownership or a co-operative (labour's path, settled yes); profits shared, union becomes partner, owners' association expels you, banks charge more; historically late (Weirton 1984) — earlier it's a hard road |
| **Sell up** (late eras) | cash out to the trust or a rival and play as a financier (holdings only) |

The next head can switch back: a politician's son can buy back into steel; a co-op can be sold.

**Being swallowed** (settled yes): if U.S. Steel's 1901 merger offer arrives while you're weak (low cash, a
lost strike, stakes held by Morgan), refusing can fail; you're bought out for U.S. Steel stock. That doesn't end
the game: it forces an early succession with your family rich in shares and no works — politics, a new industry
or a financier's life. The same can happen later to any rival takeover of you.

### Politics as a career (the politics path)

When a head of the family holds office, the seasonal loop changes:

- **Ladder**: council → mayor → state senate → governor → Congress/Senate, or appointments (Secretary of the
  Treasury, as Andrew Mellon). Each step is an election against real opponents of the era.
- **Office powers** match §2.2: a mayor controls police at strikes, permits, roads and city contracts; a
  governor the Coal & Iron Police, militia and state law; Congress tariffs, labour law and war contracts.
- **The season**: bills on the desk (sign, veto, amend), the blocs' demands (machine, reform, labour,
  business), patronage to hand out, favours owed, a strike to answer, the next election's odds.
- **The fight from the other side**: rivals and unions lobby *you*. Your own family company (if kept in
  trust) asks for favours: granting them is a conflict of interest the papers can find.
- The economy and town keep running with AI owners; your town meters and the ledger still score you.

---

## 1. Design pillars

1. **Three actors, not one meter each.** Labour, Politics and the Owners are simulated sides with resources,
   goals and a turn of their own — not numbers that drift toward a target.
2. **Everything is remembered — across generations.** Major acts write a lasting mark on the family ledger
   (a grievance, a favour, a grudge, a precedent). Marks change odds, prices and which choices exist later.
   The game shows *why*: "because your father…".
3. **Every move draws a counter.** Rivals, the union and the politicians each read what you did last and
   answer it, and they telegraph what they're planning so you can pre-empt.
4. **Money is at risk to the end.** The collapse and the fight can ruin a rich company; holdings are useful,
   not a money printer.
5. **History is the default, not a rail.** Events still fire on their dates, but the fight can move them.

---

## 2. The three actors

### 2.1 Labour — the union as a player
One union per industry, following history: Sons of Vulcan (1858) → Amalgamated Association (1876) → SWOC
(1936) → United Steelworkers (1942) for steel and metalworks; Window Glass Workers / AFGWU for glass; IBEW →
UE (1930s) → IUE for power and electrical; UMWA for your coal holdings.

| State | Meaning |
|---|---|
| **Membership** (0–100% at your works) | grows with organising, grievances and good times; falls with blacklists, lockouts, lost strikes |
| **Militancy** | readiness to strike; rises with grievances and martyrs, falls with concessions and defeats |
| **Strike fund** | how long a strike can last; filled by dues, other unions, public sympathy |
| **Leadership** | the era's real leaders (Humphreys, Shaffer, Mother Jones, Fitzpatrick, Murray, McDonald, Abel) with traits |
| **Grievances / trust** | ledger entries for and against your family |

**Moves each season**: organise a works; present **demands** (wages, hours, recognition, safety, end the company
store); strike; sympathy strike at your other works; boycott your goods; political action (endorse, get out the
vote, push a bill); sabotage only at extreme militancy.

**Demands** arrive with a deadline. Answer: concede, negotiate (offer a step, they counter), refuse, or lock out.

**Strikes are a siege** on four fronts, season by season:
- *Money*: your cash and lost orders vs their strike fund
- *Men*: strikebreakers (immigration waves, the Great Migration, unemployment) vs picket lines
- *Force*: Pinkertons / Coal & Iron Police / militia — **only if the politics allow it**
- *Opinion*: papers, clergy, public — reputation is the weapon here

Outcomes: union wins (recognition, contract), compromise, union broken (membership crushed, martyrs likely). A
broken union comes back angrier a generation later.

**Shown on the map** (settled yes): picket lines at the gates, Pinkerton barges on the river, militia camps,
mounted police in the streets, crowds at the mill, smoke stopping when the works are out; a lasting memorial
marker where martyrs fell.

**Every industry fights**, with thresholds by industry and size (no 300-man floor) and their own flashpoints:
window-glass machine 1903–08, Westinghouse 1914/1916/1946, UE 1946, Pressed Steel Car 1909.

### 2.2 Politics — offices, elections and laws (real names and parties)

| Level | Who (examples) | Controls |
|---|---|---|
| **City** | Magee–Flinn machine, Guthrie (reform), McNair, Lawrence, Barr, Flaherty, Caliguiri | police at strikes, permits, roads/bridges, zoning, city contracts, smoke ordinance |
| **State** | Quay and Penrose (Republican machine), Pinchot, Earle, Duff, Lawrence, Shafer, Thornburgh | Coal & Iron Police, militia, child-labour and hours law, workers' comp, clean air/water |
| **Federal** | tariff Congresses, T. Roosevelt, Wilson, Mellon at Treasury, F. D. Roosevelt, Truman, Nixon, Reagan | tariffs, antitrust, Wagner Act, war contracts, imports, steel seizure |

- **Blocs**: Business and Reform/Labour at each level (with the era's parties: Republican machine, Democrats,
  Progressives/Bull Moose, Socialists in 1912). Strength from money (yours, rivals'), union votes, opinion,
  scandal and the era.
- **Elections** on their real cycles with the real candidates where known; a card shows candidates, odds and
  what each would do. Fund, stay out, or switch sides; unions mobilise; rivals fund too. A counterfactual
  winner keeps their real name ("Governor Pinchot, elected 1918 thanks to the reform money").
- **Laws with movable dates**: Coal & Iron Police abolished (1935, range 1915–45), PA child labour (1915,
  1905–25), workers' comp (1915), eight-hour day, Wagner Act (1935), smoke control (1946), Taft-Hartley (1947),
  Clean Air Act (1970). **Laws force policy**: when child labour is outlawed your policy switches, or you pay
  fines and headlines every season you defy it.
- **Favours** to an office-holder can be called in (police at a strike, a bridge, a contract, a tariff, a
  delayed law). They expire with the office; scandals expose them.
- **Influence** becomes *political capital*, spent to call favours, file or block bills, sway elections.

### 2.3 Owners — the rivals fight back
Each rival owner keeps a **stance toward your family** (ally · neutral · wary · hostile) and a **memory**. Each
season it answers your last move from a counter table, by personality:

| You… | They may… |
|---|---|
| cut prices or grab share | price war, cut wages to match, lobby for a tariff you can't use |
| poach men / pay above market | poach back, blacklist your recruits, complain to the owners' association |
| buy stakes in them | counter-buy, a poison pill, go to Mellon/Morgan for a white knight |
| expand or add a process | race you to it, expand faster, corner the input you need (Frick and coke) |
| recognise the union | expel you from the association, pressure your customers — or follow you if the union is strong |
| crush a strike | send strikebreakers, or poach your best men while you're down |
| fund a candidate | fund the other side, expose your money to the papers |
| sabotage | revenge, and a court case |

- **Telegraphed intent**: "Carnegie is buying up Mesabi ore leases" — pre-empt it.
- **Owners' association**: shared strikebreakers, blacklists and political money; leaving costs.
- **Rivals merge and fail**: the 1901 merger among rivals (one giant with their combined weight and stance),
  rivals going under, and takeover bids for *you* when you're weak (see §0).
- **Rivals have successions too**: Carnegie sells and gives it away, Frick turns to art, a son squanders a
  works — their stance resets partly with a new head.

---

## 3. Compounding: the family ledger and branch cards

- **The ledger** lists every lasting mark with weight and decay, by generation: *Homestead 1892 — your
  grandfather sent the Pinkertons: grievance 40, martyrs 3*; *1912 — funded the Bull Moose: favour with
  Flinn 15*; *Carnegie — grudge 2 (sabotage traced 1897)*.
- **Branch cards** read the ledger:
  - Pinkertons in 1892 → in 1919 the union refuses arbitration and Mother Jones speaks at *your* gate;
    recognition in 1892 → your men stay in and you're asked to broker.
  - Shelter fugitives in 1850 → the churches send Great Migration men to you first in 1916; the Courier backs
    you in 1941.
  - Fund the Magee–Flinn ring → favours for decades, and exposure in the 1910 graft scandal.
  - Break the union in 1901 → SWOC organises your works first in 1936, militant.
  - Join the Allegheny Conference in 1943 → smoke control on time and Renaissance land deals; refuse → the URA
    takes your riverfront in 1950.
  - A head in politics who sent the militia → his son can't win a mill-town ward.
- **"Because your father…" lines** on every card and outcome.

---

## 4. Economy fixes the fight depends on (from the review)

| Finding | Fix |
|---|---|
| Holdings give ~$1B by 1985 | stake dividends follow the rival's actual season; share yields ~3%/yr with the market's moods; one stake purchase per rival per year; income tax from 1913 and **inheritance tax at each succession**; target: a tycoon ends ≤ 2× a works-only owner |
| The collapse isn't a test | pensions and health care after 1949 (cost per retiree), environmental cleanup of past dumping after 1970 (from the ledger), write-downs of idle capacity, imports taking orders; target: an investing owner keeps 20–60% of peak cash, a careless one goes under |
| Cash piles up | strike war chests, campaigns, land, steeply dearer modernisation, succession costs (heirs' settlements, taxes) |
| Non-steel too easy | industry shocks (window-glass machine, gas boom's end, Duquesne Light's consolidation, shipbuilding busts); an idle owner fails in every industry |
| Reputation costs nothing | reputation is the *Opinion* front: strikes, elections, bank terms, contracts, inspections, which landmarks you may fund |
| Policies frozen at founding | laws force policy; new works follow the year's norms; each succession allows a free reset |

---

## 5. Interface

- **New game**: founder's name, family name, company name, industry (as now, plus names).
- **Succession screen** at each era's end: the outgoing head's verdict, the heirs with traits, the paths with
  what each costs and brings, the inheritance tax, the ledger's top marks passing down.
- **"The Struggle" view** (key **S**): Labour · Politics · Owners columns with the ledger strip below.
- **Top bar**: the head's name and years; meters Opinion · Union · Capital (and Morale) with tooltips.
- **Politics loop UI** (when in office): office panel replacing Works/Holdings tabs with *Desk* (bills, vetoes),
  *Blocs*, *Patronage*, *Campaign*; the map stays the same.
- **Strike screen**: the four fronts and their actions; events shown on the map.
- **Policy tab**: laws in force on each policy ("illegal since 1915").
- **Watch list**: demands due, an election, a rival's intent, a law about to pass, a succession coming.

---

## 6. Score and legacy

The end paper scores each head and the family on *Fortune*, *The Valley* and *History's verdict*, shows the
family tree with each head's path, and compares you with the real dynasties (Carnegie, Frick, Mellon, Jones &
Laughlin, Westinghouse, Heinz).

---

## 7. Build order

| Phase | Work | Size |
|---|---|---|
| A. Foundations | family ledger (marks, decay, inheritance); balance fixes (§4); laws force policy; reputation consequences | M |
| B. Eras and the family | founder's name; heads and heirs with traits; era ends; succession screen with *stay*, *new industry* and *sell up*; inheritance tax; save format v2 | M |
| C. Labour actor | unions by industry and era; membership, militancy, fund, leaders; demands and negotiation; the four-front strike; strikes on the map; every industry; the co-op path | L |
| D. Politics actor | offices and real holders by level and era; blocs and parties; elections with odds and funding; movable laws; favours | L |
| E. Owners fight back | stance and memory; counter table; telegraphed intent; owners' association; 1901 merger, takeover of you, rival successions | M–L |
| F. Politics as a career | the politics path: ladder, office powers, desk/blocs/patronage/campaign, the trust company, conflicts of interest | L |
| G. Branch cards | rework ~45 decision cards and add ~25 that read the ledger across generations | M (mostly writing) |
| H. Interface and score | Struggle view, top bar, Watch items, legacy score and family tree | M |

Each phase is a playable PR (v0.16.0 = A+B, then C, D, E, F, G+H as v0.16.x), checked with the review harness.

---

## 8. Acceptance checks (review harness, 4 industries × owner styles, 2 seeds)

- An idle owner fails in every industry; an investing owner ends with 20–60% of peak cash; a tycoon ≤ 2× that.
- Every industry sees ≥ 2 strikes and ≥ 2 union demands per game.
- Three successions happen; each path (stay, new industry, politics, co-op, sell up) can be played through to
  1985 by the harness.
- ≥ 3 branch cards per game read an earlier generation's choice; the ledger has ≥ 15 marks by 1985.
- Opposite labour play (recognise vs crush) gives visibly different 1919, 1937 and 1959.
- Rivals answer at least half of your major moves within two seasons.
- Season time < 200 ms; v1 saves load into v2 (founder named "the Founder").

---

## 9. Not in v0.16 (next)

Tutorial and help page, difficulty and scenarios, customers and contracts on the selling side, growing any
works and per-works policy, cross-industry supply, new industries after 1945 (aluminium, chemicals, medicine,
software), save export, accessibility, memory profiling (1920s heap growth, the long fast-forward crash).
