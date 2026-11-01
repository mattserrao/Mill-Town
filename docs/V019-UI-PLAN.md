# v0.19 plan: menu review and cleanup

Review of every menu and panel in v0.18.2 (1 Nov 2026). It's based on screenshots of a steel game in 1850 and 1925 at 1440×900.

The goal is clear, concise menus that look professional, with less on screen at once.

## What's wrong now

### 1. Too much at once
- **Top bar:** 16 items, including:
  - era and date, five speed buttons and Season;
  - head of family, cash, last season and valley population;
  - four meters, Struggle, Trends, sound and ☰.
- **Overview:** eight KPI cards. Cash and profit repeat the top bar.
- **Long tabs:**
  - Works runs about four screens: processes, building, roads and bridges, town gifts and the supply chain.
  - Town lists every great work for 15 years ahead, about 20 rows.
  - Policy has 10 switches and about 30 actions.
  - Holdings shows "Sell the company" and every business for sale, even with nothing owned.
- **Unusable options are listed anyway.** Every process and great work appears, affordable or not, plus "N unavailable" links.

### 2. Inconsistent words
- **The four meters** go by several names:
  - Opinion, which chips call Rep;
  - Union, which chips call Lab;
  - Capital, which chips call Inf; before founding, "Capital" is cash;
  - Morale, which chips call Mor.
- **Action buttons** are labelled "Do", "Place…", "Plan…", "$11k" and "+$252k", each meaning something different.
- **"Iron & Steel"** is also called "steel" and "iron & steel" in different places.
- **Overview "Market −6%"** can't be read without its fine print.

### 3. Things in the wrong place
- **On the Works tab but about the town:** roads, bridges, the library, public steps and the incline.
- **On the Policy tab but about specific rivals or politics:**
  - rival actions (undercut, poach, sabotage, buy their works);
  - politics actions, which duplicate the Fund buttons in the Struggle.
- **On the Rivals tab:** suppliers and customers.
- **In two places:** the Watch list, on the Overview and in Trends.
- **In the ☰ menu, mixed together:** saving, "Play to next Spring", sound sliders, now-playing, keyboard help and the version.
- **In the Map menu:** the view options (names, grid, animate, time of day) and nine "Best sites" layers, one per industry.

### 4. Inconsistent look
- **Five kinds of panel:**
  - the sidebar;
  - paper-style cards (decisions, the paper);
  - dark modals (Trends, Struggle);
  - the tile card;
  - the main menu.

  Each has its own header, close button and padding.
- **Small text:** monospace at 9–10 px grey for hints and chips, which is hard to read.
- **Labels that wrap badly:**
  - in the tile card: "Soot (years of smoke)", "Walk to your works";
  - the tabs "Holdings Policy" run together;
  - the works "↗" sits alone on a line.
- **The paper** opens a 480×450 panel for one two-line story.
- **Esc** saves and exits to the main menu even when an overlay is open.

### 5. Bugs spotted
- The supply chain lists "Bar iron & nails" seven times, once per customer, all with the same name.
- In the Struggle, "U.S. Steel" appears three times among the owners, once for each of its arms.
- "Resume last game" is styled as the main button when it's disabled.

## Principles
1. **One word for each thing.** The meter names, everywhere, with no abbreviations, each with a small icon.
2. **Show what you can act on now.** Hide things that are unavailable or too far in the future. "Show all (n)" brings them back.
3. **No more than about 7 rows per section** before "Show more".
4. **One action row:**
   - name, then its effects as chips, then one button;
   - the button shows the cost ("$9,500") or "Free";
   - a greyed button gives the reason on hover;
   - map placements read "Place on map".
5. **Actions live where their subject is.** Rival actions on the rival, politics in the Struggle, town gifts in Town.
6. **One overlay frame.** Title, optional tabs, ✕, and Esc closes it.

## Proposal

### A. Top bar (16 items → 4 groups)
| Group | Contents |
|---|---|
| Time | Date with the era as a small subtitle. Pause, then one speed button that cycles 1×/2×/4×/8×. Next season ▶ |
| Money | Cash, with last season's profit as a ▲/▼ underneath |
| Meters | Reputation, Labour, Influence and Morale, as icon + number with a coloured bar. Hover shows what moves each one |
| Views | Struggle, Trends, Paper (with an unread count) and ☰ |

What moves:
- Valley population goes to the Town tab.
- The family head goes to the Struggle header.
- Sound goes into ☰ → Settings.

### B. Sidebar tabs
The six tabs become **Overview · Works · Policy · Money · Town · Rivals**.

- **Overview:**
  - four cards: Net worth, Output and utilisation, Margin (price against cost), and Market (written as "Glut: 11% unsold" or "Short: prices rising");
  - Watch, limited to 5;
  - last season's P&L.
- **Works:** one card per works with its status and Run switch.
  - **Upgrades:** the next 3 processes you can buy, then "All processes (8)".
  - **Build:** expand, housing, dock, and a new works.
  - The supply chain moves to the Map layer, with each product shown once.
- **Policy:**
  - the standing switches, in two groups: Men (wages, shifts, union, safety, boys, company store, half Saturdays, police) and Works (waste, run);
  - the labour and public actions.
  - Rival and politics actions leave this tab.
- **Money** (was Holdings):
  - net worth;
  - what you own (works, businesses, stakes, shares);
  - a "Buy" sub-list in three tabs: Businesses, Stakes, Shares;
  - "Sell or list the company…" as one button that opens a dialog with the bids and the 10% sale.
- **Town:**
  - your neighbourhood and its investments;
  - roads and bridges;
  - town gifts (library, steps, incline);
  - great works, the next 5 soonest, then "All";
  - standing and coming great works, folded;
  - morale, the out of work and the sports teams.
- **Rivals:**
  - each rival as a row with a "⋯" menu for its actions (undercut, poach, rumours, drawings, sabotage, buy the works, buy a stake);
  - suppliers and customers in a folded section.

### C. Overlays
- **One frame** for Trends, the Struggle, the paper, decisions, the tile card and the main menu:
  - a header bar with the title on the left and tabs or pagination;
  - ✕ on the right;
  - Esc closes the top overlay; only with none open does it open the menu.
- **Decision cards** keep the paper style. It's the best-looking panel in the game, and the paper and the ledger use it too.
- **The paper:**
  - sized to its stories;
  - the ledger stays as a tab;
  - the issue navigation sits in the header.
- **Trends:** Watch leaves Trends, since the Overview has it. The free space goes to a larger market chart.
- **The Struggle:**
  - owners grouped by company, so U.S. Steel is one row with its arms underneath;
  - the laws listed as a table: law, status, due date, Back/Block;
  - "What the valley remembers" limited to 6 rows with "All".
- **Tile card:**
  - a fixed label column with short labels (Soot, Smoke now, Walk to works);
  - the ancestry details folded under "Communities".
- **☰ menu:**
  - Save · Load · Settings (sound, names, grid, animation, time of day) · Keys · Exit to main menu;
  - the version in the Settings footer;
  - "Play to next Spring" moves next to Season ▶ as a shift-click or long-press.
- **Map menu:**
  - layers only, in the Land, Town and Business groups;
  - "Best sites" becomes one layer with an industry picker;
  - the view options move to Settings.

### D. Type and visual polish
- **Type scale:** 11 / 12 / 14 / 18 px. No grey text under 11 px.
- **Font:** keep the monospace for numbers, headings and labels, and use a clean proportional face for running text (descriptions, Watch details, tooltips). *(See question 1.)*
- **Buttons:** three kinds: primary (gold), standard and danger (sell, sabotage, lock-out), all the same height.
- **Numbers:** one money format ($940, $9,500, $95k, $2.6M); negatives as −$11k in red; percentages without decimals.
- **Effect chips:** full meter names with icons (e.g. a shield icon with "Reputation +8"), and green or red by direction.
- **Spacing:** consistent 8 px rhythm; section headers in one style; the tabs evenly spaced.

### E. Bug fixes
- Show each supply-chain product once, with its customers listed beneath.
- Show U.S. Steel as one owner.
- Show a disabled main-menu button as disabled.
- Stop Esc from exiting while an overlay is open.

## Order of work (one release, v0.19)
1. Vocabulary, number formats, button and chip components, type scale.
2. Top bar.
3. Sidebar tabs: moves, limits and "Show all".
4. Overlay frame: Trends, the Struggle, the paper, the tile card, the ☰ and Map menus.
5. Bug fixes, screenshots at 1100, 1440 and 1920 px, then the PR.

## Decisions (1 Nov 2026, left to judgement)
1. **Font:** a proportional face (the system UI font) for running text; the monospace stays for numbers, names, labels and headings.
2. **Meter names:** Reputation / Labour / Influence / Morale everywhere, each with a small icon (star, hammer, City Hall, flag). The top bar shows the names from 1,700 px.
3. **Rival actions:** moved to a "⋯" menu on each rival's row, with the 10% stake.

## Built (v0.19.0)
Everything above, with these choices made in the build:
- Actions with no cash cost read "Free"; map placements "Place on map"; roads "Show route".
- "Your record" left the Policy tab (the paper's ledger and the Struggle keep it).
- Buying works on the Money tab is filtered by industry (your own first), so the list stays short.
- Environment actions (curtailment plans, offsets) and dumping the yards' stock moved to the Works tab.
- The family chip and the valley's population left the top bar for the Struggle header and the Town tab.
