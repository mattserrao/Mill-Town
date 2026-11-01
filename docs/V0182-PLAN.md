# v0.18.2 plan — what things are worth: valuation, selling up, the stock market, and a market that can be flooded

Follows the v0.18 review (1 Nov 2026). Three problems:
- **Value:** the game never values a works, so cash is the only score.
- **Shares:** the share prices are set in advance, so knowing history wins, and the shares are too small to matter.
- **Output:** before 1946 you can sell any amount at the same price, and rivals never react to it.

## Decisions (1 Nov 2026)
- **After selling the company:** the family plays on as investors, with holdings only, and is free to found or buy a works again at any time.
- **Going public:** the full version — outside shareholders, dividends, dilution, and a board that can force a sale or closure once the family holds under 50%.
- **The flooded market:** from 1893. Before that, demand stays unlimited as now. From 1946 the world market feeds it.
- **Share-price noise:** moderate. History is a guide; 1929 still crashes, but by how much varies from game to game.

## Where it stands (v0.18.1)
| Topic | Now | Problem |
|---|---|---|
| Value of your works | Not shown; Fortune = cash + holdings − debt | Building plant lowers your score; closing a mill costs nothing |
| Selling a works | 5 seasons of full-capacity revenue (×0.3 from 1975); first works can't be sold | Ignores profit; a cliff in 1975; no way to sell the company and move on |
| Buying a rival | 8 seasons of full-capacity revenue (×0.4 from 1975) | Buy-then-sell loses 37% whatever the works earns |
| Returns | Businesses ~24%/yr, stakes ~2.5%/yr, shares ~3%/yr + price path | Buying every business is always best |
| Shares | 8 companies on fixed price paths × a valley-wide market mood; 500 shares a year each | Hindsight wins every time; nothing in the game moves a price; too small to matter |
| Your own company | Never public | No raising money by selling shares; takeover bids have no share price behind them |
| Output and price | Price ignores how much is made; from 1946 a % cap on capacity | Unlimited demand before 1946; your expansion takes no orders from rivals; no unsold stock |
| Rivals | Output from processes, expansions and dated events | They never react to prices or to you |

## A. One valuation for everything
1. **What a works is worth**, recomputed each season:
   - earnings value = 8 × the average yearly profit over the last two years;
   - asset floor = the plant's scrap value (land, buildings and processes at about 35% of what they cost) plus any unsold stock at market price;
   - value = the greater of the two (a losing mill is worth its scrap).

   The same formula prices rivals' works (from their own simulated profit, see C) and businesses (6 × their income).
2. **Buy and sell around the value.** You pay value +10% to buy a works; you get value −10% selling one.
   - Distressed sellers (a struck or bankrupt rival) take −25%.
   - "Financier" rivals ask +20% (Mellon).
   - The fixed ×0.3 / ×0.4 cuts after 1975 go: the world market now does that through profit.
3. **Net worth everywhere:**
   - The Overview shows company value (works + holdings + cash − debt), with its trend in Trends.
   - The legacy "Fortune" score uses net worth.
   - The succession estate tax applies to net worth (as it really did).
4. **Rebalanced returns** (targets, a year):
   - businesses 8–12%, falling with their industry;
   - stakes paid from the rival's real simulated profit, so they shrink in the collapse;
   - shares about 4–5% in dividends plus growth;
   - your own works: whatever they really earn.

## B. Selling up and reinvesting
1. **Sell the company** (any season from 1880, one action), to the highest bidder:
   - a rival in the industry, at value;
   - the trust (1901–), Mellon, or after 1983 the workers or the Steel Valley Authority.

   The sale pays capital-gains tax (rates already in the game) and leaves a ledger mark with the town and the union ("sold the works to Carnegie"). The family then plays on as investors with holdings only, free to found or buy a works again.
2. **Sell one works** (as now), but at the new valuation.
   - A closed works can be **sold for scrap** at its asset floor, or its land **cleared for redevelopment**: from 1960 by the redevelopment authority, which pays for the land and brings an office park or a shopping centre later (the Homestead and South Side sites).
3. **Reinvest:**
   - found a works in any open industry, buy a rival or a stake, or buy into a listed company;
   - the Works tab shows a "Buy into…" list with each industry's open rivals and their prices;
   - modern rivals off the map stay stake-only, and hospitals are never for sale.

## C. The stock market
1. **Prices tied to the game:**
   - price = trend × the company's own simulated profit × the market mood × noise;
   - Alcoa follows the Alcoa rival, PPG follows PPG, Westinghouse follows its works and labs, and U.S. Steel follows the Carnegie / Duquesne / Clairton / National Tube works;
   - strikes, fires, takeovers and closures move them;
   - moderate noise (seeded per game) means history guides you but doesn't guarantee anything;
   - Heinz, Mellon and Gulf keep their historical paths with noise.
2. **More stocks and bigger trades:**
   - add Koppers (1929), Jones & Laughlin (1902), Mesta (1920s) and Dravo;
   - purchase limits scale with the price level, and big buys push the price up (about 1% per lot);
   - buying shares costs no action (selling never did).
3. **Margin** (1920–1934): borrow up to 90% of a purchase at the call-loan rate; margin calls when prices fall. The 1929 crash can take a leveraged family's cash and the works.
4. **Your company goes public** (from 1890). Up to 49% of the shares can be sold to raise cash at the company's value. Then:
   - outside shareholders expect a dividend each season (miss two and the price drops; miss four and the bankers or a raider move);
   - your share price is your takeover defence (a low price invites bids; the existing bid and white-knight cards use it);
   - the family can buy shares back;
   - under 50% held by the family, the board can force a sale or a closure (the closure card becomes theirs).

   This is the full version (decided).

## D. A market that can be flooded (from 1893)
1. **Demand by industry**, in tons a season by year:
   - the national market for the valley's products, grown along the century;
   - shaped by the panics (1893, 1907), the depressions (1921, 1930–33), the wars (1861–65, 1917–18, 1941–45) and the postwar boom;
   - from 1946 the world market feeds in as imports and the demand curve, replacing the percentage cap.
2. **Supply** = your output + every rival's + imports.
3. **Price follows supply against demand**, with a slow drift; it doesn't jump every season.
   - Oversupply: prices fall and unsold stock piles up at the works, shown on the map with a cost to carry it.
   - Shortage (war, a big strike, Homestead 1892): prices rise for everyone still running.
4. **Rivals react.** They expand when margins are fat, bank furnaces when prices fall, and cut prices to clear their stock (Carnegie's way).
   - Your expansion takes orders and price from them; theirs from you.
   - The rivals' dated history stays as the anchor: they can't vanish before their time or outlive their closure by long, unless you buy, save or ruin them.
5. **Your own choices:**
   - **Run** at full output, at the market's level, or banked (a policy switch).
   - **Stockpile** or dump: sell stock below the price to win share, which the other owners will answer.
6. **Knock-on effects across the valley:**
   - Heavy mill output raises coal and coke prices (Frick's lever) and wages where men are scarce.
   - The power industry's sales follow the mills' output.
   - A slump spreads to railroads, barges, shops and morale.
7. **On screen:**
   - The Works tab shows demand, supply and your stock.
   - Trends charts the market: price, demand against supply, and imports.
   - The Watch list warns of a glut.

## Order of work (one release, v0.18.2)
1. **A:** valuation, net worth, buy and sell prices, returns rebalanced.
2. **B:** selling the company and the works, scrap and redevelopment, the "Buy into…" list.
3. **C:** share prices tied to the game, more stocks, margin, going public.
4. **D:** demand and supply, stock, rival reactions, knock-on effects.
5. **Rebalance and test:** the review harness for each industry and owner style, plus a "seller" and a "speculator" owner. Then docs and the PR.
