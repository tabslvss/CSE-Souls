import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import type { Appearance, ClassId } from '../../../shared/classes';
import { createCharacter, releaseSharedAssets, type CharacterModel } from './characters';
import { PsxRenderer } from './psxRenderer';
import { createWorld, type WorldScene } from './world';

export interface StageHandle {
  /** Plays the class's attack, as a preview of how it fights. */
  showOff: () => void;
}

const DRAG_SENSITIVITY = 0.012;
const SHOW_OFF_SECONDS = 1.1;
const STARTING_TURN = 0.3;

interface StageState {
  psx: PsxRenderer;
  world: WorldScene;
  camera: THREE.PerspectiveCamera;
  model: CharacterModel | null;
  turn: number;
  showOffTimer: number;
  loadToken: number;
}

/** The character preview on the creation screen, drawn with the same PS1 pipeline as the game. */
export const CharacterStage = forwardRef<
  StageHandle,
  { classId: ClassId; appearance: Appearance; className?: string }
>(function CharacterStage({ classId, appearance, className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<StageState | null>(null);

  useImperativeHandle(ref, () => ({
    showOff: () => {
      if (stateRef.current) stateRef.current.showOffTimer = SHOW_OFF_SECONDS;
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const psx = new PsxRenderer(canvas);
    const world = createWorld({ withRocks: false });
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
    camera.position.set(0, 1.2, 6.2);
    camera.lookAt(0, 0.98, 0);

    // A warm key light from the front, and a pale rim that lifts the character off the dark.
    const key = new THREE.DirectionalLight(0xfff0d8, 0.9);
    key.position.set(2.5, 4, 5);
    world.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd98a, 1.3);
    rim.position.set(-3, 3, -4);
    world.scene.add(rim);

    const state: StageState = { psx, world, camera, model: null, turn: STARTING_TURN, showOffTimer: 0, loadToken: 0 };
    stateRef.current = state;

    const resize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      psx.setSize(width, height);
      camera.aspect = width / height;
      // On narrow screens the panels stack, so the character moves up out of their way.
      camera.setViewOffset(width, height, 0, width < 1000 ? height * 0.2 : 0, width, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let dragging = false;
    let lastX = 0;
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      state.turn += (event.clientX - lastX) * DRAG_SENSITIVITY;
      lastX = event.clientX;
    };
    const onUp = () => {
      dragging = false;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    let frameId = 0;
    let last = performance.now();
    const frame = (time: number) => {
      frameId = requestAnimationFrame(frame);
      const seconds = Math.min(0.1, (time - last) / 1000);
      last = time;
      const { model } = state;
      if (model) {
        // A slow sway, so the character stays facing the player but never looks frozen.
        const sway = dragging ? 0 : Math.sin(time * 0.0005) * 0.22;
        model.root.rotation.y = state.turn + sway;
        const showingOff = state.showOffTimer > 0;
        const started = showingOff && state.showOffTimer === SHOW_OFF_SECONDS;
        state.showOffTimer = Math.max(0, state.showOffTimer - seconds);
        model.play(showingOff ? 'attack' : 'idle', started);
        model.update(seconds);
      }
      world.update();
      psx.render(world.scene, camera);
    };
    frameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      stateRef.current = null;
      state.model?.dispose();
      world.dispose();
      releaseSharedAssets();
      psx.dispose();
    };
  }, []);

  // Rebuilds the model whenever a choice changes. Loaded files are cached, so this is quick.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const token = ++state.loadToken;
    createCharacter(classId, appearance).then(
      (model) => {
        if (stateRef.current !== state || state.loadToken !== token) {
          model.dispose();
          return;
        }
        if (state.model) {
          state.world.scene.remove(state.model.root);
          state.model.dispose();
        }
        state.model = model;
        state.world.scene.add(model.root);
      },
      // The previous character stays on screen, and the next choice tries the download again.
      () => undefined,
    );
  }, [classId, appearance]);

  return <canvas ref={canvasRef} className={className} aria-label="Preview of your character" />;
});
