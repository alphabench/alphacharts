// Compile-time contract: what the script package's run adapter provides is what
// the UI asks for (the two packages deliberately do not import each other; the
// UI's `ScriptRunAdapter` is the definition, the script package's a structural
// copy). If either side changes alone, this file stops compiling, so
// `pnpm typecheck` catches it. One direction only: the UI's callback type is
// looser than the script package's richer diagnostic, by design.
import type { ScriptRunAdapter as UiAdapter } from "@alphacharts/ui";
import type { ScriptRunAdapter as ScriptAdapter } from "@alphacharts/script";

type Assert<T extends true> = T;
export type ScriptAdapterFitsUi = Assert<ScriptAdapter extends UiAdapter ? true : false>;
