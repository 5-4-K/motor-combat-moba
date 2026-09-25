import { BASE_TABLES } from "../base.js";
import { mergeTables } from "../merge.js";
import type { ModeTables } from "../types.js";
import { DEATHMATCH_OVERRIDES } from "./config.js";

export const DEATHMATCH_TABLES: ModeTables = mergeTables(BASE_TABLES, DEATHMATCH_OVERRIDES);
