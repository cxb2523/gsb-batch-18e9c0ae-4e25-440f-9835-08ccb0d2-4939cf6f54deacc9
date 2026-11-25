import type { Graph } from './graph';

export interface LoadGraphMessage {
  type: 'loadGraph';
  graph: Graph;
  /**
   * Monotonic rebuild counter. The engine echoes it on the messages it emits
   * so the UI can discard anything produced by a graph that has since been
   * replaced.
   */
  generation?: number;
}

export interface SetParamMessage {
  type: 'setParam';
  id: string;
  param: string;
  value: number | string;
}

export interface GraphLoadedMessage {
  type: 'graphLoaded';
  success: true;
  generation?: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  generation?: number;
}

export interface ScopeFrame {
  id: string;
  samples: number[];
}

export interface ScopeDataMessage {
  type: 'scopeData';
  frames: ScopeFrame[];
  generation?: number;
}

export type WorkletMessage =
  LoadGraphMessage | SetParamMessage | GraphLoadedMessage | ErrorMessage | ScopeDataMessage;
