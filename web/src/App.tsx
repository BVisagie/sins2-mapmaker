import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Stage, Layer, Circle, Line, Group, Text as KonvaText } from 'react-konva'
import JSZip from 'jszip'
import Ajv, { type ValidateFunction } from 'ajv'
import './index.css'

const APP_VERSION = '0.6.0'
// Only these body types may be owned by players
const PLAYER_OWNABLE_TYPES = new Set<string>(['planet_terran', 'planet_desert', 'planet_ferrous', 'planet_city'])
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
	parent_star_id?: number
    rotation?: number
    chance_of_loot?: number
    has_artifact?: boolean
    artifact_name?: string
	initial_category: BodyTypeCategory
}
interface PhaseLane { id: number; node_a: number; node_b: number; type?: 'normal' | 'star' | 'wormhole' }

import { BODY_TYPES, DEFAULT_BODY_TYPE_ID, getBodyRadiusById, bodyTypeById, getBodyColorById, toGameFillingName } from './data/bodyTypes'
import type { BodyTypeCategory } from './data/bodyTypes'

interface ProjectStateSnapshot {
	nodes: NodeItem[]
	lanes: PhaseLane[]
	scenarioName: string
	skybox: string
	players: number
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
				setScenarioName(decoded.scenarioName || 'SharedScenario')
                if (typeof decoded.modCompatVersion === 'number') setModCompatVersion(Math.max(1, Math.floor(decoded.modCompatVersion)))
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
            if (typeof (snap as any).modCompatVersion === 'number') setModCompatVersion(Math.max(1, Math.floor((snap as any).modCompatVersion)))
            if (typeof (snap as any).author === 'string') setAuthor((snap as any).author)
            if (typeof (snap as any).shortDescription === 'string') setShortDescription((snap as any).shortDescription)
            if (typeof (snap as any).displayName === 'string') setDisplayName((snap as any).displayName)
            if (typeof (snap as any).displayVersion === 'string') setDisplayVersion((snap as any).displayVersion)
            if ((snap as any).logoDataUrl != null) setLogoDataUrl((snap as any).logoDataUrl as string | null)
			// Skybox is fixed to skybox_random in the editor UI
			if (typeof snap.players === 'number') setPlayers(Math.max(2, Math.min(10, snap.players)))
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
            modCompatVersion,
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
    }, [nodes, lanes, scenarioName, skybox, players, showGrid, snapToGrid, gridSize, author, shortDescription, displayName, displayVersion, logoDataUrl])

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
		// Ownership player index validation
		for (const n of nodes) {
			if (n.ownership?.player_index && (n.ownership.player_index < 1 || n.ownership.player_index > players)) {
				w.push(`Node ${n.id} player_index out of range 1..${players}`)
			}
		}
		// Each player may only own one non-star planet (home)
		const ownedByPlayer = new Map<number, number[]>()
		nodes.forEach(n => {
			const cat = bodyTypeById.get(n.filling_name)?.category
			const p = n.ownership?.player_index
			if (cat === 'star') return
			// Only allow specific player-ownable types
			if (typeof p === 'number' && p >= 1 && !PLAYER_OWNABLE_TYPES.has(n.filling_name)) {
				w.push(`Node ${n.id} (${n.filling_name}) cannot be player-owned. Allowed: terran, desert, ferrous, city`)
			}
			if (typeof p === 'number' && p >= 1) {
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

		setWarnings(w)
	}, [lanes, nodes, players])

	// Derive current star nodes for convenience
	const starNodes = useMemo(() => nodes.filter(n => bodyTypeById.get(n.filling_name)?.category === 'star'), [nodes])

	// Derive first home planet per player index for live canvas badges
	const liveHomeByPlayer = useMemo(() => {
		const map = new Map<number, { x: number; y: number; nodeId: number }>()
		nodes.forEach(n => {
			const cat = bodyTypeById.get(n.filling_name)?.category
			const p = n.ownership?.player_index
			if (cat === 'star') return
			if (typeof p === 'number' && p >= 1 && !map.has(p)) {
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
		const newNode: NodeItem = {
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
            compatVersion: modCompatVersion,
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
        const info = buildScenarioInfoJSON(nodes, lanes, players, scenarioName, shortDescription)
        scenarioZip.file('scenario_info.json', JSON.stringify(info, null, 2))
        scenarioZip.file('galaxy_chart.json', JSON.stringify(scenario, null, 2))
        scenarioZip.file('galaxy_chart_fillings.json', JSON.stringify({ version: 1 }, null, 2))
        if (png) scenarioZip.file('picture.png', png)
        const scenarioZipData = await scenarioZip.generateAsync({ type: 'uint8array' })
        zip.file(`${root}scenarios/${scenarioFileBase}.scenario`, scenarioZipData)

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

		// Compute tight bounding box around all nodes (including radii)
		if (nodes.length === 0) {
			const dataUrlFull: string = stage.toDataURL({ pixelRatio })
            // Restore live badges layer visibility immediately after capture
            if (liveLayer && prevVisible !== undefined) { liveLayer.visible(prevVisible); stage.draw() }
			return await new Promise<Blob | null>((resolve) => {
				const img = new Image()
				img.onload = () => {
					const canvas = document.createElement('canvas')
					canvas.width = img.width
					canvas.height = img.height
					const ctx = canvas.getContext('2d')
					if (!ctx) { resolve(null); return }
					ctx.fillStyle = '#000000'
					ctx.fillRect(0, 0, canvas.width, canvas.height)
					ctx.drawImage(img, 0, 0)
					canvas.toBlob((blob) => resolve(blob), 'image/png')
				}
				img.onerror = () => resolve(null)
				img.src = dataUrlFull
			})
		}

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
		if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
			minX = 0; minY = 0; maxX = stageW; maxY = stageH
		}
		let cropX = Math.max(0, Math.floor(minX - pad))
		let cropY = Math.max(0, Math.floor(minY - pad))
		let cropW = Math.ceil((maxX + pad) - cropX)
		let cropH = Math.ceil((maxY + pad) - cropY)
		if (cropX + cropW > stageW) cropW = stageW - cropX
		if (cropY + cropH > stageH) cropH = stageH - cropY
		if (cropW <= 0 || cropH <= 0) { cropX = 0; cropY = 0; cropW = stageW; cropH = stageH }

		const dataUrl: string = stage.toDataURL({ x: cropX, y: cropY, width: cropW, height: cropH, pixelRatio })
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
				const homeByPlayer = new Map<number, { x: number; y: number }>()
				nodes.forEach(n => {
					const cat = bodyTypeById.get(n.filling_name)?.category
					const p = n.ownership?.player_index
					if (cat === 'star') return
					if (typeof p === 'number' && p >= 1 && !homeByPlayer.has(p)) {
						homeByPlayer.set(p, { x: n.position.x, y: n.position.y })
					}
				})
				// Draw numbered badges near homes (offset by crop) with high-contrast styling
					const stageToCanvasScale = scale * pixelRatio
					const badgeRadius = Math.max(10, Math.round(14 * stageToCanvasScale))
					const badgeOffsetX = Math.round(14 * stageToCanvasScale)
					const badgeOffsetY = Math.round(-14 * stageToCanvasScale)
					ctx.textAlign = 'center'
					ctx.textBaseline = 'middle'
					ctx.font = `${Math.max(10, Math.round(14 * stageToCanvasScale))}px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif`
					for (const [playerIdx, pos] of homeByPlayer) {
						const x = Math.round((pos.x - cropX) * stageToCanvasScale) + offsetX + badgeOffsetX
						const y = Math.round((pos.y - cropY) * stageToCanvasScale) + offsetY + badgeOffsetY
						ctx.beginPath()
						ctx.arc(x, y, badgeRadius, 0, Math.PI * 2)
						ctx.fillStyle = '#ffffff'
						ctx.fill()
						ctx.lineWidth = Math.max(1, Math.round(2 * stageToCanvasScale))
						ctx.strokeStyle = '#111827'
						ctx.stroke()
						ctx.fillStyle = '#111827'
						ctx.fillText(String(playerIdx), x, y)
					}
				canvas.toBlob((blob) => resolve(blob), 'image/png')
			}
			baseImg.onerror = () => resolve(null)
			baseImg.src = dataUrl
		})
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

	const stageWidth = canvasSize.width
	const stageHeight = canvasSize.height

  return (
		<div className="h-screen w-screen flex flex-col bg-black text-white">
			<div className="h-12 border-b border-white/10 px-4 flex items-center justify-between">
				<div className="font-semibold tracking-wide">Sins II Scenario Editor</div>
				<div className="flex items-center gap-2">
					<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900" onClick={resetProject}>Reset</button>
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
					<label className="block text-xs opacity-80 mt-2">Compatibility Version</label>
					<input type="number" min={1} className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={modCompatVersion} onChange={e => setModCompatVersion(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
                    
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
							<div className="font-medium text-sm">Solar System</div>
							<div className="text-xs opacity-75">A scenario represents a single solar system. You can add multiple stars and their planets below.</div>
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
						<button className="px-3 py-1 rounded border border-white/20 bg-neutral-900 disabled:opacity-40" disabled={starNodes.length === 0 || newBodyParentStarId == null} onClick={() => addNode(undefined)}>Add Body</button>
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
                            <div className="grid grid-cols-2 gap-2 mt-1">
                                <label className="block text-xs opacity-80">Rotation
                                    <input type="number" step={0.1} className="w-full mt-1 px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.rotation ?? ''}
                                        onChange={e => {
                                            const v = e.target.value
                                            setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, rotation: v === '' ? undefined : Number(v) } : n))
                                        }}
                                    />
                                </label>
                                <label className="block text-xs opacity-80">Chance of Loot (0..1)
                                    <input type="number" min={0} max={1} step={0.05} className="w-full mt-1 px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.chance_of_loot ?? ''}
                                        onChange={e => {
                                            const v = e.target.value
                                            let num = v === '' ? undefined : Number(v)
                                            if (typeof num === 'number') num = Math.max(0, Math.min(1, num as number))
                                            setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, chance_of_loot: (num as number | undefined) } : n))
                                        }}
                                    />
                                </label>
                            </div>
                            <div className="mt-2">
                                <label className="inline-flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={!!selectedNode.has_artifact} onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, has_artifact: e.target.checked, ...(e.target.checked ? {} : { artifact_name: undefined }) } : n))} />
                                    Has Artifact
                                </label>
                                {selectedNode.has_artifact && (
                                    <div className="mt-1">
                                        <label className="block text-xs opacity-80">Artifact Name</label>
                                        <input className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded" value={selectedNode.artifact_name ?? ''}
                                            onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, artifact_name: e.target.value } : n))}
                                        />
                                    </div>
                                )}
                            </div>
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
									setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, filling_name: newTypeId, parent_star_id: undefined } : n))
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
								<optgroup label="Stars (Bundled)">
									{bundled.stars.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
								</optgroup>
							) : (
								<optgroup label="Bodies (Bundled)">
									{[...bundled.planets, ...bundled.moons, ...bundled.asteroids, ...bundled.special].map(b => (
										<option key={b.id} value={b.id}>{b.label}</option>
									))}
								</optgroup>
							)}
								</select>

						{bodyTypeById.get(selectedNode.filling_name)?.category !== 'star' && (
							<div className="mt-2">
								<div className="text-sm">Ownership</div>
								<select
									className="w-full px-2 py-1 bg-neutral-900 border border-white/10 rounded"
									value={selectedNode.ownership?.player_index ? 'player' : selectedNode.ownership?.npc_filling_type ? 'npc' : 'none'}
									onChange={e => {
										const mode = e.target.value as 'none' | 'player' | 'npc'
										if (mode === 'player') {
											// Enforce player-ownable whitelist
											if (!PLAYER_OWNABLE_TYPES.has(selectedNode.filling_name)) {
												alert('Only Terran, Desert, Ferrous, or City planets can be player-owned.')
												return
											}
											// Assign the first available player index (1..players) not used by other non-star planets
											const used = new Set<number>()
											nodes.forEach(m => {
												if (m.id === selectedNode.id) return
												const cat = bodyTypeById.get(m.filling_name)?.category
												const p = m.ownership?.player_index
												if (cat !== 'star' && typeof p === 'number' && p >= 1) used.add(p)
											})
											let assign: number | null = null
											for (let i = 1; i <= players; i++) { if (!used.has(i)) { assign = i; break } }
											if (assign == null) { alert('All player slots are already assigned to other planets.'); return }
											setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { player_index: assign! } } : n))
											return
										}
										if (mode === 'none') { setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: undefined } : n)); return }
										// npc
										setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, ownership: { npc_filling_type: 'militia', npc_filling_name: 'default' } } : n))
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
											onChange={e => setNodes(prev => {
											// Enforce ownable types when setting player index directly
											if (!PLAYER_OWNABLE_TYPES.has(selectedNode.filling_name)) { alert('Only Terran, Desert, Ferrous, or City planets can be player-owned.'); return prev }
											const newIdx = Math.max(1, Math.min(players, Number(e.target.value) || 1))
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
								</ul>
							</div>
					<div>
						<div className="text-xs font-medium opacity-90">Node Extras</div>
						<ul className="text-xs opacity-80 list-disc pl-5 space-y-1 mt-1">
							<li>Rotation and loot chance are optional per-node fields.</li>
							<li>Artifacts can be toggled and named to match in-game artifacts.</li>
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
        if (typeof idx === 'number' && idx >= 1) {
            if (!playerHomePlanetByIndex.has(idx)) playerHomePlanetByIndex.set(idx, n.id)
        }
    }

    const toGameNode = (n: NodeItem) => {
        const computedFilling = ((): string => {
            const idx = n.ownership?.player_index
            if (typeof idx === 'number' && playerHomePlanetByIndex.get(idx) === n.id) return 'player_home_planet'
            return toGameFillingName(n.filling_name)
        })()
        // If the editor body is pirate base, ensure we export pirate ownership when none is provided
        const exportOwnership = ((): NodeOwnership | undefined => {
            if (n.ownership) return n.ownership
            if (n.filling_name === 'planet_pirate_base') return { npc_filling_name: 'pirate' }
            return undefined
        })()
        return {
            id: n.id,
            filling_name: computedFilling,
            position: [n.position.x, n.position.y] as [number, number],
            ...(typeof n.rotation === 'number' ? { rotation: n.rotation } : {}),
            ...(typeof n.chance_of_loot === 'number' ? { chance_of_loot: n.chance_of_loot } : {}),
            ...(n.has_artifact ? { has_artifact: true } : {}),
            ...(n.has_artifact && n.artifact_name ? { artifact_name: n.artifact_name } : {}),
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

function buildScenarioInfoJSON(nodes: NodeItem[], lanes: PhaseLane[], players: number, scenarioName: string, desc: string) {
    // Determine flags
    const hasWormholes = nodes.some(n => toGameFillingName(n.filling_name) === 'wormhole_fixture') || lanes.some(l => l.type === 'wormhole')
    const nonStars = nodes.filter(n => bodyTypeById.get(n.filling_name)?.category !== 'star')
    const planetCount = nonStars.length
    const starCount = nodes.length - nonStars.length
    // Use plain text name/description (no localization keys)
    const nameText = scenarioName.replace(/_/g, ' ')
    const descText = (desc && desc.trim().length > 0 ? desc : `${scenarioName} created with www.sins2-mapmaker.com`)
    return {
        version: 1,
        name: nameText,
        description: descText,
        desired_player_slots_configuration: {
            player_count: Math.max(2, Math.min(10, Math.floor(players) || 2)),
            team_count: 0,
        },
        can_gravity_wells_move: false,
        are_player_slots_randomized: false,
        planet_counts: [planetCount, planetCount],
        star_counts: [starCount, starCount],
        has_wormholes: hasWormholes,
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
