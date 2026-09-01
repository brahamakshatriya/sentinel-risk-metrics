'use client';

import { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

const GRID_SIZE = 64;
const GRID_SPACING = 0.08;

function VolatilitySurfaceMesh() {
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const timeRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const { size, camera } = useThree();

  useEffect(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(GRID_SIZE * GRID_SIZE * 3);
    const uvs = new Float32Array(GRID_SIZE * GRID_SIZE * 2);
    const indices: number[] = [];

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const idx = i * GRID_SIZE + j;
        positions[idx * 3] = (j - GRID_SIZE / 2) * GRID_SPACING;
        positions[idx * 3 + 1] = 0;
        positions[idx * 3 + 2] = (i - GRID_SIZE / 2) * GRID_SPACING;
        uvs[idx * 2] = j / (GRID_SIZE - 1);
        uvs[idx * 2 + 1] = i / (GRID_SIZE - 1);
      }
    }

    for (let i = 0; i < GRID_SIZE - 1; i++) {
      for (let j = 0; j < GRID_SIZE - 1; j++) {
        const a = i * GRID_SIZE + j;
        const b = i * GRID_SIZE + j + 1;
        const c = (i + 1) * GRID_SIZE + j;
        const d = (i + 1) * GRID_SIZE + j + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    geometryRef.current = geometry;

    const vertexShader = `
      varying vec2 vUv;
      varying float vHeight;
      uniform float uTime;
      uniform vec2 uMouse;
      uniform float uAspect;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p * frequency);
          amplitude *= 0.5;
          frequency *= 2.0;
        }
        return value;
      }

      void main() {
        vUv = uv;
        vec3 pos = position;

        float time = uTime * 0.3;
        float wave1 = sin(pos.x * 4.0 + time) * 0.3;
        float wave2 = cos(pos.z * 3.0 - time * 1.2) * 0.25;
        float wave3 = sin((pos.x + pos.z) * 2.5 + time * 0.8) * 0.2;
        
        float mouseDist = distance(uv, uMouse);
        float mouseInfluence = smoothstep(0.5, 0.0, mouseDist) * 0.4;
        
        float volatility = fbm(uv * 3.0 + time * 0.15) * 0.35;
        float surfaceHeight = (wave1 + wave2 + wave3 + volatility + mouseInfluence) * 0.5;

        vHeight = surfaceHeight;
        pos.y = surfaceHeight;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      varying vec2 vUv;
      varying float vHeight;
      uniform float uTime;

      void main() {
        float primaryHue = 0.55;
        float secondaryHue = 0.65;
        
        float heightNormalized = smoothstep(-0.4, 0.5, vHeight);
        float hue = mix(secondaryHue, primaryHue, heightNormalized);
        float saturation = mix(0.9, 0.6, heightNormalized);
        float lightness = mix(0.25, 0.55, heightNormalized);
        
        float pulse = sin(uTime * 2.0 + vUv.y * 10.0) * 0.03;
        lightness += pulse;
        
        vec3 color = vec3(0.0);
        float h = hue;
        float s = saturation;
        float l = lightness;
        float c = (1.0 - abs(2.0 * l - 1.0)) * s;
        float x = c * (1.0 - abs(fract(h * 6.0) - 1.0));
        float m = l - c / 2.0;
        
        if (h < 1.0/6.0) color = vec3(c, x, 0.0);
        else if (h < 2.0/6.0) color = vec3(x, c, 0.0);
        else if (h < 3.0/6.0) color = vec3(0.0, c, x);
        else if (h < 4.0/6.0) color = vec3(0.0, x, c);
        else if (h < 5.0/6.0) color = vec3(x, 0.0, c);
        else color = vec3(c, 0.0, x);
        color += m;
        
        float edgeFactor = smoothstep(0.95, 1.0, vUv.x) + smoothstep(0.95, 1.0, 1.0 - vUv.x) +
                          smoothstep(0.95, 1.0, vUv.y) + smoothstep(0.95, 1.0, 1.0 - vUv.y);
        color = mix(color, vec3(0.15, 0.25, 0.35), edgeFactor * 0.3);
        
        float gridPattern = sin(vUv.x * 80.0) * sin(vUv.y * 80.0) * 0.02;
        color += gridPattern;
        
        gl_FragColor = vec4(color, 0.92);
      }
    `;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: size.width / size.height },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    materialRef.current = material;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.15;

    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [size]);

  useFrame((state, delta) => {
    timeRef.current += delta;
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = timeRef.current;
      materialRef.current.uniforms.uMouse.value.lerp(mouseRef.current, 0.05);
      materialRef.current.uniforms.uAspect.value = size.width / size.height;
    }
  });

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    mouseRef.current.x = (event.nativeEvent.clientX / window.innerWidth) * 2 - 1;
    mouseRef.current.y = -(event.nativeEvent.clientY / window.innerHeight) * 2 + 1;
  };

  return (
    <mesh
      geometry={geometryRef.current!}
      material={materialRef.current!}
      onPointerMove={handlePointerMove}
    />
  );
}

function ParticleField() {
  const pointsRef = useRef<THREE.Points | null>(null);
  const timeRef = useRef(0);
  const { size } = useThree();

  useEffect(() => {
    const count = 2000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const radius = 0.8 + Math.random() * 1.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.3 - 0.15;
      positions[i * 3 + 2] = radius * Math.cos(phi);
      
      sizes[i] = 0.5 + Math.random() * 1.5;
      alphas[i] = 0.1 + Math.random() * 0.3;
      phases[i] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.PointsMaterial({
      size: 0.015,
      vertexColors: false,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const customMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: size.height * 0.5 },
      },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute float phase;
        varying float vAlpha;
        varying float vPhase;
        uniform float uTime;
        uniform float uSize;
        
        void main() {
          vAlpha = alpha;
          vPhase = phase;
          vec3 pos = position;
          
          float time = uTime * 0.15;
          float drift = sin(time + phase) * 0.02;
          pos.y += drift;
          pos.x += cos(time * 0.7 + phase) * 0.015;
          pos.z += sin(time * 0.5 + phase) * 0.015;
          
          float slowWave = sin(position.y * 5.0 + time) * 0.03;
          pos.y += slowWave;
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = size * (uSize / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vPhase;
        
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          
          float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * vAlpha;
          float hue = 0.55 + sin(vPhase) * 0.05;
          float sat = 0.8;
          float light = 0.5;
          
          float c = (1.0 - abs(2.0 * light - 1.0)) * sat;
          float x = c * (1.0 - abs(fract(hue * 6.0) - 1.0));
          float m = light - c / 2.0;
          vec3 color;
          float h = hue;
          if (h < 1.0/6.0) color = vec3(c, x, 0.0);
          else if (h < 2.0/6.0) color = vec3(x, c, 0.0);
          else if (h < 3.0/6.0) color = vec3(0.0, c, x);
          else if (h < 4.0/6.0) color = vec3(0.0, x, c);
          else if (h < 5.0/6.0) color = vec3(x, 0.0, c);
          else color = vec3(c, 0.0, x);
          color += m;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, customMaterial);
    pointsRef.current = points;

    return () => {
      geometry.dispose();
      customMaterial.dispose();
    };
  }, [size]);

  useFrame((_, delta) => {
    timeRef.current += delta;
    if (pointsRef.current?.material instanceof THREE.ShaderMaterial) {
      pointsRef.current.material.uniforms.uTime.value = timeRef.current;
    }
  });

  return <points ref={pointsRef} />;
}

function AmbientGlow() {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const geometry = new THREE.SphereGeometry(2.5, 32, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        uniform float uTime;
        
        void main() {
          float facing = dot(vNormal, vec3(0.0, 1.0, 0.0));
          facing = pow(facing, 3.0);
          
          float pulse = sin(uTime * 0.5) * 0.15 + 0.85;
          float hue = 0.55;
          float sat = 0.7;
          float light = 0.3 * facing * pulse;
          
          float c = (1.0 - abs(2.0 * light - 1.0)) * sat;
          float x = c * (1.0 - abs(fract(hue * 6.0) - 1.0));
          float m = light - c / 2.0;
          vec3 color;
          float h = hue;
          if (h < 1.0/6.0) color = vec3(c, x, 0.0);
          else if (h < 2.0/6.0) color = vec3(x, c, 0.0);
          else if (h < 3.0/6.0) color = vec3(0.0, c, x);
          else if (h < 4.0/6.0) color = vec3(0.0, x, c);
          else if (h < 5.0/6.0) color = vec3(x, 0.0, c);
          else color = vec3(c, 0.0, x);
          color += m;
          
          gl_FragColor = vec4(color, facing * 0.15 * pulse);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -0.15;
    meshRef.current = mesh;

    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, []);

  useFrame((_, delta) => {
    timeRef.current += delta;
    if (meshRef.current?.material instanceof THREE.ShaderMaterial) {
      meshRef.current.material.uniforms.uTime.value = timeRef.current;
    }
  });

  return <mesh ref={meshRef} />;
}

export function VolatilitySurfaceCanvas() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
    );
  }

  return (
    <Canvas
      camera={{ position: [0, 1.2, 2.2], fov: 45 }}
      style={{ width: '100%', height: '100%' }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      shadows={false}
    >
      <color attach="background" args={['#0a0e14']} />
      <fog attach="fog" args={['#0a0e14', 0.5, 8]} />
      
      <AmbientGlow />
      <VolatilitySurfaceMesh />
      <ParticleField />
      
      <ambientLight intensity={0.3} color="#3a4a5a" />
      <directionalLight position={[2, 4, 1]} intensity={0.4} color="#5aa9d6" />
      <directionalLight position={[-1, 2, -2]} intensity={0.2} color="#2a5a7a" />
    </Canvas>
  );
}

export default function VolatilitySurface() {
  return (
    <div className="relative w-full h-full min-h-[500px]" style={{ willChange: 'transform' }}>
      <VolatilitySurfaceCanvas />
    </div>
  );
}