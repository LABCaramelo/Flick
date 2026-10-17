import { useMemo, useRef, useState } from 'react';
import { Vector2 } from 'three';
import { useSearchParams } from 'react-router-dom';
import { Box, Circle, Lightbulb, Move3d, PersonStanding, Play, Plus, Rotate3d, Trash2, Upload, Video } from 'lucide-react';
import { nodeTitle, uid } from '../../../shared/project';
import type { CameraMove, CameraPose, MediaNode, StageObject, StageObjectKind, StageScene, StageShot } from '../../../shared/types';
import { useProject } from '../../store/project';
import { toast } from '../../store/ui';
import { api } from '../../lib/api';
import { connect, createMediaNode, findFreeSpot, mediaNodeFromUpload, pickFiles, uploadFilesToCanvas, viewportCenter } from '../../lib/canvasOps';
import { generateAndWait, runGeneration } from '../../lib/generation';
import { MOVES, defaultPose, lerpPose, presetEnd } from './cameraMoves';
import { Stage3D, applyPose, readPose, type PlaybackRequest, type StageBridge } from './Stage3D';
import './stage.css';

const COLORS = ['#c9c4bb', '#cda370', '#bb8be4', '#6aa9e0', '#8fbf7a', '#e0846a'];

export function StageView() {
  const stage = useProject((s) => s.project?.stage);
  const nodes = useProject((s) => s.project?.nodes);
  const aspect = useProject((s) => s.project?.projectSettings.aspectRatio ?? '16:9');
  const update = useProject((s) => s.update);
  const [, setParams] = useSearchParams();
  const scene = stage?.activeSceneId ? stage.scenes[stage.activeSceneId] : undefined;
  const [tab, setTab] = useState<'scene' | 'cameras'>('scene');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate');
  const [playback, setPlayback] = useState<PlaybackRequest | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [topView, setTopView] = useState(false);
  const [recording, setRecording] = useState(false);
  const bridge = useRef<StageBridge | null>(null);

  const images = useMemo(() => Object.values(nodes ?? {}).filter((n): n is MediaNode => n.type === 'image' && !!(n as MediaNode).data.url), [nodes]);

  const patchScene = (fn: (s: StageScene) => void, record = true) =>
    update(
      (d) => {
        const id = d.stage.activeSceneId;
        if (id && d.stage.scenes[id]) fn(d.stage.scenes[id] as StageScene);
      },
      { record },
    );

  function createScene(fromNode?: MediaNode) {
    const id = uid();
    const shot: StageShot = { id: uid(), name: 'Plano 1', move: 'dolly_in', duration: 5, start: defaultPose(), end: presetEnd('dolly_in', defaultPose()) };
    const s: StageScene = {
      id,
      name: fromNode ? nodeTitle(fromNode) : `Cena ${Object.keys(stage?.scenes ?? {}).length + 1}`,
      backdropUrl: fromNode?.data.url,
      backdropNodeId: fromNode?.id,
      objects: [{ id: uid(), kind: 'person', name: 'Personagem A', position: [0, 0, 0], rotationY: 0, scale: 1, color: COLORS[0] }],
      shots: [shot],
      activeShotId: shot.id,
    };
    update((d) => {
      d.stage.scenes[id] = s;
      d.stage.activeSceneId = id;
    });
  }

  if (!scene) {
    return (
      <div className="stage-picker">
        <h2>Escolha uma imagem para filmar</h2>
        <p className="muted">Entra uma foto, sai um set. Você marca o plano, a IA filma.</p>
        <div className="stage-picker-grid">
          {images.map((n) => (
            <button key={n.id} onClick={() => createScene(n)} title={nodeTitle(n)}>
              <img src={n.data.url} alt="" />
              <span>{nodeTitle(n)}</span>
            </button>
          ))}
          <button
            className="stage-upload"
            onClick={async () => {
              const files = await pickFiles('image/*', false);
              if (!files.length) return;
              const [id] = await uploadFilesToCanvas(files);
              const n = useProject.getState().project?.nodes[id] as MediaNode | undefined;
              if (n) createScene(n);
            }}
          >
            <Upload size={18} />
            <span>Enviar imagem</span>
          </button>
          <button className="stage-upload" onClick={() => createScene()}>
            <Box size={18} />
            <span>Set vazio</span>
          </button>
        </div>
        {Object.keys(stage?.scenes ?? {}).length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div className="label" style={{ marginBottom: 8 }}>
              Cenas existentes
            </div>
            <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              {Object.values(stage!.scenes).map((s) => (
                <button key={s.id} className="chip" onClick={() => update((d) => void (d.stage.activeSceneId = s.id))}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const shot = scene.shots.find((s) => s.id === scene.activeShotId) ?? scene.shots[0];
  const selected = scene.objects.find((o) => o.id === selectedId);

  const addObject = (kind: StageObjectKind) => {
    const n = scene.objects.filter((o) => o.kind === kind).length + 1;
    const o: StageObject = {
      id: uid(),
      kind,
      name: kind === 'person' ? `Personagem ${String.fromCharCode(64 + n)}` : kind === 'light' ? `Luz ${n}` : `Objeto ${n}`,
      position: [(Math.random() - 0.5) * 3, kind === 'light' ? 3 : 0, (Math.random() - 0.5) * 2],
      rotationY: 0,
      scale: 1,
      color: kind === 'light' ? '#ffd9a8' : COLORS[(scene.objects.length + 1) % COLORS.length],
    };
    patchScene((s) => void s.objects.push(o));
    setSelectedId(o.id);
  };

  const setShot = (fn: (s: StageShot) => void) =>
    patchScene((s) => {
      const sh = s.shots.find((x) => x.id === shot?.id);
      if (sh) fn(sh);
    });

  const captureCurrent = (which: 'start' | 'end') => {
    if (!bridge.current || !shot) return;
    const pose = readPose(bridge.current);
    setShot((s) => {
      if (which === 'start') {
        s.start = pose;
        if (s.move !== 'custom') s.end = presetEnd(s.move, pose);
      } else {
        s.end = pose;
        s.move = 'custom';
      }
    });
    toast(which === 'start' ? 'Enquadramento inicial definido.' : 'Enquadramento final definido (movimento personalizado).');
  };

  const rehearse = () => {
    if (!shot || playback) return;
    const end = shot.move === 'custom' ? shot.end : presetEnd(shot.move, shot.start, shot.end);
    setTopView(false);
    setPlayback({ from: shot.start, to: end, duration: shot.duration, lerp: lerpPose, onDone: () => setTimeout(() => setPlayback(null), 400) });
  };

  async function renderPose(pose: CameraPose): Promise<string> {
    const b = bridge.current!;
    const [aw, ah] = aspect.split(':').map(Number);
    const W = 1280;
    const H = Math.round((W * (ah || 9)) / (aw || 16) / 2) * 2;
    const size = new Vector2();
    b.gl.getSize(size);
    const prevAspect = b.camera.aspect;
    const prev = readPose(b);
    b.gl.setSize(W, H, false);
    b.camera.aspect = W / H;
    applyPose(b.camera, b.controls, pose);
    b.gl.render(b.scene, b.camera);
    const url = b.gl.domElement.toDataURL('image/jpeg', 0.92);
    b.gl.setSize(size.x, size.y, false);
    b.camera.aspect = prevAspect;
    applyPose(b.camera, b.controls, prev);
    return url;
  }

  async function record() {
    if (!shot || !scene || !bridge.current || recording) return;
    const p = useProject.getState().project!;
    setRecording(true);
    setCapturing(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const end = shot.move === 'custom' ? shot.end : presetEnd(shot.move, shot.start, shot.end);
      const [a, b] = [await renderPose(shot.start), await renderPose(end)];
      setCapturing(false);
      const [ua, ub] = await Promise.all([api.uploadDataUrl(p.projectId, a), api.uploadDataUrl(p.projectId, b)]);

      // lay the shot out on the canvas inside its own section
      const origin = findFreeSpot(viewportCenter(), 1700, 560);
      const sectionId = uid();
      const renderA = mediaNodeFromUpload({ ...ua, name: `${shot.name} · render inicial` }, { x: origin.x + 40, y: origin.y + 40 });
      const renderB = mediaNodeFromUpload({ ...ub, name: `${shot.name} · render final` }, { x: origin.x + 40, y: origin.y + 300 });
      update((d) => {
        d.sections[sectionId] = { id: sectionId, label: `Set 3D · ${scene.name} · ${shot.name}`, position: origin, dimensions: { width: 1700, height: 560 } };
        for (const n of [renderA, renderB]) d.nodes[n.id] = { ...n, sectionId };
      });
      const cast = scene.objects.filter((o) => o.kind !== 'light').map((o) => o.name).join(', ');
      const editPrompt = `Turn this 3D blocking render into a finished cinematic film frame. Keep the exact camera angle, lens and composition, and the environment from the background plate. Replace the grey mannequins with the real characters/props (${cast || 'none'}), lit consistently with the scene. ${shot.prompt ?? ''}`.trim();
      const frameA = createMediaNode('image', { actionType: 'EditImage', prompt: editPrompt, title: `${shot.name} · quadro inicial`, position: { x: origin.x + 460, y: origin.y + 40 }, sectionId, select: false });
      const frameB = createMediaNode('image', { actionType: 'EditImage', prompt: editPrompt, title: `${shot.name} · quadro final`, position: { x: origin.x + 460, y: origin.y + 300 }, sectionId, select: false });
      connect(renderA.id, frameA, 'referenceImages');
      connect(renderB.id, frameB, 'referenceImages');
      if (scene.backdropNodeId && p.nodes[scene.backdropNodeId]) {
        connect(scene.backdropNodeId, frameA, 'referenceImages');
        connect(scene.backdropNodeId, frameB, 'referenceImages');
      }
      const moveText = MOVES.find((m) => m.id === shot.move)?.prompt ?? '';
      const video = createMediaNode('video', {
        actionType: 'ImageToVideo',
        prompt: `${moveText}. ${shot.prompt ?? ''}`.trim(),
        title: `${scene.name} · ${shot.name}`,
        position: { x: origin.x + 900, y: origin.y + 160 },
        sectionId,
        settings: { duration: String(Math.round(shot.duration)) },
        select: false,
      });
      connect(frameA, video, 'startFrame');
      connect(frameB, video, 'endFrame');
      toast('Plano gravado: gerando quadros e vídeo na Tela.', 'info', { label: 'Ver na Tela', run: () => setParams({}) });

      // the AI films it: two frames, then the video
      Promise.all([generateAndWait(frameA), generateAndWait(frameB)])
        .then(([ja, jb]) => {
          if (ja.status === 'completed' && jb.status === 'completed') return runGeneration(video);
          toast('Os quadros não foram gerados; o vídeo ficou aguardando.', 'error');
        })
        .catch((e) => toast(String(e.message), 'error'));
    } catch (e) {
      toast(String((e as Error).message), 'error');
    } finally {
      setCapturing(false);
      setRecording(false);
    }
  }

  const totalDuration = scene.shots.reduce((t, s) => t + s.duration, 0) || 1;

  return (
    <div className="stage">
      <div className="stage-bar">
        <select className="select" style={{ width: 180 }} value={scene.id} onChange={(e) => (e.target.value === '__new' ? createScene() : update((d) => void (d.stage.activeSceneId = e.target.value)))}>
          {Object.values(stage!.scenes).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="__new">+ Nova cena…</option>
        </select>
        <input className="input" style={{ width: 200 }} value={scene.name} onChange={(e) => patchScene((s) => void (s.name = e.target.value), false)} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={rehearse} disabled={!!playback} title="Reproduz o movimento de câmera do plano">
          <Play size={12} /> Ensaiar
        </button>
        <button className="btn btn-sm btn-primary" onClick={record} disabled={recording} title="Captura os quadros inicial/final, gera 2 quadros finalizados e o vídeo do plano">
          <Circle size={10} fill="#f9634e" color="#f9634e" /> {recording ? 'Gravando…' : 'Gravar'}
        </button>
        <span style={{ width: 12 }} />
        <button className={`chip ${!topView ? 'on' : ''}`} onClick={() => setTopView(false)}>
          3D
        </button>
        <button className={`chip ${topView ? 'on' : ''}`} onClick={() => setTopView(true)}>
          Planta
        </button>
      </div>

      <div className="stage-body">
        <div className="stage-viewport">
          <Stage3D
            scene={scene}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(id, pos, rot) =>
              patchScene((s) => {
                const o = s.objects.find((x) => x.id === id);
                if (o) {
                  o.position = pos;
                  o.rotationY = rot;
                }
              })
            }
            bridgeRef={bridge}
            playback={playback}
            capturing={capturing}
            topView={topView}
            mode={mode}
            initialPose={shot?.start ?? defaultPose()}
          />
          {selected && (
            <div className="stage-gizmo-mode">
              <button className={`icon-btn ${mode === 'translate' ? 'active' : ''}`} title="Mover" onClick={() => setMode('translate')}>
                <Move3d size={14} />
              </button>
              <button className={`icon-btn ${mode === 'rotate' ? 'active' : ''}`} title="Girar" onClick={() => setMode('rotate')}>
                <Rotate3d size={14} />
              </button>
            </div>
          )}
          {!scene.backdropUrl && <div className="stage-hint">Sem cenário: escolha uma imagem no painel à direita.</div>}
        </div>

        <aside className="stage-panel">
          <div className="stage-tabs">
            <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')}>
              Cena
            </button>
            <button className={tab === 'cameras' ? 'on' : ''} onClick={() => setTab('cameras')}>
              Câmeras
            </button>
          </div>

          {tab === 'scene' && (
            <div className="stage-section">
              <div className="label">Cenário</div>
              <select
                className="select"
                value={scene.backdropNodeId ?? ''}
                onChange={(e) => {
                  const n = images.find((i) => i.id === e.target.value);
                  patchScene((s) => {
                    s.backdropNodeId = n?.id;
                    s.backdropUrl = n?.data.url;
                  });
                }}
              >
                <option value="">— nenhum —</option>
                {images.map((n) => (
                  <option key={n.id} value={n.id}>
                    {nodeTitle(n)}
                  </option>
                ))}
              </select>

              <div className="label" style={{ marginTop: 14 }}>
                Adicionar
              </div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => addObject('person')}>
                  <PersonStanding size={12} /> Pessoa
                </button>
                <button className="btn btn-sm" onClick={() => addObject('prop')}>
                  <Box size={12} /> Objeto
                </button>
                <button className="btn btn-sm" onClick={() => addObject('light')}>
                  <Lightbulb size={12} /> Luz
                </button>
              </div>

              <div className="obj-list">
                {scene.objects.map((o) => (
                  <div key={o.id} className={`obj-item ${o.id === selectedId ? 'on' : ''}`} onClick={() => setSelectedId(o.id)}>
                    <span className="swatch" style={{ background: o.color }} />
                    <span className="grow">{o.name}</span>
                    <button
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        patchScene((s) => void (s.objects = s.objects.filter((x) => x.id !== o.id)));
                        if (selectedId === o.id) setSelectedId(null);
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>

              {selected && (
                <div className="props">
                  <label>
                    Nome
                    <input className="input" value={selected.name} onChange={(e) => patchScene((s) => void (s.objects.find((x) => x.id === selected.id)!.name = e.target.value), false)} />
                  </label>
                  <label>
                    Cor
                    <input type="color" value={selected.color} onChange={(e) => patchScene((s) => void (s.objects.find((x) => x.id === selected.id)!.color = e.target.value), false)} />
                  </label>
                  <label>
                    Escala {selected.scale.toFixed(2)}
                    <input type="range" min={0.3} max={3} step={0.05} value={selected.scale} onChange={(e) => patchScene((s) => void (s.objects.find((x) => x.id === selected.id)!.scale = Number(e.target.value)), false)} />
                  </label>
                  <label>
                    Rotação {Math.round((selected.rotationY * 180) / Math.PI)}°
                    <input type="range" min={-Math.PI} max={Math.PI} step={0.05} value={selected.rotationY} onChange={(e) => patchScene((s) => void (s.objects.find((x) => x.id === selected.id)!.rotationY = Number(e.target.value)), false)} />
                  </label>
                </div>
              )}
            </div>
          )}

          {tab === 'cameras' && shot && (
            <div className="stage-section">
              <label>
                Nome do plano
                <input className="input" value={shot.name} onChange={(e) => setShot((s) => void (s.name = e.target.value))} />
              </label>
              <label>
                Movimento
                <select
                  className="select"
                  value={shot.move}
                  onChange={(e) =>
                    setShot((s) => {
                      s.move = e.target.value as CameraMove;
                      if (s.move !== 'custom') s.end = presetEnd(s.move, s.start);
                    })
                  }
                >
                  {MOVES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Duração {shot.duration}s
                <input type="range" min={3} max={15} step={1} value={shot.duration} onChange={(e) => setShot((s) => void (s.duration = Number(e.target.value)))} />
              </label>
              <label>
                Lente (FOV) {shot.start.fov}°
                <input
                  type="range"
                  min={15}
                  max={90}
                  step={1}
                  value={shot.start.fov}
                  onChange={(e) =>
                    setShot((s) => {
                      s.start.fov = Number(e.target.value);
                      if (s.move !== 'custom') s.end = presetEnd(s.move, s.start);
                      if (bridge.current) applyPose(bridge.current.camera, bridge.current.controls, s.start);
                    })
                  }
                />
              </label>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={() => captureCurrent('start')}>
                  Vista atual = início
                </button>
                <button className="btn btn-sm" onClick={() => captureCurrent('end')}>
                  Vista atual = fim
                </button>
                <button className="btn btn-sm" onClick={() => bridge.current && applyPose(bridge.current.camera, bridge.current.controls, shot.start)}>
                  Ir para o início
                </button>
              </div>
              <label>
                Ação do plano (prompt)
                <textarea className="textarea" value={shot.prompt ?? ''} onChange={(e) => setShot((s) => void (s.prompt = e.target.value))} placeholder="Em inglês: what happens in this shot, mood, sound…" />
              </label>
              <p className="muted" style={{ fontSize: 11 }}>
                Dica: navegue com o mouse (arrastar = orbitar, botão direito = mover, roda = zoom), enquadre e use “Vista atual = início”.
              </p>
            </div>
          )}
        </aside>
      </div>

      <div className="shot-timeline">
        <div className="shot-track-label">
          <Video size={12} /> Planos
        </div>
        <div className="shot-track">
          {scene.shots.map((s) => (
            <button
              key={s.id}
              className={`shot-block ${s.id === shot?.id ? 'on' : ''}`}
              style={{ flexGrow: s.duration / totalDuration }}
              onClick={() => {
                patchScene((sc) => void (sc.activeShotId = s.id), false);
                setTab('cameras');
                if (bridge.current) applyPose(bridge.current.camera, bridge.current.controls, s.start);
              }}
            >
              <b>{s.name}</b>
              <small>
                {MOVES.find((m) => m.id === s.move)?.label} · {s.duration}s
              </small>
            </button>
          ))}
          <button
            className="shot-add"
            title="Adicionar plano"
            onClick={() => {
              const start = bridge.current ? readPose(bridge.current) : defaultPose();
              const s: StageShot = { id: uid(), name: `Plano ${scene.shots.length + 1}`, move: 'static', duration: 5, start, end: start };
              patchScene((sc) => {
                sc.shots.push(s);
                sc.activeShotId = s.id;
              });
              setTab('cameras');
            }}
          >
            <Plus size={14} />
          </button>
          {scene.shots.length > 1 && shot && (
            <button className="shot-add" title="Excluir plano atual" onClick={() => patchScene((sc) => {
              sc.shots = sc.shots.filter((x) => x.id !== shot.id);
              sc.activeShotId = sc.shots[0]?.id;
            })}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
