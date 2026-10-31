# Blue Felt Poker

A phone-first (portrait) poker game: you vs 3 computer players, everyone starts with $1,000.

- **Two games:** Texas Hold'em or Five Card Draw. Pick one at the start, or switch any time from the ☰ menu (it takes effect from the next hand).
- **Hands tab:** every hand from Royal Flush down to High Card, with example cards, odds and tie-break rules.
- **Showdown explanations:** after every hand a results sheet shows each player's cards and best 5. It says who won and exactly why each other player lost: a lower hand type, a lower pair, or a kicker. The card that lost the tie-break is marked in red.
- **Fair cards:** each hand uses a fresh 52-card deck shuffled with Fisher–Yates and the device's cryptographic RNG (`crypto.getRandomValues`, with rejection sampling so there is no modulo bias). Nothing is weighted. The computer players only see their own cards and the board.
- **Busting:** if you run out of chips the game restarts with everyone back at $1,000. Opponents who go broke leave the table. Bust all three and a new game starts.
- No-limit betting with $10/$20 blinds, all-ins and correct side pots. Progress is saved in the browser.

## Play on your phone

It's a static web app with no build step and no dependencies. Host the `poker/` folder anywhere static, for example GitHub Pages, then open it on your phone and use **Share → Add to Home Screen** to get a full-screen app.

To run it locally: `python3 -m http.server` in this folder, then open `http://<your-computer-ip>:8000` on your phone.

## Tests

```
node tests/engine.test.js
```

This checks the hand evaluator against all 2,598,960 possible 5-card hands, checks tie-breaks and explanations, runs a chi-square test showing the shuffle is uniform, and runs basic AI sanity checks.
