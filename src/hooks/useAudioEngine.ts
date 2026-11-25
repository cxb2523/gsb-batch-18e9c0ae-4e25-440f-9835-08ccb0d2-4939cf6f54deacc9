import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Graph } from '../types/graph';
import type { ScopeDataMessage, WorkletMessage } from '../types/messages';
import { toEngineGraph } from '../model/graph';
import {
  diffParams,
  mergeScopeFrames,
  pruneScopeData,
  seedParamCache,
  type ParamCache,
} from '../model/engineSync';

export type StatusType = 'info' | 'success' | 'error';

export type EngineStatus = { message: string; type: StatusType };

/**
 * Drives the AudioWorklet. The engine rebuilds its module graph whenever the
 * audio-relevant part of the patch changes; moving nodes around the canvas
 * never touches it.
 */
export function useAudioEngine(graph: Graph) {
  const audioContext = useRef<AudioContext | null>(null);
  const modularNode = useRef<AudioWorkletNode | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<EngineStatus>({
    message: 'Ready. Press play to start audio.',
    type: 'info',
  });
  const [scopeData, setScopeData] = useState<Record<string, number[]>>({});

  const engineGraph = useMemo(() => toEngineGraph(graph), [graph]);
  const latestGraph = useRef(engineGraph);
  latestGraph.current = engineGraph;
  // Params the engine currently holds, per module id. Used to diff parameter
  // edits into cheap setParam messages instead of a full graph rebuild.
  const sentParams = useRef<ParamCache>(new Map());
  // Generation of the graph most recently sent to the engine. Scope frames
  // tagged with an older generation belong to a graph that no longer exists
  // and are dropped before they can repaint the new modules.
  const generation = useRef(0);

  const postGraph = useCallback(() => {
    const node = modularNode.current;
    if (!node) return;
    generation.current += 1;
    const graphToSend = latestGraph.current;
    node.port.postMessage({
      type: 'loadGraph',
      graph: graphToSend,
      generation: generation.current,
    });
    // The engine now owns exactly these params; the next setParam diff must be
    // measured against the new module set, not the pre-rebuild one.
    sentParams.current = seedParamCache(graphToSend.modules);
    // Drop scope traces for modules that are not part of the new graph.
    setScopeData((prev) => pruneScopeData(prev, graphToSend.modules));
  }, []);

  // Anything the worklet has to rebuild for: the set of modules and the cables.
  const structureKey = useMemo(
    () =>
      JSON.stringify({
        modules: engineGraph.modules.map(({ id, kind }) => ({ id, kind })),
        connections: engineGraph.connections,
      }),
    [engineGraph]
  );
  const lastStructureKey = useRef(structureKey);

  useEffect(() => {
    const node = modularNode.current;
    if (!node) return;

    if (structureKey !== lastStructureKey.current) {
      lastStructureKey.current = structureKey;
      postGraph();
      return;
    }

    // `diffParams` compares every module against the cache; sending only the
    // differences keeps oscillator phases and delay tails alive. The cache is
    // then refreshed to the current params objects so unchanged modules
    // short-circuit on the next render.
    for (const message of diffParams(sentParams.current, engineGraph.modules)) {
      node.port.postMessage(message);
    }
    sentParams.current = seedParamCache(engineGraph.modules);
  }, [engineGraph, structureKey, postGraph]);

  const start = useCallback(async () => {
    try {
      setStatus({ message: 'Initializing audio context...', type: 'info' });

      if (!audioContext.current) {
        audioContext.current = new AudioContext();
      }
      const ctx = audioContext.current;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      setStatus({ message: 'Loading AudioWorklet module...', type: 'info' });

      const workletPath = import.meta.env.DEV
        ? '/src/worklet/index.ts'
        : new URL(/* @vite-ignore */ 'modular-processor.js', import.meta.url).href;

      await ctx.audioWorklet.addModule(workletPath);

      const node = new AudioWorkletNode(ctx, 'modular-processor', {
        outputChannelCount: [2],
      });

      node.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
        if (e.data.type === 'graphLoaded') {
          setStatus({ message: 'Audio running.', type: 'success' });
        } else if (e.data.type === 'error') {
          setStatus({ message: `Error: ${e.data.message}`, type: 'error' });
        } else if (e.data.type === 'scopeData') {
          const data = e.data as ScopeDataMessage;
          setScopeData((prev) => mergeScopeFrames(prev, data, generation.current));
        }
      };

      node.connect(ctx.destination);
      modularNode.current = node;

      setStatus({ message: 'Loading graph...', type: 'info' });
      lastStructureKey.current = structureKey;
      postGraph();

      if (ctx.state !== 'running') {
        await ctx.resume();
      }
      setIsRunning(true);
    } catch (err) {
      console.error('Audio initialization error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setStatus({ message: `Error: ${message}`, type: 'error' });
    }
  }, [postGraph, structureKey]);

  const stop = useCallback(() => {
    if (modularNode.current) {
      modularNode.current.port.onmessage = null;
      modularNode.current.disconnect();
      modularNode.current = null;
    }
    void audioContext.current?.suspend();
    setScopeData({});
    setIsRunning(false);
    setStatus({ message: 'Audio stopped.', type: 'info' });
  }, []);

  const toggle = useCallback(() => {
    if (isRunning) {
      stop();
    } else {
      void start();
    }
  }, [isRunning, start, stop]);

  return { isRunning, status, setStatus, scopeData, start, stop, toggle, reload: postGraph };
}
