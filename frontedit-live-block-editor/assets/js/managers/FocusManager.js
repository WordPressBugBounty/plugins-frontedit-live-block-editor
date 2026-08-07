/**
 * Focus management utilities
 *
 * Reads (from existing globals):
 *   SFE.OverlayManager - for fade/unfade in setupFocusManagement
 *
 * Exposes: SFE.FocusManager  { createFocusManager, setupFocusManagement }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Creates a focus management system with optional custom handlers
	 */
	function createFocusManager(uiElements, options = {}) {
		let cleanedUp             = false;
		let focusTimeout          = null;
		let lastInteractionTarget = null;
		const listeners           = [];
		
		const {
			onFocusChange = null,    // Optional: callback(isInsideUI)
			escapeHandler = null,    // Optional: custom escape handler
			delay = 50               // Optional: debounce delay
		} = options;
		
		// Only attach focus listeners if onFocusChange is provided
		if (onFocusChange) {
			const handleFocusChange = () => {
				if (focusTimeout) clearTimeout(focusTimeout);
				
				focusTimeout = setTimeout(() => {
					if (cleanedUp) return;
					
					const active = document.activeElement;
					
					// Check if focus is inside UI elements
					const focusInsideUI = uiElements.some(el => 
						el && document.body.contains(el) && (el === active || el.contains(active))
					);
					
					// Check if last interaction (mousedown) was inside UI elements
					const interactionInsideUI = lastInteractionTarget && uiElements.some(el =>
						el && document.body.contains(el) && (el === lastInteractionTarget || el.contains(lastInteractionTarget))
					);
					
					// Treat toolbar, action bar, and editor as one congruent UI
					const isInsideUI = focusInsideUI || interactionInsideUI;
					
					onFocusChange(isInsideUI);
				}, delay);
			};
			
			// Track mousedown targets to detect interactions with toolbar/action bar
			const handleMouseDown = (e) => {
				lastInteractionTarget = e.target;
				handleFocusChange();
			};

			// Attach focus listeners
			document.addEventListener('focusin', handleFocusChange, true);
			document.addEventListener('focusout', handleFocusChange, true);
			document.addEventListener('mousedown', handleMouseDown, true);
			listeners.push(
				{ type: 'focusin', handler: handleFocusChange },
				{ type: 'focusout', handler: handleFocusChange },
				{ type: 'mousedown', handler: handleMouseDown }
			);
		}
		
		// Attach escape handler if provided
		if (escapeHandler) {
			document.addEventListener('keydown', escapeHandler);
			listeners.push({ type: 'keydown', handler: escapeHandler });
		}

		// Return cleanup function
		return () => {
			cleanedUp = true;
			if (focusTimeout) clearTimeout(focusTimeout);
			
			// Remove all attached listeners
			listeners.forEach(({ type, handler }) => {
				if (type === 'focusin' || type === 'focusout' || type === 'mousedown') {
					document.removeEventListener(type, handler, true);
				} else {
					document.removeEventListener(type, handler);
				}
			});
		};
	}

	/**
	 * Focus management during editing.
	 *
	 * Fading-on-blur has been removed: clicking outside the editor does nothing.
	 * The mode toggle bar is the only mechanism to leave the editing context.
	 * Escape key handling is wired up independently by each editor type.
	 */
	function setupFocusManagement(editorState) {
		// No-op: return an empty cleanup function so existing call sites continue
		// to work without modification.
		return () => {};
	}

	SFE.FocusManager = { createFocusManager, setupFocusManagement };

})();