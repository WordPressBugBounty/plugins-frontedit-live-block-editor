/**
 * ElementUpdater - shared utility for in-place DOM updates after saves
 *
 * Handles the common "replace element with server-rendered HTML" operation
 * used by both single-save and batch-save flows, keeping DOM-swap logic in
 * one place instead of duplicated across SaveManager and BatchEditManager.
 *
 * Reads (via globals):
 *   SFE.Context                  - .uuidMap
 *   SFE.rebindChildren           - set by EditorLifecycle.js
 *   SFE.attachActionBarToElement - set by frontend-inline-edit.js (via HoverManager)
 *
 * Exposes: SFE.ElementUpdater  { applyNewHTML, rebindElement }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Replace a DOM element with server-rendered HTML, preserving UUID data
	 * attributes and clearing any pending-draft state in the uuid map.
	 *
	 * Does NOT add any CSS classes to the new element - callers are responsible
	 * for any class adjustments needed for their specific flow
	 * (e.g. mwp-sfe-element-active during a success animation).
	 *
	 * @param   {Element}      element  The current DOM element to be replaced.
	 * @param   {string}       uuid     Block UUID used for data attributes and uuidMap lookup.
	 * @param   {string}       newHTML  Server-rendered outer HTML string for the block.
	 * @returns {Element|null}          The newly inserted element, or null on failure.
	 */
	function applyNewHTML(element, uuid, newHTML) {
		const uuidMap = (SFE.Context || {}).uuidMap || {};

		const temp       = document.createElement('div');
		temp.innerHTML   = newHTML;
		const newElement = temp.firstElementChild;

		if (!newElement || !element.parentNode) return null;

		// Preserve plugin binding attributes on the incoming element.
		newElement.dataset.mwpSfeUuid  = uuid;
		newElement.dataset.mwpSfeBound = '1';

		// Clear pending-draft status since we just published/replaced.
		if (uuidMap[uuid]) {
			uuidMap[uuid].is_pending = false;
			delete uuidMap[uuid].pending_info;
			uuidMap[uuid].publishedBaselineOuterHTML = newElement.outerHTML;
		}

		element.parentNode.replaceChild(newElement, element);

		// Silently sync any new wp-elements-* CSS rules introduced by the
		// server-rendered replacement (fire-and-forget - never blocks the caller).
		if (
			SFE.SaveHelpers &&
			typeof SFE.SaveHelpers.syncWpElementStyles === 'function'
		) {
			SFE.SaveHelpers.syncWpElementStyles(newElement);
		}

		return newElement;
	}

	/**
	 * Re-attach the action bar and rebind inner child blocks to an element.
	 *
	 * Deferred to the next animation frame so it runs after any pending
	 * enableAllElements / CSS transitions have settled.
	 *
	 * @param {Element} element  The element to rebind (typically the one returned by applyNewHTML).
	 */
	function rebindElement(element) {
		requestAnimationFrame(() => {
			try {
				SFE.rebindChildren(element);
				SFE.attachActionBarToElement(element);
			} catch (err) {
				console.error('FrontEdit: failed to rebind element after save', err);
			}
		});
	}

	SFE.ElementUpdater = { applyNewHTML, rebindElement };

})();
