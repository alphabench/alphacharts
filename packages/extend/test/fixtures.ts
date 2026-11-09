import { allTools, type ToolDef } from "@alphacharts/drawings";
import { getStudy, type StudyDef } from "@alphacharts/indicators";
import { registerAllStudies } from "@alphacharts/indicators/all";
import type { AdapterManifest, Permission } from "../src/index.js";

export const manifest = (id: string, permissions: readonly Permission[] = []): AdapterManifest => ({ id, version: "1.0.0", name: id, permissions });

/** A real built-in tool under another id, so it is a complete ToolDef. */
export const toolAs = (id: string, from = "horizontalLine"): ToolDef => ({ ...allTools.find((t) => t.id === from)!, id });

export const studyAs = (id: string, from = "sma"): StudyDef => {
  registerAllStudies();
  return { ...getStudy(from)!, id };
};
