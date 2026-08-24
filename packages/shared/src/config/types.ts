export type CarId = "rectangle" | "oval" | "hexagon";
export interface CarDef {
  id: CarId;
  name: string;
  speed: number;
  strength: number;
  hp: number;
}
export interface ColorDef {
  colorId: number;
  name: string;
  hex: string;
}
