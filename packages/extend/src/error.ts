/** An adapter did something the host must not accept. `adapter` is the manifest id; the message says what. */
export class AdapterError extends Error {
  override readonly name: string = "AdapterError";
  constructor(readonly adapter: string, message: string, options?: { cause?: unknown }) {
    super(`adapter "${adapter}": ${message}`, options);
  }
}
