/**
 * Block serializer - builds canonical schema payloads for saving.
 *
 * Reads:   SFE.SchemaRuntime
 * Exposes: SFE.BlockSerializer { buildBlockPayload, phpBlocksToWPBlocks, wpBlocksToPHPBlocks }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Convert PHP-format inner blocks (blockName/attrs) to wp.blocks format (name/attributes).
	 * Required because the REST API returns PHP-serialized block structure.
	 */
	function phpBlocksToWPBlocks( phpBlocks ) {
		return ( phpBlocks || [] ).map( b => ( {
			name:            b.blockName,
			attributes:      { ...( b.attrs || {} ) },
			innerBlocks:     phpBlocksToWPBlocks( b.innerBlocks || [] ),
			originalContent: b.innerHTML    || '',
			innerContent:    b.innerContent  || [],
		} ) );
	}

	/**
	 * Convert wp.blocks-format inner blocks back to PHP format for the REST payload.
	 */
	function wpBlocksToPHPBlocks( wpBlocks ) {
		return ( wpBlocks || [] ).map( b => ( {
			blockName:    b.name,
			attrs:        b.attributes      || {},
			innerBlocks:  wpBlocksToPHPBlocks( b.innerBlocks || [] ),
			innerHTML:    b.originalContent || '',
			innerContent: b.innerContent    || [],
		} ) );
	}

	/**
	 * Build a canonical raw block payload through the schema runtime.
	 *
	 * Non-schema payload building has been removed; all supported handlers are
	 * schema-driven and must provide runtime metadata on editor open.
	 *
	 * @param {HTMLElement} element     Live block root element.
	 * @param {Object}      editorState Active editor state.
	 * @returns {Object|null}           Schema payload or null when unavailable.
	 */
	function buildBlockPayload( element, editorState ) {
		const blockState = editorState.blockState;
		if ( !blockState?.blockName ) {
			console.error( 'FrontEdit: buildBlockPayload - blockState missing on editorState' );
			return null;
		}

		const schemaRuntime = SFE.SchemaRuntime || null;
		if (
			!editorState?._mwpSchemaRuntime ||
			!schemaRuntime ||
			typeof schemaRuntime.buildPayloadFromRuntime !== 'function'
		) {
			console.error( 'FrontEdit: buildBlockPayload requires schema runtime metadata', blockState.blockName );
			return null;
		}

		const schemaPayload = schemaRuntime.buildPayloadFromRuntime( element, editorState );
		if ( !schemaPayload ) {
			console.error( 'FrontEdit: schema runtime failed to build payload', blockState.blockName );
			return null;
		}

		return schemaPayload;
	}

	SFE.BlockSerializer = { buildBlockPayload, phpBlocksToWPBlocks, wpBlocksToPHPBlocks };

})();
