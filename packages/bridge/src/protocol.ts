import { z } from 'zod';

/** Messages between the daemon, Studio (control panel) and the page overlay. Everything is validated on receipt. */

export type ErrorCode =
  | 'PATH_OUTSIDE_ROOT'
  | 'BAD_EXTENSION'
  | 'FILE_NOT_FOUND'
  | 'NOT_UTF8'
  | 'CONFLICT'
  | 'UNDO_CONFLICT'
  | 'NOTHING_TO_UNDO'
  | 'DISARMED'
  | 'NO_PAGE'
  | 'NO_SELECTION'
  | 'CAPTURE_FAILED'
  | 'RATE_LIMITED'
  | 'INVALID_PROPOSAL'
  | 'BAD_REQUEST'
  | 'PARSE_ERROR'
  | 'NODE_NOT_FOUND'
  | 'AMBIGUOUS_NODE'
  | 'OUT_OF_SUBSET'
  | 'READ_ONLY_NODE'
  | 'READ_ONLY_PROP'
  | 'INVALID_VALUE'
  | 'UNIFORM_NOT_FOUND'
  | 'WRITE_VERIFICATION_FAILED'
  | 'INTERNAL';

export interface FileSnap {
  /** Project-relative POSIX path. */
  path: string;
  source: string;
  hash: string;
}

export type DiffAuthor = 'you' | 'page' | 'external' | 'agent';

export interface DiffWire {
  id: number;
  kind: 'edit' | 'undo' | 'redo' | 'external';
  file: string;
  line: number;
  before: string;
  after: string;
  summary: string;
  author: DiffAuthor;
  at: number;
}

export interface UndoState {
  undoDepth: number;
  redoDepth: number;
  /** False when the file changed on disk since the last edit, so the top undo would be refused. */
  canUndo: boolean;
  canRedo: boolean;
}

// ---------------- Studio -> daemon ----------------

const Vec = z.array(z.number().finite()).min(1).max(4);
const Value: z.ZodType<unknown> = z.union([z.number().finite(), z.string().max(2000), z.boolean(), z.null(), z.array(z.number().finite()).max(16), z.record(z.string(), z.unknown())]);

const EditOp = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prop'), node: z.string().min(1).max(500), prop: z.string().min(1).max(100), value: Value }),
  z.object({ kind: z.literal('uniform'), node: z.string().min(1).max(500), uniform: z.string().min(1).max(100), value: Value }),
]);
export type EditOpWire = z.infer<typeof EditOp>;

export const StudioMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().max(200) }),
  z.object({ type: z.literal('arm'), value: z.boolean() }),
  z.object({ type: z.literal('open'), file: z.string().max(500) }),
  z.object({ type: z.literal('edit'), id: z.number().int(), file: z.string().max(500), baseHash: z.string().max(100), op: EditOp }),
  z.object({ type: z.literal('undo'), id: z.number().int() }),
  z.object({ type: z.literal('redo'), id: z.number().int() }),
  z.object({ type: z.literal('select'), tag: z.string().max(600).nullable() }),
  z.object({ type: z.literal('live'), tag: z.string().max(600), prop: z.string().max(100), value: Value, uniform: z.boolean().optional() }),
  z.object({ type: z.literal('view'), mode: z.enum(['scene', 'free']) }),
  z.object({ type: z.literal('gizmo'), mode: z.enum(['translate', 'rotate', 'scale']) }),
]);
export type StudioMsg = z.infer<typeof StudioMsg>;

// ---------------- page -> daemon (untrusted observation + bounded proposals) ----------------

const Triple = z.array(z.number().finite()).length(3);
const Change = z.object({ from: Triple, to: Triple });

export const PageMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().max(200), url: z.string().max(500).optional() }),
  z.object({ type: z.literal('pick'), tag: z.string().max(600).nullable() }),
  z.object({ type: z.literal('frozen'), value: z.boolean() }),
  z.object({
    type: z.literal('capture-result'),
    id: z.number().int(),
    ok: z.boolean(),
    url: z.string().max(24 * 1024 * 1024).optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    camera: z.object({ position: Triple, rotation: Triple, fov: z.number().nullable(), type: z.string().max(40) }).optional(),
    viewport: z.object({ cssWidth: z.number(), cssHeight: z.number(), dpr: z.number() }).optional(),
    error: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('proposal'),
    id: z.number().int(),
    tag: z.string().min(3).max(600),
    changes: z.object({ position: Change.optional(), rotation: Change.optional(), scale: Change.optional() }).strict(),
  }),
]);
export type PageMsg = z.infer<typeof PageMsg>;

/** The bound on a page-originated number: anything larger is not a plausible scene edit. */
export const PROPOSAL_LIMITS = { position: 1e4, rotation: 1e3, scale: 1e3 } as const;

// ---------------- daemon -> Studio ----------------

export type ToStudio =
  | { type: 'ready'; version: string; root: string; pageUrl: string | null; files: string[]; file: FileSnap | null; armed: boolean; page: boolean; undo: UndoState }
  | { type: 'file'; file: FileSnap; cause: 'edit' | 'undo' | 'redo' | 'external' | 'open' }
  | { type: 'files'; files: string[] }
  | { type: 'result'; id: number; ok: true; file: FileSnap }
  | { type: 'result'; id: number; ok: false; code: ErrorCode; message: string; file?: FileSnap }
  | { type: 'diff'; entry: DiffWire }
  | { type: 'armed'; value: boolean; reason?: string }
  | { type: 'page'; connected: boolean }
  | { type: 'pick'; tag: string | null }
  | { type: 'frozen'; value: boolean }
  | { type: 'undo'; state: UndoState }
  | { type: 'rejected'; code: ErrorCode; message: string };

// ---------------- daemon -> page ----------------

export type ToPage =
  | { type: 'hello-ok'; armed: boolean }
  | { type: 'arm'; value: boolean }
  | { type: 'select'; tag: string | null }
  | { type: 'view'; mode: 'scene' | 'free' }
  | { type: 'gizmo'; mode: 'translate' | 'rotate' | 'scale' }
  | { type: 'capture'; id: number }
  | { type: 'live'; tag: string; prop: string; value: unknown; uniform?: boolean }
  | { type: 'proposal-result'; id: number; ok: boolean; code?: ErrorCode; message?: string };

export { Vec as _Vec };
