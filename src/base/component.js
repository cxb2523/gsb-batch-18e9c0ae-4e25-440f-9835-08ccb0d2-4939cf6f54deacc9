import React from 'react';
import PropTypes from 'prop-types';

import GraphUpdates, { sharedGraphUpdates } from './graph-updates.js';

/**
 * Anything that requires an AudioContext is a RComponent
 *
 * @class      RComponent (name)
 */
export default class RComponent extends React.Component {
  componentWillMount() {
    if (!this.context.audio) throw new ReferenceError('RComponent needs to be a child of a RAudioContext');
  }

  /**
   * Returns the graph update coordinator used by this component.
   * Falls back to a shared instance when the component is not rendered inside
   * an RAudioContext (e.g. in unit tests which drive the lifecycle directly).
   *
   * @return     {GraphUpdates}  the coordinator
   */
  getGraphUpdates() {
    return (this.context && this.context.graphUpdates) || sharedGraphUpdates;
  }

  /**
   * Opens an update pass. While a pass is open, connection changes requested by
   * any audio node in the subtree are deferred until the pass is closed, which
   * guarantees they run after every child has finished updating its parameters.
   */
  beginUpdatePass() {
    if (this._updatePassOpen) return;
    this._updatePassOpen = true;
    this.getGraphUpdates().beginPass();
  }

  /**
   * Closes an update pass. The outermost pass closure flushes the deferred
   * reconnections.
   */
  endUpdatePass() {
    if (!this._updatePassOpen) return;
    this._updatePassOpen = false;
    this.getGraphUpdates().endPass();
  }

  /**
   * Outside of an update pass, mounting can leave nodes queued because their
   * destination had not registered itself yet. Flushing on mount resolves them.
   */
  componentDidMount() {
    const graphUpdates = this.getGraphUpdates();

    if (!graphUpdates.isUpdating()) graphUpdates.flush();
  }

  render() { return null; }
}

RComponent.contextTypes = {
  audio: PropTypes.instanceOf(window.AudioContext || window.webkitAudioContext),
  nodes: PropTypes.instanceOf(Map),
  graphUpdates: PropTypes.instanceOf(GraphUpdates),
  debug: PropTypes.bool
};
