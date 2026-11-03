// Everything: the study list and a registrar. Importing this module pulls every
// study in; import single studies from "@alphacharts/indicators/studies" to stay small.
import { registerStudies } from "./registry.js";
import { ALL_STUDIES } from "./studies/all.js";

export { ALL_STUDIES };
export function registerAllStudies(): void {
  registerStudies(ALL_STUDIES);
}
