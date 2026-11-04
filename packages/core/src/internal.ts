// @alphacharts/core/internal: the rendering internals that the sibling
// packages' own WebGL series (chart-types, orderflow) are built on. Not part of
// the public API: these change with the renderers, without a deprecation.

export { InstanceWindow, chooseLevel, RECORD_FLOATS, RECORD_BYTES, HOLE_TEST } from "./render/window.js";
export { GLContext, GLSL_COMMON } from "./render/gl.js";
export type { Program } from "./render/gl.js";
export { CORE_VERSION } from "./version.js";
export { onFault } from "./fault.js";
export type { Fault, FaultSource } from "./fault.js";
