import type { SimBody } from "@motor-arena/shared";

export class InterpolationBuffer {
  private latest: SimBody | undefined;

  push(_time: number, pose: SimBody): void {
    this.latest = { x: pose.x, y: pose.y, angle: pose.angle };
  }

  sample(_time: number): SimBody | undefined {
    return this.latest;
  }
}
