/**
 * Frontend inline editing bootstrap and runtime orchestration.
 *
 * Reads: SFE.PostLockManager - .beginLockClaim
 * Exposes: SFE.Context and cross-module runtime methods used across managers/editors.
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};
	if (typeof MWPSFE_Manager_Data !== 'undefined' && Object.keys(SFE.ManagerData).length === 0) {
		SFE.ManagerData = MWPSFE_Manager_Data;
	}

	const TIMING = {
		FOCUS_DEBOUNCE:      50,
		HOVER_DELAY:         300,
		EDIT_DELAY:          300,
		TRIGGER_DELAY:       500,
		TRANSITION_DURATION: 200,
		SAFETY_DURATION:     250,
		ERROR_DISPLAY:       2000,
		SUCCESS_DISPLAY:     2000,
		SUCCESS_FADE:        300,
	};

	// Expose TIMING so utility modules can read it
	SFE.TIMING = TIMING;
	
	const restBase         = SFE.ManagerData.restUrl;
	const postId           = SFE.ManagerData.postId;
	const uuidMap          = SFE.ManagerData.uuidMap || {};
	const perms            = SFE.ManagerData.permissions || {};
	let pageRevisionToken  = SFE.ManagerData.pageRevisionToken || 0;
	const handlers         = SFE.ManagerData.handlers || [];
	const disabledElements = new Set();
	const canAccessDrafts  = !!(perms.can_publish || perms.can_draft);

	// Overlay manager reference (assumes overlay-manager.js is loaded first)
	const overlayManager = SFE.OverlayManager;

	// Hover tracking for overlapping elements (make globally accessible)
	SFE.hoverTracker = {
		lastHoveredElements: [],
		currentGroupId:      null,
		bottommostElement:   null,
		currentMousePos:     { x: 0, y: 0 },
		isProcessing:        false
	};
	const hoverTracker = SFE.hoverTracker;

	// Shared context - lets utility modules read live closure state without
	// needing the full closure. Getters/setters keep reads always current.
	SFE.Context = {
		get activeEditor()  { return activeEditor; },
		set activeEditor(v) {
			activeEditor = v;
			if (v) {
				document.body.classList.add('mwp-sfe-is-editing');
			} else {
				document.body.classList.remove('mwp-sfe-is-editing');
				// If the editor was closed while active-preview was on, reset cleanly.
				// Use rAF so closeInPlaceEditor's full call-stack finishes first.
				if (document.body.classList.contains('mwp-sfe-active-preview')) {
					requestAnimationFrame(() => {
						if (!activeEditor) {
							document.body.classList.remove('mwp-sfe-active-preview');
							isInlineUIEnabled = true;
							SFE.ModeToggleBar.update();
						}
					});
				}
			}
		},
		get activeMode()         { return activeMode; },
		set activeMode(v)        { activeMode = v; },
		get draftEditState()     { return draftEditState; },
		set draftEditState(v)    { draftEditState = v; },
		get isInlineUIEnabled()  { return isInlineUIEnabled; },
		set isInlineUIEnabled(v) { isInlineUIEnabled = !!v; },
		get isSaving()           { return isSaving; },
		set isSaving(v)          { isSaving = !!v; },
		get pageRevisionToken()  { return pageRevisionToken; },
		set pageRevisionToken(v) { pageRevisionToken = v; },
		disabledElements,
		uuidMap,
		sortHandlersByPriority,
		hoverTracker,
		// actionBar and buttonManager are set below after their init lines
	};

	// Import external classes
	const ElementPrep      = SFE.ElementPrep;
	const ListBlockTracker = SFE.ListBlockTracker;
	const ButtonManager    = SFE.ButtonManager;

	// Track active editor globally within this closure
	let activeEditor      = null;
	let activeMode        = null; // 'edit', 'comment', or 'draft'
	let draftEditState    = null; // Track draft editing: { originalElement, bar, handlers, version }
	let isInlineUIEnabled = true;
	let isSaving          = false;

	const persistedBlockSessions = new Map();

	// Helper to sort handlers by priority
	function sortHandlersByPriority(list) {
		return list.slice().sort((a, b) => {
			const pa = Number.isFinite(a.priority) ? a.priority : 100;
			const pb = Number.isFinite(b.priority) ? b.priority : 100;
			return pa - pb;
		});
	}

	function resolveEditorStrategy(element, handler, requestedMode = 'edit') {
		let strategy = 'single';
		if (
			requestedMode === 'edit' &&
			handler &&
			handler.capability === 'edit' &&
			batchEditManager &&
			typeof batchEditManager.isEnabled === 'function' &&
			batchEditManager.isEnabled()
		) {
			strategy = 'batch';
		}

		if (typeof SFE.ResolveEditorStrategy === 'function') {
			try {
				const override = SFE.ResolveEditorStrategy({
					strategy,
					element,
					handler,
					mode: requestedMode
				});
				if (override === 'single' || override === 'batch') {
					strategy = override;
				}
			} catch (error) {
				console.warn('FrontEdit: resolve editor strategy hook failed', error);
			}
		}

		return strategy;
	}

	function resolveSchemaEditingRuntime(element, handler, requestedMode = 'edit') {
		// Draft editing should use the exact same schema runtime path as normal editing.
		if (requestedMode !== 'edit' && requestedMode !== 'draft') return null;

		const schemaRuntime = SFE.SchemaRuntime;
		if (!schemaRuntime || typeof schemaRuntime.resolveForEditing !== 'function') {
			return null;
		}

		try {
			const resolved = schemaRuntime.resolveForEditing(element, handler);
			if (resolved && resolved.runtimeHandler) {
				return resolved;
			}
		} catch (error) {
			console.warn('FrontEdit: schema runtime resolution failed', error);
		}

		return null;
	}

	/**
	 * Summarize the schema component mix declared by the active handler.
	 *
	 * This keeps editor dispatch derived from schema component definitions instead
	 * of legacy handler metadata such as container/media tags.
	 *
	 * @param {object|null} handler Active schema-backed handler.
	 * @returns {{total:number,textCount:number,fileCount:number}} Component mix summary.
	 */
	function summarizeSchemaComponents(handler) {
		const components = Array.isArray(handler?.client_config?.editableComponents)
			? handler.client_config.editableComponents
			: [];
		let textCount = 0;
		let fileCount = 0;

		components.forEach(component => {
			const type = typeof component?.type === 'string'
				? component.type.trim().toLowerCase()
				: '';
			if (type === 'file') {
				fileCount++;
				return;
			}
			textCount++;
		});

		return {
			total: components.length,
			textCount,
			fileCount,
		};
	}

	/**
	 * Create one block-scoped edit session for the active editor.
	 *
	 * @param {string} uuid Stable block UUID.
	 * @returns {Object|null} Block edit session instance.
	 */
	function createBlockSession(uuid) {
		if (typeof SFE.createBlockEditSession !== 'function') {
			return null;
		}

		return SFE.createBlockEditSession({
			uuid,
		});
	}

	/**
	 * Capture the original-open restore snapshots for one block edit session.
	 *
	 * These snapshots belong to the lifetime of the block session, not to one
	 * specific editor instance, so cancel can still restore the first-open state
	 * even after the user switches away and later reopens the same UUID.
	 *
	 * @param {Element} element     Live block element being opened.
	 * @param {Object}  handler     Active runtime handler.
	 * @param {Object}  openOptions Optional open-time overrides.
	 * @returns {Object} Session-original snapshot bundle.
	 */
	function buildPersistedSessionOriginalSnapshots(element, handler, openOptions = null) {
		return {
			restoreOuterHTML: String(openOptions?.originalSnapshots?.restoreOuterHTML || '').trim() || element.outerHTML,
			cleanOuterHTML:   String(openOptions?.originalSnapshots?.cleanOuterHTML || '').trim() || ElementPrep.getCleanHTML(element, true),
			content:          ElementPrep.getContent(element, handler?.contentType),
			cleanHTML:        ElementPrep.getCleanHTML(element),
			classes:          element.className,
			styles:           element.getAttribute('style') || '',
		};
	}

	/**
	 * Capture the baseline state for one specific editor-open pass.
	 *
	 * Unlike the persisted session origin, this baseline is refreshed on every
	 * reopen so cancel/escape/outside-click can roll back only the changes made
	 * during the current open pass.
	 *
	 * @param {Element} element     Live block element being opened.
	 * @param {Object}  handler     Active runtime handler.
	 * @param {Object}  openOptions Optional open-time overrides.
	 * @returns {Object} Per-open baseline snapshot bundle.
	 */
	function buildOpenPassBaselineSnapshots(element, handler, openOptions = null) {
		return buildPersistedSessionOriginalSnapshots(element, handler, openOptions);
	}

	/**
	 * Return the persisted block-session record for one UUID, creating it on the
	 * first open of that block during the current page lifecycle.
	 *
	 * @param {Object} config Session config.
	 * @param {string} config.uuid Stable block UUID.
	 * @param {Element} config.element Live block element.
	 * @param {Object} config.handler Active runtime handler.
	 * @param {Object} config.openOptions Optional open-time overrides.
	 * @returns {Object} Persisted session record.
	 */
	function getOrCreatePersistedBlockSessionRecord(config = {}) {
		const uuid = String(config.uuid || '').trim();
		if (!uuid) {
			return {
				uuid: '',
				blockEditSession: createBlockSession(''),
				sessionOriginSnapshots: buildPersistedSessionOriginalSnapshots(
					config.element,
					config.handler,
					config.openOptions || null
				),
				openPassBaselineSnapshots: null,
				openPassCheckpoint: null,
			};
		}

		let record = persistedBlockSessions.get(uuid) || null;
		if (record) {
			return record;
		}

		record = {
			uuid,
			blockEditSession: createBlockSession(uuid),
			sessionOriginSnapshots: buildPersistedSessionOriginalSnapshots(
				config.element,
				config.handler,
				config.openOptions || null
			),
			openPassBaselineSnapshots: null,
			openPassCheckpoint: null,
		};
		persistedBlockSessions.set(uuid, record);
		return record;
	}

	/**
	 * Refresh the per-open baseline metadata for one persisted block session.
	 *
	 * @param {Object} config Open-pass config.
	 * @param {Object} config.record Persisted session record.
	 * @param {Element} config.element Live block element.
	 * @param {Object} config.handler Active runtime handler.
	 * @param {Object} config.openOptions Optional open-time overrides.
	 * @returns {Object} Updated persisted session record.
	 */
	function preparePersistedBlockSessionOpenPass(config = {}) {
		const record = config.record || null;
		if (!record || typeof record !== 'object') {
			return record;
		}

		record.openPassBaselineSnapshots = buildOpenPassBaselineSnapshots(
			config.element,
			config.handler,
			config.openOptions || null
		);
		record.openPassCheckpoint = record.blockEditSession &&
			typeof record.blockEditSession.createHistoryCheckpoint === 'function'
			? record.blockEditSession.createHistoryCheckpoint()
			: {
				historyIndex: -1,
				entry: null,
				isSessionOrigin: true,
			};

		return record;
	}

	/**
	 * Detach one live editor instance from its persisted block session.
	 *
	 * The session record remains cached so history can survive block switches, but
	 * the dead editorState reference is cleared to avoid retaining DOM nodes.
	 *
	 * @param {Object|null} editorState Editor state being closed.
	 * @returns {void}
	 */
	function detachPersistedBlockSessionEditor(editorState) {
		const blockEditSession = editorState?.blockEditSession || null;
		if (blockEditSession && typeof blockEditSession.syncEditorState === 'function') {
			blockEditSession.syncEditorState(null);
		}
	}

	/**
	 * Return the persisted block session record for one UUID.
	 *
	 * @param {string} uuid Stable block UUID.
	 * @returns {Object|null} Persisted record or null.
	 */
	function getPersistedBlockSessionRecord(uuid) {
		const normalizedUuid = String(uuid || '').trim();
		if (!normalizedUuid) {
			return null;
		}

		return persistedBlockSessions.get(normalizedUuid) || null;
	}

	/**
	 * Revert one persisted block session back to the baseline captured when the
	 * current editor-open pass began.
	 *
	 * Returns whether that checkpoint was also the session origin. Callers can use
	 * this to destroy the whole cached session only when the user canceled all the
	 * way back to the first session baseline.
	 *
	 * @param {string} uuid Stable block UUID.
	 * @returns {boolean} Whether the checkpoint was the session origin.
	 */
	function revertPersistedBlockSessionToOpenPass(uuid) {
		const record = getPersistedBlockSessionRecord(uuid);
		if (!record) {
			return true;
		}

		const checkpoint = record.openPassCheckpoint || null;
		if (
			record.blockEditSession &&
			typeof record.blockEditSession.restoreHistoryCheckpoint === 'function'
		) {
			record.blockEditSession.restoreHistoryCheckpoint(checkpoint);
		}

		record.openPassCheckpoint = null;
		record.openPassBaselineSnapshots = null;
		return checkpoint?.isSessionOrigin !== false;
	}

	/**
	 * Destroy one persisted block session record.
	 *
	 * @param {string} uuid Stable block UUID.
	 * @returns {void}
	 */
	function destroyPersistedBlockSession(uuid) {
		const normalizedUuid = String(uuid || '').trim();
		if (!normalizedUuid) {
			return;
		}

		const record = persistedBlockSessions.get(normalizedUuid) || null;
		if (!record) {
			return;
		}

		if (record.blockEditSession && typeof record.blockEditSession.syncEditorState === 'function') {
			record.blockEditSession.syncEditorState(null);
		}
		persistedBlockSessions.delete(normalizedUuid);
	}

	/**
	 * Destroy multiple persisted block session records.
	 *
	 * @param {string[]} uuids Target UUIDs.
	 * @returns {void}
	 */
	function destroyPersistedBlockSessions(uuids) {
		if (!Array.isArray(uuids)) {
			return;
		}

		uuids.forEach((uuid) => {
			destroyPersistedBlockSession(uuid);
		});
	}

	/**
	 * Persist the block's published baseline the first time it enters an edit
	 * session during the current page lifecycle.
	 *
	 * This baseline is separate from the per-editor original* snapshots used for
	 * cancel/escape restoration. Draft submission restores to this cached live
	 * state so repeated local edits do not overwrite the post-submit view.
	 *
	 * @param {string}  uuid     Block UUID.
	 * @param {Element} element  Live block element being opened for editing.
	 * @returns {void}
	 */
	function cacheInitialPublishedBaseline(uuid, element) {
		if (!uuid || !element || !SFE.Context?.uuidMap?.[uuid]) return;
		const uuidEntry = SFE.Context.uuidMap[uuid];
		if (typeof uuidEntry.publishedBaselineOuterHTML === 'string' && uuidEntry.publishedBaselineOuterHTML.trim()) {
			return;
		}

		uuidEntry.publishedBaselineOuterHTML = element.outerHTML;
	}

	// Get all applicable handlers for an element
	function getApplicableHandlers(element, uuid) {
		let applicableHandlers = [];
		
		// If it has a server UUID, get handlers from the uuidMap
		if (uuid && uuidMap[uuid]) {
			uuidMap[uuid].handlers.forEach(handlerId => {
				const handler = handlers.find(h => h.id === handlerId);
				if (handler) applicableHandlers.push(handler);
			});
		}

		return sortHandlersByPriority(applicableHandlers);
	}

	// Comment mode - see managers/CommentManager.js
	const { startCommenting, exitCommentMode } = SFE.CommentManager;

	// Draft mode - pro file may be absent in free package; use core fallback object.
	const draftManager = SFE.DraftManager || {
		loadPendingDraft:  () => {},
		editPendingDraft:  () => {},
		closeDraftPreview: () => {}
	};
	const { loadPendingDraft, editPendingDraft, closeDraftPreview } = draftManager;

	// Save manager - see managers/SaveManager.js
	const { handleInlineSave, showInlineSuccess } = SFE.SaveManager;

	// Hover manager - see managers/HoverManager.js
	const { attachActionBarToElement, findOverlappingGroup } = SFE.HoverManager;

	// Batch manager - see managers/BatchEditManager.js
	const batchEditManager = SFE.BatchEditManager || null;

	// Client UUID generator - see utils/uuid.js
	const generateClientUuid = SFE.GenerateClientUuid;

	// Position manager - see utils/position-manager.js
	const { positionFloatingElements, debouncedPosition } = SFE.PositionManager;

	// Focus manager - see utils/focus-manager.js
	const { createFocusManager, setupFocusManagement } = SFE.FocusManager;

	// Block serializer - see utils/block-serializer.js
	const { buildBlockPayload, phpBlocksToWPBlocks, wpBlocksToPHPBlocks } = SFE.BlockSerializer;

	// API utilities - see utils/api.js
	const { apiCall, hydrateEditorBlockStateOnOpen } = SFE.Api;

	// Element state helpers - see utils/element-state.js
	const { ElementState, attachEventListener, removeEventListener } = SFE.ElementState;

	// Close editor and restore element - see editors/EditorLifecycle.js
	const closeInPlaceEditor = SFE.EditorLifecycle.closeInPlaceEditor;

	// Editor lifecycle helpers - see editors/EditorLifecycle.js
	const { cleanupEditorResources, restoreElementState, restoreElementContent, resetActionBar } = SFE.EditorLifecycle;

	// Text editor - see editors/TextEditor.js
	const { startTextEditing, startMultiComponentEditing } = SFE.TextEditor;

	// Media editor - see editors/MediaEditor.js
	const startMediaEditing = SFE.MediaEditor.startMediaEditing;

	// Initialize ActionBar with dependencies
	const actionBar = new SFE.ActionBar({
		TIMING,
		perms,
		postId,
		restBase,
		apiCall,
		getApplicableHandlers,
		positionFloatingElements,
		debouncedPosition,
		ElementState,
		ElementPrep: SFE.ElementPrep,
		attachEventListener,
		removeEventListener
	});

	// Initialize ButtonManager with dependencies
	const buttonManager = new ButtonManager({
		perms,
		handleInlineSave:   null,
		closeInPlaceEditor: null,
		editPendingDraft:   null,
		closeDraftPreview:  null
	});

	// Expose instances so modules can reference them
	SFE.Context.actionBar             = actionBar;
	SFE.Context.buttonManager         = buttonManager;
	SFE.Context.batchEditManager      = batchEditManager;
	SFE.Context.resolveEditorStrategy = resolveEditorStrategy;

	/**
	 * Handle DOM element replacement (Tag swaps like H2 -> H3)
	 */
	document.addEventListener('mwp-sfe-element-replaced', function(e) {
		const { oldElement, newElement, editorHost } = e.detail;

		if (!activeEditor) return;

		// Handle NESTED element replacement (e.g. nested OL→UL swap within the
		// root list). activeEditor.element is the root, so the root-check below
		// won't match - but we still need to rebuild the tracker so UUID mappings
		// don't point at detached elements.
		if (activeEditor.element !== oldElement) {
			if (activeEditor.listTracker &&
				activeEditor.listTracker.listElement &&
				activeEditor.listTracker.listElement !== oldElement &&
				activeEditor.listTracker.listElement.contains(oldElement)) {
				activeEditor.listTracker.uuidMap.clear();
				ListBlockTracker.buildFromDOM(
					activeEditor.listTracker,
					activeEditor.listTracker.listElement,
					activeEditor.listTracker.originalBlock
				);
			}
			return;
		}

		// Update our tracking references
		activeEditor.element    = newElement;
		actionBar.activeElement = newElement;

		// Re-stamp editor classes - the new element from a tag swap starts bare.
		newElement.classList.add('mwp-sfe-element-active', 'mwp-sfe-editing-active', 'mwp-sfe-inline-editor');
		newElement.dataset.mwpSfeBound = '1';

		// Update overlay to track new element
		if (overlayManager && overlayManager.activeTarget === oldElement) {
			overlayManager.updateActiveElement(newElement);
		}

		// Also update draft state if we're editing a draft
		if (draftEditState && draftEditState.draftElement === oldElement) {
			draftEditState.draftElement = newElement;
		}

		// Update list tracker if the replaced element is a list
		if (activeEditor.listTracker && activeEditor.listTracker.listElement === oldElement) {
			// Rebuild UUID map for the new element structure
			// (buildFromDOM also updates tracker.listElement internally)
			activeEditor.listTracker.uuidMap.clear();
			ListBlockTracker.buildFromDOM(activeEditor.listTracker, newElement, activeEditor.listTracker.originalBlock);
			// Keep the element-level back-reference in sync
			newElement._mwpListTracker = activeEditor.listTracker;
		}

		// Pass the container to the new editor instance
		if (editorHost) {
			editorHost.options.toolbarContainer = activeEditor.toolbarContainer;
			// Re-run creation to ensure it moves into our floating bar
			editorHost.createToolbar();
		}

		// Re-anchor the Save/Cancel bar
		if (activeEditor.actionsContainer) {
			activeEditor.actionsContainer._targetElement = newElement;
		}

		// Update ResizeObserver and positioning handlers for new element
		if (activeEditor.resizeObserver) {
			activeEditor.resizeObserver.disconnect();
			const newUpdatePositions = () => debouncedPosition(
				activeEditor.element || null,
				activeEditor.toolbarContainer,
				activeEditor.actionsContainer
			);
			
			// Remove old listeners
			if (activeEditor.updatePositions) {
				window.removeEventListener('scroll', activeEditor.updatePositions, true);
			}
			
			// Add new listeners with updated function
			window.addEventListener('scroll', newUpdatePositions, true);
			activeEditor.updatePositions = newUpdatePositions;
			
			// Create new ResizeObserver
			activeEditor.resizeObserver = new ResizeObserver(newUpdatePositions);
			activeEditor.resizeObserver.observe(newElement);
			activeEditor._mwpObservedEditorElement = newElement;
		}

		// RESTART FOCUS MANAGEMENT
		// The old focus manager is watching the old DOM node. We must kill it
		// and start a new one that watches the newElement.
		if (activeEditor.cleanupFocus) {
			activeEditor.cleanupFocus();
		}
		// Re-initialize with the updated activeEditor state
		activeEditor.cleanupFocus = setupFocusManagement(activeEditor);

		// Position immediately (after browser paint)
		requestAnimationFrame(() => {
			positionFloatingElements(
				newElement, 
				activeEditor.toolbarContainer, 
				activeEditor.actionsContainer
			);
		});
	});

	/**
	 * Close any active mode (edit/comment/draft) before starting a new one
	 */
	SFE.closeAnyActiveMode = function closeAnyActiveMode() {
		if (activeEditor) {
			closeInPlaceEditor(activeEditor, true);
			return true;
		}
		
		// Check for orphaned comment/draft modes (shouldn't happen, but safety net)
		const activeElements = document.querySelectorAll('.mwp-sfe-element-active');
		activeElements.forEach(el => {
			const uuid     = el.dataset.mwpSfeUuid;
			const handlers = getApplicableHandlers(el, uuid);
			
			if (el.classList.contains('mwp-sfe-commenting-active')) {
				const bar = actionBar.getOrCreate();
				exitCommentMode(bar, el, uuid);
			} else if (el.classList.contains('mwp-sfe-draft-active')) {
				const bar = actionBar.getOrCreate();
				closeDraftPreview(bar, el, uuid);
			}
		});
		
		activeMode = null;
		return false;
	}

	async function openEditorInternal(element, handler, uuid, clickEvent = null, skipClose = false, requestedMode = 'edit', saveStrategy = 'single', runtimeResolution = null, openOptions = null) {
		const isPending = element.classList.contains('mwp-sfe-status-pending');

		// Comment-only users never receive pending-draft state. This guard keeps
		// a direct runtime call from opening a draft when no edit access exists.
		if (isPending && !canAccessDrafts) {
			return;
		}

		// Common pre-setup: Close any active mode first (unless transitioning from draft preview)
		if (!skipClose) {
			SFE.closeAnyActiveMode();
		}
		
		if (isPending) {
			const bar = actionBar.getOrCreate();
			loadPendingDraft(bar, element, uuid, getApplicableHandlers(element, uuid));
			return;
		}

		// GET ALL APPLICABLE HANDLERS
		const allHandlers = getApplicableHandlers(element, uuid);
		cacheInitialPublishedBaseline(uuid, element);
		
		// Get the existing action bar
		const actionsContainer          = actionBar.getOrCreate();
		actionBar.activeElement         = element;
		actionsContainer._targetElement = element;

		// Mark element as active FIRST
		if (requestedMode === 'draft') {
			ElementState.markActive(element, 'draft-editing');
		} else {
			ElementState.markActive(element, 'editing');
		}

		// Switch buttons to "Edit" state
		actionBar.updateState({
			bar:     actionsContainer,
			element,
			state:   'edit',
			content: buttonManager.getEditButtons()
		});

		const resolvedSchemaRuntime = runtimeResolution || resolveSchemaEditingRuntime(element, handler, requestedMode);
		const activeHandler         = resolvedSchemaRuntime?.runtimeHandler || handler;

		const persistedSessionRecord = getOrCreatePersistedBlockSessionRecord({
			uuid,
			element,
			handler: activeHandler,
			openOptions,
		});
		preparePersistedBlockSessionOpenPass({
			record:  persistedSessionRecord,
			element,
			handler: activeHandler,
			openOptions,
		});
		const openPassBaselineSnapshots = persistedSessionRecord.openPassBaselineSnapshots || persistedSessionRecord.sessionOriginSnapshots;

		// Build common state object
		const commonState = {
			element,
			actionsContainer,
			// Lossless DOM snapshot used only for cancel/escape restoration.
			// Keep this raw so table markup (including empty cells) is restored exactly.
			originalRestoreOuterHTML: openPassBaselineSnapshots.restoreOuterHTML,
			originalOuterHTML:        String(openPassBaselineSnapshots.cleanOuterHTML || '').trim() || ElementPrep.getCleanHTML(element, true), // Keep UUID for restoration
			originalContent:          openPassBaselineSnapshots.content,
			originalHTML:             openPassBaselineSnapshots.cleanHTML,
			originalClasses:          openPassBaselineSnapshots.classes,
			originalStyles:           openPassBaselineSnapshots.styles,
			handler:                  activeHandler,
			allHandlers,
			uuid,
			requestedMode,
			initialComponentId: String(openOptions?.initialComponentId || '').trim(),
			openSource: String(openOptions?.source || 'sfe').trim() || 'sfe',
			isPreviewMode:     false,
			saveStrategy,
			// Initialize with empty - will be populated async
			originalAttributes: {},
			blockName: '',
			toolbarContainer: null,
			blockEditSession: persistedSessionRecord.blockEditSession
		};

		const componentSummary = summarizeSchemaComponents(activeHandler);

		// Call content-type-specific setup (opens editor immediately)
		let editorState;
		if (componentSummary.total > 0 && componentSummary.textCount > 0) {
			editorState              = startMultiComponentEditing(commonState, clickEvent);
			SFE.Context.activeEditor = editorState;
			SFE.activeEditorInstance = activeEditor;

		} else if (componentSummary.total > 0 && componentSummary.fileCount > 0) {
			editorState              = startMediaEditing(commonState);
			SFE.Context.activeEditor = editorState;
			SFE.activeEditorInstance = activeEditor;

		} else if (activeHandler.contentType === 'text') {
			editorState              = startTextEditing(commonState, clickEvent);
			SFE.Context.activeEditor = editorState;
			SFE.activeEditorInstance = activeEditor;
		}

		if (editorState && resolvedSchemaRuntime?.runtime) {
			editorState._mwpSchemaRuntime   = resolvedSchemaRuntime.runtime;
			editorState._mwpSchemaHandlerId = resolvedSchemaRuntime.schema?.handlerId || activeHandler.id || '';
		}

		if (
			editorState &&
			typeof hydrateEditorBlockStateOnOpen === 'function'
		) {
			hydrateEditorBlockStateOnOpen(editorState);
		}

		if (editorState?.blockEditSession && typeof editorState.blockEditSession.syncEditorState === 'function') {
			editorState.blockEditSession.syncEditorState(editorState);
		}

		// clear mode
		SFE.Context.activeMode = null;

		if (editorState && SFE.PublicApiBridge) {
			SFE.PublicApiBridge.emitEditorEvent('editor:opened', editorState, {
				source: String(commonState.openSource || 'sfe').trim() || 'sfe',
			});
		}

		return editorState;
	}

	SFE.startEditing = async function startEditing(element, handler, uuid, clickEvent = null, skipClose = false, requestedMode = 'edit', openOptions = null) {
		const canPublish = SFE.ManagerData?.permissions?.can_publish === true;
		const lockClaim = requestedMode === 'edit' && canPublish && SFE.PostLockManager
			? SFE.PostLockManager.beginLockClaim()
			: null;
		const strategy = resolveEditorStrategy(element, handler, requestedMode);
		let editorState;
		if (
			strategy === 'batch' &&
			batchEditManager &&
			typeof batchEditManager.startOrSwitchEditing === 'function'
		) {
			editorState = await batchEditManager.startOrSwitchEditing({
				element,
				handler,
				uuid,
				clickEvent,
				openEditorInternal,
				openOptions
			});
		} else {
			editorState = await openEditorInternal(element, handler, uuid, clickEvent, skipClose, requestedMode, strategy, null, openOptions);
		}

		if (lockClaim && editorState) {
			lockClaim.then((hasLock) => {
				if (!hasLock && SFE.Context.activeEditor === editorState) {
					closeInPlaceEditor(editorState, true, { closeReason: 'post-lock-denied' });
				}
			});
		}

		return editorState;
	};

	// Wire up ButtonManager dependencies
	buttonManager.handleInlineSave   = handleInlineSave;
	buttonManager.closeInPlaceEditor = closeInPlaceEditor;
	buttonManager.editPendingDraft   = editPendingDraft;
	buttonManager.closeDraftPreview  = closeDraftPreview;

	// Make functions globally accessible
	SFE.attachActionBarToElement   = attachActionBarToElement;
	SFE.findOverlappingGroup       = findOverlappingGroup;
	SFE.startCommenting            = startCommenting;
	SFE.exitCommentMode            = exitCommentMode;
	SFE.loadPendingDraft           = loadPendingDraft;
	SFE.editPendingDraft           = editPendingDraft;
	SFE.closeDraftPreview          = closeDraftPreview;
	SFE.showInlineSuccess          = showInlineSuccess;
	SFE.handleInlineSave           = handleInlineSave;
	SFE.closeInPlaceEditor         = closeInPlaceEditor;
	SFE.startMediaEditing          = startMediaEditing;
	SFE.SetInlineUIEnabled         = SFE.ModeToggleBar.setInlineUIEnabled;
	SFE.Context.setInlineUIEnabled = SFE.ModeToggleBar.setInlineUIEnabled;

	SFE.detachPersistedBlockEditSessionEditor     = detachPersistedBlockSessionEditor;
	SFE.getPersistedBlockEditSessionRecord        = getPersistedBlockSessionRecord;
	SFE.revertPersistedBlockEditSessionToOpenPass = revertPersistedBlockSessionToOpenPass;
	SFE.destroyPersistedBlockEditSession          = destroyPersistedBlockSession;
	SFE.destroyPersistedBlockEditSessions         = destroyPersistedBlockSessions;

	/**
	 * Initialize all elements on page load
	 */
	function initializeAllElements() {
		// Initialize overlay manager
		if (overlayManager) {
			overlayManager.init();
		}

		SFE.ModeToggleBar.init();
		
		const targetElements = document.querySelectorAll('[data-mwp-sfe-uuid]');
		if (!targetElements.length) return;

		targetElements.forEach(node => {
			if (node.dataset.mwpSfeBound) return;

			// SKIP nested lists - check if this list is inside another list
			if (node.tagName === 'OL' || node.tagName === 'UL') {
				const parentList = node.closest('li');
				if (parentList) {
					return; // This is a nested list, skip it
				}
			}

			let uuid = node.dataset.mwpSfeUuid;
			let applicableHandlers = [];

			// Get handlers from uuidMap
			if (uuid && uuidMap[uuid]) {
				if (canAccessDrafts && uuidMap[uuid].is_pending) {
					node.classList.add('mwp-sfe-status-pending');
				}

				uuidMap[uuid].handlers.forEach(handlerId => {
					const handler = handlers.find(h => h.id === handlerId);
					if (handler) applicableHandlers.push(handler);
				});
			}

			if (!applicableHandlers.length) return;

			if (!uuid) {
				uuid = generateClientUuid(postId, node.tagName.toLowerCase(), node);
				node.dataset.mwpSfeUuid = uuid;
			}

			// Attach action bar
			attachActionBarToElement(node);
		});
	}

	// Run immediately if DOM is ready, otherwise wait
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializeAllElements);
	} else {
		initializeAllElements();
	}

})();
