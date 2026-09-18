"use client";

import { useEffect, useRef } from "react";
import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute,
  GridHelper, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Uint32BufferAttribute,
  Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ReliefModel } from "../lib/relief-model";

export function ThreePreview({ model }: { model: ReliefModel }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<Group | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ antialias: true, alpha: true }); }
    catch {
      container.textContent = "A prévia 3D não está disponível neste navegador.";
      container.classList.add("three-error");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(new Color("#f5f8fc"), 1);
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(34, 1, 0.1, 2000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    scene.add(new AmbientLight(0xffffff, 2.1));
    const key = new DirectionalLight(0xffffff, 3.2);
    key.position.set(-40, -55, 90);
    scene.add(key);
    const fill = new DirectionalLight(0xb7d3ff, 1.7);
    fill.position.set(60, 40, 40);
    scene.add(fill);
    const grid = new GridHelper(220, 22, 0xc5d2e2, 0xe1e7ef);
    grid.rotateX(Math.PI / 2);
    grid.position.z = -0.03;
    scene.add(grid);
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    let animation = 0;
    const draw = () => { controls.update(); renderer.render(scene, camera); animation = requestAnimationFrame(draw); };
    draw();
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    if (modelGroupRef.current) {
      scene.remove(modelGroupRef.current);
      modelGroupRef.current.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          (object.material as MeshStandardMaterial).dispose();
        }
      });
    }

    const group = new Group();
    model.parts.forEach((part) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(part.vertices.flat(), 3));
      geometry.setIndex(new Uint32BufferAttribute(part.triangles.flat(), 1));
      geometry.computeVertexNormals();
      const material = new MeshStandardMaterial({
        color: part.color,
        roughness: 0.68,
        metalness: 0.02,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -part.level,
      });
      group.add(new Mesh(geometry, material));
    });
    scene.add(group);
    modelGroupRef.current = group;
    const size = Math.max(model.width, model.depth, 25);
    camera.position.set(size * 0.82, -size * 1.08, size * 0.72);
    controls.target.copy(new Vector3(0, 0, model.height * 0.35));
    controls.minDistance = size * 0.35;
    controls.maxDistance = size * 5;
    controls.update();
  }, [model]);

  return <div className="three-preview" ref={host} aria-label="Prévia tridimensional interativa"><div className="three-controls">Arraste para girar · role para aproximar</div></div>;
}
