import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

type FlutedLiquidProps = {
  /** Three liquid colors, laid as soft moving pools. */
  colors?: [string, string, string];
  /** Surface behind the liquid. */
  background?: string;
  /** Number of vertical glass flutes across the width. */
  flutes?: number;
  /** How far each flute bends the picture behind it (0 to 1.5). */
  refraction?: number;
  className?: string;
};

const SUBSTRIPS = 10;
const DEFAULT_COLORS: [string, string, string] = ["#ff5018", "#c4b8ff", "#ffc6d4"];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Colored liquid seen through fluted glass: soft pools drift on a hidden canvas and each
// vertical flute re-draws a magnified, shifted slice of them, then adds a specular edge.
// Decorative only: aria-hidden, ignores pointer events, honours reduced motion.
export function FlutedLiquid({
  colors = DEFAULT_COLORS,
  background = "#ece8fd",
  flutes = 26,
  refraction = 0.9,
  className,
}: FlutedLiquidProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext("2d"); } catch { ctx = null; }
    if (!ctx) return;
    const out = ctx;
    const src = document.createElement("canvas");
    const sctx = src.getContext("2d");
    if (!sctx) return;

    let width = 0, height = 0, dpr = 1, frame = 0, running = true;
    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: false };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      src.width = Math.max(1, Math.round(width / 2));
      src.height = Math.max(1, Math.round(height / 2));
      draw(performance.now() / 1000);
    };

    const paintLiquid = (t: number) => {
      const w = src.width, h = src.height, s = Math.min(w, h);
      sctx.globalCompositeOperation = "source-over";
      sctx.fillStyle = background;
      sctx.fillRect(0, 0, w, h);
      const pools = [
        { c: colors[0], fx: 0.21, fy: 0.17, px: 0.0, py: 1.3, r: 0.46, a: 0.95 },
        { c: colors[1], fx: 0.15, fy: 0.23, px: 2.1, py: 0.4, r: 0.52, a: 0.95 },
        { c: colors[2], fx: 0.19, fy: 0.13, px: 4.0, py: 2.6, r: 0.48, a: 0.9 },
        { c: colors[0], fx: 0.11, fy: 0.27, px: 5.3, py: 3.5, r: 0.3, a: 0.7 },
      ];
      for (const p of pools) {
        const x = w * (0.5 + 0.42 * Math.sin(t * p.fx * 2 + p.px));
        const y = h * (0.5 + 0.4 * Math.cos(t * p.fy * 2 + p.py));
        const r = s * p.r;
        const g = sctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, p.c);
        g.addColorStop(1, p.c + "00");
        sctx.globalAlpha = p.a;
        sctx.fillStyle = g;
        sctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      if (pointer.active) {
        const x = pointer.x * w, y = pointer.y * h, r = s * 0.34;
        const g = sctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, colors[0]);
        g.addColorStop(1, colors[0] + "00");
        sctx.globalAlpha = 0.85;
        sctx.fillStyle = g;
        sctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      sctx.globalAlpha = 1;
    };

    const draw = (t: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      paintLiquid(t);
      const fw = width / flutes;
      const ratio = src.width / width;
      out.clearRect(0, 0, width, height);
      for (let i = 0; i < flutes; i++) {
        const wave = Math.sin(t * 0.5 + i * 0.55) * 0.5 * refraction;
        for (let k = 0; k < SUBSTRIPS; k++) {
          const u = (k + 0.5) / SUBSTRIPS;
          // Each flute acts like a cylinder lens: it shows a narrow, stretched slice of the pool behind it.
          const centre = (i + 0.5 + wave * (u - 0.5)) * fw;
          const sx = (centre + (u - 0.5) * fw * 0.3) * ratio;
          const sw = Math.max(1, (fw * 0.3 / SUBSTRIPS) * ratio);
          out.drawImage(src, clamp(sx, 0, src.width - sw), 0, sw, src.height, i * fw + k * (fw / SUBSTRIPS), 0, fw / SUBSTRIPS + 0.6, height);
        }
      }
      // Glass shading per flute: bright edge, soft body, darker trailing edge.
      const shade = out.createLinearGradient(0, 0, fw, 0);
      shade.addColorStop(0, "rgba(255,255,255,0.34)");
      shade.addColorStop(0.1, "rgba(255,255,255,0.08)");
      shade.addColorStop(0.55, "rgba(255,255,255,0)");
      shade.addColorStop(0.92, "rgba(56,29,42,0.10)");
      shade.addColorStop(1, "rgba(56,29,42,0.16)");
      out.fillStyle = shade;
      for (let i = 0; i < flutes; i++) {
        out.save();
        out.translate(i * fw, 0);
        out.fillRect(0, 0, fw, height);
        out.restore();
      }
      out.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < flutes; i++) out.fillRect(i * fw + fw * 0.13, 0, Math.max(1, dpr), height);
    };

    const loop = (now: number) => {
      if (!running) return;
      if (!document.hidden) draw(now / 1000);
      frame = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.tx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      pointer.ty = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      if (!pointer.active) { pointer.x = pointer.tx; pointer.y = pointer.ty; pointer.active = true; }
    };

    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    if (!reduceMotion) {
      window.addEventListener("pointermove", onMove, { passive: true });
      frame = requestAnimationFrame(loop);
    }
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [colors, background, flutes, refraction, reduceMotion]);

  return <canvas ref={canvasRef} aria-hidden="true" data-testid="login-liquid" className={className} />;
}
