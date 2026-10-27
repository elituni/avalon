# Contributing to Avalon

Contributions should only change files in `shared/`. This folder contains the game rules used by both the website and Discord bot.

- `shared/roles.js`: role definitions, teams, descriptions, presets, and setup validation.
- `shared/game.js`: role assignment, starting information, randomization, and leader selection.

Keep changes focused on the shared game logic. Preserve role privacy and keep randomized starting information consistent throughout a game.

Before submitting a pull request, use Node.js 22.12 or newer and run:

```sh
npm --prefix discord-bot ci
npm test
```

Describe the rule change and its expected behavior in your pull request. If it requires changes outside `shared/`, open an issue to discuss it first.
