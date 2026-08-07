/**
 * Rich text editor core used by frontend inline editing.
 *
 * Exposes: SFE.MWPEditor
 */

(function() {
	'use strict';

window.MWP      = window.MWP || {};
window.MWP.SFE  = window.MWP.SFE || {};
const SFE       = window.MWP.SFE;
SFE.ManagerData = SFE.ManagerData || {};

const PLACEHOLDER_ATTR                  = 'data-rich-text-placeholder';
const PLACEHOLDER_CLASS                 = 'mwp-sfe-rich-text-placeholder';
const PLACEHOLDER_ROOT_CLASSES          = [ 'mwp-sfe-rich-text-has-placeholder', 'mwp-sfe-rich-text-show-placeholder' ];
const PLACEHOLDER_ANCHOR_CHAR           = '\uFEFF';
const LEGACY_INLINE_TAG_MAP             = { B: 'STRONG', I: 'EM', STRIKE: 'S' };
const EMPTY_INLINE_TAG_SELECTOR         = 'a, b, strong, i, em, s, strike, u, span, code, mark, sub, sup, small';
const MEANINGFUL_EMBED_SELECTOR         = 'img, audio, video, iframe, embed, object, svg, canvas, hr, input, textarea, select, button, table';
const LIST_SELECT_ALL_SUPPRESS_CLASS    = 'mwp-sfe-list-select-all-pending';
const LIST_SELECT_ALL_SUPPRESS_STYLE_ID = 'mwp-sfe-list-select-all-suppress-style';

/**
 * Ensure temporary selection-suppression styles exist for context-menu list
 * select-all flows.
 *
 * The browser may briefly paint its native whole-block selection before the
 * editor remaps the range back to the current list item. These styles hide
 * that intermediate paint so the final list-item selection appears seamless.
 *
 * @returns {void}
 */
function ensureListSelectAllSuppressionStyles() {
	if (document.getElementById(LIST_SELECT_ALL_SUPPRESS_STYLE_ID)) {
		return;
	}

	const style = document.createElement('style');
	style.id = LIST_SELECT_ALL_SUPPRESS_STYLE_ID;
	style.textContent = [
		`.${LIST_SELECT_ALL_SUPPRESS_CLASS}::selection { background: transparent; color: inherit; }`,
		`.${LIST_SELECT_ALL_SUPPRESS_CLASS} *::selection { background: transparent; color: inherit; }`,
		`.${LIST_SELECT_ALL_SUPPRESS_CLASS}::-moz-selection { background: transparent; color: inherit; }`,
		`.${LIST_SELECT_ALL_SUPPRESS_CLASS} *::-moz-selection { background: transparent; color: inherit; }`
	].join('\n');
	document.head.appendChild(style);
}

/**
 * Determine whether the editable surface is a list root.
 *
 * @param   {HTMLElement|null}  element Candidate editable element.
 * @returns {boolean}                   True when the editable root is an ordered or unordered list.
 */
function isListRootElement(element) {
	return !!(
		element &&
		element.nodeType === Node.ELEMENT_NODE &&
		(element.tagName === 'OL' || element.tagName === 'UL')
	);
}

/**
 * Collect every list item contained by the editable list root.
 *
 * Nested list items remain part of the same list block/editor surface, so
 * placeholder syncing must visit the full tree rather than only top-level
 * children.
 *
 * @param   {HTMLElement|null} element List root element.
 * @returns {HTMLLIElement[]}         All nested list items owned by the editor.
 */
function getEditableListItems(element) {
	if (!isListRootElement(element) || typeof element.querySelectorAll !== 'function') {
		return [];
	}

	return Array.from(element.querySelectorAll('li'));
}

/**
 * Return the direct inline text surface for one list item when present.
 *
 * Shared-root list editing keeps the list block itself as the only live
 * editor surface, but list items may own a direct text wrapper used for
 * placeholder/caret handling and schema-backed targeting.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {HTMLElement|null}           Direct inline text surface, when present.
 */
function getListItemTextSurface(listItem) {
	if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
		return null;
	}

	const listTracker = SFE.ListBlockTracker || null;
	if (listTracker && typeof listTracker.getDirectItemTextSurface === 'function') {
		return listTracker.getDirectItemTextSurface(listItem);
	}

	return Array.from(listItem.children || []).find(child => (
		child &&
		child.nodeType === Node.ELEMENT_NODE &&
		child.getAttribute?.('data-mwp-sfe-list-item-text') === '1'
	)) || null;
}

/**
 * Return the DOM node that owns a list item's direct inline content.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {HTMLElement|null}           Direct content host used for placeholder and caret management.
 */
function getListItemContentHost(listItem) {
	return getListItemTextSurface(listItem) || listItem || null;
}

/**
 * Return the active list-item runtime UUID attribute name.
 *
 * The list tracker owns the canonical attribute name so history/caret restore
 * stays aligned with the public API's session-scoped list targeting contract.
 *
 * @returns {string} Runtime UUID attribute name.
 */
function getListItemRuntimeUuidAttributeName() {
	const listTracker = SFE.ListBlockTracker || null;
	if (listTracker && typeof listTracker.getListItemRuntimeUuidAttributeName === 'function') {
		return String(listTracker.getListItemRuntimeUuidAttributeName() || '').trim()
			|| 'data-mwp-sfe-list-item-runtime-uuid';
	}

	return 'data-mwp-sfe-list-item-runtime-uuid';
}

/**
 * Return the current session-scoped runtime UUID for one list item.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {string}                     Runtime UUID, or an empty string.
 */
function getListItemRuntimeUuid(listItem) {
	if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
		return '';
	}

	const listTracker = SFE.ListBlockTracker || null;
	if (listTracker && typeof listTracker.getRuntimeUuidForItem === 'function') {
		const tracker = listItem.closest('ul, ol')?._mwpListTracker || listTracker.active || null;
		const runtimeUuid = String(listTracker.getRuntimeUuidForItem(tracker, listItem) || '').trim();
		if (runtimeUuid) {
			return runtimeUuid;
		}
	}

	return String(listItem.getAttribute(getListItemRuntimeUuidAttributeName()) || '').trim();
}

/**
 * Return the inherited structural list-item ID attribute name.
 *
 * This ID can be intentionally copied across browser-created sibling items, so
 * it is a separate concern from the unique runtime UUID used for live API and
 * cursor targeting.
 *
 * @returns {string} Structural list-item ID attribute name.
 */
function getListItemIdAttributeName() {
	const listTracker = SFE.ListBlockTracker || null;
	if (listTracker && typeof listTracker.getListItemIdAttributeName === 'function') {
		return String(listTracker.getListItemIdAttributeName() || '').trim()
			|| 'data-item-id';
	}

	return 'data-item-id';
}

/**
 * Resolve the currently selected list item inside a list editor.
 *
 * @param   {HTMLElement|null} element List root element.
 * @returns {HTMLLIElement|null}      Active list item when the selection is inside one.
 */
function getSelectedEditableListItem(element) {
	if (!isListRootElement(element)) {
		return null;
	}

	const selection = window.getSelection();
	if (!selection || !selection.rangeCount) {
		return null;
	}

	let node = selection.getRangeAt(0).commonAncestorContainer;
	while (node && node !== element) {
		if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'LI') {
			return node;
		}
		node = node.parentNode;
	}

	return null;
}

/**
 * Find the closest list item ancestor for one DOM node inside a list editor.
 *
 * @param   {Node|null}        node    Candidate DOM node.
 * @param   {HTMLElement|null} element List root element.
 * @returns {HTMLLIElement|null}       Closest list item within the editor.
 */
function getClosestEditableListItem(node, element) {
	if (!node || !isListRootElement(element)) {
		return null;
	}

	let currentNode = node;
	while (currentNode && currentNode !== element) {
		if (currentNode.nodeType === Node.ELEMENT_NODE && currentNode.tagName === 'LI') {
			return currentNode;
		}

		currentNode = currentNode.parentNode;
	}

	return null;
}

/**
 * Resolve the list item that should own one expanded list selection.
 *
 * Triple-click selection can leak beyond the active list item and briefly land
 * in the next item's surface. When that happens, preserve the selection within
 * the originating list item instead of allowing cross-item ranges.
 *
 * @param   {HTMLElement|null}  element          List root element.
 * @param   {Range|null}        range            Live browser selection range.
 * @param   {HTMLLIElement|null} fallbackListItem Cached active list item.
 * @returns {HTMLLIElement|null}                 List item that should own the selection.
 */
function resolveExpandedListSelectionItem(element, range, fallbackListItem = null) {
	if (!isListRootElement(element) || !range) {
		return null;
	}

	const startListItem = getClosestEditableListItem(range.startContainer, element);
	const endListItem = getClosestEditableListItem(range.endContainer, element);

	if (startListItem && endListItem && startListItem === endListItem) {
		return startListItem;
	}

	if (
		fallbackListItem &&
		fallbackListItem.nodeType === Node.ELEMENT_NODE &&
		fallbackListItem.tagName === 'LI' &&
		element.contains(fallbackListItem)
	) {
		return fallbackListItem;
	}

	return startListItem || endListItem || null;
}

/**
 * Return whether one range stays fully inside the provided content host.
 *
 * @param   {Range|null}        range        Browser selection range.
 * @param   {HTMLElement|null} contentHost Direct list-item content host.
 * @returns {boolean}                      True when both range boundaries stay inside the host.
 */
function isRangeFullyInsideContentHost(range, contentHost) {
	if (!range || !contentHost || contentHost.nodeType !== Node.ELEMENT_NODE) {
		return false;
	}

	const contentRange = document.createRange();
	contentRange.selectNodeContents(contentHost);

	try {
		return (
			contentRange.comparePoint(range.startContainer, range.startOffset) === 0 &&
			contentRange.comparePoint(range.endContainer, range.endOffset) === 0
		);
	} catch (error) {
		return false;
	}
}

/**
 * Build a range covering only one list item's own editable inline content.
 *
 * Nested child lists remain outside this range so "select all" can mirror
 * Gutenberg and target only the current visual list item text surface.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {Range|null}                 Direct-content range when available.
 */
function createDirectListItemContentRange(listItem) {
	if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
		return null;
	}

	const contentHost = getListItemContentHost(listItem);
	if (!contentHost) {
		return null;
	}

	const range = document.createRange();
	range.selectNodeContents(contentHost);

	if (contentHost === listItem) {
		const nestedList = getListItemPlaceholderInsertionReference(listItem);
		if (nestedList) {
			range.setEndBefore(nestedList);
		}
	}

	return range;
}

/**
 * Find where a list-item placeholder should be inserted relative to nested
 * lists.
 *
 * The placeholder UI should sit in the inline text span of the list item, so
 * nested lists must stay after the placeholder anchor and span.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {ChildNode|null}             Nested list sibling to insert before, when present.
 */
function getListItemPlaceholderInsertionReference(listItem) {
	if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
		return null;
	}

	return Array.from(listItem.childNodes || []).find(node => (
		node &&
		node.nodeType === Node.ELEMENT_NODE &&
		(node.tagName === 'OL' || node.tagName === 'UL')
	)) || null;
}

/**
 * Determine whether a list item has direct text/media content of its own.
 *
 * Nested lists do not count as the parent item's content for placeholder
 * purposes because Gutenberg still shows a placeholder for an otherwise-empty
 * parent item that only owns child lists.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {boolean}                    True when the list item itself has meaningful content.
 */
function listItemHasMeaningfulContent(listItem) {
	if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
		return false;
	}

	const contentHost = getListItemContentHost(listItem);
	if (!contentHost) {
		return false;
	}

	for (const node of Array.from(contentHost.childNodes || [])) {
		if (!node) continue;

		if (node.nodeType === Node.TEXT_NODE) {
			if (String(node.textContent || '').replace(/\uFEFF/g, '').trim().length > 0) {
				return true;
			}
			continue;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			continue;
		}

		if (node.tagName === 'OL' || node.tagName === 'UL' || node.tagName === 'BR') {
			continue;
		}

		if (node.hasAttribute?.(PLACEHOLDER_ATTR) || node.hasAttribute?.('data-selection-marker')) {
			continue;
		}

		if (getSanitizedTextContent(node).length > 0 || !!node.querySelector?.(MEANINGFUL_EMBED_SELECTOR)) {
			return true;
		}
	}

	return false;
}

/**
 * Remove placeholder presentation artifacts from one list item.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {void}
 */
function clearListItemPlaceholderPresentation(listItem) {
	if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
		return;
	}

	const contentHost = getListItemContentHost(listItem);
	if (!contentHost) {
		return;
	}

	const span = getDirectPlaceholderSpan(contentHost);
	const anchorNode = getPlaceholderAnchorNode(contentHost, span);

	if (span) {
		span.remove();
	}

	if (anchorNode) {
		stripPlaceholderAnchorText(anchorNode);
	}
}

/**
 * Remove direct `<br>` placeholder nodes from a list item before showing the
 * visual placeholder.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {void}
 */
function removeListItemPlaceholderBreaks(listItem) {
	if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
		return;
	}

	const contentHost = getListItemContentHost(listItem);
	if (!contentHost) {
		return;
	}

	Array.from(contentHost.childNodes || []).forEach(node => {
		if (node && node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
			node.remove();
		}
	});
}

/**
 * Ensure an empty list item has a visible caret anchor before nested list
 * content when placeholder UI is being cleared for typing.
 *
 * @param   {HTMLLIElement|null} listItem Candidate list item.
 * @returns {void}
 */
function ensureListItemInputBreak(listItem) {
	if (!listItem || listItem.nodeType !== Node.ELEMENT_NODE || listItem.tagName !== 'LI') {
		return;
	}

	if (listItemHasMeaningfulContent(listItem)) {
		return;
	}

	const contentHost = getListItemContentHost(listItem);
	if (!contentHost) {
		return;
	}

	const existingBreak = Array.from(contentHost.childNodes || []).find(node => (
		node &&
		node.nodeType === Node.ELEMENT_NODE &&
		node.tagName === 'BR'
	));
	if (existingBreak) {
		return;
	}

	const br = document.createElement('br');
	contentHost.insertBefore(br, contentHost.firstChild || null);
}

function getSanitizedTextContent(node) {
	return String(node?.textContent || '')
		.replace(/\uFEFF/g, '')
		.replace(/\u00A0/g, ' ')
		.trim();
}

/**
 * Determine whether a cloned fragment still contains meaningful inline/media
 * content after placeholder cleanup.
 *
 * Empty formatting wrappers produced by partial-range cloning should not block
 * list start/end caret detection.
 *
 * @param   {DocumentFragment|HTMLElement|null} fragment Candidate fragment.
 * @returns {boolean}                                   True when meaningful content remains.
 */
function fragmentHasMeaningfulContent(fragment) {
	if (!fragment) {
		return false;
	}

	const walker = document.createTreeWalker(
		fragment,
		NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
	);

	let node = walker.nextNode();
	while (node) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (getSanitizedTextContent(node).length > 0) {
				return true;
			}
			node = walker.nextNode();
			continue;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			node = walker.nextNode();
			continue;
		}

		if (
			node.tagName === 'BR' ||
			node.tagName === 'OL' ||
			node.tagName === 'UL' ||
			node.hasAttribute?.(PLACEHOLDER_ATTR) ||
			node.hasAttribute?.('data-selection-marker')
		) {
			node = walker.nextNode();
			continue;
		}

		if (node.matches?.(MEANINGFUL_EMBED_SELECTOR) || node.querySelector?.(MEANINGFUL_EMBED_SELECTOR)) {
			return true;
		}

		node = walker.nextNode();
	}

	return false;
}

function replaceElementTag(element, newTagName) {
	if (!element || element.nodeType !== Node.ELEMENT_NODE) return element;

	const replacement = document.createElement(newTagName.toLowerCase());
	Array.from(element.attributes || []).forEach(attr => {
		replacement.setAttribute(attr.name, attr.value);
	});

	while (element.firstChild) {
		replacement.appendChild(element.firstChild);
	}

	if (element.parentNode) {
		element.parentNode.replaceChild(replacement, element);
	}

	return replacement;
}

function normalizeLegacyInlineTags(rootElement) {
	if (!rootElement || typeof rootElement.querySelectorAll !== 'function') {
		return false;
	}

	let changed = false;
	Object.entries(LEGACY_INLINE_TAG_MAP).forEach(([fromTag, toTag]) => {
		Array.from(rootElement.querySelectorAll(fromTag.toLowerCase())).forEach(node => {
			replaceElementTag(node, toTag);
			changed = true;
		});
	});

	return changed;
}

function syncListItemTextSurfaces(rootElement) {
	const listTracker = SFE.ListBlockTracker || null;
	if (
		listTracker &&
		typeof listTracker.syncEditableTextSurfaces === 'function' &&
		isListRootElement(rootElement)
	) {
		listTracker.syncEditableTextSurfaces(rootElement);
	}
}

function elementHasMeaningfulContent(element) {
	if (!element) return false;
	if (getSanitizedTextContent(element).length > 0) return true;
	return !!element.querySelector?.(MEANINGFUL_EMBED_SELECTOR);
}

function removeEmptyInlineArtifacts(rootElement) {
	if (!rootElement || typeof rootElement.querySelectorAll !== 'function') {
		return false;
	}

	const depthOf = (node) => {
		let depth = 0;
		let cursor = node;
		while (cursor && cursor !== rootElement) {
			cursor = cursor.parentElement;
			depth++;
		}
		return depth;
	};

	let changed = false;
	const candidates = Array.from(rootElement.querySelectorAll(EMPTY_INLINE_TAG_SELECTOR))
		.sort((a, b) => depthOf(b) - depthOf(a));

	candidates.forEach(node => {
		if (!node?.isConnected) return;
		if (node.hasAttribute?.(PLACEHOLDER_ATTR)) return;
		if (node.hasAttribute?.('data-selection-marker')) return;
		if (elementHasMeaningfulContent(node)) return;
		node.remove();
		changed = true;
	});

	return changed;
}

function normalizeRichTextSurface(rootElement) {
	if (!rootElement) return false;

	const normalizedLegacy = normalizeLegacyInlineTags(rootElement);
	const removedEmpty = removeEmptyInlineArtifacts(rootElement);

	if ((normalizedLegacy || removedEmpty) && typeof rootElement.normalize === 'function') {
		rootElement.normalize();
	}

	return normalizedLegacy || removedEmpty;
}

function pruneEmptyRootArtifacts(element) {
	if (!element) return;

	Array.from(element.childNodes || []).forEach(node => {
		if (!node) return;

		if (node.nodeType === Node.TEXT_NODE) {
			const sanitized = String(node.textContent || '')
				.replace(/\uFEFF/g, '')
				.replace(/\u00A0/g, ' ')
				.trim();
			if (!sanitized.length) {
				node.remove();
			}
			return;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return;
		}

		if (node.tagName === 'BR') {
			node.remove();
			return;
		}

		if (
			node.matches?.(EMPTY_INLINE_TAG_SELECTOR) &&
			!node.hasAttribute?.(PLACEHOLDER_ATTR) &&
			!node.hasAttribute?.('data-selection-marker') &&
			!elementHasMeaningfulContent(node)
		) {
			node.remove();
		}
	});

	if (typeof element.normalize === 'function') {
		element.normalize();
	}
}

function getDirectPlaceholderSpan(element) {
	if (!element) return null;

	for (const child of Array.from(element.childNodes || [])) {
		if (
			child &&
			child.nodeType === Node.ELEMENT_NODE &&
			child.tagName === 'SPAN' &&
			child.hasAttribute(PLACEHOLDER_ATTR)
		) {
			return child;
		}
	}

	return null;
}

function getPlaceholderAnchorNode(element, placeholderSpan = null) {
	const span = placeholderSpan || getDirectPlaceholderSpan(element);
	if (!span) return null;

	const previousNode = span.previousSibling;
	if (previousNode && previousNode.nodeType === Node.TEXT_NODE) {
		return previousNode;
	}

	return null;
}

function createPlaceholderSpan(placeholderText) {
	const span = document.createElement('span');
	span.className = PLACEHOLDER_CLASS;
	span.setAttribute(PLACEHOLDER_ATTR, placeholderText);
	span.setAttribute('contenteditable', 'false');
	span.setAttribute('aria-hidden', 'true');
	return span;
}

function stripPlaceholderAnchorText(anchorNode) {
	if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE) return;

	anchorNode.textContent = String(anchorNode.textContent || '').replace(/\uFEFF/g, '');
	if (!anchorNode.textContent) {
		anchorNode.remove();
	}
}

function hasMeaningfulPlaceholderContent(element) {
	if (!element) return false;

	const clone = element.cloneNode(true);
	clearPlaceholderPresentation(clone);
	normalizeRichTextSurface(clone);

	if (!isListRootElement(element)) {
		pruneEmptyRootArtifacts(clone);
	}

	if (getSanitizedTextContent(clone).length > 0) {
		return true;
	}

	return !!clone.querySelector?.(MEANINGFUL_EMBED_SELECTOR);
}

function clearPlaceholderPresentation(element) {
	if (!element) return;

	if (isListRootElement(element)) {
		getEditableListItems(element).forEach(listItem => {
			clearListItemPlaceholderPresentation(listItem);
		});
		element.classList.remove(...PLACEHOLDER_ROOT_CLASSES);
		element.removeAttribute(PLACEHOLDER_ATTR);
		return;
	}

	const span = getDirectPlaceholderSpan(element);
	const anchorNode = getPlaceholderAnchorNode(element, span);

	if (span) {
		span.remove();
	}

	if (anchorNode) {
		stripPlaceholderAnchorText(anchorNode);
	}

	element.classList.remove(...PLACEHOLDER_ROOT_CLASSES);
	element.removeAttribute(PLACEHOLDER_ATTR);
}

function syncElementPlaceholder(element, placeholderText) {
	if (!element) return;

	const normalizedPlaceholder = typeof placeholderText === 'string'
		? placeholderText.trim()
		: '';

	if (!normalizedPlaceholder) {
		clearPlaceholderPresentation(element);
		return;
	}

	if (isListRootElement(element)) {
		let hasAnyPlaceholder = false;

		getEditableListItems(element).forEach(listItem => {
			const contentHost = getListItemContentHost(listItem);
			if (!contentHost) {
				return;
			}

			normalizeRichTextSurface(contentHost);
			clearListItemPlaceholderPresentation(listItem);

			if (listItemHasMeaningfulContent(listItem)) {
				return;
			}

			removeListItemPlaceholderBreaks(listItem);

			let span = getDirectPlaceholderSpan(contentHost);
			if (!span) {
				span = createPlaceholderSpan(normalizedPlaceholder);
				contentHost.appendChild(span);
			} else {
				span.setAttribute(PLACEHOLDER_ATTR, normalizedPlaceholder);
			}

			let anchorNode = getPlaceholderAnchorNode(contentHost, span);
			if (!anchorNode) {
				anchorNode = document.createTextNode(PLACEHOLDER_ANCHOR_CHAR);
				contentHost.insertBefore(anchorNode, span);
			} else if (!String(anchorNode.textContent || '').includes(PLACEHOLDER_ANCHOR_CHAR)) {
				anchorNode.textContent = `${PLACEHOLDER_ANCHOR_CHAR}${anchorNode.textContent || ''}`;
			}

			hasAnyPlaceholder = true;
		});

		if (hasAnyPlaceholder) {
			element.classList.add(...PLACEHOLDER_ROOT_CLASSES);
			element.setAttribute(PLACEHOLDER_ATTR, normalizedPlaceholder);
		} else {
			element.classList.remove(...PLACEHOLDER_ROOT_CLASSES);
			element.removeAttribute(PLACEHOLDER_ATTR);
		}

		return;
	}

	if (hasMeaningfulPlaceholderContent(element)) {
		clearPlaceholderPresentation(element);
		return;
	}

	normalizeRichTextSurface(element);
	pruneEmptyRootArtifacts(element);

	Array.from(element.childNodes || []).forEach(node => {
		if (node && node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
			node.remove();
		}
	});

	let span = getDirectPlaceholderSpan(element);
	if (!span) {
		span = createPlaceholderSpan(normalizedPlaceholder);
		element.appendChild(span);
	} else {
		span.setAttribute(PLACEHOLDER_ATTR, normalizedPlaceholder);
	}

	let anchorNode = getPlaceholderAnchorNode(element, span);
	if (!anchorNode) {
		anchorNode = document.createTextNode(PLACEHOLDER_ANCHOR_CHAR);
		element.insertBefore(anchorNode, span);
	} else if (!String(anchorNode.textContent || '').includes(PLACEHOLDER_ANCHOR_CHAR)) {
		anchorNode.textContent = `${PLACEHOLDER_ANCHOR_CHAR}${anchorNode.textContent || ''}`;
	}

	element.classList.add(...PLACEHOLDER_ROOT_CLASSES);
	element.setAttribute(PLACEHOLDER_ATTR, normalizedPlaceholder);
}

function prepareElementForPlaceholderInput(element) {
	if (!element) return false;

	if (isListRootElement(element)) {
		const targetListItem = getSelectedEditableListItem(element);
		if (!targetListItem) {
			return false;
		}

		const contentHost = getListItemContentHost(targetListItem);
		if (!contentHost) {
			return false;
		}

		const span = getDirectPlaceholderSpan(contentHost);
		if (!span) {
			return false;
		}

		clearListItemPlaceholderPresentation(targetListItem);
		normalizeRichTextSurface(contentHost);
		pruneEmptyRootArtifacts(contentHost);

		const selection = window.getSelection();
		if (!selection) {
			return true;
		}

		ensureListItemInputBreak(targetListItem);

		const range = document.createRange();
		range.setStart(contentHost, 0);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		return true;
	}

	const hadPlaceholder = !!(
		getDirectPlaceholderSpan(element) ||
		element.classList.contains(PLACEHOLDER_ROOT_CLASSES[0]) ||
		element.classList.contains(PLACEHOLDER_ROOT_CLASSES[1]) ||
		element.hasAttribute(PLACEHOLDER_ATTR)
	);
	const hadMeaningfulContent = hasMeaningfulPlaceholderContent(element);

	clearPlaceholderPresentation(element);
	normalizeRichTextSurface(element);
	pruneEmptyRootArtifacts(element);

	if (hadMeaningfulContent) {
		return hadPlaceholder;
	}

	const selection = window.getSelection();
	if (!selection) return hadPlaceholder;

	const range = document.createRange();
	range.setStart(element, 0);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
	return true;
}

function getPlaceholderCaretTarget(element) {
	if (isListRootElement(element)) {
		const targetListItem = getSelectedEditableListItem(element);
		const contentHost = targetListItem ? getListItemContentHost(targetListItem) : null;
		const span = contentHost ? getDirectPlaceholderSpan(contentHost) : null;
		if (!span) {
			return null;
		}

		const anchorNode = getPlaceholderAnchorNode(contentHost, span);
		if (!anchorNode) {
			return null;
		}

		return {
			node: anchorNode,
			offset: String(anchorNode.textContent || '').length,
		};
	}

	const span = getDirectPlaceholderSpan(element);
	if (!span) return null;

	const anchorNode = getPlaceholderAnchorNode(element, span);
	if (!anchorNode) return null;

	return {
		node: anchorNode,
		offset: String(anchorNode.textContent || '').length,
	};
}

function isLinebreakPlaceholderNode(node) {
	return !!(
		node &&
		node.nodeType === Node.TEXT_NODE &&
		String(node.textContent || '').includes(PLACEHOLDER_ANCHOR_CHAR) &&
		String(node.textContent || '').replace(/\uFEFF/g, '').length === 0
	);
}

const RichTextPlaceholder = {
	attr: PLACEHOLDER_ATTR,
	className: PLACEHOLDER_CLASS,
	anchorChar: PLACEHOLDER_ANCHOR_CHAR,
	syncElement: syncElementPlaceholder,
	clearElement: clearPlaceholderPresentation,
	prepareForInput: prepareElementForPlaceholderInput,
	getCaretTarget: getPlaceholderCaretTarget,
	hasMeaningfulContent: hasMeaningfulPlaceholderContent,
};

class MWPEditor {
	constructor(element, options = {}) {
		this.element     = element;
		this.options     = options|| {};
		this.toolbar     = null;
		this.toolbarManager = null;
		this.formats     = options.formats || [];
		this.historyApi = options.historyApi || null;

		// Track block attribute changes
		this.attributeChanges = {};
		
		// Store handlers for reattachment
		this._keydownHandler = null;
		this._beforeInputHandler = null;
		this._pasteHandler = null;
		this._updateToolbarHandler = null;
		this._interactiveSpaceKeydownHandler = null;
		this._contextMenuHandler = null;
		this._lastActiveListItem = null;
		this._pendingContextMenuListItem = null;
		this._isApplyingListSelectAll = false;
		this._pendingListSelectAllVisualTimeout = null;

		this.isRestoring  = false;
		this.inputTimeout = null;

		this.init();
	}

	getPlaceholderText() {
		return typeof this.options?.placeholder === 'string'
			? this.options.placeholder.trim()
			: '';
	}

	clearPlaceholderState(targetElement = null) {
		RichTextPlaceholder.clearElement(targetElement || this.element);
	}

	isLinebreakMode() {
		return (
			this.getEnterMode() === 'linebreak' &&
			this.element?.tagName !== 'OL' &&
			this.element?.tagName !== 'UL'
		);
	}

	/**
	 * Return whether the active schema component persists literal `\n`
	 * characters instead of treating `<br>` as the canonical stored form.
	 *
	 * @returns {boolean} True when the editor should preserve literal newlines.
	 */
	preservesTextNewlines() {
		return this.options?.options?.preserveNewlines === true;
	}

	hasManagedLinebreakState() {
		if (!this.isLinebreakMode() || !this.element) {
			return false;
		}

		const brCount = this.element.querySelectorAll?.('br').length || 0;
		if (!brCount) {
			return false;
		}

		if (Array.from(this.element.childNodes || []).some(node => isLinebreakPlaceholderNode(node))) {
			return true;
		}

		if (getSanitizedTextContent(this.element).length > 0) {
			return true;
		}

		return brCount > 1;
	}

	prepareLinebreakPlaceholderInputState() {
		if (!this.isLinebreakMode()) {
			return false;
		}

		const selection = window.getSelection();
		if (!selection || !selection.rangeCount) {
			return false;
		}

		const range = selection.getRangeAt(0);
		if (!this.element.contains(range.commonAncestorContainer)) {
			return false;
		}

		let placeholderNode = null;
		if (range.startContainer.nodeType === Node.TEXT_NODE) {
			if (isLinebreakPlaceholderNode(range.startContainer)) {
				placeholderNode = range.startContainer;
			}
		} else if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
			placeholderNode = range.startContainer.childNodes[range.startOffset] || null;
			if (!isLinebreakPlaceholderNode(placeholderNode) && range.startOffset > 0) {
				const previousNode = range.startContainer.childNodes[range.startOffset - 1] || null;
				if (isLinebreakPlaceholderNode(previousNode)) {
					placeholderNode = previousNode;
				}
			}
		}

		if (!isLinebreakPlaceholderNode(placeholderNode) || !placeholderNode.parentNode) {
			return false;
		}

		const placeholderPrev = placeholderNode.previousSibling;
		const placeholderNext = placeholderNode.nextSibling;
		const isTrailingBreakAnchor = !!(
			(placeholderPrev && placeholderPrev.nodeType === Node.ELEMENT_NODE && placeholderPrev.tagName === 'BR') ||
			(placeholderNext && placeholderNext.nodeType === Node.ELEMENT_NODE && placeholderNext.tagName === 'BR')
		);
		if (!isTrailingBreakAnchor) {
			return false;
		}

		const parentNode = placeholderNode.parentNode;
		const offset = Array.from(parentNode.childNodes).indexOf(placeholderNode);
		placeholderNode.remove();

		const nextSibling = parentNode.childNodes[offset] || null;
		if (isLinebreakPlaceholderNode(nextSibling)) {
			nextSibling.remove();
		}

		const nextNextSibling = parentNode.childNodes[offset] || null;
		if (isLinebreakPlaceholderNode(nextNextSibling)) {
			nextNextSibling.remove();
		}

		const newRange = document.createRange();
		newRange.setStart(parentNode, Math.max(0, Math.min(offset, parentNode.childNodes.length)));
		newRange.collapse(true);
		selection.removeAllRanges();
		selection.addRange(newRange);
		return true;
	}

	cleanupLinebreakPlaceholderArtifacts() {
		if (!this.isLinebreakMode() || !this.element) {
			return;
		}

		const selection = window.getSelection();
		const activeRange = (
			selection &&
			selection.rangeCount > 0 &&
			this.element.contains(selection.getRangeAt(0).commonAncestorContainer)
		)
			? selection.getRangeAt(0).cloneRange()
			: null;

		const childNodes = Array.from(this.element.childNodes || []);
		const purePlaceholderNodes = [];

		childNodes.forEach(node => {
			if (node.nodeType !== Node.TEXT_NODE) {
				return;
			}

			const value = String(node.textContent || '');
			if (!value.includes(PLACEHOLDER_ANCHOR_CHAR)) {
				return;
			}

			const cleanedValue = value.replace(/\uFEFF/g, '');
			if (cleanedValue.length > 0) {
				let nextStartOffset = null;
				let nextEndOffset = null;
				if (activeRange?.startContainer === node) {
					const startSlice = value.slice(0, activeRange.startOffset);
					nextStartOffset = startSlice.replace(/\uFEFF/g, '').length;
				}
				if (activeRange?.endContainer === node) {
					const endSlice = value.slice(0, activeRange.endOffset);
					nextEndOffset = endSlice.replace(/\uFEFF/g, '').length;
				}

				node.textContent = cleanedValue;

				if (activeRange && (nextStartOffset !== null || nextEndOffset !== null)) {
					const restoredRange = document.createRange();
					const startOffset = nextStartOffset !== null
						? Math.min(nextStartOffset, node.textContent.length)
						: activeRange.startOffset;
					const endOffset = nextEndOffset !== null
						? Math.min(nextEndOffset, node.textContent.length)
						: startOffset;
					restoredRange.setStart(
						nextStartOffset !== null ? node : activeRange.startContainer,
						startOffset
					);
					restoredRange.setEnd(
						nextEndOffset !== null ? node : activeRange.endContainer,
						endOffset
					);
					selection.removeAllRanges();
					selection.addRange(restoredRange);
				}

				return;
			}

			purePlaceholderNodes.push(node);
		});

		let keepPlaceholderNode = null;
		purePlaceholderNodes.forEach(node => {
			const previousNode = node.previousSibling;
			if (
				previousNode &&
				previousNode.nodeType === Node.ELEMENT_NODE &&
				previousNode.tagName === 'BR'
			) {
				keepPlaceholderNode = node;
			}
		});

		purePlaceholderNodes.forEach(node => {
			if (node === keepPlaceholderNode) {
				node.textContent = PLACEHOLDER_ANCHOR_CHAR;
				return;
			}

			node.remove();
		});

		if (this.normalizeTrailingPreservedNewlineArtifacts(selection)) {
			if (typeof this.element.normalize === 'function') {
				this.element.normalize();
			}
			return;
		}

		const rootNodes = Array.from(this.element.childNodes || []);
		const lastNode = rootNodes.length ? rootNodes[rootNodes.length - 1] : null;
		if (
			lastNode &&
			lastNode.nodeType === Node.ELEMENT_NODE &&
			lastNode.tagName === 'BR'
		) {
			const hasMeaningfulTextBeforeLastBreak = rootNodes.some(node => (
				node &&
				node !== lastNode &&
				node.nodeType === Node.TEXT_NODE &&
				String(node.textContent || '').replace(/\uFEFF/g, '').length > 0
			));
			const hasPriorBreak = !!(
				lastNode.previousSibling &&
				lastNode.previousSibling.nodeType === Node.ELEMENT_NODE &&
				lastNode.previousSibling.tagName === 'BR'
			);
			if (!hasMeaningfulTextBeforeLastBreak && !hasPriorBreak) {
				if (typeof this.element.normalize === 'function') {
					this.element.normalize();
				}
				return;
			}

			const anchorNode = document.createTextNode(PLACEHOLDER_ANCHOR_CHAR);
			if (hasPriorBreak) {
				lastNode.replaceWith(anchorNode);
			} else {
				this.element.insertBefore(anchorNode, lastNode.nextSibling);
			}
		}

		if (typeof this.element.normalize === 'function') {
			this.element.normalize();
		}
	}

	/**
	 * Collapse duplicate trailing newline representations on newline-preserving
	 * text surfaces.
	 *
	 * Newline-preserving schema surfaces such as code/preformatted/verse store
	 * line endings as `\n` in the text node itself. Some delete paths can also
	 * append a trailing `<br>` plus FEFF caret anchor for the final empty line.
	 * When both exist at once, the browser renders two line breaks. Keep the
	 * `<br>` scaffold so the final empty line stays editable, and trim the
	 * duplicated literal trailing newline from the text node instead.
	 *
	 * @param   {Selection|null} selection Current browser selection.
	 * @returns {boolean}                  True when duplicate trailing newline state was normalized.
	 */
	normalizeTrailingPreservedNewlineArtifacts(selection) {
		if (!this.preservesTextNewlines() || !this.element) {
			return false;
		}

		const rootNodes = Array.from(this.element.childNodes || []);
		if (!rootNodes.length) {
			return false;
		}

		const lastNode = rootNodes[rootNodes.length - 1] || null;
		const trailingPlaceholder = isLinebreakPlaceholderNode(lastNode) ? lastNode : null;
		const trailingBreak = trailingPlaceholder
			? trailingPlaceholder.previousSibling
			: lastNode;
		if (
			!trailingBreak ||
			trailingBreak.nodeType !== Node.ELEMENT_NODE ||
			trailingBreak.tagName !== 'BR'
		) {
			return false;
		}

		const previousNode = trailingBreak.previousSibling;
		if (previousNode?.nodeType !== Node.TEXT_NODE) {
			return false;
		}

		if (!String(previousNode.textContent || '').endsWith('\n')) {
			return false;
		}

		const activeRange = (
			selection &&
			selection.rangeCount > 0 &&
			this.element.contains(selection.getRangeAt(0).commonAncestorContainer)
		)
			? selection.getRangeAt(0).cloneRange()
			: null;
		const previousValue = String(previousNode.textContent || '');
		const placeholderCaretContainer = trailingPlaceholder || previousNode;
		const placeholderCaretOffset = (placeholderCaretContainer === previousNode)
			? Math.max(0, previousValue.length - 1)
			: 1;
		const isCollapsedTrailingCaret = !!(
			activeRange &&
			activeRange.collapsed &&
			(
				activeRange.startContainer === trailingBreak ||
				activeRange.startContainer === trailingPlaceholder ||
				(
					activeRange.startContainer === previousNode &&
					activeRange.startOffset >= previousValue.length
				)
			)
		);
		let nextStartContainer = activeRange?.startContainer || null;
		let nextEndContainer = activeRange?.endContainer || null;
		let nextStartOffset = activeRange?.startOffset || 0;
		let nextEndOffset = activeRange?.endOffset || 0;

		if (isCollapsedTrailingCaret) {
			nextStartContainer = placeholderCaretContainer;
			nextEndContainer = placeholderCaretContainer;
			nextStartOffset = placeholderCaretOffset;
			nextEndOffset = placeholderCaretOffset;
		}

		if (activeRange?.startContainer === previousNode) {
			nextStartOffset = Math.min(nextStartOffset, Math.max(0, previousValue.length - 1));
		}
		if (activeRange?.endContainer === previousNode) {
			nextEndOffset = Math.min(nextEndOffset, Math.max(0, previousValue.length - 1));
		}
		if (activeRange?.startContainer === trailingBreak || activeRange?.startContainer === trailingPlaceholder) {
			nextStartContainer = placeholderCaretContainer;
			nextStartOffset = placeholderCaretOffset;
		}
		if (activeRange?.endContainer === trailingBreak || activeRange?.endContainer === trailingPlaceholder) {
			nextEndContainer = placeholderCaretContainer;
			nextEndOffset = placeholderCaretOffset;
		}

		previousNode.textContent = previousValue.slice(0, -1);

		if (selection && activeRange) {
			const restoredRange = document.createRange();
			restoredRange.setStart(
				nextStartContainer,
				Math.min(nextStartOffset, nextStartContainer?.textContent?.length ?? nextStartOffset)
			);
			restoredRange.setEnd(
				nextEndContainer,
				Math.min(nextEndOffset, nextEndContainer?.textContent?.length ?? nextEndOffset)
			);
			selection.removeAllRanges();
			selection.addRange(restoredRange);
		}

		return true;
	}

	needsPlaceholderInputPreparation() {
		if (!this.element) return false;

		const hasPlaceholderUI = !!(
			getDirectPlaceholderSpan(this.element) ||
			this.element.classList.contains(PLACEHOLDER_ROOT_CLASSES[0]) ||
			this.element.classList.contains(PLACEHOLDER_ROOT_CLASSES[1]) ||
			this.element.hasAttribute(PLACEHOLDER_ATTR)
		);

		if (this.hasManagedLinebreakState()) {
			return hasPlaceholderUI;
		}

		return hasPlaceholderUI || !this.hasMeaningfulContent();
	}

	preparePlaceholderInputState() {
		if (!this.needsPlaceholderInputPreparation()) {
			return false;
		}

		return RichTextPlaceholder.prepareForInput(this.element);
	}

	hasMeaningfulContent() {
		return RichTextPlaceholder.hasMeaningfulContent(this.element);
	}

	syncPlaceholderState() {
		if (isListRootElement(this.element)) {
			syncListItemTextSurfaces(this.element);
		}

		if (this.isLinebreakMode()) {
			this.cleanupLinebreakPlaceholderArtifacts();
		}

		if (this.hasManagedLinebreakState()) {
			RichTextPlaceholder.clearElement(this.element);
		} else {
			RichTextPlaceholder.syncElement(this.element, this.getPlaceholderText());
		}
		const schemaRuntime = SFE.SchemaRuntime || null;
		const missingUI = (
			this.options?.missingUI &&
			typeof this.options.missingUI === 'object'
		)
			? this.options.missingUI
			: null;
		const componentId = typeof this.options?.componentId === 'string'
			? this.options.componentId.trim()
			: '';
		if (
			schemaRuntime &&
			typeof schemaRuntime.syncManagedMissingComponentStateForElement === 'function'
		) {
			schemaRuntime.syncManagedMissingComponentStateForElement(this.element, {
				id: componentId,
				type: 'text',
				missingUI,
			});
		}
	}

	/**
	 * Normalize browser-authored inline markup after native contenteditable input.
	 *
	 * When a fully formatted selection is replaced by typing, browsers can retain
	 * the formatting shell but rewrite it with legacy tags like <b>, <i>, and
	 * <strike>. Convert those tags back to the canonical WordPress tags
	 * immediately so history, toolbar state, and save payloads operate on stable
	 * markup.
	 *
	 * @returns {boolean} True when normalization changed the editable surface.
	 */
	normalizeInputMarkup() {
		if (!this.element) {
			return false;
		}

		const selectionInEditor = this.isSelectionInEditor();
		const savedPosition = selectionInEditor ? this.saveCursorPosition() : null;
		const changed = normalizeRichTextSurface(this.element);

		if (changed && savedPosition) {
			this.restoreCursorPosition(savedPosition);
		}

		return changed;
	}

	getHistoryRuntimeClassNames() {
		const elementPrep = SFE.ElementPrep || null;

		if (
			elementPrep &&
			typeof elementPrep.getRuntimeClassNames === 'function'
		) {
			return new Set(elementPrep.getRuntimeClassNames(this.element));
		}

		return new Set([
			'mwp-sfe-element-active',
			'mwp-sfe-rich-text-has-placeholder',
			'mwp-sfe-rich-text-show-placeholder',
			'mwp-sfe-editor-content',
			'mwp-sfe-inline-editor',
			'mwp-sfe-editing-active',
			'mwp-sfe-component-active',
			'mwp-sfe-editable-component',
			'mwp-sfe-list-select-all-pending',
		]);
	}

	getPersistedClassName() {
		const elementPrep = SFE.ElementPrep || null;

		if (
			elementPrep &&
			typeof elementPrep.getPersistentClassName === 'function'
		) {
			return elementPrep.getPersistentClassName(this.element);
		}

		if (!this.element) return '';

		return Array.from(this.element.classList || [])
			.filter(cls => (
				cls !== 'mwp-sfe-rich-text-has-placeholder' &&
				cls !== 'mwp-sfe-rich-text-show-placeholder'
			))
			.join(' ');
	}

	getHistoryAttributes() {
		const elementPrep = SFE.ElementPrep || null;

		if (
			elementPrep &&
			typeof elementPrep.getPersistentAttributes === 'function'
		) {
			return elementPrep.getPersistentAttributes(this.element, {
				keepIdentity: true
			});
		}

		return {};
	}

	restoreHistoryAttributes(attrs = {}) {
		if (!this.element) return;

		const elementPrep = SFE.ElementPrep || null;
		const runtimeClasses = this.getHistoryRuntimeClassNames();
		const runtimeAttrs = (
			elementPrep &&
			typeof elementPrep.getRuntimeAttributes === 'function'
		)
			? elementPrep.getRuntimeAttributes(this.element, { keepIdentity: true })
			: {};
		const liveRuntimeClasses = Array.from(this.element.classList)
			.filter(cls => runtimeClasses.has(cls));

		Array.from(this.element.attributes).forEach(attr => {
			this.element.removeAttribute(attr.name);
		});

		Object.entries(attrs).forEach(([name, value]) => {
			if (
				name === 'class' ||
				name === 'contenteditable' ||
				name === 'spellcheck' ||
				name.startsWith('data-mwp-sfe-')
			) {
				return;
			}

			this.element.setAttribute(name, value);
		});

		Object.entries(runtimeAttrs).forEach(([name, value]) => {
			if (name === 'class') {
				return;
			}

			this.element.setAttribute(name, value);
		});

		const persistedClasses = String(attrs.class || attrs.classes || '')
			.split(/\s+/)
			.filter(Boolean);

		this.element.className = Array.from(new Set([
			...persistedClasses,
			...liveRuntimeClasses,
		])).join(' ');

		if (elementPrep && typeof elementPrep.pruneEmptyClassAttribute === 'function') {
			elementPrep.pruneEmptyClassAttribute(this.element);
		}
	}
	
	init() {
		this.element.contentEditable = true;
		this.element.spellcheck = true;
		this.element.classList.add('mwp-sfe-editor-content');
		syncListItemTextSurfaces(this.element);
		if (isListRootElement(this.element)) {
			const listTracker = SFE.ListBlockTracker || null;
			if (listTracker && typeof listTracker.ensureIdentityAttributes === 'function') {
				listTracker.ensureIdentityAttributes(this.element);
			}
		}
		this.syncPlaceholderState();

		// Normalize list items on init to strip hidden \n characters left by WP
		// block serialization. Must run before saveToHistory so the clean state
		// is what gets recorded as the baseline.
		if (this.element.tagName === 'OL' || this.element.tagName === 'UL') {
			this.element.querySelectorAll('li').forEach(li => this.normalizeListItem(li));
		}

		this.createToolbar();
		this.attachEvents();
	}

	/**
	 * Alias called by EditorLifecycle cleanupEditorResources().
	 * Without this, cleanupEditorResources silently skips the destroy call
	 * and every new editor session stacks another keydown listener on the
	 * element, causing Enter to insert one extra newline per prior session.
	 */
	destroy(options = {}) {
		this.cleanup(options);
	}

	cleanup(options = {}) {
		this.syncPlaceholderState();
		this.setPendingListSelectAllVisualState(false);

		// Close link UI if active
		if (this._linkUIActive) {
			this.closeLinkUI();
		}
		
		// Remove event listeners
		if (this._keydownHandler) {
			this.element.removeEventListener('keydown', this._keydownHandler);
		}
		if (this._updateToolbarHandler) {
			this.element.removeEventListener('mouseup', this._updateToolbarHandler);
			this.element.removeEventListener('keyup', this._updateToolbarHandler);
			this.element.removeEventListener('focus', this._updateToolbarHandler);
		}
		if (this._inputHandler) {
			this.element.removeEventListener('input', this._inputHandler);
		}
		if (this._beforeInputHandler) {
			this.element.removeEventListener('beforeinput', this._beforeInputHandler);
		}
		if (this._contextMenuHandler) {
			this.element.removeEventListener('contextmenu', this._contextMenuHandler);
		}
		if (this._pasteHandler) {
			this.element.removeEventListener('paste', this._pasteHandler);
		}
		if (this._linkClickHandler) {
			this.element.removeEventListener('click', this._linkClickHandler, true);
		}
		if (this._selectionChangeHandler) {
			document.removeEventListener('selectionchange', this._selectionChangeHandler);
			clearTimeout(this._selectionTimeout);
		}
		if (this._interactiveSpaceKeydownHandler) {
			document.removeEventListener('keydown', this._interactiveSpaceKeydownHandler, true);
			this._interactiveSpaceKeydownHandler = null;
		}
		
		// Clear pending timeouts
		clearTimeout(this.inputTimeout);
		
		// Clear link UI state
		this._linkUIActive   = false;
		this._savedLinkRange = null;

		if (this.toolbarManager && typeof this.toolbarManager.destroy === 'function') {
			this.toolbarManager.destroy({
				removeToolbar: options.removeToolbar !== false,
			});
		}
		
		// Clear references
		this.toolbarManager = null;
		this.toolbar = null;
	}

	attachToolbarManager(manager) {
		this.toolbarManager = manager;
		this.toolbar = manager?.toolbar || null;
	}

	detachToolbarManager(manager) {
		if (this.toolbarManager === manager) {
			this.toolbarManager = null;
		}
		if (this.toolbar === manager?.toolbar) {
			this.toolbar = null;
		}
	}

	/**
	 * Check if the current selection is within this editor
	 * @returns {boolean}
	 */
	isSelectionInEditor() {
		const selection = window.getSelection();
		if (!selection.rangeCount) return false;
		
		const range     = selection.getRangeAt(0);
		const container = range.commonAncestorContainer;
		
		// Check if the selection's container is within this.element
		const node = container.nodeType === 3 ? container.parentNode : container;
		return this.element.contains(node);
	}

	/**
	 * Resolve Enter key policy for this editor instance.
	 *
	 * @returns {"auto"|"always"|"never"|"linebreak"}
	 */
	getEnterMode() {
		const mode = typeof this.options?.enterMode === 'string'
			? this.options.enterMode.trim().toLowerCase()
			: '';

		if (mode === 'always' || mode === 'never' || mode === 'auto' || mode === 'linebreak') {
			return mode;
		}

		return 'auto';
	}

	/**
	 * Resolve Link UI mode for this editor instance.
	 *
	 * @returns {"auto"|"manual"}
	 */
	getLinkUIMode() {
		const mode = typeof this.options?.linkUIMode === 'string'
			? this.options.linkUIMode.trim().toLowerCase()
			: '';

		if (mode === 'manual' || mode === 'auto') {
			return mode;
		}

		return 'auto';
	}

	/**
	 * Return whether this editor's schema declares element-scoped link editing.
	 *
	 * Button-like text components edit the root anchor element itself rather than
	 * wrapping a live text selection. Treat that as a schema capability, not a
	 * block-type special case, so third-party handlers can opt into the same
	 * behavior without core JS changes.
	 *
	 * @returns {boolean} True when link editing targets the editor element itself.
	 */
	supportsElementLinkEditing() {
		if (this.element?.tagName !== 'A') {
			return false;
		}

		const inlineFormatCapabilities = (
			this.options?.inlineFormatCapabilities &&
			typeof this.options.inlineFormatCapabilities === 'object'
		)
			? this.options.inlineFormatCapabilities
			: null;
		const buttonLinkCapability = inlineFormatCapabilities?.buttonLink;
		const buttonLinkTag = typeof buttonLinkCapability?.tag === 'string'
			? buttonLinkCapability.tag.trim().toLowerCase()
			: '';
		if (buttonLinkTag !== 'a') {
			return false;
		}

		const attributeCapability = typeof this.getAttributeCapability === 'function'
			? this.getAttributeCapability('buttonLink')
			: null;
		const attributes = Array.isArray(attributeCapability?.attributes)
			? attributeCapability.attributes
				.map(value => (typeof value === 'string' ? value.trim() : ''))
				.filter(Boolean)
			: [];

		return attributes.includes('url');
	}

	/**
	 * Cross-browser Space key detection.
	 *
	 * @param {KeyboardEvent} event
	 * @returns {boolean}
	 */
	isSpaceKey(event) {
		if (!event) return false;
		if (event.key === ' ') return true;
		if (event.code === 'Space') return true;
		return false;
	}

	/**
	 * Resolve nearest native-interactive host that can consume Space as an
	 * activation/navigation key instead of text input.
	 *
	 * @returns {HTMLElement|null}
	 */
	getSpaceInteractiveHost() {
		if (!this.element || typeof this.element.closest !== 'function') {
			return null;
		}

		return this.element.closest('summary, button, a[href], [role="button"], [role="link"]');
	}

	/**
	 * Determine whether this keydown should be treated as plain text Space input
	 * while suppressing native interactive activation (details/accordion toggles).
	 *
	 * @param {KeyboardEvent} event
	 * @returns {boolean}
	 */
	shouldHandleSpaceAsText(event) {
		if (!event) return false;
		if (!this.isSpaceKey(event)) return false;
		if (event.isComposing) return false;
		if (event.ctrlKey || event.metaKey || event.altKey) return false;
		if (!this.element) return false;

		const selection = window.getSelection();
		const hasSelectionInEditor = !!(
			selection &&
			selection.rangeCount > 0 &&
			this.element.contains(selection.getRangeAt(0).commonAncestorContainer)
		);
		const activeEl = document.activeElement;
		const hasActiveFocusInEditor = !!(
			activeEl &&
			(activeEl === this.element || this.element.contains(activeEl))
		);
		if (!hasSelectionInEditor && !hasActiveFocusInEditor) return false;

		// Generic guard for editable content nested inside native interactive controls.
		const interactiveHost = this.getSpaceInteractiveHost();
		return !!interactiveHost;
	}

	/**
	 * Ensure a live selection exists inside this editor element.
	 *
	 * @returns {boolean}
	 */
	ensureSelectionInsideEditor() {
		const selection = window.getSelection();
		if (!selection) return false;

		if (selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			if (this.element.contains(range.commonAncestorContainer)) {
				return true;
			}
		}

		const range = document.createRange();
		range.selectNodeContents(this.element);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
		return true;
	}

	/**
	 * Remember the most recent active list item for list-root selection flows.
	 *
	 * Right-click "Select all" promotes the browser selection to the whole list
	 * root before the editor can inspect the current LI. Persisting the last
	 * active item lets us remap that select-all gesture back to the expected
	 * Gutenberg-style list-item scope.
	 *
	 * @param {HTMLLIElement|null} listItem Active list item candidate.
	 * @returns {void}
	 */
	setActiveListItem(listItem) {
		this._lastActiveListItem = (
			listItem &&
			listItem.nodeType === Node.ELEMENT_NODE &&
			listItem.tagName === 'LI' &&
			this.element?.contains(listItem)
		)
			? listItem
			: null;
	}

	/**
	 * Sync the cached active list item from the current browser selection.
	 *
	 * @returns {HTMLLIElement|null} Active list item when selection is inside one.
	 */
	updateActiveListItemFromSelection() {
		if (!isListRootElement(this.element)) {
			this.setActiveListItem(null);
			return null;
		}

		const listItem = getSelectedEditableListItem(this.element);
		if (listItem) {
			this.setActiveListItem(listItem);
		}

		return listItem;
	}

	/**
	 * Select only the current list item's own inline content.
	 *
	 * @param {HTMLLIElement|null} listItem List item to scope the selection to.
	 * @returns {boolean}                   True when a scoped selection was applied.
	 */
	selectListItemContents(listItem) {
		const selection = window.getSelection();
		const range = createDirectListItemContentRange(listItem);
		if (!selection || !range) {
			return false;
		}

		selection.removeAllRanges();
		selection.addRange(range);
		this.setActiveListItem(listItem);
		return true;
	}

	/**
	 * Toggle temporary visual suppression for pending context-menu list
	 * select-all flows.
	 *
	 * @param {boolean} isSuppressed Whether selection paint should be hidden.
	 * @returns {void}
	 */
	setPendingListSelectAllVisualState(isSuppressed) {
		if (!this.element) {
			return;
		}

		if (!isSuppressed) {
			this.element.classList.remove(LIST_SELECT_ALL_SUPPRESS_CLASS);
			if (this._pendingListSelectAllVisualTimeout) {
				clearTimeout(this._pendingListSelectAllVisualTimeout);
				this._pendingListSelectAllVisualTimeout = null;
			}
			return;
		}

		ensureListSelectAllSuppressionStyles();
		this.element.classList.add(LIST_SELECT_ALL_SUPPRESS_CLASS);

		if (this._pendingListSelectAllVisualTimeout) {
			clearTimeout(this._pendingListSelectAllVisualTimeout);
		}

		// Fail safe: if the user closes the context menu without choosing
		// select-all, restore normal selection paint automatically.
		this._pendingListSelectAllVisualTimeout = setTimeout(() => {
			this.setPendingListSelectAllVisualState(false);
		}, 1000);
	}

	/**
	 * Apply list-item-scoped select-all using the same path for keyboard and
	 * context-menu flows.
	 *
	 * @param {HTMLLIElement|null} listItem List item to select.
	 * @returns {boolean}                   True when the selection was updated.
	 */
	handleListSelectAll(listItem) {
		if (this._isApplyingListSelectAll) {
			return false;
		}

		const targetListItem = (
			listItem &&
			listItem.nodeType === Node.ELEMENT_NODE &&
			listItem.tagName === 'LI' &&
			this.element?.contains(listItem)
		)
			? listItem
			: null;

		if (!targetListItem) {
			return false;
		}

		this._isApplyingListSelectAll = true;
		const applied = this.selectListItemContents(targetListItem);
		this._pendingContextMenuListItem = null;

		requestAnimationFrame(() => {
			this.setPendingListSelectAllVisualState(false);
			this._isApplyingListSelectAll = false;
		});

		return applied;
	}

	/**
	 * Clamp expanded list selections back to one list item's text surface.
	 *
	 * Native triple-click selection can spill into the next list item or nested
	 * child list, which makes destructive keys and toolbar state behave like a
	 * multi-item selection. Keep list selections bounded to the direct
	 * `data-mwp-sfe-list-item-text` surface whenever the browser leaks outside it.
	 *
	 * @returns {boolean} True when the selection was normalized.
	 */
	normalizeExpandedListItemSelection() {
		if (!isListRootElement(this.element)) {
			return false;
		}

		const selection = window.getSelection();
		if (!selection || !selection.rangeCount) {
			return false;
		}

		const range = selection.getRangeAt(0);
		if (range.collapsed) {
			return false;
		}

		const targetListItem = resolveExpandedListSelectionItem(this.element, range, this._lastActiveListItem);
		if (!targetListItem) {
			return false;
		}

		const contentHost = getListItemContentHost(targetListItem);
		if (!contentHost) {
			return false;
		}

		const startListItem = getClosestEditableListItem(range.startContainer, this.element);
		const endListItem = getClosestEditableListItem(range.endContainer, this.element);
		const staysWithinTargetItem = (
			startListItem &&
			endListItem &&
			startListItem === targetListItem &&
			endListItem === targetListItem
		);

		if (staysWithinTargetItem && isRangeFullyInsideContentHost(range, contentHost)) {
			this.setActiveListItem(targetListItem);
			return false;
		}

		return this.selectListItemContents(targetListItem);
	}

	/**
	 * Insert text using native editor command paths first. This keeps browser
	 * contenteditable behavior consistent (including repeated spaces).
	 *
	 * @param {string} text
	 * @returns {boolean}
	 */
	insertTextUsingNativeCommand(text) {
		if (typeof text !== 'string' || !text.length) return false;
		if (!this.ensureSelectionInsideEditor()) return false;
		this.preparePlaceholderInputState();

		try {
			if (typeof document.execCommand === 'function') {
				if (document.execCommand('insertText', false, text)) {
					return true;
				}
				// Fallback for engines that reject insertText in certain hosts.
				if (text === ' ' && document.execCommand('insertHTML', false, '&nbsp;')) {
					return true;
				}
			}
		} catch (error) {
			// Fall through to manual insertion fallback.
		}

		const selection = window.getSelection();
		if (!selection || !selection.rangeCount) return false;

		const range = selection.getRangeAt(0);
		if (!this.element.contains(range.commonAncestorContainer)) return false;

		range.deleteContents();
		const textNode = document.createTextNode(text);
		range.insertNode(textNode);
		range.setStartAfter(textNode);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);

		let inputEvent = null;
		try {
			inputEvent = new InputEvent('input', {
				bubbles: true,
				cancelable: false,
				data: text,
				inputType: 'insertText',
			});
		} catch (error) {
			inputEvent = new Event('input', { bubbles: true });
		}
		this.element.dispatchEvent(inputEvent);
		return true;
	}

	handleInteractiveSpaceKeydown(event) {
		if (!this.shouldHandleSpaceAsText(event)) {
			return false;
		}

		// Block native interactive activation/scroll, then insert text ourselves.
		event.preventDefault();
		event.stopImmediatePropagation();
		return this.insertTextUsingNativeCommand(' ');
	}

	/**
	 * Determine whether Space should be suppressed while an empty list-item
	 * placeholder is visible.
	 *
	 * This matches the behavior of the other placeholder-backed text surfaces:
	 * leading spaces should not count as meaningful input for an empty required
	 * field and should not displace the visual placeholder.
	 *
	 * @param   {KeyboardEvent} event Native keydown event.
	 * @returns {boolean}            True when Space should be ignored.
	 */
	shouldSuppressListPlaceholderSpace(event) {
		if (!this.isSpaceKey(event)) return false;
		if (event.isComposing) return false;
		if (event.ctrlKey || event.metaKey || event.altKey) return false;
		if (!this.element || !isListRootElement(this.element)) return false;

		const listItem = getSelectedEditableListItem(this.element);
		if (!listItem) return false;

		return !!getDirectPlaceholderSpan(listItem);
	}

	/**
	 * Execute an editor action with automatic validation and history management
	 * @param   {Function} actionFn - The action to execute
	 * @param   {Object}   options  - Configuration options
	 * @returns {boolean}           - Whether the action was executed
	 */
	executeAction(actionFn, options = {}) {
		const {
			validateSelection = true,
			saveHistory       = true,
			updateToolbar     = false
		} = options;
		
		// Validate selection is in editor
		if (validateSelection && !this.isSelectionInEditor()) {
			return false;
		}
		
		// Execute the action
		try {
			actionFn();
		} catch (error) {
			console.error('Editor action failed:', error);
			return false;
		}
		
		// Save to history if requested
		if (saveHistory) {
			this.saveToHistory();
		}
		
		// Update toolbar if requested
		if (updateToolbar) {
			setTimeout(() => this.updateToolbarState(), 0);
		}
		
		return true;
	}

	saveToHistory() {
		if (this.historyApi && typeof this.historyApi.saveToHistory === 'function') {
			this.historyApi.saveToHistory();
		}
	}

	undo() {
		if (this.historyApi && typeof this.historyApi.undo === 'function') {
			this.historyApi.undo();
		}
	}

	redo() {
		if (this.historyApi && typeof this.historyApi.redo === 'function') {
			this.historyApi.redo();
		}
	}

	updateUndoRedoButtons() {
		if (!this.toolbarManager || typeof this.toolbarManager.updateUndoRedoButtons !== 'function') {
			return;
		}

		this.toolbarManager.updateUndoRedoButtons();
	}

	canUndo() {
		return !!(this.historyApi && typeof this.historyApi.canUndo === 'function' && this.historyApi.canUndo());
	}

	canRedo() {
		return !!(this.historyApi && typeof this.historyApi.canRedo === 'function' && this.historyApi.canRedo());
	}

	/**
	 * Set one toolbar button's disabled state by its user-facing title.
	 *
	 * @param   {string}  title      Toolbar button title attribute.
	 * @param   {boolean} isDisabled Whether the button should be disabled.
	 * @returns {void}
	 */
	setToolbarButtonDisabled(title, isDisabled) {
		if (!this.toolbarManager || typeof this.toolbarManager.setToolbarButtonDisabled !== 'function') {
			return;
		}

		this.toolbarManager.setToolbarButtonDisabled(title, isDisabled);
	}

	reinitialize(newElement, runtimeOptions = null) {
		// Cleanup old element
		this.cleanup();
		
		// Update element reference
		this.element = newElement;

		if (runtimeOptions && typeof runtimeOptions === 'object') {
			const merged = { ...this.options, ...runtimeOptions };
			if (Object.prototype.hasOwnProperty.call(runtimeOptions, 'formatTargets')) {
				merged.formatTargets = runtimeOptions.formatTargets && typeof runtimeOptions.formatTargets === 'object'
					? { ...runtimeOptions.formatTargets }
					: {};
			}
			this.options = merged;
			this.formats = this.options.formats || this.formats || [];
			this.historyApi = this.options.historyApi || this.historyApi || null;
		}
		
		// Reinitialize
		this.init();
	}
	
	/**
	 * Build the floating toolbar for this editor instance.
	 *
	 * @returns {void}
	 */
	createToolbar() {
		const ToolbarManager = SFE.ToolbarManager || null;
		if (!ToolbarManager) {
			throw new Error('FrontEdit: ToolbarManager is required before MWPEditor can initialize.');
		}

		if (this.toolbarManager && typeof this.toolbarManager.destroy === 'function') {
			this.toolbarManager.destroy();
		}

		this.toolbarManager = new ToolbarManager(this);
		this.toolbarManager.createToolbar();
		this.toolbar = this.toolbarManager.toolbar || null;
	}

	/**
	 * Close any open toolbar dropdown panels.
	 *
	 * @returns {void}
	 */
	closeToolbarDropdowns() {
		if (!this.toolbarManager || typeof this.toolbarManager.closeToolbarDropdowns !== 'function') {
			return;
		}

		this.toolbarManager.closeToolbarDropdowns();
	}

	/**
	 * Close open toolbar dropdowns when a pointer interaction lands outside the
	 * toolbar chrome.
	 *
	 * @returns {void}
	 */
	attachToolbarDropdownCloseHandler() {
		if (!this.toolbarManager || typeof this.toolbarManager.attachToolbarDropdownCloseHandler !== 'function') {
			return;
		}

		this.toolbarManager.attachToolbarDropdownCloseHandler();
	}

	/**
	 * Refresh toolbar active and disabled state from the live editor selection.
	 *
	 * @returns {void}
	 */
	updateToolbarState() {
		if (!this.toolbarManager || typeof this.toolbarManager.updateToolbarState !== 'function') {
			return;
		}

		this.toolbarManager.updateToolbarState();
	}

	showLinkUI(anchorElement = null, options = {}) {
		const force = options.force === true;

		if (!force && this._linkUIActive) {
			const actionsContainer = SFE.activeEditorInstance?.actionsContainer || null;

			if (actionsContainer) {
				const linkUI = actionsContainer.querySelector('.mwp-sfe-link-ui-wrapper');

				if (linkUI) {
					const input = linkUI.querySelector('.mwp-sfe-link-url-entry');

					if (input) {
						input.focus({ preventScroll: true });
					}

					const activeState = SFE.activeEditorInstance;
					const element     = activeState?.element || this.element;
					const toolbar     = activeState?.toolbarContainer || null;

					SFE.PositionManager.positionFloatingElements(element, toolbar, actionsContainer);
				}
			}

			return;
		}

		const isElementLinkEditor = this.supportsElementLinkEditing();

		if (isElementLinkEditor) {
			// Element-scoped link editors mutate the root anchor directly and do
			// not depend on an active text selection.
			anchorElement = this.element;
		} else {
			// Regular inline link: selection must be inside this editor
			if (!this.isSelectionInEditor()) return;
		}

		const actionsContainer = SFE.activeEditorInstance?.actionsContainer;
		if (!actionsContainer) return;

		// Save current selection (used by regular link save; unused for buttons)
		this._savedLinkRange = this.getSelectedRange();

		if (!actionsContainer._savedLinkState) {
			const nodes = Array.from(actionsContainer.childNodes);
			actionsContainer._savedLinkState = {
				nodes: nodes,
				className: actionsContainer.className
			};
		}

		this._linkUIActive = true;

		actionsContainer.innerHTML = '';
		actionsContainer.classList.remove('mwp-sfe-state-hover', 'mwp-sfe-state-edit', 'mwp-sfe-state-comment', 'mwp-sfe-state-preview');
		actionsContainer.classList.add('mwp-sfe-state-link');

		const linkUI = document.createElement('div');
		linkUI.className = 'mwp-sfe-link-ui-wrapper';
		linkUI.innerHTML = `
			<div class="mwp-sfe-link-view" style="display:none;">
				<span class="mwp-sfe-link-preview-wrap">Visit: <a href="#" target="_blank" rel="noopener noreferrer" class="mwp-sfe-link-preview"></a></span>
				<div class="mwp-sfe-link-actions">
					<button type="button" class="mwp-sfe-btn mwp-sfe-btn-primary-inline mwp-sfe-btn-link-edit">Edit</button>
					<button type="button" class="mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-sfe-btn-link-remove">Remove</button>
					<button type="button" class="mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-sfe-btn-link-cancel">Cancel</button>
				</div>
			</div>
			<div class="mwp-sfe-link-edit" style="display:none;">
				<div class="mwp-sfe-link-url">
					<input type="text" class="mwp-sfe-text-entry mwp-sfe-link-url-entry" placeholder="URL">
					<div class="mwp-sfe-link-options">
						<label><input type="checkbox" class="mwp-sfe-link-target"> New tab</label>
						<label><input type="checkbox" class="mwp-sfe-link-nofollow"> No follow</label>
					</div>
				</div>
				<div class="mwp-sfe-link-actions">
					<button type="button" class="mwp-sfe-btn mwp-sfe-btn-primary-inline mwp-sfe-btn-link-save">Apply</button>
					<button type="button" class="mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-sfe-btn-link-cancel">Cancel</button>
				</div>
			</div>
		`;
		actionsContainer.appendChild(linkUI);

		const viewMode      = linkUI.querySelector('.mwp-sfe-link-view');
		const editMode      = linkUI.querySelector('.mwp-sfe-link-edit');
		const urlInput      = linkUI.querySelector('.mwp-sfe-link-url-entry');
		const targetCheck   = linkUI.querySelector('.mwp-sfe-link-target');
		const nofollowCheck = linkUI.querySelector('.mwp-sfe-link-nofollow');

		/**
		 * Build a rel string from an existing value.
		 * - noreferrer / noopener are tied to the "New tab" checkbox
		 * - nofollow is tied to the "No follow" checkbox
		 * - All other tokens are preserved untouched
		 */
		const buildRel = (existingRel, newTab, noFollow) => {
			const managed = new Set(['noreferrer', 'noopener', 'nofollow']);
			const kept    = (existingRel || '').split(/\s+/).filter(r => r && !managed.has(r));
			if (newTab)   { kept.push('noreferrer'); kept.push('noopener'); }
			if (noFollow) { kept.push('nofollow'); }
			return kept.join(' ') || undefined;
		};

		// Switch to edit mode and pre-fill inputs from an optional anchor element.
		const openEditMode = (anchor) => {
			viewMode.style.display  = 'none';
			editMode.style.display  = 'flex';
			urlInput.value          = anchor ? anchor.getAttribute('href') || '' : '';
			targetCheck.checked     = anchor ? anchor.target === '_blank' : false;
			nofollowCheck.checked   = anchor
				? (anchor.getAttribute('rel') || '').split(/\s+/).includes('nofollow')
				: false;
			setTimeout(() => urlInput.focus(), 0);
			if (SFE.activeEditorInstance) {
				const el      = SFE.activeEditorInstance.element;
				const toolbar = SFE.activeEditorInstance.toolbarContainer;

				SFE.PositionManager.positionFloatingElements(el, toolbar, actionsContainer);
			}
		};

		if (anchorElement) {
			const rawHref = anchorElement.getAttribute('href') || '';

			// Element-scoped link editors without a URL go straight to edit mode.
			if (isElementLinkEditor && !rawHref) {
				openEditMode(anchorElement);
			} else {
				// VIEW MODE - existing link
				viewMode.style.display = 'flex';
				editMode.style.display = 'none';

				const preview       = linkUI.querySelector('.mwp-sfe-link-preview');
				preview.href        = anchorElement.href;
				preview.textContent = rawHref.length > 25 ? rawHref.substring(0, 25) + '...' : rawHref;

				linkUI.querySelector('.mwp-sfe-btn-link-remove').onclick = () => {
					if (isElementLinkEditor) {
						// Element-scoped editors clear link attrs on the root anchor.
						anchorElement.removeAttribute('href');
						anchorElement.removeAttribute('target');
						anchorElement.removeAttribute('rel');
						this.attributeChanges.url        = undefined;
						this.attributeChanges.linkTarget = undefined;
						this.attributeChanges.rel        = undefined;
					} else {
						// Regular inline link: unwrap anchor
						const parent = anchorElement.parentNode;
						while (anchorElement.firstChild) parent.insertBefore(anchorElement.firstChild, anchorElement);
						anchorElement.remove();
					}
					this.saveToHistory();
					this.closeLinkUI();
				};

				linkUI.querySelector('.mwp-sfe-btn-link-edit').onclick = () => openEditMode(anchorElement);
			}
		} else {
			// EDIT MODE - new link
			openEditMode(null);
		}

		const handleSave = () => {
			let url = urlInput.value.trim();
			if (!url) return;

			if (!/^https?:\/\//i.test(url) && !url.startsWith('/') && !url.startsWith('#') &&
				!url.startsWith('mailto:') && !url.startsWith('tel:')) {
				url = 'https://' + url;
			}

			// Build rel from current live element rel - preserves custom tokens
			const existingRel = anchorElement ? anchorElement.getAttribute('rel') : null;
			const newRel      = buildRel(existingRel, targetCheck.checked, nofollowCheck.checked);

			if (isElementLinkEditor) {
				// Element-scoped editors update attrs directly on the root anchor.
				anchorElement.setAttribute('href', url);
				if (targetCheck.checked) {
					anchorElement.setAttribute('target', '_blank');
				} else {
					anchorElement.removeAttribute('target');
				}
				if (newRel) {
					anchorElement.setAttribute('rel', newRel);
				} else {
					anchorElement.removeAttribute('rel');
				}
				this.attributeChanges.url         = url;
				this.attributeChanges.linkTarget  = targetCheck.checked ? '_blank' : undefined;
				this.attributeChanges.rel         = newRel;
			} else {
				// Regular inline link: restore selection, then apply or create anchor
				const sel = window.getSelection();
				if (this._savedLinkRange) {
					sel.removeAllRanges();
					sel.addRange(this._savedLinkRange);
				}

				const applyLinkAttributes = (el) => {
					el.setAttribute('href', url);
					if (targetCheck.checked) {
						el.setAttribute('target', '_blank');
					} else {
						el.removeAttribute('target');
					}
					if (newRel) {
						el.setAttribute('rel', newRel);
					} else {
						el.removeAttribute('rel');
					}
				};

				if (anchorElement) {
					applyLinkAttributes(anchorElement);
				} else {
					const range = this._savedLinkRange;
					if (!range) return;

					const newAnchor = document.createElement('a');
					applyLinkAttributes(newAnchor);

					if (range.collapsed) {
						newAnchor.textContent = url;
						range.insertNode(newAnchor);
					} else {
						try {
							range.surroundContents(newAnchor);
						} catch (e) {
							newAnchor.appendChild(range.extractContents());
							range.insertNode(newAnchor);
						}
					}
				}
			}

			this.saveToHistory();
			this.closeLinkUI();
		};

		linkUI.querySelector('.mwp-sfe-btn-link-save').onclick = handleSave;
		linkUI.querySelectorAll('.mwp-sfe-btn-link-cancel').forEach(btn => {
			btn.onclick = () => this.closeLinkUI();
		});
		urlInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
		});

		if (SFE.activeEditorInstance) {
			const el      = SFE.activeEditorInstance.element;
			const toolbar = SFE.activeEditorInstance.toolbarContainer;
			setTimeout(() => {
				SFE.PositionManager.positionFloatingElements(el, toolbar, actionsContainer);
			}, 0);
		}
	}

	closeLinkUI() {
		if (!this._linkUIActive) return;
		
		const actionsContainer = SFE.activeEditorInstance?.actionsContainer;
		if (!actionsContainer) return;
		
		if (actionsContainer._savedLinkState) {
			// Remove the link UI wrapper
			const linkUIWrapper = actionsContainer.querySelector('.mwp-sfe-link-ui-wrapper');
			if (linkUIWrapper) {
				linkUIWrapper.remove();
			}
			
			// Restore classes
			actionsContainer.className = actionsContainer._savedLinkState.className;
			
			// Restore the original buttons by re-appending the saved nodes
			if (actionsContainer._savedLinkState.nodes) {
				actionsContainer._savedLinkState.nodes.forEach(node => {
					actionsContainer.appendChild(node);
				});
			}
			
			delete actionsContainer._savedLinkState;
		}
		this._linkUIActive = false;
		this.element.focus();
		
		// Reposition action bar
		if (SFE.activeEditorInstance) {
			const el      = SFE.activeEditorInstance.element;
			const toolbar = SFE.activeEditorInstance.toolbarContainer;

			SFE.PositionManager.positionFloatingElements(el, toolbar, actionsContainer);
		}
	}

	insertNewline() {
		const preparedLinebreakPlaceholder = this.prepareLinebreakPlaceholderInputState();
		if (!preparedLinebreakPlaceholder) {
			this.preparePlaceholderInputState();
		}

		const selection = window.getSelection();
		if (!selection.rangeCount) return;

		const range = selection.getRangeAt(0);

		// Clear any highlighted text
		range.deleteContents();

		let node = range.endContainer;
		let offset = range.endOffset;

		const inlineTags = ['A', 'STRONG', 'B', 'EM', 'I', 'S', 'STRIKE', 'U', 'SPAN', 'CODE', 'MARK'];

		// 1. Step out of inline elements if at the END boundary
		if (node.nodeType === Node.TEXT_NODE && offset === node.length) {
			let current = node;
			let parent = current.parentNode;

			while (parent && parent !== this.element && inlineTags.includes(parent.tagName.toUpperCase())) {
				let isLast = true;
				let sibling = current.nextSibling;
				
				while (sibling) {
					// Ignore empty text nodes or existing ZWS
					if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent.replace(/\uFEFF/g, '').length === 0) {
						sibling = sibling.nextSibling;
						continue;
					}
					isLast = false;
					break;
				}

				if (isLast) {
					range.setStartAfter(parent);
					range.collapse(true);
					current = parent;
					parent = current.parentNode;
				} else {
					break;
				}
			}
		}
		// 2. Step out of inline elements if at the START boundary
		else if (node.nodeType === Node.TEXT_NODE && offset === 0) {
			let current = node;
			let parent = current.parentNode;

			while (parent && parent !== this.element && inlineTags.includes(parent.tagName.toUpperCase())) {
				let isFirst = true;
				let sibling = current.previousSibling;
				
				while (sibling) {
					if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent.replace(/\uFEFF/g, '').length === 0) {
						sibling = sibling.previousSibling;
						continue;
					}
					isFirst = false;
					break;
				}

				if (isFirst) {
					range.setStartBefore(parent);
					range.collapse(true);
					current = parent;
					parent = current.parentNode;
				} else {
					break;
				}
			}
		}

		// 3. Insert the actual line break
		const br = document.createElement('br');
		range.insertNode(br);

		// 4. Check if we are at the very end of the container
		let nextNode = br.nextSibling;
		let isAtEnd = true;
		let trailingPlaceholderNode = null;
		
		while (nextNode) {
			if (isLinebreakPlaceholderNode(nextNode)) {
				if (!trailingPlaceholderNode) {
					trailingPlaceholderNode = nextNode;
				} else {
					const duplicatePlaceholder = nextNode;
					nextNode = nextNode.nextSibling;
					duplicatePlaceholder.remove();
					continue;
				}

				nextNode = nextNode.nextSibling;
				continue;
			}

			if (nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent.replace(/\uFEFF/g, '').length === 0) {
				nextNode = nextNode.nextSibling;
				continue;
			}
			isAtEnd = false;
			break;
		}

		// 5. The Zero-Width Space Hack
		// If at the end, insert \uFEFF so the browser renders the <br> 
		// and places the caret on the new line correctly without swallowing keystrokes.
		if (isAtEnd) {
			const zws = trailingPlaceholderNode || document.createTextNode('\uFEFF');
			zws.textContent = '\uFEFF';
			if (zws.parentNode !== br.parentNode || zws.previousSibling !== br) {
				br.parentNode.insertBefore(zws, br.nextSibling);
			}
		}

		// 6. Move caret cleanly after the <br>
		const newRange = document.createRange();
		newRange.setStartAfter(br);
		newRange.collapse(true);

		selection.removeAllRanges();
		selection.addRange(newRange);
	}

	/**
	 * Check if a list item is empty (ignoring nested lists)
	 */
	isListItemEmpty(li) {
		return !listItemHasMeaningfulContent(li);
	}

	/**
	 * Return the direct nested list owned by one list item.
	 *
	 * @param   {HTMLLIElement|null} li Candidate list item.
	 * @returns {HTMLElement|null}      Direct nested list, when present.
	 */
	getDirectChildList(li) {
		if (!li || li.nodeType !== Node.ELEMENT_NODE || li.tagName !== 'LI') {
			return null;
		}

		return Array.from(li.children || []).find(child => (
			child &&
			(child.tagName === 'OL' || child.tagName === 'UL')
		)) || null;
	}

	/**
	 * Return how deeply nested one list item is below the root list.
	 *
	 * Root-level items have depth `0`.
	 *
	 * @param   {HTMLLIElement|null} li Candidate list item.
	 * @returns {number}                Zero-based nesting depth.
	 */
	getListItemDepth(li) {
		if (!li || li.nodeType !== Node.ELEMENT_NODE || li.tagName !== 'LI') {
			return -1;
		}

		let depth = 0;
		let cursor = li.parentElement;
		while (cursor && cursor !== this.element) {
			if (cursor.tagName === 'LI') {
				depth++;
			}
			cursor = cursor.parentElement;
		}

		return depth;
	}

	/**
	 * Return whether the caret is at the very start of one list item's own
	 * editable inline content.
	 *
	 * @param   {HTMLLIElement|null} li Candidate list item.
	 * @returns {boolean}               True when the caret is at the direct-content start.
	 */
	isCursorAtStartOfListItem(li) {
		const sel = window.getSelection();
		if (!sel.rangeCount || !sel.isCollapsed || !li?.contains(sel.getRangeAt(0).commonAncestorContainer)) {
			return false;
		}

		const contentRange = createDirectListItemContentRange(li);
		if (!contentRange) {
			return false;
		}

		const testRange = sel.getRangeAt(0).cloneRange();
		try {
			testRange.setStart(contentRange.startContainer, contentRange.startOffset);
		} catch (error) {
			return false;
		}

		return !fragmentHasMeaningfulContent(testRange.cloneContents());
	}

	/**
	 * Checks if the cursor is at the very end of the text content within an LI, 
	 * ignoring any nested lists that come after the text.
	 */
	isCursorAtEndOfListItem(li) {
		const sel = window.getSelection();
		if (!sel.rangeCount || !sel.isCollapsed) return false;
		const range = sel.getRangeAt(0);

		// Check if the cursor is actually inside this li
		if (!li.contains(range.commonAncestorContainer)) return false;

		const contentRange = createDirectListItemContentRange(li);
		if (!contentRange) {
			return false;
		}

		const testRange = range.cloneRange();

		try {
			testRange.setEnd(contentRange.endContainer, contentRange.endOffset);
			return !fragmentHasMeaningfulContent(testRange.cloneContents());
		} catch (e) {
			return false; // Fail safe if range boundaries get messy
		}
	}

	/**
	 * Return the next visually ordered list item in this list tree.
	 *
	 * @param   {HTMLLIElement|null} li Current list item.
	 * @returns {HTMLLIElement|null}    Next visual list item.
	 */
	findNextVisualListItem(li) {
		if (!li || li.nodeType !== Node.ELEMENT_NODE || li.tagName !== 'LI') {
			return null;
		}

		const directChildList = this.getDirectChildList(li);
		const firstChild = directChildList?.firstElementChild;
		if (firstChild?.tagName === 'LI') {
			return firstChild;
		}

		let cursor = li;
		while (cursor && cursor !== this.element) {
			const nextSibling = cursor.nextElementSibling;
			if (nextSibling?.tagName === 'LI') {
				return nextSibling;
			}

			const ancestorList = cursor.parentElement;
			const ancestorItem = ancestorList?.parentElement?.tagName === 'LI'
				? ancestorList.parentElement
				: null;
			cursor = ancestorItem;
		}

		return null;
	}

	/**
	 * Return the deepest last descendant of one list item.
	 *
	 * @param   {HTMLLIElement|null} li Candidate list item.
	 * @returns {HTMLLIElement|null}    Deepest trailing descendant.
	 */
	findDeepestLastDescendantListItem(li) {
		if (!li || li.nodeType !== Node.ELEMENT_NODE || li.tagName !== 'LI') {
			return null;
		}

		let current = li;
		while (true) {
			const directChildList = this.getDirectChildList(current);
			const lastChild = directChildList?.lastElementChild;
			if (!lastChild || lastChild.tagName !== 'LI') {
				return current;
			}
			current = lastChild;
		}
	}

	/**
	 * Return the previous visually ordered list item in this list tree.
	 *
	 * @param   {HTMLLIElement|null} li Current list item.
	 * @returns {HTMLLIElement|null}    Previous visual list item.
	 */
	findPreviousVisualListItem(li) {
		if (!li || li.nodeType !== Node.ELEMENT_NODE || li.tagName !== 'LI') {
			return null;
		}

		const previousSibling = li.previousElementSibling;
		if (previousSibling?.tagName === 'LI') {
			return this.findDeepestLastDescendantListItem(previousSibling);
		}

		const parentList = li.parentElement;
		const parentItem = parentList?.parentElement?.tagName === 'LI'
			? parentList.parentElement
			: null;
		return parentItem || null;
	}

	/**
	 * Move one list item's direct inline content into another list item.
	 *
	 * Nested child lists are preserved outside the direct text surface and are
	 * merged after the inline content transfer.
	 *
	 * @param   {HTMLLIElement|null} targetLi Destination list item.
	 * @param   {HTMLLIElement|null} sourceLi Source list item.
	 * @returns {boolean}                     True when content was merged.
	 */
	mergeListItems(targetLi, sourceLi) {
		if (
			!targetLi ||
			!sourceLi ||
			targetLi === sourceLi ||
			targetLi.tagName !== 'LI' ||
			sourceLi.tagName !== 'LI'
		) {
			return false;
		}

		const targetHost = getListItemContentHost(targetLi);
		const sourceHost = getListItemContentHost(sourceLi);
		if (!targetHost || !sourceHost) {
			return false;
		}

		clearListItemPlaceholderPresentation(targetLi);
		clearListItemPlaceholderPresentation(sourceLi);
		removeListItemPlaceholderBreaks(targetLi);
		removeListItemPlaceholderBreaks(sourceLi);

		if (listItemHasMeaningfulContent(sourceLi)) {
			while (sourceHost.firstChild) {
				targetHost.appendChild(sourceHost.firstChild);
			}
		}

		const sourceNestedList = this.getDirectChildList(sourceLi);
		if (sourceNestedList) {
			const targetNestedList = this.getDirectChildList(targetLi);
			if (targetNestedList && targetNestedList.tagName === sourceNestedList.tagName) {
				while (sourceNestedList.firstChild) {
					targetNestedList.appendChild(sourceNestedList.firstChild);
				}
				sourceNestedList.remove();
			} else {
				targetLi.appendChild(sourceNestedList);
			}
		}

		if (typeof targetHost.normalize === 'function') {
			targetHost.normalize();
		}

		this.normalizeListItem(targetLi);
		return true;
	}

	/**
	 * Remove one list item, cascading any nested child items up to the removed
	 * item's parent list level.
	 *
	 * @param   {HTMLLIElement|null} li Candidate list item.
	 * @returns {HTMLLIElement|null}    Best follow-up cursor target.
	 */
	removeListItemAndCascadeChildren(li) {
		if (!li || li.nodeType !== Node.ELEMENT_NODE || li.tagName !== 'LI') {
			return null;
		}

		const parentList = li.parentElement;
		if (!parentList) {
			return null;
		}

		const nextSibling = li.nextElementSibling;
		const previousVisual = this.findPreviousVisualListItem(li);
		const nestedList = this.getDirectChildList(li);
		if (nestedList) {
			const insertionParent = parentList;
			let insertionRef = nextSibling;
			while (nestedList.firstChild) {
				const child = nestedList.firstChild;
				insertionParent.insertBefore(child, insertionRef);
			}
			nestedList.remove();
		}

		li.remove();

		if (!parentList.children.length && parentList !== this.element) {
			parentList.remove();
		}

		return nextSibling?.tagName === 'LI'
			? nextSibling
			: (previousVisual || null);
	}

	/**
	 * Return whether one list item can be indented under its previous sibling.
	 *
	 * @param   {HTMLLIElement|null} li Candidate list item.
	 * @returns {boolean}              True when indent is currently possible.
	 */
	canIndentListItem(li) {
		return !!(
			li &&
			li.nodeType === Node.ELEMENT_NODE &&
			li.tagName === 'LI' &&
			li.previousElementSibling &&
			li.previousElementSibling.tagName === 'LI'
		);
	}

	/**
	 * Return whether one list item can be outdented to its ancestor list.
	 *
	 * @param   {HTMLLIElement|null} li Candidate list item.
	 * @returns {boolean}              True when outdent is currently possible.
	 */
	canOutdentListItem(li) {
		if (!li || li.nodeType !== Node.ELEMENT_NODE || li.tagName !== 'LI') {
			return false;
		}

		const parentList = li.parentNode;
		const grandParentListItem = parentList?.parentNode;
		return !!(
			parentList &&
			(parentList.tagName === 'UL' || parentList.tagName === 'OL') &&
			grandParentListItem &&
			grandParentListItem.tagName === 'LI'
		);
	}

	/**
	 * Determine whether Enter on the current selection should outdent an empty
	 * nested list item through FrontEdit's structural list operation path instead of
	 * relying on browser-native contenteditable list splitting.
	 *
	 * Some themes can influence the browser's native list-splitting DOM result,
	 * which makes Enter on an empty nested item detach sibling list wrappers into
	 * invalid structures before FrontEdit regains control. Routing only this unstable
	 * case through the shared outdent operation keeps the behavior deterministic
	 * while preserving native Enter handling for normal list-item creation.
	 *
	 * @param   {KeyboardEvent} event Native keydown event.
	 * @returns {HTMLLIElement|null}  Empty nested list item to outdent, or null.
	 */
	getEmptyNestedListItemForEnterOutdent(event) {
		if (!event || event.key !== 'Enter' || event.shiftKey) {
			return null;
		}

		if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
			return null;
		}

		const selection = window.getSelection();
		if (!selection || !selection.rangeCount || !selection.isCollapsed) {
			return null;
		}

		const listItem = this.getCurrentListItem();
		if (!listItem || !this.isListItemEmpty(listItem) || !this.canOutdentListItem(listItem)) {
			return null;
		}

		return listItem;
	}

	/**
	 * Outdent one empty nested list item in response to Enter.
	 *
	 * @param   {KeyboardEvent} event Native keydown event.
	 * @returns {boolean}            True when the key event was handled.
	 */
	handleEmptyNestedListItemEnter(event) {
		const listItem = this.getEmptyNestedListItemForEnterOutdent(event);
		if (!listItem) {
			return false;
		}

		event.preventDefault();

		return !!this.executeListStructureOperation({
			kind: 'outdent_list_item',
			listItem,
		});
	}

	/**
	 * Execute one primitive structural list operation through the shared schema
	 * executor.
	 *
	 * This keeps toolbar actions and keyboard-driven list mutations on the same
	 * canonical executor path that the public API wraps for external callers
	 * after translating its higher-level command vocabulary.
	 *
	 * @param   {Object} options Operation execution options.
	 * @returns {Object|null}    Applied-operation summary when the mutation applied.
	 */
	executeListStructureOperation(options = {}) {
		const operationExecutor = SFE.SchemaOperationExecutor || null;
		if (!operationExecutor || typeof operationExecutor.executeListOperations !== 'function') {
			return null;
		}

		const operation = options && typeof options === 'object'
			? options
			: {};

		return operationExecutor.executeListOperations({
			editorHost: this,
			saveHistory: operation.saveHistory !== false,
			restoreCursor: operation.restoreCursor !== false,
			operations: [ operation ],
		});
	}
	
	attachEvents() {
		this._interactiveSpaceKeydownHandler = (e) => {
			this.handleInteractiveSpaceKeydown(e);
		};
		document.addEventListener('keydown', this._interactiveSpaceKeydownHandler, true);

		// Store handlers so we can reattach after tag change
		this._keydownHandler = (e) => {
			if (this.shouldSuppressListPlaceholderSpace(e)) {
				e.preventDefault();
				return;
			}

			if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'a' && isListRootElement(this.element)) {
				const activeListItem = this.updateActiveListItemFromSelection() || this._lastActiveListItem;
				if (this.handleListSelectAll(activeListItem)) {
					e.preventDefault();
					return;
				}
			}

			// Handle Backspace from the start of list-item content using the list tree.
			if (e.key === 'Backspace' && this.getParentList()) {
				const li = this.getCurrentListItem();
				if (li && this.isCursorAtStartOfListItem(li)) {
					e.preventDefault();

					if (this.getListItemDepth(li) > 0) {
						executeOutdentOperation(this);
						return;
					}

					const previousLi = this.findPreviousVisualListItem(li);
					if (!previousLi) {
						return;
					}

					if (this.isListItemEmpty(li)) {
						const cursorTarget = this.removeListItemAndCascadeChildren(li) || previousLi;
						if (cursorTarget) {
							this.setCursorInElement(cursorTarget, 99999);
						}
						this.saveToHistory();
						return;
					}

					if (this.mergeListItems(previousLi, li)) {
						const parentList = li.parentElement;
						li.remove();
						if (parentList && !parentList.children.length && parentList !== this.element) {
							parentList.remove();
						}
						this.setCursorInElement(previousLi, 99999);
						this.saveToHistory();
					}
					return;
				}
			}

			// Handle Delete from the end of list-item content using the next visual item.
			if (e.key === 'Delete' && this.getParentList()) {
				const li = this.getCurrentListItem();
				if (li && (this.isListItemEmpty(li) || this.isCursorAtEndOfListItem(li))) {
					e.preventDefault();
					
					const savedPos = this.saveCursorPosition();

					const nextLi = this.findNextVisualListItem(li);
					if (!nextLi) {
						this.restoreCursorPosition(savedPos);
						return;
					}

					if (this.getListItemDepth(nextLi) > 0) {
						const result = this.executeListStructureOperation({
							kind: 'outdent_list_item',
							listItem: nextLi,
						});
						if (result) {
							this.restoreCursorPosition(savedPos);
						}
						return;
					}

					if (this.isListItemEmpty(nextLi)) {
						this.removeListItemAndCascadeChildren(nextLi);
						this.restoreCursorPosition(savedPos);
						this.saveToHistory();
						return;
					}

					if (this.mergeListItems(li, nextLi)) {
						const nextParentList = nextLi.parentElement;
						nextLi.remove();
						if (nextParentList && !nextParentList.children.length && nextParentList !== this.element) {
							nextParentList.remove();
						}
						this.restoreCursorPosition(savedPos);
						this.saveToHistory();
					}
					return;
				}
			}

			// Handle Enter Key
			if (e.key === 'Enter') {
				if (this.handleEmptyNestedListItemEnter(e)) {
					return;
				}

				const enterMode = this.getEnterMode();
				if (enterMode === 'never') {
					e.preventDefault();
					return;
				}
				if (enterMode === 'linebreak') {
					e.preventDefault();
					this.insertNewline();
					this.saveToHistory();
					return;
				}
			}

			// Handle tab/shift-tab to indent/outdent
			if (e.key === 'Tab') {
				e.preventDefault();
				const inList = this.getParentList();
				if (inList) {
					if (e.shiftKey) {
						executeOutdentOperation(this);
					} else {
						executeIndentOperation(this);
					}
				}
			}
			
			// Undo/Redo keyboard shortcuts
			if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
				e.preventDefault();
				this.undo();
			}
			if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
				e.preventDefault();
				this.redo();
			}
			
			// Override browser native formatting shortcuts
			if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
				e.preventDefault();
				this.toggleInlineFormat('strong');
			}
			if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
				e.preventDefault();
				this.toggleInlineFormat('em');
			}
			if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
				e.preventDefault();
				// Optionally add underline support or do nothing
				// WordPress doesn't typically use <u> tags
			}
		};
		
		this._updateToolbarHandler = () => {
			this.normalizeExpandedListItemSelection();
			this.updateToolbarState();
		};

		this._beforeInputHandler = (e) => {
			const inputType = typeof e?.inputType === 'string' ? e.inputType : '';
			if (inputType === 'selectAll' && isListRootElement(this.element)) {
				const activeListItem = this._pendingContextMenuListItem || this.updateActiveListItemFromSelection() || this._lastActiveListItem;
				if (this.handleListSelectAll(activeListItem)) {
					e.preventDefault();
				}
				return;
			}

			if (!inputType.startsWith('insert')) {
				return;
			}

			this.preparePlaceholderInputState();
		};

		// Track input for history
		this._inputHandler = () => {
			this.normalizeInputMarkup();
			syncListItemTextSurfaces(this.element);
			if (isListRootElement(this.element)) {
				const listTracker = SFE.ListBlockTracker || null;
				if (listTracker && typeof listTracker.ensureIdentityAttributes === 'function') {
					listTracker.ensureIdentityAttributes(this.element);
				}
			}
			if (isListRootElement(this.element)) {
				this.element.querySelectorAll('li').forEach(li => this.normalizeListItem(li));
			}

			// When typing into a list item that has a <br> placeholder AND a nested
			// list child, the browser won't auto-remove the <br> (it only does so for
			// plain empty <li><br></li>). Remove it manually as soon as there is real
			// text content in the li (ignoring the nested list children).
			const li = this.getCurrentListItem();
			if (li) {
				const contentHost = getListItemContentHost(li);
				const hasNestedList = li.querySelector(':scope > ul, :scope > ol');
				if (hasNestedList && contentHost && listItemHasMeaningfulContent(li)) {
					Array.from(contentHost.childNodes || []).forEach(node => {
						if (node && node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
							node.remove();
						}
					});
				}
			}

			this.cleanupLinebreakPlaceholderArtifacts();
			this.syncPlaceholderState();

			clearTimeout(this.inputTimeout);
			this.inputTimeout = setTimeout(() => {
				this.saveToHistory();
			}, 500);
		};

		// Click/select links to open link UI, close UI when clicking elsewhere in editor
		this._linkClickHandler = (e) => {
			// Suppress auto-link UI when the schema declares manual link UI or
			// element-scoped link editing.
			if (this.supportsElementLinkEditing() || this.getLinkUIMode() === 'manual') return;

			// Check if clicking/selecting inside a link
			const linkElement = e.target.closest('a');
			
			if (linkElement && linkElement.closest('[contenteditable="true"]')) {
				e.preventDefault();
				e.stopPropagation();
				
				// Open link UI
				this.showLinkUI(linkElement);
			} else if (this._linkUIActive && e.target.closest('[contenteditable="true"]')) {
				// Clicked on text in editor (not a link) while link UI is active - close it
				// But don't close if clicking on toolbar or action bar
				if (!e.target.closest('.mwp-sfe-inline-toolbar') && 
					!e.target.closest('.mwp-sfe-inline-actions')) {
					this.closeLinkUI();
				}
			}
		};

		// Also check selection changes for links
		this._selectionChangeHandler = () => {
			if (!this._isApplyingListSelectAll && this._pendingContextMenuListItem) {
				const selection = window.getSelection();
				const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
				if (range && !range.collapsed && this.handleListSelectAll(this._pendingContextMenuListItem)) {
					return;
				}
			}

			clearTimeout(this._selectionTimeout);
			this._selectionTimeout = setTimeout(() => {
				if (this._isApplyingListSelectAll) {
					return;
				}

				const selection = window.getSelection();
				if (!selection?.rangeCount) return;

				this.normalizeExpandedListItemSelection();

				const range = selection.getRangeAt(0);
				this.updateActiveListItemFromSelection();

				// Suppress auto-link UI when the schema declares manual link UI or
				// element-scoped link editing.
				if (this.supportsElementLinkEditing() || this.getLinkUIMode() === 'manual') return;
				if (range.collapsed) return; // Only care about actual selections, not cursor
				
				// Check if selection is inside or contains a link
				let node        = range.commonAncestorContainer;
				let linkElement = null;
				
				// Walk up to find link
				while (node && node !== this.element) {
					if (node.nodeType === 1 && node.tagName === 'A') {
						linkElement = node;
						break;
					}
					node = node.parentNode;
				}
				
				// Open link UI if we found a link and it's not already open
				if (linkElement && !this._linkUIActive) {
					this.showLinkUI(linkElement);
				}
			}, 150);
		};

		this._contextMenuHandler = (e) => {
			if (!isListRootElement(this.element)) {
				return;
			}

			const clickedListItem = e.target?.closest?.('li');
			if (clickedListItem && this.element.contains(clickedListItem)) {
				this.setActiveListItem(clickedListItem);
				this._pendingContextMenuListItem = clickedListItem;
				this.setPendingListSelectAllVisualState(true);
			}
		};

		document.addEventListener('selectionchange', this._selectionChangeHandler);
		this.element.addEventListener('click', this._linkClickHandler, true);
		this.element.addEventListener('keydown', this._keydownHandler);
		this.element.addEventListener('beforeinput', this._beforeInputHandler);
		this.element.addEventListener('contextmenu', this._contextMenuHandler);
		this.element.addEventListener('mouseup', this._updateToolbarHandler);
		this.element.addEventListener('keyup', this._updateToolbarHandler);
		this.element.addEventListener('focus', this._updateToolbarHandler);
		this.element.addEventListener('input', this._inputHandler);

		// PASTE - Force plain text only, no tags, replace nbsp
		this._pasteHandler = (e) => {
			e.preventDefault();
			this.prepareLinebreakPlaceholderInputState();
			this.preparePlaceholderInputState();
			
			// Get plain text only
			let text = (e.clipboardData || window.clipboardData).getData('text/plain');
			
			// Replace all nbsp with regular spaces
			text = text.replace(/\u00A0/g, ' ');
			
			// Insert as plain text node (no HTML parsing)
			const selection = window.getSelection();
			if (!selection.rangeCount) return;
			
			const range = selection.getRangeAt(0);
			range.deleteContents();
			
			// Insert plain text node directly
			const textNode = document.createTextNode(text);
			range.insertNode(textNode);
			
			// Move cursor after inserted text
			range.setStartAfter(textNode);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			
			this.saveToHistory();
		};

		this.element.addEventListener('paste', this._pasteHandler);

		// Initial state
		setTimeout(() => this.updateToolbarState(), 0);
	}
	
	/**
	 * Replace the root editable element with a new tag while preserving content,
	 * editor wiring, and schema-backed attribute tracking.
	 *
	 * @param {string} newTag New root tag name.
	 * @param {Object} [options={}] Mutation options.
	 * @param {boolean} [options.validateSelection=true] Require live selection inside the editor.
	 * @param {boolean} [options.saveHistory=true] Save one history entry after mutation.
	 * @returns {void}
	 */
	changeElementTag(newTag, options = {}) {
		const shouldValidateSelection = options.validateSelection !== false;
		const shouldSaveHistory = options.saveHistory !== false;

		// Validate selection is within this editor
		if (shouldValidateSelection && !this.isSelectionInEditor()) {
			return; // Selection is outside this editor, do nothing
		}

		// Don't change if already this tag
		if (this.element.tagName.toLowerCase() === newTag.toLowerCase()) {
			return;
		}
	
		// Close link UI IMMEDIATELY before any DOM changes
		if (this._linkUIActive) {
			this.closeLinkUI();
		}
		
		// Save selection/caret position using the shared snapshot helper so tag
		// swaps preserve expanded selections instead of collapsing to one caret.
		const savedPosition = this.saveCursorPosition();
		
		const oldElement = this.element;
		const newElement = document.createElement(newTag);

		// Copy all attributes EXCEPT plugin-specific ones
		Array.from(oldElement.attributes).forEach(attr => {
			if (attr.name === 'contenteditable') {
				return;
			}
			newElement.setAttribute(attr.name, attr.value);
		});

		if (oldElement.dataset.mwpSfeUuid) {
			newElement.dataset.mwpSfeUuid = oldElement.dataset.mwpSfeUuid;
		}
		
		// Copy content
		newElement.innerHTML = oldElement.innerHTML;
		
		// Replace in DOM
		oldElement.parentNode.replaceChild(newElement, oldElement);

		// Transfer editor reference to new element
		newElement._mwpEditor = this;
		
		// Keep block-root targeting aligned with the live element so schema-backed
		// block formats like `align` continue to mutate the replacement heading.
		if (this.options?.blockRootElement === oldElement) {
			this.options.blockRootElement = newElement;
		}

		// Update element reference
		this.element = newElement;
		
		// DON'T cleanup/reinit - just update what's needed:
		// Make new element editable
		this.element.contentEditable = true;
		this.element.classList.add('mwp-sfe-editor-content');
		this.syncPlaceholderState();
		
		// Reattach event listeners to new element
		if (this._keydownHandler) {
			oldElement.removeEventListener('keydown', this._keydownHandler);
			this.element.addEventListener('keydown', this._keydownHandler);
		}
		if (this._updateToolbarHandler) {
			oldElement.removeEventListener('mouseup', this._updateToolbarHandler);
			oldElement.removeEventListener('keyup', this._updateToolbarHandler);
			oldElement.removeEventListener('focus', this._updateToolbarHandler);
			
			this.element.addEventListener('mouseup', this._updateToolbarHandler);
			this.element.addEventListener('keyup', this._updateToolbarHandler);
			this.element.addEventListener('focus', this._updateToolbarHandler);
		}

		if (this._linkClickHandler) {
			oldElement.removeEventListener('click', this._linkClickHandler, true);
			this.element.addEventListener('click', this._linkClickHandler, true);
		}
		if (this._inputHandler) {
			oldElement.removeEventListener('input', this._inputHandler);
			this.element.addEventListener('input', this._inputHandler);
		}
		if (this._beforeInputHandler) {
			oldElement.removeEventListener('beforeinput', this._beforeInputHandler);
			this.element.addEventListener('beforeinput', this._beforeInputHandler);
		}
		if (this._pasteHandler) {
			oldElement.removeEventListener('paste', this._pasteHandler);
			this.element.addEventListener('paste', this._pasteHandler);
		}
		
		// Close link UI before changing tags - tag changes are structural
		if (this._linkUIActive) {
			this.closeLinkUI();
		}

		// Fire event for external systems (action bar, etc)
		const changeEvent = new CustomEvent('mwp-sfe-element-replaced', {
			detail: { 
				oldElement: oldElement,
				newElement: newElement,
				editorHost: this
			}
		});

		document.dispatchEvent(changeEvent);
		
		// Update global reference
		if (SFE.activeEditorInstance && SFE.activeEditorInstance.element === oldElement) {
			SFE.activeEditorInstance.element = newElement;
		}
		
		// Update toolbar state
		setTimeout(() => this.updateToolbarState(), 0);

		// Restore cursor
		if (savedPosition) {
			setTimeout(() => {
				this.restoreCursorPosition(savedPosition);
				this.element.focus();
			}, 0);
		}

		// Save to history after tag change (unless restoring)
		if (shouldSaveHistory && !this.isRestoring) {
			this.saveToHistory();
		}
	}

	/**
	 * Change list type between OL and UL while preserving all attributes
	 * Preserves UUIDs, classes, styles, and all other attributes
	 * @param {HTMLElement} listElement - The list element to convert
	 * @param {string} newType - 'ol' or 'ul'
	 * @returns {HTMLElement} - The new list element
	 */
	changeListType(listElement, newType, options = {}) {
		if (!listElement || (listElement.tagName !== 'OL' && listElement.tagName !== 'UL')) {
			return listElement;
		}

		newType = newType.toUpperCase();

		if (newType !== 'OL' && newType !== 'UL') {
			return listElement;
		}
		
		// Already the correct type
		if (listElement.tagName === newType) {
			return listElement;
		}
		
		const shouldRestoreCursor = options.restoreCursor !== false;
		const shouldSaveHistory = options.saveHistory !== false;
		const savedPosition = shouldRestoreCursor ? this.saveCursorPosition() : null;

		// Get the specific tracker for THIS list element
    	const specificTracker = listElement._mwpListTracker || (SFE.ListBlockTracker && SFE.ListBlockTracker.active);
		
		// Create new list element with the new tag
		const newList = document.createElement(newType.toLowerCase());
		
		// Copy ALL attributes (including data-list-id, class, style, etc.)
		Array.from(listElement.attributes).forEach(attr => {
			newList.setAttribute(attr.name, attr.value);
		});
		
		// Move all children (preserving their attributes including data-item-id)
		while (listElement.firstChild) {
			newList.appendChild(listElement.firstChild);
		}
		
		// Replace in DOM
		if (!listElement.parentNode) return listElement;

		listElement.parentNode.replaceChild(newList, listElement);

		// Track ordered attribute
    	this.attributeChanges.ordered = (newType === 'OL');
		
		// Update references if this is the root element
		if (this.element === listElement) {
			const oldList = listElement;
			this.reinitialize(newList);
			this.updateUndoRedoButtons();
			
			// USE THE SPECIFIC TRACKER
			if (SFE.ListBlockTracker && specificTracker) {
				SFE.ListBlockTracker.updateElement(
					specificTracker,
					newList
				);
			}
			
			// Dispatch event for UI manager
			document.dispatchEvent(new CustomEvent('mwp-sfe-element-replaced', {
				detail: {
					oldElement: oldList,
					newElement: newList,
					editorHost: this
				}
			}));
		}
		
		if (shouldSaveHistory) {
			this.saveToHistory();
		}
		
		// Restore cursor
		if (shouldRestoreCursor && savedPosition) {
			requestAnimationFrame(() => {
				this.restoreCursorPosition(savedPosition);
				newList.focus();
			});
		}
		
		return newList;
	}

	/**
	 * Toggle an inline formatting tag for the current selection.
	 *
	 * Collapsed selections are handled by moving the caret out of the active
	 * format wrapper. Expanded selections use temporary markers for the DOM
	 * mutation itself, but the final selection is restored from text offsets so
	 * structural tag splits do not leave the browser pointing at detached nodes.
	 *
	 * @param {string} tagName Inline tag name to toggle.
	 * @return {void}
	 */
	toggleInlineFormat(tagName) {
		// Validate selection is within this editor
		if (!this.isSelectionInEditor()) {
			return; // Selection is outside this editor, do nothing
		}

		const selection = window.getSelection();
		if (!selection.rangeCount) return;

		let range = selection.getRangeAt(0);
		const tag = tagName.toUpperCase();

		// ==========================================
		// SCENARIO 1: No Selection (Collapsed Cursor)
		// ==========================================
		if (range.collapsed) {
			// Find if we are currently inside the format tag
			let formatNode = null;
			let curr       = range.commonAncestorContainer;
			while (curr && curr !== this.element) {
				if (curr.nodeType === 1 && curr.tagName === tag) {
					formatNode = curr;
					break;
				}
				curr = curr.parentNode;
			}

			if (formatNode) {
				// Unwrap the format tag
				const marker = document.createTextNode('\uFEFF');
				range.insertNode(marker);

				const parent = formatNode.parentNode;
				while (formatNode.firstChild) {
					parent.insertBefore(formatNode.firstChild, formatNode);
				}
				formatNode.remove();

				range = document.createRange();
				range.setStartAfter(marker);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);

				marker.deleteData(0, marker.length);

				this.element.normalize();
				// update toolbar AFTER DOM/focus settles
				setTimeout(() => this.updateToolbarState(), 0);
				this.saveToHistory();
			}
			return;
		}

		// ==========================================
		// SCENARIO 2: Text Selected
		// ==========================================
		const selectionSnapshot = this.saveTextSelectionRange(range);
		const targetRanges = this.buildInlineFormatTargetRanges(range);
		if (!targetRanges.length) {
			return;
		}

		try {
			const shouldRemove = targetRanges.every(targetRange => this.isRangeFormatted(targetRange, tag));
			targetRanges
				.slice()
				.reverse()
				.forEach(targetRange => {
					this.toggleInlineFormatOnRange(targetRange, tag, shouldRemove);
				});

		} catch (err) {
			// Log error so we can investigate; do not abort cleanup
			console.error('toggleInlineFormat error', err);
		} finally {
			normalizeRichTextSurface(this.element);
			if (this.element.tagName === 'OL' || this.element.tagName === 'UL') {
				this.element.querySelectorAll('li').forEach(li => this.normalizeListItem(li));
			}
			this.restoreTextSelectionRange(selectionSnapshot);
			// Delay toolbar update so focus-from-button does not clobber selection detection
			setTimeout(() => {
				// ensure editor has focus (this is safe - createButton also focuses)
				try { this.element.focus(); } catch (e) {}
				this.updateToolbarState();
				this.saveToHistory();
			}, 0);
		}
	}

	/**
	 * Toggle one inline format on a single text-bounded range.
	 *
	 * @param {Range} targetRange Selection slice to mutate.
	 * @param {string} tag Uppercase inline tag name.
	 * @param {boolean} shouldRemove Whether this pass removes instead of applies.
	 * @returns {void}
	 */
	toggleInlineFormatOnRange(targetRange, tag, shouldRemove) {
		if (!targetRange) {
			return;
		}

		if (shouldRemove) {
			this.removeFormatFromRange(targetRange, tag);
			return;
		}

		this.applyFormatToRange(targetRange, tag);
	}

	/**
	 * Capture a non-collapsed selection as text offsets within the editor.
	 *
	 * Using text offsets instead of live DOM nodes allows the selection to be
	 * restored after formatting rewrites replace or split the original elements.
	 *
	 * @param {Range} range Current browser selection range.
	 * @return {?Object} Selection snapshot, or null when unavailable.
	 */
	saveTextSelectionRange(range) {
		if (!range || range.collapsed) {
			return null;
		}

		const startRange = range.cloneRange();
		startRange.selectNodeContents(this.element);
		startRange.setEnd(range.startContainer, range.startOffset);

		const endRange = range.cloneRange();
		endRange.selectNodeContents(this.element);
		endRange.setEnd(range.endContainer, range.endOffset);

		return {
			startOffset: startRange.toString().length,
			endOffset: endRange.toString().length
		};
	}

	/**
	 * Restore a saved non-collapsed selection from editor-relative text offsets.
	 *
	 * @param {?Object} selectionSnapshot Offsets captured by saveTextSelectionRange().
	 * @return {boolean} True when restoration succeeded, false otherwise.
	 */
	restoreTextSelectionRange(selectionSnapshot) {
		if (
			!selectionSnapshot ||
			typeof selectionSnapshot.startOffset !== 'number' ||
			typeof selectionSnapshot.endOffset !== 'number'
		) {
			return false;
		}

		const startBoundary = this.resolveTextOffsetBoundary(this.element, selectionSnapshot.startOffset, {
			preferNextAtBoundary: true
		});
		const endBoundary   = this.resolveTextOffsetBoundary(this.element, selectionSnapshot.endOffset, {
			preferNextAtBoundary: false
		});
		if (!startBoundary || !endBoundary) {
			return false;
		}

		const selection = window.getSelection();
		const range     = document.createRange();
		range.setStart(startBoundary.node, startBoundary.offset);
		range.setEnd(endBoundary.node, endBoundary.offset);
		selection.removeAllRanges();
		selection.addRange(range);

		return true;
	}

	/**
	 * Resolve a text offset within an element to a concrete DOM boundary point.
	 *
	 * @param {HTMLElement} element Root element containing the selection.
	 * @param {number} offset Text offset from the start of the element.
	 * @param {?Object} options Boundary resolution options.
	 * @param {boolean} [options.preferNextAtBoundary=false] When the offset lands
	 *        exactly between text nodes, resolve to the next node instead of the
	 *        end of the previous node. This keeps restored selections anchored to
	 *        the selected text instead of drifting onto wrapper boundaries.
	 * @return {?Object} Boundary descriptor containing node and offset.
	 */
	resolveTextOffsetBoundary(element, offset, options = {}) {
		if (!element || typeof offset !== 'number') {
			return null;
		}
		const preferNextAtBoundary = !!options.preferNextAtBoundary;

		const textNodes = [];
		const getTextNodes = (node) => {
			if (node.nodeType === 3) {
				textNodes.push(node);
				return;
			}

			Array.from(node.childNodes).forEach(getTextNodes);
		};

		getTextNodes(element);

		let charCount = 0;
		for (const node of textNodes) {
			const nodeLength = node.textContent.length;
			const nextCharCount = charCount + nodeLength;
			if (nextCharCount > offset) {
				return {
					node,
					offset: Math.min(offset - charCount, nodeLength)
				};
			}
			if (nextCharCount === offset) {
				if (preferNextAtBoundary) {
					charCount = nextCharCount;
					continue;
				}
				return {
					node,
					offset: nodeLength
				};
			}
			charCount = nextCharCount;
		}

		if (textNodes.length > 0) {
			const lastNode = textNodes[textNodes.length - 1];
			return {
				node: lastNode,
				offset: lastNode.textContent.length
			};
		}

		return {
			node: element,
			offset: 0
		};
	}

	isRangeFormatted(range, tag) {
		const textNodes = this.getMeaningfulTextNodesInRange(range);
		if (!textNodes.length) {
			return false;
		}

		return textNodes.every(node => !!this.getNearestFormatAncestor(node, tag));
	}

	applyFormatToRange(range, tag) {
		// Extract the contents
		const contents = range.extractContents();
		
		// Create wrapper
		const wrapper = document.createElement(tag.toLowerCase());
		wrapper.appendChild(contents);
		
		// Insert wrapper back
		range.insertNode(wrapper);
		
		// Clean up nested same tags (e.g., <strong><strong>text</strong></strong>)
		this.cleanupNestedTags(wrapper, tag);
	}

	removeFormatFromRange(range, tag) {
		const textNodes = this.getMeaningfulTextNodesInRange(range);
		if (!textNodes.length) {
			return;
		}

		const formatAncestors = textNodes
			.map(node => this.getNearestFormatAncestor(node, tag))
			.filter(Boolean);
		if (!formatAncestors.length) {
			return;
		}

		const uniqueFormatAncestors = Array.from(new Set(formatAncestors));
		if (uniqueFormatAncestors.length === 1) {
			const normalizedRange = this.createTextNodeBoundedRange(range, textNodes);
			if (
				normalizedRange &&
				this.rangeFullyCoversAncestorText(normalizedRange, uniqueFormatAncestors[0])
			) {
				this.unwrapFormatAncestorChildren(
					uniqueFormatAncestors[0],
					0,
					uniqueFormatAncestors[0].childNodes.length
				);
				return;
			}
			const expandedRange = normalizedRange
				? this.expandRangeWithinAncestor(normalizedRange, uniqueFormatAncestors[0])
				: null;
			if (expandedRange) {
				if (
					expandedRange.startContainer === uniqueFormatAncestors[0] &&
					expandedRange.endContainer === uniqueFormatAncestors[0]
				) {
					this.unwrapFormatAncestorChildren(
						uniqueFormatAncestors[0],
						expandedRange.startOffset,
						expandedRange.endOffset
					);
					return;
				}
				this.splitFormatTag(expandedRange, uniqueFormatAncestors[0]);
				return;
			}
		}

		const fragment = range.extractContents();
		const tempDiv  = document.createElement('div');
		tempDiv.appendChild(fragment);

		const elements = tempDiv.querySelectorAll(tag.toLowerCase());
		elements.forEach(el => {
			while (el.firstChild) {
				el.parentNode.insertBefore(el.firstChild, el);
			}
			el.remove();
		});

		range.insertNode(tempDiv);
		while (tempDiv.firstChild) {
			tempDiv.parentNode.insertBefore(tempDiv.firstChild, tempDiv);
		}
		tempDiv.remove();
	}

	/**
	 * Collect meaningful text nodes within one subtree.
	 *
	 * @param {HTMLElement} root Root element to inspect.
	 * @param {?Function} filter Optional additional node filter.
	 * @returns {Text[]} Visible text nodes within the subtree.
	 */
	getMeaningfulTextNodes(root, filter = null) {
		if (!root) {
			return [];
		}

		const textNodes = [];
		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: (node) => {
					const text = String(node?.textContent || '').replace(/\uFEFF/g, '');
					if (!text.length) {
						return NodeFilter.FILTER_REJECT;
					}

					if (typeof filter === 'function') {
						return filter(node)
							? NodeFilter.FILTER_ACCEPT
							: NodeFilter.FILTER_REJECT;
					}

					return NodeFilter.FILTER_ACCEPT;
				}
			}
		);

		let currentNode = walker.nextNode();
		while (currentNode) {
			textNodes.push(currentNode);
			currentNode = walker.nextNode();
		}

		return textNodes;
	}

	/**
	 * Collect meaningful text nodes touched by a range.
	 *
	 * @param {Range} range Selection range to inspect.
	 * @returns {Text[]} Visible text nodes intersecting the range.
	 */
	getMeaningfulTextNodesInRange(range) {
		if (!range || !this.element) {
			return [];
		}

		return this.getMeaningfulTextNodes(
			this.element,
			node => range.intersectsNode(node)
		);
	}

	/**
	 * Find the nearest ancestor matching an inline format tag.
	 *
	 * @param {Node} node Descendant node inside the formatted content.
	 * @param {string} tag Uppercase tag name to locate.
	 * @returns {?HTMLElement} Matching ancestor, otherwise null.
	 */
	getNearestFormatAncestor(node, tag) {
		let current = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
		while (current && current !== this.element) {
			if (current.nodeType === Node.ELEMENT_NODE && current.tagName === tag) {
				return current;
			}
			current = current.parentNode;
		}

		return null;
	}

	/**
	 * Build a range from the first and last selected text nodes.
	 *
	 * @param {Range} range Original browser range.
	 * @param {Text[]} textNodes Meaningful text nodes intersecting the range.
	 * @returns {?Range} Range bounded to text nodes, or null when unavailable.
	 */
	createTextNodeBoundedRange(range, textNodes) {
		if (!range || !Array.isArray(textNodes) || !textNodes.length) {
			return null;
		}

		const firstNode = textNodes[0];
		const lastNode  = textNodes[textNodes.length - 1];
		const boundedRange = document.createRange();

		const startOffset = range.startContainer === firstNode
			? range.startOffset
			: 0;
		const endOffset = range.endContainer === lastNode
			? range.endOffset
			: lastNode.textContent.length;

		boundedRange.setStart(firstNode, startOffset);
		boundedRange.setEnd(lastNode, endOffset);

		return boundedRange;
	}

	/**
	 * Check whether a range fully covers one format ancestor's text span.
	 *
	 * @param {Range} range Selection range bounded to meaningful text nodes.
	 * @param {HTMLElement} ancestor Format ancestor being considered.
	 * @returns {boolean} True when the range covers the ancestor's text span.
	 */
	rangeFullyCoversAncestorText(range, ancestor) {
		if (!range || !ancestor) {
			return false;
		}

		const ancestorTextNodes = this.getMeaningfulTextNodes(ancestor);
		if (!ancestorTextNodes.length) {
			return false;
		}

		const firstNode = ancestorTextNodes[0];
		const lastNode = ancestorTextNodes[ancestorTextNodes.length - 1];

		return (
			range.startContainer === firstNode &&
			range.startOffset === 0 &&
			range.endContainer === lastNode &&
			range.endOffset === lastNode.textContent.length
		);
	}

	/**
	 * Expand a range outward within one format ancestor.
	 *
	 * @param {Range} range Original selection range.
	 * @param {HTMLElement} ancestor Format ancestor being removed.
	 * @returns {?Range} Expanded range bounded within the provided ancestor.
	 */
	expandRangeWithinAncestor(range, ancestor) {
		if (!range || !ancestor) {
			return null;
		}

		const expandedRange = range.cloneRange();
		const startBoundary = this.expandRangeBoundaryWithinAncestor(expandedRange, ancestor, 'start');
		const endBoundary = this.expandRangeBoundaryWithinAncestor(expandedRange, ancestor, 'end');
		if (!startBoundary || !endBoundary) {
			return null;
		}

		expandedRange.setStart(startBoundary.node, startBoundary.offset);
		expandedRange.setEnd(endBoundary.node, endBoundary.offset);
		return expandedRange;
	}

	/**
	 * Expand one range edge toward the provided ancestor.
	 *
	 * @param {Range} range Range being expanded.
	 * @param {HTMLElement} ancestor Format ancestor being removed.
	 * @param {string} edge Boundary to expand: `start` or `end`.
	 * @returns {?Object} DOM boundary descriptor.
	 */
	expandRangeBoundaryWithinAncestor(range, ancestor, edge) {
		const isStart = edge === 'start';
		let node = isStart ? range.startContainer : range.endContainer;
		let offset = isStart ? range.startOffset : range.endOffset;

		while (node && node !== ancestor) {
			if (node.nodeType === Node.TEXT_NODE) {
				const expectedOffset = isStart ? 0 : node.textContent.length;
				if (offset !== expectedOffset) {
					break;
				}
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				const expectedOffset = isStart ? 0 : node.childNodes.length;
				if (offset !== expectedOffset) {
					break;
				}
			}

			const parent = node.parentNode;
			if (!parent) {
				break;
			}
			if (parent === ancestor) {
				const indexInAncestor = Array.prototype.indexOf.call(parent.childNodes, node);
				return {
					node: parent,
					offset: isStart ? indexInAncestor : indexInAncestor + 1
				};
			}

			const indexInParent = Array.prototype.indexOf.call(parent.childNodes, node);
			node = parent;
			offset = isStart ? indexInParent : indexInParent + 1;
		}

		return {
			node,
			offset
		};
	}

	/**
	 * Remove one matching format ancestor by moving its direct child nodes.
	 *
	 * @param {HTMLElement} ancestor Format element being removed.
	 * @param {number} startOffset Start child index within the ancestor.
	 * @param {number} endOffset End child index within the ancestor.
	 * @returns {void}
	 */
	unwrapFormatAncestorChildren(ancestor, startOffset, endOffset) {
		if (!ancestor || !ancestor.parentNode) {
			return;
		}

		const parent = ancestor.parentNode;
		const fragment = document.createDocumentFragment();
		const childNodes = Array.from(ancestor.childNodes);
		const safeStart = Math.max(0, Math.min(startOffset, childNodes.length));
		const safeEnd = Math.max(safeStart, Math.min(endOffset, childNodes.length));

		if (safeStart > 0) {
			const beforeWrapper = ancestor.cloneNode(false);
			childNodes.slice(0, safeStart).forEach(node => {
				beforeWrapper.appendChild(node);
			});
			fragment.appendChild(beforeWrapper);
		}

		childNodes.slice(safeStart, safeEnd).forEach(node => {
			fragment.appendChild(node);
		});

		if (safeEnd < childNodes.length) {
			const afterWrapper = ancestor.cloneNode(false);
			childNodes.slice(safeEnd).forEach(node => {
				afterWrapper.appendChild(node);
			});
			fragment.appendChild(afterWrapper);
		}

		parent.replaceChild(fragment, ancestor);
	}

	/**
	 * Resolve the working ranges for an inline formatting action.
	 *
	 * @param {Range} range Browser selection range.
	 * @returns {Range[]} Safe text-bounded ranges to format.
	 */
	buildInlineFormatTargetRanges(range) {
		const textNodes = this.getMeaningfulTextNodesInRange(range);
		if (!textNodes.length) {
			return [];
		}

		if (this.element.tagName !== 'OL' && this.element.tagName !== 'UL') {
			const normalizedRange = this.createTextNodeBoundedRange(range, textNodes);
			return normalizedRange ? [normalizedRange] : [];
		}

		const listItems = [];
		textNodes.forEach(node => {
			const listItem = node.parentElement?.closest('li');
			if (!listItem || !this.element.contains(listItem) || listItems.includes(listItem)) {
				return;
			}

			listItems.push(listItem);
		});

		return listItems
			.map(listItem => this.getListItemTextNodesInRange(listItem, range))
			.filter(group => Array.isArray(group) && group.length > 0)
			.map(group => this.createTextNodeBoundedRange(range, group))
			.filter(Boolean);
	}

	/**
	 * Collect text nodes for one list item's direct text span.
	 *
	 * @param {HTMLElement} listItem List item to inspect.
	 * @param {Range} range Original browser selection range.
	 * @returns {Text[]} Text nodes in the list item's own text span.
	 */
	getListItemTextNodesInRange(listItem, range) {
		if (!listItem || !range) {
			return [];
		}

		const directContentRange = document.createRange();
		directContentRange.selectNodeContents(listItem);

		const nestedList = listItem.querySelector(':scope > ul, :scope > ol');
		if (nestedList) {
			directContentRange.setEndBefore(nestedList);
		}

		return this.getMeaningfulTextNodes(
			listItem,
			node => {
				let parent = node.parentNode;
				while (parent && parent !== listItem) {
					if (parent.tagName === 'OL' || parent.tagName === 'UL') {
						return false;
					}
					parent = parent.parentNode;
				}

				return (
					directContentRange.intersectsNode(node) &&
					range.intersectsNode(node)
				);
			}
		);
	}

	splitFormatTag(range, formatTag) {
		// This splits a format tag around the selection, removing format from selection only
		const parent = formatTag.parentNode;
		
		// Get everything before the range
		const beforeRange = document.createRange();
		beforeRange.setStart(formatTag, 0);
		beforeRange.setEnd(range.startContainer, range.startOffset);
		const beforeContents = beforeRange.cloneContents();
		
		// Get everything after the range
		const afterRange = document.createRange();
		afterRange.setStart(range.endContainer, range.endOffset);
		afterRange.setEnd(formatTag, formatTag.childNodes.length);
		const afterContents = afterRange.cloneContents();
		
		// Get the selected content (unformatted)
		const selectedContents = range.cloneContents();
		
		// Build the new structure
		const fragment = document.createDocumentFragment();
		
		// Add before part (still formatted) if not empty
		if (beforeContents.textContent.trim().length > 0) {
			const beforeWrapper = document.createElement(formatTag.tagName.toLowerCase());
			beforeWrapper.appendChild(beforeContents);
			fragment.appendChild(beforeWrapper);
		}
		
		// Add selected part (unformatted)
		fragment.appendChild(selectedContents);
		
		// Add after part (still formatted) if not empty
		if (afterContents.textContent.trim().length > 0) {
			const afterWrapper = document.createElement(formatTag.tagName.toLowerCase());
			afterWrapper.appendChild(afterContents);
			fragment.appendChild(afterWrapper);
		}
		
		// Replace the original format tag
		parent.replaceChild(fragment, formatTag);
	}

	cleanupNestedTags(element, tag) {
		// Remove nested same tags like <strong><strong>text</strong></strong>
		const nested = element.querySelectorAll(tag.toLowerCase());
		nested.forEach(el => {
			// If parent is same tag, unwrap this one
			if (el.parentNode.tagName === tag) {
				while (el.firstChild) {
					el.parentNode.insertBefore(el.firstChild, el);
				}
				el.remove();
			}
		});
		
		// Also check the element itself
		if (element.parentNode && element.parentNode.tagName === tag) {
			while (element.firstChild) {
				element.parentNode.insertBefore(element.firstChild, element);
			}
			element.remove();
		}
	}

	getListItemPath(listItem) {
		if (
			!listItem ||
			listItem.nodeType !== Node.ELEMENT_NODE ||
			listItem.tagName !== 'LI' ||
			!this.element ||
			!this.element.contains(listItem)
		) {
			return '';
		}

		const indexes = [];
		let currentItem = listItem;
		while (currentItem && this.element.contains(currentItem)) {
			const parentList = currentItem.parentElement;
			if (!parentList || (parentList.tagName !== 'UL' && parentList.tagName !== 'OL')) {
				return '';
			}

			const siblingItems = Array.from(parentList.children || []).filter(child => child?.tagName === 'LI');
			const itemIndex = siblingItems.indexOf(currentItem);
			if (itemIndex < 0) {
				return '';
			}

			indexes.unshift(itemIndex);
			const ownerItem = parentList.parentElement?.tagName === 'LI'
				? parentList.parentElement
				: null;
			if (!ownerItem || !this.element.contains(ownerItem)) {
				break;
			}
			currentItem = ownerItem;
		}

		return indexes.join('_');
	}

	findListItemByPath(pathValue) {
		const normalizedPath = String(pathValue || '').trim();
		if (!normalizedPath || !this.element || (this.element.tagName !== 'UL' && this.element.tagName !== 'OL')) {
			return null;
		}

		const indexes = normalizedPath
			.split('_')
			.map(segment => Number.parseInt(segment, 10))
			.filter(index => Number.isInteger(index) && index >= 0);
		if (!indexes.length) {
			return null;
		}

		let currentList = this.element;
		let currentItem = null;
		for (let i = 0; i < indexes.length; i++) {
			const siblingItems = Array.from(currentList.children || []).filter(child => child?.tagName === 'LI');
			currentItem = siblingItems[indexes[i]] || null;
			if (!currentItem) {
				return null;
			}

			if (i === indexes.length - 1) {
				return currentItem;
			}

			currentList = Array.from(currentItem.children || []).find(child => child?.tagName === 'UL' || child?.tagName === 'OL') || null;
			if (!currentList) {
				return null;
			}
		}

		return currentItem;
	}

	saveCursorPosition() {
		const selection = window.getSelection();
		if (!selection.rangeCount) return null;
		
		const range = selection.getRangeAt(0);
		
		// For list items, save the specific LI and offset within it
		const currentLi = this.getCurrentListItem();
		if (currentLi) {
			const preSelectionStartRange = range.cloneRange();
			preSelectionStartRange.selectNodeContents(currentLi);
			preSelectionStartRange.setEnd(range.startContainer, range.startOffset);

			const preCaretRange = range.cloneRange();
			preCaretRange.selectNodeContents(currentLi);
			preCaretRange.setEnd(range.endContainer, range.endOffset);
			
			return {
				type:            'list-item',
				listItem:        currentLi,
				listItemRuntimeUuid: getListItemRuntimeUuid(currentLi),
				listItemUuid:    String(currentLi.getAttribute(getListItemIdAttributeName()) || '').trim(),
				listItemPath:    this.getListItemPath(currentLi),
				startOffset:     preSelectionStartRange.toString().length,
				offset:          preCaretRange.toString().length,
				endOffset:       preCaretRange.toString().length,
				container:       range.endContainer,
				containerOffset: range.endOffset
			};
		}
		
		// General case - save offset from start of element
		const preSelectionStartRange = range.cloneRange();
		preSelectionStartRange.selectNodeContents(this.element);
		preSelectionStartRange.setEnd(range.startContainer, range.startOffset);

		const preCaretRange = range.cloneRange();
		preCaretRange.selectNodeContents(this.element);
		preCaretRange.setEnd(range.endContainer, range.endOffset);
		
		return {
			type:            'general',
			startOffset:     preSelectionStartRange.toString().length,
			offset:          preCaretRange.toString().length,
			endOffset:       preCaretRange.toString().length,
			container:       range.endContainer,
			containerOffset: range.endOffset
		};
	}

	restoreCursorPosition(savedPosition) {
		if (!savedPosition) return;
		
		const selection = window.getSelection();
		
		if (savedPosition.type === 'list-item') {
			// Restore within specific list item
			let li = (
				savedPosition.listItem &&
				savedPosition.listItem.nodeType === Node.ELEMENT_NODE &&
				savedPosition.listItem.tagName === 'LI'
			)
				? savedPosition.listItem
				: null;
			
			// Check if the LI still belongs to this live editor root.
			if (!li || !this.element || !this.element.contains(li)) {
				const runtimeAttrName = getListItemRuntimeUuidAttributeName();
				const savedRuntimeUuid = String(savedPosition.listItemRuntimeUuid || '').trim();
				if (savedRuntimeUuid) {
					try {
						li = this.element.querySelector(
							`[${runtimeAttrName}="${CSS.escape(savedRuntimeUuid)}"]`
						);
					} catch (error) {
						li = this.element.querySelector(
							`[${runtimeAttrName}="${savedRuntimeUuid.replace(/"/g, '\\"')}"]`
						);
					}
				}

				const savedUuid = String(savedPosition.listItemUuid || '').trim();
				if (!li && savedUuid) {
					li = this.element.querySelector(
						`[${getListItemIdAttributeName()}="${savedUuid.replace(/"/g, '\\"')}"]`
					);
				}
				if (!li) {
					li = this.findListItemByPath(savedPosition.listItemPath);
				}
				if (!li) {
					const allLis = this.element.querySelectorAll('li');
					if (allLis.length > 0) {
						this.setCursorInElement(allLis[0], savedPosition.offset);
					}
					return;
				}
			}
			
			this.setCursorInElement(
				li,
				Number.isFinite(savedPosition.startOffset) ? savedPosition.startOffset : savedPosition.offset,
				Number.isFinite(savedPosition.endOffset) ? savedPosition.endOffset : savedPosition.offset
			);
		} else {
			// General restoration
			this.setCursorInElement(
				this.element,
				Number.isFinite(savedPosition.startOffset) ? savedPosition.startOffset : savedPosition.offset,
				Number.isFinite(savedPosition.endOffset) ? savedPosition.endOffset : savedPosition.offset
			);
		}
	}

	setCursorInElement(element, startOffset, endOffset = startOffset) {
		const selection = window.getSelection();
		const textNodes = [];
		let targetElement = (
			element &&
			element.nodeType === Node.ELEMENT_NODE &&
			element.tagName === 'LI'
		)
			? (getListItemContentHost(element) || element)
			: element;

		if (
			!targetElement ||
			!targetElement.isConnected ||
			(this.element && targetElement !== this.element && !this.element.contains(targetElement))
		) {
			targetElement = this.element;
		}

		if (!targetElement || !targetElement.isConnected) {
			return;
		}
		
		const getTextNodes = (node) => {
			// Skip nested lists when getting text nodes
			if (node.nodeType === 1 && (node.tagName === 'OL' || node.tagName === 'UL') && node !== targetElement) {
				return;
			}
			
			if (node.nodeType === 3) {
				textNodes.push(node);
			} else {
				Array.from(node.childNodes).forEach(getTextNodes);
			}
		};
		
		getTextNodes(targetElement);

		const resolveTextPosition = (offset) => {
			let charCount = 0;
			for (let index = 0; index < textNodes.length; index++) {
				const node = textNodes[index];
				const nodeLength = node.textContent.length;
				const nextCharCount = charCount + nodeLength;
				if (nextCharCount > offset) {
					return {
						node,
						offset: Math.min(offset - charCount, node.textContent.length)
					};
				}
				if (nextCharCount === offset) {
					const nextNode = textNodes[index + 1] || null;
					if (
						nextNode &&
						isLinebreakPlaceholderNode(nextNode) &&
						targetElement === this.element &&
						this.isLinebreakMode()
					) {
						return {
							node: nextNode,
							offset: nextNode.textContent.length
						};
					}

					return {
						node,
						offset: nodeLength
					};
				}
				charCount = nextCharCount;
			}

			if (textNodes.length > 0) {
				const lastNode = textNodes[textNodes.length - 1];
				return {
					node: lastNode,
					offset: lastNode.textContent.length
				};
			}

			return null;
		};

		const startPosition = resolveTextPosition(startOffset);
		const endPosition = resolveTextPosition(endOffset);

		if (startPosition && endPosition) {
			const range = document.createRange();
			range.setStart(startPosition.node, startPosition.offset);
			range.setEnd(endPosition.node, endPosition.offset);
			try {
				selection.removeAllRanges();
				selection.addRange(range);
			} catch (error) {
				const fallbackRange = document.createRange();
				fallbackRange.selectNodeContents(targetElement);
				fallbackRange.collapse(true);
				selection.removeAllRanges();
				selection.addRange(fallbackRange);
			}
			return;
		}
		
		// Fallback: place at end of last text node
		if (textNodes.length > 0) {
			const lastNode = textNodes[textNodes.length - 1];
			const range    = document.createRange();
			range.setStart(lastNode, lastNode.textContent.length);
			range.collapse(true);
			try {
				selection.removeAllRanges();
				selection.addRange(range);
			} catch (error) {
				const fallbackRange = document.createRange();
				fallbackRange.selectNodeContents(targetElement);
				fallbackRange.collapse(false);
				selection.removeAllRanges();
				selection.addRange(fallbackRange);
			}
		} else {
			// No text nodes remain, so place the caret inside the direct content
			// host using one temporary `<br>` anchor when needed.
			let br = targetElement.querySelector(':scope > br');
			if (!br) {
				br = document.createElement('br');
				targetElement.insertBefore(br, targetElement.firstChild);
			}
			const range = document.createRange();
			range.setStart(targetElement, 0);
			range.collapse(true);
			try {
				selection.removeAllRanges();
				selection.addRange(range);
			} catch (error) {
				return;
			}
		}
	}
	
	getSelectedRange() {
		const sel = window.getSelection();
		if (sel.rangeCount > 0) {
			return sel.getRangeAt(0);
		}
		return null;
	}
	
	getParentElement(tagName) {
		const sel = window.getSelection();
		if (!sel.rangeCount) return null;
		
		let node = sel.getRangeAt(0).commonAncestorContainer;
		while (node && node !== this.element) {
			if (node.nodeType === 1 && node.tagName === tagName.toUpperCase()) {
				return node;
			}
			node = node.parentNode;
		}
		return null;
	}
	
	getParentList() {
		// First check if the element itself is a list
		if (this.element.tagName === 'OL' || this.element.tagName === 'UL') {
			return this.element;
		}
		
		const sel = window.getSelection();
		if (!sel.rangeCount) return null;
		
		let node = sel.getRangeAt(0).commonAncestorContainer;
		while (node && node !== this.element) {
			if (node.nodeType === 1 && (node.tagName === 'OL' || node.tagName === 'UL')) {
				return node;
			}
			node = node.parentNode;
		}
		return null;
	}

	normalizeListItem(li) {
		// Remove hidden newline/carriage-return characters from all text nodes in
		// list items (WP block serialization leaves trailing \n that creates an
		// invisible "line" in contenteditable, breaking cursor placement and Enter).
		const walker = document.createTreeWalker(
			li,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: function(node) {
					// Skip nested lists
					let parent = node.parentNode;
					while (parent && parent !== li) {
						if (parent.tagName === 'OL' || parent.tagName === 'UL') {
							return NodeFilter.FILTER_SKIP;
						}
						parent = parent.parentNode;
					}
					return NodeFilter.FILTER_ACCEPT;
				}
			}
		);

		const textNodes = [];
		let node;
		while (node = walker.nextNode()) {
			textNodes.push(node);
		}

		textNodes.forEach((textNode) => {
			let content = textNode.textContent;
			// Strip all \r\n - they're invisible in the rendered list but exist in
			// the DOM text node and cause cursor and Enter key misbehavior.
			content = content.replace(/[\r\n]/g, '');
			// Keep intentional trailing spaces. Trimming the last text node here
			// breaks normal list typing by deleting a caret-adjacent space after
			// native input, which then throws off the follow-up cursor repair.
			if (content === '') {
				textNode.remove();
				return;
			}
			if (content !== textNode.textContent) {
				textNode.textContent = content;
			}
		});

		const contentHost = getListItemContentHost(li);
		if (contentHost && listItemHasMeaningfulContent(li)) {
			Array.from(contentHost.childNodes || []).forEach(node => {
				if (node && node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
					node.remove();
				}
			});
		}

		Array.from(li.children || []).forEach(child => {
			if (
				child &&
				(child.tagName === 'OL' || child.tagName === 'UL') &&
				child.children.length === 0
			) {
				child.remove();
			}
		});
	}
	
	getCurrentListItem() {
		const sel = window.getSelection();
		if (!sel.rangeCount) return null;
		
		let node = sel.getRangeAt(0).commonAncestorContainer;
		while (node && node !== this.element) {
			if (node.nodeType === 1 && node.tagName === 'LI') {
				return node;
			}
			node = node.parentNode;
		}
		return null;
	}

	insertListManual(tag) {
		// Validate selection is within this editor
		if (!this.isSelectionInEditor()) {
			return; // Selection is outside this editor, do nothing
		}

		const range = this.getSelectedRange();
		if (!range) return;

		// Create the new list structure
		const list = document.createElement(tag);
		list.classList.add('wp-block-list');
		const li = document.createElement('li');

		if (range.collapsed) {
			// Just insert an empty list item at the cursor
			li.innerHTML = '<br>';
			list.appendChild(li);
			range.insertNode(list);
		} else {
			// Move selected content into the first list item
			li.appendChild(range.extractContents());
			list.appendChild(li);
			range.insertNode(list);
		}

		this.saveToHistory();
		
		// Focus the new list item
		setTimeout(() => {
			this.setCursorInElement(li, 0);
			li.focus();
		}, 0);
	}
}

function executeListTypeOperation(editor, listType) {
	const createTag = listType === 'ordered' ? 'ol' : 'ul';
	const oppositeTag = listType === 'ordered' ? 'UL' : 'OL';

	// Close link UI if active - structural change
	if (editor._linkUIActive) {
		editor.closeLinkUI();
	}

	// Check if selection spans multiple list items
	const selection = window.getSelection();

	if (selection.rangeCount > 0) {
		const range = selection.getRangeAt(0);

		// Find the closest LI to the start and end of selection
		let startLi = range.startContainer;
		while (startLi && startLi !== editor.element && startLi.tagName !== 'LI') {
			startLi = startLi.parentNode;
		}

		let endLi = range.endContainer;
		while (endLi && endLi !== editor.element && endLi.tagName !== 'LI') {
			endLi = endLi.parentNode;
		}

		// If start and end are in different LIs, block the action
		if (startLi && endLi && startLi !== endLi) {
			return;
		}
	}

	const operationExecutor = SFE.SchemaOperationExecutor || null;

	if (
		(editor.element.tagName === 'UL' || editor.element.tagName === 'OL') &&
		operationExecutor &&
		typeof operationExecutor.executeCurrentListTypeChange === 'function'
	) {
		operationExecutor.executeCurrentListTypeChange({
			editorHost: editor,
			value: listType,
		});

		return;
	}

	const li = editor.getCurrentListItem();

	if (!li) {
		// Not in a list, create one
		editor.insertListManual(createTag);

		setTimeout(() => {
			const list = editor.getParentList();

			if (list) {
				list.classList.add('wp-block-list');
			}
		}, 10);

		return;
	}

	// Non-list editors still use the legacy create-list flow.
	const currentList = li.parentNode;

	if (currentList && currentList.tagName === oppositeTag) {
		editor.changeListType(currentList, createTag);
	}
}

function executeListIndentOperation(editor, kind) {
	const li = editor.getCurrentListItem();

	if (!li) {
		return;
	}

	editor.executeListStructureOperation({
		kind,
	});
}

function executeIndentOperation(editor) {
	executeListIndentOperation(editor, 'indent_list_item');
}

function executeOutdentOperation(editor) {
	executeListIndentOperation(editor, 'outdent_list_item');
}

function executeSchemaBlockAttributeOperation(editor, operationId, value) {
	const operationExecutor = SFE.SchemaOperationExecutor || null;

	if (!operationExecutor || typeof operationExecutor.executeBlockAttributeOperation !== 'function') {
		return;
	}

	operationExecutor.executeBlockAttributeOperation({
		editorHost: editor,
		operationId,
		value,
		saveHistory: true,
	});
}

function executeBlockAlignOperation(editor, value) {
	executeSchemaBlockAttributeOperation(editor, 'set_align', value);
}

function executeTextAlignmentOperation(editor, value) {
	executeSchemaBlockAttributeOperation(editor, 'set_text_align', value);
}

function executeHeadingLevelOperation(editor, value) {
	executeSchemaBlockAttributeOperation(editor, 'set_heading_level', value);
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { MWPEditor };
}

SFE.SchemaEditorHost.applyHostContractToPrototype(MWPEditor.prototype);

// Make globally available
SFE.MWPEditor  = MWPEditor;
SFE.RichTextPlaceholder = RichTextPlaceholder;

})();
