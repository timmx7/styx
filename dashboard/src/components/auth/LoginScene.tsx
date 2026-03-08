"use client";

import { useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

function PortalRing({ radius, tube, opacity }: { radius: number; tube: number; opacity: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    meshRef.current.rotation.x = Math.PI * 0.12 + Math.sin(t * 0.15) * 0.08;
    meshRef.current.rotation.y += 0.003;
  });

  return (
    <mesh ref={meshRef}>
      <torusGeometry args={[radius, tube, 64, 128]} />
      <meshStandardMaterial
        color="#1400FF"
        metalness={0.75}
        roughness={0.08}
        envMapIntensity={2}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

function FloatingParticle({ position, scale, speed }: { position: [number, number, number]; scale: number; speed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    meshRef.current.position.y = position[1] + Math.sin(t * speed) * 0.4;
    meshRef.current.position.x = position[0] + Math.cos(t * speed * 0.7) * 0.2;
  });

  return (
    <mesh ref={meshRef} position={position} scale={scale}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial
        color="#1400FF"
        metalness={0.6}
        roughness={0.2}
        transparent
        opacity={0.5}
      />
    </mesh>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 5, 6]} intensity={1.6} color="#ffffff" />
      <directionalLight position={[-3, -2, 3]} intensity={0.5} color="#4400ff" />
      <pointLight position={[0, 0, 4]} intensity={0.7} color="#6633ff" />

      <Float speed={0.8} rotationIntensity={0.1} floatIntensity={0.2}>
        <group>
          <PortalRing radius={2} tube={0.06} opacity={0.9} />
          <PortalRing radius={1.5} tube={0.03} opacity={0.4} />
          <PortalRing radius={2.5} tube={0.04} opacity={0.25} />
        </group>
      </Float>

      {/* Small floating particles around the portal */}
      <FloatingParticle position={[1.8, 1.2, -1]} scale={0.06} speed={0.5} />
      <FloatingParticle position={[-1.5, -0.8, -0.5]} scale={0.04} speed={0.4} />
      <FloatingParticle position={[0.5, -1.5, -1.5]} scale={0.05} speed={0.6} />
      <FloatingParticle position={[-2, 0.5, -0.8]} scale={0.035} speed={0.45} />
    </>
  );
}

export default function LoginScene() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none hidden lg:block"
      style={{
        zIndex: 0,
        opacity: 0.5,
        WebkitMaskImage:
          "radial-gradient(ellipse 60% 60% at 75% 50%, black 0%, rgba(0,0,0,0.5) 40%, transparent 70%)",
        maskImage:
          "radial-gradient(ellipse 60% 60% at 75% 50%, black 0%, rgba(0,0,0,0.5) 40%, transparent 70%)",
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
