# Historical events

`EVENTS.csv` is the master list of historical events in Mill Town. The game reads it directly.
Edit it in any spreadsheet and save it as CSV.

Columns: `Year, Season, Event Name, Description, Category, Suggested Action`

- Seasons run Spring (Mar–May), Summer (Jun–Aug), Autumn (Sep–Nov), Winter (Dec–Feb).
  An event in January or February belongs in the **previous** year's Winter.
- Category is one of: Industry, Economy, Labor, Politics, Parks, Libraries, Universities, Culture, Health,
  Infrastructure, Disaster, Society. It is shown above the headline.
- Suggested Action is a design note, not read by the game. It proposes what the event should do in play, tagged:
  **Spawn** (something appears on the map), **Rival** (an AI company acts), **Choice** (a player decision),
  **Effect** (an economy or town modifier; "Effect (existing)" means `events.ts` already does it),
  **Unlock** (a new option or technology) and **Off-map** (it happens beyond the map edge, so it acts through
  prices, rivals or migrants instead of buildings).
- Keep rows in date order (the tests check this).
- Events fire at the start of their season, shown as a headline and logged.
- Some events also change the game. The effect is matched by Event Name in `src/core/events.ts`
  (panics, wars, floods, strikes, epidemics, immigration waves, smoke control, unions, private police,
  labor law, tariffs, pollution decrees).
  Renaming one of those events in the CSV removes its effect until the name in `events.ts` is updated too.
- Dates and figures are approximate.

## Sources

The list was extended to about 400 events in October 2026 from a research pass on Pittsburgh-area
industry, labor, politics, parks, libraries, universities and civic life. `EVENTS-RESEARCH.md` has every added
event with its source and a confidence rating (High / Medium / Low), plus known date conflicts.
Roughly a quarter of the added rows are Medium or Low confidence on the exact season; check there before
relying on a date.
