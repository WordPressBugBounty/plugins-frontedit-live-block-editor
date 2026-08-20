/**
 * Stable frontend runtime PublicApi implementation.
 *
 * Exposes: SFE.PublicApi
 *   {
 *     getApiInfo, on, off, isEditorOpen, getActiveEditor,
 *     applyActiveMediaSelection, getPageContext, getRestContext, setRestNonce,
 *     getElementByUuid, getUuidForElement, getBlockSnapshot, getEditableBlocks,
 *     resolveRuntime,
 *     resolveEditingRuntime, getEditableComponents, getListStructure,
 *     getDefaultComponent, getMediaDescriptor, getMediaContext,
 *     isMediaEditable, openEditor, closeEditor, applyTextComponentOperations,
 *     applyMediaComponentOperations,
 *     applyBlockAttributeOperations,
 *     applyListOperations, applyStructuredEdit, stageBlockState,
 *     clearStagedBlockState, refreshBlock, getDirtyBlocks, hasDirtyBlocks,
 *     isBatchSessionActive, resetDirtyBlocks
 *   }
 *
 * Keeps mutable runtime internals private while exposing the documented browser
 * integration surface for external consumers such as ABE.
 */
(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};
	const PublicApi = SFE.PublicApi || {};
	const bridge    = SFE.PublicApiBridge || null;

	if (!bridge) {
		return;
	}

	/**
	 * Resolve the shared runtime context object.
	 *
	 * @returns {Object} Shared FrontEdit context.
	 */
	function getContext() {
		return SFE.Context || {};
	}

	/**
	 * Resolve the localized bootstrap payload.
	 *
	 * @returns {Object} Localized manager data.
	 */
	function getManagerData() {
		return SFE.ManagerData || {};
	}

	/**
	 * Normalize one candidate REST nonce.
	 *
	 * @param {*} nonce Candidate nonce value.
	 * @returns {string} Trimmed nonce or an empty string.
	 */
	function normalizeRestNonce(nonce) {
		return String(nonce || '').trim();
	}

	/**
	 * Return the live block element for one UUID.
	 *
	 * @param {string} uuid Block UUID.
	 * @returns {Element|null} Matching element.
	 */
	function getElementByUuid(uuid) {
		const normalizedUuid = String(uuid || '').trim();
		if (!normalizedUuid || typeof document.querySelector !== 'function') {
			return null;
		}

		try {
			return document.querySelector(`[data-mwp-sfe-uuid="${CSS.escape(normalizedUuid)}"]`);
		} catch (error) {
			return document.querySelector(`[data-mwp-sfe-uuid="${normalizedUuid.replace(/"/g, '\\"')}"]`);
		}
	}

	/**
	 * Resolve one UUID from a supplied element or nested child.
	 *
	 * @param {Element|null} element Candidate DOM node.
	 * @returns {string} Block UUID or an empty string.
	 */
	function getUuidForElement(element) {
		if (!(element instanceof Element)) {
			return '';
		}

		const candidate = element.closest('[data-mwp-sfe-uuid]');
		return candidate instanceof Element
			? String(candidate.getAttribute('data-mwp-sfe-uuid') || '').trim()
			: '';
	}

	/**
	 * Resolve one uuid-map entry from the shared context.
	 *
	 * @param {string} uuid Block UUID.
	 * @returns {Object|null} UUID map entry.
	 */
	function getUuidEntry(uuid) {
		const context = getContext();
		const normalizedUuid = String(uuid || '').trim();
		if (!normalizedUuid || !context.uuidMap || !context.uuidMap[normalizedUuid]) {
			return null;
		}

		return context.uuidMap[normalizedUuid];
	}

	/**
	 * Resolve one edit-capable handler for the supplied target.
	 *
	 * @param {Object} options Resolution options.
	 * @returns {Object|null} Edit handler when supported.
	 */
	function resolveEditHandler(options = {}) {
		const element = options.element instanceof Element ? options.element : null;
		const preferredHandlerId = String(options.handlerId || '').trim();
		const handlers = Array.isArray(element?._mwpSfeHandlers)
			? element._mwpSfeHandlers
			: [];

		if (preferredHandlerId) {
			const exact = handlers.find(handler => (
				handler &&
				handler.capability === 'edit' &&
				handler.id === preferredHandlerId
			));
			if (exact) {
				return exact;
			}
		}

		const fromElement = handlers.find(handler => handler && handler.capability === 'edit') || null;
		if (fromElement) {
			return fromElement;
		}

		const uuidEntry = getUuidEntry(options.uuid);
		const managerData = getManagerData();
		const registeredHandlers = Array.isArray(managerData.handlers) ? managerData.handlers : [];
		const handlerIds = Array.isArray(uuidEntry?.handlers) ? uuidEntry.handlers : [];

		if (preferredHandlerId) {
			return registeredHandlers.find(handler => (
				handler &&
				handler.capability === 'edit' &&
				handler.id === preferredHandlerId
			)) || null;
		}

		for (let index = 0; index < handlerIds.length; index++) {
			const handlerId = String(handlerIds[index] || '').trim();
			const match = registeredHandlers.find(handler => (
				handler &&
				handler.capability === 'edit' &&
				handler.id === handlerId
			));
			if (match) {
				return match;
			}
		}

		return null;
	}

	/**
	 * Resolve the current block-state payload used for schema hydration.
	 *
	 * @param {string} uuid Block UUID.
	 * @returns {Object|null} Block-state payload when available.
	 */
	function resolveBlockState(uuid) {
		const batchManager = SFE.BatchEditManager || null;
		if (
			batchManager &&
			typeof batchManager.isSessionActive === 'function' &&
			batchManager.isSessionActive() &&
			typeof batchManager.getBlockStateForUuid === 'function'
		) {
			return batchManager.getBlockStateForUuid(uuid);
		}

		return null;
	}

	/**
	 * Resolve the schema runtime bundle for one target block.
	 *
	 * @param {Object} options Runtime resolution options.
	 * @returns {Object|null} Schema runtime bundle.
	 */
	function resolveRuntimeBundle(options = {}) {
		const uuid = String(options.uuid || '').trim() || getUuidForElement(options.element);
		const element = options.element instanceof Element ? options.element : getElementByUuid(uuid);
		const handler = resolveEditHandler({
			uuid,
			element,
			handlerId: options.handlerId,
		});
		const schemaRuntime = SFE.SchemaRuntime || null;

		if (!uuid || !(element instanceof Element) || !handler || !schemaRuntime || typeof schemaRuntime.resolveForEditing !== 'function') {
			return null;
		}

		try {
			const blockState = options.blockState && typeof options.blockState === 'object'
				? options.blockState
				: resolveBlockState(uuid);
			const attributeChanges = options.attributeChanges && typeof options.attributeChanges === 'object'
				? options.attributeChanges
				: undefined;
			const resolved = schemaRuntime.resolveForEditing(element, handler, {
				blockState,
				attributeChanges,
			});
			if (!resolved || !resolved.runtimeHandler || !resolved.runtime) {
				return null;
			}

			return {
				uuid,
				element,
				handler: resolved.runtimeHandler,
				runtime: resolved.runtime,
				schema: resolved.schema || null,
			};
		} catch (error) {
			console.warn('FrontEdit: PublicApi resolveRuntime failed', error);
			return null;
		}
	}

	/**
	 * Build one detailed editable-component snapshot from a schema runtime entry.
	 *
	 * @param {Object|null} editableComponent Runtime editable component.
	 * @param {Object|null} componentMeta Additional component metadata.
	 * @returns {Object|null} Detailed component snapshot.
	 */
	function buildEditingRuntimeComponentDetail(editableComponent, componentMeta = null) {
		const snapshot = buildEditableComponentSnapshot(editableComponent);
		if (!snapshot) {
			return null;
		}

		const meta = componentMeta && typeof componentMeta === 'object' ? componentMeta : {};
		snapshot.element = editableComponent?.element instanceof Element
			? editableComponent.element
			: (meta.element instanceof Element ? meta.element : null);

		const bindings = Array.isArray(meta.bindings)
			? bridge.clonePlainData(meta.bindings)
			: [];
		if (bindings.length) {
			snapshot.bindings = bindings;
		}

		const target = meta.target && typeof meta.target === 'object'
			? bridge.clonePlainData(meta.target)
			: (snapshot.target || null);
		if (target) {
			snapshot.target = target;
		}

		const editorOptions = editableComponent?.editorOptions && typeof editableComponent.editorOptions === 'object'
			? bridge.clonePlainData(editableComponent.editorOptions)
			: (meta.editorOptions && typeof meta.editorOptions === 'object'
				? bridge.clonePlainData(meta.editorOptions)
				: null);
		if (editorOptions) {
			snapshot.editorOptions = editorOptions;
			snapshot.editor = bridge.clonePlainData(editorOptions);
		}

		return snapshot;
	}

	/**
	 * Build one detailed schema-resolved editing runtime snapshot.
	 *
	 * This exposes the same resolved component metadata FrontEdit uses for editing
	 * while keeping handler resolution and schema runtime execution owned by FrontEdit.
	 *
	 * @param {Object|null} bundle Runtime bundle.
	 * @returns {Object|null} Detailed editing runtime snapshot.
	 */
	function buildResolvedEditingRuntimeSnapshot(bundle) {
		if (!bundle || !bundle.runtime || !bundle.handler) {
			return null;
		}

		const runtimeComponentsById = bundle.runtime.componentsById && typeof bundle.runtime.componentsById === 'object'
			? bundle.runtime.componentsById
			: {};
		const componentDetails = [];
		const componentsById = {};

		(Array.isArray(bundle.runtime.editableComponents) ? bundle.runtime.editableComponents : []).forEach(component => {
			const componentId = String(component?.id || '').trim();
			const detail = buildEditingRuntimeComponentDetail(component, componentId ? runtimeComponentsById[componentId] : null);
			if (!detail || !componentId) {
				return;
			}

			componentDetails.push(detail);
			componentsById[componentId] = detail;
		});

		Object.keys(runtimeComponentsById).forEach(componentId => {
			if (componentsById[componentId]) {
				return;
			}

			const detail = buildEditingRuntimeComponentDetail(runtimeComponentsById[componentId], runtimeComponentsById[componentId]);
			if (!detail) {
				return;
			}

			detail.id = componentId;
			componentDetails.push(detail);
			componentsById[componentId] = detail;
		});

		const mediaComponentId = String(bundle.runtime?.mediaComponent?.id || '').trim();
		const mediaComponent = mediaComponentId && componentsById[mediaComponentId]
			? componentsById[mediaComponentId]
			: null;

		return {
			uuid: bundle.uuid,
			element: bundle.element instanceof Element ? bundle.element : null,
			handlerId: String(bundle.handler.id || '').trim(),
			blockName: String(bundle.runtime.blockName || getUuidEntry(bundle.uuid)?.blockName || '').trim(),
			schemaVersion: Number(bundle.schema?.version || 1) || 1,
			runtimeHandler: {
				id: String(bundle.handler.id || '').trim(),
			},
			runtime: {
				blockName: String(bundle.runtime.blockName || '').trim(),
				editableComponents: componentDetails,
				componentsById,
				mediaComponent,
			},
			schema: {
				handlerId: String(bundle.schema?.handlerId || bundle.handler.id || '').trim(),
			},
		};
	}

	/**
	 * Return a plain snapshot of one editable component.
	 *
	 * @param {Object|null} component Runtime component.
	 * @returns {Object|null} Public component snapshot.
	 */
	function buildEditableComponentSnapshot(component) {
		if (!component || typeof component !== 'object') {
			return null;
		}

		const snapshot = {
			id: String(component.id || '').trim(),
			label: String(component.label || component.id || '').trim(),
			type: String(component.type || '').trim().toLowerCase(),
			selector: String(component.selector || '').trim(),
			default: !!component.default,
		};

		if (!snapshot.id || !snapshot.type) {
			return null;
		}

		if (component.required === true) {
			snapshot.required = true;
		}
		if (typeof component.placeholder === 'string' && component.placeholder.trim()) {
			snapshot.placeholder = component.placeholder;
		}
		if (component.target && typeof component.target === 'object') {
			snapshot.target = bridge.clonePlainData(component.target);
		}
		if (component.mediaDescriptor && typeof component.mediaDescriptor === 'object') {
			snapshot.mediaDescriptor = bridge.clonePlainData(component.mediaDescriptor);
		}
		if (component.editorOptions && typeof component.editorOptions === 'object') {
			snapshot.editor = bridge.clonePlainData(component.editorOptions);
		}

		return snapshot;
	}

	/**
	 * Resolve the public runtime mode label.
	 *
	 * @param {Object|null} runtime Schema runtime.
	 * @returns {string} Runtime mode label.
	 */
	function resolvePublicRuntimeMode(runtime) {
		const components = Array.isArray(runtime?.editableComponents) ? runtime.editableComponents : [];
		const hasText = components.some(component => String(component?.type || '').trim().toLowerCase() !== 'file');
		const hasFile = components.some(component => String(component?.type || '').trim().toLowerCase() === 'file');

		if (hasText && hasFile) {
			return 'mixed';
		}
		if (hasFile) {
			return 'file';
		}
		return 'text';
	}

	/**
	 * Build one public runtime snapshot from a schema bundle.
	 *
	 * @param {Object|null} bundle Runtime bundle.
	 * @returns {Object|null} Public runtime snapshot.
	 */
	function buildResolvedRuntimeSnapshot(bundle) {
		if (!bundle || !bundle.runtime || !bundle.handler) {
			return null;
		}

		const components = Array.isArray(bundle.runtime.editableComponents)
			? bundle.runtime.editableComponents.map(buildEditableComponentSnapshot).filter(Boolean)
			: [];
		const defaultComponent = components.find(component => component.default) || components[0] || null;

		return {
			uuid: bundle.uuid,
			handlerId: String(bundle.handler.id || '').trim(),
			blockName: String(bundle.runtime.blockName || getUuidEntry(bundle.uuid)?.blockName || '').trim(),
			schemaVersion: Number(bundle.schema?.version || 1) || 1,
			mode: resolvePublicRuntimeMode(bundle.runtime),
			defaultComponentId: defaultComponent ? defaultComponent.id : '',
			components,
		};
	}

	/**
	 * Resolve a public media descriptor for one target block.
	 *
	 * @param {Object} options Media resolution options.
	 * @returns {Object|null} Media descriptor snapshot.
	 */
	function resolveMediaDescriptor(options = {}) {
		const runtime = resolveRuntimeBundle(options);
		if (!runtime) {
			return null;
		}

		const componentId = String(options.componentId || '').trim();
		const components = Array.isArray(runtime.runtime.editableComponents) ? runtime.runtime.editableComponents : [];
		const selected = componentId
			? components.find(component => component && component.id === componentId)
			: (
				(runtime.runtime.mediaComponent && typeof runtime.runtime.mediaComponent === 'object'
					? runtime.runtime.mediaComponent
					: components.find(component => String(component?.type || '').trim().toLowerCase() === 'file')
				) || null
			);

		if (!selected || !selected.mediaDescriptor || typeof selected.mediaDescriptor !== 'object') {
			return null;
		}

		return bridge.clonePlainData(selected.mediaDescriptor);
	}

	/**
	 * Build one stable block snapshot.
	 *
	 * @param {string} uuid Target UUID.
	 * @returns {Object|null} Block snapshot.
	 */
	function buildBlockSnapshot(uuid) {
		const normalizedUuid = String(uuid || '').trim();
		const entry = getUuidEntry(normalizedUuid);
		if (!normalizedUuid || !entry) {
			return null;
		}

		return {
			uuid: normalizedUuid,
			blockName: String(entry.blockName || '').trim(),
			handlerIds: Array.isArray(entry.handlers) ? entry.handlers.slice() : [],
			isPending: !!entry.is_pending,
			pendingInfo: entry.pending_info ? bridge.clonePlainData(entry.pending_info) : null,
			elementPresent: !!getElementByUuid(normalizedUuid),
		};
	}

	/**
	 * Return stable discovery snapshots for every editable block on this page.
	 *
	 * @returns {Array<Object>} Editable block snapshots in FrontEdit UUID-map order.
	 */
	function getEditableBlocks() {
		const context = getContext();
		const uuidMap = context.uuidMap && typeof context.uuidMap === 'object'
			? context.uuidMap
			: {};

		return Object.keys(uuidMap)
			.map(uuid => {
				const snapshot = buildBlockSnapshot(uuid);
				if (!snapshot) {
					return null;
				}

				const element = getElementByUuid(uuid);
				return {
					...snapshot,
					contentText: element instanceof Element
						? String(element.textContent || '').replace(/\s+/g, ' ').trim()
						: '',
				};
			})
			.filter(Boolean);
	}

	/**
	 * Determine whether a block currently has tracked unsaved changes.
	 *
	 * @param {string} uuid Block UUID.
	 * @returns {boolean} Whether the block is dirty.
	 */
	function isDirtyUuid(uuid) {
		const batchManager = SFE.BatchEditManager || null;
		return !!(
			uuid &&
			batchManager &&
			batchManager.dirtyBlocks instanceof Map &&
			batchManager.dirtyBlocks.has(uuid)
		);
	}

	/**
	 * Build one public editor snapshot from a live editor state object.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {Object|null} Stable editor snapshot.
	 */
	function buildEditorSnapshot(editorState) {
		if (!editorState || !editorState.uuid) {
			return null;
		}

		const draftEditState = getContext().draftEditState;
		const isDraftSession = !!(
			draftEditState &&
			draftEditState.draftElement &&
			draftEditState.draftElement === editorState.element
		);
		const activeComponentId = String(
			editorState.activeComponentId
			|| editorState.activeEditableComponent?.id
			|| ''
		).trim();
		const activeComponentType = String(
			editorState._mwpActiveComponentType
			|| editorState.activeEditableComponent?.type
			|| (editorState.isMediaEditor ? 'file' : 'text')
		).trim().toLowerCase();
		const activeEditorHost = resolveActiveEditorHost(editorState);

		return {
			uuid: String(editorState.uuid || '').trim(),
			handlerId: String(editorState._mwpSchemaHandlerId || editorState.handler?.id || '').trim(),
			mode: String(editorState.requestedMode || (isDraftSession ? 'draft' : 'edit')).trim() || 'edit',
			blockName: String(editorState.blockName || editorState.blockState?.blockName || '').trim(),
			isOpen: true,
			componentType: activeComponentType || 'text',
			componentId: activeComponentId,
			saveStrategy: String(editorState.saveStrategy || 'single').trim() || 'single',
			hasMediaSession: typeof activeEditorHost?.applyMediaSelection === 'function',
			isDirty: isDirtyUuid(editorState.uuid),
			isDraftSession,
			isBatchSession: !!(
				editorState.saveStrategy === 'batch' &&
				SFE.BatchEditManager &&
				typeof SFE.BatchEditManager.isSessionActive === 'function' &&
				SFE.BatchEditManager.isSessionActive()
			),
		};
	}

	/**
	 * Switch the active editable component inside one open editor session.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {string} componentId Target component identifier.
	 * @returns {boolean} Whether the switch succeeded.
	 */
	function activateEditorComponent(editorState, componentId) {
		if (!editorState || !componentId) {
			return false;
		}

		if (SFE.TextEditor && typeof SFE.TextEditor.activateEditableComponentById === 'function') {
			return !!SFE.TextEditor.activateEditableComponentById(editorState, componentId);
		}

		return false;
	}

	/**
	 * Open one editor session through the supported FrontEdit runtime path.
	 *
	 * @param {Object} options Open-editor options.
	 * @returns {Promise<Object|null>} Editor snapshot after opening.
	 */
	async function openEditor(options = {}) {
		const uuid = String(options.uuid || '').trim() || getUuidForElement(options.element);
		const element = options.element instanceof Element ? options.element : getElementByUuid(uuid);
		const handler = resolveEditHandler({
			uuid,
			element,
			handlerId: options.handlerId,
		});
		const componentId = String(options.componentId || '').trim();

		if (!uuid || !(element instanceof Element) || !handler || typeof SFE.startEditing !== 'function') {
			return null;
		}

		const activeEditor = getContext().activeEditor || null;
		if (activeEditor && String(activeEditor.uuid || '').trim() === uuid) {
			if (componentId) {
				activateEditorComponent(activeEditor, componentId);
			}
			return buildEditorSnapshot(getContext().activeEditor || activeEditor);
		}

		if (activeEditor && typeof SFE.closeInPlaceEditor === 'function') {
			SFE.closeInPlaceEditor(activeEditor, true, {
				closeReason: String(options.reason || 'api').trim() || 'api',
				source: String(options.source || 'external').trim() || 'external',
			});
		}

		await Promise.resolve(
			SFE.startEditing(
				element,
				handler,
				uuid,
				null,
				false,
				String(options.mode || 'edit').trim() || 'edit',
				{
					initialComponentId: componentId,
					source: String(options.source || 'external').trim() || 'external',
					originalSnapshots: options.originalSnapshots && typeof options.originalSnapshots === 'object'
						? {
							restoreOuterHTML: String(options.originalSnapshots.restoreOuterHTML || '').trim(),
							cleanOuterHTML: String(options.originalSnapshots.cleanOuterHTML || '').trim(),
						}
						: null,
				}
			)
		);

		const openedEditor = getContext().activeEditor || null;
		if (openedEditor && componentId) {
			activateEditorComponent(openedEditor, componentId);
		}

		return buildEditorSnapshot(getContext().activeEditor || openedEditor);
	}

	/**
	 * Close one editor session through the supported FrontEdit runtime path.
	 *
	 * @param {Object} options Close-editor options.
	 * @returns {boolean} Whether a close was attempted.
	 */
	function closeEditor(options = {}) {
		const activeEditor = getContext().activeEditor || null;
		if (!activeEditor || typeof SFE.closeInPlaceEditor !== 'function') {
			return false;
		}

		const targetUuid = String(options.uuid || '').trim();
		if (targetUuid && String(activeEditor.uuid || '').trim() !== targetUuid) {
			return false;
		}

		return SFE.closeInPlaceEditor(activeEditor, options.restoreOriginal !== false, {
			closeReason: String(options.reason || 'api').trim() || 'api',
			source: String(options.source || 'external').trim() || 'external',
		}) !== false;
	}

	/**
	 * Resolve the active editor state for one target block UUID.
	 *
	 * Schema-backed editor operations intentionally require a live open editor so
	 * the DOM mutation stays inside the same save/history session FrontEdit owns.
	 *
	 * @param {Object} options Editor-operation options.
	 * @returns {Object|null} Active editor state.
	 */
	function resolveActiveEditorState(options = {}) {
		const activeEditor = getContext().activeEditor || null;
		const targetUuid = String(options.uuid || '').trim() || getUuidForElement(options.element);
		if (!activeEditor || !targetUuid || String(activeEditor.uuid || '').trim() !== targetUuid) {
			return null;
		}

		return resolveActiveEditorHost(activeEditor) ? activeEditor : null;
	}

	function resolveActiveEditorHost(editorState) {
		return SFE.SchemaEditorHost?.resolveActiveEditorHost?.(editorState) || null;
	}

	/**
	 * Resolve the session-owned history API for one active editor host.
	 *
	 * External runtime mutations should commit through the same shared block
	 * session contract used internally instead of reaching into ad hoc
	 * editor-state history fields.
	 *
	 * @param {Object|null} editorHost Active schema editor host.
	 * @returns {Object|null} Session history API, or null when unavailable.
	 */
	function getSessionHistoryApiForHost(editorHost) {
		if (editorHost?.historyApi && typeof editorHost.historyApi === 'object') {
			return editorHost.historyApi;
		}

		if (typeof editorHost?.getSessionHistoryApi === 'function') {
			return editorHost.getSessionHistoryApi();
		}

		const blockEditSession = editorHost?.blockEditSession || null;
		if (!blockEditSession || typeof blockEditSession.getHistoryApi !== 'function') {
			return null;
		}

		return blockEditSession.getHistoryApi(
			String(editorHost?.blockEditSessionScopeId || '').trim() || 'text'
		);
	}

	/**
	 * Refresh one active editor state after a schema-driven DOM mutation.
	 *
	 * @param {Object} editorState Active editor state.
	 * @returns {void}
	 */
	function syncActiveEditorState(editorState) {
		if (!editorState?.handler) {
			return;
		}

		const editorHost = resolveActiveEditorHost(editorState);
		const blockRootElement = (
			editorHost &&
			typeof editorHost.getBlockRootElement === 'function'
		)
			? editorHost.getBlockRootElement()
			: null;
		if (blockRootElement && blockRootElement !== editorState.element) {
			// The active schema host element can be one editable component (for
			// example, one table cell), while block-session history and restore must
			// keep targeting the outer block root. Rebasing `editorState.element` to
			// the component host corrupts undo/redo by replaying full block markup
			// into that component instead of the block wrapper.
			editorState.element = blockRootElement;
		}

		if (!editorState.element) {
			return;
		}

		const schemaRuntime = SFE.SchemaRuntime || null;
		if (
			schemaRuntime &&
			typeof schemaRuntime.syncPlaceholders === 'function'
		) {
			schemaRuntime.syncPlaceholders(editorState.element, editorState.handler, {
				blockAttributes: editorState.blockState?.attrs || null,
				attributeChanges: editorState.attributeChanges || null,
			});
		}

		if (
			SFE.TextEditor &&
			typeof SFE.TextEditor.refreshEditableComponents === 'function'
		) {
			SFE.TextEditor.refreshEditableComponents(editorState);
		}
	}

	/**
	 * Build one component map for the active schema editor state.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {Object<string, Object>} Editable components keyed by ID.
	 */
	function getActiveEditorComponentMap(editorState) {
		if (!editorState || !Array.isArray(editorState.editableComponents)) {
			return {};
		}

		return editorState.editableComponents.reduce((map, component) => {
			const componentId = String(component?.id || '').trim();
			if (!componentId || !component?.element) {
				return map;
			}

			map[componentId] = component;
			return map;
		}, {});
	}

	/**
	 * Return the lowercase host tag name for one candidate component element.
	 *
	 * @param {Element|null} hostElement Candidate host element.
	 * @returns {string} Lowercase host tag name.
	 */
	function getHostElementTagName(hostElement) {
		return hostElement && hostElement.tagName
			? String(hostElement.tagName || '').trim().toLowerCase()
			: '';
	}

	/**
	 * Build one inline format wrapper for a structured run token.
	 *
	 * @param {Object} inlineCapabilities Allowed inline format capability map.
	 * @param {string} formatToken Format token.
	 * @param {Object|null} formatAttributes Optional format attributes.
	 * @returns {HTMLElement|null} Wrapper element.
	 */
	function buildStructuredFormatWrapper(inlineCapabilities, formatToken, formatAttributes = null) {
		const tagName = String(inlineCapabilities?.[formatToken]?.tag || '').trim().toLowerCase();
		if (!tagName) {
			return null;
		}

		const element = document.createElement(tagName);
		if (tagName === 'a' && formatAttributes && typeof formatAttributes === 'object') {
			const href = String(formatAttributes.href || '').trim();
			if (href) {
				element.setAttribute('href', href);
			}

			const target = String(formatAttributes.target || '').trim();
			if (target) {
				element.setAttribute('target', target);
			}

			const rel = String(formatAttributes.rel || '').trim();
			if (rel) {
				element.setAttribute('rel', rel);
			}
		}

		return element;
	}

	/**
	 * Hoist same-tag inline format attributes onto the host component element.
	 *
	 * @param {Array<Object>} runs Structured text runs.
	 * @param {Object} inlineCapabilities Allowed inline format capability map.
	 * @param {Element|null} hostElement Live host element.
	 * @returns {{runs: Array<Object>, hostAttributes: Object}} Hoisted run data.
	 */
	function hoistStructuredHostLevelFormats(runs, inlineCapabilities, hostElement = null) {
		const hostTagName = getHostElementTagName(hostElement);
		if (!hostTagName) {
			return {
				runs: Array.isArray(runs) ? runs : [],
				hostAttributes: {},
			};
		}

		const hostAttributes = {};
		const normalizedRuns = (Array.isArray(runs) ? runs : []).map(run => {
			const formats = Array.isArray(run?.formats) ? run.formats : [];
			const formatAttributes = run?.formatAttributes && typeof run.formatAttributes === 'object'
				? { ...run.formatAttributes }
				: {};
			const nextFormats = [];

			formats.forEach(formatToken => {
				const formatTagName = String(inlineCapabilities?.[formatToken]?.tag || '').trim().toLowerCase();
				if (!formatTagName || formatTagName !== hostTagName) {
					nextFormats.push(formatToken);
					return;
				}

				const attributes = formatAttributes?.[formatToken];
				if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
					Object.assign(hostAttributes, attributes);
				}
				delete formatAttributes[formatToken];
			});

			return {
				...run,
				formats: nextFormats,
				formatAttributes,
			};
		});

		return {
			runs: normalizedRuns,
			hostAttributes,
		};
	}

	/**
	 * Apply hoisted inline-format attributes onto one host element.
	 *
	 * @param {Element|null} hostElement Live host element.
	 * @param {Object|null} hostAttributes Hoisted host attributes.
	 * @returns {void}
	 */
	function applyStructuredHostLevelFormatAttributes(hostElement, hostAttributes = null) {
		if (!hostElement || typeof hostElement.setAttribute !== 'function' || typeof hostElement.removeAttribute !== 'function') {
			return;
		}

		const attributes = hostAttributes && typeof hostAttributes === 'object' ? hostAttributes : {};
		['href', 'target', 'rel'].forEach(attributeName => {
			const value = typeof attributes[attributeName] === 'string'
				? attributes[attributeName].trim()
				: '';
			if (value) {
				hostElement.setAttribute(attributeName, value);
				return;
			}

			hostElement.removeAttribute(attributeName);
		});
	}

	/**
	 * Build deterministic HTML from one normalized structured run sequence.
	 *
	 * @param {Array<Object>} runs Structured text runs.
	 * @param {Object} inlineCapabilities Allowed inline format capability map.
	 * @param {Object} editorOptions Runtime editor options.
	 * @param {Element|null} hostElement Live host element.
	 * @returns {{html: string, hostAttributes: Object}} Rendered HTML fragment.
	 */
	function buildStructuredHtmlFromRuns(runs, inlineCapabilities, editorOptions = {}, hostElement = null) {
		const container = document.createElement('div');
		const extractionOptions = editorOptions?.options && typeof editorOptions.options === 'object'
			? editorOptions.options
			: {};
		const hoisted = hoistStructuredHostLevelFormats(runs, inlineCapabilities, hostElement);

		(Array.isArray(hoisted.runs) ? hoisted.runs : []).forEach(run => {
			const text = String(run?.text || '');
			if (!text) {
				return;
			}

			const segments = extractionOptions.newlinesToBR === true || String(editorOptions?.enterMode || '').trim() === 'linebreak'
				? text.split('\n')
				: [text];

			segments.forEach((segment, index) => {
				if (index > 0) {
					container.appendChild(document.createElement('br'));
				}

				if (!segment) {
					return;
				}

				let node = document.createTextNode(segment);
				(Array.isArray(run.formats) ? run.formats : []).forEach(formatToken => {
					const wrapper = buildStructuredFormatWrapper(
						inlineCapabilities,
						formatToken,
						run.formatAttributes && typeof run.formatAttributes === 'object'
							? run.formatAttributes[formatToken] || null
							: null
					);
					if (!wrapper) {
						return;
					}

					wrapper.appendChild(node);
					node = wrapper;
				});

				container.appendChild(node);
			});
		});

		return {
			html: container.innerHTML,
			hostAttributes: hoisted.hostAttributes,
		};
	}

	/**
	 * Apply structured component updates onto the active editor DOM.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Array<Object>} componentUpdates Normalized component updates.
	 * @returns {string[]} Updated component IDs.
	 */
	function applyStructuredComponentUpdates(editorState, componentUpdates) {
		const componentMap = getActiveEditorComponentMap(editorState);
		const updatedComponentIds = [];

		(Array.isArray(componentUpdates) ? componentUpdates : []).forEach(componentUpdate => {
			const componentId = String(componentUpdate?.componentId || '').trim();
			const component = componentMap[componentId] || null;
			if (!component || !component.element) {
				return;
			}

			if (componentUpdate.bindingSource === 'plaintext') {
				component.element.textContent = (Array.isArray(componentUpdate.runs) ? componentUpdate.runs : [])
					.map(run => String(run?.text || ''))
					.join('');
				updatedComponentIds.push(componentId);
				return;
			}

			if (componentUpdate.bindingSource === 'html') {
				const rendered = buildStructuredHtmlFromRuns(
					componentUpdate.runs,
					componentUpdate.inlineCapabilities || {},
					componentUpdate.editorOptions || component.editorOptions || {},
					component.element
				);
				component.element.innerHTML = rendered.html;
				applyStructuredHostLevelFormatAttributes(component.element, rendered.hostAttributes);
				updatedComponentIds.push(componentId);
			}
		});

		return Array.from(new Set(updatedComponentIds));
	}

	/**
	 * Resolve the active list-editor state for one target block UUID.
	 *
	 * Structural list operations intentionally require a live open editor so the
	 * mutation happens inside the same DOM/save session FrontEdit already owns.
	 *
	 * @param {Object} options List-operation options.
	 * @returns {Object|null} Active list editor state.
	 */
	function resolveActiveListEditorState(options = {}) {
		const activeEditor = resolveActiveEditorState(options);
		if (!activeEditor) {
			return null;
		}

		const listTracker = SFE.ListBlockTracker || null;
		if (
			!listTracker ||
			!activeEditor.element ||
			(activeEditor.element.tagName !== 'UL' && activeEditor.element.tagName !== 'OL')
		) {
			return null;
		}

		if (!activeEditor.listTracker || activeEditor.listTracker.listElement !== activeEditor.element) {
			activeEditor.listTracker = listTracker.init(
				activeEditor.element,
				activeEditor.blockState || {}
			);
		}

		return activeEditor.listTracker ? activeEditor : null;
	}

	/**
	 * Refresh one active list editor after a structural DOM mutation.
	 *
	 * @param {Object} editorState Active list editor state.
	 * @returns {void}
	 */
	function syncActiveListEditorState(editorState) {
		if (!editorState?.element || !editorState?.handler) {
			return;
		}

		if (editorState.listTracker?.listElement && editorState.listTracker.listElement !== editorState.element) {
			editorState.element = editorState.listTracker.listElement;
			const editorHost = resolveActiveEditorHost(editorState);
			if (editorHost && typeof editorHost === 'object') {
				editorHost.element = editorState.listTracker.listElement;
			}
		}

		syncActiveEditorState(editorState);
	}

	/**
	 * Apply one or more schema-declared block-attribute operations to the active editor.
	 *
	 * @param {Object} options Block-attribute operation options.
	 * @returns {Object|null} Result summary and current tracked attribute changes.
	 */
	function applyBlockAttributeOperationsToActiveEditor(options = {}) {
		const editorState = resolveActiveEditorState(options);
		const editorHost = resolveActiveEditorHost(editorState);
		const operations = Array.isArray(options.operations)
			? options.operations.filter(operation => (
				operation &&
				typeof operation === 'object' &&
				!Array.isArray(operation) &&
				typeof operation.id === 'string' &&
				operation.id.trim() &&
				Object.prototype.hasOwnProperty.call(operation, 'value')
			))
			: [];
		const operationExecutor = SFE.SchemaOperationExecutor || null;

		if (
			!editorState ||
			!editorHost ||
			!operations.length ||
			!operationExecutor ||
			typeof operationExecutor.executeBlockAttributeOperations !== 'function'
		) {
			return null;
		}

		const executionResult = operationExecutor.executeBlockAttributeOperations({
			editorHost,
			operations,
			saveHistory: true,
			afterSync: function() {
				syncActiveEditorState(editorState);
			},
		});
		if (!executionResult) {
			return null;
		}

		return {
			uuid: String(editorState.uuid || '').trim(),
			operationsApplied: executionResult.operationsApplied,
			attributeChanges: bridge.clonePlainData(executionResult.attributeChanges || {}),
		};
	}

	/**
	 * Apply one or more component-content replacement operations to the active editor.
	 *
	 * The shared executor owns rich-text run rendering and link normalization so
	 * external callers can target component surfaces without reimplementing FrontEdit's
	 * browser mutation semantics.
	 *
	 * @param {Object} options Component-operation options.
	 * @returns {Object|null} Result summary and updated component IDs.
	 */
	function applyTextComponentOperationsToActiveEditor(options = {}) {
		const editorState = resolveActiveEditorState(options);
		const editorHost = resolveActiveEditorHost(editorState);
		const operations = Array.isArray(options.operations)
			? options.operations.filter(operation => operation && typeof operation === 'object' && !Array.isArray(operation))
			: [];
		const operationExecutor = SFE.SchemaOperationExecutor || null;

		if (
			!editorState ||
			!editorHost ||
			!operations.length ||
			!operationExecutor ||
			typeof operationExecutor.executeComponentOperations !== 'function'
		) {
			return null;
		}

		const executionResult = operationExecutor.executeComponentOperations({
			editorState,
			editorHost,
			operations,
			saveHistory: true,
			afterSync: function() {
				syncActiveEditorState(editorState);
			},
		});
		if (!executionResult) {
			return null;
		}

		return {
			uuid: String(editorState.uuid || '').trim(),
			updatedComponentIds: Array.isArray(executionResult.updatedComponentIds)
				? executionResult.updatedComponentIds.slice()
				: [],
			operationsApplied: Array.isArray(executionResult.operationsApplied)
				? executionResult.operationsApplied.slice()
				: [],
		};
	}

	/**
	 * Apply one or more schema-backed media replacements to the active editor.
	 *
	 * This targets the currently active media-session host so external callers
	 * can replace schema media components without bypassing FrontEdit's own preview and
	 * resolved-media update pipeline.
	 *
	 * @param {Object} options Media-operation options.
	 * @returns {Object|null} Result summary and updated component IDs.
	 */
	function applyMediaComponentOperationsToActiveEditor(options = {}) {
		const editorState = resolveActiveEditorState(options);
		const editorHost = resolveActiveEditorHost(editorState);
		const operations = Array.isArray(options.operations)
			? options.operations.filter(operation => operation && typeof operation === 'object' && !Array.isArray(operation))
			: [];
		const operationExecutor = SFE.SchemaOperationExecutor || null;

		if (
			!editorState ||
			!editorHost ||
			!operations.length ||
			!operationExecutor ||
			typeof operationExecutor.executeMediaOperations !== 'function'
		) {
			return null;
		}

		const executionResult = operationExecutor.executeMediaOperations({
			editorState,
			editorHost,
			operations,
			afterSync: function() {
				syncActiveEditorState(editorState);
			},
		});
		if (!executionResult) {
			return null;
		}

		return {
			uuid: String(editorState.uuid || '').trim(),
			updatedComponentIds: Array.isArray(executionResult.updatedComponentIds)
				? executionResult.updatedComponentIds.slice()
				: [],
			operationsApplied: Array.isArray(executionResult.operationsApplied)
				? executionResult.operationsApplied.slice()
				: [],
		};
	}

	/**
	 * Apply one or more high-level public list operations to the currently open
	 * list editor.
	 *
	 * The runtime API accepts UUID-oriented public commands and lets the shared
	 * executor translate them into the internal primitive tracker operations.
	 *
	 * @param {Object} options List-operation options.
	 * @returns {Object|null} Result summary and next list structure.
	 */
	function applyListOperationsToActiveEditor(options = {}) {
		const editorState = resolveActiveListEditorState(options);
		const editorHost = resolveActiveEditorHost(editorState);
		const operations = Array.isArray(options.operations)
			? options.operations
			: (options.operation ? [ options.operation ] : []);
		const operationExecutor = SFE.SchemaOperationExecutor || null;
		const listTracker = SFE.ListBlockTracker || null;

		if (
			!editorState ||
			!editorHost ||
			!operations.length ||
			!operationExecutor ||
			typeof operationExecutor.executeListOperations !== 'function' ||
			!listTracker
		) {
			return null;
		}

		const executionResult = operationExecutor.executeListOperations({
			tracker: editorState.listTracker,
			editorHost,
			operations,
			targetResolutionMode: 'api_uuid',
			saveHistory: true,
			afterSync: function() {
				syncActiveListEditorState(editorState);
			},
		});
		if (!executionResult) {
			return null;
		}

		return {
			uuid: String(editorState.uuid || '').trim(),
			operationsApplied: executionResult.operationsApplied,
			structure: listTracker.getStructure(editorState.listTracker),
		};
	}

	/**
	 * Apply one normalized structured edit payload to the active schema editor.
	 *
	 * This keeps non-list staged edits inside the same public runtime contract as
	 * list operations: open the editor first, then let FrontEdit own the mutation and
	 * history bookkeeping.
	 *
	 * @param {Object} options Structured-edit options.
	 * @returns {Object|null} Result summary for the applied edit.
	 */
	function applyStructuredEditToActiveEditor(options = {}) {
		const editorState = resolveActiveEditorState(options);
		const editorHost = resolveActiveEditorHost(editorState);
		const componentUpdates = Array.isArray(options.componentUpdates)
			? options.componentUpdates.filter(operation => operation && typeof operation === 'object' && !Array.isArray(operation))
			: [];
		const attributeOperations = Array.isArray(options.attributeOperations)
			? options.attributeOperations.filter(operation => (
				operation &&
				typeof operation === 'object' &&
				!Array.isArray(operation) &&
				typeof operation.id === 'string' &&
				operation.id.trim() &&
				Object.prototype.hasOwnProperty.call(operation, 'value')
			))
			: [];
		const operationExecutor = SFE.SchemaOperationExecutor || null;

		if (!editorState || !editorHost || (!componentUpdates.length && !attributeOperations.length)) {
			return null;
		}

		let attributeResult = null;
		let componentResult = null;

		if (
			componentUpdates.length
			&& operationExecutor
			&& typeof operationExecutor.executeComponentOperations === 'function'
		) {
			componentResult = operationExecutor.executeComponentOperations({
				editorState,
				editorHost,
				operations: componentUpdates,
				saveHistory: false,
			});
		}

		if (
			attributeOperations.length &&
			operationExecutor &&
			typeof operationExecutor.executeBlockAttributeOperations === 'function'
		) {
			attributeResult = operationExecutor.executeBlockAttributeOperations({
				editorHost,
				operations: attributeOperations,
				saveHistory: false,
			});
		}

		const didApplyAttributes = !!(
			attributeResult &&
			Array.isArray(attributeResult.operationsApplied) &&
			attributeResult.operationsApplied.length
		);
		const didApplyComponents = !!(
			componentResult &&
			Array.isArray(componentResult.updatedComponentIds) &&
			componentResult.updatedComponentIds.length
		);
		if (!didApplyComponents && !didApplyAttributes) {
			return null;
		}

		syncActiveEditorState(editorState);

		const historyApi = getSessionHistoryApiForHost(editorHost);
		if (typeof historyApi?.saveToHistory === 'function') {
			historyApi.saveToHistory();
		}

		if (typeof editorHost.updateToolbarState === 'function') {
			editorHost.updateToolbarState();
		}

		return {
			uuid: String(editorState.uuid || '').trim(),
			updatedComponentIds: Array.isArray(componentResult?.updatedComponentIds)
				? componentResult.updatedComponentIds
				: [],
			operationsApplied: [
				...(Array.isArray(componentResult?.operationsApplied) ? componentResult.operationsApplied : []),
				...(Array.isArray(attributeResult?.operationsApplied) ? attributeResult.operationsApplied : []),
			],
			attributeChanges: bridge.clonePlainData(editorHost.attributeChanges || {}),
		};
	}

	/**
	 * Return a structural snapshot for one list block.
	 *
	 * This resolves against the live DOM so external tooling can inspect the
	 * current nested list tree without parsing serialized block markup itself.
	 *
	 * @param {Object} options Lookup options.
	 * @returns {Object|null} List structure snapshot.
	 */
	function getListStructure(options = {}) {
		const uuid = String(options.uuid || '').trim() || getUuidForElement(options.element);
		const element = options.element instanceof Element ? options.element : getElementByUuid(uuid);
		const listTracker = SFE.ListBlockTracker || null;
		if (
			!uuid ||
			!(element instanceof Element) ||
			!listTracker ||
			(element.tagName !== 'UL' && element.tagName !== 'OL')
		) {
			return null;
		}

		const tracker = element._mwpListTracker
			|| listTracker.init(element, resolveBlockState(uuid) || {});

		return tracker && typeof listTracker.getStructure === 'function'
			? listTracker.getStructure(tracker)
			: null;
	}

	/**
	 * Apply one selected media item to the active schema-media editor session.
	 *
	 * This uses the same internal selection transition FrontEdit normally runs after
	 * the user picks an item from the media library or upload flow.
	 *
	 * @param {Object} options Media-selection options.
	 * @returns {Object|null} Stable editor snapshot after the selection is applied.
	 */
	function applyActiveMediaSelection(options = {}) {
		const activeEditor = getContext().activeEditor || null;
		const targetUuid = String(options.uuid || '').trim();
		if (!activeEditor || !targetUuid || String(activeEditor.uuid || '').trim() !== targetUuid) {
			return null;
		}

		const editorHost = resolveActiveEditorHost(activeEditor);
		const url = String(options.url || '').trim();
		if (!editorHost || typeof editorHost.applyMediaSelection !== 'function' || !url) {
			return null;
		}

		const attachmentId = Object.prototype.hasOwnProperty.call(options, 'attachmentId')
			? options.attachmentId
			: null;
		const fromState = String(options.source || '').trim().toLowerCase() === 'library'
			? 'library'
			: 'input';
		const didApply = editorHost.applyMediaSelection(url, attachmentId, { fromState });

		return didApply === false ? null : buildEditorSnapshot(activeEditor);
	}

	/**
	 * Refresh one block through the supported server-rendered replacement path.
	 *
	 * @param {string} uuid Block UUID.
	 * @param {Object} [options={}] Refresh options.
	 * @returns {Promise<Object|null>} Refreshed block snapshot.
	 */
	async function refreshBlock(uuid, options = {}) {
		const normalizedUuid = String(uuid || '').trim();
		const element = getElementByUuid(normalizedUuid);
		if (
			!normalizedUuid ||
			!(element instanceof Element) ||
			!SFE.SaveHelpers ||
			typeof SFE.SaveHelpers.fetchRenderedBlockHTML !== 'function' ||
			!SFE.ElementUpdater ||
			typeof SFE.ElementUpdater.applyNewHTML !== 'function'
		) {
			return null;
		}

		const html = await SFE.SaveHelpers.fetchRenderedBlockHTML(normalizedUuid, options || {});
		if (!html) {
			return null;
		}

		const newElement = SFE.ElementUpdater.applyNewHTML(element, normalizedUuid, html);
		if (!newElement) {
			return null;
		}

		if (typeof SFE.ElementUpdater.rebindElement === 'function') {
			SFE.ElementUpdater.rebindElement(newElement);
		}

		const block = buildBlockSnapshot(normalizedUuid);
		if (block) {
			bridge.emitEvent('block:refreshed', {
				source: String(options.source || 'sfe').trim() || 'sfe',
				block,
			});
		}

		return block;
	}

	/**
	 * Return one public dirty-block snapshot.
	 *
	 * @param {Object} entry Dirty entry from the batch manager.
	 * @returns {Object|null} Dirty block snapshot.
	 */
	function buildDirtyBlockSnapshot(entry) {
		if (!entry || typeof entry !== 'object') {
			return null;
		}

		return {
			uuid: String(entry.element_uuid || '').trim(),
			handlerId: String(entry.handler_id || '').trim(),
			blockName: String(entry.blockName || '').trim(),
			beforeRaw: String(entry.before || '').trim(),
			afterRaw: String(entry.after || '').trim(),
		};
	}

	/**
	 * Reset dirty batch state for one or more target UUIDs.
	 *
	 * @param {string[]} uuids Target UUIDs.
	 * @returns {boolean} Whether any batch state was reset.
	 */
	function resetDirtyBlocks(uuids) {
		const batchManager = SFE.BatchEditManager || null;
		const normalizedUuids = Array.isArray(uuids)
			? uuids.map(uuid => String(uuid || '').trim()).filter(Boolean)
			: [];

		if (!normalizedUuids.length || !batchManager) {
			return false;
		}

		if (typeof batchManager.resetDirtyBlocks === 'function') {
			return !!batchManager.resetDirtyBlocks(normalizedUuids);
		}

		let changed = false;
		normalizedUuids.forEach(uuid => {
			if (batchManager.dirtyBlocks instanceof Map && batchManager.dirtyBlocks.has(uuid)) {
				batchManager.dirtyBlocks.delete(uuid);
				changed = true;
			}

			if (
				batchManager.currentBlockStates instanceof Map &&
				batchManager.baseBlockStates instanceof Map &&
				batchManager.baseBlockStates.has(uuid)
			) {
				batchManager.currentBlockStates.set(
					uuid,
					bridge.clonePlainData(batchManager.baseBlockStates.get(uuid))
				);
				changed = true;
			}
		});

		return changed;
	}

	/**
	 * Return the stable PublicApi discovery snapshot.
	 *
	 * @returns {Object} API metadata.
	 */
	function getApiInfo() {
		return {
			apiVersion: 1,
			namespace: 'window.MWP.SFE.PublicApi',
			features: {
				editorControl: true,
				runtimeInspection: true,
				editableBlockDiscovery: true,
				editingRuntimeResolution: true,
				textComponentOperations: true,
				structuredEditOperations: true,
				mediaComponentOperations: true,
				mediaInspection: true,
				mediaSessionControl: true,
				explicitStaging: true,
				events: true,
				blockRefresh: true,
			},
		};
	}

	PublicApi._buildEditorSnapshot = buildEditorSnapshot;
	PublicApi.getApiInfo = getApiInfo;
	PublicApi.isEditorOpen = function isEditorOpen() {
		return !!getContext().activeEditor;
	};
	PublicApi.getActiveEditor = function getActiveEditor() {
		return buildEditorSnapshot(getContext().activeEditor || null);
	};
	PublicApi.applyActiveMediaSelection = function applyActiveMediaSelectionPublic(options = {}) {
		return applyActiveMediaSelection(options);
	};
	PublicApi.getPageContext = function getPageContext() {
		const context = getContext();
		const managerData = getManagerData();
		return {
			postId: Number(managerData.postId || 0) || 0,
			permissions: bridge.clonePlainData(managerData.permissions || {}),
			hasDraftPreview: !!(
				document.body.classList.contains('mwp-sfe-active-preview') ||
				context.activeMode === 'draft'
			),
			isEditorOpen: !!context.activeEditor,
			activeMode: String(context.activeMode || '').trim(),
		};
	};
	PublicApi.getRestContext = function getRestContext() {
		const managerData = getManagerData();
		return {
			baseUrl: String(managerData.restBase || '').trim(),
			namespaceUrl: String(managerData.restUrl || '').trim(),
			nonce: String(managerData.nonce || '').trim(),
		};
	};
	PublicApi.setRestNonce = function setRestNonce(nonce) {
		const normalizedNonce = normalizeRestNonce(nonce);
		if (!normalizedNonce) {
			return PublicApi.getRestContext();
		}

		const managerData = getManagerData();
		managerData.nonce = normalizedNonce;
		SFE.ManagerData = managerData;

		return PublicApi.getRestContext();
	};
	PublicApi.getElementByUuid = getElementByUuid;
	PublicApi.getUuidForElement = getUuidForElement;
	PublicApi.getBlockSnapshot = function getBlockSnapshot(uuid) {
		return buildBlockSnapshot(uuid);
	};
	PublicApi.getEditableBlocks = getEditableBlocks;
	PublicApi.resolveRuntime = function resolveRuntime(options = {}) {
		return buildResolvedRuntimeSnapshot(resolveRuntimeBundle(options));
	};
	PublicApi.resolveEditingRuntime = function resolveEditingRuntime(options = {}) {
		return buildResolvedEditingRuntimeSnapshot(resolveRuntimeBundle(options));
	};
	PublicApi.getEditableComponents = function getEditableComponents(options = {}) {
		const runtime = buildResolvedRuntimeSnapshot(resolveRuntimeBundle(options));
		return runtime ? runtime.components : [];
	};
	PublicApi.getListStructure = getListStructure;
	PublicApi.getDefaultComponent = function getDefaultComponent(options = {}) {
		const components = PublicApi.getEditableComponents(options);
		return components.find(component => component.default) || components[0] || null;
	};
	PublicApi.getMediaDescriptor = function getMediaDescriptor(options = {}) {
		return resolveMediaDescriptor(options);
	};
	PublicApi.getMediaContext = function getMediaContext(options = {}) {
		const descriptor = resolveMediaDescriptor(options);
		const mediaHelper = SFE.MediaHelper || null;
		if (!descriptor || !mediaHelper || typeof mediaHelper.getMediaType !== 'function') {
			return null;
		}

		const mediaType = String(mediaHelper.getMediaType(descriptor) || '').trim();
		if (!mediaType) {
			return null;
		}

		return {
			supported: true,
			componentId: String(descriptor.componentId || '').trim(),
			mediaType,
			accept: typeof mediaHelper.getAcceptTypes === 'function'
				? String(mediaHelper.getAcceptTypes(descriptor) || '*/*').trim() || '*/*'
				: '*/*',
			label: mediaType === 'audio' ? 'audio block' : (mediaType === 'video' ? 'video block' : (mediaType === 'file' ? 'file block' : 'media block')),
			descriptor,
		};
	};
	PublicApi.isMediaEditable = function isMediaEditable(options = {}) {
		return !!PublicApi.getMediaContext(options);
	};
	PublicApi.openEditor = openEditor;
	PublicApi.closeEditor = closeEditor;
	PublicApi.applyTextComponentOperations = applyTextComponentOperationsToActiveEditor;
	PublicApi.applyMediaComponentOperations = applyMediaComponentOperationsToActiveEditor;
	PublicApi.applyBlockAttributeOperations = applyBlockAttributeOperationsToActiveEditor;
	PublicApi.applyListOperations = applyListOperationsToActiveEditor;
	PublicApi.applyStructuredEdit = applyStructuredEditToActiveEditor;
	PublicApi.stageBlockState = function stageBlockState(stage) {
		const uuid = String(stage && stage.uuid ? stage.uuid : '').trim();
		if (!uuid || !stage || typeof stage !== 'object' || !stage.blockState || typeof stage.blockState !== 'object') {
			return;
		}

		bridge.stagedBlockStates.set(uuid, {
			handlerId: String(stage.handlerId || '').trim(),
			source: String(stage.source || 'external').trim() || 'external',
			blockState: bridge.clonePlainData(stage.blockState),
		});

		bridge.emitEvent('block:staged', {
			source: String(stage.source || 'external').trim() || 'external',
			uuid,
			handlerId: String(stage.handlerId || '').trim(),
		});
	};
	PublicApi.clearStagedBlockState = function clearStagedBlockState(uuid, source = 'external') {
		const normalizedUuid = String(uuid || '').trim();
		if (!normalizedUuid) {
			return;
		}

		bridge.stagedBlockStates.delete(normalizedUuid);
		bridge.emitEvent('block:stageCleared', {
			source: String(source || 'external').trim() || 'external',
			uuid: normalizedUuid,
		});
	};
	PublicApi.refreshBlock = refreshBlock;
	PublicApi.getDirtyBlocks = function getDirtyBlocks() {
		const batchManager = SFE.BatchEditManager || null;
		if (!batchManager || !(batchManager.dirtyBlocks instanceof Map)) {
			return [];
		}

		return Array.from(batchManager.dirtyBlocks.values())
			.map(buildDirtyBlockSnapshot)
			.filter(entry => entry && entry.uuid);
	};
	PublicApi.hasDirtyBlocks = function hasDirtyBlocks() {
		return PublicApi.getDirtyBlocks().length > 0;
	};
	PublicApi.isBatchSessionActive = function isBatchSessionActive() {
		const batchManager = SFE.BatchEditManager || null;
		return !!(
			batchManager &&
			typeof batchManager.isSessionActive === 'function' &&
			batchManager.isSessionActive()
		);
	};
	PublicApi.resetDirtyBlocks = function resetDirtyBlocksPublic(uuids) {
		return resetDirtyBlocks(uuids);
	};

	SFE.PublicApi = PublicApi;
})();
