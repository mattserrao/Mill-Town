# Historical events

`EVENTS.csv` is the master list of historical events in Mill Town. The game reads it directly.
Edit it in any spreadsheet and save it as CSV.

Columns: `Year, Season, Event Name, Description`

- Seasons run Spring (Mar–May), Summer (Jun–Aug), Autumn (Sep–Nov), Winter (Dec–Feb).
  An event in January or February belongs in the **previous** year's Winter.
- Events fire at the start of their season, shown as a headline and logged.
- Some events also change the game. The effect is matched by Event Name in `src/core/events.ts`
  (panics, wars, floods, strikes, epidemics, immigration waves, smoke control, unions).
  Renaming one of those events in the CSV removes its effect until the name in `events.ts` is updated too.
- Dates and figures are approximate.
