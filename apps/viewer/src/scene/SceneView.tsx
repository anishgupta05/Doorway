import { useEffect, useMemo } from "react";
import type { Scene } from "@doorway/schema";
import { useApp } from "../store";
import { SceneCtx } from "./sceneContext";
import { ObjectBody } from "./objects";
import { Placed } from "./Placed";
import { Room } from "./Room";
import { wallOf } from "./wallOf";

/** Objects are keyed by id, so switching iterations morphs the same objects instead of remounting them. */
export function SceneView({ scene, cutaway }: { scene: Scene; cutaway: boolean }) {
  // During the build-in intro only the first N objects exist yet.
  const count = useApp((s) => s.buildCount);
  useEffect(() => {
    useApp.setState({ lampIds: scene.objects.filter((o) => o.articulation?.kind === "switch").map((o) => o.id) });
  }, [scene]);
  const walls = useMemo(() => wallOf(scene), [scene]);
  const objects = count === null ? scene.objects : scene.objects.slice(0, count);
  return (
    <SceneCtx.Provider value={scene}>
    <group>
      <Room room={scene.room} cutaway={cutaway} />
      {objects.map((o) => (
        <Placed key={o.id} obj={o} wall={walls.get(o.id)}>
          <ObjectBody obj={o} />
        </Placed>
      ))}
    </group>
    </SceneCtx.Provider>
  );
}
