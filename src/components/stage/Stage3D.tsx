import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CameraPose, StageObject, StageScene } from '../../../shared/types';

export interface StageBridge {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; update(): void; enabled: boolean } | null;
}

export interface PlaybackRequest {
  from: CameraPose;
  to: CameraPose;
  duration: number;
  lerp: (a: CameraPose, b: CameraPose, x: number) => CameraPose;
  onDone: () => void;
}

function applyPose(camera: THREE.PerspectiveCamera, controls: StageBridge['controls'], pose: CameraPose) {
  camera.position.set(...pose.position);
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.set(...pose.target);
    controls.update();
  } else camera.lookAt(...pose.target);
}

export function readPose(b: StageBridge): CameraPose {
  const t = b.controls?.target ?? new THREE.Vector3(0, 1.3, 0);
  return {
    position: [b.camera.position.x, b.camera.position.y, b.camera.position.z].map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
    target: [t.x, t.y, t.z].map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
    fov: Math.round(b.camera.fov * 10) / 10,
  };
}

function Backdrop({ url }: { url: string }) {
  const tex = useLoader(THREE.TextureLoader, url);
  const geo = useMemo(() => {
    const img = tex.image as { width: number; height: number };
    const aspect = img?.width && img?.height ? img.width / img.height : 16 / 9;
    const radius = 12;
    const arc = (110 * Math.PI) / 180;
    const height = (radius * arc) / aspect;
    const g = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true, Math.PI - arc / 2, arc);
    g.translate(0, 1.6, 0);
    return g;
  }, [tex]);
  useEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1; // seen from inside the cylinder
    tex.needsUpdate = true;
  }, [tex]);
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial map={tex} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  );
}

function ObjectMesh({ obj, selected, onSelect }: { obj: StageObject; selected: boolean; onSelect: () => void }) {
  const color = selected ? '#f9634e' : obj.color;
  const common = {
    onPointerDown: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect();
    },
  };
  if (obj.kind === 'light')
    return (
      <group>
        <pointLight position={[0, 0, 0]} intensity={18 * obj.scale} distance={14} color={obj.color} />
        <mesh {...common} userData={{ helper: true }}>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    );
  if (obj.kind === 'person')
    return (
      <group {...common} scale={obj.scale}>
        <mesh position={[0, 0.75, 0]} castShadow>
          <capsuleGeometry args={[0.24, 0.9, 6, 16]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
        <mesh position={[0, 1.55, 0]} castShadow>
          <sphereGeometry args={[0.17, 20, 20]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
        {/* facing marker */}
        <mesh position={[0, 1.55, 0.17]}>
          <boxGeometry args={[0.12, 0.04, 0.04]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      </group>
    );
  return (
    <mesh {...common} position={[0, 0.4 * obj.scale, 0]} scale={obj.scale} castShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
}

function Objects({ scene, selectedId, onSelect, onMove, capturing, mode }: { scene: StageScene; selectedId: string | null; onSelect: (id: string | null) => void; onMove: (id: string, pos: [number, number, number], rotY: number) => void; capturing: boolean; mode: 'translate' | 'rotate' }) {
  const refs = useRef(new Map<string, THREE.Group>());
  const selectedObj = scene.objects.find((o) => o.id === selectedId);
  const selectedRef = selectedId ? refs.current.get(selectedId) : undefined;
  return (
    <>
      {scene.objects.map((o) => (
        <group
          key={o.id}
          ref={(g) => {
            if (g) refs.current.set(o.id, g);
            else refs.current.delete(o.id);
          }}
          position={o.kind === 'light' ? [o.position[0], Math.max(0.5, o.position[1] || 3), o.position[2]] : o.position}
          rotation={[0, o.rotationY, 0]}
          visible={!(capturing && o.kind === 'light')}
        >
          <ObjectMesh obj={o} selected={!capturing && o.id === selectedId} onSelect={() => onSelect(o.id)} />
        </group>
      ))}
      {selectedObj && selectedRef && !capturing && (
        <TransformControls
          object={selectedRef}
          mode={mode}
          showY={selectedObj.kind === 'light' || mode === 'rotate'}
          showX={mode === 'translate'}
          showZ={mode === 'translate'}
          size={0.8}
          onMouseUp={() => {
            const g = selectedRef;
            onMove(selectedObj.id, [g.position.x, g.position.y, g.position.z].map((v) => Math.round(v * 100) / 100) as [number, number, number], g.rotation.y);
          }}
        />
      )}
    </>
  );
}

function Bridge({ bridgeRef }: { bridgeRef: React.MutableRefObject<StageBridge | null> }) {
  const { gl, scene, camera, controls } = useThree();
  useEffect(() => {
    bridgeRef.current = { gl, scene, camera: camera as THREE.PerspectiveCamera, controls: controls as unknown as StageBridge['controls'] };
  }, [gl, scene, camera, controls, bridgeRef]);
  return null;
}

function Playback({ request, bridgeRef }: { request: PlaybackRequest | null; bridgeRef: React.MutableRefObject<StageBridge | null> }) {
  const start = useRef<number | null>(null);
  useEffect(() => {
    start.current = null;
  }, [request]);
  useFrame((state) => {
    const b = bridgeRef.current;
    if (!request || !b) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const x = (state.clock.elapsedTime - start.current) / Math.max(0.5, request.duration);
    applyPose(b.camera, b.controls, request.lerp(request.from, request.to, x));
    if (x >= 1) request.onDone();
  });
  return null;
}

export function Stage3D({
  scene,
  selectedId,
  onSelect,
  onMove,
  bridgeRef,
  playback,
  capturing,
  topView,
  mode,
  initialPose,
}: {
  scene: StageScene;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, pos: [number, number, number], rotY: number) => void;
  bridgeRef: React.MutableRefObject<StageBridge | null>;
  playback: PlaybackRequest | null;
  capturing: boolean;
  topView: boolean;
  mode: 'translate' | 'rotate';
  initialPose: CameraPose;
}) {
  // switch between perspective framing and the top-down plan
  useEffect(() => {
    const b = bridgeRef.current;
    if (!b) return;
    if (topView) applyPose(b.camera, b.controls, { position: [0, 22, 0.01], target: [0, 0, 0], fov: 45 });
    else applyPose(b.camera, b.controls, initialPose);
  }, [topView]);

  return (
    <Canvas
      shadows
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: initialPose.position, fov: initialPose.fov, near: 0.05, far: 200 }}
      onPointerMissed={() => onSelect(null)}
      style={{ background: '#101010' }}
    >
      <color attach="background" args={['#101010']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 8, 6]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <hemisphereLight args={['#dfe7ff', '#3a3026', 0.35]} />
      <Suspense fallback={null}>{scene.backdropUrl && <Backdrop url={scene.backdropUrl} />}</Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial opacity={0.35} />
      </mesh>
      {!capturing && <Grid args={[24, 24]} cellSize={0.5} cellThickness={0.5} sectionSize={2.5} sectionThickness={0.9} cellColor="#3a3a3a" sectionColor="#5a5a5a" fadeDistance={28} infiniteGrid position={[0, 0.002, 0]} />}
      <Objects scene={scene} selectedId={selectedId} onSelect={onSelect} onMove={onMove} capturing={capturing} mode={mode} />
      <OrbitControls makeDefault target={initialPose.target} enabled={!playback} maxPolarAngle={topView ? 0.01 : Math.PI * 0.495} enableRotate={!topView} />
      <Bridge bridgeRef={bridgeRef} />
      <Playback request={playback} bridgeRef={bridgeRef} />
    </Canvas>
  );
}

export { applyPose };
