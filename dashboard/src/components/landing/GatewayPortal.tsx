"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

function Portal() {
  const meshRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.TorusGeometry(1.2, 0.08, 64, 128);
    return geo;
  }, []);

  const innerRingGeo = useMemo(() => {
    return new THREE.TorusGeometry(0.85, 0.04, 32, 64);
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    meshRef.current.rotation.x = Math.PI * 0.15 + Math.sin(t * 0.2) * 0.1;
    meshRef.current.rotation.y += 0.004;
    meshRef.current.rotation.z = Math.cos(t * 0.15) * 0.05;
  });

  return (
    <Float speed={1} rotationIntensity={0.15} floatIntensity={0.3}>
      <group ref={meshRef}>
        {/* Outer ring */}
        <mesh geometry={geometry}>
          <meshStandardMaterial
            color="#1400FF"
            metalness={0.8}
            roughness={0.05}
            envMapIntensity={2}
          />
        </mesh>
        {/* Inner ring */}
        <mesh geometry={innerRingGeo}>
          <meshStandardMaterial
            color="#1400FF"
            metalness={0.6}
            roughness={0.2}
            transparent
            opacity={0.6}
          />
        </mesh>
        {/* Center glow disc */}
        <mesh>
          <circleGeometry args={[0.75, 64]} />
          <meshStandardMaterial
            color="#1400FF"
            transparent
            opacity={0.08}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </Float>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 4, 5]} intensity={1.8} color="#ffffff" />
      <directionalLight position={[-4, -1, 3]} intensity={0.6} color="#4400ff" />
      <pointLight position={[0, 0, 3]} intensity={0.8} color="#6633ff" />
      <Portal />
    </>
  );
}

export default function GatewayPortal() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div
      className="absolute pointer-events-none hidden md:block"
      style={{
        zIndex: 0,
        top: "10%",
        left: "-5%",
        width: "35%",
        height: "80%",
        opacity: 0.4,
        WebkitMaskImage:
          "linear-gradient(to left, transparent 0%, transparent 15%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.8) 50%, black 70%)",
        maskImage:
          "linear-gradient(to left, transparent 0%, transparent 15%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.8) 50%, black 70%)",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 4], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
        dpr={[1, 1.5]}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
