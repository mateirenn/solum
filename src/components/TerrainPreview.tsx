import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { materialByIndex } from '../domain/roblox';
import { compositeHeightAt, materialAt, TerrainProject, worldHeightFromNormalized } from '../domain/terrain';

type TerrainPreviewProps = { project: TerrainProject; revision: number; materialOverride?: Uint8Array | null };

export function TerrainPreview({ project, revision, materialOverride }: TerrainPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const waterRef = useRef<THREE.Mesh | null>(null);
  const scaleReferenceRef = useRef<THREE.Group | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const previewHost = host;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#10161b');
    const camera = new THREE.PerspectiveCamera(38, 1, 10, 50000);
    camera.position.set(0, 980, 1240);
    camera.lookAt(0, 0, 0);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    previewHost.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 120;
    controls.maxDistance = 10000;
    controls.maxPolarAngle = Math.PI * 0.47;
    scene.add(new THREE.HemisphereLight('#e4e9db', '#1c2e39', 2.1));
    const sun = new THREE.DirectionalLight('#fff2d0', 2.8);
    sun.position.set(-500, 1100, 650);
    scene.add(sun);
    scene.add(new THREE.AmbientLight('#8aa2a5', 0.45));
    sceneRef.current = scene;
    cameraRef.current = camera;

    function resize(): void {
      const width = Math.max(1, previewHost.clientWidth);
      const height = Math.max(1, previewHost.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(previewHost);
    resize();
    let animationFrame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.clear();
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !cameraRef.current) return;
    if (meshRef.current) {
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      scene.remove(meshRef.current);
    }
    if (waterRef.current) {
      waterRef.current.geometry.dispose();
      (waterRef.current.material as THREE.Material).dispose();
      scene.remove(waterRef.current);
    }
    if (scaleReferenceRef.current) {
      scaleReferenceRef.current.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else (mesh.material as THREE.Material | undefined)?.dispose?.();
      });
      scene.remove(scaleReferenceRef.current);
      scaleReferenceRef.current = null;
    }
    const side = Math.min(72, Math.max(28, Math.round(Math.sqrt(Math.min(project.width * project.height, 5184)))));
    const vertexCount = side * side;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices: number[] = [];
    const worldWidth = project.width * 4;
    const worldDepth = project.height * 4;
    const verticalScale = Math.max(0.2, Math.min(1, worldWidth / Math.max(1, project.maxElevation - project.minElevation) * 0.22));
    for (let row = 0; row < side; row += 1) {
      for (let column = 0; column < side; column += 1) {
        const vertex = row * side + column;
        const x = Math.round((column / (side - 1)) * (project.width - 1));
        const y = Math.round((row / (side - 1)) * (project.height - 1));
        const normalized = compositeHeightAt(project, x, y);
        const elevation = worldHeightFromNormalized(project, normalized);
        positions[vertex * 3] = (column / (side - 1) - 0.5) * worldWidth;
        positions[vertex * 3 + 1] = elevation * verticalScale;
        positions[vertex * 3 + 2] = (row / (side - 1) - 0.5) * worldDepth;
        const index = y * project.width + x;
        const color = new THREE.Color(materialByIndex(materialOverride?.[index] ?? materialAt(project, index)).previewColor);
        color.lerp(new THREE.Color('#f1e4bd'), normalized * 0.26);
        colors[vertex * 3] = color.r;
        colors[vertex * 3 + 1] = color.g;
        colors[vertex * 3 + 2] = color.b;
      }
    }
    for (let row = 0; row < side - 1; row += 1) {
      for (let column = 0; column < side - 1; column += 1) {
        const topLeft = row * side + column;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + side;
        const bottomRight = bottomLeft + 1;
        indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02, flatShading: false });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;

    const seaNormalized = (project.seaLevel - project.minElevation) / Math.max(1, project.maxElevation - project.minElevation);
    const waterGeometry = new THREE.PlaneGeometry(worldWidth, worldDepth).rotateX(-Math.PI / 2);
    const waterMaterial = new THREE.MeshStandardMaterial({ color: '#6b9b9c', transparent: true, opacity: 0.26, roughness: 0.2, metalness: 0.1, depthWrite: false });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.position.y = project.seaLevel * verticalScale;
    water.visible = seaNormalized > 0 && seaNormalized < 1;
    scene.add(water);
    waterRef.current = water;
    const grid = new THREE.GridHelper(worldWidth, Math.min(32, project.width / 16), '#687d78', '#31413f');
    grid.position.y = project.minElevation * verticalScale - 1;
    grid.name = 'solum-preview-grid';
    scene.add(grid);
    const scaleReference = new THREE.Group();
    scaleReference.name = 'solum-six-stud-scale-reference';
    const referenceMaterial = new THREE.MeshStandardMaterial({ color: '#c5f74f', roughness: 0.76, metalness: 0.02 });
    const baseMaterial = new THREE.MeshStandardMaterial({ color: '#81918a', roughness: 0.95, metalness: 0 });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(18, 0.35, 18), baseMaterial);
    plinth.position.y = 0.18;
    scaleReference.add(plinth);
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.8, 0.72), referenceMaterial);
    leftLeg.position.set(-0.42, 1.25, 0);
    scaleReference.add(leftLeg);
    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.8, 0.72), referenceMaterial);
    rightLeg.position.set(0.42, 1.25, 0);
    scaleReference.add(rightLeg);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 1), referenceMaterial);
    torso.position.y = 3.15;
    scaleReference.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), referenceMaterial);
    head.position.y = 4.92;
    scaleReference.add(head);
    scaleReference.position.set(-worldWidth * 0.42, project.minElevation * verticalScale, worldDepth * 0.42);
    scaleReference.scale.setScalar(1);
    scene.add(scaleReference);
    scaleReferenceRef.current = scaleReference;
    return () => {
      scene.remove(grid);
      scene.remove(scaleReference);
    };
  }, [project, revision, materialOverride]);

  return <div ref={hostRef} className="terrain-preview"><div className="preview-label"><span className="live-dot" />Live 3D preview <small>sampled mesh · 6-stud reference</small></div>{unavailable && <div className="preview-unavailable"><strong>WebGL preview unavailable</strong><span>2D editing and export remain available. Check the graphics driver or WebView2 runtime.</span></div>}<div className="preview-controls">Orbit with drag · zoom with wheel · lime mannequin ≈ 6 studs</div></div>;
}
