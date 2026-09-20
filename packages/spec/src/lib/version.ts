import { version } from '../../package.json';

/**
 * The EIDOS version this package is built for: the major.minor of the package
 * version. The renderer and the schemas are both published per EIDOS version.
 */
export const MINOR_VERSION: string = version.split('.').slice(0, 2).join('.');
