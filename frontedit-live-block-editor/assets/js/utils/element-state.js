/**
 * Element state management - active/inactive marking, disabled-elements tracking,
 * and managed event listener helpers
 *
 * Reads (from existing globals):
 *   SFE.OverlayManager           - for overlay calls in markActive/markInactive
 *   SFE.Context.disabledElements - the shared Set of currently-disabled elements
 *
 * Exposes: SFE.ElementState  { ElementState, attachEventListener, removeEventListener }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Element state management helpers
	 */
	const ElementState = {
		markActive(element, mode) {
			const overlayManager   = SFE.OverlayManager;
			const disabledElements = SFE.Context.disabledElements;
			const batchManager     = SFE.BatchEditManager || null;

			// Lock the body for ALL active modes - not just when an activeEditor is set.
			// This prevents page links and other non-plugin content from being clickable
			// during comment mode and draft preview, where activeEditor is never set.
			document.body.classList.add('mwp-sfe-is-editing');
			if (mode === 'commenting') {
				document.body.classList.add('mwp-sfe-mode-commenting');
			} else if (mode === 'draft') {
				document.body.classList.add('mwp-sfe-mode-draft');
			}

			element.classList.add('mwp-sfe-element-active', `mwp-sfe-${mode}-active`);
			
			// Hide hover overlay first
			if (overlayManager) {
				overlayManager.hideHover();
			}
			
			// Show active overlay
			if (overlayManager) {
				// Map internal mode name to overlay data-mode:
				// 'draft' → 'draft-preview' (orange shadow)
				// 'commenting' → 'commenting' (blue shadow, same for all comment modes)
				const overlayMode = mode === 'draft' ? 'draft-preview' : mode;
				overlayManager.showActive(element, overlayMode);
			}

			// Keep other elements interactive when a batch session is active *or*
			// when batch editing is enabled and the session is still being initialized
			// (isEnabled() returns true but isSessionActive() is still false because
			// the /get-page-block-tree fetch is running asynchronously in the background).
			// Without this, the very first edit on a fresh page load disables all
			// other elements before the session resolves, so hover overlays never
			// appear until the editor is closed and re-opened.
			const keepOtherElementsInteractive = (
				(mode === 'editing' || mode === 'draft-editing') &&
				batchManager &&
				(
					(typeof batchManager.isSessionActive === 'function' && batchManager.isSessionActive()) ||
					(typeof batchManager.isEnabled === 'function' && batchManager.isEnabled())
				)
			);
			if (keepOtherElementsInteractive) {
				return;
			}
			
			// Disable other elements and track them
			document.querySelectorAll('[data-mwp-sfe-bound="1"]').forEach(el => {
				if (el !== element) {
					el.setAttribute('data-mwp-sfe-bound', '0');
					el.classList.add('mwp-sfe-editing-disabled');
					disabledElements.add(el);  // ← Track it
				}
			});
		},
		
		markInactive(element) {
			const overlayManager = SFE.OverlayManager;

			element.classList.remove(
				'mwp-sfe-element-active', 
				'mwp-sfe-editing-active',
				'mwp-sfe-commenting-active',
				'mwp-sfe-draft-active',
				'mwp-sfe-editor-content'
			);
			element.removeAttribute('contenteditable');
			element.removeAttribute('spellcheck');

			// Always remove mode-specific body classes.
			// Only remove the general body lock if no activeEditor is still open
			// (regular edit mode clears it via the activeEditor setter instead).
			document.body.classList.remove('mwp-sfe-mode-commenting', 'mwp-sfe-mode-draft');
			if (!SFE.Context.activeEditor) {
				document.body.classList.remove('mwp-sfe-is-editing');
			}
			
			// Hide active overlay
			if (overlayManager) {
				overlayManager.hideActive();
			}
		},
		
		enableAllElements() {
			const disabledElements = SFE.Context.disabledElements;

			// Use the Set instead of querying DOM
			disabledElements.forEach(el => {
				el.setAttribute('data-mwp-sfe-bound', '1');
				el.classList.remove('mwp-sfe-editing-disabled');
			});
			disabledElements.clear();  // ← Clear the Set
		}
	};

	/**
	 * Safely attach event listener with automatic cleanup
	 */
	function attachEventListener(element, event, handler, key, options = false) {
		// Remove old handler if exists
		const handlerKey = `_${key}Handler`;
		if (element[handlerKey]) {
			element.removeEventListener(event, element[handlerKey], options);
		}
		
		// Store and attach new handler
		element[handlerKey] = handler;
		element.addEventListener(event, handler, options);
	}

	/**
	 * Remove a managed event listener
	 */
	function removeEventListener(element, event, key, options = false) {
		const handlerKey = `_${key}Handler`;
		if (element[handlerKey]) {
			element.removeEventListener(event, element[handlerKey], options);
			delete element[handlerKey];
		}
	}

	SFE.ElementState = { ElementState, attachEventListener, removeEventListener };

})();
