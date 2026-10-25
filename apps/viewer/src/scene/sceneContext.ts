import { createContext, useContext } from "react";
import type { Scene } from "@doorway/schema";

/** The scene being shown, for parts that need to know about their neighbours (e.g. door swings). */
export const SceneCtx = createContext<Scene | null>(null);
export const useSceneCtx = () => useContext(SceneCtx);
