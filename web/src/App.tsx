import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Stage, Layer, Circle, Line, Text as KonvaText } from 'react-konva'
import JSZip from 'jszip'
import Ajv, { type ValidateFunction } from 'ajv'
import './index.css'

const APP_VERSION = '0.1.0'
const STORAGE_KEYS = {
	version: 'sins2.appVersion',
	project: 'sins2.project',
} as const

// Types for a minimal internal data model
interface Point { x: number; y: number }
interface NodeOwnership {
	player_index?: number
	npc_filling_type?: 'militia' | 'guardian' | 'enemy_faction' | 'friendly_faction'
	npc_filling_name?: string
	are_secondary_fixtures_owned?: boolean
}
interface NodeItem {
	id: number
	filling_name: string
	position: Point
	ownership?: NodeOwnership
}
interface PhaseLane { id: number; node_a: number; node_b: number; type?: 'normal' | 'star' | 'wormhole' }

import { BODY_TYPES, DEFAULT_BODY_TYPE_ID, getBodyRadiusById } from './data/bodyTypes'

interface ProjectStateSnapshot {
	nodes: NodeItem[]
	lanes: PhaseLane[]
	scenarioName: string
	skybox: string
	players: number
	grid: { showGrid: boolean; snapToGrid: boolean; gridSize: number }
}

export default function App() {
	const [nodes, setNodes] = useState<NodeItem[]>([
		{ id: 1, filling_name: 'star', position: { x: 360, y: 280 } },
	])
	const [lanes, setLanes] = useState<PhaseLane[]>([])
	const [selectedId, setSelectedId] = useState<number | null>(1)
	const [scenarioName, setScenarioName] = useState<string>('MyScenario')
	const [skybox, setSkybox] = useState<string>('default_skybox')
	const [players, setPlayers] = useState<number>(2)
	const [linkMode, setLinkMode] = useState<boolean>(false)
	const [laneDeleteMode, setLaneDeleteMode] = useState<boolean>(false)
	const [linkStartId, setLinkStartId] = useState<number | null>(null)
	const [newLaneType, setNewLaneType] = useState<'normal' | 'star' | 'wormhole'>('normal')
	const [ajvError, setAjvError] = useState<string | null>(null)
	const [warnings, setWarnings] = useState<string[]>([])

	const [showGrid, setShowGrid] = useState<boolean>(true)
	const [snapToGrid, setSnapToGrid] = useState<boolean>(true)
	const [gridSize, setGridSize] = useState<number>(40)

	const stageRef = useRef<any>(null)
	const nextNodeId = useRef<number>(2)
	const nextLaneId = useRef<number>(1)
	const canvasRef = useRef<HTMLDivElement>(null)
	const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

	const ajv = useMemo(() => new Ajv({ allErrors: true, strict: false }), [])
	const [validateScenario, setValidateScenario] = useState<ValidateFunction | null>(null)
	const [validateUniforms, setValidateUniforms] = useState<ValidateFunction | null>(null)



	// Bundled registry options grouped
	const bundled = useMemo(() => {
		const byCat = {
			stars: BODY_TYPES.filter(b => b.category === 'star'),
			planets: BODY_TYPES.filter(b => b.category === 'planet'),
			moons: BODY_TYPES.filter(b => b.category === 'moon'),
			asteroids: BODY_TYPES.filter(b => b.category === 'asteroid'),
			special: BODY_TYPES.filter(b => b.category === 'special'),
		}
		return byCat
	}, [])

	// Load schemas once
	useEffect(() => {
		async function loadSchemas() {
			const [scenarioRes, uniformsRes] = await Promise.all([
				fetch('/schemas/galaxy-chart-schema.json'),
				fetch('/schemas/scenario-uniforms-schema.json'),
			])
			const [scenarioSchema, uniformsSchema] = await Promise.all([
				scenarioRes.json(),
				uniformsRes.json(),
			])
			setValidateScenario(ajv.compile(scenarioSchema))
			setValidateUniforms(ajv.compile(uniformsSchema))
		}
		loadSchemas()
	}, [ajv])

	// Parse share URL
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const s = params.get('s')
		if (!s) return
		try {
			const decoded = decodeState(s) as { nodes: NodeItem[]; lanes: PhaseLane[]; skybox: string; players: number; scenarioName?: string }
			if (decoded) {
				setNodes(decoded.nodes)
				setLanes(decoded.lanes)
				setSkybox(decoded.skybox)
				setPlayers(decoded.players)
				setScenarioName(decoded.scenarioName || 'SharedScenario')
				// Fix ids for new additions
				nextNodeId.current = (decoded.nodes.reduce((maxId: number, n: NodeItem) => Math.max(maxId, n.id), 0) || 0) + 1
				nextLaneId.current = (decoded.lanes.reduce((maxId: number, n: PhaseLane) => Math.max(maxId, n.id), 0) || 0) + 1
			}
		} catch {}
	}, [])

	// Versioned localStorage reset and initial load
	useEffect(() => {
		const storedVersion = localStorage.getItem(STORAGE_KEYS.version)
		if (storedVersion !== APP_VERSION) {
			localStorage.removeItem(STORAGE_KEYS.project)
			localStorage.setItem(STORAGE_KEYS.version, APP_VERSION)
			return
		}
		// Skip if share URL is present
		const params = new URLSearchParams(window.location.search)
		if (params.get('s')) return
		const saved = localStorage.getItem(STORAGE_KEYS.project)
		if (!saved) return
		try {
			const snap = JSON.parse(saved) as ProjectStateSnapshot
			if (Array.isArray(snap.nodes) && Array.isArray(snap.lanes)) {
				setNodes(snap.nodes)
				setLanes(snap.lanes)
				if (typeof snap.scenarioName === 'string') setScenarioName(snap.scenarioName)
				if (typeof snap.skybox === 'string') setSkybox(snap.skybox)
				if (typeof snap.players === 'number') setPlayers(snap.players)
				if (snap.grid) {
					setShowGrid(!!snap.grid.showGrid)
					setSnapToGrid(!!snap.grid.snapToGrid)
					if (typeof snap.grid.gridSize === 'number') setGridSize(snap.grid.gridSize)
				}
				// ensure counters are above loaded ids
				nextNodeId.current = (snap.nodes.reduce((m, n) => Math.max(m, n.id), 0) || 0) + 1
				nextLaneId.current = (snap.lanes.reduce((m, l) => Math.max(m, l.id), 0) || 0) + 1
			}
		} catch {}
	}, [])

	// Autosave project state
	useEffect(() => {
		const snap: ProjectStateSnapshot = {
			nodes,
			lanes,
			scenarioName,
			skybox,
			players,
			grid: { showGrid, snapToGrid, gridSize },
		}
		// debounce save
		const t = setTimeout(() => {
			try { localStorage.setItem(STORAGE_KEYS.project, JSON.stringify(snap)) } catch {}
		}, 300)
		return () => clearTimeout(t)
	}, [nodes, lanes, scenarioName, skybox, players, showGrid, snapToGrid, gridSize])

	// Compute simple warnings
	useEffect(() => {
		const w: string[] = []
		// Self-loop lanes
		for (const l of lanes) {
			if (l.node_a === l.node_b) w.push(`Lane ${l.id} connects a node to itself`)
			const a = nodes.find(n => n.id === l.node_a)
			const b = nodes.find(n => n.id === l.node_b)
			if (!a || !b) w.push(`Lane ${l.id} references a missing node`)
		}
		// Duplicate lanes
		const lanePairs = new Set<string>()
		for (const l of lanes) {
			const key = l.node_a < l.node_b ? `${l.node_a}-${l.node_b}` : `${l.node_b}-${l.node_a}`
			if (lanePairs.has(key)) w.push(`Duplicate lane detected between ${key}`)
			lanePairs.add(key)
		}
		// Ownership player index validation
		for (const n of nodes) {
			if (n.ownership?.player_index && (n.ownership.player_index < 1 || n.ownership.player_index > players)) {
				w.push(`Node ${n.id} player_index out of range 1..${players}`)
			}
		}
		setWarnings(w)
	}, [lanes, nodes, players])

	// Track canvas size responsively
	useEffect(() => {
		const compute = () => {
			if (!canvasRef.current) return
			const rect = canvasRef.current.getBoundingClientRect()
			setCanvasSize({ width: Math.max(0, Math.floor(rect.width)), height: Math.max(0, Math.floor(rect.height)) })
		}
		compute()
		window.addEventListener('resize', compute)
		return () => window.removeEventListener('resize', compute)
	}, [])

	const updateNodePosition = (id: number, pos: Point) => {
		const snapped = snapToGrid ? { x: snap(pos.x, gridSize), y: snap(pos.y, gridSize) } : pos
		setNodes(prev => prev.map(n => (n.id === id ? { ...n, position: snapped } : n)))
	}

	const addNode = (typeId?: string) => {
		const id = nextNodeId.current++
		const newNode: NodeItem = {
			id,
			filling_name: typeId ?? DEFAULT_BODY_TYPE_ID,
			position: { x: 200 + Math.random() * 600, y: 160 + Math.random() * 400 },
		}
		setNodes(prev => [...prev, newNode])
		setSelectedId(id)
	}

	const removeSelected = () => {
		if (selectedId == null) return
		setNodes(prev => prev.filter(n => n.id !== selectedId))
		setLanes(prev => prev.filter(l => l.node_a !== selectedId && l.node_b !== selectedId))
		setSelectedId(null)
	}

	const toggleLinkMode = () => {
		setLinkMode(v => !v)
		setLaneDeleteMode(false)
		setLinkStartId(null)
	}
	const toggleLaneDeleteMode = () => {
		setLaneDeleteMode(v => !v)
		setLinkMode(false)
		setLinkStartId(null)
	}

	const onNodeClick = (id: number) => {
		if (!linkMode) {
			setSelectedId(id)
			return
		}
		if (linkStartId == null) {
			setLinkStartId(id)
			setSelectedId(id)
			return
		}
		if (linkStartId === id) {
			setLinkStartId(null)
			return
		}
		// Create lane if not exists
		const exists = lanes.some(l => (l.node_a === linkStartId && l.node_b === id) || (l.node_b === linkStartId && l.node_a === id))
		if (!exists) {
			const lane: PhaseLane = { id: nextLaneId.current++, node_a: linkStartId, node_b: id, type: newLaneType }
			setLanes(prev => [...prev, lane])
		}
		setLinkStartId(null)
	}

	const removeLastLane = () => {
		setLanes(prev => prev.slice(0, -1))
	}

	const onLaneClick = (laneId: number) => {
		if (!laneDeleteMode) return
		setLanes(prev => prev.filter(l => l.id !== laneId))
	}

	const exportZip = async () => {
		const scenario = buildScenarioJSON(nodes, lanes, skybox)
		const uniformsObj = buildScenarioUniformsObject(scenarioName)

		if (validateScenario) {
			const valid = validateScenario(scenario)
			if (!valid) {
				setAjvError(JSON.stringify(validateScenario.errors, null, 2))
				return
			}
		}
		if (validateUniforms) {
			const validU = validateUniforms(uniformsObj)
			if (!validU) {
				setAjvError(JSON.stringify(validateUniforms.errors, null, 2))
				return
			}
		}
		if (warnings.length > 0) {
			setAjvError('Fix warnings before export:\n' + warnings.join('\n'))
			return
		}
		setAjvError(null)

		const zip = new JSZip()
		const sanitized = sanitizeName(scenarioName)
		const root = `${sanitized}Mod/`

		zip.file(`${root}.mod_meta_data`, buildModMetaData(scenarioName))
		zip.file(`${root}scenario.uniforms`, JSON.stringify(uniformsObj, null, 2))
		zip.file(`${root}scenarios/${sanitized}.scenario`, JSON.stringify(scenario, null, 2))

		const blob = await zip.generateAsync({ type: 'blob' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${sanitized}Mod.zip`
		a.click()
		URL.revokeObjectURL(url)
	}

	const onShare = async () => {
		const payload = { nodes, lanes, skybox, players, scenarioName }
		const encoded = encodeState(payload)
		const url = new URL(window.location.href)
		url.searchParams.set('s', encoded)
		try {
			await navigator.clipboard.writeText(url.toString())
			alert('Share URL copied to clipboard')
		} catch {
			prompt('Copy this URL', url.toString())
		}
	}

	const selectedNode = nodes.find(n => n.id === selectedId) || null

	const stageWidth = canvasSize.width
	const stageHeight = canvasSize.height

  return (
		<div className="h-screen w-screen flex flex-col bg-black text-white">
			<div className="h-12 border-b border-white/10 px-4 flex items-center justify-between">
				<div className="font-semibold tracking-wide">Sins II Scenario Editor</div>
				<div className="flex items-center gap-2">
					<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900" onClick={onShare}>Share</button>
					<button className="px-4 py-1.5 rounded bg-white text-black" onClick={exportZip}>Export</button>
				</div>
			</div>
			<div className="flex flex-1 overflow-hidden">
				<div className="w-96 border-r border-white/10 p-4 overflow-auto">
					<div className="space-y-6">
						<div className="space-y-2 bg-neutral-900/30 border border-white/10 rounded p-3">
							<div className="font-medium text-sm">Scenario</div>
							<label className="block text-xs opacity-80">Scenario Name</label>
							<input className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={scenarioName} onChange={e => setScenarioName(e.target.value)} />
							<label className="block text-xs opacity-80 mt-2">Skybox</label>
							<input className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={skybox} onChange={e => setSkybox(e.target.value)} />
							<label className="block text-xs opacity-80 mt-2">Players</label>
							<input type="number" min={0} className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={players} onChange={e => setPlayers(Math.max(0, Number(e.target.value) || 0))} />
						</div>

						<div className="space-y-2 bg-neutral-900/30 border border-white/10 rounded p-3">
							<div className="font-medium text-sm">Tools</div>
							<div className="flex gap-2 flex-wrap mt-1">
								<button className={`px-3 py-1 rounded border border-white/20 ${linkMode ? 'bg-white text-black' : 'bg-neutral-900'}`} onClick={toggleLinkMode}>{linkMode ? 'Link: ON' : 'Link: OFF'}</button>
								<button className={`px-3 py-1 rounded border border-white/20 ${laneDeleteMode ? 'bg-white text-black' : 'bg-neutral-900'}`} onClick={toggleLaneDeleteMode}>{laneDeleteMode ? 'Delete Lanes: ON' : 'Delete Lanes: OFF'}</button>
								<select className="px-2 py-1 rounded border border-white/20 bg-neutral-900" value={newLaneType} onChange={e => setNewLaneType(e.target.value as 'normal' | 'star' | 'wormhole')}>
									<option value="normal">New Lane: normal</option>
									<option value="star">New Lane: star</option>
									<option value="wormhole">New Lane: wormhole</option>
								</select>
								<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900" onClick={() => addNode(undefined)}>Add Body</button>
								<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900" onClick={() => addNode('star')}>Add Star</button>
								<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900 disabled:opacity-40" disabled={selectedId == null} onClick={removeSelected}>Remove Selected</button>
								<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900 disabled:opacity-40" disabled={lanes.length === 0} onClick={removeLastLane}>Undo Lane</button>
							</div>
						</div>

						<div className="space-y-2 bg-neutral-900/30 border border-white/10 rounded p-3">
							<div className="font-medium text-sm">Grid & Snap</div>
							<div className="flex items-center gap-3 flex-wrap mt-1">
								<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Show Grid</label>
								<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} /> Snap to Grid</label>
								<label className="flex items-center gap-2 text-sm">Size <input type="number" min={8} max={200} value={gridSize} onChange={e => setGridSize(Math.max(8, Math.min(200, Number(e.target.value) || 40)))} className="w-20 px-2 py-1 bg-neutral-900 border border-white/10 rounded" /></label>
							</div>
						</div>

						{selectedNode && (
							<div className="space-y-2 bg-neutral-900/30 border border-white/10 rounded p-3">
								<div className="font-medium text-sm">Selected Node</div>
								<div className="text-xs opacity-75">id: {selectedNode.id}</div>
								<label className="block text-xs opacity-80 mt-1">Body Type</label>
								<select
									className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded"
									value={selectedNode.filling_name}
									onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, filling_name: e.target.value } : n))}
								>
									<optgroup label="Stars (Bundled)">
										{bundled.stars.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
									</optgroup>
									<optgroup label="Planets (Bundled)">
										{bundled.planets.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
									</optgroup>
									<optgroup label="Moons (Bundled)">
										{bundled.moons.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
									</optgroup>
									<optgroup label="Asteroids (Bundled)">
										{bundled.asteroids.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
									</optgroup>
									<optgroup label="Special (Bundled)">
										{bundled.special.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
									</optgroup>
								</select>

								<div className="mt-2">
									<div className="text-sm">Ownership</div>
									<select
										className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded"
										value={selectedNode.ownership?.player_index ? 'player' : selectedNode.ownership?.npc_filling_type ? 'npc' : 'none'}
										onChange={e => {
											const mode = e.target.value as 'none' | 'player' | 'npc'
											setNodes(prev => prev.map(n => {
												if (n.id !== selectedNode.id) return n
												if (mode === 'none') return { ...n, ownership: undefined }
												if (mode === 'player') return { ...n, ownership: { player_index: 1 } }
												return { ...n, ownership: { npc_filling_type: 'militia', npc_filling_name: 'default' } }
											}))
										}}
									>
										<option value="none">Unowned</option>
										<option value="player">Player</option>
										<option value="npc">NPC</option>
									</select>

									{selectedNode.ownership?.player_index != null && (
										<div className="space-y-1 mt-2">
											<label className="block text-sm">Player Index (1..{players})</label>
											<input type="number" min={1} max={players} className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.ownership.player_index}
												onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { ...n.ownership, player_index: Math.max(1, Math.min(players, Number(e.target.value) || 1)) } } : n))}
											/>
										</div>
									)}

									{selectedNode.ownership?.npc_filling_type && (
										<div className="space-y-1 mt-2">
											<label className="block text-sm">NPC Type</label>
											<select className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.ownership.npc_filling_type}
												onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { ...n.ownership, npc_filling_type: e.target.value as NodeOwnership['npc_filling_type'] } } : n))}
											>
												<option value="militia">militia</option>
												<option value="guardian">guardian</option>
												<option value="enemy_faction">enemy_faction</option>
												<option value="friendly_faction">friendly_faction</option>
											</select>
											<label className="block text-sm">NPC Filling Name</label>
											<input className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.ownership.npc_filling_name ?? ''}
												onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { ...n.ownership, npc_filling_name: e.target.value } } : n))}
											/>
										</div>
									)}
								</div>
							</div>
						)}
					</div>
				</div>
				<div ref={canvasRef} className="flex-1 relative">
					<Stage ref={stageRef} width={stageWidth} height={stageHeight} style={{ background: 'black', cursor: laneDeleteMode ? 'not-allowed' : linkMode ? 'crosshair' : 'default' }}>
						<Layer listening={false}>
							{showGrid && renderGrid(stageWidth, stageHeight, gridSize)}
							{nodes.length === 0 && (
								<KonvaText x={stageWidth / 2 - 160} y={stageHeight / 2 - 10} text="Add a Star or Planet with the Tools panel" fill="#888" />
							)}
						</Layer>
						<Layer>
							{lanes.map(l => {
								const a = nodes.find(n => n.id === l.node_a)
								const b = nodes.find(n => n.id === l.node_b)
								if (!a || !b) return null
								const invalid = l.node_a === l.node_b
								return (
									<Line key={l.id} points={[a.position.x, a.position.y, b.position.x, b.position.y]} stroke={invalid ? '#ef4444' : (l.type === 'wormhole' ? '#60a5fa' : l.type === 'star' ? '#f59e0b' : 'white')} strokeWidth={2} opacity={invalid ? 0.9 : 0.7} dash={l.type === 'wormhole' ? [6, 6] : undefined} onClick={() => onLaneClick(l.id)} />
								)
							})}
							{nodes.map(n => (
								<Circle
									key={n.id}
									x={n.position.x}
									y={n.position.y}
									radius={getBodyRadiusById(n.filling_name)}
									fill={selectedId === n.id ? 'white' : 'rgba(255,255,255,0.85)'}
									draggable
									dragBoundFunc={(pos) => snapToGrid ? { x: snap(pos.x, gridSize), y: snap(pos.y, gridSize) } : pos}
									onDragEnd={e => updateNodePosition(n.id, { x: e.target.x(), y: e.target.y() })}
									onClick={() => onNodeClick(n.id)}
								/>
							))}
						</Layer>
					</Stage>
					<div className="absolute bottom-2 left-2 text-xs opacity-60">Tips: Link to create lanes; Delete Lanes to remove</div>
				</div>
				<div className="w-80 border-l border-white/10 p-4 overflow-auto">
					<div className="space-y-6">
						<div className="space-y-2 bg-neutral-900/30 border border-yellow-400/20 rounded p-3">
							<div className="font-medium text-sm text-yellow-300">Warnings</div>
							{warnings.length === 0 ? (
								<div className="text-xs opacity-70">No issues detected.</div>
							) : (
								<div className="text-xs text-yellow-300 space-y-1">{warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
							)}
						</div>

						<div className="space-y-2 bg-neutral-900/30 border border-red-400/20 rounded p-3">
							<div className="font-medium text-sm text-red-300">Validation</div>
							{ajvError ? (
								<pre className="text-xs text-red-300 whitespace-pre-wrap max-h-60 overflow-auto">{ajvError}</pre>
							) : (
								<div className="text-xs opacity-70">No validation errors.</div>
							)}
						</div>

						<div className="space-y-3 bg-neutral-900/30 border border-white/10 rounded p-3">
							<div className="font-medium text-sm">Help & Tips</div>
							<div>
								<div className="text-xs font-medium opacity-90">Getting Started</div>
								<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
									<li>Use <span className="opacity-100">Add Body</span> for a planet, or <span className="opacity-100">Add Star</span>.</li>
									<li>Select a node to change its <span className="opacity-100">Body Type</span>.</li>
									<li>Drag nodes to reposition; enable <span className="opacity-100">Snap to Grid</span> for tidy layouts.</li>
								</ul>
							</div>
							<div>
								<div className="text-xs font-medium opacity-90">Linking & Lanes</div>
								<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
									<li>Toggle <span className="opacity-100">Link</span>, then click two nodes to connect them.</li>
									<li>Pick the <span className="opacity-100">New Lane</span> type (normal, star, wormhole) before linking.</li>
									<li>Toggle <span className="opacity-100">Delete Lanes</span> to remove a lane by clicking it. Use <span className="opacity-100">Undo Lane</span> to revert the last one.</li>
								</ul>
								<div className="text-xs font-medium opacity-90 mt-2">Lane Legend</div>
								<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
									<li>Normal: white line</li>
									<li>Star: amber line</li>
									<li>Wormhole: dashed blue line</li>
								</ul>
							</div>
							<div>
								<div className="text-xs font-medium opacity-90">Ownership & Players</div>
								<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
									<li>Set a node to <span className="opacity-100">Player</span> (choose index) or <span className="opacity-100">NPC</span> (type and name).</li>
									<li><span className="opacity-100">Players</span> in Scenario controls the allowed player index range.</li>
								</ul>
							</div>
							<div>
								<div className="text-xs font-medium opacity-90">Export & Validation</div>
								<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
									<li>Warnings (self-loops, duplicates, missing nodes, bad player index) must be cleared before export.</li>
									<li>Scenarios are validated with AJV against the bundled schemas before packaging.</li>
								</ul>
							</div>
      <div>
								<div className="text-xs font-medium opacity-90">Share</div>
								<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
									<li><span className="opacity-100">Share</span> copies a URL that restores your map.</li>
								</ul>
							</div>

							<div className="space-y-1 bg-neutral-900/30 border border-yellow-400/20 rounded p-3">
								<div className="font-medium text-sm text-yellow-300">Notice</div>
								<div className="text-xs opacity-80">This tool ships with a manually maintained dataset for stellar bodies and planet types. If the game receives significant updates, some options may be temporarily out of date until we have time to review and update the app.</div>
							</div>
						</div>
					</div>
				</div>
      </div>
      </div>
	)
}

function buildScenarioJSON(nodes: NodeItem[], lanes: PhaseLane[], skybox: string) {
	return {
		version: 1,
		skybox,
		root_nodes: nodes.map(n => ({
			id: n.id,
			filling_name: n.filling_name,
			position: [n.position.x, n.position.y],
			...(n.ownership ? { ownership: n.ownership } : {}),
		})),
		phase_lanes: lanes.map(l => ({ id: l.id, node_a: l.node_a, node_b: l.node_b, ...(l.type ? { type: l.type } : {}) })),
	}
}

function buildModMetaData(name: string) {
	const sanitized = sanitizeName(name)
	return `name ${sanitized}Mod\nversion 1\nauthor WebEditor\ndescription ${name} created with Web Editor\ncompatibilityVersion 1\n`
}

function buildScenarioUniformsObject(scenarioName: string) {
	return {
		dlc_multiplayer_scenarios: [],
		dlc_scenarios: [],
		fake_server_scenarios: [],
		scenarios: [scenarioName],
		version: 1,
	}
}

function renderGrid(width: number, height: number, size: number) {
	const lines: React.ReactNode[] = []
	for (let x = 0; x <= width; x += size) {
		lines.push(<Line key={`gx-${x}`} points={[x, 0, x, height]} stroke="#222" strokeWidth={1} />)
	}
	for (let y = 0; y <= height; y += size) {
		lines.push(<Line key={`gy-${y}`} points={[0, y, width, y]} stroke="#222" strokeWidth={1} />)
	}
	return lines
}

function snap(value: number, size: number) {
	return Math.round(value / size) * size
}

function sanitizeName(name: string) {
	const s = name.trim().replace(/\s+/g, '_')
	const cleaned = s.replace(/[^A-Za-z0-9_-]/g, '')
	return cleaned || 'Scenario'
}

function encodeState(obj: any) {
	const json = JSON.stringify(obj)
	const utf8 = new TextEncoder().encode(json)
	let binary = ''
	for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i])
	const b64 = btoa(binary)
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function decodeState(s: string) {
	const pad = s.length % 4 === 0 ? s : s + '=== '.slice(0, 4 - (s.length % 4))
	const b64 = pad.replace(/-/g, '+').replace(/_/g, '/')
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	const json = new TextDecoder().decode(bytes)
	return JSON.parse(json)
}
