/**
 * Error codes returned by the parser and writer. These are a subset of the full
 * list the MCP layer will expose; the names are stable on purpose.
 */
export type PrismErrorCode =
  | 'PARSE_ERROR' // the file is not valid TSX
  | 'NODE_NOT_FOUND' // the node id does not resolve
  | 'AMBIGUOUS_NODE' // the node id resolves to more than one node
  | 'OUT_OF_SUBSET' // the target prop is an expression, not a literal
  | 'READ_ONLY_NODE' // the node is locked (map, conditional, spread, opaque)
  | 'READ_ONLY_PROP' // the prop is never written by Prismbox (ref, handlers, GLSL source)
  | 'INVALID_VALUE' // the value does not fit the prop
  | 'CONFLICT' // `expected` does not match what is in the file
  | 'UNIFORM_NOT_FOUND' // the shader has no such literal uniform
  | 'WRITE_VERIFICATION_FAILED'; // the edited output failed the post-write check

export class PrismError extends Error {
  readonly code: PrismErrorCode;

  constructor(code: PrismErrorCode, message: string) {
    super(message);
    this.name = 'PrismError';
    this.code = code;
  }
}
