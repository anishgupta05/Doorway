import type { Scene } from "@doorway/schema";
import { useApp } from "../store";
import { ObjectBody } from "./objects";
import { Placed } from "./Placed";
import { Room } from "./Room";

/** Objects are keyed by id, so switching iterations morphs the same objects instead of remounting them. */
export function SceneView({ scene, cutaway }: { scene: Scene; cutaway: boolean }) {
  // During the build-in intro only the first N objects exist yet.
  const count = useApp((s) => s.buildCount);
  const objects = count === null ? scene.objects : scene.objects.slice(0, count);
  return (
    <group>
      <Room room={scene.room} cutaway={cutaway} />
      {objects.map((o) => (
        <Placed key={o.id} obj={o}>
          <ObjectBody obj={o} />
        </Placed>
      ))}
    </group>
  );
}
