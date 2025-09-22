export type BodyTypeCategory = 'star' | 'planet' | 'moon' | 'asteroid' | 'special'

export interface BodyType {
	id: string // used as filling_name
	label: string
	category: BodyTypeCategory
	radius: number
	color: string
}

export const BODY_TYPES: BodyType[] = [
	// Stars
	{ id: 'star', label: 'Random Star', category: 'star', radius: 20, color: '#fbbf24' },
    { id: 'star_yellow', label: 'Yellow Star', category: 'star', radius: 20, color: '#fbbf24' },
    { id: 'star_orange', label: 'Orange Star', category: 'star', radius: 21, color: '#f59e0b' },
    { id: 'star_red_giant', label: 'Red Giant', category: 'star', radius: 24, color: '#ef4444' },
    { id: 'star_white_dwarf', label: 'White Dwarf', category: 'star', radius: 12, color: '#e5e7eb' },
    { id: 'star_neutron', label: 'Neutron Star', category: 'star', radius: 10, color: '#a855f7' },
    { id: 'star_blue_giant', label: 'Blue Giant', category: 'star', radius: 26, color: '#60a5fa' },
    { id: 'star_binary', label: 'Binary Star', category: 'star', radius: 26, color: '#f43f5e' },
    { id: 'star_black_hole', label: 'Black Hole Star', category: 'star', radius: 24, color: '#111827' },

	// Colonizable planets (curated)
	{ id: 'planet_ice_moon', label: 'Ice Moon', category: 'moon', radius: 11, color: '#bfdbfe' },
	{ id: 'planet_volcanic_moon', label: 'Volcanic Moon', category: 'moon', radius: 11, color: '#f97316' },
	{ id: 'planet_barren', label: 'Barren', category: 'planet', radius: 13, color: '#d6d3d1' },
	{ id: 'planet_volcanic', label: 'Volcanic', category: 'planet', radius: 14, color: '#ea580c' },
	{ id: 'planet_ice', label: 'Ice', category: 'planet', radius: 14, color: '#60a5fa' },
	    { id: 'planet_swamp', label: 'Swamp', category: 'planet', radius: 14, color: '#16a34a' },
	{ id: 'planet_terran', label: 'Terran', category: 'planet', radius: 14, color: '#22c55e' },
	{ id: 'planet_desert', label: 'Desert', category: 'planet', radius: 14, color: '#fbbf24' },
	{ id: 'planet_ferrous', label: 'Ferrous', category: 'planet', radius: 14, color: '#92400e' },
	{ id: 'planet_crystalline', label: 'Crystalline', category: 'planet', radius: 14, color: '#8b5cf6' },
	{ id: 'planet_oceanic', label: 'Oceanic', category: 'planet', radius: 14, color: '#2563eb' },
	    { id: 'planet_geomagnetic', label: 'Geomagnetic', category: 'planet', radius: 14, color: '#d946ef' },
	    { id: 'planet_greenhouse', label: 'Greenhouse', category: 'planet', radius: 14, color: '#84cc16' },
	{ id: 'planet_city', label: 'City', category: 'planet', radius: 15, color: '#f472b6' },
	{ id: 'planet_gas_giant', label: 'Gas Giant', category: 'planet', radius: 18, color: '#7c3aed' },
	{ id: 'planet_ship_graveyard', label: 'Ship Graveyard', category: 'planet', radius: 14, color: '#4b5563' },
	{ id: 'planet_pirate_base', label: 'Pirate Base', category: 'planet', radius: 14, color: '#991b1b' },
	// Additional planet variants (random_* support)
	{ id: 'planet_brown_dwarf', label: 'Brown Dwarf', category: 'planet', radius: 16, color: '#8b5cf6' },
	{ id: 'planet_irradiated', label: 'Irradiated', category: 'planet', radius: 14, color: '#f59e0b' },
	{ id: 'planet_shattered', label: 'Shattered', category: 'planet', radius: 13, color: '#9ca3af' },
	{ id: 'planet_uncolonizable', label: 'Uncolonizable', category: 'planet', radius: 14, color: '#6b7280' },

	// Moons category (separate visuals if desired)
	{ id: 'moon_small', label: 'Moon — Small', category: 'moon', radius: 10, color: '#e5e7eb' },
	{ id: 'moon_large', label: 'Moon — Large', category: 'moon', radius: 12, color: '#9ca3af' },
	{ id: 'moon_weighted', label: 'Weighted Moon', category: 'moon', radius: 11, color: '#cbd5e1' },

	// Asteroids and fields (non-colonizable options)
	{ id: 'asteroid_field', label: 'Asteroid Field', category: 'asteroid', radius: 10, color: '#6b7280' },
	{ id: 'asteroid_belt', label: 'Asteroid Belt', category: 'asteroid', radius: 12, color: '#9ca3af' },
	{ id: 'dead_asteroid', label: 'Dead Asteroid', category: 'asteroid', radius: 10, color: '#374151' },
	{ id: 'asteroid_point_line_cluster', label: 'Asteroid Cluster (Point/Line)', category: 'asteroid', radius: 12, color: '#94a3b8' },
	{ id: 'asteroid_hive', label: 'Hive Asteroid', category: 'asteroid', radius: 12, color: '#34d399' },

	// Specials
    { id: 'wormhole', label: 'Wormhole', category: 'special', radius: 12, color: '#06b6d4' },
	{ id: 'black_hole', label: 'Black Hole', category: 'special', radius: 22, color: '#000000' },
	{ id: 'special_radiation_storm', label: 'Radiation Storm', category: 'special', radius: 12, color: '#facc15' },
	{ id: 'special_antimatter_fountain', label: 'Antimatter Fountain', category: 'special', radius: 12, color: '#22d3ee' },
]

export const DEFAULT_BODY_TYPE_ID = 'planet_terran'

export const bodyTypeById = new Map(BODY_TYPES.map(b => [b.id, b]))

export function getBodyRadiusById(id: string): number {
	return bodyTypeById.get(id)?.radius ?? 14
}

export function getBodyColorById(id: string): string {
	return bodyTypeById.get(id)?.color ?? 'rgba(255,255,255,0.85)'
}

// Mapping between editor body ids and Stardock filling_name values
// This is used on export to build game-valid scenario JSON
export const EDITOR_TO_GAME_FILLING: Record<string, string> = {
    // Stars
    star: 'random_star',
    star_yellow: 'random_yellow_star',
    star_orange: 'random_orange_star',
    star_red_giant: 'random_red_star',
    star_white_dwarf: 'random_white_star',
    star_neutron: 'random_neutron_star',
    star_blue_giant: 'random_blue_star',
    star_binary: 'random_binary_star',
    star_black_hole: 'random_black_hole_star',

    // Colonizable planets
    planet_ice_moon: 'random_ice_moon_planet',
    planet_volcanic_moon: 'random_volcanic_moon_planet',
    planet_barren: 'random_barren_planet',
    planet_volcanic: 'random_volcanic_planet',
    planet_ice: 'random_ice_planet',
    planet_swamp: 'random_swamp_planet',
    planet_terran: 'random_terran_planet',
    planet_desert: 'random_desert_planet',
    planet_ferrous: 'random_ferrous_planet',
    planet_crystalline: 'random_crystalline_planet',
    planet_oceanic: 'random_oceanic_planet',
    planet_geomagnetic: 'random_magnetic_planet',
    planet_greenhouse: 'random_greenhouse_planet',
    planet_city: 'random_city_planet',
    planet_gas_giant: 'random_gas_giant_planet',
    planet_ship_graveyard: 'random_ship_graveyard_planet',
    planet_pirate_base: 'player_home_planet',
	planet_brown_dwarf: 'random_brown_dwarf_planet',
	planet_irradiated: 'random_irradiated_planet',
	planet_shattered: 'random_shattered_planet',
	planet_uncolonizable: 'random_uncolonizable_planet',

    // Asteroids and fields (non-colonizable fixtures in game terms)
    asteroid_field: 'random_asteroid',
    asteroid_belt: 'random_asteroid',
    dead_asteroid: 'random_dead_asteroid',
	asteroid_point_line_cluster: 'random_asteroid_point_line_cluster',
	asteroid_hive: 'random_hive_asteroid',
    // Moons
    moon_small: 'random_moon_planet',
    moon_large: 'random_moon_planet',
	moon_weighted: 'random_moon_planet_weighted',

    // Specials
    wormhole: 'wormhole_fixture',
    black_hole: 'random_black_hole_fixture',
	special_radiation_storm: 'random_radiation_storm_fixture',
	special_antimatter_fountain: 'random_antimatter_fountain_fixture',
}

export function toGameFillingName(editorId: string): string {
    return EDITOR_TO_GAME_FILLING[editorId] ?? editorId
}





