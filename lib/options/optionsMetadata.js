/* @flow */

// The build resolves this virtual module to metadata-only copies of every
// registered module. Runtime entry points continue importing the real registry.
// eslint-disable-next-line import-x/no-unresolved
import * as metadata from 'res-options-metadata';

export default (Object.values(metadata): any);
