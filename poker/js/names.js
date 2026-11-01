/*
 * Poker opponents. A new random three are seated for every new game.
 * Hungarian, Chinese and Korean names use their native order (surname first, then initials:
 * "Kádár J.", "Xi J.", "Kim J. U."); everyone else is written initial first ("R. Reagan").
 */
(function (root) {
  'use strict';

  // [first name(s), surname, flag, surname-first?, tag]
  const POLITICIANS = [
    ['Franklin D.', 'Roosevelt', '🇺🇸', false, 'US President'],
    ['Harry S.', 'Truman', '🇺🇸', false, 'US President'],
    ['Mikhail', 'Gorbachev', '🇷🇺', false, 'Soviet leader'],
    ['Nikita', 'Hrushchov', '🇷🇺', false, 'Soviet leader'],
    ['Ronald', 'Reagan', '🇺🇸', false, 'US President'],
    ['George H. W.', 'Bush', '🇺🇸', false, 'US President'],
    ['George W.', 'Bush', '🇺🇸', false, 'US President'],
    ['Bill', 'Clinton', '🇺🇸', false, 'US President'],
    ['John F.', 'Kennedy', '🇺🇸', false, 'US President'],
    ['Donald', 'Trump', '🇺🇸', false, 'US President'],
    ['Vladimir', 'Putin', '🇷🇺', false, 'Russian President'],
    ['Vladimir', 'Lenin', '🇷🇺', false, 'Soviet leader'],
    ['Jinping', 'Xi', '🇨🇳', true, 'Chinese leader'],
    ['Jong Un', 'Kim', '🇰🇵', true, 'North Korean leader'],
    ['Miklós', 'Horthy', '🇭🇺', true, 'Regent of Hungary'],
    ['Mátyás', 'Rákosi', '🇭🇺', true, 'Hungarian leader'],
    ['János', 'Kádár', '🇭🇺', true, 'Hungarian leader'],
    ['Péter', 'Magyar', '🇭🇺', true, 'Hungarian politician'],
  ];

  // Every Formula 1 World Drivers' Champion (first title year), up to the reigning champion.
  const F1 = [
    ['Giuseppe', 'Farina', '🇮🇹', 1950], ['Juan Manuel', 'Fangio', '🇦🇷', 1951], ['Alberto', 'Ascari', '🇮🇹', 1952],
    ['Mike', 'Hawthorn', '🇬🇧', 1958], ['Jack', 'Brabham', '🇦🇺', 1959], ['Phil', 'Hill', '🇺🇸', 1961],
    ['Graham', 'Hill', '🇬🇧', 1962], ['Jim', 'Clark', '🇬🇧', 1963], ['John', 'Surtees', '🇬🇧', 1964],
    ['Denny', 'Hulme', '🇳🇿', 1967], ['Jackie', 'Stewart', '🇬🇧', 1969], ['Jochen', 'Rindt', '🇦🇹', 1970],
    ['Emerson', 'Fittipaldi', '🇧🇷', 1972], ['Niki', 'Lauda', '🇦🇹', 1975], ['James', 'Hunt', '🇬🇧', 1976],
    ['Mario', 'Andretti', '🇺🇸', 1978], ['Jody', 'Scheckter', '🇿🇦', 1979], ['Alan', 'Jones', '🇦🇺', 1980],
    ['Nelson', 'Piquet', '🇧🇷', 1981], ['Keke', 'Rosberg', '🇫🇮', 1982], ['Alain', 'Prost', '🇫🇷', 1985],
    ['Ayrton', 'Senna', '🇧🇷', 1988], ['Nigel', 'Mansell', '🇬🇧', 1992], ['Michael', 'Schumacher', '🇩🇪', 1994],
    ['Damon', 'Hill', '🇬🇧', 1996], ['Jacques', 'Villeneuve', '🇨🇦', 1997], ['Mika', 'Häkkinen', '🇫🇮', 1998],
    ['Fernando', 'Alonso', '🇪🇸', 2005], ['Kimi', 'Räikkönen', '🇫🇮', 2007], ['Lewis', 'Hamilton', '🇬🇧', 2008],
    ['Jenson', 'Button', '🇬🇧', 2009], ['Sebastian', 'Vettel', '🇩🇪', 2010], ['Nico', 'Rosberg', '🇩🇪', 2016],
    ['Max', 'Verstappen', '🇳🇱', 2021], ['Lando', 'Norris', '🇬🇧', 2025],
  ];

  const initials = (first) => first.split(' ').map((w) => w[0] + '.').join(' ');

  /** "Kádár J." / "Kim J. U." for surname-first names, "R. Reagan" otherwise. Middle initials only kept for the two Bushes. */
  function shortName(first, last, surnameFirst) {
    if (surnameFirst) return `${last} ${initials(first)}`;
    const ini = last === 'Bush' ? initials(first) : first[0] + '.';
    return `${ini} ${last}`;
  }

  const ALL = POLITICIANS.map(([f, l, flag, hu, tag]) => ({ name: shortName(f, l, hu), flag, tag }))
    .concat(F1.map(([f, l, flag, year]) => ({ name: shortName(f, l, false), flag, tag: `F1 World Champion ${year}` })));

  /** Pick n different opponents uniformly at random. */
  function pick(n, randomInt) {
    const pool = ALL.slice();
    const out = [];
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(randomInt(pool.length), 1)[0]);
    return out;
  }

  const Names = { ALL, pick, shortName };
  if (typeof module !== 'undefined' && module.exports) module.exports = Names;
  root.Names = Names;
})(typeof window !== 'undefined' ? window : globalThis);
