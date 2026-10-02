import { Suspense, lazy, useEffect, useState } from 'react'
import App from './App'

// The motion studio (and its encoder libraries) loads only when opened.
const MotionStudio = lazy(() => import('./studio/MotionStudio').then((m) => ({ default: m.MotionStudio })))

/** Two views: the clip editor (default) and the motion studio at #motion. */
export function Root() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  if (hash !== '#motion') return <App />
  return (
    <Suspense fallback={null}>
      <MotionStudio />
    </Suspense>
  )
}
