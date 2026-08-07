/**
 * Shared schema editor host contract helpers.
 *
 * Exposes: SFE.SchemaEditorHost
 */
(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Resolve one tracked attribute value from the host state.
	 *
	 * @param {string} attributePath Canonical block attribute path.
	 * @returns {*} Tracked value when present, otherwise `undefined`.
	 */
	function getTrackedAttributeValue(attributePath) {
		const path = typeof attributePath === 'string' ? attributePath.trim() : '';
		const attributeChanges = this?.attributeChanges;
		if (
			!path ||
			!attributeChanges ||
			typeof attributeChanges !== 'object' ||
			!Object.prototype.hasOwnProperty.call(attributeChanges, path)
		) {
			return undefined;
		}

		return attributeChanges[path];
	}

	/**
	 * Persist one tracked attribute value to the host state.
	 *
	 * @param {string} attributePath Canonical block attribute path.
	 * @param {*} value Attribute value to persist, or `undefined` to clear it.
	 * @returns {void}
	 */
	function setTrackedAttributeValue(attributePath, value) {
		const path = typeof attributePath === 'string' ? attributePath.trim() : '';
		if (!path) {
			return;
		}

		if (!this.attributeChanges || typeof this.attributeChanges !== 'object') {
			this.attributeChanges = {};
		}

		this.attributeChanges[path] = value;
	}

	/**
	 * Resolve the active schema editor host for one live editor state.
	 *
	 * Text sessions expose `MWPEditor` directly, while file/media sessions own
	 * a separate schema host behind the media session controller. This helper
	 * gives shared runtime code one canonical way to find the current host
	 * contract without re-deriving editor shape locally.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {Object|null} Active schema editor host, or null.
	 */
	function resolveActiveEditorHost(editorState) {
		if (!editorState || typeof editorState !== 'object') {
			return null;
		}

		if (Object.prototype.hasOwnProperty.call(editorState, 'activeSchemaHost')) {
			return editorState.activeSchemaHost && typeof editorState.activeSchemaHost === 'object'
				? editorState.activeSchemaHost
				: null;
		}

		return null;
	}

	/**
	 * Resolve the primary rich-text host for one live editor state.
	 *
	 * Some teardown paths need the text editor instance specifically because
	 * `_mwpEditor` element references belong to the rich-text host even when a
	 * media/file session is currently active. This helper centralizes that lookup
	 * instead of letting cleanup code reach into editor-state shape directly.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {Object|null} Primary rich-text host, or null.
	 */
	function resolveTextEditorHost(editorState) {
		if (!editorState || typeof editorState !== 'object') {
			return null;
		}

		if (Object.prototype.hasOwnProperty.call(editorState, 'textEditorHost')) {
			return editorState.textEditorHost && typeof editorState.textEditorHost === 'object'
				? editorState.textEditorHost
				: null;
		}

		return null;
	}

	/**
	 * Resolve the outer block element for block-targeted schema operations.
	 *
	 * @returns {HTMLElement}
	 */
	function getBlockRootElement() {
		const root = this.options?.blockRootElement;
		return root && root.nodeType === Node.ELEMENT_NODE ? root : this.element;
	}

	/**
	 * Normalize a target value into a flat element collection.
	 *
	 * @param {*} value Candidate target descriptor value.
	 * @returns {HTMLElement[]} Normalized element list.
	 */
	function normalizeTargetElements(value) {
		if (!value) return [];

		if (value.nodeType === Node.ELEMENT_NODE) {
			return [value];
		}

		if (Array.isArray(value)) {
			return value.filter(node => node && node.nodeType === Node.ELEMENT_NODE);
		}

		if (typeof NodeList !== 'undefined' && value instanceof NodeList) {
			return Array.from(value).filter(node => node && node.nodeType === Node.ELEMENT_NODE);
		}

		if (typeof HTMLCollection !== 'undefined' && value instanceof HTMLCollection) {
			return Array.from(value).filter(node => node && node.nodeType === Node.ELEMENT_NODE);
		}

		return [];
	}

	/**
	 * Resolve one schema format target descriptor to a concrete target element.
	 *
	 * @param {*} descriptor One schema target descriptor.
	 * @param {HTMLElement} fallbackElement Fallback target.
	 * @returns {HTMLElement|HTMLElement[]} Resolved target element or elements.
	 */
	function resolveTargetDescriptor(descriptor, fallbackElement = this.element) {
		const blockRoot = this.getBlockRootElement();

		const descriptorTargets = this.normalizeTargetElements(descriptor);
		if (descriptorTargets.length > 1) {
			return descriptorTargets;
		}
		if (descriptorTargets.length === 1) {
			return descriptorTargets[0];
		}

		if (typeof descriptor === 'function') {
			try {
				const resolved = descriptor(this, {
					element: this.element,
					blockRootElement: blockRoot,
				});
				const resolvedTargets = this.normalizeTargetElements(resolved);
				if (resolvedTargets.length > 1) {
					return resolvedTargets;
				}
				if (resolvedTargets.length === 1) {
					return resolvedTargets[0];
				}
			} catch (error) {
				console.warn('FrontEdit: format target resolver failed', error);
			}
			return fallbackElement || this.element;
		}

		if (typeof descriptor === 'string') {
			const target = descriptor.trim();
			if (!target || target === 'selection' || target === 'component') {
				return this.element;
			}
			if (target === 'block' || target === 'root') {
				return blockRoot || fallbackElement || this.element;
			}
			if (target.startsWith('all:')) {
				const selector = target.slice(4).trim();
				if (!selector || !blockRoot || typeof blockRoot.querySelectorAll !== 'function') {
					return [];
				}

				return Array.from(blockRoot.querySelectorAll(selector)).filter(node => {
					const owner = node.closest('[data-mwp-sfe-uuid]');
					return !owner || owner === blockRoot;
				});
			}
			if (blockRoot && typeof blockRoot.querySelector === 'function') {
				const matched = blockRoot.querySelector(target);
				if (matched) {
					return matched;
				}
			}
		}

		return fallbackElement || this.element;
	}

	/**
	 * Resolve one named schema format target with optional overrides.
	 *
	 * @param {Object} config Target resolution config.
	 * @param {string} [config.target='selection'] Fallback target descriptor.
	 * @param {string|null} [config.targetKey=null] Named format target key.
	 * @param {HTMLElement} [config.fallback=this.element] Fallback target element.
	 * @returns {HTMLElement|HTMLElement[]} Resolved target element or elements.
	 */
	function resolveFormatTarget(config = {}) {
		const {
			target = 'selection',
			targetKey = null,
			fallback = this.element,
		} = config;

		let descriptor = target;
		if (
			targetKey &&
			this.options?.formatTargets &&
			Object.prototype.hasOwnProperty.call(this.options.formatTargets, targetKey)
		) {
			descriptor = this.options.formatTargets[targetKey];
		}

		return this.resolveTargetDescriptor(descriptor, fallback);
	}

	/**
	 * Return the element that textAlignment classes should read/write against.
	 *
	 * @returns {HTMLElement|HTMLElement[]} Resolved textAlignment target.
	 */
	function getTextAlignmentTargetElement() {
		const targetKey = (
			this.options?.formatTargets &&
			Object.prototype.hasOwnProperty.call(this.options.formatTargets, 'columnAlignment')
		)
			? 'columnAlignment'
			: 'textAlignment';

		return this.resolveFormatTarget({
			target: 'selection',
			targetKey,
			fallback: this.element,
		});
	}

	/**
	 * Normalize one explicit table-column target payload to unique zero-based indexes.
	 *
	 * @param {*} columnTarget Candidate multi-column target payload.
	 * @returns {number[]} Normalized unique column indexes.
	 */
	function normalizeTableColumnTargetIndexes(columnTarget) {
		if (columnTarget === 'all') {
			return [ 'all' ];
		}

		if (!Array.isArray(columnTarget)) {
			return [];
		}

		const rawIndexes = columnTarget;
		return Array.from(new Set(
			rawIndexes
				.map(value => Number.parseInt(value, 10))
				.filter(value => Number.isInteger(value) && value >= 0)
		));
	}

	/**
	 * Resolve every cell in one explicit table column target.
	 *
	 * @param {*} columnTarget Column index array or `'all'`.
	 * @returns {HTMLElement[]} Matching cells across the table sections.
	 */
	function getTableColumnTargetElements(columnTarget) {
		const normalizedIndexes = normalizeTableColumnTargetIndexes(columnTarget);
		const blockRoot = this.getBlockRootElement();
		if (
			!normalizedIndexes.length ||
			!blockRoot ||
			typeof blockRoot.querySelectorAll !== 'function'
		) {
			return [];
		}

		const cells = [];
		const includesAll = normalizedIndexes.length === 1 && normalizedIndexes[0] === 'all';
		blockRoot.querySelectorAll('table tr').forEach(row => {
			const candidates = Array.from(row.children || []).filter(cell => (
				cell &&
				cell.nodeType === Node.ELEMENT_NODE &&
				(cell.tagName === 'TH' || cell.tagName === 'TD')
			));

			if (includesAll) {
				candidates.forEach(cell => {
					if (cell) {
						cells.push(cell);
					}
				});
				return;
			}

			normalizedIndexes.forEach(columnIndex => {
				const cell = candidates[columnIndex] || null;
				if (cell) {
					cells.push(cell);
				}
			});
		});

		return Array.from(new Set(cells));
	}

	/**
	 * Determine whether one targetConfig includes an explicit table-column override.
	 *
	 * @param {Object} targetConfig Target resolution config.
	 * @returns {boolean} True when `columns` is supplied.
	 */
	function hasExplicitTableColumnTarget(targetConfig = {}) {
		return Object.prototype.hasOwnProperty.call(targetConfig, 'columns');
	}

	/**
	 * Resolve one explicit table-column target override from targetConfig.
	 *
	 * @param {Object} targetConfig Target resolution config.
	 * @returns {*|undefined} Column index array, `'all'`, or undefined.
	 */
	function getExplicitTableColumnTarget(targetConfig = {}) {
		if (Object.prototype.hasOwnProperty.call(targetConfig, 'columns')) {
			return targetConfig.columns;
		}

		return undefined;
	}

	/**
	 * Read the current textAlignment value from the live DOM target state.
	 *
	 * @param {HTMLElement|HTMLElement[]} [targetElement] Optional explicit target.
	 * @returns {string} Normalized textAlignment value.
	 */
	function getTextAlignmentState(targetElement = this.getTextAlignmentTargetElement()) {
		const capability = SFE.SchemaOperationExecutor?.getTextAlignmentCapability?.(this, this.getTextAlignmentOperation()) || null;
		const trackedValue = capability?.attribute ? this.getTrackedAttributeValue(capability.attribute) : undefined;
		if (typeof trackedValue === 'string' && trackedValue.trim()) {
			return trackedValue.trim().toLowerCase();
		}
		const targets = this.normalizeTargetElements(targetElement);
		const activeTarget = targets.find(node => node === this.element) || targets[0] || null;
		if (!activeTarget || !activeTarget.classList) {
			return 'left';
		}
		if (capability?.preview === 'inline_style' && activeTarget.style.textAlign) {
			return activeTarget.style.textAlign.trim().toLowerCase();
		}
		if (activeTarget.classList.contains('has-text-align-justify')) return 'justify';
		if (activeTarget.classList.contains('has-text-align-right')) return 'right';
		if (activeTarget.classList.contains('has-text-align-center')) return 'center';
		return 'left';
	}

	/**
	 * Return the schema-declared textAlignment operation metadata.
	 *
	 * @returns {Object|null} textAlignment operation metadata or null.
	 */
	function getTextAlignmentOperation() {
		const operations = Array.isArray(this.options?.operations)
			? this.options.operations
			: [];

		return operations.find(operation => (
			operation &&
			typeof operation === 'object' &&
			String(operation.id || '').trim() === 'set_text_align' &&
			String(operation.kind || '').trim() === 'block_attribute_change'
		)) || null;
	}

	/**
	 * Return the schema-declared textAlignment values for this host.
	 *
	 * @returns {string[]} Normalized textAlignment values in schema order.
	 */
	function getTextAlignmentSchemaValues() {
		const operation = this.getTextAlignmentOperation();
		const operationValues = Array.isArray(operation?.values)
			? operation.values
			: null;

		if (operationValues && operationValues.length) {
			return operationValues
				.map(value => String(value).trim().toLowerCase())
				.filter(Boolean);
		}

		const operationAttribute = typeof operation?.attribute === 'string'
			? operation.attribute.trim()
			: '';
		const fallbackCapabilityKey = operationAttribute === 'columnAlignment'
			? 'columnAlignment'
			: 'textAlignment';
		const capability = SFE.SchemaOperationExecutor?.getTextAlignmentCapability?.(this, operation) ||
			this.getAttributeCapability(fallbackCapabilityKey);
		if (Array.isArray(capability?.values) && capability.values.length) {
			return capability.values
				.map(value => String(value).trim().toLowerCase())
				.filter(Boolean);
		}

		return [];
	}

	/**
	 * Return the normalized textAlignment value declared on one dropdown option.
	 *
	 * @param {Object|null} option Dropdown option definition.
	 * @returns {string} Normalized textAlignment value or empty string.
	 */
	function getTextAlignmentValueForOption(option) {
		if (!option || typeof option !== 'object') {
			return '';
		}
		if (option.formatType && option.formatType !== 'textAlignment') {
			return '';
		}

		return typeof option.value === 'string'
			? option.value.trim().toLowerCase()
			: '';
	}

	/**
	 * Determine whether one textAlignment option is active for the host.
	 *
	 * @param {Object|null} option Dropdown option definition.
	 * @param {string} currentTextAlignment Current normalized textAlignment value.
	 * @returns {boolean} True when the option matches the active state.
	 */
	function isTextAlignmentOptionActive(option, currentTextAlignment) {
		const optionValue = this.getTextAlignmentValueForOption(option);
		if (!optionValue) {
			return false;
		}

		const schemaValues = this.getTextAlignmentSchemaValues();
		if (schemaValues.length && !schemaValues.includes(optionValue)) {
			return false;
		}

		return optionValue === currentTextAlignment;
	}

	/**
	 * Read the current block align value from tracked state or live DOM classes.
	 *
	 * @returns {string} Normalized block align value.
	 */
	function getBlockAlignState() {
		const trackedAlign = this.getTrackedAttributeValue('align');
		const normalizedTrackedAlign = typeof trackedAlign === 'string'
			? trackedAlign.trim().toLowerCase()
			: '';
		if (normalizedTrackedAlign) {
			return normalizedTrackedAlign;
		}

		const target = this.resolveFormatTarget({
			target: 'block',
			targetKey: 'align',
			fallback: this.element,
		});
		const targets = this.normalizeTargetElements(target);
		const activeTarget = targets.find(node => node === this.element) || targets[0] || this.element;
		if (!activeTarget || !activeTarget.classList) {
			return 'none';
		}

		if (activeTarget.classList.contains('alignfull')) return 'full';
		if (activeTarget.classList.contains('alignwide')) return 'wide';
		if (activeTarget.classList.contains('alignleft')) return 'left';
		if (activeTarget.classList.contains('aligncenter')) return 'center';
		if (activeTarget.classList.contains('alignright')) return 'right';
		return 'none';
	}

	/**
	 * Return the schema-declared block align operation metadata.
	 *
	 * @returns {Object|null} Block align operation metadata or null.
	 */
	function getBlockAlignOperation() {
		const operations = Array.isArray(this.options?.operations)
			? this.options.operations
			: [];

		return operations.find(operation => (
			operation &&
			typeof operation === 'object' &&
			String(operation.id || '').trim() === 'set_align' &&
			String(operation.kind || '').trim() === 'block_attribute_change'
		)) || null;
	}

	/**
	 * Return the schema-declared block align values for this host.
	 *
	 * @returns {string[]} Normalized block align values in schema order.
	 */
	function getBlockAlignSchemaValues() {
		const operation = this.getBlockAlignOperation();
		const operationValues = Array.isArray(operation?.values)
			? operation.values
			: null;

		if (operationValues && operationValues.length) {
			return operationValues
				.map(value => String(value).trim().toLowerCase())
				.filter(Boolean);
		}

		const capability = this.getAttributeCapability('align');
		if (Array.isArray(capability?.values) && capability.values.length) {
			return capability.values
				.map(value => String(value).trim().toLowerCase())
				.filter(Boolean);
		}

		return [];
	}

	/**
	 * Return the normalized block align value declared on one dropdown option.
	 *
	 * @param {Object|null} option Dropdown option definition.
	 * @returns {string} Normalized block align value or empty string.
	 */
	function getBlockAlignValueForOption(option) {
		if (!option || typeof option !== 'object') {
			return '';
		}
		if (option.formatType && option.formatType !== 'blockAlign') {
			return '';
		}

		return typeof option.value === 'string'
			? option.value.trim().toLowerCase()
			: '';
	}

	/**
	 * Determine whether one block align option is active for the host.
	 *
	 * @param {Object|null} option Dropdown option definition.
	 * @param {string} currentAlign Current normalized block align value.
	 * @returns {boolean} True when the option matches the active state.
	 */
	function isBlockAlignOptionActive(option, currentAlign) {
		const optionValue = this.getBlockAlignValueForOption(option);
		if (!optionValue) {
			return false;
		}

		const schemaValues = this.getBlockAlignSchemaValues();
		if (schemaValues.length && !schemaValues.includes(optionValue)) {
			return false;
		}

		return optionValue === currentAlign;
	}

	/**
	 * Return the normalized heading level declared on one dropdown option.
	 *
	 * @param {Object|null} option Heading dropdown option definition.
	 * @returns {string|number|null} Schema heading value or null when absent.
	 */
	function getHeadingLevelValueForOption(option) {
		if (!option || typeof option !== 'object') {
			return null;
		}

		return Object.prototype.hasOwnProperty.call(option, 'value')
			? option.value
			: null;
	}

	/**
	 * Return the current heading level represented by the host element.
	 *
	 * Pending schema-backed `level` changes win over the live DOM tag so toolbar
	 * state stays accurate before save/refresh reconciliation.
	 *
	 * @returns {string|number|null} Current schema heading value, or null when absent.
	 */
	function getHeadingLevelState() {
		const capability = this.getAttributeCapability('headingLevels');
		const trackedValue = capability?.attribute ? this.getTrackedAttributeValue(capability.attribute) : undefined;
		if (typeof trackedValue !== 'undefined') {
			return trackedValue;
		}

		const tagName = String(this.element?.tagName || '').trim().toLowerCase();
		if (capability?.tagChange === true) {
			return tagName || null;
		}
		if (/^h[1-6]$/.test(tagName)) {
			return Number.parseInt(tagName.slice(1), 10);
		}

		return null;
	}

	/**
	 * Return one schema-declared attribute capability by logical key.
	 *
	 * @param {string} key Logical capability key.
	 * @returns {Object|null} Capability metadata or null.
	 */
	function getAttributeCapability(key) {
		const normalizedKey = typeof key === 'string' ? key.trim() : '';
		const capabilities = this.options?.attributeCapabilities;
		if (
			!normalizedKey ||
			!capabilities ||
			typeof capabilities !== 'object' ||
			!Object.prototype.hasOwnProperty.call(capabilities, normalizedKey)
		) {
			return null;
		}

		const capability = capabilities[normalizedKey];
		return capability && typeof capability === 'object' ? capability : null;
	}

	/**
	 * Apply one schema-backed textAlignment change to tracked state and live DOM.
	 *
	 * @param {string} textAlignment Requested textAlignment value.
	 * @param {Object} targetConfig Target resolution config.
	 * @param {Object} [targetConfig.operation] Resolved schema operation metadata.
	 * @returns {boolean} True when the mutation was applied.
	 */
	function changeTextAlignment(textAlignment, targetConfig = {}) {
		const operationExecutor = SFE.SchemaOperationExecutor || null;
		const textAlignmentCapability = operationExecutor?.getTextAlignmentCapability?.(this, targetConfig.operation || null) || null;

		if (!textAlignmentCapability) {
			console.warn('FrontEdit: alignment change blocked because the active schema does not declare attributeCapabilities.textAlignment.attribute.');
			return false;
		}

		const operationAttribute = typeof targetConfig.operation?.attribute === 'string'
			? targetConfig.operation.attribute.trim()
			: '';

		if (operationAttribute && operationAttribute !== textAlignmentCapability.attribute) {
			console.warn('FrontEdit: alignment change blocked because the operation attribute does not match the active schema alignment attribute.', {
				operationAttribute,
				schemaAttribute: textAlignmentCapability.attribute,
			});
			return false;
		}

		const normalizedTextAlignment = String(textAlignment || '').trim().toLowerCase();
		if (
			textAlignmentCapability.values.length &&
			!textAlignmentCapability.values.includes(normalizedTextAlignment)
		) {
			console.warn('FrontEdit: alignment change blocked because the requested value is not allowed by the active schema.', {
				value: normalizedTextAlignment,
				allowedValues: textAlignmentCapability.values,
			});
			return false;
		}

		const trackedTextAlignment = operationExecutor?.normalizeBlockAttributeTrackedValue?.(
			textAlignmentCapability,
			normalizedTextAlignment
		);

		this.setTrackedAttributeValue(textAlignmentCapability.attribute, trackedTextAlignment);

		const targetValue = (
			textAlignmentCapability.attribute === 'columnAlignment' &&
			hasExplicitTableColumnTarget(targetConfig)
		)
			? this.getTableColumnTargetElements(getExplicitTableColumnTarget(targetConfig))
			: this.resolveFormatTarget({
				target: targetConfig.target || 'selection',
				targetKey: targetConfig.targetKey || 'textAlignment',
				fallback: this.element,
			});
		const normalizedTargets = this.normalizeTargetElements(targetValue);
		const targetElements = normalizedTargets.length ? normalizedTargets : [this.element];
		const uniqueTargets = Array.from(new Set(targetElements));

		uniqueTargets.forEach(targetElement => {
			if (!targetElement || !targetElement.classList) return;

			targetElement.classList.remove(
				'has-text-align-left',
				'has-text-align-center',
				'has-text-align-right',
				'has-text-align-justify'
			);

			const isUnsetTextAlignment = (
				!normalizedTextAlignment ||
				operationExecutor.isUnsetBlockAttributeValue(textAlignmentCapability, normalizedTextAlignment)
			);

			if (textAlignmentCapability.preview === 'inline_style') {
				targetElement.style.textAlign = isUnsetTextAlignment ? '' : normalizedTextAlignment;
			} else if (!isUnsetTextAlignment) {
				targetElement.classList.add(`has-text-align-${normalizedTextAlignment}`);
			}

			if (targetElement.tagName === 'TH' || targetElement.tagName === 'TD') {
				if (isUnsetTextAlignment) {
					targetElement.removeAttribute('data-align');
				} else {
					targetElement.setAttribute('data-align', normalizedTextAlignment);
				}
			}
		});

		setTimeout(() => this.updateToolbarState(), 0);

		return true;
	}

	/**
	 * Reposition floating editor chrome after one layout-affecting mutation.
	 *
	 * @returns {void}
	 */
	function scheduleFloatingElementsPositionAfterLayout() {
		const run = () => {
			const activeState = SFE.activeEditorInstance || null;

			if (activeState && typeof activeState.updatePositions === 'function') {
				activeState.updatePositions();
				return;
			}

			const positionManager = SFE.PositionManager || null;
			const positionFn = positionManager?.schedulePosition || positionManager?.positionFloatingElements;
			if (typeof positionFn !== 'function') {
				return;
			}

			const positionElement =
				activeState?.element ||
				this.options?.blockRootElement ||
				this.getBlockRootElement() ||
				this.element;
			const toolbar = this.options?.toolbarContainer || activeState?.toolbarContainer || null;
			const actions = activeState?.actionsContainer || null;

			if (!positionElement || (!toolbar && !actions)) {
				return;
			}

			positionFn(positionElement, toolbar, actions);
		};

		if (typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(run);
		} else {
			setTimeout(run, 0);
		}
	}

	/**
	 * Apply one schema-backed block align change to tracked state and live DOM.
	 *
	 * @param {string} align Requested block align value.
	 * @param {Object} targetConfig Target resolution config.
	 * @returns {boolean} True when the mutation was applied.
	 */
	function changeBlockAlign(align, targetConfig = {}) {
		const normalizedAlign = typeof align === 'string'
			? align.trim().toLowerCase()
			: '';
		const operationExecutor = SFE.SchemaOperationExecutor || null;
		const alignCapability = this.getAttributeCapability('align');
		if (!alignCapability || typeof this.resolveFormatTarget !== 'function') {
			return false;
		}

		const capabilityAttribute = typeof alignCapability.attribute === 'string'
			? alignCapability.attribute.trim()
			: 'align';
		const values = Array.isArray(alignCapability.values)
			? alignCapability.values
				.map(value => String(value).trim().toLowerCase())
				.filter(Boolean)
			: [];
		const normalizedCapability = {
			...alignCapability,
			attribute: capabilityAttribute,
			values,
			normalizedUnsetValue: typeof alignCapability.unsetValue === 'string'
				? alignCapability.unsetValue.trim().toLowerCase()
				: alignCapability.unsetValue,
		};
		const trackedAlign = operationExecutor &&
			typeof operationExecutor.normalizeBlockAttributeTrackedValue === 'function'
			? operationExecutor.normalizeBlockAttributeTrackedValue(normalizedCapability, normalizedAlign)
			: (
				normalizedAlign === normalizedCapability.normalizedUnsetValue
					? undefined
					: normalizedAlign
			);

		this.setTrackedAttributeValue(capabilityAttribute, trackedAlign);

		const targetValue = this.resolveFormatTarget({
			target: targetConfig.target || 'block',
			targetKey: targetConfig.targetKey || 'align',
			fallback: this.element,
		});
		const normalizedTargets = this.normalizeTargetElements(targetValue);
		const targetElements = normalizedTargets.length ? normalizedTargets : [this.element];
		const uniqueTargets = Array.from(new Set(targetElements));
		const isUnsetAlign = (
			!normalizedAlign ||
			(
				operationExecutor &&
				typeof operationExecutor.isUnsetBlockAttributeValue === 'function'
					? operationExecutor.isUnsetBlockAttributeValue(normalizedCapability, normalizedAlign)
					: normalizedAlign === normalizedCapability.normalizedUnsetValue
			)
		);

		uniqueTargets.forEach(targetElement => {
			if (!targetElement || !targetElement.classList) return;
			targetElement.classList.remove('alignnone', 'alignwide', 'alignfull', 'alignleft', 'aligncenter', 'alignright');
			if (!isUnsetAlign) {
				targetElement.classList.add(`align${normalizedAlign}`);
			}
		});

		if (typeof this.scheduleFloatingElementsPositionAfterLayout === 'function') {
			this.scheduleFloatingElementsPositionAfterLayout();
		}

		return true;
	}

	/**
	 * Attach the shared schema-host contract to one host object.
	 *
	 * Methods that already exist on the host are preserved so callers can opt in
	 * incrementally while reusing the shared schema-derived defaults.
	 *
	 * @param {Object} host Host object to decorate.
	 * @returns {Object} Decorated host object.
	 */
	const contractMethods = {
		resolveActiveEditorHost,
		resolveTextEditorHost,
		getTrackedAttributeValue,
		setTrackedAttributeValue,
		getBlockRootElement,
		normalizeTargetElements,
		resolveTargetDescriptor,
		resolveFormatTarget,
		getTextAlignmentTargetElement,
		normalizeTableColumnTargetIndexes,
		getTableColumnTargetElements,
		hasExplicitTableColumnTarget,
		getExplicitTableColumnTarget,
		getTextAlignmentState,
		getTextAlignmentOperation,
		getTextAlignmentSchemaValues,
		getTextAlignmentValueForOption,
		isTextAlignmentOptionActive,
		getBlockAlignState,
		getBlockAlignOperation,
		getBlockAlignSchemaValues,
		getBlockAlignValueForOption,
		isBlockAlignOptionActive,
		getHeadingLevelValueForOption,
		getHeadingLevelState,
		getAttributeCapability,
		changeTextAlignment,
		scheduleFloatingElementsPositionAfterLayout,
		changeBlockAlign,
	};

	/**
	 * Attach the shared schema-host contract to one host object.
	 *
	 * Methods that already exist on the host are preserved so callers can opt in
	 * incrementally while reusing the shared schema-derived defaults.
	 *
	 * @param {Object} host Host object to decorate.
	 * @returns {Object} Decorated host object.
	 */
	function attachHostContract(host) {
		if (!host || typeof host !== 'object') {
			return host;
		}

		Object.entries(contractMethods).forEach(([methodName, method]) => {
			if (typeof host[methodName] !== 'function') {
				host[methodName] = method;
			}
		});

		return host;
	}

	/**
	 * Apply the shared schema-host contract to one prototype, overwriting any
	 * existing implementations so the runtime uses one canonical contract body.
	 *
	 * @param {Object} hostPrototype Prototype object to decorate.
	 * @returns {Object} Decorated prototype object.
	 */
	function applyHostContractToPrototype(hostPrototype) {
		if (!hostPrototype || typeof hostPrototype !== 'object') {
			return hostPrototype;
		}

		Object.assign(hostPrototype, contractMethods);
		return hostPrototype;
	}

	SFE.SchemaEditorHost = {
		attachHostContract,
		applyHostContractToPrototype,
		resolveActiveEditorHost,
		resolveTextEditorHost,
		methods: contractMethods,
	};
})();
