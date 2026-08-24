import { Schema, type } from "@colyseus/schema";

export class ProjectileState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  @type("number") speed = 0;
  @type("uint32") spawnTick = 0;
  @type("boolean") alive = true;
}
