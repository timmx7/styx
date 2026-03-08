"use client";

import { useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

function Orb({ position, scale, speed }: { position: [number, number, number]; scale: number; speed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    meshRef.current.position.y = position[1] + Math.sin(t * speed) * 0.3;
    meshRef.current.rotation.x = t * speed * 0.5;
    meshRef.current.rotation.z = t * speed * 0.3;
  });

  return (
    <Float speed={speed * 2} rotationIntensity={0.2} floatIntensity={0.4}>
      <mesh ref={meshRef} position={position} scale={scale}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color="#1400FF"
          metalness={0.7}
          roughness={0.1}
          envMapIntensity={1.5}
        />
      </mesh>
    </Float>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.5} color="#ffffff" />
      <directionalLight position={[-3, -2, 2]} intensity={0.4} color="#4400ff" />
      <Orb position={[-2.5, 0.5, -1]} scale={0.25} speed={0.4} />
      <Orb position={[1.8, -0.3, -0.5]} scale={0.35} speed={0.3} />
      <Orb position={[0.3, 1.2, -1.5]} scale={0.2} speed={0.5} />
      <Orb position={[-1, -1, -0.8]} scale={0.18} speed={0.35} />
      <Orb position={[2.8, 0.8, -2]} scale={0.15} speed={0.45} />
    </>
  );
}

export default function FloatingOrbs() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none hidden md:block"
      style={{ zIndex: 0, opacity: 0.35 }}
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
        dpr={[1, 1.5]}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
