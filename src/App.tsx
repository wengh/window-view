import { useState, useEffect, useRef, useCallback } from 'react'
import { EarthViewer } from './components/EarthViewer'
import './App.css'
import type { WindowSelection } from './logic/WindowSelector'
import { Cartesian3, Quaternion } from 'cesium'

// Helper to parse hash state
const parseHash = (hash: string) => {
  if (!hash)
    return { selection: null, mode: 'navigating' as const, camera: null, showSunPath: false }

  try {
    const params = new URLSearchParams(hash)
    const winData = params.get('win')
    const modeData = params.get('mode')
    const camData = params.get('cam')
    const spData = params.get('sp')

    let selection: WindowSelection | null = null
    if (winData) {
      const [x, y, z, nx, ny, nz, rx, ry, rz, rw, w, h] = winData.split(',').map(parseFloat)
      selection = {
        center: new Cartesian3(x, y, z),
        normal: new Cartesian3(nx, ny, nz),
        rotation: new Quaternion(rx, ry, rz, rw),
        width: w,
        height: h,
      }
    }

    let camera: {
      x: number
      y: number
      z: number
      h: number
      p: number
      r: number
      fov?: number
    } | null = null
    if (camData) {
      const parts = camData.split(',').map(parseFloat)
      camera = {
        x: parts[0],
        y: parts[1],
        z: parts[2],
        h: parts[3],
        p: parts[4],
        r: parts[5],
        fov: parts[6],
      }
    }

    let mode: 'navigating' | 'selecting' | 'viewing' = 'navigating'
    if (modeData === 'viewing') mode = 'viewing'
    else if (modeData === 'selecting') mode = 'selecting'

    const showSunPath = spData === '1'

    return { selection, mode, camera, showSunPath }
  } catch (e) {
    console.error('Failed to parse hash', e)
    return { selection: null, mode: 'navigating' as const, camera: null, showSunPath: false }
  }
}

function App() {
  const [apiKey, setApiKey] = useState(() => {
    return (
      localStorage.getItem('google_maps_api_key') || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
    )
  })

  // Initial State from Hash
  // We use a lazy initializer to parse only once on mount, but we also subscribe to updates.
  const [initialData] = useState(() => parseHash(window.location.hash.substring(1)))

  const [selection, setSelection] = useState<WindowSelection | null>(initialData.selection)
  const [mode, setMode] = useState<'navigating' | 'selecting' | 'viewing'>(initialData.mode)
  const [tempApiKey, setTempApiKey] = useState('')
  const [showSunPath, setShowSunPath] = useState(initialData.showSunPath)

  const [cameraState, setCameraState] = useState<{
    x: number
    y: number
    z: number
    h: number
    p: number
    r: number
    fov?: number
  } | null>(initialData.camera)

  // External Camera is used to force EarthViewer to update position when it changes from outside (Hash)
  const [externalCamera, setExternalCamera] = useState<{
    x: number
    y: number
    z: number
    h: number
    p: number
    r: number
    fov?: number
  } | null>(initialData.camera)
  const [externalMode, setExternalMode] = useState(initialData.mode)
  const [copyFeedback, setCopyFeedback] = useState(false)

  const handleCopyLink = () => {
    const url = window.location.href
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopyFeedback(true)
        setTimeout(() => setCopyFeedback(false), 2000)
      })
      .catch((err) => {
        console.error('Failed to copy: ', err)
      })
  }

  // Listen for Hash Changes (User Paste / Back Button)
  useEffect(() => {
    const handleHashChange = () => {
      // If the hash matches what we just wrote, ignore it (optional, but good practice if using lastHashRef)
      // But strict equality of strings is usually enough.

      console.log('Hash Change Detected', window.location.hash)
      const newState = parseHash(window.location.hash.substring(1))

      // Update Application State
      setSelection(newState.selection)
      setMode(newState.mode)
      setExternalMode(newState.mode)
      setShowSunPath(newState.showSunPath)

      // Only update camera if present in hash
      if (newState.camera) {
        setCameraState(newState.camera)
        setExternalCamera(newState.camera)
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const restoredRef = useRef(false)

  // Writer Effect (State -> Hash)
  useEffect(() => {
    // Skip the first run - let restore complete first
    if (!restoredRef.current) {
      restoredRef.current = true
      return
    }

    const params: string[] = []

    if (selection) {
      const { center, normal, rotation, width, height } = selection
      const winStr = [
        center.x,
        center.y,
        center.z,
        normal.x,
        normal.y,
        normal.z,
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
        width,
        height,
      ]
        .map((v) => v.toFixed(3))
        .join(',')
      params.push(`win=${winStr}`)
    }

    params.push(`mode=${mode}`)

    if (cameraState) {
      const camStr = [
        cameraState.x,
        cameraState.y,
        cameraState.z,
        cameraState.h,
        cameraState.p,
        cameraState.r,
        ...(cameraState.fov !== undefined ? [cameraState.fov] : []),
      ]
        .map((v) => v.toFixed(3))
        .join(',')
      params.push(`cam=${camStr}`)
    }

    if (showSunPath) {
      params.push('sp=1')
    }

    const newHash = params.join('&')

    if (window.location.hash !== '#' + newHash) {
      window.history.replaceState(null, '', '#' + newHash)
    }
  }, [selection, mode, cameraState, showSunPath])

  const handleSetApiKey = () => {
    localStorage.setItem('google_maps_api_key', tempApiKey)
    setApiKey(tempApiKey)
  }

  const handleSelection = (sel: WindowSelection) => {
    setSelection(sel)
    setMode('selecting')
  }

  const handleCameraChange = useCallback(
    (cam: { x: number; y: number; z: number; h: number; p: number; r: number; fov?: number }) => {
      setCameraState(cam)
    },
    []
  )

  const handleEnterView = () => {
    setMode('viewing')
  }

  const handleExitView = () => {
    setMode('navigating')
  }

  const updateSize = (dim: 'width' | 'height', val: number) => {
    if (selection) {
      setSelection({
        ...selection,
        [dim]: val,
      })
    }
  }

  if (!apiKey) {
    return (
      <div className="api-key-modal">
        <div className="modal-content" style={{ maxWidth: '500px', textAlign: 'left' }}>
          <h2 style={{ textAlign: 'center' }}>Google Maps API Key Required</h2>

          <div style={{ fontSize: '0.9em', marginBottom: '15px', lineHeight: '1.4' }}>
            <p>
              To use this 3D Viewer, you need a Google Maps API Key with the{' '}
              <strong>Map Tiles API</strong> enabled.
            </p>
            <ol style={{ paddingLeft: '25px', margin: '15px 0' }}>
              <li>
                Go to{' '}
                <a
                  href="https://console.cloud.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#646cff' }}
                >
                  Google Cloud Console
                </a>
                .
              </li>
              <li>Create a new Project.</li>
              <li>
                Enable the{' '}
                <a
                  href="https://console.cloud.google.com/apis/library/tile.googleapis.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#646cff' }}
                >
                  Map Tiles API
                </a>{' '}
                (required for 3D Tiles).
              </li>
              <li>
                Go to <strong>APIs & Services</strong> → <strong>Credentials</strong> and create an{' '}
                <strong>API Key</strong>.
              </li>
            </ol>
            <p
              style={{
                color: '#ffcc00',
                fontSize: '0.9em',
                background: 'rgba(255, 200, 0, 0.1)',
                padding: '8px',
                borderRadius: '4px',
              }}
            >
              ⚠️ <strong>Important:</strong> You must enable "Map Tiles API". "Maps JavaScript API"
              is unrelated.
            </p>
          </div>

          <p
            style={{ color: '#aaa', fontSize: '0.8em', fontStyle: 'italic', marginBottom: '15px' }}
          >
            Privacy Note: Your API key is stored locally in your browser and is only sent to Google
            Servers to fetch 3D tiles. It is never sent to any other server.
          </p>

          <input
            value={tempApiKey}
            onChange={(e) => setTempApiKey(e.target.value)}
            placeholder="Enter API Key"
            style={{
              width: '100%',
              padding: '10px',
              marginBottom: '10px',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleSetApiKey}
            style={{ width: '100%', padding: '10px', fontWeight: 'bold' }}
          >
            Start
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <EarthViewer
        googleMapsApiKey={apiKey}
        onWindowSelected={handleSelection}
        onCameraChange={handleCameraChange}
        selectionMode={mode === 'selecting'}
        viewWindow={selection}
        isInsideView={mode === 'viewing'}
        // Pass externalCamera as target for both modes
        initialOutsideCamera={mode === 'navigating' ? externalCamera : null}
        // ONLY use external camera for inside start if the external mode was explicitly viewing
        startInsideCamera={mode === 'viewing' && externalMode === 'viewing' ? externalCamera : null}
        showSunPath={showSunPath}
      />

      <div className="ui-overlay">
        <h3>Controls</h3>
        <div>
          Mode: <strong>{mode}</strong>
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => setMode('navigating')}
            disabled={mode === 'viewing'}
            className={mode === 'navigating' ? 'active' : ''}
          >
            Navigate
          </button>
          <button
            onClick={() => setMode('selecting')}
            style={{ marginLeft: 5 }}
            disabled={mode === 'viewing'}
            className={mode === 'selecting' ? 'active' : ''}
          >
            Select Window
          </button>
        </div>

        {selection && mode !== 'viewing' && (
          <div style={{ marginTop: 20, borderTop: '1px solid #555', paddingTop: 10 }}>
            <h4>Window Properties</h4>
            <label>Width: {selection.width.toFixed(1)}m</label>
            <input
              type="range"
              min="0.5"
              max="10"
              step="0.1"
              value={selection.width}
              onChange={(e) => updateSize('width', parseFloat(e.target.value))}
            />

            <label>Height: {selection.height.toFixed(1)}m</label>
            <input
              type="range"
              min="0.5"
              max="10"
              step="0.1"
              value={selection.height}
              onChange={(e) => updateSize('height', parseFloat(e.target.value))}
            />

            <button
              style={{ marginTop: 10, width: '100%', background: '#4CAF50' }}
              onClick={handleEnterView}
            >
              View From Window
            </button>
          </div>
        )}

        {mode === 'viewing' && (
          <div style={{ marginTop: 20 }}>
            <p>
              WASD to Move
              <br />
              Drag to Look
              <br />
              Scroll for FOV
              <br />
              Middle Click to Reset FOV
            </p>
            <button onClick={handleExitView}>Exit View</button>
            <button
              onClick={() => setShowSunPath((v) => !v)}
              style={{
                width: '100%',
                marginTop: 8,
                background: showSunPath ? '#FF9800' : '#555',
              }}
            >
              {showSunPath ? '☀ Hide Sun Path' : '☀ Show Sun Path'}
            </button>
            {showSunPath && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  background: 'rgba(0,0,0,0.6)',
                  borderRadius: 6,
                  fontSize: 13,
                  lineHeight: '1.8',
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Legend</div>
                <div>
                  <span style={{ color: '#FFA500', fontWeight: 'bold' }}>━━</span> Solstice (6/21,
                  12/21)
                </div>
                <div>
                  <span style={{ color: '#FFD700' }}>━━</span> Date arcs
                </div>
                <div>
                  <span style={{ color: '#fff' }}>━━</span> Hour cross-lines
                </div>
                <div>
                  <span style={{ color: '#FFB6C1' }}>━━</span> DST hours
                </div>
              </div>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: 20,
            fontSize: 12,
            opacity: 0.7,
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          <a
            href="https://github.com/wengh/window-view"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#fff' }}
          >
            GitHub
          </a>
          <span style={{ opacity: 0.5 }}>|</span>
          <button
            onClick={handleCopyLink}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: '#fff',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 'inherit',
              fontWeight: 'normal',
            }}
            title="Copy current URL to clipboard"
          >
            {copyFeedback ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
