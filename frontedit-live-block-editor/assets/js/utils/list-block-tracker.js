/**
 * List block tracker for UUID-aware list editing and serialization.
 *
 * Dependencies: wp.blocks, SFE.ElementPrep
 * Exposes:      SFE.ListBlockTracker
 */
(function() {
    'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

    const { createBlock, serialize: serializeBlocks } = window.wp?.blocks || {};
    const UUID_ATTR_KEYS = ['mwpSfeUuid', 'mwpSfeUuidShadow'];
    const LIST_ITEM_TEXT_ATTR = 'data-mwp-sfe-list-item-text';
    const LIST_ITEM_TEXT_CLASS = 'mwp-sfe-list-item-text';
    const PLACEHOLDER_ATTR = 'data-rich-text-placeholder';
    const LIST_ID_ATTR = 'data-list-id';
    const LIST_ITEM_ID_ATTR = 'data-item-id';
    const LIST_RUNTIME_UUID_ATTR = 'data-mwp-sfe-list-runtime-uuid';
    const LIST_ITEM_RUNTIME_UUID_ATTR = 'data-mwp-sfe-list-item-runtime-uuid';

	/**
	 * Return whether one node is a nested list element.
	 *
	 * @param   {Node|null} node Candidate DOM node.
	 * @returns {boolean}        True when the node is a nested list.
	 */
	function isNestedListNode(node) {
		return !!(
			node &&
			node.nodeType === Node.ELEMENT_NODE &&
			(node.tagName === 'UL' || node.tagName === 'OL')
		);
	}

	/**
	 * Return whether one node is ignorable formatting whitespace between list
	 * structures.
	 *
	 * Pretty-printed block markup often leaves direct `\n` text nodes between a
	 * list item's own text and its nested child list. Those nodes should not be
	 * moved into the direct text surface because they become visible editing
	 * artifacts once wrapped.
	 *
	 * @param   {Node|null} node Candidate DOM node.
	 * @returns {boolean}        True when the node is ignorable whitespace.
	 */
	function isIgnorableListWhitespaceNode(node) {
		return !!(
			node &&
			node.nodeType === Node.TEXT_NODE &&
			String(node.textContent || '')
				.replace(/\uFEFF/g, '')
				.replace(/\u00A0/g, ' ')
				.trim()
				.length === 0
		);
	}

	/**
	 * Return the direct inline text surface for one list item.
	 *
	 * @param   {HTMLLIElement|null} liElement Candidate list item.
	 * @returns {HTMLElement|null}            Existing direct text surface, if any.
	 */
	function getDirectItemTextSurface(liElement) {
		if (!liElement || liElement.nodeType !== Node.ELEMENT_NODE || liElement.tagName !== 'LI') {
			return null;
		}

		return Array.from(liElement.children || []).find(child => (
			child &&
			child.nodeType === Node.ELEMENT_NODE &&
			child.getAttribute(LIST_ITEM_TEXT_ATTR) === '1'
		)) || null;
	}

	/**
	 * Return the DOM attribute name that stores one session-scoped runtime UUID.
	 *
	 * Runtime UUIDs are distinct from the existing serialization/attr UUIDs. They
	 * exist only while the editor session is open so external callers can point at
	 * the current live list cursor/target without having to manage shifting paths.
	 *
	 * @param   {string} type Supported runtime identity type.
	 * @returns {string}      Attribute name, or an empty string for invalid types.
	 */
	function getRuntimeUuidAttributeName(type) {
		if (type === 'list') {
			return LIST_RUNTIME_UUID_ATTR;
		}

		if (type === 'item') {
			return LIST_ITEM_RUNTIME_UUID_ATTR;
		}

		return '';
	}

	/**
	 * Normalize one runtime UUID candidate.
	 *
	 * @param   {*} value Candidate runtime UUID.
	 * @returns {string}  Trimmed runtime UUID, or an empty string.
	 */
	function normalizeRuntimeUuid(value) {
		return String(value || '').trim();
	}

	/**
	 * Return whether one element matches the requested runtime-identity type.
	 *
	 * @param   {Element|null} element Candidate DOM element.
	 * @param   {string}       type    Supported runtime identity type.
	 * @returns {boolean}              True when the element matches the type.
	 */
	function isRuntimeIdentityElement(element, type) {
		if (!element || element.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}

		if (type === 'list') {
			return element.tagName === 'UL' || element.tagName === 'OL';
		}

		if (type === 'item') {
			return element.tagName === 'LI';
		}

		return false;
	}

	/**
	 * Return one tracked element by runtime UUID from the live DOM.
	 *
	 * This intentionally queries the current DOM first instead of trusting only a
	 * cached map so history restores and other structural replacements can keep
	 * runtime UUID resolution stable as long as the attributes remain present.
	 *
	 * @param   {Object|null} tracker      Active list tracker.
	 * @param   {string}      runtimeUuid  Session-scoped runtime UUID.
	 * @param   {string}      type         Supported runtime identity type.
	 * @returns {Element|null}             Matching live DOM element.
	 */
	function findElementByRuntimeUuid(tracker, runtimeUuid, type) {
		const normalizedRuntimeUuid = normalizeRuntimeUuid(runtimeUuid);
		const attrName = getRuntimeUuidAttributeName(type);
		if (
			!tracker?.listElement ||
			!normalizedRuntimeUuid ||
			!attrName ||
			!isRuntimeIdentityElement(tracker.listElement, 'list')
		) {
			return null;
		}

		if (
			type === 'list' &&
			tracker.listElement.getAttribute(attrName) === normalizedRuntimeUuid
		) {
			return tracker.listElement;
		}

		try {
			const selector = `[${attrName}="${CSS.escape(normalizedRuntimeUuid)}"]`;
			return tracker.listElement.querySelector(selector);
		} catch (error) {
			const escapedUuid = normalizedRuntimeUuid.replace(/"/g, '\\"');
			return tracker.listElement.querySelector(`[${attrName}="${escapedUuid}"]`);
		}
	}

	/**
	 * Return every direct text surface currently attached to one list item.
	 *
	 * Merge/delete flows can temporarily move multiple direct text surfaces into
	 * the same list item. The shared list normalizer must collapse them back to
	 * one canonical surface before placeholder syncing or serialization.
	 *
	 * @param   {HTMLLIElement|null} liElement Candidate list item.
	 * @returns {HTMLElement[]}               Direct text surfaces in DOM order.
	 */
	function getAllDirectItemTextSurfaces(liElement) {
		if (!liElement || liElement.nodeType !== Node.ELEMENT_NODE || liElement.tagName !== 'LI') {
			return [];
		}

		return Array.from(liElement.children || []).filter(child => (
			child &&
			child.nodeType === Node.ELEMENT_NODE &&
			child.getAttribute(LIST_ITEM_TEXT_ATTR) === '1'
		));
	}

	/**
	 * Return whether one node is only placeholder/caret scaffolding.
	 *
	 * Duplicate direct text surfaces may carry empty placeholder anchors or
	 * caret `<br>` nodes. Those artifacts should be dropped when collapsing
	 * duplicate surfaces instead of being concatenated into visible stacks.
	 *
	 * @param   {Node|null} node Candidate DOM node.
	 * @returns {boolean}        True when the node is redundant placeholder UI.
	 */
	function isRedundantSurfaceArtifact(node) {
		if (!node) {
			return true;
		}

		if (isIgnorableListWhitespaceNode(node)) {
			return true;
		}

		if (node.nodeType === Node.TEXT_NODE) {
			return String(node.textContent || '')
				.replace(/\uFEFF/g, '')
				.replace(/\u00A0/g, ' ')
				.trim()
				.length === 0;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}

		if (node.tagName === 'BR') {
			return true;
		}

		return !!node.hasAttribute?.(PLACEHOLDER_ATTR);
	}

	/**
	 * Ensure one list item owns one direct inline text surface.
	 *
	 * The root list remains the single live editor host, but this wrapper gives
	 * schema/ABE flows one stable DOM surface per list item's own text content.
	 *
	 * @param   {HTMLLIElement|null} liElement Candidate list item.
	 * @returns {HTMLElement|null}            Ensured direct text surface.
	 */
	function ensureDirectItemTextSurface(liElement) {
		if (!liElement || liElement.nodeType !== Node.ELEMENT_NODE || liElement.tagName !== 'LI') {
			return null;
		}

		let surface = getDirectItemTextSurface(liElement);
		if (!surface) {
			surface = document.createElement('span');
			surface.setAttribute(LIST_ITEM_TEXT_ATTR, '1');
			surface.classList.add(LIST_ITEM_TEXT_CLASS);
			liElement.insertBefore(
				surface,
				Array.from(liElement.childNodes || []).find(isNestedListNode) || null
			);
		}

		getAllDirectItemTextSurfaces(liElement)
			.filter(candidate => candidate && candidate !== surface)
			.forEach(duplicateSurface => {
				Array.from(duplicateSurface.childNodes || []).forEach(node => {
					if (isRedundantSurfaceArtifact(node)) {
						node.remove();
						return;
					}

					surface.appendChild(node);
				});
				duplicateSurface.remove();
			});

		const childNodes = Array.from(liElement.childNodes || []);
		childNodes.forEach(node => {
			if (
				node &&
				node !== surface &&
				!isNestedListNode(node) &&
				isIgnorableListWhitespaceNode(node)
			) {
				node.remove();
			}
		});

		const movableNodes = childNodes.filter(node => {
			if (!node || node === surface || isNestedListNode(node)) {
				return false;
			}

			if (isIgnorableListWhitespaceNode(node)) {
				return false;
			}

			return !(
				node.nodeType === Node.ELEMENT_NODE &&
				node.getAttribute?.(LIST_ITEM_TEXT_ATTR) === '1'
			);
		});

		movableNodes.forEach(node => surface.appendChild(node));
		return surface;
	}

	/**
	 * Clone list attrs while optionally stripping plugin UUID ownership.
	 *
	 * The outermost core/list is the only persisted UUID owner for an entire
	 * list tree. Nested core/list blocks are structural children of that root.
	 * If we preserve a nested list UUID here, one accidental assignment can be
	 * re-serialized forever and split a single logical list into multiple
	 * history/edit targets. Keep this guard unless the ownership model changes
	 * everywhere else in PHP and JS at the same time.
	 *
	 * @param   {Object}  attrs                 Parsed Gutenberg attrs.
	 * @param   {boolean} allowUuidOwnership    True for the root list only.
	 * @returns {Object}                        Safe cloned attrs.
	 */
	function cloneListAttrs(attrs, allowUuidOwnership = true) {
		const clonedAttrs = JSON.parse(JSON.stringify(attrs || {}));

		if (allowUuidOwnership) {
			return clonedAttrs;
		}

		UUID_ATTR_KEYS.forEach(key => delete clonedAttrs[key]);
		return clonedAttrs;
	}

	/**
	 * Return the direct list-item children for one list element.
	 *
	 * @param   {HTMLElement|null} listElement Candidate list element.
	 * @returns {HTMLLIElement[]}             Direct child list items.
	 */
	function getDirectListItems(listElement) {
		if (!listElement || listElement.nodeType !== Node.ELEMENT_NODE) {
			return [];
		}

		return Array.from(listElement.children || []).filter(child => child.tagName === 'LI');
	}

	/**
	 * Normalize one path-like value into zero-based list indexes.
	 *
	 * Supported inputs:
	 * - `0_1_2`
	 * - `1.2.3`
	 * - arrays of integers
	 *
	 * @param   {string|Array<number>|null} pathValue Candidate path value.
	 * @returns {number[]|null}                      Parsed zero-based indexes.
	 */
	function normalizePathIndexes(pathValue) {
		if (Array.isArray(pathValue)) {
			const indexes = pathValue.map(value => Number.parseInt(value, 10));
			return indexes.every(Number.isInteger) && indexes.every(index => index >= 0)
				? indexes
				: null;
		}

		const raw = typeof pathValue === 'string' ? pathValue.trim() : '';
		if (!raw) {
			return [];
		}

		const separator = raw.includes('.') ? '.' : '_';
		const parts = raw.split(separator).filter(Boolean);
		if (!parts.length) {
			return [];
		}

		const indexes = parts.map(part => Number.parseInt(part, 10));
		if (!indexes.every(Number.isInteger)) {
			return null;
		}

		if (separator === '.') {
			return indexes.every(index => index > 0)
				? indexes.map(index => index - 1)
				: null;
		}

		return indexes.every(index => index >= 0) ? indexes : null;
	}

	/**
	 * Convert one zero-based path index list into public path metadata.
	 *
	 * @param   {number[]} indexes Zero-based indexes.
	 * @returns {{path: string, pathLabel: string, depth: number}} Path metadata.
	 */
	function buildPathMeta(indexes) {
		const safeIndexes = Array.isArray(indexes) ? indexes.filter(Number.isInteger) : [];
		return {
			path: safeIndexes.join('_'),
			pathLabel: safeIndexes.map(index => index + 1).join('.'),
			depth: Math.max(0, safeIndexes.length - 1),
		};
	}

	/**
	 * Return the direct child list element for one list item.
	 *
	 * @param   {HTMLLIElement|null} listItem Candidate list item.
	 * @returns {HTMLElement|null}            Direct nested list, if present.
	 */
	function getDirectChildList(listItem) {
		if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
			return null;
		}

		return Array.from(listItem.children || []).find(child => (
			child.tagName === 'UL' || child.tagName === 'OL'
		)) || null;
	}

	/**
	 * Return the preferred nested list tag for one list item.
	 *
	 * @param   {Object|null} tracker  Active list tracker.
	 * @param   {HTMLLIElement} listItem Parent list item.
	 * @returns {string}               `UL` or `OL`.
	 */
	function getPreferredChildListTagName(tracker, listItem) {
		const directChildList = getDirectChildList(listItem);
		if (directChildList) {
			return directChildList.tagName;
		}

		const parentList = listItem?.parentElement;
		if (parentList && (parentList.tagName === 'UL' || parentList.tagName === 'OL')) {
			return parentList.tagName;
		}

		return tracker?.listElement?.tagName === 'OL' ? 'OL' : 'UL';
	}

	/**
	 * Return one direct child list for a list item, creating it only when needed.
	 *
	 * Outdent can promote one item and then re-home its trailing siblings beneath
	 * that promoted item. When the promoted item already owns a child list, those
	 * siblings must be appended into the existing list so the DOM mirrors native
	 * editor behavior instead of creating duplicate sibling list wrappers.
	 *
	 * @param   {Object|null}    tracker         Active list tracker.
	 * @param   {HTMLLIElement}  listItem        Parent list item.
	 * @param   {string}         preferredTagName Fallback list tag name.
	 * @returns {HTMLElement|null}               Direct child list element.
	 */
	function ensureDirectChildList(tracker, listItem, preferredTagName = '') {
		if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
			return null;
		}

		let childList = getDirectChildList(listItem);
		if (childList) {
			return childList;
		}

		childList = document.createElement(
			preferredTagName || getPreferredChildListTagName(tracker, listItem)
		);
		childList.classList.add('wp-block-list');
		listItem.appendChild(childList);
		return childList;
	}

	/**
	 * Remove empty nested list wrappers up the ancestry chain.
	 *
	 * The root list element is never removed, even when it becomes empty.
	 *
	 * @param   {Object|null}      tracker   Active list tracker.
	 * @param   {HTMLElement|null} startList First candidate nested list.
	 * @returns {void}
	 */
	function cleanupEmptyAncestorLists(tracker, startList) {
		let currentList = startList;
		while (
			currentList &&
			currentList !== tracker?.listElement &&
			currentList.nodeType === Node.ELEMENT_NODE &&
			(currentList.tagName === 'UL' || currentList.tagName === 'OL') &&
			!getDirectListItems(currentList).length
		) {
			const parentItem = currentList.parentElement?.tagName === 'LI'
				? currentList.parentElement
				: null;
			currentList.remove();
			currentList = parentItem ? parentItem.parentElement : null;
		}
	}

	/**
	 * Build one new list item element from a structural operation payload.
	 *
	 * @param   {Object|null} operation Candidate operation payload.
	 * @returns {HTMLLIElement}         New list item element.
	 */
	function buildListItemFromOperation(operation) {
		const li = document.createElement('li');
		const directSurface = ensureDirectItemTextSurface(li);
		const runtimeUuid = normalizeRuntimeUuid(
			operation?.itemUuid
			?? operation?.newItemUuid
		);
		const html = typeof operation?.contentHtml === 'string'
			? operation.contentHtml
			: (typeof operation?.html === 'string' ? operation.html : '');
		const text = typeof operation?.contentText === 'string'
			? operation.contentText
			: (typeof operation?.text === 'string' ? operation.text : '');

		if (html) {
			directSurface.innerHTML = html;
		} else if (text) {
			directSurface.textContent = text;
		}

		if (runtimeUuid) {
			li.setAttribute(LIST_ITEM_RUNTIME_UUID_ATTR, runtimeUuid);
		}

		return li;
	}

	/**
	 * Copy one donor item's structural/style attributes onto the destination list
	 * item while preserving the destination runtime UUID.
	 *
	 * Native Enter list splitting happens inside the browser's contenteditable
	 * engine, so the new sibling inherits the source `li` element's attributes
	 * such as class and style automatically. API-driven insert/move operations
	 * should mirror that behavior by cloning the donor item's `li` attributes,
	 * except for the session-scoped runtime UUID which must stay unique.
	 *
	 * @param   {HTMLLIElement|null} listItem   Destination list item.
	 * @param   {HTMLLIElement|null} donorItem  Style/structure donor item.
	 * @returns {void}
	 */
	function copyDonorItemAttributes(listItem, donorItem) {
		if (
			!listItem ||
			listItem.nodeType !== Node.ELEMENT_NODE ||
			listItem.tagName !== 'LI' ||
			!donorItem ||
			donorItem.nodeType !== Node.ELEMENT_NODE ||
			donorItem.tagName !== 'LI'
		) {
			return;
		}

		const destinationRuntimeUuid = normalizeRuntimeUuid(
			listItem.getAttribute(LIST_ITEM_RUNTIME_UUID_ATTR)
		);

		Array.from(listItem.attributes || []).forEach(attr => {
			if (attr?.name === LIST_ITEM_RUNTIME_UUID_ATTR) {
				return;
			}

			listItem.removeAttribute(attr.name);
		});

		Array.from(donorItem.attributes || []).forEach(attr => {
			if (attr?.name === LIST_ITEM_RUNTIME_UUID_ATTR) {
				return;
			}

			listItem.setAttribute(attr.name, attr.value);
		});

		if (destinationRuntimeUuid) {
			listItem.setAttribute(LIST_ITEM_RUNTIME_UUID_ATTR, destinationRuntimeUuid);
		}
	}

	/**
	 * Reassign one list item's structural ID from its destination styling
	 * context.
	 *
	 * When an explicit target item is known, its structural `data-item-id`
	 * becomes the style donor for insert-before, insert-after, move-before, and
	 * move-after commands. This keeps the inheritance rule simple and matches the
	 * public API's explicit `targetItemUuid` model.
	 *
	 * For internal list-path insert/move cases that do not resolve through one
	 * target item, fall back to the local destination neighbors. If there is no
	 * neighboring item at all, clear the structural ID so the next tracker rebuild
	 * seeds a fresh item identity instead of accidentally preserving source attrs.
	 *
	 * @param   {HTMLLIElement|null} listItem    Destination list item.
	 * @param   {HTMLLIElement|null} targetItem Explicit style donor item.
	 * @returns {string}                     Applied structural ID or an empty string.
	 */
	function inheritDestinationItemId(listItem, targetItem = null) {
		if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
			return '';
		}

		const explicitTargetItem = targetItem && targetItem.nodeType === Node.ELEMENT_NODE && targetItem.tagName === 'LI'
			? targetItem
			: null;
		const previousItem = listItem.previousElementSibling?.tagName === 'LI'
			? listItem.previousElementSibling
			: null;
		const nextItem = listItem.nextElementSibling?.tagName === 'LI'
			? listItem.nextElementSibling
			: null;
		const inheritedId = normalizeRuntimeUuid(
			explicitTargetItem?.getAttribute(LIST_ITEM_ID_ATTR)
			|| previousItem?.getAttribute(LIST_ITEM_ID_ATTR)
			|| nextItem?.getAttribute(LIST_ITEM_ID_ATTR)
		);

		if (inheritedId) {
			listItem.setAttribute(LIST_ITEM_ID_ATTR, inheritedId);
			return inheritedId;
		}

		listItem.removeAttribute(LIST_ITEM_ID_ATTR);
		return '';
	}

	/**
	 * Apply one remove-list-item operation.
	 *
	 * @param   {Object|null}    tracker  Active list tracker.
	 * @param   {HTMLLIElement}  listItem Target list item.
	 * @returns {boolean}                True when the mutation applied.
	 */
	function applyRemoveListItemOperation(tracker, listItem) {
		if (!tracker?.listElement || !listItem) {
			return false;
		}

		const oldParentList = listItem.parentElement;
		listItem.remove();
		cleanupEmptyAncestorLists(tracker, oldParentList);
		return true;
	}

	/**
	 * Apply one indent-list-item operation.
	 *
	 * @param   {Object|null}    tracker  Active list tracker.
	 * @param   {HTMLLIElement}  listItem Target list item.
	 * @returns {boolean}                True when the mutation applied.
	 */
	function applyIndentListItemOperation(tracker, listItem) {
		if (!tracker?.listElement || !listItem) {
			return false;
		}

		const previousItem = listItem.previousElementSibling?.tagName === 'LI'
			? listItem.previousElementSibling
			: null;
		if (!previousItem) {
			return false;
		}

		const nestedList = ensureDirectChildList(tracker, previousItem);

		nestedList.appendChild(listItem);
		return true;
	}

	/**
	 * Apply one outdent-list-item operation.
	 *
	 * @param   {Object|null}    tracker  Active list tracker.
	 * @param   {HTMLLIElement}  listItem Target list item.
	 * @returns {boolean}                True when the mutation applied.
	 */
	function applyOutdentListItemOperation(tracker, listItem) {
		if (!tracker?.listElement || !listItem) {
			return false;
		}

		const parentList = listItem.parentElement;
		const parentItem = parentList?.parentElement?.tagName === 'LI'
			? parentList.parentElement
			: null;
		if (!parentList || !parentItem) {
			return false;
		}

		const ancestorList = parentItem.parentElement;
		const followingSiblings = [];
		let next = listItem.nextElementSibling;
		while (next) {
			followingSiblings.push(next);
			next = next.nextElementSibling;
		}

		ancestorList.insertBefore(listItem, parentItem.nextElementSibling);
		if (followingSiblings.length) {
			const nestedList = ensureDirectChildList(tracker, listItem, parentList.tagName);
			followingSiblings.forEach(sibling => nestedList.appendChild(sibling));
		}

		cleanupEmptyAncestorLists(tracker, parentList);
		return true;
	}

	/**
	 * Apply one toggle-list-type operation.
	 *
	 * @param   {Object|null} tracker      Active list tracker.
	 * @param   {Object}      rawOperation Structural operation payload.
	 * @param   {Object}      options      Apply-operation options.
	 * @returns {boolean}                  True when the mutation applied.
	 */
	function applyToggleListTypeOperation(tracker, rawOperation, options = {}) {
		if (!tracker?.listElement) {
			return false;
		}

		const listPath = rawOperation.listPath ?? rawOperation.list_path ?? '';
		const targetList = getListByPath(tracker, listPath);
		const editorHost = options?.editorHost && typeof options.editorHost.changeListType === 'function'
			? options.editorHost
			: null;
		const requestedType = targetList
			? (
				normalizeListTypeTagName(
					rawOperation.value
					?? rawOperation.listType
					?? rawOperation.list_type
					?? rawOperation.ordered
				) || (targetList.tagName === 'OL' ? 'UL' : 'OL')
			)
			: '';

		if (
			!targetList ||
			!requestedType ||
			targetList.tagName === requestedType ||
			!editorHost
		) {
			return false;
		}

		const nextList = editorHost.changeListType(targetList, requestedType.toLowerCase(), {
			saveHistory: options.saveHistory !== false,
			restoreCursor: options.restoreCursor !== false,
		});
		return !!nextList;
	}

	/**
	 * Apply one update-list-item-text operation.
	 *
	 * @param   {HTMLLIElement} listItem     Target list item.
	 * @param   {Object}        rawOperation Structural operation payload.
	 * @returns {boolean}                   True when the mutation applied.
	 */
	function applyUpdateListItemTextOperation(listItem, rawOperation) {
		if (!listItem) {
			return false;
		}

		const directSurface = ensureDirectItemTextSurface(listItem);
		const html = typeof rawOperation?.contentHtml === 'string'
			? rawOperation.contentHtml
			: (typeof rawOperation?.html === 'string' ? rawOperation.html : '');
		const text = typeof rawOperation?.contentText === 'string'
			? rawOperation.contentText
			: (typeof rawOperation?.text === 'string' ? rawOperation.text : '');

		if (!directSurface) {
			return false;
		}

		directSurface.innerHTML = '';
		if (html) {
			directSurface.innerHTML = html;
		} else if (text) {
			directSurface.textContent = text;
		}

		return true;
	}

	/**
	 * Insert one new list item relative to explicit before/after/list anchors.
	 *
	 * @param   {Object|null} tracker      Active list tracker.
	 * @param   {Object}      rawOperation Structural operation payload.
	 * @param   {Object}      trackerApi   List tracker API surface.
	 * @returns {boolean}                  True when the mutation applied.
	 */
	function applyInsertListItemOperation(tracker, rawOperation, trackerApi) {
		if (!tracker?.listElement || !trackerApi) {
			return false;
		}

		const beforePath = rawOperation.beforePath ?? rawOperation.before_path ?? '';
		const afterPath = rawOperation.afterPath ?? rawOperation.after_path ?? '';
		const listPath = rawOperation.listPath ?? rawOperation.list_path ?? '';
		const beforeItem = trackerApi.getItemByPath(tracker, beforePath);
		const afterItem = trackerApi.getItemByPath(tracker, afterPath);
		const newListItem = buildListItemFromOperation(rawOperation);

		if (beforeItem?.parentElement) {
			beforeItem.parentElement.insertBefore(newListItem, beforeItem);
			copyDonorItemAttributes(newListItem, beforeItem);
			inheritDestinationItemId(newListItem, beforeItem);
			return true;
		}

		if (afterItem?.parentElement) {
			afterItem.parentElement.insertBefore(newListItem, afterItem.nextElementSibling);
			copyDonorItemAttributes(newListItem, afterItem);
			inheritDestinationItemId(newListItem, afterItem);
			return true;
		}

		const targetList = getListByPath(tracker, listPath);
		if (!targetList) {
			return false;
		}

		const position = typeof rawOperation.position === 'string'
			? rawOperation.position.trim().toLowerCase()
			: 'append';
		if (position === 'prepend' && targetList.firstElementChild) {
			targetList.insertBefore(newListItem, targetList.firstElementChild);
		} else {
			targetList.appendChild(newListItem);
		}
		inheritDestinationItemId(newListItem);
		return true;
	}

	/**
	 * Move one existing list item relative to explicit before/after/list anchors.
	 *
	 * @param   {Object|null}    tracker      Active list tracker.
	 * @param   {HTMLLIElement}  listItem     Target list item.
	 * @param   {Object}         rawOperation Structural operation payload.
	 * @param   {Object}         trackerApi   List tracker API surface.
	 * @returns {boolean}                    True when the mutation applied.
	 */
	function applyMoveListItemOperation(tracker, listItem, rawOperation, trackerApi) {
		if (!tracker?.listElement || !listItem || !trackerApi) {
			return false;
		}

		const beforePath = rawOperation.beforePath ?? rawOperation.before_path ?? '';
		const afterPath = rawOperation.afterPath ?? rawOperation.after_path ?? '';
		const listPath = rawOperation.listPath ?? rawOperation.list_path ?? '';
		const beforeItem = trackerApi.getItemByPath(tracker, beforePath);
		const afterItem = trackerApi.getItemByPath(tracker, afterPath);
		const oldParentList = listItem.parentElement;
		let didApply = false;

		if (beforeItem && beforeItem !== listItem && !listItem.contains(beforeItem)) {
			beforeItem.parentElement.insertBefore(listItem, beforeItem);
			copyDonorItemAttributes(listItem, beforeItem);
			inheritDestinationItemId(listItem, beforeItem);
			didApply = true;
		} else if (afterItem && afterItem !== listItem && !listItem.contains(afterItem)) {
			afterItem.parentElement.insertBefore(listItem, afterItem.nextElementSibling);
			copyDonorItemAttributes(listItem, afterItem);
			inheritDestinationItemId(listItem, afterItem);
			didApply = true;
		} else if (typeof listPath === 'string') {
			const targetList = getListByPath(tracker, listPath);
			const ownerItem = targetList?.parentElement?.tagName === 'LI'
				? targetList.parentElement
				: null;

			if (targetList && ownerItem !== listItem && !listItem.contains(ownerItem || null)) {
				const position = typeof rawOperation.position === 'string'
					? rawOperation.position.trim().toLowerCase()
					: 'append';
				if (position === 'prepend' && targetList.firstElementChild) {
					targetList.insertBefore(listItem, targetList.firstElementChild);
				} else {
					targetList.appendChild(listItem);
				}
				inheritDestinationItemId(listItem);
				didApply = true;
			}
		}

		if (didApply) {
			cleanupEmptyAncestorLists(tracker, oldParentList);
		}

		return didApply;
	}

	/**
	 * Resolve one tracked list element from a list-path payload.
	 *
	 * The root list lives at the empty path. Nested lists are addressed by the
	 * tree path of the parent item that owns that child list.
	 *
	 * @param   {Object|null}            tracker   Active list tracker.
	 * @param   {string|Array<number>}   pathValue Root-empty list path or parent-item path.
	 * @returns {HTMLElement|null}                 Matching list element.
	 */
	function getListByPath(tracker, pathValue) {
		if (!tracker?.listElement) {
			return null;
		}

		if (
			pathValue === '' ||
			pathValue === null ||
			typeof pathValue === 'undefined' ||
			(Array.isArray(pathValue) && !pathValue.length) ||
			(typeof pathValue === 'string' && !pathValue.trim())
		) {
			return tracker.listElement;
		}

		const parentItem = ListBlockTracker.getItemByPath(tracker, pathValue);
		return parentItem ? getDirectChildList(parentItem) : null;
	}

	/**
	 * Normalize one requested list-type value to a DOM tag name.
	 *
	 * @param   {*} value Candidate list-type value.
	 * @returns {string}  `OL`, `UL`, or an empty string.
	 */
	function normalizeListTypeTagName(value) {
		if (value === true) {
			return 'OL';
		}
		if (value === false) {
			return 'UL';
		}

		const normalized = String(value || '').trim().toLowerCase();
		if (normalized === 'ordered' || normalized === 'ol' || normalized === 'true') {
			return 'OL';
		}
		if (normalized === 'unordered' || normalized === 'ul' || normalized === 'false') {
			return 'UL';
		}

		return '';
	}

    const ListBlockTracker = {
        active: null,
        
        /**
         * Initialize tracker for a list element
         * @param {HTMLElement} listElement - The UL or OL element
         * @param {Object} originalBlock - The complete WordPress block structure
         */
        init(listElement, originalBlock = {}) {
            if (!createBlock || !serializeBlocks) {
				console.error('wp.blocks not available');
			}

            const tracker = {
                listElement,
                originalBlock: JSON.parse(JSON.stringify(originalBlock)),
                uuidMap: new Map(),  // uuid -> {type, attrs, element}
                domMap:  new WeakMap(),  // element -> uuid
                runtimeUuidMap: new Map(), // runtimeUuid -> {type, element}
                runtimeDomMap: new WeakMap() // element -> runtimeUuid
            };
            
			// Attach tracker to element to avoid singleton issues
    		listElement._mwpListTracker = tracker;

            // Build UUID tracking from DOM and original block structure
            this.buildFromDOM(tracker, listElement, originalBlock);
            this.active = tracker;
            return tracker;
        },
        
        /**
         * Build UUID mappings from DOM and original block structure
         * Assigns UUIDs to all lists and list items, mapping to their original attrs
         */
        buildFromDOM(tracker, listElement, originalBlock) {
			const previousEntries = tracker.uuidMap instanceof Map
				? new Map(tracker.uuidMap)
				: new Map();
			const previousRuntimeEntries = tracker.runtimeUuidMap instanceof Map
				? new Map(tracker.runtimeUuidMap)
				: new Map();

            tracker.uuidMap.clear();
            tracker.domMap = new WeakMap();
            tracker.runtimeUuidMap.clear();
            tracker.runtimeDomMap = new WeakMap();
            tracker.listElement = listElement;
			this.syncEditableTextSurfaces(listElement);
            
			this.registerRuntimeIdentity(
				tracker,
				listElement,
				'list',
				previousRuntimeEntries
			);

            // Assign UUID to root list and map to original attrs
            const rootUuid = this.getOrCreateUuid(listElement, 'list');
			const previousRootEntry = previousEntries.get(rootUuid);
            tracker.uuidMap.set(rootUuid, {
                type:    'list',
                attrs:   previousRootEntry?.attrs
					? cloneListAttrs(previousRootEntry.attrs, true)
					: cloneListAttrs(originalBlock.attrs || {}, true),
                element: listElement
            });
            tracker.domMap.set(listElement, rootUuid);
            
            // Recursively process list structure
            this.processListRecursive(
				tracker,
				listElement,
				originalBlock.innerBlocks || [],
				previousEntries,
				previousRuntimeEntries
			);
        },
        
        /**
         * Recursively process list items and nested lists, assigning UUIDs
         */
        processListRecursive(
			tracker,
			listElement,
			originalItems,
			previousEntries = new Map(),
			previousRuntimeEntries = new Map()
		) {
            const items = getDirectListItems(listElement);
            
            items.forEach((li, index) => {
				this.syncEditableTextSurfaces(li);
                const originalItem = originalItems[index] || {};
				this.registerRuntimeIdentity(
					tracker,
					li,
					'item',
					previousRuntimeEntries
				);
                const itemUuid     = this.getOrCreateUuid(li, 'item');
				const previousItemEntry = previousEntries.get(itemUuid);
                
                // Map UUID to original item attrs
                tracker.uuidMap.set(itemUuid, {
                    type:    'item',
                    attrs:   previousItemEntry?.attrs
						? JSON.parse(JSON.stringify(previousItemEntry.attrs || {}))
						: JSON.parse(JSON.stringify(originalItem.attrs || {})),
                    element: li
                });
                tracker.domMap.set(li, itemUuid);
                
                // Handle nested lists
                const nestedList = getDirectChildList(li);
                if (nestedList) {
                    const originalNested = originalItem.innerBlocks?.[0] || {};
					this.registerRuntimeIdentity(
						tracker,
						nestedList,
						'list',
						previousRuntimeEntries
					);
                    const nestedUuid     = this.getOrCreateUuid(nestedList, 'list');
					const previousNestedEntry = previousEntries.get(nestedUuid);
                    
                    // Map nested list attrs without plugin UUID ownership.
                    // The tracker still needs a temporary DOM identity for list
                    // editing, but persisting mwpSfeUuid* on nested lists would
                    // fracture one logical list into multiple save/history roots.
                    tracker.uuidMap.set(nestedUuid, {
                        type:    'list',
                        attrs:   previousNestedEntry?.attrs
							? cloneListAttrs(previousNestedEntry.attrs, false)
							: cloneListAttrs(originalNested.attrs || {}, false),
                        element: nestedList
                    });
                    tracker.domMap.set(nestedList, nestedUuid);
                    
                    // Recurse into nested list
                    this.processListRecursive(
						tracker,
						nestedList,
						originalNested.innerBlocks || [],
						previousEntries,
						previousRuntimeEntries
					);
                }
            });
        },

		/**
		 * Register one list or list-item runtime identity on the tracker.
		 *
		 * @param   {Object}   tracker                Active list tracker.
		 * @param   {Element}  element                Live list or list-item element.
		 * @param   {string}   type                   Supported runtime identity type.
		 * @param   {Map}      previousRuntimeEntries Previous runtime entry map.
		 * @returns {string}                          Resolved runtime UUID.
		 */
		registerRuntimeIdentity(
			tracker,
			element,
			type,
			previousRuntimeEntries = new Map()
		) {
			const runtimeUuid = this.getOrCreateRuntimeUuid(
				tracker,
				element,
				type,
				previousRuntimeEntries
			);
			if (!runtimeUuid) {
				return '';
			}

			tracker.runtimeUuidMap.set(runtimeUuid, {
				type,
				element,
			});
			tracker.runtimeDomMap.set(element, runtimeUuid);
			return runtimeUuid;
		},

		/**
		 * Return whether one runtime UUID is already owned by a different element.
		 *
		 * Native contenteditable list splitting can clone DOM attributes from the
		 * source item into the newly created sibling. When that happens, the new
		 * runtime UUID must be reseeded so each live cursor target stays unique.
		 *
		 * @param   {Object}        tracker     Active list tracker.
		 * @param   {string}        runtimeUuid Candidate runtime UUID.
		 * @param   {Element|null}  element     Element requesting that UUID.
		 * @returns {boolean}                  True when the UUID belongs elsewhere.
		 */
		isRuntimeUuidClaimedByDifferentElement(tracker, runtimeUuid, element) {
			const normalizedRuntimeUuid = normalizeRuntimeUuid(runtimeUuid);
			if (!tracker?.runtimeUuidMap || !normalizedRuntimeUuid) {
				return false;
			}

			const existingEntry = tracker.runtimeUuidMap.get(normalizedRuntimeUuid);
			return !!(existingEntry?.element && existingEntry.element !== element);
		},
        
        /**
         * Get the inherited structural ID for an element or seed it from the
         * runtime UUID when it does not exist yet.
         *
         * Structural IDs may be intentionally copied by native list splitting so
         * related items can retain style inheritance. They are not treated as
         * unique runtime cursor identifiers.
         */
        getOrCreateUuid(element, type) {
            const attrName = type === 'list' ? LIST_ID_ATTR : LIST_ITEM_ID_ATTR;
            let uuid       = element.getAttribute(attrName);
            
            if (!uuid) {
                uuid = normalizeRuntimeUuid(
					element.getAttribute(
						type === 'list'
							? LIST_RUNTIME_UUID_ATTR
							: LIST_ITEM_RUNTIME_UUID_ATTR
					)
				) || this.generateTempUuid();
                element.setAttribute(attrName, uuid);
            }
            
            return uuid;
        },

		/**
		 * Return the existing runtime UUID for one element or create one.
		 *
		 * Caller-supplied runtime UUIDs win for newly created items/lists. When an
		 * element already belongs to the previous tracker build, its existing
		 * runtime UUID is preserved so API references remain stable across rebuilds.
		 *
		 * @param   {Object}  tracker                Active list tracker.
		 * @param   {Element} element                Live list or list-item element.
		 * @param   {string}  type                   Supported runtime identity type.
		 * @param   {Map}     previousRuntimeEntries Previous runtime entry map.
		 * @returns {string}                         Session-scoped runtime UUID.
		 */
		getOrCreateRuntimeUuid(
			tracker,
			element,
			type,
			previousRuntimeEntries = new Map()
		) {
			const attrName = getRuntimeUuidAttributeName(type);
			if (!attrName || !isRuntimeIdentityElement(element, type)) {
				return '';
			}

			let runtimeUuid = normalizeRuntimeUuid(element.getAttribute(attrName));
			if (!runtimeUuid) {
				for (const [candidateUuid, entry] of previousRuntimeEntries.entries()) {
					if (entry?.element === element && entry.type === type) {
						runtimeUuid = normalizeRuntimeUuid(candidateUuid);
						break;
					}
				}
			}

			if (this.isRuntimeUuidClaimedByDifferentElement(tracker, runtimeUuid, element)) {
				runtimeUuid = '';
			}

			if (!runtimeUuid) {
				runtimeUuid = this.generateTempUuid();
			}

			element.setAttribute(attrName, runtimeUuid);
			return runtimeUuid;
		},
        
        /**
         * Generate a RFC4122 version 4 UUID
         */
        generateTempUuid() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },

		/**
		 * Return the zero-based tree path for one list item inside the tracked list.
		 *
		 * @param   {Object}          tracker   Active list tracker.
		 * @param   {HTMLLIElement}   listItem  Candidate list item.
		 * @returns {number[]|null}            Zero-based indexes, or null on failure.
		 */
		getPathIndexesForItem(tracker, listItem) {
			if (
				!tracker?.listElement ||
				!listItem ||
				listItem.nodeType !== Node.ELEMENT_NODE ||
				listItem.tagName !== 'LI' ||
				!tracker.listElement.contains(listItem)
			) {
				return null;
			}

			const indexes = [];
			let currentItem = listItem;
			while (currentItem && tracker.listElement.contains(currentItem)) {
				const parentList = currentItem.parentElement;
				if (!parentList || (parentList.tagName !== 'UL' && parentList.tagName !== 'OL')) {
					return null;
				}

				const siblingItems = getDirectListItems(parentList);
				const itemIndex = siblingItems.indexOf(currentItem);
				if (itemIndex < 0) {
					return null;
				}

				indexes.unshift(itemIndex);
				const nextItem = parentList.closest('li');
				if (!nextItem || !tracker.listElement.contains(nextItem)) {
					break;
				}
				currentItem = nextItem;
			}

			return indexes.length ? indexes : null;
		},

		/**
		 * Return the direct list item currently living at one tree path.
		 *
		 * @param   {Object}               tracker    Active list tracker.
		 * @param   {string|Array<number>} pathValue  Zero-based path value.
		 * @returns {HTMLLIElement|null}              Matching list item.
		 */
		getItemByPath(tracker, pathValue) {
			const indexes = normalizePathIndexes(pathValue);
			if (!tracker?.listElement || !Array.isArray(indexes) || !indexes.length) {
				return null;
			}

			let currentList = tracker.listElement;
			let currentItem = null;

			for (let index = 0; index < indexes.length; index++) {
				const itemIndex = indexes[index];
				const siblingItems = getDirectListItems(currentList);
				currentItem = siblingItems[itemIndex] || null;
				if (!currentItem) {
					return null;
				}

				if (index === indexes.length - 1) {
					return currentItem;
				}

				currentList = getDirectChildList(currentItem);
				if (!currentList) {
					return null;
				}
			}

			return currentItem;
		},

		/**
		 * Resolve one list element back to its public list path.
		 *
		 * The root list is addressed as an empty string. Nested child lists are
		 * addressed by the path of the parent list item that owns them.
		 *
		 * @param   {Object|null}      tracker     Active list tracker.
		 * @param   {HTMLElement|null} listElement Candidate list element.
		 * @returns {string}                      Root-relative list path.
		 */
		getPathForList(tracker, listElement) {
			if (!tracker) tracker = this.active;
			if (!tracker?.listElement || !listElement || listElement.nodeType !== Node.ELEMENT_NODE) {
				return '';
			}

			if (listElement === tracker.listElement) {
				return '';
			}

			const parentItem = (
				listElement.parentElement &&
				listElement.parentElement.tagName === 'LI'
			)
				? listElement.parentElement
				: null;
			if (!parentItem) {
				return '';
			}

			const indexes = this.getPathIndexesForItem(tracker, parentItem);
			return Array.isArray(indexes) ? indexes.join('_') : '';
		},

		/**
		 * Return one tracked list item by runtime UUID.
		 *
		 * @param   {Object|null}      tracker      Active list tracker.
		 * @param   {string}           runtimeUuid  Session-scoped item UUID.
		 * @returns {HTMLLIElement|null}            Matching list item.
		 */
		getItemByRuntimeUuid(tracker, runtimeUuid) {
			if (!tracker) tracker = this.active;
			const element = findElementByRuntimeUuid(tracker, runtimeUuid, 'item');
			return element && element.tagName === 'LI' ? element : null;
		},

		/**
		 * Return one tracked list by runtime UUID.
		 *
		 * @param   {Object|null}      tracker      Active list tracker.
		 * @param   {string}           runtimeUuid  Session-scoped list UUID.
		 * @returns {HTMLElement|null}              Matching list element.
		 */
		getListByRuntimeUuid(tracker, runtimeUuid) {
			if (!tracker) tracker = this.active;
			const element = findElementByRuntimeUuid(tracker, runtimeUuid, 'list');
			return isListElementForRuntimeLookup(element) ? element : null;
		},

		/**
		 * Return the runtime UUID for one tracked list item.
		 *
		 * @param   {Object|null}      tracker   Active list tracker.
		 * @param   {HTMLLIElement}    listItem  Live list item.
		 * @returns {string}                    Session-scoped item UUID.
		 */
		getRuntimeUuidForItem(tracker, listItem) {
			if (!tracker) tracker = this.active;
			if (!tracker?.listElement || !listItem || listItem.tagName !== 'LI') {
				return '';
			}

			return normalizeRuntimeUuid(
				listItem.getAttribute(LIST_ITEM_RUNTIME_UUID_ATTR)
					|| tracker.runtimeDomMap?.get(listItem)
			);
		},

		/**
		 * Return the runtime UUID for one tracked list.
		 *
		 * @param   {Object|null}      tracker     Active list tracker.
		 * @param   {HTMLElement}      listElement Live list element.
		 * @returns {string}                      Session-scoped list UUID.
		 */
		getRuntimeUuidForList(tracker, listElement) {
			if (!tracker) tracker = this.active;
			if (!tracker?.listElement || !isListElementForRuntimeLookup(listElement)) {
				return '';
			}

			return normalizeRuntimeUuid(
				listElement.getAttribute(LIST_RUNTIME_UUID_ATTR)
					|| tracker.runtimeDomMap?.get(listElement)
			);
		},
        
        /**
         * Parse current DOM list structure to WordPress block format
         * Uses UUID to preserve original attrs, updates only content and ordered
         *
         * @param {HTMLElement} listElement         Live UL/OL element.
         * @param {Object}      tracker             Active list tracker.
         * @param {boolean}     allowUuidOwnership  True only for the outermost
         *                                          core/list. Nested lists must
         *                                          serialize without persisted
         *                                          plugin UUID attrs.
         */
        parseListToBlock(listElement, tracker, allowUuidOwnership = true) {
			const isOrdered = listElement.tagName === 'OL';
			const uuid      = listElement.getAttribute(LIST_ID_ATTR);
			let attrs       = { ordered: isOrdered };

			if (uuid && tracker && tracker.uuidMap.has(uuid)) {
				const original      = tracker.uuidMap.get(uuid);
				const originalAttrs = (Array.isArray(original.attrs) || !original.attrs)
					? {}
					: cloneListAttrs(original.attrs, allowUuidOwnership);
				attrs = { ...originalAttrs, ordered: isOrdered };
			}

			const listItems   = Array.from(listElement.children).filter(el => el.tagName === 'LI');
			const innerBlocks = listItems.map(li => this.parseListItemToBlock(li, tracker));

			return createBlock('core/list', attrs, innerBlocks);
		},
        
        /**
         * Parse a list item to WordPress block format
         * Preserves original attrs if UUID exists
         */
        parseListItemToBlock(liElement, tracker) {
			const uuid = liElement.getAttribute(LIST_ITEM_ID_ATTR);
			let attrs  = {};

			if (uuid && tracker && tracker.uuidMap.has(uuid)) {
				const original = tracker.uuidMap.get(uuid);
				attrs = JSON.parse(JSON.stringify(original.attrs || {}));
			}

			// Recurse into nested list using the live element before cloning
			const innerBlocks  = [];
			const nestedListEl = liElement.querySelector(':scope > ul, :scope > ol');
			if (nestedListEl) {
				innerBlocks.push(this.parseListToBlock(nestedListEl, tracker, false));
			}

			const clone         = liElement.cloneNode(true);
			const directSurface = clone.querySelector(`:scope > [${LIST_ITEM_TEXT_ATTR}="1"]`);
			let content         = '';

			if (directSurface) {
				const cleanedSurface = this.cleanElement(directSurface);
				content = cleanedSurface.innerHTML.trim();
			} else {
				const nestedInClone = clone.querySelector(':scope > ul, :scope > ol');
				if (nestedInClone) nestedInClone.remove();

				const cleaned = this.cleanElement(clone);
				content = cleaned.innerHTML.trim();
			}

			return createBlock('core/list-item', { ...attrs, content }, innerBlocks);
		},

        /**
         * Clean element using ElementPrep
         * Removes editing artifacts while preserving UUIDs and content
         */
        cleanElement(element) {
            if (SFE.ElementPrep) {
                return SFE.ElementPrep.clean(element, {
                    removeIdentity: true,
                    removeControls: true,
                    clone:          false  // Already working with a clone
                });
            }
            
            console.error('ElementPrep not found');
            return element;
        },
        
        /**
         * Serialize the current list structure to WordPress block format
         * Preserves all original attrs, updates only content and ordered
         */
        serialize(tracker) {
			if (!tracker) tracker = this.active;
			if (!tracker) return null;

			const block = this.parseListToBlock(tracker.listElement, tracker);
			return serializeBlocks([block]);
		},
        
        /**
         * Update the tracker's element reference
         * Used when the list element is replaced (e.g., OL to UL conversion)
         */
		updateElement(tracker, newElement) {
            if (!tracker) tracker = this.active;
            if (!tracker) return;

			// Ensure new element keeps the tracker reference
    		newElement._mwpListTracker = tracker;
			this.syncEditableTextSurfaces(newElement);
            
            tracker.listElement = newElement;
            
            // Update element references in uuidMap
            tracker.uuidMap.forEach((value, key) => {
                if (value.type === 'list') {
                    const newEl = newElement.querySelector(`[${LIST_ID_ATTR}="${key}"]`) || 
                                 (newElement.getAttribute(LIST_ID_ATTR) === key ? newElement : null);
                    if (newEl) {
                        value.element = newEl;
                    }
                } else if (value.type === 'item') {
                    const newEl = newElement.querySelector(`[${LIST_ITEM_ID_ATTR}="${key}"]`);
                    if (newEl) {
                        value.element = newEl;
                    }
                }
            });

			tracker.runtimeUuidMap.forEach((value, key) => {
				if (value.type === 'list') {
					const newEl = this.getListByRuntimeUuid(tracker, key);
					if (newEl) {
						value.element = newEl;
						tracker.runtimeDomMap.set(newEl, key);
					}
				} else if (value.type === 'item') {
					const newEl = this.getItemByRuntimeUuid(tracker, key);
					if (newEl) {
						value.element = newEl;
						tracker.runtimeDomMap.set(newEl, key);
					}
				}
			});
        },

		/**
		 * Return one tree-aware structural snapshot for the active list.
		 *
		 * @param   {Object|null} tracker Active list tracker.
		 * @returns {Object|null}         Lightweight structure snapshot.
		 */
		getStructure(tracker) {
			if (!tracker) tracker = this.active;
			if (!tracker?.listElement) {
				return null;
			}

			const buildListNode = (listElement, listPath = '', parentIndexes = []) => ({
				listUuid: this.getRuntimeUuidForList(tracker, listElement),
				listPath,
				ordered: listElement.tagName === 'OL',
				items: getDirectListItems(listElement).map((listItem, index) => {
					const indexes = [ ...parentIndexes, index ];
					const pathMeta = buildPathMeta(indexes);
					const directSurface = ensureDirectItemTextSurface(listItem);
					const nestedList = getDirectChildList(listItem);

					return {
						itemUuid: this.getRuntimeUuidForItem(tracker, listItem),
						path: pathMeta.path,
						pathLabel: pathMeta.pathLabel,
						depth: pathMeta.depth,
						contentHtml: directSurface ? directSurface.innerHTML.trim() : '',
						childList: nestedList
							? buildListNode(nestedList, pathMeta.path, indexes)
							: null,
					};
				}),
			});

			return buildListNode(tracker.listElement, '', []);
		},

		/**
		 * Apply one primitive structural list operation against the live tracked
		 * DOM.
		 *
		 * Public API calls are translated into this lower-level operation set by
		 * the shared schema executor so the tracker only needs to understand the
		 * canonical primitive mutation layer.
		 *
		 * Supported primitive kinds:
		 * - `insert_list_item`
		 * - `remove_list_item`
		 * - `move_list_item`
		 * - `indent_list_item`
		 * - `outdent_list_item`
		 * - `update_list_item_text`
		 * - `toggle_list_type`
		 *
		 * @param   {Object|null} tracker      Active list tracker.
		 * @param   {Object}      rawOperation Structural operation payload.
		 * @returns {Object|null}              Result summary when applied.
		 */
		applyOperation(tracker, rawOperation, options = {}) {
			if (!tracker) tracker = this.active;
			if (!tracker?.listElement || !rawOperation || typeof rawOperation !== 'object') {
				return null;
			}

			const kind = typeof rawOperation.kind === 'string' ? rawOperation.kind.trim().toLowerCase() : '';
			const path = rawOperation.path ?? rawOperation.itemPath ?? rawOperation.item_path ?? '';
			const listItem = this.getItemByPath(tracker, path);
			let didApply = false;

			if (kind === 'remove_list_item' && listItem) {
				didApply = applyRemoveListItemOperation(tracker, listItem);
			} else if (kind === 'indent_list_item' && listItem) {
				didApply = applyIndentListItemOperation(tracker, listItem);
			} else if (kind === 'outdent_list_item' && listItem) {
				didApply = applyOutdentListItemOperation(tracker, listItem);
			} else if (kind === 'toggle_list_type') {
				didApply = applyToggleListTypeOperation(tracker, rawOperation, options);
			} else if (kind === 'update_list_item_text' && listItem) {
				didApply = applyUpdateListItemTextOperation(listItem, rawOperation);
			} else if (kind === 'insert_list_item') {
				didApply = applyInsertListItemOperation(tracker, rawOperation, this);
			} else if (kind === 'move_list_item' && listItem) {
				didApply = applyMoveListItemOperation(tracker, listItem, rawOperation, this);
			}

			if (!didApply) {
				return null;
			}

			this.syncEditableTextSurfaces(tracker.listElement);
			this.buildFromDOM(tracker, tracker.listElement, tracker.originalBlock || {});

			return {
				kind,
				structure: this.getStructure(tracker),
			};
		},

		/**
		 * Ensure every list item in one tree has one direct text surface.
		 *
		 * @param   {HTMLElement|null} rootElement Candidate list root or list item.
		 * @returns {HTMLElement|null}            Normalized root element.
		 */
		syncEditableTextSurfaces(rootElement) {
			if (!rootElement || rootElement.nodeType !== Node.ELEMENT_NODE) {
				return null;
			}

			if (rootElement.tagName === 'LI') {
				ensureDirectItemTextSurface(rootElement);
				Array.from(rootElement.children || [])
					.filter(child => isNestedListNode(child))
					.forEach(childList => this.syncEditableTextSurfaces(childList));
				return rootElement;
			}

			if (rootElement.tagName !== 'UL' && rootElement.tagName !== 'OL') {
				return rootElement;
			}

			Array.from(rootElement.children || [])
				.filter(child => child.tagName === 'LI')
				.forEach(li => this.syncEditableTextSurfaces(li));
			return rootElement;
		},

		/**
		 * Ensure runtime UUID attributes are unique within one live list tree.
		 *
		 * Native contenteditable list splitting can clone `li` and nested list
		 * attributes verbatim before FrontEdit regains control. This pass reseeds only the
		 * session-scoped runtime UUID attributes so freshly created structures become
		 * distinct live API/editor targets immediately, while leaving `data-item-id`
		 * and `data-list-id` untouched for their separate responsibilities.
		 *
		 * @param   {HTMLElement|null} rootElement Candidate list root.
		 * @returns {HTMLElement|null}            Normalized root element.
		 */
		ensureUniqueRuntimeUuids(rootElement) {
			if (
				!rootElement ||
				rootElement.nodeType !== Node.ELEMENT_NODE ||
				(rootElement.tagName !== 'UL' && rootElement.tagName !== 'OL')
			) {
				return rootElement || null;
			}

			const seenListRuntimeUuids = new Set();
			const seenItemRuntimeUuids = new Set();
			const collectLists = [ rootElement, ...Array.from(rootElement.querySelectorAll('ul, ol')) ];
			const collectItems = Array.from(rootElement.querySelectorAll('li'));

			collectLists.forEach(listElement => {
				const runtimeUuid = normalizeRuntimeUuid(
					listElement.getAttribute(LIST_RUNTIME_UUID_ATTR)
				);
				if (!runtimeUuid) {
					return;
				}

				if (seenListRuntimeUuids.has(runtimeUuid)) {
					listElement.setAttribute(LIST_RUNTIME_UUID_ATTR, this.generateTempUuid());
					return;
				}

				seenListRuntimeUuids.add(runtimeUuid);
			});

			collectItems.forEach(listItem => {
				const runtimeUuid = normalizeRuntimeUuid(
					listItem.getAttribute(LIST_ITEM_RUNTIME_UUID_ATTR)
				);
				if (!runtimeUuid) {
					return;
				}

				if (seenItemRuntimeUuids.has(runtimeUuid)) {
					listItem.setAttribute(LIST_ITEM_RUNTIME_UUID_ATTR, this.generateTempUuid());
					return;
				}

				seenItemRuntimeUuids.add(runtimeUuid);
			});

			return rootElement;
		},

		/**
		 * Ensure one live list tree has the required structural IDs and runtime UUIDs.
		 *
		 * On first editor activation, list elements may not yet have either identity
		 * attribute family. Seed both from one generated UUID per element so the
		 * initial history snapshot captures stable targeting data. Later native list
		 * splits may intentionally copy the structural IDs; in those cases this pass
		 * preserves the structural IDs and only reseeds duplicated runtime UUIDs.
		 *
		 * @param   {HTMLElement|null} rootElement Candidate list root.
		 * @returns {HTMLElement|null}            Normalized root element.
		 */
		ensureIdentityAttributes(rootElement) {
			if (
				!rootElement ||
				rootElement.nodeType !== Node.ELEMENT_NODE ||
				(rootElement.tagName !== 'UL' && rootElement.tagName !== 'OL')
			) {
				return rootElement || null;
			}

			const syncIdentityPair = (element, structuralAttrName, runtimeAttrName) => {
				if (!element || element.nodeType !== Node.ELEMENT_NODE) {
					return;
				}

				let structuralId = normalizeRuntimeUuid(
					element.getAttribute(structuralAttrName)
				);
				let runtimeUuid = normalizeRuntimeUuid(
					element.getAttribute(runtimeAttrName)
				);

				if (!structuralId && !runtimeUuid) {
					runtimeUuid = this.generateTempUuid();
					structuralId = runtimeUuid;
				} else if (!runtimeUuid) {
					runtimeUuid = structuralId;
				} else if (!structuralId) {
					structuralId = runtimeUuid;
				}

				element.setAttribute(structuralAttrName, structuralId);
				element.setAttribute(runtimeAttrName, runtimeUuid);
			};

			syncIdentityPair(rootElement, LIST_ID_ATTR, LIST_RUNTIME_UUID_ATTR);

			Array.from(rootElement.querySelectorAll('ul, ol')).forEach(listElement => {
				syncIdentityPair(listElement, LIST_ID_ATTR, LIST_RUNTIME_UUID_ATTR);
			});

			Array.from(rootElement.querySelectorAll('li')).forEach(listItem => {
				syncIdentityPair(listItem, LIST_ITEM_ID_ATTR, LIST_ITEM_RUNTIME_UUID_ATTR);
			});

			return this.ensureUniqueRuntimeUuids(rootElement);
		},

		getDirectItemTextSurface,

		normalizePathIndexes,

		buildPathMeta,

		getRuntimeUuidAttributeName,

		getListRuntimeUuidAttributeName() {
			return LIST_RUNTIME_UUID_ATTR;
		},

		getListItemRuntimeUuidAttributeName() {
			return LIST_ITEM_RUNTIME_UUID_ATTR;
		},

		getListIdAttributeName() {
			return LIST_ID_ATTR;
		},

		getListItemIdAttributeName() {
			return LIST_ITEM_ID_ATTR;
		},
        
        /**
         * Destroy tracker and clean up
         */
        destroy(tracker) {
			if (!tracker) tracker = this.active;
			if (!tracker) return;

			tracker.uuidMap.clear();
			tracker.runtimeUuidMap.clear();
			if (tracker.listElement) {
				delete tracker.listElement._mwpListTracker;
			}
			if (this.active === tracker) this.active = null;
		}
    };

	/**
	 * Return whether one element is a live list node for runtime lookup helpers.
	 *
	 * @param   {Element|null} element Candidate DOM element.
	 * @returns {boolean}              True when the element is `UL` or `OL`.
	 */
	function isListElementForRuntimeLookup(element) {
		return !!(
			element &&
			element.nodeType === Node.ELEMENT_NODE &&
			(element.tagName === 'UL' || element.tagName === 'OL')
		);
	}

    // Expose globally
    SFE.ListBlockTracker = ListBlockTracker;

})();
