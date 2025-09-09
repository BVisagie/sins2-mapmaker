export type BodyTypeCategory = 'star' | 'planet' | 'moon' | 'asteroid' | 'special'

export interface BodyType {
	id: string // used as filling_name
	label: string
	category: BodyTypeCategory
	radius: number
}

export const BODY_TYPES: BodyType[] = [
	// Stars
	{ id: 'star', label: 'Star', category: 'star', radius: 20 },

	// Colonizable planets (curated)
	{ id: 'planet_asteroid', label: 'Asteroid (Poor)', category: 'planet', radius: 12 },
	{ id: 'planet_ice_asteroid', label: 'Ice Asteroid (Poor)', category: 'planet', radius: 12 },
	{ id: 'planet_hive_asteroid', label: 'Hive Asteroid (Poor)', category: 'planet', radius: 12 },
	{ id: 'planet_moon', label: 'Moon (Poor)', category: 'planet', radius: 11 },
	{ id: 'planet_ice_moon', label: 'Ice Moon (Poor)', category: 'planet', radius: 11 },
	{ id: 'planet_volcanic_moon', label: 'Volcanic Moon (Poor)', category: 'planet', radius: 11 },
	{ id: 'planet_barren', label: 'Barren (Fair)', category: 'planet', radius: 13 },
	{ id: 'planet_volcanic', label: 'Volcanic (Fair)', category: 'planet', radius: 14 },
	{ id: 'planet_ice', label: 'Ice (Fair)', category: 'planet', radius: 14 },
	{ id: 'planet_primordial', label: 'Primordial (Rich)', category: 'planet', radius: 15 },
	{ id: 'planet_terran', label: 'Terran (Rich)', category: 'planet', radius: 14 },
	{ id: 'planet_desert', label: 'Desert (Rich)', category: 'planet', radius: 14 },
	{ id: 'planet_ferrous', label: 'Ferrous (Rich)', category: 'planet', radius: 14 },
	{ id: 'planet_crystalline', label: 'Crystalline (Rich)', category: 'planet', radius: 14 },
	{ id: 'planet_oceanic', label: 'Oceanic (Rich)', category: 'planet', radius: 14 },
	{ id: 'planet_geomagnetic', label: 'Geomagnetic (Rich)', category: 'planet', radius: 14 },
	{ id: 'planet_city', label: 'City (Rich)', category: 'planet', radius: 15 },
	{ id: 'planet_gas_giant', label: 'Gas Giant (Special)', category: 'planet', radius: 18 },
	{ id: 'planet_ship_graveyard', label: 'Ship Graveyard (Special)', category: 'planet', radius: 14 },
	{ id: 'planet_pirate_base', label: 'Pirate Base (Special)', category: 'planet', radius: 14 },

	// Moons category (separate visuals if desired)
	{ id: 'moon_small', label: 'Moon — Small', category: 'moon', radius: 10 },
	{ id: 'moon_large', label: 'Moon — Large', category: 'moon', radius: 12 },

	// Asteroids and fields (non-colonizable options)
	{ id: 'asteroid_field', label: 'Asteroid Field', category: 'asteroid', radius: 10 },
	{ id: 'asteroid_belt', label: 'Asteroid Belt', category: 'asteroid', radius: 12 },
	{ id: 'dead_asteroid', label: 'Dead Asteroid', category: 'asteroid', radius: 10 },

	// Specials
	{ id: 'wormhole', label: 'Wormhole', category: 'special', radius: 12 },
	{ id: 'black_hole', label: 'Black Hole', category: 'special', radius: 22 },
]

export const DEFAULT_BODY_TYPE_ID = 'planet_terran'

export const bodyTypeById = new Map(BODY_TYPES.map(b => [b.id, b]))

export function getBodyRadiusById(id: string): number {
	return bodyTypeById.get(id)?.radius ?? 14
}





