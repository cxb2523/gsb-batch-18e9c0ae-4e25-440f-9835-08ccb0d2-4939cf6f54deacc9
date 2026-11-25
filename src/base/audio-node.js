import React from 'react';
import RComponent from './component.js';

/**
 * Any RComponent that corresponds to an AudioNode is a RAudioNode
 *
 * @class      RAudioNode (name)
 */
export default class RAudioNode extends RComponent {
  constructor(props) {
    super(props);
    // internal AudioNode instance
    this.node = null;
    // dictionary of AudioNode parameters (either AudioParams or object properties)
    this.params = {};
    // the node instance which the recorded connection plan was established for
    this._connectionPlanNode = null;
    // whether the node is currently disconnected by the `disconnected` prop
    this._planDisconnected = false;
    // the list of arguments used for the last successful connection pass
    this._connectionPlan = null;
    this.connectToAllDestinations = this.connectToAllDestinations.bind(this);
    this.setParam = this.setParam.bind(this);
    this.performReconnect = this.performReconnect.bind(this);
    this.requestReconnect = this.requestReconnect.bind(this);
  }

  // recursively builds up a list of nodes pointed to by IDs or lists of IDs
  flattenPointers(destinations, flattened = []) {
    for (let element of destinations) {
      if (Array.isArray(element)) {
        this.flattenPointers(element, flattened);
      } else if (typeof element === 'symbol') {
        flattened.push(this.context.nodes.get(element));
      } else {
        flattened.push(element);
      }
    }

    return flattened;
  }

  /**
   * Generates arguments for AudioNode.connect
   * Useful because we can, for instance, override the channel assignment logic for ChannelSplitter etc.
   *
   * @param      {function} destination The AudioNode to connect to
   * @param      {number} destinationIndex The index of the AudioNode among other destinations
   * @param      {string|null} toParam The name of the AudioParam to connect to (or undefined)
   * @param      {number} fromChannel The index of the chosen output channel of this node (default is 0)
   * @param      {number} toChannel The index of the chosen input channel of the destination node (default is 0)
   */
  getConnectionArguments(destination, destinationIndex, toParam, fromChannel = 0, toChannel = 0) {
    const connectTarget = toParam ? destination[toParam] : destination;

    return [ connectTarget ].concat(toParam ? [] : [ fromChannel, toChannel ]);
  }

  /**
   * Builds the list of arguments which would be used to connect the node to its
   * current destinations, without actually performing any connection.
   *
   * A destination which is referenced by an identifier which cannot be resolved
   * yet (because the corresponding node has not registered itself in the node
   * registry) makes the plan incomplete: in that case we must not connect,
   * because we would silently skip the not-yet-ready target.
   *
   * @param      {function}  destinationFunction  returns the destinations
   * @return     {Object}  { args: Array<Array>, complete: Boolean }
   */
  buildConnectionPlan(destinationFunction) {
    if (typeof destinationFunction !== 'function') {
      return { args: [], complete: true };
    }

    let destinations;

    try {
      destinations = destinationFunction();
    } catch (e) {
      return { args: [], complete: false };
    }

    if (!(destinations instanceof Array)) destinations = [ destinations ];

    const flattened = [];

    for (let element of destinations) {
      if (Array.isArray(element)) {
        this.flattenPointers(element, flattened);
      } else if (typeof element === 'symbol') {
        flattened.push(this.context.nodes.get(element));
      } else {
        flattened.push(element);
      }
    }

    const args = [];
    let complete = true;

    flattened.forEach((destination, di) => {
      // `undefined` is what both an unresolved identifier and a missing
      // destination resolve to - either way we cannot connect right now
      if (destination === undefined) {
        complete = false;
        return;
      }

      // null is an explicit "no destination" (e.g. an empty RSplit input list)
      if (destination === null) return;

      args.push(this.getConnectionArguments(
        destination,
        di,
        this.props.connectToParam,
        this.props.connectFromChannel,
        this.props.connectToChannel));
    });

    return { args, complete };
  }

  /**
   * Compares two connection plans. Used to avoid tearing down and rebuilding
   * connections when a re-render produced an equivalent set of destinations.
   *
   * @param      {Array}  a  connection plan arguments
   * @param      {Array}  b  other connection plan arguments
   * @return     {boolean}  True if both plans are equivalent
   */
  connectionPlansEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;

    // compare every connect() argument by identity; AudioNodes, AudioParams
    // and numeric channel indices are all safe to compare this way
    return a.every((args, i) => {
      const other = b[i];
      return other &&
        args.length === other.length &&
        args.every((arg, j) => arg === other[j]);
    });
  }

  /**
   * Brings the node's outgoing connections in line with its current props.
   *
   * The connection plan is only rebuilt when the effective destinations (or
   * the node instance itself) changed, so a re-render which merely updates
   * parameters does not churn the graph. When the plan did change, all old
   * connections are removed first and the new ones are established afterwards.
   *
   * This is called by the graph update coordinator after the whole updated
   * subtree has applied its parameter changes.
   *
   * @return     {boolean}  False if the destinations could not be resolved yet
   */
  performReconnect(destinationFunction) {
    if (!this.node) return true;

    const disconnected = !!this.props.disconnected;

    if (disconnected) {
      const alreadyDisconnected =
        this._connectionPlanNode === this.node && this._planDisconnected;

      if (!alreadyDisconnected) {
        // tear down the old edges, but do not build a new plan - the node
        // remains in the registry so it can be reconnected later
        this.disconnectNode();

        this._connectionPlanNode = this.node;
        this._planDisconnected = true;
        this._connectionPlan = null;
      }

      return true;
    }

    const destination = typeof destinationFunction === 'function'
      ? destinationFunction
      : this.props.destination;

    const { args, complete } = this.buildConnectionPlan(destination);

    if (!complete) {
      // a destination is not ready yet - keep the current connection and
      // retry once the coordinator runs another connection pass
      return false;
    }

    const planIsStale =
      this._connectionPlanNode !== this.node ||
      this._planDisconnected ||
      !this.connectionPlansEqual(this._connectionPlan, args);

    if (!planIsStale) return true;

    // disconnect the old edges before wiring up the new destination(s)
    this.disconnectNode();

    this._connectionPlanNode = this.node;
    this._planDisconnected = false;
    this._connectionPlan = args;

    args.forEach(connectArgs => {
      try {
        this.node.connect(...connectArgs);
      } catch (e) {
        console.warn('Could not connect audio node', this.node, e); // eslint-disable-line no-console
      }
    });

    return true;
  }

  disconnectNode() {
    if (!this.node || typeof this.node.disconnect !== 'function') return;

    try {
      this.node.disconnect();
    } catch (e) {
      // the node may have no outgoing connections at all
    }
  }

  /**
   * Requests a connection update. While a graph update pass is in progress
   * the request is deferred until the whole subtree has finished updating,
   * which guarantees reconnections happen after child nodes applied their
   * parameter changes.
   */
  requestReconnect() {
    this.getGraphUpdates().scheduleConnection(this);
  }

  /**
   * Entry point for nodes which (re)connect outside of a normal React update,
   * most notably scheduled sources restarting after their node instance was
   * replaced. The optional destination getter is honoured for this call only.
   *
   * @param      {function}   destinationFunction  The getter for destinations
   * @param      {AudioNode}  webAudioNode         The node instance to connect
   */
  connectToAllDestinations(destinationFunction, webAudioNode) {
    if (webAudioNode && webAudioNode !== this.node) {
      // the caller wants a different instance than the one we track
      this.node = webAudioNode;
    }

    if (!this.node) return;

    if (!this.performReconnect(destinationFunction)) {
      this.getGraphUpdates().retryLater(this);
    }
  }

  componentWillMount() {
    super.componentWillMount();
  }

  componentWillReceiveProps(nextProps) {
    this.updateParams(nextProps);
  }

  componentWillUpdate(nextProps, nextState) {
    // update the node's record in the node registry
    if (this.props.identifier !== nextProps.identifier) {
      if (this.props.identifier !== undefined) {
        this.context.nodes.delete(this.props.identifier);
      }
      if (this.node && nextProps.identifier !== undefined) {
        this.context.nodes.set(nextProps.identifier, this.node);
      }
    }
  }

  // connect in DidUpdate so that the whole subtree has rendered and every
  // node has registered itself before destinations are resolved
  componentDidUpdate(prevProps, prevState) {
    this.requestReconnect();
  }

  componentDidMount() {
    super.componentDidMount();
    this.requestReconnect();
  }

  /**
   * Removes the reverse (parent -> this node) connections when the node goes
   * away. Parents which are already gone are skipped safely.
   */
  disconnectFromParents() {
    const parentFunction = this.props && this.props.parent;
    if (typeof parentFunction !== 'function') return;

    let parents;

    try {
      parents = parentFunction();
    } catch (e) {
      return;
    }

    if (parents === null || parents === undefined) return;

    const queue = Array.isArray(parents) ? parents.slice() : [ parents ];

    while (queue.length) {
      const parentPointer = queue.shift();

      if (parentPointer === null || parentPointer === undefined) continue;

      if (Array.isArray(parentPointer)) {
        queue.push(...parentPointer);
        continue;
      }

      const parentNode = typeof parentPointer === 'symbol'
        ? this.context.nodes.get(parentPointer)
        : parentPointer;

      // the parent may have been unmounted already - nothing to disconnect
      if (!parentNode || typeof parentNode.disconnect !== 'function') continue;

      try {
        parentNode.disconnect(this.node);
      } catch (e) {
        // the parent was not connected to this node (e.g. it was
        // disconnected itself) - that's fine
      }
    }
  }

  componentWillUnmount() {
    this.getGraphUpdates().cancel(this);
    this.disconnectFromParents();

    if (this.node) {
      try {
        this.node.disconnect();
      } catch (e) {
        // already disconnected
      }
    }

    if (this.props.identifier !== undefined) {
      this.context.nodes.delete(this.props.identifier);
    }
  }

  resolveTransitionProps(props, propName) {
    const transitionTime = typeof props.transitionTime === 'number'
      ? props.transitionTime
      : props.transitionTime ? props.transitionTime[propName] : null;

    const transitionCurve = typeof props.transitionCurve === 'string'
      ? props.transitionCurve
      : props.transitionCurve ? props.transitionCurve[propName] : null;

    return [ transitionTime, transitionCurve ];
  }

  // updates only Web Audio-related parameters
  // (both AudioParams and regular properties)
  updateParams(props) {
    if (!this.params) return;

    for (let p in this.params) {
      if (!(p in props)) continue;

      const [ transitionTime, transitionCurve ] = this.resolveTransitionProps(props, p);

      if (this.node[p] instanceof AudioParam) {
        this.setParam(this.node[p], props[p], transitionTime, transitionCurve);
      } else if (this.node.parameters && this.node.parameters.has(p)) {
        let param = this.node.parameters.get(p);
        this.setParam(param, props[p], transitionTime, transitionCurve);
      } else if (p in this.node) {
        // some browsers (e.g. Chrome) will try to set channelCount and throw an error
        // since we can't use Object.getOwnPropertyDescriptor on the AudioNodes
        // we simply wrap the action in a try-catch
        try {
          if (this.node[p] !== props[p]) this.node[p] = props[p];
        } catch(e) {
          console.warn(`Tried setting ${p} on node`, this.node); // eslint-disable-line no-console
        }
      }
    }
  }

  /**
   * Applies a new value to an AudioParam.
   *
   * When a transition time is given, the parameter is ramped from its current
   * value (as reported by the AudioParam at the time of the update) to the new
   * value over the requested duration, rather than jumping to the target. The
   * ramp starts at `currentTime` and ends at `currentTime + transitionTime`.
   *
   * @param      {AudioParam}  param           The parameter
   * @param      {number}  value               The target value
   * @param      {number}  transitionTime      The duration of the ramp in seconds
   * @param      {string}  transitionCurve     Either `linear` or `exponential`
   */
  setParam(param, value, transitionTime, transitionCurve) {
    const now = this.context.audio.currentTime;
    const hasTransition = typeof transitionTime === 'number' && transitionTime > 0;

    if (!hasTransition) {
      param.setValueAtTime(value, now);
      return;
    }

    // start from the value the parameter actually has right now, so a new
    // transition continues from wherever the previous one left off
    const currentValue = typeof param.value === 'number' && isFinite(param.value)
      ? param.value
      : value;

    const endTime = now + transitionTime;

    // drop any automation which is still queued so the new ramp is the only
    // thing driving the parameter from here on
    if (typeof param.cancelScheduledValues === 'function') {
      param.cancelScheduledValues(now);
    }
    param.setValueAtTime(currentValue, now);

    if (transitionCurve) {
      const fn = `${transitionCurve}RampToValueAtTime`;

      // exponential ramps are undefined (and throw in some browsers) for
      // non-positive values, so fall back to a linear ramp
      if (typeof param[fn] === 'function') {
        try {
          param[fn](value, endTime);
          return;
        } catch (e) {
          // fall through to the linear ramp
        }
      }
    }

    param.linearRampToValueAtTime(value, endTime);
  }

  render() {
    if (this.context.debug) {
      return (
        <li>
          <div>
            <strong>
              {this.constructor.name} <em>{this.props.name || ''}</em>
              <sup><mark>{this.props.disconnected && 'disconnected' || ''}</mark></sup>
            </strong>
            <div>{ this.props.connectToParam ? <span> connects to <em>{this.props.connectToParam}</em></span> : null }</div>
          </div>
          <ul>
            {
              Object.keys(this.params).map((p, pi) => {
                if (!this.props[p] && this.props[p] !== 0) return null;

                let param = this.props[p];
                if (typeof this.props[p] === 'boolean') param = this.props[p].toString();

                if (!(['number', 'string', 'boolean'].includes(typeof this.props[p]))) {
                  param = param.constructor.name;
                }

                return <li key={pi}>{p}: <code>{param}</code></li>;
              })
            }
          </ul>
        </li>
      );
    }

    return null;
  }
}
