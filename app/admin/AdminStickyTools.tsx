"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const StickyToolsTargetContext =
  createContext<RefObject<HTMLDivElement | null> | null>(null);

export function AdminStickyToolsProvider({
  targetRef,
  children,
}: {
  targetRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <StickyToolsTargetContext.Provider value={targetRef}>
      {children}
    </StickyToolsTargetContext.Provider>
  );
}

/** Renders children inside the sticky admin header (below title/nav). */
export function AdminStickyTools({ children }: { children: ReactNode }) {
  const targetRef = useContext(StickyToolsTargetContext);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    setTarget(targetRef?.current ?? null);
  }, [targetRef]);

  if (!target) return null;
  return createPortal(children, target);
}
