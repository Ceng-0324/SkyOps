import { useRef } from "react";

export function WorkspaceResizer({ label, controls, value, minimum, maximum, defaultValue, direction, onChange }: {
  label: string; controls: string; value: number; minimum: number; maximum: number;
  defaultValue: number; direction: 1 | -1; onChange: (width: number) => void;
}) {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const clamp = (width: number) => Math.min(maximum, Math.max(minimum, width));
  return <div className={`ws-resizer ${direction === 1 ? "ws-resizer-right" : "ws-resizer-left"}`} role="separator" tabIndex={0}
    aria-label={label} aria-controls={controls} aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={value}
    title="拖拽调整宽度；双击恢复默认，方向键微调"
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); drag.current = { id: e.pointerId, x: e.clientX, width: value }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (drag.current?.id === e.pointerId) onChange(clamp(drag.current.width + (e.clientX - drag.current.x) * direction)); }}
    onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => onChange(clamp(defaultValue))}
    onKeyDown={e => {
      const next: Record<string, number> = { ArrowRight: value + 24 * direction, ArrowLeft: value - 24 * direction, Home: minimum, End: maximum };
      if (e.key in next) { e.preventDefault(); onChange(clamp(next[e.key])); }
    }} />;
}
