import { useEffect, useState } from 'react';
import { Stage, Layer, Line, Arc, Rect, Circle, Group } from 'react-konva';
import House3D from './House3D';

function App() {
  const [blueprint, setBlueprint] = useState(null);
  const [selectedTool, setSelectedTool] = useState('select');
  
  const [wallStart, setWallStart] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isShiftDown, setIsShiftDown] = useState(false);
  const [selectedElements, setSelectedElements] = useState([]);

  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [lastPointer, setLastPointer] = useState(null);

  // Layer Visibility
  const [showArchitecture, setShowArchitecture] = useState(true);
  const [showStructural, setShowStructural] = useState(true);
  const [showPlumbing, setShowPlumbing] = useState(true);
  const [showElectrical, setShowElectrical] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Shift') setIsShiftDown(true);
      if (e.key === ' ' && e.target.tagName !== 'INPUT') { e.preventDefault(); setIsSpaceDown(true); }
      if (e.key === 'Enter' || e.key === 'Escape') setWallStart(null); 
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftDown(false);
      if (e.key === ' ') setIsSpaceDown(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    fetch('http://localhost:8000/api/blueprint')
      .then(res => res.json())
      .then(data => { if (data.status === 'success') setBlueprint(data.data); })
      .catch(err => console.error(err));
      
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, []);

  if (!blueprint) return <div style={{ color: 'white', padding: '20px' }}>Loading AI Systems...</div>;

  const { walls } = blueprint.layers.architecture;
  const { openings } = blueprint.layers;
  const { pillars } = blueprint.layers.structural;
  const plumbingNodes = blueprint.layers.mep.plumbing.nodes;
  const plumbingPipes = blueprint.layers.mep.plumbing.pipes || [];
  const electricalNodes = blueprint.layers.mep.electrical.nodes;
  const electricalWires = blueprint.layers.mep.electrical.wires || [];

  const syncWithServer = async (updatedBlueprint) => {
    setBlueprint(updatedBlueprint); 
    try {
      const res = await fetch('http://localhost:8000/api/blueprint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedBlueprint) });
      const data = await res.json();
      if (data.status === 'success') setBlueprint(data.data); 
    } catch (err) {}
  };

  const getRelativePointerPosition = (stage) => {
    const pointerPosition = stage.getPointerPosition();
    const scale = stage.scaleX();
    const position = stage.position();
    return { x: (pointerPosition.x - position.x) / scale, y: (pointerPosition.y - position.y) / scale };
  };

  const renderGrid = () => {
    const lines = [];
    const extent = 4000; 
    for (let i = -extent; i < extent; i += 40) {
      lines.push(<Line key={`v-${i}`} points={[i, -extent, i, extent]} stroke="#1a1a1a" strokeWidth={1} />);
      lines.push(<Line key={`h-${i}`} points={[-extent, i, extent, i]} stroke="#1a1a1a" strokeWidth={1} />);
    }
    return lines;
  };

  const getPosOnWall = (obj, wallsList) => {
    const wall = wallsList.find(w => w.id === obj.parent_wall);
    if (!wall) return null;
    const [x1, y1] = wall.start;
    const [x2, y2] = wall.end;
    const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
    const wallLen = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const t = wallLen !== 0 ? obj.position_on_wall / wallLen : 0;
    return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, angle };
  };

  const calculateSnap = (rawPos) => {
    let x = rawPos.x, y = rawPos.y;
    const snapDist = 15 / stageScale; 
    let snappedToPoint = false;
    for (let w of walls) {
      if (Math.hypot(w.start[0] - x, w.start[1] - y) < snapDist) { x = w.start[0]; y = w.start[1]; snappedToPoint = true; break; }
      if (Math.hypot(w.end[0] - x, w.end[1] - y) < snapDist) { x = w.end[0]; y = w.end[1]; snappedToPoint = true; break; }
    }
    if (!snappedToPoint) { x = Math.round(x / 20) * 20; y = Math.round(y / 20) * 20; }
    if (isShiftDown && wallStart) {
      const dx = x - wallStart[0], dy = y - wallStart[1];
      const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const dist = Math.hypot(dx, dy);
      x = Math.round(wallStart[0] + Math.cos(snappedAngle) * dist);
      y = Math.round(wallStart[1] + Math.sin(snappedAngle) * dist);
    }
    return { x, y };
  };

  const handleGeneralDrag = (e, id, category) => {
    if (isSpaceDown) return; 
    const dragX = e.target.x(), dragY = e.target.y();
    let closestWall = null, minDistance = Infinity, rawPosOnWall = 0;

    walls.forEach(w => {
      const [x1, y1] = w.start, [x2, y2] = w.end;
      const wallLenSq = Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2);
      if (wallLenSq === 0) return;
      let t = Math.max(0, Math.min(1, ((dragX - x1) * (x2 - x1) + (dragY - y1) * (y2 - y1)) / wallLenSq)); 
      const dist = Math.sqrt(Math.pow(dragX - (x1 + t * (x2 - x1)), 2) + Math.pow(dragY - (y1 + t * (y2 - y1)), 2));
      if (dist < minDistance) { minDistance = dist; closestWall = w; rawPosOnWall = t * Math.sqrt(wallLenSq); }
    });

    if (closestWall && minDistance < 100) {
      const updated = { ...blueprint };
      let list = category === 'opening' ? updated.layers.openings : category === 'sink' ? updated.layers.mep.plumbing.nodes : updated.layers.mep.electrical.nodes;
      const idx = list.findIndex(item => item.id === id);
      const wallLen = Math.sqrt(Math.pow(closestWall.end[0]-closestWall.start[0], 2) + Math.pow(closestWall.end[1]-closestWall.start[1], 2));
      
      list[idx].parent_wall = closestWall.id;
      list[idx].position_on_wall = Math.max(0, Math.min(rawPosOnWall, wallLen - (list[idx].width || 0)));
      
      syncWithServer({ ...updated, _sync: Date.now() });
      if (selectedElements.length === 1 && selectedElements[0].id === id) setSelectedElements([list[idx]]);
    } else syncWithServer({ ...blueprint, _sync: Date.now() });
  };

  // --- NEW: Free-form Drag handler for Pillars ---
  const handlePillarDrag = (e, id) => {
    if (isSpaceDown) return;
    // Snap pillars to 20px grid
    const x = Math.round(e.target.x() / 20) * 20;
    const y = Math.round(e.target.y() / 20) * 20;

    const updated = { ...blueprint };
    const idx = updated.layers.structural.pillars.findIndex(p => p.id === id);
    updated.layers.structural.pillars[idx].position = [x, y];
    
    syncWithServer({ ...updated, _sync: Date.now() });
    if (selectedElements.length === 1 && selectedElements[0].id === id) {
      setSelectedElements([{ ...updated.layers.structural.pillars[idx], category: 'pillar' }]);
    }
  };

  const handleAddAny = (wallId, category) => {
    const updated = JSON.parse(JSON.stringify(blueprint));
    const id = `${category}_${Date.now()}`;
    
    // PILLAR LOGIC
    if (category === 'pillar') {
      updated.layers.structural.pillars.push({
        id, position: [400, 200], dimensions: [30, 30], height: 300
      });
      syncWithServer(updated);
      setSelectedTool('select');
      return;
    }

    let width = 90, height = 210, z_offset = 0;
    if (category === 'door') { width = 90; height = 210; }
    else if (category === 'window') { width = 120; height = 100; z_offset = 90; }
    else if (category === 'sink') { width = 40; height = 20; z_offset = 85; }
    else if (category === 'outlet') { width = 15; height = 15; z_offset = 30; }
    else if (category === 'main_inlet') { width = 30; height = 40; z_offset = 10; }
    else if (category === 'main_breaker') { width = 40; height = 60; z_offset = 120; }

    const newNode = { id, parent_wall: wallId, position_on_wall: 20, width, height, z_offset, type: category === 'door' ? 'standard_door' : category === 'window' ? 'sliding_window' : category, category };

    if (category === 'door' || category === 'window') updated.layers.openings.push(newNode); 
    else if (category === 'sink' || category === 'main_inlet') updated.layers.mep.plumbing.nodes.push(newNode); 
    else if (category === 'outlet' || category === 'main_breaker') updated.layers.mep.electrical.nodes.push(newNode); 

    syncWithServer(updated);
    setSelectedTool('select');
  };

  const handleElementSelect = (e, obj, category) => {
    if (isSpaceDown || e.evt.button === 1) return; 
    e.cancelBubble = true; 
    setSelectedTool('select');
    const newObj = { ...obj, category };

    if (e.evt.shiftKey) {
      const exists = selectedElements.find(el => el.id === obj.id);
      if (exists) setSelectedElements(selectedElements.filter(el => el.id !== obj.id));
      else setSelectedElements([...selectedElements, newObj]);
    } else setSelectedElements([newObj]);
  };

  const handleDelete = () => {
    if (selectedElements.length === 0) return;
    let updated = JSON.parse(JSON.stringify(blueprint));
    
    selectedElements.forEach(el => {
      const cat = el.category;
      if (cat === 'wall') {
        updated.layers.architecture.walls = updated.layers.architecture.walls.filter(w => w.id !== el.id);
        updated.layers.openings = updated.layers.openings.filter(o => o.parent_wall !== el.id);
        updated.layers.mep.plumbing.nodes = updated.layers.mep.plumbing.nodes.filter(n => n.parent_wall !== el.id);
        updated.layers.mep.electrical.nodes = updated.layers.mep.electrical.nodes.filter(n => n.parent_wall !== el.id);
      } 
      else if (cat === 'pillar') updated.layers.structural.pillars = updated.layers.structural.pillars.filter(p => p.id !== el.id);
      else if (cat === 'door' || cat === 'window') updated.layers.openings = updated.layers.openings.filter(o => o.id !== el.id);
      else if (cat === 'sink' || cat === 'main_inlet') updated.layers.mep.plumbing.nodes = updated.layers.mep.plumbing.nodes.filter(n => n.id !== el.id);
      else updated.layers.mep.electrical.nodes = updated.layers.mep.electrical.nodes.filter(n => n.id !== el.id);
    });
    
    syncWithServer(updated);
    setSelectedElements([]);
    setSelectedTool('select');
  };

  const handleScaleUpdate = (prop, val) => {
    if (selectedElements.length !== 1) return;
    const target = selectedElements[0];
    const updated = JSON.parse(JSON.stringify(blueprint));
    const cat = target.category;
    let numericVal = val === '' ? '' : parseFloat(val);

    if (cat === 'wall') {
      const idx = updated.layers.architecture.walls.findIndex(w => w.id === target.id);
      if (idx !== -1) {
        updated.layers.architecture.walls[idx][prop] = numericVal;
        syncWithServer(updated);
        setSelectedElements([{ ...updated.layers.architecture.walls[idx], category: cat }]);
      }
      return;
    }

    if (cat === 'pillar') {
      const idx = updated.layers.structural.pillars.findIndex(p => p.id === target.id);
      if (idx !== -1) {
        if (prop === 'width') updated.layers.structural.pillars[idx].dimensions[0] = numericVal;
        else if (prop === 'depth') updated.layers.structural.pillars[idx].dimensions[1] = numericVal;
        else if (prop === 'height') updated.layers.structural.pillars[idx].height = numericVal;
        syncWithServer(updated);
        setSelectedElements([{ ...updated.layers.structural.pillars[idx], category: cat }]);
      }
      return;
    }
    
    let list = cat === 'door' || cat === 'window' ? updated.layers.openings : cat === 'sink' ? updated.layers.mep.plumbing.nodes : updated.layers.mep.electrical.nodes;
    const idx = list.findIndex(item => item.id === target.id);
    
    if (idx !== -1) {
      if (prop === 'position_on_wall' && numericVal !== '') {
        const wall = updated.layers.architecture.walls.find(w => w.id === target.parent_wall);
        const wallLen = Math.sqrt(Math.pow(wall.end[0]-wall.start[0], 2) + Math.pow(wall.end[1]-wall.start[1], 2));
        numericVal = Math.max(0, Math.min(numericVal, wallLen - (list[idx].width || 0)));
      }
      list[idx][prop] = numericVal;
      syncWithServer(updated);
      setSelectedElements([{ ...list[idx], category: cat }]);
    }
  };

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    
    setStageScale(newScale);
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  };

  const handleMouseDown = (e) => {
    const isStage = e.target === e.target.getStage();
    if (e.evt.button === 1 || (isSpaceDown && e.evt.button === 0) || (e.evt.button === 0 && isStage && selectedTool === 'select')) {
      setIsDraggingCanvas(true);
      setLastPointer({ x: e.evt.clientX, y: e.evt.clientY });
      e.cancelBubble = true;
    }
  };

  const handleMouseUp = () => { if (isDraggingCanvas) { setIsDraggingCanvas(false); setLastPointer(null); } };

  const handleStageClick = (e) => {
    if (e.evt.button !== 0 || isSpaceDown) return; 

    if (selectedTool === 'draw_wall') {
      const stage = e.target.getStage();
      const rawPos = getRelativePointerPosition(stage);
      const snapPos = calculateSnap(rawPos);

      if (!wallStart) setWallStart([snapPos.x, snapPos.y]); 
      else {
        const updated = JSON.parse(JSON.stringify(blueprint));
        updated.layers.architecture.walls.push({ id: `wall_${Date.now()}`, type: "straight", start: wallStart, end: [snapPos.x, snapPos.y], thickness: 20 });
        syncWithServer(updated);
        setWallStart([snapPos.x, snapPos.y]); 
      }
    } else {
      if(selectedTool === 'add_pillar') {
         // Free-drop pillar anywhere
         const stage = e.target.getStage();
         const rawPos = getRelativePointerPosition(stage);
         const snapX = Math.round(rawPos.x / 20) * 20;
         const snapY = Math.round(rawPos.y / 20) * 20;
         
         const updated = JSON.parse(JSON.stringify(blueprint));
         updated.layers.structural.pillars.push({
            id: `pillar_${Date.now()}`, position: [snapX, snapY], dimensions: [30, 30], height: 300
         });
         syncWithServer(updated);
         setSelectedTool('select');
      } else {
        setSelectedElements([]); 
      }
    }
  };

  const handleMouseMove = (e) => {
    if (isDraggingCanvas && lastPointer) {
      const dx = e.evt.clientX - lastPointer.x, dy = e.evt.clientY - lastPointer.y;
      setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPointer({ x: e.evt.clientX, y: e.evt.clientY });
      return; 
    }
    if (selectedTool === 'draw_wall') {
      const stage = e.target.getStage();
      setMousePos(calculateSnap(getRelativePointerPosition(stage))); 
    }
  };

  const handleContextMenu = (e) => { e.evt.preventDefault(); if (selectedTool === 'draw_wall') setWallStart(null); };

  const singleSelect = selectedElements.length === 1 ? selectedElements[0] : null;
  let selectedWallLen = 0;
  if (singleSelect && singleSelect.category !== 'wall' && singleSelect.category !== 'pillar') {
    const wall = walls.find(w => w.id === singleSelect.parent_wall);
    if (wall) selectedWallLen = Math.sqrt(Math.pow(wall.end[0]-wall.start[0], 2) + Math.pow(wall.end[1]-wall.start[1], 2));
  }

  let canvasCursor = 'default';
  if (isDraggingCanvas) canvasCursor = 'grabbing';
  else if (isSpaceDown) canvasCursor = 'grab';
  else if (selectedTool === 'draw_wall' || selectedTool === 'add_pillar') canvasCursor = 'crosshair';

  return (
    <div style={{ backgroundColor: '#050505', minHeight: '100vh', display: 'flex', fontFamily: 'monospace', color: '#00FF41' }}>
      
      {/* SIDEBAR */}
      <div style={{ width: '250px', backgroundColor: '#0a0a0a', padding: '20px', borderRight: '1px solid #222', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ color: '#00FF41', borderBottom: '1px solid #222', paddingBottom: '10px', fontSize: '16px' }}>AI.CORE_BIM</h3>
        
        <div style={{ margin: '15px 0' }}>
          {[["ARCHITECTURE", showArchitecture, setShowArchitecture], ["STRUCTURAL", showStructural, setShowStructural], ["PLUMBING", showPlumbing, setShowPlumbing], ["ELECTRICAL", showElectrical, setShowElectrical]].map(([l, s, set]) => (
            <label key={l} style={{ display: 'block', fontSize: '10px', marginBottom: '8px', color: s ? '#00FF41' : '#444', cursor: 'pointer' }}>
              <input type="checkbox" checked={s} onChange={() => set(!s)} /> {l}
            </label>
          ))}
        </div>

        <h4 style={{ fontSize: '10px', color: '#888' }}>ADD OBJECT</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '15px' }}>
          <button onClick={() => { setSelectedTool('draw_wall'); setWallStart(null); }} style={{ background: selectedTool==='draw_wall'?'#4CAF50':'#111', color: selectedTool==='draw_wall'?'#000':'#4CAF50', border: '1px solid #4CAF50', padding: '10px', fontSize: '10px', cursor: 'pointer' }}>+ DRAW WALL</button>
          <button onClick={() => setSelectedTool('select')} style={{ background: selectedTool==='select'?'#00FF41':'#111', color: selectedTool==='select'?'#000':'#00FF41', border: '1px solid #00FF41', padding: '10px', fontSize: '10px', cursor: 'pointer' }}>MOVE MODE</button>
          
          <button onClick={() => setSelectedTool('add_pillar')} style={{ background: '#111', color: '#FFF', border: '1px solid #FFF', padding: '10px', fontSize: '10px', cursor: 'pointer' }}>+ PILLAR</button>
          <button onClick={() => setSelectedTool('add_door')} style={{ background: '#111', color: '#FF9800', border: '1px solid #FF9800', padding: '10px', fontSize: '10px', cursor: 'pointer' }}>+ DOOR</button>
          
          <button onClick={() => setSelectedTool('add_window')} style={{ background: '#111', color: '#03A9F4', border: '1px solid #03A9F4', padding: '10px', fontSize: '10px', cursor: 'pointer' }}>+ WINDOW</button>
          <button onClick={() => setSelectedTool('add_sink')} style={{ background: '#111', color: '#00bcd4', border: '1px solid #00bcd4', padding: '10px', fontSize: '10px', cursor: 'pointer' }}>+ SINK</button>
          
          <button onClick={() => setSelectedTool('add_outlet')} style={{ background: '#111', color: '#ffeb3b', border: '1px solid #ffeb3b', padding: '10px', fontSize: '10px', cursor: 'pointer' }}>+ OUTLET</button>
          <button onClick={() => setSelectedTool('add_main_inlet')} style={{ background: '#111', color: '#00bcd4', border: '1px solid #00bcd4', padding: '10px', fontSize: '10px', cursor: 'pointer' }}>+ M. WATER</button>
          
          <button onClick={() => setSelectedTool('add_main_breaker')} style={{ background: '#111', color: '#ffeb3b', border: '1px solid #ffeb3b', padding: '10px', fontSize: '10px', cursor: 'pointer', gridColumn: 'span 2' }}>+ M. PANEL</button>
        </div>

        {selectedElements.length > 0 && (
          <div style={{ borderTop: '1px solid #333', paddingTop: '15px' }}>
            <h4 style={{ fontSize: '10px', color: '#03A9F4', marginBottom: '10px' }}>
              {selectedElements.length > 1 ? `EDIT: ${selectedElements.length} ITEMS` : `EDIT: ${singleSelect.id}`}
            </h4>
            
            {singleSelect && singleSelect.category !== 'wall' && singleSelect.category !== 'pillar' && (
              <>
                <label style={{ fontSize: '9px', color: '#888' }}>SLIDE POSITION</label>
                <input type="range" min="0" max={selectedWallLen - (singleSelect.width || 0)} value={singleSelect.position_on_wall || 0} onChange={(e) => handleScaleUpdate('position_on_wall', e.target.value)} style={{ width: '100%', cursor: 'pointer', marginBottom: '5px' }} />
                <input type="number" value={singleSelect.position_on_wall === '' ? '' : Math.round(singleSelect.position_on_wall)} onChange={(e) => handleScaleUpdate('position_on_wall', e.target.value)} style={{ width: '100%', background: '#000', color: '#0f0', border: '1px solid #333', marginBottom: '10px', padding: '5px' }} />

                <label style={{ fontSize: '9px', color: '#888' }}>WIDTH (X cm)</label>
                <input type="number" value={singleSelect.width ?? ''} onChange={(e) => handleScaleUpdate('width', e.target.value)} style={{ width: '100%', background: '#000', color: '#0f0', border: '1px solid #333', marginBottom: '10px', padding: '5px' }} />
                
                <label style={{ fontSize: '9px', color: '#888' }}>HEIGHT (Z cm)</label>
                <input type="number" value={singleSelect.height ?? ''} onChange={(e) => handleScaleUpdate('height', e.target.value)} style={{ width: '100%', background: '#000', color: '#0f0', border: '1px solid #333', marginBottom: '10px', padding: '5px' }} />

                <label style={{ fontSize: '9px', color: '#888' }}>ELEVATION (Z Offset cm)</label>
                <input type="number" value={singleSelect.z_offset ?? ''} onChange={(e) => handleScaleUpdate('z_offset', e.target.value)} style={{ width: '100%', background: '#000', color: '#0f0', border: '1px solid #333', marginBottom: '10px', padding: '5px' }} />
              </>
            )}

            {singleSelect && singleSelect.category === 'pillar' && (
              <>
                <label style={{ fontSize: '9px', color: '#888' }}>WIDTH (X cm)</label>
                <input type="number" value={singleSelect.dimensions?.[0] ?? ''} onChange={(e) => handleScaleUpdate('width', e.target.value)} style={{ width: '100%', background: '#000', color: '#0f0', border: '1px solid #333', marginBottom: '10px', padding: '5px' }} />
                <label style={{ fontSize: '9px', color: '#888' }}>DEPTH (Y cm)</label>
                <input type="number" value={singleSelect.dimensions?.[1] ?? ''} onChange={(e) => handleScaleUpdate('depth', e.target.value)} style={{ width: '100%', background: '#000', color: '#0f0', border: '1px solid #333', marginBottom: '10px', padding: '5px' }} />
                <label style={{ fontSize: '9px', color: '#888' }}>HEIGHT (Z cm)</label>
                <input type="number" value={singleSelect.height ?? ''} onChange={(e) => handleScaleUpdate('height', e.target.value)} style={{ width: '100%', background: '#000', color: '#0f0', border: '1px solid #333', marginBottom: '10px', padding: '5px' }} />
              </>
            )}
            
            {singleSelect && singleSelect.category === 'wall' && (
              <>
                <label style={{ fontSize: '9px', color: '#888' }}>THICKNESS (Y cm)</label>
                <input type="number" value={singleSelect.thickness ?? ''} onChange={(e) => handleScaleUpdate('thickness', e.target.value)} style={{ width: '100%', background: '#000', color: '#0f0', border: '1px solid #333', marginBottom: '10px', padding: '5px' }} />
              </>
            )}

            <button onClick={handleDelete} style={{ width: '100%', background: '#ff1744', color: '#fff', border: 'none', padding: '8px', cursor: 'pointer', marginTop: '10px', fontWeight: 'bold' }}>
              DELETE {selectedElements.length > 1 ? "SELECTED" : "ELEMENT"}
            </button>        
          </div>
        )}
      </div>

      {/* CANVAS */}
      <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ background: '#93d5fc', border: '1px solid #222', borderRadius: '4px', overflow: 'hidden', boxShadow: 'inset 0 0 10px #000', cursor: canvasCursor }}>
          
          <Stage 
            width={800} height={450} 
            scaleX={stageScale} scaleY={stageScale} x={stagePos.x} y={stagePos.y} 
            onWheel={handleWheel} 
            onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            onClick={handleStageClick} onMouseMove={handleMouseMove} onContextMenu={handleContextMenu}
          >
            <Layer>
              {renderGrid()}
              
              {selectedTool === 'draw_wall' && wallStart && (
                <Line points={[wallStart[0], wallStart[1], mousePos.x, mousePos.y]} stroke="#4CAF50" strokeWidth={18} opacity={0.5} lineCap="square" />
              )}
              
              {showArchitecture && walls.map(w => {
                const isSelected = selectedElements.some(el => el.id === w.id);
                return (
                  <Group key={w.id} onClick={(e) => { 
                    if (selectedTool === 'draw_wall' || isSpaceDown || selectedTool === 'add_pillar') return; 
                    e.cancelBubble = true; 
                    if (selectedTool.startsWith('add_')) handleAddAny(w.id, selectedTool.replace('add_', '')); 
                    else if (selectedTool === 'select') handleElementSelect(e, w, 'wall');
                  }}>
                    <Line points={[w.start[0], w.start[1], w.end[0], w.end[1]]} stroke={isSelected ? "#4CAF50" : "#1a1a1a"} strokeWidth={w.thickness || 20} lineCap="square" lineJoin="miter" />
                    <Line points={[w.start[0], w.start[1], w.end[0], w.end[1]]} stroke={isSelected ? "#FFF" : "#00FF41"} strokeWidth={1.5} lineCap="square" opacity={isSelected ? 1 : 0.6} listening={false} />
                  </Group>
                )
              })}
              
              {/* RENDERING PILLARS */}
              {showStructural && pillars.map(p => {
                const isSelected = selectedElements.some(el => el.id === p.id);
                const [w, d] = p.dimensions || [30, 30];
                return (
                  <Group 
                    key={p.id} x={p.position[0]} y={p.position[1]} 
                    draggable={selectedTool==='select' && !isSpaceDown} 
                    onDragEnd={(e) => handlePillarDrag(e, p.id)} 
                    onClick={(e) => handleElementSelect(e, p, 'pillar')}
                  >
                    <Rect x={-w/2} y={-d/2} width={w} height={d} fill="#222" stroke={isSelected ? "#FFF" : "#00FF41"} strokeWidth={isSelected ? 2 : 1} />
                  </Group>
                )
              })}
              
              {showArchitecture && openings.map(op => {
                const pos = getPosOnWall(op, walls);
                if (!pos) return null;
                const isW = op.type.includes('win');
                const isSelected = selectedElements.some(el => el.id === op.id);
                return (
                  <Group key={op.id} x={pos.x} y={pos.y} rotation={pos.angle} draggable={selectedTool==='select' && !isSpaceDown} onDragEnd={(e) => handleGeneralDrag(e, op.id, 'opening')} onClick={(e) => handleElementSelect(e, op, isW ? 'window' : 'door')}>
                    <Rect width={op.width} height={16} y={-8} fill="#000" />
                    <Rect width={op.width} height={8} y={-4} fill={isW ? "#03A9F4" : "#FF9800"} stroke={isSelected ? "#FFF" : "#333"} strokeWidth={isSelected ? 1.5 : 0.5} />
                    {!isW && <Arc innerRadius={op.width} outerRadius={op.width} angle={90} rotation={270} stroke="#FF9800" dash={[4,2]} strokeWidth={1} />}
                  </Group>
                )
              })}

              {showPlumbing && plumbingPipes.map(pipe => (
                <Line key={pipe.id} points={pipe.path_coords} stroke="#00bcd4" strokeWidth={2} dash={[5, 5]} opacity={0.6} listening={false} />
              ))}

              {showPlumbing && plumbingNodes.map(node => {
                const pos = getPosOnWall(node, walls);
                if (!pos) return null;
                const isSelected = selectedElements.some(el => el.id === node.id);
                const isMain = node.type === 'main_inlet';
                return (
                  <Group key={node.id} x={pos.x} y={pos.y} rotation={pos.angle} draggable={selectedTool==='select' && !isSpaceDown} onDragEnd={(e) => handleGeneralDrag(e, node.id, 'sink')} onClick={(e) => handleElementSelect(e, node, 'sink')}>
                    {isMain ? <Rect width={30} height={20} y={-10} fill="#00bcd4" stroke={isSelected ? "#FFF" : "#222"} strokeWidth={isSelected ? 2 : 1} shadowBlur={isSelected ? 10 : 0} shadowColor="#00bcd4" /> : <Circle radius={10} fill="#00bcd4" stroke={isSelected ? "#FFF" : "#222"} strokeWidth={isSelected ? 2 : 1} shadowBlur={isSelected ? 10 : 5} shadowColor="#00bcd4" />}
                  </Group>
                )
              })}

              {showElectrical && electricalWires.map(wire => (
                <Line key={wire.id} points={wire.path_coords} stroke="#ffeb3b" strokeWidth={1.5} dash={[2, 4]} opacity={0.6} listening={false} />
              ))}
              
              {showElectrical && electricalNodes.map(node => {
                const pos = getPosOnWall(node, walls);
                if (!pos) return null;
                const isSelected = selectedElements.some(el => el.id === node.id);
                const isMain = node.type === 'main_breaker';
                return (
                  <Group key={node.id} x={pos.x} y={pos.y} rotation={pos.angle} draggable={selectedTool==='select' && !isSpaceDown} onDragEnd={(e) => handleGeneralDrag(e, node.id, 'outlet')} onClick={(e) => handleElementSelect(e, node, 'outlet')}>
                    {isMain ? <Rect width={40} height={16} y={-8} fill="#ffeb3b" stroke={isSelected ? "#FFF" : "#000"} strokeWidth={isSelected ? 2 : 1} shadowBlur={isSelected ? 10 : 0} shadowColor="#ffeb3b"/> : <Rect width={12} height={12} x={-6} y={-6} fill="#ffeb3b" stroke={isSelected ? "#FFF" : "#000"} strokeWidth={isSelected ? 2 : 1} />}
                  </Group>
                )
              })}
            </Layer>
          </Stage>
        </div>
        <div style={{ flex: 1, border: '1px solid #222', borderRadius: '4px', overflow: 'hidden' }}>
          {/* PASSED THE LAYERS PROP TO 3D */}
          <House3D blueprint={blueprint} layers={{ showArchitecture, showStructural, showPlumbing, showElectrical }} />
        </div>
      </div>
    </div>
  );
}

export default App;