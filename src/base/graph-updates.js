/**
 * Coordinates graph updates which span more than one component.
 *
 * A React update is split into a render phase (where all
 * `componentWillReceiveProps` and therefore all parameter updates happen)
 * and a commit phase (where `componentDidUpdate` is called, children before
 * their parents).
 *
 * Audio nodes need to re-establish their connections *after* the children
 * they connect to have applied their new parameter values. Because sibling
 * subtrees are committed one after another, a node's own `componentDidUpdate`
 * is not necessarily late enough. Graph components (and `RAudioContext`)
 * therefore open an "update pass" when they start updating and close it when
 * they finish. Reconnections requested while a pass is open are queued and
 * only performed once the outermost pass closes, i.e. after the whole subtree
 * has finished updating.
 *
 * If a node cannot resolve its new destination yet (e.g. the destination node
 * has not registered itself in `context.nodes`), the node is re-queued and
 * retried on the next pass (or when a node mounts). This prevents connecting
 * to a not-yet-ready target.
 *
 * @class      GraphUpdates (name)
 */
export default class GraphUpdates {
  constructor() {
    // number of currently open update passes (updated graph containers)
    this.depth = 0;
    // nodes which asked to reconnect during the current pass
    this.pending = new Set();
  }

  /**
   * Called by a graph container when its update starts (render phase).
   */
  beginPass() {
    this.depth += 1;
  }

  /**
   * Called by a graph container when its update is committed.
   * Flushes once the outermost container has finished updating.
   */
  endPass() {
    if (this.depth > 0) this.depth -= 1;
    if (this.depth === 0) this.flush();
  }

  /**
   * Whether an update pass is currently in progress.
   *
   * @return     {boolean}  True if at least one graph container is updating.
   */
  isUpdating() {
    return this.depth > 0;
  }

  /**
   * Queues a node's reconnection until the current pass has completed.
   * If no pass is active the connection is updated immediately, which keeps
   * isolated components (and direct lifecycle invocation) working.
   *
   * @param      {RAudioNode}  nodeComponent  The node component requesting a reconnect
   */
  scheduleConnection(nodeComponent) {
    if (!nodeComponent) return;

    if (this.depth > 0) {
      this.pending.add(nodeComponent);
      return;
    }

    // bring anything which was waiting for a destination up to date first
    this.flush();

    if (nodeComponent.performReconnect() === false) {
      this.pending.add(nodeComponent);
    }
  }

  /**
   * Marks a node for another connection attempt later on. Used when its
   * destination could not be resolved during the current pass.
   *
   * @param      {RAudioNode}  nodeComponent  The node component
   */
  retryLater(nodeComponent) {
    if (nodeComponent) this.pending.add(nodeComponent);
  }

  /**
   * Removes a node from the queue (e.g. when it unmounts).
   *
   * @param      {RAudioNode}  nodeComponent  The node component
   */
  cancel(nodeComponent) {
    this.pending.delete(nodeComponent);
  }

  /**
   * Performs all queued reconnections. A node is only queued once per pass,
   * so several prop updates within the same render end up in a single
   * disconnect/connect cycle, using the latest props.
   *
   * Nodes whose destination is still unavailable stay queued for a later pass.
   */
  flush() {
    if (this.pending.size === 0) return;

    const batch = Array.from(this.pending);
    this.pending.clear();

    batch.forEach(nodeComponent => {
      if (nodeComponent.performReconnect() === false) {
        this.pending.add(nodeComponent);
      }
    });
  }

  /**
   * Discards all queued work. Used when the audio context unmounts.
   */
  reset() {
    this.depth = 0;
    this.pending.clear();
  }
}

const sharedGraphUpdates = new GraphUpdates();

export {
  sharedGraphUpdates
};
