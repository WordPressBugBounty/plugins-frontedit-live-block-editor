/**
 * Floating element positioning - smart sticky placement for toolbar + action bar
 *
 * Exposes: SFE.PositionManager
 *   { positionFloatingElements, debouncedPosition, schedulePosition }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Reusable smart positioning logic
	 */
	function positionFloatingElements(element, toolbar, actions, skipTransitionControl = false) {
		const actionsEl = (actions && actions._isDocked) ? null : actions;
		const toolbarEl = toolbar;
		if (!toolbarEl && !actionsEl) return;

		const scrollTop      = window.pageYOffset || document.documentElement.scrollTop;
		const scrollLeft     = window.pageXOffset || document.documentElement.scrollLeft;
		const viewportWidth  = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const PADDING        = 8;
		const GAP            = 8; // Gap between element and bars

		const rect = element.getBoundingClientRect();

		// Safety check: If the element is currently "invisible" or 0,0 during replacement
		if (rect.top === 0 && rect.left === 0 && rect.width === 0) {
			return; // Don't move the bars to 0,0
		}

		// Disable position transitions during scroll (keep size transitions).
		// Skip if the element has a live state-change transition in progress -
		// the _markTransitioning() guard in ActionBar sets this flag.
		if (!skipTransitionControl) {
			if (toolbarEl && !toolbarEl._isStateTransitioning) toolbarEl.classList.add('mwp-sfe-no-position-transition');
			if (actionsEl && !actionsEl._isStateTransitioning) actionsEl.classList.add('mwp-sfe-no-position-transition');
		}

		function applyPos(el, isToolbar) {
			if (!el) return { top: 0, height: 0 };
			
			// Don't override a docked action bar's fixed position.
			if (el._isDocked) return { top: 0, height: 0 };
			
			// Ensure element is visible for measurement
			const originalDisplay = el.style.display;
			const isHidden        = getComputedStyle(el).display === 'none';
			if (isHidden) {
				el.style.display    = 'flex';
				el.style.visibility = 'hidden';
			}

			// Measurement reset
			el.style.position = 'absolute';
			if (isToolbar) {
				el.style.top  = '0';    // Reset top so it doesn't affect scroll height
				el.style.left = '0';   // Move to far left to give it maximum "runway"
			}
			el.style.right = '';
			el.style.width = '';

			// Calculate current available viewport room
			const maxAvailableWidth = viewportWidth - (PADDING * 2);
			el.style.maxWidth       = maxAvailableWidth + 'px';
			el.style.boxSizing      = 'border-box';
			
			// Force reflow to commit any pending class changes (e.g. removal of
			// mwp-sfe-no-position-transition) before the final top/left are written.
			void el.offsetHeight;

			const elWidth  = el.offsetWidth;
			const elHeight = el.offsetHeight;
			
			// Ideal Left (Left-aligned with element)
			const elementLeft       = rect.left + scrollLeft;
			const elementRight      = rect.right + scrollLeft;
			const viewportRightEdge = scrollLeft + viewportWidth - PADDING;
			const minLeft           = scrollLeft + PADDING;
			const maxLeft           = viewportRightEdge - elWidth;
			
			let elLeft = elementLeft;

			// 1. Try left-aligning with the element
			// 2. If it overflows the right viewport edge, try right-aligning with the element
			if (elLeft > maxLeft) {
				elLeft = elementRight - elWidth;
			}
			
			// 3. Clamp to the left edge of the viewport if we've pushed too far left
			if (elLeft < minLeft) {
				elLeft = minLeft;
			}

			// 4. FINAL SAFETY CLAMP: Ensure the right side NEVER exceeds the viewport edge.
			// This handles cases where the element is very wide or the zoom is high.
			if (elLeft > maxLeft) {
				elLeft = maxLeft;
			}

			el.style.left = elLeft + 'px';
			
			// Calculate vertical position with sticky behavior
			let elTop;
			
			if (isToolbar) {
				// Toolbar: default position is above the element
				const defaultTop              = rect.top + scrollTop - elHeight - GAP;
				const elementTopInViewport    = rect.top;
				const elementBottomInViewport = rect.bottom;
				const toolbarTopInViewport    = elementTopInViewport - elHeight - GAP;
				
				// Check if toolbar would be above viewport
				if (toolbarTopInViewport >= PADDING) {
					// Toolbar fits above element - use default position
					elTop = defaultTop;
				} else if (elementBottomInViewport > elHeight + PADDING + GAP) {
					// Element top is above viewport but bottom is still visible
					// And there's room for toolbar in viewport
					// Stick to top of viewport
					elTop = scrollTop + PADDING;
				} else {
					// Element is mostly or completely above viewport - anchor to bottom of element.
					// Using defaultTop (element top) here puts the toolbar far above the visible
					// area when rect.top is deeply negative. Anchoring to rect.bottom instead
					// keeps the toolbar just above the element's last visible edge, mirroring
					// how the action bar anchors to rect.top when the element is below viewport.
					elTop = rect.bottom + scrollTop - elHeight - GAP;
				}
			} else {
				// Action bar: default position is below the element
				const defaultTop                = rect.bottom + scrollTop + GAP;
				const elementBottomInViewport   = rect.bottom;
				const elementTopInViewport      = rect.top;
				const actionBarBottomInViewport = elementBottomInViewport + GAP + elHeight;
				
				// Check if action bar bottom would be below viewport
				if (actionBarBottomInViewport <= viewportHeight - PADDING) {
					// Action bar fits below element - use default position
					elTop = defaultTop;
				} else if (elementTopInViewport < viewportHeight - elHeight - PADDING - GAP) {
					// Element bottom is below viewport but top is still visible
					// And there's room for action bar in viewport
					// Stick to bottom of viewport
					elTop = scrollTop + viewportHeight - elHeight - PADDING;
				} else {
					// Element is mostly or completely below viewport - move with element
					elTop = rect.top + scrollTop + PADDING;
				}
			}

			el.style.top = elTop + 'px';

			// Restore visibility/display
			if (isHidden) {
				el.style.display    = originalDisplay;
				el.style.visibility = '';
			}
			
			return { top: elTop, height: elHeight };
		}

		// Apply positions and get their calculated positions
		const toolbarPos = applyPos(toolbarEl, true);
		const actionsPos = applyPos(actionsEl, false);
		
		// Collision detection - prevent toolbar and action bar from overlapping
		if (toolbarEl && actionsEl) {
			const toolbarBottom = toolbarPos.top + toolbarPos.height;
			const actionsTop    = actionsPos.top;
			const collision     = toolbarBottom + GAP > actionsTop;
			
			if (collision) {
				// They're colliding - determine which one moves
				const elementTopInViewport    = rect.top;
				const elementBottomInViewport = rect.bottom;
				const elementCenterInViewport = (elementTopInViewport + elementBottomInViewport) / 2;
				const viewportCenter          = viewportHeight / 2;
				
				// If element center is in lower half of viewport, move action bar down with toolbar
				// If element center is in upper half, move toolbar up with action bar
				if (elementCenterInViewport > viewportCenter) {
					// Move action bar down to be below toolbar
					const newActionsTop = toolbarBottom + GAP;
					actionsEl.style.top = newActionsTop + 'px';
				} else {
					// Move toolbar up to be above action bar
					const newToolbarTop = actionsTop - toolbarPos.height - GAP;
					toolbarEl.style.top = newToolbarTop + 'px';
				}
			}
		}
	}

	/**
	 * rAF-scheduled position updater (1 per frame)
	 */
	function createRafScheduler(fn) {
		let rafId = null;
		const queue = [];

		return function scheduledPosition(...args) {
			queue.push(args);
			if (rafId) return;
			rafId = requestAnimationFrame(() => {
				rafId = null;
				const batch = queue.splice(0, queue.length);
				batch.forEach(callArgs => fn(...callArgs));
			});
		};
	}

	const schedulePosition  = createRafScheduler(positionFloatingElements);
	const debouncedPosition = schedulePosition;

	SFE.PositionManager = { positionFloatingElements, debouncedPosition, schedulePosition };
})();