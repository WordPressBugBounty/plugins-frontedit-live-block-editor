/**
 * Action Bar Dock - Docked save/submit UI for batch edit mode
 *
 * After the first editor is opened in a batch session the action bar gains
 * a "dock" position fixed to the left of the mode-toggle bar. Whenever no
 * element is hovered or active the bar transitions to this dock showing a
 * Save / Submit-for-Review button.  When the user hovers an element the bar
 * slides back down from the dock and up to the element using the same
 * mwp-sfe-slide animations used everywhere else.
 *
 * Transition rules
 *   element → dock   : mwp-sfe-slide-down-reverse (out), then mwp-sfe-slide-up (in at dock)
 *   dock    → element : mwp-sfe-slide-down-reverse (out from dock), then mwp-sfe-slide-up (in at element)
 *   --mwp-sfe-transition-position is NEVER used between dock and element (suppressed via
 *   bar._suppressPositionTransition flag read by action-bar.js).
 *
 * Cancellation & redirect rules
 *   Docking animation (element → dock)  :  cancelled immediately when a new hover or click
 *                                          arrives, matching the existing editor-close cancel
 *                                          behavior.
 *   Undocking animation (dock → element):  NOT cancelled on new hover.  Instead the target
 *                                          is silently redirected (latestUndockCallback) so
 *                                          the animation runs once and lands on the most
 *                                          recent hovered element.  Rapid N-element hovers
 *                                          all collapse to the last one.
 *                                          Forced cancellation (click-to-edit via
 *                                          cancelAnimation(true)) still clears everything.
 *
 * Preview mode
 *   A CSS rule in frontend-inline.css keeps the docked bar at display:flex but
 *   opacity:0 during body.mwp-sfe-preview-mode so it fades in/out using the
 *   existing opacity transition on .mwp-sfe-inline-actions, identical to the
 *   active-editor preview behavior.
 *
 * Activation
 *   The dock is inactive unless the shared BatchEditManager reports an enabled,
 *   active session with at least one editor opened. Single-block editing keeps
 *   the normal action-bar behavior.
 *
 * Reads (via globals):
 *   SFE.Context          - .actionBar
 *   SFE.BatchEditManager - .isSessionActive, .isEnabled, .handleBatchSave
 *   SFE.ManagerData      - .permissions
 *   SFE.TIMING
 *
 * Exposes: SFE.ActionBarDock
 *   { notifyEditorOpened, notifySessionReset,
 *     shouldHandleHide, handleHide,
 *     shouldHandleShow, handleShow,
 *     shouldHandleReset, handleReset,
 *     cancelAnimation, refreshPosition }
 */

(function () {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	// ── Module state ──────────────────────────────────────────────────────────

	/** True once the first editor has been opened in the current batch session. */
	let sessionHasEdited = false;

	/** True when the action bar is fully positioned at the dock. */
	let isDocked = false;

	/**
	 * Current animation direction, or null when idle.
	 *   'docking'   - element → dock  (phase 1 close, phase 2 slide-up to dock)
	 *   'undocking' - dock → element  (phase 1 close, phase 2 slide-up to element)
	 */
	let animationPhase = null;

	/** Timeout handle for the in-progress two-phase animation. */
	let dockAnimTimeout = null;

	/**
	 * The onDone callback for the current undock animation.
	 * Replaced by every subsequent hover so rapid hovers collapse to the last
	 * target without restarting the animation.
	 */
	let latestUndockCallback = null;

	// ── Internal helpers ──────────────────────────────────────────────────────

	function getBatchManager() {
		return SFE.BatchEditManager || null;
	}

	function getActionBar() {
		return SFE.Context ? SFE.Context.actionBar : null;
	}

	function getBar() {
		var ab = getActionBar();
		return ab ? ab.activeBar : null;
	}

	function getToggleBar() {
		return document.querySelector('.mwp-sfe-mode-toggle-bar');
	}

	function TIMING() {
		return SFE.TIMING || { TRANSITION_DURATION: 200 };
	}

	/**
	 * Clamp a number into an inclusive range.
	 *
	 * @param   {number} value Candidate numeric value.
	 * @param   {number} min   Minimum allowed value.
	 * @param   {number} max   Maximum allowed value.
	 * @returns {number}       Clamped numeric value.
	 */
	function clamp(value, min, max) {
		if (value < min) return min;
		if (value > max) return max;
		return value;
	}

	/**
	 * Returns true when dock behavior should be active:
	 *   - a batch edit session is enabled and currently active, AND
	 *   - the user has opened at least one editor in this session.
	 */
	function isDockActive() {
		var bm = getBatchManager();
		return !!(
			sessionHasEdited &&
			bm &&
			typeof bm.isEnabled === 'function' && bm.isEnabled() &&
			typeof bm.isSessionActive === 'function' && bm.isSessionActive()
		);
	}

	/**
	 * Clears the in-progress animation timeout and resets all phase tracking.
	 * Only call when taking full ownership of bar state.
	 */
	function _clearAnimationState() {
		if (dockAnimTimeout) {
			clearTimeout(dockAnimTimeout);
			dockAnimTimeout = null;
		}
		animationPhase       = null;
		latestUndockCallback = null;
	}

	/**
	 * Calculate the viewport-relative position for the docked bar.
	 *
	 * Preferred placement is on the left side of the mode toggle bar. When that
	 * would push the dock beyond the left edge of the viewport, the dock flips to
	 * the right side instead. Final coordinates are clamped to the viewport so
	 * the dock remains visible even after the toggle bar has been moved.
	 */
	function getDockCoords(bar) {
		var toggleBar = getToggleBar();
		if (!toggleBar || !bar) return null;

		var tRect           = toggleBar.getBoundingClientRect();
		var barRect         = bar.getBoundingClientRect();
		var GAP             = 10;
		var viewportWidth   = document.documentElement.clientWidth || window.innerWidth;
		var viewportHeight  = document.documentElement.clientHeight || window.innerHeight;
		var preferredLeft   = tRect.left - barRect.width - GAP;
		var preferredRight  = tRect.right + GAP;
		var shouldFlipRight = preferredLeft < 0;
		var maxLeft         = Math.max(0, viewportWidth - barRect.width);
		var maxTop          = Math.max(0, viewportHeight - barRect.height);

		return {
			top : clamp(tRect.top, 0, maxTop),
			left: clamp(shouldFlipRight ? preferredRight : preferredLeft, 0, maxLeft),
			side: shouldFlipRight ? 'right' : 'left'
		};
	}

	/**
	 * Apply fixed-position dock coordinates to the bar.
	 * Switches the element away from PositionManager's absolute positioning.
	 */
	function applyDockPosition(bar) {
		var coords = getDockCoords(bar);
		if (!coords) return;

		bar.style.position = 'fixed';
		bar.style.top      = coords.top  + 'px';
		bar.style.left     = coords.left + 'px';
		bar.style.right    = '';
		bar.style.width    = 'fit-content';
		bar.style.maxWidth = '';
		bar.dataset.mwpSfeDockSide = coords.side;
	}

	/**
	 * Build the dock-state content (header + save/submit button) inside the bar.
	 * Clears existing content and removes all mwp-sfe-state-* classes first.
	 */
	function buildDockContent(bar) {
		var bm         = getBatchManager();
		var perms      = (SFE.ManagerData && SFE.ManagerData.permissions) || {};
		var canPublish = !!perms.can_publish;
		var headerText = canPublish ? 'Save Your Changes' : 'Submit for Review';
		var buttonText = canPublish ? 'Save Changes' : 'Submit for Review';

		bar.innerHTML = '';
		Array.from(bar.classList)
			.filter(function(c) { return c.startsWith('mwp-sfe-state-'); })
			.forEach(function(c) { bar.classList.remove(c); });
		bar.classList.add('mwp-sfe-state-dock');

		var row       = document.createElement('div');
		row.className = 'mwp-sfe-single-element-row';

		var headerEl         = document.createElement('div');
		headerEl.className   = 'mwp-sfe-single-element-header';
		headerEl.textContent = headerText;

		var buttonsEl       = document.createElement('div');
		buttonsEl.className = 'mwp-sfe-single-element-buttons';

		var btn         = document.createElement('button');
		btn.className   = 'mwp-sfe-btn mwp-sfe-btn-primary-inline';
		btn.textContent = buttonText;
		// If a save is already in progress when the dock is (re)built, start disabled.
		if (SFE.Context && SFE.Context.isSaving) btn.disabled = true;
		btn.onclick = function(e) {
			e.preventDefault();
			e.stopPropagation();
			if (bm && typeof bm.handleBatchSave === 'function') {
				bm.handleBatchSave(btn);
			}
		};

		buttonsEl.appendChild(btn);
		row.appendChild(headerEl);
		row.appendChild(buttonsEl);
		bar.appendChild(row);
	}

	/**
	 * Force the mwp-sfe-slide-up animation to replay from scratch.
	 */
	function retriggerSlideUp(bar) {
		bar.style.animation = 'none';
		void bar.offsetWidth;
		bar.style.animation = '';
	}

	// ── Dock transition (element/edit → dock) ─────────────────────────────────

	/**
	 * Transition the action bar from its current position to the dock.
	 * Phase 1: play mwp-sfe-slide-down-reverse at the current position.
	 * Phase 2: reposition to dock (fixed), replay mwp-sfe-slide-up.
	 */
	function startDocking(bar, ab) {
		if (!bar) return;

		_clearAnimationState();
		animationPhase = 'docking';

		// Remove scroll listener - the docked bar follows a fixed position.
		ab._removeScrollListener(bar);

		if (bar._multiElements) {
			delete bar._multiElements;
			delete bar._currentFocusIndex;
		}

		ab.activeElement = null;
		if (SFE.hoverTracker) {
			SFE.hoverTracker.currentGroupId      = null;
			SFE.hoverTracker.bottommostElement   = null;
			SFE.hoverTracker.lastHoveredElements = [];
		}

		// Phase 1: slide-down-reverse out of current position.
		bar.classList.add('mwp-sfe-no-position-transition');
		bar.classList.add('mwp-sfe-closing');

		var T = TIMING();

		dockAnimTimeout = setTimeout(function() {
			dockAnimTimeout = null;
			animationPhase  = null;

			if (!bar.classList.contains('mwp-sfe-closing')) return;

			bar.classList.remove('mwp-sfe-closing');

			// Phase 2: build content, position at dock, slide-up in.
			buildDockContent(bar);

			bar.style.display       = 'flex';
			bar.style.pointerEvents = 'auto';
			applyDockPosition(bar);

			bar.classList.add('mwp-sfe-no-position-transition');
			retriggerSlideUp(bar);

			isDocked      = true;
			bar._isDocked = true;

			requestAnimationFrame(function() {
				bar.classList.remove('mwp-sfe-no-position-transition');
			});

		}, T.TRANSITION_DURATION);
	}

	// ── Undock transition (dock → element) ────────────────────────────────────

	/**
	 * Transition the action bar from the dock back to an element.
	 * Phase 1: play mwp-sfe-slide-down-reverse at the dock position.
	 * Phase 2: call latestUndockCallback (most recent hovered element target).
	 *
	 * Rapid hovers during phase 1 only update latestUndockCallback - the
	 * animation runs once and delivers the bar to the latest target.
	 */
	function startUndocking(bar, ab, onDone) {
		if (!bar) {
			if (typeof onDone === 'function') onDone();
			return;
		}

		_clearAnimationState();
		animationPhase       = 'undocking';
		latestUndockCallback = onDone;

		// Mark not-docked immediately so shouldHandleShow can distinguish
		// "fully docked" from "undocking in progress" via animationPhase.
		isDocked      = false;
		bar._isDocked = false;

		// Phase 1: slide-down-reverse out of dock position.
		bar.classList.add('mwp-sfe-no-position-transition');
		bar.classList.add('mwp-sfe-closing');

		var T = TIMING();

		dockAnimTimeout = setTimeout(function() {
			dockAnimTimeout = null;
			animationPhase  = null;

			// Use the latest target - may have been redirected by rapid hovers.
			var resolvedCallback = latestUndockCallback;
			latestUndockCallback = null;

			if (!bar.classList.contains('mwp-sfe-closing')) {
				// Another flow already took control; let it handle everything.
				if (typeof resolvedCallback === 'function') resolvedCallback();
				return;
			}

			bar.classList.remove('mwp-sfe-closing');

			// Switch back to absolute so PositionManager can take over.
			bar.style.position = 'absolute';
			bar.style.left     = '';
			bar.style.right    = '';

			// Signal _continueShowActionBar to suppress position transitions so
			// the bar doesn't CSS-slide from dock coords to element coords.
			bar._suppressPositionTransition = true;

			// Retrigger slide-up before resolvedCallback positions the bar so
			// the bar is invisible (opacity:0/translateY:10px) during the jump.
			retriggerSlideUp(bar);

			if (typeof resolvedCallback === 'function') resolvedCallback();

			requestAnimationFrame(function() {
				delete bar._suppressPositionTransition;
				bar.classList.remove('mwp-sfe-no-position-transition');

				// After landing, if we aren't hovering anymore, trigger the
				// standard hide logic so it plays the closing animation.
				const isHoveringBar = bar.matches(':hover');
				// ab is the ActionBar instance passed into startUndocking
				const isHoveringElement = ab.activeElement && ab.activeElement.matches(':hover');
				const isMultiHover      = bar._multiElements && bar._multiElements.some(el => el.matches(':hover'));

				if (!isHoveringBar && !isHoveringElement && !isMultiHover) {
					// This triggers the standard ActionBar._hideActionBar() logic,
					// which will handle the HOVER_DELAY and the 'mwp-sfe-closing' animation.
					ab.hide(); 
				}
			});

		}, T.TRANSITION_DURATION);
	}

	// ── Resize handler ────────────────────────────────────────────────────────

	window.addEventListener('resize', function() {
		if (!isDocked) return;
		var bar = getBar();
		if (bar) applyDockPosition(bar);
	});

	/**
	 * Reposition the dock immediately when the mode toggle bar moves.
	 *
	 * @returns {void}
	 */
	function refreshPosition() {
		if (!isDocked) return;
		var bar = getBar();
		if (bar) applyDockPosition(bar);
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Cancel the in-progress dock/undock animation.
	 *
	 * @param {boolean} force  When false (default) only cancels a *docking*
	 *                         animation; an undocking animation is left running
	 *                         so its target can be silently redirected by the
	 *                         next handleShow() call.
	 *                         When true (_updateActionBarState on click-to-edit)
	 *                         cancels everything unconditionally.
	 */
	function cancelAnimation(force) {
		if (!dockAnimTimeout) return;

		if (force || animationPhase === 'docking') {
			// When force-cancelling an undocking animation (e.g. user clicked to
			// edit while the bar was sliding down from the dock), reset the bar
			// to a clean position:absolute state and retrigger slide-up so the
			// bar animates into its new edit position rather than flying from
			// the dock's fixed coordinates.
			if (force && animationPhase === 'undocking') {
				var bar = getBar();
				if (bar) {
					bar.classList.remove('mwp-sfe-closing');
					bar.style.position = 'absolute';
					bar.style.left     = '';
					bar.style.right    = '';
					
					// SIGNAL SUPPRESSION: prevent CSS top/left transition from dock coords
					bar._suppressPositionTransition = true;
					requestAnimationFrame(function() {
						delete bar._suppressPositionTransition;
						bar.classList.remove('mwp-sfe-no-position-transition');
					});

					retriggerSlideUp(bar);
				}
			}
			_clearAnimationState();
		}
		// If animationPhase === 'undocking' and !force, leave the timeout
		// running; the next handleShow() call will redirect latestUndockCallback.
	}

	/**
	 * Called by BatchEditManager.startOrSwitchEditing after the editor state
	 * object is created.  Enables dock behavior from this point forward.
	 */
	function notifyEditorOpened() {
		sessionHasEdited = true;
	}

	/**
	 * Called by BatchEditManager._resetSession after a successful batch save.
	 * Disables the dock and cleans up the bar if it was docked.
	 */
	function notifySessionReset() {
		var wasDockedOnReset     = isDocked;
		var wasDockingInProgress = (animationPhase === 'docking');

		sessionHasEdited = false;
		isDocked         = false;
		_clearAnimationState();

		var bar = getBar();
		if (!bar) return;

		bar._isDocked = false;
		bar.classList.remove('mwp-sfe-state-dock');

		var T = TIMING();

		if (wasDockedOnReset) {
			bar.classList.add('mwp-sfe-closing');
			setTimeout(function() {
				if (bar.classList.contains('mwp-sfe-closing')) {
					bar.classList.remove('mwp-sfe-closing');
					bar.style.display  = 'none';
					bar.style.position = 'absolute';
					bar.style.left     = '';
					bar.style.right    = '';
					bar.style.top      = '';
				}
			}, T.TRANSITION_DURATION);

		} else if (wasDockingInProgress) {
			bar.classList.remove('mwp-sfe-closing');
			bar.style.display  = 'none';
			bar.style.position = 'absolute';
			bar.style.left     = '';
			bar.style.right    = '';
			bar.style.top      = '';
		}
	}

	/**
	 * Called inside _hideActionBar's deferred check (after HOVER_DELAY).
	 * Returns true when the dock should receive the bar instead of hiding it.
	 */
	function shouldHandleHide(bar) {
		return isDockActive() && !!bar;
	}

	/**
	 * Called when shouldHandleHide() returns true.
	 * Force-cancels any in-progress animation (including undocking) and starts
	 * a fresh docking transition.
	 */
	function handleHide(bar, ab) {
		// Force-clear all animation state so startDocking starts clean.
		// This handles the edge case where the user leaves an element while
		// an undock animation is still in phase 1.
		if (dockAnimTimeout) {
			clearTimeout(dockAnimTimeout);
			dockAnimTimeout = null;
		}
		animationPhase       = null;
		latestUndockCallback = null;

		// Remove any stale closing class from the aborted undock so
		// startDocking replays the animation from scratch.
		bar.classList.remove('mwp-sfe-closing');
		bar.style.display = 'flex';
		void bar.offsetWidth;

		startDocking(bar, ab);
	}

	/**
	 * Called at the start of _showActionBar.
	 * Returns true when the bar is fully docked OR when an undocking animation
	 * is running (so we can redirect its target instead of flying).
	 */
	function shouldHandleShow() {
		return isDocked || animationPhase === 'undocking';
	}

	/**
	 * Called when shouldHandleShow() returns true.
	 *
	 * - If fully docked: start the two-phase undock animation.
	 * - If already undocking: silently redirect to the new target.  The running
	 *   animation delivers the bar to the most recent target at completion.
	 */
	function handleShow(bar, ab, onDone) {
		if (isDocked) {
			startUndocking(bar, ab, onDone);
		} else if (animationPhase === 'undocking') {
			// Redirect - existing phase-1 timeout runs uninterrupted.
			latestUndockCallback = onDone;
		}
	}

	/**
	 * Called inside _resetActionBar when the mouse is not over any editable.
	 * Returns true when the dock should receive the bar instead of closing it.
	 */
	function shouldHandleReset(bar) {
		return isDockActive() && !!bar;
	}

	function handleReset(bar, ab) {
		startDocking(bar, ab);
	}

	SFE.ActionBarDock = {
		notifyEditorOpened,
		notifySessionReset,
		shouldHandleHide,
		handleHide,
		shouldHandleShow,
		handleShow,
		shouldHandleReset,
		handleReset,
		cancelAnimation,
		refreshPosition,
	};

})();
