# Historical events: action specs, event by event

Companion to `EVENTS-PLAN.md`. One row per event in `EVENTS.csv`, classified by the mechanism that would carry its Suggested Action, with a concrete spec, what exists today (DONE / PARTIAL / NEW) and effort (S data entry, M small new code, L new system). Capability names in brackets are defined in `EVENTS-PLAN.md` §3 (each era table used its own short names; the plan maps them).

Mechanisms: MOD timed modifier · MOD+ modifier needing a new scope · FLOOD / EPIDEMIC · DECISION card · RIVAL move · SPAWN on the map · MIGRATE pulse · UNLOCK action/policy/tech · INFRA transport · CIVIC municipal/political state · FLAVOUR headline only.

## 1850 – 1893

| Year | Season | Event | Mechanisms | Concrete spec | Status | Effort |
|---|---|---|---|---|---|---|
| 1850 | Spring | A City Rebuilt | FLAVOUR | Game start = foundCompany + 1850 seeded town (town.ts settlements). Nothing to add. | DONE (game.ts foundCompany, town.ts 1850 settlements) | – |
| 1850 | Summer | Famine Irish and German Forty-Eighters | MIGRATE | Irish (2) and German (3) waves peak 1855 (GROUPS.wave), ANCHORS Lawrenceville/Deutschtown/Troy Hill, churches via communityBuildings. Optional: one-off pulse +600 Irish Point/Lawrenceville, +600 German Allegheny City [MIGPULSE]. | DONE (ancestry.ts waves + town.ts communityBuildings); pulse optional | S |
| 1850 | Autumn | Fugitive Slave Act Panic | MIGRATE, DECISION | Pulse: group 4 −15% in Hill District, Downtown [MIGPULSE]. Decision (any player): "Shelter fugitives" rep +6, influence −5, 20% chance fine $2k; "Stay out" nothing (historical=1). | NEW | M |
| 1851 | Spring | McKeesport's First Mill | SPAWN, RIVAL | Neutral small iron works at McKeesport landmark (no AI moves, 0.4× base capacity) [NEUTRAL]. McKeesport already a site + 1850 settlement (pop 1400). | PARTIAL (site/town exist) | M |
| 1851 | Summer | Ohio & Pennsylvania Railroad Arrives | INFRA | railLines id 9 "Fort Wayne line" year 1851 already gates rail access (freight.ts railDist). | DONE (map railLines) | – |
| 1852 | Spring | American Iron Company Founded | RIVAL | Change RIVALS jl.entryYear 1853→1852 (see Doubts). | PARTIAL | S |
| 1852 | Winter | Pennsylvania Railroad Reaches Pittsburgh | INFRA | Line id 10 year 1852 DONE. "Eastbound cost drops, canal rises" needs outbound freight [OUTFREIGHT]; otherwise skip. | PARTIAL | L (or skip) |
| 1853 | Spring | Western Pennsylvania Hospital Opens | SPAWN | Hospital at Bloomfield edge (40.461,−79.952), 3×3 [INST]; epidemic loss ×0.5 within 40 tiles [HEALTHR]. | NEW | M |
| 1854 | Summer | Cholera Epidemic | EPIDEMIC, DECISION | Epidemic 0.04 DONE. Decision (any player with ≥100 men): "Fund pest house and clean water" $3k×era, epidemic loss ×0.5 in tiles within labour radius of works, labour +5 (historical=1 "Do nothing"). Needs epidemic to read a protected mask [HEALTHR]. | PARTIAL | M |
| 1854 | Summer | Laughlin Buys In | RIVAL, SPAWN | jl: expand +0.2 [RIVOP]; spawn coal mine (Use.Coal mine) on slope above jl works. | NEW | S (after RIVOP) |
| 1854 | Autumn | Western University Rebuilds | SPAWN | Institution "Western University" downtown (40.4395,−79.9985), 2×2, until 1882 [INST]. | NEW | S |
| 1855 | Autumn | Central High School Opens | SPAWN | Institution downtown, CivicSub.School variant [INST]. Skip "skilled share" (no skill model) → FLAVOUR for effect. | NEW | S |
| 1855 | Winter | Republicans Organize at Lafayette Hall | DECISION | Any player. "Back the Republicans": influence +8 from 1861 (store flag), tariff action cost −25% [FLAGS]; "Back the Democrats": influence +8 now, recruit action cost −25%; "Stay out" (historical=2). | NEW | M |
| 1857 | Summer | State Sells the Main Line | INFRA | Needs outbound canal mode [OUTFREIGHT]. Without it: FLAVOUR (economy.ts display already switches canal→PRR by year). | PARTIAL (display only) | L (or skip) |
| 1857 | Autumn | Panic of 1857 | MOD, DECISION | price 0.72×8 DONE. Decision (any player): "Bank the furnaces": output 0.5×4, wage 0.8×4, labour −10; "Run at a loss" (historical=0, bank). | PARTIAL | S |
| 1858 | Spring | Sons of Vulcan Founded | MOD, UNLOCK, DECISION | wage 1.05×40 DONE. Unlock union stance before 1876 for steel (setPolicy gate) [UNIONGATE]. Decision (steel, ≥100 men): "Recognise puddlers" union=recognise, labour +10; "Blacklist" blacklistUntil +8, labour −10 (historical=1). | PARTIAL | M |
| 1859 | Summer | Oil Struck at Titusville | SPAWN, MOD+ | Spawn 3 refinery sprites on Allegheny shore Lawrenceville/Strip [INST or new Use]; price ×1.05 for glass and metalworks 20 seasons [INDMOD]. | NEW | M |
| 1860 | Winter | Lincoln Passes Through | MOD+, FLAVOUR | Labour +3 one-off [METERFX]. Crowd sprite: skip. | NEW | S |
| 1860 | Winter | Citizens Stop the Cannon | DECISION | Any player. "Join the meeting": rep +5, influence +4, flag warContract → Civil War price ×1.1 extra for you [FLAGS]; "Stay out" (historical=0, join). | NEW | M |
| 1861 | Spring | Civil War Begins | MOD, DECISION | price 1.35×16 DONE. Decision (steel/metalworks): "Bid for Union contracts": price floor (no price<1.0) + output 1.1 ×16, labour pool: migrants 0.7×16 and participation −10% [LABPOOL]; "Sell on the open market" (historical=0). | PARTIAL | M |
| 1861 | Spring | Jones & Laughlin Named | RIVAL | Rename jl display name to "Jones & Laughlin" from 1861 [RIVOP rename]; expand +0.15. | NEW | S |
| 1862 | Summer | Dixmont Asylum; West Penn Goes to War | SPAWN | West Penn institution state "military" 1862–1865: disables its [HEALTHR] effect. Dixmont off-map: headline. | NEW | S |
| 1862 | Autumn | Allegheny Arsenal Explosion | SPAWN, DECISION | Arsenal structure (existing landmark) shows ruin stage 1862–1864 [INST stages]; pop −78 in Lawrenceville. Decision (any player ≥100 men): "Hire a safety inspector" = set policy.safety "basic" free for the season + rep +3; "No" (historical=1). | NEW | M |
| 1863 | Summer | Defences Thrown Up on the Hills | MOD, SPAWN | MOD output 0.6×1 (or [LABPOOL] 0.5×1). Earthworks sprites on Coal Hill and Herron Hill 1863–1866 (optional). | NEW | S |
| 1864 | Winter | Iron Wages Tied to Iron Prices | MOD, UNLOCK | wage 1.04×60 DONE. Unlock WageLevel "sliding" (steel only): wageMult = current price/base price, labour +5 target, strike ×0.8 [POLICYOPT]. | PARTIAL | M |
| 1865 | Spring | The War Ends | MOD, DECISION | End war mods early (remove "Civil War Begins" mods) [MODCLEAR]. Decision (steel): "Retool for rails" $20k×era, price ×1.1 to 1873 (≈32 seasons) via [INDMOD]; "Carry on" (historical=0). | NEW | M |
| 1865 | Spring | Coal and Iron Police Authorized | MOD, UNLOCK | strike 0.85×260 DONE (applies to all). Unlock action/policy "Company police": $1k×era/season, strike ×0.7, deaths ×1.5 in strikes, rep −2/season; blocked ≥1935 (Pinchot) [POLICYOPT]. | PARTIAL | M |
| 1865 | Summer | Observatory Given to the University | FLAVOUR | Allegheny Observatory is north of map edge (40.48N). Headline only; donation = existing "donate" action. | NEW | – |
| 1867 | Summer | Allegheny Commons Laid Out | SPAWN | PARKS "Allegheny Commons" year 1867. Land value effect via recomputeLandValue already reads parks? (not verified) | DONE (features.ts PARKS) | – |
| 1867 | Summer | Vulcan Locals Collapse | MOD | wage 0.97×16, strike 0.85×8 (steel only would be [INDMOD]; acceptable global). | NEW | S |
| 1867 | Winter | Hell with the Lid Off | MOD+ | If player pollution output top-third: reputation −5 one-off [METERFX conditional]. Night view: FLAVOUR. | NEW | S |
| 1868 | Summer | The City Annexes the East End | CIVIC | Boundary already annexes Lawrenceville, East Liberty, Hazelwood 1868 (districts.ts MUNI). Taxes/police on works: needs [TAXES]; skip until a tax model exists. | PARTIAL (boundary DONE) | L (taxes) |
| 1869 | Spring | Westinghouse Patents the Air Brake | UNLOCK, DECISION | Metalworks: decision "License air-brake work" $10k×era → metalworks price ×1.08 for 40 seasons [INDMOD]; "Decline" (historical=1). | NEW | M |
| 1869 | Spring | Heinz Bottles Horseradish | MOD+ | Glass price ×1.05 for 8 seasons [INDMOD]. | NEW | S (after INDMOD) |
| 1869 | Autumn | Westinghouse Air Brake Company | RIVAL | New RivalDef "wab", metalworks, entry 1869 (or 1870), site = new landmark Allegheny City riverfront (Isabella/Federal St), style innovator. | NEW | S (+landmark) |
| 1869 | Autumn | Pennsylvania Female College Founded | SPAWN | Institution in Shadyside (40.449,−79.925), 2×2 [INST]. | NEW | S |
| 1870 | Spring | The Monongahela Incline Opens | SPAWN | INCLINES id 1 year 1870; HILLSIDES Mt. Washington 1870. | DONE (features.ts) | – |
| 1870 | Spring | Black Men Regain the Vote | CIVIC, FLAVOUR | No ward politics model. Optional: influence actions +10% if group 4 share near works >10% [WARDS]. Recommend FLAVOUR. | NEW | – |
| 1871 | Spring | Saturday Half-Holiday | UNLOCK | New policy flag halfHoliday (from 1871): wpu ×1.04 (output cost), strike ×0.9, participation +5%, labour target +5 [POLICYOPT]. | NEW | M |
| 1871 | Summer | Frick Coke Company | MOD+ | Coke/coal input price ×0.9 for steel (and power) 400 seasons [GOODPRICE]; steel has no coke good (inputs ore/coal/limestone) → apply to coal. | NEW | M |
| 1871 | Winter | The South Side Joins the City | CIVIC | Birmingham annexed 1872 (= Winter 1871 game year). Taxes as 1868. | PARTIAL (boundary DONE) | L (taxes) |
| 1872 | Spring | Edgar Thomson Works Begun | RIVAL, SPAWN | carnegie entryYear 1872 DONE. Add construction phase: r.building until 1875 → output 0, construction sprite [RIVOP building]. | PARTIAL | M |
| 1872 | Summer | National Tube Works, McKeesport | RIVAL | New RivalDef "ntube", steel (pipe), entry 1872, site "McKeesport", style steady. McKeesport HILLSIDES 1885 already; optional HILLSIDES weight bump. Conflicts with mellon site "McKeesport" (spawnRivals picks nearby). | NEW | S |
| 1873 | Autumn | Panic of 1873 | MOD, DECISION | price 0.7×16, wage 0.85×16 DONE. Decision (any, ≥100 men): "Cut wages 10%" policy.wages step down, strike ×2×4; "Hold wages" labour +10, wage 1/0.85 for you ×8 (historical=0). | PARTIAL | S |
| 1875 | Autumn | First Rail at Edgar Thomson | RIVAL, UNLOCK | ET production starts (end of building phase [RIVOP]). Bessemer tech already 1868 (industries.ts) → no unlock needed; see Doubts. | PARTIAL | S |
| 1875 | Winter | Heinz Goes Bust | FLAVOUR | UI tip if cash<0 during an active price<0.8 mod; bankruptcy exists (game.ts redSeasons/RECEIVERSHIP). | PARTIAL | S |
| 1876 | Summer | Amalgamated Association Founded | MOD, UNLOCK, DECISION | wage 1.05×60, strike 1.2×60 DONE; union stance unlock at 1876 DONE (setPolicy gate). Decision (steel/metalworks ≥ DECISION_MEN): "Sign the scale" union=recognise; "Refuse" union=fight (historical=0 sign—most mills signed). | PARTIAL | S |
| 1877 | Spring | Duquesne Incline Opens | SPAWN | INCLINES id 3 year 1877. | DONE (features.ts) | – |
| 1877 | Summer | Great Railroad Strike | MOD, SPAWN, DECISION | strike 4×2 DONE. Rail capacity 0 for 1 season [RAILOUT]. Ruin sprite at 28th St yards 1877–78 [INST]. Decision (any with dock): "Ship by river" river cost ×1.3, rail need moved to river; else rail-borne inputs 50% short (historical=1). | PARTIAL | M |
| 1878 | Autumn | Pittsburgh Catholic College Founded | SPAWN | Institution on the Bluff (40.4365,−79.9905) [INST]. | NEW | S |
| 1878 | Winter | Pittsburgh & Lake Erie Completed | INFRA | railLines id 11 year 1879 (= Winter 1878) DONE. "Cheaper rates near P&LE": rail cost ×0.85 for works whose nearest open line is id 11 [RAILRATE]. | PARTIAL | M |
| 1880 | Spring | New Immigrants from Eastern Europe | MIGRATE | Slovak/Hungarian/Polish/Rusyn waves start 1875–80; ANCHORS prefs from 1878–85; twin/onion churches via communityBuildings. | DONE (ancestry.ts, town.ts) | – |
| 1880 | Spring | Mellon Money Backs Frick | UNLOCK, FLAVOUR | "loan" action already exists (blocked until mellon rival active, 1869). Either FLAVOUR or move mellon entry/loan gate to 1880 (see Doubts). | DONE (rivalai.ts loan) | S |
| 1880 | Summer | City's First Electric Company | UNLOCK | Power: dc_dynamo tech 1882 exists. Optionally move to 1880 or price ×1.1 for power 20 seasons [INDMOD]. | PARTIAL | S |
| 1880 | Autumn | The Magee–Flinn Ring | CIVIC, DECISION | Any player. "Pay the ring" $5k×era/yr flag ring → lobby/bribe +50% influence, projects cost −10% [FLAGS]; "Refuse": project costs +10% until 1902 (historical=0). | NEW | M |
| 1881 | Spring | Homestead Works Opens | RIVAL | frick rival entryYear 1881 at "Homestead Works site". | DONE (rivals.ts frick) — naming doubt | – |
| 1881 | Spring | Air Brake Moves to Allegheny | RIVAL | wab expand +0.3 [RIVOP]. | NEW | S |
| 1881 | Summer | Union Switch & Signal | RIVAL | New RivalDef "uss", metalworks, 1881, site new landmark Swissvale (40.423,−79.884), steady (or treat as wab expand). | NEW | S |
| 1881 | Winter | Frick Meets Carnegie | RIVAL, DECISION | carnegie: input ×0.85 (rival cost; rivals have no cost model → expand +0.15) [RIVOP]. Decision (steel): "Sign Frick coke contract" coal input ×0.88 400 seasons [GOODPRICE], union stance locked to fight/tolerate while contract (Frick's say) [FLAGS]; "Buy on the open market" frick corner-coke move hits you ×1.5 more often (historical=1). | NEW | M |
| 1882 | Spring | Courthouse Fire Moves the University | SPAWN | Courthouse structure (existing landmark) → ruin stage 1882–1888 [INST stages]; Western University institution ends 1882. | NEW | S |
| 1883 | Spring | St. Anthony's Chapel | SPAWN | Institution on Troy Hill (40.4605,−79.9870), church sprite [INST]. Pilgrims: FLAVOUR. | NEW | S |
| 1883 | Summer | The New Smithfield Street Bridge | INFRA | bridges id 3 stage 1883 "lenticular". | DONE (map bridges stages) | – |
| 1883 | Summer | Pittsburgh Plate Glass Founded | RIVAL | ppg entryYear 1883 DONE; site Lawrenceville (Creighton is off-map; see Doubts). Price competition via marketFactor DONE. | DONE (rivals.ts ppg) | – |
| 1883 | Autumn | The Pittsburgh Proclamation | MOD | strike 1.15×8. | NEW | S |
| 1883 | Winter | February Flood | FLOOD | flood 0.6 (Feb 1884 = Winter 1883). | DONE (events.ts) | – |
| 1884 | Spring | Natural Gas Boom | MOD, UNLOCK | pollution 0.6×24 DONE. Glass gas_furnace (1883) exists; add gas-firing tech for steel/power/metalworks (1884, efficiency +0.1, pollution −0.3) or a waste-policy option [TECHDATA]. | PARTIAL | S |
| 1884 | Summer | Carrie Furnaces Built | RIVAL | New RivalDef "carrie" steel (furnaces), 1884, site "Rankin", steady; later merge into carnegie (1898). | NEW | S |
| 1884 | Autumn | Shadyside Nursing School | FLAVOUR | Headline; optional Shadyside Hospital institution [INST]. | NEW | S |
| 1885 | Autumn | Davis Island Dam Opens | INFRA | riverCapacity ohio 12k→30k and allegheny 8k→16k at 1885 already. Optional: Summer low-water factor 0.8→0.9 for ohio gateway from 1885 [RIVERSEASON]. | DONE (freight.ts riverCapacity) | S (optional) |
| 1885 | Winter | Westinghouse Electric Founded | RIVAL | westinghouse entryYear 1886 (= Winter 1885). | DONE (rivals.ts) | – |
| 1886 | Spring | Open Hearths at Homestead | UNLOCK, RIVAL | open_hearth tech year 1890; move to 1886 [TECHDATA] or give frick rival tech early [RIVOP tech]. | PARTIAL | S |
| 1886 | Summer | Jones & Laughlin Makes Steel | RIVAL | rivalTechs gives jl bessemer from 1870 already (techsForYear year−2). Add per-rival tech delay: jl bessemer from 1886 [RIVOP tech]. | PARTIAL | S |
| 1886 | Autumn | Allegheny General Hospital | SPAWN | Institution in Allegheny City (40.457,−80.003) [INST] + [HEALTHR]. | NEW | S |
| 1887 | Spring | New City Charter | CIVIC | If ring flag (1880): bribe cost ×1.25, bribe influence ×1.25 [FLAGS]. Else FLAVOUR. | NEW | S |
| 1888 | Summer | Pittsburgh Reduction Company | RIVAL | New RivalDef "alcoa", metalworks, 1888, site Strip District (new landmark), innovator; closes 1891 [RIVOP close]. | NEW | S |
| 1888 | Autumn | New Allegheny County Courthouse | SPAWN | Courthouse structure stage "Richardson" from 1888 (ruin ends) [INST stages]. | NEW | S |
| 1888 | Autumn | First Aluminum Poured | UNLOCK | Metalworks tech "aluminum" (1888, cost 80k, capacity +0.3, quality 1) [TECHDATA]. | NEW | S |
| 1888 | Autumn | H.J. Heinz Company | MOD+ | Glass price ×1.06 for 12 seasons [INDMOD]. | NEW | S |
| 1889 | Spring | Johnstown Flood | DECISION | Any player. "Send relief" $5k×era, rep +6, labour +3; "Nothing" (historical=0). Off-map; no flood here. | NEW | S |
| 1889 | Spring | Braddock Carnegie Library Dedicated | SPAWN, DECISION | Spawn CivicSub.Library at Braddock landmark (rival-owned) [INST]. Decision prompt for existing fundLibrary (from 1880, $40k, rep +10 target) — add strike ×0.9 while c.library. | PARTIAL (fundLibrary exists) | S |
| 1889 | Summer | Highland Park Assembled | SPAWN | Highland Park reservoir is at/over the north edge (40.48N); add PARKS entry clipped (lat 40.474, r 400, year 1893). | NEW | S |
| 1889 | Autumn | Schenley Park Given to the City | SPAWN | PARKS "Schenley Park" 1889. | DONE (features.ts) | – |
| 1889 | Winter | Carnegie Library of Allegheny | SPAWN | CivicSub.Library on Allegheny Commons edge (40.4530,−80.0060) [INST]. | NEW | S |
| 1890 | Spring | Electric Trolleys Arrive | INFRA | commute.ts streetcars 1890–1955 already extend reach. | DONE (commute.ts modeCost) | – |
| 1890 | Autumn | McKinley Tariff | MOD | price 1.1×16 DONE but applies to all industries; restrict to steel+glass [INDMOD]. | PARTIAL | S |
| 1891 | Spring | Morewood Massacre | MOD, MOD+ | strike 2×1 DONE. Coal input ×1.15 for 1 season for steel [GOODPRICE] (or MOD input 1.1×1 now). | PARTIAL | S |
| 1891 | Summer | Aluminum Moves to New Kensington | RIVAL | alcoa closes, footprint → vacant (Use.Open), jobs leave [RIVOP close]. | NEW | M |
| 1891 | Summer | Dravo Founded | RIVAL | dravo entryYear 1891. | DONE (rivals.ts) | – |
| 1891 | Autumn | AC Power at Telluride | FLAVOUR | ac_system tech already 1886 (industries.ts); headline only. | DONE (tech exists) | – |
| 1892 | Spring | "57 Varieties" | MOD+ | Glass price ×1.05 for 8 seasons [INDMOD]. | NEW | S |
| 1892 | Spring | Medical College Joins the University | FLAVOUR | Headline only. | DONE (headline) | – |
| 1892 | Summer | Battle of Homestead | MOD, DECISION | strike 3×4; decision "homestead1892" (3 options, historical=1); rival frick/carnegie output 0 in 1892 (game.ts rivalPlants). | DONE (events.ts, business.ts DECISIONS, game.ts) | – |
| 1892 | Summer | Attempt on Frick | MOD | strike 0.8×2 (order after Homestead mod; multiplicative fine). | NEW | S |
| 1892 | Summer | Carnegie Steel Company Formed | RIVAL | Merge frick (Homestead) into carnegie as one rival with 2 works; shared expand/damage; no Duquesne rival exists [RIVMERGE]. | NEW | L |
| 1892 | Autumn | West Penn Nursing School | MOD+ | West Penn [HEALTHR] strength 0.5→0.4. | NEW | S |
| 1892 | Autumn | Homestead Strike Called Off | MOD, SPAWN | wage 0.92×60, strike 0.7×60 DONE. Militia sprite at Homestead 1 season: skip/FLAVOUR. | DONE (events.ts) | – |
| 1892 | Winter | Homestead Charges Dropped | FLAVOUR | Headline only. | DONE (headline) | – |
| 1893 | Spring | Anti-Pinkerton Act | MOD+ | pinkertons action cost ×1.5 from 1893 (year check in ACTIONS cost). | NEW | S |
| 1893 | Spring | Westinghouse Lights the World's Fair | RIVAL | westinghouse expand +0.3 [RIVOP]; marketFactor then lowers power prices automatically. | NEW | S |
| 1893 | Summer | Panic of 1893 | MOD, SPAWN | price 0.72×12, wage 0.85×12 DONE. Soup kitchens: FLAVOUR. | DONE (events.ts) | – |
| 1893 | Summer | Highland Park Opens | SPAWN | Same PARKS entry (year 1893). | NEW | S |

## 1893 – 1918

| Year | Season | Event | Mechanisms | Concrete spec | Status | Effort |
|---|---|---|---|---|---|---|
| 1893 | Autumn | Braddock Library Doubled | SPAWN | Braddock Carnegie library is not on the map at all (first built 1889). Add LANDMARK "Carnegie Library of Braddock" CivicSub.Library, size 2, 40.4065,-79.8655, year 1889; this event upgrades it to size 3. | NEW | S |
| 1893 | Winter | Phipps Conservatory Opens | SPAWN | LANDMARK "Phipps Conservatory", new sprite `conservatory` (glasshouse), size 3, 40.4390,-79.9470, inside PARKS Schenley Park. | NEW | M (sprite) |
| 1894 | Spring | Coal Miners' Strike | MOD | events.ts `output 0.85 ×2`. Optional: add `input 1.1 ×2` (coal short = dear). | DONE (events.ts) | S |
| 1894 | Summer | Riverview Park Given | FLAVOUR | Park is at ~40.484 N, north of the map edge (40.477). Headline only. | NEW | – |
| 1894 | Autumn | Croatian Fraternal Union | MIGRATE, SPAWN | GROUPS[9].hall is already "Croatian Fraternal Union", but no anchor in Allegheny City has a Croat pref, so it never appears. Add ANCHORS pref `[CROAT, 4, 1890]` to Troy Hill/Deutschtown (St. Nicholas Croatian parish, East Ohio St.), and force one CivicSub.Hall eth=9 there this season. | PARTIAL (hall type exists) | S |
| 1894 | Autumn | Mellon Joins the University Board | UNLOCK | New Public action "Endow the university" (from 1894): cost 10000×era, reputation +6, influence +3; sets `c.endowedUniv`, which halves the cost of "Hire engineers" (1912). | NEW | S |
| 1895 | Summer | Niagara Power Plant | UNLOCK | Add power tech `transmission` "Long-distance AC transmission", year 1896, cost 120000, 6 seasons, requires ac_system, capacity +0.5. Rivals get it via techsForYear automatically. | NEW | S |
| 1895 | Autumn | Carnegie Institute Opens | SPAWN | LANDMARK "Carnegie Institute" new sprite `museum` (or Library size 3), 40.4436,-79.9496, Oakland. | NEW | M (sprite) |
| 1895 | Autumn | Pittsburgh Symphony Founded | UNLOCK | Not a decision (doesn't touch the works). New Public action "Sponsor the orchestra" (1895+): cost 4000×era, reputation +4, influence +4; while sponsoring, Mellon loan interest 25% → 20%. | NEW | S |
| 1895 | Winter | Boss Magee Offers a Zoo | FLAVOUR | Highland Park (~40.48 N) is off the north edge; no trolley-line model. Headline only. | NEW | – |
| 1896 | Spring | Union Railroad Opens | INFRA | map json railLines["2"] "Union Railroad" year 1896 already opens and adds rail capacity. | DONE (mon-valley.json railLines) | – |
| 1896 | Spring | Westinghouse–GE Patent Truce | RIVAL | "Smaller price swings" has no model. Instead: from 1896 Westinghouse's innovator move "sued you over his patents" is disabled (flag `patentTruce`) — power players stop paying patent suits. | NEW | S |
| 1896 | Summer | Union Revival Crushed | MOD | No union-lodge model. `strike 0.85 ×16` (district unions beaten); headline covers the rest. | NEW | S |
| 1897 | Summer | J&L Refuses the Union | DECISION | Who: labourIndustry(g) and policy.union ≠ "fight". Options: (0) Follow J&L: union→fight, wages step down, labour −15, influence +5 [historical]; (1) Stay with the Amalgamated: union→recognise, labour +10, influence −8. Rival jl gets no mechanic (no rival union state). | NEW | S |
| 1897 | Summer | Washington Takes the Mon | INFRA | Toll factor on COST.river for gateway upper_mon: ×1.15 before Summer 1897, ×1.0 after (i.e. Mon barges ~13% cheaper from now). | NEW | S |
| 1898 | Spring | Lawrenceville Library Opens | SPAWN | LANDMARK "Lawrenceville Branch Library" CivicSub.Library size 1, 40.4655,-79.9605. | NEW | S |
| 1898 | Summer | Highland Park Zoo Dedicated | FLAVOUR | Off the north edge. Headline only. | NEW | – |
| 1898 | Summer | Mesta Machine Company | RIVAL | New RivalDef `mesta` "Mesta Machine Company", figures ["George Mesta"], metalworks, entryYear 1898, style "steady" (heavy machinery). Site: no "West Homestead" landmark — add one (40.399,-79.912) in mapgen or use "Homestead" (search radius 24 tiles reaches it). | NEW | S (M if new landmark) |
| 1898 | Summer | Carnegie Buys the Carrie Furnaces | RIVAL | rival carnegie `expand(+0.15)`; headline. No Carrie site exists separately (Rankin). | NEW | S |
| 1898 | Autumn | Homestead Library Opens Above the Mill | SPAWN | LANDMARK "Carnegie Library of Homestead" CivicSub.Library size 3, 40.3995,-79.9015 (Munhall hilltop). | NEW | S |
| 1898 | Autumn | First Women Graduates | FLAVOUR | Headline only. | DONE (headline) | – |
| 1898 | Winter | Mellon Line Buys Kenny's Grove | SPAWN | Add PARKS entry "Kenny's Grove" 40.3875,-79.8625, radius 150 m, year 1898 (Kennywood replaces/enlarges it 1899). Trolley extension: no line model, skip. | NEW | S |
| 1898 | Winter | West End Library Opens | SPAWN | LANDMARK "West End Branch Library" CivicSub.Library size 1, 40.4415,-80.0335. | NEW | S |
| 1899 | Spring | Boss Quay Acquitted | CIVIC | Weak. Flag `stateStalled` 8 seasons: "Lobby City Hall and Harrisburg" gives half influence; tariff/locks (federal) unaffected. Could be FLAVOUR. | NEW | S |
| 1899 | Spring | Homestead Lodge Snuffed Out | RIVAL, MOD+ | rival frick (sited at "Homestead Works site") damage 0.5 ×1 "lockout". Local labour pool: +300 men job-seekers in Homestead zone for 1 season (place-scoped migrants), or skip. | NEW | S (+M for place pool) |
| 1899 | Summer | Kennywood Opens | SPAWN | PARKS "Kennywood" 40.3875,-79.8625, radius 300 m, year 1899 (supersedes Kenny's Grove; needs amusement-park sprite variant). Weekend crowds = street life only. Picnic action text says "Kennywood" before 1899 — make it year-aware. | NEW | S (M for sprite) |
| 1899 | Summer | Dippy Found in Wyoming | FLAVOUR | Headline only. | DONE (headline) | – |
| 1899 | Autumn | National Tube Trust | RIVAL | No National Tube rival. The McKeesport rival is `mellon` (metalworks, financier). Either (a) new RivalDef `national_tube` steel/metalworks entry 1899 at "McKeesport" style steady, starting expand 0.3, or (b) mellon expand +0.2. Prefer (a). | NEW | S |
| 1899 | Autumn | Pittsburgh Coal Company | MOD (MOD+ later) | `input 1.04 ×40`. Better as coal-only price (GOOD_PRICE coal ×1.06 ×40). | NEW | S |
| 1899 | Winter | Carnegie Steel Clears $21 Million | FLAVOUR | Optional UI: Markets view draws a "Carnegie Steel 1899: $21M" benchmark line beside your yearly profit. | NEW | M (UI) |
| 1900 | Spring | No Union Steel Left | MOD | events.ts `wage 0.95 ×40`. | DONE (events.ts) | – |
| 1900 | Summer | PPG Rules Plate Glass | RIVAL, MOD+ | rival ppg `expand(+0.2)`; IND_PRICE glass ×0.95 ×12. | NEW | S |
| 1900 | Summer | American Bridge Company | RIVAL | New RivalDef `ambridge` "American Bridge Company", metalworks, entry 1900, site "Lawrenceville" (Carnegie's Keystone Bridge shops), style steady; joins US_STEEL group in 1901. | NEW | S |
| 1900 | Autumn | Carnegie Technical Schools Founded | SPAWN | LANDMARK "Carnegie Technical Schools" CivicSub.School ×3 tiles (or `campus` sprite), 40.4433,-79.9436, Oakland. | NEW | S (M sprite) |
| 1900 | Winter | Spindletop Gusher | FLAVOUR | Texas oil doesn't feed Pittsburgh furnaces (they burn coal and natural gas); no oil good. Headline only. | NEW | – |
| 1901 | Spring | U.S. Steel Formed | RIVAL, DECISION | RIVAL: owner group `usSteel` = carnegie (+frick, national_tube, ambridge, clairton if added): renamed "U.S. Steel (…Works)", refuse acquisition ("Morgan sells to no one"), no rival actions against each other, style carnegie aggressive→steady (Gary's price leadership). DECISION (steel/metalworks, ≥250 men): (0) Stay independent [historical, like J&L]: US Steel price war price ×0.94 ×4; (1) Join the "Gary dinners" price pact: price ×1.04 ×40, undercut action blocked 40 seasons, influence −5; (2) Sell your second works (if any) to Morgan at 1.5× acquisitionQuote. NOT "sell the company" (see Doubts). | NEW | L (owner groups) + S decision |
| 1901 | Spring | Magee Dies; the Ripper Act | CIVIC, MOD+ | Project costs ×1.15 for 8 seasons for projects inside Pittsburgh city limits (cityName = Pittsburgh). Needs project-cost modifier. | NEW | M |
| 1901 | Spring | Carnegie's Lawyer Goes to Washington | FLAVOUR | No antitrust mechanic. Headline only. | NEW | – |
| 1901 | Summer | Union Rejects Half a Loaf | MOD | events.ts `strike 4 ×1`. | DONE (events.ts) | – |
| 1901 | Autumn | 1901 Steel Strike Collapses | MOD | events.ts `wage 0.95 ×40, strike 0.7 ×32`. | DONE (events.ts) | – |
| 1901 | Winter | Pittsburgh Railways Formed | INFRA | Streetcars already exist 1890–1955 (town.ts modeCost walk 0.55). From 1902: streetcar factor 0.55→0.5 (transfers, unified fare). No fare model. | PARTIAL | S |
| 1902 | Autumn | Phipps Botany Hall | SPAWN | Extend "Phipps Conservatory" landmark by 1 tile (or FLAVOUR). | NEW | S |
| 1903 | Spring | "Pittsburg: A City Ashamed" | CIVIC | BRIBE_RISK: bribe exposure chance 0.2 → 0.3 from 1903 (permanent baseline). | NEW | S |
| 1903 | Summer | Duquesne Light Formed | RIVAL | New RivalDef `duquesne_light` power, entry 1903, site "The Point (Pittsburgh)", style steady. Gives Power a second rival (marketFactor then responds to it). | NEW | S |
| 1903 | Autumn | The First World Series | MOD+ | Weak. METER labour +2 one-off (no morale meter). Could be FLAVOUR. | NEW | S |
| 1903 | Autumn | U.S. Steel Comes to Clairton | RIVAL | New RivalDef `clairton` "Clairton Works (Crucible / U.S. Steel)", steel, entry 1903, site "Clairton", style steady, in usSteel group. Clairton town (districts 1903) and Clairton hillside (features 1903) already open that year. | NEW | S |
| 1903 | Winter | Harwick Mine Disaster | MOD | `input 1.08 ×1` (GOOD_PRICE coal later). | NEW | S |
| 1904 | Spring | Carnegie Hero Fund | FLAVOUR | Headline only. | DONE (headline) | – |
| 1904 | Spring | Wabash Terminal Opens | INFRA, SPAWN | railLines["5"] "Wabash Pittsburgh Terminal" year 1904 already opens (+rail capacity). Missing: Wabash Bridge (1904–1948) in bridges data, and a terminal building downtown (LANDMARK `terminal` sprite, 40.4380,-80.0050). | PARTIAL | M |
| 1905 | Spring | Dippy Goes to London | FLAVOUR | Headline only. | DONE (headline) | – |
| 1905 | Summer | J&L Builds at Aliquippa | RIVAL, MOD+ | rival jl `expand(+0.2)` (off-map capacity); IND_PRICE steel ×0.97 ×20. | NEW | S |
| 1905 | Summer | Ambridge Incorporated | RIVAL, MOD+ | rival ambridge `expand(+0.2)`; IND_PRICE metalworks ×0.97 ×20. | NEW | S |
| 1905 | Winter | Reform Mayor Guthrie | CIVIC | BRIBE_RISK: "Bribe an official" blocked 16 seasons ("Reform mayor: no one at City Hall will take it"). | NEW | S |
| 1906 | Summer | Westinghouse Research Department | UNLOCK | RESEARCH_BOOST: new project/action "Found a research department" (power works only, 1906+): cost 60000×era; that works' research seasons ×0.75. | NEW | S |
| 1906 | Winter | Aluminum Company of America | FLAVOUR | No aluminum good or product line (metalworks inputs are iron, coal). Headline only. | NEW | – |
| 1906 | Winter | Gulf Oil Corporation | MOD+ | Mellon loan interest 25% → 20% from 1907 (loan action and financier move). | NEW | S |
| 1907 | Spring | St. Patrick's Day Flood | FLOOD | events.ts `flood 0.35`. | DONE (events.ts) | – |
| 1907 | Spring | Dippy Comes Home | FLAVOUR | Headline only. | DONE (headline) | – |
| 1907 | Summer | Carrie Furnaces 6 and 7 | RIVAL | rival carnegie (US Steel) `expand(+0.1)`. | NEW | S |
| 1907 | Summer | Puddlers Secede | MOD+ | `strike 0.85 ×20` only at steel works without bessemer (iron works); fallback plain MOD `strike 0.95 ×20`. | NEW | S (M scoped) |
| 1907 | Autumn | Panic of 1907 | MOD | events.ts `price 0.8 ×6`. | DONE (events.ts) | – |
| 1907 | Autumn | Westinghouse Loses His Empire | RIVAL | rival westinghouse: no expand moves for 8 seasons (flag `noExpandUntil`), or damage 0.9 ×8. | NEW | S |
| 1907 | Winter | Allegheny City Annexed | CIVIC | districts.ts MUNI "Allegheny City" annexed [1907, "Pittsburgh"]; boundaries redraw. | DONE (districts.ts) | – |
| 1907 | Winter | Darr Mine Disaster | MOD (MIGRATE optional) | `input 1.08 ×1`. Migrant pulse is historically weak (see Doubts); if wanted: MIGRATE Rusyn(8) 150, Hungarian(7) 100, Slovak(5) 100 to Homestead/McKeesport. | NEW | S |
| 1907 | Winter | University Buys Oakland Land | SPAWN | Reserve tiles (Use.Landmark, empty lot) at 40.4445,-79.9540, size 4, so the town doesn't build there before 1909. | NEW | S |
| 1908 | Spring | The Pittsburgh Survey | DECISION (MOD+ done) | Reputation part exists: business.ts targets() gives −8 for twelve-hour day and −6 for no safety from 1908. DECISION who: hours = "twelve" and totalEmployees ≥ 250. Options: (0) Keep twelve hours, say nothing [historical]: reputation −5; (1) Ten-hour day: hours→ten, labour +10, reputation +5; (2) Buy the newspapers (press effect free for 8 seasons), influence −5. | PARTIAL | S |
| 1908 | Spring | University of Pittsburgh Named | FLAVOUR | Headline only. | DONE (headline) | – |
| 1908 | Summer | Wabash Railroad Fails | FLAVOUR | Don't close the line: it kept running (as Pittsburgh & West Virginia). Headline only (see Doubts). | NEW | – |
| 1908 | Autumn | Marianna Mine Explosion | MOD | `input 1.06 ×1`. | NEW | S |
| 1908 | Winter | Clean Water at Last | EPIDEMIC (scoped), — | environment.ts drinkingRisk already filters from 1908 (×0.35, ×0.1 from 1915), lifting health. "Epidemic losses halved" would need EPIDEMIC_SCOPE but the only later epidemic is influenza (airborne) — skip. | PARTIAL (environment.ts) | – |
| 1909 | Summer | Pressed Steel Car Strike | MOD | events.ts `strike 2 ×2`. | DONE (events.ts) | – |
| 1909 | Summer | Forbes Field Opens | SPAWN | LANDMARK "Forbes Field", new sprite `ballpark`, size 3, 40.4446,-79.9566. | NEW | M (sprite) |
| 1909 | Summer | U.S. Steel Goes Open Shop | MOD | events.ts `strike 1.5 ×6`. | DONE (events.ts) | – |
| 1909 | Autumn | Pirates Win the World Series | MOD+ | As 1903: labour +2 one-off, or FLAVOUR. | NEW | S |
| 1909 | Autumn | Pitt Moves to Oakland | SPAWN | Build on the 1907 reserved lot: LANDMARK "University of Pittsburgh" `campus` sprite (or CivicSub.School ×4), 40.4445,-79.9540. | NEW | S (M sprite) |
| 1910 | Spring | Westmoreland Coal Strike | MOD | events.ts `output 0.9 ×5`. Optional add `input 1.05 ×5`. | DONE (events.ts) | – |
| 1910 | Spring | Shooting at Yukon | MOD | `strike 1.5 ×1`. | NEW | S |
| 1910 | Spring | Councilmanic Graft Scandal | CIVIC | If `biz.record` has "Bribe an official" since 1900: 50% chance fine 10000×era, reputation −15, influence −15, headline "Graft Exposed". | NEW | S |
| 1910 | Spring | Pittsburgh Courier Founded | MIGRATE | ANCHORS Hill District: add pref `[BLACK, 6, 1910]` (before the existing `[BLACK, 14, 1916]`). | NEW | S |
| 1910 | Summer | George Westinghouse Ousted | RIVAL | Per-rival style override in RivalState: westinghouse innovator→steady from 1910. Side effect: standardTechs for Power falls back to year−4 (see Doubts). | NEW | S |
| 1910 | Winter | Tin-Plate Strike Broken | MOD | `wage 0.97 ×8, strike 0.8 ×8`. | NEW | S |
| 1911 | Summer | Small Council Charter | CIVIC | Weak. From 1911: bribe gives +12 influence (was +20); lobby's reputation weighting ×2. Could be FLAVOUR. | NEW | S |
| 1911 | Winter | West Penn Moves to Bloomfield | SPAWN | LANDMARK "West Penn Hospital", new sprite `hospital`, size 2, 40.4616,-79.9460. | NEW | M (sprite) |
| 1912 | Spring | Homestead Grays | MIGRATE | ANCHORS Homestead: add `[BLACK, 3, 1912]` (retention before the 1916 wave). "Morale" has no meter. | NEW | S |
| 1912 | Summer | The Hump Cut | FLAVOUR | Terrain/elevation is static (USGS); lowering Grant's Hill means mutable terrain. Headline only. | NEW | – (L if built) |
| 1912 | Autumn | Carnegie Tech Grants Degrees | UNLOCK | RESEARCH_BOOST: standing policy "Hire Tech engineers" (1912+): 2×era $ per worker-hundred per season; all research seasons ×0.8 (half cost if endowedUniv). | NEW | S |
| 1912 | Autumn | Bull Moose Carries Pennsylvania | CIVIC | BRIBE_RISK: exposure chance +0.15 for 16 seasons. | NEW | S |
| 1913 | Autumn | Mellon Institute Founded | UNLOCK | RESEARCH_BOOST: action "Contract industrial research" (1913+): pay 40% of the current project's techCost, its remaining seasons halved. | NEW | S |
| 1914 | Summer | War in Europe | MOD | events.ts `price 1.3 ×16, migrants 0.3 ×16`. | DONE (events.ts) | – |
| 1915 | Summer | Donora Zinc Works Opens | FLAVOUR | Off-map (Donora is south of Clairton). Headline only. | DONE (headline) | – |
| 1915 | Summer | High-Voltage Ring | UNLOCK | Add power tech `hv_ring` "69 kV transmission ring", year 1915, cost 300000, 8 seasons, requires steam_turbine, capacity +0.5. | NEW | S |
| 1915 | Autumn | Votes for Women Defeated | FLAVOUR | Headline only. | DONE (headline) | – |
| 1916 | Spring | The Great Migration Begins | MIGRATE, SPAWN | ancestry.ts already has Black wave bell(1922) and ANCHORS BLACK prefs from 1916 at Hill (14), Homestead, Hazelwood, Braddock, McKeesport, Clairton; town.ts communityBuildings raises AME churches and Elks halls. Missing: Beltzhoover anchor (40.4155,-79.9985) `[BLACK, 6, 1916]`. | PARTIAL (ancestry.ts, town.ts) | S |
| 1916 | Spring | Streetcar Strike | MOD | `output 0.97 ×1` (three days). | NEW | S |
| 1916 | Spring | Battle of Braddock | MOD (RIVAL optional) | events.ts `strike 3 ×1`. Optional: rival westinghouse damage 0.7 ×1 (the strike was at its East Pittsburgh works). | DONE (events.ts) | S |
| 1916 | Summer | Clairton Coke Works | RIVAL | rival clairton (needs 1903 def) `expand(+0.3)`; it then pollutes more via its plant. | NEW | S |
| 1916 | Autumn | Schenley High School | SPAWN | LANDMARK "Schenley High School" CivicSub.School size 2, 40.4516,-79.9555. | NEW | S |
| 1917 | Spring | America Enters the War | MOD | events.ts `price 1.25 ×7, output 1.1 ×7` — but the output part never acts (see Doubts). | DONE (events.ts) | – |
| 1917 | Summer | Air Brake Buys Union Switch | FLAVOUR | Neither company is a rival. Headline only. | NEW | – |
| 1918 | Summer | Wartime Aluminum Boom | FLAVOUR | No aluminum; war price mods already run. Headline only. | NEW | – |
| 1918 | Autumn | Influenza | EPIDEMIC | events.ts `epidemic 0.03` (game.ts applies ×2 to tiles over 30 people). | DONE (events.ts) | – |

## 1918 – 1952

| Year | Season | Event | Mechanisms | Concrete spec | Status | Effort |
|---|---|---|---|---|---|---|
| 1918 | Autumn | Armistice | MOD | The boost already ends: "America Enters the War" (Spring 1917, 7 seasons) lapses at Autumn 1918. Optional: `price 0.92, 2` for the cancelled orders. | DONE (implicit, events.ts dur 7) | S |
| 1919 | Spring | Neville Island Shipyard | RIVAL | Dravo is already on-map (Allegheny City, 1891), so model the off-map yard as `dravo` expand +0.3. If you play metalworks: `price 0.97, 8` (metalworks scope). | NEW | S (expand) / M (scope) |
| 1919 | Summer | Pennsylvania Ratifies the 19th | FLAVOUR | Headline only. | DONE | – |
| 1919 | Summer | Fannie Sellins Murdered | MOD | `strike 1.3, 1` (Brackenridge is off-map, so no place-based unrest). | NEW | S |
| 1919 | Autumn | Great Steel Strike | MOD, DECISION | `strike 8, 2` plus the `strike1919` decision. | DONE (events.ts, business.ts DECISIONS) | – |
| 1919 | Autumn | Mother Jones Jailed in Homestead | DECISION, MOD+ | Who: `labourIndustry` and union≠recognise. **Ban meetings** (historical): `blacklistUntil=turn+4`, labour −10, reputation −6. **Allow**: `strike 1.2, 2`, labour +5, influence −3. This lands in the same season as the Great Steel Strike decision, so it needs a decision queue. | NEW | M |
| 1919 | Winter | Prohibition | SPAWN, MOD+ | Existing saloons and taverns (ShopSub.Saloon/Tavern) get a shuttered or speakeasy look from 1920 to 1933. One-off labour −3. New saloons are already blocked. | PARTIAL (town.ts:719) | M |
| 1919 | Winter | Frick Leaves a Park | SPAWN | Reserve the Frick Park circle (no new houses) from 1920; the park still opens in 1927. | PARTIAL (features.ts PARKS 1927) | S |
| 1920 | Autumn | KDKA Goes on the Air | UNLOCK | New Public action "Advertise on the radio" (from 1920): cost 4000×era, pushes `price 1.04, 4` (Source "Radio advertising"). Can't stack while active. | NEW | M |
| 1921 | Spring | Immigration Restricted | MOD, MIGRATE | `migrants 0.6, 400`; the European waves ×0.3 are in ancestry. | DONE (events.ts, ancestry.ts european) | – |
| 1921 | Spring | Mellon at the Treasury | MOD (proxy) | No tax system. Proxy: `price 1.02, 46` (to 1932), or leave as FLAVOUR. A real profit tax is L. | NEW | S (proxy) / L (tax) |
| 1921 | Autumn | Robert Morris Founded | FLAVOUR | Headline only. | DONE | – |
| 1922 | Spring | Coal Strike of 1922 | MOD | `output 0.85, 2`. | DONE (events.ts) | – |
| 1922 | Summer | Emsworth Replaces Davis Island | FLAVOUR | No change (Ohio capacity has no 1922 step). | DONE | – |
| 1923 | Summer | Eight-Hour Day | MOD | `wage 1.1, 200`. | DONE (events.ts) | – |
| 1923 | Winter | Liberty Tubes Open | INFRA, SPAWN | Two tunnel portals as landmarks (N 40.4290,-80.0090; S 40.4210,-80.0130). Commute link through Mt. Washington from 1924 (block-cost shortcut). New hillside/suburb "South Hills (Beechview–Dormont)" 40.405,-80.030, r 1200 m, year 1924, peak 1955, weight 1.4. | NEW | M |
| 1924 | Spring | National Origins Act | MOD, MIGRATE | `migrants 0.7, 400`; the European waves ×0.05 are in ancestry. | DONE | – |
| 1925 | Summer | Coke Centralized at Clairton | MOD+, RIVAL | Steel only: coal input ×0.92 for the rest of the game (steel has no coke good; inputs are ore/coal/limestone). `frick` expand +0.2, and Frick's "corner the coke" move chance ×0.5 from 1925. | NEW | M |
| 1925 | Autumn | Pitt Stadium Opens | SPAWN | Landmark "Pitt Stadium", 40.4445,-79.9625, 5×5, clears homes. | NEW | S (after landmark system) |
| 1925 | Winter | Mellon Tax Cuts | MOD | `price 1.05, 12`. | DONE (events.ts) | – |
| 1926 | Summer | Cathedral of Learning Begun | SPAWN, DECISION | Landmark at 40.4443,-79.9533, 2×2, staged: site 1926, frame 1931, tower 1937. Decision for steel players: **Donate the steel** (historical): cost 15000×era, reputation +8, influence +4. **Decline**: no effect. | NEW | M |
| 1927 | Spring | County Parks Open | SPAWN | Add PARKS {South Park, 40.300,-79.995, 1200 m, 1927} (clipped by the map's south edge). North Park is off-map: headline only. | NEW | S |
| 1927 | Spring | Loew's Penn Theatre | SPAWN | Landmark "Loew's Penn", 40.4430,-80.0010, 1×2, downtown. | NEW | S |
| 1927 | Autumn | Gasometer Explosion | SPAWN | New blast effect at 40.4515,-80.0275: radius 250 m clears buildings to rubble; radius 800 m −30% pop; 28 deaths logged; ruin landmark for 8 seasons. | NEW | M |
| 1928 | Spring | Liberty Bridge Opens | INFRA | Bridge id 4, year 1928, in map JSON. | DONE | – |
| 1928 | Summer | The Three Sisters | INFRA | Bridge ids 19/20/23 get suspension stages in 1928. | DONE | – |
| 1928 | Winter | John Barkoski Beaten to Death | CIVIC, MOD+ | Pinkerton (company police) action cost ×1.25 from 1929; one-off labour −3, `strike 1.2, 2`. | NEW | M |
| 1929 | Spring | Musmanno's Crusade | CIVIC | Pinkerton cost ×1.25 again (×1.56 total). | NEW | S (after action-rule table) |
| 1929 | Summer | Metropolitan Pittsburgh Rejected | FLAVOUR | Boroughs already stay separate (districts.ts has no county merge). | DONE | – |
| 1929 | Autumn | The Crash | MOD | `price 0.6, output 0.55, migrants 0.3, 28`. | DONE (events.ts) | – |
| 1929 | Autumn | Ohio River Canalized | INFRA | Capacity is done. Add an Ohio river freight cost ×0.85 from 1929 (`COST.river` per gateway). | PARTIAL (freight.ts:39 capacity) | S |
| 1929 | Autumn | Mount Mercy College | FLAVOUR | Headline only. | DONE | – |
| 1931 | Spring | Pinchot Strips the Private Police | MOD, CIVIC | `strike 1.2, 400` exists. Also move the `pinkertons` block from 1937 to 1931 ("No police commissions"). | PARTIAL (events.ts) | S |
| 1931 | Summer | Charity Hospital in Hard Times | DECISION | Who: any company with ≥100 men. **Give relief**: cost 6000×era, labour +10, reputation +5, flag `reliefGiven` → participation +5% from 1936 to 1940. **Refuse** (historical): labour −5. | NEW | M |
| 1931 | Autumn | County Airport Dedicated | SPAWN | Landmark "Allegheny County Airport", 40.3544,-79.9302, 8×8 runway sprite, clears farms. | NEW | S–M |
| 1931 | Winter | Father Cox's Army | DECISION | Who: any company. **Donate to relief**: cost 3000×era, reputation +6, labour +3. **Ignore** (historical): reputation −2. | NEW | S |
| 1931 | Winter | Impeach Mellon! | FLAVOUR | Headline only. | DONE | – |
| 1932 | Spring | Greenlee Field Opens | SPAWN | Landmark "Greenlee Field", 40.4523,-79.9712, 4×4, Hill District. | NEW | S |
| 1932 | Autumn | The Forbes Field Promise | FLAVOUR | Headline only. | DONE | – |
| 1933 | Summer | Section 7(a) | MOD | `strike 1.5, 8`. | DONE (events.ts) | – |
| 1933 | Autumn | Clairton Strike | MOD | `strike 2, 1`. | DONE (events.ts) | – |
| 1933 | Autumn | Mill Organizing Drives | MOD, DECISION | `strike 1.3, 6`. Who: `labourIndustry`, union≠recognise. **Company union (ERP)** (historical): flag `companyUnion`, strike ×0.6 to Summer 1935, then ×1.4 until recognise/1937. **Let them organise**: labour +6, `strike 1.2, 4`. **Fire the card-signers**: blacklist 8 seasons, labour −12, reputation −5. | NEW | M |
| 1933 | Autumn | Ambridge Massacre | MOD | `strike 2, 1`. | DONE (events.ts) | – |
| 1933 | Autumn | Captive Mines Strike | MOD | `output 0.9, 1`. | DONE (events.ts) | – |
| 1933 | Autumn | Democrat McNair Elected Mayor | CIVIC | Political era → "democratic" from 1934: `bribe` influence +20→+8 and exposure chance 0.2→0.3 until 1946; `lobby` text says "Democratic organisation". | NEW | M |
| 1933 | Winter | Repeal | SPAWN, MOD+ | Undo the Prohibition sprites; one-off labour +3. Saloon building resumes in 1933. | PARTIAL (town.ts:719) | S (with Prohibition) |
| 1934 | Spring | Mesta Builds the Irvin Works | RIVAL | Needs a `mesta` rival (metalworks, 1898, West Homestead). `mesta` expand +0.2. Optional: Irvin strip-mill rival works at 40.330,-79.890 (1938). | NEW | S (after Mesta rival) |
| 1934 | Summer | Steel Strike Called Off | MOD | `strike 0.7, 2`. | NEW | S |
| 1934 | Autumn | Democrats Take Harrisburg | CIVIC | From 1935: `strikebreakers` cost ×1.5. Pinkerton/strike-breaking decision options lose their state-police help (strike lasts +1 season). | NEW | M |
| 1934 | Autumn | Penn State Comes to McKeesport | SPAWN | Landmark "Penn State McKeesport", 40.3480,-79.8480, 2×2. | NEW | S |
| 1935 | Summer | The Wagner Act | MOD | `wage 1.05, 400`. | DONE (events.ts) | – |
| 1935 | Summer | Coal and Iron Police Abolished | CIVIC | `pinkertons` blocked for good (with Pinchot it's already blocked from 1931; set the message). End "Coal and Iron Police Authorized" `strike 0.85` here (it now lapses Spring 1930). | PARTIAL (business.ts blocks ≥1937) | S |
| 1935 | Autumn | CIO Formed | MOD+ | Conditional mod: `strike 1.25` while union≠recognise, until Spring 1937 (6 seasons). | NEW | S–M |
| 1936 | Spring | St. Patrick's Day Flood | FLOOD | `flood 0.35`. | DONE (events.ts) | – |
| 1936 | Summer | Steel Workers Organizing Committee | MOD | The CSV says "existing", but **there is no EFFECTS entry**. Add `strike 1.4, 3`. | NEW | S |
| 1936 | Summer | Flood Control Act | FLOOD+ | New `floodProtection(year)`: random floodRisk ×0.5 and event floods `1−(1−f)×0.5` from 1940 (Hurricane Agnes 1972 0.6 → 0.8). | NEW | S–M |
| 1936 | Autumn | McNair Quits | FLAVOUR | Headline only. | DONE | – |
| 1937 | Spring | Big Steel Signs | MOD, DECISION | `wage 1.15, 200` plus the `swoc1937` decision. | DONE (events.ts, business.ts) | – |
| 1937 | Spring | The Aliquippa Case | CIVIC | From now on: `blacklist` blocked ("NLRB: illegal"), `companyUnion` flag cleared, `lockout` blocked unless on strike. With union=fight, strike ×1.2 extra. | NEW | M |
| 1937 | Summer | Death on the Beaver Falls Picket | MOD | `strike 1.5, 1`. | NEW | S |
| 1937 | Summer | Little New Deal | MOD, CIVIC | `wage 1.03, 400`; `strikebreakers` cost ×1.5 (×2.25 with Harrisburg). | NEW | S–M |
| 1937 | Autumn | Housing Authority Founded | UNLOCK, SPAWN | From 1938, the town grower may replace the most crowded blocks (crowd >0.6, near jobs) with a public housing project (new HouseSub, 3×3, pop cap ×1.3, health +). About 1 project per 3 years in the city. | NEW | L |
| 1937 | Autumn | Mellon Institute Building | SPAWN | Landmark "Mellon Institute", 40.4462,-79.9510, 2×3. | NEW | S |
| 1937 | Autumn | Fallingwater | FLAVOUR | Off-map; headline only. | DONE | – |
| 1938 | Spring | Alcoa Antitrust Suit | CIVIC | Rivals never buy works, so the suggestion has nothing to act on. Instead: player `buy` price ×1.3 and +15 influence needed, 1938–1941. | NEW | S |
| 1938 | Summer | Tygart Dam Completed | FLOOD+ | `floodProtection` ×0.9 from 1938 (Mon floods aren't modelled separately). | NEW | S (with Flood Control) |
| 1938 | Autumn | Heinz Memorial Chapel | SPAWN | Landmark "Heinz Chapel", 40.4446,-79.9512, 1×1. | NEW | S |
| 1939 | Autumn | War in Europe Again | MOD | `price 1.15, 9`. | DONE (events.ts) | – |
| 1939 | Autumn | Buhl Planetarium Opens | SPAWN | Landmark "Buhl Planetarium", 40.4517,-80.0062, 1×2, North Side. | NEW | S |
| 1940 | Spring | Lawrence on Trial | FLAVOUR | Headline only. | DONE | – |
| 1940 | Autumn | Pennsylvania Turnpike Opens | INFRA | Rail freight cost ×0.9 from 1940 (`COST.rail`). No truck mode. | NEW | S |
| 1940 | Autumn | Roosevelt Dedicates Terrace Village | SPAWN | Public housing project at 40.4455,-79.9680, about 10×6 tiles, clears Hill District rowhouses, rehouses ~80% of pop (Black group weight). | NEW | M (L with Housing Authority) |
| 1941 | Summer | Smoke Ordinance Passed | FLAVOUR | Log/warning if your works' pollution is in the top quartile or waste=dump: "Smoke control in 1946." | NEW | S |
| 1941 | Winter | Pearl Harbor | MOD | `price 1.3, output 1.15, 15`. | DONE (events.ts) | – |
| 1941 | Winter | Double V | FLAVOUR | Headline only. | DONE | – |
| 1942 | Spring | United Steelworkers of America | CIVIC, MOD+ | If union=recognise: wage policy locked to market (the union scale ×1.08 stays), strikeMult ×0.85. | NEW | M |
| 1942 | Spring | Dravo Wins the First "E" | DECISION, RIVAL | `dravo` expand +0.5. Who: you own a metalworks works. **Bid for war orders** (historical): metalworks `price 1.2, output 1.1, 14`, `wage 1.1, 14` (labour shortage), labour −3. **Stay in civilian work**: none. | NEW | M |
| 1943 | Spring | Allegheny Conference Formed | DECISION | Who: company with ≥500 men. **Join** (historical): cost 10000×era, reputation +6, influence +8, your works' pollutionMult ×0.85 (new company flag; regional mod untouched). **Stay out**: influence −4. | NEW | M |
| 1943 | Summer | Mesta's Big Guns | RIVAL, MOD+ | `mesta` expand to 1.0. Metalworks `price 0.95, 8`. | NEW | S (after Mesta + industry scope) |
| 1945 | Summer | Victory | MOD | `price 0.9, 2`. Also trim Pearl Harbor to 14 seasons so the war boost ends here. | NEW | S |
| 1945 | Autumn | Lawrence Elected Mayor | CIVIC | Political era → "renaissance" from 1946: `lobby` influence ×1.25; unlocks URA renewal (see URA). | NEW | M |
| 1945 | Winter | Postwar Steel Strike | MOD | `strike 8, 1`. | DONE (events.ts) | – |
| 1945 | Winter | Westinghouse Strike | MOD+ | Now global `strike 3, 2`; should be power only. Steel players get it from Postwar anyway. | PARTIAL (events.ts) | S (with industry scope) |
| 1946 | Spring | Mounted Police at East Pittsburgh | FLAVOUR | East Pittsburgh is just off-map east; headline only. | DONE | – |
| 1946 | Autumn | Smoke Control Enforced | MOD | `pollution 0.45, 400`. | DONE (events.ts) | – |
| 1946 | Autumn | Duquesne Light Strike | MOD | `output 0.9, 1`. | DONE (events.ts) | – |
| 1946 | Autumn | Urban Redevelopment Authority | UNLOCK, CIVIC | New Politics action "Ask the URA to clear a block" (from 1946, influence ≥20): clears a chosen 4×4 slum/warehouse block near downtown or your works and frees land for expand/found. Cost influence 20, reputation −2 per 500 displaced. | NEW | L |
| 1947 | Spring | The Pittsburgh Package | MOD+ | Per-place pollution: tiles outside the Pittsburgh municipality ×0.85 from 1947 (the 1946 mod is regional, so the city then sits lower). | NEW | M |
| 1947 | Summer | Taft-Hartley | MOD | `strike 0.85, 400`. | DONE (events.ts) | – |
| 1948 | Summer | Elrama Power Plant | MOD+ | Off-map: power `price 0.93, 400` (no Duquesne Light rival). | NEW | S (with industry scope) |
| 1948 | Autumn | Donora Smog | MOD+ | Reputation target −8 for waste=dump and −3 for standard, 16 seasons (timed term in `targets()`). | NEW | S–M |
| 1948 | Winter | Television Arrives | FLAVOUR | Headline only. | DONE | – |
| 1949 | Autumn | CIO Expels the UE | MOD+ | Power `strike 0.7, 4`. | NEW | S (with industry scope) |
| 1949 | Autumn | Steel Pension Strike | MOD | `strike 6, 1`, `wage 1.05, 400`. | DONE (events.ts) | – |
| 1949 | Winter | Homer Brown Takes the Bench | FLAVOUR | Headline only. | DONE | – |
| 1950 | Spring | Renaissance I | SPAWN | Clear warehouses in the Point triangle (Use.Commerce/Warehouse inside r 350 m of 40.4415,-80.0110). Add PARKS {Point State Park, 40.4418,-80.0115, 200 m, 1950}. Landmarks "Gateway Center" ×3 office towers, 40.4410,-80.0060, 1952–53. | PARTIAL (skyline office growth after 1945, town.ts:799) | M |
| 1950 | Spring | City Population Peaks | FLAVOUR | REGION_POP already peaks in 1950 and falls after. | DONE (features.ts) | – |
| 1950 | Spring | The Cvetic Hearings | FLAVOUR | Headline only. | DONE | – |
| 1952 | Spring | Truman Seizes the Mills | MOD | `strike 6, 2`. | DONE (events.ts) | – |
| 1952 | Spring | Greater Pittsburgh Airport Opens | FLAVOUR | Moon Township is off-map. | DONE | – |
| 1952 | Summer | The 50,000-Ton Press | RIVAL, MOD+ | `mesta` expand +0.2 (cap 1). Metalworks `price 0.97, 12`. | NEW | S (after Mesta + industry scope) |

## 1952 – 1985

| Year | Season | Event | Mechanisms | Concrete spec | Status | Effort |
|---|---|---|---|---|---|---|
| 1952 | Autumn | Conemaugh Dam Completed | FLOOD, INFRA | C1: Allegheny-floodplain flood mult ×1.15 milder (i.e. damage ×0.85) and seasonal floodRisk ×0.85 on Allegheny tiles, permanent | NEW | M |
| 1953 | Summer | Parkway and Squirrel Hill Tunnel | SPAWN, INFRA, MIGRATE | C9: road Parkway East, Point→Squirrel Hill tunnel→east edge; car cost on its blocks 0.15. C8-lite: growth bias +east suburbs, city-ward pull −5% for 40 turns | NEW | L |
| 1954 | Spring | WQED on the Air | FLAVOUR | Headline only | DONE (no effect entry) | – |
| 1954 | Winter | Turnpike Reaches Ohio | INFRA, MOD+ | C11: off-map trucking: rail and river freight cost ×0.92 for shippers west (ohio gateway) and rail capacity share ×0.9, permanent. Weak; see Doubts | NEW | M |
| 1955 | Spring | Salk Vaccine Works | FLAVOUR | Headline only (optional: epidemic events impossible after) | DONE | – |
| 1955 | Autumn | Long Westinghouse Strike | MOD+, RIVAL, DECISION | C2: `strike` ×6, 2 turns, power only. Rival westinghouse damage 0.5, 2 turns. DECISION (power works ≥250 men): A Settle early: wages up a step, labour +10, strike ends; B Wait it out (historical): strikeTurns=2, labour −15 | NEW | M |
| 1956 | Summer | Lower Hill Cleared | SPAWN, MIGRATE | C8: clear houses within 350 m of 40.4425,−79.9930 (Lower Hill), ~8,000 people moved: 50% Homewood, 30% East Liberty, 20% Hill upper. Group 4 mostly. Tiles to vacant (arena site, C7) | NEW | M |
| 1956 | Summer | Port Authority Created | FLAVOUR | Headline only (prerequisite flag for 1964) | DONE | – |
| 1956 | Summer | Summer Steel Strike | MOD | `strike` ×6, 1 turn | DONE (events.ts) | – |
| 1957 | Winter | Shippingport Atomic Power | UNLOCK | Tech `nuclear` (power, year 1957, $6M, 16 seasons) | DONE (industries.ts:96) | – |
| 1958 | Spring | Regional Parks Planned | FLAVOUR | All six parks lie beyond the map bounds (−80.08…−79.83, 40.28…40.48). At most an edge marker; not worth building | NEW | S |
| 1958 | Autumn | Lawrence for Governor | FLAVOUR | Headline only. Optional C13: influence carried by the machine continues | DONE | – |
| 1959 | Spring | ALCOSAN Cleans the Rivers | MOD+ | C14: town sewage load (SEWAGE_K) ×0.25, permanent; drinkingRisk falls with it | NEW | S |
| 1959 | Summer | 116-Day Strike | MOD, DECISION | Mods `strike` ×10 2t, `price` ×0.9 12t. DECISION strike1959 (hold out → priceLoss +0.03). Imports already start 1960 in `imports()` | DONE (events.ts; business.ts DECISIONS) | – |
| 1959 | Summer | Fort Pitt Bridge Opens | SPAWN | Span "Fort Pitt Bridge", stage 1959 arch, in map data | DONE (mon-valley.json spans/bridges) | – |
| 1959 | Autumn | Khrushchev Visits Mesta | FLAVOUR | Headline only | DONE | – |
| 1960 | Autumn | Mazeroski's Home Run | MOD+ | C4: labour +3; C5: unrest −0.05 map-wide, 1 turn | NEW | S |
| 1960 | Autumn | Fort Pitt Tunnel Opens | SPAWN, INFRA | C9: tunnel portal at 40.4335,−80.0270 linking the bridge to the west edge; car cost 0.15 | NEW | M (after C9) |
| 1960 | Autumn | Point Park College | FLAVOUR | Headline only | DONE | – |
| 1961 | Spring | County Labor Council | MOD+ | C15: for 1961+, a strike at any works (player or rival, C12) raises `strike` ×1.5 for 1 turn at the player's other works within 8 km. Simpler fallback: `strike` ×1.1 permanent (MOD, S) | NEW | M |
| 1961 | Autumn | Civic Arena Opens | SPAWN | C7: landmark "Civic Arena" 6×6 tiles at 40.4410,−79.9890, on the 1956 cleared tiles | NEW | M |
| 1963 | Summer | Dorothy Six Lit | RIVAL, DECISION | C12: needs a U.S. Steel/Duquesne Works rival at "Duquesne Works site" (landmark exists, no rival); expand +0.3. DECISION (steel works with open_hearth, no bof): A Modernise: start `bof` now at full cost (techCost), B Keep open hearths (historical): nothing now, price penalty comes from techStanding | NEW | M |
| 1963 | Autumn | La Roche and Pitt-Greensburg | FLAVOUR | Headline only (both off-map) | DONE | – |
| 1964 | Spring | Port Authority Takes the Wheel | INFRA, CIVIC | C10: streetcar lines become dated objects; from 1964 close one line every 4–8 turns until only South Hills lines are left in 1985; inclines become public (no change to cost) | NEW | L |
| 1964 | Winter | Westinghouse Record Sales | RIVAL, MOD+ | westinghouse expand +0.2 (cap 1); C2: power `price` ×0.95, 8 turns | NEW | S |
| 1965 | Summer | Pitt Chancellor Ousted | FLAVOUR | Headline only | DONE | – |
| 1965 | Autumn | Kinzua Dam Completed | FLOOD, INFRA | C1: Allegheny flood damage ×0.7 and floodRisk ×0.6 from here on (stacks with Conemaugh) | NEW | S (after C1) |
| 1966 | Summer | Pitt Becomes State-Related | FLAVOUR | Headline only | DONE | – |
| 1966 | Autumn | Community College Founded | UNLOCK | C16: action "Retrain laid-off men" (Labour group): $800×era per 100 men; keeps them in the local pool for 8 turns (migrants-out suppressed near works); labour +3. Depends on a layoff concept (C16) | NEW | M |
| 1966 | Autumn | The Courier Closes | FLAVOUR | Headline only | DONE | – |
| 1967 | Summer | Carnegie Mellon University | FLAVOUR | Headline only | DONE | – |
| 1967 | Summer | Mesta Unionized | RIVAL, DECISION | C12: Mesta rival (proposed for 1898 row; not in rivals.ts) gets damage 0.95 for 8 turns (labour costs). DECISION (metalworks works ≥250 men, union ≠ recognise): A Recognise (historical): union=recognise, labour +15; B Resist: union=fight, `strike` ×2 4t, labour −10 | NEW | M |
| 1967 | Winter | Mister Rogers' Neighborhood | FLAVOUR | Headline only | DONE | – |
| 1968 | Spring | The Hill Burns | SPAWN, MIGRATE, MOD+ | C8: ~60 commerce/house tiles in Hill District (anchor) and Homewood (C6, 40.4560,−79.8980) set to ruin/vacant; pop −10% there; 30% of burned shops never rebuild (block regrowth 40 turns). C5: unrest +0.2 there, 4 turns | NEW | M |
| 1968 | Spring | LTV Buys Jones & Laughlin | RIVAL, DECISION | C12: jl `techFreeze`=1968 (rivalTechs uses min(year,1968)); jl expand frozen. DECISION (any player company, cash flow positive, ≥1960): A Accept a conglomerate buyout: cash +acquisitionQuote-style value×0.6 of own works now, then all future profits −30% (owner draws) and techs frozen; B Stay independent (historical for player): nothing | NEW | M |
| 1968 | Summer | Boyce Park Dedicated | FLAVOUR | Off-map (Monroeville/Plum) | DONE | – |
| 1968 | Summer | Air Brake Sold | FLAVOUR | Wilmerding is just east of the map edge and Air Brake is not a rival. Headline only | DONE | – |
| 1968 | Autumn | Bidwell Training Center | MOD+ | C5-like: North Side (Allegheny City municipality) unrest −0.05, 20 turns. Weak; FLAVOUR is acceptable | NEW | S |
| 1968 | Winter | PPG Industries | RIVAL | Optional rename of ppg to "PPG Industries" from 1968 (C12 rename-by-year) | NEW | S |
| 1969 | Spring | Hartwood Acres Offered | FLAVOUR | Off-map | DONE | – |
| 1969 | Summer | Black Monday Shutdowns | DECISION, MOD+ | Public construction halt: no lobbying/locks action for 1 turn (CIVIC). DECISION (any works ≥250 men): A Open the skilled trades: recruits.push([4, 300]), labour −5 now, reputation +6; B Keep them closed (historical): reputation −4, `strike` ×1.3 2t | NEW | M |
| 1969 | Autumn | "Nobody's Boy" Elected | CIVIC | C13: 1970–1977: lobby/bribe gain ×0.6 for city matters; bribe exposure chance 0.2→0.35; locks/tariff unaffected (federal) | NEW | M |
| 1970 | Summer | Three Rivers Stadium | SPAWN | C7: landmark "Three Rivers Stadium" ~8×8 tiles at 40.4467,−80.0158 (North Side shore) | NEW | M |
| 1970 | Autumn | Burn Unit at West Penn | FLAVOUR | Headline only | DONE | – |
| 1971 | Autumn | Pirates Win Again | MOD+ | C4 labour +3; C5 unrest −0.05, 1 turn | NEW | S |
| 1971 | Autumn | Heinz Hall Opens | SPAWN | C7: re-skin a downtown commerce tile at 40.4425,−80.0005 as "Heinz Hall" | NEW | S (after C7) |
| 1972 | Summer | Hurricane Agnes | FLOOD | `flood: 0.6`. With C1, Allegheny tiles get Kinzua's damping (historically it cut the crest) | DONE (events.ts) | – |
| 1972 | Summer | Slag Dumping Ends | MOD+, SPAWN | C3: steel works `input` ×1.03 permanent (slag haul); `waste: "dump"` fine chance already ×0.35 from 1972 (business.ts). Nine Mile Run is east of Frick Park on the map: stop slag-pile growth there if slag is drawn (it is not: no slag tiles in code) | PARTIAL | S |
| 1972 | Autumn | Clairton Consent Decree | MOD, DECISION | `pollution` ×0.9 400t DONE. DECISION (works with `byproduct_coke`): A Sign the decree: cash −$2M×era spread as 40 turns of extra cost, waste→abate, reputation +8; B Fight it in court (historical? no: USS signed, so A is historical): 30% chance per year of fine $500k×era until 1982, reputation −6 | PARTIAL | M |
| 1972 | Winter | The Immaculate Reception | MOD+ | C4 labour +3; C5 unrest −0.05, 1 turn | NEW | S |
| 1973 | Spring | State Sues U.S. Steel | MOD+ | C3: from 1973, each season any player works whose local air (env.air at works block) > threshold (e.g. 70th percentile) pays fine $50k×era, reputation −3 | NEW | M |
| 1973 | Spring | The No-Strike Deal | MOD, DECISION | Mods `strike` ×0.3 40t, `wage` ×1.08 40t DONE (flat 8%, not 3%/yr). DECISION (steel works ≥250 men): A Join ENA (historical): keep the mods; B Bargain alone: cancel the two mods for the player, `strike` ×1.5 8t, wages unchanged. Needs a per-company mod opt-out | PARTIAL | M |
| 1973 | Autumn | Oil Crisis | MOD+ | C2: steel `price` ×0.9 8t (car-steel demand); all works `input` ×1.15 8t | NEW | S |
| 1974 | Summer | Point State Park Fountain | SPAWN | Add PARKS entry {Point State Park, 40.4416,−80.0122, r 250 m, year 1974} (features.ts) plus fountain sprite at the tip | NEW | S |
| 1974 | Summer | Braddock Library Closes | SPAWN, DECISION, MOD+ | C7: Braddock library civic tile → boarded state. C5: Braddock unrest +0.05. DECISION (any player company): A Fund the repairs: −$150k×era, reputation +6, library stays open (skips 1983 event); B Let it close (historical) | NEW | M |
| 1974 | Autumn | "A National Disgrace" | MOD | `pollution` ×0.8 400t | DONE (events.ts) | – |
| 1974 | Winter | Super Bowl Champions | MOD+ | C4 labour +3; C5 unrest −0.05, 1 turn | NEW | S |
| 1975 | Spring | Gulf Payments Scandal | MOD+ | If `biz.record` has "Bribe an official" since 1965: 40% chance of a fine of $100k×era, reputation −15, influence −20, headline | NEW | S |
| 1975 | Autumn | Clairton Air Crisis | DECISION, MOD+ | DECISION (works with `byproduct_coke`, or steel works if no coke tech is modelled): A Cut output by half for one turn (C3 output 0.5 on those works); B Run on (historical USS position): fine $1M×era, reputation −12. Also C5: Clairton health −0.1, 1 turn | NEW | M |
| 1975 | Autumn | Westinghouse Uranium Crisis | RIVAL | westinghouse damage 0.7, 12 turns (marketFactor raises the power price automatically) | NEW | S |
| 1976 | Spring | Volkswagen Picks New Stanton | MOD | `migrants` ×0.85 8t (skilled men leave). New Stanton is off-map | NEW | S |
| 1976 | Autumn | Beaver Valley Nuclear Plant | MOD+, RIVAL | C2: power `price` ×0.92 permanent. Duquesne Light is not a rival; a modifier is enough | NEW | S |
| 1976 | Winter | Speaker Irvis | FLAVOUR | Headline only | DONE | – |
| 1977 | Spring | Caliguiri Steps In | FLAVOUR | Headline only (ends C13 reform penalty early, optional) | DONE | – |
| 1977 | Summer | South Busway Opens | INFRA | C9: busway road south of the Mon (south edge to Smithfield St Bridge) car-speed cost; growth bias to the south-edge blocks. Most of the South Hills is beyond the map's south-west | NEW | M (after C9) |
| 1977 | Autumn | J&L Cuts Back in the City | RIVAL | C12: jl damage 0.6 permanent (partial closure); C5 South Side unrest +0.1 4t. Pop loss follows from rival jobs in `centersFor` | PARTIAL (blanket 1979 cut to 0.55) | S |
| 1978 | Spring | Renaissance II | SPAWN | town.ts downtown officeCap: add +4 office buildings over 1978–85 (raise post-1945 rate 0.8→1.5/yr from 1978) | PARTIAL (office growth exists) | S |
| 1978 | Summer | Carrie Furnaces Go Cold | RIVAL, SPAWN | No Carrie rival. Spawn C7 ruin landmark "Carrie Furnaces" at Rankin riverside (40.4130,−79.8790); Rankin jobs centre −1,000 (C12 or a fixed job-centre entry) | NEW | M |
| 1978 | Autumn | J&L Takes Youngstown Sheet & Tube | RIVAL | jl expand cannot rise again (expand frozen with techFreeze from 1968). Effectively FLAVOUR | NEW | S |
| 1979 | Autumn | City of Champions | MOD+ | C4 labour +5; C5 unrest −0.1 1t (offsets `eraGrievance` 0.25 from 1979) | NEW | S |
| 1979 | Autumn | Closures Announced | MOD, DECISION | `price` ×0.85 30t DONE. DECISION (steel works with open_hearth and no bof): A Close the oldest hearths: capacity −30% (remove one expand annex, or a C3 output mod 0.7 permanent), wage bill −30%, labour −15, C5 unrest +0.1 locally; B Keep them running (historical): nothing (losses follow from price) | PARTIAL | M |
| 1980 | Spring | City Shrinks to 424,000 | FLAVOUR | Headline plus a population chart. Needs a yearly population history (none is stored now: only `g.prices`) | NEW | S |
| 1981 | Summer | The Bottom Falls Out | MOD, DECISION | Mods `price` ×0.75 20t, `output` ×0.7 20t DONE. DECISION (any works ≥250 men): A Lay off: C16 employees −30%, labour −15, C5 unrest +0.15 near works; B Carry them: keep employees, wage bill unchanged for 4 turns, labour +10 | PARTIAL | M |
| 1982 | Spring | National Tube Curtailed | RIVAL | No National Tube rival. Mellon (metalworks) is sited at McKeesport: damage 0.5 permanent as proxy, or a fixed McKeesport job centre −2,400. C5 McKeesport unrest +0.1 | NEW | S |
| 1982 | Summer | Neville Island Yard Closes | RIVAL, DECISION | C12: dravo closes (active=false; its tiles go idle/vacant). DECISION (metalworks player): A Bid for its contracts: metalworks `price` ×1.1 8t, cash −$200k×era; B Stay out: metalworks `price` ×0.95 8t | NEW | M |
| 1982 | Summer | Westinghouse Buys Robots | UNLOCK | New tech for every industry `automation` (year 1982, $2M, 6 seasons, workersPerUnit −0.3, requires latest III tech); on completion labour −10 | NEW | S |
| 1982 | Autumn | The Andrew Project | FLAVOUR | Headline only | DONE | – |
| 1982 | Winter | Mon Valley Unemployment Peaks | SPAWN, DECISION | Vacant houses: abandon 5% of house tiles in Mon valley municipalities (Homestead, Braddock, Duquesne, McKeesport, Clairton, Rankin). C7: "food bank" tag on social halls. DECISION duplicates 1981; skip or reuse 1981 card | NEW | M |
| 1982 | Winter | Mesta Goes Bankrupt | RIVAL | C12: Mesta rival active=false, tiles idle. Needs the Mesta rival | NEW | S (after Mesta rival) |
| 1983 | Spring | East Busway Opens | INFRA | C9: busway Downtown→East Liberty→Wilkinsburg (east edge) car-speed cost | NEW | M (after C9) |
| 1983 | Summer | American Bridge Leaves Ambridge | MOD+ | C2: metalworks `price` ×0.95 permanent (shrinking market). Ambridge is off-map, no rival | NEW | S |
| 1983 | Autumn | Braddock Library Saved | SPAWN | C7: Braddock library state boarded → "children's library"; C5 Braddock unrest −0.05. Skip if the player funded repairs in 1974 | NEW | S (after C7) |
| 1984 | Spring | Duquesne Works Closes | RIVAL, DECISION | C12: Duquesne Works rival closes (blanket 1983 closure already does it a year early). DECISION (any company with cash > $5M×era): A Buy Dorothy Six with the union and town: acquire as second works at 0.3×quote; works techs = steel to `bof` without continuous_cast; labour +20; 50% chance it loses money and closes within 8 turns; B Let it go (historical) | PARTIAL | M |
| 1984 | Spring | Chevron Buys Gulf | FLAVOUR | Headline; its effect lands with the 1985 Gulf row | DONE | – |
| 1984 | Spring | LTV Steel Formed | RIVAL | C12 rename: jl displayed as "LTV Steel" from 1984 | NEW | S |
| 1984 | Spring | Light Rail Rolls | INFRA | C10: South Hills lines become light rail (keep streetcar-class cost south of the Mon). Mount Lebanon is beyond the map's south-west edge | NEW | M (after C10) |
| 1984 | Summer | Workers Buy Weirton | UNLOCK | Action "Sell the works to its workers" (from 1984, works losing money): cash +0.2×quote, wages fixed (`wage` ×0.9 24t on that works), works leaves the company (becomes neutral employer) | NEW | M |
| 1984 | Winter | Skunk Oil at Christmas | MOD+ | C5 unrest +0.1 Mon valley 2t. C4: reputation −10 if the player cut capacity/laid off (1979/1981 option A or C16) | NEW | S |
| 1984 | Winter | Pastor Roth Jailed | DECISION, MOD+ | C5 Clairton unrest +0.1 2t. DECISION (works in Clairton municipality, or any steel works): A Press charges: unrest +0.1, reputation −5, influence +5; B Meet them: reputation +5, labour +5 | NEW | M |
| 1984 | Winter | Benzene in the Mon | MOD+ | C14: one-turn river load spike ×10 below Clairton on the Mon (env.river at Clairton reach); drinkingRisk for Mon-side towns rises for that season | NEW | S |
| 1985 | Spring | Gulf Leaves Town | SPAWN | Downtown: remove 1,500 jobs from the downtown job centre; close ~6 downtown shop tiles (Commerce → vacant) | NEW | M |
| 1985 | Spring | Clergy Protest at Shadyside | MOD+ | Same as Skunk Oil: C5 unrest +0.05, C4 reputation −8 for companies with layoffs in last 8 turns | NEW | S |
| 1985 | Spring | Wheeling-Pitt Bankrupt | MOD+ | C2: steel `price` ×0.95 4t | NEW | S |
| 1985 | Spring | cmu.edu | FLAVOUR | Headline only | DONE | – |
| 1985 | Summer | The Mills Go Quiet | FLAVOUR, SPAWN | Game-end summary screen: biz.record, peak and final population (needs population history, see 1980), plus jl closure (already closed in 1983 by the blanket rule) | NEW | M |
| 1985 | Summer | Barricade at Nativity Lutheran | MOD+ | C5 unrest +0.05 Mon valley municipalities, 2t | NEW | S |
| 1985 | Summer | Service at the Steel Tower | MOD+ | C5 unrest +0.05 downtown, 2t | NEW | S |
| 1985 | Summer | Subway Opens Downtown | INFRA | C10: streetcars leave downtown; light-rail subway faster cost in downtown blocks | NEW | M (after C10) |
| 1985 | Autumn | Clairton Goes Broke | SPAWN, MOD+ | Abandon 10% of Clairton house tiles; C5 Clairton unrest +0.15 4t | NEW | S |
| 1985 | Autumn | Steel Valley Authority | UNLOCK, CIVIC | Action "Sell to the Steel Valley Authority" (1985 Autumn only, since the game ends at 1985 Winter): cash +0.25×quote instead of closing, reputation +10. Barely playable this late | NEW | S |
| 1985 | Autumn | Election Day Flood | FLOOD | `flood: 0.6` | DONE (events.ts) | – |
