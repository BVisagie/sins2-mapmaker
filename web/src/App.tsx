import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Stage, Layer, Circle, Line, Group, Text as KonvaText } from 'react-konva'
import JSZip from 'jszip'
import Ajv, { type ValidateFunction } from 'ajv'
import './index.css'
import LZString from 'lz-string'

const APP_VERSION = '0.9.0'
const WORLD_WIDTH = 2400
const WORLD_HEIGHT = 2325
// Only these body types may be owned by players
const PLAYER_OWNABLE_TYPES = new Set<string>(['planet_terran', 'planet_desert', 'planet_ferrous', 'planet_city'])
const STORAGE_KEYS = {
	version: 'sins2.appVersion',
	project: 'sins2.project',
} as const

// Allowed artifacts (game ids). Displayed with humanized labels in UI
const ARTIFACT_OPTIONS = [
    'culture_bonus_planet_artifact',
    'matter_compressor_planet_artifact',
    'exoforce_matrix_ship_artifact',
    'kinetic_intensifier_ship_artifact',
    'power_core_relic_ship_artifact',
    'relativistic_factories_planet_artifact',
    'resilient_metaloids_ship_artifact',
    'research_archive_planet_artifact',
    'weapon_symbiote_ship_artifact',
    'tachyon_comms_relay_planet_artifact',
    'mass_negation_core_ship_artifact',
] as const

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
	parent_star_id?: number
    rotation?: number
    chance_of_loot?: number
	has_artifact?: boolean
	artifact_name?: string
	initial_category: BodyTypeCategory
}
interface PhaseLane { id: number; node_a: number; node_b: number; type?: 'normal' | 'star' | 'wormhole' }

import { BODY_TYPES, DEFAULT_BODY_TYPE_ID, getBodyRadiusById, bodyTypeById, getBodyColorById, toGameFillingName, humanizeGameFillingName } from './data/bodyTypes'
import type { BodyType } from './data/bodyTypes'
import type { BodyTypeCategory } from './data/bodyTypes'

interface ProjectStateSnapshot {
	nodes: NodeItem[]
	lanes: PhaseLane[]
	scenarioName: string
	skybox: string
	players: number
	teamCount?: number
    modCompatVersion: number
	grid: { showGrid: boolean; snapToGrid: boolean; gridSize: number }
    author?: string
    shortDescription?: string
    displayName?: string
    displayVersion?: string
    logoDataUrl?: string | null
}

export default function App() {
	const [nodes, setNodes] = useState<NodeItem[]>([
		{ id: 1, filling_name: 'star', position: { x: 360, y: 280 }, initial_category: 'star' },
	])
	const [lanes, setLanes] = useState<PhaseLane[]>([])
	const [selectedId, setSelectedId] = useState<number | null>(1)
	const [scenarioName, setScenarioName] = useState<string>('MyScenario')
	const [skybox, setSkybox] = useState<string>('skybox_random')
	const [players, setPlayers] = useState<number>(2)
const [teamCount, setTeamCount] = useState<number | null>(null)
	    const [modCompatVersion, setModCompatVersion] = useState<number>(2)
    const [author, setAuthor] = useState<string>('')
    const [shortDescription, setShortDescription] = useState<string>('')
    const [displayName, setDisplayName] = useState<string>('')
    const [displayVersion, setDisplayVersion] = useState<string>('1.0.0')
    const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
	const [linkMode, setLinkMode] = useState<boolean>(false)
	const [laneDeleteMode, setLaneDeleteMode] = useState<boolean>(false)
	const [linkStartId, setLinkStartId] = useState<number | null>(null)
	const [newLaneType, setNewLaneType] = useState<'normal' | 'star' | 'wormhole'>('normal')
	const [ajvError, setAjvError] = useState<string | null>(null)
	const [warnings, setWarnings] = useState<string[]>([])


	// Parent star selection for creating new non-star bodies
	const [newBodyParentStarId, setNewBodyParentStarId] = useState<number | null>(null)

	// Modal state for reassigning bodies when deleting a star
	const [reassignStarModalOpen, setReassignStarModalOpen] = useState<boolean>(false)
	const [reassignSourceStarId, setReassignSourceStarId] = useState<number | null>(null)
	const [reassignTargetStarId, setReassignTargetStarId] = useState<number | null>(null)

	const [showGrid, setShowGrid] = useState<boolean>(true)
	const [snapToGrid, setSnapToGrid] = useState<boolean>(true)
	const [gridSize, setGridSize] = useState<number>(40)

	const stageRef = useRef<any>(null)
	const canvasRef = useRef<HTMLDivElement>(null)
	const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
	const [viewScale, setViewScale] = useState<number>(1)
	const [viewPos, setViewPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
	const [manualView, setManualView] = useState<boolean>(false)
	const [spacePressed, setSpacePressed] = useState<boolean>(false)
	const [isPanningViaMouse, setIsPanningViaMouse] = useState<boolean>(false)
	const panLast = useRef<{ x: number; y: number } | null>(null)

	const ajv = useMemo(() => new Ajv({ allErrors: true, strict: false }), [])
    const [validateScenario, setValidateScenario] = useState<ValidateFunction | null>(null)
    const [validateUniforms, setValidateUniforms] = useState<ValidateFunction | null>(null)


	// Bundled registry options grouped
    const bundled = useMemo(() => {
        const stars = BODY_TYPES.filter(b => b.category === 'star')
        // Hide planet options unless they map to random_rich_planet or random_poor_planet
        const planetsAll = BODY_TYPES.filter(b => b.category === 'planet')
        const planets = planetsAll.filter(b => {
            const game = toGameFillingName(b.id)
            // Exclude only ambiguous buckets; keep all specific planet biomes
            return !(game === 'random_rich_planet' || game === 'random_poor_planet')
        })
        const moons = BODY_TYPES.filter(b => b.category === 'moon')
        const asteroids = BODY_TYPES.filter(b => b.category === 'asteroid')
        const special = BODY_TYPES.filter(b => b.category === 'special')
        return { stars, planets, moons, asteroids, special }
    }, [])

// Recommended Team Count options based on Players
const teamCountOptions = useMemo(() => {
	const opts: { value: number; label: string }[] = []
	// FFA always available
	opts.push({ value: 0, label: 'FFA' })
	const p = Math.max(2, Math.min(10, Math.floor(players) || 2))
	for (let teams = 2; teams <= p; teams++) {
		if (p % teams !== 0) continue
		const size = p / teams
		// Require at least 2 players per team (no 1v1 option alongside FFA)
		if (size < 2) continue
		const label = Array.from({ length: teams }, () => String(size)).join('v')
		opts.push({ value: teams, label })
	}
	return opts
}, [players])

useEffect(() => {
	if (teamCount == null) return
	if (!teamCountOptions.some(o => o.value === teamCount)) setTeamCount(null)
}, [players, teamCount, teamCountOptions])

// Default to FFA when there are exactly 2 players and no selection yet
useEffect(() => {
    if (players === 2 && teamCount == null) setTeamCount(0)
}, [players, teamCount])

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

	const nextNodeId = useRef<number>(2)
	const nextLaneId = useRef<number>(1)

	// Parse share URL
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const s = params.get('s')
		if (!s) return
		try {
			const decoded = decodeState(s) as any
			if (!decoded) return
			if (Array.isArray(decoded.nodes) && Array.isArray(decoded.lanes)) {
				const withInitial: NodeItem[] = decoded.nodes.map((n: any) => {
					const cat = bodyTypeById.get(n.filling_name)?.category as BodyTypeCategory | undefined
					return { ...n, initial_category: n.initial_category ?? (cat ?? 'planet') }
				})
				setNodes(withInitial)
				setLanes(decoded.lanes)
				setSelectedId(decoded.nodes[0]?.id ?? null)
				// Skybox is fixed to skybox_random in the editor UI
                if (typeof decoded.players === 'number') setPlayers(Math.max(2, Math.min(10, decoded.players)))
                if (typeof (decoded as any).teamCount === 'number') setTeamCount(Math.max(0, Math.min(10, Math.floor((decoded as any).teamCount))))
				setScenarioName(decoded.scenarioName || 'SharedScenario')
				if (typeof decoded.modCompatVersion === 'number') setModCompatVersion(Math.max(1, Math.floor(decoded.modCompatVersion)))
				// Restore scenario metadata if present
				if (typeof decoded.author === 'string') setAuthor(decoded.author)
				if (typeof decoded.shortDescription === 'string') setShortDescription(decoded.shortDescription)
				if (typeof decoded.displayName === 'string') setDisplayName(decoded.displayName)
				if (typeof decoded.displayVersion === 'string') setDisplayVersion(decoded.displayVersion)
				if (decoded.logoDataUrl != null) setLogoDataUrl(decoded.logoDataUrl as string | null)
				if (decoded.grid && typeof decoded.grid === 'object') {
					if (typeof decoded.grid.showGrid === 'boolean') setShowGrid(decoded.grid.showGrid)
					if (typeof decoded.grid.snapToGrid === 'boolean') setSnapToGrid(decoded.grid.snapToGrid)
					if (typeof decoded.grid.gridSize === 'number') setGridSize(decoded.grid.gridSize)
				}
                nextNodeId.current = (decoded.nodes.reduce((m: number, n: NodeItem) => Math.max(m, n.id), 0) || 0) + 1
				nextLaneId.current = (decoded.lanes.reduce((m: number, l: PhaseLane) => Math.max(m, l.id), 0) || 0) + 1
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
				const withInitial: NodeItem[] = snap.nodes.map((n: any) => {
					const cat = bodyTypeById.get(n.filling_name)?.category as BodyTypeCategory | undefined
					return { ...n, initial_category: n.initial_category ?? (cat ?? 'planet') }
				})
				setNodes(withInitial)
				setLanes(snap.lanes)
				nextNodeId.current = (snap.nodes.reduce((m, n) => Math.max(m, n.id), 0) || 0) + 1
				nextLaneId.current = (snap.lanes.reduce((m, l) => Math.max(m, l.id), 0) || 0) + 1
			}
			if (typeof snap.scenarioName === 'string') setScenarioName(snap.scenarioName)
			// Force compatibility version to 2 regardless of loaded project
			setModCompatVersion(2)
            if (typeof (snap as any).author === 'string') setAuthor((snap as any).author)
            if (typeof (snap as any).shortDescription === 'string') setShortDescription((snap as any).shortDescription)
            if (typeof (snap as any).displayName === 'string') setDisplayName((snap as any).displayName)
            if (typeof (snap as any).displayVersion === 'string') setDisplayVersion((snap as any).displayVersion)
            if ((snap as any).logoDataUrl != null) setLogoDataUrl((snap as any).logoDataUrl as string | null)
			// Skybox is fixed to skybox_random in the editor UI
            if (typeof snap.players === 'number') setPlayers(Math.max(2, Math.min(10, snap.players)))
            if (typeof (snap as any).teamCount === 'number') setTeamCount(Math.max(0, Math.min(10, Math.floor((snap as any).teamCount))))
			if (snap.grid) {
				setShowGrid(!!snap.grid.showGrid)
				setSnapToGrid(!!snap.grid.snapToGrid)
				if (typeof snap.grid.gridSize === 'number') setGridSize(snap.grid.gridSize)
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
            teamCount: teamCount ?? undefined,
	            modCompatVersion: 2,
            author,
            shortDescription,
			displayName,
			displayVersion,
			logoDataUrl,
			grid: { showGrid, snapToGrid, gridSize },
		}
		const t = setTimeout(() => {
			try { localStorage.setItem(STORAGE_KEYS.project, JSON.stringify(snap)) } catch {}
		}, 300)
		return () => clearTimeout(t)
    }, [nodes, lanes, scenarioName, skybox, players, teamCount, showGrid, snapToGrid, gridSize, author, shortDescription, displayName, displayVersion, logoDataUrl])

		// Compute simple warnings
		useEffect(() => {
		const w: string[] = []
		// Self-loop lanes
		for (const l of lanes) {
			if (l.node_a === l.node_b) w.push(`Lane ${l.id} connects a node to itself`)
			const a = nodes.find(n => n.id === l.node_a)
			const b = nodes.find(n => n.id === l.node_b)
			if (!a || !b) w.push(`Lane ${l.id} references a missing node`)
			// Star lane type constraints
			if (a && b && l.type === 'star') {
				const isAStar = bodyTypeById.get(a.filling_name)?.category === 'star'
				const isBStar = bodyTypeById.get(b.filling_name)?.category === 'star'
				if (!(isAStar && isBStar)) w.push(`Lane ${l.id} type star must connect two stars`)
			}
			if (a && b && l.type === 'wormhole') {
				const aName = toGameFillingName(a.filling_name)
				const bName = toGameFillingName(b.filling_name)
				if (!(aName === 'wormhole_fixture' && bName === 'wormhole_fixture')) w.push(`Lane ${l.id} type wormhole must connect two wormhole fixtures`)
			}
		}
		// Duplicate lanes
		const lanePairs = new Set<string>()
		for (const l of lanes) {
			const key = l.node_a < l.node_b ? `${l.node_a}-${l.node_b}` : `${l.node_b}-${l.node_a}`
			if (lanePairs.has(key)) w.push(`Duplicate lane detected between ${key}`)
			lanePairs.add(key)
		}
		// Ownership player index validation (0-based)
		for (const n of nodes) {
			const p = n.ownership?.player_index
			if (typeof p === 'number' && (p < 0 || p >= players)) {
				w.push(`Node ${n.id} player_index out of range 0..${Math.max(0, players - 1)}`)
			}
		}
		// Each player may only own one non-star planet (home)
		const ownedByPlayer = new Map<number, number[]>()
		nodes.forEach(n => {
			const cat = bodyTypeById.get(n.filling_name)?.category
			const p = n.ownership?.player_index
			if (cat === 'star') return
			// Only allow specific player-ownable types
			if (typeof p === 'number' && p >= 0 && !PLAYER_OWNABLE_TYPES.has(n.filling_name)) {
				w.push(`Node ${n.id} (${n.filling_name}) cannot be player-owned. Allowed: terran, desert, ferrous, city`)
			}
			if (typeof p === 'number' && p >= 0) {
				if (!ownedByPlayer.has(p)) ownedByPlayer.set(p, [])
				ownedByPlayer.get(p)!.push(n.id)
			}
		})
		for (const [p, ids] of ownedByPlayer) {
			if (ids.length > 1) w.push(`Player ${p} owns multiple planets: ${ids.join(', ')} (only one allowed)`) 
		}

		// Minimum players validation
		if (players < 2) {
			w.push('Players must be at least 2')
		}

		// Star/body constraints
		const starIds = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category === 'star').map(n => n.id)
		if (starIds.length > 15) w.push(`Too many stars: ${starIds.length} (max 15)`) 
		const nonStars = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category !== 'star')
		// If there are bodies but no stars at all
		if (nonStars.length > 0 && starIds.length === 0) {
			w.push('Bodies exist but there are no stars. Add a star and assign parents.')
		}
		// Per-star body counts
		for (const sid of starIds) {
			const count = nonStars.filter(p => p.parent_star_id === sid).length
			if (count > 100) w.push(`Star ${sid} has ${count} bodies (max 100)`)
		}
		// Each non-star must have a valid parent star
		for (const n of nonStars) {
			if (n.parent_star_id == null) {
				w.push(`Body node ${n.id} has no parent_star_id`)
				continue
			}
			if (!starIds.includes(n.parent_star_id)) {
				w.push(`Body node ${n.id} parent_star_id ${n.parent_star_id} does not reference an existing star`)
			}
		}

		// Reachability: every non-star must be reachable from its parent star via lanes
		if (lanes.length > 0 && starIds.length > 0) {
			// Build adjacency map (undirected)
			const nodeExists = new Set(nodes.map(n => n.id))
			const adj = new Map<number, number[]>()
			const addEdge = (a: number, b: number) => {
				if (!nodeExists.has(a) || !nodeExists.has(b)) return
				if (!adj.has(a)) adj.set(a, [])
				if (!adj.has(b)) adj.set(b, [])
				adj.get(a)!.push(b)
				adj.get(b)!.push(a)
			}
			for (const l of lanes) addEdge(l.node_a, l.node_b)

			// Precompute reachability per star
			const reachableByStar = new Map<number, Set<number>>()
			for (const sid of starIds) {
				const visited = new Set<number>()
				const queue: number[] = [sid]
				visited.add(sid)
				while (queue.length > 0) {
					const cur = queue.shift()!
					const neighbors = adj.get(cur) || []
					for (const nb of neighbors) {
						if (!visited.has(nb)) { visited.add(nb); queue.push(nb) }
					}
				}
				reachableByStar.set(sid, visited)
			}

			for (const n of nonStars) {
				if (!n.parent_star_id) continue
				const reach = reachableByStar.get(n.parent_star_id)
				if (!reach || !reach.has(n.id)) {
					w.push(`Body node ${n.id} is not reachable from its parent star ${n.parent_star_id}`)
				}
			}
		}
		// Derive flags consistency
		const hasAnyWormholeNode = nodes.some(n => toGameFillingName(n.filling_name) === 'wormhole_fixture')
		const hasAnyWormholeLane = lanes.some(l => l.type === 'wormhole')
		if (!hasAnyWormholeNode && !hasAnyWormholeLane) {
			// ok if none
		} else {
			// Informative only; uniforms flag checked on export
		}

			// Enforce loot fields for all nodes (stars and bodies)
			for (const n of nodes) {
				if (typeof n.chance_of_loot !== 'number') {
					w.push(`Node ${n.id} requires Chance of Loot`)
				}
				if (typeof n.chance_of_loot === 'number' && typeof (n as any).loot_level !== 'number') {
					w.push(`Node ${n.id} requires Loot Level`)
				}
				// If player-owned, loot must be exactly 0/0
				if (typeof n.ownership?.player_index === 'number' && n.ownership.player_index >= 0) {
					if ((n.chance_of_loot ?? 0) !== 0) {
						w.push(`Node ${n.id} is player-owned and must have Chance of Loot = 0%`)
					}
					if (typeof (n as any).loot_level !== 'number' || (n as any).loot_level !== 0) {
						w.push(`Node ${n.id} is player-owned and must have Loot Level = 0`)
					}
					// Player-owned planets cannot have artifacts
					if (n.has_artifact) {
						w.push(`Node ${n.id} is player-owned and cannot have an artifact`)
					}
				}
				// If has_artifact is true, an artifact_name must be provided, and only on eligible categories
				if (n.has_artifact) {
					const cat = bodyTypeById.get(n.filling_name)?.category
					const isPirateBase = n.filling_name === 'planet_pirate_base'
					const allowedCategory = (cat === 'planet' || cat === 'moon' || cat === 'asteroid' || isPirateBase)
					if (!allowedCategory) {
						w.push(`Node ${n.id} type does not allow artifacts`)
					}
					if (!n.artifact_name || !ARTIFACT_OPTIONS.includes(n.artifact_name as any)) {
						w.push(`Node ${n.id} has_artifact=true requires a valid Artifact Name`)
					}
				}
			}

			setWarnings(w)
	}, [lanes, nodes, players])

	// Derive current star nodes for convenience
	const starNodes = useMemo(() => nodes.filter(n => bodyTypeById.get(n.filling_name)?.category === 'star'), [nodes])

	// Derive NPC planets for live badges
	const liveNpcPlanets = useMemo(() => {
		return nodes
			.filter(n => bodyTypeById.get(n.filling_name)?.category !== 'star' && !!n.ownership?.npc_filling_name)
			.map(n => ({ id: n.id, x: n.position.x, y: n.position.y, name: n.ownership!.npc_filling_name! }))
	}, [nodes])

	// Derive first home planet per player index for live canvas badges
	const liveHomeByPlayer = useMemo(() => {
		const map = new Map<number, { x: number; y: number; nodeId: number }>()
		nodes.forEach(n => {
			const cat = bodyTypeById.get(n.filling_name)?.category
			const p = n.ownership?.player_index
			if (cat === 'star') return
			if (typeof p === 'number' && p >= 0 && !map.has(p)) {
				map.set(p, { x: n.position.x, y: n.position.y, nodeId: n.id })
			}
		})
		return map
	}, [nodes])

	// Keep the parent star selector valid and helpful
	useEffect(() => {
		// If no stars, clear selection
		if (starNodes.length === 0) {
			if (newBodyParentStarId != null) setNewBodyParentStarId(null)
			return
		}
		// If current selection is not a star anymore, choose a sensible default
		const selectionStillValid = newBodyParentStarId != null && starNodes.some(s => s.id === newBodyParentStarId)
		if (!selectionStillValid) {
			// Prefer currently selected node if it's a star
			const selected = selectedId != null ? nodes.find(n => n.id === selectedId) : undefined
			const selectedIsStar = selected && bodyTypeById.get(selected.filling_name)?.category === 'star'
			if (selectedIsStar) {
				setNewBodyParentStarId(selected!.id)
			} else if (starNodes.length === 1) {
				setNewBodyParentStarId(starNodes[0].id)
			} else {
				setNewBodyParentStarId(null)
			}
		}
	}, [starNodes, selectedId, nodes, newBodyParentStarId])

	// Track canvas size responsively and fit world if not manually adjusted
	useEffect(() => {
		const compute = () => {
			if (!canvasRef.current) return
			const rect = canvasRef.current.getBoundingClientRect()
			const width = Math.max(0, Math.floor(rect.width))
			const height = Math.max(0, Math.floor(rect.height))
			setCanvasSize({ width, height })
			if (!manualView) {
				const s = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) || 1
				const x = Math.floor((width - WORLD_WIDTH * s) / 2)
				const y = Math.floor((height - WORLD_HEIGHT * s) / 2)
				setViewScale(s)
				setViewPos({ x, y })
			}
		}
		compute()
		window.addEventListener('resize', compute)
		return () => window.removeEventListener('resize', compute)
	}, [manualView])

	// Space key toggles panning mode
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== ' ') return
			const target = e.target as HTMLElement | null
			const tag = target?.tagName
			const inEditable = !!(target && (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'))
			if (inEditable) return
			setSpacePressed(true)
		}
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key !== ' ') return
			setSpacePressed(false)
			panLast.current = null
		}
		window.addEventListener('keydown', onKeyDown)
		window.addEventListener('keyup', onKeyUp)
		return () => {
			window.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('keyup', onKeyUp)
		}
	}, [])

	const updateNodePosition = (id: number, pos: Point) => {
		const snapped = snapToGrid ? { x: snap(pos.x, gridSize), y: snap(pos.y, gridSize) } : pos
		setNodes(prev => prev.map(n => (n.id === id ? { ...n, position: snapped } : n)))
	}

	const addNode = (typeId?: string) => {
		const id = nextNodeId.current++
		const filling = typeId ?? DEFAULT_BODY_TYPE_ID
		const isStar = bodyTypeById.get(filling)?.category === 'star'
		// Enforce star count ≤ 15
		if (isStar) {
			const starCount = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category === 'star').length
			if (starCount >= 15) {
				alert('Star limit reached (15).')
				return
			}
		}
		// If adding a non-star, require a parent star selection and enforce ≤100 bodies per star
		let parent_star_id: number | undefined = undefined
		if (!isStar) {
			if (starNodes.length === 0) {
				alert('Add a star first before adding bodies.')
				return
			}
			if (newBodyParentStarId == null) {
				alert('Select a Parent Star in the Tools panel before adding a body.')
				return
			}
			parent_star_id = newBodyParentStarId
			const count = nodes.filter(n => n.parent_star_id === parent_star_id).length
			if (count >= 100) {
				alert('Body limit per star reached (100).')
				return
			}
		}
		let newNode: NodeItem = {
			id,
			filling_name: filling,
			position: { x: 200 + Math.random() * 600, y: 160 + Math.random() * 400 },
			initial_category: (isStar ? 'star' : (bodyTypeById.get(filling)?.category as BodyTypeCategory || 'planet')),
			...(parent_star_id != null ? { parent_star_id } : {}),
		}
		setNodes(prev => [...prev, newNode])
		setSelectedId(id)
	}

	const removeSelected = () => {
		if (selectedId == null) return
		const selected = nodes.find(n => n.id === selectedId)
		if (!selected) return
		const category = bodyTypeById.get(selected.filling_name)?.category
		const hasLaneLinks = lanes.some(l => l.node_a === selectedId || l.node_b === selectedId)

		if (category === 'star') {
			const dependentBodies = nodes.filter(n => n.parent_star_id === selected.id && bodyTypeById.get(n.filling_name)?.category !== 'star')
			const otherStars = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category === 'star' && n.id !== selected.id)
			if (dependentBodies.length > 0) {
				if (otherStars.length === 0) {
					alert('Cannot delete the only star while bodies are assigned to it. Create another star or reassign bodies first.')
					return
				}
				// Open modal to select reassignment star
				setReassignSourceStarId(selected.id)
				const defaultTarget = (newBodyParentStarId != null && newBodyParentStarId !== selected.id && otherStars.some(s => s.id === newBodyParentStarId)) ? newBodyParentStarId : otherStars[0].id
				setReassignTargetStarId(defaultTarget)
				setReassignStarModalOpen(true)
				return
			}
			// No dependent bodies; confirm if linked by lanes
			if (hasLaneLinks) {
				const ok = confirm('Delete this star and remove its connected lanes?')
				if (!ok) return
			}
			setNodes(prev => prev.filter(n => n.id !== selectedId))
			setLanes(prev => prev.filter(l => l.node_a !== selectedId && l.node_b !== selectedId))
			setSelectedId(null)
			return
		}

		// Deleting a non-star body
		if (hasLaneLinks) {
			const ok = confirm('Delete this body and remove its connected lanes?')
			if (!ok) return
		}
		setNodes(prev => prev.filter(n => n.id !== selectedId))
		setLanes(prev => prev.filter(l => l.node_a !== selectedId && l.node_b !== selectedId))
		setSelectedId(null)
	}

	// Keyboard: Delete key removes selected node (with confirmations/rules)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Delete') return
			const target = e.target as HTMLElement | null
			const tag = target?.tagName
			const inEditable = !!(target && (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'))
			if (inEditable) return
			if (selectedId != null) {
				e.preventDefault()
				removeSelected()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [selectedId, removeSelected])

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
			const a = nodes.find(n => n.id === linkStartId)
			const b = nodes.find(n => n.id === id)
			if (!a || !b) { setLinkStartId(null); return }
			const aCat = bodyTypeById.get(a.filling_name)?.category
			const bCat = bodyTypeById.get(b.filling_name)?.category
			// If linking planet <-> star, enforce at most one star link per planet
			if ((aCat === 'planet' && bCat === 'star') || (aCat === 'star' && bCat === 'planet')) {
				const planetId = aCat === 'planet' ? a.id : b.id
				const starId = aCat === 'star' ? a.id : b.id
				// Find any existing star link for this planet
				const existingStarLink = lanes.find(l => {
					const otherId = l.node_a === planetId ? l.node_b : l.node_b === planetId ? l.node_a : null
					if (otherId == null) return false
					const otherNode = nodes.find(n => n.id === otherId)
					return !!otherNode && bodyTypeById.get(otherNode.filling_name)?.category === 'star'
				})
				if (existingStarLink) {
					// Planet already linked to some star, block linking to another star
					const existingOtherId = existingStarLink.node_a === planetId ? existingStarLink.node_b : existingStarLink.node_a
					if (existingOtherId !== starId) {
						alert('This planet is already linked to a star. Delete the existing link first.')
						setLinkStartId(null)
						return
					}
				}
				// Also honor parent_star_id if set
				const planetNode = nodes.find(n => n.id === planetId)
				if (planetNode?.parent_star_id && planetNode.parent_star_id !== starId) {
					alert('This planet already has a parent star. Delete the existing star link first.')
					setLinkStartId(null)
					return
				}
			}
			const lane: PhaseLane = { id: nextLaneId.current++, node_a: linkStartId!, node_b: id, type: newLaneType }
			setLanes(prev => [...prev, lane])
			// If planet-star link, set parent_star_id when missing
			if ((aCat === 'planet' && bCat === 'star') || (aCat === 'star' && bCat === 'planet')) {
				const planetId = aCat === 'planet' ? a.id : b.id
				const starId = aCat === 'star' ? a.id : b.id
				setNodes(prev => prev.map(n => n.id === planetId && !n.parent_star_id ? { ...n, parent_star_id: starId } : n))
			}
		}
		setLinkStartId(null)
	}

	const removeLastLane = () => {
		setLanes(prev => prev.slice(0, -1))
	}

	const onLaneClick = (laneId: number) => {
		if (!laneDeleteMode) return
		const removed = lanes.find(l => l.id === laneId)
		setLanes(prev => prev.filter(l => l.id !== laneId))
		if (removed) {
			const a = nodes.find(n => n.id === removed.node_a)
			const b = nodes.find(n => n.id === removed.node_b)
			const aCat = a ? bodyTypeById.get(a.filling_name)?.category : undefined
			const bCat = b ? bodyTypeById.get(b.filling_name)?.category : undefined
			if ((aCat === 'planet' && bCat === 'star') || (aCat === 'star' && bCat === 'planet')) {
				const planetId = aCat === 'planet' ? removed.node_a : removed.node_b
				const starId = aCat === 'star' ? removed.node_a : removed.node_b
				// After removal, if planet no longer has any star links, clear parent_star_id
				const stillLinked = lanes.some(l => {
					if (l.id === laneId) return false
					const isPlanetEndpoint = l.node_a === planetId || l.node_b === planetId
					if (!isPlanetEndpoint) return false
					const otherId = l.node_a === planetId ? l.node_b : l.node_a
					const otherNode = nodes.find(n => n.id === otherId)
					return !!otherNode && bodyTypeById.get(otherNode.filling_name)?.category === 'star'
				})
				if (!stillLinked) {
					setNodes(prev => prev.map(n => n.id === planetId && n.parent_star_id === starId ? { ...n, parent_star_id: undefined } : n))
				}
			}
		}
	}

const exportZip = async () => {
    // Strict check: block export if any node has an unrecognized body id that does not
    // map to a valid game filling and is not a known game filling id shape.
    const isGameFillingId = (id: string): boolean => {
        // Allow known direct game ids/patterns that may appear from older shares
        const patterns = [
            /^random_.+$/,                 // all random_* buckets and fixtures/stars
            /^player_home_planet$/,        // computed for player homes
            /^home_.+_planet$/,            // home_* planet variants
            /^wormhole_fixture$/,          // wormhole
        ]
        return patterns.some(r => r.test(id))
    }
    const unknownIds = Array.from(new Set(nodes
        .map(n => n.filling_name)
        .filter(id => {
            const mapped = toGameFillingName(id)
            if (mapped !== id) return false // curated mapping exists
            if (bodyTypeById.has(id)) return false // curated id exists without mapping (should be rare)
            return !isGameFillingId(id)
        })
    ))
    if (unknownIds.length > 0) {
        setAjvError('Unrecognized body types present: ' + unknownIds.join(', ') + '\nPlease change them to supported options before export.')
        return
    }
        const scenario = buildScenarioJSON(nodes, lanes, skybox)
    const sanitized = sanitizeName(scenarioName)
    // Preserve case and underscores for file base and uniforms entry
    const scenarioFileBase = sanitized
    const uniformsObj = buildScenarioUniformsObject(scenarioFileBase)

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
        // External/official schema validation removed
        if (teamCount == null) {
            setAjvError('Please select a Recommended Team Count in the Scenario panel before export.')
            return
        }
		if (warnings.length > 0) {
			setAjvError('Fix warnings before export:\n' + warnings.join('\n'))
			return
		}
		setAjvError(null)

    const zip = new JSZip()
        const root = `${scenarioFileBase}/`

        // Mod metadata and uniforms
        // Require in-game Display Name
        if (!displayName || displayName.trim().length === 0) {
            setAjvError('Please enter a Display Name (in-game) in the Scenario panel before export.')
            return
        }
        const preferredDisplayName = displayName.trim()
		zip.file(`${root}.mod_meta_data`, buildModMetaData({
            scenarioName,
			compatVersion: 2,
            displayName: preferredDisplayName,
            displayVersion: displayVersion && displayVersion.trim().length > 0 ? displayVersion.trim() : '1.0.0',
            author,
            shortDescription,
            logoFileName: logoDataUrl ? 'logo.png' : 'picture.png',
        }))
        zip.file(`${root}uniforms/scenario.uniforms`, JSON.stringify(uniformsObj, null, 2))

        // Snapshot image
        let png: Blob | null = null
        try {
            png = await createMapPictureBlob()
            if (png) zip.file(`${root}picture.png`, png)
        } catch {}

        // Build scenario .scenario zip (must contain scenario_info.json, galaxy_chart.json, galaxy_chart_fillings.json, picture.png)
        const scenarioZip = new JSZip()
        // Build scenario_info using localization keys
    const info = buildScenarioInfoJSON(nodes, lanes, players, teamCount, scenarioFileBase)
        scenarioZip.file('scenario_info.json', JSON.stringify(info, null, 2))
        scenarioZip.file('galaxy_chart.json', JSON.stringify(scenario, null, 2))
        scenarioZip.file('galaxy_chart_fillings.json', JSON.stringify({ version: 1 }, null, 2))
        if (png) scenarioZip.file('picture.png', png)
        const scenarioZipData = await scenarioZip.generateAsync({ type: 'uint8array' })
        zip.file(`${root}scenarios/${scenarioFileBase}.scenario`, scenarioZipData)

        // Localized text for scenario name/description
        const loc: Record<string, string> = {}
        loc[scenarioFileBase] = preferredDisplayName
        const descText = (shortDescription && shortDescription.trim().length > 0) ? shortDescription.trim() : `${scenarioName} created with www.sins2-mapmaker.com`
        loc[`${scenarioFileBase}_desc`] = descText
        zip.file(`${root}localized_text/en.localized_text`, JSON.stringify(loc, null, 2))

        // Optional logo file
        if (logoDataUrl) {
            try {
                const logoBlob = await (await fetch(logoDataUrl)).blob()
                zip.file(`${root}logo.png`, logoBlob)
            } catch {}
        }

        const blob = await zip.generateAsync({ type: 'blob' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
        const modZipBase = `${scenarioFileBase}_v${(displayVersion && displayVersion.trim().length > 0) ? displayVersion.trim() : '1.0.0'}`
        a.download = `${modZipBase}.zip`
		a.click()
		URL.revokeObjectURL(url)
	}

const createMapPictureBlob = async (): Promise<Blob | null> => {
		const stage: any = stageRef.current
		if (!stage || !stage.toDataURL) return null
        const pixelRatio = 2
        // Hide live badges layer during capture to avoid double-drawing
        const liveLayer = stage.findOne ? stage.findOne('#liveBadgesLayer') : null
        const prevVisible = liveLayer ? liveLayer.visible() : undefined
        if (liveLayer) { liveLayer.visible(false); stage.draw() }

		// Compute a tight crop around nodes; if nearly world-sized, fall back to full world
		const stageW: number = stage.width()
		const stageH: number = stage.height()
		const pad = 40
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
		nodes.forEach(n => {
			const r = getBodyRadiusById(n.filling_name)
			minX = Math.min(minX, n.position.x - r)
			minY = Math.min(minY, n.position.y - r)
			maxX = Math.max(maxX, n.position.x + r)
			maxY = Math.max(maxY, n.position.y + r)
		})
		let cropX = 0, cropY = 0, cropW = WORLD_WIDTH, cropH = WORLD_HEIGHT
		if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
			const tightX = Math.max(0, Math.floor(minX - pad))
			const tightY = Math.max(0, Math.floor(minY - pad))
			const tightW = Math.min(WORLD_WIDTH - tightX, Math.ceil((maxX + pad) - tightX))
			const tightH = Math.min(WORLD_HEIGHT - tightY, Math.ceil((maxY + pad) - tightY))
			// If tight box is meaningfully smaller than the world, use it; else use full world
			const tightArea = Math.max(1, tightW) * Math.max(1, tightH)
			const worldArea = WORLD_WIDTH * WORLD_HEIGHT
			const useTight = tightArea <= worldArea * 0.9
			if (useTight && tightW > 0 && tightH > 0) {
				cropX = tightX; cropY = tightY; cropW = tightW; cropH = tightH
			}
		}
		// Fit the world into the viewport by temporarily adjusting the stage transform
		const prevScaleX = stage.scaleX ? stage.scaleX() : 1
		const prevScaleY = stage.scaleY ? stage.scaleY() : 1
		const prevPos = stage.position ? stage.position() : { x: 0, y: 0 }
		const fitScale = Math.min(stageW / cropW, stageH / cropH)
		const fitX = Math.floor((stageW - cropW * fitScale) / 2 - cropX * fitScale)
		const fitY = Math.floor((stageH - cropH * fitScale) / 2 - cropY * fitScale)
		if (stage.scale) stage.scale({ x: fitScale, y: fitScale })
		if (stage.position) stage.position({ x: fitX, y: fitY })
		stage.draw()
		const dataUrl: string = stage.toDataURL({ pixelRatio })
		// Restore previous view transform
		if (stage.scale) stage.scale({ x: prevScaleX, y: prevScaleY })
		if (stage.position) stage.position({ x: prevPos.x, y: prevPos.y })
		stage.draw()
		// Restore live badges layer visibility immediately after capture
		if (liveLayer && prevVisible !== undefined) { liveLayer.visible(prevVisible); stage.draw() }
		return await new Promise<Blob | null>((resolve) => {
			const baseImg = new Image()
			baseImg.onload = () => {
                // Fixed target canvas size
                let targetW = 800
                let targetH = 775

                // Compute letterbox scale to fit baseImg into target
                const scale = Math.min(targetW / baseImg.width, targetH / baseImg.height)
                const drawW = Math.max(1, Math.floor(baseImg.width * scale))
                const drawH = Math.max(1, Math.floor(baseImg.height * scale))
                const offsetX = Math.floor((targetW - drawW) / 2)
                const offsetY = Math.floor((targetH - drawH) / 2)

                const canvas = document.createElement('canvas')
                canvas.width = targetW
                canvas.height = targetH
				const ctx = canvas.getContext('2d')
				if (!ctx) { resolve(null); return }
				// Ensure solid black background
				ctx.fillStyle = '#000000'
                ctx.fillRect(0, 0, canvas.width, canvas.height)
                ctx.drawImage(baseImg, 0, 0, baseImg.width, baseImg.height, offsetX, offsetY, drawW, drawH)
					// Determine player home planets (first body per player index)
					const homeByPlayer = new Map<number, { x: number; y: number; r: number }>()
					nodes.forEach(n => {
					const cat = bodyTypeById.get(n.filling_name)?.category
					const p = n.ownership?.player_index
					if (cat === 'star') return
						if (typeof p === 'number' && p >= 0 && !homeByPlayer.has(p)) {
							const r = getBodyRadiusById(n.filling_name)
							homeByPlayer.set(p, { x: n.position.x, y: n.position.y, r })
					}
				})
				// Draw numbered badges near homes (offset by crop) with high-contrast styling
					// Compose the full world->canvas scale: crop fit on stage, raster pixelRatio, then draw scale
					const composedScale = fitScale * pixelRatio * scale
					// Account for stage centering margins when mapping world coords to the base image
					const leftMargin = Math.floor((stageW - cropW * fitScale) / 2)
					const topMargin = Math.floor((stageH - cropH * fitScale) / 2)
					const worldToCanvas = (wx: number, wy: number) => {
						const imgX = ((wx - cropX) * fitScale + leftMargin) * pixelRatio
						const imgY = ((wy - cropY) * fitScale + topMargin) * pixelRatio
						const canvasX = Math.round(imgX * scale) + offsetX
						const canvasY = Math.round(imgY * scale) + offsetY
						return { x: canvasX, y: canvasY }
					}
					const baseBadgeRadius = Math.max(10, Math.round(14 * composedScale))
					ctx.textAlign = 'center'
					ctx.textBaseline = 'middle'
					ctx.font = `${Math.max(11, Math.round(16 * composedScale))}px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif`
					for (const [playerIdx, pos] of homeByPlayer) {
						const { x: baseX, y: baseY } = worldToCanvas(pos.x, pos.y)
						// Offset by planet radius (in world units) scaled into canvas space, plus a small margin
						const offsetDiag = Math.max(baseBadgeRadius, Math.round((pos.r + 6) * composedScale))
						const x = baseX + offsetDiag
						const y = baseY - offsetDiag
						ctx.beginPath()
						ctx.arc(x, y, baseBadgeRadius, 0, Math.PI * 2)
						ctx.fillStyle = '#111827'
						ctx.fill()
						ctx.lineWidth = Math.max(2, Math.round(3 * composedScale))
						ctx.strokeStyle = '#ffffff'
						ctx.stroke()
						ctx.fillStyle = '#ffffff'
						ctx.fillText(String(playerIdx), x, y)
					}
					// Draw NPC badges on snapshot
					const npcPlanets = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category !== 'star' && !!n.ownership?.npc_filling_name)
					for (const n of npcPlanets) {
						const { x: baseX, y: baseY } = worldToCanvas(n.position.x, n.position.y)
						const npcOffset = Math.max(baseBadgeRadius, Math.round(12 * composedScale))
						const x = baseX - npcOffset
						const y = baseY - npcOffset
						ctx.beginPath()
						ctx.arc(x, y, Math.max(9, Math.round(12 * composedScale)), 0, Math.PI * 2)
						ctx.fillStyle = '#f59e0b'
						ctx.fill()
						ctx.lineWidth = Math.max(2, Math.round(3 * composedScale))
						ctx.strokeStyle = '#111827'
						ctx.stroke()
						ctx.fillStyle = '#111827'
						ctx.textAlign = 'center'
						ctx.textBaseline = 'middle'
						ctx.font = `${Math.max(10, Math.round(13 * composedScale))}px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif`
						ctx.fillText('N', x, y)
					}
				canvas.toBlob((blob) => resolve(blob), 'image/png')
			}
			baseImg.onerror = () => resolve(null)
			baseImg.src = dataUrl
		})
	}

	const onShare = async () => {
        const payload = {
			nodes,
			lanes,
			skybox,
			players,
            teamCount,
			scenarioName,
			modCompatVersion,
			author,
			shortDescription,
			displayName,
			displayVersion,
			logoDataUrl,
			grid: { showGrid, snapToGrid, gridSize },
		}
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

	const resetProject = () => {
		const ok = confirm('Reset to a brand new scenario? This will clear the current project.')
		if (!ok) return
		// Clear persisted project state and share URL
		try { localStorage.removeItem(STORAGE_KEYS.project) } catch {}
		const url = new URL(window.location.href)
		if (url.searchParams.has('s')) {
			url.searchParams.delete('s')
			window.history.replaceState(null, '', url.toString())
		}
		// Reset in-memory state
		nextNodeId.current = 2
        nextLaneId.current = 1
		setNodes([{ id: 1, filling_name: 'star', position: { x: 360, y: 280 }, initial_category: 'star' }])
		setLanes([])
		setSelectedId(1)
		setScenarioName('MyScenario')
		setSkybox('skybox_random')
        setPlayers(2)
        setTeamCount(null)
        setModCompatVersion(2)
        setAuthor('')
        setShortDescription('')
		setLinkMode(false)
		setLaneDeleteMode(false)
		setLinkStartId(null)
		setNewLaneType('normal')
		setNewBodyParentStarId(null)
		setReassignStarModalOpen(false)
		setReassignSourceStarId(null)
		setReassignTargetStarId(null)
		setShowGrid(true)
		setSnapToGrid(true)
		setGridSize(40)
		setWarnings([])
		setAjvError(null)
	}

	const selectedNode = nodes.find(n => n.id === selectedId) || null

	const labelForOption = (id: string): string => {
		if (id === 'planet_pirate_base') return 'Pirate Base'
		return humanizeGameFillingName(toGameFillingName(id))
	}

	const dedupeForSelect = (list: BodyType[]): BodyType[] => {
		const seen = new Set<string>()
		return list.filter(b => {
			const mapped = toGameFillingName(b.id)
			const keep = (selectedNode?.filling_name === b.id) || !seen.has(mapped)
			if (keep) seen.add(mapped)
			return keep
		})
	}

	const stageWidth = canvasSize.width
	const stageHeight = canvasSize.height

	const fitView = () => {
		const width = canvasSize.width
		const height = canvasSize.height
		const s = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) || 1
		const x = Math.floor((width - WORLD_WIDTH * s) / 2)
		const y = Math.floor((height - WORLD_HEIGHT * s) / 2)
		setViewScale(s)
		setViewPos({ x, y })
		setManualView(false)
	}

  return (
		<div className="h-screen w-screen flex flex-col bg-black text-white">
			<DevBanner />
			<div className="h-12 border-b border-white/10 px-4 flex items-center justify-between">
				<div className="font-semibold tracking-wide">Sins II Scenario Editor</div>
				<div className="flex items-center gap-2">
					<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900" onClick={resetProject}>Reset</button>
					<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900" onClick={onShare}>Share</button>
					<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900" onClick={fitView}>Fit</button>
					<button className="px-4 py-1.5 rounded bg-white text-black" onClick={exportZip}>Export</button>
				</div>
			</div>
			<div className="flex flex-1 overflow-hidden">
				<div className="w-96 border-r border-white/10 p-4 overflow-auto">
					<div className="space-y-6">
		<div className="space-y-2 bg-neutral-900/30 border border-white/10 rounded p-3">
							<div className="font-medium text-sm">Scenario</div>
							<label className="block text-xs opacity-80">Scenario Name</label>
						<input className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={scenarioName} onChange={e => {
							const raw = e.target.value
							// Allow only alphanumeric and spaces; strip others
							const cleaned = raw.replace(/[^A-Za-z0-9 ]+/g, '')
							setScenarioName(cleaned)
						}} />
						<label className="block text-xs opacity-80 mt-2">Display Name (in-game, required)</label>
						<input required className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Shown in-game; e.g. My Scenario Mod" />
						<label className="block text-xs opacity-80 mt-2">Display Version</label>
						<input className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={displayVersion} onChange={e => setDisplayVersion(e.target.value)} />
						<label className="block text-xs opacity-80 mt-2">Author</label>
						<input className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={author} onChange={e => setAuthor(e.target.value)} />
						<label className="block text-xs opacity-80 mt-2">Short Description</label>
						<input className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={shortDescription} onChange={e => setShortDescription(e.target.value)} />
						<div className="block text-xs opacity-80 mt-2">Skybox</div>
						<div className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded opacity-60 select-none">skybox_random</div>
                        <label className="block text-xs opacity-80 mt-2">Players</label>
						<input type="number" min={2} max={10} className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={players} onChange={e => setPlayers(Math.max(2, Math.min(10, Number(e.target.value) || 2)))} />
                        <label className="block text-xs opacity-80 mt-2">Recommended Team Count</label>
						<select
							required
							className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded"
							value={teamCount == null ? '' : teamCount}
							onChange={e => {
								const v = e.target.value
								setTeamCount(v === '' ? null : Math.max(0, Math.min(10, Math.floor(Number(v) || 0))))
							}}
							disabled={!(players >= 2)}
						>
							<option value="">Please select…</option>
							{teamCountOptions.map(opt => (
								<option key={opt.value} value={opt.value}>{opt.label}</option>
							))}
						</select>
						<label className="block text-xs opacity-80 mt-2">Compatibility Version</label>
						<div className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded opacity-60 select-none">2</div>
                    
					<div className="mt-2">
						<div className="block text-xs opacity-80">Logo (optional, square recommended)</div>
						<input type="file" accept="image/*" className="block w-full text-xs" onChange={async e => {
							const f = e.target.files?.[0]
							if (!f) { setLogoDataUrl(null); return }
							const dataUrl = await new Promise<string>((resolve, reject) => {
								const reader = new FileReader()
								reader.onload = () => resolve(String(reader.result || ''))
								reader.onerror = () => reject(new Error('read error'))
								reader.readAsDataURL(f)
							})
							setLogoDataUrl(dataUrl)
						}} />
						{logoDataUrl && <div className="mt-2"><img src={logoDataUrl} alt="logo preview" className="max-w-[96px] max-h-[96px] border border-white/10" /></div>}
					</div>
                        <div className="block text-xs opacity-80 mt-2">Snapshot Size: 800 x 775</div>
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
						<select
							className="px-2 py-1 rounded border border-white/20 bg-neutral-900 min-w-40"
							value={newBodyParentStarId ?? ''}
							disabled={starNodes.length === 0}
							onChange={e => {
								const v = e.target.value
								setNewBodyParentStarId(v === '' ? null : Number(v))
							}}
						>
							<option value="">{starNodes.length === 0 ? 'No stars yet' : 'Parent Star: choose'}</option>
							{starNodes.map(s => (
								<option key={s.id} value={s.id}>Star {s.id}</option>
							))}
						</select>
								<button
										className="px-3 py-1 rounded border border-white/20 bg-neutral-900 disabled:opacity-40"
										disabled={starNodes.length === 0 || newBodyParentStarId == null}
									onClick={() => addNode(undefined)}
								>
									Add Body
								</button>
								<button
									className="px-3 py-1 rounded border border-white/20 bg-neutral-900"
									onClick={() => addNode('star')}
								>
									Add Star
								</button>
								<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900 disabled:opacity-40" disabled={selectedId == null} onClick={removeSelected}>Remove Selected</button>
								<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900 disabled:opacity-40" disabled={lanes.length === 0} onClick={removeLastLane}>Undo Lane</button>
							</div>
						</div>



						{selectedNode && (
							<div className="space-y-2 bg-neutral-900/30 border border-white/10 rounded p-3">
								<div className="font-medium text-sm">Selected Node</div>
								<div className="text-xs opacity-75">id: {selectedNode.id}</div>
								<div className="text-sm">Loot</div>
								<div className="grid grid-cols-2 gap-2 mt-1">
									{selectedNode.ownership?.player_index == null && (<>
									<label className="block text-xs opacity-80">Chance of Loot
                                    <select
                                        className="w-full mt-1 px-2 py-1 bg-neutral-900 border border-white/10 rounded"
										value={selectedNode.chance_of_loot ?? ''}
										disabled={selectedNode.ownership?.player_index != null}
                                        onChange={e => {
                                            const v = e.target.value
                                            const chance = Number(v)
                                            setNodes(prev => prev.map(n => {
                                                if (n.id !== selectedNode.id) return n
                                                // When chance is 0%, force loot_level to 0
                                                if (chance === 0) return { ...n, chance_of_loot: 0, loot_level: 0 }
                                                // For non-zero chance, clear loot_level so the UI shows "Select Loot Level…"
                                                return { ...n, chance_of_loot: chance, loot_level: undefined }
                                            }))
                                        }}
                                    >
                                        <option value="" disabled>Select Chance of Loot…</option>
                                        <option value={0}>0% — Never</option>
                                        <option value={0.1}>10% — Rare</option>
                                        <option value={0.25}>25% — Uncommon</option>
                                        <option value={0.5}>50% — Even</option>
                                        <option value={0.75}>75% — Common</option>
                                        <option value={1}>100% — Always</option>
                                    </select>
									</label>
									<label className="block text-xs opacity-80">Loot Level
                                    <select
                                        className="w-full mt-1 px-2 py-1 bg-neutral-900 border border-white/10 rounded"
                                        value={(nodes.find(n => n.id === selectedNode.id) as any)?.loot_level ?? ''}
										disabled={selectedNode.ownership?.player_index != null || typeof selectedNode.chance_of_loot !== 'number' || selectedNode.chance_of_loot === 0}
                                        onChange={e => {
                                            const v = e.target.value
                                            const lvl = Number(v)
                                            setNodes(prev => prev.map(n => {
                                                if (n.id !== selectedNode.id) return n
                                                // If loot level 0 is selected, force chance to 0%
                                                if (lvl === 0) return { ...n, loot_level: 0, chance_of_loot: 0 }
                                                return { ...n, loot_level: lvl }
                                            }))
                                        }}
                                    >
                                        <option value="" disabled>Select Loot Level…</option>
                                        <option value={0}>0 — None</option>
                                        <option value={1}>1 — Small</option>
                                        <option value={2}>2 — Large</option>
                                    </select>
									</label>
									</>)}
									{selectedNode.ownership?.player_index != null && (
										<div className="col-span-2 text-xs opacity-60">Loot is not applicable for player-owned planets.</div>
									)}
                            </div>

								{/* Artifacts */}
								{bodyTypeById.get(selectedNode.filling_name)?.category !== 'star' && (
								<div className="mt-2">
									<div className="text-sm">Artifact</div>
									{(() => {
										const cat = bodyTypeById.get(selectedNode.filling_name)?.category
										const isStar = cat === 'star'
										const isPlayerOwned = selectedNode.ownership?.player_index != null
										const isNpcOwned = !!selectedNode.ownership?.npc_filling_type
										const isPirateBase = selectedNode.filling_name === 'planet_pirate_base'
										const isAllowedCategory = (cat === 'planet' || cat === 'moon' || cat === 'asteroid' || isPirateBase)
										const eligible = isAllowedCategory && !isPlayerOwned && !isNpcOwned && !isStar
										if (isPlayerOwned) {
											return (
												<div className="text-xs opacity-60">Artifacts are not applicable for player-owned planets.</div>
											)
										}
										return (
										<div className="grid grid-cols-2 gap-2 mt-1">
												<label className="block text-xs opacity-80">Has Artifact
													<select
														className="w-full mt-1 px-2 py-1 bg-neutral-900 border border-white/10 rounded"
														value={eligible ? String(!!selectedNode.has_artifact) : 'false'}
														disabled={!eligible}
														onChange={e => {
															const v = e.target.value === 'true'
															setNodes(prev => prev.map(n => {
																if (n.id !== selectedNode.id) return n
																return v ? { ...n, has_artifact: true } : { ...n, has_artifact: false, artifact_name: undefined }
															}))
														}}
													>
														<option value="false">No</option>
														<option value="true">Yes</option>
													</select>
												</label>
												<label className="block text-xs opacity-80">Artifact Name
													<select
														className="w-full mt-1 px-2 py-1 bg-neutral-900 border border-white/10 rounded"
														value={selectedNode.artifact_name ?? ''}
														disabled={!eligible || !selectedNode.has_artifact}
														onChange={e => {
															const v = e.target.value
															setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, artifact_name: v || undefined } : n))
														}}
													>
														<option value="" disabled>Select Artifact…</option>
														{ARTIFACT_OPTIONS.map(a => (
															<option key={a} value={a}>{humanizeGameFillingName(a)}</option>
														))}
													</select>
												</label>
												{!eligible && (
													<div className="col-span-2 text-xs opacity-60">
														{isNpcOwned ? 'Artifacts are not applicable for NPC-owned planets.' : isStar ? 'Artifacts are not applicable for stars.' : 'Artifacts are only allowed on unowned, colonizable bodies.'}
													</div>
												)}
											</div>
										)
									})()}
								</div>
								)}
								{/* Artifact fields removed */}
								{bodyTypeById.get(selectedNode.filling_name)?.category !== 'star' && (
									<div className="mt-1">
										<label className="block text-xs opacity-80">Parent Star</label>
										<select
											className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded"
											value={selectedNode.parent_star_id ?? ''}
											disabled={starNodes.length === 0}
											onChange={e => {
												const v = e.target.value
												const targetStarId = v === '' ? null : Number(v)
												if (targetStarId == null) {
													setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, parent_star_id: undefined } : n))
													return
												}
												const countAtTarget = nodes.filter(n => n.parent_star_id === targetStarId && n.id !== selectedNode.id).length
												if (countAtTarget >= 100) {
													alert('Body limit per star reached (100).')
													return
												}
												setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, parent_star_id: targetStarId } : n))
											}}
										>
											<option value="">{starNodes.length === 0 ? 'No stars yet' : 'Choose a star'}</option>
											{starNodes.map(s => (
												<option key={s.id} value={s.id}>Star {s.id}</option>
											))}
										</select>
									</div>
								)}
				<label className="block text-xs opacity-80 mt-1">Body Type</label>
								<select
									className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded"
									value={selectedNode.filling_name}
							onChange={e => {
								const newTypeId = e.target.value
								const newCategory = bodyTypeById.get(newTypeId)?.category
								if (!newCategory) return
							// Prevent switching between star and non-star groups
							const initialCat = selectedNode.initial_category
							const initiallyStar = initialCat === 'star'
							if (initiallyStar && newCategory !== 'star') { alert('This star can only change to another star type.'); return }
							if (!initiallyStar && newCategory === 'star') { alert('This body cannot change into a star.'); return }
								const currentCategory = bodyTypeById.get(selectedNode.filling_name)?.category
									if (newCategory === 'star') {
									// If switching from non-star to star, enforce ≤15 stars
									if (currentCategory !== 'star') {
										const starCount = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category === 'star').length
										if (starCount >= 15) {
											alert('Star limit reached (15).')
											return
										}
									}
										setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, filling_name: newTypeId, parent_star_id: undefined, has_artifact: false, artifact_name: undefined } : n))
									return
								}
								// For any non-star body, require a parent star
								if (starNodes.length === 0) {
									alert('Add a star first before assigning a body type that is not a star.')
									return
								}
								let parentStarId: number | null = selectedNode.parent_star_id ?? null
								const hasValidCurrentParent = parentStarId != null && starNodes.some(s => s.id === parentStarId)
								if (!hasValidCurrentParent) {
									if (newBodyParentStarId != null && starNodes.some(s => s.id === newBodyParentStarId)) {
										parentStarId = newBodyParentStarId
									} else if (starNodes.length === 1) {
										parentStarId = starNodes[0].id
									} else {
										alert('Select a Parent Star for this body first (Tools or Selected Node panel).')
										return
									}
								}
								const countAtParent = nodes.filter(n => n.parent_star_id === parentStarId && n.id !== selectedNode.id).length
								if (countAtParent >= 100) {
									alert('Body limit per star reached (100).')
									return
								}
										setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, filling_name: newTypeId, parent_star_id: parentStarId ?? undefined } : n))
							}}
								>
								{selectedNode.initial_category === 'star' ? (
									<optgroup label="Stars">
								{dedupeForSelect(bundled.stars).map(b => (
									<option key={b.id} value={b.id}>{labelForOption(b.id)}</option>
								))}
									</optgroup>
								) : (
									<>
										<optgroup label="Planets">
									{dedupeForSelect(bundled.planets).map(b => (
										<option key={b.id} value={b.id}>{labelForOption(b.id)}</option>
									))}
										</optgroup>
										<optgroup label="Moons">
									{dedupeForSelect(bundled.moons).map(b => (
										<option key={b.id} value={b.id}>{labelForOption(b.id)}</option>
									))}
										</optgroup>
										<optgroup label="Asteroids">
									{dedupeForSelect(bundled.asteroids).map(b => (
										<option key={b.id} value={b.id}>{labelForOption(b.id)}</option>
									))}
										</optgroup>
										<optgroup label="Special">
									{dedupeForSelect(bundled.special).map(b => (
										<option key={b.id} value={b.id}>{labelForOption(b.id)}</option>
									))}
										</optgroup>
									</>
								)}
								</select>

								<div className="text-xs opacity-70 mt-1">Game filling: <span className="opacity-90">{toGameFillingName(selectedNode.filling_name)}</span></div>

						{bodyTypeById.get(selectedNode.filling_name)?.category !== 'star' && (
							<div className="mt-2">
								<div className="text-sm">Ownership</div>
								<select
									className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded"
				value={selectedNode.ownership?.player_index != null ? 'player' : selectedNode.ownership?.npc_filling_type ? 'npc' : 'none'}
									onChange={e => {
										const mode = e.target.value as 'none' | 'player' | 'npc'
										if (mode === 'player') {
											// Enforce player-ownable whitelist
											if (!PLAYER_OWNABLE_TYPES.has(selectedNode.filling_name)) {
												alert('Only Terran, Desert, Ferrous, or City planets can be player-owned.')
												return
											}
						// Assign the first available player index (0..players-1) not used by other non-star planets
											const used = new Set<number>()
											nodes.forEach(m => {
												if (m.id === selectedNode.id) return
												const cat = bodyTypeById.get(m.filling_name)?.category
												const p = m.ownership?.player_index
							if (cat !== 'star' && typeof p === 'number' && p >= 0) used.add(p)
											})
											let assign: number | null = null
						for (let i = 0; i < players; i++) { if (!used.has(i)) { assign = i; break } }
									if (assign == null) { alert('All player slots are already assigned to other planets.'); return }
										setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { player_index: assign! }, chance_of_loot: 0, loot_level: 0, has_artifact: false, artifact_name: undefined } : n))
											return
										}
                                        if (mode === 'none') { setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: undefined, chance_of_loot: undefined, loot_level: undefined } : n)); return }
										// npc
									setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { npc_filling_type: 'militia', npc_filling_name: 'default' }, chance_of_loot: undefined, loot_level: undefined, has_artifact: false, artifact_name: undefined } : n))
									}}
								>
									<option value="none">Unowned</option>
									<option value="player">Player</option>
									<option value="npc">NPC</option>
								</select>

				{selectedNode.ownership?.player_index != null && (
									<div className="space-y-1 mt-2">
							<label className="block text-sm">Player Index (0..{Math.max(0, players - 1)})</label>
							<input type="number" min={0} max={Math.max(0, players - 1)} className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.ownership.player_index}
											onChange={e => setNodes(prev => {
											// Enforce ownable types when setting player index directly
											if (!PLAYER_OWNABLE_TYPES.has(selectedNode.filling_name)) { alert('Only Terran, Desert, Ferrous, or City planets can be player-owned.'); return prev }
								const newIdx = Math.max(0, Math.min(Math.max(0, players - 1), Number(e.target.value) ?? 0))
											const conflict = prev.some(m => m.id !== selectedNode.id && bodyTypeById.get(m.filling_name)?.category !== 'star' && m.ownership?.player_index === newIdx)
											if (conflict) { alert(`Player ${newIdx} is already assigned to another planet.`); return prev }
											return prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { ...n.ownership, player_index: newIdx } } : n)
										})}
										/>
									</div>
								)}



								{selectedNode.ownership?.npc_filling_type && (
									<div className="space-y-1 mt-2">
										<label className="block text-sm">NPC Type</label>
										<select className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.ownership.npc_filling_type}
											onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { ...n.ownership, npc_filling_type: e.target.value as NodeOwnership['npc_filling_type'] } } : n) )}
										>
											<option value="militia">militia</option>
											<option value="guardian">guardian</option>
											<option value="enemy_faction">enemy_faction</option>
											<option value="friendly_faction">friendly_faction</option>
										</select>
									<label className="block text-sm">NPC Filling Name</label>
									<select className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.ownership.npc_filling_name ?? ''}
										onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { ...n.ownership, npc_filling_name: e.target.value } } : n) )}
									>
										<option value="">custom...</option>
										<option value="pirate">pirate</option>
										<option value="jiskun_force">jiskun_force</option>
										<option value="viturak_cabal">viturak_cabal</option>
										<option value="pranast_united">pranast_united</option>
									</select>
									{(selectedNode.ownership.npc_filling_name ?? '') === '' && (
											<input className="w-full mt-1 px-2 py-1 bg-neutral-900 border border-white/10 rounded" placeholder="custom NPC name"
												value={selectedNode.ownership.npc_filling_name ?? ''}
												onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { ...n.ownership, npc_filling_name: e.target.value } } : n) )}
											/>
										)}
									</div>
								)}
							</div>
						)}

							</div>
						)}

						<div className="space-y-2 bg-neutral-900/30 border border-white/10 rounded p-3">
							<div className="font-medium text-sm">Grid & Snap</div>
							<div className="flex items-center gap-3 flex-wrap mt-1">
								<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Show Grid</label>
								<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} /> Snap to Grid</label>
								<label className="flex items-center gap-2 text-sm">Size <input type="number" min={8} max={200} value={gridSize} onChange={e => setGridSize(Math.max(8, Math.min(200, Number(e.target.value) || 40)))} className="w-20 px-2 py-1 bg-neutral-900 border border-white/10 rounded" /></label>
							</div>
						</div>
					</div>
				</div>
		<div ref={canvasRef} className="flex-1 relative"
			onWheel={e => {
				// zoom to cursor
				const scaleBy = 1.05
				const stage = stageRef.current
				if (!stage) return
				const pointer = stage.getPointerPosition?.() || { x: e.clientX, y: e.clientY }
				const mouseX = pointer.x
				const mouseY = pointer.y
				const direction = e.deltaY > 0 ? -1 : 1
				const newScale = direction > 0 ? viewScale * scaleBy : viewScale / scaleBy
				const worldPoint = { x: (mouseX - viewPos.x) / viewScale, y: (mouseY - viewPos.y) / viewScale }
				const newPos = { x: mouseX - worldPoint.x * newScale, y: mouseY - worldPoint.y * newScale }
				setViewScale(newScale)
				setViewPos(newPos)
				setManualView(true)
				e.preventDefault()
			}}
			onMouseDown={e => {
				// Middle mouse (button === 1) always enables panning; Space+left also pans
				if (e.button === 1) {
					setIsPanningViaMouse(true)
					panLast.current = { x: e.clientX, y: e.clientY }
					e.preventDefault()
					return
				}
				if (!spacePressed) return
				panLast.current = { x: e.clientX, y: e.clientY }
			}}
			onMouseMove={e => {
				if (!(spacePressed || isPanningViaMouse) || !panLast.current) return
				const dx = e.clientX - panLast.current.x
				const dy = e.clientY - panLast.current.y
				panLast.current = { x: e.clientX, y: e.clientY }
				setViewPos(p => ({ x: p.x + dx, y: p.y + dy }))
				setManualView(true)
			}}
			onMouseUp={() => { panLast.current = null; setIsPanningViaMouse(false) }}
			onMouseLeave={() => { panLast.current = null; setIsPanningViaMouse(false) }}
		>
			<Stage ref={stageRef} width={stageWidth} height={stageHeight} x={viewPos.x} y={viewPos.y} scaleX={viewScale} scaleY={viewScale} style={{ background: 'black', cursor: (spacePressed || isPanningViaMouse) ? 'grab' : (laneDeleteMode ? 'not-allowed' : linkMode ? 'crosshair' : 'default') }}>
						<Layer listening={false}>
						{showGrid && renderGrid(WORLD_WIDTH, WORLD_HEIGHT, gridSize)}
							{nodes.length === 0 && (
								<KonvaText x={WORLD_WIDTH / 2 - 160} y={WORLD_HEIGHT / 2 - 10} text="Add a Star or Planet with the Tools panel" fill="#888" />
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
								fill={getBodyColorById(n.filling_name)}
								stroke={selectedId === n.id ? 'white' : undefined}
								strokeWidth={selectedId === n.id ? 2 : 0}
									draggable
								dragBoundFunc={(pos) => snapToGrid ? { x: snap(pos.x, gridSize), y: snap(pos.y, gridSize) } : pos}
								onDragEnd={e => updateNodePosition(n.id, { x: e.target.x(), y: e.target.y() })}
									onClick={() => onNodeClick(n.id)}
								/>
							))}
					</Layer>
					{/* Live home planet number badges */}
					<Layer listening={false} id="liveBadgesLayer">
						{Array.from(liveHomeByPlayer.entries()).map(([playerIdx, pos]) => (
							<Group key={`home-badge-${playerIdx}-${pos.nodeId}`} x={pos.x + 14} y={pos.y - 14}>
								<Circle x={0} y={0} radius={12} fill="#ffffff" stroke="#111827" strokeWidth={2} />
								<KonvaText x={-12} y={-12} width={24} height={24} align="center" verticalAlign="middle" text={String(playerIdx)} fill="#111827" fontSize={14} fontFamily="system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif" />
							</Group>
						))}
						{liveNpcPlanets.map(p => (
							<Group key={`npc-badge-${p.id}`} x={p.x - 14} y={p.y - 14}>
								<Circle x={0} y={0} radius={10} fill="#f59e0b" stroke="#111827" strokeWidth={2} />
								<KonvaText x={-10} y={-10} width={20} height={20} align="center" verticalAlign="middle" text="N" fill="#111827" fontSize={12} fontFamily="system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif" />
							</Group>
						))}
					</Layer>
					</Stage>
				<div className="absolute bottom-2 left-2 text-xs opacity-60">Tips: Link to create lanes; Delete Lanes to remove</div>
				{reassignStarModalOpen && reassignSourceStarId != null && (
					<div className="absolute inset-0 bg-black/60 flex items-center justify-center">
						<div className="bg-neutral-900 border border-white/20 rounded p-4 w-[380px]">
							<div className="font-medium mb-2">Delete Star {reassignSourceStarId}</div>
							<div className="text-xs opacity-80 mb-3">This star has bodies assigned. Choose a target star to reassign them before deletion.</div>
							<label className="block text-xs opacity-80 mb-1">Reassign bodies to</label>
							<select
								className="w-full px-2 py-1 bg-neutral-800 border border-white/20 rounded"
								value={reassignTargetStarId ?? ''}
								onChange={e => setReassignTargetStarId(e.target.value === '' ? null : Number(e.target.value))}
							>
								<option value="">Choose a star</option>
								{nodes
									.filter(n => bodyTypeById.get(n.filling_name)?.category === 'star' && n.id !== reassignSourceStarId)
									.map(s => <option key={s.id} value={s.id}>Star {s.id}</option>)}
							</select>
							<div className="flex justify-end gap-2 mt-4">
								<button className="px-3 py-1 rounded border border-white/20 bg-neutral-800" onClick={() => { setReassignStarModalOpen(false); setReassignSourceStarId(null); setReassignTargetStarId(null) }}>Cancel</button>
								<button className="px-3 py-1 rounded bg-white text-black" onClick={() => {
									if (reassignTargetStarId == null) { alert('Choose a target star.'); return }
									if (reassignTargetStarId === reassignSourceStarId) { alert('Choose a different star.'); return }
									const dependentBodies = nodes.filter(n => n.parent_star_id === reassignSourceStarId && bodyTypeById.get(n.filling_name)?.category !== 'star')
									const existingAtTarget = nodes.filter(n => n.parent_star_id === reassignTargetStarId).length
									if (existingAtTarget + dependentBodies.length > 100) { alert('Reassignment would exceed the per-star body limit (100).'); return }
									// Apply reassignment and delete the source star and its lanes
									setNodes(prev => prev
										.filter(n => n.id !== reassignSourceStarId)
										.map(n => n.parent_star_id === reassignSourceStarId ? { ...n, parent_star_id: reassignTargetStarId } : n)
									)
									setLanes(prev => prev.filter(l => l.node_a !== reassignSourceStarId && l.node_b !== reassignSourceStarId))
									setSelectedId(null)
									setReassignStarModalOpen(false)
									setReassignSourceStarId(null)
									setReassignTargetStarId(null)
								}}>Reassign & Delete</button>
							</div>
						</div>
					</div>
				)}
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
                            {/* External Official Schemas section removed */}
						</div>

						<div className="space-y-3 bg-neutral-900/30 border border-white/10 rounded p-3">
							<div className="font-medium text-sm">Help & Tips</div>
							<div>
								<div className="text-xs font-medium opacity-90">Getting Started</div>
								<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
									<li>Use <span className="opacity-100">Add Body</span> for a planet, or <span className="opacity-100">Add Star</span>.</li>
									<li>Select a node to change its <span className="opacity-100">Body Type</span>.</li>
									<li>Drag nodes to reposition; enable <span className="opacity-100">Snap to Grid</span> for tidy layouts.</li>
									<li>Navigate: press the middle mouse button and drag (or hold Space + drag).</li>
								</ul>
							</div>
					<div>
						<div className="text-xs font-medium opacity-90">Node Extras</div>
						<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
									<li>Chance of Loot uses presets (0/10/25/50/75/100%) and exports 0..1.</li>
									<li>Loot Level options: 0 — None, 1 — Small, 2 — Large.</li>
									<li>Artifacts can be toggled and named to match in-game artifacts.</li>
									<li>Body Type tooltips show editor id → game filling mapping.</li>
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
				<div className="h-10 border-t border-white/10 px-4 flex items-center justify-between text-xs text-white/70">
					<div>
						Fan-made tool; not affiliated with or endorsed by the Sins of a Solar Empire IP holders.
					</div>
					<div className="flex items-center gap-3">
						<a className="hover:text-white" href="https://www.sins2-mapmaker.com/" target="_blank" rel="noreferrer">Website</a>
						<a className="hover:text-white" href="https://github.com/BVisagie/sins2-mapmaker" target="_blank" rel="noreferrer">Source</a>
						<a className="hover:text-white" href="https://github.com/sponsors/BVisagie" target="_blank" rel="noreferrer">Donate</a>
						<a className="hover:text-white" href="https://github.com/BVisagie/sins2-mapmaker/issues" target="_blank" rel="noreferrer">Issues</a>
					</div>
				</div>
	      </div>
	)
}

function DevBanner() {
	const [visible, setVisible] = useState<boolean>(() => {
		try { return localStorage.getItem('sins2.devBannerDismissed') !== '1' } catch { return true }
	})
	useEffect(() => {
		if (!visible) return
		const t = setTimeout(() => setVisible(false), 10000)
		return () => clearTimeout(t)
	}, [visible])
	if (!visible) return null
	return (
		<div className="w-full bg-yellow-500/10 text-yellow-300 text-xs px-4 py-2 border-b border-yellow-500/20 flex items-center justify-between">
			<div>Active development: frequent updates may break in-progress maps. Please export often.</div>
			<button className="text-yellow-200 hover:text-yellow-100" onClick={() => { setVisible(false); try { localStorage.setItem('sins2.devBannerDismissed', '1') } catch {} }}>Dismiss</button>
		</div>
	)
}

function buildScenarioJSON(nodes: NodeItem[], lanes: PhaseLane[], skybox: string) {
    // Build hierarchical structure expected by the game: stars as roots, child_nodes under stars
    const stars = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category === 'star')
    const nonStars = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category !== 'star')

    // group non-stars under their parent star
    const childrenByStar = new Map<number, NodeItem[]>()
    for (const s of stars) childrenByStar.set(s.id, [])
    for (const b of nonStars) {
        const sid = b.parent_star_id
        if (sid == null || !childrenByStar.has(sid)) continue
        childrenByStar.get(sid)!.push(b)
    }

    // Determine one home planet per player index if present
    const playerHomePlanetByIndex = new Map<number, number>()
    for (const n of nonStars) {
        const idx = n.ownership?.player_index
        if (typeof idx === 'number' && idx >= 0) {
            if (!playerHomePlanetByIndex.has(idx)) playerHomePlanetByIndex.set(idx, n.id)
        }
    }

    const toGameNode = (n: NodeItem) => {
        const computedFilling = ((): string => {
            const idx = n.ownership?.player_index
            if (typeof idx === 'number' && playerHomePlanetByIndex.get(idx) === n.id) return 'player_home_planet'
            if (n.ownership?.npc_filling_name) return 'player_home_planet'
            return toGameFillingName(n.filling_name)
        })()
        // If the editor body is pirate base, ensure we export pirate ownership when none is provided
		const exportOwnership = ((): NodeOwnership | undefined => {
			if (n.ownership) {
				// Clean ownership to only allowed fields
				const { player_index, npc_filling_type, npc_filling_name, are_secondary_fixtures_owned } = n.ownership
				const cleaned: NodeOwnership = {}
				if (typeof player_index === 'number') cleaned.player_index = player_index
				if (npc_filling_type) cleaned.npc_filling_type = npc_filling_type
				if (typeof npc_filling_name === 'string') cleaned.npc_filling_name = npc_filling_name
				if (typeof are_secondary_fixtures_owned === 'boolean') cleaned.are_secondary_fixtures_owned = are_secondary_fixtures_owned
				return cleaned
			}
            if (n.filling_name === 'planet_pirate_base') return { npc_filling_name: 'pirate' }
            return undefined
        })()
        // Include optional loot_level if provided on node
        return {
            id: n.id,
            filling_name: computedFilling,
            position: [n.position.x, n.position.y] as [number, number],
            // rotation removed from UI; only export if present in loaded data
            ...(typeof (n as any).rotation === 'number' ? { rotation: (n as any).rotation } : {}),
            ...(typeof n.chance_of_loot === 'number' ? { chance_of_loot: n.chance_of_loot } : {}),
            ...(typeof (n as any).loot_level === 'number' ? { loot_level: (n as any).loot_level } : {}),
            ...(n.has_artifact ? { has_artifact: true } : {}),
            ...(n.has_artifact && typeof n.artifact_name === 'string' ? { artifact_name: n.artifact_name } : {}),
            // artifact export removed
            ...(exportOwnership ? { ownership: exportOwnership } : {}),
        }
    }

    const root_nodes = stars.map(s => ({
        ...toGameNode(s),
        child_nodes: (childrenByStar.get(s.id) || []).map(toGameNode),
    }))

    // lanes are preserved (ids and endpoints must stay consistent with flattened ids)
    const phase_lanes = lanes.map(l => ({
        id: l.id,
        node_a: l.node_a,
        node_b: l.node_b,
        ...(l.type === 'wormhole' ? { type: 'wormhole' as const } : {}),
    }))

    return { version: 1, skybox, root_nodes, phase_lanes }
}

function buildModMetaData(params: { scenarioName: string; compatVersion: number; displayName: string; displayVersion: string; author?: string; shortDescription?: string; logoFileName: string }) {
    const { scenarioName, compatVersion, displayName, displayVersion, author, shortDescription, logoFileName } = params
    const meta = {
        compatibility_version: compatVersion,
        display_version: displayVersion,
        display_name: displayName,
        short_description: (shortDescription && shortDescription.trim().length > 0) ? shortDescription : `${scenarioName} created with www.sins2-mapmaker.com`,
        ...(author && author.trim().length > 0 ? { author } : {}),
        logos: {
            large_logo: logoFileName,
            small_logo: logoFileName,
        },
    }
    return JSON.stringify(meta, null, 2)
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

function buildScenarioInfoJSON(nodes: NodeItem[], lanes: PhaseLane[], players: number, teamCount: number, scenarioKey: string) {
    // Determine flags
    const hasWormholes = nodes.some(n => toGameFillingName(n.filling_name) === 'wormhole_fixture') || lanes.some(l => l.type === 'wormhole')
    const nonStars = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category !== 'star')
    const planetCount = nonStars.length
    const starCount = nodes.length - nonStars.length
    // Use colon-prefixed keys that exactly match our localization keys (underscores)
    const nameText = `:${scenarioKey}`
    const descText = `:${scenarioKey}_desc`
    const hasNpcs = nodes.some(n => !!n.ownership?.npc_filling_name)

    return {
        version: 1,
        name: nameText,
        description: descText,
        desired_player_slots_configuration: {
            player_count: Math.max(2, Math.min(10, Math.floor(players) || 2)),
            team_count: Math.max(0, Math.min(10, Math.floor(teamCount) || 0)),
        },
        can_gravity_wells_move: false,
        are_player_slots_randomized: false,
        planet_counts: [planetCount, planetCount],
        star_counts: [starCount, starCount],
        has_wormholes: hasWormholes,
        ...(hasNpcs ? { has_npcs: true } : {}),
        resources: 'scenario_options_view_resources_high',
        map_type: 'scenario_options_view_map_type_custom',
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
    // Compress to base64-safe URI component
    return LZString.compressToEncodedURIComponent(json)
}
function decodeState(s: string) {
    // Try LZString first
    try {
        const json = LZString.decompressFromEncodedURIComponent(s)
        if (json) return JSON.parse(json)
    } catch {}
    // Fallback to legacy base64url decoding for backward compatibility
    try {
        const pad = s.length % 4 === 0 ? s : s + '=== '.slice(0, 4 - (s.length % 4))
        const b64 = pad.replace(/-/g, '+').replace(/_/g, '/')
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const json = new TextDecoder().decode(bytes)
        return JSON.parse(json)
    } catch {}
    return null
}
