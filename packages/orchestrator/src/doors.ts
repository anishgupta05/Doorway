// Every doorway gets a real door. Argon reliably sees door *openings* but sometimes
// leaves out the door itself, and a room whose door can't open is no use to a robot
// (or to the demo). This adds a hinged door to any door opening without one.
import type { Opening, Scene, SceneObject } from "@doorway/schema";
import { interactionTests } from "./interaction-tests.js";

const THICK = 0.045;

function doorPose(room: Scene["room"], o: Opening): { position: [number, number, number]; rotationY: number } {
  // The slab sits in the wall plane, front facing out, hinged on its local left so it swings into the room.
  const out = THICK / 2 + 0.008;
  switch (o.wall) {
    case "south": return { position: [o.offset, 0, room.depth / 2 + out], rotationY: 0 };
    case "north": return { position: [o.offset, 0, -room.depth / 2 - out], rotationY: Math.PI };
    case "east": return { position: [room.width / 2 + out, 0, o.offset], rotationY: Math.PI / 2 };
    case "west": return { position: [-room.width / 2 - out, 0, o.offset], rotationY: -Math.PI / 2 };
  }
}

export function ensureDoors(scene: Scene): { scene: Scene; added: string[] } {
  const out = structuredClone(scene);
  const added: string[] = [];
  const doors = () => out.objects.filter((o) => o.type === "door");
  for (const o of out.room.openings.filter((x) => x.kind === "door")) {
    const pose = doorPose(out.room, o);
    const near = doors().some((d) => Math.hypot(d.position[0] - pose.position[0], d.position[2] - pose.position[2]) < Math.max(0.5, o.width / 2));
    if (near) continue;
    let n = doors().length + 1;
    while (out.objects.some((x) => x.id === `door_${n}`)) n++;
    const door: SceneObject = {
      id: `door_${n}`,
      type: "door",
      label: "Door",
      position: pose.position,
      rotationY: pose.rotationY,
      size: [Math.max(0.5, o.width - 0.02), Math.max(1.5, o.height - 0.01), THICK],
      color: "#d9d4ca",
      material: "paint",
      articulation: { kind: "hinge", axis: [0, 1, 0], pivot: [-(Math.max(0.5, o.width - 0.02)) / 2, 0, 0], range: [0, 1.6] },
      physics: { body: "kinematic", mass: 15, friction: 0.5, collider: "box", damping: 2 },
      decor: false,
    };
    out.objects.push(door);
    // Swing into the room if that's clear; otherwise outward (phone booths, tight rooms).
    const swing = () => interactionTests(out).find((t) => t.id === door.id);
    if (!swing()?.ok && door.articulation?.kind === "hinge") door.articulation.range = [0, -1.6];
    out.interactions.push({ verb: "open", target: door.id });
    added.push(door.id);
  }
  return { scene: out, added };
}
