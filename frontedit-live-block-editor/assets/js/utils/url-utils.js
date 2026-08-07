/**
 * URL utilities - scroll-to-UUID and edit-draft-from-URL
 *
 * Reads:   SFE.TIMING (set early in frontend-inline-edit.js)
 * Exposes: SFE.UrlUtils  { scrollToUUID, handleEditDraftFromURL }
 *
 * This module self-registers its own DOMContentLoaded and hashchange listeners,
 * so those can be removed from frontend-inline-edit.js entirely.
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Custom scroll function to smoothly scroll to a specific UUID
	 */
	function scrollToUUID() {
		if (!location.hash) return;

		const uuid = decodeURIComponent(location.hash.slice(1));
		const el   = document.querySelector(
			`[data-mwp-sfe-uuid="${CSS.escape(uuid)}"]`
		);
		if (!el) return;

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const rect = el.getBoundingClientRect();
				const top  =
					window.pageYOffset +
					rect.top -
					window.innerHeight / 2 +
					rect.height / 2;

				window.scrollTo({
					top,
					behavior: 'smooth'
				});

				el.focus({ preventScroll: true });
			});
		});
	}

	/**
	 * Auto-trigger draft edit mode if URL contains action=edit-draft
	 */
	function handleEditDraftFromURL() {
		const TIMING    = SFE.TIMING;
		const urlParams = new URLSearchParams(window.location.search);
		const action    = urlParams.get('action');
		
		if (action === 'edit-draft' && location.hash) {
			const uuid = decodeURIComponent(location.hash.slice(1));
			if (!uuid) return;
			
			const element = document.querySelector(`[data-mwp-sfe-uuid="${CSS.escape(uuid)}"]`);
			if (!element) return;
			
			// Mark element for auto-edit after preview loads
			element.dataset.autoEditDraft = 'true';
			
			// Wait for page to settle, then trigger preview
			setTimeout(() => {
				// CSS [data-mwp-sfe-uuid] handles scroll
				element.scrollIntoView({ behavior: 'smooth', block: 'start' });
				
				// Trigger click to start preview
				setTimeout(() => {
					element.click();
				}, TIMING.TRIGGER_DELAY);
			}, 100);
		}
	}

	// Initial load
	document.addEventListener('DOMContentLoaded', () => {
		scrollToUUID();
		handleEditDraftFromURL();
	});

	// Hash changes (clicks, back/forward)
	window.addEventListener('hashchange', scrollToUUID);

	SFE.UrlUtils = { scrollToUUID, handleEditDraftFromURL };

})();