import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {TransitionSeries, springTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';

// ─── Design tokens ─────────────────────────────────────────────────────────
const BLUE = '#1400FF';
const BG = '#1a1a1a';
const WHITE = '#ffffff';
const MUTED = '#666666';
const CARD_BG = '#111111';
const CARD_BORDER = '#2a2a2a';
const FONT_SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const FONT_MONO = '"SF Mono", "Cascadia Code", "Fira Code", "Courier New", monospace';

// ─── Browser chrome layout ──────────────────────────────────────────────────
const BR = { x: 60, y: 40, w: 1800, h: 1000, ch: 52 } as const;
const CONTENT_TOP = BR.y + BR.ch; // 92

// ─── Coordinate helper ──────────────────────────────────────────────────────
const toVideo = (px: number, py: number, imgW: number, imgH: number) => {
  const scale = Math.max(BR.w / imgW, (BR.h - BR.ch) / imgH);
  return {x: BR.x + px * scale, y: CONTENT_TOP + py * scale};
};

// ─── Cubic ease-in-out ──────────────────────────────────────────────────────
const eio = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ─── Cursor keyframe interpolation ─────────────────────────────────────────
type CursorKF = {f: number; x: number; y: number};
const cursorAt = (frame: number, kf: CursorKF[]): {x: number; y: number} => {
  if (frame <= kf[0].f) return kf[0];
  if (frame >= kf[kf.length - 1].f) return kf[kf.length - 1];
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i], b = kf[i + 1];
    if (frame >= a.f && frame <= b.f) {
      const t = (frame - a.f) / (b.f - a.f);
      const ease = eio(t);
      return {x: a.x + (b.x - a.x) * ease, y: a.y + (b.y - a.y) * ease};
    }
  }
  return kf[kf.length - 1];
};

// ─── Browser chrome wrapper ─────────────────────────────────────────────────
const BrowserFrame: React.FC<{url: string; children: React.ReactNode}> = ({url, children}) => (
  <div
    style={{
      position: 'absolute',
      left: BR.x, top: BR.y, width: BR.w, height: BR.h,
      background: '#1c1c1e',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 50px 120px rgba(0,0,0,0.85)',
    }}
  >
    <div
      style={{
        height: BR.ch,
        background: '#2c2c2e',
        display: 'flex', alignItems: 'center',
        padding: '0 18px', gap: 10,
        borderBottom: '1px solid #1a1a1a',
        flexShrink: 0,
      }}
    >
      <div style={{display: 'flex', gap: 7}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} style={{width: 13, height: 13, borderRadius: '50%', background: c}} />
        ))}
      </div>
      <div
        style={{
          background: '#1c1c1e', borderRadius: '7px 7px 0 0',
          padding: '6px 18px', fontSize: 12, color: '#999',
          fontFamily: FONT_SANS, marginLeft: 8,
        }}
      >
        Styx — AI Gateway
      </div>
      <div
        style={{
          flex: 1, margin: '0 44px',
          background: '#141416', borderRadius: 8,
          padding: '5px 14px', fontSize: 13, color: '#777',
          fontFamily: FONT_MONO, textAlign: 'center', letterSpacing: 0.3,
        }}
      >
        {url}
      </div>
    </div>
    <div style={{width: '100%', height: BR.h - BR.ch, overflow: 'hidden', position: 'relative'}}>
      {children}
    </div>
  </div>
);

// ─── Mouse cursor SVG ───────────────────────────────────────────────────────
const Cursor: React.FC<{x: number; y: number; scale?: number; opacity?: number}> = ({
  x, y, scale = 1, opacity = 1,
}) => (
  <div
    style={{
      position: 'absolute', left: x, top: y,
      pointerEvents: 'none', zIndex: 300,
      transform: `scale(${scale})`, transformOrigin: '3px 3px',
      opacity,
      filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.5))',
    }}
  >
    <svg width="28" height="34" viewBox="0 0 28 34" fill="none">
      <path
        d="M4 2L25 13.5L15.5 16.5L12 30L4 2Z"
        fill="white" stroke="#1a1a1a" strokeWidth="2" strokeLinejoin="round"
      />
    </svg>
  </div>
);

// ─── Click ripple ───────────────────────────────────────────────────────────
const ClickRipple: React.FC<{x: number; y: number; frame: number; clickAt: number}> = ({
  x, y, frame, clickAt,
}) => {
  const t = frame - clickAt;
  if (t < 0 || t > 28) return null;
  const size = interpolate(t, [0, 28], [6, 58], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opacity = interpolate(t, [0, 28], [0.9, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2, top: y - size / 2,
        width: size, height: size,
        borderRadius: '50%',
        background: `rgba(20, 0, 255, ${opacity * 0.25})`,
        border: `2px solid rgba(20, 0, 255, ${opacity})`,
        pointerEvents: 'none', zIndex: 299,
      }}
    />
  );
};

// ─── Highlight ring helper ──────────────────────────────────────────────────
const HighlightRing: React.FC<{
  x: number; y: number; w: number; h: number;
  opacity: number; radius?: number;
}> = ({x, y, w, h, opacity, radius = 7}) => (
  <div
    style={{
      position: 'absolute',
      left: x, top: y, width: w, height: h,
      border: `2px solid rgba(20,0,255,${opacity})`,
      borderRadius: radius, zIndex: 250,
      pointerEvents: 'none',
    }}
  />
);

// ─── SCENE 1 — Title (200f = 3.33s) ─────────────────────────────────────────
const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const letters: {char: string; color: string}[] = [
    {char: 'S', color: WHITE}, {char: 'T', color: WHITE},
    {char: 'Y', color: WHITE}, {char: 'X', color: BLUE},
  ];
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex', gap: 12,
          fontFamily: FONT_SANS, fontWeight: 900, fontSize: 220, letterSpacing: -8, lineHeight: 1,
        }}
      >
        {letters.map(({char, color}, i) => {
          const s = i * 12;
          return (
            <span
              key={char}
              style={{
                color, display: 'inline-block',
                opacity: interpolate(frame, [s, s + 28], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
                transform: `translateY(${interpolate(frame, [s, s + 28], [60, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)`,
              }}
            >
              {char}
            </span>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 28, fontFamily: FONT_SANS, fontSize: 22, color: MUTED,
          letterSpacing: 6, textTransform: 'uppercase',
          opacity: interpolate(frame, [70, 100], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        The MCP-Native AI Gateway
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 2 — Tagline (180f = 3s) ──────────────────────────────────────────
const TaglineScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', padding: '0 120px',
      }}
    >
      <div style={{textAlign: 'center'}}>
        <div
          style={{
            fontFamily: FONT_SANS, fontWeight: 800, fontSize: 88, color: WHITE, lineHeight: 1.12,
            opacity: interpolate(frame, [0, 28], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
            transform: `translateY(${interpolate(frame, [0, 28], [40, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)`,
          }}
        >
          The AI gateway your
        </div>
        <div
          style={{
            fontFamily: FONT_SANS, fontWeight: 800, fontSize: 88, color: WHITE, lineHeight: 1.12,
            opacity: interpolate(frame, [18, 46], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
            transform: `translateY(${interpolate(frame, [18, 46], [40, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)`,
          }}
        >
          team <span style={{color: BLUE}}>actually owns.</span>
        </div>
      </div>
      <div
        style={{
          marginTop: 52, display: 'flex', gap: 16,
          opacity: interpolate(frame, [55, 85], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        {['Apache 2.0', 'Self-Hosted', 'Free Forever'].map((l) => (
          <span
            key={l}
            style={{
              padding: '10px 24px', border: `1px solid ${CARD_BORDER}`, borderRadius: 999,
              fontFamily: FONT_SANS, fontSize: 16, color: MUTED, letterSpacing: 2, textTransform: 'uppercase',
            }}
          >
            {l}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 3 — Browser: Landing (280f = 4.67s) ──────────────────────────────
// Aerial 3D descent (0-100f): browser lands from a tilted aerial view
// Push-in (140-222f): gentle zoom toward Dashboard → button
// Click at 222f
const CLICK_LAND = 222;
const LAND_TARGET = toVideo(1422, 52, 1920, 1080); // "Dashboard →" ~(1392, 141)

const BrowserLandingScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Phase 1: Aerial 3D descent — perspective rotateX 7°→0°, scale 1.1→1.0
  const descentP = interpolate(frame, [0, 100], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: eio,
  });
  const rotX = (1 - descentP) * 7;
  const descentScale = 1.1 - descentP * 0.1;

  // Phase 2: Push-in toward Dashboard button
  const pushIn = interpolate(frame, [140, CLICK_LAND], [1.0, 1.055], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: eio,
  });

  const totalScale = descentScale * pushIn;

  const browserOpacity = interpolate(frame, [0, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const curOpacity = interpolate(frame, [98, 120], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // Cursor: appears after descent, drifts from center, moves to Dashboard button
  const kf: CursorKF[] = [
    {f: 95,  x: 960, y: 520},
    {f: 125, x: 960, y: 520},
    {f: 200, x: LAND_TARGET.x, y: LAND_TARGET.y},
    {f: CLICK_LAND + 55, x: LAND_TARGET.x, y: LAND_TARGET.y},
  ];
  const cur = cursorAt(frame, kf);
  const curScale = frame >= CLICK_LAND && frame < CLICK_LAND + 10
    ? interpolate(frame, [CLICK_LAND, CLICK_LAND + 5, CLICK_LAND + 10], [1.0, 0.82, 1.0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 1.0;

  // Cinematic vignette fades out during descent
  const vignetteOpacity = interpolate(frame, [0, 80], [0.65, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: BG}}>
      {/* 3D perspective wrapper */}
      <div
        style={{
          position: 'absolute', inset: 0,
          transform: `perspective(1600px) rotateX(${rotX}deg) scale(${totalScale})`,
          transformOrigin: '960px 320px',
        }}
      >
        <div style={{opacity: browserOpacity}}>
          <BrowserFrame url="styxhq.com">
            <Img
              src={staticFile('landing_hero.png')}
              style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top'}}
            />
          </BrowserFrame>
        </div>

        {/* Highlight ring on Dashboard button */}
        {frame > 193 && frame < CLICK_LAND && (
          <HighlightRing
            x={LAND_TARGET.x - 34} y={LAND_TARGET.y - 18}
            w={116} h={36}
            opacity={interpolate(frame, [193, 210], [0, 0.7], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
            radius={8}
          />
        )}

        <Cursor x={cur.x} y={cur.y} scale={curScale} opacity={curOpacity} />
        <ClickRipple x={LAND_TARGET.x} y={LAND_TARGET.y} frame={frame} clickAt={CLICK_LAND} />
      </div>

      {/* Aerial vignette — dark edges that fade as the camera "lands" */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.75) 100%)',
          opacity: vignetteOpacity,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

// ─── SCENE 4 — Browser: Dashboard (290f = 4.83s) ────────────────────────────
// DRONE EFFECT (0-170f): scale 1.45→1.0, origin tracks from sidebar top → screen center
// This creates a cinematic pull-back as if a drone was hovering over the sidebar and zooming out
// Cursor (170-248f): moves from content area to Models sidebar link
// Click at 248f
const CLICK_DASH = 248;
const DASH_TARGET = toVideo(132, 440, 1920, 1080); // sidebar "Models" ~(184, 505)
const DRONE_DURATION = 170;

const BrowserDashboardScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Drone pull-back animation
  const droneP = interpolate(frame, [0, DRONE_DURATION], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: eio,
  });
  const droneScale = 1.45 - droneP * 0.45;                    // 1.45 → 1.0
  const droneOriginX = 184 + (960 - 184) * droneP;            // sidebar x → center x
  const droneOriginY = 210 + (590 - 210) * droneP;            // sidebar top → below center (pan down)

  // After drone, gentle push-in toward the Models link
  const pushIn = interpolate(frame, [188, CLICK_DASH], [1.0, 1.04], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: eio,
  });

  // Blend transforms: during drone use drone origin, after use center
  const activeOriginX = frame < DRONE_DURATION ? droneOriginX : 960;
  const activeOriginY = frame < DRONE_DURATION ? droneOriginY : 540;
  const activeScale = droneScale * (frame >= 188 ? pushIn : 1.0);

  const browserOpacity = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const curOpacity = interpolate(frame, [DRONE_DURATION - 8, DRONE_DURATION + 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // Cursor: appears as drone completes, sweeps to sidebar
  const kf: CursorKF[] = [
    {f: DRONE_DURATION,      x: 860, y: 410},
    {f: DRONE_DURATION + 28, x: 860, y: 410},
    {f: 222,                 x: DASH_TARGET.x, y: DASH_TARGET.y},
    {f: CLICK_DASH + 38,     x: DASH_TARGET.x, y: DASH_TARGET.y},
  ];
  const cur = cursorAt(frame, kf);
  const curScale = frame >= CLICK_DASH && frame < CLICK_DASH + 10
    ? interpolate(frame, [CLICK_DASH, CLICK_DASH + 5, CLICK_DASH + 10], [1.0, 0.82, 1.0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 1.0;

  return (
    <AbsoluteFill style={{backgroundColor: BG}}>
      <div
        style={{
          position: 'absolute', inset: 0,
          transform: `scale(${activeScale})`,
          transformOrigin: `${activeOriginX}px ${activeOriginY}px`,
        }}
      >
        <div style={{opacity: browserOpacity}}>
          <BrowserFrame url="styxhq.com/overview">
            <Img
              src={staticFile('dashboard.png')}
              style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top'}}
            />
          </BrowserFrame>
        </div>

        {frame > 216 && frame < CLICK_DASH && (
          <HighlightRing
            x={DASH_TARGET.x - 4} y={DASH_TARGET.y - 14}
            w={162} h={30}
            opacity={interpolate(frame, [216, 234], [0, 0.65], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
          />
        )}

        <Cursor x={cur.x} y={cur.y} scale={curScale} opacity={curOpacity} />
        <ClickRipple x={DASH_TARGET.x} y={DASH_TARGET.y} frame={frame} clickAt={CLICK_DASH} />
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 5 — Browser: Models (210f = 3.5s) ────────────────────────────────
// Cursor scans model rows top-to-bottom, then sweeps to Projects sidebar link
const CLICK_MODELS = 170;
const MODELS_TARGET = toVideo(132, 146, 1920, 1080); // sidebar "Projects" ~(184, 229)

// Estimated model row positions in video space (models.png 1920×1080, scale 0.9375)
const MODEL_ROW1 = toVideo(700, 255, 1920, 1080);
const MODEL_ROW2 = toVideo(700, 365, 1920, 1080);
const MODEL_ROW3 = toVideo(700, 478, 1920, 1080);

const BrowserModelsScene: React.FC = () => {
  const frame = useCurrentFrame();

  const browserOpacity = interpolate(frame, [0, 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const curOpacity = interpolate(frame, [10, 26], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // Cursor: scans 3 model rows then sweeps left+up to Projects sidebar
  const kf: CursorKF[] = [
    {f: 8,   x: MODEL_ROW1.x, y: MODEL_ROW1.y},
    {f: 48,  x: MODEL_ROW2.x, y: MODEL_ROW2.y},
    {f: 88,  x: MODEL_ROW3.x, y: MODEL_ROW3.y},
    {f: 110, x: MODEL_ROW3.x, y: MODEL_ROW3.y},  // brief hover
    {f: 162, x: MODELS_TARGET.x, y: MODELS_TARGET.y},
    {f: CLICK_MODELS + 35, x: MODELS_TARGET.x, y: MODELS_TARGET.y},
  ];
  const cur = cursorAt(frame, kf);
  const curScale = frame >= CLICK_MODELS && frame < CLICK_MODELS + 10
    ? interpolate(frame, [CLICK_MODELS, CLICK_MODELS + 5, CLICK_MODELS + 10], [1.0, 0.82, 1.0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 1.0;

  // Gentle content-zoom during row scan (1.0 → 1.025 → back to 1.02)
  const scanZoom = interpolate(frame, [0, 100, 162], [1.0, 1.025, 1.025], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: BG}}>
      <div
        style={{
          position: 'absolute', inset: 0,
          transform: `scale(${scanZoom})`,
          transformOrigin: `${MODEL_ROW2.x}px ${MODEL_ROW2.y}px`,
        }}
      >
        <div style={{opacity: browserOpacity}}>
          <BrowserFrame url="styxhq.com/models">
            <Img
              src={staticFile('models.png')}
              style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top'}}
            />
          </BrowserFrame>
        </div>

        {frame > 156 && frame < CLICK_MODELS && (
          <HighlightRing
            x={MODELS_TARGET.x - 4} y={MODELS_TARGET.y - 14}
            w={142} h={28}
            opacity={interpolate(frame, [156, 168], [0, 0.65], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
          />
        )}

        <Cursor x={cur.x} y={cur.y} scale={curScale} opacity={curOpacity} />
        <ClickRipple x={MODELS_TARGET.x} y={MODELS_TARGET.y} frame={frame} clickAt={CLICK_MODELS} />
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 6 — Browser: Projects (190f = 3.17s) ──────────────────────────────
// Mini drone pull-back from project card → full view, then cursor explores the card
const PROJ_CARD = toVideo(707, 384, 1920, 1080); // "Default Project" card ~(723, 452)

const BrowserProjectsScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Mini drone: zoomed on project card → full view
  const droneP = interpolate(frame, [0, 95], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: eio,
  });
  const droneScale = 1.18 - droneP * 0.18;              // 1.18 → 1.0
  const droneOriginX = PROJ_CARD.x + (960 - PROJ_CARD.x) * droneP;
  const droneOriginY = PROJ_CARD.y + (540 - PROJ_CARD.y) * droneP;

  const browserOpacity = interpolate(frame, [0, 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const curOpacity = interpolate(frame, [80, 100], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // Cursor: appears after drone, hovers over project card with a micro-drift
  const kf: CursorKF[] = [
    {f: 75,  x: PROJ_CARD.x + 90, y: PROJ_CARD.y - 50},
    {f: 120, x: PROJ_CARD.x,      y: PROJ_CARD.y},
    {f: 155, x: PROJ_CARD.x + 20, y: PROJ_CARD.y - 14},
    {f: 185, x: PROJ_CARD.x,      y: PROJ_CARD.y},
  ];
  const cur = cursorAt(frame, kf);

  return (
    <AbsoluteFill style={{backgroundColor: BG}}>
      <div
        style={{
          position: 'absolute', inset: 0,
          transform: `scale(${droneScale})`,
          transformOrigin: `${droneOriginX}px ${droneOriginY}px`,
        }}
      >
        <div style={{opacity: browserOpacity}}>
          <BrowserFrame url="styxhq.com/projects">
            <Img
              src={staticFile('projects.png')}
              style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top'}}
            />
          </BrowserFrame>
        </div>
        <Cursor x={cur.x} y={cur.y} opacity={curOpacity} />
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 7 — Stats (180f = 3s) ────────────────────────────────────────────
const StatsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const stats = [
    {number: '65+', label: 'Models', delay: 20},
    {number: '4',   label: 'Providers', delay: 38},
    {number: '1',   label: 'Endpoint', delay: 56},
  ];
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 56,
      }}
    >
      <div
        style={{
          fontFamily: FONT_SANS, fontSize: 22, color: MUTED,
          letterSpacing: 5, textTransform: 'uppercase',
          opacity: interpolate(frame, [0, 28], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        One interface to rule them all
      </div>
      <div style={{display: 'flex', gap: 96, alignItems: 'center'}}>
        {stats.map(({number, label, delay}, i) => (
          <React.Fragment key={label}>
            <div
              style={{
                textAlign: 'center',
                opacity: interpolate(frame, [delay, delay + 28], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
                transform: `translateY(${interpolate(frame, [delay, delay + 28], [35, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: FONT_SANS, fontWeight: 900, fontSize: 128, color: WHITE,
                  lineHeight: 1, letterSpacing: -5,
                }}
              >
                {number}
              </div>
              <div
                style={{
                  fontFamily: FONT_SANS, fontSize: 20, color: MUTED,
                  letterSpacing: 4, textTransform: 'uppercase', marginTop: 10,
                }}
              >
                {label}
              </div>
            </div>
            {i < stats.length - 1 && (
              <div
                style={{
                  fontFamily: FONT_SANS, fontSize: 80, color: '#2a2a2a',
                  fontWeight: 100, lineHeight: 1,
                  opacity: interpolate(frame, [delay + 28, delay + 48], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
                }}
              >
                ·
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      <div
        style={{
          fontFamily: FONT_SANS, fontSize: 22, color: '#444', letterSpacing: 3,
          opacity: interpolate(frame, [100, 130], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        OpenAI · Anthropic · Google · Mistral
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 8 — Terminal: styx:auto typing (210f = 3.5s) ─────────────────────
const TerminalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const CODE =
    `client = OpenAI(\n` +
    `  base_url="http://localhost:8080/v1",\n` +
    `  api_key="sk-any-string"\n` +
    `)\n\n` +
    `response = client.chat.completions.create(\n` +
    `  model="styx:auto",  # intelligent routing\n` +
    `  messages=[{"role":"user","content":"..."}]\n` +
    `)`;

  const START = 25;
  const SPEED = 1.3;
  const chars = Math.min(CODE.length, Math.floor(Math.max(0, frame - START) * SPEED));
  const visible = CODE.slice(0, chars);
  const cursorOn = Math.floor(frame / 18) % 2 === 0;
  const TARGET = '"styx:auto"';
  const hitIdx = visible.indexOf(TARGET);

  const renderCode = (): React.ReactNode => {
    const cur = cursorOn ? <span style={{color: BLUE}}>▌</span> : null;
    if (hitIdx === -1) return <>{visible}{cur}</>;
    return (
      <>
        {visible.slice(0, hitIdx)}
        <span style={{color: BLUE, fontWeight: 700, textShadow: `0 0 22px ${BLUE}55`}}>{TARGET}</span>
        {visible.slice(hitIdx + TARGET.length)}
        {cur}
      </>
    );
  };

  const pillOpacity = hitIdx !== -1
    ? interpolate(
        frame,
        [hitIdx / SPEED + START + 8, hitIdx / SPEED + START + 32],
        [0, 1],
        {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
      )
    : 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', padding: '0 120px', gap: 32,
      }}
    >
      <div
        style={{
          fontFamily: FONT_SANS, fontSize: 20, color: MUTED, letterSpacing: 5, textTransform: 'uppercase',
          opacity: interpolate(frame, [0, 25], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        Intelligent Auto-Routing
      </div>
      <div
        style={{
          background: CARD_BG, border: `1px solid ${CARD_BORDER}`,
          borderRadius: 14, padding: '28px 36px', width: '100%', maxWidth: 920,
          opacity: interpolate(frame, [5, 28], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        <div style={{display: 'flex', gap: 8, marginBottom: 22}}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <div key={c} style={{width: 12, height: 12, borderRadius: '50%', background: c}} />
          ))}
        </div>
        <pre
          style={{
            fontFamily: FONT_MONO, fontSize: 21, lineHeight: 1.75, color: '#ccc',
            margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {renderCode()}
        </pre>
      </div>
      <div style={{display: 'flex', gap: 14, opacity: pillOpacity}}>
        {['styx:fast', 'styx:balanced', 'styx:frontier'].map((m) => (
          <span
            key={m}
            style={{
              padding: '7px 18px', background: '#0d0d1f',
              border: '1px solid #1e1e3a', borderRadius: 999,
              fontFamily: FONT_MONO, fontSize: 15, color: '#7777ee',
            }}
          >
            {m}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 9 — 3 Commands (180f = 3s) ───────────────────────────────────────
const CommandsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const cmds = [
    'git clone https://github.com/timmx7/styx && cd styx',
    './setup.sh',
    'docker compose up -d --build',
  ];
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', padding: '0 120px', gap: 40,
      }}
    >
      <div
        style={{
          textAlign: 'center',
          opacity: interpolate(frame, [0, 28], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          transform: `translateY(${interpolate(frame, [0, 28], [24, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)`,
        }}
      >
        <div style={{fontFamily: FONT_SANS, fontWeight: 800, fontSize: 68, color: WHITE, lineHeight: 1.1}}>
          Self-hosted in <span style={{color: BLUE}}>3 commands.</span>
        </div>
        <div style={{fontFamily: FONT_SANS, fontSize: 22, color: MUTED, marginTop: 12}}>
          Docker Compose · Your server · Your data
        </div>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 18, width: '100%', maxWidth: 920}}>
        {cmds.map((cmd, i) => {
          const d = 35 + i * 22;
          return (
            <div
              key={i}
              style={{
                opacity: interpolate(frame, [d, d + 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
                transform: `translateX(${interpolate(frame, [d, d + 24], [-28, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)`,
                display: 'flex', alignItems: 'center',
                background: CARD_BG, border: `1px solid ${CARD_BORDER}`,
                borderRadius: 12, padding: '16px 28px', gap: 16,
              }}
            >
              <span style={{fontFamily: FONT_MONO, fontSize: 20, color: BLUE, fontWeight: 700}}>$</span>
              <span style={{fontFamily: FONT_MONO, fontSize: 20, color: '#ccc'}}>{cmd}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 10 — Final (150f = 2.5s) ─────────────────────────────────────────
const FinalScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 28,
      }}
    >
      <div
        style={{
          fontFamily: FONT_SANS, fontWeight: 900, fontSize: 168,
          letterSpacing: -6, lineHeight: 1,
          opacity: interpolate(frame, [0, 32], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          transform: `translateY(${interpolate(frame, [0, 32], [24, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)`,
        }}
      >
        <span style={{color: WHITE}}>STY</span><span style={{color: BLUE}}>X</span>
      </div>
      <div
        style={{
          fontFamily: FONT_MONO, fontSize: 26, color: MUTED, letterSpacing: 1,
          opacity: interpolate(frame, [25, 55], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        github.com/timmx7/styx
      </div>
      <div
        style={{
          display: 'flex', gap: 18,
          opacity: interpolate(frame, [50, 80], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        {['Open Source', 'Apache 2.0', 'Self-Hosted'].map((l) => (
          <span
            key={l}
            style={{
              padding: '9px 26px', border: `1px solid ${CARD_BORDER}`,
              borderRadius: 999, fontFamily: FONT_SANS, fontSize: 15, color: MUTED,
              letterSpacing: 2, textTransform: 'uppercase',
            }}
          >
            {l}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ─── Main composition ────────────────────────────────────────────────────────
// Timing:
//   Scenes:      200+180+280+290+210+190+180+210+180+150 = 2070
//   Transitions: 9 × 30 = 270
//   Net total:   2070 - 270 = 1800 frames = 30s @ 60fps ✓
//
// Transition language:
//   fade   → conceptual/design scenes (slow spring for drama)
//   slide  → browser navigation scenes (feels like real browser forward navigation)
export const StyxPromo: React.FC = () => {
  const Tfade  = springTiming({config: {damping: 22}, durationInFrames: 30});
  const Tslide = springTiming({config: {damping: 30, stiffness: 220}, durationInFrames: 30});

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={200}><TitleScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tfade} presentation={fade()} />

      <TransitionSeries.Sequence durationInFrames={180}><TaglineScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tfade} presentation={fade()} />

      <TransitionSeries.Sequence durationInFrames={280}><BrowserLandingScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tslide} presentation={slide({direction: 'from-right'})} />

      <TransitionSeries.Sequence durationInFrames={290}><BrowserDashboardScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tslide} presentation={slide({direction: 'from-right'})} />

      <TransitionSeries.Sequence durationInFrames={210}><BrowserModelsScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tslide} presentation={slide({direction: 'from-right'})} />

      <TransitionSeries.Sequence durationInFrames={190}><BrowserProjectsScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tfade} presentation={fade()} />

      <TransitionSeries.Sequence durationInFrames={180}><StatsScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tfade} presentation={fade()} />

      <TransitionSeries.Sequence durationInFrames={210}><TerminalScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tfade} presentation={fade()} />

      <TransitionSeries.Sequence durationInFrames={180}><CommandsScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition timing={Tfade} presentation={fade()} />

      <TransitionSeries.Sequence durationInFrames={150}><FinalScene /></TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
