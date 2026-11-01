# Interface plan

From the UI review of v0.13.0 (1 Nov 2026). Mockups and before/after screenshots:
https://claude.ai/artifact/7UsYBgPTzLkV9zYbZMQP61

**Status (v0.14.0):** built. Differences from the proposal: the supply-chain list sits at the bottom of the Works
tab (with an "on the map" link) rather than inside the map layer; "Play to next Spring" is in the ☰ menu
(Shift+Space still works); the neighbourhood panel ("what each community has built") folds into the tile card.

## Goals
One sidebar instead of two; short labels with effect chips (full text on hover); a Trends view that replaces
Markets and shows how the business is doing and what could go wrong.

## What changed
| Area | Now |
|---|---|
| Top bar | Date and era · cash · last season's profit · valley population · meter bars (Rep, Labour, Influence, Morale; hover for the word) · Trends · sound icon · ☰ (seed, new town, play to next Spring, volumes, keys, version) · speeds · Season ▶ |
| Left sidebar | Removed. Layers and view options behind the **Map** button on the map (chips grouped Land / Town / Business / Best sites, short names, full names on hover); legend under the button while a layer is on; the newspaper is a headline strip that opens the paper (back issues) with a **Ledger** tab (the old log) |
| Right tabs | **Overview · Works · Policy · Town · Rivals** |
| Overview | Before founding: industry, one-line note, name, "Show me a good site", a four-row site report, Found. After: six cards (cash and profit with sparklines, output against capacity, market share against ten years ago, price and cost per unit with margin), **Watch** (top five risks with buttons to the tab that deals with them), last season's accounts as bars, men, health and unrest |
| Works | Roads & bridges: suggested roads to large neighbourhoods and new bridges across the river (minutes saved, men gained, cost or influence; Plan… shows the route on the map, then Pay or Lobby). Each works: capacity, men, price against rivals, processes as chips (missing ones dashed), next processes as rows; build on the map; rail siding; for the town (library, steps, incline); supply chain |
| Town | Morale, jobless, teams; **Found now**: great works you can fund up to 15 years ahead of history (cost, what it gives); **Standing**: every landmark and park, yours marked, click to fly there and open its card; **Coming** |
| Policy | Actions left; policies as switches (staged, one action to apply); actions in four groups as rows with effect chips, unavailable ones folded; your record |
| Rivals | Your share bar; you and each open rival by output, with place, distance and last move; coming, closed; suppliers, customers, bank; owners and history on hover |
| Tile | The Tile panel and the ? tool are gone: a click opens the tile card (before founding, a click picks a site) |
| Trends (T) | Business: cash, revenue/costs/profit, price and cost per unit, capacity/output/men with process marks, share of the industry's output by rival (stacked), the full risk list. Prices & wages: prices by industry, wages, coal and ore, what you got against the market. Town: population, morale, jobless, your workforce's health and unrest. Ranges: all · 30 · 10 years |

## Risks (`src/ui/risks.ts`)
Strike or lockout · overdrawn (seasons left before the receivers) or losing money (cash runway) · debt · processes
behind the industry · unrest · workforce health · short of men · freight lanes over 85% full · market share down or
up by 15% over ten years · timed event effects on your industry (price, output, raw materials, wages, strikes,
freight; with their end year, or "lasting"). Worst first.

## Data recorded each season (`PricePoint`)
Added: capacity and output (total and by industry), men, cost per unit, the processes owned, each rival's output,
valley population, morale, the jobless, workforce health and unrest.

## Fixes made on the way
- Rival output (`rivalOutput` in `game.ts`) follows each rival's own processes, expansions, damage and dated
  cutbacks; the Rivals tab, supply chain and share charts all use it (before, every rival showed the same figure).
