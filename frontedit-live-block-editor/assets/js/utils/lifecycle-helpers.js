/**
 * Shared lifecycle helpers used across all editor modes.
 *
 * Reads (via globals):
 *   SFE.FocusManager      - .createFocusManager
 *   SFE.PositionManager   - .positionFloatingElements
 *   SFE.closeDraftPreview - set by frontend-inline-edit.js (via DraftManager)
 *
 * Exposes: SFE.LifecycleHelpers
 *   { setupDraftPreviewLifecycle }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Attach escape handling and scroll/resize positioning to a bar/element pair
	 * showing a draft preview.
	 *
	 * Writes onto bar:
	 *   bar._escapeCleanup  – tears down the escape handler
	 *   bar._updatePosition – repositions the bar
	 *   bar._cleanupDraft   – single call that tears down all of the above,
	 *                         plus bar._resizeObserver if the caller set it
	 *
	 * If bar._cleanupDraft already exists it is called first so stale listeners
	 * are removed before new ones are added.
	 */
	function setupDraftPreviewLifecycle(bar, element, handlers, uuid) {
		const { createFocusManager }      = SFE.FocusManager;
		const { positionFloatingElements,
			debouncedPosition }           = SFE.PositionManager;

		// Tear down any previous draft lifecycle before installing the new one
		if (bar._cleanupDraft) {
			bar._cleanupDraft();
			delete bar._cleanupDraft;
		}

		bar._escapeCleanup = createFocusManager([], {
			escapeHandler: (e) => {
				if (e.key === 'Escape') SFE.closeDraftPreview(bar, element, uuid);
			}
		});

		bar._updatePosition = () => debouncedPosition(element, null, bar);
		window.addEventListener('scroll', bar._updatePosition, true);

		bar._cleanupDraft = () => {
			if (bar._escapeCleanup) { bar._escapeCleanup(); delete bar._escapeCleanup; }
			if (bar._updatePosition) {
				window.removeEventListener('scroll', bar._updatePosition, true);
				delete bar._updatePosition;
			}
			if (bar._resizeObserver) {
				bar._resizeObserver.disconnect();
				delete bar._resizeObserver;
			}
		};
	}

	SFE.LifecycleHelpers = { setupDraftPreviewLifecycle };

})();