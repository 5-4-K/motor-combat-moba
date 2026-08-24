export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Spawn {
  x: number;
  y: number;
  angle: number;
}

export interface ArenaDef {
  id: string;
  width: number;
  height: number;
  obstacles: readonly Obstacle[];
  ffaSpawns: readonly Spawn[];
  teamASpawns: readonly Spawn[];
  teamBSpawns: readonly Spawn[];
}
