"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

function RiverRibbon() {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.TorusKnotGeometry(1.8, 0.12, 256, 16, 3, 5);
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const wave = Math.sin(x * 1.5 + y * 2) * 0.08 + Math.cos(z * 2.5) * 0.06;
      positions.setXYZ(i, x + wave, y + wave * 0.5, z + wave * 0.7);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    meshRef.current.rotation.x = Math.sin(t * 0.08) * 0.15;
    meshRef.current.rotation.y += 0.002;
    meshRef.current.rotation.z = Math.cos(t * 0.06) * 0.08;
  });

  return (
    <Float speed={0.8} rotationIntensity={0.1} floatIntensity={0.2}>
      <mesh ref={meshRef} geometry={geometry} scale={1.1}>
        <meshStandardMaterial
          color="#1400FF"
          metalness={0.5}
          roughness={0.25}
          envMapIntensity={1}
          transparent
          opacity={0.85}
        />
      </mesh>
    </Float>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 3, 5]} intensity={1.5} color="#ffffff" />
      <directionalLight position={[-3, -3, 2]} intensity={0.5} color="#4400ff" />
      <pointLight position={[0, 2, 3]} intensity={0.6} color="#6633ff" />
      <RiverRibbon />
    </>
  );
}

export default function RiverScene() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none hidden md:block"
      style={{
        zIndex: 0,
        opacity: 0.25,
        WebkitMaskImage:
          "radial-gradient(ellipse 80% 70% at 50% 50%, black 0%, transparent 70%)",
        maskImage:
          "radial-gradient(ellipse 80% 70% at 50% 50%, black 0%, transparent 70%)",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 6], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
        dpr={[1, 1.5]}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
