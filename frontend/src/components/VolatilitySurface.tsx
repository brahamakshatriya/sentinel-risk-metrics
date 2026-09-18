'use client';

import { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

const MAX_TIME = 10000;

function ParticleField() {
  const pointsRef = useRef<THREE.Points | null>(null);
  const timeRef = useRef(0);
  const { size } = useThree();
  const isVisibleRef = useRef(true);

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
    if (!isVisibleRef.current) return;
    
    timeRef.current += delta;
    if (timeRef.current > MAX_TIME) {
      timeRef.current = timeRef.current % MAX_TIME;
    }
    
    if (pointsRef.current?.material instanceof THREE.ShaderMaterial) {
      pointsRef.current.material.uniforms.uTime.value = timeRef.current;
    }
  });

  return <points ref={pointsRef} />;
}

function AmbientGlow() {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const timeRef = useRef(0);
  const isVisibleRef = useRef(true);

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
    if (!isVisibleRef.current) return;
    
    timeRef.current += delta;
    if (timeRef.current > MAX_TIME) {
      timeRef.current = timeRef.current % MAX_TIME;
    }
    
    if (meshRef.current?.material instanceof THREE.ShaderMaterial) {
      meshRef.current.material.uniforms.uTime.value = timeRef.current;
    }
  });

  return <mesh ref={meshRef} />;
}

function VolatilitySurfaceCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: '100px', threshold: 0.1 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!mounted) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [0, 1.2, 2.2], fov: 45 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
        shadows={false}
        performance={{ min: 0.5, max: 1 }}
      >
        <color attach="background" args={['#0a0e14']} />
        <fog attach="fog" args={['#0a0e14', 0.5, 8]} />
        
        {/* Wave surface mesh removed — DotGrid is now the hero's interactive
            field. Particle field + ambient glow retained as ambient depth. */}
        <AmbientGlow />
        <ParticleField />
        
        <ambientLight intensity={0.3} color="#3a4a5a" />
        <directionalLight position={[2, 4, 1]} intensity={0.4} color="#5aa9d6" />
        <directionalLight position={[-1, 2, -2]} intensity={0.2} color="#2a5a7a" />
      </Canvas>
    </div>
  );
}

export default function VolatilitySurface() {
  return (
    <div className="relative w-full h-full min-h-[500px]" style={{ willChange: 'transform', contain: 'layout style paint' }}>
      <VolatilitySurfaceCanvas />
    </div>
  );
}