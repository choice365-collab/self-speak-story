import { useEffect, useRef, useState } from "react";

type SilenceTimerProps = {
  active: boolean;
  durationMs?: number;
  onTimeout?: () => void;
};

export default function SilenceTimer({ active, durationMs = 3000, onTimeout }: SilenceTimerProps) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef(0);
  const calledRef = useRef(false);

  useEffect(() => {
    if (!active) {
      setProgress(0);
      cancelAnimationFrame(rafRef.current);
      calledRef.current = false;
      return;
    }

    startRef.current = performance.now();
    calledRef.current = false;

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const p = Math.min(elapsed / durationMs, 1);
      setProgress(p);

      if (p >= 1 && !calledRef.current) {
        calledRef.current = true;
        onTimeout?.();
        return;
      }

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [active, durationMs, onTimeout]);

  if (!active) return null;

  const size = 56;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="flex flex-col items-center gap-1.5 animate-fade-in">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-none"
        />
      </svg>
      <span className="text-[11px] font-semibold text-muted-foreground">Listening…</span>
    </div>
  );
}
