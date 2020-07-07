/**
 * @typedef {import('../types/api').Annotation} Annotation
 *
 * @typedef Thread
 * @prop {string} id
 * @prop {Annotation|undefined} annotation
 * @prop {Thread|undefined} parent
 * @prop {boolean} visible
 * @prop {boolean} collapsed
 * @prop {Thread[]} children
 * @prop {number} totalChildren
 * @prop {'dim'|'highlight'|undefined} highlightState
 */

/**
 * Default state for new threads, before applying filters etc.
 *
 * @type {Partial<Thread>}
 */
const DEFAULT_THREAD_STATE = {
  /**
   * The id of this thread. This will be the same as the annotation id for
   * created annotations or the `$tag` property for new annotations.
   */
  id: '__default__',
  /**
   * The Annotation which is displayed by this thread.
   *
   * This may be null if the existence of an annotation is implied by the
   * `references` field in an annotation but the referenced parent annotation
   * does not exist.
   */
  annotation: undefined,
  /** The parent thread id */
  parent: undefined,
  /** True if this thread is collapsed, hiding replies to this annotation. */
  collapsed: false,
  /** True if this annotation matches the current filters. */
  visible: true,
  /**
   * The total number of children of this annotation,
   * including any which have been hidden by filters.
   */
  totalChildren: 0,
  /**
   * The highlight state of this annotation:
   *  undefined - Do not (de-)emphasize this annotation
   *  'dim' - De-emphasize this annotation
   *  'highlight' - Emphasize this annotation
   */
  highlightState: undefined,
};

/**
 * Returns a persistent identifier for an Annotation.
 * If the Annotation has been created on the server, it will have
 * an id assigned, otherwise we fall back to the local-only '$tag'
 * property.
 *
 * @return {string}
 */
function annotationId(annotation) {
  return annotation.id || annotation.$tag;
}

/**
 * Is there a valid path from the thread indicated by `id` to the root thread,
 * with no circular references?
 *
 * @param {string} id
 * @param {string} ancestorId
 */
function hasPathToRoot(threads, id, ancestorId) {
  if (!threads[ancestorId] || threads[ancestorId].parent === id) {
    // Thread for ancestor not found, or points at itself: circular reference
    return false;
  } else if (!threads[ancestorId].parent) {
    // Top of the tree: we've made it
    return true;
  }
  return hasPathToRoot(threads, id, threads[ancestorId].parent);
}

/**
 * Link the annotation to its parent
 *
 * @param {string} id
 * @param {Array<string>} [parents] - ids of parent annotations, from the
 *        annotation's `references` field.
 */
function setParent(threads, id, parents = []) {
  if (threads[id].parent || !parents.length) {
    // Parent already assigned, do not try to change it.
    return;
  }
  // The last entry in `parents` is this thread's immediate parent
  const parentId = parents[parents.length - 1];
  if (!threads[parentId]) {
    // Parent does not exist. This may be a reply to an annotation which has
    // been deleted. Create a placeholder Thread with no annotation to
    // represent the missing annotation.
    threads[parentId] = {
      ...DEFAULT_THREAD_STATE,
      ...{ children: [] },
    };
    // Link up this new thread to _its_ parent, which should be the original
    // thread's grandparent
    setParent(threads, parentId, parents.slice(0, -1));
  }

  if (hasPathToRoot(threads, id, parentId)) {
    threads[id].parent = parentId;
    threads[parentId].children.push(threads[id]);
  }
}

/**
 * Creates a thread tree of annotations from a list of annotations.
 *
 * Given a flat list of annotations and replies, this generates a hierarchical
 * thread, using the `references` field of an annotation to link together
 * annotations and their replies. The `references` field is a possibly
 * incomplete ordered list of the parents of an annotation, from furthest to
 * nearest ancestor.
 *
 * @param {Array<Annotation>} annotations - The input annotations to thread.
 * @return {Thread} - The input annotations threaded into a tree structure.
 */
function threadAnnotations(annotations) {
  // Map of annotation id -> Thread
  const threads = {};

  // Create a `Thread` for each annotation
  annotations.forEach(annotation => {
    const id = annotationId(annotation);
    threads[id] = {
      ...DEFAULT_THREAD_STATE,
      ...{ children: [], annotation, id },
    };
  });

  // Establish ancestral relationships between annotations
  annotations.forEach(annotation =>
    setParent(threads, annotationId(annotation), annotation.references)
  );

  // Collect the set of threads which have no parent as
  // children of the thread root
  const rootThreads = [];
  for (const rootThreadId in threads) {
    if (!threads[rootThreadId].parent) {
      // Top-level threads are collapsed by default
      threads[rootThreadId].collapsed = true;
      rootThreads.push(threads[rootThreadId]);
    }
  }

  const rootThread = {
    ...DEFAULT_THREAD_STATE,
    ...{
      id: 'root',
      children: rootThreads,
      totalChildren: rootThreads.length,
    },
  };

  return rootThread;
}

/**
 * Returns a copy of `thread` with the thread
 * and each of its children transformed by mapFn(thread).
 *
 * @param {Thread} thread
 * @param {(Thread) => Thread} mapFn
 */
function mapThread(thread, mapFn) {
  return Object.assign({}, mapFn(thread), {
    children: thread.children.map(function (child) {
      return mapThread(child, mapFn);
    }),
  });
}

/**
 * Return a sorted copy of an array of threads.
 *
 * @param {Array<Thread>} threads - The list of threads to sort
 * @param {(a: Annotation, b: Annotation) => boolean} compareFn
 * @return {Array<Thread>} Sorted list of threads
 */
function sort(threads, compareFn) {
  return threads.slice().sort((a, b) => {
    // Threads with no annotation always sort to the top
    if (!a.annotation || !b.annotation) {
      if (!a.annotation && !b.annotation) {
        return 0;
      } else {
        return !a.annotation ? -1 : 1;
      }
    }

    if (compareFn(a.annotation, b.annotation)) {
      return -1;
    } else if (compareFn(b.annotation, a.annotation)) {
      return 1;
    } else {
      return 0;
    }
  });
}

/**
 * Return a new `Thread` object with all (recursive) `children` arrays sorted.
 * Sort the children of top-level threads using `compareFn` and all other
 * children using `replyCompareFn`.
 *
 * @param {Thread} thread
 * @param {(a: Annotation, b: Annotation) => boolean} compareFn - Less-than
 *         comparison function for sorting top-level annotations
 * @param {(a: Annotation, b: Annotation) => boolean} replyCompareFn - Less-than
 *       comparison function for sorting replies
 * @return {Thread}
 */
function sortThread(thread, compareFn, replyCompareFn) {
  const children = thread.children.map(child =>
    sortThread(child, replyCompareFn, replyCompareFn)
  );

  return { ...thread, ...{ children: sort(children, compareFn) } };
}

/**
 * Return a copy of @p thread with the `replyCount` and `depth` properties
 * updated.
 */
function countRepliesAndDepth(thread, depth) {
  const children = thread.children.map(c => countRepliesAndDepth(c, depth + 1));
  const replyCount = children.reduce(
    (total, child) => total + 1 + child.replyCount,
    0
  );
  return {
    ...thread,
    ...{
      children,
      depth,
      replyCount,
    },
  };
}

/** Return true if a thread has any visible children. */
function hasVisibleChildren(thread) {
  return thread.children.some(function (child) {
    return child.visible || hasVisibleChildren(child);
  });
}

/**
 * @typedef Options
 * @prop {string[]} [selected]
 * @prop {string[]} [forceVisible] - List of ids of annotations that have
 *       been explicitly expanded by the user, even if they don't
 *       match current filters
 * @prop {(a: Annotation) => boolean} [filterFn] - Predicate function that
 *       returns `true` if annotation should be visible
 * @prop {(t: Thread) => boolean} [threadFilterFn] - Predicate function that
 *       returns `true` if the annotation should be included in the thread tree
 * @prop {Object} [expanded] - List of ids of annotations/threads that have been
 *       expanded by the user
 * @prop {Object} [highlighted] - List of ids of annotations that are highlighted
 * @prop {(a: Annotation, b: Annotation) => boolean} [sortCompareFn] - Less-than
 *       comparison function for sorting top-level annotations
 * @prop {(a: Annotation, b: Annotation) => boolean} [replySortCompareFn] - Less-than
 *       comparison function for sorting replies
 */

/**
 * Default options for buildThread()
 *
 * @type {Options}
 */
const defaultOpts = {
  /** List of currently selected annotation ids */
  selected: [],
  /**
   * Mapping of annotation ids to expansion states.
   */
  expanded: {},
  /** List of highlighted annotation ids */
  highlighted: [],
  /**
   * Less-than comparison function used to compare annotations in order to sort
   * the top-level thread.
   */
  sortCompareFn: (a, b) => {
    return a.id < b.id;
  },
  /**
   * Less-than comparison function used to compare annotations in order to sort
   * replies.
   */
  replySortCompareFn: (a, b) => {
    return a.created < b.created;
  },
};

/**
 * Project, filter and sort a list of annotations into a thread structure for
 * display by the <Thread> component.
 *
 * buildThread() takes as inputs a flat list of annotations,
 * the current visibility filters and sort function and returns
 * the thread structure that should be rendered.
 *
 * @param {Array<Annotation>} annotations - A list of annotations and replies
 * @param {Partial<Options>} options
 * @return {Thread} - The root thread, whose children are the top-level
 *                    annotations to display.
 */
export default function buildThread(annotations, options) {
  const opts = { ...defaultOpts, ...options };

  const annotationsFiltered = !!opts.filterFn;
  const threadsFiltered = !!opts.threadFilterFn;

  const hasHighlights = opts.highlighted.length > 0;
  const hasSelected = opts.selected.length > 0;
  const hasForcedVisible = opts.forceVisible && opts.forceVisible.length;

  let thread = threadAnnotations(annotations);

  if (hasSelected) {
    // Remove threads (annotations) that are not selected
    thread.children = thread.children.filter(
      child => opts.selected.indexOf(child.id) !== -1
    );
  }

  if (threadsFiltered) {
    // Remove threads not matching thread-level filters
    thread.children = thread.children.filter(opts.threadFilterFn);
  }

  /**
   * Should this thread be visible or not?
   *
   * @param {Thread} thread
   * @return {boolean}
   */
  const isVisible = thread => {
    if (!thread.visible || !thread.annotation) {
      return false;
    }
    // Respect threads that have been "forced visible"
    if (
      hasForcedVisible &&
      opts.forceVisible.indexOf(annotationId(thread.annotation)) !== -1
    ) {
      return true;
    }
    // If this annotation doesn't match the current filters
    if (annotationsFiltered && !opts.filterFn(thread.annotation)) {
      return false;
    }
    return true;
  };

  // Set visibility state for all descendant threads
  thread = mapThread(thread, thread => {
    return { ...thread, ...{ visible: isVisible(thread) } };
  });

  // Remove top-level threads which contain no visible annotations
  thread.children = thread.children.filter(
    child => child.visible || hasVisibleChildren(child)
  );

  // Determine other UI states for threads
  thread = mapThread(thread, thread => {
    const threadStates = {
      collapsed: thread.collapsed,
    };

    if (hasHighlights) {
      if (thread.annotation && opts.highlighted.indexOf(thread.id) !== -1) {
        threadStates.highlightState = 'highlight';
      } else {
        threadStates.highlightState = 'dim';
      }
    }

    if (opts.expanded.hasOwnProperty(thread.id)) {
      // This thread has been explicitly expanded/collapsed by user
      threadStates.collapsed = !opts.expanded[thread.id];
    } else {
      // If annotations are filtered, and at least one child matches
      // those filters, make sure thread is not collapsed
      const hasUnfilteredChildren =
        annotationsFiltered && hasVisibleChildren(thread);
      threadStates.collapsed = thread.collapsed && !hasUnfilteredChildren;
    }
    return { ...thread, ...threadStates };
  });

  // Sort the root thread according to the current search criteria
  thread = sortThread(thread, opts.sortCompareFn, opts.replySortCompareFn);

  // Update `replyCount` and `depth` properties
  thread = countRepliesAndDepth(thread, -1);

  return thread;
}
