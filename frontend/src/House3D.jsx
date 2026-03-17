import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Stage } from '@react-three/drei';

function Wall({ start, end, thickness, openings }) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  
  const wallHeight = 300; 
  const center = [(start[0] + end[0]) / 2, wallHeight / 2, (start[1] + end[1]) / 2];

  return (
    <group position={center} rotation={[0, -angle, 0]}>
      <mesh>
        <boxGeometry args={[length + thickness, wallHeight, thickness]} />
        <meshStandardMaterial color="#4CAF50" transparent opacity={0.8} />
      </mesh>

      {openings.map(op => {
        const isWindow = op.type.includes("window");
        const horizontalPos = op.position_on_wall - length / 2 + op.width / 2;
        const verticalPos = isWindow 
            ? (op.z_offset - (wallHeight / 2) + (op.height / 2)) 
            : -(wallHeight / 2) + (op.height / 2);

        return (
          <mesh key={op.id} position={[horizontalPos, verticalPos, 0]}>
            <boxGeometry args={[op.width, op.height, thickness + 2]} />
            <meshStandardMaterial 
              color={isWindow ? "#81D4FA" : "#111"} 
              transparent={isWindow} 
              opacity={isWindow ? 0.6 : 1.0} 
            />
          </mesh>
        );
      })}
    </group>
  );
}

export default function House3D({ blueprint, layers }) {
  if (!blueprint) return null;
  const { walls } = blueprint.layers.architecture;
  const { openings } = blueprint.layers;
  const { pillars } = blueprint.layers.structural;

  const { showArchitecture, showStructural } = layers;

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '450px', background: '#111', borderRadius: '8px', overflow: 'hidden' }}>
      <Canvas camera={{ position: [500, 500, 500], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <pointLight position={[100, 500, 100]} intensity={1} />
        <directionalLight position={[-100, 200, -100]} intensity={0.5} />
        
        <Stage intensity={0.5} environment="city" adjustCamera={false}>
          <group>
            
            {/* RENDER WALLS & OPENINGS based on Layer View */}
            {showArchitecture && walls.map((wall) => (
              <Wall 
                key={wall.id} 
                start={wall.start} 
                end={wall.end} 
                thickness={wall.thickness} 
                openings={openings.filter(op => op.parent_wall === wall.id)}
              />
            ))}

            {/* RENDER STRUCTURAL PILLARS based on Layer View */}
            {showStructural && pillars.map(p => {
              const [w, d] = p.dimensions || [30, 30];
              const h = p.height || 300;
              return (
                <mesh key={p.id} position={[p.position[0], h / 2, p.position[1]]}>
                  <boxGeometry args={[w, h, d]} />
                  <meshStandardMaterial color="#607D8B" /> {/* Slate Gray Concrete */}
                </mesh>
              )
            })}

          </group>
        </Stage>

        <Grid infiniteGrid fadeDistance={1500} sectionColor="#444" cellColor="#222" sectionSize={100} cellSize={20} />
        <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
    </div>
  );
}