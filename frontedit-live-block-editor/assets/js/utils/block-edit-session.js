/**
 * Block edit session state and undo/redo ownership.
 *
 * Exposes: SFE.BlockEditSession, SFE.createBlockEditSession
 */
(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Return one JSON-safe clone of plain snapshot data.
	 *
	 * @param {*} value Snapshot value.
	 * @returns {*} Cloned value.
	 */
	function cloneSnapshotValue(value) {
		if (value === undefined) {
			return undefined;
		}

		if (value === null || typeof value !== 'object') {
			return value;
		}

		if (Array.isArray(value)) {
			return value.map((entry) => cloneSnapshotValue(entry));
		}

		const clone = {};
		Object.keys(value).forEach((key) => {
			clone[key] = cloneSnapshotValue(value[key]);
		});
		return clone;
	}

	/**
	 * Return whether two session history entries are equivalent.
	 *
	 * @param {Object|null} left  First entry.
	 * @param {Object|null} right Second entry.
	 * @returns {boolean} Whether the entries match.
	 */
	function areEntriesEquivalent(left, right) {
		if (!left || !right) {
			return false;
		}

		if (String(left.scopeId || '') !== String(right.scopeId || '')) {
			return false;
		}

		try {
			return JSON.stringify(left.snapshot) === JSON.stringify(right.snapshot);
		} catch (error) {
			return false;
		}
	}

	/**
	 * Shared block-scoped edit session.
	 */
	class BlockEditSession {
		/**
		 * Create one block edit session.
		 *
		 * @param {Object} options Session options.
		 */
		constructor(options = {}) {
			this.uuid = String(options.uuid || '').trim();
			this.maxHistory = Number.isInteger(options.maxHistory) ? options.maxHistory : 50;
			this.editorState = null;
			this.history = [];
			this.historyIndex = -1;
			this.isRestoring = false;
			this.activeScopeId = '';
			this.scopes = new Map();
			this.historyApis = new Map();
		}

		/**
		 * Attach or refresh the live editor state reference.
		 *
		 * @param {Object|null} editorState Active editor state.
		 * @returns {void}
		 */
		syncEditorState(editorState) {
			this.editorState = editorState || null;
			if (this.editorState && this.editorState.blockEditSession !== this) {
				this.editorState.blockEditSession = this;
			}
			if (this.editorState && typeof this.editorState.getSessionHistoryApi !== 'function') {
				this.editorState.getSessionHistoryApi = (scopeId = null) => this.getHistoryApi(scopeId);
			}
			if (this.editorState && (!this.editorState.historyApis || typeof this.editorState.historyApis !== 'object')) {
				this.editorState.historyApis = {};
			}
		}

		/**
		 * Register one history scope descriptor.
		 *
		 * @param {string} scopeId    Stable scope identifier.
		 * @param {Object} descriptor Scope descriptor.
		 * @returns {string} Normalized scope identifier.
		 */
		registerScope(scopeId, descriptor = {}) {
			const normalizedScopeId = String(scopeId || '').trim() || 'default';
			const previous = this.scopes.get(normalizedScopeId) || {};

			this.scopes.set(normalizedScopeId, {
				...previous,
				...descriptor,
				scopeId: normalizedScopeId,
				host: Object.prototype.hasOwnProperty.call(descriptor, 'host')
					? descriptor.host
					: (previous.host || null),
			});

			if (!this.activeScopeId) {
				this.activeScopeId = normalizedScopeId;
			}

			return normalizedScopeId;
		}

		/**
		 * Register one live host against a session scope.
		 *
		 * @param {Object} host       Live editor or toolbar host.
		 * @param {Object} descriptor Scope descriptor additions.
		 * @returns {string} Scope identifier.
		 */
		registerHost(host, descriptor = {}) {
			const scopeId = this.registerScope(descriptor.scopeId, {
				...descriptor,
				host,
			});
			if (
				host &&
				typeof host === 'object' &&
				descriptor.attachHistoryApi === true
			) {
				this.attachHistoryApi(host, scopeId);
			}
			this.activateScope(scopeId);
			return scopeId;
		}

		/**
		 * Register one snapshot-driven history host with session-owned plumbing.
		 *
		 * Editors should describe how to capture and restore their block/session
		 * snapshots, while the shared session owns the common registration shape,
		 * editor-state syncing, and optional initial-history seeding.
		 *
		 * @param {Object} host   Live editor or toolbar host.
		 * @param {Object} config Snapshot registration config.
		 * @returns {string} Scope identifier.
		 */
		registerSnapshotHost(host, config = {}) {
			if (config?.editorState) {
				this.syncEditorState(config.editorState);
			}

			const descriptor = {
				scopeId: config.scopeId,
				attachHistoryApi: config.attachHistoryApi === true,
				capture: ({ host: activeHost, session, editorState, scopeId }) => (
					typeof config.captureSnapshot === 'function'
						? config.captureSnapshot({
							host: activeHost,
							session,
							editorState,
							scopeId,
						})
						: null
				),
				captureSelection: ({ host: activeHost, session, editorState, scopeId }) => (
					typeof config.captureSelection === 'function'
						? config.captureSelection({
							host: activeHost,
							session,
							editorState,
							scopeId,
						})
						: null
				),
				restore: ({ host: activeHost, session, editorState, scopeId, snapshot, preferredSelection, entrySelection }) => {
					if (typeof config.restoreSnapshot !== 'function') {
						return false;
					}

					return config.restoreSnapshot({
						host: activeHost,
						session,
						editorState,
						scopeId,
						snapshot,
						preferredSelection,
						entrySelection,
						selectionToRestore: entrySelection != null
							? entrySelection
							: preferredSelection != null
								? preferredSelection
								: null,
					});
				},
			};

			if (typeof config.restoreSelection === 'function') {
				descriptor.restoreSelection = config.restoreSelection;
			}

			const scopeId = this.registerHost(host, descriptor);
			if (config.seedInitialHistory === true) {
				this.seedInitialHistory(scopeId);
			}
			return scopeId;
		}

		/**
		 * Return one session-owned history API for a specific scope.
		 *
		 * This gives non-editor modules one stable way to commit/undo/redo or
		 * refresh the initial baseline without reaching through MWPEditor as an
		 * implementation detail.
		 *
		 * @param {string|null} scopeId Scope identifier.
		 * @returns {Object} Session-backed history API.
		 */
		getHistoryApi(scopeId = null) {
			const normalizedScopeId = String(scopeId || this.activeScopeId || '').trim() || 'default';
			const existingApi = this.historyApis.get(normalizedScopeId) || null;
			if (existingApi) {
				return existingApi;
			}

			const historyApi = {
				blockEditSession: this,
				blockEditSessionScopeId: normalizedScopeId,
				saveToHistory: () => this.commit(normalizedScopeId),
				undo: () => this.undo(),
				redo: () => this.redo(),
				canUndo: () => this.canUndo(),
				canRedo: () => this.canRedo(),
				replaceInitialHistoryEntry: () => this.replaceInitialEntryFromCapture(normalizedScopeId),
				canReplaceInitialHistoryEntry: () => (
					this.history.length === 1 &&
					this.historyIndex === 0 &&
					!!this.getScope(normalizedScopeId)
				),
			};

			this.historyApis.set(normalizedScopeId, historyApi);
			if (this.editorState) {
				if (!this.editorState.historyApis || typeof this.editorState.historyApis !== 'object') {
					this.editorState.historyApis = {};
				}
				this.editorState.historyApis[normalizedScopeId] = historyApi;
				if (!this.editorState.historyApi || normalizedScopeId === 'text') {
					this.editorState.historyApi = historyApi;
				}
			}

			return historyApi;
		}

		/**
		 * Attach the session-owned history API to one lightweight host.
		 *
		 * This is useful for toolbar-style hosts that should expose the same
		 * `saveToHistory()` / `undo()` / `redo()` surface as MWPEditor without
		 * re-implementing session branching locally.
		 *
		 * @param {Object} host    Live history host.
		 * @param {string} scopeId Stable scope identifier.
		 * @returns {Object} Decorated host.
		 */
		attachHistoryApi(host, scopeId) {
			if (!host || typeof host !== 'object') {
				return host;
			}

			const historyApi = this.getHistoryApi(scopeId);
			host.blockEditSession = historyApi.blockEditSession;
			host.blockEditSessionScopeId = historyApi.blockEditSessionScopeId;
			host.historyApi = historyApi;
			host.getSessionHistoryApi = (requestedScopeId = null) => (
				requestedScopeId
					? this.getHistoryApi(requestedScopeId)
					: historyApi
			);
			host.saveToHistory = historyApi.saveToHistory;
			host.undo = historyApi.undo;
			host.redo = historyApi.redo;
			host.canUndo = historyApi.canUndo;
			host.canRedo = historyApi.canRedo;
			host.replaceInitialHistoryEntry = historyApi.replaceInitialHistoryEntry;
			host.canReplaceInitialHistoryEntry = historyApi.canReplaceInitialHistoryEntry;
			return host;
		}

		/**
		 * Replace the live editor root from one serialized snapshot.
		 *
		 * This preserves runtime/plugin classes and attributes that belong to the
		 * active session while swapping the persistent block markup back to a
		 * history entry snapshot.
		 *
		 * @param {Object} config Restore configuration.
		 * @returns {Object|null} Restore metadata, or null on failure.
		 */
		replaceEditorRootFromSnapshot(config = {}) {
			const elementPrep = SFE.ElementPrep || null;
			const ctx = SFE.Context || null;
			const editorState = config?.editorState || this.editorState || null;
			const rootOuterHTML = String(config?.rootOuterHTML || '').trim();
			if (!editorState?.element || !rootOuterHTML) {
				return null;
			}

			const previousRoot = editorState.element;
			const runtimeRootClasses = (
				elementPrep &&
				typeof elementPrep.getRuntimeClassNames === 'function'
			)
				? elementPrep.getRuntimeClassNames(previousRoot)
				: [];
			const runtimeRootAttrs = (
				elementPrep &&
				typeof elementPrep.getRuntimeAttributes === 'function'
			)
				? elementPrep.getRuntimeAttributes(previousRoot, { keepIdentity: true })
				: {};
			const toolbarHadNoTransition = !!editorState.toolbarContainer?.classList.contains('mwp-sfe-no-position-transition');
			const actionsHadNoTransition = !!editorState.actionsContainer?.classList.contains('mwp-sfe-no-position-transition');

			const temp = document.createElement('div');
			temp.innerHTML = rootOuterHTML;
			const restoredElement = temp.firstElementChild;
			if (!restoredElement || !previousRoot.parentNode) {
				return null;
			}

			previousRoot.parentNode.replaceChild(restoredElement, previousRoot);
			runtimeRootClasses.forEach((className) => {
				if (className) {
					restoredElement.classList.add(className);
				}
			});
			Object.entries(runtimeRootAttrs).forEach(([name, value]) => {
				if (name !== 'class') {
					restoredElement.setAttribute(name, value);
				}
			});
			editorState.element = restoredElement;
			if (
				ctx?.draftEditState &&
				ctx.draftEditState.draftElement === previousRoot
			) {
				ctx.draftEditState.draftElement = restoredElement;
			}

			return {
				previousRoot,
				restoredElement,
				toolbarHadNoTransition,
				actionsHadNoTransition,
			};
		}

		/**
		 * Re-apply generic editor chrome state after a block restore.
		 *
		 * @param {Object} config Finalization configuration.
		 * @returns {void}
		 */
		finalizeEditorRootRestore(config = {}) {
			const overlayManager = SFE.OverlayManager || null;
			const actionBar = SFE.Context?.actionBar || null;
			const editorState = config?.editorState || this.editorState || null;
			const restoredElement = config?.restoredElement || editorState?.element || null;
			const activeElement = config?.activeElement || null;
			if (!editorState || !restoredElement) {
				return;
			}

			if (overlayManager && activeElement) {
				overlayManager.updateActiveElement(activeElement);
			}

			if (actionBar && editorState.actionsContainer) {
				actionBar.activeElement = restoredElement;
				editorState.actionsContainer._targetElement = restoredElement;
				editorState.actionsContainer.classList.add('mwp-sfe-inline-editor');
				if (typeof actionBar._attachScrollListener === 'function') {
					actionBar._attachScrollListener(editorState.actionsContainer, restoredElement);
				}
			}

			if (config?.toolbarHadNoTransition && editorState.toolbarContainer) {
				editorState.toolbarContainer.classList.add('mwp-sfe-no-position-transition');
			}
			if (config?.actionsHadNoTransition && editorState.actionsContainer) {
				editorState.actionsContainer.classList.add('mwp-sfe-no-position-transition');
			}

			if (typeof editorState.updatePositions === 'function') {
				editorState.updatePositions();
			}
		}

		/**
		 * Restore one managed block snapshot through the shared session pipeline.
		 *
		 * The session owns the generic root-swap/finalize flow while editor-level
		 * modules provide block-specific callbacks for cleanup, component
		 * resolution, activation, and selection restoration.
		 *
		 * @param {Object} config Restore configuration.
		 * @returns {boolean} Whether restore succeeded.
		 */
		restoreManagedBlockSnapshot(config = {}) {
			const editorState = config?.editorState || this.editorState || null;
			const snapshot = config?.snapshot || null;
			const selection = config?.selection ?? null;
			const rootOuterHTML = String(snapshot?.rootOuterHTML || config?.rootOuterHTML || '').trim();
			if (!editorState?.element || !rootOuterHTML) {
				return false;
			}

			if (typeof config.beforeRestore === 'function') {
				config.beforeRestore({
					session: this,
					editorState,
					snapshot,
					selection,
				});
			}

			const restoredRoot = this.replaceEditorRootFromSnapshot({
				editorState,
				rootOuterHTML,
			});
			const restoredElement = restoredRoot?.restoredElement || null;
			if (!restoredElement) {
				return false;
			}

			if (typeof config.afterRootReplace === 'function') {
				const afterRootResult = config.afterRootReplace({
					session: this,
					editorState,
					snapshot,
					selection,
					restoredRoot,
					restoredElement,
				});
				if (afterRootResult === false) {
					return false;
				}
			}

			const activation = typeof config.resolveActivation === 'function'
				? config.resolveActivation({
					session: this,
					editorState,
					snapshot,
					selection,
					restoredRoot,
					restoredElement,
				})
				: {};
			if (activation === false) {
				return false;
			}

			const activationContext = (
				activation && typeof activation === 'object' && !Array.isArray(activation)
			)
				? activation
				: {};

			const activationResult = typeof config.activate === 'function'
				? config.activate({
					session: this,
					editorState,
					snapshot,
					selection,
					restoredRoot,
					restoredElement,
					activation: activationContext,
				})
				: {};
			if (activationResult === false) {
				return false;
			}

			const resolvedActivationResult = (
				activationResult && typeof activationResult === 'object' && !Array.isArray(activationResult)
			)
				? activationResult
				: {};

			if (selection != null && typeof config.restoreSelection === 'function') {
				const restoreSelectionResult = config.restoreSelection({
					session: this,
					editorState,
					snapshot,
					selection,
					restoredRoot,
					restoredElement,
					activation: activationContext,
					activationResult: resolvedActivationResult,
				});
				if (restoreSelectionResult === false) {
					return false;
				}
			}

			if (typeof config.afterActivate === 'function') {
				const afterActivateResult = config.afterActivate({
					session: this,
					editorState,
					snapshot,
					selection,
					restoredRoot,
					restoredElement,
					activation: activationContext,
					activationResult: resolvedActivationResult,
				});
				if (afterActivateResult === false) {
					return false;
				}
			}

			const activeElement = resolvedActivationResult.activeElement
				|| activationContext.activeElement
				|| null;
			this.finalizeEditorRootRestore({
				editorState,
				restoredElement,
				activeElement,
				toolbarHadNoTransition: !!restoredRoot?.toolbarHadNoTransition,
				actionsHadNoTransition: !!restoredRoot?.actionsHadNoTransition,
			});

			if (typeof config.afterFinalize === 'function') {
				config.afterFinalize({
					session: this,
					editorState,
					snapshot,
					selection,
					restoredRoot,
					restoredElement,
					activation: activationContext,
					activationResult: resolvedActivationResult,
					activeElement,
				});
			}

			return true;
		}

		/**
		 * Mark one scope as active.
		 *
		 * @param {string} scopeId Scope identifier.
		 * @returns {boolean} Whether activation succeeded.
		 */
		activateScope(scopeId) {
			const normalizedScopeId = String(scopeId || '').trim();
			if (!normalizedScopeId || !this.scopes.has(normalizedScopeId)) {
				return false;
			}

			this.activeScopeId = normalizedScopeId;
			return true;
		}

		/**
		 * Resolve one scope descriptor.
		 *
		 * @param {string|null} scopeId Scope identifier.
		 * @returns {Object|null} Scope descriptor.
		 */
		getScope(scopeId = null) {
			const normalizedScopeId = String(scopeId || this.activeScopeId || '').trim();
			if (!normalizedScopeId || !this.scopes.has(normalizedScopeId)) {
				return null;
			}

			return this.scopes.get(normalizedScopeId) || null;
		}

		/**
		 * Return whether one undo step is available.
		 *
		 * @returns {boolean} Whether the session can undo.
		 */
		canUndo() {
			return this.historyIndex > 0;
		}

		/**
		 * Return whether one redo step is available.
		 *
		 * @returns {boolean} Whether the session can redo.
		 */
		canRedo() {
			return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
		}

		/**
		 * Notify every live scope host that history availability changed.
		 *
		 * @returns {void}
		 */
		notifyHistoryChange() {
			this.scopes.forEach((descriptor) => {
				if (typeof descriptor?.host?.updateUndoRedoButtons === 'function') {
					descriptor.host.updateUndoRedoButtons();
				}
			});
		}

		/**
		 * Capture one history entry for the requested scope.
		 *
		 * @param {string|null} scopeId Scope identifier.
		 * @returns {Object|null} Captured history entry.
		 */
		captureEntry(scopeId = null) {
			const descriptor = this.getScope(scopeId);
			if (!descriptor || typeof descriptor.capture !== 'function') {
				return null;
			}
			this.activateScope(descriptor.scopeId);

			const snapshot = descriptor.capture({
				host: descriptor.host || null,
				session: this,
				editorState: this.editorState,
				scopeId: descriptor.scopeId,
			});
			if (!snapshot || typeof snapshot !== 'object') {
				return null;
			}

			const selection = typeof descriptor.captureSelection === 'function'
				? descriptor.captureSelection({
					host: descriptor.host || null,
					session: this,
					editorState: this.editorState,
					scopeId: descriptor.scopeId,
				})
				: null;

			return {
				scopeId: descriptor.scopeId,
				snapshot: cloneSnapshotValue(snapshot),
				selection: cloneSnapshotValue(selection),
			};
		}

		/**
		 * Seed the initial history entry for one scope.
		 *
		 * @param {string|null} scopeId Scope identifier.
		 * @returns {Object|null} Captured entry or current baseline.
		 */
		seedInitialHistory(scopeId = null) {
			if (this.history.length > 0) {
				return this.history[this.historyIndex] || null;
			}

			return this.commit(scopeId);
		}

		/**
		 * Commit one history entry from the requested scope.
		 *
		 * @param {string|null} scopeId Scope identifier.
		 * @returns {Object|null} Captured entry.
		 */
		commit(scopeId = null) {
			if (this.isRestoring) {
				return null;
			}

			const entry = this.captureEntry(scopeId);
			if (!entry) {
				return null;
			}

			const currentEntry = this.historyIndex >= 0
				? this.history[this.historyIndex]
				: null;
			if (areEntriesEquivalent(currentEntry, entry)) {
				if (currentEntry) {
					currentEntry.selection = cloneSnapshotValue(entry.selection);
				}
				this.notifyHistoryChange();
				return currentEntry;
			}

			this.history = this.history.slice(0, this.historyIndex + 1);
			this.history.push(entry);

			if (this.history.length > this.maxHistory) {
				this.history.shift();
			} else {
				this.historyIndex++;
			}

			this.notifyHistoryChange();
			return entry;
		}

		/**
		 * Replace the initial baseline entry in place.
		 *
		 * @param {string} scopeId   Scope identifier.
		 * @param {Object} snapshot  Replacement snapshot.
		 * @param {*}      selection Replacement selection snapshot.
		 * @returns {boolean} Whether replacement succeeded.
		 */
		replaceInitialEntry(scopeId, snapshot, selection = null) {
			if (this.history.length !== 1 || this.historyIndex !== 0) {
				return false;
			}

			this.history[0] = {
				scopeId: String(scopeId || this.activeScopeId || '').trim() || 'default',
				snapshot: cloneSnapshotValue(snapshot),
				selection: cloneSnapshotValue(selection),
			};
			this.notifyHistoryChange();
			return true;
		}

		/**
		 * Capture the current live scope state and replace the initial baseline.
		 *
		 * @param {string|null} scopeId Scope identifier.
		 * @returns {boolean} Whether replacement succeeded.
		 */
		replaceInitialEntryFromCapture(scopeId = null) {
			const entry = this.captureEntry(scopeId);
			if (!entry) {
				return false;
			}

			return this.replaceInitialEntry(
				entry.scopeId,
				entry.snapshot,
				entry.selection
			);
		}

		/**
		 * Restore one history entry through its owning scope.
		 *
		 * @param {Object} entry               History entry to restore.
		 * @param {*}      preferredSelection  Optional current-selection handoff.
		 * @returns {boolean} Whether restore succeeded.
		 */
		restoreEntry(entry, preferredSelection = null) {
			if (!entry || !entry.scopeId) {
				return false;
			}

			const descriptor = this.getScope(entry.scopeId);
			if (!descriptor || typeof descriptor.restore !== 'function') {
				return false;
			}

			const previousScopeId = this.activeScopeId;
			this.activateScope(entry.scopeId);
			this.isRestoring = true;

			try {
				const restoreSucceeded = descriptor.restore({
					host: descriptor.host || null,
					session: this,
					editorState: this.editorState,
					scopeId: descriptor.scopeId,
					snapshot: cloneSnapshotValue(entry.snapshot),
					preferredSelection: cloneSnapshotValue(preferredSelection),
					entrySelection: cloneSnapshotValue(entry.selection),
				});
				if (restoreSucceeded !== true) {
					this.activeScopeId = previousScopeId;
					return false;
				}

				const selectionToRestore = entry.selection != null
					? entry.selection
					: preferredSelection;
				if (
					selectionToRestore != null &&
					typeof descriptor.restoreSelection === 'function'
				) {
					descriptor.restoreSelection({
						host: descriptor.host || null,
						session: this,
						editorState: this.editorState,
						scopeId: descriptor.scopeId,
						selection: cloneSnapshotValue(selectionToRestore),
					});
				}
			} finally {
				this.isRestoring = false;
			}

			return true;
		}

		/**
		 * Restore the previous history entry.
		 *
		 * @returns {boolean} Whether undo succeeded.
		 */
		undo() {
			if (!this.canUndo()) {
				return false;
			}

			const currentScope = this.getScope();
			const nextEntry = this.history[this.historyIndex - 1] || null;
			const preferredSelection = (
				nextEntry &&
				currentScope &&
				nextEntry.scopeId === currentScope.scopeId &&
				typeof currentScope.captureSelection === 'function'
			)
				? currentScope.captureSelection({
					host: currentScope.host || null,
					session: this,
					editorState: this.editorState,
					scopeId: currentScope.scopeId,
				})
				: null;

			if (!this.restoreEntry(nextEntry, preferredSelection)) {
				return false;
			}

			this.historyIndex--;
			this.notifyHistoryChange();
			return true;
		}

		/**
		 * Restore the next history entry.
		 *
		 * @returns {boolean} Whether redo succeeded.
		 */
		redo() {
			if (!this.canRedo()) {
				return false;
			}

			const currentScope = this.getScope();
			const nextEntry = this.history[this.historyIndex + 1] || null;
			const preferredSelection = (
				nextEntry &&
				currentScope &&
				nextEntry.scopeId === currentScope.scopeId &&
				typeof currentScope.captureSelection === 'function'
			)
				? currentScope.captureSelection({
					host: currentScope.host || null,
					session: this,
					editorState: this.editorState,
					scopeId: currentScope.scopeId,
				})
				: null;

			if (!this.restoreEntry(nextEntry, preferredSelection)) {
				return false;
			}

			this.historyIndex++;
			this.notifyHistoryChange();
			return true;
		}

		/**
		 * Clear the full session history stack.
		 *
		 * @returns {void}
		 */
		clear() {
			this.history = [];
			this.historyIndex = -1;
			this.notifyHistoryChange();
		}

		/**
		 * Capture one stable checkpoint for the current history position.
		 *
		 * Reopen-aware editor lifecycles can use this to remember the block-session
		 * baseline for the current open pass, then discard later entries if that
		 * open is canceled without saving.
		 *
		 * The checkpoint contains a full immutable clone of the session timeline so
		 * cancel can restore the exact pre-open history branch even if the reopened
		 * session later undoes into an older entry and commits a new branch.
		 *
		 * @returns {Object|null} History checkpoint or null when no baseline exists.
		 */
		createHistoryCheckpoint() {
			if (this.historyIndex < 0 || !this.history[this.historyIndex]) {
				return {
					historyIndex: -1,
					entry: null,
					history: [],
					activeScopeId: String(this.activeScopeId || '').trim() || 'default',
					isSessionOrigin: true,
				};
			}

			return {
				historyIndex: this.historyIndex,
				entry: cloneSnapshotValue(this.history[this.historyIndex]),
				history: cloneSnapshotValue(this.history),
				activeScopeId: String(this.activeScopeId || '').trim() || 'default',
				isSessionOrigin: this.historyIndex === 0,
			};
		}

		/**
		 * Trim the session history back to one prior checkpoint.
		 *
		 * This is the non-leaky close-time companion to createHistoryCheckpoint():
		 * it restores the full cloned session timeline that was live when the
		 * current editor pass opened, without restoring through the live editor
		 * host during teardown.
		 *
		 * @param {Object|null} checkpoint Previously captured history checkpoint.
		 * @returns {boolean} Whether the history was trimmed successfully.
		 */
		restoreHistoryCheckpoint(checkpoint) {
			if (!checkpoint || typeof checkpoint !== 'object') {
				return false;
			}

			const checkpointHistory = Array.isArray(checkpoint.history)
				? cloneSnapshotValue(checkpoint.history)
				: null;
			const checkpointActiveScopeId = String(checkpoint.activeScopeId || '').trim();
			if (checkpointHistory) {
				this.history = checkpointHistory;
				this.historyIndex = Number.isInteger(checkpoint.historyIndex)
					? checkpoint.historyIndex
					: checkpointHistory.length - 1;
				if (this.historyIndex < 0) {
					this.historyIndex = checkpointHistory.length ? 0 : -1;
				}
				if (this.historyIndex >= checkpointHistory.length) {
					this.historyIndex = checkpointHistory.length - 1;
				}
				if (checkpointActiveScopeId) {
					this.activeScopeId = checkpointActiveScopeId;
				}
				this.notifyHistoryChange();
				return true;
			}

			if (!checkpoint.entry) {
				this.clear();
				return true;
			}

			let targetIndex = -1;
			const requestedIndex = Number.isInteger(checkpoint.historyIndex)
				? checkpoint.historyIndex
				: -1;

			if (
				requestedIndex >= 0 &&
				requestedIndex < this.history.length &&
				areEntriesEquivalent(this.history[requestedIndex], checkpoint.entry)
			) {
				targetIndex = requestedIndex;
			} else {
				targetIndex = this.history.findIndex((entry) => areEntriesEquivalent(entry, checkpoint.entry));
			}

			if (targetIndex < 0) {
				this.history = [cloneSnapshotValue(checkpoint.entry)];
				this.historyIndex = 0;
				this.notifyHistoryChange();
				return true;
			}

			this.history = this.history.slice(0, targetIndex + 1);
			this.history[targetIndex] = cloneSnapshotValue(checkpoint.entry);
			this.historyIndex = targetIndex;
			if (checkpointActiveScopeId) {
				this.activeScopeId = checkpointActiveScopeId;
			}
			this.notifyHistoryChange();
			return true;
		}
	}

	SFE.BlockEditSession = BlockEditSession;
	SFE.createBlockEditSession = function createBlockEditSession(options = {}) {
		return new BlockEditSession(options);
	};
})();
