/**
 * Shared schema-operation executor for live editor mutations.
 *
 * This is the canonical runtime bridge between schema/public-api operation
 * payloads and the active frontend editor instance. Toolbar actions and the
 * public API should both flow through this executor so one operation kind has
 * one mutation path.
 *
 * Exposes: SFE.SchemaOperationExecutor
 *   {
 *     executeComponentOperation, executeComponentOperations,
 *     executeMediaOperation, executeMediaOperations,
 *     executeBlockAttributeOperation, executeBlockAttributeOperations,
 *     executeListOperations, executeCurrentListTypeChange, getTrackerForEditor,
 *     getCurrentListElement, getListPathForElement, syncEditorRoot,
 *     isUnsetBlockAttributeValue, normalizeBlockAttributeTrackedValue,
 *     getTextAlignmentCapability, getNormalizedTextAlignmentCapability,
 *     isTextAlignmentOperation
 *   }
 */
(function() {
	'use strict';

	window.MWP = window.MWP || {};
	window.MWP.SFE = window.MWP.SFE || {};

	const SFE = window.MWP.SFE;

	/**
	 * Return whether one candidate element is a list root.
	 *
	 * @param   {HTMLElement|null} element Candidate DOM element.
	 * @returns {boolean}                  True when the element is `UL` or `OL`.
	 */
	function isListElement(element) {
		return !!(
			element &&
			element.nodeType === Node.ELEMENT_NODE &&
			(element.tagName === 'UL' || element.tagName === 'OL')
		);
	}

	/**
	 * Normalize one operations payload to an array.
	 *
	 * @param   {Object} options Executor options.
	 * @returns {Object[]}       Normalized operations list.
	 */
	function normalizeOperations(options = {}) {
		if (Array.isArray(options.operations)) {
			return options.operations.filter(operation => operation && typeof operation === 'object');
		}

		if (options.operation && typeof options.operation === 'object') {
			return [ options.operation ];
		}

		return [];
	}

	/**
	 * Capture one editor-relative selection snapshot before a batched mutation.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object}      options   Executor options.
	 * @returns {Object|null}           Saved cursor/selection snapshot.
	 */
	function captureSelectionSnapshot(editorHost, options = {}) {
		if (
			options.restoreCursor === false ||
			!editorHost ||
			typeof editorHost.isSelectionInEditor !== 'function' ||
			typeof editorHost.saveCursorPosition !== 'function' ||
			!editorHost.isSelectionInEditor()
		) {
			return null;
		}

		return editorHost.saveCursorPosition();
	}

	/**
	 * Resolve the shared list tracker module.
	 *
	 * @returns {Object|null} List tracker module when loaded.
	 */
	function getListTrackerModule() {
		return SFE.ListBlockTracker || null;
	}

	/**
	 * Resolve one live tracker for an editor-bound list root.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @returns {Object|null}           Active list tracker.
	 */
	function getTrackerForEditor(editorHost) {
		const listTracker = getListTrackerModule();
		if (!listTracker || !editorHost || !isListElement(editorHost.element)) {
			return null;
		}

		if (editorHost.element._mwpListTracker?.listElement) {
			return editorHost.element._mwpListTracker;
		}

		if (listTracker.active?.listElement === editorHost.element) {
			return listTracker.active;
		}

		if (typeof listTracker.init === 'function') {
			return listTracker.init(editorHost.element, editorHost.originalBlock || {});
		}

		return null;
	}

	/**
	 * Sync one editor instance to the tracker's current root list element.
	 *
	 * Root list type changes replace the editable element. All editor-facing
	 * callers should update their element reference through this helper instead
	 * of assuming the original root still exists.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object|null} tracker   Active list tracker.
	 * @returns {void}
	 */
	function syncEditorRoot(editorHost, tracker) {
		if (!editorHost || !tracker?.listElement) {
			return;
		}

		if (editorHost.element !== tracker.listElement) {
			editorHost.element = tracker.listElement;
		}

		if (typeof editorHost.syncPlaceholderState === 'function') {
			editorHost.syncPlaceholderState();
		}
	}

	/**
	 * Restore one saved editor-relative selection after a batched mutation.
	 *
	 * @param   {Object|null} editorHost      Active schema editor host.
	 * @param   {Object|null} savedSelection Saved cursor/selection snapshot.
	 * @returns {void}
	 */
	function restoreSelectionSnapshot(editorHost, savedSelection) {
		if (
			!savedSelection ||
			!editorHost ||
			typeof editorHost.restoreCursorPosition !== 'function'
		) {
			return;
		}

		try {
			if (typeof editorHost.element?.focus === 'function') {
				editorHost.element.focus();
			}
		} catch (error) {
			// Focus failures are non-fatal; selection restore below may still work.
		}

		editorHost.restoreCursorPosition(savedSelection);
	}

	/**
	 * Resolve the current list element targeted by one list-editor selection.
	 *
	 * When the selection is inside a nested list item, the target is that
	 * list item's immediate parent list. If the selection cannot be mapped to
	 * a concrete list item, fall back to the editor root list itself.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @returns {HTMLElement|null}      Target list element.
	 */
	function getCurrentListElement(editorHost) {
		if (!editorHost || !isListElement(editorHost.element)) {
			return null;
		}

		const currentListItem = typeof editorHost.getCurrentListItem === 'function'
			? editorHost.getCurrentListItem()
			: null;
		if (currentListItem?.parentElement && isListElement(currentListItem.parentElement)) {
			return currentListItem.parentElement;
		}

		const currentList = typeof editorHost.getParentList === 'function'
			? editorHost.getParentList()
			: null;
		return isListElement(currentList) ? currentList : editorHost.element;
	}

	/**
	 * Resolve the schema/public-api list path for one concrete list element.
	 *
	 * @param   {Object|null}      tracker     Active list tracker.
	 * @param   {HTMLElement|null} listElement Concrete list element.
	 * @returns {string}                      Root-relative list path.
	 */
	function getListPathForElement(tracker, listElement) {
		const listTracker = getListTrackerModule();
		if (!listTracker || !tracker?.listElement || !isListElement(listElement)) {
			return '';
		}

		if (typeof listTracker.getPathForList === 'function') {
			return String(listTracker.getPathForList(tracker, listElement) || '');
		}

		return listElement === tracker.listElement ? '' : '';
	}

	/**
	 * Resolve the schema/public-api item path for one concrete list item.
	 *
	 * @param   {Object|null}        tracker  Active list tracker.
	 * @param   {HTMLLIElement|null} listItem Concrete list item.
	 * @returns {string}                     Root-relative item path.
	 */
	function getListItemPathForElement(tracker, listItem) {
		const listTracker = getListTrackerModule();
		if (
			!listTracker ||
			!tracker?.listElement ||
			!listItem ||
			listItem.nodeType !== Node.ELEMENT_NODE ||
			listItem.tagName !== 'LI' ||
			typeof listTracker.getPathIndexesForItem !== 'function'
		) {
			return '';
		}

		const pathIndexes = listTracker.getPathIndexesForItem(tracker, listItem);
		return Array.isArray(pathIndexes) && pathIndexes.length
			? pathIndexes.join('_')
			: '';
	}

	/**
	 * Resolve the current runtime UUID for one concrete list element.
	 *
	 * @param   {Object|null}      tracker     Active list tracker.
	 * @param   {HTMLElement|null} listElement Concrete list element.
	 * @returns {string}                      Session-scoped list UUID.
	 */
	function getListRuntimeUuidForElement(tracker, listElement) {
		const listTracker = getListTrackerModule();
		if (
			!listTracker ||
			!tracker?.listElement ||
			!isListElement(listElement) ||
			typeof listTracker.getRuntimeUuidForList !== 'function'
		) {
			return '';
		}

		return String(listTracker.getRuntimeUuidForList(tracker, listElement) || '');
	}

	/**
	 * Resolve the current runtime UUID for one concrete list item.
	 *
	 * @param   {Object|null}        tracker  Active list tracker.
	 * @param   {HTMLLIElement|null} listItem Concrete list item.
	 * @returns {string}                     Session-scoped item UUID.
	 */
	function getListItemRuntimeUuidForElement(tracker, listItem) {
		const listTracker = getListTrackerModule();
		if (
			!listTracker ||
			!tracker?.listElement ||
			!listItem ||
			listItem.nodeType !== Node.ELEMENT_NODE ||
			listItem.tagName !== 'LI' ||
			typeof listTracker.getRuntimeUuidForItem !== 'function'
		) {
			return '';
		}

		return String(listTracker.getRuntimeUuidForItem(tracker, listItem) || '');
	}

	/**
	 * Return the schema-declared editor operations for one active editor.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @returns {Object[]}              Supported schema operation descriptors.
	 */
	function getEditorOperations(editorHost) {
		return Array.isArray(editorHost?.options?.operations)
			? editorHost.options.operations.filter(operation => operation && typeof operation === 'object')
			: [];
	}

	/**
	 * Return one component map for the current active editor session.
	 *
	 * @param   {Object|null} editorState Active editor state.
	 * @returns {Object<string, Object>}  Component metadata keyed by component ID.
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
	 * Normalize one candidate string array.
	 *
	 * @param   {*} rawValues Candidate values.
	 * @returns {string[]}    Trimmed non-empty strings.
	 */
	function normalizeStringArray(rawValues) {
		return Array.isArray(rawValues)
			? rawValues
				.map(value => String(value || '').trim())
				.filter(Boolean)
			: [];
	}

	/**
	 * Return one normalized link capability object for the supplied format token.
	 *
	 * @param   {Object} inlineCapabilities Available inline format capabilities.
	 * @param   {string} formatToken        Inline format token.
	 * @returns {Object}                    Normalized capability data.
	 */
	function getInlineLinkCapability(inlineCapabilities, formatToken) {
		const capability = inlineCapabilities?.[formatToken] && typeof inlineCapabilities[formatToken] === 'object'
			? inlineCapabilities[formatToken]
			: {};

		return {
			...capability,
			tag: String(capability.tag || '').trim().toLowerCase(),
			allowedTargets: normalizeStringArray(capability.allowedTargets),
			allowedRelTokens: normalizeStringArray(capability.allowedRelTokens).map(value => value.toLowerCase()),
			allowedProtocols: normalizeStringArray(capability.allowedProtocols).map(value => value.toLowerCase()),
			autoProtocol: typeof capability.autoProtocol === 'string'
				? capability.autoProtocol.trim().toLowerCase()
				: '',
			allowsRelativeUrls: capability.allowsRelativeUrls !== false,
			allowsAnchorLinks: capability.allowsAnchorLinks !== false,
			preservesUnknownRelTokens: capability.preservesUnknownRelTokens === true,
		};
	}

	/**
	 * Return whether one candidate attribute payload contains link-like data.
	 *
	 * @param   {Object|null} candidateAttributes Candidate link payload.
	 * @returns {boolean}                        True when link-like keys are present.
	 */
	function componentRunAttributesContainLinkData(candidateAttributes) {
		if (!candidateAttributes || typeof candidateAttributes !== 'object') {
			return false;
		}

		if (
			Object.prototype.hasOwnProperty.call(candidateAttributes, 'href') ||
			Object.prototype.hasOwnProperty.call(candidateAttributes, 'url') ||
			Object.prototype.hasOwnProperty.call(candidateAttributes, 'target') ||
			Object.prototype.hasOwnProperty.call(candidateAttributes, 'rel')
		) {
			return true;
		}

		return Boolean(candidateAttributes.settings && typeof candidateAttributes.settings === 'object');
	}

	/**
	 * Resolve one raw per-format link attribute payload.
	 *
	 * @param   {Object|null} rawFormatAttributes Raw format attribute map.
	 * @param   {string}      formatToken         Current link format token.
	 * @param   {string[]}    linkFormatTokens    Active link format tokens.
	 * @returns {Object}                          Raw link attribute payload.
	 */
	function getComponentRunLinkFormatAttributes(rawFormatAttributes, formatToken, linkFormatTokens) {
		const source = rawFormatAttributes && typeof rawFormatAttributes === 'object'
			? rawFormatAttributes
			: {};
		const directAttributes = source[formatToken];
		if (directAttributes && typeof directAttributes === 'object' && !Array.isArray(directAttributes)) {
			return directAttributes;
		}

		if (!Array.isArray(linkFormatTokens) || linkFormatTokens.length !== 1) {
			return {};
		}

		const misplacedToken = Object.keys(source).find(token => {
			if (String(token || '').trim() === formatToken) {
				return false;
			}

			return componentRunAttributesContainLinkData(source[token]);
		});

		return misplacedToken ? source[misplacedToken] : {};
	}

	/**
	 * Return whether the supplied rel token is allowed for one link capability.
	 *
	 * @param   {string} relToken   Candidate rel token.
	 * @param   {Object} capability Normalized link capability data.
	 * @returns {boolean}           True when the token is allowed.
	 */
	function linkCapabilityAllowsRelToken(relToken, capability) {
		const token = String(relToken || '').trim().toLowerCase();
		if (!token) {
			return false;
		}

		return !capability.allowedRelTokens.length
			|| capability.allowedRelTokens.includes(token)
			|| capability.preservesUnknownRelTokens;
	}

	/**
	 * Apply one model-facing link settings payload onto raw link attributes.
	 *
	 * @param   {Object|null} linkAttributes Current sanitized attributes.
	 * @param   {Object|null} settings       Model-facing settings payload.
	 * @param   {Object}      capability     Normalized link capability data.
	 * @returns {Object}                     Merged link attributes.
	 */
	function mergeComponentLinkSettingsIntoAttributes(linkAttributes, settings, capability) {
		const merged = linkAttributes && typeof linkAttributes === 'object'
			? { ...linkAttributes }
			: {};
		const source = settings && typeof settings === 'object' ? settings : {};

		if (Object.prototype.hasOwnProperty.call(source, 'new_tab')) {
			if (source.new_tab && capability.allowedTargets.includes('_blank')) {
				merged.target = '_blank';
			} else if (!source.new_tab && merged.target === '_blank') {
				delete merged.target;
			}
		}

		if (Object.prototype.hasOwnProperty.call(source, 'no_follow')) {
			const relTokens = Array.from(new Set(
				String(merged.rel || '')
					.split(/\s+/)
					.map(value => String(value || '').trim().toLowerCase())
					.filter(Boolean)
			));

			if (source.no_follow && linkCapabilityAllowsRelToken('nofollow', capability)) {
				relTokens.push('nofollow');
			} else if (!source.no_follow) {
				const nextTokens = relTokens.filter(token => token !== 'nofollow');
				relTokens.length = 0;
				relTokens.push(...nextTokens);
			}

			if (relTokens.length) {
				merged.rel = Array.from(new Set(relTokens)).join(' ');
			} else {
				delete merged.rel;
			}
		}

		return merged;
	}

	/**
	 * Sanitize one candidate link href against schema capability metadata.
	 *
	 * @param   {*}      rawHref     Candidate raw href or url value.
	 * @param   {Object} capability  Normalized link capability data.
	 * @returns {string}             Sanitized href or an empty string.
	 */
	function sanitizeComponentLinkHref(rawHref, capability) {
		const value = String(rawHref || '').trim();
		if (!value) {
			return '';
		}

		if (value.startsWith('#')) {
			return capability.allowsAnchorLinks ? value : '';
		}

		if (/^(\/|\.\/|\.\.\/)/.test(value)) {
			return capability.allowsRelativeUrls ? value : '';
		}

		const protocolMatch = value.match(/^([a-z][a-z0-9+.-]*):/i);
		if (protocolMatch) {
			const protocol = String(protocolMatch[1] || '').trim().toLowerCase();
			return !capability.allowedProtocols.length || capability.allowedProtocols.includes(protocol)
				? value
				: '';
		}

		if (capability.autoProtocol) {
			return `${capability.autoProtocol}://${value}`;
		}

		return capability.allowsRelativeUrls ? value : '';
	}

	/**
	 * Normalize one raw run format-attribute map into canonical FrontEdit shape.
	 *
	 * @param   {Object|null} rawFormatAttributes Raw per-format attribute map.
	 * @param   {string[]}    formats             Active sanitized format tokens.
	 * @param   {Object}      inlineCapabilities  Available inline format capabilities.
	 * @returns {Object<string, Object>}          Canonical format-attribute map.
	 */
	function normalizeComponentRunFormatAttributes(rawFormatAttributes, formats, inlineCapabilities) {
		const source = rawFormatAttributes && typeof rawFormatAttributes === 'object'
			? rawFormatAttributes
			: {};
		const normalized = {};
		const linkFormatTokens = Array.from(new Set(
			(Array.isArray(formats) ? formats : [])
				.map(value => String(value || '').trim())
				.filter(token => getInlineLinkCapability(inlineCapabilities, token).tag === 'a')
		));

		formats.forEach(formatToken => {
			const capability = getInlineLinkCapability(inlineCapabilities, formatToken);
			if (capability.tag !== 'a') {
				return;
			}

			const rawLinkAttributes = getComponentRunLinkFormatAttributes(source, formatToken, linkFormatTokens);
			if (!rawLinkAttributes || typeof rawLinkAttributes !== 'object') {
				return;
			}

			let linkAttributes = {};
			const href = sanitizeComponentLinkHref(rawLinkAttributes.href || rawLinkAttributes.url || '', capability);
			if (href) {
				linkAttributes.href = href;
			}

			const target = String(rawLinkAttributes.target || '').trim();
			if (!capability.allowedTargets.length || capability.allowedTargets.includes(target)) {
				if (target) {
					linkAttributes.target = target;
				}
			}

			if (rawLinkAttributes.settings && typeof rawLinkAttributes.settings === 'object') {
				linkAttributes = mergeComponentLinkSettingsIntoAttributes(
					linkAttributes,
					rawLinkAttributes.settings,
					capability
				);
			}

			const rel = String(rawLinkAttributes.rel || '').trim();
			if (rel) {
				const normalizedRel = Array.from(new Set(
					rel
						.split(/\s+/)
						.map(value => String(value || '').trim().toLowerCase())
						.filter(token => token && linkCapabilityAllowsRelToken(token, capability))
				));
				if (normalizedRel.length) {
					linkAttributes.rel = normalizedRel.join(' ');
				}
			}

			if (Object.keys(linkAttributes).length) {
				normalized[formatToken] = linkAttributes;
			}
		});

		return normalized;
	}

	/**
	 * Normalize one raw structured run list into canonical FrontEdit component runs.
	 *
	 * @param   {*}      rawRuns             Candidate raw run list.
	 * @param   {Object} inlineCapabilities  Available inline format capabilities.
	 * @returns {Array<Object>}              Canonical structured runs.
	 */
	function normalizeComponentRuns(rawRuns, inlineCapabilities) {
		if (!Array.isArray(rawRuns)) {
			return [];
		}

		return rawRuns.reduce((runs, run) => {
			if (!run || typeof run !== 'object' || !Object.prototype.hasOwnProperty.call(run, 'text')) {
				return runs;
			}

			const text = String(run.text || '');
			const formats = Array.isArray(run.formats)
				? Array.from(new Set(
					run.formats
						.map(value => String(value || '').trim())
						.filter(token => token && Object.prototype.hasOwnProperty.call(inlineCapabilities || {}, token))
				))
				: [];
			const rawFormatAttributes = run.formatAttributes && typeof run.formatAttributes === 'object'
				? run.formatAttributes
				: (run.format_attributes && typeof run.format_attributes === 'object'
					? run.format_attributes
					: {});

			runs.push({
				text,
				formats,
				formatAttributes: normalizeComponentRunFormatAttributes(rawFormatAttributes, formats, inlineCapabilities),
			});

			return runs;
		}, []);
	}

	/**
	 * Read one normalized host-link attribute snapshot from a component element.
	 *
	 * @param   {Element|null} element Current host element.
	 * @returns {Object}               Existing host link attributes.
	 */
	function getExistingComponentHostLinkAttributes(element) {
		if (!element || element.nodeType !== Node.ELEMENT_NODE) {
			return {};
		}

		const href = String(element.getAttribute('href') || '').trim();
		const target = String(element.getAttribute('target') || '').trim();
		const rel = String(element.getAttribute('rel') || '').trim();
		const attributes = {};

		if (href) {
			attributes.href = href;
		}
		if (target) {
			attributes.target = target;
		}
		if (rel) {
			attributes.rel = rel;
		}

		return attributes;
	}

	/**
	 * Build one canonical host-link attribute payload from an operation input.
	 *
	 * @param   {Object} operationInput Raw operation payload.
	 * @param   {Object} capability     Normalized link capability data.
	 * @param   {Object} operation      Resolved schema operation metadata.
	 * @param   {Element} element       Host component element.
	 * @returns {Object|null}           Canonical link attributes or null when invalid.
	 */
	function normalizeComponentHostLinkOperationPayload(operationInput, capability, operation, element) {
		const payload = operationInput.link && typeof operationInput.link === 'object'
			? operationInput.link
			: (operationInput.attributes && typeof operationInput.attributes === 'object' && !Array.isArray(operationInput.attributes)
				? operationInput.attributes
				: (operationInput.value && typeof operationInput.value === 'object' && !Array.isArray(operationInput.value)
					? operationInput.value
					: operationInput));
		let nextAttributes = operation?.preserveUnspecifiedAttributes === false
			? {}
			: getExistingComponentHostLinkAttributes(element);
		let didReceivePayload = false;

		if (Object.prototype.hasOwnProperty.call(payload, 'href') || Object.prototype.hasOwnProperty.call(payload, 'url')) {
			didReceivePayload = true;
			const href = sanitizeComponentLinkHref(payload.href || payload.url || '', capability);
			if (href) {
				nextAttributes.href = href;
			} else {
				delete nextAttributes.href;
			}
		}

		if (Object.prototype.hasOwnProperty.call(payload, 'target') || Object.prototype.hasOwnProperty.call(payload, 'linkTarget')) {
			didReceivePayload = true;
			const target = String(payload.target || payload.linkTarget || '').trim();
			if (!target) {
				delete nextAttributes.target;
			} else if (!capability.allowedTargets.length || capability.allowedTargets.includes(target)) {
				nextAttributes.target = target;
			}
		}

		if (Object.prototype.hasOwnProperty.call(payload, 'rel')) {
			didReceivePayload = true;
			const rel = String(payload.rel || '').trim();
			if (!rel) {
				delete nextAttributes.rel;
			} else {
				const normalizedRel = Array.from(new Set(
					rel
						.split(/\s+/)
						.map(value => String(value || '').trim().toLowerCase())
						.filter(token => token && linkCapabilityAllowsRelToken(token, capability))
				));
				if (normalizedRel.length) {
					nextAttributes.rel = normalizedRel.join(' ');
				} else {
					delete nextAttributes.rel;
				}
			}
		}

		const settings = payload.settings && typeof payload.settings === 'object'
			? { ...payload.settings }
			: {};
		if (Object.prototype.hasOwnProperty.call(payload, 'new_tab')) {
			settings.new_tab = payload.new_tab;
			didReceivePayload = true;
		}
		if (Object.prototype.hasOwnProperty.call(payload, 'no_follow')) {
			settings.no_follow = payload.no_follow;
			didReceivePayload = true;
		}
		if (Object.keys(settings).length) {
			didReceivePayload = true;
			nextAttributes = mergeComponentLinkSettingsIntoAttributes(nextAttributes, settings, capability);
		}

		return didReceivePayload ? nextAttributes : null;
	}

	/**
	 * Apply one normalized host-link attribute payload to a component element.
	 *
	 * @param   {Element|null} element        Host component element.
	 * @param   {Object}       linkAttributes Canonical link attributes.
	 * @returns {boolean}                    True when the mutation applied.
	 */
	function applyComponentHostLinkAttributes(element, linkAttributes) {
		if (!element || element.nodeType !== Node.ELEMENT_NODE || !linkAttributes || typeof linkAttributes !== 'object') {
			return false;
		}

		const href = String(linkAttributes.href || '').trim();
		const target = String(linkAttributes.target || '').trim();
		const rel = String(linkAttributes.rel || '').trim();

		if (href) {
			element.setAttribute('href', href);
			if ('href' in element) {
				element.href = href;
			}
		} else {
			element.removeAttribute('href');
		}

		if (target) {
			element.setAttribute('target', target);
		} else {
			element.removeAttribute('target');
		}

		if (rel) {
			element.setAttribute('rel', rel);
		} else {
			element.removeAttribute('rel');
		}

		return true;
	}

	/**
	 * Flatten one line-based rich-text payload into canonical runs.
	 *
	 * This remains an undocumented compatibility input so callers such as ABE
	 * can migrate to direct runs later without FrontEdit reimplementing broker logic
	 * outside the shared executor.
	 *
	 * @param   {*} rawLines Candidate raw line list.
	 * @returns {Array<Object>} Flat run list with literal newline separators.
	 */
	function flattenComponentLineRuns(rawLines) {
		if (!Array.isArray(rawLines)) {
			return [];
		}

		return rawLines.reduce((runs, line, index) => {
			if (index > 0) {
				runs.push({
					text: '\n',
					formats: [],
					formatAttributes: {},
				});
			}

			if (Array.isArray(line?.runs)) {
				runs.push(...line.runs);
			}

			return runs;
		}, []);
	}

	/**
	 * Return the lowercase host tag name for one component element.
	 *
	 * @param   {Element|null} hostElement Candidate host element.
	 * @returns {string}                   Lowercase host tag name.
	 */
	function getComponentHostTagName(hostElement) {
		return hostElement && hostElement.tagName
			? String(hostElement.tagName || '').trim().toLowerCase()
			: '';
	}

	/**
	 * Build one inline format wrapper for a component run token.
	 *
	 * @param   {Object}      inlineCapabilities Available inline format capabilities.
	 * @param   {string}      formatToken        Format token.
	 * @param   {Object|null} formatAttributes   Optional format attributes.
	 * @returns {HTMLElement|null}               Wrapper element.
	 */
	function buildComponentFormatWrapper(inlineCapabilities, formatToken, formatAttributes = null) {
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
	 * Hoist same-tag inline format attributes onto one host component element.
	 *
	 * @param   {Array<Object>} runs               Structured text runs.
	 * @param   {Object}       inlineCapabilities  Available inline format capabilities.
	 * @param   {Element|null} hostElement         Live host element.
	 * @returns {{runs:Array<Object>,hostAttributes:Object}} Hoisted run data.
	 */
	function hoistComponentHostLevelFormats(runs, inlineCapabilities, hostElement = null) {
		const hostTagName = getComponentHostTagName(hostElement);
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
	 * @param   {Element|null} hostElement    Live host element.
	 * @param   {Object|null}  hostAttributes Hoisted host attributes.
	 * @returns {void}
	 */
	function applyComponentHostLevelFormatAttributes(hostElement, hostAttributes = null) {
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
	 * Build deterministic HTML from one normalized component run sequence.
	 *
	 * @param   {Array<Object>} runs               Structured text runs.
	 * @param   {Object}       inlineCapabilities  Available inline format capabilities.
	 * @param   {Object}       editorOptions       Runtime editor options.
	 * @param   {Element|null} hostElement         Live host element.
	 * @returns {{html:string,hostAttributes:Object}} Rendered HTML and host attrs.
	 */
	function buildComponentHtmlFromRuns(runs, inlineCapabilities, editorOptions = {}, hostElement = null) {
		const container = document.createElement('div');
		const extractionOptions = editorOptions?.options && typeof editorOptions.options === 'object'
			? editorOptions.options
			: {};
		const hoisted = hoistComponentHostLevelFormats(runs, inlineCapabilities, hostElement);

		(Array.isArray(hoisted.runs) ? hoisted.runs : []).forEach(run => {
			const text = String(run?.text || '');
			if (!text) {
				return;
			}

			const segments = extractionOptions.newlinesToBR === true || String(editorOptions?.enterMode || '').trim() === 'linebreak'
				? text.split('\n')
				: [ text ];

			segments.forEach((segment, index) => {
				if (index > 0) {
					container.appendChild(document.createElement('br'));
				}

				if (!segment) {
					return;
				}

				let node = document.createTextNode(segment);
				(Array.isArray(run.formats) ? run.formats : []).forEach(formatToken => {
					const wrapper = buildComponentFormatWrapper(
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
	 * Build one plain-text replacement string from normalized runs.
	 *
	 * @param   {Array<Object>} runs Structured text runs.
	 * @returns {string}             Joined plain-text content.
	 */
	function buildPlainTextFromComponentRuns(runs) {
		return (Array.isArray(runs) ? runs : [])
			.map(run => String(run?.text || ''))
			.join('');
	}

	/**
	 * Resolve one schema component-content operation from executor options.
	 *
	 * @param   {Object|null} editorState Active editor state.
	 * @param   {Object}      options     Executor options.
	 * @returns {Object|null}             Matching component operation metadata.
	 */
	function resolveComponentOperation(editorState, options = {}) {
		const operationInput = options.operation && typeof options.operation === 'object'
			? options.operation
			: options;
		const componentId = String(
			operationInput.componentId ||
			operationInput.component ||
			operationInput.component_id ||
			''
		).trim();
		if (!componentId) {
			return null;
		}

		const component = getActiveEditorComponentMap(editorState)[componentId] || null;
		const editorOperations = Array.isArray(component?.editorOptions?.operations)
			? component.editorOptions.operations.filter(operation => operation && typeof operation === 'object')
			: [];
		const suppliedKind = String(operationInput.kind || '').trim();
		if (suppliedKind === 'replace_component_content' || suppliedKind === 'text_rewrite') {
			return {
				...operationInput,
				component: componentId,
				kind: 'replace_component_content',
			};
		}
		if (suppliedKind === 'link_change' || suppliedKind === 'inline_link_change') {
			return {
				...operationInput,
				component: componentId,
				kind: 'link_change',
			};
		}

		const suppliedOperationId = String(
			operationInput.id || operationInput.operationId || ''
		).trim();
		if (!suppliedOperationId) {
			return null;
		}

		const matched = editorOperations.find(operation => (
			String(operation?.id || '').trim() === suppliedOperationId &&
			(
				String(operation?.kind || '').trim() === 'text_rewrite' ||
				String(operation?.kind || '').trim() === 'replace_component_content' ||
				String(operation?.kind || '').trim() === 'link_change'
			)
		)) || null;
		if (!matched) {
			return null;
		}

		return {
			...matched,
			component: componentId,
			kind: String(matched.kind || '').trim() === 'link_change'
				? 'link_change'
				: 'replace_component_content',
		};
	}

	/**
	 * Execute one or more schema-backed component-content replacements.
	 *
	 * @param   {Object} options Executor options.
	 * @returns {Object|null}    Applied-operation summary.
	 */
	function executeComponentOperations(options = {}) {
		const editorState = options.editorState || null;
		const editorHost = options.editorHost || null;
		const componentMap = getActiveEditorComponentMap(editorState);
		const inputOperations = Array.isArray(options.operations)
			? options.operations
			: [ options.operation || options ];
		if (!editorState || !editorHost || !Object.keys(componentMap).length || !inputOperations.length) {
			return null;
		}

		const savedSelection = captureSelectionSnapshot(editorHost, options);
		const results = [];
		const updatedComponentIds = [];

		inputOperations.forEach(inputOperation => {
			const operationInput = inputOperation && typeof inputOperation === 'object' && !Array.isArray(inputOperation)
				? inputOperation
				: {};
			const operation = resolveComponentOperation(editorState, operationInput);
			if (!operation) {
				return;
			}

			const componentId = String(operation.component || '').trim();
			const component = componentMap[componentId] || null;
			if (!component || !component.element) {
				return;
			}

			const inlineCapabilities = (
				component.editorOptions?.inlineFormatCapabilities &&
				typeof component.editorOptions.inlineFormatCapabilities === 'object'
			)
				? component.editorOptions.inlineFormatCapabilities
				: {};
			if (operation.kind === 'link_change') {
				const formatToken = String(operation.format || operationInput.format || '').trim();
				const capability = getInlineLinkCapability(inlineCapabilities, formatToken);
				const hostTagName = String(component.element?.tagName || '').trim().toLowerCase();
				if (capability.tag !== 'a' || hostTagName !== capability.tag) {
					return;
				}

				const linkAttributes = normalizeComponentHostLinkOperationPayload(
					operationInput,
					capability,
					operation,
					component.element
				);
				if (!linkAttributes || !applyComponentHostLinkAttributes(component.element, linkAttributes)) {
					return;
				}
			} else {
				const bindingSource = String(
					operationInput.bindingSource ||
					component?.bindingSource ||
					''
				).trim().toLowerCase();
				if (bindingSource !== 'html' && bindingSource !== 'plaintext') {
					return;
				}

				const rawRuns = Array.isArray(operationInput.runs)
					? operationInput.runs
					: flattenComponentLineRuns(operationInput.lines);
				const hasDirectTextPayload = Object.prototype.hasOwnProperty.call(operationInput, 'text');
				const runs = normalizeComponentRuns(
					hasDirectTextPayload && bindingSource === 'plaintext' && !rawRuns.length
						? [ { text: String(operationInput.text || ''), formats: [], formatAttributes: {} } ]
						: rawRuns,
					inlineCapabilities
				);
				const hasReplacementPayload = hasDirectTextPayload || Array.isArray(operationInput.runs) || Array.isArray(operationInput.lines);
				if (!hasReplacementPayload) {
					return;
				}

				if (bindingSource === 'plaintext') {
					component.element.textContent = hasDirectTextPayload && !rawRuns.length
						? String(operationInput.text || '')
						: buildPlainTextFromComponentRuns(runs);
				} else {
					const rendered = buildComponentHtmlFromRuns(
						runs,
						inlineCapabilities,
						component.editorOptions || {},
						component.element
					);
					component.element.innerHTML = rendered.html;
					applyComponentHostLevelFormatAttributes(component.element, rendered.hostAttributes);
				}
			}

			updatedComponentIds.push(componentId);
			results.push({
				id: String(operation.id || '').trim(),
				kind: operation.kind === 'link_change'
					? 'link_change'
					: 'replace_component_content',
				componentId,
				applied: true,
			});
		});

		if (!results.length) {
			return null;
		}

		restoreSelectionSnapshot(editorHost, savedSelection);

		if (typeof options.afterSync === 'function') {
			options.afterSync({
				editorState,
				editorHost,
				results,
				updatedComponentIds: Array.from(new Set(updatedComponentIds)),
			});
		}

		if (typeof editorHost.updateToolbarState === 'function') {
			editorHost.updateToolbarState();
		}

		const historyApi = getSessionHistoryApiForHost(editorHost);
		if (options.saveHistory !== false && typeof historyApi?.saveToHistory === 'function') {
			historyApi.saveToHistory();
		}

		return {
			results,
			updatedComponentIds: Array.from(new Set(updatedComponentIds)),
			operationsApplied: results
				.map(result => result.id || result.kind)
				.filter(Boolean),
		};
	}

	/**
	 * Resolve one schema component-media operation from executor options.
	 *
	 * @param   {Object|null} editorState Active editor state.
	 * @param   {Object}      options     Executor options.
	 * @returns {Object|null}             Matching component-media operation metadata.
	 */
	function resolveMediaOperation(editorState, options = {}) {
		const operationInput = options.operation && typeof options.operation === 'object'
			? options.operation
			: options;
		const componentId = String(
			operationInput.componentId ||
			operationInput.component ||
			operationInput.component_id ||
			''
		).trim();
		if (!componentId) {
			return null;
		}

		const component = getActiveEditorComponentMap(editorState)[componentId] || null;
		if (!component?.element || !component?.mediaDescriptor) {
			return null;
		}

		const suppliedKind = String(operationInput.kind || '').trim();
		if (suppliedKind === 'replace_component_media') {
			return {
				...operationInput,
				component: componentId,
				kind: 'replace_component_media',
			};
		}

		return null;
	}

	/**
	 * Execute one or more schema-backed component-media replacements through the
	 * active media-session host.
	 *
	 * @param   {Object} options Executor options.
	 * @returns {Object|null}    Applied-operation summary.
	 */
	function executeMediaOperations(options = {}) {
		const editorState = options.editorState || null;
		const editorHost = options.editorHost || null;
		const componentMap = getActiveEditorComponentMap(editorState);
		const inputOperations = Array.isArray(options.operations)
			? options.operations
			: [ options.operation || options ];
		if (
			!editorState ||
			!editorHost ||
			typeof editorHost.applyMediaSelection !== 'function' ||
			!Object.keys(componentMap).length ||
			!inputOperations.length
		) {
			return null;
		}

		const activeComponentId = String(
			editorState.activeComponentId ||
			editorState.activeEditableComponent?.id ||
			''
		).trim();
		const results = [];
		const updatedComponentIds = [];

		inputOperations.forEach(inputOperation => {
			const operationInput = inputOperation && typeof inputOperation === 'object' && !Array.isArray(inputOperation)
				? inputOperation
				: {};
			const operation = resolveMediaOperation(editorState, operationInput);
			if (!operation) {
				return;
			}

			const componentId = String(operation.component || '').trim();
			const component = componentMap[componentId] || null;
			if (!component?.element || !component?.mediaDescriptor) {
				return;
			}

			if (activeComponentId && activeComponentId !== componentId) {
				return;
			}
			if (!activeComponentId && editorHost.element && editorHost.element !== component.element) {
				return;
			}

			const payload = operationInput.media && typeof operationInput.media === 'object'
				? operationInput.media
				: (operationInput.value && typeof operationInput.value === 'object'
					? operationInput.value
					: operationInput);
			const url = String(payload?.url || '').trim();
			if (!url) {
				return;
			}

			const attachmentId = Object.prototype.hasOwnProperty.call(payload, 'attachmentId')
				? payload.attachmentId
				: (Object.prototype.hasOwnProperty.call(payload, 'attachment_id')
					? payload.attachment_id
					: null);
			const source = String(
				payload?.source ||
				payload?.fromState ||
				''
			).trim().toLowerCase() === 'library'
				? 'library'
				: 'input';
			const didApply = editorHost.applyMediaSelection(url, attachmentId, {
				fromState: source,
			});
			if (didApply === false) {
				return;
			}

			updatedComponentIds.push(componentId);
			results.push({
				id: String(operation.id || '').trim(),
				kind: 'replace_component_media',
				componentId,
				applied: true,
			});
		});

		if (!results.length) {
			return null;
		}

		if (typeof options.afterSync === 'function') {
			options.afterSync({
				editorState,
				editorHost,
				results,
				updatedComponentIds: Array.from(new Set(updatedComponentIds)),
			});
		}

		return {
			results,
			updatedComponentIds: Array.from(new Set(updatedComponentIds)),
			operationsApplied: results
				.map(result => result.id || result.kind)
				.filter(Boolean),
		};
	}

	/**
	 * Normalize one primitive list-operation kind to the canonical
	 * tracker/editor operation kind.
	 *
	 * @param   {string} kindRaw Candidate operation kind.
	 * @returns {string}         Canonical primitive operation kind or an empty string.
	 */
	function normalizePrimitiveListOperationKind(kindRaw) {
		const kind = String(kindRaw || '').trim().toLowerCase();
		const supportedKinds = new Set([
			'insert_list_item',
			'remove_list_item',
			'move_list_item',
			'indent_list_item',
			'outdent_list_item',
			'update_list_item_text',
			'toggle_list_type',
		]);

		return supportedKinds.has(kind) ? kind : '';
	}

	/**
	 * Normalize one public list-operation kind to the documented runtime API
	 * vocabulary.
	 *
	 * Public callers intentionally use a higher-level token family than the
	 * primitive tracker/editor operations so the external contract stays explicit
	 * while FrontEdit keeps the low-level DOM mutation layer internal.
	 *
	 * @param   {string} kindRaw Candidate operation kind.
	 * @returns {string}         Canonical public operation kind or an empty string.
	 */
	function normalizePublicApiListOperationKind(kindRaw) {
		const kind = String(kindRaw || '').trim().toLowerCase();
		const supportedKinds = new Set([
			'update_list_item_text',
			'insert_before',
			'insert_after',
			'insert_child',
			'remove_list_item',
			'move_before',
			'move_after',
			'indent_list_item',
			'outdent_list_item',
			'toggle_list_type',
		]);

		return supportedKinds.has(kind) ? kind : '';
	}

	/**
	 * Normalize one list-operation kind for the current execution surface.
	 *
	 * Public API calls use the higher-level UUID-oriented vocabulary, while
	 * internal editor/schema calls keep the primitive tracker operation kinds.
	 *
	 * @param   {string} kindRaw  Candidate operation kind.
	 * @param   {Object} options  Executor options.
	 * @returns {string}          Canonical operation kind or an empty string.
	 */
	function normalizeListOperationKind(kindRaw, options = {}) {
		return getListTargetResolutionMode(options) === 'api_uuid'
			? normalizePublicApiListOperationKind(kindRaw)
			: normalizePrimitiveListOperationKind(kindRaw);
	}

	/**
	 * Return whether one operation payload explicitly defines a given key.
	 *
	 * @param   {Object|null} operation Candidate operation payload.
	 * @param   {string}      key       Key to check.
	 * @returns {boolean}               True when the key exists on the payload.
	 */
	function hasOwnOperationKey(operation, key) {
		return !!(
			operation &&
			typeof operation === 'object' &&
			!Array.isArray(operation) &&
			Object.prototype.hasOwnProperty.call(operation, key)
		);
	}

	/**
	 * Return the caller target-resolution mode for list operations.
	 *
	 * `selection` allows editor-originated calls to omit the item/list target and
	 * resolve it from the current DOM selection. `explicit` requires path/list
	 * tokens. `api_uuid` requires the public runtime UUID token family.
	 *
	 * @param   {Object} options Executor options.
	 * @returns {string}         `selection`, `explicit`, or `api_uuid`.
	 */
	function getListTargetResolutionMode(options = {}) {
		const mode = String(options.targetResolutionMode || '').trim().toLowerCase();
		if (mode === 'explicit') {
			return 'explicit';
		}

		if (mode === 'api_uuid') {
			return 'api_uuid';
		}

		return 'selection';
	}

	/**
	 * Return whether one normalized list operation targets a list item.
	 *
	 * @param   {string} kind Canonical list operation kind.
	 * @returns {boolean}     True when the operation acts on one item path.
	 */
	function isItemTargetListOperation(kind) {
		return (
			kind === 'remove_list_item' ||
			kind === 'indent_list_item' ||
			kind === 'outdent_list_item' ||
			kind === 'update_list_item_text' ||
			kind === 'move_list_item'
		);
	}

	/**
	 * Return whether one normalized list operation uses structural item-path
	 * anchors without using only one direct `path`.
	 *
	 * @param   {string} kind Canonical list operation kind.
	 * @returns {boolean}     True when the operation uses before/after/parent paths.
	 */
	function isPathAnchoredListOperation(kind) {
		return (
			kind === 'insert_list_item' ||
			kind === 'move_list_item'
		);
	}

	/**
	 * Return whether one normalized list operation moves an existing item.
	 *
	 * @param   {string} kind Canonical list operation kind.
	 * @returns {boolean}     True when the operation moves one existing item.
	 */
	function isMoveListOperation(kind) {
		return kind === 'move_list_item';
	}

	/**
	 * Return whether one insert/move operation defines any supported path anchor.
	 *
	 * @param   {Object} operationInput Raw operation payload.
	 * @returns {boolean}               True when one path anchor exists.
	 */
	function hasAnyStructuralPathAnchor(operationInput) {
		return (
			hasOwnOperationKey(operationInput, 'path') ||
			hasOwnOperationKey(operationInput, 'itemPath') ||
			hasOwnOperationKey(operationInput, 'item_path') ||
			hasOwnOperationKey(operationInput, 'beforePath') ||
			hasOwnOperationKey(operationInput, 'before_path') ||
			hasOwnOperationKey(operationInput, 'afterPath') ||
			hasOwnOperationKey(operationInput, 'after_path') ||
			hasOwnOperationKey(operationInput, 'parentPath') ||
			hasOwnOperationKey(operationInput, 'parent_path')
		);
	}

	/**
	 * Return whether one raw operation includes any public UUID list-item target.
	 *
	 * @param   {Object} operationInput Raw operation payload.
	 * @returns {boolean}               True when one item UUID token exists.
	 */
	function hasAnyUuidItemTarget(operationInput) {
		return (
			hasOwnOperationKey(operationInput, 'itemUuid') ||
			hasOwnOperationKey(operationInput, 'newItemUuid') ||
			hasOwnOperationKey(operationInput, 'targetItemUuid')
		);
	}

	/**
	 * Return whether one public operation payload contains any path fields.
	 *
	 * @param   {Object} operationInput Raw operation payload.
	 * @returns {boolean}               True when a path token exists.
	 */
	function hasAnyPathTarget(operationInput) {
		return hasAnyStructuralPathAnchor(operationInput)
			|| hasOwnOperationKey(operationInput, 'listPath')
			|| hasOwnOperationKey(operationInput, 'list_path');
	}

	/**
	 * Return whether one public payload contains only the documented keys for one
	 * public list-operation kind.
	 *
	 * Unknown keys are rejected. The public list API is intentionally strict so
	 * callers must match the documented v1 shape exactly.
	 *
	 * @param   {Object} operationInput Raw operation payload.
	 * @param   {string} normalizedKind Canonical public operation kind.
	 * @returns {boolean}               True when no unsupported keys are present.
	 */
	function hasOnlySupportedApiUuidKeys(operationInput, normalizedKind) {
		const allowedKeys = new Set([
			'kind',
			'contentHtml',
			'contentText',
		]);

		if (
			normalizedKind === 'update_list_item_text' ||
			normalizedKind === 'remove_list_item' ||
			normalizedKind === 'indent_list_item' ||
			normalizedKind === 'outdent_list_item'
		) {
			allowedKeys.add('itemUuid');
		} else if (normalizedKind === 'insert_before' || normalizedKind === 'insert_after') {
			allowedKeys.add('newItemUuid');
			allowedKeys.add('targetItemUuid');
		} else if (normalizedKind === 'insert_child') {
			allowedKeys.add('newItemUuid');
			allowedKeys.add('targetItemUuid');
		} else if (normalizedKind === 'move_before' || normalizedKind === 'move_after') {
			allowedKeys.add('itemUuid');
			allowedKeys.add('targetItemUuid');
		} else if (normalizedKind === 'toggle_list_type') {
			allowedKeys.add('itemUuid');
		}

		return Object.keys(operationInput || {}).every(key => allowedKeys.has(key));
	}

	/**
	 * Validate that one explicit public list operation uses only the documented
	 * target token family for its kind.
	 *
	 * @param   {Object} operationInput Raw operation payload.
	 * @param   {string} normalizedKind Canonical list operation kind.
	 * @returns {boolean}               True when the target token shape is valid.
	 */
	function isValidExplicitListOperationTarget(operationInput, normalizedKind) {
		const hasPath = hasOwnOperationKey(operationInput, 'path')
			|| hasOwnOperationKey(operationInput, 'itemPath')
			|| hasOwnOperationKey(operationInput, 'item_path');
		const hasListPath = hasOwnOperationKey(operationInput, 'listPath')
			|| hasOwnOperationKey(operationInput, 'list_path');

		if (normalizedKind === 'toggle_list_type') {
			return hasListPath && !hasPath;
		}

		if (isItemTargetListOperation(normalizedKind)) {
			return hasPath && !hasListPath;
		}

		if (isMoveListOperation(normalizedKind)) {
			return hasPath && !hasListPath;
		}

		if (isPathAnchoredListOperation(normalizedKind)) {
			return hasAnyStructuralPathAnchor(operationInput) && !hasListPath;
		}

		return true;
	}

	/**
	 * Validate that one public API list operation uses only the UUID token family.
	 *
	 * API callers must treat runtime UUIDs as the external cursor model. Paths
	 * remain internal execution details resolved by FrontEdit immediately before each
	 * operation runs.
	 *
	 * @param   {Object} operationInput Raw operation payload.
	 * @param   {string} normalizedKind Canonical list operation kind.
	 * @returns {boolean}               True when the UUID target shape is valid.
	 */
	function isValidApiUuidListOperationTarget(operationInput, normalizedKind) {
		if (!hasOnlySupportedApiUuidKeys(operationInput, normalizedKind)) {
			return false;
		}

		const hasItemUuid = hasOwnOperationKey(operationInput, 'itemUuid');
		const hasNewItemUuid = hasOwnOperationKey(operationInput, 'newItemUuid');
		const hasListUuid = hasOwnOperationKey(operationInput, 'listUuid');
		const hasTargetItemUuid = hasOwnOperationKey(operationInput, 'targetItemUuid');

		if (normalizedKind === 'toggle_list_type') {
			return hasItemUuid && !hasNewItemUuid && !hasListUuid && !hasTargetItemUuid;
		}

		if (
			normalizedKind === 'update_list_item_text' ||
			normalizedKind === 'remove_list_item' ||
			normalizedKind === 'indent_list_item' ||
			normalizedKind === 'outdent_list_item'
		) {
			return hasItemUuid && !hasNewItemUuid && !hasListUuid && !hasTargetItemUuid;
		}

		if (normalizedKind === 'insert_before' || normalizedKind === 'insert_after') {
			return !hasItemUuid && hasNewItemUuid && !hasListUuid && hasTargetItemUuid;
		}

		if (normalizedKind === 'insert_child') {
			return !hasItemUuid && hasNewItemUuid && !hasListUuid && hasTargetItemUuid;
		}

		if (normalizedKind === 'move_before' || normalizedKind === 'move_after') {
			return hasItemUuid && !hasNewItemUuid && !hasListUuid && hasTargetItemUuid;
		}

		return false;
	}

	/**
	 * Expand one public API list operation into one or more public operation
	 * inputs that can be resolved against the live tree one step at a time.
	 *
	 * `insert_child` intentionally fans out into `insert_after` and `indent_list_item` so
	 * the second primitive resolution runs after the new list item exists.
	 *
	 * @param   {Object} operationInput Raw public operation payload.
	 * @returns {Object[]}              Expanded public operation inputs.
	 */
	function expandApiUuidListOperationInputs(operationInput) {
		const normalizedKind = normalizePublicApiListOperationKind(operationInput?.kind);
		if (!normalizedKind) {
			return [];
		}

		if (normalizedKind !== 'insert_child') {
			return [
				{
					...operationInput,
					kind: normalizedKind,
				},
			];
		}

		return [
			{
				...operationInput,
				kind: 'insert_after',
			},
			{
				kind: 'indent_list_item',
				itemUuid: operationInput.newItemUuid,
			},
		];
	}

	/**
	 * Resolve one public API UUID-targeted list operation to one internal
	 * primitive operation payload with concrete path tokens.
	 *
	 * This runs against the current live mutated tree so later batched operations
	 * can reuse the same stable runtime UUIDs while FrontEdit recalculates fresh paths
	 * before each mutation.
	 *
	 * @param   {Object|null} tracker   Active list tracker.
	 * @param   {Object}      operation Normalized public operation payload.
	 * @returns {Object|null}           Path-resolved primitive tracker operation payload.
	 */
	function resolveApiUuidListOperationTargets(tracker, operation) {
		const listTracker = getListTrackerModule();
		if (!listTracker || !tracker?.listElement || !operation || typeof operation !== 'object') {
			return null;
		}

		const publicKind = normalizePublicApiListOperationKind(operation.kind);
		if (!publicKind) {
			return null;
		}

		const resolvedOperation = {
			...operation,
		};
		const itemUuid = String(resolvedOperation.itemUuid ?? '').trim();
		const newItemUuid = String(resolvedOperation.newItemUuid ?? '').trim();
		const listUuid = String(resolvedOperation.listUuid ?? '').trim();
		const targetItemUuid = String(resolvedOperation.targetItemUuid ?? '').trim();
		let targetItem = null;

		let currentItem = null;

		if (itemUuid) {
			currentItem = typeof listTracker.getItemByRuntimeUuid === 'function'
				? listTracker.getItemByRuntimeUuid(tracker, itemUuid)
				: null;
			const targetPath = getListItemPathForElement(tracker, currentItem);
			if (!targetPath) {
				return null;
			}

			resolvedOperation.path = targetPath;
		}

		if (targetItemUuid) {
			targetItem = typeof listTracker.getItemByRuntimeUuid === 'function'
				? listTracker.getItemByRuntimeUuid(tracker, targetItemUuid)
				: null;
			if (!targetItem) {
				return null;
			}
		}

		if (listUuid) {
			const targetList = typeof listTracker.getListByRuntimeUuid === 'function'
				? listTracker.getListByRuntimeUuid(tracker, listUuid)
				: null;
			if (!targetList) {
				return null;
			}

			resolvedOperation.listPath = getListPathForElement(tracker, targetList);
		}

		if (newItemUuid) {
			resolvedOperation.newItemUuid = newItemUuid;
			resolvedOperation.itemUuid = newItemUuid;
		}

		if (
			publicKind === 'update_list_item_text' ||
			publicKind === 'remove_list_item' ||
			publicKind === 'indent_list_item' ||
			publicKind === 'outdent_list_item'
		) {
			resolvedOperation.kind = publicKind;
		} else if (publicKind === 'insert_before' || publicKind === 'insert_after') {
			const targetPath = getListItemPathForElement(tracker, targetItem);
			if (!targetPath) {
				return null;
			}

			resolvedOperation.kind = 'insert_list_item';
			if (publicKind === 'insert_before') {
				resolvedOperation.beforePath = targetPath;
			} else {
				resolvedOperation.afterPath = targetPath;
			}
		} else if (publicKind === 'move_before' || publicKind === 'move_after') {
			const targetPath = getListItemPathForElement(tracker, targetItem);
			if (!targetPath) {
				return null;
			}

			resolvedOperation.kind = 'move_list_item';
			if (publicKind === 'move_before') {
				resolvedOperation.beforePath = targetPath;
			} else {
				resolvedOperation.afterPath = targetPath;
			}
		} else if (publicKind === 'toggle_list_type') {
			const containingList = currentItem?.parentElement;
			const containingListPath = getListPathForElement(tracker, containingList);
			if (!containingListPath && containingList !== tracker.listElement) {
				return null;
			}

			resolvedOperation.listPath = containingListPath;
			resolvedOperation.kind = 'toggle_list_type';
		} else {
			return null;
		}

		delete resolvedOperation.listUuid;
		delete resolvedOperation.targetItemUuid;

		return resolvedOperation;
	}

	/**
	 * Resolve one schema list-structure operation from executor options.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object}      options   Executor options.
	 * @returns {Object|null}           Matching list operation metadata.
	 */
	function resolveListOperation(editorHost, options = {}, executorOptions = {}) {
		if (options.operation && typeof options.operation === 'object') {
			const suppliedOperation = options.operation;
			const suppliedKind = normalizeListOperationKind(suppliedOperation.kind, executorOptions);
			if (suppliedKind) {
				return {
					...suppliedOperation,
					kind: suppliedKind,
				};
			}

			const suppliedOperationId = String(
				suppliedOperation.id || suppliedOperation.operationId || ''
			).trim();
			if (suppliedOperationId) {
				return getEditorOperations(editorHost).find(operation => (
					String(operation?.id || '').trim() === suppliedOperationId &&
					!!normalizePrimitiveListOperationKind(operation?.kind)
				)) || null;
			}
		}

		const operationId = String(options.operationId || options.id || '').trim();
		if (!operationId) {
			return null;
		}

		return getEditorOperations(editorHost).find(operation => (
			String(operation?.id || '').trim() === operationId &&
			!!normalizePrimitiveListOperationKind(operation?.kind)
		)) || null;
	}

	/**
	 * Resolve one schema block-attribute operation from executor options.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object}      options   Executor options.
	 * @returns {Object|null}           Matching block-attribute operation.
	 */
	function resolveBlockAttributeOperation(editorHost, options = {}) {
		if (options.operation && typeof options.operation === 'object') {
			const suppliedOperation = options.operation;
			if (String(suppliedOperation.kind || '').trim() === 'block_attribute_change') {
				return suppliedOperation;
			}

			const suppliedOperationId = String(
				suppliedOperation.id || suppliedOperation.operationId || ''
			).trim();
			if (suppliedOperationId) {
				return getEditorOperations(editorHost).find(operation => (
					String(operation?.id || '').trim() === suppliedOperationId &&
					String(operation?.kind || '').trim() === 'block_attribute_change'
				)) || null;
			}
		}

		const operationId = String(options.operationId || options.id || '').trim();
		if (!operationId) {
			return null;
		}

		return getEditorOperations(editorHost).find(operation => (
			String(operation?.id || '').trim() === operationId &&
			String(operation?.kind || '').trim() === 'block_attribute_change'
		)) || null;
	}

	/**
	 * Build one executable structural list operation for the tracker layer.
	 *
	 * Toolbar actions may provide only a schema operation ID, while public-api
	 * callers generally provide canonical payload kinds. This helper resolves
	 * either shape and fills in the active item/list path when the caller is
	 * targeting the current selection.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object|null} tracker   Active list tracker.
	 * @param   {Object}      input     Raw executor operation input.
	 * @returns {Object|null}           Normalized tracker operation payload.
	 */
	function buildExecutableListOperation(editorHost, tracker, input = {}, options = {}) {
		const operationInput = input && typeof input === 'object' && !Array.isArray(input)
			? input
			: {};
		const resolvedOperation = resolveListOperation(editorHost, operationInput, options);
		const baseOperation = resolvedOperation && typeof resolvedOperation === 'object'
			? resolvedOperation
			: operationInput;
		const normalizedKind = normalizeListOperationKind(baseOperation.kind || operationInput.kind, options);
		if (!normalizedKind) {
			return null;
		}
		const targetResolutionMode = getListTargetResolutionMode(options);
		if (
			targetResolutionMode === 'explicit' &&
			!isValidExplicitListOperationTarget(operationInput, normalizedKind)
		) {
			return null;
		}
		if (
			targetResolutionMode === 'api_uuid' &&
			!isValidApiUuidListOperationTarget(operationInput, normalizedKind)
		) {
			return null;
		}

		const mergedOperation = {
			...baseOperation,
			...operationInput,
			kind: normalizedKind,
		};
		if (targetResolutionMode === 'api_uuid') {
			delete mergedOperation.listItem;
			delete mergedOperation.listElement;
			return resolveApiUuidListOperationTargets(tracker, mergedOperation);
		}

		const explicitListItem = operationInput.listItem instanceof Element &&
			operationInput.listItem.tagName === 'LI'
			? operationInput.listItem
			: null;
		const currentListItem = explicitListItem || (
			typeof editorHost?.getCurrentListItem === 'function'
				? editorHost.getCurrentListItem()
				: null
		);
		const itemPath = String(
			mergedOperation.path
			?? mergedOperation.itemPath
			?? mergedOperation.item_path
			?? ''
		).trim();
		if (
			!itemPath &&
			normalizedKind !== 'insert_list_item' &&
			normalizedKind !== 'move_list_item' &&
			normalizedKind !== 'toggle_list_type'
		) {
			if (targetResolutionMode === 'explicit') {
				return null;
			}

			const currentItemPath = getListItemPathForElement(tracker, currentListItem);
			if (!currentItemPath) {
				return null;
			}

			mergedOperation.path = currentItemPath;
		}

		if (normalizedKind === 'toggle_list_type') {
			const targetList = operationInput.listElement || getCurrentListElement(editorHost);
			const listPath = String(
				mergedOperation.listPath
				?? mergedOperation.list_path
				?? ''
			).trim();
			if (!listPath && targetResolutionMode === 'explicit') {
				return null;
			}

			if (!listPath && targetList) {
				mergedOperation.listPath = getListPathForElement(tracker, targetList);
			}
		}

		delete mergedOperation.listItem;
		delete mergedOperation.listElement;

		return mergedOperation;
	}

	/**
	 * Return the explicit current value for one tracked block attribute.
	 *
	 * @param   {Object|null} editorHost    Active schema editor host.
	 * @param   {string}      attributePath Canonical block attribute path.
	 * @returns {*}                        Tracked value when present.
	 */
	function getTrackedAttributeValue(editorHost, attributePath) {
		if (!editorHost || typeof editorHost.getTrackedAttributeValue !== 'function') {
			return undefined;
		}

		return editorHost.getTrackedAttributeValue(attributePath);
	}

	/**
	 * Return the current heading level represented by the live editor element.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @returns {number|null}          Current heading level when applicable.
	 */
	function getCurrentHeadingLevel(editorHost) {
		const trackedLevel = getTrackedAttributeValue(editorHost, 'level');
		const parsedTrackedLevel = Number.parseInt(trackedLevel, 10);
		if (Number.isInteger(parsedTrackedLevel) && parsedTrackedLevel >= 1 && parsedTrackedLevel <= 6) {
			return parsedTrackedLevel;
		}

		const tagName = String(editorHost?.element?.tagName || '').trim().toLowerCase();
		if (/^h[1-6]$/.test(tagName)) {
			return Number.parseInt(tagName.slice(1), 10);
		}

		return null;
	}

	/**
	 * Return the current textAlignment represented by the schema-backed editor state.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object|null} operation  Schema block-attribute operation metadata.
	 * @returns {string|undefined}       Current normalized textAlignment value.
	 */
	function getCurrentTextAlignmentValue(editorHost, operation = null) {
		const textAlignmentCapability = getNormalizedTextAlignmentCapability(editorHost, operation);
		if (!textAlignmentCapability || !isTextAlignmentOperation(editorHost, operation)) {
			return undefined;
		}

		const isVirtualBindingBackedTextAlignment =
			isVirtualBindingBackedTextAlignmentCapability(textAlignmentCapability);

		if (
			isVirtualBindingBackedTextAlignment &&
			editorHost &&
			typeof editorHost.getTextAlignmentState === 'function'
		) {
			const domTextAlignment = String(editorHost.getTextAlignmentState() || '').trim().toLowerCase();
			if (domTextAlignment) {
				return domTextAlignment;
			}

			return textAlignmentCapability.normalizedUnsetValue;
		}

		const trackedTextAlignment = getTrackedAttributeValue(editorHost, textAlignmentCapability.attribute);
		if (typeof trackedTextAlignment === 'string' && trackedTextAlignment.trim()) {
			return trackedTextAlignment.trim().toLowerCase();
		}

		if (typeof trackedTextAlignment === 'undefined') {
			if (editorHost && typeof editorHost.getTextAlignmentState === 'function') {
				const domTextAlignment = String(editorHost.getTextAlignmentState() || '').trim().toLowerCase();
				if (domTextAlignment) {
					return domTextAlignment;
				}
			}

			return textAlignmentCapability.normalizedUnsetValue;
		}

		return textAlignmentCapability.normalizedUnsetValue;
	}

	/**
	 * Determines whether the given textAlignment capability relies on a virtual data-binding
	 * (explicitly checking if the attribute is strictly named 'textAlignment').
	 *
	 * @param {Object|null|undefined} textAlignmentCapability - The textAlignment capability configuration object to evaluate.
	 * @returns {boolean} True if the capability is backed by a virtual binding; otherwise false.
	 */
	function isVirtualBindingBackedTextAlignmentCapability(textAlignmentCapability) {
		return !!(
			textAlignmentCapability &&
			(
				textAlignmentCapability.attribute === 'textAlignment' ||
				textAlignmentCapability.attribute === 'columnAlignment'
			)
		);
	}

	/**
	 * Determine whether one resolved block-attribute operation is the active
	 * schema-backed textAlignment operation for this editor.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object|null} operation Schema block-attribute operation metadata.
	 * @returns {boolean}               True when this operation targets textAlignment.
	 */
	function isTextAlignmentOperation(editorHost, operation = null) {
		if (!operation || typeof operation !== 'object') {
			return false;
		}

		const textAlignmentCapability = getNormalizedTextAlignmentCapability(editorHost, operation);
		if (!textAlignmentCapability) {
			return false;
		}

		const operationAttribute = typeof operation.attribute === 'string'
			? operation.attribute.trim()
			: '';

		return !!operationAttribute && operationAttribute === textAlignmentCapability.attribute;
	}

	/**
	 * Return the normalized schema-backed textAlignment capability for one editor.
	 *
	 * Centralizes the canonical textAlignment attribute lookup so both the executor and
	 * editor mutation helpers read the same normalized shape.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @returns {Object|null}           Normalized textAlignment capability or null.
	 */
	function getNormalizedTextAlignmentCapability(editorHost, operation = null) {
		if (!editorHost || typeof editorHost.getAttributeCapability !== 'function') {
			return null;
		}

		const operationAttribute = typeof operation?.attribute === 'string'
			? operation.attribute.trim()
			: '';
		const capabilityKey = operationAttribute === 'columnAlignment'
			? 'columnAlignment'
			: 'textAlignment';
		const textAlignmentCapability = editorHost.getAttributeCapability(capabilityKey);
		if (!textAlignmentCapability || typeof textAlignmentCapability !== 'object') {
			return null;
		}

		const attribute = typeof textAlignmentCapability.attribute === 'string'
			? textAlignmentCapability.attribute.trim()
			: '';

		if (!attribute) {
			return null;
		}

		const values = Array.isArray(textAlignmentCapability.values)
			? textAlignmentCapability.values
				.map(value => String(value).trim().toLowerCase())
				.filter(Boolean)
			: [];

		const hasUnsetValue = Object.prototype.hasOwnProperty.call(textAlignmentCapability, 'unsetValue');
		const unsetValue = hasUnsetValue
			? textAlignmentCapability.unsetValue
			: undefined;
		const normalizedUnsetValue = typeof unsetValue === 'string'
			? unsetValue.trim().toLowerCase()
			: unsetValue;

		return {
			...textAlignmentCapability,
			attribute,
			values,
			unsetValue,
			normalizedUnsetValue,
		};
	}

	/**
	 * Normalize one candidate block-attribute value for unset-value comparison.
	 *
	 * String-based schema values such as alignment tokens compare case-insensitively,
	 * while numeric/boolean/null values preserve their original scalar semantics.
	 *
	 * @param {*} value Candidate attribute value.
	 * @returns {*} Normalized comparison value.
	 */
	function normalizeBlockAttributeComparisonValue(value) {
		return typeof value === 'string'
			? value.trim().toLowerCase()
			: value;
	}

	/**
	 * Determine whether one requested block-attribute value maps to the schema's
	 * declared unset/default value.
	 *
	 * @param {Object|null} descriptor Operation/capability metadata with optional `unsetValue`.
	 * @param {*}           value      Candidate attribute value.
	 * @returns {boolean}              True when the value represents the unset state.
	 */
	function isUnsetBlockAttributeValue(descriptor, value) {
		if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'unsetValue')) {
			return false;
		}

		return normalizeBlockAttributeComparisonValue(value) ===
			normalizeBlockAttributeComparisonValue(descriptor.unsetValue);
	}

	/**
	 * Normalize one requested block-attribute value for tracked attr storage.
	 *
	 * Schema-declared unset values are converted to `undefined` so the canonical
	 * save path removes the corresponding attribute instead of persisting the
	 * default marker itself.
	 *
	 * @param {Object|null} descriptor Operation/capability metadata with optional `unsetValue`.
	 * @param {*}           value      Requested attribute value.
	 * @returns {*}                    Storage-ready tracked value.
	 */
	function normalizeBlockAttributeTrackedValue(descriptor, value) {
		return isUnsetBlockAttributeValue(descriptor, value)
			? undefined
			: value;
	}

	/**
	 * Return the current block-attribute value for one schema operation.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object|null} operation Schema block-attribute operation metadata.
	 * @returns {*}                     Current effective attribute value.
	 */
	function getCurrentBlockAttributeValue(editorHost, operation = null) {
		const attributePath = String(operation?.attribute || '').trim();
		if (!attributePath) {
			return undefined;
		}

		if (attributePath === 'level') {
			return getCurrentHeadingLevel(editorHost);
		}

		if (operation?.tagChange === true) {
			return String(editorHost?.element?.tagName || '').trim().toLowerCase() || undefined;
		}

		if (attributePath === 'align' && typeof editorHost?.getBlockAlignState === 'function') {
			return editorHost.getBlockAlignState();
		}

		if (isTextAlignmentOperation(editorHost, operation)) {
			return getCurrentTextAlignmentValue(editorHost, operation);
		}

		const trackedValue = getTrackedAttributeValue(editorHost, attributePath);
		if (typeof trackedValue !== 'undefined') {
			return trackedValue;
		}

		return Object.prototype.hasOwnProperty.call(operation || {}, 'unsetValue')
			? operation.unsetValue
			: undefined;
	}

	/**
	 * Apply one schema-backed block-attribute change to the live editor DOM.
	 *
	 * @param   {Object|null} editorHost Active schema editor host.
	 * @param   {Object}      operation Schema block-attribute operation metadata.
	 * @param   {*}           value     Requested attribute value.
	 * @returns {boolean}               True when the mutation was applied.
	 */
	function applyBlockAttributeChange(editorHost, operation, value, operationOptions = {}) {
		if (!editorHost || !operation) {
			return false;
		}

		const attributePath = String(operation.attribute || '').trim();
		if (!attributePath) {
			return false;
		}

		if (attributePath === 'level') {
			const level = Number.parseInt(value, 10);
			if (!Number.isInteger(level) || level < 1 || level > 6) {
				return false;
			}

			if (
				typeof editorHost.changeElementTag !== 'function' ||
				typeof editorHost.setTrackedAttributeValue !== 'function'
			) {
				return false;
			}

			// Keep the block attribute as the canonical source of truth, then
			// project that change into the live DOM tag for immediate feedback.
			editorHost.setTrackedAttributeValue(attributePath, level);
			editorHost.changeElementTag(`h${level}`, {
				validateSelection: false,
				saveHistory: false,
			});
			return true;
		}

		if (operation.tagChange === true) {
			const tagName = String(value || '').trim().toLowerCase();
			const allowedTags = Array.isArray(operation.values)
				? operation.values.map(candidate => String(candidate || '').trim().toLowerCase()).filter(Boolean)
				: [];
			if (!tagName || !allowedTags.includes(tagName)) {
				return false;
			}

			if (
				typeof editorHost.changeElementTag !== 'function' ||
				typeof editorHost.setTrackedAttributeValue !== 'function'
			) {
				return false;
			}

			editorHost.setTrackedAttributeValue(attributePath, tagName);
			editorHost.changeElementTag(tagName, {
				validateSelection: false,
				saveHistory: false,
			});
			return true;
		}

		if (isTextAlignmentOperation(editorHost, operation)) {
			if (typeof editorHost.changeTextAlignment !== 'function') {
				return false;
			}

			const targetKey = operation.attribute === 'columnAlignment'
				? 'columnAlignment'
				: 'textAlignment';
			const textAlignmentOptions = {
				operation,
				targetKey,
			};

			if (
				operation.attribute === 'columnAlignment' &&
				Object.prototype.hasOwnProperty.call(operationOptions || {}, 'columns')
			) {
				textAlignmentOptions.columns = operationOptions.columns;
			}

			return editorHost.changeTextAlignment(
				String(value || '').trim().toLowerCase(),
				textAlignmentOptions
			) === true;
		}

		if (attributePath === 'align') {
			if (typeof editorHost.changeBlockAlign !== 'function') {
				return false;
			}

			return editorHost.changeBlockAlign(String(value || '').trim().toLowerCase(), {
				operation,
				targetKey: 'align',
			}) === true;
		}

		if (typeof editorHost.setTrackedAttributeValue !== 'function') {
			return false;
		}

		editorHost.setTrackedAttributeValue(
			attributePath,
			normalizeBlockAttributeTrackedValue(operation, value)
		);

		return true;
	}

	/**
	 * Return whether one public column-alignment target payload matches the
	 * committed runtime contract.
	 *
	 * The public API accepts only a zero-based index array or the `'all'`
	 * shortcut. Scalar values intentionally fail loudly so external callers do
	 * not depend on undocumented coercion.
	 *
	 * @param {*} columns Candidate explicit column target payload.
	 * @returns {boolean} True when the payload matches the committed contract.
	 */
	function isValidExplicitColumnTarget(columns) {
		if (columns === 'all') {
			return true;
		}

		return Array.isArray(columns);
	}

	/**
	 * Execute one or more schema-declared block-attribute changes.
	 *
	 * @param   {Object} options Executor options.
	 * @returns {Object|null}    Applied-operation summary.
	 */
	function executeBlockAttributeOperations(options = {}) {
		const editorHost = options.editorHost || null;
		const inputOperations = Array.isArray(options.operations)
			? options.operations
			: [ options.operation || options ];
		const resolvedOperations = inputOperations
			.map(inputOperation => {
				const operationOptions = (
					inputOperation &&
					typeof inputOperation === 'object' &&
					!Array.isArray(inputOperation)
				)
					? inputOperation
					: {};
				const operation = resolveBlockAttributeOperation(editorHost, operationOptions);
				if (!operation) {
					return null;
				}
				const isExplicitColumnAlignmentOperation = (
					String(operation.attribute || '').trim() === 'columnAlignment'
				);
				const isExplicitSetColumnAlign = String(operation.id || '').trim() === 'set_column_align';
				const hasColumn = Object.prototype.hasOwnProperty.call(operationOptions, 'column');
				const hasColumns = Object.prototype.hasOwnProperty.call(operationOptions, 'columns');
				if (isExplicitColumnAlignmentOperation && hasColumn) {
					return null;
				}
				if (isExplicitSetColumnAlign && !hasColumns) {
					return null;
				}
				if (
					isExplicitColumnAlignmentOperation &&
					hasColumns &&
					!isValidExplicitColumnTarget(operationOptions.columns)
				) {
					return null;
				}

				const operationValue = Object.prototype.hasOwnProperty.call(operationOptions, 'value')
					? operationOptions.value
					: undefined;
				return operationValue === undefined
					? null
					: {
						operation,
						value: operationValue,
						options: operationOptions,
					};
			})
			.filter(Boolean);

		if (!editorHost || !resolvedOperations.length) {
			return null;
		}

		const savedSelection = captureSelectionSnapshot(editorHost, options);
		const results = [];

		resolvedOperations.forEach(({ operation, value, options: operationOptions }) => {
			const hasExplicitColumnTarget = (
				String(operation.attribute || '').trim() === 'columnAlignment' &&
				Object.prototype.hasOwnProperty.call(operationOptions || {}, 'columns')
			);
			const currentValue = hasExplicitColumnTarget
				? undefined
				: getCurrentBlockAttributeValue(editorHost, operation);
			const normalizedRequestedValue = String(operation.attribute || '').trim() === 'level'
				? Number.parseInt(value, 10)
				: value;
			const normalizedCurrentValue = String(operation.attribute || '').trim() === 'level'
				? Number.parseInt(currentValue, 10)
				: currentValue;

			if (normalizedCurrentValue === normalizedRequestedValue) {
				results.push({
					id: String(operation.id || '').trim(),
					kind: 'block_attribute_change',
					attribute: String(operation.attribute || '').trim(),
					value: normalizedRequestedValue,
					applied: false,
				});
				return;
			}

			const didApply = applyBlockAttributeChange(
				editorHost,
				operation,
				normalizedRequestedValue,
				operationOptions || {}
			);
			if (!didApply) {
				return;
			}

			results.push({
				id: String(operation.id || '').trim(),
				kind: 'block_attribute_change',
				attribute: String(operation.attribute || '').trim(),
				value: normalizedRequestedValue,
				applied: true,
			});
		});

		if (!results.length) {
			return null;
		}

		restoreSelectionSnapshot(editorHost, savedSelection);

		if (typeof options.afterSync === 'function') {
			options.afterSync({
				editorHost,
				results,
				operations: resolvedOperations.map(entry => entry.operation),
			});
		}

		if (typeof editorHost.updateToolbarState === 'function') {
			editorHost.updateToolbarState();
		}

		const historyApi = getSessionHistoryApiForHost(editorHost);
		if (
			results.some(result => result.applied) &&
			options.saveHistory !== false &&
			typeof historyApi?.saveToHistory === 'function'
		) {
			historyApi.saveToHistory();
		}

		return {
			results,
			operationsApplied: results
				.filter(result => result.applied)
				.map(result => result.id || result.kind),
			attributeChanges: editorHost.attributeChanges || {},
		};
	}

	/**
	 * Execute one schema-declared block-attribute change.
	 *
	 * @param   {Object} options Executor options.
	 * @returns {Object|null}    Applied-operation summary.
	 */
	function executeBlockAttributeOperation(options = {}) {
		return executeBlockAttributeOperations({
			...options,
			operations: undefined,
			operation: options.operation || options,
		});
	}

	/**
	 * Resolve the session-owned history API for one active editor host.
	 *
	 * Schema operations should commit through the shared block session directly
	 * instead of depending on MWPEditor's convenience history facade as an
	 * integration boundary.
	 *
	 * @param {Object|null} editorHost Active editor host.
	 * @returns {Object|null} Session history API, or null.
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
	 * Execute one or more list operations through the canonical tracker path.
	 *
	 * This method intentionally disables per-operation history saves and cursor
	 * restores inside the lower-level tracker/editors, then records one history
	 * step after the full batch succeeds.
	 *
	 * @param   {Object} options Executor options.
	 * @returns {Object|null}    Applied-operation summary.
	 */
	function executeListOperations(options = {}) {
		const listTracker = getListTrackerModule();
		const editorHost = options.editorHost || null;
		const tracker = options.tracker || getTrackerForEditor(editorHost);
		const inputOperations = normalizeOperations(options);
		const savedSelection = captureSelectionSnapshot(editorHost, options);

		if (
			!listTracker ||
			typeof listTracker.applyOperation !== 'function' ||
			typeof listTracker.getStructure !== 'function' ||
			!tracker?.listElement ||
			!inputOperations.length
		) {
			return null;
		}

		const results = [];
		const operations = [];
		const appliedOperationKinds = [];
		for (let index = 0; index < inputOperations.length; index++) {
			const rawOperation = inputOperations[index];
			const targetResolutionMode = getListTargetResolutionMode(options);
			const expandedInputs = targetResolutionMode === 'api_uuid'
				? expandApiUuidListOperationInputs(rawOperation)
				: [ rawOperation ];
			if (!expandedInputs.length) {
				return null;
			}

			for (let expandedIndex = 0; expandedIndex < expandedInputs.length; expandedIndex++) {
				const operation = buildExecutableListOperation(
					editorHost,
					tracker,
					expandedInputs[expandedIndex],
					options
				);
				if (!operation) {
					return null;
				}

				const result = listTracker.applyOperation(tracker, operation, {
					editorHost,
					saveHistory: false,
					restoreCursor: false,
				});
				if (!result) {
					return null;
				}

				operations.push(operation);
				results.push(result);
			}

			const appliedKind = normalizeListOperationKind(rawOperation?.kind, options);
			if (!appliedKind) {
				return null;
			}
			appliedOperationKinds.push(appliedKind);
		}

		syncEditorRoot(editorHost, tracker);
		restoreSelectionSnapshot(editorHost, savedSelection);

		if (typeof options.afterSync === 'function') {
			options.afterSync({
				tracker,
				editorHost,
				results,
				operations,
			});
		}

		if (typeof editorHost?.updateToolbarState === 'function') {
			editorHost.updateToolbarState();
		}

		const historyApi = getSessionHistoryApiForHost(editorHost);
		if (options.saveHistory !== false && typeof historyApi?.saveToHistory === 'function') {
			historyApi.saveToHistory();
		}

		return {
			results,
			operationsApplied: appliedOperationKinds,
			structure: listTracker.getStructure(tracker),
		};
	}

	/**
	 * Execute one list-type change against the currently selected list.
	 *
	 * @param   {Object} options Executor options.
	 * @returns {Object|null}    Applied-operation summary.
	 */
	function executeCurrentListTypeChange(options = {}) {
		const editorHost = options.editorHost || null;
		const tracker = options.tracker || getTrackerForEditor(editorHost);
		const targetList = options.listElement || getCurrentListElement(editorHost);

		if (!tracker?.listElement || !targetList) {
			return null;
		}

		return executeListOperations({
			tracker,
			editorHost,
			saveHistory: options.saveHistory !== false,
			afterSync: options.afterSync,
			operations: [
				{
					kind: 'toggle_list_type',
					listPath: getListPathForElement(tracker, targetList),
					value: options.value,
				},
			],
		});
	}

	SFE.SchemaOperationExecutor = {
		executeComponentOperation: function executeComponentOperation(options = {}) {
			return executeComponentOperations({
				...options,
				operations: undefined,
				operation: options.operation || options,
			});
		},
		executeComponentOperations,
		executeMediaOperation: function executeMediaOperation(options = {}) {
			return executeMediaOperations({
				...options,
				operations: undefined,
				operation: options.operation || options,
			});
		},
		executeMediaOperations,
		executeBlockAttributeOperation,
		executeBlockAttributeOperations,
		executeListOperations,
		executeCurrentListTypeChange,
		getTrackerForEditor,
		getCurrentListElement,
		getListPathForElement,
		syncEditorRoot,
		isUnsetBlockAttributeValue,
		normalizeBlockAttributeTrackedValue,
		getTextAlignmentCapability: getNormalizedTextAlignmentCapability,
		getNormalizedTextAlignmentCapability,
		isTextAlignmentOperation,
	};
})();
