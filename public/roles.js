// Shared public setup rules. Player assignments and private knowledge stay on the server.
export const ROLE_INFO = {
  Resistance: { team: 'Good', description: 'A loyal servant of Arthur. You receive no information about other players.' },
  Merlin: { team: 'Good', description: 'You see Evil players, except Mordred. Keep your identity secret from the Assassin.' },
  Percival: { team: 'Good', description: 'You see Merlin and Morgana as possible Merlins, without knowing which is which.' },
  Minion: { team: 'Evil', description: 'A minion of Mordred. You know the other Evil players, except Oberon, but not their exact roles.' },
  Assassin: { team: 'Evil', description: 'You know the other Evil players, except Oberon. In the full game, you try to identify Merlin after three successful quests.' },
  Morgana: { team: 'Evil', description: 'You appear as a possible Merlin to Percival and know the other Evil players, except Oberon.' },
  Mordred: { team: 'Evil', description: 'Merlin cannot see you. You know the other Evil players, except Oberon.' },
  Oberon: { team: 'Evil', description: 'You do not know the other Evil players, and they do not see you. Merlin can see you.' },
};
export const EVIL_COUNTS = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };
export const emptyCounts = () => Object.fromEntries(Object.keys(ROLE_INFO).map(role => [role, 0]));
export function preset(size = 6) {
  const counts = emptyCounts();
  if (size === 15) {
    Object.assign(counts, { Resistance: 5, Merlin: 2, Percival: 3, Assassin: 2, Morgana: 3 });
    return { mode: 'custom', counts };
  }
  const evil = EVIL_COUNTS[size];
  Object.assign(counts, { Resistance: size - evil - 2, Merlin: 1, Percival: 1, Assassin: 1, Morgana: 1, Minion: evil - 2 });
  return { mode: 'standard', counts };
}
export function totals(config) {
  const result = { total: 0, Good: 0, Evil: 0 };
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
  const { total, Good, Evil } = totals(config);
  const max = config.mode === 'standard' ? 10 : 15;
  if (total < 5 || total > max) return `Choose between 5 and ${max} players in ${config.mode} mode.`;
  if (!Good || !Evil) return 'Include at least one Good player and one Evil player.';
  if (config.mode === 'standard') {
    if (Evil !== EVIL_COUNTS[total]) return `A standard ${total}-player game needs ${total - EVIL_COUNTS[total]} Good and ${EVIL_COUNTS[total]} Evil players.`;
    if (config.counts.Merlin !== 1 || config.counts.Assassin !== 1) return 'Standard setup includes exactly one Merlin and one Assassin. Use custom mode for variants.';
    for (const role of ['Percival', 'Morgana', 'Mordred', 'Oberon']) if (config.counts[role] > 1) return `Standard setup allows at most one ${role}.`;
    if (total === 5 && config.counts.Percival && !config.counts.Morgana && !config.counts.Mordred) return 'For five players with Percival, include Morgana or Mordred.';
  }
  return null;
}
