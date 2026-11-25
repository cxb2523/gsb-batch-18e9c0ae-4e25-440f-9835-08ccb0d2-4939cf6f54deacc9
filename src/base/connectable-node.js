import React from 'react';
import RAudioNode from './audio-node.js';

/**
 * Any RAudioNode that can be connected to is a RConnectableNode
 *
 * Reverse connections (parent -> this node) are removed by
 * RAudioNode.componentWillUnmount, which resolves parent identifiers safely.
 *
 * @class      RConnectableNode (name)
 */
export default class RConnectableNode extends RAudioNode {}
