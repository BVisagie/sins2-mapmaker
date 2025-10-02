import { useEffect, useState } from 'react'

const STORAGE_KEY = 'sins2.mobileBannerDismissedAt'
const MOBILE_BANNER_TTL_MS = 3 * 24 * 60 * 60 * 1000

export default function MobileBanner() {
	const [isNarrow, setIsNarrow] = useState<boolean>(false)
	const [dismissedAt, setDismissedAt] = useState<number | null>(null)

	useEffect(() => {
		try {
			const v = localStorage.getItem(STORAGE_KEY)
			if (v != null) setDismissedAt(Number(v) || 0)
		} catch {}
		const mql = window.matchMedia('(max-width: 1023px)')
		const update = () => setIsNarrow(!!mql.matches)
		update()
		if (typeof mql.addEventListener === 'function') {
			mql.addEventListener('change', update)
			return () => mql.removeEventListener('change', update)
		} else if (typeof (mql as any).addListener === 'function') {
			;(mql as any).addListener(update)
			return () => (mql as any).removeListener(update)
		}
	}, [])

	const isSuppressed = dismissedAt != null && (Date.now() - dismissedAt) < MOBILE_BANNER_TTL_MS
	if (!isNarrow || isSuppressed) return null

	return (
		<div
			role="region"
			aria-label="Mobile usage notice"
			className="w-full bg-yellow-500/10 text-yellow-300 text-xs px-4 py-2 border-b border-yellow-500/20 flex items-center justify-between"
		>
			<div className="pr-2">This map maker is not optimized for mobile. For the best experience, use a desktop or a large-screen tablet.</div>
			<button
				className="text-yellow-200 hover:text-yellow-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300 rounded px-1"
				onClick={() => {
					const now = Date.now()
					setDismissedAt(now)
					try { localStorage.setItem(STORAGE_KEY, String(now)) } catch {}
				}}
			>
				Dismiss
			</button>
		</div>
	)
}


