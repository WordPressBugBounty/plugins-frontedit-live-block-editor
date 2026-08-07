/**
 * Text editor - all contenteditable text-editing setup
 *
 * Reads (via globals):
 *   SFE.Context            - .draftEditState
 *   SFE.ElementPrep        - .getCleanHTML, .getContent
 *   SFE.OverlayManager
 *   SFE.PositionManager    - .positionFloatingElements
 *   SFE.FocusManager       - .createFocusManager
 *   SFE.handleInlineSave   - set by SaveManager
 *   SFE.closeInPlaceEditor - set by EditorLifecycle
 *   SFE.startMediaEditing  - set by frontend-inline-edit.js (via SFE.MediaEditor)
 *   SFE.MWPEditor          - rich text editor class
 *   SFE.ManagerData        - .handlers
 *
 * Exposes: SFE.TextEditor
 *   { startTextEditing, startMultiComponentEditing, refreshEditableComponents }
 */

(function() {
	'use strict';

	window.MWP       = window.MWP || {};
	window.MWP.SFE   = window.MWP.SFE || {};
	const SFE        = window.MWP.SFE;
	SFE.ManagerData  = SFE.ManagerData || {};
	const MWPEditor  = SFE.MWPEditor;

	function normalizeEditorFormatsSpec(rawFormats, depth = 0) {
		if (depth > 3 || !Array.isArray(rawFormats)) {
			return null;
		}

		const normalized = [];
		rawFormats.forEach((item) => {
			if (typeof item === 'string') {
				const token = item.trim();
				if (token) {
					normalized.push(token);
				}
				return;
			}

			if (Array.isArray(item)) {
				const group = normalizeEditorFormatsSpec(item, depth + 1);
				if (Array.isArray(group) && group.length) {
					normalized.push(group);
				}
			}
		});

		return normalized.length ? normalized : null;
	}

	function cloneEditorFormatsSpec(formatsSpec) {
		if (!Array.isArray(formatsSpec)) return null;
		return formatsSpec.map(item => (
			Array.isArray(item) ? cloneEditorFormatsSpec(item) : item
		));
	}

	function normalizeInlineFormatCapability(rawCapability) {
		if (!rawCapability || typeof rawCapability !== 'object' || Array.isArray(rawCapability)) {
			return null;
		}

		const tag = typeof rawCapability.tag === 'string'
			? rawCapability.tag.trim().toLowerCase()
			: '';
		if (!tag) return null;

		const normalizeStringArray = (rawValue) => {
			if (!Array.isArray(rawValue)) return null;
			const values = rawValue
				.map((value) => (typeof value === 'string' ? value.trim() : ''))
				.filter(Boolean);
			return values.length ? values : null;
		};

		const normalized = { tag };
		const attributes = normalizeStringArray(rawCapability.attributes);
		const requiredAttributes = normalizeStringArray(rawCapability.requiredAttributes);
		const allowedTargets = normalizeStringArray(rawCapability.allowedTargets);
		const allowedRelTokens = normalizeStringArray(rawCapability.allowedRelTokens);
		const allowedProtocols = normalizeStringArray(rawCapability.allowedProtocols);

		if (attributes) normalized.attributes = attributes;
		if (requiredAttributes) normalized.requiredAttributes = requiredAttributes;
		if (allowedTargets) normalized.allowedTargets = allowedTargets;
		if (allowedRelTokens) normalized.allowedRelTokens = allowedRelTokens;
		if (allowedProtocols) normalized.allowedProtocols = allowedProtocols;

		if (typeof rawCapability.allowsRelativeUrls === 'boolean') {
			normalized.allowsRelativeUrls = rawCapability.allowsRelativeUrls;
		}

		if (typeof rawCapability.allowsAnchorLinks === 'boolean') {
			normalized.allowsAnchorLinks = rawCapability.allowsAnchorLinks;
		}

		if (typeof rawCapability.autoProtocol === 'string' && rawCapability.autoProtocol.trim()) {
			normalized.autoProtocol = rawCapability.autoProtocol.trim().toLowerCase();
		}

		if (typeof rawCapability.preservesUnknownRelTokens === 'boolean') {
			normalized.preservesUnknownRelTokens = rawCapability.preservesUnknownRelTokens;
		}

		return normalized;
	}

	function cloneInlineFormatCapabilities(inlineFormatCapabilities) {
		if (!inlineFormatCapabilities || typeof inlineFormatCapabilities !== 'object' || Array.isArray(inlineFormatCapabilities)) {
			return null;
		}

		const cloned = {};
		Object.keys(inlineFormatCapabilities).forEach((key) => {
			const cleanKey = typeof key === 'string' ? key.trim() : '';
			if (!cleanKey) return;

			const capability = normalizeInlineFormatCapability(inlineFormatCapabilities[key]);
			if (!capability) return;

			cloned[cleanKey] = capability;
		});

		return Object.keys(cloned).length ? cloned : null;
	}

	function normalizeAttributeCapabilityValues(rawValues) {
		if (!Array.isArray(rawValues)) return null;

		const values = rawValues.filter(value => (
			typeof value === 'string' ||
			typeof value === 'number' ||
			typeof value === 'boolean' ||
			value === null
		));

		return values.length ? values : null;
	}

	function normalizeAttributeCapability(rawCapability) {
		if (!rawCapability || typeof rawCapability !== 'object' || Array.isArray(rawCapability)) {
			return null;
		}

		const normalized = {};
		const attribute = typeof rawCapability.attribute === 'string'
			? rawCapability.attribute.trim()
			: '';
		const attributes = Array.isArray(rawCapability.attributes)
			? rawCapability.attributes
				.map(value => (typeof value === 'string' ? value.trim() : ''))
				.filter(Boolean)
			: null;

		if (attribute) {
			normalized.attribute = attribute;
		} else if (attributes && attributes.length) {
			normalized.attributes = attributes;
		} else {
			return null;
		}

		const values = normalizeAttributeCapabilityValues(rawCapability.values);
		if (values) {
			normalized.values = values;
		}

		if (
			Object.prototype.hasOwnProperty.call(rawCapability, 'unsetValue') &&
			(
				typeof rawCapability.unsetValue === 'string' ||
				typeof rawCapability.unsetValue === 'number' ||
				typeof rawCapability.unsetValue === 'boolean' ||
				rawCapability.unsetValue === null
			)
		) {
			normalized.unsetValue = rawCapability.unsetValue;
		}

		return normalized;
	}

	function cloneAttributeCapabilities(attributeCapabilities) {
		if (!attributeCapabilities || typeof attributeCapabilities !== 'object' || Array.isArray(attributeCapabilities)) {
			return null;
		}

		const cloned = {};
		Object.keys(attributeCapabilities).forEach((key) => {
			const cleanKey = typeof key === 'string' ? key.trim() : '';
			if (!cleanKey) return;

			const capability = normalizeAttributeCapability(attributeCapabilities[key]);
			if (!capability) return;

			cloned[cleanKey] = { ...capability };
			if (Array.isArray(capability.attributes)) {
				cloned[cleanKey].attributes = [ ...capability.attributes ];
			}
			if (Array.isArray(capability.values)) {
				cloned[cleanKey].values = [ ...capability.values ];
			}
		});

		return Object.keys(cloned).length ? cloned : null;
	}

	function normalizeEditorOperationValues(rawValues) {
		if (!Array.isArray(rawValues)) return null;

		const values = rawValues.filter(value => (
			typeof value === 'string' ||
			typeof value === 'number' ||
			typeof value === 'boolean' ||
			value === null
		));

		return values.length ? values : null;
	}

	function normalizeEditorOperationStringArray(rawValues) {
		if (!Array.isArray(rawValues)) return null;

		const values = rawValues
			.map(value => (typeof value === 'string' ? value.trim() : ''))
			.filter(Boolean);

		return values.length ? values : null;
	}

	function normalizeEditorOperation(rawOperation) {
		if (!rawOperation || typeof rawOperation !== 'object' || Array.isArray(rawOperation)) {
			return null;
		}

		const id = typeof rawOperation.id === 'string' ? rawOperation.id.trim() : '';
		const kind = typeof rawOperation.kind === 'string' ? rawOperation.kind.trim() : '';
		const component = typeof rawOperation.component === 'string' ? rawOperation.component.trim() : '';
		if (!id || !kind || !component) {
			return null;
		}

		const normalized = { id, kind, component };
		const attribute = typeof rawOperation.attribute === 'string' ? rawOperation.attribute.trim() : '';
		const format = typeof rawOperation.format === 'string' ? rawOperation.format.trim() : '';
		const attributes = normalizeEditorOperationStringArray(rawOperation.attributes);
		const formats = normalizeEditorOperationStringArray(rawOperation.formats);
		const targetModes = normalizeEditorOperationStringArray(rawOperation.targetModes);
		const values = normalizeEditorOperationValues(rawOperation.values);

		if (attribute) {
			normalized.attribute = attribute;
		}
		if (attributes) {
			normalized.attributes = attributes;
		}
		if (format) {
			normalized.format = format;
		}
		if (formats) {
			normalized.formats = formats;
		}
		if (targetModes) {
			normalized.targetModes = targetModes;
		}
		if (values) {
			normalized.values = values;
		}
		if (Object.prototype.hasOwnProperty.call(rawOperation, 'unsetValue')) {
			normalized.unsetValue = rawOperation.unsetValue;
		}
		if (typeof rawOperation.preserveInlineFormatting === 'boolean') {
			normalized.preserveInlineFormatting = rawOperation.preserveInlineFormatting;
		}
		if (typeof rawOperation.preserveUnchangedText === 'boolean') {
			normalized.preserveUnchangedText = rawOperation.preserveUnchangedText;
		}
		if (typeof rawOperation.preserveUnspecifiedAttributes === 'boolean') {
			normalized.preserveUnspecifiedAttributes = rawOperation.preserveUnspecifiedAttributes;
		}
		if (typeof rawOperation.mergeRelTokens === 'boolean') {
			normalized.mergeRelTokens = rawOperation.mergeRelTokens;
		}

		return normalized;
	}

	function cloneEditorOperations(rawOperations) {
		if (!Array.isArray(rawOperations)) return null;

		const normalized = rawOperations
			.map(normalizeEditorOperation)
			.filter(Boolean);

		return normalized.length ? normalized : null;
	}

	/**
	 * Resolve the concrete toolbar format config for one text component.
	 *
	 * @param {HTMLElement|null} element        Active editable element.
	 * @param {Object}           runtimeOptions Normalized component editor options.
	 * @returns {Array<Object|Array>} Concrete toolbar format definitions.
	 */
	function resolveComponentFormats(element, runtimeOptions) {
		const toolbarManager = SFE.ToolbarManager || null;
		if (toolbarManager && typeof toolbarManager.resolveFormats === 'function') {
			return toolbarManager.resolveFormats(runtimeOptions, element);
		}

		return [];
	}

	/**
	 * Execute one list indentation action for the active rich-text editor host.
	 *
	 * @param {Object|null} editor Active rich-text editor host.
	 * @param {string}      action Tab-mode action: `indent` or `outdent`.
	 * @returns {void}
	 */
	function executeListTabAction(editor, action) {
		if (!editor || typeof editor.executeListStructureOperation !== 'function') {
			return;
		}

		const operationKind = action === 'indent'
			? 'indent_list_item'
			: action === 'outdent'
				? 'outdent_list_item'
				: '';
		if (!operationKind) {
			return;
		}

		editor.executeListStructureOperation({
			kind: operationKind,
		});
	}

	/**
	 * Place caret from click coordinates when available, otherwise at element end.
	 */
	function placeCaretInEditableElement(editableElement, clickEvent) {
		if (!editableElement) return;

		editableElement.focus();
		setTimeout(() => {
			// Guard: element may have been detached from the document between the
			// time this setTimeout was scheduled and when it fires (e.g. during
			// rapid component switches or editor teardown). Calling addRange() on
			// a range whose boundary nodes are not in the document throws:
			//   "addRange(): The given range isn't in document."
			if (!document.body.contains(editableElement)) return;

			const selection = window.getSelection();
			const range     = document.createRange();
			const placeholderApi = SFE.RichTextPlaceholder || null;
			const placeholderCaret = (
				placeholderApi &&
				typeof placeholderApi.getCaretTarget === 'function'
			)
				? placeholderApi.getCaretTarget(editableElement)
				: null;

			if (placeholderCaret?.node) {
				// Guard placeholder node as well - it may reference a node inside
				// a ghost/placeholder element that was removed between ticks.
				if (!document.body.contains(placeholderCaret.node)) return;

				range.setStart(placeholderCaret.node, placeholderCaret.offset);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
				return;
			}

			if (clickEvent && clickEvent.clientX !== undefined && clickEvent.clientY !== undefined) {
				try {
					let clickRange = null;
					if (document.caretPositionFromPoint) {
						const pos = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY);
						if (pos) {
							clickRange = document.createRange();
							clickRange.setStart(pos.offsetNode, pos.offset);
							clickRange.collapse(true);
						}
					} else if (document.caretRangeFromPoint) {
						clickRange = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
					}

					if (clickRange && editableElement.contains(clickRange.startContainer)) {
						selection.removeAllRanges();
						selection.addRange(clickRange);
						return;
					}
				} catch (e) { /* ignore */ }
			}

			range.selectNodeContents(editableElement);
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
		}, 0);
	}

	/**
	 * Find the first selector match that belongs to this block root (not a nested block).
	 */
	function findScopedComponentElement(rootElement, selector) {
		if (!rootElement || !selector) return null;

		if (rootElement.matches(selector)) {
			const owner = rootElement.closest('[data-mwp-sfe-uuid]');
			if (!owner || owner === rootElement) return rootElement;
		}

		const matches = rootElement.querySelectorAll(selector);
		for (const candidate of matches) {
			const owner = candidate.closest('[data-mwp-sfe-uuid]');
			if (!owner || owner === rootElement) {
				return candidate;
			}
		}
		return null;
	}

	function getEditableComponentFromTarget(components, target) {
		if (!target) return null;
		const targetEl = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
		if (!targetEl) return null;

		const distanceToAncestor = (descendant, ancestor) => {
			let steps = 0;
			let node = descendant;
			while (node && node !== ancestor) {
				node = node.parentElement;
				steps++;
			}
			return node === ancestor ? steps : null;
		};

		let bestComponent = null;
		let bestScore = Number.POSITIVE_INFINITY;

		components.forEach(component => {
			if (!component?.element) return;

			let score = null;

			// Exact target match has highest priority.
			if (component.element === targetEl) {
				score = 0;
			} else {
				// Prefer the closest containing component when multiple components overlap.
				const containsDistance = distanceToAncestor(targetEl, component.element);
				if (containsDistance !== null) {
					score = containsDistance;
				} else if (isFileComponent(component) && targetEl.contains(component.element)) {
					// Fallback for file components when clicking a wrapper around the media element.
					const wrapperDistance = distanceToAncestor(component.element, targetEl);
					if (wrapperDistance !== null) {
						score = 100 + wrapperDistance;
					}
				}
			}

			if (score !== null && score < bestScore) {
				bestScore = score;
				bestComponent = component;
			}
		});

		return bestComponent;
	}

	function resolveInitialEditableComponent(components, clickEvent, preferredComponentId = '') {
		const normalizedPreferredComponentId = String(preferredComponentId || '').trim();
		if (normalizedPreferredComponentId) {
			const preferredComponent = components.find(component => component?.id === normalizedPreferredComponentId);
			if (preferredComponent) {
				return preferredComponent;
			}
		}

		const fromClick = getEditableComponentFromTarget(components, clickEvent?.target || null);
		if (fromClick) return fromClick;
		return components.find(component => component.default) || components[0] || null;
	}

	function normalizeComponentEditorOptions(rawEditorOptions) {
		if (!rawEditorOptions || typeof rawEditorOptions !== 'object') {
			return {};
		}

		const normalized = {};

		if (typeof rawEditorOptions.enterMode === 'string') {
			const mode = rawEditorOptions.enterMode.trim().toLowerCase();
			if (mode === 'auto' || mode === 'always' || mode === 'never' || mode === 'linebreak') {
				normalized.enterMode = mode;
			}
		}

		if (typeof rawEditorOptions.linkUIMode === 'string') {
			const mode = rawEditorOptions.linkUIMode.trim().toLowerCase();
			if (mode === 'auto' || mode === 'manual') {
				normalized.linkUIMode = mode;
			}
		}

		if (rawEditorOptions.tabMode && typeof rawEditorOptions.tabMode === 'object') {
			const tabMode = {};
			const tabAction = typeof rawEditorOptions.tabMode.tab === 'string'
				? rawEditorOptions.tabMode.tab.trim()
				: '';
			const shiftTabAction = typeof rawEditorOptions.tabMode.shiftTab === 'string'
				? rawEditorOptions.tabMode.shiftTab.trim()
				: '';
			const isValidTabAction = (action) => (
				action === 'none' ||
				action === 'indent' ||
				action === 'outdent' ||
				action === 'nextComponent' ||
				action === 'previousComponent'
			);

			if (isValidTabAction(tabAction)) {
				tabMode.tab = tabAction;
			}

			if (isValidTabAction(shiftTabAction)) {
				tabMode.shiftTab = shiftTabAction;
			}

			if (Object.keys(tabMode).length) {
				normalized.tabMode = tabMode;
			}
		}

		if (rawEditorOptions.options && typeof rawEditorOptions.options === 'object') {
			const options = {};
			if (rawEditorOptions.options.preserveNewlines === true) {
				options.preserveNewlines = true;
			}
			if (rawEditorOptions.options.newlinesToBR === true) {
				options.newlinesToBR = true;
			}
			if (Object.keys(options).length) {
				normalized.options = options;
			}
		}

		if (rawEditorOptions.formatTargets && typeof rawEditorOptions.formatTargets === 'object') {
			const targets = {};
			Object.keys(rawEditorOptions.formatTargets).forEach((key) => {
				const cleanKey = typeof key === 'string' ? key.trim() : '';
				const value = rawEditorOptions.formatTargets[key];
				const cleanValue = typeof value === 'string' ? value.trim() : '';
				if (!cleanKey || !cleanValue) return;
				targets[cleanKey] = cleanValue;
			});

			if (Object.keys(targets).length) {
				normalized.formatTargets = targets;
			}
		}

		const formatsSpec = normalizeEditorFormatsSpec(rawEditorOptions.formats);
		if (formatsSpec) {
			normalized.formats = formatsSpec;
		}

		const inlineFormatCapabilities = cloneInlineFormatCapabilities(rawEditorOptions.inlineFormatCapabilities);
		if (inlineFormatCapabilities) {
			normalized.inlineFormatCapabilities = inlineFormatCapabilities;
		}

		const attributeCapabilities = cloneAttributeCapabilities(rawEditorOptions.attributeCapabilities);
		if (attributeCapabilities) {
			normalized.attributeCapabilities = attributeCapabilities;
		}

		const operations = cloneEditorOperations(rawEditorOptions.operations);
		if (operations) {
			normalized.operations = operations;
		}

		return normalized;
	}

	function normalizeComponentPlaceholder(rawPlaceholder) {
		if (typeof rawPlaceholder !== 'string') {
			return '';
		}

		return rawPlaceholder.trim();
	}

	/**
	 * Normalize the schema media descriptor attached to a file component.
	 *
	 * @param {object|null} component Editable component definition.
	 * @param {string}      id        Normalized component id.
	 * @param {string}      selector  Normalized component selector.
	 * @param {object|null} target    Normalized schema target definition.
	 * @returns {object|null} Normalized schema media descriptor, or null when invalid.
	 */
	function normalizeSchemaMediaDescriptor(component, id, selector, target) {
		const MediaHelper = SFE.MediaHelper || null;
		const rawDescriptor = component?.mediaDescriptor && typeof component.mediaDescriptor === 'object'
			? component.mediaDescriptor
			: null;
		const descriptor = rawDescriptor || {
			componentId: id,
			scopeSelector: selector,
			targetSelector: target?.selector || '',
			attribute: target?.attribute || '',
			mediaType: target?.mediaType || '',
		};

		if (!MediaHelper?.isSchemaMediaDescriptor?.(descriptor)) {
			return null;
		}

		return {
			componentId: typeof descriptor.componentId === 'string' && descriptor.componentId.trim()
				? descriptor.componentId.trim()
				: id,
			scopeSelector: typeof descriptor.scopeSelector === 'string' && descriptor.scopeSelector.trim()
				? descriptor.scopeSelector.trim()
				: selector,
			targetSelector: descriptor.targetSelector.trim(),
			attribute: descriptor.attribute.trim().toLowerCase(),
			mediaType: descriptor.mediaType.trim().toLowerCase(),
		};
	}

	/**
	 * Collect normalized editable schema components for the active block root.
	 *
	 * @param {HTMLElement} rootElement Active block root element.
	 * @param {object}      handler     Active schema-backed handler.
	 * @returns {Array<object>} Normalized editable component definitions.
	 */
	function collectEditableComponents(rootElement, handler) {
		const ElementPrep = SFE.ElementPrep;
		const configured  = handler?.client_config?.editableComponents;
		if (!Array.isArray(configured) || !configured.length) return [];

		const normalized = [];
		const seenIds    = new Set();

		configured.forEach((component, index) => {
			if (!component || typeof component !== 'object') return;

			const selector = typeof component.selector === 'string' ? component.selector.trim() : '';
			if (!selector) return;

			const componentType = (
				typeof component.type === 'string' &&
				component.type.trim().toLowerCase() === 'file'
			) ? 'file' : 'text';
			const attribute = typeof component.attribute === 'string' ? component.attribute.trim() : '';
			if (componentType !== 'file' && !attribute) return;

			const providedElement = component.element && component.element.nodeType === Node.ELEMENT_NODE
				? component.element
				: null;
			const element = (
				providedElement &&
				(rootElement === providedElement || rootElement.contains(providedElement))
			)
				? providedElement
				: findScopedComponentElement(rootElement, selector);
			if (!element) return;

			const idRaw = typeof component.id === 'string' ? component.id.trim() : '';
			const id    = idRaw || `component_${index + 1}`;
			if (seenIds.has(id)) return;
			seenIds.add(id);

			const normalizedComponent = {
				id,
				label: typeof component.label === 'string' && component.label.trim()
					? component.label.trim()
					: id,
				selector,
				type: componentType,
				default: !!component.default,
				element,
				// Keep a lossless snapshot for emergency cancel restore fallback paths.
				originalRestoreOuterHTML: element.outerHTML,
				originalHTML: ElementPrep.getCleanHTML(element),
				originalOuterHTML: ElementPrep.getCleanHTML(element, true),
				editorOptions: normalizeComponentEditorOptions(component.editor),
				placeholder: normalizeComponentPlaceholder(component.placeholder),
				isGhost: !!component.isGhost || element.getAttribute('data-mwp-sfe-ghost') === '1',
			};

			if (component.missingUI && typeof component.missingUI === 'object') {
				normalizedComponent.missingUI = component.missingUI;
			}

			if (componentType === 'file') {
				const target = component.target && typeof component.target === 'object'
					? component.target
					: null;
				const targetSelector = typeof target?.selector === 'string' ? target.selector.trim() : '';
				const targetAttribute = typeof target?.attribute === 'string' ? target.attribute.trim().toLowerCase() : '';
				const mediaType = typeof target?.mediaType === 'string' ? target.mediaType.trim().toLowerCase() : '';
				if (!targetSelector || !targetAttribute || !mediaType) return;

				normalizedComponent.target = {
					selector: targetSelector,
					attribute: targetAttribute,
					mediaType,
				};
				normalizedComponent.mediaDescriptor = normalizeSchemaMediaDescriptor(
					component,
					id,
					selector,
					normalizedComponent.target
				);
				if (!normalizedComponent.mediaDescriptor) return;
				normalizedComponent.urlBindingPath = typeof component.urlBindingPath === 'string'
					? component.urlBindingPath.trim()
					: '';
				normalizedComponent.idBindingPath = typeof component.idBindingPath === 'string'
					? component.idBindingPath.trim()
					: '';
			} else {
				normalizedComponent.attribute = attribute;
			}

			normalized.push(normalizedComponent);
		});

		if (normalized.length && !normalized.some(component => component.default)) {
			normalized[0].default = true;
		}

		return normalized;
	}

	function stripEditableComponentState(component, editorState) {
		if (!component?.element) return;
		const elementPrep = SFE.ElementPrep || null;

		component.element.classList.remove(
			'mwp-sfe-inline-editor',
			'mwp-sfe-component-active',
			'mwp-sfe-editable-component',
			'mwp-sfe-editor-content'
		);
		if (elementPrep && typeof elementPrep.pruneEmptyClassAttribute === 'function') {
			elementPrep.pruneEmptyClassAttribute(component.element);
		}
		component.element.removeAttribute('data-mwp-sfe-editable-component');
		component.element.removeAttribute('data-mwp-sfe-active-component');

		if (component.element._mwpEditor === editorState?.mwpEditor) {
			delete component.element._mwpEditor;
		}

		if (editorState?._mwpActiveComponentType !== 'text' || component.id !== editorState?.activeComponentId) {
			component.element.removeAttribute('contenteditable');
			component.element.removeAttribute('spellcheck');
		}
	}

	function applyEditableComponentState(component) {
		if (!component?.element) return;
		component.element.classList.add('mwp-sfe-editable-component');
		component.element.dataset.mwpSfeEditableComponent = component.id;
	}

	function buildComponentEditorRuntimeOptions(editorState, component) {
		const runtimeOptions = {
			enterMode:     'auto',
			linkUIMode:    'auto',
			formatTargets: {},
		};

		if (editorState?.element) {
			runtimeOptions.blockRootElement = editorState.element;
		}

		const editorOptions = component?.editorOptions;
		if (!editorOptions || typeof editorOptions !== 'object') {
			return runtimeOptions;
		}

		if (typeof editorOptions.enterMode === 'string') {
			runtimeOptions.enterMode = editorOptions.enterMode;
		}

		if (typeof editorOptions.linkUIMode === 'string') {
			runtimeOptions.linkUIMode = editorOptions.linkUIMode;
		}

		if (editorOptions.formatTargets && typeof editorOptions.formatTargets === 'object') {
			runtimeOptions.formatTargets = { ...editorOptions.formatTargets };
		}

		if (Array.isArray(editorOptions.formats)) {
			runtimeOptions.formats = cloneEditorFormatsSpec(editorOptions.formats);
		}

		if (editorOptions.inlineFormatCapabilities && typeof editorOptions.inlineFormatCapabilities === 'object') {
			const inlineFormatCapabilities = cloneInlineFormatCapabilities(editorOptions.inlineFormatCapabilities);
			if (inlineFormatCapabilities) {
				runtimeOptions.inlineFormatCapabilities = inlineFormatCapabilities;
			}
		}

		if (editorOptions.attributeCapabilities && typeof editorOptions.attributeCapabilities === 'object') {
			const attributeCapabilities = cloneAttributeCapabilities(editorOptions.attributeCapabilities);
			if (attributeCapabilities) {
				runtimeOptions.attributeCapabilities = attributeCapabilities;
			}
		}

		if (Array.isArray(editorOptions.operations)) {
			const operations = cloneEditorOperations(editorOptions.operations);
			if (operations) {
				runtimeOptions.operations = operations;
			}
		}

		if (editorOptions.options && typeof editorOptions.options === 'object') {
			runtimeOptions.options = { ...editorOptions.options };
		}

		if (typeof component?.placeholder === 'string' && component.placeholder.trim()) {
			runtimeOptions.placeholder = component.placeholder.trim();
		}

		if (typeof component?.id === 'string' && component.id.trim()) {
			runtimeOptions.componentId = component.id.trim();
		}

		if (component?.missingUI && typeof component.missingUI === 'object') {
			runtimeOptions.missingUI = component.missingUI;
		}

		return runtimeOptions;
	}

	function isFileComponent(component) {
		return component?.type === 'file';
	}

	function bindInlineEditButtons(editorState) {
		const actionsContainer = editorState?.actionsContainer;
		if (!actionsContainer) return;

		if (actionsContainer._saveBtn) {
			actionsContainer._saveBtn.addEventListener('click', e => {
				e.preventDefault();
				e.stopImmediatePropagation();
				SFE.handleInlineSave(editorState);
			});
		}

		if (actionsContainer._cancelBtn) {
			actionsContainer._cancelBtn.addEventListener('click', e => {
				e.preventDefault();
				e.stopImmediatePropagation();
				SFE.closeInPlaceEditor(editorState, true);
			});
		}
	}

	function restoreInlineEditButtons(editorState) {
		const ctx              = SFE.Context;
		const actionBar        = ctx?.actionBar;
		const buttonManager    = ctx?.buttonManager;
		const actionsContainer = editorState?.actionsContainer;
		if (!actionBar || !buttonManager || !actionsContainer) return;

		actionBar.updateState({
			bar: actionsContainer,
			element: editorState.element,
			state: 'edit',
			content: buttonManager.getEditButtons(),
		});
		bindInlineEditButtons(editorState);
	}

	function cleanupSchemaMediaSession(editorState, options = {}) {
		if (!editorState) return;
		const session = editorState._mwpSchemaMediaSession;
		if (session && typeof session.cleanup === 'function') {
			session.cleanup(options);
		}
		editorState.activeSchemaHost = null;
		delete editorState._mwpSchemaMediaSession;
	}

	/**
	 * Resolve the current primary rich-text host for one active editor state.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {Object|null} Current text editor host, or null.
	 */
	function resolveCurrentTextEditorHost(editorState) {
		return SFE.SchemaEditorHost?.resolveTextEditorHost?.(editorState) || null;
	}

	function setupSharedEditorLifecycle(editorState) {
		const { debouncedPosition } = SFE.PositionManager;
		const actionsContainer = editorState?.actionsContainer || null;
		const element = editorState?.element || null;
		if (!editorState || !element || !actionsContainer) {
			return;
		}

		actionsContainer.classList.add('mwp-sfe-inline-editor');

		if (!editorState._mwpInlineButtonsBound) {
			bindInlineEditButtons(editorState);
			editorState._mwpInlineButtonsBound = true;
		}

		if (!editorState.cleanupFocus) {
			editorState.cleanupFocus = () => {};
		}

		if (!editorState.updatePositions) {
			const updatePositions = () => debouncedPosition(
				editorState.element || null,
				editorState.toolbarContainer || null,
				editorState.actionsContainer || null
			);
			window.addEventListener('scroll', updatePositions, true);
			editorState.updatePositions = updatePositions;
		}

		if (
			!editorState.resizeObserver ||
			editorState._mwpObservedEditorElement !== element
		) {
			if (editorState.resizeObserver) {
				editorState.resizeObserver.disconnect();
			}

			const resizeObserver = new ResizeObserver(editorState.updatePositions);
			resizeObserver.observe(element);
			editorState.resizeObserver = resizeObserver;
			editorState._mwpObservedEditorElement = element;
		}

		if (!editorState.escapeHandler) {
			const escapeHandler = (e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					const textEditorHost = resolveCurrentTextEditorHost(editorState);
					const mediaSession = editorState._mwpSchemaMediaSession;
					if (
						editorState._mwpActiveComponentType === 'file' &&
						mediaSession &&
						typeof mediaSession.handleEscape === 'function' &&
						mediaSession.handleEscape()
					) {
						return;
					}
					if (textEditorHost && textEditorHost._linkUIActive && typeof textEditorHost.closeLinkUI === 'function') {
						textEditorHost.closeLinkUI();
					} else {
						SFE.closeInPlaceEditor(editorState, true);
					}
				}
			};
			document.addEventListener('keydown', escapeHandler);
			editorState.escapeHandler = escapeHandler;
		}

	}

	function showToolbar(toolbar) {
		if (!toolbar) return;
		if (toolbar._mwpSwitchHideTimeout) {
			clearTimeout(toolbar._mwpSwitchHideTimeout);
			delete toolbar._mwpSwitchHideTimeout;
		}
		toolbar.classList.remove('mwp-sfe-closing');
		toolbar.style.display = '';
	}

	function teardownEditableComponentSwitching(editorState) {
		if (!editorState) return;
		const switchTarget = editorState._mwpComponentSwitchTarget || editorState.element || null;
		if (!switchTarget) return;

		if (editorState.componentSwitchHandler) {
			switchTarget.removeEventListener('mousedown', editorState.componentSwitchHandler, true);
			delete editorState.componentSwitchHandler;
		}
		if (editorState.componentClickGuard) {
			switchTarget.removeEventListener('click', editorState.componentClickGuard, true);
			delete editorState.componentClickGuard;
		}
		if (editorState.componentTabHandler) {
			switchTarget.removeEventListener('keydown', editorState.componentTabHandler, true);
			delete editorState.componentTabHandler;
		}
		delete editorState._mwpComponentSwitchTarget;
	}

	function activateEditableComponent(editorState, targetComponent, clickEvent, options = {}) {
		const overlayManager = SFE.OverlayManager;
		if (!editorState || !targetComponent || !targetComponent.element) return;
		if (!editorState.actionsContainer) return;
		const shouldPlaceCaret = options?.placeCaret !== false;

		const previousComponent = editorState.activeEditableComponent || null;
		const targetIsFile = isFileComponent(targetComponent);
		if (previousComponent && previousComponent.id === targetComponent.id) {
			if (!targetIsFile && shouldPlaceCaret) {
				placeCaretInEditableElement(targetComponent.element, clickEvent);
			}
			return;
		}

		if (previousComponent && previousComponent.element) {
			const textEditorHost = resolveCurrentTextEditorHost(editorState);
			previousComponent.element.classList.remove('mwp-sfe-component-active', 'mwp-sfe-inline-editor', 'mwp-sfe-editor-content');
			previousComponent.element.removeAttribute('contenteditable');
			previousComponent.element.removeAttribute('spellcheck');
			previousComponent.element.removeAttribute('data-mwp-sfe-active-component');
			if (previousComponent.element._mwpEditor === textEditorHost) {
				delete previousComponent.element._mwpEditor;
			}
		}

		cleanupSchemaMediaSession(editorState, { preserveChanges: true });

		if (targetIsFile) {
			const textEditorHost = resolveCurrentTextEditorHost(editorState);
			editorState.activeSchemaHost = null;
			if (textEditorHost && textEditorHost._linkUIActive && typeof textEditorHost.closeLinkUI === 'function') {
				textEditorHost.closeLinkUI();
			}
			if (textEditorHost?.toolbarManager && typeof textEditorHost.toolbarManager.destroy === 'function') {
				textEditorHost.toolbarManager.destroy();
			}

			targetComponent.element.classList.add('mwp-sfe-component-active');
			targetComponent.element.dataset.mwpSfeActiveComponent = targetComponent.id;

			editorState.activeEditableComponent = targetComponent;
			editorState.activeComponentId       = targetComponent.id;
			editorState._mwpActiveComponentType = 'file';

			if (overlayManager) {
				overlayManager.updateActiveElement(targetComponent.element);
			}

			const mediaEditor = SFE.MediaEditor;
			if (mediaEditor && typeof mediaEditor.startSchemaComponentEditing === 'function') {
				editorState._mwpSchemaMediaSession = mediaEditor.startSchemaComponentEditing(editorState, targetComponent, {
					onCancel: () => SFE.closeInPlaceEditor(editorState, true),
				});
			} else {
				editorState._mwpActiveComponentType = 'text';
				if (editorState.toolbarContainer) {
					showToolbar(editorState.toolbarContainer);
				}
				restoreInlineEditButtons(editorState);
			}

			if (previousComponent && previousComponent.id !== targetComponent.id && SFE.PublicApiBridge) {
				SFE.PublicApiBridge.emitEditorEvent('editor:componentChanged', editorState, {
					source: 'sfe',
				});
			}
			return;
		}

		if (editorState._mwpActiveComponentType === 'file') {
			restoreInlineEditButtons(editorState);
		}
		setupSharedTextEditing(editorState, targetComponent.element, clickEvent, targetComponent, {
			placeCaret: shouldPlaceCaret,
		});

		const textEditorHost = resolveCurrentTextEditorHost(editorState);
		if (!textEditorHost) return;

		targetComponent.element._mwpEditor = textEditorHost;
		targetComponent.element.classList.add('mwp-sfe-inline-editor', 'mwp-sfe-component-active');
		targetComponent.element.dataset.mwpSfeActiveComponent = targetComponent.id;

		editorState.activeEditableComponent = targetComponent;
		editorState.activeComponentId       = targetComponent.id;
		editorState._mwpActiveComponentType = 'text';

		if (overlayManager) {
			overlayManager.updateActiveElement(targetComponent.element);
		}

		if (previousComponent && previousComponent.id !== targetComponent.id && SFE.PublicApiBridge) {
			SFE.PublicApiBridge.emitEditorEvent('editor:componentChanged', editorState, {
				source: 'sfe',
			});
		}
	}

	/**
	 * Activate one editable component by its public component identifier.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @param {string}      componentId Target component identifier.
	 * @returns {boolean} Whether activation succeeded.
	 */
	function activateEditableComponentById(editorState, componentId) {
		if (!editorState || !Array.isArray(editorState.editableComponents)) {
			return false;
		}

		const normalizedComponentId = String(componentId || '').trim();
		if (!normalizedComponentId) {
			return false;
		}

		const targetComponent = editorState.editableComponents.find(component => component?.id === normalizedComponentId) || null;
		if (!targetComponent) {
			return false;
		}

		activateEditableComponent(editorState, targetComponent, null);
		return true;
	}

	/**
	 * Clone one plain object used for tracked block attribute changes.
	 *
	 * @param {Object|null} attributeChanges Source attribute map.
	 * @returns {Object} Cloned plain attribute map.
	 */
	function cloneAttributeChanges(attributeChanges) {
		return attributeChanges && typeof attributeChanges === 'object'
			? { ...attributeChanges }
			: {};
	}

	/**
	 * Replace the shared tracked block attribute map in place.
	 *
	 * @param {Object}      editorState      Active editor state.
	 * @param {Object|null} nextChanges Plain attribute-change map.
	 * @returns {void}
	 */
	function replaceAttributeChanges(editorState, nextChanges) {
		if (!editorState) {
			return;
		}

		const target = (
			editorState.attributeChanges &&
			typeof editorState.attributeChanges === 'object' &&
			!Array.isArray(editorState.attributeChanges)
		)
			? editorState.attributeChanges
			: (editorState.attributeChanges = {});

		Object.keys(target).forEach((key) => {
			delete target[key];
		});

		if (nextChanges && typeof nextChanges === 'object' && !Array.isArray(nextChanges)) {
			Object.keys(nextChanges).forEach((key) => {
				target[key] = nextChanges[key];
			});
		}

		if (editorState.mwpEditor && typeof editorState.mwpEditor === 'object') {
			editorState.mwpEditor.attributeChanges = target;
		}
	}

	/**
	 * Capture one block-scoped session snapshot from the live editor DOM.
	 *
	 * @param {Object} editorState Active editor state.
	 * @returns {Object|null} Block snapshot or null.
	 */
	function captureBlockSessionSnapshot(editorState) {
		const ElementPrep = SFE.ElementPrep || null;
		if (!editorState?.element) {
			return null;
		}

		const rootOuterHTML = (
			ElementPrep &&
			typeof ElementPrep.getCleanHTML === 'function'
		)
			? ElementPrep.getCleanHTML(editorState.element, true)
			: editorState.element.outerHTML;

		return {
			rootOuterHTML,
			activeComponentId: String(
				editorState.activeComponentId ||
				editorState.activeEditableComponent?.id ||
				''
			).trim(),
			activeComponentType: String(editorState._mwpActiveComponentType || '').trim() || 'text',
			attributeChanges: cloneAttributeChanges(editorState.attributeChanges),
			rootMediaChanges: cloneAttributeChanges(editorState.element?._mwpMediaChanges || null),
		};
	}

	/**
	 * Capture the current active text selection for one block session snapshot.
	 *
	 * @param {Object} editorState Active editor state.
	 * @returns {*} Saved selection snapshot or null.
	 */
	function captureBlockSessionSelection(editorState) {
		const mwpEditor = editorState?.mwpEditor || null;
		if (
			editorState?._mwpActiveComponentType !== 'text' ||
			!mwpEditor ||
			typeof mwpEditor.isSelectionInEditor !== 'function' ||
			typeof mwpEditor.saveCursorPosition !== 'function' ||
			!mwpEditor.isSelectionInEditor()
		) {
			return null;
		}

		const selection = mwpEditor.saveCursorPosition();
		if (!selection || typeof selection !== 'object') {
			return selection || null;
		}

		// Block-session history is JSON-cloned, so strip any live DOM references
		// from the shared selection snapshot here instead of changing MWPEditor's
		// native cursor snapshot shape used by live list keyboard flows.
		const sanitizedSelection = { ...selection };
		delete sanitizedSelection.listItem;
		delete sanitizedSelection.container;
		return sanitizedSelection;
	}

	/**
	 * Resolve the session-owned history API for the active text scope.
	 *
	 * @param {Object} editorState Active editor state.
	 * @returns {Object|null} Session history API, or null when unavailable.
	 */
	function getTextSessionHistoryApi(editorState) {
		if (typeof editorState?.getSessionHistoryApi === 'function') {
			return editorState.getSessionHistoryApi('text');
		}

		const blockEditSession = editorState?.blockEditSession || null;
		if (!blockEditSession || typeof blockEditSession.getHistoryApi !== 'function') {
			return null;
		}

		return blockEditSession.getHistoryApi('text');
	}

	/**
	 * Seed the text session's initial entry with the current live block-attribute
	 * state once the active component is fully registered.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} mwpEditor   Active rich-text editor instance.
	 * @returns {void}
	 */
	function syncInitialTextHistoryBaseline(editorState, mwpEditor) {
		const historyApi = getTextSessionHistoryApi(editorState);
		if (
			!mwpEditor ||
			!historyApi ||
			typeof historyApi.canReplaceInitialHistoryEntry !== 'function' ||
			!historyApi.canReplaceInitialHistoryEntry()
		) {
			return;
		}

		const executor = SFE.SchemaOperationExecutor || null;
		const operations = Array.isArray(mwpEditor.options?.operations)
			? mwpEditor.options.operations
			: [];
		if (!executor || !operations.length) {
			return;
		}

		let didChange = false;
		operations.forEach((operation) => {
			if (String(operation?.kind || '').trim() !== 'block_attribute_change') {
				return;
			}

			const attributePath = String(operation?.attribute || '').trim();
			if (!attributePath) {
				return;
			}

			let trackedValue;
			if (attributePath === 'level') {
				const currentLevel = mwpEditor.getHeadingLevelState?.();
				trackedValue = Number.isInteger(currentLevel) ? currentLevel : undefined;
			} else if (attributePath === 'align') {
				trackedValue = typeof executor.normalizeBlockAttributeTrackedValue === 'function'
					? executor.normalizeBlockAttributeTrackedValue(operation, mwpEditor.getBlockAlignState?.())
					: mwpEditor.getBlockAlignState?.();
			} else if (
				typeof executor.getTextAlignmentCapability === 'function' &&
				executor.getTextAlignmentCapability(mwpEditor, operation)
			) {
				const textAlignmentCapability = executor.getTextAlignmentCapability(mwpEditor, operation);
				trackedValue = typeof executor.normalizeBlockAttributeTrackedValue === 'function'
					? executor.normalizeBlockAttributeTrackedValue(textAlignmentCapability, mwpEditor.getTextAlignmentState?.())
					: mwpEditor.getTextAlignmentState?.();
			} else {
				return;
			}

			if (
				Object.prototype.hasOwnProperty.call(mwpEditor.attributeChanges, attributePath) &&
				mwpEditor.attributeChanges[attributePath] === trackedValue
			) {
				return;
			}

			mwpEditor.attributeChanges[attributePath] = trackedValue;
			didChange = true;
		});

		if (!didChange) {
			return;
		}

		historyApi.replaceInitialHistoryEntry?.();
		mwpEditor.updateUndoRedoButtons?.();
	}

	/**
	 * Run the shared pre-restore cleanup required before one block snapshot swap.
	 *
	 * @param {Object} editorState Active editor state.
	 * @returns {void}
	 */
	function prepareTextBlockSnapshotRestore(editorState) {
		cleanupSchemaMediaSession(editorState, {
			preserveChanges: true,
			preserveToolbarDom: true,
		});
		teardownEditableComponentSwitching(editorState);
		const textEditorHost = resolveCurrentTextEditorHost(editorState);

		if (
			textEditorHost &&
			typeof textEditorHost.closeLinkUI === 'function' &&
			textEditorHost._linkUIActive
		) {
			textEditorHost.closeLinkUI();
		}
	}

	/**
	 * Rebuild runtime state immediately after the block root has been swapped.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} snapshot    Restored block snapshot.
	 * @param {Object|null} schemaRuntime Optional schema runtime module.
	 * @returns {void}
	 */
	function syncTextBlockSnapshotAfterRootReplace(editorState, snapshot, schemaRuntime = null) {
		// History snapshots intentionally store clean block markup without managed
		// missingUI ghost shells. Re-materialize schema placeholders/ghost
		// components before rebuilding the editable component list so empty
		// optional components stay addressable after undo/redo restores.
		if (schemaRuntime && typeof schemaRuntime.refreshEditorState === 'function') {
			schemaRuntime.refreshEditorState(editorState, {
				blockState: editorState.blockState || null,
				attributeChanges: snapshot?.attributeChanges || {},
			});
		}

		refreshEditableComponents(editorState);
		replaceAttributeChanges(editorState, snapshot?.attributeChanges || {});
		if (snapshot?.rootMediaChanges && typeof snapshot.rootMediaChanges === 'object') {
			editorState.element._mwpMediaChanges = { ...snapshot.rootMediaChanges };
		} else {
			delete editorState.element._mwpMediaChanges;
		}
	}

	/**
	 * Resolve which editable component should be reactivated after restore.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} snapshot    Restored block snapshot.
	 * @returns {Object|false} Activation context or false on failure.
	 */
	function resolveTextBlockSnapshotActivation(editorState, snapshot) {
		const targetComponentId = String(snapshot?.activeComponentId || '').trim();
		const targetComponent = (
			targetComponentId &&
			Array.isArray(editorState.editableComponents)
		)
			? editorState.editableComponents.find(component => component?.id === targetComponentId) || null
			: null;
		const fallbackComponent = targetComponent
			|| editorState.editableComponents?.find(component => component?.default)
			|| editorState.editableComponents?.[0]
			|| null;
		if (!fallbackComponent || !fallbackComponent.element) {
			return false;
		}

		return {
			component: fallbackComponent,
			activeElement: fallbackComponent.element,
		};
	}

	/**
	 * Reactivate the restored editable component without applying default caret placement.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} snapshot    Restored block snapshot.
	 * @param {Object} activation  Resolved activation context.
	 * @returns {Object|false} Activation result or false on failure.
	 */
	function activateTextBlockSnapshot(editorState, snapshot, activation) {
		const fallbackComponent = activation?.component || null;
		if (!fallbackComponent?.element) {
			return false;
		}

		if (snapshot?.activeComponentType === 'file') {
			const textEditorHost = resolveCurrentTextEditorHost(editorState);
			if (
				textEditorHost?.toolbarManager &&
				typeof textEditorHost.toolbarManager.destroy === 'function'
			) {
				textEditorHost.toolbarManager.destroy();
			}
			if (snapshot?.rootMediaChanges && typeof snapshot.rootMediaChanges === 'object') {
				fallbackComponent.element._mwpMediaChanges = { ...snapshot.rootMediaChanges };
			} else if (fallbackComponent.element?._mwpMediaChanges) {
				delete fallbackComponent.element._mwpMediaChanges;
			}
		}

		editorState.activeEditableComponent = null;
		editorState.activeComponentId = '';
		editorState._mwpActiveComponentType = '';

		activateEditableComponent(editorState, fallbackComponent, null, {
			placeCaret: false,
		});

		return {
			activeElement: fallbackComponent.element,
		};
	}

	/**
	 * Restore one text selection after the target component has been reactivated.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {*}      selection   Saved text selection snapshot.
	 * @returns {void}
	 */
	function restoreTextBlockSnapshotSelection(editorState, selection) {
		const textEditorHost = resolveCurrentTextEditorHost(editorState);
		if (
			selection &&
			editorState._mwpActiveComponentType === 'text' &&
			textEditorHost &&
			typeof textEditorHost.restoreCursorPosition === 'function'
		) {
			textEditorHost.restoreCursorPosition(selection);
		}
	}

	/**
	 * Recreate any post-activation runtime sessions and shared editor wiring.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} snapshot    Restored block snapshot.
	 * @param {Object} activation  Resolved activation context.
	 * @param {Object|null} mediaEditor Optional media editor module.
	 * @returns {void}
	 */
	function finalizeTextBlockSnapshotActivation(editorState, snapshot, activation, mediaEditor = null) {
		const fallbackComponent = activation?.component || null;
		if (
			snapshot?.activeComponentType === 'file' &&
			mediaEditor &&
			typeof mediaEditor.startSchemaComponentEditing === 'function' &&
			!editorState._mwpSchemaMediaSession &&
			fallbackComponent
		) {
			editorState._mwpSchemaMediaSession = mediaEditor.startSchemaComponentEditing(editorState, fallbackComponent, {
				onCancel: () => SFE.closeInPlaceEditor(editorState, true),
			});
		}

		setupSharedEditorLifecycle(editorState);
		setupEditableComponentSwitching(editorState);
	}

	/**
	 * Run any deferred layout work required after finalizing one restored block.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} snapshot    Restored block snapshot.
	 * @returns {void}
	 */
	function finalizeTextBlockSnapshotLayout(editorState, snapshot) {
		if (snapshot?.activeComponentType === 'file') {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					editorState.updatePositions?.();
				});
			});
		}
	}

	/**
	 * Build the text-specific restore adapter consumed by the shared block
	 * session restore pipeline.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} snapshot    Session snapshot to restore.
	 * @param {*}      selection   Optional text selection snapshot.
	 * @returns {Object} Restore configuration for BlockEditSession.
	 */
	function buildTextBlockSessionRestoreConfig(editorState, snapshot, selection = null) {
		const mediaEditor = SFE.MediaEditor || null;
		const schemaRuntime = SFE.SchemaRuntime || null;

		return {
			editorState,
			snapshot,
			selection,
			beforeRestore: ({ editorState: activeEditorState }) => {
				prepareTextBlockSnapshotRestore(activeEditorState);
			},
			afterRootReplace: ({ editorState: activeEditorState, snapshot: activeSnapshot }) => {
				syncTextBlockSnapshotAfterRootReplace(activeEditorState, activeSnapshot, schemaRuntime);
			},
			resolveActivation: ({ editorState: activeEditorState, snapshot: activeSnapshot }) => {
				return resolveTextBlockSnapshotActivation(activeEditorState, activeSnapshot);
			},
			activate: ({ editorState: activeEditorState, snapshot: activeSnapshot, activation }) => {
				return activateTextBlockSnapshot(activeEditorState, activeSnapshot, activation);
			},
			restoreSelection: ({ editorState: activeEditorState, selection: selectionToRestore }) => {
				restoreTextBlockSnapshotSelection(activeEditorState, selectionToRestore);
			},
			afterActivate: ({ editorState: activeEditorState, snapshot: activeSnapshot, activation }) => {
				finalizeTextBlockSnapshotActivation(activeEditorState, activeSnapshot, activation, mediaEditor);
			},
			afterFinalize: ({ editorState: activeEditorState, snapshot: activeSnapshot }) => {
				finalizeTextBlockSnapshotLayout(activeEditorState, activeSnapshot);
			},
		};
	}

	/**
	 * Restore one full block-scoped session snapshot into the live editor.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} snapshot Session snapshot to restore.
	 * @param {*}      selection Optional text selection snapshot.
	 * @returns {boolean} Whether restore succeeded.
	 */
	function restoreBlockSessionSnapshot(editorState, snapshot, selection = null) {
		const blockEditSession = editorState?.blockEditSession || null;
		if (
			!editorState?.element ||
			!blockEditSession ||
			typeof blockEditSession.restoreManagedBlockSnapshot !== 'function'
		) {
			return false;
		}

		return blockEditSession.restoreManagedBlockSnapshot(
			buildTextBlockSessionRestoreConfig(editorState, snapshot, selection)
		);
	}

	/**
	 * Build the text snapshot-host registration descriptor for one active block
	 * edit session.
	 *
	 * @param {Object} editorState Active editor state.
	 * @returns {Object} Snapshot-host registration config.
	 */
	function buildTextHistorySnapshotHostConfig(editorState) {
		return {
			editorState,
			scopeId: 'text',
			attachHistoryApi: true,
			seedInitialHistory: true,
			captureSnapshot: ({ editorState: activeEditorState }) => captureBlockSessionSnapshot(activeEditorState),
			captureSelection: ({ editorState: activeEditorState }) => captureBlockSessionSelection(activeEditorState),
			restoreSnapshot: ({ editorState: activeEditorState, snapshot, selectionToRestore }) => {
				restoreBlockSessionSnapshot(activeEditorState, snapshot, selectionToRestore || null);
			},
		};
	}

	/**
	 * Register the active rich-text editor as the block session history host.
	 *
	 * @param {Object} editorState Active editor state.
	 * @param {Object} mwpEditor   Active rich-text editor instance.
	 * @returns {void}
	 */
	function registerTextHistorySessionHost(editorState, mwpEditor) {
		const blockEditSession = editorState?.blockEditSession || null;
		if (!blockEditSession || typeof blockEditSession.registerSnapshotHost !== 'function' || !mwpEditor) {
			return;
		}

		blockEditSession.registerSnapshotHost(
			mwpEditor,
			buildTextHistorySnapshotHostConfig(editorState)
		);
	}

	function cycleEditableComponent(editorState, direction = 1) {
		if (!editorState || !Array.isArray(editorState.editableComponents)) return false;

		const components = editorState.editableComponents.filter(component => component?.element);
		if (components.length < 2) return false;

		const activeId = editorState.activeComponentId;
		let currentIndex = components.findIndex(component => component.id === activeId);
		if (currentIndex < 0) currentIndex = 0;

		const step = direction < 0 ? -1 : 1;
		const nextIndex = (currentIndex + step + components.length) % components.length;
		const nextComponent = components[nextIndex];
		if (!nextComponent || nextComponent.id === activeId) return false;

		activateEditableComponent(editorState, nextComponent, null);
		editorState._suppressNextComponentClick = true;
		return true;
	}

	function refreshEditableComponents(editorState) {
		if (!editorState?.element || !editorState?.handler) return false;
		if (!Array.isArray(editorState.editableComponents)) return false;

		const previousComponents = editorState.editableComponents;
		const nextComponents = collectEditableComponents(editorState.element, editorState.handler);

		previousComponents.forEach(component => {
			if (!component?.id || !component.element) return;
			const stillPresent = nextComponents.some(nextComponent => (
				nextComponent?.id === component.id &&
				nextComponent.element === component.element
			));
			if (stillPresent) return;
			stripEditableComponentState(component, editorState);
		});

		nextComponents.forEach(component => applyEditableComponentState(component));
		editorState.editableComponents = nextComponents;

		if (!nextComponents.length) {
			editorState.activeEditableComponent = null;
			editorState.activeComponentId = '';
			return false;
		}

		const activeId = editorState.activeComponentId || editorState.activeEditableComponent?.id || '';
		const nextActive = activeId
			? nextComponents.find(component => component.id === activeId) || null
			: null;

		if (nextActive) {
			editorState.activeEditableComponent = nextActive;
			editorState.activeComponentId = nextActive.id;

			if (editorState._mwpActiveComponentType === 'text') {
				nextActive.element._mwpEditor = editorState.mwpEditor;
				nextActive.element.classList.add('mwp-sfe-inline-editor', 'mwp-sfe-component-active');
				nextActive.element.dataset.mwpSfeActiveComponent = nextActive.id;
				nextActive.element.setAttribute('contenteditable', 'true');
				nextActive.element.setAttribute('spellcheck', 'true');
			} else if (editorState._mwpActiveComponentType === 'file') {
				nextActive.element.classList.add('mwp-sfe-component-active');
				nextActive.element.dataset.mwpSfeActiveComponent = nextActive.id;
			}

			return true;
		}

		const fallbackComponent = nextComponents.find(component => component.default) || nextComponents[0] || null;
		if (!fallbackComponent) {
			editorState.activeEditableComponent = null;
			editorState.activeComponentId = '';
			return false;
		}

		activateEditableComponent(editorState, fallbackComponent, null);
		return true;
	}

	function setupEditableComponentSwitching(editorState) {
		if (!editorState || !Array.isArray(editorState.editableComponents) || !editorState.editableComponents.length) {
			return;
		}
		const switchTarget = editorState.element;
		if (!switchTarget) return;
		teardownEditableComponentSwitching(editorState);

		const getTabModeAction = (component, shiftKey) => {
			const tabMode = component?.editorOptions?.tabMode;
			if (!tabMode || typeof tabMode !== 'object') return '';
			const action = shiftKey ? tabMode.shiftTab : tabMode.tab;
			return typeof action === 'string' ? action : '';
		};

		const switchHandler = (event) => {
			const targetComponent = getEditableComponentFromTarget(editorState.editableComponents, event.target);
			if (!targetComponent) {
				return;
			}

			if (targetComponent.id === editorState.activeComponentId) {
				if (isFileComponent(targetComponent)) {
					event.preventDefault();
					event.stopPropagation();
				}
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			activateEditableComponent(editorState, targetComponent, event);
			editorState._suppressNextComponentClick = true;
		};

		const clickGuard = (event) => {
			if (editorState._suppressNextComponentClick) {
				editorState._suppressNextComponentClick = false;
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			const targetComponent = getEditableComponentFromTarget(editorState.editableComponents, event.target);
			if (!targetComponent) {
				return;
			}
			if (isFileComponent(targetComponent) || targetComponent.id !== editorState.activeComponentId) {
				event.preventDefault();
				event.stopPropagation();
			}
		};

		const tabHandler = (event) => {
			if (event.key !== 'Tab') return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (!editorState.actionsContainer || !document.body.contains(editorState.actionsContainer)) {
				teardownEditableComponentSwitching(editorState);
				return;
			}

			const activeComponent = editorState.activeEditableComponent;
			if (!activeComponent) return;
			const tabAction = getTabModeAction(activeComponent, event.shiftKey);
			if (!tabAction) return;

			if (tabAction === 'nextComponent' || tabAction === 'previousComponent') {
				if (cycleEditableComponent(editorState, tabAction === 'previousComponent' ? -1 : 1)) {
					event.preventDefault();
					event.stopPropagation();
				}
				return;
			}

			if (tabAction === 'indent' || tabAction === 'outdent') {
				event.preventDefault();
				event.stopPropagation();

				const editor = editorState.mwpEditor;
				const inList = !!(editor && typeof editor.getParentList === 'function' && editor.getParentList());
				if (inList) {
					executeListTabAction(editor, tabAction);
				}
				return;
			}

			if (tabAction === 'none') {
				event.preventDefault();
				event.stopPropagation();
			}
		};

		switchTarget.addEventListener('mousedown', switchHandler, true);
		switchTarget.addEventListener('click', clickGuard, true);
		switchTarget.addEventListener('keydown', tabHandler, true);
		editorState._mwpComponentSwitchTarget = switchTarget;
		editorState.componentSwitchHandler = switchHandler;
		editorState.componentClickGuard = clickGuard;
		editorState.componentTabHandler = tabHandler;
	}

	/**
	 * Shared setup for text-based editing
	 */
	function setupSharedTextEditing(editorState, editableElement, clickEvent, activeComponent = null, options = {}) {
		const { positionFloatingElements } = SFE.PositionManager;
		const { element, handler, actionsContainer } = editorState;
		if (!actionsContainer) return editorState;
		const resolvedActiveComponent = activeComponent || editorState.activeEditableComponent || null;
		const shouldPlaceCaret = options?.placeCaret !== false;

		// Multi-component sessions need the intended active component registered
		// before the block session seeds its initial history baseline. Otherwise
		// undo-to-zero can reactivate the first/default component instead of the
		// component where editing actually started.
		if (resolvedActiveComponent?.id) {
			editorState.activeEditableComponent = resolvedActiveComponent;
			editorState.activeComponentId = resolvedActiveComponent.id;
			editorState._mwpActiveComponentType = 'text';
		}

		editableElement.classList.add('mwp-sfe-inline-editor');
		let toolbarContainer = editorState.toolbarContainer || null;
		if (!toolbarContainer) {
			toolbarContainer = document.createElement('div');
			toolbarContainer.className = 'mwp-sfe-inline-toolbar mwp-sfe-inline-editor';
			toolbarContainer.setAttribute('data-mwp-sfe-control', 'true');
			toolbarContainer.style.pointerEvents = 'auto';
			toolbarContainer.style.display = 'none';
			document.body.appendChild(toolbarContainer);
			editorState.toolbarContainer = toolbarContainer;
		}

		const componentRuntimeOptions = {
			...buildComponentEditorRuntimeOptions(
				editorState,
				resolvedActiveComponent
			),
			toolbarContainer,
			historyApi: getTextSessionHistoryApi(editorState),
		};
		const formats = resolveComponentFormats(editableElement, componentRuntimeOptions);
		componentRuntimeOptions.formats = formats;

		let mwpEditor = resolveCurrentTextEditorHost(editorState) || editorState.mwpEditor || null;
		if (mwpEditor && typeof mwpEditor.reinitialize === 'function') {
			mwpEditor.reinitialize(editableElement, componentRuntimeOptions);
		} else {
			if (mwpEditor && typeof mwpEditor.destroy === 'function') {
				mwpEditor.destroy();
			}
			mwpEditor = new MWPEditor(editableElement, {
				formats,
				...componentRuntimeOptions,
			});
		}

		editorState.mwpEditor = mwpEditor;
		editorState.textEditorHost = mwpEditor;
		editorState.activeSchemaHost = mwpEditor;
		editableElement._mwpEditor = mwpEditor;

		if (editorState.attributeChanges && typeof editorState.attributeChanges === 'object') {
			mwpEditor.attributeChanges = editorState.attributeChanges;
		} else {
			editorState.attributeChanges = mwpEditor.attributeChanges;
		}

		registerTextHistorySessionHost(editorState, mwpEditor);

		toolbarContainer.classList.remove('mwp-sfe-no-position-transition');
		actionsContainer.classList.remove('mwp-sfe-no-position-transition');
		positionFloatingElements(element, toolbarContainer, actionsContainer, true);
		showToolbar(toolbarContainer);
		if (shouldPlaceCaret) {
			placeCaretInEditableElement(editableElement, clickEvent);
		}
		syncInitialTextHistoryBaseline(editorState, mwpEditor);
		editorState._mwpActiveComponentType = 'text';

		setupSharedEditorLifecycle(editorState);

		return editorState;
	}

	/**
	 * Shared plain-text edit setup against the block root element.
	 */
	function startRootTextEditing(commonState, clickEvent) {
		const ElementPrep = SFE.ElementPrep;
		const { element, handler } = commonState;
		const contentType = handler.contentType || 'text';
		const ctx         = SFE.Context;

		let originalContent;
		if (ctx.draftEditState && ctx.draftEditState.draftElement === element && ctx.draftEditState.originalElement) {
			originalContent = ElementPrep.getContent(ctx.draftEditState.originalElement, contentType);
		} else {
			originalContent = ElementPrep.getContent(element, contentType);
		}

		// Capture a clean DOM snapshot now, before MWPEditor modifies anything.
		const originalCleanHTML = ElementPrep.getCleanHTML(element);
		const editorState       = { ...commonState, originalContent, originalCleanHTML };
		return setupSharedTextEditing(editorState, element, clickEvent);
	}

	/**
	 * Content-type-specific: Text Editing
	 * Receives common state, adds text-specific resources, returns complete editor state
	 */
	function startTextEditing(commonState, clickEvent) {
		return startRootTextEditing(commonState, clickEvent);
	}

	/**
	 * Multi-component editing (single block root, multiple switchable sub-components).
	 */
	function startMultiComponentEditing(commonState, clickEvent) {
		const overlayManager       = SFE.OverlayManager;
		const { element, handler } = commonState;
		const editableComponents   = collectEditableComponents(element, handler);

		if (!editableComponents.length) {
			return startRootTextEditing(commonState, clickEvent);
		}

		const initialComponent = resolveInitialEditableComponent(
			editableComponents,
			clickEvent,
			commonState.initialComponentId || ''
		);
		if (!initialComponent || !initialComponent.element) {
			return startRootTextEditing(commonState, clickEvent);
		}

		editableComponents.forEach(component => applyEditableComponentState(component));

		const editorState = {
			...commonState,
			editableComponents,
			activeEditableComponent: null,
			activeComponentId: '',
		};

		// Narrow the active overlay to the selected component instead of full block root.
		if (overlayManager && overlayManager.activeTarget === element) {
			overlayManager.updateActiveElement(initialComponent.element);
		}

		setupSharedEditorLifecycle(editorState);
		setupEditableComponentSwitching(editorState);
		activateEditableComponent(editorState, initialComponent, clickEvent);

		return editorState;
	}

	SFE.TextEditor = {
		startTextEditing,
		startMultiComponentEditing,
		refreshEditableComponents,
		activateEditableComponentById,
		captureBlockSessionSnapshot,
		captureBlockSessionSelection,
		restoreBlockSessionSnapshot
	};

})();
