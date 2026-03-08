"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

function AbstractShape() {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.TorusKnotGeometry(1, 0.35, 128, 32, 2, 3);
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const noise =
        Math.sin(x * 2) * 0.05 +
        Math.cos(y * 3) * 0.04 +
        Math.sin(z * 1.5) * 0.03;
      positions.setXYZ(i, x + noise, y + noise * 0.8, z + noise * 0.6);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    meshRef.current.rotation.x = Math.sin(t * 0.15) * 0.2;
    meshRef.current.rotation.y += 0.003;
    meshRef.current.rotation.z = Math.cos(t * 0.1) * 0.1;
  });

  return (
    <Float speed={1.5} rotationIntensity={0.3} floatIntensity={0.5}>
      <mesh ref={meshRef} geometry={geometry} scale={1.3}>
        <meshStandardMaterial
          color="#1400FF"
          metalness={0.6}
          roughness={0.15}
          envMapIntensity={1.2}
        />
      </mesh>
    </Float>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1.8} color="#ffffff" />
      <directionalLight
        position={[-3, -2, 2]}
        intensity={0.5}
        color="#4400ff"
      />
      <pointLight position={[0, 3, 4]} intensity={1} color="#ffffff" />
      <AbstractShape />
    </>
  );
}

export default function HeroScene() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className="absolute pointer-events-none hidden md:block"
      style={{
        zIndex: 0,
        top: "5%",
        right: "-8%",
        width: "42%",
        height: "80%",
        opacity: mounted ? 0.65 : 0,
        transition: "opacity 1.2s ease-out",
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0%, transparent 20%, rgba(0,0,0,0.3) 35%, rgba(0,0,0,0.8) 55%, black 75%)",
        maskImage:
          "linear-gradient(to right, transparent 0%, transparent 20%, rgba(0,0,0,0.3) 35%, rgba(0,0,0,0.8) 55%, black 75%)",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
        dpr={[1, 1.5]}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
