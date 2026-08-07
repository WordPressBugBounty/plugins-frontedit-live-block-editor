/**
 * Move manager - reusable pointer-driven movement for floating UI.
 *
 * Reads (via globals):
 *   SFE.Context - optional shared runtime context
 *
 * Exposes: SFE.FloatingUiMoveManager
 *   {
 *     createMover,
 *     createDetachedGripMover,
 *     buildDetachedGripBounds,
 *     isDragActive,
 *     getActiveOwner
 *   }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/** @type {{ owner:string, element:HTMLElement }|null} */
	let activeDragSession = null;

	/** @type {HTMLElement|null} */
	let sharedGripElement = null;

	/** @type {ReturnType<typeof createDetachedGripMover>|null} */
	let sharedGripOwnerController = null;

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
	 * Read the current viewport dimensions in CSS pixels.
	 *
	 * @returns {{ width:number, height:number }} Viewport size.
	 */
	function getViewportSize() {
		return {
			width:  document.documentElement.clientWidth || window.innerWidth || 0,
			height: document.documentElement.clientHeight || window.innerHeight || 0,
		};
	}

	/**
	 * Normalize a caller-provided bounds object so every edge is present.
	 *
	 * @param   {Partial<{ minLeft:number, maxLeft:number, minTop:number, maxTop:number }>|null} bounds Raw bounds.
	 * @param   {DOMRect}                                                                  rect   Current element rect.
	 * @returns {{ minLeft:number, maxLeft:number, minTop:number, maxTop:number }}                Normalized bounds.
	 */
	function normalizeBounds(bounds, rect) {
		const viewport = getViewportSize();
		const defaults = {
			minLeft: 0,
			maxLeft: Math.max(0, viewport.width - rect.width),
			minTop:  0,
			maxTop:  Math.max(0, viewport.height - rect.height),
		};

		if (!bounds) return defaults;

		return {
			minLeft: Number.isFinite(bounds.minLeft) ? bounds.minLeft : defaults.minLeft,
			maxLeft: Number.isFinite(bounds.maxLeft) ? bounds.maxLeft : defaults.maxLeft,
			minTop:  Number.isFinite(bounds.minTop)  ? bounds.minTop  : defaults.minTop,
			maxTop:  Number.isFinite(bounds.maxTop)  ? bounds.maxTop  : defaults.maxTop,
		};
	}

	/**
	 * Build viewport bounds for a draggable element that uses a detached grip.
	 *
	 * Left, right, and bottom are constrained by the draggable element itself.
	 * Top is constrained by the detached grip so the grip can slide up until it
	 * touches the viewport edge while the target remains partially below it.
	 *
	 * @param   {Object} config Configuration values.
	 * @param   {DOMRect} config.rect Current target element rect.
	 * @param   {DOMRect|null} [config.gripRect] Current detached grip rect.
	 * @param   {{ width:number, height:number }} [config.viewport] Viewport size.
	 * @returns {{ minLeft:number, maxLeft:number, minTop:number, maxTop:number }} Bounds.
	 */
	function buildDetachedGripBounds(config) {
		const rect         = config.rect;
		const gripRect     = config.gripRect || null;
		const viewport     = config.viewport || getViewportSize();
		const gripTopOffset = gripRect ? Math.max(0, rect.top - gripRect.top) : 0;

		return {
			minLeft: 0,
			maxLeft: Math.max(0, viewport.width - rect.width),
			minTop:  gripTopOffset,
			maxTop:  Math.max(0, viewport.height - rect.height),
		};
	}

	/**
	 * Toggle shared drag state for the runtime so other modules can suppress
	 * hover-driven behavior while a control is being moved.
	 *
	 * @param {string|null} owner   Logical owner of the drag session.
	 * @param {HTMLElement|null} element Element being moved.
	 * @returns {void}
	 */
	function setActiveDragSession(owner, element) {
		activeDragSession = owner && element ? { owner, element } : null;
		document.body.classList.toggle('mwp-sfe-ui-dragging', !!activeDragSession);
	}

	/**
	 * Return whether any FloatingUiMoveManager-driven drag session is active.
	 *
	 * @returns {boolean} True when a drag session is active.
	 */
	function isDragActive() {
		return !!activeDragSession;
	}

	/**
	 * Return the logical owner name for the active drag session.
	 *
	 * @returns {string|null} Active owner name when dragging, otherwise null.
	 */
	function getActiveOwner() {
		return activeDragSession ? activeDragSession.owner : null;
	}

	/**
	 * Reset the shared grip to its generic base presentation.
	 *
	 * @param {HTMLElement} grip Shared detached grip element.
	 * @returns {void}
	 */
	function resetSharedGripPresentation(grip) {
		grip.className = 'mwp-sfe-grip-bar';
		grip.removeAttribute('data-mwp-sfe-grip-owner');
		grip.setAttribute('aria-label', 'Move element');
		grip.classList.remove('mwp-sfe-is-visible');
		grip.classList.remove('mwp-sfe-is-dragging');
	}

	/**
	 * Apply owner-specific grip metadata and classes to the shared grip.
	 *
	 * @param {HTMLElement} grip Shared detached grip element.
	 * @param {string} owner Logical owner name.
	 * @param {Object} gripOptions Presentation options for the current owner.
	 * @returns {void}
	 */
	function applySharedGripPresentation(grip, owner, gripOptions) {
		resetSharedGripPresentation(grip);
		grip.setAttribute('data-mwp-sfe-grip-owner', owner);
		grip.setAttribute('aria-label', gripOptions.ariaLabel || 'Move element');

		const extraClasses = Array.isArray(gripOptions.classNames)
			? gripOptions.classNames
			: [];
		extraClasses.forEach(className => {
			if (className) grip.classList.add(className);
		});
	}

	/**
	 * Refresh the shared grip's hover-driven visibility for the active owner.
	 *
	 * @returns {void}
	 */
	function syncActiveGripVisibility() {
		if (!sharedGripOwnerController) return;
		sharedGripOwnerController.syncGripVisibility();
	}

	/**
	 * Create the singleton detached grip element used by all movable controls.
	 *
	 * The grip is shared so only one grip exists at a time, mirroring how the
	 * action bar moves between eligible elements instead of duplicating chrome.
	 *
	 * @returns {HTMLElement} Shared grip element.
	 */
	function ensureSharedGripElement() {
		if (sharedGripElement && document.body.contains(sharedGripElement)) {
			return sharedGripElement;
		}

		const grip = document.createElement('button');
		grip.type = 'button';
		grip.className = 'mwp-sfe-grip-bar';
		grip.setAttribute('data-mwp-sfe-control', 'true');
		grip.setAttribute('tabindex', '-1');
		grip.setAttribute('aria-label', 'Move element');

		for (let index = 0; index < 5; index++) {
			const dot = document.createElement('span');
			dot.className = 'mwp-sfe-grip-bar-dot';
			dot.setAttribute('aria-hidden', 'true');
			grip.appendChild(dot);
		}

		grip.addEventListener('click', function(event) {
			event.preventDefault();
			event.stopPropagation();
		});

		grip.addEventListener('mouseenter', function() {
			syncActiveGripVisibility();
		});

		grip.addEventListener('mouseleave', function() {
			requestAnimationFrame(syncActiveGripVisibility);
		});

		document.body.appendChild(grip);
		sharedGripElement = grip;
		return grip;
	}

	/**
	 * Resolve the controller-safe shared grip element.
	 *
	 * @returns {HTMLElement} Shared grip element.
	 */
	function getSharedGripElement() {
		return ensureSharedGripElement();
	}

	/**
	 * Assign shared grip ownership to a controller so the singleton grip follows
	 * that controller's target element and presentation rules.
	 *
	 * @param {ReturnType<typeof createDetachedGripMover>|null} controller Active detached-grip controller.
	 * @returns {HTMLElement|null} Shared grip when assigned, otherwise null.
	 */
	function assignSharedGripOwner(controller) {
		if (!controller) {
			sharedGripOwnerController = null;
			if (sharedGripElement) resetSharedGripPresentation(sharedGripElement);
			return null;
		}

		const grip = getSharedGripElement();
		sharedGripOwnerController = controller;
		applySharedGripPresentation(grip, controller.owner, controller.getGripOptions());
		return grip;
	}

	/**
	 * Create a reusable pointer-driven mover for an element.
	 *
	 * The caller owns position storage and rendering via getPosition/applyPosition.
	 * This helper provides pointer lifecycle, viewport clamping, and drag-state
	 * coordination that other UI modules can share.
	 *
	 * @param   {Object}   config                    Mover configuration.
	 * @param   {HTMLElement} config.element         Element being moved.
	 * @param   {HTMLElement} config.handle          Handle that starts the drag.
	 * @param   {string}   [config.owner]            Logical owner name for shared drag state.
	 * @param   {Function} config.getPosition        () => { left:number, top:number } current position.
	 * @param   {Function} config.applyPosition      (position, meta) => void render callback.
	 * @param   {Function} [config.getBounds]        ({ element, rect, viewport }) => bounds callback.
	 * @param   {Function} [config.onDragStart]      Optional drag-start callback.
	 * @param   {Function} [config.onDragMove]       Optional drag-move callback.
	 * @param   {Function} [config.onDragEnd]        Optional drag-end callback.
	 * @returns {{ destroy:Function, syncToBounds:Function, isDragging:Function }} Controller API.
	 */
	function createMover(config) {
		const element       = config.element;
		const handle        = config.handle || config.element;
		const owner         = String(config.owner || 'generic').trim() || 'generic';
		const getPosition   = config.getPosition;
		const applyPosition = config.applyPosition;
		const getBounds     = config.getBounds || null;
		const onDragStart   = config.onDragStart || null;
		const onDragMove    = config.onDragMove || null;
		const onDragEnd     = config.onDragEnd || null;

		let pointerId      = null;
		let startPointerX  = 0;
		let startPointerY  = 0;
		let startPosition  = { left: 0, top: 0 };
		let isDragging     = false;
		let destroyed      = false;

		/**
		 * Resolve movement bounds for the current element rect.
		 *
		 * @param   {DOMRect} rect Current element rect.
		 * @returns {{ minLeft:number, maxLeft:number, minTop:number, maxTop:number }} Bounds.
		 */
		function resolveBounds(rect) {
			const viewport  = getViewportSize();
			const rawBounds = typeof getBounds === 'function'
				? getBounds({ element, rect, viewport })
				: null;
			return normalizeBounds(rawBounds, rect);
		}

		/**
		 * Clamp a candidate left/top position to the current allowed bounds.
		 *
		 * @param   {{ left:number, top:number }} position Candidate position.
		 * @param   {DOMRect}                     rect     Current element rect.
		 * @returns {{ left:number, top:number }}         Clamped position.
		 */
		function clampPosition(position, rect) {
			const bounds = resolveBounds(rect);
			return {
				left: clamp(position.left, bounds.minLeft, bounds.maxLeft),
				top:  clamp(position.top, bounds.minTop, bounds.maxTop),
			};
		}

		/**
		 * Re-clamp the current element position to the latest viewport bounds.
		 *
		 * @param   {Object} [meta] Callback metadata passed through to applyPosition.
		 * @returns {{ left:number, top:number }} Clamped position.
		 */
		function syncToBounds(meta = {}) {
			const rect         = element.getBoundingClientRect();
			const nextPosition = clampPosition(getPosition(), rect);
			applyPosition(nextPosition, Object.assign({
				isDragging: false,
				source:     'sync',
			}, meta));
			return nextPosition;
		}

		/**
		 * Finish the current drag session and emit the end callback.
		 *
		 * @param {PointerEvent|null} event     Finishing pointer event.
		 * @param {boolean}           cancelled Whether the drag ended via cancellation.
		 * @returns {void}
		 */
		function endDrag(event, cancelled) {
			if (!isDragging) return;

			isDragging = false;
			element.classList.remove('mwp-sfe-is-dragging');
			setActiveDragSession(null, null);

			window.removeEventListener('pointermove', handlePointerMove, true);
			window.removeEventListener('pointerup', handlePointerUp, true);
			window.removeEventListener('pointercancel', handlePointerCancel, true);

			if (pointerId !== null && handle.releasePointerCapture) {
				try {
					handle.releasePointerCapture(pointerId);
				} catch (_) {
					// Pointer capture release failures are non-fatal.
				}
			}

			const finalPosition = syncToBounds({
				source:    cancelled ? 'cancel' : 'end',
				cancelled: !!cancelled,
			});

			if (typeof onDragEnd === 'function') {
				onDragEnd({
					event,
					position: finalPosition,
					cancelled: !!cancelled,
					element,
				});
			}

			pointerId = null;
		}

		/**
		 * Advance the drag session with the latest pointer coordinates.
		 *
		 * @param {PointerEvent} event Active pointer event.
		 * @returns {void}
		 */
		function handlePointerMove(event) {
			if (!isDragging || event.pointerId !== pointerId) return;

			const rect         = element.getBoundingClientRect();
			const nextPosition = clampPosition({
				left: startPosition.left + (event.clientX - startPointerX),
				top:  startPosition.top + (event.clientY - startPointerY),
			}, rect);

			applyPosition(nextPosition, {
				isDragging: true,
				source:     'move',
				event,
			});

			if (typeof onDragMove === 'function') {
				onDragMove({
					event,
					position: nextPosition,
					element,
				});
			}
		}

		/**
		 * Finish the drag when the active pointer is released.
		 *
		 * @param {PointerEvent} event Pointer-up event.
		 * @returns {void}
		 */
		function handlePointerUp(event) {
			if (event.pointerId !== pointerId) return;
			endDrag(event, false);
		}

		/**
		 * Cancel the drag when the browser cancels the active pointer.
		 *
		 * @param {PointerEvent} event Pointer-cancel event.
		 * @returns {void}
		 */
		function handlePointerCancel(event) {
			if (event.pointerId !== pointerId) return;
			endDrag(event, true);
		}

		/**
		 * Start a new drag session from the configured handle.
		 *
		 * @param {PointerEvent} event Pointer-down event.
		 * @returns {void}
		 */
		function handlePointerDown(event) {
			if (destroyed) return;
			if (event.button !== undefined && event.button !== 0) return;
			if (isDragActive()) return;

			event.preventDefault();
			event.stopPropagation();

			const rect            = element.getBoundingClientRect();
			const currentPosition = clampPosition(getPosition(), rect);

			pointerId     = event.pointerId;
			startPointerX = event.clientX;
			startPointerY = event.clientY;
			startPosition = currentPosition;
			isDragging    = true;

			element.classList.add('mwp-sfe-is-dragging');
			setActiveDragSession(owner, element);

			if (handle.setPointerCapture) {
				try {
					handle.setPointerCapture(pointerId);
				} catch (_) {
					// Pointer capture failures are non-fatal.
				}
			}

			window.addEventListener('pointermove', handlePointerMove, true);
			window.addEventListener('pointerup', handlePointerUp, true);
			window.addEventListener('pointercancel', handlePointerCancel, true);

			if (typeof onDragStart === 'function') {
				onDragStart({
					event,
					position: currentPosition,
					element,
				});
			}
		}

		handle.addEventListener('pointerdown', handlePointerDown, true);

		return {
			destroy() {
				if (destroyed) return;
				destroyed = true;
				handle.removeEventListener('pointerdown', handlePointerDown, true);
				endDrag(null, true);
			},
			syncToBounds,
			isDragging() {
				return isDragging;
			},
		};
	}

	/**
	 * Create a controller for draggable UI that uses the shared detached grip.
	 *
	 * The caller still owns target-specific position state and visibility rules,
	 * but the FloatingUiMoveManager owns the shared grip element, drag lifecycle, hover
	 * plumbing, and viewport sync so future movable controls can reuse them.
	 *
	 * @param   {Object} config Detached-grip mover configuration.
	 * @param   {HTMLElement} config.element Target element being moved.
	 * @param   {string} [config.owner] Logical owner name for drag/grip state.
	 * @param   {Function} config.getPosition () => { left:number, top:number } current target position.
	 * @param   {Function} config.applyPosition (position, meta) => void render callback.
	 * @param   {Function} [config.getBounds] ({ element, rect, viewport, grip, gripRect, defaultBounds }) => bounds callback.
	 * @param   {Function} [config.getGripAnchorBox] ({ element, rect }) => { left:number, top:number, width:number } anchor box callback.
	 * @param   {Function|HTMLElement[]|null} [config.visibilityTargets] Targets that should refresh grip visibility on hover.
	 * @param   {Function} [config.shouldShowGrip] ({ element, grip, isDragging }) => boolean visibility callback.
	 * @param   {Function|boolean} [config.isMovable] Whether the current target may use the shared grip.
	 * @param   {Object} [config.gripOptions] Shared grip presentation options.
	 * @param   {Function} [config.onDragStart] Optional drag-start callback.
	 * @param   {Function} [config.onDragMove] Optional drag-move callback.
	 * @param   {Function} [config.onDragEnd] Optional drag-end callback.
	 * @returns {{
	 *   owner:string,
	 *   destroy:Function,
	 *   activateGrip:Function,
	 *   syncToBounds:Function,
	 *   syncGripPosition:Function,
	 *   syncGripVisibility:Function,
	 *   isDragging:Function,
	 *   getGripOptions:Function
	 * }} Controller API.
	 */
	function createDetachedGripMover(config) {
		const element          = config.element;
		const owner            = String(config.owner || 'generic').trim() || 'generic';
		const getPosition      = config.getPosition;
		const applyPosition    = config.applyPosition;
		const getBounds        = config.getBounds || null;
		const getGripAnchorBox = config.getGripAnchorBox || null;
		const shouldShowGrip   = config.shouldShowGrip || null;
		const gripOptions      = Object.assign({
			ariaLabel:  'Move element',
			classNames: [],
		}, config.gripOptions || {});
		const onDragStart      = config.onDragStart || null;
		const onDragMove       = config.onDragMove || null;
		const onDragEnd        = config.onDragEnd || null;

		let destroyed = false;
		const visibilityBindings = [];

		/**
		 * Resolve whether this target currently supports the shared move grip.
		 *
		 * @returns {boolean} True when the target may currently be moved.
		 */
		function isMovable() {
			if (typeof config.isMovable === 'function') return !!config.isMovable({ element });
			if (config.isMovable === undefined) return true;
			return !!config.isMovable;
		}

		/**
		 * Resolve hover targets that should refresh shared grip visibility.
		 *
		 * @returns {HTMLElement[]} Visibility-sync hover targets.
		 */
		function resolveVisibilityTargets() {
			if (typeof config.visibilityTargets === 'function') {
				return (config.visibilityTargets({ element }) || []).filter(Boolean);
			}
			if (Array.isArray(config.visibilityTargets)) {
				return config.visibilityTargets.filter(Boolean);
			}
			return [element];
		}

		/**
		 * Return the current shared grip options for this controller.
		 *
		 * @returns {{ ariaLabel:string, classNames:string[] }} Grip presentation options.
		 */
		function getControllerGripOptions() {
			return {
				ariaLabel:  gripOptions.ariaLabel,
				classNames: Array.isArray(gripOptions.classNames) ? gripOptions.classNames.slice() : [],
			};
		}

		/**
		 * Resolve the current detached grip anchor box for this target.
		 *
		 * @returns {{ left:number, top:number, width:number }} Grip anchor box.
		 */
		function resolveGripAnchorBox() {
			const rect = element.getBoundingClientRect();
			if (typeof getGripAnchorBox === 'function') {
				return getGripAnchorBox({ element, rect });
			}
			return {
				left:  rect.left,
				top:   rect.top,
				width: rect.width,
			};
		}

		/**
		 * Resolve the current shared grip for this controller and claim ownership
		 * when this controller becomes the active detached-grip target.
		 *
		 * @returns {HTMLElement|null} Shared grip when available, otherwise null.
		 */
		function activateGrip() {
			if (destroyed || !isMovable()) return null;
			if (isDragActive() && getActiveOwner() !== owner) {
				return sharedGripOwnerController === api ? getSharedGripElement() : null;
			}
			const grip = assignSharedGripOwner(api);
			syncGripPosition();
			return grip;
		}

		/**
		 * Position the shared grip relative to this controller's target element.
		 *
		 * @returns {void}
		 */
		function syncGripPosition() {
			if (sharedGripOwnerController !== api) return;
			const grip      = getSharedGripElement();
			const anchorBox = resolveGripAnchorBox();
			grip.style.left = Math.round(anchorBox.left + (anchorBox.width / 2)) + 'px';
			grip.style.top  = Math.round(anchorBox.top) + 'px';
		}

		/**
		 * Refresh the shared grip visibility class using the caller's visibility
		 * policy while keeping drag visibility guaranteed during active drags.
		 *
		 * @returns {void}
		 */
		function syncGripVisibility() {
			if (destroyed || sharedGripOwnerController !== api) return;
			const grip = getSharedGripElement();

			const showGrip = mover.isDragging() || (
				typeof shouldShowGrip === 'function'
					? !!shouldShowGrip({ element, grip, isDragging: mover.isDragging() })
					: true
			);

			grip.classList.toggle('mwp-sfe-is-visible', showGrip);
		}

		const mover = createMover({
			element,
			handle: getSharedGripElement(),
			owner,
			getPosition,
			applyPosition(position, meta) {
				applyPosition(position, meta);
				syncGripPosition();
			},
			getBounds({ rect, viewport }) {
				const grip         = getSharedGripElement();
				const gripRect     = grip.getBoundingClientRect();
				const defaultBounds = buildDetachedGripBounds({ rect, gripRect, viewport });
				if (typeof getBounds === 'function') {
					return getBounds({
						element,
						rect,
						viewport,
						grip,
						gripRect,
						defaultBounds,
					});
				}
				return defaultBounds;
			},
			onDragStart(payload) {
				const grip = activateGrip();
				if (grip) grip.classList.add('mwp-sfe-is-dragging');
				syncGripPosition();
				syncGripVisibility();
				if (typeof onDragStart === 'function') onDragStart(payload);
			},
			onDragMove(payload) {
				syncGripPosition();
				syncGripVisibility();
				if (typeof onDragMove === 'function') onDragMove(payload);
			},
			onDragEnd(payload) {
				const grip = getSharedGripElement();
				grip.classList.remove('mwp-sfe-is-dragging');
				requestAnimationFrame(function() {
					syncGripPosition();
					syncGripVisibility();
				});
				if (typeof onDragEnd === 'function') onDragEnd(payload);
			},
		});

		/**
		 * Attach hover listeners to the configured visibility targets.
		 *
		 * @returns {void}
		 */
		function bindVisibilityTargets() {
			resolveVisibilityTargets().forEach(target => {
				if (!target) return;

				const enterHandler = function() {
					activateGrip();
					syncGripVisibility();
				};
				const leaveHandler = function() {
					requestAnimationFrame(function() {
						if (sharedGripOwnerController === api) {
							syncGripVisibility();
						}
					});
				};

				target.addEventListener('mouseenter', enterHandler);
				target.addEventListener('mouseleave', leaveHandler);
				visibilityBindings.push({ target, enterHandler, leaveHandler });
			});
		}

		/**
		 * Keep this target and the shared grip clamped to the viewport as layout
		 * changes occur, including browser resize.
		 *
		 * @returns {void}
		 */
		function bindResizeSync() {
			const resizeHandler = function() {
				if (destroyed) return;
				mover.syncToBounds({ source: 'resize' });
				if (sharedGripOwnerController === api) {
					syncGripPosition();
					syncGripVisibility();
				}
			};

			window.addEventListener('resize', resizeHandler);
			visibilityBindings.push({ target: window, resizeHandler });
		}

		const api = {
			owner,
			destroy() {
				if (destroyed) return;
				destroyed = true;

				visibilityBindings.forEach(binding => {
					if (binding.resizeHandler) {
						window.removeEventListener('resize', binding.resizeHandler);
						return;
					}
					binding.target.removeEventListener('mouseenter', binding.enterHandler);
					binding.target.removeEventListener('mouseleave', binding.leaveHandler);
				});

				if (sharedGripOwnerController === api) {
					assignSharedGripOwner(null);
				}

				mover.destroy();
			},
			activateGrip,
			syncToBounds(meta = {}) {
				const nextPosition = mover.syncToBounds(meta);
				syncGripPosition();
				syncGripVisibility();
				return nextPosition;
			},
			syncGripPosition,
			syncGripVisibility,
			isDragging() {
				return mover.isDragging();
			},
			getGripOptions() {
				return getControllerGripOptions();
			},
		};

		bindVisibilityTargets();
		bindResizeSync();

		return api;
	}

	SFE.FloatingUiMoveManager = {
		createMover,
		createDetachedGripMover,
		buildDetachedGripBounds,
		isDragActive,
		getActiveOwner,
	};

})();
