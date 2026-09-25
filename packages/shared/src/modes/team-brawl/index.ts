import { BASE_TABLES } from "../base.js";
import { mergeTables } from "../merge.js";
import type { ModeTables } from "../types.js";
import { TEAM_OVERRIDES } from "./config.js";

export const TEAM_TABLES: ModeTables = mergeTables(BASE_TABLES, TEAM_OVERRIDES);
