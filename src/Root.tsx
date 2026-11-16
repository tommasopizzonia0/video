import { Suspense, lazy, useEffect, useState } from 'react'
import App from './App'

// The motion studio (and its encoder libraries) loads only when opened.
const MotionStudio = lazy(() => import('./studio/MotionStudio').then((m) => ({ default: m.MotionStudio })))

export function Root() {
  // The Artifact build is the live studio only.
  if (import.meta.env.MODE === 'artifact') return <LiveStudio />
  return <Views />
}

function LiveStudio() {
  return (
    <Suspense fallback={null}>
      <MotionStudio live />
    </Suspense>
  )
}

/** Two views: the clip editor (default) and the motion studio at #motion. */
function Views() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // #live (dev server only): the studio follows live/current.json as Claude edits it.
  const local = import.meta.env.DEV && hash === '#live'
  if (hash !== '#motion' && !local) return <App />
  return (
    <Suspense fallback={null}>
      <MotionStudio key={hash} live={local} />
    </Suspense>
  )
}
