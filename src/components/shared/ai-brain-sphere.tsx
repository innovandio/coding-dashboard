"use client";

import { useRef, useEffect } from "react";
import * as THREE from "three";

interface AiBrainSphereProps {
  isActive: boolean;
  isConnected?: boolean;
  isThinking?: boolean;
  size?: number;
}

export function AiBrainSphere({ isActive, isConnected = true, isThinking = false, size = 256 }: AiBrainSphereProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(isActive);
  const connectedRef = useRef(isConnected);
  const thinkingRef = useRef(isThinking);
  const internalsRef = useRef<{
    renderer: THREE.WebGLRenderer;
    frameId: number;
  } | null>(null);

  useEffect(() => {
    activeRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    connectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    thinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.z = 4.5;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const PARTICLE_COUNT = 1800;
    const SYNAPSE_COUNT = 120;
    const BASE_RADIUS = 1.6;

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const origRadius = new Float32Array(PARTICLE_COUNT);
    const spherePhi = new Float32Array(PARTICLE_COUNT);
    const sphereTheta = new Float32Array(PARTICLE_COUNT);
    const orangeGroup = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / PARTICLE_COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = BASE_RADIUS + (Math.random() - 0.5) * 0.25;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      origRadius[i] = r;
      spherePhi[i] = phi;
      sphereTheta[i] = theta;

      const palette = Math.random();
      if (palette < 0.55) {
        colors[i * 3] = 0.05 + Math.random() * 0.08;
        colors[i * 3 + 1] = 0.15 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.5 + Math.random() * 0.3;
      } else if (palette < 0.88) {
        colors[i * 3] = 0.05 + Math.random() * 0.1;
        colors[i * 3 + 1] = 0.3 + Math.random() * 0.25;
        colors[i * 3 + 2] = 0.6 + Math.random() * 0.25;
      } else {
        colors[i * 3] = 0.1 + Math.random() * 0.15;
        colors[i * 3 + 1] = 0.45 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.7 + Math.random() * 0.2;
      }

      sizes[i] = 0.6 + Math.random() * 1.0;
      orangeGroup[i] = Math.random() < 0.5 ? 1.0 : 0.0;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("origRadius", new THREE.BufferAttribute(origRadius, 1));
    geo.setAttribute("sPhi", new THREE.BufferAttribute(spherePhi, 1));
    geo.setAttribute("sTheta", new THREE.BufferAttribute(sphereTheta, 1));
    geo.setAttribute("aOrangeGroup", new THREE.BufferAttribute(orangeGroup, 1));

    const particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uActive: { value: isActive ? 1.0 : 0.0 },
        uConnected: { value: isConnected ? 1.0 : 0.0 },
        uThinking: { value: isThinking ? 1.0 : 0.0 },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        attribute float origRadius;
        attribute float sPhi;
        attribute float sTheta;
        attribute float aOrangeGroup;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;
        uniform float uActive;
        uniform float uConnected;
        uniform float uThinking;
        void main() {
          // Blend to orange for particles in the orange group when thinking
          vec3 orangeColor = vec3(0.85, 0.45, 0.08);
          vec3 liveColor = mix(color, orangeColor, aOrangeGroup * uThinking);
          // Desaturate to gray when disconnected
          float luma = dot(liveColor, vec3(0.299, 0.587, 0.114));
          vec3 grayColor = vec3(luma * 0.45);
          vColor = mix(grayColor, liveColor, uConnected);
          // Same radius active & inactive — waves are the only difference
          float baseR = origRadius;
          float wave1 = sin(sPhi * 4.0 + sTheta * 3.0 + uTime * 1.8) * 0.20;
          float wave2 = sin(sPhi * 6.0 - sTheta * 2.0 + uTime * 1.1) * 0.14;
          float wave3 = sin(sPhi * 2.5 + sTheta * 5.0 - uTime * 2.2) * 0.10;
          float waveR = baseR + (wave1 + wave2 + wave3) * uActive * uConnected;
          float breathe = sin(uTime * 0.8) * 0.07 * uActive * uConnected;
          waveR += breathe;
          vec3 pos;
          pos.x = waveR * sin(sPhi) * cos(sTheta);
          pos.y = waveR * sin(sPhi) * sin(sTheta);
          pos.z = waveR * cos(sPhi);
          float pulseActive = sin(uTime * 1.5 + pos.y * 3.0) * 0.5 + 0.5;
          float pulseInactive = sin(uTime * 0.4) * 0.3 + 0.5;
          float pulse = mix(pulseInactive, pulseActive, uActive);
          // When disconnected, use a flat dim alpha
          float connectedAlpha = mix(0.55, 0.85, uActive);
          float disconnectedAlpha = 0.35;
          float activePulse = mix(disconnectedAlpha, connectedAlpha, uConnected);
          vAlpha = mix(disconnectedAlpha, (0.15 + pulse * 0.30) * activePulse, uConnected);
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = size * (95.0 / -mvPos.z) * (0.8 + pulse * 0.25 * uActive * uConnected);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float glow = exp(-d * d * 4.0);
          gl_FragColor = vec4(vColor, vAlpha * glow);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geo, particleMat);
    scene.add(particles);

    // --- Synaptic Connections ---
    const synapseGeo = new THREE.BufferGeometry();
    const synPositions = new Float32Array(SYNAPSE_COUNT * 6);
    const synColors = new Float32Array(SYNAPSE_COUNT * 6);

    for (let i = 0; i < SYNAPSE_COUNT; i++) {
      const a = Math.floor(Math.random() * PARTICLE_COUNT);
      const ax = positions[a * 3],
        ay = positions[a * 3 + 1],
        az = positions[a * 3 + 2];
      let bestDist = Infinity,
        bestB = Math.floor(Math.random() * PARTICLE_COUNT);
      for (let t = 0; t < 8; t++) {
        const candidate = Math.floor(Math.random() * PARTICLE_COUNT);
        const dx = positions[candidate * 3] - ax;
        const dy = positions[candidate * 3 + 1] - ay;
        const dz = positions[candidate * 3 + 2] - az;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestDist && dist > 0.01) {
          bestDist = dist;
          bestB = candidate;
        }
      }

      synPositions[i * 6] = positions[a * 3];
      synPositions[i * 6 + 1] = positions[a * 3 + 1];
      synPositions[i * 6 + 2] = positions[a * 3 + 2];
      synPositions[i * 6 + 3] = positions[bestB * 3];
      synPositions[i * 6 + 4] = positions[bestB * 3 + 1];
      synPositions[i * 6 + 5] = positions[bestB * 3 + 2];

      for (let v = 0; v < 2; v++) {
        synColors[i * 6 + v * 3] = 0.08;
        synColors[i * 6 + v * 3 + 1] = 0.25;
        synColors[i * 6 + v * 3 + 2] = 0.6;
      }
    }

    synapseGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(synPositions, 3)
    );
    synapseGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(synColors, 3)
    );

    const synapseMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uActive: { value: isActive ? 1.0 : 0.0 }, uConnected: { value: isConnected ? 1.0 : 0.0 } },
      vertexShader: `
        attribute vec3 color;
        varying vec3 vColor;
        varying float vConnected;
        uniform float uTime;
        uniform float uActive;
        uniform float uConnected;
        void main() {
          float luma = dot(color, vec3(0.299, 0.587, 0.114));
          vColor = mix(vec3(luma * 0.45), color, uConnected);
          vConnected = uConnected;
          vec3 pos = position;
          float r = length(pos);
          float sPhi = acos(clamp(pos.z / r, -1.0, 1.0));
          float sTheta = atan(pos.y, pos.x);
          float wave1 = sin(sPhi * 4.0 + sTheta * 3.0 + uTime * 1.8) * 0.20;
          float wave2 = sin(sPhi * 6.0 - sTheta * 2.0 + uTime * 1.1) * 0.14;
          float wave3 = sin(sPhi * 2.5 + sTheta * 5.0 - uTime * 2.2) * 0.10;
          float breathe = sin(uTime * 0.8) * 0.07;
          float newR = r + (wave1 + wave2 + wave3 + breathe) * uActive * uConnected;
          pos = normalize(pos) * newR;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vConnected;
        void main() {
          gl_FragColor = vec4(vColor, mix(0.02, 0.05, vConnected));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const synapses = new THREE.LineSegments(synapseGeo, synapseMat);
    scene.add(synapses);

    // --- Inner Core Glow (only visible when active) ---
    const coreGeo = new THREE.SphereGeometry(0.35, 32, 32);
    const coreMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uActive: { value: isActive ? 1.0 : 0.0 }, uConnected: { value: isConnected ? 1.0 : 0.0 }, uThinking: { value: isThinking ? 1.0 : 0.0 } },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uActive;
        uniform float uConnected;
        uniform float uThinking;
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.65 - dot(vNormal, vec3(0, 0, 1.0)), 2.5);
          float pulse = 0.7 + 0.3 * sin(uTime * 1.2);
          vec3 blueCol = mix(vec3(0.04, 0.12, 0.55), vec3(0.1, 0.35, 0.75), intensity);
          vec3 orangeCol = mix(vec3(0.55, 0.25, 0.04), vec3(0.75, 0.40, 0.10), intensity);
          vec3 col = mix(blueCol, orangeCol, uThinking * 0.5);
          // Fade core to nothing when disconnected
          gl_FragColor = vec4(col * pulse, intensity * 0.32 * pulse * uActive * uConnected);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(coreGeo, coreMat));

    // --- Animation (delta-time rotation to avoid spin jumps on transition) ---
    const clock = new THREE.Clock();
    let activeSmooth = isActive ? 1.0 : 0.0;
    let connectedSmooth = isConnected ? 1.0 : 0.0;
    let thinkingSmooth = isThinking ? 1.0 : 0.0;
    let rotY = 0;
    let frameId = 0;

    function animate() {
      frameId = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      const t = clock.elapsedTime;

      const target = activeRef.current ? 1.0 : 0.0;
      activeSmooth += (target - activeSmooth) * 0.03;

      const connectedTarget = connectedRef.current ? 1.0 : 0.0;
      connectedSmooth += (connectedTarget - connectedSmooth) * 0.03;

      const thinkingTarget = thinkingRef.current ? 1.0 : 0.0;
      thinkingSmooth += (thinkingTarget - thinkingSmooth) * 0.03;

      particleMat.uniforms.uTime.value = t;
      particleMat.uniforms.uActive.value = activeSmooth;
      particleMat.uniforms.uConnected.value = connectedSmooth;
      particleMat.uniforms.uThinking.value = thinkingSmooth;
      synapseMat.uniforms.uTime.value = t;
      synapseMat.uniforms.uActive.value = activeSmooth;
      synapseMat.uniforms.uConnected.value = connectedSmooth;
      coreMat.uniforms.uTime.value = t;
      coreMat.uniforms.uActive.value = activeSmooth;
      coreMat.uniforms.uConnected.value = connectedSmooth;
      coreMat.uniforms.uThinking.value = thinkingSmooth;

      // Accumulate rotation via delta — speed changes don't cause jumps
      // Stop rotation when disconnected
      const rotSpeed = (0.08 + activeSmooth * 0.04) * connectedSmooth;
      rotY -= dt * rotSpeed;
      particles.rotation.y = rotY;
      particles.rotation.x = Math.sin(rotY * 0.6) * (0.05 + activeSmooth * 0.08);
      synapses.rotation.copy(particles.rotation);

      renderer.render(scene, camera);
    }

    animate();
    internalsRef.current = { renderer, frameId };

    return () => {
      cancelAnimationFrame(frameId);
      renderer.dispose();
      renderer.domElement.remove();
      geo.dispose();
      particleMat.dispose();
      synapseGeo.dispose();
      synapseMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      internalsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return (
    <div
      ref={containerRef}
      style={{ width: size, height: size }}
      className="flex-shrink-0"
    />
  );
}
