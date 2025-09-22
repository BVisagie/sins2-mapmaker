# Sins II Web Map Editor

[![Sponsor](https://img.shields.io/badge/Sponsor-❤-brightgreen)](https://github.com/sponsors/BVisagie)

Live Demo: https://www.sins2-mapmaker.com/

Browser-based scenario editor for Sins of a Solar Empire II.

- Tech: React + Vite + TypeScript, Tailwind, React Konva, AJV, JSZip
- Features: nodes (stars/planets/moons/asteroids/special), parent-star assignment, lane types (normal/star/wormhole), ownership & players, grid/snap, per-star limits, warnings, tooltips with game filling mapping, share URL, export to mod zip

## Prerequisites

- Node.js 18+ and npm

## Getting Started

```bash
cd web
npm install
npm run dev
```

Open the app at the printed URL.

## Persistence

- Work-in-progress projects auto-save to your browser's localStorage.
- Saved format is versioned; on app updates we may clear prior saved state to ensure compatibility.

## Using the Editor

- Scenario
  - Scenario Name (alphanumeric + spaces; sanitized for file names)
  - Author and Short Description
  - Players count (validates player ownership indices, min 2, max 10)
  - Compatibility Version (written to `.mod_meta_data`)
  - Skybox is fixed to `skybox_random`
- Nodes
  - Add Star
  - Add Body (requires choosing a Parent Star in Tools)
  - Select and drag; edit Body Type from a bundled list
- Optional per-node fields: Chance of Loot (presets: 0/10/25/50/75/100%), Loot Level (0 — None, 1 — Small, 2 — Large), Artifact toggle/name
  - Remove Selected (with safeguards for linked nodes and stars with children)
- Tools
  - Parent Star selector for creating/assigning non-star bodies
  - Grid & Snap: toggle visibility/snap and set grid size
- Lanes
  - Link: ON → click two nodes to create a lane
  - New Lane type: normal, star, wormhole (wormholes render dashed blue)
  - Delete Lanes: ON → click a lane to remove it; Undo Lane reverts last
  - Constraints: star lanes must connect two stars; wormhole lanes require wormhole fixtures
- Ownership
  - Set a body to Player (choose index) or NPC (type + name)
  - Player-ownable whitelist: Terran, Desert, Ferrous, City planets only; at most one player-owned planet per player
- Limits & Checks
  - ≤ 15 stars total; ≤ 100 bodies per star
  - Each non-star must have a valid Parent Star and be reachable via lanes
  - Warnings list must be empty before export
- Share
  - Copies a URL encoding the current map
- Export
  - Validates `.scenario` and `scenario.uniforms` via AJV against bundled clean-room schemas
  - Blocks export if warnings exist
  - Blocks export on unrecognized body types (must be bundled or valid game ids like random_* / home_* / wormhole_fixture)
  - Downloads `<ScenarioName>.zip`

## Body Types

Body types are bundled with the app in `web/src/data/bodyTypes.ts`.

## Exported Structure

```
<ScenarioName>/
  .mod_meta_data
  uniforms/
    scenario.uniforms
  scenarios/
    <ScenarioName>.scenario
```

Notes:

- The `.scenario` file is itself a zip containing: `scenario_info.json`, `galaxy_chart.json`, `galaxy_chart_fillings.json`, and `picture.png` (auto-generated from your canvas with home badges).
- The `.mod_meta_data` uses a display name like `<ScenarioName>Mod`, but the folder name is `<ScenarioName>/`.
- Place the extracted folder into your Sins II mods directory.

## Schemas (Clean-room)

The app serves schemas from `web/public/schemas/` and validates with AJV.
- `galaxy-chart-schema.json` for the `.scenario`
- `scenario-uniforms-schema.json` for `scenario.uniforms`

These schemas are original to this repository and used solely to validate the editor’s own output.

Notes:

- The app does not bundle or use any files from the official mod tools.
- Schema updates: `loot_level` allows 0; `primary_fixture_override_name` supported on nodes.
- The editor exports JSON conforming to the clean-room schemas above; compatibility targets the game’s general expectations but does not rely on proprietary definitions.

## Build & Preview

```bash
cd web
npm run build
npm run preview
```

Serve the contents of `web/dist/` on any static host.

## Disclaimer

This tool ships with a manually maintained dataset for stellar bodies and planet types. If the game receives significant updates, some options may be temporarily out of date until we have time to review and update the app.