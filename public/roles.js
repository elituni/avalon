// Shared public setup rules. Player assignments and private knowledge stay on the server.
export const ROLE_INFO = {
  Resistance: { team: 'Resistance', description: 'A loyal servant of Arthur. You receive no information about other players.' },
  Merlin: { team: 'Resistance', description: 'You see spies, except Mordred. Keep your identity secret from the Assassin.' },
  Percival: { team: 'Resistance', description: 'You see Merlin and Morgana as possible Merlins, without knowing which is which.' },
  Spy: { team: 'Spy', description: 'An ordinary spy. You know the other spies, except Oberon, but not their exact roles.' },
  Assassin: { team: 'Spy', description: 'You know the other spies, except Oberon. In the full game, you try to identify Merlin after three successful quests.' },
  Morgana: { team: 'Spy', description: 'You appear as a possible Merlin to Percival and know the other spies, except Oberon.' },
  Mordred: { team: 'Spy', description: 'Merlin cannot see you. You know the other spies, except Oberon.' },
  Oberon: { team: 'Spy', description: 'You do not know the other spies, and they do not see you. Merlin can see you.' },
};
export const SPY_COUNTS = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };
export const emptyCounts = () => Object.fromEntries(Object.keys(ROLE_INFO).map(role => [role, 0]));
export function preset(size = 6) {
  const counts = emptyCounts();
  if (size === 15) {
    Object.assign(counts, { Resistance: 5, Merlin: 2, Percival: 3, Assassin: 2, Morgana: 3 });
    return { mode: 'custom', counts };
  }
  const spies = SPY_COUNTS[size];
  Object.assign(counts, { Resistance: size - spies - 2, Merlin: 1, Percival: 1, Assassin: 1, Morgana: 1, Spy: spies - 2 });
  return { mode: 'standard', counts };
}
export function totals(config) {
  const result = { total: 0, Resistance: 0, Spy: 0 };
  for (const [role, count] of Object.entries(config.counts)) {
    result.total += count;
    result[ROLE_INFO[role].team] += count;
  }
  return result;
}
export function validateConfig(config) {
  if (!config || !['standard', 'custom'].includes(config.mode) || !config.counts || typeof config.counts !== 'object' || Array.isArray(config.counts)) return 'Choose a setup mode and role counts.';
  if (Object.keys(config.counts).length !== Object.keys(ROLE_INFO).length || Object.keys(config.counts).some(role => !Object.hasOwn(ROLE_INFO, role))) return 'Use only the eight supported roles.';
  for (const role of Object.keys(ROLE_INFO)) {
    if (!Number.isInteger(config.counts[role]) || config.counts[role] < 0 || config.counts[role] > 15) return 'Role counts must be whole numbers from 0 to 15.';
  }
  const { total, Resistance, Spy } = totals(config);
  const max = config.mode === 'standard' ? 10 : 15;
  if (total < 5 || total > max) return `Choose between 5 and ${max} players in ${config.mode} mode.`;
  if (!Resistance || !Spy) return 'Include at least one Resistance player and one Spy player.';
  if (config.mode === 'standard') {
    if (Spy !== SPY_COUNTS[total]) return `A standard ${total}-player game needs ${total - SPY_COUNTS[total]} Resistance and ${SPY_COUNTS[total]} Spy players.`;
    if (config.counts.Merlin !== 1 || config.counts.Assassin !== 1) return 'Standard setup includes exactly one Merlin and one Assassin. Use custom mode for variants.';
    for (const role of ['Percival', 'Morgana', 'Mordred', 'Oberon']) if (config.counts[role] > 1) return `Standard setup allows at most one ${role}.`;
    if (total === 5 && config.counts.Percival && !config.counts.Morgana && !config.counts.Mordred) return 'For five players with Percival, include Morgana or Mordred.';
  }
  return null;
}
