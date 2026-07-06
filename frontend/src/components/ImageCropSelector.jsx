import { useEffect, useRef, useState } from "react";

/**
 * ImageCropSelector — click-and-drag a rectangle over the image to pick a
 * crop region. Reports back in the image's natural pixel coordinates via
 * onChange({ x1, y1, x2, y2 }), matching what /crop expects directly.
 */
export default function ImageCropSelector({ file, color = "#5a4bff", onChange }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [natural, setNatural] = useState(null); // { w, h }
  const [displaySize, setDisplaySize] = useState(null); // { w, h } as rendered
  const [box, setBox] = useState(null); // { x, y, w, h } in displayed px
  const dragStart = useRef(null);
  const wrapRef = useRef();
  const imgRef = useRef();

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const emit = (b, disp, nat) => {
    if (!onChange || !disp || !nat) return;
    const scaleX = nat.w / disp.w;
    const scaleY = nat.h / disp.h;
    onChange({
      x1: Math.round(b.x * scaleX),
      y1: Math.round(b.y * scaleY),
      x2: Math.round((b.x + b.w) * scaleX),
      y2: Math.round((b.y + b.h) * scaleY),
    });
  };

  const handleImgLoad = (e) => {
    const nat = { w: e.target.naturalWidth, h: e.target.naturalHeight };
    const disp = { w: e.target.clientWidth, h: e.target.clientHeight };
    setNatural(nat);
    setDisplaySize(disp);
    const full = { x: 0, y: 0, w: disp.w, h: disp.h };
    setBox(full);
    emit(full, disp, nat);
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const getRelPos = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: clamp(e.clientX - rect.left, 0, rect.width),
      y: clamp(e.clientY - rect.top, 0, rect.height),
    };
  };

  const handleMouseDown = (e) => {
    const pos = getRelPos(e);
    dragStart.current = pos;
    setBox({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const handleMouseMove = (e) => {
    if (!dragStart.current) return;
    const pos = getRelPos(e);
    const x = Math.min(dragStart.current.x, pos.x);
    const y = Math.min(dragStart.current.y, pos.y);
    const w = Math.abs(pos.x - dragStart.current.x);
    const h = Math.abs(pos.y - dragStart.current.y);
    setBox({ x, y, w, h });
  };

  const handleMouseUp = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    setBox((b) => {
      const finalBox = b && b.w > 4 && b.h > 4 ? b : { x: 0, y: 0, w: displaySize.w, h: displaySize.h };
      emit(finalBox, displaySize, natural);
      return finalBox;
    });
  };

  if (!imgUrl) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Loading preview…</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
        Click and drag on the image to select the area you want to keep.
      </div>
      <div
        ref={wrapRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          display: "inline-block",
          maxWidth: "100%",
          cursor: "crosshair",
          userSelect: "none",
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <img
          ref={imgRef}
          src={imgUrl}
          alt="Crop preview"
          draggable={false}
          onLoad={handleImgLoad}
          style={{ display: "block", maxWidth: "100%", maxHeight: 420, pointerEvents: "none" }}
        />
        {box && (
          <div
            style={{
              position: "absolute",
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              border: `2px solid ${color}`,
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)`,
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}
