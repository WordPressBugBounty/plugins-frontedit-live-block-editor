/**
 * Internal floating toolbar manager.
 *
 * Renders schema-declared toolbar chrome against one active editor host
 * contract so text and non-text hosts share the same floating UI behavior.
 *
 * Exposes: SFE.ToolbarManager
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	const TOOLBAR_FORMAT_ICONS = {
		undo:                  '<svg viewBox="0 0 18 18"><polygon class="mwp-sfe-fill mwp-sfe-stroke" points="6 10 4 12 2 10 6 10"></polygon><path class="mwp-sfe-stroke" d="M8.09,13.91A4.6,4.6,0,0,0,9,14,5,5,0,1,0,4,9"></path></svg>',
		redo:                  '<svg viewBox="0 0 18 18"><polygon class="mwp-sfe-fill mwp-sfe-stroke" points="12 10 14 12 16 10 12 10"></polygon><path class="mwp-sfe-stroke" d="M9.91,13.91A4.6,4.6,0,0,1,9,14a5,5,0,1,1,5-5"></path></svg>',
		bold:                  '<svg viewBox="0 0 18 18"><path class="mwp-sfe-stroke" d="M5,4H9.5A2.5,2.5,0,0,1,12,6.5v0A2.5,2.5,0,0,1,9.5,9H5A0,0,0,0,1,5,9V4A0,0,0,0,1,5,4Z"></path><path class="mwp-sfe-stroke" d="M5,9h5.5A2.5,2.5,0,0,1,13,11.5v0A2.5,2.5,0,0,1,10.5,14H5a0,0,0,0,1,0,0V9A0,0,0,0,1,5,9Z"></path></svg>',
		italic:                '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="7" x2="13" y1="4" y2="4"></line><line class="mwp-sfe-stroke" x1="5" x2="11" y1="14" y2="14"></line><line class="mwp-sfe-stroke" x1="8" x2="10" y1="14" y2="4"></line></svg>',
		strikethrough:         '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke mwp-sfe-thin" x1="15.5" x2="2.5" y1="8.5" y2="9.5"></line><path class="mwp-sfe-fill" d="M9.007,8C6.542,7.791,6,7.519,6,6.5,6,5.792,7.283,5,9,5c1.571,0,2.765.679,2.969,1.309a1,1,0,0,0,1.9-.617C13.356,4.106,11.354,3,9,3,6.2,3,4,4.538,4,6.5a3.2,3.2,0,0,0,.5,1.843Z"></path><path class="mwp-sfe-fill" d="M8.984,10C11.457,10.208,12,10.479,12,11.5c0,0.708-1.283,1.5-3,1.5-1.571,0-2.765-.679-2.969-1.309a1,1,0,1,0-1.9.617C4.644,13.894,6.646,15,9,15c2.8,0,5-1.538,5-3.5a3.2,3.2,0,0,0-.5-1.843Z"></path></svg>',
		link:                  '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="7" x2="11" y1="7" y2="11"></line><path class="mwp-sfe-even mwp-sfe-stroke" d="M8.9,4.577a3.476,3.476,0,0,1,.36,4.679A3.476,3.476,0,0,1,4.577,8.9C3.185,7.5,2.035,6.4,4.217,4.217S7.5,3.185,8.9,4.577Z"></path><path class="mwp-sfe-even mwp-sfe-stroke" d="M13.423,9.1a3.476,3.476,0,0,0-4.679-.36,3.476,3.476,0,0,0,.36,4.679c1.392,1.392,2.5,2.542,4.679.36S14.815,10.5,13.423,9.1Z"></path></svg>',
		alignNone:             '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="3" x2="15" y1="3" y2="3"></line><rect class="mwp-sfe-stroke" x="3" y="6.5" width="12" height="5" rx="1.125"></rect><line class="mwp-sfe-stroke" x1="3" x2="15" y1="15" y2="15"></line></svg>',
		alignWide:             '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="5" x2="13" y1="3" y2="3"></line><rect class="mwp-sfe-stroke" x="3" y="6.5" width="12" height="5" rx="1.125"></rect><line class="mwp-sfe-stroke" x1="5" x2="13" y1="15" y2="15"></line></svg>',
		alignFull:             '<svg viewBox="0 0 18 18"><rect class="mwp-sfe-stroke" x="3" y="3" width="12" height="8" rx="1.125"></rect><line class="mwp-sfe-stroke" x1="5" x2="13" y1="15" y2="15"></line></svg>',
		alignLeft:             '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="3" x2="10" y1="3" y2="3"></line><rect class="mwp-sfe-stroke" x="3" y="6.5" width="12" height="5" rx="1.125"></rect><line class="mwp-sfe-stroke" x1="3" x2="10" y1="15" y2="15"></line></svg>',
		alignCenter:           '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="3" x2="15" y1="3" y2="3"></line><rect class="mwp-sfe-stroke" x="4.5" y="6.5" width="9" height="5" rx="1.125"></rect><line class="mwp-sfe-stroke" x1="3" x2="15" y1="15" y2="15"></line></svg>',
		alignRight:            '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="8" x2="15" y1="3" y2="3"></line><rect class="mwp-sfe-stroke" x="3" y="6.5" width="12" height="5" rx="1.125"></rect><line class="mwp-sfe-stroke" x1="8" x2="15" y1="15" y2="15"></line></svg>',
		textAlignLeft:         '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="3" x2="15" y1="9" y2="9"></line><line class="mwp-sfe-stroke" x1="3" x2="13" y1="14" y2="14"></line><line class="mwp-sfe-stroke" x1="3" x2="9" y1="4" y2="4"></line></svg>',
		textAlignCenter:       '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="15" x2="3" y1="9" y2="9"></line><line class="mwp-sfe-stroke" x1="14" x2="4" y1="14" y2="14"></line><line class="mwp-sfe-stroke" x1="12" x2="6" y1="4" y2="4"></line></svg>',
		textAlignRight:        '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="15" x2="3" y1="9" y2="9"></line><line class="mwp-sfe-stroke" x1="15" x2="5" y1="14" y2="14"></line><line class="mwp-sfe-stroke" x1="15" x2="9" y1="4" y2="4"></line></svg>',
		orderedList:           '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="7" x2="15" y1="4" y2="4"></line><line class="mwp-sfe-stroke" x1="7" x2="15" y1="9" y2="9"></line><line class="mwp-sfe-stroke" x1="7" x2="15" y1="14" y2="14"></line><line class="mwp-sfe-stroke mwp-sfe-thin" x1="2.5" x2="4.5" y1="5.5" y2="5.5"></line><path class="mwp-sfe-fill" d="M3.5,6A0.5,0.5,0,0,1,3,5.5V3.085l-0.276.138A0.5,0.5,0,0,1,2.053,3c-0.124-.247-0.023-0.324.224-0.447l1-.5A0.5,0.5,0,0,1,4,2.5v3A0.5,0.5,0,0,1,3.5,6Z"></path><path class="mwp-sfe-stroke mwp-sfe-thin" d="M4.5,10.5h-2c0-.234,1.85-1.076,1.85-2.234A0.959,0.959,0,0,0,2.5,8.156"></path><path class="mwp-sfe-stroke mwp-sfe-thin" d="M2.5,14.846a0.959,0.959,0,0,0,1.85-.109A0.7,0.7,0,0,0,3.75,14a0.688,0.688,0,0,0,.6-0.736,0.959,0.959,0,0,0-1.85-.109"></path></svg>',
		unorderedList:         '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="6" x2="15" y1="4" y2="4"></line><line class="mwp-sfe-stroke" x1="6" x2="15" y1="9" y2="9"></line><line class="mwp-sfe-stroke" x1="6" x2="15" y1="14" y2="14"></line><line class="mwp-sfe-stroke" x1="3" x2="3" y1="4" y2="4"></line><line class="mwp-sfe-stroke" x1="3" x2="3" y1="9" y2="9"></line><line class="mwp-sfe-stroke" x1="3" x2="3" y1="14" y2="14"></line></svg>',
		indent:                '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="3" x2="15" y1="14" y2="14"></line><line class="mwp-sfe-stroke" x1="3" x2="15" y1="4" y2="4"></line><line class="mwp-sfe-stroke" x1="9" x2="15" y1="9" y2="9"></line><polyline class="mwp-sfe-fill mwp-sfe-stroke" points="3 7 3 11 5 9 3 7"></polyline></svg>',
		outdent:               '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="3" x2="15" y1="14" y2="14"></line><line class="mwp-sfe-stroke" x1="3" x2="15" y1="4" y2="4"></line><line class="mwp-sfe-stroke" x1="9" x2="15" y1="9" y2="9"></line><polyline class="mwp-sfe-stroke" points="5 7 5 11 3 9 5 7"></polyline></svg>',
		textAlignmentDropdown: '<svg viewBox="0 0 18 18"><line class="mwp-sfe-stroke" x1="3" x2="15" y1="9" y2="9"></line><line class="mwp-sfe-stroke" x1="3" x2="13" y1="14" y2="14"></line><line class="mwp-sfe-stroke" x1="3" x2="9" y1="4" y2="4"></line></svg>',
		replaceMedia:          '<span>Replace</span>',
	};

	/**
	 * Create one runtime toolbar button definition.
	 *
	 * @param {Object} config Button configuration.
	 * @returns {Object} Runtime toolbar button definition.
	 */
	function createToolbarButton(config = {}) {
		return {
			icon: config.icon || '',
			title: config.title || '',
			action: typeof config.action === 'function' ? config.action : () => {},
			className: config.className || '',
			formatKey: config.formatKey || '',
			formatType: config.formatType || '',
			value: Object.prototype.hasOwnProperty.call(config, 'value') ? config.value : undefined,
			tag: config.tag || '',
			activeTags: Array.isArray(config.activeTags) ? config.activeTags : [],
		};
	}

	/**
	 * Create one runtime toolbar dropdown definition.
	 *
	 * @param {Object} config Dropdown configuration.
	 * @returns {Object} Runtime toolbar dropdown definition.
	 */
	function createToolbarDropdown(config = {}) {
		return {
			type: 'dropdown',
			title: config.title || '',
			defaultIcon: config.defaultIcon || '',
			options: Array.isArray(config.options) ? config.options.filter(Boolean) : [],
			formatKey: config.formatKey || '',
		};
	}

	/**
	 * Execute one schema block-attribute operation from a toolbar action.
	 *
	 * @param {Object|null} editor Editor host.
	 * @param {string} operationId Schema operation id.
	 * @param {*} value Requested operation value.
	 * @returns {void}
	 */
	function executeSchemaBlockAttributeOperation(editor, operationId, value) {
		const operationExecutor = SFE.SchemaOperationExecutor || null;
		if (!operationExecutor || typeof operationExecutor.executeBlockAttributeOperation !== 'function') {
			return;
		}

		operationExecutor.executeBlockAttributeOperation({
			editorHost: editor,
			operationId,
			value,
			saveHistory: true,
		});
	}

	/**
	 * Execute one schema list operation from a toolbar action.
	 *
	 * @param {Object|null} editor Editor host.
	 * @param {string} operationId Schema or primitive operation id.
	 * @returns {void}
	 */
	function executeSchemaListOperation(editor, operationId) {
		if (typeof editor?.executeListStructureOperation !== 'function') {
			return;
		}

		editor.executeListStructureOperation({
			kind: operationId,
		});
	}

	/**
	 * Execute one list type switch from a toolbar action.
	 *
	 * @param {Object|null} editor Editor host.
	 * @param {string} listType List type token.
	 * @returns {void}
	 */
	function executeListTypeOperation(editor, listType) {
		const createTag = listType === 'ordered' ? 'ol' : 'ul';
		const oppositeTag = listType === 'ordered' ? 'UL' : 'OL';
		const operationExecutor = SFE.SchemaOperationExecutor || null;

		if (editor?._linkUIActive && typeof editor.closeLinkUI === 'function') {
			editor.closeLinkUI();
		}

		const selection = window.getSelection();
		if (selection?.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			let startLi = range.startContainer;
			let endLi = range.endContainer;

			while (startLi && startLi !== editor?.element && startLi.tagName !== 'LI') {
				startLi = startLi.parentNode;
			}

			while (endLi && endLi !== editor?.element && endLi.tagName !== 'LI') {
				endLi = endLi.parentNode;
			}

			if (startLi && endLi && startLi !== endLi) {
				return;
			}
		}

		if (
			(editor?.element?.tagName === 'UL' || editor?.element?.tagName === 'OL') &&
			operationExecutor &&
			typeof operationExecutor.executeCurrentListTypeChange === 'function'
		) {
			const result = operationExecutor.executeCurrentListTypeChange({
				editorHost: editor,
				value: listType,
			});

			if (result) {
				return;
			}
		}

		const listItem = typeof editor?.getCurrentListItem === 'function'
			? editor.getCurrentListItem()
			: null;

		if (!listItem) {
			if (typeof editor?.insertListManual === 'function') {
				editor.insertListManual(createTag);

				setTimeout(() => {
					const list = typeof editor?.getParentList === 'function'
						? editor.getParentList()
						: null;

					if (list) {
						list.classList.add('wp-block-list');
					}
				}, 10);
			}
			return;
		}

		const currentList = listItem.parentNode;
		if (
			currentList &&
			currentList.tagName === oppositeTag &&
			typeof editor?.changeListType === 'function'
		) {
			editor.changeListType(currentList, createTag);
		}
	}

	/**
	 * Build one toolbar button for a schema token that toggles inline formatting.
	 *
	 * @param {string} token Token name.
	 * @param {string} title Button title.
	 * @param {string} icon Icon markup.
	 * @param {string} tagName Inline tag name.
	 * @param {string[]} activeTags Active-tag list for toolbar state.
	 * @returns {Object} Runtime toolbar button definition.
	 */
	function createInlineFormatButton(token, title, icon, tagName, activeTags) {
		return createToolbarButton({
			formatKey: token,
			title,
			icon,
			activeTags,
			action: (editor) => {
				if (typeof editor?.toggleInlineFormat !== 'function') {
					return;
				}

				editor.executeAction(() => {
					editor.toggleInlineFormat(tagName);
				}, { saveHistory: false });
			},
		});
	}

	/**
	 * Build one toolbar button for a schema token that opens link editing.
	 *
	 * @param {string} token Token name.
	 * @param {string} title Button title.
	 * @returns {Object} Runtime toolbar button definition.
	 */
	function createLinkButton(token, title) {
		return createToolbarButton({
			formatKey: token,
			title,
			icon: TOOLBAR_FORMAT_ICONS.link,
			action: (editor) => {
				if (typeof editor?.showLinkUI !== 'function') {
					return;
				}

				const usesElementScopedLinkEditing = typeof editor.supportsElementLinkEditing === 'function'
					? editor.supportsElementLinkEditing()
					: false;
				const existingLink = typeof editor.getParentElement === 'function'
					? editor.getParentElement('a')
					: null;
				editor.showLinkUI(usesElementScopedLinkEditing ? null : existingLink);
			},
		});
	}

	/**
	 * Determine whether schema declares element-scoped link editing for the
	 * active text component.
	 *
	 * @param {HTMLElement|null} element Active editable element.
	 * @param {Object} editorOptions Normalized component editor options.
	 * @returns {boolean} True when the component edits its root anchor directly.
	 */
	function supportsElementScopedLinkToken(element, editorOptions = {}) {
		if (!element || element.tagName !== 'A') {
			return false;
		}

		const inlineFormatCapabilities = (
			editorOptions?.inlineFormatCapabilities &&
			typeof editorOptions.inlineFormatCapabilities === 'object'
		)
			? editorOptions.inlineFormatCapabilities
			: null;
		const attributeCapabilities = (
			editorOptions?.attributeCapabilities &&
			typeof editorOptions.attributeCapabilities === 'object'
		)
			? editorOptions.attributeCapabilities
			: null;
		const buttonLinkCapability = inlineFormatCapabilities?.buttonLink;
		const buttonLinkTag = typeof buttonLinkCapability?.tag === 'string'
			? buttonLinkCapability.tag.trim().toLowerCase()
			: '';
		if (buttonLinkTag !== 'a') {
			return false;
		}

		const attributes = Array.isArray(attributeCapabilities?.buttonLink?.attributes)
			? attributeCapabilities.buttonLink.attributes
				.map(value => (typeof value === 'string' ? value.trim() : ''))
				.filter(Boolean)
			: [];

		return attributes.includes('url');
	}

	/**
	 * Build one toolbar button for a schema list indentation action.
	 *
	 * @param {string} token Token name.
	 * @param {string} title Button title.
	 * @param {string} icon Icon markup.
	 * @param {string} operationId Schema list operation id.
	 * @returns {Object} Runtime toolbar button definition.
	 */
	function createListIndentButton(token, title, icon, operationId) {
		return createToolbarButton({
			formatKey: token,
			title,
			icon,
			action: (editor) => {
				executeSchemaListOperation(editor, operationId);
			},
		});
	}

	/**
	 * Build one toolbar option for schema-backed block alignment.
	 *
	 * @param {string} optionKey Icon/format lookup key.
	 * @param {string} title Option title.
	 * @param {string} value Alignment value.
	 * @returns {Object} Runtime toolbar option definition.
	 */
	function createBlockAlignOption(optionKey, title, value) {
		return createToolbarButton({
			formatKey: optionKey,
			formatType: 'blockAlign',
			title,
			icon: TOOLBAR_FORMAT_ICONS[optionKey],
			value,
			action: (editor) => {
				executeSchemaBlockAttributeOperation(editor, 'set_align', value);
			},
		});
	}

	/**
	 * Build one toolbar option for schema-backed text alignment.
	 *
	 * @param {string} optionKey Icon/format lookup key.
	 * @param {string} title Option title.
	 * @param {string} value Alignment value.
	 * @returns {Object} Runtime toolbar option definition.
	 */
	function createTextAlignmentOption(optionKey, title, value) {
		return createToolbarButton({
			formatKey: optionKey,
			formatType: 'textAlignment',
			title,
			icon: TOOLBAR_FORMAT_ICONS[optionKey],
			value,
			action: (editor) => {
				executeSchemaBlockAttributeOperation(editor, 'set_text_align', value);
			},
		});
	}

	/**
	 * Build one toolbar option for schema-backed heading level changes.
	 *
	 * @param {string|number} level Heading level or element-tag value.
	 * @returns {Object} Runtime toolbar option definition.
	 */
	function createHeadingLevelOption(level) {
		const value = typeof level === 'string' ? level.trim().toLowerCase() : level;
		const tag = typeof value === 'number' ? `h${value}` : value;
		const levelNumber = Number.parseInt(String(tag).replace(/^h/i, ''), 10);
		const title = tag === 'p' ? 'Paragraph' : tag === 'div' ? 'Div' : `Heading ${levelNumber}`;
		return createToolbarButton({
			formatKey: String(tag),
			title,
			icon: title,
			tag,
			value,
			action: (editor) => {
				executeSchemaBlockAttributeOperation(editor, 'set_heading_level', value);
			},
		});
	}

	/**
	 * Return the canonical built-in block-align toolbar option map.
	 *
	 * @returns {Map<string, Object>} Built-in block-align options keyed by value.
	 */
	function getBlockAlignOptionMap() {
		return new Map([
			['none', createBlockAlignOption('alignNone', 'None', 'none')],
			['wide', createBlockAlignOption('alignWide', 'Wide Width', 'wide')],
			['full', createBlockAlignOption('alignFull', 'Full Width', 'full')],
			['left', createBlockAlignOption('alignLeft', 'Align Left', 'left')],
			['center', createBlockAlignOption('alignCenter', 'Align Center', 'center')],
			['right', createBlockAlignOption('alignRight', 'Align Right', 'right')],
		]);
	}

	/**
	 * Create the schema-backed text-alignment dropdown.
	 *
	 * @returns {Object} Runtime toolbar dropdown definition.
	 */
	function createTextAlignmentDropdown() {
		return createToolbarDropdown({
			formatKey: 'textAlignment',
			title: 'Text Alignment',
			defaultIcon: TOOLBAR_FORMAT_ICONS.textAlignmentDropdown,
			options: [
				createTextAlignmentOption('textAlignLeft', 'Align Text Left', 'left'),
				createTextAlignmentOption('textAlignCenter', 'Align Text Center', 'center'),
				createTextAlignmentOption('textAlignRight', 'Align Text Right', 'right'),
			],
		});
	}

	function getSchemaBlockAlignValues(editorOptions = {}) {
		const operations = Array.isArray(editorOptions?.operations)
			? editorOptions.operations
			: [];
		const operation = operations.find(candidate => (
			String(candidate?.id || '').trim() === 'set_align' &&
			String(candidate?.kind || '').trim() === 'block_attribute_change'
		)) || null;
		const operationValues = Array.isArray(operation?.values)
			? operation.values
			: null;
		const capabilityValues = Array.isArray(editorOptions?.attributeCapabilities?.align?.values)
			? editorOptions.attributeCapabilities.align.values
			: null;
		const values = operationValues && operationValues.length
			? operationValues
			: capabilityValues;

		return Array.isArray(values)
			? values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
			: [];
	}

	function createBlockAlignDropdown(editorOptions = {}) {
		const allowedValues = getSchemaBlockAlignValues(editorOptions);
		const optionMap = getBlockAlignOptionMap();
		const options = allowedValues.map(value => optionMap.get(value)).filter(Boolean);

		if (!options.length) {
			return null;
		}

		return createToolbarDropdown({
			formatKey: 'align',
			title: 'Align',
			defaultIcon: options[0].icon,
			options
		});
	}

	/**
	 * Create the schema-backed heading-level dropdown.
	 *
	 * @returns {Object} Runtime toolbar dropdown definition.
	 */
	function createHeadingDropdown(editorOptions = {}) {
		const operation = (editorOptions.operations || []).find(candidate => (
			String(candidate?.id || '').trim() === 'set_heading_level'
		)) || null;
		const values = Array.isArray(operation?.values)
			? operation.values
			: (editorOptions.attributeCapabilities?.headingLevels?.values || []);
		return createToolbarDropdown({
			formatKey: 'headingLevels',
			title: 'Heading Level',
			defaultIcon: 'H',
			options: values.map(createHeadingLevelOption),
		});
	}

	/**
	 * Create the shared media-replace toolbar button.
	 *
	 * @returns {Object} Runtime toolbar button definition.
	 */
	function createReplaceMediaButton() {
		return createToolbarButton({
			formatKey: 'replaceMedia',
			icon: TOOLBAR_FORMAT_ICONS.replaceMedia,
			title: 'Replace Media',
			className: 'mwp-sfe-editor-btn-text',
			action: (editor) => {
				if (typeof editor?.showMediaReplaceUI === 'function') {
					editor.showMediaReplaceUI();
				}
			}
		});
	}

	/**
	 * Resolve one built-in schema toolbar token to a runtime format definition.
	 *
	 * @param {string} token Built-in schema toolbar token.
	 * @param {HTMLElement|null} element Active editable element.
	 * @param {Object} editorOptions Normalized editor options.
	 * @returns {Object|null} Runtime toolbar definition or null.
	 */
	function resolveSchemaFormatToken(token, element, editorOptions = {}) {
		const normalizedToken = typeof token === 'string' ? token.trim() : '';
		if (!normalizedToken) return null;

		switch (normalizedToken) {
			case 'undo':
				return createToolbarButton({
					formatKey: 'undo',
					title: 'Undo',
					icon: TOOLBAR_FORMAT_ICONS.undo,
					action: (editor) => editor?.undo?.(),
				});
			case 'redo':
				return createToolbarButton({
					formatKey: 'redo',
					title: 'Redo',
					icon: TOOLBAR_FORMAT_ICONS.redo,
					action: (editor) => editor?.redo?.(),
				});
			case 'bold':
				return createInlineFormatButton('bold', 'Bold', TOOLBAR_FORMAT_ICONS.bold, 'strong', ['strong', 'b']);
			case 'italic':
				return createInlineFormatButton('italic', 'Italic', TOOLBAR_FORMAT_ICONS.italic, 'em', ['em', 'i']);
			case 'strikethrough':
				return createInlineFormatButton('strikethrough', 'Strikethrough', TOOLBAR_FORMAT_ICONS.strikethrough, 's', ['s', 'strike']);
			case 'link':
				return createLinkButton('link', 'Link');
			case 'buttonLink':
				return !supportsElementScopedLinkToken(element, editorOptions)
					? null
					: createLinkButton('buttonLink', 'Button Link');
			case 'textAlignment':
				return createTextAlignmentDropdown();
			case 'align':
				return createBlockAlignDropdown(editorOptions);
			case 'headingLevels':
				return createHeadingDropdown(editorOptions);
			case 'orderedList':
				return createToolbarButton({
					formatKey: 'orderedList',
					title: 'Ordered List',
					icon: TOOLBAR_FORMAT_ICONS.orderedList,
					action: (editor) => executeListTypeOperation(editor, 'ordered'),
				});
			case 'unorderedList':
				return createToolbarButton({
					formatKey: 'unorderedList',
					title: 'Unordered List',
					icon: TOOLBAR_FORMAT_ICONS.unorderedList,
					action: (editor) => executeListTypeOperation(editor, 'unordered'),
				});
			case 'indent':
				return createListIndentButton('indent', 'Indent', TOOLBAR_FORMAT_ICONS.indent, 'indent_list_item');
			case 'outdent':
				return createListIndentButton('outdent', 'Outdent', TOOLBAR_FORMAT_ICONS.outdent, 'outdent_list_item');
			case 'replaceMedia':
				return createReplaceMediaButton();
			default:
				return null;
		}
	}

	/**
	 * Convert one nested schema format token spec into concrete toolbar configs.
	 *
	 * @param {Array} formatsSpec Nested schema token spec.
	 * @param {HTMLElement|null} element Active editable element.
	 * @param {Object} editorOptions Normalized editor options.
	 * @param {number} depth Current recursion depth.
	 * @returns {Array<Object|Array>|null} Concrete toolbar config tree.
	 */
	function buildFormatsFromSchemaSpec(formatsSpec, element, editorOptions = {}, depth = 0) {
		if (depth > 3 || !Array.isArray(formatsSpec)) return null;

		const resolved = [];
		formatsSpec.forEach(item => {
			if (typeof item === 'string') {
				const format = resolveSchemaFormatToken(item, element, editorOptions);
				if (format) {
					resolved.push(format);
				}
				return;
			}

			if (Array.isArray(item)) {
				const group = buildFormatsFromSchemaSpec(item, element, editorOptions, depth + 1);
				if (Array.isArray(group) && group.length) {
					resolved.push(group);
				}
			}
		});

		return resolved.length ? resolved : null;
	}

	/**
	 * Flatten one nested toolbar definition tree into a single format list.
	 *
	 * @param {Array<Object|Array>} items Nested toolbar definition tree.
	 * @returns {Object[]} Flat format list.
	 */
	function flattenFormats(items = []) {
		const flattened = [];

		(items || []).forEach((item) => {
			if (Array.isArray(item)) {
				flattened.push(...flattenFormats(item));
				return;
			}

			if (!item || typeof item !== 'object') {
				return;
			}

			flattened.push(item);

			if (item.type === 'dropdown' && Array.isArray(item.options)) {
				flattened.push(...flattenFormats(item.options));
			}
		});

		return flattened;
	}

	class ToolbarManager {
		constructor(host, options = {}) {
			this.host                          = host || null;
			this.options                       = options || {};
			this.toolbar                       = null;
			this._toolbarPointerdownHandler    = null;
			this._activeToolbarDropdownWrapper = null;

			if (this.host && typeof this.host.attachToolbarManager === 'function') {
				this.host.attachToolbarManager(this);
			}
		}

		getFormats() {
			return Array.isArray(this.host?.formats)
				? this.host.formats
				: [];
		}

		/**
		 * Return one flat runtime toolbar format list.
		 *
		 * @returns {Object[]} Flat toolbar format list.
		 */
		getFlatFormats() {
			return flattenFormats(this.getFormats());
		}

		createToolbar() {
			if (this.toolbar && this.toolbar.parentNode) this.toolbar.remove();

			this.toolbar           = document.createElement('div');
			this.toolbar.className = 'mwp-sfe-editor-toolbar';

			const selectorSvg = '<svg viewBox="0 0 18 18"><polygon class="mwp-sfe-stroke" points="7 11 9 13 11 11 7 11"></polygon><polygon class="mwp-sfe-stroke" points="7 7 9 5 11 7 7 7"></polygon></svg>';

			const createButton = (format) => {
				const btn          = document.createElement('button');
				btn.type           = 'button';
				btn.className      = ['mwp-sfe-editor-btn', format.className || ''].filter(Boolean).join(' ');
				btn.innerHTML      = format.icon;
				btn.title          = format.title;
				btn.dataset.format = format.title;

				if (format.title === 'Undo') btn.dataset.action = 'undo';
				if (format.title === 'Redo') btn.dataset.action = 'redo';

				btn.addEventListener('mousedown', (event) => event.preventDefault());
				btn.addEventListener('click', (event) => {
					event.preventDefault();
					format.action(this.host);
				});
				return btn;
			};

			const buildItems = (items, container) => {
				items.forEach(item => {
					if (Array.isArray(item)) {
						const group     = document.createElement('div');
						group.className = 'mwp-sfe-btn-group';
						buildItems(item, group);
						container.appendChild(group);
					} else if (item.type === 'dropdown') {
						const wrapper     = document.createElement('div');
						wrapper.className = 'mwp-sfe-dropdown';

						const toggle     = document.createElement('button');
						toggle.className = 'mwp-sfe-editor-btn mwp-sfe-dropdown-toggle';
						toggle.title     = item.title;
						if (item.formatKey === 'headingLevels') {
							wrapper.classList.add('mwp-sfe-dropdown-heading-level');
							toggle.innerHTML = `<span>${item.defaultIcon} ${selectorSvg}</span>`;
						} else {
							toggle.innerHTML = `${item.defaultIcon}`;
						}

						const content     = document.createElement('div');
						content.className = 'mwp-sfe-dropdown-content';

						item.options.forEach(opt => {
							const optBtn = createButton(opt);
							optBtn.addEventListener('click', () => {
							if (item.formatKey === 'headingLevels') {
									toggle.innerHTML = `${opt.icon} ${selectorSvg}`;
								} else {
									toggle.innerHTML = `${opt.icon}`;
								}
								content.classList.remove('mwp-sfe-show');
							});
							content.appendChild(optBtn);
						});

						toggle.addEventListener('mousedown', (event) => event.preventDefault());
						toggle.addEventListener('click', (event) => {
							event.preventDefault();
							this.toolbar.querySelectorAll('.mwp-sfe-dropdown-content.mwp-sfe-show').forEach(el => {
								if (el !== content) el.classList.remove('mwp-sfe-show');
							});
							content.classList.toggle('mwp-sfe-show');
							this._activeToolbarDropdownWrapper = content.classList.contains('mwp-sfe-show')
								? wrapper
								: null;
						});

						wrapper.appendChild(toggle);
						wrapper.appendChild(content);

						if (container.className !== 'mwp-sfe-btn-group') {
							const group     = document.createElement('div');
							group.className = 'mwp-sfe-btn-group';
							group.appendChild(wrapper);
							container.appendChild(group);
						} else {
							container.appendChild(wrapper);
						}
					} else {
						const btn = createButton(item);

						if (container.className !== 'mwp-sfe-btn-group') {
							const group     = document.createElement('div');
							group.className = 'mwp-sfe-btn-group';
							group.appendChild(btn);
							container.appendChild(group);
						} else {
							container.appendChild(btn);
						}
					}
				});
			};

			buildItems(this.getFormats(), this.toolbar);
			this.attachToolbarDropdownCloseHandler();

			const toolbarContainer = this.host?.options?.toolbarContainer || null;
			if (toolbarContainer) {
				toolbarContainer.innerHTML = '';
				toolbarContainer.appendChild(this.toolbar);
			} else if (this.host?.element?.parentNode) {
				this.host.element.parentNode.insertBefore(this.toolbar, this.host.element);
			}

			this.updateUndoRedoButtons();
		}

		closeToolbarDropdowns() {
			if (!this.toolbar) {
				return;
			}

			this.toolbar.querySelectorAll('.mwp-sfe-dropdown-content.mwp-sfe-show').forEach((element) => {
				element.classList.remove('mwp-sfe-show');
			});
			this._activeToolbarDropdownWrapper = null;
		}

		attachToolbarDropdownCloseHandler() {
			if (!this.toolbar) {
				return;
			}

			if (this._toolbarPointerdownHandler) {
				document.removeEventListener('pointerdown', this._toolbarPointerdownHandler, true);
			}

			this._toolbarPointerdownHandler = (event) => {
				if (
					!this.toolbar ||
					(
						this._activeToolbarDropdownWrapper &&
						this._activeToolbarDropdownWrapper.contains(event.target)
					)
				) {
					return;
				}

				this.closeToolbarDropdowns();
			};

			document.addEventListener('pointerdown', this._toolbarPointerdownHandler, true);
		}

		updateUndoRedoButtons() {
			if (!this.toolbar) return;

			const undoBtn = this.toolbar.querySelector('[data-action="undo"]');
			const redoBtn = this.toolbar.querySelector('[data-action="redo"]');
			const canUndo = typeof this.host?.canUndo === 'function'
				? this.host.canUndo()
				: (
					typeof this.host?.historyIndex === 'number' &&
					this.host.historyIndex > 0
				);
			const canRedo = typeof this.host?.canRedo === 'function'
				? this.host.canRedo()
				: (
					typeof this.host?.historyIndex === 'number' &&
					Array.isArray(this.host?.history) &&
					this.host.historyIndex < this.host.history.length - 1
				);

			if (undoBtn) {
				undoBtn.disabled = !canUndo;
			}

			if (redoBtn) {
				redoBtn.disabled = !canRedo;
			}
		}

		setToolbarButtonDisabled(title, isDisabled) {
			if (!this.toolbar || !title) {
				return;
			}

			const button = this.toolbar.querySelector(`button[title="${title}"]`);
			if (button) {
				button.disabled = !!isDisabled;
			}
		}

		updateToolbarState() {
			if (!this.toolbar || !this.host) return;

			const selection = window.getSelection();
			const hasSelectionInEditor = (
				selection &&
				selection.rangeCount &&
				typeof this.host.isSelectionInEditor === 'function' &&
				this.host.isSelectionInEditor()
			);
			const parents = [];

			if (this.host.element?.tagName) {
				parents.push(this.host.element.tagName.toLowerCase());
			}

			if (hasSelectionInEditor) {
				const range = selection.getRangeAt(0);
				let node    = range.commonAncestorContainer;

				while (node && node !== this.host.element) {
					if (node.nodeType === 1) parents.push(node.tagName.toLowerCase());
					node = node.parentNode;
				}
			}

			this.toolbar.querySelectorAll('.mwp-sfe-editor-btn').forEach(btn => {
				btn.classList.remove('mwp-sfe-editor-btn-active');
			});

			const checkActive = (format, tags) => {
				if (!format || !Array.isArray(tags) || !tags.some(tag => parents.includes(tag))) {
					return false;
				}

				const btn = this.toolbar.querySelector(`button[title="${format.title}"]`);
				if (btn) btn.classList.add('mwp-sfe-editor-btn-active');
				return true;
			};

			if (hasSelectionInEditor) {
				this.getFlatFormats().forEach((format) => {
					if (!Array.isArray(format?.activeTags) || !format.activeTags.length) {
						return;
					}

					checkActive(format, format.activeTags);
				});
			}

			const currentAlign = typeof this.host.getBlockAlignState === 'function'
				? this.host.getBlockAlignState()
				: 'none';
			const currentTextAlignment = typeof this.host.getTextAlignmentState === 'function'
				? this.host.getTextAlignmentState()
				: 'left';
			const currentHeadingLevel = typeof this.host.getHeadingLevelState === 'function'
				? this.host.getHeadingLevelState()
				: null;

			const getDropdownFormats = (items) => {
				const dropdowns = [];

				(items || []).forEach(item => {
					if (Array.isArray(item)) {
						dropdowns.push(...getDropdownFormats(item));
						return;
					}

					if (item && item.type === 'dropdown') {
						dropdowns.push(item);
					}
				});

				return dropdowns;
			};

			getDropdownFormats(this.getFormats()).forEach(item => {
				const toggle = this.toolbar.querySelector(`button[title="${item.title}"]`);
				if (!toggle) return;

				const activeOption = item.options.find(opt => {
					const headingLevel = typeof this.host.getHeadingLevelValueForOption === 'function'
						? this.host.getHeadingLevelValueForOption(opt)
						: null;

					if ( item.formatKey === 'headingLevels' && headingLevel === currentHeadingLevel ) {
						return true;
					}

					if (
						typeof this.host.isTextAlignmentOptionActive === 'function' &&
						this.host.isTextAlignmentOptionActive(opt, currentTextAlignment)
					) {
						return true;
					}

					if (
						typeof this.host.isBlockAlignOptionActive === 'function' &&
						this.host.isBlockAlignOptionActive(opt, currentAlign)
					) {
						return true;
					}

					return false;
				});

				const selectorSvg = '<svg viewBox="0 0 18 18"><polygon class="mwp-sfe-stroke" points="7 11 9 13 11 11 7 11"></polygon><polygon class="mwp-sfe-stroke" points="7 7 9 5 11 7 7 7"></polygon></svg>';

				if (activeOption) {
					toggle.innerHTML = item.formatKey === 'headingLevels'
						? `<span>${activeOption.icon} ${selectorSvg}</span>`
						: `${activeOption.icon}`;
				} else {
					toggle.innerHTML = item.formatKey === 'headingLevels'
						? `<span>${item.defaultIcon} ${selectorSvg}</span>`
						: `${item.defaultIcon}`;
				}

				item.options.forEach(opt => {
					const optionButton = this.toolbar.querySelector(`button[title="${opt.title}"]`);
					if (!optionButton) return;

					let isDisabled = false;

					if (item.formatKey === 'headingLevels') {
						const optionLevel = typeof this.host.getHeadingLevelValueForOption === 'function'
							? this.host.getHeadingLevelValueForOption(opt)
							: null;

						isDisabled = optionLevel === currentHeadingLevel;
					} else if (
						typeof this.host.getTextAlignmentValueForOption === 'function' &&
						this.host.getTextAlignmentValueForOption(opt)
					) {
						isDisabled = typeof this.host.isTextAlignmentOptionActive === 'function'
							? this.host.isTextAlignmentOptionActive(opt, currentTextAlignment)
							: false;
					} else if (
						typeof this.host.getBlockAlignValueForOption === 'function' &&
						this.host.getBlockAlignValueForOption(opt)
					) {
						isDisabled = typeof this.host.isBlockAlignOptionActive === 'function'
							? this.host.isBlockAlignOptionActive(opt, currentAlign)
							: false;
					}

					optionButton.disabled = isDisabled;
				});
			});

			const operationExecutor = SFE.SchemaOperationExecutor || null;
			const currentListItem = typeof this.host.getCurrentListItem === 'function'
				? this.host.getCurrentListItem()
				: null;
			const currentList = (
				operationExecutor &&
				typeof operationExecutor.getCurrentListElement === 'function'
			)
				? operationExecutor.getCurrentListElement(this.host)
				: (
					typeof this.host.getParentList === 'function'
						? this.host.getParentList()
						: null
				);
			const canIndent = typeof this.host.canIndentListItem === 'function'
				? this.host.canIndentListItem(currentListItem)
				: false;
			const canOutdent = typeof this.host.canOutdentListItem === 'function'
				? this.host.canOutdentListItem(currentListItem)
				: false;

			this.setToolbarButtonDisabled('Ordered List', !currentList || currentList.tagName === 'OL');
			this.setToolbarButtonDisabled('Unordered List', !currentList || currentList.tagName === 'UL');
			this.setToolbarButtonDisabled('Indent', !currentListItem || !canIndent);
			this.setToolbarButtonDisabled('Outdent', !currentListItem || !canOutdent);

			this.updateUndoRedoButtons();
		}

		destroy(options = {}) {
			const removeToolbar = options.removeToolbar !== false;

			if (this._toolbarPointerdownHandler) {
				document.removeEventListener('pointerdown', this._toolbarPointerdownHandler, true);
				this._toolbarPointerdownHandler = null;
			}

			this._activeToolbarDropdownWrapper = null;

			if (removeToolbar && this.toolbar && this.toolbar.parentNode) {
				this.toolbar.remove();
			}

			if (this.host && typeof this.host.detachToolbarManager === 'function') {
				this.host.detachToolbarManager(this);
			}

			this.toolbar = removeToolbar ? null : this.toolbar;
			this.host = null;
		}

		static resolveFormats(editorOptions = {}, element = null) {
			const schemaFormats = buildFormatsFromSchemaSpec(editorOptions?.formats, element, editorOptions);
			return Array.isArray(schemaFormats) && schemaFormats.length
				? schemaFormats
				: [];
		}
	}

	SFE.ToolbarManager = ToolbarManager;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { ToolbarManager };
	}
})();
