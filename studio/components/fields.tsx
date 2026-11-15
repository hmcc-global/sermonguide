"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

type AutoTextareaProps = {
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * A textarea that grows to fit what's in it.
 *
 * Reviewing a generated draft means reading a 400-word recap and four sets of
 * questions through an 88px window, scrolling each field independently. Sizing
 * to content means the whole draft is visible at once.
 *
 * CSS min-height still sets the floor and max-height still sets the ceiling —
 * an inline height sits between them, so a long transcript scrolls internally
 * rather than growing without limit. `field-sizing: content` would do this
 * natively but is not in Firefox yet, and mixing the two would double up.
 */
export function AutoTextarea({
  value,
  onValueChange,
  className,
  placeholder,
  disabled,
}: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first, or scrollHeight only ever reports the current height.
    el.style.height = "auto";
    // scrollHeight covers content + padding but not borders, while box-sizing
    // is border-box, so height must include them. Skipping this clips the last
    // couple of pixels of text in every field.
    const cs = getComputedStyle(el);
    const borders =
      parseFloat(cs.borderTopWidth || "0") + parseFloat(cs.borderBottomWidth || "0");
    el.style.height = `${el.scrollHeight + borders}px`;
  }, []);

  // Layout effect so the field is already the right size on first paint —
  // useEffect would show the collapsed height for a frame.
  useLayoutEffect(resize, [value, resize]);

  // Wrapping changes with the width, so a rotation or resize changes the height.
  useEffect(() => {
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    />
  );
}
