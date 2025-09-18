# Sins II Web Map Editor

Browser-based scenario editor for Sins of a Solar Empire II.

- Tech: React + Vite + TypeScript, Tailwind, React Konva, AJV, JSZip
- Features: nodes (body types: stars/planets/moons/asteroids/special), lane linking with type, ownership & players, grid/snap, warnings, share URL, export zip

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
  - Scenario Name and Skybox inputs
  - Players count (used to validate player ownership indices)
- Nodes
  - Add Body (default planet) and Add Star
  - Select, drag, edit Body Type via dropdown
  - Remove Selected
- Lanes
  - Link: ON → click two nodes to create a lane
  - New Lane type selector: normal, star, wormhole (wormholes render dashed blue)
  - Delete Lanes: ON → click a lane to remove it
  - Undo Lane removes the last lane
- Grid & Snap
  - Toggle grid visibility and snap-to-grid
  - Adjust grid size
- Ownership
  - Set a node to Player (choose index) or NPC (type + name)
- Share
  - Share button copies a URL encoding the current map
- Export
  - Validates `.scenario` and `scenario.uniforms` via AJV against bundled clean-room schemas
  - Blocks export if warnings exist (self-loop, duplicates, missing node references, invalid player index)
  - Downloads `<ScenarioName>Mod.zip`

## Body Types

Body types are bundled with the app in `web/src/data/bodyTypes.ts`. You can extend the set in future releases.

## Exported Structure

```
<ScenarioName>Mod/
  .mod_meta_data
  scenario.uniforms
  scenarios/
    <ScenarioName>.scenario
```

Place the extracted folder into your Sins II mods directory.

## Schemas (Clean-room)

The app serves schemas from `web/public/schemas/` and validates with AJV.
- `galaxy-chart-schema.json` for the `.scenario`
- `scenario-uniforms-schema.json` for `scenario.uniforms`

These schemas are original to this repository and used solely to validate the editor’s own output.

Notes:

- The app does not bundle or use any files from the official mod tools. External/original "Official Schemas" upload-and-validate functionality has been removed to keep this project independent.
- The editor exports JSON conforming to the clean-room schemas above; compatibility targets the game’s general expectations but does not rely on proprietary definitions.

## Build & Preview

```bash
cd web
npm run build
npm run preview
```

Serve the contents of `web/dist/` on any static host.