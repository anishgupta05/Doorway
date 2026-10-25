// Real robots' sizes and reach, so a job can fail where that robot really would.
// radius: half the base's width (the planner treats the base as a disc this big).
// reach: lowest and highest a handle can be for the robot to open it, metres from the floor.
export type RobotProfile = { id: string; name: string; radius: number; height: number; reach: [number, number] };

export const PROFILES: RobotProfile[] = [
  { id: "delivery", name: "Small delivery bot", radius: 0.17, height: 1.2, reach: [0.25, 1.1] },
  { id: "stretch", name: "Hello Robot Stretch", radius: 0.17, height: 1.41, reach: [0.05, 1.5] },
  { id: "fetch", name: "Fetch", radius: 0.28, height: 1.1, reach: [0.3, 1.4] },
  { id: "quadruped", name: "Quadruped with arm", radius: 0.38, height: 0.7, reach: [0.2, 0.85] },
];

export const profileById = (id: string) => PROFILES.find((p) => p.id === id) ?? PROFILES[0];
