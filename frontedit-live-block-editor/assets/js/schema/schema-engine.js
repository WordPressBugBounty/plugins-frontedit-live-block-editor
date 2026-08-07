/**
 * Schema runtime service.
 *
 * Reads PHP-provided schema contracts and exposes explicit runtime helpers
 * consumed by core editor/save modules.
 *
 * Exposes:
 *   SFE.SchemaRuntime
 *   SFE.SchemaV2
 */
( function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	const RAW_SCHEMA_DATA = window.MWPSFE_Schema_Data || { version: 1, schemas: {} };

	const VALID_COMPONENT_TYPES       = new Set( [ 'text', 'file' ] );
	const VALID_BLOCK_TYPES           = new Set( [ 'text', 'media' ] );
	const VALID_MEDIA_TYPES           = new Set( [ 'image', 'audio', 'video', 'file', 'image_or_video', 'icon' ] );
	const VALID_BINDING_SOURCES       = new Set( [ 'html', 'plaintext', 'textalignment', 'columnalignment', 'url', 'id', 'media_type', 'list_block' ] );
	const VALID_TARGET_SCOPES         = new Set( [ 'component', 'block', 'column' ] );
	const VALID_ENTER_MODES           = new Set( [ 'auto', 'always', 'never', 'linebreak' ] );
	const VALID_LINK_UI_MODES         = new Set( [ 'auto', 'manual' ] );
	const VALID_TAB_ACTIONS           = new Set( [ 'none', 'indent', 'outdent', 'nextComponent', 'previousComponent' ] );
	const VALID_MISSING_UI_MODES      = new Set( [ 'ghost' ] );
	const VALID_MISSING_UI_PLACEMENTS = new Set( [ 'append', 'prepend' ] );
	const GHOST_COMPONENT_ATTR        = 'data-mwp-sfe-ghost-component';
	const GHOST_FLAG_ATTR             = 'data-mwp-sfe-ghost';
	const GHOST_CLASS                 = 'mwp-sfe-ghost-component';

	function isPlainObject( value ) {
		return !!value && typeof value === 'object' && !Array.isArray( value );
	}

	function isElementNode( value ) {
		return !!value && value.nodeType === Node.ELEMENT_NODE;
	}

	function normalizeBindingDefinition( rawBinding ) {
		if ( !isPlainObject( rawBinding ) ) return null;
		const path   = typeof rawBinding.path === 'string' ? rawBinding.path.trim() : '';
		const source = typeof rawBinding.source === 'string' ? rawBinding.source.trim().toLowerCase() : '';
		if ( !path || !VALID_BINDING_SOURCES.has( source ) ) return null;

		const binding = { path, source };
		if ( rawBinding.resolved === true ) {
			binding.resolved = true;
		}

		if ( typeof rawBinding.value === 'string' && rawBinding.value.trim() ) {
			binding.value = rawBinding.value.trim();
		}

		return binding;
	}

	function normalizeEditorExtractionOptions( rawOptions ) {
		if ( !isPlainObject( rawOptions ) ) return null;

		const options = {};
		if ( rawOptions.preserveNewlines === true ) {
			options.preserveNewlines = true;
		}
		if ( rawOptions.newlinesToBR === true ) {
			options.newlinesToBR = true;
		}

		return Object.keys( options ).length ? options : null;
	}

	function normalizeEditorTabMode( rawTabMode ) {
		if ( !isPlainObject( rawTabMode ) ) return null;

		const tab      = typeof rawTabMode.tab === 'string' ? rawTabMode.tab.trim() : '';
		const shiftTab = typeof rawTabMode.shiftTab === 'string' ? rawTabMode.shiftTab.trim() : '';
		const normalized = {};

		if ( tab && VALID_TAB_ACTIONS.has( tab ) ) {
			normalized.tab = tab;
		}

		if ( shiftTab && VALID_TAB_ACTIONS.has( shiftTab ) ) {
			normalized.shiftTab = shiftTab;
		}

		return Object.keys( normalized ).length ? normalized : null;
	}

	function normalizeEditorTarget( rawTarget ) {
		if ( typeof rawTarget === 'string' ) {
			const value = rawTarget.trim();
			return value || null;
		}

		if ( !isPlainObject( rawTarget ) ) return null;

		const scope = typeof rawTarget.scope === 'string' ? rawTarget.scope.trim().toLowerCase() : '';
		if ( scope && !VALID_TARGET_SCOPES.has( scope ) ) return null;

		const selector   = typeof rawTarget.selector === 'string' ? rawTarget.selector.trim() : '';
		const contextKey = typeof rawTarget.contextKey === 'string' ? rawTarget.contextKey.trim() : 'column';

		return {
			scope: scope || 'component',
			selector,
			contextKey,
		};
	}

	function normalizeEditorFormats( rawFormats, depth = 0 ) {
		if ( depth > 3 || !Array.isArray( rawFormats ) ) return null;

		const normalized = [];
		rawFormats.forEach( item => {
			if ( typeof item === 'string' ) {
				const token = item.trim();
				if ( token ) {
					normalized.push( token );
				}
				return;
			}

			if ( Array.isArray( item ) ) {
				const group = normalizeEditorFormats( item, depth + 1 );
				if ( Array.isArray( group ) && group.length ) {
					normalized.push( group );
				}
			}
		} );

		return normalized.length ? normalized : null;
	}

	function normalizeInlineFormatCapability( rawCapability ) {
		if ( !isPlainObject( rawCapability ) ) return null;

		const tag = typeof rawCapability.tag === 'string'
			? rawCapability.tag.trim().toLowerCase()
			: '';
		if ( !tag ) return null;

		const normalizeStringArray = rawValue => {
			if ( !Array.isArray( rawValue ) ) return null;
			const values = rawValue
				.map( value => ( typeof value === 'string' ? value.trim() : '' ) )
				.filter( Boolean );
			return values.length ? values : null;
		};

		const normalized = { tag };
		const attributes = normalizeStringArray( rawCapability.attributes );
		const requiredAttributes = normalizeStringArray( rawCapability.requiredAttributes );
		const allowedTargets = normalizeStringArray( rawCapability.allowedTargets );
		const allowedRelTokens = normalizeStringArray( rawCapability.allowedRelTokens );
		const allowedProtocols = normalizeStringArray( rawCapability.allowedProtocols );

		if ( attributes ) normalized.attributes = attributes;
		if ( requiredAttributes ) normalized.requiredAttributes = requiredAttributes;
		if ( allowedTargets ) normalized.allowedTargets = allowedTargets;
		if ( allowedRelTokens ) normalized.allowedRelTokens = allowedRelTokens;
		if ( allowedProtocols ) normalized.allowedProtocols = allowedProtocols;

		if ( typeof rawCapability.allowsRelativeUrls === 'boolean' ) {
			normalized.allowsRelativeUrls = rawCapability.allowsRelativeUrls;
		}

		if ( typeof rawCapability.allowsAnchorLinks === 'boolean' ) {
			normalized.allowsAnchorLinks = rawCapability.allowsAnchorLinks;
		}

		if ( typeof rawCapability.autoProtocol === 'string' && rawCapability.autoProtocol.trim() ) {
			normalized.autoProtocol = rawCapability.autoProtocol.trim().toLowerCase();
		}

		if ( typeof rawCapability.preservesUnknownRelTokens === 'boolean' ) {
			normalized.preservesUnknownRelTokens = rawCapability.preservesUnknownRelTokens;
		}

		return normalized;
	}

	function normalizeInlineFormatCapabilities( rawCapabilities ) {
		if ( !isPlainObject( rawCapabilities ) ) return null;

		const normalized = {};
		Object.keys( rawCapabilities ).forEach( key => {
			const cleanKey = typeof key === 'string' ? key.trim() : '';
			if ( !cleanKey ) return;

			const capability = normalizeInlineFormatCapability( rawCapabilities[ key ] );
			if ( capability ) {
				normalized[ cleanKey ] = capability;
			}
		} );

		return Object.keys( normalized ).length ? normalized : null;
	}

	function normalizeEditorAttributeCapabilityValues( rawValues ) {
		if ( !Array.isArray( rawValues ) ) return null;

		const values = rawValues.filter( value => (
			typeof value === 'string' ||
			typeof value === 'number' ||
			typeof value === 'boolean' ||
			value === null
		) );

		return values.length ? values : null;
	}

	function normalizeEditorAttributeCapability( rawCapability ) {
		if ( !isPlainObject( rawCapability ) ) return null;

		const normalized = {};
		const attribute = typeof rawCapability.attribute === 'string'
			? rawCapability.attribute.trim()
			: '';
		const attributes = Array.isArray( rawCapability.attributes )
			? rawCapability.attributes
				.map( value => ( typeof value === 'string' ? value.trim() : '' ) )
				.filter( Boolean )
			: null;

		if ( attribute ) {
			normalized.attribute = attribute;
		} else if ( attributes && attributes.length ) {
			normalized.attributes = attributes;
		} else {
			return null;
		}

		const values = normalizeEditorAttributeCapabilityValues( rawCapability.values );
		if ( values ) {
			normalized.values = values;
		}

		if ( rawCapability.tagChange === true ) {
			normalized.tagChange = true;
		}

		if ( rawCapability.preview === 'inline_style' ) {
			normalized.preview = 'inline_style';
		}

		if (
			Object.prototype.hasOwnProperty.call( rawCapability, 'unsetValue' ) &&
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

	function normalizeEditorAttributeCapabilities( rawCapabilities ) {
		if ( !isPlainObject( rawCapabilities ) ) return null;

		const normalized = {};
		Object.keys( rawCapabilities ).forEach( key => {
			const cleanKey = typeof key === 'string' ? key.trim() : '';
			if ( !cleanKey ) return;

			const capability = normalizeEditorAttributeCapability( rawCapabilities[ key ] );
			if ( capability ) {
				normalized[ cleanKey ] = capability;
			}
		} );

		return Object.keys( normalized ).length ? normalized : null;
	}

	function cloneEditorFormats( formats ) {
		if ( !Array.isArray( formats ) ) return null;
		return formats.map( item => (
			Array.isArray( item ) ? cloneEditorFormats( item ) : item
		) );
	}

	function cloneInlineFormatCapabilities( capabilities ) {
		if ( !isPlainObject( capabilities ) ) return null;

		const cloned = {};
		Object.keys( capabilities ).forEach( key => {
			const capability = normalizeInlineFormatCapability( capabilities[ key ] );
			if ( !capability ) return;

			cloned[ key ] = capability;
		} );

		return Object.keys( cloned ).length ? cloned : null;
	}

	function cloneEditorAttributeCapabilities( capabilities ) {
		if ( !isPlainObject( capabilities ) ) return null;

		const cloned = {};
		Object.keys( capabilities ).forEach( key => {
			const capability = capabilities[ key ];
			if ( !isPlainObject( capability ) ) return;

			cloned[ key ] = { ...capability };
			if ( Array.isArray( capability.attributes ) ) {
				cloned[ key ].attributes = [ ...capability.attributes ];
			}
			if ( Array.isArray( capability.values ) ) {
				cloned[ key ].values = [ ...capability.values ];
			}
		} );

		return Object.keys( cloned ).length ? cloned : null;
	}

	function normalizeEditorOperationValues( rawValues ) {
		if ( !Array.isArray( rawValues ) ) return null;

		const values = rawValues.filter( value => (
			typeof value === 'string' ||
			typeof value === 'number' ||
			typeof value === 'boolean' ||
			value === null
		) );

		return values.length ? values : null;
	}

	function normalizeEditorOperationStringArray( rawValues ) {
		if ( !Array.isArray( rawValues ) ) return null;

		const values = rawValues
			.map( value => ( typeof value === 'string' ? value.trim() : '' ) )
			.filter( Boolean );

		return values.length ? values : null;
	}

	function normalizeEditorOperation( rawOperation ) {
		if ( !isPlainObject( rawOperation ) ) return null;

		const id = typeof rawOperation.id === 'string' ? rawOperation.id.trim() : '';
		const kind = typeof rawOperation.kind === 'string' ? rawOperation.kind.trim() : '';
		const component = typeof rawOperation.component === 'string' ? rawOperation.component.trim() : '';
		if ( !id || !kind || !component ) return null;

		const normalized = { id, kind, component };
		const attribute = typeof rawOperation.attribute === 'string' ? rawOperation.attribute.trim() : '';
		const format = typeof rawOperation.format === 'string' ? rawOperation.format.trim() : '';
		const attributes = normalizeEditorOperationStringArray( rawOperation.attributes );
		const formats = normalizeEditorOperationStringArray( rawOperation.formats );
		const targetModes = normalizeEditorOperationStringArray( rawOperation.targetModes );
		const values = normalizeEditorOperationValues( rawOperation.values );

		if ( attribute ) {
			normalized.attribute = attribute;
		}
		if ( attributes ) {
			normalized.attributes = attributes;
		}
		if ( format ) {
			normalized.format = format;
		}
		if ( formats ) {
			normalized.formats = formats;
		}
		if ( targetModes ) {
			normalized.targetModes = targetModes;
		}
		if ( values ) {
			normalized.values = values;
		}
		if ( Object.prototype.hasOwnProperty.call( rawOperation, 'unsetValue' ) ) {
			normalized.unsetValue = rawOperation.unsetValue;
		}
		if ( typeof rawOperation.preserveInlineFormatting === 'boolean' ) {
			normalized.preserveInlineFormatting = rawOperation.preserveInlineFormatting;
		}
		if ( typeof rawOperation.preserveUnchangedText === 'boolean' ) {
			normalized.preserveUnchangedText = rawOperation.preserveUnchangedText;
		}
		if ( typeof rawOperation.preserveUnspecifiedAttributes === 'boolean' ) {
			normalized.preserveUnspecifiedAttributes = rawOperation.preserveUnspecifiedAttributes;
		}
		if ( typeof rawOperation.mergeRelTokens === 'boolean' ) {
			normalized.mergeRelTokens = rawOperation.mergeRelTokens;
		}
		if ( rawOperation.tagChange === true ) {
			normalized.tagChange = true;
		}

		return normalized;
	}

	function cloneEditorOperations( operations ) {
		if ( !Array.isArray( operations ) ) return null;

		const cloned = operations
			.map( normalizeEditorOperation )
			.filter( Boolean );

		return cloned.length ? cloned : null;
	}

	function normalizeEditorDefinition( rawEditor ) {
		if ( !isPlainObject( rawEditor ) ) return null;

		const normalized = {};

		const enterMode = typeof rawEditor.enterMode === 'string'
			? rawEditor.enterMode.trim().toLowerCase()
			: '';
		if ( enterMode && VALID_ENTER_MODES.has( enterMode ) ) {
			normalized.enterMode = enterMode;
		}

		const linkUIMode = typeof rawEditor.linkUIMode === 'string'
			? rawEditor.linkUIMode.trim().toLowerCase()
			: '';
		if ( linkUIMode && VALID_LINK_UI_MODES.has( linkUIMode ) ) {
			normalized.linkUIMode = linkUIMode;
		}

		const tabMode = normalizeEditorTabMode( rawEditor.tabMode );
		if ( tabMode ) {
			normalized.tabMode = tabMode;
		}

		if ( isPlainObject( rawEditor.formatTargets ) ) {
			const formatTargets = {};
			Object.keys( rawEditor.formatTargets ).forEach( key => {
				const cleanKey = typeof key === 'string' ? key.trim() : '';
				if ( !cleanKey ) return;
				const normalizedTarget = normalizeEditorTarget( rawEditor.formatTargets[ key ] );
				if ( normalizedTarget ) {
					formatTargets[ cleanKey ] = normalizedTarget;
				}
			} );

			if ( Object.keys( formatTargets ).length ) {
				normalized.formatTargets = formatTargets;
			}
		}

		const formats = normalizeEditorFormats( rawEditor.formats );
		if ( formats ) {
			normalized.formats = formats;
		}

		const inlineFormatCapabilities = normalizeInlineFormatCapabilities( rawEditor.inlineFormatCapabilities );
		if ( inlineFormatCapabilities ) {
			normalized.inlineFormatCapabilities = inlineFormatCapabilities;
		}

		const attributeCapabilities = normalizeEditorAttributeCapabilities( rawEditor.attributeCapabilities );
		if ( attributeCapabilities ) {
			normalized.attributeCapabilities = attributeCapabilities;
		}

		const operations = cloneEditorOperations( rawEditor.operations );
		if ( operations ) {
			normalized.operations = operations;
		}

		const options = normalizeEditorExtractionOptions( rawEditor.options );
		if ( options ) {
			normalized.options = options;
		}

		return Object.keys( normalized ).length ? normalized : null;
	}

	function normalizeRepeatDefinition( rawRepeat ) {
		if ( !isPlainObject( rawRepeat ) ) return null;
		const mode = typeof rawRepeat.mode === 'string'
			? rawRepeat.mode.trim().toLowerCase()
			: '';

		if ( mode === 'tree_path' ) {
			const itemSelector = typeof rawRepeat.itemSelector === 'string' ? rawRepeat.itemSelector.trim() : '';
			const pathKey = typeof rawRepeat.pathKey === 'string' ? rawRepeat.pathKey.trim() : 'path';
			if ( !itemSelector || !pathKey ) return null;

			return {
				mode: 'tree_path',
				itemSelector,
				pathKey,
			};
		}

		const rowSelector  = typeof rawRepeat.rowSelector === 'string' ? rawRepeat.rowSelector.trim() : '';
		const cellSelector = typeof rawRepeat.cellSelector === 'string' ? rawRepeat.cellSelector.trim() : '';
		if ( !rowSelector || !cellSelector ) return null;
		return { rowSelector, cellSelector };
	}

	function normalizeFileTargetDefinition( rawTarget ) {
		if ( !isPlainObject( rawTarget ) ) return null;

		const selector  = typeof rawTarget.selector === 'string' ? rawTarget.selector.trim() : '';
		const attribute = typeof rawTarget.attribute === 'string' ? rawTarget.attribute.trim().toLowerCase() : '';
		const mediaType = typeof rawTarget.mediaType === 'string' ? rawTarget.mediaType.trim().toLowerCase() : '';

		if ( !selector || !attribute || !VALID_MEDIA_TYPES.has( mediaType ) ) {
			return null;
		}

		return {
			selector,
			attribute,
			mediaType,
		};
	}

	function normalizeMissingUIDefinition( rawMissingUI ) {
		if ( !isPlainObject( rawMissingUI ) ) return null;

		const mode = typeof rawMissingUI.mode === 'string'
			? rawMissingUI.mode.trim().toLowerCase()
			: '';
		const mountSelector = typeof rawMissingUI.mountSelector === 'string'
			? rawMissingUI.mountSelector.trim()
			: '';
		const placement = typeof rawMissingUI.placement === 'string'
			? rawMissingUI.placement.trim().toLowerCase()
			: 'append';
		const tag = typeof rawMissingUI.tag === 'string'
			? rawMissingUI.tag.trim().toLowerCase()
			: '';

		if (
			!VALID_MISSING_UI_MODES.has( mode ) ||
			!mountSelector ||
			!VALID_MISSING_UI_PLACEMENTS.has( placement ) ||
			!tag
		) {
			return null;
		}

		const attributes = {};
		if ( isPlainObject( rawMissingUI.attributes ) ) {
			Object.keys( rawMissingUI.attributes ).forEach( key => {
				const attrName = typeof key === 'string' ? key.trim() : '';
				const attrValue = typeof rawMissingUI.attributes[ key ] === 'string'
					? rawMissingUI.attributes[ key ].trim()
					: '';
				if ( attrName && attrValue ) {
					attributes[ attrName ] = attrValue;
				}
			} );
		}

		let when = null;
		if ( isPlainObject( rawMissingUI.when ) ) {
			const path = typeof rawMissingUI.when.path === 'string'
				? rawMissingUI.when.path.trim()
				: '';
			const hasEquals = Object.prototype.hasOwnProperty.call( rawMissingUI.when, 'equals' );
			const equals = hasEquals ? rawMissingUI.when.equals : undefined;
			const isComparableScalar = (
				typeof equals === 'string' ||
				typeof equals === 'number' ||
				typeof equals === 'boolean' ||
				equals === null
			);

			if ( path && hasEquals && isComparableScalar ) {
				when = { path, equals };
			}
		}

		let placementWhen = null;
		if ( isPlainObject( rawMissingUI.placementWhen ) ) {
			const path = typeof rawMissingUI.placementWhen.path === 'string'
				? rawMissingUI.placementWhen.path.trim()
				: '';
			const hasEquals = Object.prototype.hasOwnProperty.call( rawMissingUI.placementWhen, 'equals' );
			const equals = hasEquals ? rawMissingUI.placementWhen.equals : undefined;
			const conditionalPlacement = typeof rawMissingUI.placementWhen.placement === 'string'
				? rawMissingUI.placementWhen.placement.trim().toLowerCase()
				: '';
			const isComparableScalar = (
				typeof equals === 'string' ||
				typeof equals === 'number' ||
				typeof equals === 'boolean' ||
				equals === null
			);

			if ( path && hasEquals && isComparableScalar && VALID_MISSING_UI_PLACEMENTS.has( conditionalPlacement ) ) {
				placementWhen = { path, equals, placement: conditionalPlacement };
			}
		}

		return {
			mode,
			mountSelector,
			placement,
			tag,
			attributes: Object.keys( attributes ).length ? attributes : {},
			when,
			placementWhen,
		};
	}

	function normalizeComponentDefinition( rawComponent ) {
		if ( !isPlainObject( rawComponent ) ) return null;

		const id       = typeof rawComponent.id === 'string' ? rawComponent.id.trim() : '';
		const label    = typeof rawComponent.label === 'string' ? rawComponent.label.trim() : '';
		const type     = typeof rawComponent.type === 'string' ? rawComponent.type.trim().toLowerCase() : '';
		const selector = typeof rawComponent.selector === 'string' ? rawComponent.selector.trim() : '';

		if ( !id || !label || !selector || !VALID_COMPONENT_TYPES.has( type ) ) {
			return null;
		}

		const bindings = Array.isArray( rawComponent.bindings )
			? rawComponent.bindings
				.map( normalizeBindingDefinition )
				.filter( Boolean )
			: [];
		if ( !bindings.length ) {
			return null;
		}

		const normalized = {
			id,
			label,
			type,
			selector,
			bindings,
			default: !!rawComponent.default,
			uiEditable: rawComponent.uiEditable !== false,
		};

		const placeholder = typeof rawComponent.placeholder === 'string'
			? rawComponent.placeholder.trim()
			: '';
		if ( placeholder ) {
			normalized.placeholder = placeholder;
		}

		const repeat = normalizeRepeatDefinition( rawComponent.repeat );
		if ( repeat ) {
			normalized.repeat = repeat;
		}

		const editor = normalizeEditorDefinition( rawComponent.editor );
		if ( editor ) {
			normalized.editor = editor;
		}

		if ( type === 'text' ) {
			const missingUI = normalizeMissingUIDefinition( rawComponent.missingUI );
			if ( missingUI ) {
				normalized.missingUI = missingUI;
			}

			normalized.required = rawComponent.required === true;
		}

		if ( type === 'file' ) {
			const target = normalizeFileTargetDefinition( rawComponent.target );
			if ( !target ) return null;
			normalized.target = target;
		}

		return normalized;
	}

	function normalizeSchemaDefinition( rawSchema, handlerId ) {
		if ( !isPlainObject( rawSchema ) ) return null;

		const version = Number.parseInt( rawSchema.version, 10 );
		if ( !Number.isInteger( version ) || version < 1 ) return null;

		if ( !isPlainObject( rawSchema.block ) ) return null;
		const blockName = typeof rawSchema.block.name === 'string' ? rawSchema.block.name.trim() : '';
		if ( !blockName ) return null;

		const blockType = typeof rawSchema.block.type === 'string'
			? rawSchema.block.type.trim().toLowerCase()
			: '';
		if ( !VALID_BLOCK_TYPES.has( blockType ) ) return null;

		const components = Array.isArray( rawSchema.components )
			? rawSchema.components
				.map( normalizeComponentDefinition )
				.filter( Boolean )
			: [];
		if ( !components.length ) return null;

		return {
			handlerId,
			version,
			block: {
				name: blockName,
				type: blockType,
			},
			components,
		};
	}

	function buildSchemaRegistry( rawData ) {
		if ( !isPlainObject( rawData ) || !isPlainObject( rawData.schemas ) ) {
			return {};
		}

		const registry = {};
		Object.keys( rawData.schemas ).forEach( handlerId => {
			const normalized = normalizeSchemaDefinition( rawData.schemas[ handlerId ], handlerId );
			if ( normalized ) {
				registry[ handlerId ] = normalized;
			}
		} );
		return registry;
	}

	function getSchemaForHandler( handler, registry ) {
		if ( !handler || typeof handler.id !== 'string' ) return null;
		return registry[ handler.id ] || null;
	}

	function findScopedElements( rootElement, selector ) {
		if ( !isElementNode( rootElement ) || !selector ) return [];

		const scoped = [];
		if ( rootElement.matches( selector ) ) {
			const owner = rootElement.closest( '[data-mwp-sfe-uuid]' );
			if ( !owner || owner === rootElement ) {
				scoped.push( rootElement );
			}
		}

		const matches = rootElement.querySelectorAll( selector );
		matches.forEach( candidate => {
			const owner = candidate.closest( '[data-mwp-sfe-uuid]' );
			if ( !owner || owner === rootElement ) {
				scoped.push( candidate );
			}
		} );

		return scoped;
	}

	function findScopedElement( rootElement, selector ) {
		const matches = findScopedElements( rootElement, selector );
		return matches.length ? matches[ 0 ] : null;
	}

	function isGhostElement( element ) {
		return isElementNode( element ) && element.getAttribute( GHOST_FLAG_ATTR ) === '1';
	}

	function findRealScopedElements( rootElement, selector ) {
		return findScopedElements( rootElement, selector ).filter( element => !isGhostElement( element ) );
	}

	function getManagedMissingComponentElements( rootElement, componentId ) {
		if ( !isElementNode( rootElement ) || !componentId ) return [];

		return Array.from( rootElement.querySelectorAll( `[${ GHOST_COMPONENT_ATTR }]` ) ).filter( element => (
			element.getAttribute( GHOST_COMPONENT_ATTR ) === componentId
		) );
	}

	function getManagedMissingComponentElement( rootElement, componentId ) {
		const matches = getManagedMissingComponentElements( rootElement, componentId );
		return matches.length ? matches[ 0 ] : null;
	}

	function getGhostComponentElements( rootElement, componentId ) {
		return getManagedMissingComponentElements( rootElement, componentId ).filter( isGhostElement );
	}

	function getGhostComponentElement( rootElement, componentId ) {
		const matches = getGhostComponentElements( rootElement, componentId );
		return matches.length ? matches[ 0 ] : null;
	}

	function removeGhostComponentElements( rootElement, componentId ) {
		getGhostComponentElements( rootElement, componentId ).forEach( element => element.remove() );
	}

	function resolveGhostMountElement( rootElement, mountSelector ) {
		const selector = typeof mountSelector === 'string' ? mountSelector.trim() : '';
		if ( !selector ) return null;
		if ( selector === ':scope' ) return rootElement;
		return findScopedElement( rootElement, selector );
	}

	function applyGhostShellAttributes( ghostElement, componentDefinition ) {
		if ( !isElementNode( ghostElement ) || !componentDefinition ) return;

		const ghostAttributes = isPlainObject( componentDefinition?.missingUI?.attributes )
			? componentDefinition.missingUI.attributes
			: {};

		Object.keys( ghostAttributes ).forEach( attrName => {
			const attrValue = ghostAttributes[ attrName ];
			if ( typeof attrValue === 'string' && attrValue ) {
				if ( attrName === 'class' ) {
					attrValue.split( /\s+/ ).filter( Boolean ).forEach( cls => ghostElement.classList.add( cls ) );
				} else {
					ghostElement.setAttribute( attrName, attrValue );
				}
			}
		} );

		ghostElement.setAttribute( GHOST_COMPONENT_ATTR, componentDefinition.id );
	}

	function insertGhostElement( mountElement, ghostElement, placement ) {
		if ( !isElementNode( mountElement ) || !isElementNode( ghostElement ) ) return;

		if ( placement === 'prepend' ) {
			mountElement.insertBefore( ghostElement, mountElement.firstChild );
			return;
		}

		mountElement.appendChild( ghostElement );
	}

	function resolveComponentAttributeState( options = {} ) {
		const directAttributeState = isPlainObject( options.attributeState )
			? options.attributeState
			: null;
		if ( directAttributeState ) {
			return directAttributeState;
		}

		const blockAttributes = isPlainObject( options.blockAttributes )
			? options.blockAttributes
			: null;
		const attributeChanges = isPlainObject( options.attributeChanges )
			? options.attributeChanges
			: null;

		if ( blockAttributes && attributeChanges ) {
			return applyAttributeChangesToAttributes( blockAttributes, attributeChanges );
		}

		if ( blockAttributes ) {
			return deepCloneAttributes( blockAttributes );
		}

		if ( attributeChanges ) {
			return applyAttributeChangesToAttributes( {}, attributeChanges );
		}

		return null;
	}

	function isRequiredTextComponent( componentDefinition ) {
		return !!(
			componentDefinition &&
			componentDefinition.type === 'text' &&
			componentDefinition.required === true
		);
	}

	function supportsGhostManagedTextComponent( componentDefinition ) {
		return !!(
			componentDefinition &&
			componentDefinition.type === 'text' &&
			componentDefinition?.missingUI?.mode === 'ghost'
		);
	}

	function shouldMaterializeGhostComponent( componentDefinition, options = {} ) {
		if (
			!componentDefinition ||
			componentDefinition.type !== 'text' ||
			componentDefinition?.missingUI?.mode !== 'ghost'
		) {
			return false;
		}

		const when = isPlainObject( componentDefinition.missingUI.when )
			? componentDefinition.missingUI.when
			: null;
		if ( when?.path ) {
			const attributeState = resolveComponentAttributeState( options );
			if ( !attributeState ) {
				return false;
			}

			if ( getValueByPath( attributeState, when.path ) !== when.equals ) {
				return false;
			}
		}

		return true;
	}

	function hasMeaningfulManagedComponentContent( element ) {
		if ( !isElementNode( element ) ) return false;

		const placeholderApi = SFE.RichTextPlaceholder || null;
		if ( placeholderApi && typeof placeholderApi.hasMeaningfulContent === 'function' ) {
			return placeholderApi.hasMeaningfulContent( element );
		}

		const text = String( element.textContent || '' )
			.replace( /\uFEFF/g, '' )
			.replace( /\u00A0/g, ' ' )
			.trim();
		if ( text.length ) {
			return true;
		}

		return !!element.querySelector?.( 'img, audio, video, iframe, embed, object, svg, canvas, hr, input, textarea, select, button, table' );
	}

	function hasMeaningfulComponentBindingValue( value, source ) {
		if ( value === undefined || value === null ) return false;

		if ( source === 'plaintext' ) {
			return String( value )
				.replace( /\uFEFF/g, '' )
				.replace( /\u00A0/g, ' ' )
				.trim()
				.length > 0;
		}

		if ( source === 'html' ) {
			const html = String( value || '' );
			if ( !html.trim() ) {
				return false;
			}

			const probe = document.createElement( 'div' );
			probe.innerHTML = html;
			return hasMeaningfulManagedComponentContent( probe );
		}

		return !!value;
	}

	function componentHasMeaningfulAttributeContent( componentDefinition, attributeState ) {
		if ( !componentDefinition || !Array.isArray( componentDefinition.bindings ) || !attributeState ) {
			return false;
		}

		return componentDefinition.bindings.some( binding => {
			if ( !binding || ( binding.source !== 'html' && binding.source !== 'plaintext' ) ) {
				return false;
			}

			return hasMeaningfulComponentBindingValue(
				getValueByPath( attributeState, binding.path ),
				binding.source
			);
		} );
	}

	function resolveAttributeStateFromRawContent( rawContent ) {
		const content = typeof rawContent === 'string' ? rawContent.trim() : '';
		if ( !content || !window.wp?.blocks?.parse ) {
			return null;
		}

		try {
			const parsedBlocks = wp.blocks.parse( content );
			const parsedBlock = Array.isArray( parsedBlocks ) ? parsedBlocks[ 0 ] : null;
			return isPlainObject( parsedBlock?.attributes ) ? parsedBlock.attributes : {};
		} catch ( error ) {
			console.error( 'FrontEdit Schema: failed to parse raw block content for rendered snapshot reconciliation', error );
			return null;
		}
	}

	/**
	 * Reconcile a cloned live block snapshot against canonical schema attrs.
	 *
	 * Keeps full-page/theme-aware DOM classes from the rendered block while removing
	 * empty optional missingUI shells that no longer exist in the serialized block
	 * payload. This prevents batch-edit state from restoring stale optional markup.
	 *
	 * @param {HTMLElement} rootElement Snapshot root to mutate.
	 * @param {Object}      handler     Active edit handler.
	 * @param {Object}      options     Reconciliation options.
	 * @returns {HTMLElement|null}      The mutated root element, or null when no schema applies.
	 */
	function reconcileRenderedSnapshot( rootElement, handler, options = {} ) {
		if ( !isElementNode( rootElement ) || !handler ) return null;

		const schema = getSchemaForHandler( handler, schemaRegistry );
		if ( !schema || !Array.isArray( schema.components ) ) {
			return null;
		}

		const attributeState = resolveComponentAttributeState( options )
			|| resolveAttributeStateFromRawContent( options.rawContent || '' );
		if ( !attributeState ) {
			return rootElement;
		}

		schema.components.forEach( componentDefinition => {
			if ( !supportsGhostManagedTextComponent( componentDefinition ) ) {
				return;
			}

			const shouldMaterialize = shouldMaterializeGhostComponent( componentDefinition, {
				attributeState,
			} );
			const hasCanonicalContent = componentHasMeaningfulAttributeContent( componentDefinition, attributeState );
			if ( shouldMaterialize && hasCanonicalContent ) {
				return;
			}

			findScopedElements( rootElement, componentDefinition.selector ).forEach( element => {
				if ( hasMeaningfulManagedComponentContent( element ) ) {
					return;
				}

				element.remove();
			} );
		} );

		return rootElement;
	}

	/**
	 * Synchronize schema-managed optional component shell state.
	 *
	 * @param {HTMLElement} element            Candidate schema component element.
	 * @param {?Object}     componentDefinition Optional schema component definition.
	 * @param {Object}      options            Sync options.
	 * @param {boolean}     options.removeInactiveEmpty Remove empty inactive shells.
	 * @param {boolean}     options.forceRemoveInactive Remove inactive empties even when block root is still marked editing-active.
	 * @returns {void}
	 */
	function syncManagedMissingComponentState( element, componentDefinition = null, options = {} ) {
		if ( !isElementNode( element ) ) return;

		const managesGhostState = !!element.getAttribute( GHOST_COMPONENT_ATTR )
			|| supportsGhostManagedTextComponent( componentDefinition );
		if ( !managesGhostState ) return;

		const persistGhostFlag = !!element.getAttribute( GHOST_COMPONENT_ATTR );

		if ( hasMeaningfulManagedComponentContent( element ) ) {
			element.classList.remove( GHOST_CLASS );
			element.removeAttribute( GHOST_FLAG_ATTR );
			return;
		}

		const removeInactiveEmpty = options?.removeInactiveEmpty !== false;
		const forceRemoveInactive = options?.forceRemoveInactive === true;
		const ownerElement = element.closest( '[data-mwp-sfe-uuid]' );
		const ownerIsInlineEditing = !!(
			isElementNode( ownerElement ) && (
				ownerElement.classList.contains( 'mwp-sfe-element-active' )
				|| ownerElement.classList.contains( 'mwp-sfe-editing-active' )
				|| ownerElement.classList.contains( 'mwp-sfe-inline-editor' )
			)
		);
		const isInactiveManagedComponent = (
			element.getAttribute( 'contenteditable' ) !== 'true'
			&& !element.getAttribute( 'data-mwp-sfe-active-component' )
			&& !element.classList.contains( 'mwp-sfe-component-active' )
			&& !element.classList.contains( 'mwp-sfe-inline-editor' )
			&& !element.classList.contains( 'mwp-sfe-editable-component' )
		);
		if ( removeInactiveEmpty && isInactiveManagedComponent && ( forceRemoveInactive || !ownerIsInlineEditing ) ) {
			element.remove();
			return;
		}

		element.classList.add( GHOST_CLASS );
		if ( persistGhostFlag ) {
			element.setAttribute( GHOST_FLAG_ATTR, '1' );
			return;
		}

		element.removeAttribute( GHOST_FLAG_ATTR );
	}

	/**
	 * Resolve the schema-declared placement for one optional ghost component.
	 *
	 * @param {Object} componentDefinition Normalized component schema.
	 * @param {Object} options Runtime block attribute state.
	 * @returns {'append'|'prepend'} Effective ghost placement.
	 */
	function resolveGhostPlacement( componentDefinition, options = {} ) {
		const missingUI = componentDefinition?.missingUI || null;
		const placementWhen = isPlainObject( missingUI?.placementWhen ) ? missingUI.placementWhen : null;
		const attributeState = resolveComponentAttributeState( options );

		if ( placementWhen?.path && attributeState && getValueByPath( attributeState, placementWhen.path ) === placementWhen.equals ) {
			return placementWhen.placement;
		}

		return missingUI?.placement || 'append';
	}

	/**
	 * Materialize one schema-managed optional text component when its canonical
	 * node is absent from rendered markup.
	 *
	 * @param {HTMLElement} rootElement Block root element.
	 * @param {Object} componentDefinition Normalized component schema.
	 * @param {Object} options Runtime block attribute state.
	 * @returns {HTMLElement|null} Materialized ghost element, if active.
	 */
	function materializeGhostComponentElement( rootElement, componentDefinition, options = {} ) {
		if (
			!isElementNode( rootElement ) ||
			!componentDefinition ||
			componentDefinition.type !== 'text' ||
			componentDefinition?.missingUI?.mode !== 'ghost'
		) {
			return null;
		}

		const mountElement = resolveGhostMountElement( rootElement, componentDefinition.missingUI.mountSelector );
		if ( !mountElement ) {
			removeGhostComponentElements( rootElement, componentDefinition.id );
			return null;
		}

		const existingManaged = getManagedMissingComponentElements( rootElement, componentDefinition.id );
		let ghostElement = existingManaged.find( element => element.parentNode ) || null;
		existingManaged.slice( ghostElement ? 1 : 0 ).forEach( element => element.remove() );

		const desiredTag = componentDefinition.missingUI.tag.toUpperCase();
		if ( ghostElement && ghostElement.tagName !== desiredTag ) {
			ghostElement.remove();
			ghostElement = null;
		}

		if ( !ghostElement ) {
			ghostElement = document.createElement( componentDefinition.missingUI.tag );
		}

		applyGhostShellAttributes( ghostElement, componentDefinition );
		if ( ghostElement.parentNode !== mountElement ) {
			insertGhostElement( mountElement, ghostElement, resolveGhostPlacement( componentDefinition, options ) );
		}

		// Sync ghost lifecycle only after the shell is attached so owner-state
		// checks can see whether the block is actually active. When this runs
		// outside an edit session, empty optional shells are removed immediately
		// instead of lingering as bare DOM nodes.
		syncManagedMissingComponentState( ghostElement, componentDefinition );

		return ghostElement.parentNode ? ghostElement : null;
	}

	function materializeRepeatedComponentElements( rootElement, componentDefinition ) {
		if (
			!isElementNode( rootElement ) ||
			!componentDefinition?.repeat ||
			componentDefinition.repeat.mode !== 'tree_path'
		) {
			return [];
		}

		const listTracker = SFE.ListBlockTracker || null;
		if ( listTracker && typeof listTracker.syncEditableTextSurfaces === 'function' ) {
			listTracker.syncEditableTextSurfaces( rootElement );
		}

		return findRealScopedElements( rootElement, componentDefinition.selector );
	}

	function resolveSchemaComponentElements( rootElement, componentDefinition, options = {} ) {
		if ( !isElementNode( rootElement ) || !componentDefinition ) return [];

		const {
			materializeGhost = false,
		} = options;

		let realMatches = findRealScopedElements( rootElement, componentDefinition.selector );
		if ( !realMatches.length ) {
			realMatches = materializeRepeatedComponentElements( rootElement, componentDefinition );
		}
		if ( realMatches.length ) {
			removeGhostComponentElements( rootElement, componentDefinition.id );
			return realMatches;
		}

		if ( componentDefinition.type !== 'text' || componentDefinition?.missingUI?.mode !== 'ghost' ) {
			removeGhostComponentElements( rootElement, componentDefinition.id );
			return [];
		}

		if ( !shouldMaterializeGhostComponent( componentDefinition, options ) ) {
			removeGhostComponentElements( rootElement, componentDefinition.id );
			return [];
		}

		const ghostElement = materializeGhost
			? materializeGhostComponentElement( rootElement, componentDefinition, options )
			: getManagedMissingComponentElement( rootElement, componentDefinition.id );

		return ghostElement ? [ ghostElement ] : [];
	}

	function resolveLiveComponentElement( rootElement, component ) {
		if ( !isElementNode( rootElement ) || !component || typeof component !== 'object' ) {
			return null;
		}

		const existingElement = component.element;
		if ( isElementNode( existingElement ) && rootElement.contains( existingElement ) ) {
			return existingElement;
		}

		const selector = typeof component.selector === 'string' ? component.selector.trim() : '';
		if ( selector ) {
			const resolvedBySelector = findScopedElement( rootElement, selector );
			if ( resolvedBySelector ) {
				return resolvedBySelector;
			}
		}

		if ( typeof component.id === 'string' && component.id ) {
			const ghostElement = getManagedMissingComponentElement( rootElement, component.id );
			if ( ghostElement ) {
				return ghostElement;
			}
		}

		return isElementNode( existingElement ) ? existingElement : null;
	}

	function getNthOfTypeIndex( node ) {
		let index = 1;
		let cursor = node;
		while ( cursor && cursor.previousElementSibling ) {
			cursor = cursor.previousElementSibling;
			if ( cursor.tagName === node.tagName ) {
				index++;
			}
		}
		return index;
	}

	function buildSelectorWithinRoot( rootElement, targetElement ) {
		if ( !isElementNode( rootElement ) || !isElementNode( targetElement ) ) return '';
		if ( targetElement === rootElement ) return ':scope';

		const segments = [];
		let cursor = targetElement;
		while ( cursor && cursor !== rootElement ) {
			const tag = cursor.tagName.toLowerCase();
			const nth = getNthOfTypeIndex( cursor );
			segments.unshift( `${ tag }:nth-of-type(${ nth })` );
			cursor = cursor.parentElement;
		}

		if ( cursor !== rootElement ) return '';
		return segments.join( ' > ' );
	}

	function resolveRepeatedContext( rootElement, element, repeatDefinition ) {
		if ( repeatDefinition?.mode === 'tree_path' ) {
			const itemSelector = typeof repeatDefinition.itemSelector === 'string'
				? repeatDefinition.itemSelector.trim()
				: '';
			const pathKey = typeof repeatDefinition.pathKey === 'string'
				? repeatDefinition.pathKey.trim()
				: 'path';
			const itemNode = itemSelector ? element.closest( itemSelector ) : null;
			if ( !itemNode || !rootElement.contains( itemNode ) ) {
				return null;
			}

			const indexes = [];
			let currentItem = itemNode;
			while ( currentItem && rootElement.contains( currentItem ) ) {
				const parentList = currentItem.parentElement;
				if ( !isElementNode( parentList ) ) {
					return null;
				}

				const siblingItems = Array.from( parentList.children || [] ).filter( child => child.tagName === 'LI' );
				const itemIndex = siblingItems.indexOf( currentItem );
				if ( itemIndex < 0 ) {
					return null;
				}

				indexes.unshift( itemIndex );
				const nextItem = parentList.closest( itemSelector );
				if ( !nextItem || !rootElement.contains( nextItem ) ) {
					break;
				}
				currentItem = nextItem;
			}

			if ( !indexes.length ) {
				return null;
			}

			const humanPath = indexes.map( index => index + 1 ).join( '.' );
			return {
				[ pathKey ]: indexes.join( '_' ),
				pathLabel: humanPath,
				depth: indexes.length - 1,
			};
		}

		const rowNodes = findScopedElements( rootElement, repeatDefinition.rowSelector );
		const rowNode  = element.closest( repeatDefinition.rowSelector );
		if ( !rowNode ) return null;

		const rowIndex = rowNodes.indexOf( rowNode );
		if ( rowIndex < 0 ) return null;

		const rowChildren = Array.from( rowNode.children ).filter( isElementNode );
		let columnIndex = Number.isInteger( element?.cellIndex ) ? element.cellIndex : -1;

		// Prefer the DOM cellIndex (true sibling position) so column targets stay aligned
		// across mixed th/td rows; fall back to selector-filtered indexing for non-table cases.
		if (
			columnIndex < 0
			|| columnIndex >= rowChildren.length
			|| rowChildren[ columnIndex ] !== element
		) {
			const cellNodes = rowChildren.filter( child => child.matches( repeatDefinition.cellSelector ) );
			columnIndex = cellNodes.indexOf( element );
		}

		if ( columnIndex < 0 ) return null;

		return {
			row: rowIndex,
			column: columnIndex,
		};
	}

	function applyContextTokens( template, context ) {
		return template.replace( /\{([a-zA-Z0-9_]+)\}/g, ( _, token ) => {
			if ( Object.prototype.hasOwnProperty.call( context, token ) ) {
				return String( context[ token ] );
			}
			return '';
		} );
	}

	function buildRuntimeComponentId( componentDefinition, context, fallbackIndex ) {
		if ( !componentDefinition.repeat ) {
			return componentDefinition.id;
		}

		if ( typeof context?.path === 'string' && context.path.trim() ) {
			return `${ componentDefinition.id }__p${ context.path.trim() }`;
		}

		const parts = [];
		if ( Number.isInteger( context.row ) ) {
			parts.push( `r${ context.row }` );
		}
		if ( Number.isInteger( context.column ) ) {
			parts.push( `c${ context.column }` );
		}
		if ( !parts.length ) {
			parts.push( String( fallbackIndex ) );
		}

		return `${ componentDefinition.id }__${ parts.join( '_' ) }`;
	}

	function resolveRuntimeFormatTarget( targetDefinition, context ) {
		if ( typeof targetDefinition === 'string' ) {
			return targetDefinition;
		}

		if ( !isPlainObject( targetDefinition ) ) return '';

		if ( targetDefinition.scope === 'block' ) {
			return 'block';
		}

		if ( targetDefinition.scope === 'component' ) {
			return 'selection';
		}

		if ( targetDefinition.scope === 'column' ) {
			const selector = typeof targetDefinition.selector === 'string' ? targetDefinition.selector.trim() : '';
			const contextKey = targetDefinition.contextKey || 'column';
			const contextValue = Number.parseInt( context[ contextKey ], 10 );
			if ( !selector || !Number.isInteger( contextValue ) || contextValue < 0 ) {
				return '';
			}
			return `all:${ selector }:nth-child(${ contextValue + 1 })`;
		}

		if ( targetDefinition.selector ) {
			return targetDefinition.selector;
		}

		return '';
	}

	function buildRuntimeEditorOptions( componentDefinition, context ) {
		const editorDefinition = componentDefinition.editor;
		if ( !editorDefinition ) {
			return null;
		}

		const editorOptions = {};
		if ( editorDefinition.enterMode ) {
			editorOptions.enterMode = editorDefinition.enterMode;
		}

		if ( editorDefinition.linkUIMode ) {
			editorOptions.linkUIMode = editorDefinition.linkUIMode;
		}

		if ( isPlainObject( editorDefinition.tabMode ) ) {
			editorOptions.tabMode = { ...editorDefinition.tabMode };
		}

		if ( isPlainObject( editorDefinition.formatTargets ) ) {
			const formatTargets = {};
			Object.keys( editorDefinition.formatTargets ).forEach( key => {
				const resolved = resolveRuntimeFormatTarget( editorDefinition.formatTargets[ key ], context );
				if ( resolved ) {
					formatTargets[ key ] = resolved;
				}
			} );
			if ( Object.keys( formatTargets ).length ) {
				editorOptions.formatTargets = formatTargets;
			}
		}

		if ( Array.isArray( editorDefinition.formats ) ) {
			editorOptions.formats = cloneEditorFormats( editorDefinition.formats );
		}

		if ( isPlainObject( editorDefinition.inlineFormatCapabilities ) ) {
			const inlineFormatCapabilities = cloneInlineFormatCapabilities( editorDefinition.inlineFormatCapabilities );
			if ( inlineFormatCapabilities ) {
				editorOptions.inlineFormatCapabilities = inlineFormatCapabilities;
			}
		}

		if ( isPlainObject( editorDefinition.attributeCapabilities ) ) {
			const attributeCapabilities = cloneEditorAttributeCapabilities( editorDefinition.attributeCapabilities );
			if ( attributeCapabilities ) {
				editorOptions.attributeCapabilities = attributeCapabilities;
			}
		}

		if ( Array.isArray( editorDefinition.operations ) ) {
			const operations = cloneEditorOperations( editorDefinition.operations );
			if ( operations ) {
				editorOptions.operations = operations;
			}
		}

		if ( isPlainObject( editorDefinition.options ) ) {
			editorOptions.options = { ...editorDefinition.options };
		}

		return Object.keys( editorOptions ).length ? editorOptions : null;
	}

	function buildRuntimeFromSchema( rootElement, schema, options = {} ) {
		if ( !schema || !isElementNode( rootElement ) ) return null;

		const runtime = {
			schemaHandlerId: schema.handlerId,
			blockName: schema.block.name,
			mode: 'text',
			editableComponents: [],
			componentsById: {},
			mediaComponent: null,
			primaryTextComponent: null,
		};

		let defaultAssigned  = false;
		let hasTextComponent = false;
		let hasFileComponent = false;

		schema.components.forEach( componentDefinition => {
			const matches = resolveSchemaComponentElements( rootElement, componentDefinition, {
				materializeGhost: true,
				blockAttributes: options.blockAttributes,
				attributeChanges: options.attributeChanges,
			} );
			if ( !matches.length ) return;

			matches.forEach( ( matchedElement, matchIndex ) => {
				const context = componentDefinition.repeat
					? resolveRepeatedContext( rootElement, matchedElement, componentDefinition.repeat )
					: {};
				if ( componentDefinition.repeat && !context ) {
					return;
				}

				const resolvedBindings = componentDefinition.bindings.map( binding => ( {
					path:     applyContextTokens( binding.path, context || {} ),
					source:   binding.source,
					resolved: !!binding.resolved,
					value:    typeof binding.value === 'string' ? binding.value : '',
				} ) );

				const selector = buildSelectorWithinRoot( rootElement, matchedElement );
				if ( !selector ) return;

				const runtimeId     = buildRuntimeComponentId( componentDefinition, context || {}, matchIndex );
				const editorOptions = buildRuntimeEditorOptions( componentDefinition, context || {} );
				const label         = buildRuntimeComponentLabel( componentDefinition, context || {} );

				if ( componentDefinition.type === 'file' ) {
					hasFileComponent = true;
					const target     = componentDefinition.target || null;
					if ( !target ) return;

					const urlBinding = resolvedBindings.find( binding => binding.source === 'url' ) || null;
					const idBinding  = resolvedBindings.find( binding => binding.source === 'id' ) || null;
					const mediaDescriptor = {
						componentId:    runtimeId,
						scopeSelector:  selector,
						targetSelector: target.selector,
						attribute:      target.attribute,
						mediaType:      target.mediaType,
					};

					const editableComponent = {
						id: runtimeId,
						label,
						selector,
						element: matchedElement,
						type: 'file',
						default: !!componentDefinition.default && !defaultAssigned,
						target: {
							selector:  target.selector,
							attribute: target.attribute,
							mediaType: target.mediaType,
						},
						mediaDescriptor,
						urlBindingPath: urlBinding?.path || '',
						idBindingPath: idBinding?.path || '',
					};
					if ( editorOptions ) {
						editableComponent.editor = editorOptions;
					}
					if ( editableComponent.default ) {
						defaultAssigned = true;
					}

					if ( componentDefinition.uiEditable !== false ) {
						runtime.editableComponents.push( editableComponent );
					}
					runtime.componentsById[ runtimeId ] = {
						id: runtimeId,
						label,
						element: matchedElement,
						selector,
						type: 'file',
						uiEditable: componentDefinition.uiEditable !== false,
						bindings: resolvedBindings,
						schemaSelector: componentDefinition.selector,
						mediaDescriptor,
						target: {
							selector:  target.selector,
							attribute: target.attribute,
							mediaType: target.mediaType,
						},
						editorOptions: editorOptions || null,
					};

					if ( !runtime.mediaComponent ) {
						runtime.mediaComponent = {
							id: runtimeId,
							selector,
							mediaDescriptor,
							target: {
								selector:  target.selector,
								attribute: target.attribute,
								mediaType: target.mediaType,
							},
							bindings: resolvedBindings,
						};
					}
					return;
				}

				const contentBinding = resolvedBindings.find( binding => (
					binding.source === 'html' ||
					binding.source === 'plaintext' ||
					binding.source === 'list_block'
				) );
				if ( !contentBinding ) return;
				hasTextComponent = true;

				const editableComponent = {
					id: runtimeId,
					label,
					selector,
					element: matchedElement,
					attribute: contentBinding.path,
					type: 'text',
					default: !!componentDefinition.default && !defaultAssigned,
					isGhost: isGhostElement( matchedElement ),
				};

				if ( componentDefinition.placeholder ) {
					editableComponent.placeholder = componentDefinition.placeholder;
				}

				if ( componentDefinition.missingUI ) {
					editableComponent.missingUI = componentDefinition.missingUI;
				}

				editableComponent.required = componentDefinition.required === true;

				if ( editorOptions ) {
					editableComponent.editor = editorOptions;
				}

				if ( editableComponent.default ) {
					defaultAssigned = true;
				}

				if ( componentDefinition.uiEditable !== false ) {
					runtime.editableComponents.push( editableComponent );
				}
				runtime.componentsById[ runtimeId ] = {
					id: runtimeId,
					label,
					element: matchedElement,
					selector,
					type: 'text',
					uiEditable: componentDefinition.uiEditable !== false,
					bindings: resolvedBindings,
					schemaSelector: componentDefinition.selector,
					missingUI: componentDefinition.missingUI || null,
					required: componentDefinition.required === true,
					editorOptions: editorOptions || null,
				};
			} );
		} );

		if ( !runtime.editableComponents.length ) {
			return null;
		}

		if ( !runtime.editableComponents.some( component => component.default ) ) {
			runtime.editableComponents[ 0 ].default = true;
		}

		const primaryTextComponent = runtime.editableComponents.find( component => component.type === 'text' && component.default )
			|| runtime.editableComponents.find( component => component.type === 'text' )
			|| null;
		if ( primaryTextComponent ) {
			runtime.primaryTextComponent = {
				selector: primaryTextComponent.selector,
				attribute: primaryTextComponent.attribute,
			};
		}

		if ( hasTextComponent && hasFileComponent ) {
			runtime.mode = 'mixed';
		} else if ( hasTextComponent ) {
			runtime.mode = 'text';
		} else if ( hasFileComponent ) {
			runtime.mode = 'media';
		} else {
			return null;
		}

		return runtime;
	}

	function createSchemaAwareHandler( handler, runtime ) {
		const baseConfig = isPlainObject( handler.client_config ) ? { ...handler.client_config } : {};
		const runtimeHandler = {
			...handler,
			client_config: baseConfig,
		};

		if ( runtime.mode === 'text' || runtime.mode === 'mixed' ) {
			runtimeHandler.contentType = 'text';
			runtimeHandler.client_config.editableComponents = runtime.editableComponents;
			return runtimeHandler;
		}

		if ( runtime.mode === 'media' && runtime.mediaComponent ) {
			runtimeHandler.contentType = 'media';
			runtimeHandler.client_config.editableComponents = runtime.editableComponents;
			return runtimeHandler;
		}

		return runtimeHandler;
	}

	function readTextAlignmentFromElement( element ) {
		if ( !isElementNode( element ) || !element.classList ) return undefined;
		const dataAlign = typeof element.getAttribute === 'function'
			? String( element.getAttribute( 'data-align' ) || '' ).trim().toLowerCase()
			: '';
		if ( dataAlign === 'left' || dataAlign === 'center' || dataAlign === 'right' || dataAlign === 'justify' ) {
			return dataAlign;
		}
		if ( element.classList.contains( 'has-text-align-justify' ) ) return 'justify';
		if ( element.classList.contains( 'has-text-align-right' ) ) return 'right';
		if ( element.classList.contains( 'has-text-align-center' ) ) return 'center';
		if ( element.classList.contains( 'has-text-align-left' ) ) return 'left';
		return undefined;
	}

	function isVideoUrl( url ) {
		return /\.(mp4|webm|ogv|mov|avi|wmv|m4v)(\?.*)?$/i.test( String( url || '' ) );
	}

	function splitBindingPath( path ) {
		return String( path || '' )
			.split( '.' )
			.map( segment => segment.trim() )
			.filter( Boolean )
			.map( segment => ( /^\d+$/.test( segment ) ? Number.parseInt( segment, 10 ) : segment ) );
	}

	/**
	 * Determine whether one existing nested attribute container matches the
	 * structure required by the next path segment.
	 *
	 * WordPress can round-trip empty nested style objects such as
	 * `style.typography` back into array-shaped containers. When that happens we
	 * must coerce the container back to an object before assigning a nested key,
	 * otherwise JSON serialization silently drops string-key writes on arrays.
	 *
	 * @param {*}      value   Existing nested container candidate.
	 * @param {number|string} nextKey Upcoming path segment.
	 * @returns {boolean} True when the container already has the required shape.
	 */
	function isCompatiblePathContainer( value, nextKey ) {
		return ( typeof nextKey === 'number' )
			? Array.isArray( value )
			: isPlainObject( value );
	}

	/**
	 * Determine whether one nested attribute value is structurally empty.
	 *
	 * Empty objects/arrays left behind after unsetting one deep attribute should
	 * be pruned so default/unset block attrs disappear cleanly instead of
	 * persisting as `style: { typography: [] }`.
	 *
	 * @param {*} value Candidate nested value.
	 * @returns {boolean} True when the value is an empty container.
	 */
	function isEmptyPathContainer( value ) {
		if ( Array.isArray( value ) ) {
			return value.length === 0 && Object.keys( value ).length === 0;
		}

		if ( !isPlainObject( value ) ) {
			return false;
		}

		return Object.keys( value ).length === 0;
	}

	function setValueByPath( target, path, value ) {
		const parts = splitBindingPath( path );
		if ( !parts.length ) return;

		let cursor = target;
		const parentTrail = [];
		for ( let i = 0; i < parts.length - 1; i++ ) {
			const key = parts[ i ];
			const nextKey = parts[ i + 1 ];

			if ( typeof key === 'number' ) {
				if ( !Array.isArray( cursor ) ) return;
				if (
					cursor[ key ] === undefined ||
					cursor[ key ] === null ||
					!isCompatiblePathContainer( cursor[ key ], nextKey )
				) {
					cursor[ key ] = ( typeof nextKey === 'number' ) ? [] : {};
				}
				parentTrail.push( { container: cursor, key } );
				cursor = cursor[ key ];
				continue;
			}

			if ( !isPlainObject( cursor ) && !Array.isArray( cursor ) ) return;
			if (
				cursor[ key ] === undefined ||
				cursor[ key ] === null ||
				!isCompatiblePathContainer( cursor[ key ], nextKey )
			) {
				cursor[ key ] = ( typeof nextKey === 'number' ) ? [] : {};
			}
			parentTrail.push( { container: cursor, key } );
			cursor = cursor[ key ];
		}

		const finalKey = parts[ parts.length - 1 ];
		if ( typeof finalKey === 'number' ) {
			if ( !Array.isArray( cursor ) ) return;
			cursor[ finalKey ] = value;
			return;
		}

		if ( value === undefined || value === null ) {
			if ( isPlainObject( cursor ) || Array.isArray( cursor ) ) {
				delete cursor[ finalKey ];

				for ( let i = parentTrail.length - 1; i >= 0; i-- ) {
					const parentEntry = parentTrail[ i ];
					const childValue = parentEntry?.container?.[ parentEntry.key ];
					if ( !isEmptyPathContainer( childValue ) ) {
						break;
					}

					delete parentEntry.container[ parentEntry.key ];
				}
			}
			return;
		}

		cursor[ finalKey ] = value;
	}

	function getValueByPath( source, path ) {
		const parts = splitBindingPath( path );
		if ( !parts.length ) return undefined;

		let cursor = source;
		for ( let i = 0; i < parts.length; i++ ) {
			const key = parts[ i ];
			if ( cursor === undefined || cursor === null ) {
				return undefined;
			}

			if ( typeof key === 'number' ) {
				if ( !Array.isArray( cursor ) ) {
					return undefined;
				}
				cursor = cursor[ key ];
				continue;
			}

			if ( !isPlainObject( cursor ) && !Array.isArray( cursor ) ) {
				return undefined;
			}
			cursor = cursor[ key ];
		}

		return cursor;
	}

	function stripEditorPlaceholderChars( value ) {
		return ( typeof value === 'string' ) ? value.replace( /\uFEFF/g, '' ) : value;
	}

	function extractBindingValue( binding, component, editorState, componentMeta = null ) {
		const ElementPrep   = SFE.ElementPrep;
		const element       = component?.element || null;
		const editorOptions = isPlainObject( componentMeta?.editorOptions )
			? componentMeta.editorOptions
			: null;
		const extractionOptions = isPlainObject( editorOptions?.options )
			? editorOptions.options
			: null;

		if ( binding.source === 'url' ) {
			const mediaChanges = element?._mwpMediaChanges || editorState?.element?._mwpMediaChanges || null;
			if ( !mediaChanges ) {
				return undefined;
			}

			if ( binding.resolved ) {
				const resolvedValueKey = binding.value === 'width'
					? 'resolvedWidth'
					: ( binding.value === 'height' ? 'resolvedHeight' : 'resolvedUrl' );
				const resolvedValue = mediaChanges?.[ resolvedValueKey ];
				return ( resolvedValue === undefined || resolvedValue === null ) ? undefined : resolvedValue;
			}

			return mediaChanges.url || undefined;
		}

		if ( binding.source === 'id' ) {
			const idValue = element?._mwpMediaChanges?.id ?? editorState?.element?._mwpMediaChanges?.id;
			return ( idValue === undefined || idValue === null ) ? undefined : idValue;
		}

		if ( binding.source === 'media_type' ) {
			const urlValue = element?._mwpMediaChanges?.url || editorState?.element?._mwpMediaChanges?.url || '';
			if ( typeof urlValue !== 'string' || !urlValue.trim() ) {
				return undefined;
			}
			return isVideoUrl( urlValue ) ? 'video' : 'image';
		}

		if ( !element || !ElementPrep || typeof ElementPrep.clean !== 'function' ) {
			return undefined;
		}

		const cleaned = ElementPrep.clean( element, {
			removeIdentity: true,
			removeControls: true,
			clone:          true,
		} );

		if ( binding.source === 'html' ) {
			let html = cleaned.innerHTML;
			if ( extractionOptions?.preserveNewlines ) {
				const clone = cleaned.cloneNode( true );
				clone.querySelectorAll( 'br' ).forEach( br => {
					br.replaceWith( '\n' );
				} );
				html = clone.innerHTML;
			}
			if ( extractionOptions?.newlinesToBR && typeof html === 'string' ) {
				html = html.replace( /\n/g, '<br>' );
			}
			if ( typeof html === 'string' ) {
				html = html.replace( /(?:\u00A0|&nbsp;|&#160;)/g, ' ' );
			}
			return stripEditorPlaceholderChars( html );
		}

		if ( binding.source === 'plaintext' ) {
			return stripEditorPlaceholderChars( cleaned.textContent.replace( /\u00A0/g, ' ' ).trim() );
		}

		if ( binding.source === 'textalignment' || binding.source === 'columnalignment' ) {
			return readTextAlignmentFromElement( element );
		}

		return undefined;
	}

	function deepCloneAttributes( attrs ) {
		try {
			return JSON.parse( JSON.stringify( attrs || {} ) );
		} catch ( error ) {
			return { ...( attrs || {} ) };
		}
	}

	/**
	 * Clone one attribute change payload value so schema merges never retain
	 * live references back into editor state.
	 *
	 * @param {*} value Attribute change value.
	 * @returns {*} Cloned value when structured, otherwise the original scalar.
	 */
	function cloneAttributeChangeValue( value ) {
		if ( Array.isArray( value ) || isPlainObject( value ) ) {
			try {
				return JSON.parse( JSON.stringify( value ) );
			} catch ( error ) {
				if ( Array.isArray( value ) ) {
					return [ ...value ];
				}
				return { ...value };
			}
		}

		return value;
	}

	/**
	 * Apply unsaved editor attr changes onto canonical block attrs using the
	 * same dotted-path semantics exposed through the schema contract.
	 *
	 * @param {?Object} baseAttributes Canonical parsed block attrs.
	 * @param {?Object} attributeChanges Unsaved editor attr mutations.
	 * @returns {Object} Merged attribute snapshot.
	 */
	function applyAttributeChangesToAttributes( baseAttributes, attributeChanges ) {
		const mergedAttributes = deepCloneAttributes( baseAttributes || {} );
		if ( !isPlainObject( attributeChanges ) ) {
			return mergedAttributes;
		}

		Object.keys( attributeChanges ).forEach( rawPath => {
			const path = typeof rawPath === 'string' ? rawPath.trim() : '';
			if ( !path ) {
				return;
			}

			const value = attributeChanges[ rawPath ];
			if (
				path.indexOf( '.' ) === -1 &&
				isPlainObject( value ) &&
				isPlainObject( mergedAttributes[ path ] )
			) {
				mergedAttributes[ path ] = applyAttributeChangesToAttributes(
					mergedAttributes[ path ],
					value
				);
				return;
			}

			setValueByPath( mergedAttributes, path, cloneAttributeChangeValue( value ) );
		} );

		return mergedAttributes;
	}

	function isListElement( element ) {
		return !!element && (
			element.tagName === 'UL' ||
			element.tagName === 'OL'
		);
	}

	function findSchemaListBindingState( rootElement, editorState, runtime ) {
		const editableComponents = Array.isArray( editorState?.editableComponents )
			? editorState.editableComponents
			: [];

		for ( const component of editableComponents ) {
			const componentMeta = runtime?.componentsById?.[ component.id ];
			if ( !componentMeta || !Array.isArray( componentMeta.bindings ) ) {
				continue;
			}

			const hasListBinding = componentMeta.bindings.some( binding => binding.source === 'list_block' );
			if ( !hasListBinding ) {
				continue;
			}

			const liveComponentElement = resolveLiveComponentElement( rootElement, component );
			if ( liveComponentElement && component.element !== liveComponentElement ) {
				component.element = liveComponentElement;
			}

			const componentElement = liveComponentElement || component.element || null;
			let listElement = null;

			if ( isListElement( componentElement ) ) {
				listElement = componentElement;
			} else if ( componentElement && typeof componentElement.querySelector === 'function' ) {
				listElement = componentElement.querySelector( ':scope > ul, :scope > ol' )
					|| componentElement.querySelector( 'ul, ol' );
			}

			if ( !isListElement( listElement ) ) {
				return {
					component,
					componentMeta,
					listElement: null,
				};
			}

			return {
				component,
				componentMeta,
				listElement,
			};
		}

		return null;
	}

	function buildRuntimeComponentLabel( componentDefinition, context ) {
		if ( typeof context?.pathLabel === 'string' && context.pathLabel.trim() ) {
			return `${ componentDefinition.label } (${ context.pathLabel.trim() })`;
		}

		if ( Number.isInteger( context?.row ) && Number.isInteger( context?.column ) ) {
			return `${ componentDefinition.label } (${ context.row + 1 },${ context.column + 1 })`;
		}

		return componentDefinition.label;
	}

	/**
	 * Determine whether a list item contains meaningful inline or nested-list
	 * content after placeholder artifacts have been stripped.
	 *
	 * Empty parent items that only own empty descendants should still fail
	 * required validation, while parent items with meaningful nested list content
	 * remain valid even if their own inline text span is blank.
	 *
	 * @param {HTMLElement|null} listItem List item to inspect.
	 * @returns {boolean} True when the list item is meaningfully populated.
	 */
	function listItemHasMeaningfulSchemaContent( listItem ) {
		if ( !isElementNode( listItem ) || listItem.tagName !== 'LI' ) {
			return false;
		}

		const directText = Array.from( listItem.childNodes || [] ).some( node => {
			if ( !node ) return false;

			if ( node.nodeType === Node.TEXT_NODE ) {
				return String( node.textContent || '' )
					.replace( /\uFEFF/g, '' )
					.replace( /\u00A0/g, ' ' )
					.trim()
					.length > 0;
			}

			if ( node.nodeType !== Node.ELEMENT_NODE ) {
				return false;
			}

			if ( node.tagName === 'OL' || node.tagName === 'UL' || node.tagName === 'BR' ) {
				return false;
			}

			return hasMeaningfulManagedComponentContent( node );
		} );

		if ( directText ) {
			return true;
		}

		const nestedLists = Array.from( listItem.children || [] ).filter( child => (
			child.tagName === 'OL' || child.tagName === 'UL'
		) );

		return nestedLists.some( nestedList => (
			Array.from( nestedList.children || [] ).some( child => listItemHasMeaningfulSchemaContent( child ) )
		) );
	}

	/**
	 * Validate that a required list component does not contain empty list items.
	 *
	 * @param {Object|null} listBindingState Resolved list binding state.
	 * @returns {string|null} Validation error message when the list is invalid.
	 */
	function validateRequiredSchemaListBindingState( listBindingState ) {
		const componentMeta = listBindingState?.componentMeta || null;
		const listElement = listBindingState?.listElement || null;
		if ( !isRequiredTextComponent( componentMeta ) ) {
			return null;
		}

		if ( !isListElement( listElement ) ) {
			return `${ listBindingState?.component?.label || 'Required text field' } is missing and cannot be saved empty. Add some text or cancel to restore original.`;
		}

		const allListItems = Array.from( listElement.querySelectorAll( 'li' ) );
		const hasEmptyItem = allListItems.some( listItem => !listItemHasMeaningfulSchemaContent( listItem ) );
		if ( hasEmptyItem ) {
			return `${ listBindingState?.component?.label || 'Required text field' } cannot contain empty items. Add text to each item or cancel to restore original.`;
		}

		return null;
	}

	function buildSchemaListPayload( listBindingState, editorState, attrChanges ) {
		const ListBlockTracker = SFE.ListBlockTracker;
		const listElement = listBindingState?.listElement || null;
		const tracker = editorState?.listTracker
			|| listElement?._mwpListTracker
			|| ListBlockTracker?.active
			|| null;

		if (
			!listElement ||
			!ListBlockTracker ||
			typeof ListBlockTracker.parseListToBlock !== 'function' ||
			!tracker
		) {
			return null;
		}

		const parsedListBlock = ListBlockTracker.parseListToBlock( listElement, tracker );
		if ( !parsedListBlock || typeof parsedListBlock !== 'object' ) {
			return null;
		}

		const safeAttrChanges = isPlainObject( attrChanges ) ? { ...attrChanges } : {};
		if ( Object.prototype.hasOwnProperty.call( safeAttrChanges, 'ordered' ) ) {
			delete safeAttrChanges.ordered;
		}

		const nextBlock = {
			...parsedListBlock,
			attributes: applyAttributeChangesToAttributes(
				parsedListBlock.attributes || {},
				safeAttrChanges
			),
		};

		let serialized = '';
		try {
			serialized = wp.blocks.serialize( [ nextBlock ] );
		} catch ( error ) {
			console.error( 'FrontEdit Schema: wp.blocks.serialize failed for list binding', error );
			return null;
		}

		return {
			_type: 'raw_block_content',
			rawContent: serialized,
		};
	}

	function applySchemaBindingToAttributes( attrs, binding, component, editorState, componentMeta = null ) {
		if ( binding.source === 'list_block' ) {
			return;
		}

		const value = extractBindingValue( binding, component, editorState, componentMeta );
		// URL/id bindings are sparse patch values; when unchanged, preserve attrs from parsed raw block content.
		if (
			(
				binding.source === 'url'
				|| binding.source === 'id'
				|| binding.source === 'media_type'
			) &&
			( value === undefined || value === null )
		) {
			return;
		}
		setValueByPath( attrs, binding.path, value );
	}

	function validateRequiredSchemaTextComponents( rootElement, editorState, runtime ) {
		if ( !runtime || !Array.isArray( editorState?.editableComponents ) ) {
			return null;
		}

		for ( const component of editorState.editableComponents ) {
			const componentMeta = runtime.componentsById?.[ component?.id ] || null;
			if ( !isRequiredTextComponent( componentMeta ) ) {
				continue;
			}

			const liveComponentElement = resolveLiveComponentElement( rootElement, component );
			if ( liveComponentElement && component.element !== liveComponentElement ) {
				component.element = liveComponentElement;
			}

			const componentElement = liveComponentElement || component?.element || null;
			if ( !isElementNode( componentElement ) ) {
				return `${ component?.label || 'Required text field' } is missing and cannot be saved empty. Add some text or cancel to restore original.`;
			}

			if ( !hasMeaningfulManagedComponentContent( componentElement ) ) {
				return `${ component?.label || 'Required text field' } cannot be empty. Add some text or cancel to restore original.`;
			}
		}

		return null;
	}

	function buildSchemaPayload( element, editorState ) {
		const runtime = editorState?._mwpSchemaRuntime;
		const blockState = editorState?.blockState;
		if ( !runtime || !blockState?.rawContent ) return null;
		if ( !window.wp?.blocks?.parse || !window.wp?.blocks?.serialize ) return null;

		let parsedBlock = null;
		try {
			[ parsedBlock ] = wp.blocks.parse( blockState.rawContent );
		} catch ( error ) {
			console.error( 'FrontEdit Schema: failed to parse raw block content', error );
			return null;
		}

		if ( !parsedBlock ) return null;

		const attrChanges = {
			...( isPlainObject( editorState?.attributeChanges ) ? editorState.attributeChanges : {} ),
			...( isPlainObject( element?._mwpEditor?.attributeChanges ) ? element._mwpEditor.attributeChanges : {} ),
			...( isPlainObject( element?._mwpMediaChanges ) ? element._mwpMediaChanges : {} ),
		};

		const listBindingState = findSchemaListBindingState( element, editorState, runtime );
		if ( listBindingState ) {
			const requiredListValidationError = validateRequiredSchemaListBindingState( listBindingState );
			if ( requiredListValidationError ) {
				throw new Error( requiredListValidationError );
			}

			const listPayload = buildSchemaListPayload( listBindingState, editorState, attrChanges );
			if ( listPayload ) {
				return listPayload;
			}
			return null;
		}

		const requiredValidationError = validateRequiredSchemaTextComponents( element, editorState, runtime );
		if ( requiredValidationError ) {
			throw new Error( requiredValidationError );
		}

		const newAttrs = applyAttributeChangesToAttributes(
			parsedBlock.attributes || {},
			attrChanges
		);

		if ( runtime.mode === 'media' && runtime.mediaComponent ) {
			const mediaComponentMeta = runtime.componentsById?.[ runtime.mediaComponent.id ] || null;
			runtime.mediaComponent.bindings.forEach( binding => {
				applySchemaBindingToAttributes( newAttrs, binding, { element }, editorState, mediaComponentMeta );
			} );
		}

		const editableComponents = Array.isArray( editorState.editableComponents )
			? editorState.editableComponents
			: [];

		editableComponents.forEach( component => {
			const componentMeta = runtime.componentsById[ component.id ];
			if ( !componentMeta ) return;
			const liveComponentElement = resolveLiveComponentElement( element, component );
			if ( liveComponentElement && component.element !== liveComponentElement ) {
				component.element = liveComponentElement;
			}
			const componentState = liveComponentElement
				? { ...component, element: liveComponentElement }
				: component;

			componentMeta.bindings.forEach( binding => {
				applySchemaBindingToAttributes( newAttrs, binding, componentState, editorState, componentMeta );
			} );
		} );

		const nextBlock = {
			...parsedBlock,
			attributes: newAttrs,
		};

		let serialized = '';
		try {
			serialized = wp.blocks.serialize( [ nextBlock ] );
		} catch ( error ) {
			console.error( 'FrontEdit Schema: wp.blocks.serialize failed', error );
			return null;
		}

		return {
			_type: 'raw_block_content',
			rawContent: serialized,
		};
	}

	/**
	 * Sync schema placeholders and optional missingUI shell lifecycle for a block.
	 *
	 * @param {HTMLElement} rootElement Block root element.
	 * @param {Object}      handler     Active edit handler.
	 * @param {Object}      options     Runtime options.
	 * @param {Object|null} options.blockAttributes Canonical block attributes.
	 * @param {Object|null} options.attributeChanges Unsaved attribute changes.
	 * @param {boolean}     options.removeInactiveEmpty Remove empty inactive shells.
	 * @returns {void}
	 */
	function syncSchemaPlaceholders( rootElement, handler, options = {} ) {
		const placeholderApi = SFE.RichTextPlaceholder || null;
		if (
			!isElementNode( rootElement ) ||
			!handler ||
			!placeholderApi ||
			typeof placeholderApi.syncElement !== 'function'
		) {
			return;
		}

		const schema = getSchemaForHandler( handler, schemaRegistry );
		if ( !schema || !Array.isArray( schema.components ) ) {
			return;
		}

		schema.components.forEach( componentDefinition => {
			if ( !componentDefinition || componentDefinition.type !== 'text' ) {
				return;
			}

			const matches = resolveSchemaComponentElements( rootElement, componentDefinition, {
				materializeGhost: true,
				blockAttributes: options.blockAttributes,
				attributeChanges: options.attributeChanges,
			} );
			if ( !matches.length ) return;

			matches.forEach( matchedElement => {
				if (
					typeof componentDefinition.placeholder === 'string' &&
					componentDefinition.placeholder.trim()
				) {
					placeholderApi.syncElement( matchedElement, componentDefinition.placeholder );
				}
				syncManagedMissingComponentState( matchedElement, componentDefinition, {
					removeInactiveEmpty: options.removeInactiveEmpty !== false,
				} );
			} );
		} );
	}

	function syncExistingBoundPlaceholders() {
		if ( typeof document === 'undefined' ) return;

		document.querySelectorAll( '[data-mwp-sfe-uuid]' ).forEach( element => {
			const handlers = Array.isArray( element._mwpSfeHandlers )
				? element._mwpSfeHandlers
				: [];
			const editHandler = handlers.find( handler => handler?.capability === 'edit' ) || null;
			if ( editHandler ) {
				syncSchemaPlaceholders( element, editHandler );
			}
		} );
	}

	/**
	 * Sync missingUI shell visibility/removal for a concrete component element.
	 *
	 * @param {HTMLElement} element             Component element.
	 * @param {?Object}     componentDefinition Optional schema component definition.
	 * @param {Object}      options             Sync options.
	 * @param {boolean}     options.removeInactiveEmpty Remove empty inactive shells.
	 * @returns {void}
	 */
	function syncManagedMissingComponentStateForElement( element, componentDefinition = null, options = {} ) {
		if ( !isElementNode( element ) ) return;
		syncManagedMissingComponentState( element, componentDefinition, options );
	}

	const schemaRegistry = buildSchemaRegistry( RAW_SCHEMA_DATA );

	/**
	 * Resolve schema runtime metadata for an edit session.
	 *
	 * @param {HTMLElement} rootElement Block root element.
	 * @param {Object}      handler     Candidate edit handler.
	 * @param {Object}      options     Resolution options.
	 * @param {?Object}     options.blockState Block-state payload containing attrs.
	 * @param {?Object}     options.blockAttributes Canonical block attrs.
	 * @param {?Object}     options.attributeChanges Unsaved attribute overrides.
	 * @param {boolean}     options.removeInactiveEmpty Remove empty inactive shells.
	 * @returns {?Object}   Schema resolution bundle, or null when not schema-backed.
	 */
	function resolveForEditing( rootElement, handler, options = {} ) {
		if ( !isElementNode( rootElement ) || !handler ) return null;
		const schema = getSchemaForHandler( handler, schemaRegistry );
		if ( !schema ) return null;

		const blockAttributes = isPlainObject( options.blockState?.attrs )
			? options.blockState.attrs
			: ( isPlainObject( options.blockAttributes ) ? options.blockAttributes : null );
		const attributeChanges = isPlainObject( options.attributeChanges )
			? options.attributeChanges
			: null;

		syncSchemaPlaceholders( rootElement, handler, {
			blockAttributes,
			attributeChanges,
			removeInactiveEmpty: options.removeInactiveEmpty !== false,
		} );

		const runtime = buildRuntimeFromSchema( rootElement, schema, {
			blockAttributes,
			attributeChanges,
		} );
		if ( !runtime ) return null;

		return {
			schema,
			runtime,
			runtimeHandler: createSchemaAwareHandler( handler, runtime ),
		};
	}

	function refreshEditorState( editorState, options = {} ) {
		if ( !editorState?.element || !editorState?.handler ) return null;

		const resolved = resolveForEditing( editorState.element, editorState.handler, {
			blockState: options.blockState || editorState.blockState || null,
			blockAttributes: options.blockAttributes || null,
			attributeChanges: options.attributeChanges || editorState.attributeChanges || null,
		} );
		if ( !resolved?.runtimeHandler ) {
			return null;
		}

		editorState.handler = resolved.runtimeHandler;
		editorState._mwpSchemaRuntime = resolved.runtime;
		editorState._mwpSchemaHandlerId = resolved.schema?.handlerId || editorState.handler.id || '';

		return resolved;
	}

	function runtimeHasListBinding( runtime ) {
		if ( !runtime || !isPlainObject( runtime.componentsById ) ) return false;
		const componentIds = Object.keys( runtime.componentsById );
		for ( const id of componentIds ) {
			const componentMeta = runtime.componentsById[ id ];
			if ( !componentMeta || !Array.isArray( componentMeta.bindings ) ) {
				continue;
			}

			if ( componentMeta.bindings.some( binding => binding.source === 'list_block' ) ) {
				return true;
			}
		}
		return false;
	}

	function hasListBinding( editorState, runtimeOverride = null ) {
		const runtime = runtimeOverride || editorState?._mwpSchemaRuntime || null;
		return runtimeHasListBinding( runtime );
	}

	function collectRuntimeMediaUrlBindingPaths( runtime, editorState = null ) {
		if ( !runtime ) return [];

		const paths = [];
		const seen  = new Set();
		const addPath = path => {
			const cleanPath = typeof path === 'string' ? path.trim() : '';
			if ( !cleanPath || seen.has( cleanPath ) ) return;
			seen.add( cleanPath );
			paths.push( cleanPath );
		};

		const addFromBindings = bindings => {
			if ( !Array.isArray( bindings ) ) return;
			bindings.forEach( binding => {
				if ( binding && binding.source === 'url' ) {
					addPath( binding.path );
				}
			} );
		};

		if ( runtime.mediaComponent && Array.isArray( runtime.mediaComponent.bindings ) ) {
			addFromBindings( runtime.mediaComponent.bindings );
		}

		const componentsById = isPlainObject( runtime.componentsById ) ? runtime.componentsById : {};
		if ( Array.isArray( editorState?.editableComponents ) ) {
			editorState.editableComponents.forEach( component => {
				const componentMeta = componentsById[ component?.id ];
				if ( componentMeta?.type === 'file' ) {
					addFromBindings( componentMeta.bindings );
				}
			} );
		}

		if ( !paths.length ) {
			Object.keys( componentsById ).forEach( id => {
				const componentMeta = componentsById[ id ];
				if ( componentMeta?.type === 'file' ) {
					addFromBindings( componentMeta.bindings );
				}
			} );
		}

		return paths;
	}

	function resolveInitialMediaSource( editorState, blockState = null, runtimeOverride = null ) {
		const runtime = runtimeOverride || editorState?._mwpSchemaRuntime || null;
		if ( !runtime ) return '';

		const attrs = isPlainObject( blockState?.attrs )
			? blockState.attrs
			: ( isPlainObject( editorState?.originalAttributes ) ? editorState.originalAttributes : null );
		if ( !attrs ) return '';

		const urlPaths = collectRuntimeMediaUrlBindingPaths( runtime, editorState );
		for ( const path of urlPaths ) {
			const value = getValueByPath( attrs, path );
			if ( typeof value === 'string' && value.trim() ) {
				return value;
			}
		}

		return '';
	}

	const schemaRuntimeApi = {
		version: RAW_SCHEMA_DATA.version || 1,
		schemas: schemaRegistry,
		getSchemaForHandler: handler => getSchemaForHandler( handler, schemaRegistry ),
		buildRuntimeFromSchema,
		createRuntimeHandler: createSchemaAwareHandler,
		resolveForEditing,
		refreshEditorState,
		buildPayloadFromRuntime: buildSchemaPayload,
		syncPlaceholders: syncSchemaPlaceholders,
		reconcileRenderedSnapshot,
		syncManagedMissingComponentStateForElement,
		hasListBinding,
		resolveInitialMediaSource,
		splitBindingPath,
		getValueByPath,
		collectMediaUrlBindingPaths: collectRuntimeMediaUrlBindingPaths,
	};

	SFE.SchemaRuntime = schemaRuntimeApi;
	SFE.SchemaV2 = {
		version: RAW_SCHEMA_DATA.version || 1,
		schemas: schemaRegistry,
		buildRuntimeFromSchema,
		resolveForEditing,
		refreshEditorState,
		buildSchemaPayload,
		reconcileRenderedSnapshot,
		syncManagedMissingComponentStateForElement,
	};

	syncExistingBoundPlaceholders();
} )();
