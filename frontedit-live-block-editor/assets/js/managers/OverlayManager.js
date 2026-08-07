/**
 * Overlay manager for status, hover, and active element visuals.
 *
 * Exposes: SFE.OverlayManager (singleton)
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	class OverlayManager {
		constructor() {
			// Container for all overlays
			this.container = null;
			
			// Status overlays (persistent, one per element)
			this.statusOverlays = new Map(); // element -> overlay div
			
			// Hover overlay (single, reusable)
			this.hoverOverlay = null;
			this.hoverTarget  = null;
			
			// Active overlay (single, for editing/commenting/draft)
			this.activeOverlay = null;
			this.activeTarget  = null;
			
			// Observers
			this.resizeObserver = null;
			this.isInitialized  = false;
		}

		/**
		 * Initialize the overlay system
		 */
		init() {
			if (this.isInitialized) return;

			// Create container for all overlays
			this.container               = document.createElement('div');
			this.container.className     = 'mwp-sfe-overlay-container';
			this.container.setAttribute('data-mwp-sfe-control', 'true');
			this.container.style.cssText = `
				top: 0;
				left: 0;
				width: 100%;
				height: 100%;
			`;
			document.body.appendChild(this.container);

			// Create hover overlay (single, reusable)
			this.hoverOverlay               = document.createElement('div');
			this.hoverOverlay.className     = 'mwp-sfe-overlay mwp-sfe-overlay-hover';
			this.container.appendChild(this.hoverOverlay);

			// Create active overlay (single, for editing states)
			this.activeOverlay               = document.createElement('div');
			this.activeOverlay.className     = 'mwp-sfe-overlay mwp-sfe-overlay-active';
			this.container.appendChild(this.activeOverlay);

			// Setup ResizeObserver for all tracked elements
			this.resizeObserver = new ResizeObserver((entries) => {
				requestAnimationFrame(() => {
					entries.forEach(entry => {
						const element = entry.target;
						
						// Update status overlay if exists
						if (this.statusOverlays.has(element)) {
							this.updateStatusOverlay(element);
						}
						
						// Update hover overlay if this is the hovered element
						if (this.hoverTarget === element) {
							this.updateHoverOverlay();
						}
						
						// Update active overlay if this is the active element
						if (this.activeTarget === element) {
							this.updateActiveOverlay();
						}
					});
				});
			});

			// Global scroll/resize handlers
			const updateAll = () => {
				requestAnimationFrame(() => {
					this.updateAllOverlays();
				});
			};

			window.addEventListener('scroll', updateAll, true);
			window.addEventListener('resize', updateAll);

			// MutationObserver to catch ALL DOM changes (accordions, animations, etc.)
			const mutationObserver = new MutationObserver(() => {
				requestAnimationFrame(() => {
					this.updateAllOverlays();
					this.checkVisibility();
				});
			});

			// Observe the entire document for changes
			mutationObserver.observe(document.body, {
				childList:       true,
				subtree:         true,
				attributes:      true,
				attributeFilter: ['style', 'class', 'open'] // Watch for style/class/open changes
			});

			this.isInitialized = true;
		}

		/**
		 * Check if an element is visible in the DOM
		 * @param {HTMLElement} element
		 * @returns {boolean}
		 */
		isElementVisible(element) {
			if (!element || !element.offsetParent) return false;
			
			const style = window.getComputedStyle(element);
			if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
				return false;
			}
			
			return true;
		}

		/**
		 * Check visibility of all tracked elements and hide overlays for hidden elements
		 */
		checkVisibility() {
			// Check status overlays
			this.statusOverlays.forEach((overlay, element) => {
				if (this.isElementVisible(element)) {
					overlay.style.display = '';
				} else {
					overlay.style.display = 'none';
				}
			});

			// Check hover overlay
			if (this.hoverTarget && !this.isElementVisible(this.hoverTarget)) {
				this.hideHover();
			}

			// Check active overlay
			if (this.activeTarget && !this.isElementVisible(this.activeTarget)) {
				this.activeOverlay.style.display = 'none';
			} else if (this.activeTarget) {
				this.activeOverlay.style.display = '';
			}
		}

		/**
		 * Add persistent status overlay to an element
		 * @param {HTMLElement} element - Element to add status overlay to
		 * @param {string} status - Status: 'editable', 'pending'
		 */
		addStatusOverlay(element, status = 'editable') {
			if (!element) return;

			// Check if overlay already exists
			let overlay = this.statusOverlays.get(element);

			if (!overlay) {
				// Create new status overlay
				overlay = document.createElement('div');
				overlay.className = 'mwp-sfe-overlay mwp-sfe-overlay-status';
				overlay.style.cssText = `
					top: 0;
					left: 0;
				`;
				this.container.insertBefore(overlay, this.hoverOverlay); // Insert before hover layer
				this.statusOverlays.set(element, overlay);
				
				// Start observing
				this.resizeObserver.observe(element);
			}

			// Update status
			overlay.setAttribute('data-status', status);
			
			// Position immediately
			this.updateStatusOverlay(element);
		}

		/**
		 * Return the data-status value of an element's status overlay, or null.
		 * Use this instead of touching the element's own classes/attributes.
		 */
		getElementStatus(element) {
			const overlay = this.statusOverlays.get(element);
			return overlay ? overlay.getAttribute('data-status') : null;
		}

		/**
		 * Hide all status overlays (when editing)
		 */
		hideAllStatusOverlays() {
			this.statusOverlays.forEach(overlay => {
				overlay.style.opacity = '0';
			});
		}

		/**
		 * Hide status overlays for switchable elements only, keeping pending-draft
		 * and comment-only outlines visible. Used during regular batch editing so
		 * users can still see which elements are drafts or comment-only while editing.
		 */
		hideSwitchableStatusOverlays() {
			// Only hide overlays for fully switchable elements - keep pending and
			// comment-only outlines visible by reading the overlay's own data-status.
			this.statusOverlays.forEach(overlay => {
				const status = overlay.getAttribute('data-status');
				if (status !== 'pending' && status !== 'comment-only') {
					overlay.style.opacity = '0';
				}
			});
		}

		/**
		 * Show all status overlays (when done editing)
		 */
		showAllStatusOverlays() {
			this.statusOverlays.forEach(overlay => {
				overlay.style.opacity = '1';
			});
		}

		/**
		 * Show hover overlay on an element
		 * @param {HTMLElement} element
		 */
		showHover(element) {
			if (!element || this.hoverTarget === element) return;

			this.hoverTarget = element;
			
			// Start observing if not already
			if (!this.statusOverlays.has(element)) {
				this.resizeObserver.observe(element);
			}

			// Position and show
			this.updateHoverOverlay();
			this.hoverOverlay.style.opacity = '1';
		}

		/**
		 * Hide hover overlay
		 */
		hideHover() {
			if (!this.hoverTarget) return;

			this.hoverOverlay.style.opacity = '0';
			
			// Unobserve if no status overlay
			const oldTarget = this.hoverTarget;
			this.hoverTarget = null;
			
			if (!this.statusOverlays.has(oldTarget) && this.activeTarget !== oldTarget) {
				this.resizeObserver.unobserve(oldTarget);
			}
		}

		/**
		 * Show active overlay with mode
		 * @param {HTMLElement} element
		 * @param {string} mode - 'editing', 'commenting', 'draft-editing', 'draft-preview'
		 */
		showActive(element, mode = 'editing') {
			if (!element) return;

			this.activeTarget = element;
			
			// For regular batch editing, keep pending-draft and comment-only outlines
			// visible so users know which elements exist but are not switchable.
			// For draft or comment active modes, hide ALL outlines - those modes don't
			// allow switching to anything so no indicators need to remain visible.
			const _bm                 = SFE.BatchEditManager;
			const _isRegularBatchEdit = (
				mode === 'editing' &&
				_bm &&
				typeof _bm.isEnabled === 'function' &&
				_bm.isEnabled()
			);
			if (_isRegularBatchEdit) {
				this.hideSwitchableStatusOverlays();
			} else {
				this.hideAllStatusOverlays();
			}

			// Always hide the active element's own status overlay - the active overlay
			// (box-shadow) replaces it while the element is open.
			const _ownOverlay = this.statusOverlays.get(element);
			if (_ownOverlay) _ownOverlay.style.opacity = '0';
			
			// Set mode
			this.activeOverlay.setAttribute('data-mode', mode);
			
			// Start observing
			this.resizeObserver.observe(element);

			// Position overlay
			this.updateActiveOverlay();

			// Only show if element is visible
			if (this.isElementVisible(element)) {
				this.activeOverlay.style.opacity = '1';
			}
		}
		
		/**
		 * Update active overlay to track a new element (for element replacement)
		 * @param {HTMLElement} newElement
		 */
		updateActiveElement(newElement) {
			if (!this.activeTarget || !newElement) return;
			
			// Stop observing old element
			this.resizeObserver.unobserve(this.activeTarget);
			
			// Update to new element
			this.activeTarget = newElement;
			
			// Start observing new element
			this.resizeObserver.observe(newElement);
			
			// Reposition immediately
			this.updateActiveOverlay();
		}

		/**
		 * Update active overlay mode
		 * @param {string} mode
		 */
		updateActiveMode(mode) {
			if (this.activeOverlay) {
				this.activeOverlay.setAttribute('data-mode', mode);
			}
		}

		/**
		 * Hide active overlay
		 */
		hideActive() {
			if (!this.activeTarget) return;

			this.activeOverlay.style.opacity = '0';
			
			// Show status overlays again
			this.showAllStatusOverlays();
			
			// Unobserve
			const oldTarget   = this.activeTarget;
			this.activeTarget = null;
			
			if (!this.statusOverlays.has(oldTarget) && this.hoverTarget !== oldTarget) {
				this.resizeObserver.unobserve(oldTarget);
			}
		}

		/**
		 * Update position of status overlay
		 */
		updateStatusOverlay(element) {
			const overlay = this.statusOverlays.get(element);
			if (!overlay) return;

			const rect       = element.getBoundingClientRect();
			const scrollTop  = window.pageYOffset || document.documentElement.scrollTop;
			const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

			overlay.style.top    = (rect.top + scrollTop) + 'px';
			overlay.style.left   = (rect.left + scrollLeft) + 'px';
			overlay.style.width  = rect.width + 'px';
			overlay.style.height = rect.height + 'px';
		}

		/**
		 * Update position of hover overlay
		 */
		updateHoverOverlay() {
			if (!this.hoverTarget) return;

			const rect       = this.hoverTarget.getBoundingClientRect();
			const scrollTop  = window.pageYOffset || document.documentElement.scrollTop;
			const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

			this.hoverOverlay.style.top    = (rect.top + scrollTop) + 'px';
			this.hoverOverlay.style.left   = (rect.left + scrollLeft) + 'px';
			this.hoverOverlay.style.width  = rect.width + 'px';
			this.hoverOverlay.style.height = rect.height + 'px';
		}

		/**
		 * Update position of active overlay
		 */
		updateActiveOverlay() {
			if (!this.activeTarget) return;

			const rect       = this.activeTarget.getBoundingClientRect();
			const scrollTop  = window.pageYOffset || document.documentElement.scrollTop;
			const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

			this.activeOverlay.style.top    = (rect.top + scrollTop) + 'px';
			this.activeOverlay.style.left   = (rect.left + scrollLeft) + 'px';
			this.activeOverlay.style.width  = rect.width + 'px';
			this.activeOverlay.style.height = rect.height + 'px';
		}

		/**
		 * Update all overlays
		 */
		updateAllOverlays() {
			// Update all status overlays
			this.statusOverlays.forEach((overlay, element) => {
				this.updateStatusOverlay(element);
			});

			// Update hover overlay
			if (this.hoverTarget) {
				this.updateHoverOverlay();
			}

			// Update active overlay
			if (this.activeTarget) {
				this.updateActiveOverlay();
			}
		}
	}

	// Create and export global instance
	SFE.OverlayManager = new OverlayManager();

})();
