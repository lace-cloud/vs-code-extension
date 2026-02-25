import React, { useState, useEffect, useRef } from 'react';

type SlidePanelProps = {
  open: boolean;
  zIndex?: number;
  children: React.ReactNode;
};

export default function SlidePanel({ open, zIndex = 20, children }: SlidePanelProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timeoutRef.current);
    if (open) {
      setMounted(true);
      // Delay one frame so the browser paints the off-screen state first
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timeoutRef.current = setTimeout(() => setMounted(false), 200);
    }
    return () => clearTimeout(timeoutRef.current);
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      className="slide-panel"
      style={{ zIndex, transform: visible ? 'translateX(0)' : 'translateX(100%)' }}
    >
      {children}
    </div>
  );
}
