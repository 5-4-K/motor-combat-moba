import { BASE_TABLES } from "../base.js";
import { mergeTables } from "../merge.js";
import type { ModeTables } from "../types.js";
import { CONQUER_OVERRIDES } from "./config.js";

export const CONQUER_TABLES: ModeTables = mergeTables(BASE_TABLES, CONQUER_OVERRIDES);
