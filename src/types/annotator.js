/**
 * Type definitions for objects passes between the annotator and sidebar
 */

/** @typedef {import("./api").Target} Target */

/**
 * @typedef AnnotationData
 * @prop {string} uri
 * @prop {string} $tag
 * @prop {string} [$highlight]
 * @prop {Target[]} target
 * @prop {Document} document
 */

/**
 * @typedef Document
 * @prop {string} title
 * @prop {Object[]} link
 *   @prop {string} link.rel
 *   @prop {string} link.type
 * @prop {Object} dc
 * @prop {Object} eprints
 * @prop {Object} facebook
 * @prop {Object} highwire
 * @prop {Object} prism
 * @prop {Object} twitter
 */

// Make TypeScript treat this file as a module.
export const unused = {};
