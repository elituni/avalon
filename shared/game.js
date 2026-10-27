import { randomInt } from 'node:crypto';
import { ROLE_INFO, totals, validateConfig } from './roles.js';

export function startingInformation(me, players) {
  if (!me.role) return null;
  let visible = [];
  let heading = 'No players revealed';
  let explanation = 'Your role gives you no information about other players.';
  if (me.role === 'Merlin') {
    visible = players.filter(p => ROLE_INFO[p.role].team === 'Spy' && p.role !== 'Mordred');
    heading = 'Known spies';
    explanation = 'Mordred is hidden from you. These players are spies; their exact roles are not revealed.';
  } else if (me.role === 'Percival') {
    visible = players.filter(p => p.role === 'Merlin' || p.role === 'Morgana');
    heading = 'Possible Merlins';
    explanation = 'These players are Merlin or Morgana. You cannot tell their roles apart from this reveal.';
    if (!visible.some(p => p.role === 'Morgana')) {
      heading = 'Merlin';
      explanation = 'No Morgana is in this game, so every revealed player is Merlin.';
    } else if (!visible.some(p => p.role === 'Merlin')) {
      heading = 'Morgana';
      explanation = 'No Merlin is in this custom setup, so every revealed player is Morgana.';
    }
  } else if (me.role === 'Tristan' || me.role === 'Isolde') {
    const partner = me.role === 'Tristan' ? 'Isolde' : 'Tristan';
    visible = players.filter(p => p.role === partner);
    heading = partner;
    explanation = `You know every ${partner} in this setup.`;
  } else if (me.role === 'Oberon') {
    explanation = 'You are a spy, but you do not see your teammates and they do not see you. Merlin can see you.';
  } else if (ROLE_INFO[me.role].team === 'Spy') {
    visible = players.filter(p => p.id !== me.id && ROLE_INFO[p.role].team === 'Spy' && p.role !== 'Oberon');
    heading = 'Known spy teammates';
    explanation = 'Oberon is hidden from your team. Exact teammate roles are not revealed.';
  }
  // Preserve public seat order, never group or sort candidates by their hidden roles.
  return { heading, explanation, players: visible.map(p => ({ id: p.id, name: p.name })) };
}

export function assignRoles(players, config) {
  const error = validateConfig(config);
  if (error) throw new Error(error);
  if (players.length !== totals(config).total) throw new Error('Fill every seat before starting.');
  const roles = Object.entries(config.counts).flatMap(([role, count]) => Array(count).fill(role));
  for (let i = roles.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return players.map((player, index) => ({ ...player, role: roles[index] }));
}
