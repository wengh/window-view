import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { EarthViewer } from './components/EarthViewer';
import './App.css';
import type { WindowSelection } from './logic/WindowSelector';
import { Cartesian3, Quaternion } from 'cesium';

function App() {
  const [apiKey, setApiKey] = useState(() => {
      return localStorage.getItem('google_maps_api_key') || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  });

  // Parse URL hash once on initial load
  const initialState = useMemo(() => {
      const hash = window.location.hash.substring(1);
      if (!hash) return { selection: null, mode: 'navigating' as const, camera: null };

      try {
          const params = new URLSearchParams(hash);
          const winData = params.get('win');
          const modeData = params.get('mode');
          const camData = params.get('cam');

          let selection: WindowSelection | null = null;
          if (winData) {
              const [x,y,z, nx,ny,nz, rx,ry,rz,rw, w,h] = winData.split(',').map(parseFloat);
              selection = {
                  center: new Cartesian3(x,y,z),
                  normal: new Cartesian3(nx,ny,nz),
                  rotation: new Quaternion(rx,ry,rz,rw),
                  width: w,
                  height: h
              };
          }

          let camera: { x:number, y:number, z:number, h:number, p:number, r:number } | null = null;
          if (camData) {
              const [cx,cy,cz, ch,cp,cr] = camData.split(',').map(parseFloat);
              camera = { x:cx, y:cy, z:cz, h:ch, p:cp, r:cr };
          }

          let mode: 'navigating' | 'selecting' | 'viewing' = 'navigating';
          if (modeData === 'viewing') mode = 'viewing';
          else if (modeData === 'selecting') mode = 'selecting';

          return { selection, mode, camera };
      } catch (e) {
          console.error("Failed to parse hash", e);
          return { selection: null, mode: 'navigating' as const, camera: null };
      }
  }, []);

  const [selection, setSelection] = useState<WindowSelection | null>(initialState.selection);
  const [mode, setMode] = useState<'navigating' | 'selecting' | 'viewing'>(initialState.mode);
  const [tempApiKey, setTempApiKey] = useState('');

  const [cameraState, setCameraState] = useState<{ x:number, y:number, z:number, h:number, p:number, r:number } | null>(initialState.camera);
  const initialCameraRef = useRef(initialState.camera);


  const restoredRef = useRef(false);

  // 2. Write State to URL (only after initial restore)
  useEffect(() => {
     // Skip the first run - let restore complete first
     if (!restoredRef.current) {
         restoredRef.current = true;
         return;
     }

     const params: string[] = [];

     if (selection) {
         const { center, normal, rotation, width, height } = selection;
         const winStr = [
             center.x, center.y, center.z,
             normal.x, normal.y, normal.z,
             rotation.x, rotation.y, rotation.z, rotation.w,
             width, height
         ].map(v => v.toFixed(3)).join(',');
         params.push(`win=${winStr}`);
     }

     params.push(`mode=${mode}`);

     if (cameraState) {
         const camStr = [
             cameraState.x, cameraState.y, cameraState.z,
             cameraState.h, cameraState.p, cameraState.r
         ].map(v => v.toFixed(3)).join(',');
         params.push(`cam=${camStr}`);
     }

     const newHash = params.join('&');

     if (window.location.hash !== '#' + newHash) {
        window.location.replace('#' + newHash);
     }
  }, [selection, mode, cameraState]);

  const handleSetApiKey = () => {
      localStorage.setItem('google_maps_api_key', tempApiKey);
      setApiKey(tempApiKey);
  }

  const handleSelection = (sel: WindowSelection) => {
    setSelection(sel);
    setMode('selecting');
  };

  const handleCameraChange = useCallback((cam: { x:number, y:number, z:number, h:number, p:number, r:number }) => {
      setCameraState(cam);
  }, []);

  const handleEnterView = () => {
      setMode('viewing');
  };

  const handleExitView = () => {
      setMode('navigating');
  };

  const updateSize = (dim: 'width' | 'height', val: number) => {
      if (selection) {
          setSelection({
              ...selection,
              [dim]: val
          });
      }
  };

  if (!apiKey) {
      return (
          <div className="api-key-modal">
              <div className="modal-content">
                  <h2>Google Maps API Key Required</h2>
                  <p>Please enter a key with "Map Tiles API" enabled.</p>
                  <input
                    value={tempApiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                    placeholder="Enter API Key"
                  />
                  <button onClick={handleSetApiKey}>Start</button>
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
        initialCamera={initialCameraRef.current}
      />

      <div className="ui-overlay">
          <h3>Controls</h3>
          <div>
             Mode: <strong>{mode}</strong>
          </div>

          <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setMode('navigating')}
                disabled={mode==='viewing'}
                className={mode === 'navigating' ? 'active' : ''}
              >
                  Navigate
              </button>
              <button
                onClick={() => setMode('selecting')}
                style={{ marginLeft: 5 }}
                disabled={mode==='viewing'}
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
                    type="range" min="0.5" max="10" step="0.1"
                    value={selection.width}
                    onChange={(e) => updateSize('width', parseFloat(e.target.value))}
                  />

                  <label>Height: {selection.height.toFixed(1)}m</label>
                  <input
                    type="range" min="0.5" max="10" step="0.1"
                    value={selection.height}
                    onChange={(e) => updateSize('height', parseFloat(e.target.value))}
                  />

                  <button
                    style={{ marginTop: 10, width: '100%', background: '#4CAF50' }}
                    onClick={handleEnterView}
                  >
                      View Outside (Go Inside)
                  </button>
              </div>
          )}

          {mode === 'viewing' && (
               <div style={{ marginTop: 20 }}>
                   <p>WASD to Move<br/>Drag to Look<br/>Scroll for FOV</p>
                   <button onClick={handleExitView}>Exit View</button>
               </div>
          )}
      </div>
    </div>
  );
}

export default App;
