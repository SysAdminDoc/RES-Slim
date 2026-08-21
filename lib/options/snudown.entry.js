/* @flow */

import { markdown, markdownWiki } from 'snudown-js';

const renderers = Object.freeze({ markdown, markdownWiki });
(window: any).RESSnudown = renderers;
